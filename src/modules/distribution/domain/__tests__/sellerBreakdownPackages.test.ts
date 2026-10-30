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

const derivedLine: DistSale['lines'][number] = {
  ...sachet,
  productId: 'derived',
  quantity: 7,
  documentedPackageWeightKgSnapshot: 0.25,
  allocations: [{
    lotId: 'derived-lot', lotCode: 'D-1', expiresOn: '2027-01-01', quantity: 7, productionCost: 1.25,
    processingAllocation: {
      segmentId: 'segment-1', batchId: 'batch-1', destinationId: 'derived-lot', sourceMovementId: 'move-1',
      quantity: 7, physicalWeightG: 1700, costCents: 875, weightBasis: 'documented_average', allocationMethod: 'documented_average',
      physicalOriginConfirmed: false, sourceLocation: 'route', allocationOperationId: 'sale-derived',
    },
  }],
}
const derivedSale = baseSale('sale-derived', 'derived-seller', [derivedLine])
const derivedClaim = {
  ...claim, id: 'derived-return', saleId: 'sale-derived', sellerUid: 'derived-seller', productId: 'derived',
  quantity: 1,
  returnedProcessingAllocations: [{
    lotId: 'derived-lot', quantity: 1, weightG: 240, allocations: [{
      lotId: 'derived-lot', lotCode: 'D-1', expiresOn: '2027-01-01', quantity: 1, productionCost: 1.25,
      processingAllocation: { ...derivedLine.allocations![0].processingAllocation!, quantity: 1, physicalWeightG: 240, costCents: 125 },
    }],
  }],
} as DistClaim
const derivedResult = computeSellerBreakdown([derivedSale], [], [], [derivedClaim], [{ id: 'derived', unitType: 'package', documentedPackageWeightKg: 0.25 } as DistProduct])
const derivedSeller = derivedResult.find(row => row.sellerUid === 'derived-seller')!
assert(derivedSeller.packages === 6, 'una devolución derivada reduce la cantidad neta de paquetes')
assert(derivedSeller.documentedSachetKilograms === 1.46, 'el peso derivado usa gramos históricos asignados y gramos exactos devueltos, no el peso del catálogo')
const derivedCatalogChanged = computeSellerBreakdown([derivedSale], [], [], [], [{ id: 'derived', unitType: 'package', documentedPackageWeightKg: 0.4 } as DistProduct])
assert(derivedCatalogChanged.find(row => row.sellerUid === 'derived-seller')?.documentedSachetKilograms === 1.7, 'cambiar el peso configurado no altera gramos congelados de la venta derivada')

const unknownReturn = { ...derivedClaim, id: 'derived-return-unknown', returnedProcessingAllocations: undefined }
const unknownResult = computeSellerBreakdown([derivedSale], [], [], [unknownReturn], [{ id: 'derived', unitType: 'package', documentedPackageWeightKg: 0.25 } as DistProduct])
const unknownSeller = unknownResult.find(row => row.sellerUid === 'derived-seller')!
assert(unknownSeller.unknownWeightPackages === 6 && unknownSeller.documentedSachetKilograms === 0, 'devolución derivada sin gramos exactos mantiene el peso neto como desconocido')
const historicalWithoutSnapshot = baseSale('sale-old-weight', 'old-seller', [{ ...sachet, productId: 'old-pack', presentationSnapshot: 'Sachet', descriptionSnapshot: '', documentedPackageWeightKgSnapshot: undefined }])
const oldWeightResult = computeSellerBreakdown([historicalWithoutSnapshot], [], [], [], [{ id: 'old-pack', unitType: 'package', documentedPackageWeightKg: 0.4, approximateWeightKg: 0.22 } as DistProduct])
const oldWeightSeller = oldWeightResult.find(row => row.sellerUid === 'old-seller')!
assert(oldWeightSeller.documentedSachetKilograms === 0 && oldWeightSeller.estimatedSachetKilograms === 2.2, 'venta histórica sin snapshot no usa el peso maestro actual como si fuera histórico')

const priorDayReturn = {
  ...claim, id: 'prior-day-return', saleId: 'sale-yesterday', sellerUid: 'yesterday-seller', productId: 'bulk',
  productName: 'Granel', unitType: 'kg', quantity: 2, dayKey: '2026-10-29', createdAt: '2026-10-29T10:00:00.000Z',
} as DistClaim
const returnPeriodResult = computeSellerBreakdown([], [], [], [priorDayReturn], [])
const returnPeriodSeller = returnPeriodResult.find(row => row.sellerUid === 'yesterday-seller')!
assert(returnPeriodSeller.kilograms === -2, 'devolución de una venta anterior reduce los kg del período del movimiento sin reimportar la venta original')

const exactExchange = {
  ...claim, id: 'exchange-yesterday-sale', kind: 'exchange', saleId: 'sale-from-previous-period', sellerUid: 'exchange-seller',
  productId: 'old-derived', productName: 'Sachet original', unitType: 'package', quantity: 1,
  returnedProcessingAllocations: [{ lotId: 'old-lot', reservationId: 'old-reservation', quantity: 1, allocations: [{
    lotId: 'old-lot', lotCode: 'OLD', expiresOn: '2027-01-01', quantity: 1, productionCost: 1.25,
    processingAllocation: { ...derivedLine.allocations![0].processingAllocation!, quantity: 1, physicalWeightG: 250, costCents: 125 },
  }] }],
  replacement: { productId: 'replacement-derived', productName: 'Nuevo sachet', quantity: 1, unitType: 'package', total: 5,
    documentedPackageWeightKgSnapshot: 0.25, allocations: [{ lotId: 'replacement-lot', lotCode: 'NEW', expiresOn: '2027-01-01', quantity: 1, productionCost: 1.67,
      processingAllocation: { ...derivedLine.allocations![0].processingAllocation!, batchId: 'replacement-batch', segmentId: 'replacement-segment', quantity: 1, physicalWeightG: 333, costCents: 167 } }] },
} as DistClaim
const exactExchangeResult = computeSellerBreakdown([], [], [], [exactExchange], [
  { id: 'old-derived', unitType: 'package', approximateWeightKg: 0.1 } as DistProduct,
  { id: 'replacement-derived', unitType: 'package', approximateWeightKg: 0.25, documentedPackageWeightKg: 0.25 } as DistProduct,
])
const exactExchangeSeller = exactExchangeResult.find(row => row.sellerUid === 'exchange-seller')!
assert(exactExchangeSeller.packages === 0, 'un cambio de un sachet por otro no altera el total neto de paquetes')
assert(exactExchangeSeller.documentedSachetKilograms === 0.083, 'cambio en período usa 333 g persistidos en reemplazo menos 250 g devueltos, no el catálogo actual')
assert(exactExchangeSeller.estimatedSachetKilograms === 0, 'el peso estimado del catálogo no sustituye la asignación histórica del cambio')
console.log('PASS resumen por vendedor: granel, sachets exactos, estimados, devoluciones, anulaciones y peso ausente')
