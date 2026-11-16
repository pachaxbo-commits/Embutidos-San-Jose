// Shared inventory product-order operation and Firestore permissions. Emulator only.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore'

const require = createRequire(new URL('../../functions/package.json', import.meta.url))
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9095'
const { initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { processCommand } = require('./operations.cjs')

// Explicit test project ensures emulator sandbox isolation
const projectId = 'demo-pachax-audit'
const app = initializeApp({ projectId }, `qa-inv-order-${Date.now()}`)
const db = getFirestore(app)
const root = db.doc('restaurants/sanjose')
const env = await initializeTestEnvironment({
  projectId,
  firestore: { host: '127.0.0.1', port: 8085, rules: fs.readFileSync('firebase/firestore.rules', 'utf8') },
})

const prefix = `inv${Date.now().toString(36)}`
const admin = `${prefix}-admin`
const warehouse = `${prefix}-warehouse`
const distributor = `${prefix}-distributor`
const support = `${prefix}-support`
const settingsRef = root.collection('distSettings').doc('inventoryProductOrder')
let passed = 0

function pass(condition, label) {
  assert(condition, label)
  passed++
  console.log(`PASS: ${label}`)
}

async function command(actor, payload, expected = 'confirmed') {
  const id = `${prefix}-operation-${Math.random().toString(36).slice(2)}`
  const firestore = env.authenticatedContext(actor).firestore()
  await setDoc(doc(firestore, 'restaurants', 'sanjose', 'distOperations', id), {
    id,
    restaurantId: 'sanjose',
    createdBy: actor,
    createdAt: new Date().toISOString(),
    type: 'saveInventoryProductOrder',
    payload,
    status: 'queued',
  })
  await processCommand(db, root.collection('distOperations').doc(id))
  const result = (await root.collection('distOperations').doc(id).get()).data()
  assert.equal(result?.status, expected, result?.error || `estado inesperado: ${result?.status}`)
  return result
}

function waitForRevision(firestore, revision) {
  return new Promise((resolve, reject) => {
    let stop = () => {}
    const timer = setTimeout(() => { stop(); reject(new Error(`No llegó la revisión ${revision} al listener.`)) }, 10000)
    stop = onSnapshot(doc(firestore, 'restaurants', 'sanjose', 'distSettings', 'inventoryProductOrder'), snapshot => {
      const value = snapshot.data()
      if (snapshot.exists() && value?.revision === revision) {
        clearTimeout(timer)
        stop()
        resolve(value)
      }
    }, error => { clearTimeout(timer); stop(); reject(error) })
  })
}

try {
  // 1. Setup test members
  for (const [uid, role] of [[admin, 'admin'], [warehouse, 'warehouse'], [distributor, 'distributor'], [support, 'support']]) {
    await root.collection('members').doc(uid).set({ uid, role, displayName: role, active: true })
  }

  // 2. Setup initial products A, B, C with stock and price attributes to prove immutability
  const initialProducts = [
    { id: 'prod-A', name: 'Salchicha Especial A', category: 'Salchichas', price: 25.5, currentStock: 100, active: true, deleted: false, restaurantId: 'sanjose' },
    { id: 'prod-B', name: 'Chorizo Parrillero B', category: 'Chorizos', price: 32.0, currentStock: 50, active: true, deleted: false, restaurantId: 'sanjose' },
    { id: 'prod-C', name: 'Mortadela Familiar C', category: 'Mortadelas', price: 18.0, currentStock: 75, active: true, deleted: false, restaurantId: 'sanjose' },
    { id: 'prod-inactive', name: 'Inactivo Antiguo', category: 'Varios', price: 10.0, currentStock: 0, active: false, deleted: false, restaurantId: 'sanjose' },
  ]
  for (const p of initialProducts) {
    await root.collection('distProducts').doc(p.id).set(p)
  }

  const adminDb = env.authenticatedContext(admin).firestore()
  const warehouseDb = env.authenticatedContext(warehouse).firestore()
  const distributorDb = env.authenticatedContext(distributor).firestore()
  const supportDb = env.authenticatedContext(support).firestore()

  // 3. Security rules verification:
  // - Direct write to distSettings/inventoryProductOrder blocked
  await assert.rejects(setDoc(doc(adminDb, 'restaurants', 'sanjose', 'distSettings', 'inventoryProductOrder'), { enabled: true }))
  await assert.rejects(setDoc(doc(warehouseDb, 'restaurants', 'sanjose', 'distSettings', 'inventoryProductOrder'), { enabled: true }))
  pass(true, 'reglas de seguridad impiden la escritura directa en distSettings/inventoryProductOrder')

  // - Distributor and support cannot enqueue saveInventoryProductOrder operation
  await assert.rejects(setDoc(doc(distributorDb, 'restaurants', 'sanjose', 'distOperations', `${prefix}-dist-attempt`), {
    id: `${prefix}-dist-attempt`, restaurantId: 'sanjose', createdBy: distributor, createdAt: new Date().toISOString(),
    type: 'saveInventoryProductOrder', payload: { expectedRevision: 0, productIds: ['prod-C', 'prod-A', 'prod-B'] }, status: 'queued',
  }))
  pass(true, 'distribuidor rechazado por reglas de seguridad al intentar enqueue saveInventoryProductOrder')

  await assert.rejects(setDoc(doc(supportDb, 'restaurants', 'sanjose', 'distOperations', `${prefix}-supp-attempt`), {
    id: `${prefix}-supp-attempt`, restaurantId: 'sanjose', createdBy: support, createdAt: new Date().toISOString(),
    type: 'saveInventoryProductOrder', payload: { expectedRevision: 0, productIds: ['prod-C', 'prod-A', 'prod-B'] }, status: 'queued',
  }))
  pass(true, 'soporte rechazado por reglas de seguridad al intentar enqueue saveInventoryProductOrder')

  // 4. Test initial order: A, B, C -> Guardar C, A, B por Administración
  const initialAdminSync = waitForRevision(adminDb, 1)
  const initialWarehouseSync = waitForRevision(warehouseDb, 1)

  const op1 = await command(admin, { expectedRevision: 0, productIds: ['prod-C', 'prod-A', 'prod-B'] })
  pass(op1.status === 'confirmed', 'operación saveInventoryProductOrder confirmada con éxito por Administración')
  pass(op1.result?.revision === 1 && op1.result?.enabled === true, 'resultado reporta revision=1 y enabled=true')

  const [adminSynced, warehouseSynced] = await Promise.all([initialAdminSync, initialWarehouseSync])
  pass(
    adminSynced.productIds.join(',') === 'prod-C,prod-A,prod-B' &&
    warehouseSynced.productIds.join(',') === 'prod-C,prod-A,prod-B' &&
    adminSynced.revision === 1 &&
    adminSynced.enabled === true,
    'distSettings/inventoryProductOrder guardado y propagado en vivo con C, A, B'
  )

  // 5. Subsequent read confirms C, A, B persists
  const reRead = await root.collection('distSettings').doc('inventoryProductOrder').get()
  pass(reRead.exists && reRead.data().productIds.join(',') === 'prod-C,prod-A,prod-B', 'lectura posterior conserva exactamente el orden C, A, B')

  // 6. Immutability check: verify stock and products were NOT modified
  for (const p of initialProducts) {
    const afterSnap = await root.collection('distProducts').doc(p.id).get()
    const afterData = afterSnap.data()
    assert.equal(afterData.currentStock, p.currentStock, `Stock de ${p.id} no debe cambiar`)
    assert.equal(afterData.price, p.price, `Precio de ${p.id} no debe cambiar`)
    assert.equal(afterData.name, p.name, `Nombre de ${p.id} no debe cambiar`)
    assert.equal(afterData.active, p.active, `Estado active de ${p.id} no debe cambiar`)
  }
  pass(true, 'catálogo, stock, precios y datos de productos permanecen completamente inmutados')

  // 7. Concurrency check: expectedRevision stale must reject without overwriting
  const staleAttempt = await command(warehouse, { expectedRevision: 0, productIds: ['prod-A', 'prod-B', 'prod-C'] }, 'rejected')
  pass(staleAttempt.error.includes('cambió en otro dispositivo'), 'concurrencia con expectedRevision rechaza revisión vieja (0 vs 1)')
  const currentAfterStale = (await root.collection('distSettings').doc('inventoryProductOrder').get()).data()
  pass(currentAfterStale.revision === 1 && currentAfterStale.productIds.join(',') === 'prod-C,prod-A,prod-B', 'revisión y orden no sufren sobreescritura ante fallo de concurrencia')

  // 8. Catalog change: adding a new active product D
  await root.collection('distProducts').doc('prod-D').set({
    id: 'prod-D', name: 'Jamón Inglés D', category: 'Jamones', price: 40.0, currentStock: 20, active: true, deleted: false, restaurantId: 'sanjose'
  })

  // Trying to save without D must fail because active list changed
  const missingDAttempt = await command(warehouse, { expectedRevision: 1, productIds: ['prod-C', 'prod-A', 'prod-B'] }, 'rejected')
  pass(missingDAttempt.error.includes('activos cambió'), 'guardar sin incluir producto nuevo agregado es rechazado para evitar inconsistencias')

  // Saving with D included succeeds and increments revision to 2
  const op2 = await command(warehouse, { expectedRevision: 1, productIds: ['prod-C', 'prod-A', 'prod-B', 'prod-D'] })
  pass(op2.status === 'confirmed' && op2.result?.revision === 2, 'guardar con nuevo producto D incluido incrementa revisión a 2')

  // 9. Fallback view sorting logic:
  // When a product exists that was NOT in the saved list, fallback puts it at the end
  const { sortInventoryProducts } = await import('../../src/modules/distribution/domain/inventorySelection.ts')
  const simulatedSavedOrder = ['prod-C', 'prod-A', 'prod-B']
  const allProds = [
    { id: 'prod-A', name: 'Salchicha Especial A', category: 'Salchichas' },
    { id: 'prod-B', name: 'Chorizo Parrillero B', category: 'Chorizos' },
    { id: 'prod-C', name: 'Mortadela Familiar C', category: 'Mortadelas' },
    { id: 'prod-D', name: 'Jamón Inglés D', category: 'Jamones' },
  ]
  const sorted = sortInventoryProducts(allProds, simulatedSavedOrder)
  pass(
    sorted.map(p => p.id).join(',') === 'prod-C,prod-A,prod-B,prod-D',
    'lógica de vista / fallback ubica nuevos productos al final preservando el orden guardado'
  )

  // 10. Reset test: reset: true, expectedRevision: 2
  const resetOp = await command(admin, { expectedRevision: 2, reset: true })
  pass(resetOp.status === 'confirmed' && resetOp.result?.revision === 3 && resetOp.result?.enabled === false, 'operación reset confirmada con revision=3 y enabled=false')

  const resetDoc = (await root.collection('distSettings').doc('inventoryProductOrder').get()).data()
  pass(
    resetDoc.enabled === false &&
    Array.isArray(resetDoc.productIds) &&
    resetDoc.productIds.length === 0 &&
    resetDoc.revision === 3,
    'distSettings/inventoryProductOrder restablecido con enabled: false y productIds: []'
  )

  // 11. View behavior after reset: default category/name sort
  const resetSorted = sortInventoryProducts(allProds, resetDoc.enabled ? resetDoc.productIds : undefined)
  pass(
    resetSorted[0].category <= resetSorted[1].category && resetSorted[1].category <= resetSorted[2].category,
    'tras reset la vista vuelve al orden predeterminado por categoría y nombre'
  )

  console.log(`\n========================================`)
  console.log(`TODAS LAS ${passed} PRUEBAS EN EMULATOR APROBADAS`)
  console.log(`========================================`)
} finally {
  await env.cleanup()
  await app.delete()
}
