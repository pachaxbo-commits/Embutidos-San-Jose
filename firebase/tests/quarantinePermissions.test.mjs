// End-to-end permission and backend check against Firestore Emulator Security Rules.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'

const projectId = 'demo-pachax-audit'
const host = '127.0.0.1'
const port = 8085
const rules = fs.readFileSync('firebase/firestore.rules', 'utf8')
const oldRules = rules.replace(/^\s*\|\| \(request\.resource\.data\.type == 'resolveQuarantine' && distAdmin\(restaurantId\)\)\r?\n/m, '')
assert.notEqual(oldRules, rules, 'la suite debe encontrar la regla nueva para construir la línea base previa al fix')

const require = createRequire(new URL('../../functions/package.json', import.meta.url))
process.env.FIRESTORE_EMULATOR_HOST = `${host}:${port}`
const { initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { processCommand } = require('./operations.cjs')
const app = initializeApp({ projectId }, `quarantine-rules-${Date.now()}`)
const adminDb = getFirestore(app)
const root = adminDb.doc('restaurants/sanjose')
const env = await initializeTestEnvironment({ projectId, firestore: { host, port, rules } })
const prefix = `qrules-${Date.now().toString(36)}`
const users = {
  admin: `${prefix}-admin`,
  warehouse: `${prefix}-warehouse`,
  distributor: `${prefix}-distributor`,
  support: `${prefix}-support`,
}
let checks = 0
const pass = (condition, label) => { assert.ok(condition, label); checks++; console.log('PASS', label) }
const operationData = (id, restaurantId = 'sanjose', createdBy = users.admin) => ({
  id,
  restaurantId,
  createdBy,
  createdAt: new Date().toISOString(),
  type: 'resolveQuarantine',
  payload: { lotId: `${prefix}-quarantine-lot`, location: 'central', resolution: 'released_existing_lot', destinationLotId: `${prefix}-good-lot`, reason: 'Verificación QA' },
  status: 'queued',
})
const request = (actor, id, restaurantId = 'sanjose', createdBy = actor) => setDoc(
  doc(env.authenticatedContext(actor).firestore(), 'restaurants', restaurantId, 'distOperations', id),
  operationData(id, restaurantId, createdBy),
)
const setRules = async (source) => {
  const response = await fetch(`http://${host}:${port}/emulator/v1/projects/${projectId}:securityRules`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: source }] } }),
  })
  assert.equal(response.ok, true, `no se pudo cargar Rules en Emulator: ${response.status} ${await response.text()}`)
}

