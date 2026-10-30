import type {
  DistClosureProductRow,
  DistCollection,
  DistClaim,
  DistDispatch,
  DistExpense,
  DistLotAllocation,
  DistProduct,
  DistSale,
  DistSaleLine,
  PaymentKind,
  UnitType,
} from '../types'
import { expenseCashPaidAmount } from './expenseAccounting.ts'

/** Redondeo monetario/cantidad a 2 decimales para evitar ruido de punto flotante */
export function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100
}

export function toDayKey(value: string | number | Date = new Date()): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function centralBalanceId(productId: string): string {
  return `central__${productId}`
}

/** Identificador canónico de Administración */
export const ADMIN_CANONICAL_ROUTE_ID = 'administracion'
/** Identificador canónico de Impulsación */
export const IMPULSACION_ROUTE_ID = 'route-impulsacion'

/**
 * Determina si el routeId de un documento coincide con el filtro de ruta seleccionado,
 * con soporte bidireccional y compatibilidad hacia atrás para 'admin' y 'administracion',
 * y para 'route-impulsacion' y el legacy 'route-directa'.
 */
export function matchesRoute(recordRouteId?: string | null, filterRouteId?: string | null): boolean {
  if (!filterRouteId) return true
  const cleanFilter = filterRouteId.trim()
  const cleanRecord = (recordRouteId ?? '').trim()
  if (cleanFilter === 'administracion' || cleanFilter === 'admin') {
    return cleanRecord === 'administracion' || cleanRecord === 'admin'
  }
  if (cleanFilter === 'route-impulsacion' || cleanFilter === 'route-directa') {
    return cleanRecord === 'route-impulsacion' || cleanRecord === 'route-directa'
  }
  return cleanRecord === cleanFilter
}

/** A central-warehouse sale never belongs to a dispatch cash close, even if
 * stale client state accidentally attached that dispatchId to the sale. */
export function isSaleForDispatch(
  sale: { routeId?: string | null; sourceLocation?: string | null },
  dispatchRouteId: string,
): boolean {
  return (!sale.routeId || sale.routeId === dispatchRouteId) && sale.sourceLocation !== 'centralWarehouse'
}

/** Scope the same-dispatch legacy sales accepted by the closure backend. */
export function isSaleForDispatchSettlement(
  sale: { dispatchId?: string; routeId?: string | null; sourceLocation?: string | null; createdAt: string },
  dispatchId: string,
  dispatchRouteId: string,
  dispatchCreatedAt: string,
  competingDispatches?: Array<{ id: string; routeId: string; createdAt: string; status: 'open' | 'closed'; closedAt?: string; operationalIntervals?: Array<{ openedAt: string; closedAt?: string }>; reopenHistory?: Array<{ reopenedAt: string; previousClosedAt?: string }> }>,
): boolean {
  if (!isSaleForDispatch(sale, dispatchRouteId)) return false
  if (sale.dispatchId) return sale.dispatchId === dispatchId
  if (sale.routeId !== dispatchRouteId || !Number.isFinite(Date.parse(sale.createdAt))) return false
  if (Number.isFinite(Date.parse(dispatchCreatedAt)) && Date.parse(sale.createdAt) < Date.parse(dispatchCreatedAt)) return false
  if (!competingDispatches) return true
  const possible = getPossibleDispatchIdsForLegacySale(sale, dispatchRouteId, competingDispatches)
  return possible.length === 1 && possible[0] === dispatchId
}

export function getPossibleDispatchIdsForLegacySale(
  sale: { routeId?: string | null; sourceLocation?: string | null; createdAt?: string },
  dispatchRouteId: string,
  competingDispatches: Array<{ id: string; routeId: string; createdAt: string; status: 'open' | 'closed'; closedAt?: string; operationalIntervals?: Array<{ openedAt: string; closedAt?: string }>; reopenHistory?: Array<{ reopenedAt: string; previousClosedAt?: string }> }>,
): string[] {
  if (!isSaleForDispatch(sale, dispatchRouteId) || sale.routeId !== dispatchRouteId) return []
  if (!sale.createdAt || !Number.isFinite(Date.parse(sale.createdAt))) {
    return competingDispatches.filter(dispatch => dispatch.routeId === dispatchRouteId).map(dispatch => dispatch.id)
  }
  const saleAt = Date.parse(sale.createdAt)
  return competingDispatches.filter(dispatch => dispatch.routeId === dispatchRouteId && dispatchMayContainSaleAt(dispatch, saleAt)).map(dispatch => dispatch.id)
}

