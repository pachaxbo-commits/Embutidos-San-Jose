import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronRight, ClipboardCheck, FileText, Lock, PackageCheck, Printer, Search, Send, Unlock } from 'lucide-react'
import { Field, NumberInput, Segmented, TextInput } from '../../../components/ui/Form'
import { ChoiceButton, ChoiceModal } from '../../../components/ui/ChoiceModal'
import { Modal } from '../../../components/ui/Modal'
import { EmptyBlock, Screen } from '../../../components/ui/Screen'
import { buildReconciliation, computeMoneySummary, matchesRoute, round2, toDayKey } from '../domain/engine'
import { declareRouteReturn, reopenClosure, saveClosure, setClosureVarianceReviewed, subscribeSales, subscribeCollections, subscribeExpenses } from '../data/distributionRepository'
import { KpiCard, PrimaryButton, SecondaryButton, SectionCard, VarianceBadge, formatBs, formatQty } from './shared'
import type { DistributionViewProps } from './DistributionApp'
import type { DistSale, DistCollection, DistExpense, DistClosure } from '../types'
import { printClosureTicket, printClosureSheet, shareClosurePdf } from '../data/distributionDocumentPrintService'
import { getProductPresentation } from '../domain/productPresentation'
import { calculateReturnBreakdown, validateReturnQuantity } from '../domain/returnReconciliation'

const CLOSURE_STATUS: Record<DistClosure['status'], string> = {
  draft: 'Devolución declarada; espera confirmación de almacén',
  warehouse_done: 'Devolución confirmada por almacén',
  closed: 'Cierre finalizado',
  reopened: 'Cierre reabierto',
}

/**
 * Arqueo de ruta: conciliacion fisica por producto y cuadre de dinero.
 *
 * El efectivo esperado solo considera efectivo:
 *   expectedCash = ventas efectivo + cobros efectivo - gastos efectivo
 * QR y credito no entran al efectivo fisico.
 */
