import { buildCustomerCreditStatement, customerStatementFilename } from '../customerCreditStatement.ts'
import type { DistCollection, DistCustomer, DistReceivable, DistRoute } from '../../types.ts'

function equal(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) throw new Error(`${message}: esperado ${String(expected)}, recibido ${String(actual)}`)
}
function matches(actual: string, expected: RegExp, message: string) {
  if (!expected.test(actual)) throw new Error(`${message}: ${actual}`)
}

const customer = { id: 'customer-1', name: 'Ana Pérez', customerCode: 'C-001', identityNumber: '123' } as DistCustomer
const debt = (id: string, extra: Record<string, unknown> = {}) => ({
  id, restaurantId: 'r', branchId: 'b', createdAt: '2026-10-01T12:00:00.000Z', createdBy: 'admin', dayKey: '2026-10-01', schemaVersion: 1,
  customerId: 'customer-1', customerName: 'Ana Pérez', routeId: 'north', distributorUid: 'seller-north', distributorName: 'Hugo',
  originalAmount: 100, paidAmount: 40, balance: 60, status: 'PARTIAL', saleId: `sale-${id}`, sourceType: 'sale',
  saleLines: [{ productId: 'p1', productNameSnapshot: 'Chorizo', quantity: 2.5, unitType: 'kg', actualUnitPrice: 40, subtotal: 100 }],
  ...extra,
}) as unknown as DistReceivable

const receivables = [
  debt('active-north'),
  debt('active-south', { routeId: 'south', distributorUid: 'seller-south', distributorName: 'Ricardo', originalAmount: 50, paidAmount: 0, balance: 50, saleLines: undefined, sourceType: 'opening_balance', saleId: undefined }),
  debt('paid', { originalAmount: 25, paidAmount: 25, balance: 0, status: 'PAID' }),
  debt('void', { originalAmount: 90, paidAmount: 0, balance: 90, voided: true, voidReason: 'Duplicada' }),
  debt('pending', { balance: 5, pendingConfirmation: true }),
  debt('other-customer', { customerId: 'customer-2', balance: 900 }),
]
const collections = [
  { id: 'cash-1', customerId: 'customer-1', createdAt: '2026-10-02T10:00:00.000Z', amount: 20, method: 'cash', cashAmount: 20, qrAmount: 0, collectedByName: 'Cobranza 1', receivableId: 'active-north', routeId: 'north' },
  { id: 'mixed-1', customerId: 'customer-1', createdAt: '2026-10-03T10:00:00.000Z', amount: 20, method: 'mixed', cashAmount: 5, qrAmount: 15, collectedByName: 'Cobranza 2', allocations: [{ receivableId: 'active-north', amount: 20 }] },
  { id: 'pending-1', customerId: 'customer-1', createdAt: '2026-10-04T10:00:00.000Z', amount: 500, method: 'cash', pendingConfirmation: true },
  { id: 'other-customer-payment', customerId: 'customer-2', createdAt: '2026-10-04T10:00:00.000Z', amount: 900, method: 'cash' },
] as unknown as DistCollection[]
const adjustments = [{
  id: 'adjust-1', customerId: 'customer-1', receivableId: 'active-north', action: 'edit', effectiveAt: '2026-10-05T10:00:00.000Z', actorName: 'Admin', reason: 'Corrección auditada', previous: { originalAmount: 120 }, next: { originalAmount: 100 },
}, { id: 'other-adjust', customerId: 'customer-2', receivableId: 'x', action: 'edit', effectiveAt: '2026-10-05T10:00:00.000Z', reason: 'No incluir' }] as unknown as import('../../types.ts').DistReceivableAdjustment[]
const routes = [{ id: 'north', name: 'Zona Norte' }, { id: 'south', name: 'Zona Sud' }] as DistRoute[]

const statement = buildCustomerCreditStatement({
  customer,
  receivables,
  collections,
  adjustments,
  routes,
  salesById: new Map(),
  emittedAt: new Date('2026-10-20T18:00:00.000Z'),
})

equal(statement.currentDebts.length, 2, 'solo deudas vigentes del cliente, de distintas rutas')
equal(statement.currentDebts[0].route, 'Zona Norte', 'ruta Norte preservada')
equal(statement.currentDebts[1].route, 'Zona Sud', 'ruta Sud preservada')
equal(statement.currentDebts[1].products, 'Saldo anterior registrado; no corresponde a productos de una venta.', 'saldo anterior sin productos inventados')
equal(statement.pendingProducts.length, 1, 'productos agrupados solo desde créditos con saldo')
equal(statement.pendingProducts[0].quantity, 2.5, 'cantidad histórica de producto pendiente sin atribuir abonos al producto')
equal(statement.paidDebts.length, 1, 'deuda pagada separada de la cartera pendiente')
equal(statement.voidedDebts.length, 1, 'deuda anulada separada y no vigente')
equal(statement.outstandingTotal, 110, 'saldo pendiente suma solo deudas abiertas')
equal(statement.openingBalance, 50, 'saldos anteriores identificados por separado')
equal(statement.payments.length, 2, 'pagos confirmados del customerId sin mezclar clientes ni incluir pendientes')
equal(statement.paymentTotal, 40, 'total de pagos')
equal(statement.paymentCashTotal, 25, 'efectivo')
equal(statement.paymentQrTotal, 15, 'QR')
equal(statement.adjustments.length, 1, 'ajustes filtrados por customerId')
equal(statement.adjustments[0].reason, 'Corrección auditada', 'motivo auditado')
equal(statement.historicalProductDetailsMissing, 0, 'los saldos anteriores no requieren detalle de productos')
matches(customerStatementFilename('Ana Pérez / #1', 'customer-1', 'pdf'), /^SanJose-estado-cuenta-ana-perez-1-customer-1\.pdf$/, 'nombre seguro y específico')

console.log('PASS: cartera completa por ID, sin mezcla por nombres, filtros visuales, deudas pagadas/anuladas, historial de cobros y ajustes.')