export function partitionDispatchSettlementSales<T extends { id: string; dispatchId?: string; routeId?: string | null; sourceLocation?: string | null; createdAt?: string; voidedAt?: string; pendingConfirmation?: boolean }>(
  sales: T[],
  dispatchId: string,
  dispatchRouteId: string,
  dispatchCandidates: Array<{ id: string; routeId: string; createdAt: string; status: 'open' | 'closed'; closedAt?: string; operationalIntervals?: Array<{ openedAt: string; closedAt?: string }>; reopenHistory?: Array<{ reopenedAt: string; previousClosedAt?: string }> }>,
): { attributable: T[]; ambiguous: T[]; excluded: T[] } {
  const attributable: T[] = []
  const ambiguous: T[] = []
  const excluded: T[] = []
  for (const sale of sales) {
    if (!isSaleForDispatch(sale, dispatchRouteId)) { excluded.push(sale); continue }
    if (sale.dispatchId) {
      if (sale.dispatchId === dispatchId && !sale.voidedAt && !sale.pendingConfirmation) attributable.push(sale)
      else excluded.push(sale)
      continue
    }
    if (sale.routeId !== dispatchRouteId) { excluded.push(sale); continue }
    if (sale.voidedAt || sale.pendingConfirmation) { excluded.push(sale); continue }
    // The backend conservatively rejects effective legacy sales without a
    // trustworthy timestamp, even when only one dispatch is currently known.
    // Keep the UI warning in lockstep; a missing date cannot prove attribution.
    if (!sale.createdAt || !Number.isFinite(Date.parse(sale.createdAt))) { ambiguous.push(sale); continue }
    const possible = getPossibleDispatchIdsForLegacySale(sale, dispatchRouteId, dispatchCandidates)
    if (possible.length === 1 && possible[0] === dispatchId) attributable.push(sale)
    else if (possible.includes(dispatchId) && (possible.length > 1 || !sale.createdAt || !Number.isFinite(Date.parse(sale.createdAt)))) ambiguous.push(sale)
    else excluded.push(sale)
  }
  return { attributable, ambiguous, excluded }
}

function dispatchMayContainSaleAt(
  dispatch: { createdAt: string; status: 'open' | 'closed'; closedAt?: string; operationalIntervals?: Array<{ openedAt: string; closedAt?: string }>; reopenHistory?: Array<{ reopenedAt: string; previousClosedAt?: string }> },
  saleAt: number,
): boolean {
  const createdAt = Date.parse(dispatch.createdAt || '')
  if (Array.isArray(dispatch.operationalIntervals) && dispatch.operationalIntervals.length) {
    return dispatch.operationalIntervals.some(interval => {
      const openedAt = Date.parse(interval.openedAt || '')
      const closedAt = Date.parse(interval.closedAt || '')
      return Number.isFinite(openedAt) && openedAt <= saleAt && (!interval.closedAt || !Number.isFinite(closedAt) || saleAt <= closedAt)
    }) || (dispatch.status === 'open' && Number.isFinite(createdAt) && saleAt >= createdAt
      && saleAt >= Date.parse(dispatch.operationalIntervals.at(-1)?.openedAt || dispatch.createdAt))
  }

  const history = dispatch.reopenHistory || []
  if (history.length) {
    if (!Number.isFinite(createdAt)) return true
    const firstClose = Date.parse(history[0].previousClosedAt || '')
    if (!Number.isFinite(firstClose)) return saleAt >= createdAt
    if (saleAt >= createdAt && saleAt <= firstClose) return true
    for (let index = 0; index < history.length; index++) {
      const openedAt = Date.parse(history[index].reopenedAt || '')
      const nextClose = history[index + 1]?.previousClosedAt
      const closedAt = nextClose ? Date.parse(nextClose) : dispatch.status === 'closed' ? Date.parse(dispatch.closedAt || '') : Number.POSITIVE_INFINITY
      if (Number.isFinite(openedAt) && openedAt <= saleAt && (!Number.isFinite(closedAt) || saleAt <= closedAt)) return true
    }
    return false
  }

  if (!Number.isFinite(createdAt)) return true
  if (saleAt < createdAt) return false
  if (dispatch.status === 'open') return true
  if (!dispatch.closedAt) return true // Legacy closed dispatch without an end time remains conservatively ambiguous.
  const closedAt = Date.parse(dispatch.closedAt)
  return !Number.isFinite(closedAt) || saleAt <= closedAt
}

/**
 * Obtiene el nombre canónico de una ruta para UI / etiquetas.
 */
