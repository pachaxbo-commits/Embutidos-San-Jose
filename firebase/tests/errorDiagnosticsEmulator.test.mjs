import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'

const projectId = 'demo-pachax-audit'
const authBase = process.env.SANJOSE_AUTH_EMULATOR_BASE || 'http://127.0.0.1:9095'
const functionsBase = process.env.SANJOSE_FUNCTIONS_EMULATOR_BASE || `http://127.0.0.1:5001/${projectId}/us-central1/manageSanJoseDiagnostics`
process.env.FIRESTORE_EMULATOR_HOST = process.env.SANJOSE_FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085'
const require = createRequire(new URL('../../functions/package.json', import.meta.url))
const { initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const app = initializeApp({ projectId }, `diagnostics-e2e-${Date.now()}`)
const db = getFirestore(app)
const suffix = randomBytes(5).toString('hex')
const testUsers = {
  distributor: { email: `diagnostics-${suffix}@example.test`, password: `Test-${suffix}-Pass!`, role: 'distributor' },
  admin: { email: `diagnostics-admin-${suffix}@example.test`, password: `Test-${suffix}-Pass!`, role: 'admin' },
  warehouse: { email: `diagnostics-warehouse-${suffix}@example.test`, password: `Test-${suffix}-Pass!`, role: 'warehouse' },
}
const createdUids = []

async function signUp(user) {
  const response = await fetch(`${authBase}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: user.password, returnSecureToken: true }),
  })
  const body = await response.json()
  assert.equal(response.ok, true, `Auth Emulator signup failed: ${JSON.stringify(body)}`)
  createdUids.push(body.localId)
  await db.doc(`restaurants/sanjose/members/${body.localId}`).set({
    uid: body.localId, role: user.role, active: true,
    displayName: `Diagnostics QA ${user.role}`, routeId: user.role === 'distributor' ? 'route-qa' : '',
  })
  return body.idToken
}

async function callable(token, data) {
  const response = await fetch(functionsBase, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ data }),
  })
  const body = await response.json()
  return { ok: response.ok, status: response.status, body }
}

try {
  const [distributorToken, adminToken, warehouseToken] = await Promise.all(Object.values(testUsers).map(signUp))
  const code = `ERR-${randomBytes(3).toString('hex').toUpperCase()}`
  const report = {
    code, occurredAt: new Date().toISOString(), appVersion: 'emulator-test', build: 'test',
    browser: 'Chrome', operatingSystem: 'Android', view: 'dist.closure', source: 'react_render', category: 'render',
    errorName: 'TypeError', message: 'Controlled diagnostics emulator test; no business operation was created.',
    stack: 'at ClosureView (test-only)', componentStack: 'at ClosureView', recentEvents: [],
  }
  const submit = await callable(distributorToken, {
    action: 'submit', report,
    occurrenceIdentity: { uid: createdUids[0], restaurantId: 'sanjose' },
  })
  assert.equal(submit.ok, true, JSON.stringify(submit.body))
  assert.equal(submit.body.result?.accepted, true)
  console.log('PASS distributor session A uploads a controlled diagnostic to the Functions/Firestore Emulators')
  const retried = await callable(distributorToken, {
    action: 'submit', report,
    occurrenceIdentity: { uid: createdUids[0], restaurantId: 'sanjose' },
  })
  assert.equal(retried.ok, true, JSON.stringify(retried.body))
  assert.equal(retried.body.result?.duplicateDelivery, true)
  console.log('PASS retry after a lost response does not create a duplicate occurrence')

  const adminList = await callable(adminToken, { action: 'list' })
  assert.equal(adminList.ok, true, JSON.stringify(adminList.body))
  assert.ok(adminList.body.result?.reports?.some(item => item.code === code))
  console.log('PASS authorized admin session B sees the same diagnostic uploaded by session A')

  const distributorList = await callable(distributorToken, { action: 'list' })
  assert.equal(distributorList.ok, false)
  assert.match(JSON.stringify(distributorList.body), /permission[-_]denied/i)
  const warehouseList = await callable(warehouseToken, { action: 'list' })
  assert.equal(warehouseList.ok, false)
  assert.match(JSON.stringify(warehouseList.body), /permission[-_]denied/i)
  console.log('PASS distributor and warehouse sessions cannot read global diagnostics')

  const adminSnapshot = await db.collection('restaurants/sanjose/distErrorDiagnostics').where('code', '==', code).get()
  assert.equal(adminSnapshot.size, 1)
  assert.equal(adminSnapshot.docs[0].data().actorUid, createdUids[0])
  assert.equal(adminSnapshot.docs[0].data().occurrenceCount, 1)
  console.log('PASS emulator persisted exactly one report with server-derived actor identity')
} finally {
  await Promise.all(createdUids.map(uid => db.doc(`restaurants/sanjose/members/${uid}`).delete()))
  await app.delete()
}
