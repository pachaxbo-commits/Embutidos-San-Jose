import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, BadgeCheck, CheckCircle2, ChevronDown, ChevronRight, ClipboardCheck, Clock3, FileText, History, Lock, PackageCheck, Printer, Search, Send, Unlock } from 'lucide-react'
import { Field, NumberInput, Segmented, TextInput } from '../../../components/ui/Form'
import { ChoiceButton, ChoiceModal } from '../../../components/ui/ChoiceModal'
import { Modal } from '../../../components/ui/Modal'
import { EmptyBlock, Screen } from '../../../components/ui/Screen'
import { buildReconciliation, computeMoneySummary, isSaleForDispatch, matchesRoute, round2, toDayKey } from '../domain/engine'
import { previewDispatchMermaSettlement } from '../domain/dispatchMermaSettlement'
import { declareRouteReturn, newOperationId, reopenClosure, saveClosure, setClosureVarianceReviewed, subscribeSales, subscribeCollections, subscribeExpenses } from '../data/distributionRepository'
import { KpiCard, PrimaryButton, SecondaryButton, SectionCard, VarianceBadge, formatBs, formatQty } from './shared'
import type { DistributionViewProps } from './DistributionApp'
import type { DistSale, DistCollection, DistExpense, DistClosure } from '../types'
import { printClosureTicket, printClosureSheet, shareClosurePdf } from '../data/distributionDocumentPrintService'
import { closureRectificationView } from '../domain/closureRectification'
import { ClosureRectificationAudit } from './ClosureRectificationAudit'
import { getProductPresentation } from '../domain/productPresentation'
import { calculateDeclaredReturnTotal, calculatePhysicalReturnBreakdown, calculateReturnBreakdown, calculateReturnDeclarationDifference, parseReturnQuantityInput, validateReturnDeclarationInput, validateReturnQuantity } from '../domain/returnReconciliation'
import { closureReopenEvents, closureReturnSummary } from '../domain/closureAudit'
import { boliviaDayKey, buildClosureQueue, closureQueueCounts, filterClosureQueue, filterClosureQueueForRole, type ClosureQueueFilter } from '../domain/closureQueue'
import { closureHistoryOwnerKey, closureOperationalDayKey, filterClosureHistory, visibleClosureHistory } from '../domain/closureHistory'
import { RangePicker, describeRange, formatDayKey, type RangePreset } from './RangePicker'
import { recordDiagnosticEvent, setDiagnosticClosureContext } from '../../../lib/errorDiagnostics'

const CLOSURE_STATUS: Record<DistClosure['status'], string> = {
  draft: 'Devolución declarada; espera confirmación de almacén',
  warehouse_done: 'Devolución confirmada por almacén',
  closed: 'Cierre finalizado',
  reopened: 'Cierre reabierto',
}

const parseDraftQuantities = (drafts: Record<string, string>) =>
  Object.fromEntries(Object.entries(drafts).map(([id, value]) => [
    id,
    value.trim() === '' ? 0 : parseReturnQuantityInput(value) ?? 0,
  ]))

