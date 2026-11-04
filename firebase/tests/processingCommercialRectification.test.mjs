import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085'
process.env.FUNCTIONS_EMULATOR = 'true'
process.env.SANJOSE_DERIVED_SALES_EMULATOR_TEST = 'true'
const req = createRequire(new URL('../../functions/package.json', import.meta.url))
const { initializeApp } = req('firebase-admin/app')
const { getFirestore } = req('firebase-admin/firestore')
const { processCommand } = req('./operations.cjs')
const projectId = 'demo-pachax-audit'
const app = initializeApp({ projectId }, 'qa-processing-commercial-rectification')
const db = getFirestore(app)
const root = db.doc('restaurants/sanjose')
const env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8085, rules: fs.readFileSync('firebase/firestore.rules', 'utf8') } })
const prefix = `pcr${Date.now().toString(36)}`
const ids = { admin: `${prefix}-admin`, warehouse: `${prefix}-warehouse`, seller: `${prefix}-seller`, source: `${prefix}-source`, product: `${prefix}-mortadela`, sourceLot: `${prefix}-source-lot`, batch: `${prefix}-batch`, route: `${prefix}-route` }
const read = async (collection, id) => (await root.collection(collection).doc(id).get()).data()
const authDb = uid => env.authenticatedContext(uid).firestore()
let checks = 0
const pass = (condition, message) => { assert.ok(condition, message); checks++; console.log(`PASS ${message}`) }
const enqueue = async (actor, type, payload, operationId, secure = true) => {
  const ref = root.collection('distOperations').doc(operationId)
  const body = { id: operationId, restaurantId: 'sanjose', createdBy: actor, createdAt: new Date().toISOString(), type, payload, status: 'queued' }
  if (secure) await setDoc(doc(authDb(actor), 'restaurants', 'sanjose', 'distOperations', operationId), body)
  else await ref.set(body)
  return ref
}
const command = async (actor, type, payload, operationId, expected = 'confirmed') => {
  const ref = await enqueue(actor, type, payload, operationId)
  await processCommand(db, ref)
  const result = (await ref.get()).data()
  if (expected) assert.equal(result.status, expected, `${type}: ${result.error || 'estado inesperado'}`)
  return result
}

