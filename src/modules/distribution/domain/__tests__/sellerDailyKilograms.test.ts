import {
  computeSellerBreakdown,
  computeSellerDailyBreakdown,
  formatDayKeyToDate,
} from '../engine.ts'
import type { DistClaim, DistProduct, DistSale } from '../../types.ts'

const assert = (condition: unknown, message = '') => {
  if (!condition) throw new Error(message || 'Assertion failed')
}
const equal = (actual: unknown, expected: unknown, label = '') => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

const products: DistProduct[] = [
  { id: 'chorizo', name: 'Chorizo Parrillero', unitType: 'kg', active: true } as DistProduct,
  { id: 'salchicha', name: 'Salchicha Viena', unitType: 'kg', active: true } as DistProduct,
  { id: 'sachet-jamon', name: 'Sachet Jamón 250g', unitType: 'package', active: true, approximateWeightKg: 0.25, documentedPackageWeightKg: 0.25 } as DistProduct,
  { id: 'sachet-tocino', name: 'Sachet Tocino', unitType: 'package', active: true, approximateWeightKg: 0.3 } as DistProduct,
  { id: 'combo-sin-peso', name: 'Combo Promocional', unitType: 'package', active: true } as DistProduct,
]

const makeSale = (values: Partial<DistSale>): DistSale => ({
  id: 'sale', operationId: 'op', restaurantId: 'sanjose', branchId: 'main',
  schemaVersion: 1, sourceLocation: 'central',
  dayKey: '2026-10-28', createdAt: '2026-10-28T10:00:00.000Z', createdBy: 'hugo',
  sellerUid: 'hugo', sellerName: 'Hugo', routeId: 'norte', routeName: 'Zona Norte',
  total: 100, paymentKind: 'cash', cashAmount: 100, qrAmount: 0, creditAmount: 0, saleKind: 'sale',
  lines: [], ...values,
} as DistSale)