export function getCanonicalRouteName(routeId?: string | null, routeNameFallback?: string): string {
  if (!routeId) return routeNameFallback || ''
  if (routeId === 'administracion' || routeId === 'admin') return 'Administración'
  if (routeId === 'route-impulsacion' || routeId === 'route-directa') return 'Impulsación'
  return routeNameFallback || routeId
}

export function routeBalanceId(routeId: string, productId: string): string {
  return `route__${routeId}__${productId}`
}

export function formatQuantity(quantity: number, unitType: UnitType): string {
  const value = round2(quantity)
  if (unitType === 'kg') return `${value} kg`
  if (unitType === 'package') return `${value} paq`
  return `${value} u`
}

export type VarianceKind = 'FALTANTE' | 'SOBRANTE' | 'CUADRADO'

export interface VarianceLabel {
  kind: VarianceKind
  /** Magnitud absoluta, siempre positiva: nunca mostramos signos ambiguos */
  amount: number
}

export function describeVariance(variance: number): VarianceLabel {
  const value = round2(variance)
  if (value < 0) return { kind: 'FALTANTE', amount: Math.abs(value) }
  if (value > 0) return { kind: 'SOBRANTE', amount: value }
  return { kind: 'CUADRADO', amount: 0 }
}

export interface LoadedTotals {
  initialDispatch: number
  additions: number
  dispatchMerma: number
  totalLoaded: number
  productName: string
  unitType: UnitType
}

/** totalLoaded = carga inicial + aumentos, por producto */
export function computeLoadedByProduct(dispatch: DistDispatch | null): Map<string, LoadedTotals> {
  const result = new Map<string, LoadedTotals>()
  if (!dispatch) return result

  for (const line of dispatch.lines || []) {
    const current = result.get(line.productId)
    result.set(line.productId, {
      productName: line.productName,
      unitType: line.unitType,
      initialDispatch: round2((current?.initialDispatch ?? 0) + line.quantity),
      additions: current?.additions ?? 0,
      dispatchMerma: round2((current?.dispatchMerma ?? 0) + (line.dispatchMerma || 0)),
      totalLoaded: round2((current?.totalLoaded ?? 0) + line.quantity),
    })
  }

  for (const addition of dispatch.additions || []) {
    if (addition.voided) continue
    for (const line of addition.quantityByProduct || []) {
      const current = result.get(line.productId)
      result.set(line.productId, {
        productName: line.productName,
        unitType: line.unitType,
        initialDispatch: current?.initialDispatch ?? 0,
        additions: round2((current?.additions ?? 0) + line.quantity),
        dispatchMerma: round2((current?.dispatchMerma ?? 0) + (line.dispatchMerma || 0)),
        totalLoaded: round2((current?.totalLoaded ?? 0) + line.quantity),
      })
    }
  }

  return result
}

export interface SoldTotals {
  productName: string
  unitType: UnitType
  quantity: number
  courtesyQuantity: number
  amount: number
}

export function computeSoldByProduct(sales: DistSale[]): Map<string, SoldTotals> {
  const result = new Map<string, SoldTotals>()
  for (const sale of sales) {
    for (const line of sale.lines || []) {
      const current = result.get(line.productId)
      result.set(line.productId, {
        productName: line.productNameSnapshot,
        unitType: line.unitType,
        quantity: round2((current?.quantity ?? 0) + (sale.saleKind === 'courtesy' ? 0 : line.quantity)),
        courtesyQuantity: round2((current?.courtesyQuantity ?? 0) + (sale.saleKind === 'courtesy' ? line.quantity : 0)),
        amount: round2((current?.amount ?? 0) + (sale.saleKind === 'courtesy' ? 0 : line.subtotal)),
      })
    }
  }
  return result
}

/**
 * Conciliacion fisica por producto.
 * expectedReturn = totalLoaded - sold - courtesy ; la cortesía es salida física,
 * pero nunca una venta. Merma y faltante se resuelven durante recepción.
 */
