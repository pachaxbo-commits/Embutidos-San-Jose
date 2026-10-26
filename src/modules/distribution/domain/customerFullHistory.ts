import { round2 } from './engine.ts'
import type { DistCollection, DistCustomer, DistReceivable, DistReceivableAdjustment, DistRoute, DistSale, DistSaleCorrection } from '../types.ts'

export type CustomerHistoryTab = 'purchases' | 'payments' | 'account'
export type CustomerHistoryPreset = 'today' | 'yesterday' | 'week' | 'previous-week' | 'month' | 'previous-month' | 'custom' | 'all'
export interface CustomerHistoryRange { from: string | null; to: string | null }
export interface CustomerFullHistoryData {
  sales: DistSale[]
  saleCorrections: DistSaleCorrection[]
  receivables: DistReceivable[]
  collections: DistCollection[]
  receivableAdjustments: DistReceivableAdjustment[]
  unlinkedNameMatches: Array<{ id: string; createdAt: string; customerName?: string; routeName?: string; sellerName?: string; total?: number }>
}
export interface CustomerAccountEvent {
  id: string
  date: string
  dayKey: string
  kind: 'opening' | 'purchase' | 'payment' | 'adjustment'
  label: string
  reference: string
  route: string
  responsible: string
  charge: number
  payment: number
  balance: number
  note: string
}
export interface CustomerHistorySummary {
  purchaseCount: number
  voidedSalesCount: number
  totalBought: number
  paidAtPurchase: number
  cashAtPurchase: number
  qrAtPurchase: number
  creditGenerated: number
  collectionsReceived: number
  debtAdjustments: number
  openingBalance: number | null
  endingBalance: number | null
  currentBalance: number
  balanceVerified: boolean
}
export interface CustomerMonthlySummary extends CustomerHistorySummary { month: string }

const BOLIVIA_TIME_ZONE = 'America/La_Paz'
const partsInBolivia = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: BOLIVIA_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)

