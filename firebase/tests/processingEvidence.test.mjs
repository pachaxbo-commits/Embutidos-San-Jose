import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'
import { ref, uploadBytes } from 'firebase/storage'
import { createHash } from 'node:crypto'

const req = createRequire(new URL('../../functions/package.json', import.meta.url))
const projectId = 'demo-pachax-audit'
const bucket = `${projectId}.appspot.com`
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9095'
process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199'
process.env.FUNCTIONS_EMULATOR = 'true'
process.env.SANJOSE_PROCESSING_EVIDENCE_BUCKET = bucket
const { initializeApp } = req('firebase-admin/app')
const app = initializeApp({ projectId, storageBucket: bucket })
const db = req('firebase-admin/firestore').getFirestore(app)
const root = db.doc('restaurants/sanjose')
const { processCommand } = req('./operations.cjs')
const env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8085, rules: fs.readFileSync('firebase/firestore.rules', 'utf8') }, storage: { host: '127.0.0.1', port: 9199, rules: fs.readFileSync('firebase/storage.rules', 'utf8') } })
const prefix = `pe${Date.now().toString(36)}`
let checks = 0
const pass = (condition, message) => { assert.ok(condition, message); checks++; console.log(`PASS ${message}`) }
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

try {
  const warehouseUid = `${prefix}-warehouse`, adminUid = `${prefix}-admin`, distributorUid = `${prefix}-seller`
  const lotId = `${prefix}-lot`, reservationId = `${prefix}-reservation`, caseId = `${prefix}-case`, reviewId = `${prefix}-review`, evidenceId = `${prefix}-evidence`
  const operationId = `${prefix}-register-evidence`, reviewOperationId = `${prefix}-record-review`
  const location = 'central', productId = `${prefix}-product`
  await root.collection('members').doc(warehouseUid).set({ uid: warehouseUid, role: 'warehouse', active: true, warehouseId: 'central', displayName: 'QA Almacén' })
  await root.collection('members').doc(adminUid).set({ uid: adminUid, role: 'admin', active: true, displayName: 'QA Admin' })
  await root.collection('members').doc(distributorUid).set({ uid: distributorUid, role: 'distributor', active: true, routeId: `${prefix}-route` })
  await root.collection('distProducts').doc(productId).set({ id: productId, restaurantId: 'sanjose', name: 'QA Sachet', unitType: 'package', active: true, referencePrice: 10 })
  await root.collection('distStockReservations').doc(reservationId).set({ id: reservationId, restaurantId: 'sanjose', lotId, productId, location, purpose: 'review_hold', status: 'active', remainingQuantity: 2, remainingWeightG: 500, remainingCostCents: 250 })
  await root.collection('distLots').doc(lotId).set({ id: lotId, restaurantId: 'sanjose', productId, quantities: { central: 2 }, processingUnavailable: { central: { courtesy: 0, repackPending: 0, reviewHold: 2 } }, processingReview: { caseId, latestReviewId: reviewId, revision: 1, status: 'in_review' } })
  await root.collection('distBalances').doc(`central__${productId}`).set({ id: `central__${productId}`, restaurantId: 'sanjose', locationKind: 'central', warehouseId: 'central', productId, unitType: 'package', quantity: 2 })
  await root.collection('distProcessingReviews').doc(reviewId).set({ id: reviewId, restaurantId: 'sanjose', caseId, lotId, reservationId, location, revision: 1, status: 'in_review' })

  const bytes = Buffer.from('%PDF-1.4\nQA evidence fixture\n%%EOF\n')
  const sha256 = hash(bytes)
  const objectPath = `processing-evidence/sanjose/${location}/${reservationId}/${caseId}/1/${warehouseUid}/${evidenceId}`
  const customMetadata = { restaurantId: 'sanjose', lotId, reservationId, reviewCaseId: caseId, reviewRevision: '1', location, uploadedBy: warehouseUid, evidenceType: 'measurement_record', sha256, evidenceId }
  const warehouseStorage = env.authenticatedContext(warehouseUid).storage(bucket)
  await assertSucceeds(uploadBytes(ref(warehouseStorage, objectPath), bytes, { contentType: 'application/pdf', customMetadata })); checks++
  pass(true, 'Almacén puede subir PDF sólo al caso de revisión y ubicación vinculados')

  const distributorStorage = env.authenticatedContext(distributorUid).storage(bucket)
  await assertFails(uploadBytes(ref(distributorStorage, `processing-evidence/sanjose/${location}/${reservationId}/${caseId}/1/${distributorUid}/${prefix}-foreign`), bytes, { contentType: 'application/pdf', customMetadata: { ...customMetadata, uploadedBy: distributorUid, evidenceId: `${prefix}-foreign` } })); checks++
  pass(true, 'Rules rechazan carga de evidencia por distribuidor')

  const operation = { id: operationId, restaurantId: 'sanjose', createdBy: warehouseUid, createdAt: new Date().toISOString(), type: 'recordProcessingEvidence', status: 'queued', payload: { lotId, reservationId, location, reviewCaseId: caseId, reviewRevision: 1, evidenceType: 'measurement_record', evidenceId } }
  await assertSucceeds(setDoc(doc(env.authenticatedContext(warehouseUid).firestore(), 'restaurants', 'sanjose', 'distOperations', operationId), operation)); checks++
  await processCommand(db, root.collection('distOperations').doc(operationId))
  const savedOperation = (await root.collection('distOperations').doc(operationId).get()).data()
  const savedEvidence = (await root.collection('distProcessingEvidence').doc(evidenceId).get()).data()
  pass(savedOperation.status === 'confirmed' && savedEvidence.status === 'verified' && savedEvidence.sha256 === sha256 && savedEvidence.objectGeneration && savedEvidence.byteSize === bytes.length, `servidor verifica bytes, SHA-256, generación y contexto antes de registrar evidencia (${savedOperation.error || savedOperation.status})`)

  const badRevisionId = `${prefix}-bad-revision`, badEvidenceId = `${prefix}-bad-evidence`
  const badOperation = { ...operation, id: badRevisionId, createdAt: new Date().toISOString(), payload: { ...operation.payload, evidenceId: badEvidenceId, reviewRevision: 2 } }
  await setDoc(doc(env.authenticatedContext(warehouseUid).firestore(), 'restaurants', 'sanjose', 'distOperations', badRevisionId), badOperation)
  await processCommand(db, root.collection('distOperations').doc(badRevisionId))
  const badResult = (await root.collection('distOperations').doc(badRevisionId).get()).data()
  pass(badResult.status === 'rejected' && !(await root.collection('distProcessingEvidence').doc(badEvidenceId).get()).exists, 'el registro con revisión obsoleta se rechaza sin crear evidencia validada')

  const review = { id: reviewOperationId, restaurantId: 'sanjose', createdBy: warehouseUid, createdAt: new Date().toISOString(), type: 'recordProcessingReview', status: 'queued', payload: { lotId, reservationId, location, expectedRevision: 1, action: 'record_observation', physicalWeightG: 500, packageCondition: 'sealed_intact', productObservation: 'apparently_apt', observations: 'Evidencia adjunta en prueba', reason: 'Validar ruta de carga de evidencia', evidenceRefs: [evidenceId] } }
  await setDoc(doc(env.authenticatedContext(warehouseUid).firestore(), 'restaurants', 'sanjose', 'distOperations', reviewOperationId), review)
  await processCommand(db, root.collection('distOperations').doc(reviewOperationId))
  pass((await root.collection('distOperations').doc(reviewOperationId).get()).data().status === 'confirmed', 'la revisión consume la referencia verificada del archivo sin liberar reserva ni cambiar existencias')
  console.log(`processing evidence emulator: ${checks} checks PASS`)
} finally {
  await env.cleanup()
  await app.delete()
}