const getClosureSortTimestamp = (closure: DistClosure) => closure.closedAt || closure.warehouseClosedAt || closure.returnDeclaredAt || closure.createdAt || ''

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
  const [recoverableMermaDrafts, setRecoverableMermaDrafts] = useState<Record<string, Record<string, string>>>({})
  const [wasteDrafts, setWasteDrafts] = useState<Record<string, Record<string, string>>>({})
  const [wasteReasonDrafts, setWasteReasonDrafts] = useState<Record<string, Record<string, string>>>({})
  const [receiptReviewedByDispatch, setReceiptReviewedByDispatch] = useState<Record<string, string[]>>({})
  const [receiptModalProductId, setReceiptModalProductId] = useState<string | null>(null)
  const [receiptModalDraft, setReceiptModalDraft] = useState({ normal: '', merma: '0', waste: '0', reason: '' })
  const [cashDrafts, setCashDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [returnInputIssue, setReturnInputIssue] = useState<{ productId: string; field: 'normal' | 'merma'; message: string } | null>(null)
  const returnCardRefs = useRef<Record<string, HTMLElement | null>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isSubmittingRef = useRef(false)
  const [justClosedRouteName, setJustClosedRouteName] = useState<string | null>(null)
  const [isDispatchOpen, setIsDispatchOpen] = useState(false)
  const [historyOpenId, setHistoryOpenId] = useState<string | null>(null)
  const [rectificationModes, setRectificationModes] = useState<Record<string, 'original' | 'corrected'>>({})
  const [reviewingClosureId, setReviewingClosureId] = useState('')
  const [confirmingDeclaration, setConfirmingDeclaration] = useState(false)
  const [confirmingWarehouseReception, setConfirmingWarehouseReception] = useState(false)
  const [confirmingClosure, setConfirmingClosure] = useState(false)
  const [reopenTarget, setReopenTarget] = useState<DistClosure | null>(null)
  const [reopenReason, setReopenReason] = useState('')
  const [reopenPreserveFinancialSnapshot, setReopenPreserveFinancialSnapshot] = useState(false)
  const [isReopening, setIsReopening] = useState(false)
  const todayKey = toDayKey(new Date())
  const queueTodayKey = boliviaDayKey(new Date().toISOString())
  const [adminDayKey, setAdminDayKey] = useState(todayKey)
  const [adminDeclaredCash, setAdminDeclaredCash] = useState('')
  const [adminNote, setAdminNote] = useState('')
  const [confirmingAdminClosure, setConfirmingAdminClosure] = useState(false)
  const [closureTab, setClosureTab] = useState<'routes' | 'admin'>(availableDispatches.length === 0 && session.role === 'admin' ? 'admin' : 'routes')
  const [closureViewMode, setClosureViewMode] = useState<'current' | 'history'>('current')
  const [closureQueueFilter, setClosureQueueFilter] = useState<ClosureQueueFilter>('all')
  const [historyDayKeys, setHistoryDayKeys] = useState<string[]>([todayKey])
  const [historyPreset, setHistoryPreset] = useState<RangePreset>('today')
  const [historyOwnerFilter, setHistoryOwnerFilter] = useState('')
  const [historyVisibleCount, setHistoryVisibleCount] = useState(20)
  const [isHistoryOwnerOpen, setIsHistoryOwnerOpen] = useState(false)
  const [reopenHistoryTarget, setReopenHistoryTarget] = useState<DistClosure | null>(null)

  const dispatch = availableDispatches.find(item => item.id === selectedDispatchId) ?? availableDispatches[0] ?? null

  const existingClosure = dispatch
    ? data.closures.find((closure) => closure.dispatchId === dispatch.id) ?? null
    : null
  useEffect(() => {
    const closure = data.closures.find(item => item.dispatchId === selectedDispatchId)
    if (!selectedDispatchId) {
      setDiagnosticClosureContext(null)
      return
    }
    setDiagnosticClosureContext({
      dispatchId: selectedDispatchId,
      ...(closure?.id ? { closureId: closure.id } : {}),
      ...(closure?.dayKey ? { dayKey: closure.dayKey } : {}),
      dispatchStatus: dispatch ? 'open' : 'closed',
      ...(closure?.status ? { closureStatus: closure.status } : { closureStatus: 'unknown' }),
      confirmation: 'unknown',
    })
    return () => setDiagnosticClosureContext(null)
  }, [data.closures, dispatch, selectedDispatchId])
  const previousClosureStatusesRef = useRef<Map<string, string>>(new Map())
  const previousOpenDispatchIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const knownStatuses = previousClosureStatusesRef.current
    for (const closure of data.closures) {
      const previousStatus = knownStatuses.get(closure.dispatchId)
      if (previousStatus !== closure.status) {
        recordDiagnosticEvent('closure_snapshot', closure.status as 'draft' | 'warehouse_done' | 'closed' | 'reopened', { dispatchId: closure.dispatchId, closureId: closure.id, operationStatus: 'unknown' })
        if (closure.status === 'closed') recordDiagnosticEvent('post_close_render', 'closed', { dispatchId: closure.dispatchId, closureId: closure.id })
        knownStatuses.set(closure.dispatchId, closure.status)
      }
    }
    const currentOpenDispatchIds = new Set(data.openDispatches.map(item => item.id))
    for (const id of previousOpenDispatchIdsRef.current) {
      if (!currentOpenDispatchIds.has(id)) recordDiagnosticEvent('dispatch_removed', 'none', { dispatchId: id })
    }
    previousOpenDispatchIdsRef.current = currentOpenDispatchIds
  }, [data.closures, data.openDispatches])

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
        const normalReturn = row?.actualReturn ?? existingClosure?.declaredReturns?.[id]
        return [id, normalReturn === undefined ? '' : String(normalReturn)]
      }))
  const savedRecoverableMermas = isDistributor
    ? Object.fromEntries(Object.entries(existingClosure?.declaredReturnMermas || {}).map(([id, q]) => [id, String(q)]))
    : Object.fromEntries([...new Set([
        ...Object.keys(existingClosure?.declaredReturnMermas || {}),
        ...existingProductsById.keys(),
      ])].map(id => {
        const row = existingProductsById.get(id)
        const merma = row?.returnMerma ?? existingClosure?.declaredReturnMermas?.[id] ?? 0
        return [id, String(merma)]
      }))
  const savedWastes = Object.fromEntries((existingClosure?.products || []).map(row => [row.productId, String(row.returnWaste || 0)]))
  const savedWasteReasons = Object.fromEntries((existingClosure?.products || []).map(row => [row.productId, row.returnWasteReason || '']))
  const returns = returnDrafts[dispatchKey] ?? savedReturns
  const recoverableMermas = recoverableMermaDrafts[dispatchKey] ?? savedRecoverableMermas
  const wastes = wasteDrafts[dispatchKey] ?? savedWastes
  const wasteReasons = wasteReasonDrafts[dispatchKey] ?? savedWasteReasons
  const declaredCash = cashDrafts[dispatchKey] ?? (existingClosure?.physicalCashDeclared != null ? String(existingClosure.physicalCashDeclared) : '')
  const setDeclaredCash = (value: string) => setCashDrafts(current => ({ ...current, [dispatchKey]: value }))
  const setReturns = (updater: (current: Record<string, string>) => Record<string, string>) => setReturnDrafts(current => ({ ...current, [dispatchKey]: updater(current[dispatchKey] ?? savedReturns) }))
  const reviewedReceiptIds = new Set(receiptReviewedByDispatch[dispatchKey] || [])
  const closureQueue = filterClosureQueueForRole(
    buildClosureQueue(availableDispatches, data.closures, receiptReviewedByDispatch, queueTodayKey),
    session.role,
    session.warehouseId,
  )
  const closureQueueSummary = closureQueueCounts(closureQueue)
  const visibleClosureQueue = filterClosureQueue(closureQueue, closureQueueFilter)
  const closureQueueStatuses = {
    undeclared: {
      label: 'Sin declarar',
      className: 'border-slate-200 bg-slate-50 text-slate-800',
      badgeClassName: 'bg-slate-200 text-slate-700',
      message: () => 'Aún no existe una declaración del distribuidor.',
      Icon: Clock3,
    },
    awaiting_warehouse: {
      label: 'Esperando Almacén',
      className: 'border-amber-300 bg-amber-50 text-amber-950 ring-1 ring-amber-100',
      badgeClassName: 'bg-amber-200 text-amber-950',
      message: (item: typeof closureQueue[number]) => `${item.closure?.distributorName || item.dispatch?.distributorName || 'El distribuidor'} ya declaró su retorno — esperando revisión de Almacén.`,
      Icon: Clock3,
    },
    warehouse_confirmed: {
      label: 'Recepción confirmada',
      className: 'border-emerald-200 bg-emerald-50 text-emerald-950',
      badgeClassName: 'bg-emerald-100 text-emerald-900',
      message: () => 'Almacén confirmó la recepción; está pendiente el cierre administrativo.',
      Icon: BadgeCheck,
    },
    closed: {
      label: 'Cierre finalizado',
      className: 'border-emerald-200 bg-white text-emerald-950',
      badgeClassName: 'bg-emerald-100 text-emerald-900',
      message: () => 'Administración completó el cierre de esta ruta.',
      Icon: CheckCircle2,
    },
  } satisfies Record<typeof closureQueue[number]['stage'], {
    label: string
    className: string
    badgeClassName: string
    message: (item: typeof closureQueue[number]) => string
    Icon: typeof Clock3
  }>

  // Las suscripciones anteriores pueden seguir vivas durante un render al cambiar
  // de ruta. Nunca conciliar un despacho con ventas/caja de otro despacho.
  const [salesSnapshot, setSalesSnapshot] = useState<{ dispatchId: string; rows: DistSale[] }>({ dispatchId: '', rows: [] })
  const [collectionsSnapshot, setCollectionsSnapshot] = useState<{ dispatchId: string; rows: DistCollection[] }>({ dispatchId: '', rows: [] })
  const [expensesSnapshot, setExpensesSnapshot] = useState<{ dispatchId: string; rows: DistExpense[] }>({ dispatchId: '', rows: [] })
  const routeSales = salesSnapshot.dispatchId === dispatchKey ? salesSnapshot.rows : []
  const routeCollections = collectionsSnapshot.dispatchId === dispatchKey ? collectionsSnapshot.rows : []
  const routeExpenses = expensesSnapshot.dispatchId === dispatchKey ? expensesSnapshot.rows : []
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
    const stop = [subscribeSales(days, dispatchRoute, rows => { setSalesSnapshot({ dispatchId: dispatchKey, rows: rows.filter(s => isSaleForDispatch(s, dispatchRoute) && !s.voidedAt && !s.pendingConfirmation && (s.dispatchId === dispatchKey || (!s.dispatchId && s.createdAt >= dispatchCreated))).map(s => s.effectiveSnapshot ? { ...s, ...s.effectiveSnapshot } : s) }); mark('sales') }, fail, ownerUid)]
    if (session.role !== 'warehouse') {
      stop.push(subscribeCollections(days, dispatchRoute, rows => { setCollectionsSnapshot({ dispatchId: dispatchKey, rows: rows.filter(c => c.createdAt >= dispatchCreated) }); mark('collections') }, fail, ownerUid))
      stop.push(subscribeExpenses(days, dispatchRoute, rows => { setExpensesSnapshot({ dispatchId: dispatchKey, rows: rows.filter(e => e.createdAt >= dispatchCreated) }); mark('expenses') }, fail, ownerUid))
    }
    return () => stop.forEach(fn => fn())
  }, [dispatchKey, dispatchDay, dispatchRoute, dispatchCreated, session.role, session.uid])

  /** La declaración y la recepción son independientes; cada rol completa su propio dato. */
  const isDeclared = (productId: string) => {
    const value = returns[productId]
    const merma = recoverableMermas[productId] ?? '0'
    const row = productRows.find(item => item.productId === productId)
    if (isDistributor) return value !== undefined && value !== '' && parseReturnQuantityInput(value) !== null
    return value !== undefined && value !== '' && parseReturnQuantityInput(value) !== null
      && (row?.unitType !== 'kg' || (merma !== '' && parseReturnQuantityInput(merma) !== null))
  }

  const parsedReturns = useMemo(() => parseDraftQuantities(returns), [returns])
  const parsedRecoverableMermas = useMemo(() => parseDraftQuantities(recoverableMermas), [recoverableMermas])
  const parsedWastes = useMemo(() => parseDraftQuantities(wastes), [wastes])
  const productRows = buildReconciliation(dispatch, routeSales, parsedReturns).map(row => {
    const returnWaste = parsedWastes[row.productId] || 0
    const returnMerma = parsedRecoverableMermas[row.productId] || 0
    const mermaPreview = !isDistributor
      ? previewDispatchMermaSettlement(dispatch, routeSales, row.productId, row.actualReturn, returnMerma, returnWaste)
      : null
    const expectedPhysicalReturn = mermaPreview?.eligible ? mermaPreview.expectedPhysicalReturn : row.expectedReturn
    const breakdown = isDistributor
      ? calculateReturnBreakdown(row.expectedReturn, row.actualReturn, 0)
      : calculatePhysicalReturnBreakdown(expectedPhysicalReturn, row.actualReturn, returnMerma, returnWaste)
    const saved = existingProductsById.get(row.productId)
    const declaredReturnNormal = existingClosure?.declaredReturns?.[row.productId] ?? saved?.declaredReturnNormal ?? (saved?.declaredReturn != null ? saved.declaredReturn - (saved.declaredReturnMerma || 0) : undefined)
    const declaredReturnMerma = existingClosure?.declaredReturnMermas?.[row.productId] ?? saved?.declaredReturnMerma ?? 0
    const declaredReturn = declaredReturnNormal === undefined ? saved?.declaredReturn : calculateDeclaredReturnTotal(declaredReturnNormal, declaredReturnMerma)
    return {
      ...row,
      expectedReturn: expectedPhysicalReturn,
      ...(mermaPreview && mermaPreview.dispatchMermaSent > 0 ? {
        normalExpectedReturn: mermaPreview.normalExpectedReturn,
        dispatchMermaSent: mermaPreview.dispatchMermaSent,
        dispatchMermaIncludedInSales: mermaPreview.includedInSales,
        dispatchMermaReconciliationStatus: mermaPreview.fullyReturned ? 'returned' as const : mermaPreview.eligible ? (mermaPreview.includedInSales > 0 ? 'included_in_sales' as const : 'reconciled_with_unfit' as const) : 'pending_review' as const,
      } : {}),
      declaredReturn,
      declaredReturnNormal,
      declaredReturnMerma,
      physicalReturn: isDistributor ? undefined : calculateDeclaredReturnTotal(row.actualReturn + returnMerma, returnWaste),
      actualReturn: row.actualReturn,
      returnMerma,
      returnWaste,
      returnWasteReason: wasteReasons[row.productId] || '',
      shortage: breakdown.shortage,
      overage: breakdown.overage,
      variance: breakdown.overage - breakdown.shortage,
    }
  })
  useEffect(() => {
    if (!returnInputIssue) return
    const card = returnCardRefs.current[returnInputIssue.productId]
    if (!card) return
    card.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    const input = [...card.querySelectorAll<HTMLInputElement>('input[data-return-field]')]
      .find(candidate => candidate.dataset.returnField === returnInputIssue.field)
    input?.focus({ preventScroll: true })
  }, [returnInputIssue])
  const receiptModalRow = productRows.find(row => row.productId === receiptModalProductId) ?? null
  const receiptModalNormal = parseReturnQuantityInput(receiptModalDraft.normal) ?? 0
  const receiptModalMerma = parseReturnQuantityInput(receiptModalDraft.merma) ?? 0
  const receiptModalWaste = parseReturnQuantityInput(receiptModalDraft.waste) ?? 0
  const receiptModalBreakdown = receiptModalRow
    ? calculatePhysicalReturnBreakdown(receiptModalRow.expectedReturn, receiptModalNormal, receiptModalMerma, receiptModalWaste)
    : null

  const openReceiptEditor = (productId: string) => {
    setReceiptModalProductId(productId)
    setReceiptModalDraft({
      normal: returns[productId] ?? '',
      merma: recoverableMermas[productId] ?? '0',
      waste: wastes[productId] ?? '0',
      reason: wasteReasons[productId] ?? '',
    })
  }

  const saveReceiptEditor = () => {
    if (!receiptModalRow) return
    const quantities = [receiptModalDraft.normal, receiptModalDraft.merma, receiptModalDraft.waste]
    if (quantities.some(value => value.trim() === '' || parseReturnQuantityInput(value) === null)) {
      setError('Completa las cantidades antes de guardar la recepción.')
      return
    }
    if (![receiptModalNormal, receiptModalMerma, receiptModalWaste].every(value => validateReturnQuantity(receiptModalRow.unitType, value))) {
      setError('Los kilogramos admiten decimales; paquetes y unidades requieren cantidades enteras.')
      return
    }
    if (receiptModalWaste > 0 && !receiptModalDraft.reason.trim()) {
      setError('Indica por qué el producto no puede volver al stock vendible.')
      return
    }
    const pid = receiptModalRow.productId
    setReturnDrafts(current => ({ ...current, [dispatchKey]: { ...(current[dispatchKey] ?? returns), [pid]: receiptModalDraft.normal } }))
    setRecoverableMermaDrafts(current => ({ ...current, [dispatchKey]: { ...(current[dispatchKey] ?? recoverableMermas), [pid]: receiptModalDraft.merma } }))
    setWasteDrafts(current => ({ ...current, [dispatchKey]: { ...(current[dispatchKey] ?? wastes), [pid]: receiptModalDraft.waste } }))
    setWasteReasonDrafts(current => ({ ...current, [dispatchKey]: { ...(current[dispatchKey] ?? wasteReasons), [pid]: receiptModalDraft.reason.trim() } }))
    setReceiptReviewedByDispatch(current => ({ ...current, [dispatchKey]: [...new Set([...(current[dispatchKey] || []), pid])] }))
    setError(null)
    setReceiptModalProductId(null)
  }

  const moneySummary = computeMoneySummary(routeSales, routeCollections, routeExpenses)
  const claimCash = data.claims.filter(c => c.routeId === dispatchRoute && c.createdAt >= dispatchCreated).reduce((n,c)=>n+c.cashIn-c.cashOut,0)
  const calculatedMoney = { ...moneySummary, expectedCash:round2(moneySummary.expectedCash+claimCash) }
  const preservingHistoricalMoney = Boolean(existingClosure?.preserveFinancialSnapshot && ['reopened', 'warehouse_done'].includes(existingClosure.status))
  const money = preservingHistoricalMoney
    ? {
        cashSales: existingClosure?.cashSales || 0,
        qrSales: existingClosure?.qrSales || 0,
        creditGenerated: existingClosure?.creditGenerated || 0,
        cashCollections: existingClosure?.cashCollections || 0,
        qrCollections: existingClosure?.qrCollections || 0,
        cashExpenses: existingClosure?.cashExpenses || 0,
        expectedCash: existingClosure?.expectedCash || 0,
      }
    : calculatedMoney

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
    const cashExpenses = round2(expenses.reduce((n, e) => n + ((e.paymentMethod ?? 'cash') === 'cash' ? (e.amount || 0) : 0), 0))
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

  const submit = async (status: DistClosure['status'], confirmed = false) => {
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
      const unreviewedCount = productRows.filter(row => !reviewedReceiptIds.has(row.productId)).length
      if (unreviewedCount > 0) {
        setError(`Revisa la recepción de todos los productos. Faltan ${unreviewedCount}.`)
        isSubmittingRef.current = false
        setIsSubmitting(false)
        return
      }
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
      const incompleteQuantity = productRows.find(row =>
        [returns[row.productId] ?? '', recoverableMermas[row.productId] ?? '0', wastes[row.productId] ?? '0']
          .some(value => value.trim() !== '' && parseReturnQuantityInput(value) === null))
      if (incompleteQuantity) {
        setError(`${incompleteQuantity.productName}: completa la cantidad decimal antes de confirmar.`)
        isSubmittingRef.current = false
        setIsSubmitting(false)
        return
      }
      const invalidQuantity = productRows.find(row =>
        !validateReturnQuantity(row.unitType, parsedReturns[row.productId] || 0)
        || !validateReturnQuantity(row.unitType, parsedRecoverableMermas[row.productId] || 0)
        || !validateReturnQuantity(row.unitType, parsedWastes[row.productId] || 0))
      if (invalidQuantity) {
        setError(`${invalidQuantity.productName}: paquetes y unidades requieren cantidades enteras; los kilogramos admiten decimales.`)
        isSubmittingRef.current = false
        setIsSubmitting(false)
        return
      }
      const missingReason = productRows.find(row => (parsedWastes[row.productId] || 0) > 0 && !wasteReasons[row.productId]?.trim())
      if (missingReason) {
        setError(`Indica por qué ${missingReason.productName} no puede volver al stock vendible.`)
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

    if (status === 'warehouse_done' && !confirmed) {
      setConfirmingWarehouseReception(true)
      isSubmittingRef.current = false
      setIsSubmitting(false)
      return
    }

    let diagnosticOperationId = ''
    try {
      const operationId = newOperationId('closure')
      diagnosticOperationId = operationId
      setDiagnosticClosureContext({ dispatchId: dispatch.id, closureId: closure.id, operationId, dayKey: closure.dayKey, dispatchStatus: 'open', closureStatus: status, confirmation: 'queued' })
      recordDiagnosticEvent('operation_sent', status, { dispatchId: dispatch.id, closureId: closure.id, operationId, operationStatus: 'queued' })
      await saveClosure({ closure, applyStockReturn: status === 'warehouse_done' && !returnsAlreadyApplied }, operationId)
      if (status === 'warehouse_done') setConfirmingWarehouseReception(false)
      setDiagnosticClosureContext({ dispatchId: dispatch.id, closureId: closure.id, operationId, dayKey: closure.dayKey, dispatchStatus: status === 'closed' ? 'closed' : 'open', closureStatus: status, confirmation: 'confirmed' })
      recordDiagnosticEvent('confirmation_received', status, { dispatchId: dispatch.id, closureId: closure.id, operationId, operationStatus: 'confirmed' })
      if (status === 'closed') {
        setJustClosedRouteName(dispatch.routeName)
      }
    } catch (submitError) {
      const rejected = Boolean((submitError as { rejected?: boolean }).rejected)
      setDiagnosticClosureContext({ dispatchId: dispatch.id, closureId: closure.id, operationId: diagnosticOperationId, dayKey: closure.dayKey, dispatchStatus: 'open', closureStatus: status, confirmation: rejected ? 'rejected' : 'unknown' })
      recordDiagnosticEvent('confirmation_received', status, { dispatchId: dispatch.id, closureId: closure.id, operationId: diagnosticOperationId, operationStatus: rejected ? 'rejected' : 'unknown' })
      setError((submitError as Error).message || 'No se pudo guardar el cierre.')
    } finally {
      isSubmittingRef.current = false
      setIsSubmitting(false)
    }
  }

  const requestDeclarationConfirmation = () => {
    if (isSubmittingRef.current || isSubmitting) return
    for (const row of productRows) {
      const issue = validateReturnDeclarationInput(row.unitType, 'normal', returns[row.productId] ?? '')
      if (issue) {
        setProductSearch('')
        setReturnInputIssue({ productId: row.productId, field: issue.field, message: issue.message })
        setError(null)
        return
      }
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
    setReturnInputIssue(null)
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
    recordDiagnosticEvent('before_confirmation', 'closed', { dispatchId: dispatch?.id, closureId: existingClosure?.id })
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

  const accessibleHistoricalClosures = useMemo(() => data.closures
    .filter(closure => closure.status === 'closed')
    .filter(closure => session.role !== 'distributor' || closure.distributorUid === session.uid || closure.returnDeclaredBy === session.uid)
    .filter(closure => session.role !== 'warehouse' || (closure.warehouseId || 'central') === (session.warehouseId || 'central')),
  [data.closures, session.role, session.uid, session.warehouseId])
  const historyOwners = useMemo(() => [...new Map(accessibleHistoricalClosures.map(closure => [
    closureHistoryOwnerKey(closure),
    { value: closureHistoryOwnerKey(closure), label: `${closure.routeName || 'Ruta registrada'} · ${closure.distributorName || 'Distribuidor'}` },
  ])).values()].sort((a, b) => a.label.localeCompare(b.label, 'es')), [accessibleHistoricalClosures])
  const historyOwnerLabel = historyOwners.find(owner => owner.value === historyOwnerFilter)?.label || 'Todas las rutas / distribuidores'
  const filteredHistoricalClosures = useMemo(() => filterClosureHistory(accessibleHistoricalClosures, historyDayKeys, historyOwnerFilter)
    .slice()
    .sort((a, b) => closureOperationalDayKey(b).localeCompare(closureOperationalDayKey(a)) || getClosureSortTimestamp(b).localeCompare(getClosureSortTimestamp(a))),
  [accessibleHistoricalClosures, historyDayKeys, historyOwnerFilter])
  const historicalClosures = visibleClosureHistory(filteredHistoricalClosures, historyVisibleCount)

  const closureHistory = (
    <SectionCard title="Historial de cierres">
      <div className="grid gap-3">
        <p className="text-xs leading-relaxed text-slate-600">Busca cierres por la fecha de la jornada. Si un cierre se reabrió otro día, seguirá apareciendo en su fecha original.</p>
        <RangePicker dayKeys={historyDayKeys} initialPreset={historyPreset} onPresetChange={setHistoryPreset} onChange={value => { setHistoryDayKeys(value); setHistoryVisibleCount(20) }} />
        {session.role === 'admin' && <Field label="Ruta / distribuidor"><ChoiceButton label={historyOwnerLabel} placeholder="Todas las rutas / distribuidores" onClick={() => setIsHistoryOwnerOpen(true)} /></Field>}
        <p className="text-xs font-bold text-slate-600">{describeRange(historyDayKeys)} · {historyOwnerLabel} · {filteredHistoricalClosures.length} cierres encontrados{filteredHistoricalClosures.length > 0 ? ` · mostrando ${historicalClosures.length}` : ''}</p>
      </div>
      {filteredHistoricalClosures.length === 0 ? <EmptyBlock title={historyDayKeys.length === 1 && historyDayKeys[0] === todayKey ? 'No hay cierres para hoy.' : 'No hay cierres para este periodo.'} description="Prueba Semana, Mes o selecciona otras fechas." /> : <div className="mt-3 grid gap-2">
        {historicalClosures.map(historyClosure => {
          const closure = closureRectificationView(historyClosure, rectificationModes[historyClosure.id] || 'corrected')
          const expanded = historyOpenId === closure.id
          const hasProductDifference = closure.products.some(row => Math.abs(Number(row.variance) || 0) > 0.001)
          const closureTimestamp = closure.closedAt || closure.warehouseClosedAt || closure.returnDeclaredAt || closure.createdAt
          const reopenEvents = closureReopenEvents(closure)
          return <article key={closure.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="grid gap-2 p-3">
              {closure.rectification && <span className="w-fit rounded-full bg-blue-100 px-2 py-1 text-[10px] font-black text-blue-900">RECTIFICADO</span>}
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="break-words text-sm text-slate-900">{closure.routeName || 'Ruta registrada'} · {closure.distributorName || 'Distribuidor'}</strong>{reopenEvents.length > 0 && <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-black tracking-wide text-amber-900">REABIERTO</span>}</div>
                  <p className="mt-1 text-xs font-bold text-slate-700">Jornada: {formatDayKey(closureOperationalDayKey(closure)) || 'Sin fecha registrada'}</p>
                  <p className="text-[11px] font-semibold text-slate-500">Cierre: {closureTimestamp ? new Date(closureTimestamp).toLocaleString('es-BO') : 'Sin fecha registrada'}</p>
                  {reopenEvents.at(-1)?.reopenedAt && <p className="text-[11px] font-semibold text-amber-800">Reabierto: {new Date(reopenEvents.at(-1)!.reopenedAt!).toLocaleString('es-BO')}</p>}
                  <p className="mt-1 text-[10px] font-extrabold text-[var(--primary)]">{CLOSURE_STATUS[closure.status] || 'Estado pendiente'}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {reopenEvents.length > 0 && <SecondaryButton onClick={() => setReopenHistoryTarget(closure)}><History size={15} /> Ver historial de reapertura</SecondaryButton>}
                  <SecondaryButton onClick={() => setHistoryOpenId(expanded ? null : closure.id)} aria-expanded={expanded}>{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}{expanded ? 'Ocultar detalle' : 'Ver detalle'}</SecondaryButton>
                </div>
              </div>
            </div>
            {expanded && <div className="grid gap-3 border-t border-slate-100 p-3">
              <ClosureRectificationAudit closure={closure} onSelect={mode => setRectificationModes(current => ({ ...current, [closure.id]: mode }))} />
              <div className="grid gap-1 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                <p><strong>Jornada / fecha operativa:</strong> {closure.dayKey || 'Sin fecha registrada'}</p>
                {closure.warehouseClosedAt && <p><strong>Recepción de almacén:</strong> {new Date(closure.warehouseClosedAt).toLocaleString('es-BO')}</p>}
                {closure.closedAt && <p><strong>Cierre actual:</strong> {new Date(closure.closedAt).toLocaleString('es-BO')}</p>}
              </div>
              <div className="grid gap-2 md:grid-cols-2">{closure.products.length === 0 ? <p className="text-xs text-slate-500">Almacén todavía no confirmó las cantidades.</p> : closure.products.map(row => {
                const declaredNormal = row.declaredReturnNormal ?? closure.declaredReturns?.[row.productId]
                const declaredMerma = row.declaredReturnMerma ?? closure.declaredReturnMermas?.[row.productId] ?? 0
                const declared = declaredNormal === undefined ? row.declaredReturn : round2(Number(declaredNormal) + Number(declaredMerma))
                  const declaredLabel = declared === undefined
                  ? 'Sin registro'
                    : session.role === 'distributor'
                      ? formatQty(Number(declared), row.unitType)
                  : closure.returnDeclarationMode === 'normal_only'
                    ? `${formatQty(Number(declaredNormal ?? declared), row.unitType)} normal (declaración simple)`
                    : declaredNormal === undefined
                      ? formatQty(Number(declared), row.unitType)
                      : `Normal ${formatQty(Number(declaredNormal), row.unitType)} + merma ${formatQty(Number(declaredMerma), row.unitType)} = ${formatQty(Number(declared), row.unitType)}`
                const physical = row.physicalReturn ?? row.actualReturn + (row.returnMerma || 0) + (row.returnWaste || 0)
                const returnSummary = closureReturnSummary(row)
                return <div key={row.productId} className="rounded-xl bg-slate-50 p-3"><div className="flex items-start justify-between gap-2"><strong className="min-w-0 break-words text-xs text-slate-900">{row.productName}</strong><VarianceBadge variance={row.variance} unitType={row.unitType} /></div><dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4"><div><dt className="text-[9px] font-bold uppercase text-slate-400">Despachado</dt><dd className="text-xs font-black">{formatQty(row.totalLoaded, row.unitType)}</dd></div><div><dt className="text-[9px] font-bold uppercase text-slate-400">Vendido</dt><dd className="text-xs font-black">{formatQty(row.sold, row.unitType)}</dd></div><div><dt className="text-[9px] font-bold uppercase text-slate-400">Cortesía</dt><dd className="text-xs font-black">{formatQty(row.courtesy || 0, row.unitType)}</dd></div><div><dt className="text-[9px] font-bold uppercase text-slate-400">Debía retornar</dt><dd className="text-xs font-black">{formatQty(row.expectedReturn, row.unitType)}</dd></div><div><dt className="text-[9px] font-bold uppercase text-slate-400">Declarado por distribuidor</dt><dd className="text-xs font-black">{declaredLabel}</dd></div><div><dt className="text-[9px] font-bold uppercase text-slate-400">Recibido físicamente</dt><dd className="text-xs font-black">{formatQty(physical, row.unitType)}{row.physicalReturn === undefined ? ' · aprox.' : ''}</dd></div>{session.role !== 'distributor' && <><div><dt className="text-[9px] font-bold uppercase text-slate-400">Retorno normal</dt><dd className="text-xs font-black text-emerald-700">{formatQty(returnSummary.normal, row.unitType)}</dd></div><div><dt className="text-[9px] font-bold uppercase text-slate-400">Merma recuperable</dt><dd className="text-xs font-black text-emerald-700">{formatQty(returnSummary.recoverableMerma, row.unitType)}</dd></div></>}<div><dt className="text-[9px] font-bold uppercase text-slate-400">Total apto recibido</dt><dd className="text-xs font-black text-emerald-800">{formatQty(returnSummary.totalApto, row.unitType)}</dd></div><div><dt className="text-[9px] font-bold uppercase text-slate-400">Vuelve al stock vendible</dt><dd className="text-xs font-black text-emerald-800">{formatQty(returnSummary.returnsToSellableStock, row.unitType)}{returnSummary.quarantinedSellableOverage > 0 ? ` · ${formatQty(returnSummary.quarantinedSellableOverage, row.unitType)} en cuarentena` : ''}</dd></div>{session.role !== 'distributor' && <><div><dt className="text-[9px] font-bold uppercase text-slate-400">Producto no apto / pérdida</dt><dd className="text-xs font-black text-rose-700">{formatQty(returnSummary.nonSellable, row.unitType)}{row.returnWasteReason ? ` · ${row.returnWasteReason}` : ''}</dd></div><div><dt className="text-[9px] font-bold uppercase text-slate-400">Costo de pérdida</dt><dd className="text-xs font-black">{row.lossCost == null && (row.returnWaste || 0) > 0 ? 'No disponible' : formatBs(row.lossCost || 0)}</dd></div></>}<div><dt className="text-[9px] font-bold uppercase text-slate-400">Faltante</dt><dd className="text-xs font-black">{row.shortage ?? Math.max(0, row.expectedReturn - physical)}</dd></div><div><dt className="text-[9px] font-bold uppercase text-slate-400">Sobrante</dt><dd className="text-xs font-black">{formatQty(row.overage || 0, row.unitType)}</dd></div></dl></div>
              })}</div>
              {session.role === 'admin' && closure.status === 'closed' && <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><KpiCard label="Ventas efectivo" value={formatBs(closure.cashSales)} /><KpiCard label="Ventas QR" value={formatBs(closure.qrSales)} /><KpiCard label="Crédito" value={formatBs(closure.creditGenerated)} /><KpiCard label="Cobros efectivo" value={formatBs(closure.cashCollections)} /><KpiCard label="Cobros QR" value={formatBs(closure.qrCollections)} /><KpiCard label="Egresos en efectivo" value={formatBs(closure.cashExpenses)} /><KpiCard label="Efectivo esperado" value={formatBs(closure.expectedCash)} /><KpiCard label="Efectivo declarado" value={formatBs(closure.physicalCashDeclared ?? 0)} /></div>}
              {session.role === 'admin' && hasProductDifference && ['warehouse_done', 'closed'].includes(closure.status) && <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 p-3"><p className="text-xs font-semibold text-amber-900">{closure.varianceReviewedAt ? `Diferencia revisada el ${new Date(closure.varianceReviewedAt).toLocaleString('es-BO')}.` : 'Esta diferencia aparece en pendientes de Administración.'}</p><SecondaryButton disabled={Boolean(reviewingClosureId)} onClick={async () => { setReviewingClosureId(closure.id); setError(null); try { await setClosureVarianceReviewed(closure.id, !closure.varianceReviewedAt) } catch (e) { setError((e as Error).message) } finally { setReviewingClosureId('') } }}>{reviewingClosureId === closure.id ? 'Guardando…' : closure.varianceReviewedAt ? 'Volver a pendientes' : 'Marcar revisada'}</SecondaryButton></div>}
              {session.role === 'admin' && closure.status === 'closed' && <div className="flex flex-wrap items-center justify-between gap-2"><VarianceBadge variance={closure.cashDifference} /><SecondaryButton onClick={() => { setReopenTarget(closure); setReopenReason(''); setReopenPreserveFinancialSnapshot(false); }}><Unlock size={15} /> Reabrir cierre</SecondaryButton></div>}
              <div className="grid grid-cols-3 gap-2">
                <SecondaryButton onClick={() => void printClosureTicket(closure).catch(printError => setError(printError.message))}><Printer size={15} /> Ticket de cierre</SecondaryButton>
                <SecondaryButton onClick={() => void printClosureSheet(closure).catch(printError => setError(printError.message))}><FileText size={15} /> Hoja de cierre</SecondaryButton>
                <SecondaryButton onClick={() => void shareClosurePdf(closure).catch(pdfError => setError(pdfError.message))}><Send size={15} /> Compartir PDF</SecondaryButton>
              </div>
            </div>}
          </article>
        })}
      </div>}
      {historicalClosures.length < filteredHistoricalClosures.length && <div className="mt-3 text-center"><SecondaryButton onClick={() => setHistoryVisibleCount(count => count + 20)}>Mostrar más ({filteredHistoricalClosures.length - historicalClosures.length} restantes)</SecondaryButton></div>}
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
            <KpiCard label="Egresos en efectivo" value={formatBs(adminMoney.cashExpenses)} tone="danger" />
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
                <SecondaryButton onClick={() => { setReopenTarget(existingAdminClosure); setReopenReason(''); setReopenPreserveFinancialSnapshot(false); }}><Unlock size={15} /> Reabrir arqueo</SecondaryButton>
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
    </div>
  )

  const closureNavigationControls = (
    <div className="grid gap-2 pb-1">
      {session.role === 'admin' && <Segmented
        value={closureTab}
        options={[
          { value: 'routes', label: 'Cierres de ruta' },
          { value: 'admin', label: 'Caja Administración' },
        ]}
        onChange={val => setClosureTab(val as 'routes' | 'admin')}
      />}
      <div className="flex justify-center">
        {closureViewMode === 'current' ? <SecondaryButton onClick={() => {
          setHistoryDayKeys([todayKey])
          setHistoryPreset('today')
          setHistoryVisibleCount(20)
          setClosureViewMode('history')
        }}><History size={16} /> Historial de cierres</SecondaryButton> : <SecondaryButton onClick={() => setClosureViewMode('current')}><ArrowLeft size={16} /> Volver al cierre actual</SecondaryButton>}
      </div>
    </div>
  )

  const closureQueuePanel = (session.role === 'admin' || session.role === 'warehouse') && (
    <SectionCard title="Estado de cierres de ruta">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-2.5"><p className="text-[10px] font-bold uppercase text-amber-900">Esperando Almacén</p><p className="mt-0.5 text-xl font-black tabular-nums text-amber-950">{closureQueueSummary.awaitingWarehouse}</p></div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5"><p className="text-[10px] font-bold uppercase text-slate-600">Sin declarar</p><p className="mt-0.5 text-xl font-black tabular-nums text-slate-800">{closureQueueSummary.undeclared}</p></div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-2.5"><p className="text-[10px] font-bold uppercase text-emerald-800">Recepción confirmada</p><p className="mt-0.5 text-xl font-black tabular-nums text-emerald-950">{closureQueueSummary.warehouseConfirmed}</p></div>
        <div className="rounded-xl border border-emerald-200 bg-white p-2.5"><p className="text-[10px] font-bold uppercase text-emerald-800">Cierre finalizado hoy</p><p className="mt-0.5 text-xl font-black tabular-nums text-emerald-950">{closureQueueSummary.closed}</p></div>
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-2.5"><p className="text-[10px] font-bold uppercase text-sky-800">En revisión aquí</p><p className="mt-0.5 text-xl font-black tabular-nums text-sky-950">{closureQueueSummary.reviewingHere}</p></div>
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-2.5"><p className="text-[10px] font-bold uppercase text-orange-800">Con diferencias</p><p className="mt-0.5 text-xl font-black tabular-nums text-orange-950">{closureQueueSummary.differences}</p></div>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">Los estados principales provienen del cierre guardado. “En revisión aquí” solo refleja productos revisados en esta sesión y dispositivo; no es un estado compartido.</p>
      <div className="mt-3 flex flex-wrap gap-2" aria-label="Filtrar cierres por estado">
        {([
          ['all', 'Todos'],
          ['awaiting_warehouse', 'Esperando Almacén'],
          ['undeclared', 'Sin declarar'],
          ['warehouse_confirmed', 'Recepción confirmada'],
          ['closed', 'Finalizados hoy'],
          ['reviewing_here', 'En revisión aquí'],
          ['differences', 'Con diferencias'],
        ] as [ClosureQueueFilter, string][]).map(([filter, label]) => (
          <button
            key={filter}
            type="button"
            aria-pressed={closureQueueFilter === filter}
            onClick={() => setClosureQueueFilter(filter)}
            className={`min-h-10 rounded-full border px-3 text-xs font-bold transition-colors ${closureQueueFilter === filter ? 'border-[var(--primary)] bg-[var(--primary)] text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
          >{label}</button>
        ))}
      </div>
      <div className="mt-3 grid gap-2">
        {visibleClosureQueue.length === 0 ? <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-4 text-center text-sm font-semibold text-slate-600">No hay rutas con este estado.</p> : visibleClosureQueue.map(item => {
          const status = closureQueueStatuses[item.stage]
          const StatusIcon = status.Icon
          const declarationAt = item.closure?.returnDeclaredAt
          const warehouseAt = item.closure?.warehouseClosedAt
          const closedAt = item.closure?.closedAt
          const itemDispatch = item.dispatch
          const active = Boolean(itemDispatch && itemDispatch.id === dispatch?.id)
          return (
            <article key={item.closure?.id || itemDispatch?.id} className={`min-w-0 rounded-2xl border p-3 ${status.className} ${active ? 'ring-2 ring-[var(--primary)] ring-offset-1' : ''}`}>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="break-words text-sm">{item.closure?.distributorName || itemDispatch?.distributorName || 'Distribuidor'}</strong>
                    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10px] font-black uppercase ${status.badgeClassName}`}><StatusIcon size={12} />{status.label}</span>
                  </div>
                  <p className="mt-0.5 break-words text-xs font-semibold">Ruta: {item.closure?.routeName || itemDispatch?.routeName || 'Ruta registrada'}</p>
                  <p className="mt-2 break-words text-sm font-extrabold leading-relaxed">{status.message(item)}</p>
                  {item.reviewStartedHere && <span className="mt-2 inline-flex rounded-full bg-sky-100 px-2.5 py-1 text-[10px] font-black uppercase text-sky-900"><ClipboardCheck size={12} className="mr-1" />En revisión aquí · {item.reviewedProductCount}/{item.totalProductCount}</span>}
                  {item.hasPhysicalDifferences && <span className="mt-2 mr-1 inline-flex rounded-full bg-orange-100 px-2.5 py-1 text-[10px] font-black uppercase text-orange-900"><AlertTriangle size={12} className="mr-1" />Diferencias físicas</span>}
                  {item.hasCashDifference && <span className="mt-2 mr-1 inline-flex rounded-full bg-rose-100 px-2.5 py-1 text-[10px] font-black uppercase text-rose-900"><AlertTriangle size={12} className="mr-1" />Diferencia de caja</span>}
                  {item.hasMerma && <span className="mt-2 mr-1 inline-flex rounded-full bg-violet-100 px-2.5 py-1 text-[10px] font-black uppercase text-violet-900">Merma registrada</span>}
                  {item.isReopened && <span className="mt-2 mr-1 inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black uppercase text-amber-900">Reabierto</span>}
                </div>
                <div className="shrink-0 text-left text-[11px] font-semibold sm:text-right">
                  {item.closure?.dayKey && <span className="block">Jornada: {formatDayKey(item.closure.dayKey)}</span>}
                  {declarationAt ? <span className="block">Declarado: {new Date(declarationAt).toLocaleString('es-BO', { timeZone: 'America/La_Paz' })}</span> : item.stage === 'undeclared' && <span className="block">Sin declaración registrada</span>}
                  {warehouseAt && <span className="mt-0.5 block">Almacén confirmó: {new Date(warehouseAt).toLocaleString('es-BO', { timeZone: 'America/La_Paz' })}</span>}
                  {closedAt && <span className="mt-0.5 block">Cierre: {new Date(closedAt).toLocaleString('es-BO', { timeZone: 'America/La_Paz' })}</span>}
                  {itemDispatch && <button type="button" onClick={() => setSelectedDispatchId(itemDispatch.id)} aria-current={active ? 'true' : undefined} className="mt-2 min-h-10 rounded-xl border border-current/20 bg-white/70 px-3 text-xs font-bold text-[var(--primary)] hover:bg-white">{active ? 'Ruta seleccionada' : 'Abrir recepción'}</button>}
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </SectionCard>
  )

  const reopenHistoryModal = (
    <Modal
      isOpen={Boolean(reopenHistoryTarget)}
      onClose={() => setReopenHistoryTarget(null)}
      title="Historial de reapertura"
      subtitle={reopenHistoryTarget ? `${reopenHistoryTarget.routeName || 'Ruta registrada'} · ${reopenHistoryTarget.distributorName || 'Distribuidor'}` : undefined}
      size="lg"
    >
      {reopenHistoryTarget && <div className="grid gap-3">
        {closureReopenEvents(reopenHistoryTarget).map((event, index, events) => {
          const closedAgain = events[index + 1]?.previousClosedAt || (index === events.length - 1 ? reopenHistoryTarget.closedAt : undefined)
          return <section key={`${event.reopenedAt || 'reapertura'}-${index}`} className="grid gap-1.5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-slate-800">
            <h3 className="font-black text-amber-950">Reapertura {index + 1}</h3>
            {event.previousClosedAt && <p><strong>Cierre anterior:</strong> {new Date(event.previousClosedAt).toLocaleString('es-BO')}</p>}
            {event.previousWarehouseClosedAt && <p><strong>Recepción de almacén anterior:</strong> {new Date(event.previousWarehouseClosedAt).toLocaleString('es-BO')}</p>}
            {event.previousClosedByName && <p><strong>Cierre anterior realizado por:</strong> {event.previousClosedByName}</p>}
            {event.reopenedAt && <p><strong>Reabierto:</strong> {new Date(event.reopenedAt).toLocaleString('es-BO')}</p>}
            {(event.reopenedByName || event.reopenedBy) && <p><strong>Por:</strong> {event.reopenedByName || event.reopenedBy}</p>}
            <p className="break-words"><strong>Motivo:</strong> {event.reason ? `“${event.reason}”` : 'Sin motivo disponible en este registro.'}</p>
            {closedAgain && <p><strong>Cerrado nuevamente:</strong> {new Date(closedAgain).toLocaleString('es-BO')}</p>}
          </section>
        })}
      </div>}
    </Modal>
  )

  const reopenModal = (
    <Modal
      isOpen={Boolean(reopenTarget)}
      onClose={() => { if (!isReopening) { setReopenTarget(null); setReopenPreserveFinancialSnapshot(false); } }}
      title="Reabrir cierre"
      subtitle={reopenTarget ? `${reopenTarget.routeName} · ${reopenTarget.distributorName}` : ''}
      footer={
        <div className="grid grid-cols-2 gap-2 w-full">
          <SecondaryButton disabled={isReopening} onClick={() => { setReopenTarget(null); setReopenPreserveFinancialSnapshot(false); }}>
            Cancelar
          </SecondaryButton>
          <PrimaryButton
            disabled={isReopening || reopenReason.trim().length < 3}
            onClick={async () => {
              if (!reopenTarget || reopenReason.trim().length < 3) return
              setIsReopening(true)
              setError(null)
              try {
                await reopenClosure(reopenTarget, reopenReason.trim(), reopenPreserveFinancialSnapshot)
                setReopenTarget(null)
                setReopenReason('')
                setReopenPreserveFinancialSnapshot(false)
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
        {reopenTarget?.closureType !== 'admin' && <label className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm leading-relaxed text-blue-950">
          <input
            type="checkbox"
            checked={reopenPreserveFinancialSnapshot}
            onChange={event => setReopenPreserveFinancialSnapshot(event.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-blue-700"
          />
          <span><strong>Corregir solo inventario.</strong> Conservar exactamente los importes de caja de este cierre, sin recalcularlos.</span>
        </label>}
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

  const historyOwnerModal = (
    <ChoiceModal
      isOpen={isHistoryOwnerOpen}
      onClose={() => setIsHistoryOwnerOpen(false)}
      title="Filtrar cierres"
      subtitle="Selecciona una ruta y su distribuidor"
      searchable
      options={[{ value: '', label: 'Todas las rutas / distribuidores' }, ...historyOwners]}
      selectedValue={historyOwnerFilter}
      onSelect={value => { setHistoryOwnerFilter(value); setHistoryVisibleCount(20) }}
    />
  )

  if (closureViewMode === 'history') {
    return (
      <Screen title="Cierre y arqueo de caja" subtitle="Consulta de cierres anteriores">
        {closureNavigationControls}
        {closureHistory}
        {historyOwnerModal}
        {reopenHistoryModal}
        {reopenModal}
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      </Screen>
    )
  }

  if (!dispatch) {
    if (session.role === 'admin' && closureTab === 'admin') {
      return (
        <Screen title="Cierre y arqueo de caja" subtitle="Administración">
          {closureNavigationControls}
          {adminClosureContent}
          {historyOwnerModal}
          {reopenHistoryModal}
          {reopenModal}
          {adminClosureModal}
          {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
        </Screen>
      )
    }

    return (
      <Screen title="Cierre y arqueo de caja" subtitle={session.role === 'warehouse' ? `Almacén · ${data.warehouses.find(item => item.id === (session.warehouseId || 'central'))?.name || 'Central'}` : 'Cierres de ruta'}>
        {closureNavigationControls}
        {closureQueue.length > 0 && closureQueuePanel}
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
        {closureQueue.length === 0 && <EmptyBlock
          title="No hay rutas abiertas"
          description={isDistributor ? 'El arqueo se habilita cuando Almacén registra una carga abierta para tu usuario.' : 'El arqueo se hace sobre un despacho abierto. Registra un despacho primero.'}
        />}
        {historyOwnerModal}
        {reopenHistoryModal}
        {reopenModal}
        {adminClosureModal}
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      </Screen>
    )
  }

  return (
    <Screen title="Cierre y arqueo de caja" subtitle={closureTab === 'admin' ? 'Administración' : `${dispatch.routeName} · ${dispatch.distributorName}`}>
      {closureNavigationControls}
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
        {closureQueue.length > 0 && closureQueuePanel}
        {availableDispatches.length > 1 && (
          <Field label="Ruta a cerrar">
            <ChoiceButton label={`${dispatch.routeName} · ${dispatch.distributorName}`} placeholder="Selecciona despacho" onClick={() => setIsDispatchOpen(true)} />
          </Field>
        )}

        <p className="rounded-2xl bg-amber-50 p-3 text-xs font-semibold leading-relaxed text-amber-900">{isDistributor ? 'Escribe únicamente la cantidad normal que devuelves. Almacén verificará la recepción; después podrás completar el cierre del efectivo.' : 'El distribuidor declara la cantidad normal. Almacén confirma la recepción física y registra por separado la merma recuperable o el producto no apto; después se habilita el cierre final. Confirmar y cerrar requieren conexión.'}</p>
        <SectionCard title="Productos devueltos">
          {!isDistributor && <div className="mb-3 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm font-bold text-indigo-900" role="status">{reviewedReceiptIds.size} de {productRows.length} productos revisados</div>}
          <div className="relative mb-3"><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><TextInput value={productSearch} onChange={event => setProductSearch(event.target.value)} placeholder="Buscar producto sin perder cantidades..." className="pl-9" /></div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {productRows.filter(row => row.productName.toLowerCase().includes(productSearch.trim().toLowerCase())).map((row) => {
              const rowIssue = returnInputIssue?.productId === row.productId ? returnInputIssue : null
              const product = data.products.find(p => p.id === row.productId)
              const presentation = product ? getProductPresentation(product) : ''
              const declaredNormal = existingClosure?.declaredReturns?.[row.productId] ?? existingProductsById.get(row.productId)?.declaredReturnNormal ?? existingProductsById.get(row.productId)?.declaredReturn
              const declaredMerma = existingClosure?.declaredReturnMermas?.[row.productId] ?? existingProductsById.get(row.productId)?.declaredReturnMerma ?? 0
              const declaredTotal = declaredNormal === undefined ? undefined : calculateDeclaredReturnTotal(Number(declaredNormal), Number(declaredMerma || 0))
              const received = parseReturnQuantityInput(returns[row.productId] || '') ?? 0
              const enteredRecoverableMerma = parseReturnQuantityInput(recoverableMermas[row.productId] || '0') ?? 0
              const enteredWaste = parseReturnQuantityInput(wastes[row.productId] || '0') ?? 0
              const breakdown = calculatePhysicalReturnBreakdown(row.expectedReturn, received, enteredRecoverableMerma, enteredWaste)
              const reviewed = reviewedReceiptIds.has(row.productId)
              return (
                <article ref={element => { returnCardRefs.current[row.productId] = element }} key={row.productId} data-return-product={row.productId} className={`w-full min-w-0 rounded-2xl border bg-white p-4 shadow-xs transition-colors ${rowIssue ? 'border-rose-500 ring-2 ring-rose-200' : 'border-slate-200 hover:border-slate-300'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="break-words text-sm font-black leading-snug text-slate-900">{row.productName}</h3>
                      {presentation && <p className="mt-0.5 text-xs font-semibold text-slate-500">{presentation}</p>}
                    </div>
                    {isDeclared(row.productId) ? (isDistributor ? <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-black text-blue-800">DECLARADO</span> : <VarianceBadge variance={row.variance} unitType={row.unitType} />) : <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-black text-slate-500">SIN DECLARAR</span>}
                  </div>

                  {rowIssue && <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800" role="alert">Revisa esta cantidad: {rowIssue.message}</p>}

                  <dl className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3 sm:grid-cols-3">
                    <div><dt className="text-[10px] font-semibold text-slate-500">Despachado</dt><dd className="text-sm font-bold">{formatQty(row.totalLoaded, row.unitType)}</dd></div>
                    <div><dt className="text-[10px] font-semibold text-slate-500">Vendido</dt><dd className="text-sm font-bold">{formatQty(row.sold, row.unitType)}</dd></div>
                    <div><dt className="text-[10px] font-semibold text-slate-500">Cortesía</dt><dd className="text-sm font-bold">{formatQty(row.courtesy || 0, row.unitType)}</dd></div>
                    <div><dt className="text-[10px] font-semibold text-slate-500">Aumentos</dt><dd className="text-sm font-bold">{formatQty(row.additions, row.unitType)}</dd></div>
                    <div><dt className="text-[10px] font-semibold text-slate-500">Debía retornar</dt><dd className="text-sm font-black text-indigo-700">{formatQty(row.expectedReturn, row.unitType)}</dd></div>
                    {Number(row.dispatchMermaSent) > 0 && <div className="col-span-full rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950"><strong>Merma adicional enviada dentro de las bolsas:</strong> {formatQty(row.dispatchMermaSent || 0, row.unitType)}.{row.dispatchMermaReconciliationStatus === 'included_in_sales' ? <> Se estima que {formatQty(row.dispatchMermaIncludedInSales || 0, row.unitType)} salió dentro de ventas; se comprobará con el saldo físico antes de guardar.</> : row.dispatchMermaReconciliationStatus === 'reconciled_with_unfit' ? <> La merma adicional se concilia con lo recibido como no apto y el saldo físico; no se asigna esa parte a ventas.</> : row.dispatchMermaReconciliationStatus === 'returned' ? <> Toda la merma adicional está registrada como retorno físico; se conserva por separado del retorno normal.</> : <> La diferencia aún no coincide con ventas y retorno normal; no se asigna automáticamente a ventas.</>}</div>}
                  </dl>

                  {isDistributor ? <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3">
                    <h4 className="text-xs font-black uppercase tracking-wide text-blue-900">Declaración del distribuidor</h4>
                    <div className="mt-2 grid gap-2">
                      <Field label="CANTIDAD QUE DEVUELVES" hint="Escribe únicamente la cantidad normal que devuelves. Almacén verificará físicamente la recepción.">
                        <TextInput type="text" inputMode={row.unitType === 'kg' ? 'decimal' : 'numeric'} data-return-field="normal" aria-invalid={Boolean(rowIssue?.field === 'normal')} value={returns[row.productId] ?? ''} disabled={returnsAlreadyApplied || Boolean(existingClosure?.returnDeclaredAt)} placeholder="Escribe la cantidad" onChange={event => { setReturns(current => ({ ...current, [row.productId]: event.target.value })); if (rowIssue?.field === 'normal') setReturnInputIssue(null) }} />
                      </Field>
                      {rowIssue?.field === 'normal' && <p className="mt-1 text-xs font-semibold text-rose-700">{rowIssue.message}</p>}
                      <div className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-extrabold text-blue-950">CANTIDAD NORMAL DECLARADA: {formatQty(parseReturnQuantityInput(returns[row.productId] || '') ?? 0, row.unitType)}</div>
                      <div className="flex gap-1 pb-0.5">
                        <button type="button" disabled={Boolean(existingClosure?.returnDeclaredAt)} onClick={() => setReturns(current => ({ ...current, [row.productId]: '0' }))} className="min-h-10 rounded-lg border border-blue-200 bg-white px-3 text-xs font-bold text-blue-900 disabled:opacity-40">0</button>
                        <button type="button" disabled={Boolean(existingClosure?.returnDeclaredAt)} onClick={() => setReturns(current => ({ ...current, [row.productId]: String(row.expectedReturn) }))} className="min-h-10 rounded-lg border border-blue-200 bg-white px-3 text-xs font-bold text-blue-900 disabled:opacity-40">Todo</button>
                      </div>
                    </div>
                  </div> : <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div><p className="text-xs font-bold text-slate-600">Debía retornar</p><p className="text-lg font-black text-indigo-800">{formatQty(row.expectedReturn, row.unitType)}</p></div>
                      <div className="flex flex-wrap items-center gap-2">{reviewed ? <><span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black text-emerald-800">REVISADO</span><VarianceBadge variance={row.variance} unitType={row.unitType} /></> : <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black text-amber-900">PENDIENTE DE RECIBIR</span>}</div>
                    </div>
                    <p className="mt-2 text-xs text-slate-600">Declarado por distribuidor: <strong>{declaredNormal === undefined ? 'Sin registro' : isDistributor ? formatQty(Number(declaredTotal), row.unitType) : existingClosure?.returnDeclarationMode === 'normal_only' ? `${formatQty(Number(declaredNormal), row.unitType)} normal` : `Normal ${formatQty(Number(declaredNormal), row.unitType)} + merma ${formatQty(Number(declaredMerma), row.unitType)} = ${formatQty(Number(declaredTotal), row.unitType)}`}</strong></p>
                    {declaredTotal !== undefined && reviewed && <p className="mt-1 text-xs font-semibold text-indigo-800">{existingClosure?.returnDeclarationMode === 'normal_only' ? 'Diferencia entre normal declarado y recibido' : 'Diferencia contra declaración'}: {formatQty(calculateReturnDeclarationDifference(existingClosure?.returnDeclarationMode === 'normal_only' ? Number(declaredNormal) : declaredTotal, existingClosure?.returnDeclarationMode === 'normal_only' ? breakdown.normalReturn : breakdown.totalReceived), row.unitType)}</p>}
                    {reviewed && <p className="mt-1 text-xs text-slate-700">{session.role !== 'distributor' && existingClosure?.returnDeclarationMode === 'normal_only' ? `Normal recibido ${formatQty(breakdown.normalReturn, row.unitType)} · Merma recuperable registrada por Almacén: ${formatQty(breakdown.recoverableMerma, row.unitType)} · ` : ''}Total físico recibido {formatQty(breakdown.totalReceived, row.unitType)}{session.role !== 'distributor' ? ` · vuelve al stock ${formatQty(breakdown.sellableFromDispatch, row.unitType)}${enteredWaste > 0 ? ` · no apto ${formatQty(enteredWaste, row.unitType)}` : ''}` : ''}</p>}
                    <div className="mt-3"><PrimaryButton full disabled={returnsAlreadyApplied} onClick={() => openReceiptEditor(row.productId)}>{reviewed ? 'Editar recepción' : 'Registrar recepción'}</PrimaryButton></div>
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
            <KpiCard label="Egresos en efectivo" value={formatBs(money.cashExpenses)} tone="danger" />
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
                disabled={(!canCloseMoney && !isDistributor) || (isDistributor && Boolean(existingClosure?.returnDeclaredAt)) || preservingHistoricalMoney}
                onChange={(event) => setDeclaredCash(event.target.value)}
              />
            </Field>
          </div>
          {preservingHistoricalMoney && <p className="mt-2 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs font-semibold leading-relaxed text-blue-900">Este cierre se reabrió para corregir la recepción del producto. Los importes de caja anteriores se conservarán sin recalcularlos.</p>}

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
              disabled={isSubmitting || !loaded || returnsAlreadyApplied || (!isDistributor && reviewedReceiptIds.size !== productRows.length)}
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
        {canCloseMoney && existingClosure?.status !== 'closed' && <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700" role="status">
          {!existingClosure?.returnDeclaredAt
            ? 'Paso 1 de 3: declara el retorno. Después, Almacén debe confirmar la recepción física.'
            : !returnsAlreadyApplied
              ? 'Paso 2 de 3: retorno declarado; pendiente de confirmación de Almacén. El cierre de ruta se habilitará después.'
              : 'Paso 3 de 3: recepción confirmada. Ya puedes revisar y completar el cierre monetario.'}
        </p>}

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-bold text-slate-500">
              <ClipboardCheck size={13} className="mr-1 inline" />
              Estado del cierre: {existingClosure ? CLOSURE_STATUS[existingClosure.status] || 'Pendiente' : 'Devolución pendiente de declarar'}
            </p>
            {existingClosure?.status === 'closed' && session.can('dist.reports.view') && (
              <SecondaryButton onClick={() => { setReopenTarget(existingClosure); setReopenReason(''); setReopenPreserveFinancialSnapshot(false); }}>
                <Unlock size={15} /> Reabrir (administracion)
              </SecondaryButton>
            )}
          </div>
      </div>
      )}
      {historyOwnerModal}
      {reopenHistoryModal}
      <ChoiceModal
        isOpen={isDispatchOpen}
        onClose={() => setIsDispatchOpen(false)}
        title="Ruta a cerrar"
        subtitle="Selecciona un despacho abierto"
        searchable
        options={availableDispatches.map(item => ({ value: item.id, label: item.routeName, description: `${item.distributorName} · ${new Date(item.createdAt).toLocaleString('es-BO')}` }))}
        selectedValue={dispatch?.id ?? ''}
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
                    <span className="text-right font-bold text-slate-900 tabular-nums">{formatQty(parsedReturns[row.productId] || 0, row.unitType)} normal</span>
                  </div>
                ))}
                {productRows.every(r => !(parsedReturns[r.productId] || 0)) && (
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
      <Modal
        isOpen={confirmingWarehouseReception}
        onClose={() => setConfirmingWarehouseReception(false)}
        title="Confirmar recepción física"
        subtitle={dispatch ? `${dispatch.routeName} · ${dispatch.distributorName}` : ''}
        size="lg"
        footer={<div className="grid w-full grid-cols-2 gap-2"><SecondaryButton disabled={isSubmitting} onClick={() => setConfirmingWarehouseReception(false)}>Volver a revisar</SecondaryButton><PrimaryButton disabled={isSubmitting} onClick={() => void submit('warehouse_done', true)}>{isSubmitting ? 'Guardando…' : 'Confirmar recepción'}</PrimaryButton></div>}
      >
        <div className="grid gap-3"><p className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm font-semibold text-indigo-950">Verifica las cantidades físicas antes de guardar. La merma adicional enviada dentro de las bolsas no es pérdida real del almacén.</p>{productRows.map(row => <article key={row.productId} className="grid gap-1 rounded-xl border border-slate-200 bg-white p-3 text-sm"><strong className="break-words">{row.productName}</strong><p>Retorno normal: <b>{formatQty(parsedReturns[row.productId] || 0, row.unitType)}</b></p><p>Merma recuperable recibida: <b>{formatQty(parsedRecoverableMermas[row.productId] || 0, row.unitType)}</b></p>{(parsedWastes[row.productId] || 0) > 0 && <p className="text-rose-800">Pérdida real / no apto: <b>{formatQty(parsedWastes[row.productId], row.unitType)}</b> · {wasteReasons[row.productId]}</p>}<p className="font-black text-emerald-800">Total recibido físicamente: {formatQty((parsedReturns[row.productId] || 0) + (parsedRecoverableMermas[row.productId] || 0) + (parsedWastes[row.productId] || 0), row.unitType)}</p>{Number(row.dispatchMermaSent) > 0 && <p className="text-xs text-amber-900">Merma adicional enviada dentro de las bolsas: {formatQty(row.dispatchMermaSent || 0, row.unitType)} · {row.dispatchMermaReconciliationStatus === 'included_in_sales' ? `estimada dentro de ventas: ${formatQty(row.dispatchMermaIncludedInSales || 0, row.unitType)}; el servidor comprobará el saldo.` : row.dispatchMermaReconciliationStatus === 'reconciled_with_unfit' ? 'conciliada con el no apto recibido y el saldo físico.' : row.dispatchMermaReconciliationStatus === 'returned' ? 'recibida completamente.' : 'diferencia pendiente de revisar; no se asigna a ventas automáticamente.'}</p>}<p className="text-xs text-slate-600">Diferencia física: faltante {formatQty(row.shortage || 0, row.unitType)} · sobrante {formatQty(row.overage || 0, row.unitType)}</p></article>)}</div>
      </Modal>
      <Modal
        isOpen={Boolean(receiptModalRow)}
        onClose={() => setReceiptModalProductId(null)}
        title="Registrar recepción"
        subtitle={receiptModalRow?.productName}
        size="lg"
        footer={(
          <div className="grid w-full grid-cols-2 gap-2">
            <SecondaryButton onClick={() => setReceiptModalProductId(null)}>Cancelar</SecondaryButton>
            <PrimaryButton onClick={saveReceiptEditor}>Guardar recepción</PrimaryButton>
          </div>
        )}
      >
        {receiptModalRow && receiptModalBreakdown && (
          <div className="grid min-w-0 gap-4">
            <div className="grid grid-cols-2 gap-3 rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
              <div><p className="text-xs font-bold text-indigo-800">Debía retornar</p><p className="mt-1 text-xl font-black text-indigo-950">{formatQty(receiptModalRow.expectedReturn, receiptModalRow.unitType)}</p></div>
              <div><p className="text-xs font-bold text-indigo-800">Declaración del distribuidor</p>{receiptModalRow.declaredReturnNormal === undefined ? <p className="mt-1 break-words text-xl font-black text-indigo-950">Sin registro</p> : <div className="mt-1 break-words text-sm font-bold text-indigo-950">{existingClosure?.returnDeclarationMode === 'normal_only' ? <p className="text-lg font-black">{formatQty(Number(receiptModalRow.declaredReturnNormal), receiptModalRow.unitType)} normal</p> : <><p>Normal: {formatQty(Number(receiptModalRow.declaredReturnNormal), receiptModalRow.unitType)}</p><p>Merma: {formatQty(Number(receiptModalRow.declaredReturnMerma || 0), receiptModalRow.unitType)}</p><p className="text-lg font-black">Total declarado: {formatQty(Number(receiptModalRow.declaredReturn), receiptModalRow.unitType)}</p></>}</div>}</div>
            </div>

            {Number(receiptModalRow.dispatchMermaSent) > 0 && <p className={`rounded-xl border p-3 text-sm ${receiptModalRow.dispatchMermaReconciliationStatus === 'included_in_sales' || receiptModalRow.dispatchMermaReconciliationStatus === 'returned' || receiptModalRow.dispatchMermaReconciliationStatus === 'reconciled_with_unfit' ? 'border-emerald-200 bg-emerald-50 text-emerald-950' : 'border-amber-200 bg-amber-50 text-amber-950'}`}><strong>Merma adicional enviada dentro de las bolsas:</strong> {formatQty(receiptModalRow.dispatchMermaSent || 0, receiptModalRow.unitType)}. {receiptModalRow.dispatchMermaReconciliationStatus === 'included_in_sales' ? <>La revisión estima que {formatQty(receiptModalRow.dispatchMermaIncludedInSales || 0, receiptModalRow.unitType)} salió dentro de ventas. Al guardar, el servidor volverá a verificar el saldo real.</> : receiptModalRow.dispatchMermaReconciliationStatus === 'reconciled_with_unfit' ? <>El saldo concilia después de contar {formatQty(parsedWastes[receiptModalRow.productId] || 0, receiptModalRow.unitType)} como producto no apto. El servidor comprobará el saldo real antes de guardar.</> : receiptModalRow.dispatchMermaReconciliationStatus === 'returned' ? <>La merma adicional fue recibida completamente en el retorno.</> : <>Aún no se puede conciliar con las ventas y el retorno normal. No la asignaremos a ventas; revisa la diferencia física antes de confirmar.</>}</p>}

            <div className="grid min-w-0 gap-4">
              <div>
                <Field label="Retorno normal" hint="Producto que vuelve normalmente al stock.">
                  <TextInput type="text" inputMode={receiptModalRow.unitType === 'kg' ? 'decimal' : 'numeric'} value={receiptModalDraft.normal} placeholder="Cantidad recibida" onChange={event => setReceiptModalDraft(current => ({ ...current, normal: event.target.value }))} />
                </Field>
                {receiptModalRow.declaredReturnNormal !== undefined && <div className="mt-2"><SecondaryButton full onClick={() => setReceiptModalDraft(current => ({ ...current, normal: String(receiptModalRow.declaredReturnNormal) }))}>Usar cantidad declarada</SecondaryButton></div>}
              </div>
              <Field label="Merma de retorno" hint="También vuelve al stock; se registra aparte para control.">
                <TextInput type="text" inputMode={receiptModalRow.unitType === 'kg' ? 'decimal' : 'numeric'} value={receiptModalDraft.merma} placeholder="0" onChange={event => setReceiptModalDraft(current => ({ ...current, merma: event.target.value }))} />
              </Field>
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
                <Field label="Producto no apto / pérdida" hint="Solo si realmente no puede volver a venderse.">
                  <TextInput type="text" inputMode={receiptModalRow.unitType === 'kg' ? 'decimal' : 'numeric'} value={receiptModalDraft.waste} placeholder="0" onChange={event => setReceiptModalDraft(current => ({ ...current, waste: event.target.value }))} />
                </Field>
                {receiptModalWaste > 0 && <div className="mt-3"><Field label="Motivo" required><TextInput value={receiptModalDraft.reason} placeholder="Describe por qué no se puede vender" onChange={event => setReceiptModalDraft(current => ({ ...current, reason: event.target.value }))} /></Field></div>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:grid-cols-3">
              <div><p className="text-xs font-semibold text-slate-600">Total recibido</p><p className="text-lg font-black text-slate-900">{formatQty(receiptModalBreakdown.totalReceived, receiptModalRow.unitType)}</p></div>
              <div><p className="text-xs font-semibold text-slate-600">Vuelve al stock</p><p className="text-lg font-black text-emerald-800">{formatQty(receiptModalBreakdown.sellableFromDispatch, receiptModalRow.unitType)}</p></div>
              <div><p className="text-xs font-semibold text-slate-600">Merma registrada</p><p className="text-lg font-black text-emerald-800">{formatQty(receiptModalMerma, receiptModalRow.unitType)}</p></div>
              <div><p className="text-xs font-semibold text-slate-600">Producto perdido</p><p className="text-lg font-black text-rose-700">{formatQty(receiptModalWaste, receiptModalRow.unitType)}</p></div>
              <div><p className="text-xs font-semibold text-slate-600">Faltante</p><p className="text-lg font-black text-amber-800">{formatQty(receiptModalBreakdown.shortage, receiptModalRow.unitType)}</p></div>
              <div><p className="text-xs font-semibold text-slate-600">Sobrante</p><p className="text-lg font-black text-amber-800">{formatQty(receiptModalBreakdown.overage, receiptModalRow.unitType)}</p></div>
            </div>
            {receiptModalBreakdown.sellableOverage > 0 && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">El excedente vendible quedará separado hasta revisar su origen.</p>}
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
