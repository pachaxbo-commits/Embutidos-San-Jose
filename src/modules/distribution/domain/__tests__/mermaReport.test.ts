import { computeMermaReport } from '../mermaReport.ts'
import type { DistClosure, DistLot, DistProduct, DistRoute, DistSale, DistStockMovement } from '../../types.ts'

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
  movement('ret-merma', 'return_merma', 0.08, { routeId: 'domingo-real', dispatchId: 'dispatch-d', centralDelta: 0.08 }),
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

const closureForReconciliation = (dispatchId: string, returnMerma: number, expectedReturn = 10.2): DistClosure => ({
  ...closure, id: `closure-${dispatchId}`, dispatchId, dayKey: '2026-10-19', status: 'closed',
  products: [{ productId: 'p', productName: product.name, unitType: 'kg', initialDispatch: expectedReturn - 0.2, additions: 0.2, totalLoaded: expectedReturn, sold: 0, expectedReturn, actualReturn: expectedReturn - returnMerma, returnMerma, physicalReturn: expectedReturn, variance: 0 }],
})
const lots: DistLot[] = [
  { id: 'pending-lot', restaurantId: 'sanjose', productId: 'p', productName: product.name, unitType: 'kg', lotCode: 'SOBRANTE POR REVISAR', manufacturedOn: '', expiresOn: '', productionCost: null, quantities: { central: 0.05 }, quarantined: true, createdAt: '', createdBy: 'admin' },
  { id: 'resolved-lot', restaurantId: 'sanjose', productId: 'p', productName: product.name, unitType: 'kg', lotCode: 'LOT-R', manufacturedOn: '', expiresOn: '', productionCost: 5, quantities: { central: 0 }, quarantined: false, createdAt: '', createdBy: 'admin', quarantineResolvedAt: '2026-10-20T12:00:00.000Z', quarantineResolution: 'released_existing_lot' },
  { id: 'discarded-lot', restaurantId: 'sanjose', productId: 'p', productName: product.name, unitType: 'kg', lotCode: 'LOT-D', manufacturedOn: '', expiresOn: '', productionCost: 5, quantities: { central: 0 }, quarantined: false, createdAt: '', createdBy: 'admin', quarantineResolvedAt: '2026-10-20T13:00:00.000Z', quarantineResolution: 'discarded' },
]
const fullReturnReport = computeMermaReport([
  movement('sent-merma', 'dispatch', 10.2, { routeId: 'domingo-real', refId: 'dispatch-full', dispatchMerma: 0.2, normalQuantity: 10 }),
  movement('returned-merma', 'return_merma', 0.2, { routeId: 'domingo-real', dispatchId: 'dispatch-full', centralDelta: 0.2 }),
], [product], routes, [closureForReconciliation('dispatch-full', 0.2)], { dayKeys: ['2026-10-19'] })
expect(fullReturnReport.consolidated.dispatchMermaSent.kg, 0.2, '10 normal + 0.2 merma contabiliza solo el componente merma enviado')
expect(fullReturnReport.consolidated.recoverableMermaRecordedAtWarehouse.kg, 0.2, 'Merma recuperable registrada por almacén')
expect(fullReturnReport.consolidated.recoverableMermaReturnedToStock.kg, 0.2, 'Merma confirmada en stock se cuenta una sola vez')
expect(fullReturnReport.byProduct[0]?.returnMermaStockConfirmed, 0.2, 'Acumulado por producto solo incluye reintegro confirmado')
expect(fullReturnReport.byDate[0]?.returnMermaStockConfirmed, 0.2, 'Acumulado por fecha distingue reintegro confirmado')
expect(fullReturnReport.byWeek[0]?.returnMermaStockConfirmed, 0.2, 'Acumulado semanal conserva la distinción')
expect(fullReturnReport.byMonth[0]?.returnMermaStockConfirmed, 0.2, 'Acumulado mensual conserva la distinción')
expect(fullReturnReport.consolidated.unreturnedNewMermaPending.kg, 0, 'Retorno idéntico deja cero merma pendiente')
expect(fullReturnReport.consolidated.byDispatchProduct[0]?.physicalReturn, 10.2, 'Conciliación conserva el total físico recibido')