export function customerHistoryDayKey(value: string | Date | undefined): string {
  if (!value) return ''
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = Object.fromEntries(partsInBolivia(date).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function customerHistoryRange(preset: CustomerHistoryPreset, now = new Date(), custom?: CustomerHistoryRange): CustomerHistoryRange {
  if (preset === 'all') return { from: null, to: null }
  if (preset === 'custom') return custom || { from: null, to: null }
  const today = customerHistoryDayKey(now)
  const [year, month, day] = today.split('-').map(Number)
  const local = new Date(Date.UTC(year, month - 1, day))
  const shift = (days: number) => new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
  if (preset === 'today') return { from: today, to: today }
  if (preset === 'yesterday') { const day = shift(-1); return { from: day, to: day } }
  if (preset === 'week' || preset === 'previous-week') {
    const mondayOffset = (local.getUTCDay() + 6) % 7
    const start = shift(-mondayOffset + (preset === 'previous-week' ? -7 : 0))
    const end = shift(-mondayOffset + (preset === 'previous-week' ? -1 : 6))
    return { from: start, to: end }
  }
  const monthStart = `${today.slice(0, 7)}-01`
  const currentMonthEnd = shift(0)
  if (preset === 'month') return { from: monthStart, to: currentMonthEnd }
  const previousEnd = new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10)
  const previousStart = `${previousEnd.slice(0, 7)}-01`
  return { from: previousStart, to: previousEnd }
}

export function recordDayKey(row: { dayKey?: string; sourceDate?: string; effectiveDayKey?: string; createdAt?: string; effectiveAt?: string }): string {
  return row.dayKey || row.effectiveDayKey || row.sourceDate || customerHistoryDayKey(row.effectiveAt || row.createdAt)
}

const effectiveSale = (sale: DistSale) => sale.effectiveSnapshot ? { ...sale, ...sale.effectiveSnapshot } : sale
const cancelled = (row: Record<string, unknown>) => Boolean(row.voidedAt || row.cancelledAt || row.status === 'VOID' || row.voided === true)
const routeName = (routeId: string | undefined, fallback: string | undefined, routes: DistRoute[]) => fallback || routes.find(route => route.id === routeId)?.name || 'Ruta histórica no disponible'

export function buildCustomerAccountEvents(input: {
  customer: DistCustomer
  data: CustomerFullHistoryData
  routes: DistRoute[]
}): { events: CustomerAccountEvent[]; currentBalance: number; reconstructedBalance: number; balanceDifference: number; balanceVerified: boolean; warningCount: number; auditWarnings: string[] } {
  const { customer, data, routes } = input
  const events: CustomerAccountEvent[] = []
  const saleById = new Map(data.sales.map(sale => [sale.id, sale]))
  const receivableById = new Map(data.receivables.map(debt => [debt.id, debt]))
  const addedReceivableSaleIds = new Set<string>()
  let warningCount = data.unlinkedNameMatches.length ? 1 : 0
  const auditWarnings: string[] = data.unlinkedNameMatches.length ? [`${data.unlinkedNameMatches.length} venta(s) con nombre coincidente carecen de customerId y no se atribuyeron automáticamente.`] : []

  for (const debt of data.receivables) {
    if (debt.pendingConfirmation || cancelled(debt as unknown as Record<string, unknown>)) continue
    if (debt.sourceType === 'opening_balance') {
      const debtAdjustments = data.receivableAdjustments.filter(item => item.receivableId === debt.id).sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt))
      const firstAmount = debtAdjustments[0]?.previous.originalAmount ?? debt.originalAmount
      events.push({ id: `opening-${debt.id}`, date: debt.sourceDate || debt.createdAt, dayKey: debt.sourceDate || debt.dayKey || recordDayKey(debt), kind: 'opening', label: 'Saldo inicial documentado', reference: debt.id, route: routeName(debt.routeId, undefined, routes), responsible: debt.distributorName || 'Responsable no disponible', charge: round2(Number(firstAmount) || 0), payment: 0, balance: 0, note: debt.note || '' })
      addedReceivableSaleIds.add(debt.id)
    } else {
      const sale = saleById.get(debt.saleId || debt.id)
      if (sale) {
        addedReceivableSaleIds.add(debt.id)
        addedReceivableSaleIds.add(sale.id)
      } else {
        const original = (debt.originalSnapshot as Record<string, unknown> | undefined)?.originalAmount
        const amount = original == null ? Number(debt.originalAmount) || 0 : Number(original) || 0
        events.push({ id: `credit-legacy-${debt.id}`, date: debt.sourceDate || debt.createdAt, dayKey: debt.sourceDate || debt.dayKey || recordDayKey(debt), kind: 'purchase', label: 'Crédito histórico sin venta original disponible', reference: debt.saleId || debt.id, route: routeName(debt.routeId, undefined, routes), responsible: debt.distributorName || 'Responsable no disponible', charge: round2(amount), payment: 0, balance: 0, note: debt.note || 'No se encontró el documento de venta vinculado.' })
        addedReceivableSaleIds.add(debt.id)
        if (original == null && debt.lastAdjustmentId) { warningCount++; auditWarnings.push(`El crédito histórico ${debt.id} tiene ajustes, pero no conserva el saldo anterior verificable.`) }
      }
    }
  }

  for (const sale of data.sales) {
    if (!sale.customerId || sale.customerId !== customer.id || sale.pendingConfirmation) continue
    const effective = effectiveSale(sale)
    const isVoid = Boolean(sale.voidedAt)
    const total = isVoid ? 0 : Number(effective.total) || 0
    const cash = isVoid ? 0 : Number(effective.cashAmount) || 0
    const qr = isVoid ? 0 : Number(effective.qrAmount) || 0
    const credit = isVoid ? 0 : Number(effective.creditAmount) || 0
    const originalCredit = Number(sale.creditAmount) || 0
    events.push({ id: `sale-${sale.id}`, date: sale.createdAt, dayKey: recordDayKey(sale), kind: 'purchase', label: isVoid ? 'Venta anulada' : sale.latestCorrectionId ? 'Compra corregida (valores vigentes)' : 'Compra', reference: sale.id, route: routeName(sale.routeId, sale.routeName, routes), responsible: sale.sellerName || 'Responsable no disponible', charge: round2(originalCredit), payment: 0, balance: 0, note: sale.voidReason || sale.editReason || sale.note || '' })
    if (!addedReceivableSaleIds.has(sale.id) && credit > 0) {
      // Legacy credit sale without receivable document: preserve the charge but flag incomplete reconciliation.
      warningCount++
      auditWarnings.push(`La venta ${sale.id} contiene crédito pero no tiene una cuenta por cobrar vinculada.`)
      events.push({ id: `unbacked-credit-${sale.id}`, date: sale.createdAt, dayKey: recordDayKey(sale), kind: 'purchase', label: 'Crédito de venta sin cuenta por cobrar vinculada', reference: sale.id, route: routeName(sale.routeId, sale.routeName, routes), responsible: sale.sellerName || 'Responsable no disponible', charge: 0, payment: 0, balance: 0, note: 'El crédito queda en la compra, pero falta el documento de cartera para conciliar su saldo.' })
    }
    if (total || !isVoid) {
      // Informational purchase events have zero charge unless part of the credit.
      events.push({ id: `purchase-value-${sale.id}`, date: sale.createdAt, dayKey: recordDayKey(sale), kind: 'purchase', label: isVoid ? 'Compra anulada' : 'Compra registrada', reference: sale.id, route: routeName(sale.routeId, sale.routeName, routes), responsible: sale.sellerName || 'Responsable no disponible', charge: 0, payment: 0, balance: 0, note: `Venta ${round2(total)} Bs · contado ${round2(cash)} · QR ${round2(qr)} · crédito ${round2(credit)} Bs` })
    }
  }

  for (const correction of data.saleCorrections) {
    const linkedSale = saleById.get(correction.saleId)
    if (!linkedSale || linkedSale.customerId !== customer.id) continue
    const original = Number(correction.original.creditAmount) || 0
    const corrected = Number(correction.corrected.creditAmount) || 0
    const delta = round2(corrected - original)
    if (!delta && round2((Number(correction.corrected.total) || 0) - (Number(correction.original.total) || 0)) === 0) continue
    events.push({ id: `sale-correction-${correction.id}`, date: correction.createdAt, dayKey: recordDayKey(correction), kind: 'adjustment', label: correction.kind === 'void' ? 'Anulación de venta' : 'Corrección de compra', reference: correction.saleId, route: routeName(linkedSale?.routeId, linkedSale?.routeName, routes), responsible: correction.correctedByName || linkedSale?.sellerName || 'Responsable no disponible', charge: delta, payment: 0, balance: 0, note: `${correction.reason || 'Motivo no disponible'} · cambio venta ${round2((Number(correction.corrected.total) || 0) - (Number(correction.original.total) || 0))} Bs` })
  }

  for (const collection of data.collections) {
    const raw = collection as unknown as Record<string, unknown>
    if (collection.pendingConfirmation || cancelled(raw)) continue
    const allocations = collection.allocations || (collection.receivableId ? [{ receivableId: collection.receivableId, amount: collection.amount }] : [])
    const refs = allocations.map(allocation => {
      const debt = receivableById.get(allocation.receivableId)
      return debt?.saleId || allocation.saleId || allocation.receivableId
    })
    events.push({ id: `payment-${collection.id}`, date: collection.createdAt, dayKey: recordDayKey(collection), kind: 'payment', label: 'Abono recibido', reference: collection.id, route: routeName(collection.routeId, undefined, routes), responsible: collection.collectedByName || 'Responsable no disponible', charge: 0, payment: Number(collection.amount) || 0, balance: 0, note: [collection.note, refs.length ? `Aplicado a: ${[...new Set(refs)].join(', ')}` : 'Asignación FIFO histórica no disponible'].filter(Boolean).join(' · ') })
  }

  for (const adjustment of data.receivableAdjustments) {
    const debt = receivableById.get(adjustment.receivableId)
    if (adjustment.customerId !== customer.id || (debt?.sourceType !== 'opening_balance' && saleById.has(debt?.saleId || debt?.id || ''))) continue
    const delta = round2((Number(adjustment.next.balance) || 0) - (Number(adjustment.previous.balance) || 0))
    if (!delta) continue
    events.push({ id: `receivable-adjustment-${adjustment.id}`, date: adjustment.effectiveAt, dayKey: adjustment.effectiveDayKey || recordDayKey(adjustment), kind: 'adjustment', label: adjustment.action === 'void' ? 'Anulación de deuda' : 'Ajuste de deuda', reference: adjustment.receivableId, route: routeName(debt?.routeId, undefined, routes), responsible: adjustment.actorName || 'Responsable no disponible', charge: delta, payment: 0, balance: 0, note: adjustment.reason || 'Motivo no disponible.' })
  }

  // Correcciones de cartera de deudas vinculadas a ventas también son movimientos de deuda.
  for (const adjustment of data.receivableAdjustments) {
    if (adjustment.customerId !== customer.id) continue
    const debt = receivableById.get(adjustment.receivableId)
    if (!debt?.saleId || !saleById.has(debt.saleId)) continue
    const delta = round2((Number(adjustment.next.balance) || 0) - (Number(adjustment.previous.balance) || 0))
    // A sale correction edits sales and receivable atomically without an adjustment document;
    // manual receivable edits are represented only here.
    if (!delta) continue
    events.push({ id: `receivable-adjustment-${adjustment.id}`, date: adjustment.effectiveAt, dayKey: adjustment.effectiveDayKey || recordDayKey(adjustment), kind: 'adjustment', label: adjustment.action === 'void' ? 'Anulación de crédito' : 'Ajuste de crédito', reference: adjustment.receivableId, route: routeName(debt.routeId, undefined, routes), responsible: adjustment.actorName || 'Responsable no disponible', charge: delta, payment: 0, balance: 0, note: adjustment.reason || 'Motivo no disponible.' })
  }

  const sort = (a: CustomerAccountEvent, b: CustomerAccountEvent) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)
  events.sort(sort)
  let running = 0
  for (const event of events) {
    running = round2(running + event.charge - event.payment)
    event.balance = running
  }
  const currentBalance = round2(data.receivables.filter(row => row.customerId === customer.id && !row.pendingConfirmation && !cancelled(row as unknown as Record<string, unknown>)).reduce((sum, row) => sum + (Number(row.balance) || 0), 0))
  const balanceDifference = round2(running - currentBalance)
  const balanceVerified = Math.abs(balanceDifference) <= 0.02 && warningCount === 0
  if (Math.abs(balanceDifference) > 0.02) auditWarnings.push(`La reconstrucción difiere de la cartera vigente en ${balanceDifference.toFixed(2)} Bs.`)
  if (!balanceVerified) warningCount++
  return { events, currentBalance, reconstructedBalance: running, balanceDifference, balanceVerified, warningCount, auditWarnings }
}

