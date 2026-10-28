// Fase 3D.1: derived finished sachets move by location without enabling sales.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'

const req = createRequire(new URL('../../functions/package.json', import.meta.url))
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085'
const { initializeApp } = req('firebase-admin/app')
const { getFirestore } = req('firebase-admin/firestore')
const { processCommand } = req('./operations.cjs')
const projectId = 'demo-pachax-audit'
const app = initializeApp({ projectId }, 'qa-derived-dispatch')
const db = getFirestore(app)
const root = db.doc('restaurants/sanjose')
const env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8085, rules: fs.readFileSync('firebase/firestore.rules', 'utf8') } })
const prefix = `dd${Date.now().toString(36)}`
const ids = { admin: `${prefix}-admin`, warehouse: `${prefix}-warehouse`, seller: `${prefix}-seller`, otherSeller: `${prefix}-seller2`, thirdSeller: `${prefix}-seller3`, fourthSeller: `${prefix}-seller4`, fifthSeller: `${prefix}-seller5`, sixthSeller: `${prefix}-seller6`, product: `${prefix}-sachet`, source: `${prefix}-source`, courtesy: `${prefix}-courtesy`, route: `${prefix}-route`, route2: `${prefix}-route2`, route3: `${prefix}-route3`, route4: `${prefix}-route4`, route5: `${prefix}-route5`, route6: `${prefix}-route6`, warehouseId: `${prefix}-wh`, otherWarehouseId: `${prefix}-wh2` }
let checks = 0
const pass = (condition, message) => { assert.ok(condition, message); checks++; console.log(`PASS ${message}`) }
const authDb = uid => env.authenticatedContext(uid).firestore()
const read = async (col, id) => (await root.collection(col).doc(id).get()).data()
const command = async (actor, type, payload, operationId, expected = 'confirmed') => {
  const ref = root.collection('distOperations').doc(operationId)
  await setDoc(doc(authDb(actor), 'restaurants', 'sanjose', 'distOperations', operationId), { id: operationId, restaurantId: 'sanjose', createdBy: actor, createdAt: new Date().toISOString(), type, payload, status: 'queued' })
  await processCommand(db, ref)
  const value = (await ref.get()).data()
  if (expected) assert.equal(value.status, expected, `${type}: ${value.error || 'estado inesperado'}`)
  return { ...value, operationId }
}
const seedProduct = (id, unitType, cost) => root.collection('distProducts').doc(id).set({ id, restaurantId: 'sanjose', name: `QA ${id}`, unitType, active: true, productionCost: cost, referencePrice: 10 })
const seedLot = async (productId, lotId, location, quantity, cost) => {
  await root.collection('distLots').doc(lotId).set({ id: lotId, restaurantId: 'sanjose', productId, productName: `QA ${productId}`, unitType: 'kg', lotCode: `LOT-${lotId}`, manufacturedOn: '2026-10-10', expiresOn: '2027-10-10', productionCost: cost, quantities: { [location]: quantity } })
  const id = `${location}__${productId}`
  const ref = root.collection('distBalances').doc(id)
  const current = await ref.get()
  await ref.set({ id, restaurantId: 'sanjose', locationKind: location === 'central' ? 'central' : location.startsWith('route__') ? 'route' : 'warehouse', warehouseId: location.startsWith('warehouse__') ? location.slice(11) : 'central', routeId: location.startsWith('route__') ? location.slice(7) : '', productId, unitType: 'kg', quantity: Number(current.data()?.quantity || 0) + quantity })
}
const batchPayload = ({ batchId, sourceProductId, sourceLotId, sourceQuantity, inputWeightG, outputProductId, packageCount, outputWeightG, discardWeightG, lotCode }) => ({
  batchId, processType: 'bagging', sourceProductId, location: 'central', processingDate: '2026-10-28', inputWeightG,
  sourceAllocations: [{ lotId: sourceLotId, quantity: sourceQuantity, measuredNetWeightG: inputWeightG }],
  destinations: [
    { id: 'finished', kind: 'finished', productId: outputProductId, commercialQuantity: packageCount, netWeightG: outputWeightG, nominalWeightG: 250, weightBasis: 'documented_average', lotCode, manufacturedOn: '2026-10-28', packagedOn: '2026-10-28', expiresOn: '2027-01-10' },
    ...(discardWeightG ? [{ id: 'discard', kind: 'discard', netWeightG: discardWeightG, reason: 'Merma física ficticia de QA' }] : []),
  ],
  packagingMaterials: [], costComponents: [],
})

