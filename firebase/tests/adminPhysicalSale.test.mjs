// Backend operation regression test. All writes are isolated to the Firestore emulator.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8085'
const req = createRequire(new URL('../../functions/package.json', import.meta.url))
const { initializeApp } = req('firebase-admin/app')
const { getFirestore } = req('firebase-admin/firestore')
const { processCommand } = req('./operations.cjs')
const app = initializeApp({ projectId: 'demo-pachax-audit' }, `admin-physical-sale-${Date.now()}`)
const db = getFirestore(app)
const root = db.collection('restaurants').doc('sanjose')
const suffix = Date.now().toString(36)
const admin = `qa-admin-${suffix}`
const distributor = `qa-distributor-${suffix}`
const productId = `qa-kg-${suffix}`
const routeId = `qa-route-${suffix}`
const dispatchId = `qa-dispatch-${suffix}`
const adminOpId = `qa-admin-sale-${suffix}`
const distributorOpId = `qa-distributor-sale-${suffix}`
const now = new Date().toISOString()

async function run(id, actor, role, payload) {
  const ref = root.collection('distOperations').doc(id)
  await ref.set({ id, restaurantId: 'sanjose', type: 'sale', status: 'queued', createdBy: actor, createdAt: now, payload })
  await processCommand(db, ref)
  return (await ref.get()).data()
}

try {
  await root.collection('members').doc(admin).set({ role: 'admin', active: true, displayName: 'QA Admin' })
  await root.collection('members').doc(distributor).set({ role: 'distributor', active: true, routeId, displayName: 'QA Distribuidor' })
  await root.collection('distProducts').doc(productId).set({ id: productId, restaurantId: 'sanjose', name: 'Producto kg QA', unitType: 'kg', active: true, referencePrice: 10, productionCost: 4 })
  const lotId = `lot-${suffix}`
  await root.collection('distLots').doc(lotId).set({ id: lotId, restaurantId: 'sanjose', productId, productName: 'Producto kg QA', unitType: 'kg', lotCode: 'QA-LOT', manufacturedOn: '2026-10-01', expiresOn: '2027-10-01', productionCost: 4, quantities: { central: 10 }, createdAt: now, createdBy: admin })
  await root.collection('distBalances').doc(`central__${productId}`).set({ id: `central__${productId}`, restaurantId: 'sanjose', productId, productName: 'Producto kg QA', unitType: 'kg', locationKind: 'central', warehouseId: 'central', quantity: 10 })
  const adminPayload = { sourceLocation: 'centralWarehouse', routeId: 'administracion', routeName: 'Administración', lines: [{ productId, quantity: 1, physicalQuantity: 1.125, actualUnitPrice: 10 }], cashAmount: 10, qrAmount: 0, creditAmount: 0, paymentKind: 'cash' }
  const adminOp = await run(adminOpId, admin, 'admin', adminPayload)
  assert.equal(adminOp.status, 'confirmed')
  assert.equal(adminOp.result.total, 10)
  assert.equal(adminOp.result.lines[0].quantity, 1)
  assert.equal(adminOp.result.lines[0].physicalQuantity, 1.125)
  assert.equal(adminOp.result.lines[0].excessWeightQuantity, 0.125)
  assert.equal((await root.collection('distBalances').doc(`central__${productId}`).get()).data().quantity, 8.875)
  const movement = (await root.collection('distStockMovements').where('refId', '==', adminOpId).get()).docs.map((row) => row.data()).find((row) => row.type === 'sale')
  assert.equal(movement.quantity, 1.125)
  assert.equal(movement.chargedQuantity, 1)
  assert.equal(movement.excessWeightQuantity, 0.125)
  await processCommand(db, root.collection('distOperations').doc(adminOpId))
  assert.equal((await root.collection('distBalances').doc(`central__${productId}`).get()).data().quantity, 8.875, 'retry must not deduct twice')

  const routeLocation = `route__${routeId}`
  await root.collection('distDispatches').doc(dispatchId).set({ id: dispatchId, restaurantId: 'sanjose', routeId, distributorUid: distributor, status: 'open' })
  await root.collection('distLots').doc(lotId).set({ quantities: { central: 8.875, [routeLocation]: 2 } }, { merge: true })
  await root.collection('distBalances').doc(`central__${productId}`).set({ quantity: 8.875 }, { merge: true })
  await root.collection('distBalances').doc(`${routeLocation}__${productId}`).set({ id: `${routeLocation}__${productId}`, restaurantId: 'sanjose', productId, productName: 'Producto kg QA', unitType: 'kg', locationKind: 'route', routeId, quantity: 2 })
  const distributorOp = await run(distributorOpId, distributor, 'distributor', { sourceLocation: 'route', routeId, routeName: 'QA', dispatchId, lines: [{ productId, quantity: 1, physicalQuantity: 1.1, actualUnitPrice: 10 }], cashAmount: 10, qrAmount: 0, creditAmount: 0, paymentKind: 'cash' })
  assert.equal(distributorOp.status, 'rejected')
  assert.match(distributorOp.error, /Solo Administración/)
  assert.equal((await root.collection('distBalances').doc(`${routeLocation}__${productId}`).get()).data().quantity, 2)
  console.log('PASS venta admin cobra cantidad facturada, descuenta peso físico; reintento idempotente; distribuidor no puede declarar excedente')
} finally {
  await app.delete()
}
