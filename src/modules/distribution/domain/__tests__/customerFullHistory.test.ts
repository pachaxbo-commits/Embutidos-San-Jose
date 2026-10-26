import { buildCustomerAccountEvents, customerHistoryDayKey, customerHistoryRange, summarizeCustomerHistory, type CustomerFullHistoryData } from '../customerFullHistory.ts'
import type { DistCustomer, DistReceivable, DistSale, DistSaleCorrection } from '../../types.ts'

const customer = { id: 'c1', name: 'Cliente Uno' } as DistCustomer
const sale = (id: string, dayKey: string, values: Record<string, unknown> = {}) => ({
  id, customerId: 'c1', customerName: customer.name, customerCode: 'C-1', routeId: 'r1', routeName: 'Norte',
  sellerUid: 'seller', sellerName: 'Vendedor', sourceLocation: 'route', dispatchId: `d-${id}`, createdAt: `${dayKey}T14:00:00.000Z`, dayKey,
  lines: [{ productId: 'p1', productNameSnapshot: 'Producto', quantity: 1, unitType: 'kg', actualUnitPrice: 100, subtotal: 100 }],
  total: 100, paymentKind: 'mixed', cashAmount: 40, qrAmount: 10, creditAmount: 50, saleKind: 'sale', pendingConfirmation: false,
  ...values,
}) as unknown as DistSale
const receivable = (id: string, saleId: string, amount: number, paid: number, balance: number) => ({
  id, customerId: 'c1', customerName: customer.name, saleId, sourceType: 'sale', sourceDate: '2026-10-05', dayKey: '2026-10-05',
  routeId: 'r1', distributorUid: 'seller', distributorName: 'Vendedor', originalAmount: amount, paidAmount: paid, balance, status: balance ? 'PARTIAL' : 'PAID',
  createdAt: '2026-10-05T12:00:00.000Z', pendingConfirmation: false,
}) as unknown as DistReceivable
const baseData = (): CustomerFullHistoryData => ({ sales: [], saleCorrections: [], receivables: [], collections: [], receivableAdjustments: [], unlinkedNameMatches: [] })
const equal = (actual: unknown, expected: unknown, message: string) => { if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`) }
const deepEqual = (actual: unknown, expected: unknown, message: string) => { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`) }

const data = baseData()
data.sales = [
  sale('s1', '2026-10-05', { total: 150, cashAmount: 0, qrAmount: 0, creditAmount: 150, paymentKind: 'credit', latestCorrectionId: 'corr1', effectiveSnapshot: { lines: [], total: 140, cashAmount: 0, qrAmount: 0, creditAmount: 140, paymentKind: 'credit' } }),
  sale('s2', '2026-10-12'),
  sale('cash', '2026-10-14', { total: 70, cashAmount: 70, qrAmount: 0, creditAmount: 0, paymentKind: 'cash' }),
  sale('void', '2026-10-15', { total: 80, cashAmount: 80, qrAmount: 0, creditAmount: 0, voidedAt: '2026-10-16T12:00:00Z', voidReason: 'Error de registro', effectiveSnapshot: { lines: [], total: 0, cashAmount: 0, qrAmount: 0, creditAmount: 0, paymentKind: 'cash' } }),
  sale('pending', '2026-10-18', { pendingConfirmation: true, total: 999 }),
]
data.saleCorrections = [{ id: 'corr1', saleId: 's1', sellerUid: 'seller', revision: 1, reason: 'Corrección de precio', createdAt: '2026-10-07T15:00:00.000Z', dayKey: '2026-10-07', original: { lines: [], total: 150, paymentKind: 'credit', cashAmount: 0, qrAmount: 0, creditAmount: 150 }, corrected: { lines: [], total: 140, paymentKind: 'credit', cashAmount: 0, qrAmount: 0, creditAmount: 140 }, stockDeltas: [], moneyDelta: -10, creditDelta: -10, correctedByName: 'Administración' } as unknown as DistSaleCorrection,
  { id: 'corrvoid', saleId: 'void', sellerUid: 'seller', revision: 1, kind: 'void', reason: 'Error de registro', createdAt: '2026-10-16T12:00:00.000Z', dayKey: '2026-10-16', original: { lines: [], total: 80, paymentKind: 'cash', cashAmount: 80, qrAmount: 0, creditAmount: 0 }, corrected: { lines: [], total: 0, paymentKind: 'cash', cashAmount: 0, qrAmount: 0, creditAmount: 0 }, stockDeltas: [], moneyDelta: -80, creditDelta: 0, correctedByName: 'Admin' } as unknown as DistSaleCorrection,
]
data.receivables = [receivable('s1', 's1', 140, 100, 40), receivable('s2', 's2', 50, 0, 50)]
data.collections = [{ id: 'pay1', customerId: 'c1', customerName: customer.name, routeId: 'r1', collectedByUid: 'seller', collectedByName: 'Vendedor', operationId: 'pay1', amount: 100, cashAmount: 60, qrAmount: 40, method: 'mixed', allocations: [{ receivableId: 's1', amount: 100 }], createdAt: '2026-10-08T13:00:00.000Z', dayKey: '2026-10-08', pendingConfirmation: false } as never,
  { id: 'pendingPay', customerId: 'c1', customerName: customer.name, routeId: 'r1', collectedByUid: 'seller', collectedByName: 'Vendedor', operationId: 'pendingPay', amount: 500, method: 'cash', createdAt: '2026-10-09T13:00:00.000Z', dayKey: '2026-10-09', pendingConfirmation: true } as never]

