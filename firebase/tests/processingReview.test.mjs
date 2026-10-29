// Specialized inspection workflow tests. Emulator only; all fixture records are synthetic.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing'
import { doc, setDoc, getDoc } from 'firebase/firestore'

const req = createRequire(new URL('../../functions/package.json', import.meta.url))
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085'
process.env.FUNCTIONS_EMULATOR = 'true'
const { initializeApp } = req('firebase-admin/app')
const { getFirestore } = req('firebase-admin/firestore')
const { processCommand } = req('./operations.cjs')
const projectId = 'demo-pachax-audit'
const adminApp = initializeApp({ projectId }, 'qa-processing-review')
const db = getFirestore(adminApp)
const root = db.doc('restaurants/sanjose')
const env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8085, rules: fs.readFileSync('firebase/firestore.rules', 'utf8') } })
const prefix = `review${Date.now().toString(36)}`
const ids = { admin: `${prefix}-admin`, quality: `${prefix}-quality`, warehouse: `${prefix}-warehouse`, otherWarehouse: `${prefix}-other-wh`, distributor: `${prefix}-distributor`, warehouseId: `${prefix}-wh`, otherWarehouseId: `${prefix}-wh2`, route: `${prefix}-route` }
let checks = 0
const pass = (condition, message) => { assert.ok(condition, message); checks++; console.log(`PASS ${message}`) }
const queueDb = uid => env.authenticatedContext(uid).firestore()
async function command(actor, type, payload, operationId = `${prefix}-${type}-${Math.random().toString(36).slice(2)}`, expected = 'confirmed') {
  const ref = root.collection('distOperations').doc(operationId)
  await setDoc(doc(queueDb(actor), 'restaurants', 'sanjose', 'distOperations', operationId), { id: operationId, restaurantId: 'sanjose', createdBy: actor, createdAt: new Date().toISOString(), type, payload, status: 'queued' })
  await processCommand(db, ref)
  const operation = (await ref.get()).data()
  if (expected) assert.equal(operation.status, expected, `${type}: ${operation.error || 'estado inesperado'}`)
  return operation
}
async function seedReviewLot({ lotId, productId, location, quantity, unitType, purpose, weightG, costCents, extraLot = {} }) {
  const reservationId = `${lotId}-reservation`
  await root.collection('distProducts').doc(productId).set({ id: productId, restaurantId: 'sanjose', name: `QA ${productId}`, sku: `SKU-${productId}`, unitType, active: true, productionCost: unitType === 'kg' ? 25 : null })
  await root.collection('distLots').doc(lotId).set({ id: lotId, restaurantId: 'sanjose', productId, productName: `QA ${productId}`, unitType, lotCode: `LOT-${lotId}`, manufacturedOn: '2026-10-20', expiresOn: '2026-11-20', productionCost: unitType === 'kg' ? 25 : null, quantities: { [location]: quantity }, processingUnavailable: { [location]: { courtesy: 0, repackPending: purpose === 'repack_pending' ? quantity : 0, reviewHold: purpose === 'review_hold' ? quantity : 0 } }, ...extraLot, ...(extraLot.derivedReturn ? { derivedReturn: { ...extraLot.derivedReturn, reservationId } } : {}) })
  await root.collection('distBalances').doc(`${location}__${productId}`).set({ id: `${location}__${productId}`, restaurantId: 'sanjose', productId, unitType, locationKind: location === 'central' ? 'central' : 'warehouse', warehouseId: location === 'central' ? 'central' : location.slice('warehouse__'.length), quantity })
  await root.collection('distStockReservations').doc(reservationId).set({ id: reservationId, restaurantId: 'sanjose', branchId: 'main', schemaVersion: 1, productId, productName: `QA ${productId}`, lotId, lotCode: `LOT-${lotId}`, unitType, location, purpose, originalQuantity: quantity, remainingQuantity: quantity, consumedQuantity: 0, physicalWeightG: weightG, remainingWeightG: weightG, remainingCostCents: costCents, status: 'active', source: 'qa', createdAt: new Date().toISOString(), createdBy: ids.admin, createdByName: 'QA', history: [] })
  return reservationId
}
const input = (lotId, reservationId, location, patch = {}) => ({ lotId, reservationId, location, expectedRevision: 0, action: 'record_observation', physicalWeightG: null, packageCondition: 'unknown', productObservation: 'not_assessed', observations: 'Inspección sintética QA', reason: 'Prueba del flujo de revisión', evidenceRefs: [], ...patch })