export function buildReconciliation(
  dispatch: DistDispatch | null,
  sales: DistSale[],
  actualReturns: Record<string, number> = {},
): DistClosureProductRow[] {
  const loaded = computeLoadedByProduct(dispatch)
  const sold = computeSoldByProduct(sales)

  const productIds = new Set<string>([...loaded.keys(), ...sold.keys()])

  return Array.from(productIds)
    .map((productId) => {
      const load = loaded.get(productId)
      const sale = sold.get(productId)
      const totalLoaded = load?.totalLoaded ?? 0
      const soldQty = sale?.quantity ?? 0
      const courtesyQty = sale?.courtesyQuantity ?? 0
      const expectedReturn = round2(totalLoaded - soldQty - courtesyQty)
      const actualReturn = round2(Number(actualReturns[productId]) || 0)

      return {
        productId,
        productName: load?.productName ?? sale?.productName ?? productId,
        unitType: load?.unitType ?? sale?.unitType ?? ('unit' as UnitType),
        initialDispatch: load?.initialDispatch ?? 0,
        additions: load?.additions ?? 0,
        totalLoaded,
        sold: soldQty,
        courtesy: courtesyQty,
        expectedReturn,
        actualReturn,
        variance: round2(actualReturn - expectedReturn),
      }
    })
    .sort((a, b) => a.productName.localeCompare(b.productName))
}

export interface MoneySummary {
  salesTotal: number
  cashSales: number
  qrSales: number
  creditGenerated: number
  cashCollections: number
  qrCollections: number
  collectionsTotal: number
  cashExpenses: number
  expectedCash: number
}

/**
 * Dinero del arqueo.
 * expectedCash = ventas en efectivo + cobros en efectivo - gastos en efectivo.
 * QR y credito NO entran al efectivo fisico. Los cobros NO suman a salesTotal.
 */
export function computeMoneySummary(
  sales: DistSale[],
  collections: DistCollection[],
  expenses: DistExpense[],
): MoneySummary {
  let cashSales = 0
  let qrSales = 0
  let creditGenerated = 0
  let salesTotal = 0

  for (const sale of sales) {
    if (sale.saleKind === 'courtesy' || sale.voidedAt || sale.pendingConfirmation) continue
    cashSales += Number(sale.cashAmount) || 0
    qrSales += Number(sale.qrAmount) || 0
    creditGenerated += Number(sale.creditAmount) || 0
    salesTotal += Number(sale.total) || 0
  }

  let cashCollections = 0
  let qrCollections = 0
  for (const collection of collections) {
    const cash = collection.cashAmount ?? (collection.method === 'cash' ? collection.amount : 0)
    const qr = collection.qrAmount ?? (collection.method === 'qr' ? collection.amount : 0)
    cashCollections += Number(cash) || 0
    qrCollections += Number(qr) || 0
  }

  const cashExpenses = expenses.filter((expense) => !expense.voided).reduce((sum, expense) =>
    sum + expenseCashPaidAmount(expense), 0)

  return {
    salesTotal: round2(salesTotal),
    cashSales: round2(cashSales),
    qrSales: round2(qrSales),
    creditGenerated: round2(creditGenerated),
    cashCollections: round2(cashCollections),
    qrCollections: round2(qrCollections),
    collectionsTotal: round2(cashCollections + qrCollections),
    cashExpenses: round2(cashExpenses),
    expectedCash: round2(cashSales + cashCollections - cashExpenses),
  }
}

export interface SalePaymentSplit {
  cashAmount: number
  qrAmount: number
  creditAmount: number
}

export function computeSaleTotal(lines: DistSaleLine[]): number {
  return round2(lines.reduce((sum, line) => sum + (Number(line.subtotal) || 0), 0))
}

/** Reparte el total segun la forma de pago. Para 'mixed' respeta los montos dados. */
export function splitPayment(
  total: number,
  paymentKind: PaymentKind,
  mixed?: { cashAmount?: number; qrAmount?: number; creditAmount?: number },
): SalePaymentSplit {
  const amount = round2(total)
  if (paymentKind === 'cash') return { cashAmount: amount, qrAmount: 0, creditAmount: 0 }
  if (paymentKind === 'qr') return { cashAmount: 0, qrAmount: amount, creditAmount: 0 }
  if (paymentKind === 'credit') return { cashAmount: 0, qrAmount: 0, creditAmount: amount }

  const cashAmount = round2(mixed?.cashAmount ?? 0)
  const qrAmount = round2(mixed?.qrAmount ?? 0)
  const creditAmount = round2(mixed?.creditAmount ?? round2(amount - cashAmount - qrAmount))
  return { cashAmount, qrAmount, creditAmount }
}

export function validateSalePayment(total: number, split: SalePaymentSplit): string | null {
  const sum = round2(split.cashAmount + split.qrAmount + split.creditAmount)
  if (sum !== round2(total)) {
    return `El desglose de pago (${sum}) no coincide con el total (${round2(total)}).`
  }
  if (split.cashAmount < 0 || split.qrAmount < 0 || split.creditAmount < 0) {
    return 'Los montos de pago no pueden ser negativos.'
  }
  return null
}