try {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    for (const [uid, role] of Object.entries({ admin: 'admin', warehouse: 'warehouse', distributor: 'distributor', support: 'support' })) {
      await setDoc(doc(db, 'restaurants', 'sanjose', 'members', users[uid]), { role, active: true, displayName: `QA ${role}` })
    }
    await setDoc(doc(db, 'restaurants', 'sanjose', 'distProducts', `${prefix}-product`), {
      id: `${prefix}-product`, restaurantId: 'sanjose', name: 'Viena QA', unitType: 'kg', active: true, productionCost: 8,
    })
    await setDoc(doc(db, 'restaurants', 'sanjose', 'distBalances', `central__${prefix}-product`), {
      id: `central__${prefix}-product`, restaurantId: 'sanjose', locationKind: 'central', productId: `${prefix}-product`, quantity: 5.74,
    })
    await setDoc(doc(db, 'restaurants', 'sanjose', 'distLots', `${prefix}-quarantine-lot`), {
      id: `${prefix}-quarantine-lot`, restaurantId: 'sanjose', productId: `${prefix}-product`, productName: 'Viena QA', unitType: 'kg',
      lotCode: 'SOBRANTE POR REVISAR', manufacturedOn: '', expiresOn: '', productionCost: null, quarantined: true,
      quantities: { central: 0.74 }, createdAt: new Date().toISOString(), createdBy: users.admin,
    })
    await setDoc(doc(db, 'restaurants', 'sanjose', 'distLots', `${prefix}-good-lot`), {
      id: `${prefix}-good-lot`, restaurantId: 'sanjose', productId: `${prefix}-product`, productName: 'Viena QA', unitType: 'kg',
      lotCode: '171026', manufacturedOn: '2026-10-17', expiresOn: '2026-11-17', productionCost: 8,
      quantities: { central: 5 }, createdAt: new Date().toISOString(), createdBy: users.admin,
    })
  })

  // This is the exact deployed-before-fix rule set; prove the admin write was denied by Rules.
  await setRules(oldRules)
  let baselineError
  try { await request(users.admin, `${prefix}-same-operation`) } catch (error) { baselineError = error }
  assert.equal(baselineError?.code, 'permission-denied', 'antes del fix, Rules debe negar el envío admin con permission-denied')
  pass(true, 'Rules anteriores reproducen permission-denied para resolveQuarantine de Administración')
  await assertFails(request(users.warehouse, `${prefix}-warehouse-denied`)); checks++
  await assertFails(request(users.distributor, `${prefix}-distributor-denied`)); checks++
  await assertFails(request(users.support, `${prefix}-support-denied`)); checks++
  await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), 'restaurants', 'sanjose', 'distOperations', `${prefix}-anonymous`), operationData(`${prefix}-anonymous`, 'sanjose', 'anonymous'))); checks++
  await assertFails(request(users.admin, `${prefix}-other-tenant`, 'other-tenant')); checks++
  pass(true, 'warehouse, distributor, support, anónimo y otro tenant son denegados')

  await setRules(rules)
  const operationId = `${prefix}-same-operation`
  await assertSucceeds(request(users.admin, operationId))
  pass(true, 'con la regla corregida, Administración puede crear resolveQuarantine queued')

  for (const collection of ['distLots', 'distBalances', 'distStockMovements', 'distLotHistory']) {
    await assertFails(setDoc(doc(env.authenticatedContext(users.admin).firestore(), 'restaurants', 'sanjose', collection, `${prefix}-forbidden-write`), { id: `${prefix}-forbidden-write`, restaurantId: 'sanjose' }))
    checks++
  }
  pass(true, 'la escritura directa en lotes, balances, movimientos e historial sigue bloqueada')

  const operationRef = root.collection('distOperations').doc(operationId)
  await processCommand(adminDb, operationRef)
  let operation = (await operationRef.get()).data()
  assert.equal(operation.status, 'confirmed', operation.error || 'backend no confirmó la liberación')
  const sourceLot = (await root.collection('distLots').doc(`${prefix}-quarantine-lot`).get()).data()
  let targetLot = (await root.collection('distLots').doc(`${prefix}-good-lot`).get()).data()
  const balance = (await root.collection('distBalances').doc(`central__${prefix}-product`).get()).data()
  assert.equal(sourceLot.quantities.central, 0)
  assert.equal(targetLot.quantities.central, 5.74)
  assert.equal(balance.quantity, 5.74)
  assert.equal(sourceLot.quarantineResolution, 'released_existing_lot')
  assert.equal(sourceLot.quarantineResolvedBy, users.admin)
  const movement = (await root.collection('distStockMovements').doc(operation.result.movementId).get()).data()
  assert.equal(movement.type, 'quarantine_release')
  assert.equal(movement.centralDelta, 0)
  pass(true, 'Function auditada confirma y libera 0.740 kg sin cambiar stock físico')

  await processCommand(adminDb, operationRef)
  targetLot = (await root.collection('distLots').doc(`${prefix}-good-lot`).get()).data()
  assert.equal(targetLot.quantities.central, 5.74)
  const duplicateId = `${prefix}-second-resolution`
  const duplicateRef = root.collection('distOperations').doc(duplicateId)
  await duplicateRef.set({ ...operationData(duplicateId), payload: operationData(operationId).payload })
  await processCommand(adminDb, duplicateRef)
  const duplicate = (await duplicateRef.get()).data()
  assert.equal(duplicate.status, 'rejected')
  assert.equal((await root.collection('distLots').doc(`${prefix}-good-lot`).get()).data().quantities.central, 5.74)
  pass(true, 'reintento del mismo operationId y nueva resolución repetida no duplican stock')
  console.log(`${checks} comprobaciones de reglas más verificaciones backend aprobadas`)
} finally {
  await env.cleanup()
  await app.delete()
}