try {
  await root.collection('members').doc(ids.admin).set({ role: 'admin', active: true, displayName: 'QA Admin' })
  await root.collection('members').doc(ids.quality).set({ role: 'admin', active: true, displayName: 'QA Calidad' })
  await root.collection('members').doc(ids.warehouse).set({ role: 'warehouse', active: true, warehouseId: ids.warehouseId, displayName: 'QA Almacén' })
  await root.collection('members').doc(ids.otherWarehouse).set({ role: 'warehouse', active: true, warehouseId: ids.otherWarehouseId, displayName: 'Otro Almacén' })
  await root.collection('members').doc(ids.distributor).set({ role: 'distributor', active: true, routeId: ids.route, displayName: 'QA Distribuidor' })
  await root.collection('distProcessingQualityAuthorizations').doc(ids.quality).set({ id: 'QA-AUTH-2026', authorizationId: 'QA-AUTH-2026', restaurantId: 'sanjose', status: 'active', beneficiaryUid: ids.quality, grantedBy: ids.admin, expiresAt: '2027-12-31T23:59:59.000Z' })
  for (const warehouseId of [ids.warehouseId, ids.otherWarehouseId]) await root.collection('distWarehouses').doc(warehouseId).set({ id: warehouseId, restaurantId: 'sanjose', active: true, name: 'QA' })

  const location = `warehouse__${ids.warehouseId}`
  const lotId = `${prefix}-repack-lot`, productId = `${prefix}-repack-product`
  const reservationId = await seedReviewLot({ lotId, productId, location, quantity: 10, unitType: 'kg', purpose: 'repack_pending', weightG: 2000, costCents: 5000 })
  const beforeBalance = (await root.collection('distBalances').doc(`${location}__${productId}`).get()).data().quantity
  const beforeMovements = (await root.collection('distStockMovements').where('productId', '==', productId).get()).size
  const observation = await command(ids.warehouse, 'recordProcessingReview', input(lotId, reservationId, location, { physicalWeightG: 1900, packageCondition: 'no_package', productObservation: 'uncertain' }), `${prefix}-observe`)
  const reviewId = observation.result.reviewId
  let review = (await root.collection('distProcessingReviews').doc(reviewId).get()).data()
  const addEvidence = (evidenceId, caseId, evidenceLotId, evidenceReservationId, evidenceLocation, reviewRevision) => root.collection('distProcessingEvidence').doc(evidenceId).set({ id: evidenceId, restaurantId: 'sanjose', status: 'verified', evidenceType: 'photo', lotId: evidenceLotId, reservationId: evidenceReservationId, reviewCaseId: caseId, reviewRevision, location: evidenceLocation, uploadedBy: ids.warehouse, recordedAt: new Date().toISOString(), bucket: 'qa-fixture', objectPath: `processing-evidence/sanjose/${evidenceId}.jpg`, objectGeneration: '1', sha256: 'a'.repeat(64), byteSize: 128, contentType: 'image/jpeg', viewers: [ids.quality], verificationMethod: 'emulator_fixture', objectExists: true })
  let lot = (await root.collection('distLots').doc(lotId).get()).data()
  let reservation = (await root.collection('distStockReservations').doc(reservationId).get()).data()
  pass(observation.result.status === 'pending_review' && review.commercialQuantity === 10 && review.historicalAssignedWeightG === 2000 && review.physicalWeightG === 1900 && review.weightDifferenceG === 100 && review.costCents === 5000, 'revisión registra cantidad, gramos históricos, medida, diferencia y costo sin confundirlos')
  pass((await root.collection('distBalances').doc(`${location}__${productId}`).get()).data().quantity === beforeBalance && lot.quantities[location] === 10 && reservation.remainingQuantity === 10 && lot.processingUnavailable[location].repackPending === 10, 'inspección mantiene balance, lote y reserva exactos')
  pass((await root.collection('distStockMovements').where('productId', '==', productId).get()).size === beforeMovements, 'una inspección no genera movimiento Kardex')
  await processCommand(db, root.collection('distOperations').doc(`${prefix}-observe`))
  pass((await root.collection('distProcessingReviews').where('lotId', '==', lotId).get()).size === 1, 'reintento del mismo operationId no duplica informe')
  const wrongLocation = await command(ids.otherWarehouse, 'recordProcessingReview', input(lotId, reservationId, location, { expectedRevision: 1 }), `${prefix}-wrong-location`, 'rejected')
  pass(wrongLocation.error.includes('No tienes permiso') && (await root.collection('distLots').doc(lotId).get()).data().processingReview.revision === 1, 'Almacén no inspecciona reservas de otra ubicación')

  const unauthorizedApproval = await command(ids.admin, 'recordProcessingReview', input(lotId, reservationId, location, { expectedRevision: 1, action: 'authorize_repack', physicalWeightG: 1900, packageCondition: 'no_package', productObservation: 'apparently_apt', evidenceRefs: ['evidence-1'], qualityAuthorizationRef: 'fake-client-flag' }), `${prefix}-unauthorized-decision`, 'rejected')
  pass(unauthorizedApproval.error.includes('autorización de calidad') && (await root.collection('distLots').doc(lotId).get()).data().processingReview.revision === 1, 'Administración sin autorización de calidad no aprueba reenvasado ni cambia revisión')
  const noQualityClaim = await command(ids.warehouse, 'recordProcessingReview', input(lotId, reservationId, location, { expectedRevision: 1, action: 'record_observation', productObservation: 'confirmed_unfit' }), `${prefix}-warehouse-unfit`, 'rejected')
  pass(noQualityClaim.error.includes('observación') && (await root.collection('distLots').doc(lotId).get()).data().processingReview.revision === 1, 'Almacén no puede certificar no aptitud sanitaria')

  const concurrent = await Promise.all([
    command(ids.admin, 'recordProcessingReview', input(lotId, reservationId, location, { expectedRevision: 1, action: 'start_review' }), `${prefix}-review-race-a`, null),
    command(ids.admin, 'recordProcessingReview', input(lotId, reservationId, location, { expectedRevision: 1, action: 'start_review' }), `${prefix}-review-race-b`, null),
  ])
  pass(concurrent.filter(row => row.status === 'confirmed').length === 1 && concurrent.filter(row => row.status === 'rejected').length === 1, 'revisiones concurrentes con revisión esperada idéntica no sobrescriben la decisión')
  lot = (await root.collection('distLots').doc(lotId).get()).data()
  const currentRevision = lot.processingReview.revision
  await addEvidence('qa-evidence-ref', lot.processingReview.caseId, lotId, reservationId, location, currentRevision)
  const decision = await command(ids.quality, 'recordProcessingReview', input(lotId, reservationId, location, { expectedRevision: currentRevision, action: 'authorize_repack', physicalWeightG: 1900, packageCondition: 'no_package', productObservation: 'apparently_apt', observations: 'Autorización ficticia del entorno de pruebas', evidenceRefs: ['qa-evidence-ref'], qualityAuthorizationRef: 'QA-AUTH-2026' }), `${prefix}-authorize-repack`)
  lot = (await root.collection('distLots').doc(lotId).get()).data()
  reservation = (await root.collection('distStockReservations').doc(reservationId).get()).data()
  pass(decision.result.status === 'authorized_for_repack' && lot.processingReview.status === 'authorized_for_repack', 'cuenta QA con autorización confiable puede autorizar el siguiente procedimiento especializado')
  pass(lot.quantities[location] === 10 && reservation.remainingQuantity === 10 && lot.processingUnavailable[location].repackPending === 10 && (await root.collection('distBalances').doc(`${location}__${productId}`).get()).data().quantity === 10, 'autorización de reenvasado no libera, duplica ni modifica producto')
  const release = await command(ids.admin, 'releaseProcessingReservation', { reservationId, reason: 'QA intentar liberar' }, `${prefix}-generic-release`, 'rejected')
  pass(release.status === 'rejected' && (await root.collection('distStockReservations').doc(reservationId).get()).data().remainingQuantity === 10, 'liberación genérica sigue bloqueada incluso después de autorizar el procedimiento futuro')

  const unfitLotId = `${prefix}-unfit-lot`, unfitProductId = `${prefix}-unfit-product`
  const unfitReservationId = await seedReviewLot({ lotId: unfitLotId, productId: unfitProductId, location, quantity: 1, unitType: 'package', purpose: 'review_hold', weightG: null, costCents: null, extraLot: { quarantined: true, processingCommercialBlocked: true, processingDestinationKind: 'review_hold' } })
  const unfitObserve = await command(ids.warehouse, 'recordProcessingReview', input(unfitLotId, unfitReservationId, location, { packageCondition: 'package_damaged_partial', productObservation: 'uncertain' }), `${prefix}-unfit-observe`)
  await command(ids.admin, 'recordProcessingReview', input(unfitLotId, unfitReservationId, location, { expectedRevision: 1, action: 'start_review' }), `${prefix}-unfit-start`)
  await addEvidence('qa-unfit-evidence', unfitObserve.result.reviewId, unfitLotId, unfitReservationId, location, 2)
  const unfit = await command(ids.quality, 'recordProcessingReview', input(unfitLotId, unfitReservationId, location, { expectedRevision: 2, action: 'declare_unrecoverable', packageCondition: 'package_damaged_partial', productObservation: 'confirmed_unfit', observations: 'No apto según revisión sintética QA', evidenceRefs: ['qa-unfit-evidence'], qualityAuthorizationRef: 'QA-AUTH-2026' }), `${prefix}-unfit-decision`)
  const unfitLot = (await root.collection('distLots').doc(unfitLotId).get()).data()
  pass(unfit.result.status === 'not_recoverable' && unfitLot.processingReview.economicDispositionStatus === 'pending_quarantine_disposition', 'no apto requiere cuenta QA y queda pendiente de disposición económica, no descartado')
  pass(unfitLot.quantities[location] === 1 && unfitLot.processingUnavailable[location].reviewHold === 1 && (await root.collection('distStockReservations').doc(unfitReservationId).get()).data().remainingQuantity === 1, 'declaración de no aptitud conserva inmovilización física y costo histórico')

  const derivedLotId = `${prefix}-derived-return`, derivedProductId = `${prefix}-derived-product`
  const derivedReservationId = await seedReviewLot({ lotId: derivedLotId, productId: derivedProductId, location, quantity: 2, unitType: 'package', purpose: 'review_hold', weightG: 500, costCents: 250, extraLot: { quarantined: true, processingCommercialBlocked: true, processingDestinationKind: 'review_hold', processingBatchId: 'batch-derived', processingPhysicalWeightGRemaining: 500, processingCostCentsRemaining: 250, derivedReturn: { claimId: 'claim-qa', sourceSaleId: 'sale-qa', sourceLotId: 'source-qa', batchId: 'batch-derived', assignedWeightG: 500, measuredWeightG: null, physicalOriginConfirmed: false } } })
  const nullMeasurement = await command(ids.warehouse, 'recordProcessingReview', input(derivedLotId, derivedReservationId, location, { physicalWeightG: null, packageCondition: 'package_damaged_partial', productObservation: 'uncertain' }), `${prefix}-derived-null-measure`)
  const derivedReview = (await root.collection('distProcessingReviews').doc(nullMeasurement.result.reviewId).get()).data()
  pass(derivedReview.historicalAssignedWeightG === 500 && derivedReview.physicalWeightG === null && derivedReview.weightDifferenceG === null && derivedReview.costCents === 250, 'devolución derivada mantiene peso medido desconocido como null y separa 500 g históricos/Bs 2,50')
  await command(ids.admin, 'recordProcessingReview', input(derivedLotId, derivedReservationId, location, { expectedRevision: 1, action: 'start_review', physicalWeightG: null }), `${prefix}-derived-start-review`)
  const pendingEconomics = await command(ids.admin, 'recordProcessingReview', input(derivedLotId, derivedReservationId, location, { expectedRevision: 2, action: 'mark_pending_economic_disposition', physicalWeightG: null }), `${prefix}-derived-pending-economics`)
  const unresolvedReview = (await root.collection('distProcessingReviews').doc(pendingEconomics.result.reviewId).get()).data()
  pass(unresolvedReview.status === 'pending_economic_disposition' && unresolvedReview.economicDispositionStatus === 'pending_quarantine_disposition' && (await root.collection('distStockReservations').doc(derivedReservationId).get()).data().remainingQuantity === 2, 'costo queda pendiente de disposición sin descarte ni ajuste automático')

  await assertFails(setDoc(doc(queueDb(ids.distributor), 'restaurants', 'sanjose', 'distOperations', `${prefix}-distributor-review`), { id: `${prefix}-distributor-review`, restaurantId: 'sanjose', createdBy: ids.distributor, createdAt: new Date().toISOString(), type: 'recordProcessingReview', payload: {}, status: 'queued' })); checks++
  await assertFails(setDoc(doc(queueDb(ids.admin), 'restaurants', 'sanjose', 'distProcessingReviews', `${prefix}-direct-write`), { location, lotId })); checks++
  await assertFails(getDoc(doc(queueDb(ids.otherWarehouse), 'restaurants', 'sanjose', 'distProcessingReviews', reviewId))); checks++
  const warehouseRead = await getDoc(doc(queueDb(ids.warehouse), 'restaurants', 'sanjose', 'distProcessingReviews', reviewId))
  pass(warehouseRead.exists(), 'Almacén puede consultar las revisiones de su ubicación')
  pass(true, 'Rules rechazan distribuidores, escrituras directas y lectura fuera del almacén')
  console.log(`processing review emulator: ${checks} checks PASS`)
} finally {
  await env.cleanup()
  await adminApp.delete()
}
