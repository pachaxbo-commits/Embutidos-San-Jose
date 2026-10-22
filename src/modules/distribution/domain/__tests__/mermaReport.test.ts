import { computeMermaReport } from '../mermaReport.ts'
import type { DistClosure, DistProduct, DistRoute, DistSale, DistStockMovement } from '../../types.ts'

const product: DistProduct = { id: 'p', name: 'Viena granel', category: 'Embutidos', unitType: 'kg', referencePrice: 10, active: true, sortOrder: 1, restaurantId: 'sanjose', createdAt: '2026-01-01T00:00:00.000Z' }
const routes: DistRoute[] = [
  { id: 'domingo-real', name: 'Domingo', kind: 'route', active: true, restaurantId: 'sanjose', createdAt: '' },
  { id: 'route-sud', name: 'Zona Sud', kind: 'route', active: true, restaurantId: 'sanjose', createdAt: '' },
]
const closure: DistClosure = {
  id: 'closure-d', restaurantId: 'sanjose', branchId: 'main', createdAt: '2026-10-19T20:00:00.000Z', createdBy: 'admin', dayKey: '2026-10-19', schemaVersion: 1,
  dispatchId: 'dispatch-d', routeId: 'domingo-real', routeName: 'Domingo', distributorUid: 'd1', distributorName: 'Domingo seller', status: 'closed', products: [],
  cashSales: 0, qrSales: 0, creditGenerated: 0, cashCollections: 0, qrCollections: 0, cashExpenses: 0, expectedCash: 0, cashDifference: 0,
}
function movement(id: string, type: DistStockMovement['type'], quantity: number, extra: Partial<DistStockMovement> = {}): DistStockMovement {
  return { id, restaurantId: 'sanjose', branchId: 'main', createdAt: '2026-10-19T17:00:00.000Z', createdBy: 'admin', dayKey: '2026-10-19', schemaVersion: 1, type, productId: 'p', productName: 'Viena granel', unitType: 'kg', quantity, centralDelta: 0, routeDelta: 0, ...extra }
}
const data = [
  movement('d-merma', 'dispatch', 82.5, { routeId: 'domingo-real', dispatchMerma: 2.5, normalQuantity: 80, refId: 'dispatch-d' }),
  movement('d-old-waste', 'dispatch_waste', 0.2, { routeId: 'domingo-real', lossCost: 3 }),
  movement('ret-merma', 'return_merma', 0.08, { routeId: 'domingo-real', dispatchId: 'dispatch-d' }),
  movement('unfit', 'return_waste', 0.1, { routeId: 'domingo-real', dispatchId: 'dispatch-d', lossCost: null, reason: 'Deteriorado' } as Partial<DistStockMovement>),
  movement('short', 'shortage', 0.235, { routeId: 'domingo-real', dispatchId: 'dispatch-d', lossCost: 10 }),
  movement('over', 'overage', 0.05, { routeId: 'domingo-real', dispatchId: 'dispatch-d' }),
  movement('rectified-over', 'overage', 13.5, { routeId: 'route-sacaba', dispatchId: 'dispatch-luciano', rectifiedAt: '2026-10-21T23:00:00.000Z', rectifiedByMovementId: 'rectification__0' }),
  movement('reversed', 'return_merma', 9, { routeId: 'domingo-real', reversedAt: '2026-10-20T00:00:00.000Z' }),
  movement('admin', 'dispatch', 1, { routeId: 'administracion', dispatchMerma: 0.9 }),
] as DistStockMovement[]
const sale = (id: string, linePatch: Partial<DistSale['lines'][number]> = {}, salePatch: Partial<DistSale> = {}): DistSale => ({
  id, restaurantId: 'sanjose', branchId: 'main', createdAt: '2026-10-19T18:00:00.000Z', createdBy: 'admin', dayKey: '2026-10-19', schemaVersion: 1,
  operationId: id, sourceLocation: 'centralWarehouse', routeId: 'administracion', routeName: 'Administración', sellerUid: 'admin-uid', sellerName: 'Administración San José',
  lines: [{ productId: 'p', productNameSnapshot: 'Viena granel', quantity: 2, physicalQuantity: 2.1, excessWeightQuantity: 0.1, unitType: 'kg', actualUnitPrice: 10, subtotal: 20, allocations: [{ lotId: 'lot-1', lotCode: 'LOT-1', expiresOn: '2026-12-31', quantity: 2.1, productionCost: 5 }], ...linePatch }],
  total: 20, paymentKind: 'cash', cashAmount: 20, qrAmount: 0, creditAmount: 0, ...salePatch,
})
const saleMovements = [
  movement('sale-admin-excess', 'sale', 2.1, { routeId: '', refId: 'sale-admin-excess', chargedQuantity: 2, excessWeightQuantity: 0.1 }),
  movement('sale-admin-corrected', 'sale', 2.1, { routeId: 'admin', refId: 'sale-admin-corrected', chargedQuantity: 2, excessWeightQuantity: 0.1 }),
  movement('sale-admin-voided', 'sale', 2.1, { routeId: 'administracion', refId: 'sale-admin-voided', chargedQuantity: 2, excessWeightQuantity: 0.1 }),
  movement('sale-domingo-excess', 'sale', 2.1, { routeId: 'domingo-real', refId: 'sale-domingo-excess', chargedQuantity: 2, excessWeightQuantity: 0.1 }),
  movement('sale-admin-normal', 'sale', 2, { routeId: 'administracion', refId: 'sale-admin-normal', chargedQuantity: 2 }),
  movement('sale-admin-removed-line', 'sale', 2.1, { routeId: 'administracion', refId: 'sale-admin-removed-line', chargedQuantity: 2, excessWeightQuantity: 0.1 }),
]
const sales = [
  sale('sale-admin-excess'),
  sale('sale-admin-corrected', { quantity: 1.9, physicalQuantity: 2.1, excessWeightQuantity: 0.2, subtotal: 19 }),
  sale('sale-admin-voided', {}, { voidedAt: '2026-10-19T19:00:00.000Z' }),
  sale('sale-domingo-excess', {}, { routeId: 'domingo-real', routeName: 'Domingo' }),
  sale('sale-admin-normal', { quantity: 2, physicalQuantity: undefined, excessWeightQuantity: undefined }),
  sale('sale-admin-removed-line', {}, { effectiveSnapshot: { lines: [], total: 0, paymentKind: 'cash', cashAmount: 0, qrAmount: 0, creditAmount: 0, saleKind: 'sale' } }),
] as DistSale[]
const report = computeMermaReport(data, [product], routes, [closure], { dayKeys: ['2026-10-19'] })
const expect = (value: unknown, wanted: unknown, name: string) => { if (value !== wanted) throw new Error(`${name}: esperado ${wanted}, recibido ${value}`) }
expect(report.totals.dispatch_merma.kg, 3.4, 'Merma despacho cuenta componentes sin duplicar el total físico')
expect(report.totals.dispatch_waste.kg, 0.2, 'Pérdida histórica despacho conserva categoría')
expect(report.totals.return_merma.kg, 0.08, 'Merma recuperable no se pierde')
expect(report.totals.unfit.kg, 0.1, 'No apto separado')
expect(report.totals.shortage.kg, 0.235, 'Faltante separado')
expect(report.totals.overage.kg, 0.05, 'Sobrante separado')
expect(report.rows.some(row => row.id === 'reversed'), false, 'Movimientos revertidos excluidos')
expect(report.rows.some(row => row.id === 'rectified-over'), false, 'Sobrante original rectificado sigue auditable pero no integra cantidades vigentes')
expect(report.rows.find(row => row.id === 'unfit')?.lossCost, null, 'No inventa costo histórico')
expect(report.rows.find(row => row.id === 'admin')?.routeName, 'Administración', 'Administración separada de rutas')
expect(report.byRoute.find(row => row.routeId === 'domingo-real')?.dispatchMerma, 2.5, 'Ruta Domingo por separado')
expect(computeMermaReport(data, [product], routes, [closure], { dayKeys: ['2026-10-19'], routeId: 'domingo-real' }).totals.dispatch_merma.kg, 2.5, 'Filtro de Domingo excluye Impulsación/Admin')
expect(computeMermaReport(data, [product], routes, [closure], { dayKeys: ['2026-10-19'], routeId: 'domingo-real' }).rows.some(row => row.routeId === 'administracion'), false, 'Filtro Domingo excluye Administración')
expect(computeMermaReport(data, [product], routes, [closure], { dayKeys: ['2026-10-19'], distributorUid: 'unknown' }).rows.length, 0, 'Filtro distribuidor requiere atribución comprobada')
const excessReport = computeMermaReport([...data, ...saleMovements], [product], routes, [closure], { dayKeys: ['2026-10-19'] }, [], sales)
expect(excessReport.rows.filter(row => row.kind === 'admin_sale_excess').length, 2, 'Ventas administrativas activas con excedente, sin anuladas ni Domingo')
expect(excessReport.totals.admin_sale_excess.kg, 0.3, 'Excedentes vigentes usan corrección actual sin duplicar el movimiento original')
expect(excessReport.rows.find(row => row.id === 'sale-admin-corrected')?.chargedQuantity, 1.9, 'Cantidad cobrada refleja la venta corregida')
expect(excessReport.rows.find(row => row.id === 'sale-admin-corrected')?.physicalQuantity, 2.1, 'Cantidad física refleja la venta corregida')
expect(excessReport.rows.find(row => row.id === 'sale-admin-corrected')?.lossCost, 1, 'Costo informativo usa costo histórico de lote sin tratarlo como pérdida')
expect(excessReport.rows.find(row => row.id === 'sale-admin-excess')?.saleReference, 'sale-admin-excess', 'Referencia de venta legible y enlazada')
expect(excessReport.rows.some(row => row.id === 'sale-admin-voided'), false, 'Venta anulada excluida')
expect(excessReport.rows.some(row => row.id === 'sale-domingo-excess'), false, 'Venta de ruta Domingo no se clasifica como venta administrativa')
expect(excessReport.rows.some(row => row.id === 'sale-admin-normal'), false, 'Venta normal sin excedente no aparece')
expect(excessReport.rows.some(row => row.id === 'sale-admin-removed-line'), false, 'Producto retirado por corrección no conserva excedente obsoleto')
expect(excessReport.byProduct[0]?.adminSaleExcess, 0.3, 'Acumulado por producto')
expect(excessReport.byDate.find(row => row.dayKey === '2026-10-19')?.adminSaleExcess, 0.3, 'Acumulado por fecha operativa')
expect(computeMermaReport([...data, ...saleMovements], [product], routes, [closure], { dayKeys: ['2026-10-19'], kind: 'admin_sale_excess' }, [], sales).rows.length, 2, 'Filtro de categoría exclusiva')
const mixedLotCostSale = sale('sale-mixed-cost', { allocations: [
  { lotId: 'lot-1', lotCode: 'LOT-1', expiresOn: '2026-12-31', quantity: 1, productionCost: 5 },
  { lotId: 'lot-2', lotCode: 'LOT-2', expiresOn: '2026-12-31', quantity: 1.1, productionCost: 6 },
] })
expect(computeMermaReport([movement('sale-mixed-cost', 'sale', 2.1, { refId: 'sale-mixed-cost' })], [product], routes, [], { dayKeys: ['2026-10-19'] }, [], [mixedLotCostSale]).rows[0]?.lossCost, null, 'No estima costo cuando las asignaciones tienen costos distintos')
console.log('PASS mermaReport.test.ts')
