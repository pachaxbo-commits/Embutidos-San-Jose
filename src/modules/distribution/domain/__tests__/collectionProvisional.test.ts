import { buildCollectionReceiptPayload } from '../collectionReceiptPayload.ts'
import { buildProvisionalCollectionSnapshot } from '../provisionalCollection.ts'
import type { DistCollection, DistReceivable } from '../../types.ts'

let passed = 0
const check = (condition: boolean, label: string) => { if (!condition) throw new Error(label); passed += 1; console.log(`PASS: ${label}`) }
const receivable = (id: string, balance: number, sourceDate: string, extra: Partial<DistReceivable> = {}): DistReceivable => ({
  id, restaurantId: 'sanjose', branchId: 'main', schemaVersion: 2, createdAt: `${sourceDate}T12:00:00.000Z`, createdBy: 'admin', dayKey: sourceDate,
  customerId: 'laura', customerName: 'Laura Jacqueline Gonzales Sejas- LAURA TIKIPAYA', customerCode: '5062983', routeId: 'ruta-hugo',
  distributorUid: 'hugo', distributorName: 'Hugo', originalAmount: balance, paidAmount: 0, balance, status: 'OPEN', sourceDate,
  sourceType: 'sale', saleId: `sale-${id}`, ...extra,
})
const context = { companyName: 'Embutidos San José' }
const base = receivable('deuda-a', 1059.5, '2026-10-15')
const snapshot = buildProvisionalCollectionSnapshot([base], 50, '5062983')
check(snapshot.customerCode === '5062983', 'el snapshot inmediato incluye el CI local del cliente')
check(snapshot.portfolioBalanceBefore === 1059.5, 'el snapshot conserva el saldo de cartera antes del cobro')
check(snapshot.portfolioBalanceAfter === 1009.5, 'el snapshot calcula el saldo restante a centavos')
check(snapshot.allocations?.length === 1 && snapshot.allocations[0].amount === 50, 'el cobro de una deuda genera su asignación FIFO exacta')

const immediate: DistCollection = {
  ...snapshot, id: 'col-regression', operationId: 'col-regression', restaurantId: 'sanjose', branchId: 'main', schemaVersion: 2,
  createdAt: '2026-10-15T16:00:00.000Z', createdBy: 'hugo', dayKey: '2026-10-15', customerId: 'laura', customerName: base.customerName,
  routeId: 'ruta-hugo', collectedByUid: 'hugo', collectedByName: 'Hugo', amount: 50, method: 'cash', cashAmount: 50, qrAmount: 0,
}
const confirmed: DistCollection = { ...immediate }
const immediatePayload = buildCollectionReceiptPayload(immediate, context)
const confirmedPayload = buildCollectionReceiptPayload(confirmed, context)
check(immediatePayload.customerPhone === 'CI/CÓDIGO: 5062983', 'comprobante inmediato imprime CI/código')
check(immediatePayload.paymentDetails?.some(line => line.includes('SALDO ANTES: 1059.50')) === true, 'comprobante inmediato muestra saldo previo real')
check(immediatePayload.paymentDetails?.some(line => line.includes('SALDO RESTANTE: 1009.50')) === true, 'comprobante inmediato muestra saldo restante real')
check(JSON.stringify(immediatePayload.items) === JSON.stringify(confirmedPayload.items) && JSON.stringify(immediatePayload.paymentDetails) === JSON.stringify(confirmedPayload.paymentDetails), 'comprobante provisional coincide con el confirmado en montos y FIFO')

const first = receivable('deuda-a', 30, '2026-10-01', { saleLines: [{ productId: 'chorizo', productNameSnapshot: 'Chorizo', quantity: 2, unitType: 'kg', actualUnitPrice: 50, subtotal: 100 }] as DistReceivable['saleLines'] })
const second = receivable('deuda-b', 100, '2026-10-02')
const fifo = buildProvisionalCollectionSnapshot([second, first], 50)
check(fifo.allocations?.length === 2 && fifo.allocations[0].receivableId === 'deuda-a' && fifo.allocations[0].amount === 30 && fifo.allocations[1].receivableId === 'deuda-b' && fifo.allocations[1].amount === 20, 'FIFO ordena por fecha y distribuye el cobro entre varias deudas')
check(fifo.allocations?.reduce((sum, allocation) => sum + allocation.amount, 0) === 50, 'las asignaciones FIFO suman exactamente el cobro')
check(fifo.saleLines?.[0]?.productNameSnapshot === 'Chorizo', 'el snapshot conserva líneas de venta de la primera deuda FIFO')
check(buildProvisionalCollectionSnapshot([base], 50).customerCode === base.customerCode, 'el CI usa la deuda como respaldo si falta en el catálogo local')

console.log(`${passed} comprobaciones del snapshot provisional de cobro aprobadas`)