export interface StockCheckLine {
  productId: string
  productName: string
  quantity: number
  unitType: UnitType
}

/** Impide dejar stock negativo. Devuelve el mensaje de error o null. */
export function validateStockAvailability(
  lines: StockCheckLine[],
  available: Map<string, number>,
): string | null {
  const requested = new Map<string, { name: string; qty: number; unitType: UnitType }>()
  for (const line of lines) {
    const current = requested.get(line.productId)
    requested.set(line.productId, {
      name: line.productName,
      qty: round2((current?.qty ?? 0) + line.quantity),
      unitType: line.unitType,
    })
  }

  for (const [productId, entry] of requested) {
    const stock = round2(available.get(productId) ?? 0)
    if (entry.qty > stock) {
      return `Stock insuficiente de ${entry.name}: disponible ${formatQuantity(stock, entry.unitType)}, solicitado ${formatQuantity(entry.qty, entry.unitType)}.`
    }
  }
  return null
}

export function validateCollection(amount: number, outstandingBalance: number): string | null {
  const value = round2(amount)
  if (value <= 0) return 'El monto del cobro debe ser mayor a cero.'
  if (value > round2(outstandingBalance)) {
    return `No se puede cobrar mas que el saldo pendiente (${round2(outstandingBalance)}).`
  }
  return null
}

export function nextReceivableStatus(originalAmount: number, paidAmount: number): 'OPEN' | 'PARTIAL' | 'PAID' {
  const paid = round2(paidAmount)
  if (paid <= 0) return 'OPEN'
  if (paid >= round2(originalAmount)) return 'PAID'
  return 'PARTIAL'
}

/** Kg vendidos: solo suma lineas con unitType 'kg'. Nunca convierte sachets a kilos. */
export function computeSoldKilograms(sales: DistSale[]): number {
  let total = 0
  for (const sale of sales) {
    for (const line of sale.lines || []) {
      if (line.unitType === 'kg') total += Number(line.quantity) || 0
    }
  }
  return round2(total)
}

export function computeSoldPackages(sales: DistSale[]): number {
  let total = 0
  for (const sale of sales) {
    for (const line of sale.lines || []) {
      if (line.unitType !== 'kg') total += Number(line.quantity) || 0
    }
  }
  return round2(total)
}

export interface SellerBreakdown {
  sellerUid: string
  sellerName: string
  routeNames: string[]
  salesCount: number
  salesTotal: number
  cashSales: number
  qrSales: number
  creditGenerated: number
  collected: number
  expenses: number
  kilograms: number
  documentedSachetKilograms: number
  estimatedSachetKilograms: number
  unknownWeightPackages: number
  totalDocumentedKilograms: number
  totalEstimatedKilograms: number
  packages: number
  /** Efectivo que deberia entregar: ventas efectivo + cobros efectivo - gastos */
  expectedCash: number
}

/**
 * Resumen por persona: cuanto vendio cada quien, como cobro y que gasto.
 * Las cobranzas y los gastos se atribuyen a quien los registro, no a la ruta,
 * porque es esa persona la que rinde el dinero.
 */