const partialReturnReport = computeMermaReport([
  movement('sent-partial', 'dispatch', 10.2, { routeId: 'domingo-real', refId: 'dispatch-partial', dispatchMerma: 0.2, normalQuantity: 10 }),
  movement('returned-partial', 'return_merma', 0.1, { routeId: 'domingo-real', dispatchId: 'dispatch-partial', centralDelta: 0.1 }),
], [product], routes, [closureForReconciliation('dispatch-partial', 0.1)], { dayKeys: ['2026-10-19'] })
expect(partialReturnReport.consolidated.unreturnedNewMermaPending.kg, 0.1, 'Merma nueva parcialmente retornada queda pendiente, no pérdida')
expect(partialReturnReport.consolidated.confirmedUnfit.kg, 0, 'No convierte la merma restante en producto no apto')

const legacyPendingReport = computeMermaReport([
  movement('legacy-waste', 'dispatch_waste', 0.2, { routeId: 'domingo-real', dispatchId: 'legacy-dispatch', lossCost: 3 }),
  movement('legacy-return', 'return_merma', 0.08, { routeId: 'domingo-real', dispatchId: 'legacy-dispatch', centralDelta: 0.08 }),
], [product], routes, [closureForReconciliation('legacy-dispatch', 0.08)], { dayKeys: ['2026-10-19'] })
expect(legacyPendingReport.consolidated.legacyDispatchWastePending.kg, 0.2, 'dispatch_waste histórico no se reinterpreta por proximidad')
expect(legacyPendingReport.consolidated.legacyDispatchWasteCost.amount, 3, 'Costo histórico asociado se conserva aparte y en Bs')
expect(legacyPendingReport.consolidated.legacyWasteReturnDifferenceCandidate.kg, 0.12, 'Diferencia histórica se informa solo como cálculo aritmético no validado')
expect(legacyPendingReport.consolidated.byDispatchProduct[0]?.recoverableMermaRecordedAtWarehouse, 0.08, 'El filtro legacy conserva contexto de recepción vinculada')
expect(legacyPendingReport.consolidated.unreturnedNewMermaPending.kg, 0, 'No compensa legacy waste con return_merma sin prueba de vínculo semántico')

const overageReport = computeMermaReport([
  movement('over-pending', 'overage', 0.05, { routeId: 'domingo-real', dispatchId: 'dispatch-over', lotId: 'pending-lot' }),
  movement('over-resolved', 'overage', 0.03, { routeId: 'domingo-real', dispatchId: 'dispatch-over-2', lotId: 'resolved-lot' }),
  movement('over-discarded', 'overage', 0.02, { routeId: 'domingo-real', dispatchId: 'dispatch-over-3', lotId: 'discarded-lot' }),
], [product], routes, [], { dayKeys: ['2026-10-19'] }, [], [], lots)
expect(overageReport.consolidated.overagePendingReview.kg, 0.05, 'Cuarentena sin resolver se separa')
expect(overageReport.consolidated.overageResolved.kg, 0.05, 'Cuarentena resuelta se separa')
expect(overageReport.consolidated.overageReleasedToSellable.kg, 0.03, 'Solo liberaciones se clasifican como lotes vendibles')
expect(overageReport.consolidated.overageDiscarded.kg, 0.02, 'Descarte no se confunde con recuperación')
expect(overageReport.consolidated.overageStatusUnknown.kg, 0, 'Lotes vinculados permiten estado determinable')
expect(overageReport.rows.find(row => row.id === 'over-resolved')?.reviewState, 'quarantine_released', 'Sobrante liberado no se etiqueta como return_merma')
expect(overageReport.rows.find(row => row.id === 'over-discarded')?.reviewState, 'quarantine_discarded', 'Sobrante descartado queda explícito')
expect(overageReport.consolidated.byDispatchProduct.length, 3, 'Múltiples productos/despachos no colisionan por dispatchId')

