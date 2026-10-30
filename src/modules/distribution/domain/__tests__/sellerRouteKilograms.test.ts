import { computeSellerBreakdown, computeSellerKilogramsByProduct, computeSellerKilogramsByRoute } from '../engine.ts'
import type { DistClaim, DistProduct, DistSale } from '../../types.ts'
const equal = (actual: unknown, expected: unknown, label: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

const sale = (values: Partial<DistSale>) => ({
  id: 'sale', routeId: 'route-a', routeName: 'Ruta A', sellerUid: 'hugo', sellerName: 'Hugo',
  createdAt: '2026-10-30T12:00:00.000Z', dayKey: '2026-10-30', saleKind: 'sale', total: 10, cashAmount: 10, qrAmount: 0, creditAmount: 0,
  lines: [], ...values,
}) as DistSale
const products = [
  { id: 'sausage', name: 'Chorizo', unitType: 'package', approximateWeightKg: 0.5 } as DistProduct,
  { id: 'unknown', name: 'Paquete antiguo', unitType: 'package' } as DistProduct,
]
const sales = [
  sale({ id: 'a1', lines: [
    { productId: 'beef', productNameSnapshot: 'Carne', unitType: 'kg', quantity: 3, actualUnitPrice: 10, subtotal: 30 },
    { productId: 'sausage', productNameSnapshot: 'Chorizo', unitType: 'package', quantity: 2, actualUnitPrice: 5, subtotal: 10, documentedPackageWeightKgSnapshot: 0.25 },
    { productId: 'sausage', productNameSnapshot: 'Chorizo', unitType: 'package', quantity: 2, actualUnitPrice: 5, subtotal: 10 },
    { productId: 'unknown', productNameSnapshot: 'Paquete antiguo', unitType: 'package', quantity: 1, actualUnitPrice: 4, subtotal: 4 },
  ] }),
  sale({ id: 'a2', lines: [{ productId: 'beef', productNameSnapshot: 'Carne', unitType: 'kg', quantity: 1, actualUnitPrice: 10, subtotal: 10 }] }),
  sale({ id: 'b1', routeId: 'route-b', routeName: 'Ruta B', sellerUid: 'ana', sellerName: 'Ana', lines: [{ productId: 'beef', productNameSnapshot: 'Carne', unitType: 'kg', quantity: 2, actualUnitPrice: 10, subtotal: 20 }] }),
  sale({ id: 'voided', lines: [{ productId: 'beef', productNameSnapshot: 'Carne', unitType: 'kg', quantity: 99, actualUnitPrice: 10, subtotal: 990 }], voidedAt: '2026-10-30T13:00:00.000Z' }),
  sale({ id: 'courtesy', saleKind: 'courtesy', lines: [{ productId: 'beef', productNameSnapshot: 'Carne', unitType: 'kg', quantity: 88, actualUnitPrice: 10, subtotal: 880 }] }),
  sale({ id: 'pending', pendingConfirmation: true, lines: [{ productId: 'beef', productNameSnapshot: 'Carne', unitType: 'kg', quantity: 77, actualUnitPrice: 10, subtotal: 770 }] }),
]
const claims = [{ id: 'return-a2', saleId: 'a2', productId: 'beef', quantity: 0.5, unitType: 'kg', routeId: 'route-a', sellerUid: 'hugo', sellerName: 'Hugo', dayKey: '2026-10-30', kind: 'return' } as DistClaim]
const byRoute = computeSellerKilogramsByRoute(sales, claims, products)
const byProduct = computeSellerKilogramsByProduct(sales, claims, products)
const report = computeSellerBreakdown(sales.filter(row => row.routeId === 'route-a'), [], [], claims, products).find(row => row.sellerUid === 'hugo')!
equal(byRoute.get('route-a')?.granelKilograms, report.kilograms, 'route bulk matches seller report')
equal(byRoute.get('route-a')?.documentedSachetKilograms, report.documentedSachetKilograms, 'route documented sachets match seller report')
equal(byRoute.get('route-a')?.totalDocumentedKilograms, report.totalDocumentedKilograms, 'route total matches seller report')
equal(byRoute.get('route-a')?.estimatedSachetKilograms, report.estimatedSachetKilograms, 'route estimates match seller report')
equal(byRoute.get('route-a')?.unknownWeightPackages, report.unknownWeightPackages, 'route unknown weights match seller report')
equal(byRoute.get('route-a'), { granelKilograms: 3.5, documentedSachetKilograms: 0.5, totalDocumentedKilograms: 4, estimatedSachetKilograms: 1, unknownWeightPackages: 1 }, 'route A breakdown')
equal(byRoute.get('route-b'), { granelKilograms: 2, documentedSachetKilograms: 0, totalDocumentedKilograms: 2, estimatedSachetKilograms: 0, unknownWeightPackages: 0 }, 'route B breakdown')
equal(byProduct.find(row => row.productId === 'beef' && row.sellerUid === 'hugo')?.granelKilograms, 3.5, 'product beef reconciles the partial return')
equal(byProduct.find(row => row.productId === 'sausage' && row.sellerUid === 'hugo')?.documentedSachetKilograms, 0.5, 'documented package weight remains exact in product detail')
equal(byProduct.find(row => row.productId === 'sausage' && row.sellerUid === 'hugo')?.estimatedSachetKilograms, 1, 'catalog estimates stay separate in product detail')
equal(byProduct.find(row => row.productId === 'unknown' && row.sellerUid === 'hugo')?.unknownWeightPackages, 1, 'unknown package weight stays a package count')

const corrected = sales.map(row => row.id === 'a2' ? { ...row, effectiveSnapshot: { lines: [{ productId: 'beef', productNameSnapshot: 'Carne', unitType: 'kg', quantity: 2, actualUnitPrice: 10, subtotal: 20 }] } } as DistSale : row)
const correctedResult = computeSellerKilogramsByRoute(corrected, claims, products)
equal(correctedResult.get('route-a')?.granelKilograms, 4.5, 'effective correction is reflected in route total')
console.log('PASS Inicio y Reportes usan la misma base por chofer/ruta: granel, sachets, devolución, estimación, sin peso y exclusión de anuladas/cortesías/pendientes')