try {
  await root.collection('members').doc(ids.admin).set({ uid: ids.admin, role: 'admin', active: true, displayName: 'Administración QA' })
  await root.collection('members').doc(ids.warehouse).set({ uid: ids.warehouse, role: 'warehouse', active: true, displayName: 'Almacén QA', warehouseId: 'qa-central' })
  await root.collection('members').doc(ids.seller).set({ uid: ids.seller, role: 'distributor', active: true, displayName: 'Distribuidor QA', routeId: ids.route })
  await root.collection('distRoutes').doc(ids.route).set({ id: ids.route, restaurantId: 'sanjose', name: 'Ruta QA', kind: 'route', active: true })
  await root.collection('distProducts').doc(ids.source).set({ id: ids.source, restaurantId: 'sanjose', name: 'Mortadela QA granel', category: 'Granel', unitType: 'kg', active: true, productionCost: 5, referencePrice: 10 })
  await root.collection('distProducts').doc(ids.product).set({ id: ids.product, restaurantId: 'sanjose', name: 'Mortadela jamonada porcionado QA', category: 'Otros', presentation: '1000', unitType: 'unit', active: true, productionCost: 999, referencePrice: 12 })
  await root.collection('distLots').doc(ids.sourceLot).set({ id: ids.sourceLot, restaurantId: 'sanjose', productId: ids.source, productName: 'Mortadela QA granel', unitType: 'kg', lotCode: 'QA-GRANEL-9200', manufacturedOn: '2026-10-20', expiresOn: '2027-01-10', productionCost: 5, quantities: { central: 9.2 } })
  await root.collection('distBalances').doc(`central__${ids.source}`).set({ id: `central__${ids.source}`, restaurantId: 'sanjose', locationKind: 'central', warehouseId: 'central', productId: ids.source, productName: 'Mortadela QA granel', unitType: 'kg', quantity: 9.2 })
  const payload = {
    batchId: ids.batch, processType: 'bagging', sourceProductId: ids.source, location: 'central', processingDate: '2026-11-04', inputWeightG: 9200,
    sourceAllocations: [{ lotId: ids.sourceLot, quantity: 9.2, measuredNetWeightG: 9200 }], packagingMaterials: [], costComponents: [],
    destinations: [
      { id: 'finished', kind: 'finished', productId: ids.product, commercialUnit: 'unit', commercialQuantity: 1, netWeightG: 9000, nominalWeightG: 1000, weightBasis: 'measured_total', lotCode: '041126', manufacturedOn: '2026-10-25', packagedOn: '2026-11-04', expiresOn: '2027-02-04' },
      { id: 'discard', kind: 'discard', commercialQuantity: 0, netWeightG: 200, reason: 'Recorte físico medido' },
    ],
  }
  const originalOperation = await command(ids.admin, 'confirmProcessingBatch', payload, `${prefix}-confirm`)
  const batchBefore = await read('distProcessingBatches', ids.batch)
  const lotId = batchBefore.result.derivedLots.find(row => row.destinationId === 'finished').lotId
  const lotBefore = await read('distLots', lotId)
  const productBefore = await read('distProducts', ids.product)
  const balanceBefore = await read('distBalances', `central__${ids.product}`)
  const movementsBefore = (await root.collection('distStockMovements').where('productId', '==', ids.product).get()).docs.map(row => row.data())
  const rectificationInput = { batchId: ids.batch, lotId, destinationId: 'finished', productId: ids.product, toQuantity: 9, toUnitType: 'package', netWeightG: 9000, nominalWeightG: 1000, discardWeightG: 200, presentation: 'Paquete de 1 kg', reason: 'Rectificación autorizada: conteo físico confirmado de nueve bolsas de 1 kg.' }

  const postActivityRef = root.collection('distStockMovements').doc(`${prefix}-synthetic-post-sale`)
  await postActivityRef.set({ id: postActivityRef.id, restaurantId: 'sanjose', productId: ids.product, productName: 'Mortadela jamonada porcionado QA', unitType: 'unit', quantity: 1, centralDelta: -1, routeDelta: 0, type: 'sale', lotId, createdAt: new Date().toISOString() })
  const blockedForActivity = await command(ids.admin, 'rectifyProcessingCommercialUnit', rectificationInput, `${prefix}-activity-block`, 'rejected')
  assert.match(blockedForActivity.error, /movimientos posteriores incompatibles/)
  assert.equal((await read('distBalances', `central__${ids.product}`)).quantity, 1)
  assert.equal((await read('distProducts', ids.product)).unitType, 'unit')
  await postActivityRef.delete()
  pass(true, 'una venta posterior detectada bloquea la rectificación sin cambiar unidad ni balance')

  await assertFails(enqueue(ids.warehouse, 'rectifyProcessingCommercialUnit', rectificationInput, `${prefix}-warehouse-rules-denied`))
  const deniedWarehouseRef = await enqueue(ids.warehouse, 'rectifyProcessingCommercialUnit', rectificationInput, `${prefix}-warehouse-server-denied`, false)
  await processCommand(db, deniedWarehouseRef)
  const deniedWarehouse = (await deniedWarehouseRef.get()).data()
  assert.equal(deniedWarehouse.status, 'rejected')
  assert.match(deniedWarehouse.error, /Administración/)
  pass(true, 'Almacén no puede rectificar la unidad comercial')
  assert.deepEqual(await read('distProducts', ids.product), productBefore)
  assert.deepEqual(await read('distLots', lotId), lotBefore)
  assert.deepEqual(await read('distBalances', `central__${ids.product}`), balanceBefore)

  const rectification = await command(ids.admin, 'rectifyProcessingCommercialUnit', rectificationInput, `${prefix}-rectify`)
  const batchAfter = await read('distProcessingBatches', ids.batch)
  const lotAfter = await read('distLots', lotId)
  const productAfter = await read('distProducts', ids.product)
  const balanceAfter = await read('distBalances', `central__${ids.product}`)
  const outputMovement = (await root.collection('distStockMovements').where('batchId', '==', ids.batch).get()).docs.map(row => row.data()).find(row => row.type === 'processing_output')
  const correctionMovements = (await root.collection('distStockMovements').where('productId', '==', ids.product).get()).docs.map(row => row.data()).filter(row => row.type === 'processing_commercial_rectification')
  const auditRows = (await root.collection('distProcessingBatchAudit').where('batchId', '==', ids.batch).get()).docs.map(row => row.data()).filter(row => row.event === 'commercial_unit_rectification')

  assert.equal(productAfter.unitType, 'package')
  assert.equal(productAfter.category, 'Otros')
  assert.equal(productAfter.documentedPackageWeightKg, 1)
  assert.equal(productAfter.presentation, 'Paquete de 1 kg')
  assert.equal(batchAfter.inputWeightG, 9200)
  assert.equal(batchAfter.destinations.find(row => row.id === 'finished').commercialQuantity, 9)
  assert.equal(batchAfter.destinations.find(row => row.id === 'finished').commercialUnit, 'package')
  assert.equal(batchAfter.destinations.find(row => row.id === 'finished').netWeightG, 9000)
  assert.equal(batchAfter.destinations.find(row => row.id === 'discard').netWeightG, 200)
  assert.equal(batchAfter.result.derivedLots.find(row => row.lotId === lotId).commercialQuantity, 9)
  assert.equal(lotAfter.unitType, 'package')
  assert.equal(lotAfter.quantities.central, 9)
  assert.equal(lotAfter.processingPhysicalWeightGRemaining, 9000)
  assert.equal(lotAfter.processingPackageWeightLedger.packageCount, 9)
  assert.equal(lotAfter.processingPackageWeightLedger.measuredNetWeightG, 9000)
  assert.equal(lotAfter.processingPackageWeightLedger.consumedCount, 0)
  assert.equal(lotAfter.processingByLocation.central.segments[0].remainingQuantity, 9)
  assert.equal(lotAfter.processingByLocation.central.segments[0].remainingWeightG, 9000)
  assert.equal(lotAfter.processingCostCentsRemaining, lotBefore.processingCostCentsRemaining)
  assert.equal(lotAfter.processingByLocation.central.segments[0].remainingCostCents, lotBefore.processingByLocation.central.segments[0].remainingCostCents)
  assert.equal(balanceAfter.quantity, 9)
  assert.equal(balanceAfter.unitType, 'package')
  assert.equal(outputMovement.quantity, 1, 'el movimiento original conserva su entrada histórica inicial')
  assert.equal(outputMovement.commercialUnitRectification.correctedCommercialQuantity, 9)
  assert.equal(correctionMovements.length, 1)
  assert.equal(correctionMovements[0].quantity, 8)
  assert.equal(correctionMovements[0].centralDelta, 8, 'delta de unidades visible como rectificación administrativa')
  assert.equal(correctionMovements[0].physicalEffect, false)
  assert.equal(correctionMovements[0].physicalWeightG, 0)
  assert.equal(correctionMovements[0].costCents, 0)
  assert.equal(auditRows.length, 1)
  assert.equal(auditRows[0].physicalDeltaG, 0)
  assert.equal(auditRows[0].references.correctionMovementId, correctionMovements[0].id)
  assert.equal((await read('distOperations', originalOperation.id)).payload.destinations[0].commercialQuantity, 1, 'la operación original permanece inmutable como evidencia histórica')
  assert.deepEqual((await read('distLots', ids.sourceLot)).quantities.central, 0, 'el granel no vuelve a descontarse')
  pass(true, '9 paquetes quedan en producto, batch, lote, segmentos y balance; 9.000 g, costo, entrada y descarte conservados')

  const duplicate = await command(ids.admin, 'rectifyProcessingCommercialUnit', rectificationInput, `${prefix}-rectify-retry`)
  assert.equal(duplicate.result.duplicate, true)
  assert.equal((await root.collection('distStockMovements').where('productId', '==', ids.product).get()).docs.filter(row => row.data().type === 'processing_commercial_rectification').length, 1)
  assert.equal((await root.collection('distProcessingBatchAudit').where('batchId', '==', ids.batch).get()).docs.filter(row => row.data().event === 'commercial_unit_rectification').length, 1)
  pass(true, 'reintento con otro operationId es idempotente y no duplica Kardex ni auditoría')

  const releases = await command(ids.admin, 'releaseProcessingLot', { lotId, reason: 'Producto apto para despacho y venta' }, `${prefix}-release`)
  assert.equal(releases.result.release.status, 'released')
  const dispatch = await command(ids.admin, 'dispatch', { warehouseId: 'central', routeId: ids.route, routeName: 'Ruta QA', distributorUid: ids.seller, distributorName: 'Distribuidor QA', warehouseResponsibleName: 'Almacén QA', lines: [{ productId: ids.product, quantity: 1, normalQuantity: 1, dispatchMerma: 0, allocationsRequested: [{ lotId, quantity: 1 }] }] }, `${prefix}-dispatch`)
  assert.equal(dispatch.status, 'confirmed')
  assert.equal((await read('distBalances', `central__${ids.product}`)).quantity, 8)
  assert.equal((await read('distBalances', `route__${ids.route}__${ids.product}`)).quantity, 1)
  const afterDispatchLot = await read('distLots', lotId)
  assert.equal(afterDispatchLot.quantities.central, 8)
  assert.equal(afterDispatchLot.quantities[`route__${ids.route}`], 1)
  const sale = await command(ids.seller, 'sale', { sourceLocation: 'route', routeId: ids.route, routeName: 'Ruta QA', dispatchId: `${prefix}-dispatch`, lines: [{ productId: ids.product, quantity: 1, actualUnitPrice: 12 }], cashAmount: 12, qrAmount: 0, creditAmount: 0, paymentKind: 'cash' }, `${prefix}-sale`)
  assert.equal(sale.status, 'confirmed')
  const afterSaleLot = await read('distLots', lotId)
  assert.equal(afterSaleLot.quantities.central, 8)
  assert.equal(afterSaleLot.quantities[`route__${ids.route}`], 0)
  assert.equal(afterSaleLot.processingPhysicalWeightGRemaining, 8000)
  assert.equal(afterSaleLot.processingCostCentsRemaining, Math.round(lotAfter.processingCostCentsRemaining * 8 / 9))
  pass(true, 'liberación, despacho de un paquete y venta posterior consumen segmentos, peso y costo proporcionalmente')

  console.log(`PASS procesamiento comercial rectificable: ${checks} validaciones sintéticas`)
} finally {
  await env.cleanup()
  await app.delete()
}
