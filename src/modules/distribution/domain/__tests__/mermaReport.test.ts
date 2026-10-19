import { computeMermaReport } from '../mermaReport.ts'
import type { DistClosure, DistProduct, DistRoute, DistStockMovement } from '../../types.ts'

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
  movement('reversed', 'return_merma', 9, { routeId: 'domingo-real', reversedAt: '2026-10-20T00:00:00.000Z' }),
  movement('admin', 'dispatch', 1, { routeId: 'administracion', dispatchMerma: 0.9 }),
] as DistStockMovement[]
const report = computeMermaReport(data, [product], routes, [closure], { dayKeys: ['2026-10-19'] })
const expect = (value: unknown, wanted: unknown, name: string) => { if (value !== wanted) throw new Error(`${name}: esperado ${wanted}, recibido ${value}`) }
expect(report.totals.dispatch_merma.kg, 3.4, 'Merma despacho cuenta componentes sin duplicar el total físico')
expect(report.totals.dispatch_waste.kg, 0.2, 'Pérdida histórica despacho conserva categoría')
expect(report.totals.return_merma.kg, 0.08, 'Merma recuperable no se pierde')
expect(report.totals.unfit.kg, 0.1, 'No apto separado')
expect(report.totals.shortage.kg, 0.235, 'Faltante separado')
expect(report.totals.overage.kg, 0.05, 'Sobrante separado')
expect(report.rows.some(row => row.id === 'reversed'), false, 'Movimientos revertidos excluidos')
expect(report.rows.find(row => row.id === 'unfit')?.lossCost, null, 'No inventa costo histórico')
expect(report.rows.find(row => row.id === 'admin')?.routeName, 'Administración', 'Administración separada de rutas')
expect(report.byRoute.find(row => row.routeId === 'domingo-real')?.dispatchMerma, 2.5, 'Ruta Domingo por separado')
expect(computeMermaReport(data, [product], routes, [closure], { dayKeys: ['2026-10-19'], routeId: 'domingo-real' }).totals.dispatch_merma.kg, 2.5, 'Filtro de Domingo excluye Impulsación/Admin')
expect(computeMermaReport(data, [product], routes, [closure], { dayKeys: ['2026-10-19'], routeId: 'domingo-real' }).rows.some(row => row.routeId === 'administracion'), false, 'Filtro Domingo excluye Administración')
expect(computeMermaReport(data, [product], routes, [closure], { dayKeys: ['2026-10-19'], distributorUid: 'unknown' }).rows.length, 0, 'Filtro distribuidor requiere atribución comprobada')
console.log('PASS mermaReport.test.ts')
