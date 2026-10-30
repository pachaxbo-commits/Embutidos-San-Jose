import type {
  DistClosureProductRow,
  DistCollection,
  DistClaim,
  DistDispatch,
  DistExpense,
  DistLotAllocation,
  DistProduct,
  DistSale,
  DistSaleCorrection,
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
    if (sale.voidedAt || sale.pendingConfirmation) continue
    const effective = sale.effectiveSnapshot ? { ...sale, ...sale.effectiveSnapshot } : sale
    for (const line of effective.lines || []) {
      const current = result.get(line.productId)
      result.set(line.productId, {
        productName: line.productNameSnapshot,
        unitType: line.unitType,
        quantity: round2((current?.quantity ?? 0) + (effective.saleKind === 'courtesy' ? 0 : line.quantity)),
        courtesyQuantity: round2((current?.courtesyQuantity ?? 0) + (effective.saleKind === 'courtesy' ? line.quantity : 0)),
        amount: round2((current?.amount ?? 0) + (effective.saleKind === 'courtesy' ? 0 : line.subtotal)),
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
  /** Cobros originales de ventas anuladas; movimiento de caja, no venta neta. */
  voidedCashReceipts: number
  /** Cobros QR originales de ventas anuladas; movimiento electrónico, no venta neta. */
  voidedQrReceipts: number
  claimCash: number
  claimQr: number
  expectedCash: number
}

export function isSettledClaimCashMovement(claim: DistClaim): boolean {
  return claim.pendingConfirmation !== true && claim.cashRefundStatus !== 'pending'
}

export function cashMovementRouteId(claim: DistClaim): string {
  return claim.cashMovementRouteId || (claim.isDerivedSaleVoid ? 'administracion' : claim.routeId)
}

export function cashMovementSellerUid(claim: DistClaim): string {
  return claim.cashMovementResponsibleUid || (claim.isDerivedSaleVoid ? claim.createdBy || claim.sellerUid || '' : claim.sellerUid || '')
}

export function resolveVoidedSaleReceiptSnapshot(
  sale: DistSale,
  correction?: Pick<DistSaleCorrection, 'saleId' | 'original'>,
): { cashAmount: number; qrAmount: number } {
  const snapshot = sale.derivedVoid?.cashReceiptSnapshot
  const source = snapshot || correction?.original
  const error = `Conciliación pendiente: falta evidencia verificable del cobro original de la venta ${sale.id}.`
  if (!source || (correction && correction.saleId !== sale.id)) throw new Error(error)
  const { cashAmount, qrAmount } = source
  if (typeof cashAmount !== 'number' || !Number.isFinite(cashAmount) || cashAmount < 0
    || typeof qrAmount !== 'number' || !Number.isFinite(qrAmount) || qrAmount < 0) throw new Error(error)
  if ('total' in source && source.total !== undefined) {
    const creditAmount = 'creditAmount' in source ? source.creditAmount : undefined
    if (typeof source.total !== 'number' || !Number.isFinite(source.total) || source.total < 0
      || (creditAmount !== undefined && (typeof creditAmount !== 'number' || !Number.isFinite(creditAmount) || creditAmount < 0))
      || Math.abs(round2(cashAmount + qrAmount + (typeof creditAmount === 'number' ? creditAmount : 0)) - round2(source.total)) > 0.01) {
      throw new Error(error)
    }
  }
  return { cashAmount: round2(cashAmount), qrAmount: round2(qrAmount) }
}

export function computeVoidedSaleReceiptTotals(sales: DistSale[]): { cash: number; qr: number; total: number } {
  const totals = sales.filter(sale => sale.voidedAt && sale.derivedVoid && !sale.pendingConfirmation
    && sale.saleKind !== 'courtesy' && sale.effectiveSnapshot?.saleKind !== 'courtesy')
    .reduce((sum, sale) => {
      const snapshot = resolveVoidedSaleReceiptSnapshot(sale)
      return { cash: sum.cash + snapshot.cashAmount, qr: sum.qr + snapshot.qrAmount }
    }, { cash: 0, qr: 0 })
  const cash = round2(totals.cash)
  const qr = round2(totals.qr)
  return { cash, qr, total: round2(cash + qr) }
}

function settledClaimDelta(claims: DistClaim[], fieldIn: 'cashIn' | 'qrIn', fieldOut: 'cashOut' | 'qrOut'): number {
  return round2(claims.filter(isSettledClaimCashMovement).reduce((sum, claim) =>
    sum + (Number(claim[fieldIn]) || 0) - (Number(claim[fieldOut]) || 0), 0))
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
  claims: DistClaim[] = [],
): MoneySummary {
  let cashSales = 0
  let qrSales = 0
  let creditGenerated = 0
  let salesTotal = 0
  let voidedCashReceipts = 0
  let voidedQrReceipts = 0

  for (const sale of sales) {
    if (sale.voidedAt) {
      if (!sale.pendingConfirmation && sale.derivedVoid && sale.saleKind !== 'courtesy' && sale.effectiveSnapshot?.saleKind !== 'courtesy') {
        const receipt = resolveVoidedSaleReceiptSnapshot(sale)
        voidedCashReceipts += receipt.cashAmount
        voidedQrReceipts += receipt.qrAmount
      }
      continue
    }
    if (sale.saleKind === 'courtesy' || sale.pendingConfirmation) continue
    const effective = sale.effectiveSnapshot ? { ...sale, ...sale.effectiveSnapshot } : sale
    cashSales += Number(effective.cashAmount) || 0
    qrSales += Number(effective.qrAmount) || 0
    creditGenerated += Number(effective.creditAmount) || 0
    salesTotal += Number(effective.total) || 0
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
  const claimCash = settledClaimDelta(claims, 'cashIn', 'cashOut')
  const claimQr = settledClaimDelta(claims, 'qrIn', 'qrOut')

  return {
    salesTotal: round2(salesTotal),
    cashSales: round2(cashSales),
    qrSales: round2(qrSales),
    creditGenerated: round2(creditGenerated),
    cashCollections: round2(cashCollections),
    qrCollections: round2(qrCollections),
    collectionsTotal: round2(cashCollections + qrCollections),
    cashExpenses: round2(cashExpenses),
    voidedCashReceipts: round2(voidedCashReceipts),
    voidedQrReceipts: round2(voidedQrReceipts),
    claimCash,
    claimQr,
    expectedCash: round2(cashSales + voidedCashReceipts + cashCollections - cashExpenses + claimCash),
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
    if (sale.voidedAt || sale.pendingConfirmation) continue
    const effective = sale.effectiveSnapshot ? { ...sale, ...sale.effectiveSnapshot } : sale
    for (const line of effective.lines || []) {
      if (line.unitType === 'kg') total += Number(line.quantity) || 0
    }
  }
  return round2(total)
}

export function computeSoldPackages(sales: DistSale[]): number {
  let total = 0
  for (const sale of sales) {
    if (sale.voidedAt || sale.pendingConfirmation) continue
    const effective = sale.effectiveSnapshot ? { ...sale, ...sale.effectiveSnapshot } : sale
    for (const line of effective.lines || []) {
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
  voidedCashReceipts: number
  cashRefunds: number
  qrRefunds: number
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
      voidedCashReceipts: 0,
      cashRefunds: 0,
      qrRefunds: 0,
      expectedCash: 0,
    }
    map.set(key, created)
    return created
  }

  for (const sale of sales) {
    if (sale.voidedAt) {
      if (sale.derivedVoid && !sale.pendingConfirmation && sale.saleKind !== 'courtesy') {
        const entry = ensure(sale.sellerUid, sale.sellerName)
        const receipt = resolveVoidedSaleReceiptSnapshot(sale)
        entry.voidedCashReceipts = round2(entry.voidedCashReceipts + receipt.cashAmount)
        entry.expectedCash = round2(entry.expectedCash + receipt.cashAmount)
      }
      continue
    }
    if (sale.saleKind === 'courtesy' || sale.pendingConfirmation) continue
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
    if (!isSettledClaimCashMovement(claim)) continue
    const financialOwner = cashMovementSellerUid(claim)
    if (!financialOwner) continue
    const entry = ensure(financialOwner, claim.cashMovementResponsibleName || claim.sellerName || '')
    entry.cashRefunds = round2(entry.cashRefunds + (Number(claim.cashOut) || 0))
    entry.qrRefunds = round2(entry.qrRefunds + (Number(claim.qrOut) || 0))
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

export interface SellerRouteKilograms {
  granelKilograms: number
  documentedSachetKilograms: number
  totalDocumentedKilograms: number
  estimatedSachetKilograms: number
  unknownWeightPackages: number
}

/** Shares the seller report calculation while keeping route rows independent. */
export function computeSellerKilogramsByRoute(
  sales: DistSale[],
  claims: DistClaim[] = [],
  products: DistProduct[] = [],
): Map<string, SellerRouteKilograms> {
  const routeIds = new Set([...sales.map(sale => sale.routeId), ...claims.map(claim => claim.routeId)].filter(Boolean))
  const result = new Map<string, SellerRouteKilograms>()
  for (const routeId of routeIds) {
    const routeSales = sales.filter(sale => sale.routeId === routeId)
    const routeSaleIds = new Set(routeSales.map(sale => sale.id))
    const routeClaims = claims.filter(claim => claim.routeId === routeId || routeSaleIds.has(claim.saleId))
    const sellers = computeSellerBreakdown(routeSales, [], [], routeClaims, products)
    const totals = sellers.reduce((sum, seller) => ({
      granelKilograms: sum.granelKilograms + seller.kilograms,
      documentedSachetKilograms: sum.documentedSachetKilograms + seller.documentedSachetKilograms,
      totalDocumentedKilograms: sum.totalDocumentedKilograms + seller.totalDocumentedKilograms,
      estimatedSachetKilograms: sum.estimatedSachetKilograms + seller.estimatedSachetKilograms,
      unknownWeightPackages: sum.unknownWeightPackages + seller.unknownWeightPackages,
    }), { granelKilograms: 0, documentedSachetKilograms: 0, totalDocumentedKilograms: 0, estimatedSachetKilograms: 0, unknownWeightPackages: 0 })
    if (sellers.some(seller => seller.salesCount > 0 || seller.kilograms !== 0 || seller.documentedSachetKilograms !== 0 || seller.estimatedSachetKilograms !== 0 || seller.packages !== 0 || seller.unknownWeightPackages !== 0)) result.set(routeId, {
      granelKilograms: round3(totals.granelKilograms),
      documentedSachetKilograms: round3(totals.documentedSachetKilograms),
      totalDocumentedKilograms: round3(totals.totalDocumentedKilograms),
      estimatedSachetKilograms: round3(totals.estimatedSachetKilograms),
      unknownWeightPackages: round3(totals.unknownWeightPackages),
    })
  }
  return result
}

export interface SellerProductKilograms extends SellerRouteKilograms {
  sellerUid: string
  sellerName: string
  routeNames: string[]
  productId: string
  productName: string
}

/** Net kilogram detail per seller and item, using the same sale/claim logic. */
export function computeSellerKilogramsByProduct(
  sales: DistSale[],
  claims: DistClaim[] = [],
  products: DistProduct[] = [],
  sellerFilter = '',
): SellerProductKilograms[] {
  const productsById = new Map(products.map(product => [product.id, product]))
  const productIds = new Set<string>()
  for (const sale of sales) {
    const effective = sale.effectiveSnapshot ? { ...sale, ...sale.effectiveSnapshot } : sale
    for (const line of effective.lines || []) productIds.add(line.productId)
  }
  for (const claim of claims) {
    productIds.add(claim.productId)
    if (claim.replacement?.productId) productIds.add(claim.replacement.productId)
  }
  const result: SellerProductKilograms[] = []
  for (const productId of productIds) {
    const productSales = sales.flatMap(sale => {
      const effective = sale.effectiveSnapshot ? { ...sale, ...sale.effectiveSnapshot } : sale
      const lines = (effective.lines || []).filter(line => line.productId === productId)
      return lines.length ? [{ ...effective, effectiveSnapshot: undefined, lines }] : []
    })
    const productClaims = claims.flatMap(claim => {
      const originalMatches = claim.productId === productId
      const replacementMatches = claim.replacement?.productId === productId
      if (!originalMatches && !replacementMatches) return []
      return [{
        ...claim,
        productId,
        quantity: originalMatches ? claim.quantity : 0,
        unitType: originalMatches ? claim.unitType : claim.replacement?.unitType || claim.unitType,
        returnedProcessingAllocations: originalMatches ? claim.returnedProcessingAllocations : [],
        replacement: replacementMatches ? claim.replacement : null,
      }]
    })
    const rows = computeSellerBreakdown(productSales, [], [], productClaims, products)
    for (const row of rows) {
      if (sellerFilter && row.sellerUid !== sellerFilter) continue
      if (row.salesCount === 0 && row.kilograms === 0 && row.documentedSachetKilograms === 0 && row.estimatedSachetKilograms === 0 && row.packages === 0 && row.unknownWeightPackages === 0) continue
      result.push({
        sellerUid: row.sellerUid,
        sellerName: row.sellerName,
        routeNames: row.routeNames,
        productId,
        productName: productsById.get(productId)?.name
          || productSales.flatMap(sale => sale.lines).find(line => line.productId === productId)?.productNameSnapshot
          || claims.find(claim => claim.productId === productId)?.productName
          || claims.find(claim => claim.replacement?.productId === productId)?.replacement?.productName
          || 'Producto histórico',
        granelKilograms: row.kilograms,
        documentedSachetKilograms: row.documentedSachetKilograms,
        totalDocumentedKilograms: row.totalDocumentedKilograms,
        estimatedSachetKilograms: row.estimatedSachetKilograms,
        unknownWeightPackages: row.unknownWeightPackages,
      })
    }
  }
  return result.sort((a, b) => a.sellerName.localeCompare(b.sellerName, 'es') || a.productName.localeCompare(b.productName, 'es'))
}

export interface SellerDailyRow {
  dayKey: string
  dateFormatted: string
  sellerUid: string
  sellerName: string
  routeNames: string[]
  granelKilograms: number
  documentedSachetKilograms: number
  totalDocumentedKilograms: number
  estimatedSachetKilograms: number
  totalEstimatedKilograms: number
  packages: number
  unknownWeightPackages: number
}

export interface SellerDailyDayGroup {
  dayKey: string
  dateFormatted: string
  rows: SellerDailyRow[]
  subtotal: {
    granelKilograms: number
    documentedSachetKilograms: number
    totalDocumentedKilograms: number
    estimatedSachetKilograms: number
    totalEstimatedKilograms: number
    packages: number
    unknownWeightPackages: number
  }
}

/** Formatea una fecha YYYY-MM-DD a DD/MM/YYYY */
export function formatDayKeyToDate(dayKey: string): string {
  const [year, month, day] = dayKey.split('-')
  return year && month && day ? `${day}/${month}/${year}` : dayKey
}

/**
 * Computes daily kilogram breakdown by seller and day, matching shared calculation logic.
 * Respects Bolivia dates, voided/courtesy/pending exclusions, and return compensations.
 */
export function computeSellerDailyBreakdown(
  days: string[],
  sales: DistSale[],
  claims: DistClaim[] = [],
  products: DistProduct[] = [],
  routeFilter = '',
  sellerFilter = '',
): SellerDailyDayGroup[] {
  const sortedDays = [...new Set(days)].filter(Boolean).sort()
  const result: SellerDailyDayGroup[] = []

  for (const dayKey of sortedDays) {
    const daySales = sales.filter((sale) =>
      (sale.dayKey || toDayKey(sale.createdAt)) === dayKey &&
      (!routeFilter || matchesRoute(sale.routeId, routeFilter)) &&
      (!sellerFilter || sale.sellerUid === sellerFilter)
    )
    const dayClaims = claims.filter((claim) =>
      (claim.dayKey || toDayKey(claim.createdAt)) === dayKey &&
      (!routeFilter || matchesRoute(cashMovementRouteId(claim), routeFilter)) &&
      (!sellerFilter || cashMovementSellerUid(claim) === sellerFilter)
    )

    if (daySales.length === 0 && dayClaims.length === 0) continue

    const sellers = computeSellerBreakdown(daySales, [], [], dayClaims, products)
      .filter((seller) =>
        (!sellerFilter || seller.sellerUid === sellerFilter) &&
        (seller.salesCount > 0 || seller.kilograms !== 0 || seller.documentedSachetKilograms !== 0 ||
         seller.estimatedSachetKilograms !== 0 || seller.packages !== 0 || seller.unknownWeightPackages !== 0)
      )

    if (sellers.length === 0) continue

    const dateFormatted = formatDayKeyToDate(dayKey)

    const rows: SellerDailyRow[] = sellers.map((seller) => ({
      dayKey,
      dateFormatted,
      sellerUid: seller.sellerUid,
      sellerName: seller.sellerName,
      routeNames: seller.routeNames,
      granelKilograms: round3(seller.kilograms),
      documentedSachetKilograms: round3(seller.documentedSachetKilograms),
      totalDocumentedKilograms: round3(seller.totalDocumentedKilograms),
      estimatedSachetKilograms: round3(seller.estimatedSachetKilograms),
      totalEstimatedKilograms: round3(seller.totalEstimatedKilograms),
      packages: round3(seller.packages),
      unknownWeightPackages: round3(seller.unknownWeightPackages),
    }))

    const subtotal = {
      granelKilograms: round3(rows.reduce((sum, r) => sum + r.granelKilograms, 0)),
      documentedSachetKilograms: round3(rows.reduce((sum, r) => sum + r.documentedSachetKilograms, 0)),
      totalDocumentedKilograms: round3(rows.reduce((sum, r) => sum + r.totalDocumentedKilograms, 0)),
      estimatedSachetKilograms: round3(rows.reduce((sum, r) => sum + r.estimatedSachetKilograms, 0)),
      totalEstimatedKilograms: round3(rows.reduce((sum, r) => sum + r.totalEstimatedKilograms, 0)),
      packages: round3(rows.reduce((sum, r) => sum + r.packages, 0)),
      unknownWeightPackages: round3(rows.reduce((sum, r) => sum + r.unknownWeightPackages, 0)),
    }

    result.push({
      dayKey,
      dateFormatted,
      rows,
      subtotal,
    })
  }

  return result
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
