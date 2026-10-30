const assert = { equal(actual: unknown, expected: unknown, message?: string) { if (actual !== expected) throw new Error(`${message || 'assertion failed'}: ${String(actual)} !== ${String(expected)}`) } }
import { computeMoneySummary, computeSellerBreakdown, cashMovementRouteId, cashMovementSellerUid } from '../engine.ts'
import type { DistClaim, DistSale } from '../../types.ts'

const baseSale = (patch: Partial<DistSale> = {}) => ({
  id: 'sale-1', operationId: 'sale-1', restaurantId: 'sanjose', branchId: 'main', createdAt: '2026-10-28T10:00:00.000Z', createdBy: 'seller', dayKey: '2026-10-28', schemaVersion: 2,
  saleKind: 'sale', sourceLocation: 'centralWarehouse', routeId: 'administracion', routeName: 'Administración', sellerUid: 'admin', sellerName: 'Administración', lines: [], total: 10, paymentKind: 'cash', cashAmount: 10, qrAmount: 0, creditAmount: 0,
  ...patch,
} as DistSale)
const voidClaim = (patch: Partial<DistClaim> = {}) => ({
  id: 'void-1', kind: 'return', isDerivedSaleVoid: true, saleId: 'sale-1', sellerUid: 'admin', sellerName: 'Administración', saleSellerUid: 'admin', customerId: 'c1', customerName: 'Cliente', productId: 'p1', productName: 'Producto', quantity: 0, unitType: 'package', reason: 'anulación', routeId: 'administracion', createdAt: '2026-10-28T11:00:00.000Z', createdBy: 'admin', dayKey: '2026-10-28', revenueDelta: 0, additionalCost: 0, debtReduction: 0, cashIn: 0, cashOut: 10, qrIn: 0, qrOut: 0, replacement: null, cashRefundStatus: 'executed', cashMovementResponsibleUid: 'admin', cashMovementResponsibleName: 'Administración', cashMovementRouteId: 'administracion', ...patch,
} as DistClaim)
const snapshot = (cashAmount: number, qrAmount: number) => ({ cashAmount, qrAmount, saleDayKey: '2026-10-28', saleCreatedAt: '2026-10-28T10:00:00.000Z' })
const sameDaySale = baseSale({ voidedAt: '2026-10-28T11:00:00.000Z', effectiveSnapshot: { lines: [], total: 0, paymentKind: 'cash', cashAmount: 0, qrAmount: 0, creditAmount: 0, saleKind: 'sale' }, derivedVoid: { cashReceiptSnapshot: snapshot(10, 0) } })
const sameDayClaim = voidClaim()
const sameDay = computeMoneySummary([sameDaySale], [], [], [sameDayClaim])
assert.equal(sameDay.cashSales, 0)
assert.equal(sameDay.voidedCashReceipts, 10)
assert.equal(sameDay.claimCash, -10)
assert.equal(sameDay.expectedCash, 0, 'same-day receipt and executed refund net to zero')

const priorSale = baseSale({ id: 'prior-sale', operationId: 'prior-sale', dayKey: '2026-10-27', createdAt: '2026-10-27T10:00:00.000Z', voidedAt: '2026-10-28T11:00:00.000Z', effectiveSnapshot: { lines: [], total: 0, paymentKind: 'cash', cashAmount: 0, qrAmount: 0, creditAmount: 0, saleKind: 'sale' }, derivedVoid: { cashReceiptSnapshot: snapshot(10, 0) } })
const laterClaim = voidClaim({ id: 'later-void', saleId: 'prior-sale', createdAt: '2026-10-28T11:00:00.000Z', dayKey: '2026-10-28' })
assert.equal(computeMoneySummary([priorSale], [], []).expectedCash, 10, 'original jornada preserves the actual receipt')
assert.equal(computeMoneySummary([], [], [], [laterClaim]).expectedCash, -10, 'later jornada records only the executed refund')

const qrSale = baseSale({ paymentKind: 'qr', cashAmount: 0, qrAmount: 10, voidedAt: '2026-10-28T11:00:00.000Z', effectiveSnapshot: { lines: [], total: 0, paymentKind: 'qr', cashAmount: 0, qrAmount: 0, creditAmount: 0, saleKind: 'sale' }, derivedVoid: { cashReceiptSnapshot: snapshot(0, 10) } })
const qrClaim = voidClaim({ cashOut: 0, qrOut: 10 })
const qrSummary = computeMoneySummary([qrSale], [], [], [qrClaim])
assert.equal(qrSummary.expectedCash, 0, 'QR receipt/refund never changes physical cash')
assert.equal(qrSummary.voidedQrReceipts, 10)
assert.equal(qrSummary.claimQr, -10)