export function computeSellerBreakdown(
  sales: DistSale[],
  collections: DistCollection[],
  expenses: DistExpense[],
  claims: DistClaim[] = [],
  products: DistProduct[] = [],
): SellerBreakdown[] {
  const map = new Map<string, SellerBreakdown>()
  const productsById = new Map(products.map(product => [product.id, product]))
  const salesById = new Map(sales.map(sale => [sale.id, sale]))
  const returnedBySaleProduct = new Map<string, number>()
  const returnedProcessingWeightBySaleProduct = new Map<string, number>()
  const returnedProcessingWeightUnknown = new Set<string>()
  for (const claim of claims) {
    const key = `${claim.saleId}::${claim.productId}`
    returnedBySaleProduct.set(key, (returnedBySaleProduct.get(key) || 0) + Math.max(0, Number(claim.quantity) || 0))
    const groups = (claim as DistClaim & { returnedProcessingAllocations?: Array<{ allocations?: DistLotAllocation[]; quantity?: number }> }).returnedProcessingAllocations || []
    const returnedAllocations = groups.flatMap(group => group.allocations || []).filter(allocation => allocation.processingAllocation)
    const isDerived = Boolean(salesById.get(claim.saleId)?.lines?.some(line => line.productId === claim.productId && line.allocations?.some(allocation => allocation.processingAllocation)))
    const returnedQuantity = Math.max(0, Number(claim.quantity) || 0)
    const groupsCoverReturn = groups.reduce((sum, group) => sum + Number(group.quantity || 0), 0) === returnedQuantity
    if (isDerived && (!groups.length || !groupsCoverReturn || !returnedAllocations.length
      || !returnedAllocations.every(allocation => Number.isSafeInteger(allocation.processingAllocation?.physicalWeightG)))) {
      returnedProcessingWeightUnknown.add(key)
    } else if (returnedAllocations.length) {
      returnedProcessingWeightBySaleProduct.set(key, (returnedProcessingWeightBySaleProduct.get(key) || 0)
        + returnedAllocations.reduce((sum, allocation) => sum + Number(allocation.processingAllocation?.physicalWeightG), 0))
    }
  }
  const cashExpenseBySeller = new Map<string, number>()

  const ensure = (uid: string, name: string): SellerBreakdown => {
    const key = uid || name || 'sin-asignar'
    const current = map.get(key)
    if (current) return current
    const created: SellerBreakdown = {
      sellerUid: key,
      sellerName: name || 'Sin asignar',
      routeNames: [],
      salesCount: 0,
      salesTotal: 0,
      cashSales: 0,
      qrSales: 0,
      creditGenerated: 0,
      collected: 0,
      expenses: 0,
      kilograms: 0,
      documentedSachetKilograms: 0,
      estimatedSachetKilograms: 0,
      unknownWeightPackages: 0,
      totalDocumentedKilograms: 0,
      totalEstimatedKilograms: 0,
      packages: 0,
      expectedCash: 0,
    }
    map.set(key, created)
    return created
  }

  for (const sale of sales) {
    if (sale.saleKind === 'courtesy' || sale.voidedAt || sale.pendingConfirmation) continue
    const effective = sale.effectiveSnapshot ? { ...sale, ...sale.effectiveSnapshot } : sale
    const entry = ensure(effective.sellerUid, effective.sellerName)
    entry.salesCount += 1
    entry.salesTotal = round2(entry.salesTotal + (Number(effective.total) || 0))
    entry.cashSales = round2(entry.cashSales + (Number(effective.cashAmount) || 0))
    entry.qrSales = round2(entry.qrSales + (Number(effective.qrAmount) || 0))
    entry.creditGenerated = round2(entry.creditGenerated + (Number(effective.creditAmount) || 0))
    for (const line of effective.lines || []) {
      const key = `${sale.id}::${line.productId}`
      const soldQuantity = Math.max(0, Number(line.quantity) || 0)
      const returnedQuantity = Math.min(soldQuantity, returnedBySaleProduct.get(key) || 0)
      const processing = (line.allocations || []).filter(allocation => allocation.processingAllocation)
      if (line.unitType === 'package' && processing.length > 0) {
        const allProcessingWeightsKnown = processing.every(allocation => Number.isSafeInteger(allocation.processingAllocation?.physicalWeightG))
        const processingWeightG = allProcessingWeightsKnown
          ? processing.reduce((sum, allocation) => sum + Number(allocation.processingAllocation?.physicalWeightG), 0)
          : null
        const returnedWeightG = returnedProcessingWeightBySaleProduct.get(key)
        const netQuantity = Math.max(0, soldQuantity - returnedQuantity)
        const derivedQuantity = processing.reduce((sum, allocation) => sum + Number(allocation.quantity || 0), 0)
        const derivedReturnedQuantity = Math.min(derivedQuantity, returnedQuantity)
        entry.packages += Math.min(netQuantity, derivedQuantity)
        if (allProcessingWeightsKnown && processingWeightG !== null && !returnedProcessingWeightUnknown.has(key)) {
          const netWeightG = Math.max(0, processingWeightG - (returnedWeightG ?? (derivedReturnedQuantity === 0 ? 0 : NaN)))
          if (Number.isFinite(netWeightG)) entry.documentedSachetKilograms += netWeightG / 1000
          else entry.unknownWeightPackages += Math.min(netQuantity, derivedQuantity)
        } else {
          entry.unknownWeightPackages += Math.min(netQuantity, derivedQuantity)
        }
        const ordinaryNetQuantity = Math.max(0, netQuantity - Math.min(netQuantity, derivedQuantity))
        if (ordinaryNetQuantity > 0) addSellerSaleLine(entry, line, ordinaryNetQuantity, productsById)
      } else {
        addSellerSaleLine(entry, line, soldQuantity - returnedQuantity, productsById)
      }
      returnedBySaleProduct.set(key, Math.max(0, (returnedBySaleProduct.get(key) || 0) - returnedQuantity))
      returnedProcessingWeightBySaleProduct.delete(key)
      returnedProcessingWeightUnknown.delete(key)
    }
    if (effective.routeName && !entry.routeNames.includes(effective.routeName)) entry.routeNames.push(effective.routeName)
  }

  // Devoluciones y cambios reducen la cantidad originalmente vendida. La
  // reposición del cambio se suma una vez como producto efectivamente entregado.
  for (const claim of claims) {
    const originalSale = salesById.get(claim.saleId)
    const sellerUid = claim.sellerUid || originalSale?.sellerUid
    if (!sellerUid || claim.isDerivedSaleVoid || originalSale?.voidedAt || originalSale?.pendingConfirmation) continue
    const entry = ensure(sellerUid, claim.sellerName || originalSale?.sellerName || '')
    // If the sale predates the selected report period, its return is still a
    // physical movement in this period. Do not pull the old sale into the
    // period; record only the negative quantity event using the claim snapshot.
    if (!originalSale) addSellerClaimReturnLine(entry, claim)
    if (claim.kind === 'exchange' && claim.replacement) {
      addSellerClaimReplacement(entry, claim.replacement)
    }
  }

  for (const collection of collections) {
    const entry = ensure(collection.collectedByUid, collection.collectedByName)
    entry.collected = round2(entry.collected + (Number(collection.amount) || 0))
  }

  for (const expense of expenses) {
    if (expense.voided) continue
    const entry = ensure(expense.registeredByUid, expense.registeredByName)
    cashExpenseBySeller.set(entry.sellerUid, round2((cashExpenseBySeller.get(entry.sellerUid) || 0) + expenseCashPaidAmount(expense)))
    if (expense.transactionKind !== 'supplier_payment') entry.expenses = round2(entry.expenses + (Number(expense.amount) || 0))
    if (expense.routeName && !entry.routeNames.includes(expense.routeName)) entry.routeNames.push(expense.routeName)
  }

  for (const collection of collections) {
    const entry = ensure(collection.collectedByUid, collection.collectedByName)
    const cash = collection.cashAmount ?? (collection.method === 'cash' ? collection.amount : 0)
    entry.expectedCash = round2(entry.expectedCash + (Number(cash) || 0))
  }

  for (const claim of claims) {
    if (!claim.sellerUid) continue
    const entry = ensure(claim.sellerUid, claim.sellerName || '')
    entry.expectedCash = round2(entry.expectedCash + (Number(claim.cashIn) || 0) - (Number(claim.cashOut) || 0))
  }

  for (const entry of map.values()) {
    entry.kilograms = round3(entry.kilograms)
    entry.documentedSachetKilograms = round3(entry.documentedSachetKilograms)
    entry.estimatedSachetKilograms = round3(entry.estimatedSachetKilograms)
    entry.totalDocumentedKilograms = round3(entry.kilograms + entry.documentedSachetKilograms)
    entry.totalEstimatedKilograms = round3(entry.totalDocumentedKilograms + entry.estimatedSachetKilograms)
    entry.unknownWeightPackages = round3(entry.unknownWeightPackages)
    entry.expectedCash = round2(entry.expectedCash + entry.cashSales - (cashExpenseBySeller.get(entry.sellerUid) || 0))
  }

  return [...map.values()].sort((a, b) => b.salesTotal - a.salesTotal)
}

