import { buildCollectionReceiptPayload } from '../collectionReceiptPayload.ts'
import type { DistCollection } from '../../types.ts'

let passed = 0
const check = (condition: boolean, label: string) => { if (!condition) throw new Error(label); passed += 1; console.log(`PASS: ${label}`) }
const base: DistCollection = {
  id: 'col-abcdef', operationId: 'col-abcdef', restaurantId: 'sanjose', branchId: 'main', schemaVersion: 2,
  createdAt: '2026-10-09T14:00:00.000Z', createdBy: 'admin', dayKey: '2026-10-09', customerId: 'cliente', customerName: 'Cliente QA', customerCode: '1234567',
  routeId: 'administracion', collectedByUid: 'admin', collectedByName: 'Administración', amount: 100, method: 'cash', cashAmount: 100, qrAmount: 0,
  portfolioBalanceBefore: 300, portfolioBalanceAfter: 200,
  allocations: [{ receivableId: 'opening', amount: 100, sourceType: 'opening_balance' }],
}
const context = { companyName: 'Embutidos San José', routeName: 'Administración', distributorName: 'Administración' }

const opening = buildCollectionReceiptPayload(base, context)
check(opening.documentTitle === 'COMPROBANTE DE COBRO', 'el documento se identifica como comprobante de cobro')
check(opening.paymentDetails?.some(line => line.includes('SALDO ANTES: 300.00')) === true, 'saldo anterior conserva 300 antes')
check(opening.paymentDetails?.some(line => line.includes('SALDO RESTANTE: 200.00')) === true, 'saldo anterior conserva 200 después')
check(opening.items[0].name.includes('Deuda anterior'), 'saldo inicial se etiqueta sin inventar venta ni productos')

const fifo: DistCollection = { ...base, id: 'col-fifo12', amount: 150, cashAmount: 150, portfolioBalanceBefore: 300, portfolioBalanceAfter: 150, allocations: [
  { receivableId: 'sale-a', saleId: 'sale-a', amount: 100, sourceType: 'sale' },
  { receivableId: 'sale-b', saleId: 'sale-b', amount: 50, sourceType: 'sale' },
] }
const fifoPayload = buildCollectionReceiptPayload(fifo, context)
check(fifoPayload.items.length === 2 && fifoPayload.items[0].lineTotal === 100 && fifoPayload.items[1].lineTotal === 50, 'ticket muestra las dos aplicaciones FIFO')

const mixed: DistCollection = { ...base, id: 'col-mixed1', method: 'mixed', cashAmount: 60, qrAmount: 40 }
const mixedPayload = buildCollectionReceiptPayload(mixed, context)
check(Boolean(mixedPayload.paymentMethod === 'MIXTO' && mixedPayload.paymentDetails?.some(line => line === 'EFECTIVO: 60.00 Bs') && mixedPayload.paymentDetails?.some(line => line === 'QR: 40.00 Bs')), 'pago mixto conserva efectivo 60 y QR 40')

const historic: DistCollection = { ...base, id: 'col-old001', portfolioBalanceBefore: undefined, portfolioBalanceAfter: undefined }
const first = buildCollectionReceiptPayload(historic, context)
const second = buildCollectionReceiptPayload(historic, context)
check(JSON.stringify(first) === JSON.stringify(second), 'reimpresión conserva importe, fecha, medio y datos históricos')
check(first.paymentDetails?.includes('SALDO HISTÓRICO NO DISPONIBLE') === true, 'cobro antiguo no inventa saldos')
check(!JSON.stringify(first).toLowerCase().includes('comprobante de venta') && !JSON.stringify(first).toLowerCase().includes('productos vendidos'), 'ticket de cobro no se presenta como venta')
check(base.amount === 100 && base.portfolioBalanceBefore === 300 && base.portfolioBalanceAfter === 200, 'construir el ticket no altera cartera ni operación')

console.log(`${passed} comprobaciones de comprobantes de cobro aprobadas`)
