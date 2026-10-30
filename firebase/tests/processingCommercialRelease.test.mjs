// Fase 3D.1: derived finished sachets move by location without enabling sales.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'
console.log(`Commercial release runtime: Node ${process.versions.node}`)

const req = createRequire(new URL('../../functions/package.json', import.meta.url))
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085'
process.env.FUNCTIONS_EMULATOR = 'true'
process.env.SANJOSE_DERIVED_SALES_EMULATOR_TEST = 'true'
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

  delete process.env.SANJOSE_DERIVED_SALES_EMULATOR_TEST
  await command(ids.admin, 'releaseProcessingLot', { lotId: derivedLotId, authorizationReference: 'quality-release', reason: 'QA physical finished product approved' }, `${prefix}-no-auth`, 'rejected')
  await root.collection('distProcessingQualityAuthorizations').doc(ids.admin).set({ restaurantId: 'sanjose', status: 'active', beneficiaryUid: ids.admin, authorizationId: 'quality-release', grantedBy: 'independent-quality-authority', expiresAt: '2999-12-31T00:00:00.000Z' })
  await assertFails(setDoc(doc(authDb(ids.warehouse), 'restaurants', 'sanjose', 'distLots', derivedLotId), { processingCommercialRelease: { status: 'released' } }, { merge: true }))
  await root.collection('distLots').doc(derivedLotId).update({ quarantined: true })
  await command(ids.admin, 'releaseProcessingLot', { lotId: derivedLotId, authorizationReference: 'quality-release', reason: 'QA must reject quarantined stock' }, `${prefix}-quarantine`, 'rejected')
  await root.collection('distLots').doc(derivedLotId).update({ quarantined: false })
  const [release, concurrentRelease] = await Promise.all([
    command(ids.admin, 'releaseProcessingLot', { lotId: derivedLotId, authorizationReference: 'quality-release', reason: 'QA physical finished product approved' }, `${prefix}-release`),
    command(ids.admin, 'releaseProcessingLot', { lotId: derivedLotId, authorizationReference: 'quality-release', reason: 'QA concurrent release cannot duplicate approval' }, `${prefix}-concurrent-release`),
  ])
  assert.equal(release.result.release.operationId, concurrentRelease.result.release.operationId)
  assert.equal(release.result.release.status, 'released')
  const repeated = await command(ids.admin, 'releaseProcessingLot', { lotId: derivedLotId, authorizationReference: 'quality-release', reason: 'QA repeated release request is safe' }, `${prefix}-release-again`)
  assert.equal(repeated.result.release.operationId, release.result.release.operationId)
  const releasedSnapshot = await read('distLots', derivedLotId)
  await command(ids.admin, 'updateLot', { lotId: derivedLotId, lotCode: 'QA-CHANGED', manufacturedOn: '2026-10-28', expiresOn: '2999-12-31', productionCost: 999, reason: 'QA generic editing must not extend derived expiry' }, `${prefix}-blocked-edit`, 'rejected')
  assert.deepEqual(await read('distLots', derivedLotId), releasedSnapshot)
  const dispatchId = `${prefix}-released-dispatch`
  await command(ids.admin, 'dispatch', { warehouseId: 'central', routeId: ids.route, routeName: 'QA Ruta', distributorUid: ids.seller, distributorName: 'QA Vendedor', warehouseResponsibleName: 'QA Almacen', lines: [{ productId: ids.product, quantity: 10, normalQuantity: 10, dispatchMerma: 0, allocationsRequested: [{ lotId: derivedLotId, quantity: 10 }] }] }, dispatchId)
  const sale = await command(ids.admin, 'sale', { sourceLocation: 'centralWarehouse', routeId: 'administracion', routeName: 'QA Administracion', lines: [{ productId: ids.product, quantity: 1, actualUnitPrice: 10 }], cashAmount: 10, qrAmount: 0, creditAmount: 0, paymentKind: 'cash' }, `${prefix}-released-sale`)
  const after = await read('distLots', derivedLotId)
  assert.equal(after.processingPhysicalWeightGRemaining, 8750)
  assert.equal(after.processingCostCentsRemaining, 4375)
  assert.equal(after.processingCommercialBlocked, true)
  assert.equal(after.quantities[`route__${ids.route}`], 10)
  assert.equal(sale.status, 'confirmed')
  const routeSaleId = `${prefix}-route-sale`
  await command(ids.seller, 'sale', { sourceLocation: 'route', routeId: ids.route, routeName: 'QA Route', dispatchId, lines: [{ productId: ids.product, quantity: 7, actualUnitPrice: 10 }], cashAmount: 70, qrAmount: 0, creditAmount: 0, paymentKind: 'cash' }, routeSaleId)
  const routeSale = await read('distSales', routeSaleId)
  assert.equal(routeSale.lines[0].costCents, 875)
  assert.equal(routeSale.lines[0].allocations.reduce((sum, row) => sum + row.processingAllocation.physicalWeightG, 0), 1750)
  const receiveId = `${prefix}-route-receive`
  await command(ids.admin, 'closure', { mode: 'warehouse', closure: { dispatchId, warehouseResponsibleName: 'QA Warehouse', products: [{ productId: ids.product, actualReturn: 3, returnWaste: 0 }] } }, receiveId)
  const returned = await read('distLots', derivedLotId)
  assert.equal(returned.quantities.central, 28)
  assert.equal(returned.quantities[`route__${ids.route}`], 0)
  assert.equal(returned.processingPhysicalWeightGRemaining, 7000)
  assert.equal(returned.processingCostCentsRemaining, 3500)
  await processCommand(db, root.collection('distOperations').doc(receiveId))
  assert.deepEqual(await read('distLots', derivedLotId), returned)
  await command(ids.admin, 'closure', { mode: 'final', closure: { dispatchId, physicalCashDeclared: 70 } }, `${prefix}-route-close`)
  assert.equal((await read('distDispatches', dispatchId)).status, 'closed')
  const customerId = `${prefix}-customer`
  await root.collection('distCustomers').doc(customerId).set({ id: customerId, restaurantId: 'sanjose', active: true, name: 'QA Customer', identityNumber: '1234567' })
  for (const kind of ['qr', 'credit']) {
    await command(ids.admin, 'sale', { sourceLocation: 'centralWarehouse', routeId: 'administracion', routeName: 'QA Admin', customerId, lines: [{ productId: ids.product, quantity: 1, actualUnitPrice: 10 }], cashAmount: 0, qrAmount: kind === 'qr' ? 10 : 0, creditAmount: kind === 'credit' ? 10 : 0, paymentKind: kind }, `${prefix}-${kind}-sale`)
  }
  const finalLot = await read('distLots', derivedLotId)
  assert.equal(finalLot.quantities.central, 26)
  assert.equal(finalLot.processingPhysicalWeightGRemaining, 6500)
  assert.equal(finalLot.processingCostCentsRemaining, 3250)
  console.log('PASS elaboration -> Quality release -> dispatch -> route sale -> warehouse closure/return; exact historical grams and cents, idempotent retry')
  console.log('PASS release requires Quality authorization; dispatch and sale preserve derived grams and cents without emulator flag')
} finally { await env.cleanup() }