const unconfirmedReturn = computeMermaReport([
  movement('return-no-central-entry', 'return_merma', 0.28, { routeId: 'domingo-real', dispatchId: 'return-unconfirmed', centralDelta: 0 }),
], [product], routes, [closureForReconciliation('return-unconfirmed', 0.28)], { dayKeys: ['2026-10-19'] })
expect(unconfirmedReturn.consolidated.recoverableMermaRecordedAtWarehouse.kg, 0.28, 'Conserva cuánto declaró recibir Almacén')
expect(unconfirmedReturn.consolidated.recoverableMermaReturnedToStock.kg, 0, 'No llama reintegrado al stock sin delta central positivo')
expect(unconfirmedReturn.consolidated.recoverableMermaStockGap.kg, 0.28, 'Diferencia de reintegro queda pendiente, no como pérdida')
expect(unconfirmedReturn.rows[0]?.reviewState, 'recorded_not_reintegrated', 'Movimiento sin entrada central no se etiqueta como recuperado')
expect(unconfirmedReturn.byProduct[0]?.returnMermaStockConfirmed, 0, 'Agrupación por producto no incluye retorno sin delta central')

const hugoOverageLot: DistLot = { ...lots[1]!, id: 'hugo-overage', lotCode: 'SOBRANTE POR REVISAR', quantities: { central: 0 }, quarantined: true, quarantineResolvedAt: '2026-10-22T14:30:16.488Z', quarantineResolution: 'released_existing_lot', quarantineResolvedQuantity: 0.28, quarantineDestinationLotCode: '171026', quarantineResolvedByName: 'Administración San José' }
const hugoClosure: DistClosure = { ...closureForReconciliation('hugo-dispatch', 0.28, 9), id: 'hugo-closure', routeId: 'route-norte', routeName: 'Zona Norte', distributorUid: 'hugo', distributorName: 'Hugo Herbas', products: [{ productId: 'p', productName: product.name, unitType: 'kg', initialDispatch: 9, additions: 0, totalLoaded: 9, sold: 0, expectedReturn: 9, actualReturn: 9, returnMerma: 0.28, physicalReturn: 9.28, variance: 0.28 }] }
const hugoReport = computeMermaReport([
  movement('hugo-overage-movement', 'overage', 0.28, { routeId: 'route-norte', dispatchId: 'hugo-dispatch', lotId: 'hugo-overage' }),
], [product], routes, [hugoClosure], { dayKeys: ['2026-10-19'] }, [], [], [hugoOverageLot])
expect(hugoReport.consolidated.recoverableMermaRecordedAtWarehouse.kg, 0.28, 'Caso Hugo conserva recepción anotada')
expect(hugoReport.consolidated.recoverableMermaReturnedToStock.kg, 0, 'Caso Hugo no inventa movimiento return_merma')
expect(hugoReport.consolidated.overageReleasedToSellable.kg, 0.28, 'Caso Hugo informa por separado sobrante luego liberado')
expect(hugoReport.rows[0]?.reviewState, 'quarantine_released', 'Caso Hugo muestra la resolución real de cuarentena')

const skuTwo: DistProduct = { ...product, id: 'sku-two', name: 'Viena económica' }
const separateSkuReport = computeMermaReport([
  movement('same-dispatch-p1', 'dispatch', 10.2, { productId: 'p', routeId: 'domingo-real', refId: 'same-dispatch', dispatchMerma: 0.2, normalQuantity: 10 }),
  movement('same-dispatch-p2', 'dispatch', 4.1, { productId: 'sku-two', productName: skuTwo.name, routeId: 'domingo-real', refId: 'same-dispatch', dispatchMerma: 0.1, normalQuantity: 4 }),
], [product, skuTwo], routes, [], { dayKeys: ['2026-10-19'] })
expect(separateSkuReport.consolidated.byDispatchProduct.length, 2, 'SKU distintos permanecen separados dentro del mismo despacho')
expect(separateSkuReport.consolidated.dispatchMermaSent.kg, 0.3, 'Consolidado agrega cantidades por unidad, sin colisión SKU')
console.log('PASS mermaReport.test.ts')