export function ClosureView({ session, data }: DistributionViewProps) {
  const [productSearch, setProductSearch] = useState('')
  const isDistributor = session.role === 'distributor'
  const availableDispatches = data.openDispatches.filter(d => session.role !== 'warehouse' || (d.warehouseId || 'central') === (session.warehouseId || 'central'))
  const canRegisterReturn = session.can('dist.return.register')
  const canCloseMoney = session.can('dist.closure.money')

  const [selectedDispatchId, setSelectedDispatchId] = useState('')
  const [returnDrafts, setReturnDrafts] = useState<Record<string, Record<string, string>>>({})
  const [wasteDrafts, setWasteDrafts] = useState<Record<string, Record<string, string>>>({})
  const [wasteReasonDrafts, setWasteReasonDrafts] = useState<Record<string, Record<string, string>>>({})
  const [cashDrafts, setCashDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isSubmittingRef = useRef(false)
  const [justClosedRouteName, setJustClosedRouteName] = useState<string | null>(null)
  const [isDispatchOpen, setIsDispatchOpen] = useState(false)
  const [historyOpenId, setHistoryOpenId] = useState<string | null>(null)
  const [reviewingClosureId, setReviewingClosureId] = useState('')
  const [confirmingDeclaration, setConfirmingDeclaration] = useState(false)
  const [confirmingClosure, setConfirmingClosure] = useState(false)
  const [reopenTarget, setReopenTarget] = useState<DistClosure | null>(null)
  const [reopenReason, setReopenReason] = useState('')
  const [isReopening, setIsReopening] = useState(false)
  const todayKey = toDayKey(new Date())
  const [adminDayKey, setAdminDayKey] = useState(todayKey)
  const [adminDeclaredCash, setAdminDeclaredCash] = useState('')
  const [adminNote, setAdminNote] = useState('')
  const [confirmingAdminClosure, setConfirmingAdminClosure] = useState(false)
  const [closureTab, setClosureTab] = useState<'routes' | 'admin'>(availableDispatches.length === 0 && session.role === 'admin' ? 'admin' : 'routes')

  const dispatch = availableDispatches.find(item => item.id === selectedDispatchId) ?? availableDispatches[0] ?? null

  const existingClosure = data.closures.find((closure) => closure.dispatchId === dispatch?.id) ?? null

  const returnsAlreadyApplied = existingClosure
    ? Boolean(existingClosure.warehouseClosedBy)
    : false

  const dispatchKey = dispatch?.id || ''
  const dispatchDay = dispatch?.dayKey || ''
  const dispatchRoute = dispatch?.routeId || ''
  const dispatchCreated = dispatch?.createdAt || ''
  const existingProductsById = new Map((existingClosure?.products || []).map(row => [row.productId, row]))
  const savedReturns = isDistributor
    ? Object.fromEntries(Object.entries(existingClosure?.declaredReturns || {}).map(([id, q]) => [id, String(q)]))
    : Object.fromEntries([...new Set([
        ...Object.keys(existingClosure?.declaredReturns || {}),
        ...existingProductsById.keys(),
      ])].map(id => {
        const row = existingProductsById.get(id)
        const physical = row?.physicalReturn ?? existingClosure?.declaredReturns?.[id] ?? (row ? round2(row.actualReturn + (row.returnWaste || 0)) : undefined)
        return [id, physical === undefined ? '' : String(physical)]
      }))
  const savedWastes = Object.fromEntries((existingClosure?.products || []).map(row => [row.productId, String(row.returnWaste || 0)]))
  const savedWasteReasons = Object.fromEntries((existingClosure?.products || []).map(row => [row.productId, row.returnWasteReason || '']))
  const returns = returnDrafts[dispatchKey] ?? savedReturns
  const wastes = wasteDrafts[dispatchKey] ?? savedWastes
  const wasteReasons = wasteReasonDrafts[dispatchKey] ?? savedWasteReasons
  const declaredCash = cashDrafts[dispatchKey] ?? (existingClosure?.physicalCashDeclared != null ? String(existingClosure.physicalCashDeclared) : '')
  const setDeclaredCash = (value: string) => setCashDrafts(current => ({ ...current, [dispatchKey]: value }))
  const setReturns = (updater: (current: Record<string, string>) => Record<string, string>) => setReturnDrafts(current => ({ ...current, [dispatchKey]: updater(current[dispatchKey] ?? savedReturns) }))
  const setWastes = (updater: (current: Record<string, string>) => Record<string, string>) => setWasteDrafts(current => ({ ...current, [dispatchKey]: updater(current[dispatchKey] ?? savedWastes) }))
  const setWasteReasons = (updater: (current: Record<string, string>) => Record<string, string>) => setWasteReasonDrafts(current => ({ ...current, [dispatchKey]: updater(current[dispatchKey] ?? savedWasteReasons) }))

  const [routeSales, setRouteSales] = useState<DistSale[]>([])
  const [routeCollections, setRouteCollections] = useState<DistCollection[]>([])
  const [routeExpenses, setRouteExpenses] = useState<DistExpense[]>([])
  const [readyDispatch, setReadyDispatch] = useState('')
  const loaded = readyDispatch === dispatchKey
  useEffect(() => {
    if (!dispatchKey) return
    const days = [dispatchDay, toDayKey(new Date())]
    const ready = new Set<string>()
    const expected = session.role === 'warehouse' ? 1 : 3
    const mark = (key: string) => { ready.add(key); if (ready.size >= expected) setReadyDispatch(dispatchKey) }
    const fail = (e: Error) => setError(e.message)
    const ownerUid = session.role === 'distributor' ? session.uid : undefined
    const stop = [subscribeSales(days, dispatchRoute, rows => { setRouteSales(rows.filter(s => s.sourceLocation !== 'centralWarehouse' && (s.dispatchId === dispatchKey || (!s.dispatchId && s.createdAt >= dispatchCreated)))); mark('sales') }, fail, ownerUid)]
    if (session.role !== 'warehouse') {
      stop.push(subscribeCollections(days, dispatchRoute, rows => { setRouteCollections(rows.filter(c => c.createdAt >= dispatchCreated)); mark('collections') }, fail, ownerUid))
      stop.push(subscribeExpenses(days, dispatchRoute, rows => { setRouteExpenses(rows.filter(e => e.createdAt >= dispatchCreated)); mark('expenses') }, fail, ownerUid))
    }
    return () => stop.forEach(fn => fn())
  }, [dispatchKey, dispatchDay, dispatchRoute, dispatchCreated, session.role, session.uid])

  /** La declaración y la recepción son independientes; cada rol completa su propio dato. */
  const isDeclared = (productId: string) => {
    const value = returns[productId]
    return value !== undefined && value !== '' && !Number.isNaN(Number(value))
  }

  const parsedReturns = useMemo(() => {
    const map: Record<string, number> = {}
    for (const [productId, value] of Object.entries(returns)) map[productId] = round2(Number(value) || 0)
    return map
  }, [returns])

  const parsedWastes = useMemo(() => Object.fromEntries(Object.entries(wastes).map(([id, value]) => [id, round2(Number(value) || 0)])), [wastes])
  const productRows = buildReconciliation(dispatch, routeSales, parsedReturns).map(row => {
    const returnWaste = parsedWastes[row.productId] || 0
    const breakdown = calculateReturnBreakdown(row.expectedReturn, row.actualReturn, returnWaste)
    const saved = existingProductsById.get(row.productId)
    const declaredReturn = existingClosure?.declaredReturns?.[row.productId] ?? saved?.declaredReturn
    return {
      ...row,
      declaredReturn,
      physicalReturn: isDistributor ? undefined : row.actualReturn,
      actualReturn: isDistributor ? row.actualReturn : breakdown.apt,
      returnWaste,
      returnWasteReason: wasteReasons[row.productId] || '',
      shortage: breakdown.shortage,
      overage: breakdown.overage,
      variance: round2(breakdown.overage - breakdown.shortage),
    }
  })

  const moneySummary = computeMoneySummary(routeSales, routeCollections, routeExpenses)
  const claimCash = data.claims.filter(c => c.routeId === dispatchRoute && c.createdAt >= dispatchCreated).reduce((n,c)=>n+c.cashIn-c.cashOut,0)
  const money = { ...moneySummary, expectedCash:round2(moneySummary.expectedCash+claimCash) }

  const declaredValue = round2(Number(declaredCash) || 0)
  // Mientras no se declare el efectivo fisico no hay diferencia que reportar:
  // guardar -368 en un cierre a medias confundia a quien revisaba el arqueo.
  const isCashDeclared = declaredCash !== ''
  const cashDifference = isCashDeclared ? round2(declaredValue - money.expectedCash) : 0

  const existingAdminClosure = useMemo(() => {
    return data.closures.find(c => c.closureType === 'admin' && c.dayKey === adminDayKey) ?? null
  }, [data.closures, adminDayKey])

  const adminMoney = useMemo(() => {
    const sales = data.sales
      .filter(s => s.dayKey === adminDayKey && (matchesRoute(s.routeId, 'administracion') || (!s.routeId && s.sourceLocation === 'centralWarehouse')))
      .map(s => s.effectiveSnapshot ? { ...s, ...s.effectiveSnapshot } : s)
    const collections = data.collections
      .filter(c => c.dayKey === adminDayKey && (matchesRoute(c.routeId, 'administracion') || c.collectedByUid === session.uid))
    const expenses = data.expenses
      .filter(e => e.dayKey === adminDayKey && (matchesRoute(e.routeId, 'administracion') || !e.routeId) && !e.voided)
    const claims = data.claims
      .filter(c => c.dayKey === adminDayKey && matchesRoute(c.routeId, 'administracion'))

    const commercialSales = sales.filter(s => s.saleKind !== 'courtesy')
    const cashSales = round2(commercialSales.reduce((n, s) => n + (s.cashAmount || 0), 0))
    const qrSales = round2(commercialSales.reduce((n, s) => n + (s.qrAmount || 0), 0))
    const creditGenerated = round2(commercialSales.reduce((n, s) => n + (s.creditAmount || 0), 0))
    const cashCollections = round2(collections.reduce((n, c) => n + (Number.isFinite(c.cashAmount) ? c.cashAmount! : c.method === 'cash' ? c.amount : 0), 0))
    const qrCollections = round2(collections.reduce((n, c) => n + (Number.isFinite(c.qrAmount) ? c.qrAmount! : c.method === 'qr' ? c.amount : 0), 0))
    const cashExpenses = round2(expenses.reduce((n, e) => n + (e.amount || 0), 0))
    const claimCash = round2(claims.reduce((n, c) => n + (c.cashIn || 0) - (c.cashOut || 0), 0))
    const expectedCash = round2(cashSales + cashCollections - cashExpenses + claimCash)

    return {
      cashSales,
      qrSales,
      creditGenerated,
      cashCollections,
      qrCollections,
      cashExpenses,
      claimCash,
      expectedCash,
    }
  }, [data.sales, data.collections, data.expenses, data.claims, adminDayKey, session.uid])

  const adminDeclaredVal = round2(Number(adminDeclaredCash) || 0)
  const isAdminCashDeclared = adminDeclaredCash.trim() !== ''
  const adminCashDifference = isAdminCashDeclared ? round2(adminDeclaredVal - adminMoney.expectedCash) : 0

  const executeAdminClosure = async () => {
    if (isSubmittingRef.current || isSubmitting) return
    isSubmittingRef.current = true
    setIsSubmitting(true)
    setError(null)
    const now = new Date().toISOString()
    const closureDoc: DistClosure = {
      id: `closure_admin_${adminDayKey}`,
      restaurantId: session.restaurantId,
      branchId: 'main',
      createdAt: now,
      createdBy: session.uid,
      dayKey: adminDayKey,
      schemaVersion: 1,
      closureType: 'admin',
      dispatchId: `admin_${adminDayKey}`,
      warehouseId: 'central',
      routeId: 'administracion',
      routeName: 'Administración',
      distributorUid: session.uid,
      distributorName: session.userName || 'Administración',
      status: 'closed',
      products: [],
      declaredReturns: {},
      returnDeclaredBy: '',
      returnDeclaredAt: '',
      cashDeclaredBy: session.uid,
      cashDeclaredAt: now,
      cashSales: adminMoney.cashSales,
      qrSales: adminMoney.qrSales,
      creditGenerated: adminMoney.creditGenerated,
      cashCollections: adminMoney.cashCollections,
      qrCollections: adminMoney.qrCollections,
      cashExpenses: adminMoney.cashExpenses,
      claimCash: adminMoney.claimCash,
      expectedCash: adminMoney.expectedCash,
      physicalCashDeclared: adminDeclaredVal,
      cashDifference: adminCashDifference,
      closedBy: session.uid,
      closedAt: now,
      note: adminNote.trim(),
    }
    try {
      await saveClosure({ closure: closureDoc, applyStockReturn: false })
      setConfirmingAdminClosure(false)
      setAdminDeclaredCash('')
      setAdminNote('')
    } catch (e) {
      setError((e as Error).message || 'No se pudo guardar el arqueo de Administración.')
      setConfirmingAdminClosure(false)
    } finally {
      isSubmittingRef.current = false
      setIsSubmitting(false)
    }
  }

  const buildClosureDoc = (status: DistClosure['status']): DistClosure | null => {
    if (!dispatch) return null
    const now = new Date().toISOString()
    const cashValueToSave = isCashDeclared
      ? declaredValue
      : (existingClosure?.physicalCashDeclared ?? undefined)
    const effectiveDifference = cashValueToSave !== undefined
      ? round2(cashValueToSave - money.expectedCash)
      : 0
    return {
      id: `closure_${dispatch.id}`,
      restaurantId: session.restaurantId,
      branchId: 'main',
      createdAt: existingClosure?.createdAt ?? now,
      createdBy: existingClosure?.createdBy ?? session.uid,
      dayKey: existingClosure?.dayKey ?? toDayKey(now),
      schemaVersion: 1,
      dispatchId: dispatch.id,
      warehouseId: dispatch.warehouseId || 'central',
      routeId: dispatch.routeId,
      routeName: dispatch.routeName,
      distributorUid: dispatch.distributorUid,
      distributorName: dispatch.distributorName,
      status,
      products: productRows,
      declaredReturns: existingClosure?.declaredReturns || {},
      returnDeclaredBy: existingClosure?.returnDeclaredBy || '',
      returnDeclaredAt: existingClosure?.returnDeclaredAt || '',
      cashDeclaredBy: existingClosure?.cashDeclaredBy || (isCashDeclared ? session.uid : ''),
      cashDeclaredAt: existingClosure?.cashDeclaredAt || (isCashDeclared ? now : ''),
      cashSales: money.cashSales,
      qrSales: money.qrSales,
      creditGenerated: money.creditGenerated,
      cashCollections: money.cashCollections,
      qrCollections: money.qrCollections,
      cashExpenses: money.cashExpenses,
      expectedCash: money.expectedCash,
      physicalCashDeclared: cashValueToSave,
      cashDifference: effectiveDifference,
      // Firestore rechaza undefined: los campos aun no ocurridos van vacios.
      warehouseClosedBy: status === 'warehouse_done' ? session.uid : (existingClosure?.warehouseClosedBy ?? ''),
      warehouseClosedAt: status === 'warehouse_done' ? now : (existingClosure?.warehouseClosedAt ?? ''),
      closedBy: status === 'closed' ? session.uid : (existingClosure?.closedBy ?? ''),
      closedAt: status === 'closed' ? now : (existingClosure?.closedAt ?? ''),
      note: existingClosure?.note ?? '',
    }
  }

  const submit = async (status: DistClosure['status']) => {
    if (!dispatch || isSubmittingRef.current) return
    isSubmittingRef.current = true
    setIsSubmitting(true)
    setError(null)

    const closure = buildClosureDoc(status)
    if (!closure) {
      isSubmittingRef.current = false
      setIsSubmitting(false)
      return
    }

    if (status === 'warehouse_done') {
      const sinDeclarar = productRows.filter((row) => !isDeclared(row.productId))
      if (sinDeclarar.length > 0) {
        setError(`Falta declarar el retorno de: ${sinDeclarar.map((row) => row.productName).join(', ')}.`)
        isSubmittingRef.current = false
        setIsSubmitting(false)
        return
      }
    }

    if (Object.values(parsedReturns).some(q => !Number.isFinite(q) || q < 0)) {
      setError('No se permiten retornos negativos.')
      isSubmittingRef.current = false
      setIsSubmitting(false)
      return
    }
    if (status === 'warehouse_done') {
      const invalidQuantity = productRows.find(row =>
        !validateReturnQuantity(row.unitType, parsedReturns[row.productId] || 0)
        || !validateReturnQuantity(row.unitType, parsedWastes[row.productId] || 0))
      if (invalidQuantity) {
        setError(`${invalidQuantity.productName}: paquetes y unidades requieren cantidades enteras; los kilogramos admiten decimales.`)
        isSubmittingRef.current = false
        setIsSubmitting(false)
        return
      }
      const missingReason = productRows.find(row => (parsedWastes[row.productId] || 0) > 0 && !wasteReasons[row.productId]?.trim())
      if (missingReason) {
        setError(`Indica el motivo de merma para ${missingReason.productName}.`)
        isSubmittingRef.current = false
        setIsSubmitting(false)
        return
      }
      const excessWaste = productRows.find(row => !calculateReturnBreakdown(row.expectedReturn, parsedReturns[row.productId] || 0, parsedWastes[row.productId] || 0).wasteValid)
      if (excessWaste) {
        setError(`La merma de ${excessWaste.productName} no puede superar lo recibido ni lo que debía retornar.`)
        isSubmittingRef.current = false
        setIsSubmitting(false)
        return
      }
    }
    if (status === 'closed' && !returnsAlreadyApplied) {
      setError('Almacén debe confirmar primero el retorno físico.')
      isSubmittingRef.current = false
      setIsSubmitting(false)
      return
    }
    if (status === 'closed' && (declaredCash.trim() === '' || !Number.isFinite(Number(declaredCash)) || Number(declaredCash) < 0)) {
      setError('Ingresa el efectivo físico declarado antes de cerrar la ruta.')
      isSubmittingRef.current = false
      setIsSubmitting(false)
      return
    }

    try {
      await saveClosure({ closure, applyStockReturn: status === 'warehouse_done' && !returnsAlreadyApplied })
      if (status === 'closed') {
        setJustClosedRouteName(dispatch.routeName)
      }
    } catch (submitError) {
      setError((submitError as Error).message || 'No se pudo guardar el cierre.')
    } finally {
      isSubmittingRef.current = false
      setIsSubmitting(false)
    }
  }

  const requestDeclarationConfirmation = () => {
    if (isSubmittingRef.current || isSubmitting) return
    if (productRows.some(row => !isDeclared(row.productId))) {
      setError('Declara todos los productos, incluso si retornas cero.')
      return
    }
    if (declaredCash.trim() === '') {
      setError('Ingresa el efectivo que estás entregando. Si no devuelves dinero, escribe 0.')
      return
    }
    const cashNum = Number(declaredCash)
    if (!Number.isFinite(cashNum) || cashNum < 0) {
      setError('El efectivo declarado debe ser un número válido mayor o igual a 0.')
      return
    }
    setError(null)
    setConfirmingDeclaration(true)
  }

  const executeConfirmedDeclaration = async () => {
    if (!dispatch || isSubmittingRef.current || isSubmitting) return
    const cashNum = round2(Number(declaredCash))
    isSubmittingRef.current = true
    setIsSubmitting(true)
    setError(null)
    try {
      await declareRouteReturn(dispatch, parsedReturns, cashNum)
      setConfirmingDeclaration(false)
    } catch (e) {
      setError((e as Error).message)
      setConfirmingDeclaration(false)
    } finally {
      isSubmittingRef.current = false
      setIsSubmitting(false)
    }
  }

  const requestClosureConfirmation = () => {
    if (isSubmittingRef.current || isSubmitting) return
    if (!returnsAlreadyApplied) {
      setError('Almacén debe confirmar primero el retorno físico.')
      return
    }
    if (declaredCash.trim() === '') {
      setError('Ingresa el efectivo físico declarado antes de cerrar la ruta. Si no hay dinero, escribe 0.')
      return
    }
    const cashNum = Number(declaredCash)
    if (!Number.isFinite(cashNum) || cashNum < 0) {
      setError('El efectivo declarado debe ser mayor o igual a cero.')
      return
    }
    if (Object.values(parsedReturns).some(q => !Number.isFinite(q) || q < 0)) {
      setError('No se permiten retornos negativos.')
      return
    }
    setError(null)
    setConfirmingClosure(true)
  }

  const executeConfirmedClosure = async () => {
    if (isSubmittingRef.current || isSubmitting) return
    try {
      await submit('closed')
      setConfirmingClosure(false)
    } catch {
      setConfirmingClosure(false)
    }
  }

  const getClosureSortTimestamp = (closure: DistClosure) =>
    closure.closedAt || closure.warehouseClosedAt || closure.returnDeclaredAt || closure.createdAt || ''

  const historicalClosures = data.closures
    .filter(closure => session.role !== 'distributor' || closure.distributorUid === session.uid || closure.returnDeclaredBy === session.uid)
    .filter(closure => session.role !== 'warehouse' || (closure.warehouseId || 'central') === (session.warehouseId || 'central'))
    .slice()
    .sort((a, b) => getClosureSortTimestamp(b).localeCompare(getClosureSortTimestamp(a)))

  const closureHistory = (
    <SectionCard title="Historial de cierres">
      {historicalClosures.length === 0 ? <p className="text-xs font-semibold text-slate-500">Todavía no hay cierres registrados.</p> : <div className="grid gap-2">
        {historicalClosures.map(closure => {
          const expanded = historyOpenId === closure.id
          const hasProductDifference = closure.products.some(row => Math.abs(Number(row.variance) || 0) > 0.001)
          const closureTimestamp = closure.closedAt || closure.warehouseClosedAt || closure.returnDeclaredAt || closure.createdAt
          return <article key={closure.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <button type="button" onClick={() => setHistoryOpenId(expanded ? null : closure.id)} className="flex min-h-[62px] w-full items-center gap-3 p-3 text-left" aria-expanded={expanded}>
              <span className="min-w-0 flex-1"><strong className="block break-words text-sm text-slate-900">{closure.routeName || 'Ruta registrada'} · {closure.distributorName || 'Distribuidor'}</strong><span className="mt-0.5 block text-[11px] font-semibold text-slate-500">{closureTimestamp ? new Date(closureTimestamp).toLocaleString('es-BO') : 'Sin fecha registrada'}</span><span className="mt-1 block text-[10px] font-extrabold text-[var(--primary)]">{CLOSURE_STATUS[closure.status] || 'Estado pendiente'}</span></span>
              {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
            </button>
            {expanded && <div className="grid gap-3 border-t border-slate-100 p-3">
              <div className="grid gap-2 md:grid-cols-2">{closure.products.length === 0 ? <p className="text-xs text-slate-500">Almacén todavía no confirmó las cantidades.</p> : closure.products.map(row => {
                const declared = row.declaredReturn ?? closure.declaredReturns?.[row.productId]
                const physical = row.physicalReturn ?? row.actualReturn + (row.returnWaste || 0)
                return <div key={row.productId} className="rounded-xl bg-slate-50 p-3"><div className="flex items-start justify-between gap-2"><strong className="min-w-0 break-words text-xs text-slate-900">{row.productName}</strong><VarianceBadge variance={row.variance} unitType={row.unitType} /></div><dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4"><div><dt className="text-[9px] font-bold uppercase text-slate-400">Despachado</dt><dd className="text-xs font-black">{formatQty(row.totalLoaded, row.unitType)}</dd></div><div><dt className="text-[9px] font-bold uppercase text-slate-400">Vendido</dt><dd className="text-xs font-black">{formatQty(row.sold, row.unitType)}</dd></div><div><dt className="text-[9px] font-bold uppercase text-slate-400">Cortesía</dt><dd className="text-xs font-black">{formatQty(row.courtesy || 0, row.unitType)}</dd></div><div><dt className="text-[9px] font-bold uppercase text-slate-400">Debía retornar</dt><dd className="text-xs font-black">{formatQty(row.expectedReturn, row.unitType)}</dd></div><div><dt className="text-[9px] font-bold uppercase text-slate-400">Declarado por distribuidor</dt><dd className="text-xs font-black">{declared === undefined ? 'Sin registro' : formatQty(Number(declared), row.unitType)}</dd></div><div><dt className="text-[9px] font-bold uppercase text-slate-400">Recibido físicamente</dt><dd className="text-xs font-black">{formatQty(physical, row.unitType)}{row.physicalReturn === undefined ? ' · aprox.' : ''}</dd></div><div><dt className="text-[9px] font-bold uppercase text-slate-400">Retorno apto</dt><dd className="text-xs font-black text-emerald-700">{formatQty(row.actualReturn, row.unitType)}</dd></div><div><dt className="text-[9px] font-bold uppercase text-slate-400">Merma</dt><dd className="text-xs font-black text-rose-700">{formatQty(row.returnWaste || 0, row.unitType)}{row.returnWasteReason ? ` · ${row.returnWasteReason}` : ''}</dd></div><div><dt className="text-[9px] font-bold uppercase text-slate-400">Faltante</dt><dd className="text-xs font-black">{formatQty(row.shortage ?? Math.max(0, row.expectedReturn - row.actualReturn - (row.returnWaste || 0)), row.unitType)}</dd></div><div><dt className="text-[9px] font-bold uppercase text-slate-400">Sobrante en cuarentena</dt><dd className="text-xs font-black">{formatQty(row.overage || 0, row.unitType)}</dd></div></dl></div>
              })}</div>
              {session.role === 'admin' && closure.status === 'closed' && <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><KpiCard label="Ventas efectivo" value={formatBs(closure.cashSales)} /><KpiCard label="Ventas QR" value={formatBs(closure.qrSales)} /><KpiCard label="Crédito" value={formatBs(closure.creditGenerated)} /><KpiCard label="Cobros efectivo" value={formatBs(closure.cashCollections)} /><KpiCard label="Cobros QR" value={formatBs(closure.qrCollections)} /><KpiCard label="Gastos" value={formatBs(closure.cashExpenses)} /><KpiCard label="Efectivo esperado" value={formatBs(closure.expectedCash)} /><KpiCard label="Efectivo declarado" value={formatBs(closure.physicalCashDeclared ?? 0)} /></div>}
              {session.role === 'admin' && hasProductDifference && ['warehouse_done', 'closed'].includes(closure.status) && <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 p-3"><p className="text-xs font-semibold text-amber-900">{closure.varianceReviewedAt ? `Diferencia revisada el ${new Date(closure.varianceReviewedAt).toLocaleString('es-BO')}.` : 'Esta diferencia aparece en pendientes de Administración.'}</p><SecondaryButton disabled={Boolean(reviewingClosureId)} onClick={async () => { setReviewingClosureId(closure.id); setError(null); try { await setClosureVarianceReviewed(closure.id, !closure.varianceReviewedAt) } catch (e) { setError((e as Error).message) } finally { setReviewingClosureId('') } }}>{reviewingClosureId === closure.id ? 'Guardando…' : closure.varianceReviewedAt ? 'Volver a pendientes' : 'Marcar revisada'}</SecondaryButton></div>}
              {session.role === 'admin' && closure.status === 'closed' && <div className="flex flex-wrap items-center justify-between gap-2"><VarianceBadge variance={closure.cashDifference} /><SecondaryButton onClick={() => { setReopenTarget(closure); setReopenReason(''); }}><Unlock size={15} /> Reabrir cierre</SecondaryButton></div>}
              <div className="grid grid-cols-3 gap-2">
                <SecondaryButton onClick={() => void printClosureTicket(closure).catch(printError => setError(printError.message))}><Printer size={15} /> Ticket de cierre</SecondaryButton>
                <SecondaryButton onClick={() => void printClosureSheet(closure).catch(printError => setError(printError.message))}><FileText size={15} /> Hoja de cierre</SecondaryButton>
                <SecondaryButton onClick={() => void shareClosurePdf(closure).catch(pdfError => setError(pdfError.message))}><Send size={15} /> Compartir PDF</SecondaryButton>
              </div>
            </div>}
          </article>
        })}
      </div>}
    </SectionCard>
  )


  const adminClosureContent = (
    <div className="grid w-full min-w-0 gap-3">
      <SectionCard title="Arqueo de caja — Administración">
        <div className="grid gap-3">
          <p className="text-xs text-slate-500 font-medium">Conciliación de dinero físico de venta directa, cobros y gastos de oficina.</p>
          <Field label="Fecha de arqueo" hint="Consulta y concilia los movimientos registrados en esta fecha">
            <TextInput
              type="date"
              value={adminDayKey}
              onChange={e => setAdminDayKey(e.target.value)}
              className="max-w-xs font-bold"
            />
          </Field>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <KpiCard label="Ventas efectivo" value={formatBs(adminMoney.cashSales)} />
            <KpiCard label="Ventas QR" value={formatBs(adminMoney.qrSales)} />
            <KpiCard label="Crédito generado" value={formatBs(adminMoney.creditGenerated)} tone="warning" />
            <KpiCard label="Cobros efectivo" value={formatBs(adminMoney.cashCollections)} />
            <KpiCard label="Cobros QR" value={formatBs(adminMoney.qrCollections)} />
            <KpiCard label="Gastos oficina" value={formatBs(adminMoney.cashExpenses)} tone="danger" />
            <KpiCard label="Ajuste devoluciones" value={formatBs(adminMoney.claimCash)} />
            <KpiCard label="Efectivo esperado" value={formatBs(adminMoney.expectedCash)} tone="primary" />
          </div>

          {existingAdminClosure ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="flex items-center gap-2 text-emerald-900 font-bold text-sm mb-2">
                <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
                <span>Caja de Administración cerrada para el {existingAdminClosure.dayKey}</span>
              </div>
              <p className="text-xs text-emerald-800 mb-3">
                Cerrado por <strong>{existingAdminClosure.distributorName || 'Administración'}</strong> el{' '}
                {new Date(existingAdminClosure.closedAt || existingAdminClosure.createdAt).toLocaleString('es-BO')}.
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 mb-3">
                <div className="rounded-xl bg-white p-2.5 border border-emerald-100">
                  <span className="text-[10px] font-bold uppercase text-slate-500">Efectivo esperado</span>
                  <p className="text-sm font-black text-slate-800 tabular-nums">{formatBs(existingAdminClosure.expectedCash)}</p>
                </div>
                <div className="rounded-xl bg-white p-2.5 border border-emerald-100">
                  <span className="text-[10px] font-bold uppercase text-slate-500">Efectivo declarado</span>
                  <p className="text-sm font-black text-slate-800 tabular-nums">{formatBs(existingAdminClosure.physicalCashDeclared ?? 0)}</p>
                </div>
                <div className="rounded-xl bg-white p-2.5 border border-emerald-100 col-span-2 sm:col-span-1">
                  <span className="text-[10px] font-bold uppercase text-slate-500">Diferencia</span>
                  <div className="mt-0.5"><VarianceBadge variance={existingAdminClosure.cashDifference} /></div>
                </div>
              </div>
              {existingAdminClosure.note && (
                <p className="text-xs text-slate-600 italic mb-3">Nota: {existingAdminClosure.note}</p>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-emerald-200">
                <SecondaryButton onClick={() => void printClosureTicket(existingAdminClosure).catch(printError => setError(printError.message))}><Printer size={15} /> Ticket</SecondaryButton>
                <SecondaryButton onClick={() => void printClosureSheet(existingAdminClosure).catch(printError => setError(printError.message))}><FileText size={15} /> Hoja de arqueo</SecondaryButton>
                <SecondaryButton onClick={() => void shareClosurePdf(existingAdminClosure).catch(pdfError => setError(pdfError.message))}><Send size={15} /> Compartir PDF</SecondaryButton>
                <SecondaryButton onClick={() => { setReopenTarget(existingAdminClosure); setReopenReason(''); }}><Unlock size={15} /> Reabrir arqueo</SecondaryButton>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 pt-2 border-t border-slate-100">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Efectivo físico en caja (Bs)" required hint="Conteo físico del efectivo en caja de administración al cierre del día">
                  <NumberInput
                    value={adminDeclaredCash}
                    min={0}
                    step={0.5}
                    placeholder="0.00"
                    onChange={e => setAdminDeclaredCash(e.target.value)}
                  />
                </Field>
                <Field label="Observación o nota" hint="Opcional: detalles sobre billetes retenidos, diferencias, etc.">
                  <TextInput
                    value={adminNote}
                    onChange={e => setAdminNote(e.target.value)}
                    placeholder="Sin observaciones"
                  />
                </Field>
              </div>

              {isAdminCashDeclared && (
                <div className="flex items-center justify-between gap-2 rounded-2xl bg-slate-50 px-3 py-2.5">
                  <span className="text-xs font-extrabold uppercase text-slate-500">Diferencia proyectada</span>
                  <VarianceBadge variance={adminCashDifference} />
                </div>
              )}

              <PrimaryButton
                full
                disabled={isSubmitting || !isAdminCashDeclared}
                onClick={() => setConfirmingAdminClosure(true)}
              >
                <Lock size={16} /> Cerrar caja de Administración
              </PrimaryButton>
            </div>
          )}
        </div>
      </SectionCard>
      {closureHistory}
    </div>
  )

  const reopenModal = (
    <Modal
      isOpen={Boolean(reopenTarget)}
      onClose={() => { if (!isReopening) setReopenTarget(null) }}
      title="Reabrir cierre"
      subtitle={reopenTarget ? `${reopenTarget.routeName} · ${reopenTarget.distributorName}` : ''}
      footer={
        <div className="grid grid-cols-2 gap-2 w-full">
          <SecondaryButton disabled={isReopening} onClick={() => setReopenTarget(null)}>
            Cancelar
          </SecondaryButton>
          <PrimaryButton
            disabled={isReopening || reopenReason.trim().length < 3}
            onClick={async () => {
              if (!reopenTarget || reopenReason.trim().length < 3) return
              setIsReopening(true)
              setError(null)
              try {
                await reopenClosure(reopenTarget, reopenReason.trim())
                setReopenTarget(null)
                setReopenReason('')
              } catch (e) {
                setError((e as Error).message)
              } finally {
                setIsReopening(false)
              }
            }}
          >
            {isReopening ? 'Reabriendo…' : 'Confirmar reapertura'}
          </PrimaryButton>
        </div>
      }
    >
      <div className="grid gap-3">
        <p className="text-xs text-slate-600 leading-relaxed">
          Al reabrir el cierre, la ruta o caja volverá a estado abierto para permitir ajustes operativos o correcciones auditadas.
        </p>
        <Field label="Motivo obligatorio de la reapertura" required hint="Quedará registrado en la auditoría con tu nombre y fecha.">
          <TextInput
            value={reopenReason}
            onChange={e => setReopenReason(e.target.value)}
            placeholder="Ej. Corrección de conteo físico, ajuste de venta en ruta..."
            autoFocus
          />
        </Field>
      </div>
    </Modal>
  )

  const adminClosureModal = (
    <Modal
      isOpen={confirmingAdminClosure}
      onClose={() => { if (!isSubmitting) setConfirmingAdminClosure(false) }}
      title="Confirmar cierre de caja Administración"
      subtitle={`Fecha: ${adminDayKey}`}
      footer={
        <div className="grid grid-cols-2 gap-2 w-full">
          <SecondaryButton disabled={isSubmitting} onClick={() => setConfirmingAdminClosure(false)}>
            Volver a revisar
          </SecondaryButton>
          <PrimaryButton disabled={isSubmitting} onClick={() => void executeAdminClosure()}>
            {isSubmitting ? 'Cerrando…' : 'Sí, confirmar cierre'}
          </PrimaryButton>
        </div>
      }
    >
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-center">
            <p className="text-[10px] font-bold uppercase text-slate-500">Efectivo esperado</p>
            <p className="mt-1 text-lg font-black text-slate-800 tabular-nums">{formatBs(adminMoney.expectedCash)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-center">
            <p className="text-[10px] font-bold uppercase text-slate-500">Efectivo declarado</p>
            <p className="mt-1 text-lg font-black text-slate-800 tabular-nums">{formatBs(adminDeclaredVal)}</p>
          </div>
        </div>

        {Math.abs(adminCashDifference) < 0.01 ? (
          <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-3.5 text-center">
            <p className="text-xs font-black uppercase tracking-wider text-emerald-800">Caja cuadrada (Bs 0.00)</p>
            <p className="text-[11px] text-emerald-700 mt-0.5">El conteo físico coincide con los movimientos del día.</p>
          </div>
        ) : adminCashDifference < 0 ? (
          <div className="rounded-2xl border border-rose-300 bg-rose-50 p-3.5 text-center">
            <p className="text-xs font-black uppercase tracking-wider text-rose-800">
              Faltante en caja: {formatBs(adminCashDifference)}
            </p>
            <p className="text-[11px] text-rose-700 mt-0.5">El efectivo físico es menor al esperado por el sistema.</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3.5 text-center">
            <p className="text-xs font-black uppercase tracking-wider text-amber-800">
              Sobrante en caja: +{formatBs(adminCashDifference)}
            </p>
            <p className="text-[11px] text-amber-700 mt-0.5">El efectivo físico es mayor al esperado por el sistema.</p>
          </div>
        )}

        <p className="text-xs text-slate-600 leading-relaxed">
          Esta acción cerrará formalmente el arqueo de caja de Administración para la fecha seleccionada.
        </p>
      </div>
    </Modal>
  )

  if (!dispatch) {
    if (session.role === 'admin' && closureTab === 'admin') {
      return (
        <Screen title="Cierre y arqueo de caja">
          <div className="mb-3">
            <Segmented
              value={closureTab}
              options={[
                { value: 'routes', label: 'Cierres de ruta' },
                { value: 'admin', label: 'Caja Administración' },
              ]}
              onChange={val => setClosureTab(val as 'routes' | 'admin')}
            />
          </div>
          {adminClosureContent}
          {reopenModal}
          {adminClosureModal}
          {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
        </Screen>
      )
    }

    return (
      <Screen title="Cierre de ruta">
        {session.role === 'admin' && (
          <div className="mb-3">
            <Segmented
              value={closureTab}
              options={[
                { value: 'routes', label: 'Cierres de ruta' },
                { value: 'admin', label: 'Caja Administración' },
              ]}
              onChange={val => setClosureTab(val as 'routes' | 'admin')}
            />
          </div>
        )}
        {justClosedRouteName && (
          <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900 mb-3">
            <CheckCircle2 size={20} className="shrink-0 text-emerald-600" />
            <div className="min-w-0 flex-1">
              <strong className="block text-sm font-bold">Ruta cerrada correctamente ({justClosedRouteName})</strong>
              <span className="block text-xs text-emerald-700">La ruta fue finalizada y conciliada. El registro se encuentra disponible en el historial de cierres.</span>
            </div>
          </div>
        )}
        {isDistributor && (
          <p className="rounded-2xl bg-amber-50 p-3 text-xs font-semibold leading-relaxed text-amber-900">
            Para cerrar tu ruta, primero declaras cuánto producto devuelves. Almacén cuenta y confirma físicamente esa devolución; después se habilita el cierre final del efectivo.
          </p>
        )}
        <EmptyBlock
          title="No hay rutas abiertas"
          description={isDistributor ? 'El arqueo se habilita cuando Almacén registra una carga abierta para tu usuario.' : 'El arqueo se hace sobre un despacho abierto. Registra un despacho primero.'}
        />
        {closureHistory}
        {reopenModal}
        {adminClosureModal}
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      </Screen>
    )
  }

  return (
    <Screen title="Cierre y arqueo de caja" subtitle={closureTab === 'admin' ? 'Administración' : `${dispatch.routeName} · ${dispatch.distributorName}`}>
      {session.role === 'admin' && (
        <div className="mb-3">
          <Segmented
            value={closureTab}
            options={[
              { value: 'routes', label: 'Cierres de ruta' },
              { value: 'admin', label: 'Caja Administración' },
            ]}
            onChange={val => setClosureTab(val as 'routes' | 'admin')}
          />
        </div>
      )}
      {closureTab === 'admin' ? (
        adminClosureContent
      ) : (
        <div className="grid w-full min-w-0 gap-3">
        {justClosedRouteName && (
          <div role="status" className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">
            <CheckCircle2 size={18} className="shrink-0 text-emerald-600" />
            <span className="text-xs font-bold">Ruta "{justClosedRouteName}" cerrada exitosamente.</span>
          </div>
        )}
        {availableDispatches.length > 1 && (
          <Field label="Ruta a cerrar">
            <ChoiceButton label={`${dispatch.routeName} · ${dispatch.distributorName}`} placeholder="Selecciona despacho" onClick={() => setIsDispatchOpen(true)} />
          </Field>
        )}

        <p className="rounded-2xl bg-amber-50 p-3 text-xs font-semibold leading-relaxed text-amber-900">{isDistributor ? 'Para cerrar tu ruta, primero declara cuánto producto devuelves. Almacén debe contar y confirmar físicamente esa devolución; después se habilita el cierre final del efectivo.' : 'El distribuidor declara las cantidades. Almacén confirma la recepción física y después se habilita el cierre final. Confirmar y cerrar requieren conexión.'}</p>
        <SectionCard title="Productos devueltos">
          <div className="relative mb-3"><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><TextInput value={productSearch} onChange={event => setProductSearch(event.target.value)} placeholder="Buscar producto sin perder cantidades..." className="pl-9" /></div>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {productRows.filter(row => row.productName.toLowerCase().includes(productSearch.trim().toLowerCase())).map((row) => {
              const product = data.products.find(p => p.id === row.productId)
              const presentation = product ? getProductPresentation(product) : ''
              const declared = existingClosure?.declaredReturns?.[row.productId] ?? existingProductsById.get(row.productId)?.declaredReturn
              const received = Number(returns[row.productId]) || 0
              const enteredWaste = Number(wastes[row.productId]) || 0
              const breakdown = calculateReturnBreakdown(row.expectedReturn, received, enteredWaste)
              return (
                <article key={row.productId} className="w-full min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs hover:border-slate-300 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="break-words text-sm font-black leading-snug text-slate-900">{row.productName}</h3>
                      {presentation && <p className="mt-0.5 text-xs font-semibold text-slate-500">{presentation}</p>}
                    </div>
                    {isDeclared(row.productId) ? <VarianceBadge variance={row.variance} unitType={row.unitType} /> : <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-black text-slate-500">SIN DECLARAR</span>}
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3 sm:grid-cols-3">
                    <div><dt className="text-[10px] font-semibold text-slate-500">Despachado</dt><dd className="text-sm font-bold">{formatQty(row.totalLoaded, row.unitType)}</dd></div>
                    <div><dt className="text-[10px] font-semibold text-slate-500">Vendido</dt><dd className="text-sm font-bold">{formatQty(row.sold, row.unitType)}</dd></div>
                    <div><dt className="text-[10px] font-semibold text-slate-500">Cortesía</dt><dd className="text-sm font-bold">{formatQty(row.courtesy || 0, row.unitType)}</dd></div>
                    <div><dt className="text-[10px] font-semibold text-slate-500">Aumentos</dt><dd className="text-sm font-bold">{formatQty(row.additions, row.unitType)}</dd></div>
                    <div><dt className="text-[10px] font-semibold text-slate-500">Debía retornar</dt><dd className="text-sm font-black text-indigo-700">{formatQty(row.expectedReturn, row.unitType)}</dd></div>
                  </dl>

                  {isDistributor ? <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3">
                    <h4 className="text-xs font-black uppercase tracking-wide text-blue-900">Declaración del distribuidor</h4>
                    <div className="mt-2 grid grid-cols-[1fr_auto] items-end gap-2">
                      <Field label="Cantidad que devuelves">
                        <NumberInput value={returns[row.productId] ?? ''} min={0} step={row.unitType === 'kg' ? 0.01 : 1} disabled={returnsAlreadyApplied || Boolean(existingClosure?.returnDeclaredAt)} placeholder="Escribe la cantidad" onChange={event => setReturns(current => ({ ...current, [row.productId]: event.target.value }))} />
                      </Field>
                      <div className="flex gap-1 pb-0.5">
                        <button type="button" disabled={Boolean(existingClosure?.returnDeclaredAt)} onClick={() => setReturns(current => ({ ...current, [row.productId]: '0' }))} className="min-h-10 rounded-lg border border-blue-200 bg-white px-3 text-xs font-bold text-blue-900 disabled:opacity-40">0</button>
                        <button type="button" disabled={Boolean(existingClosure?.returnDeclaredAt)} onClick={() => setReturns(current => ({ ...current, [row.productId]: String(row.expectedReturn) }))} className="min-h-10 rounded-lg border border-blue-200 bg-white px-3 text-xs font-bold text-blue-900 disabled:opacity-40">Todo</button>
                      </div>
                    </div>
                  </div> : <div className="mt-3 rounded-xl border border-slate-200 p-3">
                    <h4 className="text-xs font-black uppercase tracking-wide text-slate-800">Recepción de Almacén</h4>
                    <p className="mt-1 text-xs text-slate-600">Declarado por distribuidor: <strong>{declared === undefined ? 'Sin registro' : formatQty(Number(declared), row.unitType)}</strong></p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <Field label="Recibido físicamente">
                          <div className="grid grid-cols-[1fr_auto] gap-2">
                            <NumberInput value={returns[row.productId] ?? ''} min={0} step={row.unitType === 'kg' ? 0.01 : 1} disabled={returnsAlreadyApplied} placeholder="Cantidad pesada" onChange={event => setReturns(current => ({ ...current, [row.productId]: event.target.value }))} />
                            <SecondaryButton disabled={returnsAlreadyApplied || declared === undefined} onClick={() => declared !== undefined && setReturns(current => ({ ...current, [row.productId]: String(declared) }))}>Usar cantidad declarada</SecondaryButton>
                          </div>
                        </Field>
                      </div>
                      <Field label="Merma dentro del retorno" hint="Parte de lo recibido que no vuelve al stock vendible.">
                        <NumberInput value={wastes[row.productId] ?? '0'} min={0} step={row.unitType === 'kg' ? 0.01 : 1} disabled={returnsAlreadyApplied} placeholder="0" onChange={event => setWastes(current => ({ ...current, [row.productId]: event.target.value }))} />
                      </Field>
                      {enteredWaste > 0 && <Field label="Motivo de merma" required>
                        <TextInput value={wasteReasons[row.productId] || ''} disabled={returnsAlreadyApplied} placeholder="Describe el motivo" onChange={event => setWasteReasons(current => ({ ...current, [row.productId]: event.target.value }))} />
                      </Field>}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-emerald-50 p-3 sm:grid-cols-4">
                      <div><p className="text-[10px] font-semibold text-slate-600">Vuelve a stock</p><p className="text-sm font-black text-emerald-800">{formatQty(breakdown.apt, row.unitType)}</p></div>
                      <div><p className="text-[10px] font-semibold text-slate-600">Merma</p><p className="text-sm font-black text-rose-700">{formatQty(enteredWaste, row.unitType)}</p></div>
                      <div><p className="text-[10px] font-semibold text-slate-600">Faltante</p><p className="text-sm font-black text-amber-800">{formatQty(breakdown.shortage, row.unitType)}</p></div>
                      <div><p className="text-[10px] font-semibold text-slate-600">Sobrante en cuarentena</p><p className="text-sm font-black text-amber-800">{formatQty(breakdown.overage, row.unitType)}</p></div>
                    </div>
                    {!breakdown.wasteValid && <p className="mt-2 text-xs font-bold text-rose-700">La merma no puede superar lo recibido ni lo que debía retornar.</p>}
                  </div>}
                </article>
              )
            })}
          </div>
        </SectionCard>

        {session.role !== 'warehouse' && <SectionCard title="Dinero">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <KpiCard label="Ventas efectivo" value={formatBs(money.cashSales)} />
            <KpiCard label="Ventas QR" value={formatBs(money.qrSales)} />
            <KpiCard label="Credito generado" value={formatBs(money.creditGenerated)} tone="warning" />
            <KpiCard label="Cobros efectivo" value={formatBs(money.cashCollections)} />
            <KpiCard label="Cobros QR" value={formatBs(money.qrCollections)} />
            <KpiCard label="Gastos" value={formatBs(money.cashExpenses)} tone="danger" />
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <KpiCard
              label="Efectivo esperado"
              value={formatBs(money.expectedCash)}
              hint="Ventas efectivo + cobros efectivo - gastos"
              tone="primary"
            />
            <Field
              label={isDistributor ? 'Efectivo físico que estás devolviendo (Bs)' : 'Efectivo físico declarado (Bs)'}
              required
              hint={
                isDistributor
                  ? 'Debes declarar el efectivo físico que entregas en mano. Si no hay efectivo, escribe 0.'
                  : 'Verifica el efectivo físico recibido de la ruta.'
              }
            >
              <NumberInput
                value={declaredCash}
                min={0}
                step={1}
                placeholder={isDistributor ? 'Escribe 0 si no devuelves efectivo' : 'Escribe 0 si no hay efectivo'}
                disabled={(!canCloseMoney && !isDistributor) || (isDistributor && Boolean(existingClosure?.returnDeclaredAt))}
                onChange={(event) => setDeclaredCash(event.target.value)}
              />
            </Field>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <KpiCard label="QR confirmado" value={formatBs(data.supportSettings.requireQrVerification ? data.qrVerifications.filter(v => (v.sourceType === 'sale' ? routeSales.some(s => s.id === v.sourceId) : routeCollections.some(c => c.id === v.sourceId))).reduce((sum, v) => sum + v.amount, 0) : money.qrSales + money.qrCollections)} tone="positive" />
            <KpiCard label="QR por verificar" value={formatBs(data.supportSettings.requireQrVerification ? money.qrSales + money.qrCollections - data.qrVerifications.filter(v => (v.sourceType === 'sale' ? routeSales.some(s => s.id === v.sourceId) : routeCollections.some(c => c.id === v.sourceId))).reduce((sum, v) => sum + v.amount, 0) : 0)} tone="warning" />
          </div>
          <p className="mt-2 text-xs text-slate-500">Administracion verifica los depositos en Verificar QR. El dinero del banco se concilia por separado del efectivo fisico.</p>
          {isCashDeclared && (
            <div className="mt-3 flex items-center justify-between gap-2 rounded-2xl bg-slate-50 px-3 py-2.5">
              <span className="text-xs font-extrabold uppercase text-slate-500">Diferencia de caja</span>
              <VarianceBadge variance={cashDifference} />
            </div>
          )}
        </SectionCard>}

        {error && <p className="text-xs font-bold text-rose-600">{error}</p>}

        {isDistributor && !returnsAlreadyApplied && (
          <SecondaryButton
            full
            disabled={isSubmitting || !loaded || Boolean(existingClosure?.returnDeclaredAt)}
            onClick={requestDeclarationConfirmation}
          >
            {isSubmitting ? 'Enviando devolución…' : 'Declarar retorno para almacén'}
          </SecondaryButton>
        )}
        {existingClosure?.returnDeclaredAt && (
          <p className="text-xs text-emerald-700">
            Retorno declarado. {returnsAlreadyApplied ? 'Recepción confirmada por almacén.' : 'Pendiente de recepción en almacén.'}
          </p>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          {canRegisterReturn && (
            <SecondaryButton
              full
              disabled={isSubmitting || !loaded || returnsAlreadyApplied}
              onClick={() => void submit('warehouse_done')}
            >
              <PackageCheck size={16} />
              {isSubmitting ? 'Confirmando devolución…' : returnsAlreadyApplied ? 'Retorno ya registrado' : 'Guardar retorno de almacén'}
            </SecondaryButton>
          )}
          {canCloseMoney && (
            <PrimaryButton
              full
              disabled={isSubmitting || !loaded || !returnsAlreadyApplied || existingClosure?.status === 'closed'}
              onClick={requestClosureConfirmation}
            >
              <Lock size={16} />
              {isSubmitting ? 'Cerrando ruta…' : existingClosure?.status === 'closed' ? 'Ruta cerrada correctamente' : 'Cerrar ruta'}
            </PrimaryButton>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-bold text-slate-500">
              <ClipboardCheck size={13} className="mr-1 inline" />
              Estado del cierre: {existingClosure ? CLOSURE_STATUS[existingClosure.status] || 'Pendiente' : 'Devolución pendiente de declarar'}
            </p>
            {existingClosure?.status === 'closed' && session.can('dist.reports.view') && (
              <SecondaryButton onClick={() => { setReopenTarget(existingClosure); setReopenReason(''); }}>
                <Unlock size={15} /> Reabrir (administracion)
              </SecondaryButton>
            )}
          </div>
        {closureHistory}
      </div>
      )}
      <ChoiceModal
        isOpen={isDispatchOpen}
        onClose={() => setIsDispatchOpen(false)}
        title="Ruta a cerrar"
        subtitle="Selecciona un despacho abierto"
        searchable
        options={availableDispatches.map(item => ({ value: item.id, label: item.routeName, description: `${item.distributorName} · ${new Date(item.createdAt).toLocaleString('es-BO')}` }))}
        selectedValue={dispatch.id}
        onSelect={setSelectedDispatchId}
      />

      {/* Modal Dedicado de Confirmación de Declaración de Retorno (Distribuidor) */}
      <Modal
        isOpen={confirmingDeclaration && Boolean(dispatch)}
        onClose={() => {
          if (!isSubmitting) setConfirmingDeclaration(false)
        }}
        title="Confirmar declaración de retorno"
        subtitle="Verifica las cantidades antes de enviar a almacén"
        footer={
          <div className="grid grid-cols-2 gap-2 w-full">
            <SecondaryButton disabled={isSubmitting} onClick={() => setConfirmingDeclaration(false)}>
              Volver a revisar
            </SecondaryButton>
            <PrimaryButton disabled={isSubmitting} onClick={() => void executeConfirmedDeclaration()}>
              {isSubmitting ? 'Enviando…' : `Sí, declarar ${formatBs(round2(Number(declaredCash)))}`}
            </PrimaryButton>
          </div>
        }
      >
        {dispatch && (
          <div className="grid gap-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs grid gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Ruta:</span>
                <span className="font-extrabold text-slate-900">{dispatch.routeName}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Distribuidor:</span>
                <span className="font-bold text-slate-800">{dispatch.distributorName}</span>
              </div>
            </div>

            <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 text-center">
              <p className="text-xs font-extrabold uppercase tracking-wide text-emerald-700">Efectivo que declaras devolver</p>
              <p className="mt-1 text-3xl font-black text-emerald-800 tabular-nums">{formatBs(round2(Number(declaredCash)))}</p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs">
              <div className="flex items-center justify-between font-bold text-slate-700 mb-1">
                <span>Resumen de productos devueltos:</span>
                <span className="text-slate-900">
                  {productRows.filter(r => (parsedReturns[r.productId] || 0) > 0).length} con retorno
                </span>
              </div>
              <div className="max-h-36 overflow-y-auto divide-y divide-slate-100 pr-1">
                {productRows.filter(r => (parsedReturns[r.productId] || 0) > 0).map(row => (
                  <div key={row.productId} className="flex items-center justify-between py-1 text-[11px]">
                    <span className="truncate text-slate-600">{row.productName}</span>
                    <span className="font-bold text-slate-900 tabular-nums">
                      {formatQty(parsedReturns[row.productId] || 0, row.unitType)}
                    </span>
                  </div>
                ))}
                {productRows.every(r => !(parsedReturns[r.productId] > 0)) && (
                  <p className="text-[11px] italic text-slate-500 py-1">Sin productos a devolver (retorno 0 en todos)</p>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900 font-medium leading-relaxed">
              <p className="font-bold text-amber-950 mb-0.5">¿Estás seguro de enviar esta declaración al almacén?</p>
              Una vez enviada, el encargado de almacén verificará físicamente tu carga y tu dinero.
            </div>

            {error && <p className="text-xs font-bold text-rose-600 text-center">{error}</p>}
          </div>
        )}
      </Modal>

      {reopenModal}
      {adminClosureModal}
      {/* Modal Dedicado de Confirmación de Cierre Final de Ruta */}
      <Modal
        isOpen={confirmingClosure && Boolean(dispatch)}
        onClose={() => {
          if (!isSubmitting) setConfirmingClosure(false)
        }}
        title="Confirmar cierre de ruta"
        subtitle="Verifica el cuadre de caja antes de finalizar"
        footer={
          <div className="grid grid-cols-2 gap-2 w-full">
            <SecondaryButton disabled={isSubmitting} onClick={() => setConfirmingClosure(false)}>
              Volver a revisar
            </SecondaryButton>
            <PrimaryButton disabled={isSubmitting} onClick={() => void executeConfirmedClosure()}>
              {isSubmitting ? 'Cerrando…' : 'Sí, cerrar ruta'}
            </PrimaryButton>
          </div>
        }
      >
        {dispatch && (
          <div className="grid gap-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs grid gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Ruta:</span>
                <span className="font-extrabold text-slate-900">{dispatch.routeName}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Distribuidor:</span>
                <span className="font-bold text-slate-800">{dispatch.distributorName}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-center">
                <p className="text-[10px] font-bold uppercase text-slate-500">Efectivo esperado</p>
                <p className="mt-1 text-lg font-black text-slate-800 tabular-nums">{formatBs(money.expectedCash)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-center">
                <p className="text-[10px] font-bold uppercase text-slate-500">Efectivo declarado</p>
                <p className="mt-1 text-lg font-black text-slate-800 tabular-nums">{formatBs(declaredValue)}</p>
              </div>
            </div>

            {/* Diferencia de caja destacada */}
            {Math.abs(cashDifference) < 0.01 ? (
              <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-3.5 text-center">
                <p className="text-xs font-black uppercase tracking-wider text-emerald-800">
                  Caja cuadrada (Bs 0.00)
                </p>
                <p className="text-[11px] text-emerald-700 mt-0.5">El dinero físico coincide exactamente con lo esperado.</p>
              </div>
            ) : cashDifference < 0 ? (
              <div className="rounded-2xl border border-rose-300 bg-rose-50 p-3.5 text-center">
                <p className="text-xs font-black uppercase tracking-wider text-rose-800">
                  Faltante en caja: {formatBs(cashDifference)}
                </p>
                <p className="text-[11px] text-rose-700 mt-0.5">Falta dinero físico según el registro del sistema.</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3.5 text-center">
                <p className="text-xs font-black uppercase tracking-wider text-amber-800">
                  Sobrante en caja: +{formatBs(cashDifference)}
                </p>
                <p className="text-[11px] text-amber-700 mt-0.5">Hay más dinero físico del esperado por el sistema.</p>
              </div>
            )}

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-700 font-medium leading-relaxed">
              <p className="font-bold text-slate-900 mb-0.5">¿Estás seguro de cerrar definitivamente esta ruta?</p>
              Esta acción finalizará el arqueo y registrará el estado final de caja.
            </div>

            {error && <p className="text-xs font-bold text-rose-600 text-center">{error}</p>}
          </div>
        )}
      </Modal>
    </Screen>
  )
}