try {
  for (const [uid, role, extra] of [[ids.admin, 'admin', {}], [ids.warehouse, 'warehouse', { warehouseId: ids.warehouseId }], [ids.seller, 'distributor', { routeId: ids.route }], [ids.otherSeller, 'distributor', { routeId: ids.route2 }], [ids.thirdSeller, 'distributor', { routeId: ids.route3 }], [ids.fourthSeller, 'distributor', { routeId: ids.route4 }], [ids.fifthSeller, 'distributor', { routeId: ids.route5 }], [ids.sixthSeller, 'distributor', { routeId: ids.route6 }]]) await root.collection('members').doc(uid).set({ role, active: true, displayName: `QA ${uid}`, ...extra })
  for (const warehouseId of [ids.warehouseId, ids.otherWarehouseId]) await root.collection('distWarehouses').doc(warehouseId).set({ id: warehouseId, restaurantId: 'sanjose', active: true, name: `QA ${warehouseId}` })
  await seedProduct(ids.source, 'kg', 5)
  await seedProduct(ids.product, 'package', 999)
  await seedProduct(ids.courtesy, 'kg', 12)
  const sourceLot = `${prefix}-source-lot`
  await seedLot(ids.source, sourceLot, 'central', 10, 5)
  const batchId = `${prefix}-main-batch`
  const payload = batchPayload({ batchId, sourceProductId: ids.source, sourceLotId: sourceLot, sourceQuantity: 10, inputWeightG: 10000, outputProductId: ids.product, packageCount: 36, outputWeightG: 9000, discardWeightG: 1000, lotCode: `DER-${prefix}` })
  await command(ids.admin, 'confirmProcessingBatch', payload, `${prefix}-batch-op`)
  const batch = await read('distProcessingBatches', batchId)
  const derivedLotId = batch.result.derivedLots.find(row => row.destinationKind === 'finished').lotId
  const derivedLot = await read('distLots', derivedLotId)
  pass(derivedLot.processingByLocation.central.segments[0].remainingQuantity === 36 && derivedLot.processingByLocation.central.segments[0].remainingWeightG === 9000 && derivedLot.processingByLocation.central.segments[0].remainingCostCents === 4500, 'elaboración crea segmentos de lote por ubicación con 36 paquetes, 9.000 g y 4.500 centavos')

  const dispatchId = `${prefix}-dispatch`
  const dispatchPayload = { warehouseId: 'central', routeId: ids.route, routeName: 'QA Ruta', distributorUid: ids.seller, distributorName: 'QA Vendedor', warehouseResponsibleName: 'QA Almacén', lines: [{ productId: ids.product, productName: 'QA Sachets', unitType: 'package', quantity: 10, normalQuantity: 10, dispatchMerma: 0, allocationsRequested: [{ lotId: derivedLotId, quantity: 10 }] }] }
  await command(ids.admin, 'dispatch', dispatchPayload, dispatchId)
  let lot = await read('distLots', derivedLotId)
  pass(lot.quantities.central === 26 && lot.quantities[`route__${ids.route}`] === 10 && lot.processingByLocation.central.segments[0].remainingWeightG === 6500 && lot.processingByLocation[`route__${ids.route}`].segments[0].remainingWeightG === 2500 && lot.processingByLocation.central.segments[0].remainingCostCents === 3250 && lot.processingByLocation[`route__${ids.route}`].segments[0].remainingCostCents === 1250, 'despacho de 10 traslada exactamente 2.500 g y Bs 12,50; Almacén conserva 26, 6.500 g y Bs 32,50')
  const dispatchMovement = (await root.collection('distStockMovements').where('refId', '==', dispatchId).get()).docs.map(row => row.data()).find(row => row.type === 'dispatch')
  pass(dispatchMovement.physicalWeightG === 2500 && dispatchMovement.costCents === 1250 && dispatchMovement.processingAllocationMethod === 'documented_average_not_individual_measurement', 'Kardex de despacho conserva gramos, costo en centavos y etiqueta de asignación promedio documentada')

  const transferId = `${prefix}-transfer`
  await command(ids.admin, 'transfer', { from: 'central', to: ids.otherWarehouseId, line: { productId: ids.product, quantity: 4 }, note: 'QA traslado sachets' }, transferId)
  lot = await read('distLots', derivedLotId)
  const otherLocation = `warehouse__${ids.otherWarehouseId}`
  pass(lot.quantities.central === 22 && lot.quantities[otherLocation] === 4 && lot.processingByLocation.central.segments[0].remainingWeightG === 5500 && lot.processingByLocation[otherLocation].segments[0].remainingWeightG === 1000 && lot.processingByLocation.central.segments[0].remainingCostCents === 2750 && lot.processingByLocation[otherLocation].segments[0].remainingCostCents === 500, 'traslado entre almacenes conserva los paquetes, asigna 1.000 g y 500 centavos, sin gastar inventario')

  const correctionId = `${prefix}-correction`
  await command(ids.admin, 'correctDispatch', { dispatchId, reason: 'QA retorno de 4 paquetes no utilizados', changes: [{ targetType: 'initial', productId: ids.product, newQuantity: 6 }] }, correctionId)
  lot = await read('distLots', derivedLotId)
  pass(lot.quantities.central === 26 && lot.quantities[`route__${ids.route}`] === 6 && lot.quantities[otherLocation] === 4 && lot.processingPhysicalWeightGRemaining === 9000 && lot.processingCostCentsRemaining === 4500, 'corrección devuelve solo 4 paquetes a su asignación original; total restante 36, 9.000 g y 4.500 centavos')
  pass(lot.processingByLocation.central.segments[0].remainingWeightG === 6500 && lot.processingByLocation[`route__${ids.route}`].segments[0].remainingWeightG === 1500 && lot.processingByLocation[otherLocation].segments[0].remainingWeightG === 1000 && lot.processingByLocation.central.segments[0].remainingCostCents === 3250 && lot.processingByLocation[`route__${ids.route}`].segments[0].remainingCostCents === 750 && lot.processingByLocation[otherLocation].segments[0].remainingCostCents === 500, 'la devolución restaura la rebanada original de 1.000 g/500 centavos sin recalcular el resto')
  const movementCount = (await root.collection('distStockMovements').where('refId', '==', correctionId).get()).size
  await processCommand(db, root.collection('distOperations').doc(correctionId))
  pass((await root.collection('distStockMovements').where('refId', '==', correctionId).get()).size === movementCount, 'reintento del mismo operationId no duplica corrección ni movimientos')

  const saleAttempt = await command(ids.admin, 'sale', { sourceLocation: 'centralWarehouse', routeId: 'administracion', routeName: 'Administración', lines: [{ productId: ids.product, quantity: 1, actualUnitPrice: 10 }], cashAmount: 10, qrAmount: 0, creditAmount: 0, paymentKind: 'cash' }, `${prefix}-sale-attempt`, 'rejected')
  pass(saleAttempt.status === 'rejected' && (await read('distLots', derivedLotId)).quantities.central === 26, 'venta comercial permanece bloqueada después de habilitar movimientos logísticos')

  const centSource = `${prefix}-cent-source`, centSourceLot = `${prefix}-cent-source-lot`, centBatch = `${prefix}-cent-batch`
  await seedProduct(centSource, 'kg', 5.01)
  await seedLot(centSource, centSourceLot, 'central', 2, 5.01)
  const centPayload = batchPayload({ batchId: centBatch, sourceProductId: centSource, sourceLotId: centSourceLot, sourceQuantity: 2, inputWeightG: 2000, outputProductId: ids.product, packageCount: 3, outputWeightG: 1001, discardWeightG: 999, lotCode: `CENT-${prefix}` })
  await command(ids.admin, 'confirmProcessingBatch', centPayload, `${prefix}-cent-batch-op`)
  const centLotId = (await read('distProcessingBatches', centBatch)).result.derivedLots.find(row => row.destinationKind === 'finished').lotId
  const firstCent = await command(ids.admin, 'dispatch', { ...dispatchPayload, routeId: ids.route2, routeName: 'QA Ruta 2', distributorUid: ids.otherSeller, lines: [{ ...dispatchPayload.lines[0], quantity: 1, normalQuantity: 1, allocationsRequested: [{ lotId: centLotId, quantity: 1 }] }] }, `${prefix}-cent-dispatch-1`)
  const centMovement1 = (await root.collection('distStockMovements').where('refId', '==', firstCent.operationId).get()).docs.map(row => row.data()).find(row => row.type === 'dispatch')
  const secondCent = await command(ids.admin, 'addition', { dispatch: { id: `${prefix}-cent-dispatch-1` }, ...dispatchPayload, lines: [{ ...dispatchPayload.lines[0], quantity: 2, normalQuantity: 2, allocationsRequested: [{ lotId: centLotId, quantity: 2 }] }] }, `${prefix}-cent-dispatch-2`)
  const centMovement2 = (await root.collection('distStockMovements').where('type', '==', 'dispatch_addition').get()).docs.map(row => row.data()).find(row => row.allocations?.some(allocation => allocation.lotId === centLotId))
  const centLot = await read('distLots', centLotId)
  const centMovedWeight = [ids.route2, ids.route].reduce((sum, routeId) => sum + Number(centLot.processingByLocation[`route__${routeId}`]?.segments.reduce((n, segment) => n + segment.remainingWeightG, 0) || 0), 0)
  const centMovedCost = [ids.route2, ids.route].reduce((sum, routeId) => sum + Number(centLot.processingByLocation[`route__${routeId}`]?.segments.reduce((n, segment) => n + segment.remainingCostCents, 0) || 0), 0)
  pass(centMovement1.physicalWeightG + centMovement2.physicalWeightG === 1001 && centMovement1.costCents + centMovement2.costCents === 502 && centLot.processingPhysicalWeightGRemaining === 1001 && centLot.processingCostCentsRemaining === 502 && centMovedWeight === 1001 && centMovedCost === 502, '3 paquetes conservan exactamente 1.001 g y 502 centavos asignados al destino aunque gramos y costo no sean divisibles por paquete')
  pass(centMovement1.processingAllocationMethod === 'documented_average_not_individual_measurement' && centMovement2.processingAllocationMethod === 'documented_average_not_individual_measurement', 'asignaciones no divisibles se identifican como promedio contable, no como mediciones individuales')

  const unknownSource = `${prefix}-unknown-source`, unknownLot = `${prefix}-unknown-source-lot`, unknownBatchId = `${prefix}-unknown-batch`
  await seedProduct(unknownSource, 'kg', 100)
  await seedLot(unknownSource, unknownLot, 'central', 2, null)
  const unknownPayload = batchPayload({ batchId: unknownBatchId, sourceProductId: unknownSource, sourceLotId: unknownLot, sourceQuantity: 2, inputWeightG: 2000, outputProductId: ids.product, packageCount: 2, outputWeightG: 2000, discardWeightG: 0, lotCode: `UNK-${prefix}` })
  await command(ids.admin, 'confirmProcessingBatch', unknownPayload, `${prefix}-unknown-batch-op`)
  const unknownDerived = (await read('distProcessingBatches', unknownBatchId)).result.derivedLots[0].lotId
  const unknownDispatch = await command(ids.admin, 'dispatch', { ...dispatchPayload, routeId: ids.route3, routeName: 'QA Ruta 3', distributorUid: ids.thirdSeller, lines: [{ ...dispatchPayload.lines[0], quantity: 1, normalQuantity: 1, allocationsRequested: [{ lotId: unknownDerived, quantity: 1 }] }] }, `${prefix}-unknown-dispatch`)
  const unknownMovement = (await root.collection('distStockMovements').where('refId', '==', unknownDispatch.operationId).get()).docs.map(row => row.data()).find(row => row.type === 'dispatch')
  const unknownLotAfter = await read('distLots', unknownDerived)
  pass(unknownMovement.physicalWeightG === 1000 && unknownMovement.costCents === null && unknownLotAfter.processingCostCentsRemaining === null, 'lote con costo histórico desconocido conserva null durante el movimiento y en el Kardex')

  const protectedProduct = `${prefix}-protected-product`, protectedSourceLot = `${prefix}-protected-source-lot`, protectedBatchId = `${prefix}-protected-batch`
  await seedProduct(protectedProduct, 'kg', 2)
  await seedLot(protectedProduct, protectedSourceLot, 'central', 2, 2)
  const protectedPayload = batchPayload({ batchId: protectedBatchId, sourceProductId: protectedProduct, sourceLotId: protectedSourceLot, sourceQuantity: 2, inputWeightG: 2000, outputProductId: ids.product, packageCount: 2, outputWeightG: 2000, discardWeightG: 0, lotCode: `HOLD-${prefix}` })
  protectedPayload.destinations[0].id = 'repack'
  protectedPayload.destinations[0].kind = 'repack_pending'
  protectedPayload.destinations[0].reason = 'Pendiente de reenvasado en QA'
  await command(ids.admin, 'confirmProcessingBatch', protectedPayload, `${prefix}-protected-batch-op`)
  const protectedDerived = (await read('distProcessingBatches', protectedBatchId)).result.derivedLots[0].lotId
  const blocked = await command(ids.admin, 'dispatch', { ...dispatchPayload, lines: [{ ...dispatchPayload.lines[0], quantity: 1, normalQuantity: 1, allocationsRequested: [{ lotId: protectedDerived, quantity: 1 }] }] }, `${prefix}-repack-dispatch`, 'rejected')
  pass(blocked.status === 'rejected' && (await read('distLots', protectedDerived)).quantities.central === 2, 'repack_pending no se puede despachar y el rechazo no causa escrituras parciales')

  const holdSource = `${prefix}-hold-source`, holdSourceLot = `${prefix}-hold-source-lot`, holdBatchId = `${prefix}-courtesy-review-batch`
  await seedProduct(holdSource, 'kg', 2)
  await seedLot(holdSource, holdSourceLot, 'central', 2, 2)
  const holdPayload = batchPayload({ batchId: holdBatchId, sourceProductId: holdSource, sourceLotId: holdSourceLot, sourceQuantity: 2, inputWeightG: 2000, outputProductId: ids.product, packageCount: 1, outputWeightG: 1000, discardWeightG: 0, lotCode: `HOLD2-${prefix}` })
  holdPayload.destinations = [
    { ...holdPayload.destinations[0], id: 'courtesy-hold', kind: 'courtesy', commercialQuantity: 1, netWeightG: 1000, qualityConfirmed: true, qualityReason: 'Control de QA confirmado', reason: 'Reservado para cortesía' },
    { id: 'review-hold', kind: 'review_hold', productId: ids.product, commercialQuantity: 1, netWeightG: 1000, weightBasis: 'measured_total', lotCode: `REVIEW-${prefix}`, manufacturedOn: '2026-10-28', packagedOn: '2026-10-28', expiresOn: '2027-01-10', reason: 'Pendiente de revisión QA' },
  ]
  await command(ids.admin, 'confirmProcessingBatch', holdPayload, `${prefix}-courtesy-review-batch-op`)
  const holdDerivedRows = (await read('distProcessingBatches', holdBatchId)).result.derivedLots
  for (const [index, row] of holdDerivedRows.entries()) {
    const rejected = await command(ids.admin, 'dispatch', { ...dispatchPayload, routeId: index ? ids.route4 : ids.route3, routeName: 'QA Ruta reservada', distributorUid: index ? ids.fourthSeller : ids.thirdSeller, lines: [{ ...dispatchPayload.lines[0], quantity: 1, normalQuantity: 1, allocationsRequested: [{ lotId: row.lotId, quantity: 1 }] }] }, `${prefix}-held-${row.destinationKind}-dispatch`, 'rejected')
    pass(rejected.status === 'rejected' && (await read('distLots', row.lotId)).quantities.central === 1, `${row.destinationKind} permanece reservado y el despacho rechazado no crea movimientos parciales`)
  }

  const beforeInsufficient = await read('distLots', derivedLotId)
  const insufficient = await command(ids.admin, 'dispatch', { ...dispatchPayload, routeId: ids.route3, routeName: 'QA Ruta insuficiente', distributorUid: ids.thirdSeller, lines: [{ ...dispatchPayload.lines[0], quantity: 27, normalQuantity: 27, allocationsRequested: [{ lotId: derivedLotId, quantity: 27 }] }] }, `${prefix}-derived-insufficient`, 'rejected')
  pass(insufficient.status === 'rejected' && JSON.stringify(await read('distLots', derivedLotId)) === JSON.stringify(beforeInsufficient), 'despacho superior al paquete disponible se rechaza sin modificar lote ni balance')
  const routeBalance = await read('distBalances', `route__${ids.route}__${ids.product}`)
  const warehouseBalance = await read('distBalances', `${otherLocation}__${ids.product}`)
  const totalPhysical = Object.values(lot.quantities).reduce((sum, value) => sum + value, 0)
  const totalWeight = Object.values(lot.processingByLocation).flatMap(value => value.segments).reduce((sum, segment) => sum + segment.remainingWeightG, 0)
  const totalCost = Object.values(lot.processingByLocation).flatMap(value => value.segments).reduce((sum, segment) => sum + segment.remainingCostCents, 0)
  pass(totalPhysical === 36 && totalWeight === 9000 && totalCost === 4500 && routeBalance.quantity === 6 && warehouseBalance.quantity === 4, 'balances y lotes por ubicación concilian tras despacho, transferencia y corrección')

  const dispatchRace = await Promise.all([
    command(ids.admin, 'dispatch', { ...dispatchPayload, routeId: ids.route4, routeName: 'QA Concurrencia A', distributorUid: ids.fourthSeller, lines: [{ ...dispatchPayload.lines[0], quantity: 20, normalQuantity: 20, allocationsRequested: [{ lotId: derivedLotId, quantity: 20 }] }] }, `${prefix}-dispatch-race-a`, null),
    command(ids.admin, 'dispatch', { ...dispatchPayload, routeId: ids.route5, routeName: 'QA Concurrencia B', distributorUid: ids.fifthSeller, lines: [{ ...dispatchPayload.lines[0], quantity: 20, normalQuantity: 20, allocationsRequested: [{ lotId: derivedLotId, quantity: 20 }] }] }, `${prefix}-dispatch-race-b`, null),
  ])
  lot = await read('distLots', derivedLotId)
  const concurrentQuantity = Object.values(lot.quantities).reduce((sum, value) => sum + Number(value || 0), 0)
  const concurrentWeight = Object.values(lot.processingByLocation).flatMap(value => value.segments).reduce((sum, segment) => sum + segment.remainingWeightG, 0)
  const concurrentCost = Object.values(lot.processingByLocation).flatMap(value => value.segments).reduce((sum, segment) => sum + segment.remainingCostCents, 0)
  pass(dispatchRace.filter(operation => operation.status === 'confirmed').length === 1 && dispatchRace.filter(operation => operation.status === 'rejected').length === 1 && concurrentQuantity === 36 && concurrentWeight === 9000 && concurrentCost === 4500, 'despachos simultáneos desde el mismo lote serializan; uno se rechaza y paquetes, gramos y costo siguen conciliados')

  const multiLotDispatchId = `${prefix}-multi-derived-dispatch`
  const multiLotDispatch = await command(ids.admin, 'dispatch', { ...dispatchPayload, routeId: ids.route6, routeName: 'QA Lotes derivados mixtos', distributorUid: ids.sixthSeller, lines: [{ ...dispatchPayload.lines[0], quantity: 3, normalQuantity: 3, allocationsRequested: [{ lotId: derivedLotId, quantity: 2 }, { lotId: unknownDerived, quantity: 1 }] }] }, multiLotDispatchId)
  const multiLotMovement = (await root.collection('distStockMovements').where('refId', '==', multiLotDispatch.operationId).get()).docs.map(row => row.data()).find(row => row.type === 'dispatch')
  pass(multiLotMovement.processingAllocations.length === 2 && multiLotMovement.processingBatchIds.length === 2 && multiLotMovement.physicalWeightG === 1500 && multiLotMovement.costCents === null && multiLotMovement.processingAllocations.some(part => part.costCents === null), 'un despacho de dos lotes derivados conserva genealogía y gramos por asignación; costo global queda null si una fuente no tiene costo')

  const distributorOperationId = `${prefix}-distributor-dispatch-denied`
  await assertFails(setDoc(doc(authDb(ids.seller), 'restaurants', 'sanjose', 'distOperations', distributorOperationId), { id: distributorOperationId, restaurantId: 'sanjose', createdBy: ids.seller, createdAt: new Date().toISOString(), type: 'dispatch', payload: dispatchPayload, status: 'queued' }))
  pass(true, 'Firestore Rules impiden que distribuidores encolen movimientos de despacho')
  console.log(`processing derived dispatch emulator: ${checks} checks PASS`)
} finally {
  await env.cleanup()
  await app.delete()
}