const sales: DistSale[] = [
  // Día 28/10/2026 - Chofer Hugo en Zona Norte
  makeSale({
    id: 'sale-1', dayKey: '2026-10-28', createdAt: '2026-10-28T10:00:00.000Z',
    sellerUid: 'hugo', sellerName: 'Hugo', routeId: 'norte', routeName: 'Zona Norte',
    lines: [
      { productId: 'chorizo', productNameSnapshot: 'Chorizo Parrillero', unitType: 'kg', quantity: 35.250, actualUnitPrice: 30, subtotal: 1057.5 },
      {
        productId: 'sachet-jamon', productNameSnapshot: 'Sachet Jamón 250g', unitType: 'package', quantity: 18, actualUnitPrice: 15, subtotal: 270,
        allocations: [{
          lotId: 'lot-1', lotCode: 'L1', expiresOn: '2026-12-31', quantity: 18, productionCost: 10,
          processingAllocation: { allocationOperationId: 'alloc-op-1', segmentId: 'seg-1', batchId: 'batch-1', destinationId: 'lot-1', sourceMovementId: 'mov-1', quantity: 18, physicalWeightG: 4500, costCents: 18000, weightBasis: 'documented_average', allocationMethod: 'documented_average', physicalOriginConfirmed: false, sourceLocation: 'central' },
        }],
      },
    ],
  }),
  // Día 29/10/2026 - Chofer Hugo en Zona Norte
  makeSale({
    id: 'sale-2', dayKey: '2026-10-29', createdAt: '2026-10-29T11:00:00.000Z',
    sellerUid: 'hugo', sellerName: 'Hugo', routeId: 'norte', routeName: 'Zona Norte',
    lines: [
      { productId: 'chorizo', productNameSnapshot: 'Chorizo Parrillero', unitType: 'kg', quantity: 42.000, actualUnitPrice: 30, subtotal: 1260 },
      {
        productId: 'sachet-jamon', productNameSnapshot: 'Sachet Jamón 250g', unitType: 'package', quantity: 20, actualUnitPrice: 15, subtotal: 300,
        allocations: [{
          lotId: 'lot-2', lotCode: 'L2', expiresOn: '2026-12-31', quantity: 20, productionCost: 10,
          processingAllocation: { allocationOperationId: 'alloc-op-2', segmentId: 'seg-2', batchId: 'batch-2', destinationId: 'lot-2', sourceMovementId: 'mov-2', quantity: 20, physicalWeightG: 5000, costCents: 20000, weightBasis: 'documented_average', allocationMethod: 'documented_average', physicalOriginConfirmed: false, sourceLocation: 'central' },
        }],
      },
      // Sachets con peso estimado por catálogo (no documentado)
      { productId: 'sachet-tocino', productNameSnapshot: 'Sachet Tocino', unitType: 'package', quantity: 10, actualUnitPrice: 20, subtotal: 200 },
      // Paquete sin peso aproximado ni documentado
      { productId: 'combo-sin-peso', productNameSnapshot: 'Combo Promocional', unitType: 'package', quantity: 5, actualUnitPrice: 50, subtotal: 250 },
    ],
  }),
  // Día 29/10/2026 - Chofer Carlos en Zona Sur
  makeSale({
    id: 'sale-3', dayKey: '2026-10-29', createdAt: '2026-10-29T12:00:00.000Z',
    sellerUid: 'carlos', sellerName: 'Carlos', routeId: 'sur', routeName: 'Zona Sur',
    lines: [
      { productId: 'salchicha', productNameSnapshot: 'Salchicha Viena', unitType: 'kg', quantity: 15.500, actualUnitPrice: 35, subtotal: 542.5 },
    ],
  }),
  // Día 30/10/2026 - Chofer Hugo en Zona Norte
  makeSale({
    id: 'sale-4', dayKey: '2026-10-30', createdAt: '2026-10-30T10:00:00.000Z',
    sellerUid: 'hugo', sellerName: 'Hugo', routeId: 'norte', routeName: 'Zona Norte',
    lines: [
      { productId: 'chorizo', productNameSnapshot: 'Chorizo Parrillero', unitType: 'kg', quantity: 30.000, actualUnitPrice: 30, subtotal: 900 },
      {
        productId: 'sachet-jamon', productNameSnapshot: 'Sachet Jamón 250g', unitType: 'package', quantity: 13, actualUnitPrice: 15, subtotal: 195,
        allocations: [{
          lotId: 'lot-3', lotCode: 'L3', expiresOn: '2026-12-31', quantity: 13, productionCost: 10,
          processingAllocation: { allocationOperationId: 'alloc-op-3', segmentId: 'seg-3', batchId: 'batch-3', destinationId: 'lot-3', sourceMovementId: 'mov-3', quantity: 13, physicalWeightG: 3250, costCents: 13000, weightBasis: 'documented_average', allocationMethod: 'documented_average', physicalOriginConfirmed: false, sourceLocation: 'central' },
        }],
      },
    ],
  }),
]

// Reclamación/devolución en día 30 sobre venta de día 28
const claims: DistClaim[] = [
  {
    id: 'claim-1', kind: 'return', saleId: 'sale-1', sellerUid: 'hugo', sellerName: 'Hugo',
    productId: 'chorizo', productName: 'Chorizo Parrillero', quantity: 2.000, unitType: 'kg',
    routeId: 'norte', createdAt: '2026-10-30T14:00:00.000Z', dayKey: '2026-10-30',
  } as DistClaim,
]

const days = ['2026-10-28', '2026-10-29', '2026-10-30']

console.log('--- TEST 1: Formato de fechas Bolivia ---')
equal(formatDayKeyToDate('2026-10-28'), '28/10/2026')
equal(formatDayKeyToDate('2026-10-29'), '29/10/2026')
equal(formatDayKeyToDate('2026-10-30'), '30/10/2026')
console.log('PASS formatDayKeyToDate')

console.log('--- TEST 2: Desglose diario por chofer y ruta ---')
const daily = computeSellerDailyBreakdown(days, sales, claims, products)
equal(daily.length, 3, 'debe haber 3 días con actividad')

// Día 28
const day28 = daily.find(d => d.dayKey === '2026-10-28')!
assert(day28, 'día 28 existe')
equal(day28.dateFormatted, '28/10/2026')
equal(day28.rows.length, 1)
const hugo28 = day28.rows[0]
equal(hugo28.sellerName, 'Hugo')
equal(hugo28.routeNames, ['Zona Norte'])
equal(hugo28.granelKilograms, 35.250)
equal(hugo28.documentedSachetKilograms, 4.500)
equal(hugo28.totalDocumentedKilograms, 39.750)
equal(day28.subtotal.totalDocumentedKilograms, 39.750)