const computed = summarizeCustomerHistory({ customer, data, routes: [{ id: 'r1', name: 'Norte', kind: 'route', active: true, restaurantId: 'sanjose', createdAt: '' }], range: { from: '2026-10-01', to: '2026-10-31' } })
equal(computed.summary.totalBought, 310, 'Las compras vigentes excluyen la anulada y la pendiente; incluye el valor corregido')
equal(computed.summary.purchaseCount, 3, 'Conteo de compras')
equal(computed.summary.voidedSalesCount, 1, 'Conteo de anulaciones')
equal(computed.summary.paidAtPurchase, 120, 'El contado/QR de compra no se mezcla con cobros posteriores')
equal(computed.summary.creditGenerated, 200, 'El crédito generado conserva el valor al originarse; la corrección se muestra separada')
equal(computed.summary.debtAdjustments, -10, 'La corrección de la venta aparece como ajuste neto separado')
equal(computed.summary.collectionsReceived, 100, 'El cobro mixto se cuenta una sola vez; el pendiente se excluye')
equal(computed.summary.currentBalance, 90, 'Saldo actual')
equal(computed.summary.endingBalance, 90, 'Saldo final')
equal(computed.summary.balanceVerified, true, 'Saldo conciliado')
equal(computed.filteredAccountEvents.filter(event => event.id === 'payment-pay1').length, 1, 'Un pago asignado FIFO a una deuda aparece una sola vez')
equal(computed.filteredAccountEvents.find(event => event.id === 'sale-s2')?.charge, 50, 'Solo la porción a crédito del movimiento modifica el saldo')
equal(computed.filteredAccountEvents.find(event => event.id === 'sale-cash')?.charge, 0, 'La compra al contado es informativa y no modifica el saldo de crédito')

const mismatch = baseData()
mismatch.receivables = [receivable('s1', 'missing-sale', 70, 0, 40)]
const mismatchResult = buildCustomerAccountEvents({ customer, data: mismatch, routes: [] })
equal(mismatchResult.balanceVerified, false, 'Un saldo que no se puede reconstruir se señala')

equal(customerHistoryDayKey('2026-10-26T02:30:00.000Z'), '2026-10-25', 'Los instantes se convierten a jornada Bolivia')
deepEqual(customerHistoryRange('yesterday', new Date('2026-10-26T12:00:00-04:00')), { from: '2026-10-25', to: '2026-10-25' }, 'Filtro de ayer')
deepEqual(customerHistoryRange('previous-week', new Date('2026-10-26T12:00:00-04:00')), { from: '2026-10-19', to: '2026-10-25' }, 'Filtro de semana anterior')
deepEqual(customerHistoryRange('previous-month', new Date('2026-10-26T12:00:00-04:00')), { from: '2026-09-01', to: '2026-09-30' }, 'Filtro de mes anterior')
console.log('PASS customerFullHistory: compras, pagos, correcciones, anulaciones, saldo verificable y períodos Bolivia')