function addSellerClaimReturnLine(entry: SellerBreakdown, claim: DistClaim): void {
  const quantity = Math.max(0, Number(claim.quantity) || 0)
  if (!quantity) return
  if (claim.unitType === 'kg') {
    entry.kilograms -= quantity
    return
  }
  entry.packages -= quantity
  if (claim.unitType !== 'package') return
  const allocations = (claim.returnedProcessingAllocations || []).flatMap(group => group.allocations || [])
  const processing = allocations.filter(allocation => allocation.processingAllocation)
  if (processing.length) {
    if (processing.every(allocation => Number.isSafeInteger(allocation.processingAllocation?.physicalWeightG))) {
      const grams = processing.reduce((sum, allocation) => sum + Number(allocation.processingAllocation?.physicalWeightG), 0)
      entry.documentedSachetKilograms -= grams / 1000
    } else entry.unknownWeightPackages += quantity
    return
  }
  const snapshot: DistSaleLine = {
    productId: claim.productId,
    productNameSnapshot: claim.productName,
    unitType: claim.unitType,
    quantity,
    actualUnitPrice: 0,
    subtotal: 0,
    ...(claim.documentedPackageWeightKgSnapshot ? { documentedPackageWeightKgSnapshot: claim.documentedPackageWeightKgSnapshot } : {}),
    ...(claim.presentationSnapshot ? { presentationSnapshot: claim.presentationSnapshot } : {}),
    ...(claim.descriptionSnapshot ? { descriptionSnapshot: claim.descriptionSnapshot } : {}),
  }
  const exactWeight = documentedPackageWeight(snapshot)
  if (exactWeight !== undefined) entry.documentedSachetKilograms -= quantity * exactWeight
  else entry.unknownWeightPackages += quantity
}

