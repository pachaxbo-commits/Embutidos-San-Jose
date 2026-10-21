// Isolated emulator test for the approved, idempotent correction of Luciano's fictitious overage.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085'
const req = createRequire(new URL('../../functions/package.json', import.meta.url))
const { initializeApp } = req('firebase-admin/app')
const { getFirestore } = req('firebase-admin/firestore')
const { processCommand } = req('./operations.cjs')
const app = initializeApp({ projectId: 'demo-pachax-audit' }, `luciano-rectify-${Date.now()}`)
const db = getFirestore(app)
const root = db.doc('restaurants/sanjose')
const suffix = Date.now().toString(36)
const admin = `admin-${suffix}`
const dispatchId = `disp_bac68ca5-18e6-4037-83fc-4198d608514c-${suffix}`
const closureId = `closure-${dispatchId}`
const productId = `sku-mortadela-jamonada-granel--mu5xjuz6-${suffix}`
const lotId = `quarantine-${suffix}`
const sourceOperationId = `warehouse-source-${suffix}`
const sourceMovementId = `source-overage-${suffix}`
const operationId = `rectification-${suffix}`
const read = async (collection, id) => (await root.collection(collection).doc(id).get()).data()

try {
  await root.collection('members').doc(admin).set({ active: true, role: 'admin', displayName: 'QA Administración' })
  await root.collection('distProducts').doc(productId).set({ id: productId, restaurantId: 'sanjose', name: 'Mortadela jamonada Granel', unitType: 'kg', active: true, productionCost: null })
  await root.collection('distDispatches').doc(dispatchId).set({ id: dispatchId, restaurantId: 'sanjose', routeId: 'route-sacaba', distributorUid: 'luciano-qa', distributorName: 'Luciano Marcani', routeName: 'Sacaba', dayKey: '2026-10-17', status: 'closed' })
  await root.collection('distClosures').doc(closureId).set({ id: closureId, restaurantId: 'sanjose', dispatchId, routeId: 'route-sacaba', distributorUid: 'luciano-qa', distributorName: 'Luciano Marcani', routeName: 'Sacaba', dayKey: '2026-10-17', status: 'closed', physicalCashDeclared: 0, products: [{ productId, productName: 'Mortadela jamonada Granel', unitType: 'kg', totalLoaded: 5, sold: 3.5, expectedReturn: 1.5, physicalReturn: 15, actualReturn: 15, overage: 13.5, returnMerma: 0, returnWaste: 0 }] })
  await root.collection('distOperations').doc(sourceOperationId).set({ id: sourceOperationId, restaurantId: 'sanjose', createdBy: admin, type: 'closure', status: 'confirmed', payload: { mode: 'warehouse', closure: { dispatchId } } })
  await root.collection('distLots').doc(lotId).set({ id: lotId, restaurantId: 'sanjose', productId, productName: 'Mortadela jamonada Granel', unitType: 'kg', lotCode: 'SOBRANTE POR REVISAR', manufacturedOn: '', expiresOn: '', productionCost: null, quantities: { central: 13.5 }, quarantined: true, createdAt: '2026-10-17T20:00:00.000Z', createdBy: admin })
  await root.collection('distBalances').doc(`central__${productId}`).set({ id: `central__${productId}`, restaurantId: 'sanjose', productId, locationKind: 'central', warehouseId: 'central', quantity: 212.45 })
  await root.collection('distStockMovements').doc(sourceMovementId).set({ id: sourceMovementId, restaurantId: 'sanjose', type: 'overage', productId, productName: 'Mortadela jamonada Granel', unitType: 'kg', quantity: 13.5, centralDelta: 13.5, routeDelta: 0, toLocation: 'central', routeId: 'route-sacaba', dispatchId, refId: sourceOperationId, refType: 'closure', lotId, dayKey: '2026-10-17', createdAt: '2026-10-17T20:00:00.000Z' })
  // Other active inventory in the product's lots makes physical total reconcile at 212.45 kg.
  await root.collection('distLots').doc(`valid-lot-${suffix}`).set({ id: `valid-lot-${suffix}`, restaurantId: 'sanjose', productId, productName: 'Mortadela jamonada Granel', unitType: 'kg', lotCode: 'VALIDO', manufacturedOn: '2026-10-01', expiresOn: '2026-11-01', productionCost: 10, quantities: { central: 198.95 }, quarantined: false, createdAt: '2026-10-01T12:00:00.000Z', createdBy: admin })
  // The incident-specific handler rejects a fixture whose balance doesn't match its lots;
  // seed remaining legitimate stock as a third lot to match the verified production snapshot.
  await root.collection('distLots').doc(`other-lot-${suffix}`).set({ id: `other-lot-${suffix}`, restaurantId: 'sanjose', productId, productName: 'Mortadela jamonada Granel', unitType: 'kg', lotCode: 'OTRO', manufacturedOn: '2026-10-01', expiresOn: '2026-11-01', productionCost: 10, quantities: { central: 0 }, quarantined: false, createdAt: '2026-10-01T12:00:00.000Z', createdBy: admin })
  const balanceRef = root.collection('distBalances').doc(`central__${productId}`)
  await balanceRef.update({ quantity: 212.45 })
  // Match the exact total with the quarantined lot and traced stock.
  await root.collection('distLots').doc(`valid-lot-${suffix}`).update({ 'quantities.central': 198.95 })

  const operationRef = root.collection('distOperations').doc(operationId)
  await operationRef.set({ id: operationId, restaurantId: 'sanjose', createdBy: admin, createdAt: new Date().toISOString(), type: 'rectifyQuarantineInputError', status: 'queued', payload: { lotId, movementId: sourceMovementId, dispatchId, closureId, productId, confirmation: 'RECTIFICAR-13.5-KG-FICTICIOS' } })
  await processCommand(db, operationRef)
  const resultOperation = await read('distOperations', operationId)
  assert.equal(resultOperation.status, 'confirmed', resultOperation.error)
  assert.equal(resultOperation.result.quantity, 13.5)
  const correctedBalance = await read('distBalances', `central__${productId}`)
  assert.equal(correctedBalance.quantity, 198.95)
  const resolvedLot = await read('distLots', lotId)
  assert.equal(resolvedLot.quantities.central, 0)
  assert.equal(resolvedLot.quarantineResolution, 'rectified_input_error')
  assert.equal(resolvedLot.quarantineResolvedQuantity, 13.5)
  const originalMovement = await read('distStockMovements', sourceMovementId)
  assert.equal(originalMovement.quantity, 13.5)
  assert.equal(originalMovement.centralDelta, 13.5)
  assert.equal(originalMovement.rectifiedByMovementId, resultOperation.result.correctionMovementId)
  const correctionMovement = await read('distStockMovements', resultOperation.result.correctionMovementId)
  assert.equal(correctionMovement.type, 'quarantine_rectification')
  assert.equal(correctionMovement.quantity, 13.5)
  assert.equal(correctionMovement.centralDelta, -13.5)
  assert.equal(correctionMovement.lossCost, null)
  const history = await read('distLotHistory', `${operationId}__history`)
  assert.equal(history.action, 'quarantine_input_error_rectification')
  const closure = await read('distClosures', closureId)
  assert.deepEqual(closure.products[0], { productId, productName: 'Mortadela jamonada Granel', unitType: 'kg', totalLoaded: 5, sold: 3.5, expectedReturn: 1.5, physicalReturn: 15, actualReturn: 15, overage: 13.5, returnMerma: 0, returnWaste: 0 })
  assert.equal((await read('distDispatches', dispatchId)).status, 'closed')
  const lotTotal = (await root.collection('distLots').where('productId', '==', productId).get()).docs.reduce((sum, snapshot) => sum + Number(snapshot.data().quantities?.central || 0), 0)
  assert.equal(lotTotal, correctedBalance.quantity)
  await processCommand(db, operationRef)
  assert.equal((await read('distBalances', `central__${productId}`)).quantity, 198.95, 'reprocesar mismo operationId no debe duplicar')

  const duplicateRef = root.collection('distOperations').doc(`${operationId}-duplicate`)
  await duplicateRef.set({ id: duplicateRef.id, restaurantId: 'sanjose', createdBy: admin, createdAt: new Date().toISOString(), type: 'rectifyQuarantineInputError', status: 'queued', payload: { lotId, movementId: sourceMovementId, dispatchId, closureId, productId, confirmation: 'RECTIFICAR-13.5-KG-FICTICIOS' } })
  await processCommand(db, duplicateRef)
  assert.equal((await duplicateRef.get()).data().status, 'rejected')
  assert.equal((await read('distBalances', `central__${productId}`)).quantity, 198.95, 'operación duplicada distinta tampoco debe cambiar el saldo')
  console.log('PASS: corrección auditada 13.5 kg; cierre y 3.5 kg vendidos/1.5 kg reales intactos; saldo/lotes conciliados; sin pérdida económica ni duplicación')
} finally {
  await app.delete()
}
