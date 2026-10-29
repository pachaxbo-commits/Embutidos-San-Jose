import { computeSellerBreakdown } from '../engine.ts'
import type { DistClaim, DistProduct, DistSale } from '../../types.ts'

const baseSale = (id: string, sellerUid: string, lines: DistSale['lines'], extra: Partial<DistSale> = {}): DistSale => ({
  id, restaurantId: 'sanjose', branchId: 'main', createdAt: '2026-10-29T12:00:00.000Z', createdBy: sellerUid,
  dayKey: '2026-10-29', schemaVersion: 1, operationId: id, sourceLocation: 'route', routeId: `route-${sellerUid}`,
  routeName: 'Ruta', sellerUid, sellerName: sellerUid, lines, total: 500, paymentKind: 'cash', cashAmount: 500,
  qrAmount: 0, creditAmount: 0, ...extra,
})
const bulk = { productId: 'bulk', productNameSnapshot: 'Granel', unitType: 'kg' as const, quantity: 50, actualUnitPrice: 10, subtotal: 500 }
const sachet = { productId: 'pack', productNameSnapshot: 'Salchicha', presentationSnapshot: 'Sachet 250 g', unitType: 'package' as const, quantity: 10, actualUnitPrice: 3, subtotal: 30 }
const sales = [
  baseSale('sale-a', 'a', [bulk, sachet], { effectiveSnapshot: { lines: [bulk, sachet], total: 530, paymentKind: 'cash', cashAmount: 530, qrAmount: 0, creditAmount: 0, saleKind: 'sale' } }),
  baseSale('sale-b', 'b', [{ ...sachet, productId: 'approx', presentationSnapshot: 'Sachet', quantity: 3 }]),
  baseSale('sale-c', 'c', [{ ...sachet, productId: 'unknown', presentationSnapshot: 'Bolsa', quantity: 4 }]),
  baseSale('sale-void', 'a', [{ ...bulk, quantity: 99 }], { voidedAt: '2026-10-29T13:00:00.000Z' }),
]
const claim = { id: 'return-1', kind: 'return', saleId: 'sale-a', sellerUid: 'a', sellerName: 'a', customerId: 'customer', customerName: 'Cliente', productId: 'pack', productName: 'Salchicha', quantity: 2, unitType: 'package', reason: 'devolución', routeId: 'route-a', createdAt: '2026-10-29T14:00:00.000Z', dayKey: '2026-10-29', revenueDelta: -6, additionalCost: 0, debtReduction: 0, cashIn: 0, cashOut: 0, qrIn: 0, qrOut: 0, replacement: null } as DistClaim
const products = [
  { id: 'approx', approximateWeightKg: 0.2 } as DistProduct,
]
const result = computeSellerBreakdown(sales, [], [], [claim], products)
const a = result.find(row => row.sellerUid === 'a')!
const b = result.find(row => row.sellerUid === 'b')!
const c = result.find(row => row.sellerUid === 'c')!
const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message) }
assert(a.kilograms === 50 && a.documentedSachetKilograms === 2 && a.totalDocumentedKilograms === 52, 'granel + sachets documentados netos de la devolución')
assert(a.packages === 8 && a.unknownWeightPackages === 0, 'la devolución reduce los paquetes sin duplicarlos')
assert(b.estimatedSachetKilograms === 0.6 && b.totalDocumentedKilograms === 0 && b.totalEstimatedKilograms === 0.6, 'peso aproximado separado y marcado como estimado')
assert(c.packages === 4 && c.unknownWeightPackages === 4 && c.totalEstimatedKilograms === 0, 'sin peso fiable conserva paquetes y no inventa kg')
assert(!result.some(row => row.kilograms === 99), 'ventas anuladas quedan fuera')
console.log('PASS resumen por vendedor: granel, sachets exactos, estimados, devoluciones, anulaciones y peso ausente')
