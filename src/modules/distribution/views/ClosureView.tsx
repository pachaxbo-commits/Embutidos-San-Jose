import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronRight, ClipboardCheck, FileText, Lock, PackageCheck, Printer, Search, Send, Unlock } from 'lucide-react'
import { Field, NumberInput, TextInput } from '../../../components/ui/Form'
import { ChoiceButton, ChoiceModal } from '../../../components/ui/ChoiceModal'
import { Modal } from '../../../components/ui/Modal'
import { EmptyBlock, Screen } from '../../../components/ui/Screen'
import { buildReconciliation, computeMoneySummary, round2, toDayKey } from '../domain/engine'
import { declareRouteReturn, reopenClosure, saveClosure, setClosureVarianceReviewed, subscribeSales, subscribeCollections, subscribeExpenses } from '../data/distributionRepository'
import { KpiCard, PrimaryButton, SecondaryButton, SectionCard, VarianceBadge, formatBs, formatQty } from './shared'
import type { DistributionViewProps } from './DistributionApp'
import type { DistSale, DistCollection, DistExpense, DistClosure } from '../types'
import { printClosureTicket, printOperationalSheet } from '../data/distributionDocumentPrintService'
import { exportPdf } from '../data/reportExports'
import { getProductPresentation } from '../domain/productPresentation'

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

  const dispatch = availableDispatches.find(item => item.id === selectedDispatchId) ?? availableDispatches[0] ?? null

  const existingClosure = data.closures.find((closure) => closure.dispatchId === dispatch?.id) ?? null

  const returnsAlreadyApplied = existingClosure
    ? Boolean(existingClosure.warehouseClosedBy)
    : false

  const dispatchKey = dispatch?.id || ''
  const dispatchDay = dispatch?.dayKey || ''
  const dispatchRoute = dispatch?.routeId || ''
  const dispatchCreated = dispatch?.createdAt || ''
  const savedReturns = existingClosure?.products?.length
    ? Object.fromEntries(existingClosure.products.map(row => [row.productId, String(row.actualReturn)]))
    : Object.fromEntries(Object.entries(existingClosure?.declaredReturns || {}).map(([id, q]) => [id, String(q)]))
  const returns = returnDrafts[dispatchKey] ?? savedReturns
  const declaredCash = cashDrafts[dispatchKey] ?? (existingClosure?.physicalCashDeclared != null ? String(existingClosure.physicalCashDeclared) : '')
  const setDeclaredCash = (value: string) => setCashDrafts(current => ({ ...current, [dispatchKey]: value }))
  const setReturns = (updater: (current: Record<string, string>) => Record<string, string>) => setReturnDrafts(current => ({ ...current, [dispatchKey]: updater(current[dispatchKey] ?? savedReturns) }))

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

  /** Un producto solo se evalua cuando almacen escribio la cantidad retornada */
  const isDeclared = (productId: string) => {
    const value = returns[productId]
    return value !== undefined && value !== '' && !Number.isNaN(Number(value))
  }

  const parsedReturns = useMemo(() => {
    const map: Record<string, number> = {}
    for (const [productId, value] of Object.entries(returns)) map[productId] = round2(Number(value) || 0)
    return map
  }, [returns])

  const productRows = buildReconciliation(dispatch, routeSales, parsedReturns)

  const moneySummary = computeMoneySummary(routeSales, routeCollections, routeExpenses)
  const claimCash = data.claims.filter(c => c.routeId === dispatchRoute && c.createdAt >= dispatchCreated).reduce((n,c)=>n+c.cashIn-c.cashOut,0)
  const money = { ...moneySummary, expectedCash:round2(moneySummary.expectedCash+claimCash) }

  const declaredValue = round2(Number(declaredCash) || 0)
  // Mientras no se declare el efectivo fisico no hay diferencia que reportar:
  // guardar -368 en un cierre a medias confundia a quien revisaba el arqueo.
  const isCashDeclared = declaredCash !== ''
  const cashDifference = isCashDeclared ? round2(declaredValue - money.expectedCash) : 0

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
              <div className="grid gap-2 md:grid-cols-2">{closure.products.length === 0 ? <p className="text-xs text-slate-500">Almacén todavía no confirmó las cantidades.</p> : closure.products.map(row => <div key={row.productId} className="rounded-xl bg-slate-50 p-3"><div className="flex items-start justify-between gap-2"><strong className="min-w-0 break-words text-xs text-slate-900">{row.productName}</strong><VarianceBadge variance={row.variance} unitType={row.unitType} /></div><dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4"><div><dt className="text-[9px] font-bold uppercase text-slate-400">Entregado</dt><dd className="text-xs font-black">{formatQty(row.totalLoaded, row.unitType)}</dd></div><div><dt className="text-[9px] font-bold uppercase text-slate-400">Vendido</dt><dd className="text-xs font-black">{formatQty(row.sold, row.unitType)}</dd></div><div><dt className="text-[9px] font-bold uppercase text-slate-400">Debía volver</dt><dd className="text-xs font-black">{formatQty(row.expectedReturn, row.unitType)}</dd></div><div><dt className="text-[9px] font-bold uppercase text-slate-400">Devuelto</dt><dd className="text-xs font-black">{formatQty(row.actualReturn, row.unitType)}</dd></div></dl></div>)}</div>
              {session.role === 'admin' && closure.status === 'closed' && <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><KpiCard label="Ventas efectivo" value={formatBs(closure.cashSales)} /><KpiCard label="Ventas QR" value={formatBs(closure.qrSales)} /><KpiCard label="Crédito" value={formatBs(closure.creditGenerated)} /><KpiCard label="Cobros efectivo" value={formatBs(closure.cashCollections)} /><KpiCard label="Cobros QR" value={formatBs(closure.qrCollections)} /><KpiCard label="Gastos" value={formatBs(closure.cashExpenses)} /><KpiCard label="Efectivo esperado" value={formatBs(closure.expectedCash)} /><KpiCard label="Efectivo declarado" value={formatBs(closure.physicalCashDeclared ?? 0)} /></div>}
              {session.role === 'admin' && hasProductDifference && ['warehouse_done', 'closed'].includes(closure.status) && <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 p-3"><p className="text-xs font-semibold text-amber-900">{closure.varianceReviewedAt ? `Diferencia revisada el ${new Date(closure.varianceReviewedAt).toLocaleString('es-BO')}.` : 'Esta diferencia aparece en pendientes de Administración.'}</p><SecondaryButton disabled={Boolean(reviewingClosureId)} onClick={async () => { setReviewingClosureId(closure.id); setError(null); try { await setClosureVarianceReviewed(closure.id, !closure.varianceReviewedAt) } catch (e) { setError((e as Error).message) } finally { setReviewingClosureId('') } }}>{reviewingClosureId === closure.id ? 'Guardando…' : closure.varianceReviewedAt ? 'Volver a pendientes' : 'Marcar revisada'}</SecondaryButton></div>}
              {session.role === 'admin' && closure.status === 'closed' && <div className="flex flex-wrap items-center justify-between gap-2"><VarianceBadge variance={closure.cashDifference} /><SecondaryButton onClick={() => void reopenClosure(closure, session.uid).catch(e => setError(e.message))}><Unlock size={15} /> Reabrir cierre</SecondaryButton></div>}
              <div className="grid grid-cols-3 gap-2">
                <SecondaryButton onClick={() => void printClosureTicket(closure).catch(printError => setError(printError.message))}><Printer size={15} /> Ticket de cierre</SecondaryButton>
                <SecondaryButton onClick={() => {
                  void printOperationalSheet(
                    'Cierre de ruta',
                    `${closure.routeName} · ${closure.distributorName}`,
                    closure.products.map(row => ({ name: row.productName, detail: `Entregado ${formatQty(row.totalLoaded, row.unitType)} · vendido ${formatQty(row.sold, row.unitType)} · devuelto ${formatQty(row.actualReturn, row.unitType)}` })),
                    closure.status === 'closed' ? [
                      { label: 'Efectivo esperado', value: formatBs(closure.expectedCash) },
                      { label: 'Efectivo declarado', value: formatBs(closure.physicalCashDeclared ?? 0) },
                      { label: 'Diferencia', value: formatBs(closure.cashDifference) },
                    ] : [],
                  ).catch(printError => setError(printError.message))
                }}><FileText size={15} /> Hoja de cierre</SecondaryButton>
                <SecondaryButton onClick={() => void exportPdf([{name:'Cierre de ruta',headers:['Producto','Entregado','Vendido','Debía volver','Devuelto','Diferencia'],rows:[...closure.products.map(row=>[row.productName,formatQty(row.totalLoaded,row.unitType),formatQty(row.sold,row.unitType),formatQty(row.expectedReturn,row.unitType),formatQty(row.actualReturn,row.unitType),formatQty(row.variance,row.unitType)]),['EFECTIVO','','','','Esperado',formatBs(closure.expectedCash)],['','','','','Declarado',formatBs(closure.physicalCashDeclared ?? 0)],['','','','','Diferencia',formatBs(closure.cashDifference)]]}],`${closure.routeName} · ${closure.distributorName} · Encargado almacén: ${closure.warehouseResponsibleName || 'registro anterior'} · Generado ${new Date().toLocaleString('es-BO')}`,`Cierre-${closure.dayKey || 'ruta'}.pdf`).catch(pdfError=>setError(pdfError.message))}><Send size={15} /> Compartir PDF</SecondaryButton>
              </div>
            </div>}
          </article>
        })}
      </div>}
    </SectionCard>
  )

  if (!dispatch) {
    return (
      <Screen title="Cierre de ruta">
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
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      </Screen>
    )
  }

  return (
    <Screen title="Cierre de ruta" subtitle={`${dispatch.routeName} · ${dispatch.distributorName}`}>
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
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {productRows.filter(row => row.productName.toLowerCase().includes(productSearch.trim().toLowerCase())).map((row) => {
              const product = data.products.find(p => p.id === row.productId)
              const presentation = product ? getProductPresentation(product) : ''
              return (
                <div key={row.productId} className="w-full min-w-0 rounded-xl border border-slate-200 bg-white p-2.5 shadow-xs hover:border-slate-300 transition-colors">
                  {/* Fila 1: Nombre + Detalle + Estado/Diferencia badge */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-1.5">
                        <span className="line-clamp-2 text-xs font-black leading-snug text-slate-900">{row.productName}</span>
                        {presentation && (
                          <span className="line-clamp-1 text-[10px] font-semibold text-slate-500">({presentation})</span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0">
                      {isDeclared(row.productId) ? (
                        <VarianceBadge variance={row.variance} unitType={row.unitType} />
                      ) : (
                        <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[9px] font-black text-slate-500">
                          SIN DECLARAR
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Fila 2: Tira horizontal de 4 métricas */}
                  <div className="mt-1.5 flex items-center justify-between rounded-lg bg-slate-50 px-2 py-1 text-[10px] text-slate-600 border border-slate-100">
                    <div>
                      <span className="text-[9px] text-slate-400">Env: </span>
                      <span className="font-bold tabular-nums text-slate-700">{formatQty(row.initialDispatch, row.unitType)}</span>
                    </div>
                    <span className="text-slate-300">·</span>
                    <div>
                      <span className="text-[9px] text-slate-400">Aum: </span>
                      <span className="font-bold tabular-nums text-slate-700">{formatQty(row.additions, row.unitType)}</span>
                    </div>
                    <span className="text-slate-300">·</span>
                    <div>
                      <span className="text-[9px] text-slate-400">Ven: </span>
                      <span className="font-bold tabular-nums text-slate-700">{formatQty(row.sold, row.unitType)}</span>
                    </div>
                    <span className="text-slate-300">·</span>
                    <div>
                      <span className="text-[9px] text-slate-400 font-semibold">Debe volver: </span>
                      <span className="font-black tabular-nums text-indigo-700">{formatQty(row.expectedReturn, row.unitType)}</span>
                    </div>
                  </div>

                  {/* Fila 3: Input de devolución con botones rápidos [0] [Todo (W)] */}
                  <div className="mt-2 flex items-center justify-between gap-1.5 pt-1.5 border-t border-slate-100">
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mr-0.5">Retorno:</span>
                      <button
                        type="button"
                        disabled={(!canRegisterReturn && !isDistributor) || returnsAlreadyApplied}
                        onClick={() => setReturns((current) => ({ ...current, [row.productId]: '0' }))}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-100 active:scale-95 disabled:opacity-40 transition-colors"
                        title="Declarar retorno 0"
                      >
                        0
                      </button>
                      <button
                        type="button"
                        disabled={(!canRegisterReturn && !isDistributor) || returnsAlreadyApplied}
                        onClick={() => setReturns((current) => ({ ...current, [row.productId]: String(row.expectedReturn) }))}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-100 active:scale-95 disabled:opacity-40 transition-colors"
                        title={`Declarar retorno esperado (${row.expectedReturn})`}
                      >
                        Todo ({row.expectedReturn})
                      </button>
                    </div>
                    <div className="w-24 sm:w-28 shrink-0">
                      <NumberInput
                        value={returns[row.productId] ?? ''}
                        min={0}
                        step={row.unitType === 'kg' ? 0.1 : 1}
                        disabled={(!canRegisterReturn && !isDistributor) || returnsAlreadyApplied}
                        placeholder="0"
                        className="!min-h-[34px] py-1 px-2.5 text-right font-black text-xs"
                        onChange={(event) =>
                          setReturns((current) => ({ ...current, [row.productId]: event.target.value }))
                        }
                      />
                    </div>
                  </div>
                </div>
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
              <SecondaryButton onClick={() => void reopenClosure(existingClosure, session.uid)}>
                <Unlock size={15} /> Reabrir (administracion)
              </SecondaryButton>
            )}
          </div>
        {closureHistory}
      </div>
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