export function filterCustomerHistory<T extends { dayKey: string }>(rows: T[], range: CustomerHistoryRange): T[] {
  return rows.filter(row => (!range.from || row.dayKey >= range.from) && (!range.to || row.dayKey <= range.to))
}

export function summarizeCustomerHistory(input: {
  customer: DistCustomer
  data: CustomerFullHistoryData
  routes: DistRoute[]
  range: CustomerHistoryRange
}): { summary: CustomerHistorySummary; account: ReturnType<typeof buildCustomerAccountEvents>; filteredAccountEvents: CustomerAccountEvent[]; monthly: CustomerMonthlySummary[] } {
  const account = buildCustomerAccountEvents({ customer: input.customer, data: input.data, routes: input.routes })
  const sales = filterCustomerHistory(input.data.sales.filter(sale => !sale.pendingConfirmation), input.range)
  const purchases = sales.filter(sale => !sale.voidedAt)
  const payments = filterCustomerHistory(input.data.collections.filter(row => !row.pendingConfirmation && !cancelled(row as unknown as Record<string, unknown>)), input.range)
  const filteredAccountEvents = filterCustomerHistory(account.events, input.range)
  const beforeRange = input.range.from ? account.events.filter(event => event.dayKey < input.range.from!) : []
  const inRange = filteredAccountEvents
  const opening = beforeRange.length ? beforeRange[beforeRange.length - 1].balance : 0
  const ending = inRange.length ? inRange[inRange.length - 1].balance : opening
  const sum = (values: number[]) => round2(values.reduce((total, value) => total + value, 0))
  const summary: CustomerHistorySummary = {
    purchaseCount: purchases.length,
    voidedSalesCount: sales.filter(sale => Boolean(sale.voidedAt)).length,
    totalBought: sum(purchases.map(sale => Number(effectiveSale(sale).total) || 0)),
    paidAtPurchase: sum(purchases.map(sale => (Number(effectiveSale(sale).cashAmount) || 0) + (Number(effectiveSale(sale).qrAmount) || 0))),
    cashAtPurchase: sum(purchases.map(sale => Number(effectiveSale(sale).cashAmount) || 0)),
    qrAtPurchase: sum(purchases.map(sale => Number(effectiveSale(sale).qrAmount) || 0)),
    creditGenerated: sum(purchases.map(sale => Number(sale.creditAmount) || 0)),
    collectionsReceived: sum(payments.map(row => Number(row.amount) || 0)),
    debtAdjustments: sum(inRange.filter(event => event.kind === 'adjustment').map(event => event.charge)),
    openingBalance: account.balanceVerified ? round2(opening) : null,
    endingBalance: account.balanceVerified ? round2(ending) : null,
    currentBalance: account.currentBalance,
    balanceVerified: account.balanceVerified,
  }
  const months = new Map<string, CustomerAccountEvent[]>()
  for (const event of inRange) {
    const month = event.dayKey.slice(0, 7)
    if (!month) continue
    months.set(month, [...(months.get(month) || []), event])
  }
  const monthly = [...months.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([month, events]) => {
    const monthSales = purchases.filter(sale => recordDayKey(sale).startsWith(month))
    const monthPayments = payments.filter(row => recordDayKey(row).startsWith(month))
    const priorEvents = account.events.filter(event => event.dayKey < `${month}-01`)
    const firstBalance = priorEvents.at(-1)?.balance ?? 0
    const endingBalance = events.at(-1)?.balance ?? firstBalance
    const monthAdjustment = sum(events.filter(event => event.kind === 'adjustment').map(event => event.charge))
    return {
      month,
      purchaseCount: monthSales.length,
      voidedSalesCount: sales.filter(sale => sale.voidedAt && recordDayKey(sale).startsWith(month)).length,
      totalBought: sum(monthSales.map(sale => Number(effectiveSale(sale).total) || 0)),
      paidAtPurchase: sum(monthSales.map(sale => (Number(effectiveSale(sale).cashAmount) || 0) + (Number(effectiveSale(sale).qrAmount) || 0))),
      cashAtPurchase: sum(monthSales.map(sale => Number(effectiveSale(sale).cashAmount) || 0)),
      qrAtPurchase: sum(monthSales.map(sale => Number(effectiveSale(sale).qrAmount) || 0)),
      creditGenerated: sum(monthSales.map(sale => Number(sale.creditAmount) || 0)),
      collectionsReceived: sum(monthPayments.map(row => Number(row.amount) || 0)),
      debtAdjustments: monthAdjustment,
      openingBalance: account.balanceVerified ? round2(firstBalance) : null,
      endingBalance: account.balanceVerified ? round2(endingBalance) : null,
      currentBalance: account.currentBalance,
      balanceVerified: account.balanceVerified,
    }
  })
  return { summary, account, filteredAccountEvents, monthly }
}
