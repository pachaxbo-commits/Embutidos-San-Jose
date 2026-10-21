import { round2, toDayKey } from './engine.ts'
import { getRouteDisplayName, resolveCreditProducts } from './creditRoutes.ts'
import type { DistCollection, DistCustomer, DistReceivable, DistReceivableAdjustment, DistRoute, DistSale } from '../types.ts'

export interface CustomerCreditStatementInput {
  customer: Pick<DistCustomer, 'id' | 'name' | 'identityNumber' | 'customerCode'>
  receivables: DistReceivable[]
  collections: DistCollection[]
  adjustments: DistReceivableAdjustment[]
  routes: DistRoute[]
  salesById: Map<string, DistSale>
  emittedAt?: Date
  adjustmentsAvailable?: boolean
}

export interface CustomerCreditStatementRow {
  date: string
  reference: string
  route: string
  distributor: string
  products: string
  original: number
  paid: number
  credited: number
  balance: number
  note: string
}

export interface CustomerCreditStatement {
  customerName: string
  customerCode: string
  issuedAt: string
  currentDebts: CustomerCreditStatementRow[]
  paidDebts: CustomerCreditStatementRow[]
  voidedDebts: CustomerCreditStatementRow[]
  payments: Array<{
    date: string
    reference: string
    method: string
    cash: number
    qr: number
    total: number
    responsible: string
    note: string
    pending: boolean
  }>
  adjustments: Array<{
    date: string
    reference: string
    action: string
    reason: string
    responsible: string
    previous: number | null
    current: number | null
  }>
  openingBalance: number
  outstandingTotal: number
  paymentTotal: number
  paymentCashTotal: number
  paymentQrTotal: number
  paymentsHistoryAvailable: boolean
  adjustmentsAvailable: boolean
  historicalProductDetailsMissing: number
  scopeLabel: string
}

function isVoided(receivable: DistReceivable): boolean {
  const extra = receivable as unknown as Record<string, unknown>
  return Boolean(
    receivable.voided || receivable.status === 'VOID' || receivable.voidedAt ||
    extra.voidReason || extra.isVoid || receivable.note?.toLowerCase().includes('anulad'),
  )
}

function openingBalance(receivable: DistReceivable): boolean {
  return receivable.sourceType === 'opening_balance'
}