const mixedSale = baseSale({ paymentKind: 'mixed', cashAmount: 6, qrAmount: 4, voidedAt: '2026-10-28T11:00:00.000Z', effectiveSnapshot: { lines: [], total: 0, paymentKind: 'mixed', cashAmount: 0, qrAmount: 0, creditAmount: 0, saleKind: 'sale' }, derivedVoid: { cashReceiptSnapshot: snapshot(6, 4) } })
const mixedClaim = voidClaim({ cashOut: 6, qrOut: 4 })
const mixed = computeMoneySummary([mixedSale], [], [], [mixedClaim])
assert.equal(mixed.expectedCash, 0, 'mixed refund reverses the actual cash part only in physical cash')
assert.equal(mixed.voidedCashReceipts, 6)
assert.equal(mixed.voidedQrReceipts, 4)
assert.equal(mixed.claimQr, -4)

const partialSale = baseSale({ id: 'partial-sale', operationId: 'partial-sale', cashAmount: 10 })
const partialClaim = voidClaim({ id: 'partial-return', saleId: 'partial-sale', isDerivedSaleVoid: false, cashOut: 3, qrOut: 0, cashRefundStatus: undefined, routeId: 'administracion' })
assert.equal(computeMoneySummary([partialSale], [], [], [partialClaim]).expectedCash, 7, 'same-day partial refund subtracts only executed amount')
assert.equal(computeMoneySummary([], [], [], [partialClaim]).expectedCash, -3, 'later partial refund is attributed to its own period')
assert.equal(computeMoneySummary([partialSale], [], [], [{ ...partialClaim, cashOut: 3, cashRefundStatus: 'pending' }]).expectedCash, 10, 'pending refund is not counted as cash paid')
assert.equal(computeMoneySummary([partialSale], [], [], [{ ...partialClaim, cashOut: 3, pendingConfirmation: true }]).expectedCash, 10, 'unconfirmed refund is not counted as cash paid')

const correctedBeforeVoid = baseSale({ id: 'corrected-sale', operationId: 'corrected-sale', cashAmount: 10, voidedAt: '2026-10-28T12:00:00.000Z', effectiveSnapshot: { lines: [], total: 0, paymentKind: 'qr', cashAmount: 0, qrAmount: 0, creditAmount: 0, saleKind: 'sale' }, derivedVoid: { cashReceiptSnapshot: snapshot(0, 8) } })
assert.equal(computeMoneySummary([correctedBeforeVoid], [], [], [voidClaim({ cashOut: 0, qrOut: 8 })]).expectedCash, 0, 'a documented corrected payment split is reconciled from its frozen snapshot, not the stale base split')

const routeSale = baseSale({ id: 'route-sale', operationId: 'route-sale', routeId: 'route-a', routeName: 'Ruta A', sellerUid: 'seller-a', sellerName: 'Vendedor A', sourceLocation: 'route' })
const adminRefund = voidClaim({ createdBy: 'admin-1', sellerUid: 'admin-1', sellerName: 'Admin 1', cashMovementResponsibleUid: 'admin-1', cashMovementRouteId: 'administracion', routeId: 'administracion', saleSellerUid: 'seller-a', originRouteId: 'route-a' })
assert.equal(cashMovementRouteId(adminRefund), 'administracion', 'refund belongs to the box where Administration executed it')
assert.equal(cashMovementSellerUid(adminRefund), 'admin-1')
const sellerRows = computeSellerBreakdown([{ ...routeSale, voidedAt: '2026-10-28T11:00:00.000Z', derivedVoid: { cashReceiptSnapshot: snapshot(10, 0) } }], [], [], [adminRefund])
assert.equal(sellerRows.find(row => row.sellerUid === 'seller-a')?.expectedCash, 10, 'seller keeps responsibility for the original route receipt')
assert.equal(sellerRows.find(row => row.sellerUid === 'admin-1')?.expectedCash, -10, 'refund is assigned to the responsible administrator')

console.log('PASS cash movement reconciliation: same/later day, QR, mixed, partial, pending, corrected split, responsible route and seller attribution')