// Día 29
const day29 = daily.find(d => d.dayKey === '2026-10-29')!
assert(day29, 'día 29 existe')
equal(day29.rows.length, 2, 'Hugo y Carlos vendieron el día 29')
const hugo29 = day29.rows.find(r => r.sellerUid === 'hugo')!
equal(hugo29.granelKilograms, 42.000)
equal(hugo29.documentedSachetKilograms, 5.000)
equal(hugo29.totalDocumentedKilograms, 47.000)
equal(hugo29.estimatedSachetKilograms, 3.000, '10 paquetes × 0.3 kg estimado separado')
equal(hugo29.totalEstimatedKilograms, 50.000)
equal(hugo29.unknownWeightPackages, 5, '5 paquetes sin peso no se convierten a kg')

const carlos29 = day29.rows.find(r => r.sellerUid === 'carlos')!
equal(carlos29.granelKilograms, 15.500)
equal(carlos29.totalDocumentedKilograms, 15.500)
equal(day29.subtotal.totalDocumentedKilograms, 62.500, '47.000 + 15.500 = 62.500')

// Día 30 (Hugo vende 30 kg granel + 3.250 kg sachets, pero hay devolución de 2 kg granel)
const day30 = daily.find(d => d.dayKey === '2026-10-30')!
assert(day30, 'día 30 existe')
const hugo30 = day30.rows.find(r => r.sellerUid === 'hugo')!
equal(hugo30.granelKilograms, 28.000)
equal(hugo30.documentedSachetKilograms, 3.250)
equal(hugo30.totalDocumentedKilograms, 31.250)
equal(day30.subtotal.totalDocumentedKilograms, 31.250)
console.log('PASS desglose diario coincide con los números y distinciones por tipo')

console.log('--- TEST 3: La suma diaria coincide exactamente con el total del período ---')
const period = computeSellerBreakdown(sales, [], [], claims, products)
const periodHugo = period.find(s => s.sellerUid === 'hugo')!

const sumDailyHugoGranel = Math.round((hugo28.granelKilograms + hugo29.granelKilograms + hugo30.granelKilograms) * 1000) / 1000
const sumDailyHugoDocSachet = Math.round((hugo28.documentedSachetKilograms + hugo29.documentedSachetKilograms + hugo30.documentedSachetKilograms) * 1000) / 1000
const sumDailyHugoTotalDoc = Math.round((hugo28.totalDocumentedKilograms + hugo29.totalDocumentedKilograms + hugo30.totalDocumentedKilograms) * 1000) / 1000

equal(sumDailyHugoGranel, periodHugo.kilograms, 'Suma diaria granel Hugo coincide con total mensual')
equal(sumDailyHugoDocSachet, periodHugo.documentedSachetKilograms, 'Suma diaria sachets Hugo coincide con total mensual')
equal(sumDailyHugoTotalDoc, periodHugo.totalDocumentedKilograms, 'Suma diaria total doc Hugo coincide con total mensual')

const totalPeriodDoc = Math.round(period.reduce((sum, s) => sum + s.totalDocumentedKilograms, 0) * 1000) / 1000
const totalDailyDoc = Math.round(daily.reduce((sum, d) => sum + d.subtotal.totalDocumentedKilograms, 0) * 1000) / 1000
equal(totalDailyDoc, totalPeriodDoc, 'Total general diario coincide exactamente con total mensual')
console.log('PASS la suma diaria coincide con el total del período')

console.log('--- TEST 4: Filtros por chofer y por ruta ---')
const hugoOnly = computeSellerDailyBreakdown(days, sales, claims, products, '', 'hugo')
assert(hugoOnly.every(d => d.rows.every(r => r.sellerUid === 'hugo')), 'filtro chofer solo devuelve Hugo')

const surOnly = computeSellerDailyBreakdown(days, sales, claims, products, 'sur', '')
equal(surOnly.length, 1, 'solo día 29 tiene ruta sur')
equal(surOnly[0].rows[0].sellerUid, 'carlos')

const hoyOnly = computeSellerDailyBreakdown(['2026-10-28'], sales, claims, products)
equal(hoyOnly.length, 1)
equal(hoyOnly[0].dayKey, '2026-10-28')
console.log('PASS filtros de chofer, ruta y jornada individual funcionan correctamente')

console.log('ALL SELLER DAILY KILOGRAM TESTS PASSED!')