function addSellerClaimReplacement(
  entry: SellerBreakdown,
  replacement: NonNullable<DistClaim['replacement']>,
): void {
  const quantity = Math.max(0, Number(replacement.quantity) || 0)
  const allocations = replacement.allocations || []
  const processing = allocations.filter(allocation => allocation.processingAllocation)
  if (replacement.unitType === 'package' && processing.length > 0) {
    entry.packages += quantity
    const allocatedQuantity = processing.reduce((sum, allocation) => sum + Number(allocation.quantity || 0), 0)
    const exactWeights = allocatedQuantity === quantity && processing.every(allocation => Number.isSafeInteger(allocation.processingAllocation?.physicalWeightG))
    if (exactWeights) {
      entry.documentedSachetKilograms += processing.reduce((sum, allocation) => sum + Number(allocation.processingAllocation?.physicalWeightG), 0) / 1000
    } else entry.unknownWeightPackages += quantity
    return
  }
  if (replacement.unitType === 'kg') {
    entry.kilograms += quantity
    return
  }
  entry.packages += quantity
  if (replacement.unitType !== 'package') return
  const snapshot = {
    productId: replacement.productId,
    unitType: replacement.unitType,
    quantity,
    ...(replacement.documentedPackageWeightKgSnapshot ? { documentedPackageWeightKgSnapshot: replacement.documentedPackageWeightKgSnapshot } : {}),
    ...(replacement.presentationSnapshot ? { presentationSnapshot: replacement.presentationSnapshot } : {}),
    ...(replacement.descriptionSnapshot ? { descriptionSnapshot: replacement.descriptionSnapshot } : {}),
  } as DistSaleLine
  const exactWeight = documentedPackageWeight(snapshot)
  if (exactWeight !== undefined) entry.documentedSachetKilograms += quantity * exactWeight
  else entry.unknownWeightPackages += quantity
}

function round3(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 1000) / 1000
}

function documentedPackageWeight(line: DistSaleLine): number | undefined {
  if (Number.isFinite(line.documentedPackageWeightKgSnapshot) && (line.documentedPackageWeightKgSnapshot || 0) > 0) {
    return line.documentedPackageWeightKgSnapshot
  }
  // Una presentación con unidad y peso explícitos es una especificación
  // documental. El peso aproximado del catálogo nunca pasa por esta rama.
  const label = `${line.presentationSnapshot || ''} ${line.descriptionSnapshot || ''}`
  const match = label.match(/(?:^|\D)(\d+(?:[.,]\d+)?)\s*(kg|g|gr|gramos?)\b/i)
  if (match) {
    const amount = Number(match[1].replace(',', '.'))
    const weight = match[2].toLowerCase() === 'kg' ? amount : amount / 1000
    if (Number.isFinite(weight) && weight > 0) return weight
  }
  return undefined
}

function addSellerSaleLine(
  entry: SellerBreakdown,
  line: Pick<DistSaleLine, 'productId' | 'unitType' | 'quantity' | 'presentationSnapshot' | 'descriptionSnapshot' | 'documentedPackageWeightKgSnapshot'>,
  signedQuantity: number,
  productsById: Map<string, DistProduct>,
): void {
  const product = productsById.get(line.productId)
  if (line.unitType === 'kg') {
    entry.kilograms += signedQuantity
    return
  }
  entry.packages += signedQuantity
  if (line.unitType !== 'package') return
  const exactWeight = documentedPackageWeight(line as DistSaleLine)
  if (exactWeight !== undefined) {
    entry.documentedSachetKilograms += signedQuantity * exactWeight
  } else if (Number.isFinite(product?.approximateWeightKg) && (product?.approximateWeightKg || 0) > 0) {
    entry.estimatedSachetKilograms += signedQuantity * (product?.approximateWeightKg || 0)
  } else {
    entry.unknownWeightPackages += signedQuantity
  }
}
