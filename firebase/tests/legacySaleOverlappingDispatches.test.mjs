import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8085'
const requireFunctions = createRequire(new URL('../../functions/package.json', import.meta.url))
const { initializeApp } = requireFunctions('firebase-admin/app')
const { getFirestore } = requireFunctions('firebase-admin/firestore')
const { processCommand } = requireFunctions('./operations.cjs')
const app = initializeApp({ projectId: 'demo-pachax-audit' }, `legacy-sale-overlap-${Date.now()}`)
const db = getFirestore(app)
const root = db.doc('restaurants/sanjose')
const token = `legacy-overlap-${Date.now().toString(36)}`
const routeId = `${token}-route`
const warehouseUid = `${token}-warehouse`
const dispatchA = `${token}-dispatch-a`
const dispatchB = `${token}-dispatch-b`
const saleId = `${token}-sale`

try {
  await root.collection('members').doc(warehouseUid).set({ role: 'warehouse', active: true, warehouseId: 'central', displayName: 'QA Almacén' })
  await root.collection('distDispatches').doc(dispatchA).set({ id: dispatchA, restaurantId: 'sanjose', routeId, status: 'open', createdAt: '2026-10-28T09:00:00.000Z', lines: [], additions: [] })
  await root.collection('distDispatches').doc(dispatchB).set({ id: dispatchB, restaurantId: 'sanjose', routeId, status: 'open', createdAt: '2026-10-28T10:00:00.000Z', lines: [], additions: [] })
  await root.collection('distSales').doc(saleId).set({ id: saleId, restaurantId: 'sanjose', routeId, sourceLocation: 'route', createdAt: '2026-10-28T11:00:00.000Z', lines: [], total: 0, cashAmount: 0, qrAmount: 0, creditAmount: 0 })
  const movementCountBefore = (await root.collection('distMovements').get()).size
  const operationId = `${token}-close`
  const operationRef = root.collection('distOperations').doc(operationId)
  await operationRef.set({ id: operationId, restaurantId: 'sanjose', createdBy: warehouseUid, createdAt: new Date().toISOString(), type: 'closure', payload: { mode: 'warehouse', closure: { dispatchId: dispatchB, products: [] } }, status: 'queued' })
  await processCommand(db, operationRef)
  const operation = (await operationRef.get()).data()
  assert.equal(operation.status, 'rejected')
  assert.match(operation.error, /ventas históricas.*sin despacho vinculado.*más de un despacho/i)
  assert.equal((await root.collection('distClosures').doc(`closure_${dispatchB}`).get()).exists, false)
  assert.equal((await root.collection('distMovements').get()).size, movementCountBefore)
  assert.equal((await root.collection('distDispatches').doc(dispatchA).get()).data().status, 'open')
  assert.equal((await root.collection('distDispatches').doc(dispatchB).get()).data().status, 'open')
  console.log('PASS Emulator: venta histórica ambigua bloquea cierre sin movimientos ni cambios de despacho')
} finally {
  await app.delete()
}