export function buildCustomerCreditStatement(input: CustomerCreditStatementInput): CustomerCreditStatement {
  const customerReceivables = input.receivables
    .filter((row) => row.customerId === input.customer.id && !row.pendingConfirmation)
    .slice()
    .sort((a, b) => (a.sourceDate || a.dayKey || a.createdAt).localeCompare(b.sourceDate || b.dayKey || b.createdAt))

  const salesLines = new Map<string, DistSale>()
  for (const sale of input.salesById.values()) salesLines.set(sale.id, sale)

  const toDebtRow = (receivable: DistReceivable): CustomerCreditStatementRow => {
    const sale = input.salesById.get(receivable.saleId || '')
    const products = resolveCreditProducts(receivable, sale)
    const productText = openingBalance(receivable)
      ? 'Saldo anterior registrado; no corresponde a productos de una venta.'
      : products.lines.length
        ? products.lines.map((line) => `${line.productNameSnapshot || 'Producto histórico'}: ${line.quantity} ${line.unitType}`).join('; ')
        : 'Detalle de productos no disponible en el registro histórico.'
    return {
      date: receivable.sourceDate || receivable.dayKey || toDayKey(receivable.createdAt),
      reference: openingBalance(receivable) ? 'Saldo anterior' : receivable.saleId || receivable.id,
      route: getRouteDisplayName(receivable.routeId, input.routes),
      distributor: receivable.distributorName || 'Responsable histórico no disponible',
      products: productText,
      original: round2(Number(receivable.originalAmount) || 0),
      paid: round2(Number(receivable.paidAmount) || 0),
      credited: round2(Number(receivable.creditedAmount) || 0),
      balance: round2(Number(receivable.balance) || 0),
      note: receivable.note || '',
    }
  }

  const voided = customerReceivables.filter(isVoided)
  const valid = customerReceivables.filter((row) => !isVoided(row))
  const currentDebts = valid.filter((row) => Number(row.balance) > 0).map(toDebtRow)
  const paidDebts = valid.filter((row) => Number(row.balance) <= 0).map(toDebtRow)
  const voidedDebts = voided.map(toDebtRow)
  const currentIds = new Set(customerReceivables.map((row) => row.id))
  const paymentRows = input.collections
    .filter((row) => row.customerId === input.customer.id && !row.pendingConfirmation)
    .filter((row, index, rows) => rows.findIndex((candidate) => candidate.id === row.id) === index)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((row) => {
      const allocations = row.allocations?.filter((allocation) => currentIds.has(allocation.receivableId)) || []
      const legacyReceivableId = row.receivableId && currentIds.has(row.receivableId) ? row.receivableId : ''
      const refs = allocations.map((allocation) => {
        const debt = customerReceivables.find((item) => item.id === allocation.receivableId)
        return debt?.saleId || (debt ? (openingBalance(debt) ? 'Saldo anterior' : debt.id) : '')
      }).filter(Boolean)
      if (!refs.length && legacyReceivableId) {
        const debt = customerReceivables.find((item) => item.id === legacyReceivableId)
        if (debt) refs.push(debt.saleId || (openingBalance(debt) ? 'Saldo anterior' : debt.id))
      }
      const cash = round2(Number(row.cashAmount ?? (row.method === 'cash' ? row.amount : 0)) || 0)
      const qr = round2(Number(row.qrAmount ?? (row.method === 'qr' ? row.amount : 0)) || 0)
      return {
        date: row.createdAt,
        reference: refs.length ? [...new Set(refs)].join(', ') : 'Aplicación al saldo del cliente; asignación histórica no disponible',
        method: row.method === 'cash' ? 'Efectivo' : row.method === 'qr' ? 'QR' : 'Mixto',
        cash,
        qr,
        total: round2(Number(row.amount) || cash + qr),
        responsible: row.collectedByName || 'Responsable no disponible',
        note: row.note || '',
        pending: false,
      }
    })

  const adjustmentRows = input.adjustments
    .filter((row) => row.customerId === input.customer.id)
    .slice()
    .sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt))
    .map((row) => ({
      date: row.effectiveAt,
      reference: row.receivableId,
      action: row.action === 'void' ? 'Anulación de deuda' : 'Ajuste de deuda',
      reason: row.reason || 'Motivo no disponible en el registro histórico.',
      responsible: row.actorName || 'Responsable no disponible',
      previous: row.previous?.originalAmount == null ? null : round2(Number(row.previous.originalAmount)),
      current: row.next?.originalAmount == null ? null : round2(Number(row.next.originalAmount)),
    }))

  const missingProductDetails = customerReceivables.filter((row) =>
    !openingBalance(row) && !row.saleLines?.length && !row.adjustedSaleLines?.length && !input.salesById.has(row.saleId || ''),
  ).length
  const currentNonVoided = valid.filter((row) => Number(row.balance) > 0)
  return {
    customerName: input.customer.name,
    customerCode: input.customer.customerCode || input.customer.identityNumber || 'No registrado',
    issuedAt: (input.emittedAt || new Date()).toLocaleString('es-BO', { timeZone: 'America/La_Paz' }),
    currentDebts,
    paidDebts,
    voidedDebts,
    payments: paymentRows,
    adjustments: adjustmentRows,
    openingBalance: round2(currentNonVoided.filter(openingBalance).reduce((sum, row) => sum + (Number(row.balance) || 0), 0)),
    outstandingTotal: round2(currentNonVoided.reduce((sum, row) => sum + (Number(row.balance) || 0), 0)),
    paymentTotal: round2(paymentRows.reduce((sum, row) => sum + row.total, 0)),
    paymentCashTotal: round2(paymentRows.reduce((sum, row) => sum + row.cash, 0)),
    paymentQrTotal: round2(paymentRows.reduce((sum, row) => sum + row.qr, 0)),
    paymentsHistoryAvailable: true,
    adjustmentsAvailable: input.adjustmentsAvailable ?? true,
    historicalProductDetailsMissing: missingProductDetails,
    scopeLabel: 'Cartera completa disponible para esta cuenta, al momento de emisión',
  }
}

export function customerStatementFilename(customerName: string, customerId: string, extension: 'pdf' | 'xlsx'): string {
  const safeName = customerName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'cliente'
  const safeId = customerId.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 16) || 'id'
  return `SanJose-estado-cuenta-${safeName}-${safeId}.${extension}`
}
