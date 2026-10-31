// Shared dispatch product-order operation and Firestore permissions. Emulator only.
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
const projectId = 'demo-pachax-audit'
const app = initializeApp({ projectId }, `qa-dispatch-order-${Date.now()}`)
const db = getFirestore(app)
const root = db.doc('restaurants/sanjose')
const env = await initializeTestEnvironment({
  projectId,
  firestore: { host: '127.0.0.1', port: 8085, rules: fs.readFileSync('firebase/firestore.rules', 'utf8') },
})
const prefix = `order${Date.now().toString(36)}`
const admin = `${prefix}-admin`
const warehouse = `${prefix}-warehouse`
const distributor = `${prefix}-distributor`
const support = `${prefix}-support`
const settingsRef = root.collection('distSettings').doc('dispatchProductOrder')
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
    id, restaurantId: 'sanjose', createdBy: actor, createdAt: new Date().toISOString(),
    type: 'saveDispatchProductOrder', payload, status: 'queued',
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
    stop = onSnapshot(doc(firestore, 'restaurants', 'sanjose', 'distSettings', 'dispatchProductOrder'), snapshot => {
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
  for (const [uid, role] of [[admin, 'admin'], [warehouse, 'warehouse'], [distributor, 'distributor'], [support, 'support']]) {
    await root.collection('members').doc(uid).set({ uid, role, displayName: role, active: true })
  }
  for (const [id, active] of [['p1', true], ['p2', true], ['inactive', false]]) {
    await root.collection('distProducts').doc(id).set({ id, name: id, active, deleted: false, restaurantId: 'sanjose' })
  }

  const adminDb = env.authenticatedContext(admin).firestore()
  const warehouseDb = env.authenticatedContext(warehouse).firestore()
  const distributorDb = env.authenticatedContext(distributor).firestore()
  const supportDb = env.authenticatedContext(support).firestore()
  await assert.rejects(setDoc(doc(adminDb, 'restaurants', 'sanjose', 'distSettings', 'dispatchProductOrder'), { enabled: true }))
  await assert.rejects(setDoc(doc(distributorDb, 'restaurants', 'sanjose', 'distOperations', `${prefix}-direct`), {
    id: `${prefix}-direct`, restaurantId: 'sanjose', createdBy: distributor, createdAt: new Date().toISOString(),
    type: 'saveDispatchProductOrder', payload: { expectedRevision: 0, productIds: ['p2', 'p1', 'p3'] }, status: 'queued',
  }))
  pass(true, 'solo el servidor escribe configuración y distribuidores no pueden crear operaciones para ordenarla')

  const initialAdminSync = waitForRevision(adminDb, 1)
  const initialDistributorSync = waitForRevision(distributorDb, 1)
  await command(admin, { expectedRevision: 0, productIds: ['p2', 'p1'] })
  const [adminSynced, distributorSynced] = await Promise.all([initialAdminSync, initialDistributorSync])
  pass(adminSynced.productIds.join(',') === 'p2,p1' && distributorSynced.productIds.join(',') === 'p2,p1', 'Administración y distribuidor reciben el mismo orden en vivo')

  await command(warehouse, { expectedRevision: 1, productIds: ['p1', 'p2'] })
  const [adminRead, warehouseRead, distributorRead] = await Promise.all([
    getDoc(doc(adminDb, 'restaurants', 'sanjose', 'distSettings', 'dispatchProductOrder')),
    getDoc(doc(warehouseDb, 'restaurants', 'sanjose', 'distSettings', 'dispatchProductOrder')),
    getDoc(doc(distributorDb, 'restaurants', 'sanjose', 'distSettings', 'dispatchProductOrder')),
  ])
  pass([adminRead, warehouseRead, distributorRead].every(snapshot => snapshot.exists() && snapshot.data().productIds.join(',') === 'p1,p2' && snapshot.data().revision === 2), 'el orden persiste tras recargar y coincide en sesiones de Administración, Almacén y distribuidor')

  const stale = await command(admin, { expectedRevision: 1, productIds: ['p2', 'p1', 'p3'] }, 'rejected')
  pass(stale.error.includes('cambió en otro dispositivo') && (await settingsRef.get()).data().revision === 2, 'revisión obsoleta se rechaza sin sobrescribir una edición concurrente')

  await root.collection('distProducts').doc('p3').set({ id: 'p3', name: 'Producto nuevo', active: true, deleted: false, restaurantId: 'sanjose' })
  const missingNewProduct = await command(admin, { expectedRevision: 2, productIds: ['p1', 'p2'] }, 'rejected')
  pass(missingNewProduct.error.includes('productos activos cambió') && (await settingsRef.get()).data().revision === 2, 'un producto activo nuevo obliga a revisar la lista antes de guardar')
  const inactiveIncluded = await command(warehouse, { expectedRevision: 2, productIds: ['p3', 'p1', 'p2', 'inactive'] }, 'rejected')
  pass(inactiveIncluded.error.includes('productos activos cambió'), 'el servidor excluye productos inactivos del orden')

  await command(warehouse, { expectedRevision: 2, productIds: ['p2', 'p3', 'p1'] })
  const reset = await command(admin, { expectedRevision: 3, reset: true })
  const resetSetting = (await settingsRef.get()).data()
  pass(resetSetting.enabled === false && resetSetting.productIds.length === 0 && resetSetting.revision === 4 && reset.result.revision === 4, 'restablecer desactiva el orden personalizado con revisión monotónica')

  await assert.rejects(getDoc(doc(supportDb, 'restaurants', 'sanjose', 'distSettings', 'dispatchProductOrder')))
  pass(true, 'soporte no recibe permiso de lectura de configuración de despacho')
  console.log(`${passed} comprobaciones de orden compartido y permisos aprobadas`)
} finally {
  await env.cleanup()
  await app.delete()
}
