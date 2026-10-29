import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'

const req = createRequire(new URL('../../functions/package.json', import.meta.url))
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9095'
const { initializeApp } = req('firebase-admin/app')
const { getFirestore } = req('firebase-admin/firestore')
const { getAuth } = req('firebase-admin/auth')
const projectId = 'demo-pachax-audit'
const app = initializeApp({ projectId }, 'qa-processing-quality-auth')
const db = getFirestore(app)
const auth = getAuth(app)
const root = db.doc('restaurants/sanjose')
const env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8085, rules: fs.readFileSync('firebase/firestore.rules', 'utf8') } })
const prefix = `qauth${Date.now().toString(36)}`
let checks = 0
const pass = (condition, message) => { assert.ok(condition, message); checks++; console.log(`PASS ${message}`) }
async function authUser(uid, email, claims = {}) {
  const user = await auth.createUser({ uid, email, password: 'QA-only-password-123!' })
  await auth.setCustomUserClaims(uid, claims)
  const response = await fetch('http://127.0.0.1:9095/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'QA-only-password-123!', returnSecureToken: true }) })
  assert.equal(response.status, 200)
  return { uid: user.uid, token: (await response.json()).idToken }
}
async function callable(token, data) {
  return fetch('http://127.0.0.1:5001/demo-pachax-audit/us-central1/manageProcessingQualityAuthorization', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ data }) })
}

try {
  const granteeUid = `${prefix}-qa-reviewer`, ordinaryUid = `${prefix}-ordinary`, authorityUid = `${prefix}-authority`
  await root.collection('members').doc(granteeUid).set({ uid: granteeUid, role: 'admin', active: true, displayName: 'QA autorizado' })
  await root.collection('members').doc(ordinaryUid).set({ uid: ordinaryUid, role: 'admin', active: true, displayName: 'QA ordinario' })
  await root.collection('members').doc(authorityUid).set({ uid: authorityUid, role: 'admin', active: true, displayName: 'QA concedente' })
  const ordinary = await authUser(ordinaryUid, `${ordinaryUid}@example.test`)
  const authority = await authUser(authorityUid, `${authorityUid}@example.test`, { processingQualityGrantAuthority: true })
  const noAuth = await callable('', { action: 'grant', beneficiaryUid: granteeUid, reason: 'QA test', validDays: 1 })
  pass(noAuth.status >= 400, 'llamada sin autenticación no concede autorizaciones')
  const ordinaryResult = await callable(ordinary.token, { action: 'grant', beneficiaryUid: granteeUid, reason: 'QA test', validDays: 1 })
  pass(ordinaryResult.status >= 400, 'Administración ordinaria no tiene autoridad para conceder permisos de calidad')
  const selfGrant = await callable(authority.token, { action: 'grant', beneficiaryUid: authorityUid, reason: 'QA autoasignación', validDays: 1 })
  pass(selfGrant.status >= 400, 'el concedente privilegiado no puede autoasignarse calidad')
  const invalidExpiry = await callable(authority.token, { action: 'grant', beneficiaryUid: granteeUid, reason: 'QA vencimiento excesivo', validDays: 999 })
  pass(invalidExpiry.status >= 400, 'la vigencia queda limitada por validación del servidor')
  const grantedResponse = await callable(authority.token, { action: 'grant', beneficiaryUid: granteeUid, reason: 'Responsable de calidad de turno QA', validDays: 7 })
  assert.equal(grantedResponse.status, 200)
  const granted = (await grantedResponse.json()).result
  const authorization = (await root.collection('distProcessingQualityAuthorizations').doc(granteeUid).get()).data()
  const grantEvents = await root.collection('distProcessingQualityAuthorizationEvents').where('beneficiaryUid', '==', granteeUid).get()
  pass(granted.status === 'active' && authorization.grantedBy === authorityUid && authorization.expiresAt === granted.expiresAt && grantEvents.size === 1, 'concesión guarda beneficiario, concedente, motivo, vigencia y evento auditable')
  const rulesDb = env.authenticatedContext(authorityUid).firestore()
  await assertFails(setDoc(doc(rulesDb, 'restaurants', 'sanjose', 'distProcessingQualityAuthorizations', ordinaryUid), { status: 'active', beneficiaryUid: ordinaryUid })); checks++
  pass(true, 'Rules impiden escrituras directas de autorizaciones incluso a Administración')
  const revokeResponse = await callable(authority.token, { action: 'revoke', beneficiaryUid: granteeUid, reason: 'Fin de turno QA' })
  assert.equal(revokeResponse.status, 200)
  const afterRevoke = (await root.collection('distProcessingQualityAuthorizations').doc(granteeUid).get()).data()
  const events = await root.collection('distProcessingQualityAuthorizationEvents').where('beneficiaryUid', '==', granteeUid).get()
  pass(afterRevoke.status === 'revoked' && afterRevoke.revokedBy === authorityUid && afterRevoke.revokeReason === 'Fin de turno QA' && events.size === 2, 'revocación queda efectiva y agrega evento sin borrar la concesión histórica')
  const grantAgain = await callable(authority.token, { action: 'grant', beneficiaryUid: granteeUid, reason: 'QA nueva vigencia', validDays: 1 })
  pass(grantAgain.status === 200 && (await root.collection('distProcessingQualityAuthorizationEvents').where('beneficiaryUid', '==', granteeUid).get()).size === 3, 'una autorización revocada puede renovarse con nuevo identificador y auditoría')
  console.log(`processing quality authorization emulator: ${checks} checks PASS`)
} finally {
  await env.cleanup()
  await app.delete()
}
