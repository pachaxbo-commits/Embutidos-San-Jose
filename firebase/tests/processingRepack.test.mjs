// Transactional repack QA. Uses fictional fixtures and emulator-only feature gate.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'

const req = createRequire(new URL('../../functions/package.json', import.meta.url))
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085'
process.env.FUNCTIONS_EMULATOR = 'true'
delete process.env.SANJOSE_PROCESSING_REPACK_EMULATOR_TEST
delete process.env.SANJOSE_PROCESSING_REPACK_ENABLED
delete process.env.SANJOSE_PROCESSING_EVIDENCE_BUCKET
delete process.env.SANJOSE_DERIVED_SALES_EMULATOR_TEST
const { initializeApp } = req('firebase-admin/app')
const { getFirestore } = req('firebase-admin/firestore')
const { processCommand } = req('./operations.cjs')
const projectId = 'demo-pachax-audit'
const app = initializeApp({ projectId }, 'qa-processing-repack')
const db = getFirestore(app)
const root = db.doc('restaurants/sanjose')
const env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8085, rules: fs.readFileSync('firebase/firestore.rules', 'utf8') } })
const prefix = `repack${Date.now().toString(36)}`
const ids = { admin: `${prefix}-admin`, warehouse: `${prefix}-warehouse`, distributor: `${prefix}-distributor`, wh: `${prefix}-wh`, route: `${prefix}-route` }
let checks = 0
const pass = (condition, message) => { assert.ok(condition, message); checks++; console.log(`PASS ${message}`) }
const queueDb = uid => env.authenticatedContext(uid).firestore()
async function command(actor, type, payload, id, expected = 'confirmed') {
  const ref = root.collection('distOperations').doc(id)
  await ref.set({ id, restaurantId: 'sanjose', createdBy: actor, createdAt: new Date().toISOString(), type, payload, status: 'queued' })
  await processCommand(db, ref)
  const value = (await ref.get()).data()
  if (expected) assert.equal(value.status, expected, `${type}: ${value.error || 'estado inesperado'}`)
  return value
}
async function seedBase({ sourceUnit = 'kg', quantity = 2, weightG = 2000, costCents = 1000, derived = false, expired = false, returned = false, lotId = `${prefix}-source`, targetId = `${prefix}-target`, reservationId = `${prefix}-hold`, repackId = `${prefix}-repack` } = {}) {
  const location = 'central', expiry = expired ? '2026-10-01' : '2026-11-20', batchId = `${prefix}-prior-batch`, segmentId = `${prefix}-prior-segment`
  await root.collection('distProducts').doc(lotId + '-product').set({ id: lotId + '-product', restaurantId: 'sanjose', name: 'QA Origen', unitType: sourceUnit, active: true, productionCost: costCents === null ? null : sourceUnit === 'kg' ? 5 : costCents / 100 / quantity })
  await root.collection('distProducts').doc(targetId).set({ id: targetId, restaurantId: 'sanjose', name: 'QA Sachet', unitType: 'package', active: true, productionCost: 999, referencePrice: 10 })
  const sourceProductId = lotId + '-product'
  const lot = { id: lotId, restaurantId: 'sanjose', productId: sourceProductId, productName: 'QA Origen', unitType: sourceUnit, lotCode: `LOT-${lotId}`, manufacturedOn: '2026-10-01', expiresOn: expiry, productionCost: costCents === null ? null : sourceUnit === 'kg' ? 5 : costCents / 100 / quantity, quantities: { [location]: quantity }, processingUnavailable: { [location]: { courtesy: 0, repackPending: quantity, reviewHold: 0 } } }
  if (derived) Object.assign(lot, { processingCommercialBlocked: true, processingDestinationKind: 'finished', processingBatchId: batchId, processingDestinationId: `${prefix}-origin-dest`, processingPhysicalWeightGRemaining: weightG, processingCostCentsRemaining: costCents, processingByLocation: { [location]: { segments: [{ segmentId, batchId, destinationId: `${prefix}-origin-dest`, sourceMovementId: `${prefix}-origin-output`, weightBasis: 'documented_average', remainingQuantity: quantity, remainingWeightG: weightG, remainingCostCents: costCents }] } }, processingSourceAllocationBasis: 'batch_blend_accounting_allocation', ...returned ? { derivedReturn: { claimId: `${prefix}-claim`, sourceSaleId: `${prefix}-sale`, assignedWeightG: weightG, physicalOriginConfirmed: false }, pendingEconomicDisposition: true } : {} })
  await root.collection('distLots').doc(lotId).set(lot)
  await root.collection('distBalances').doc(`${location}__${sourceProductId}`).set({ id: `${location}__${sourceProductId}`, restaurantId: 'sanjose', locationKind: 'central', warehouseId: 'central', productId: sourceProductId, unitType: sourceUnit, quantity })
  await root.collection('distStockReservations').doc(reservationId).set({ id: reservationId, restaurantId: 'sanjose', branchId: 'main', schemaVersion: 1, productId: sourceProductId, productName: 'QA Origen', lotId, lotCode: lot.lotCode, unitType: sourceUnit, location, purpose: 'repack_pending', originalQuantity: quantity, remainingQuantity: quantity, consumedQuantity: 0, physicalWeightG: weightG, remainingWeightG: weightG, remainingCostCents: costCents, ...(derived ? { processingSegments: [{ batchId, segmentId, quantity, remainingWeightG: weightG, remainingCostCents: costCents }] } : {}), status: 'active', source: 'qa', createdAt: new Date().toISOString(), createdBy: ids.admin, history: [] })
  const reviewId = `${prefix}-approved-review`, caseId = `${prefix}-case-${lotId}`
  const authId = `${prefix}-quality-auth`
  await root.collection('distProcessingQualityAuthorizations').doc(ids.admin).set({ id: authId, authorizationId: authId, restaurantId: 'sanjose', status: 'active', beneficiaryUid: ids.admin, grantedBy: `${prefix}-grantor`, expiresAt: '2027-12-31T23:59:59.000Z' })
  await root.collection('distProcessingReviews').doc(reviewId).set({ id: reviewId, caseId, operationId: `${prefix}-review-operation`, restaurantId: 'sanjose', lotId, reservationId, location, status: 'authorized_for_repack', qualityDecision: 'authorized_for_repack', qualityAuthorizationRef: authId, evidenceRevision: 1, reviewedBy: ids.admin, revision: 1, physicalWeightG: weightG, evidenceRefs: [`${prefix}-evidence-${lotId}`] })
  await root.collection('distLots').doc(lotId).update({ processingReview: { caseId, latestReviewId: reviewId, revision: 1, status: 'authorized_for_repack', updatedAt: new Date().toISOString(), updatedBy: ids.admin } })
  await root.collection('distProcessingEvidence').doc(`${prefix}-evidence-${lotId}`).set({ id: `${prefix}-evidence-${lotId}`, restaurantId: 'sanjose', status: 'verified', evidenceType: 'measurement_record', lotId, reservationId, reviewCaseId: caseId, reviewRevision: 1, location, uploadedBy: ids.warehouse, recordedAt: new Date().toISOString(), bucket: 'qa-fixture', objectPath: `processing-evidence/sanjose/${prefix}/${lotId}.pdf`, objectGeneration: '1', sha256: 'b'.repeat(64), byteSize: 512, contentType: 'application/pdf', viewers: [ids.admin, ids.warehouse], verificationMethod: 'emulator_fixture', objectExists: true })
  return { location, lotId, sourceProductId, targetId, reservationId, repackId, reviewId, caseId, authId, batchId: derived ? batchId : null, segmentId: derived ? segmentId : null, weightG, quantity, costCents }
}
const makeInput = (f, patch = {}) => ({ operationId: `${f.repackId}-op`, repackId: f.repackId, reviewId: f.reviewId, sourceLotId: f.lotId, reservationId: f.reservationId, location: f.location, expectedReviewRevision: 1, expectedReservationQuantity: f.quantity, sourceKind: f.batchId ? 'derived_lot' : 'traditional_lot', sourceUnitType: f.batchId ? 'package' : 'kg', openedCommercialQuantity: f.quantity, sourceSegments: f.batchId ? [{ batchId: f.batchId, segmentId: f.segmentId }] : [], openedPhysicalWeightG: f.weightG, outputs: [{ id: 'dest-a', productId: f.targetId, commercialUnit: 'package', commercialQuantity: f.weightG / 250, measuredNetWeightG: f.weightG, lotCode: `OUT-${f.repackId}`, manufacturedOn: '2026-10-01', packagedOn: '2026-10-28', expiresOn: '2026-11-10' }], packagingMaterials: [{ materialId: 'bag', quantityMilli: f.weightG, damagedQuantityMilli: 0, costCents: 25 }], additionalCostComponents: [], authorizationReference: f.authId, evidenceRefs: [`${prefix}-evidence-${f.lotId}`], reason: 'Reenvasado total QA con medida real', ...patch })

try {
  await root.collection('members').doc(ids.admin).set({ uid: ids.admin, role: 'admin', active: true, displayName: 'QA Admin' })
  await root.collection('members').doc(ids.warehouse).set({ uid: ids.warehouse, role: 'warehouse', active: true, warehouseId: 'central', displayName: 'QA Almacén' })
  await root.collection('members').doc(ids.distributor).set({ uid: ids.distributor, role: 'distributor', active: true, routeId: ids.route, displayName: 'QA Distribuidor' })

  const full = await seedBase()
  const request = makeInput(full)
  const blockedProduction = await command(ids.admin, 'confirmProcessingRepack', request, `${prefix}-prod-gate`, 'rejected')
  pass(blockedProduction.error.includes('bucket y activación') && (await root.collection('distBalances').doc(`central__${full.sourceProductId}`).get()).data().quantity === 2, 'reenvasado permanece bloqueado sin configuración server-side y conserva inventario')
  process.env.SANJOSE_PROCESSING_REPACK_ENABLED = 'true'
  process.env.SANJOSE_PROCESSING_EVIDENCE_BUCKET = 'qa-evidence-bucket'
  const confirmed = await command(ids.admin, 'confirmProcessingRepack', request, `${prefix}-confirm`)
  const sourceBalance = (await root.collection('distBalances').doc(`central__${full.sourceProductId}`).get()).data()
  const targetBalance = (await root.collection('distBalances').doc(`central__${full.targetId}`).get()).data()
  const sourceReservation = (await root.collection('distStockReservations').doc(full.reservationId).get()).data()
  const output = confirmed.result.outputLots[0]
  const outputLot = (await root.collection('distLots').doc(output.lotId).get()).data()
  const outputBatch = (await root.collection('distProcessingBatches').doc(full.repackId).get()).data()
  const movements = await root.collection('distStockMovements').where('repackId', '==', full.repackId).get()
  pass(confirmed.status === 'confirmed' && sourceBalance.quantity === 0 && sourceReservation.status === 'consumed' && sourceLotQuantity(outputLot, full.location) === 8, '2 kg se consumen exactamente y se crean ocho paquetes no disponibles para venta')
  pass(outputLot.processingPhysicalWeightGRemaining === 2000 && outputLot.processingByLocation.central.segments[0].remainingWeightG === 2000 && outputLot.processingCostCentsRemaining === 1000 && output.costCents === 1000, 'los 2.000 g y Bs 10,00 históricos se trasladan exactamente a los paquetes')
  pass(targetBalance.quantity === 8 && movements.size === 2 && outputBatch.status === 'confirmed' && outputLot.processingCommercialBlocked === true, 'balances, dos movimientos y batch/auditoría concilian; salida sigue bloqueada comercialmente')
  pass(outputLot.processingSourceLotIds[0] === full.lotId && outputLot.processingRepackId === full.repackId && outputLot.processingReviewId === full.reviewId, 'lote final conserva origen, reenvasado y revisión relacionados')
  pass((await root.collection('distProcessingRepackings').doc(full.repackId).get()).data().packagingMaterials[0].costTreatment === 'informational_only_no_additional_result_charge', 'costo de bolsas queda informativo y no genera un segundo gasto')
  const repeatPayload = { ...request, operationId: `${prefix}-retry-op` }
  const repeated = await command(ids.warehouse, 'confirmProcessingRepack', repeatPayload, `${prefix}-retry`)
  pass(repeated.result.duplicate === true && (await root.collection('distStockMovements').where('repackId', '==', full.repackId).get()).size === 2, 'mismo repackId con otro operationId es idempotente y no duplica movimientos')
  await processCommand(db, root.collection('distOperations').doc(`${prefix}-confirm`))
  pass((await root.collection('distStockMovements').where('repackId', '==', full.repackId).get()).size === 2, 'reprocesar el mismo operationId confirmado no vuelve a consumir stock')
  const conflict = await command(ids.admin, 'confirmProcessingRepack', { ...request, reason: 'Payload incompatible para reenvasado' }, `${prefix}-conflict`, 'rejected')
  pass(conflict.error.includes('datos diferentes') && (await root.collection('distStockMovements').where('repackId', '==', full.repackId).get()).size === 2, 'repackId repetido con payload diferente se rechaza sin cambios')

  const multiple = await seedBase({ lotId: `${prefix}-multiple-source`, targetId: `${prefix}-multiple-target-a`, reservationId: `${prefix}-multiple-hold`, repackId: `${prefix}-multiple` })
  const targetB = `${prefix}-multiple-target-b`
  await root.collection('distProducts').doc(targetB).set({ id: targetB, restaurantId: 'sanjose', name: 'QA presentación B', unitType: 'package', active: true, productionCost: 0 })
  const multipleInput = makeInput(multiple, { outputs: [
    { id: 'small-packs', productId: multiple.targetId, commercialUnit: 'package', commercialQuantity: 3, measuredNetWeightG: 750, lotCode: 'OUT-MULTI-A', manufacturedOn: '2026-10-01', packagedOn: '2026-10-28', expiresOn: '2026-11-10' },
    { id: 'large-packs', productId: targetB, commercialUnit: 'package', commercialQuantity: 5, measuredNetWeightG: 1250, lotCode: 'OUT-MULTI-B', manufacturedOn: '2026-10-01', packagedOn: '2026-10-28', expiresOn: '2026-11-10' },
  ] })
  const multipleResult = await command(ids.admin, 'confirmProcessingRepack', multipleInput, `${prefix}-multiple-confirm`)
  const multipleCost = multipleResult.result.outputLots.reduce((sum, output) => sum + output.costCents, 0)
  pass(multipleResult.result.outputLots.length === 2 && multipleResult.result.outputLots.reduce((sum, output) => sum + output.netWeightG, 0) === 2000 && multipleCost === 1000, 'dos presentaciones conservan 2.000 g y los 1.000 centavos de costo exactos')
  pass(multipleResult.result.outputLots.every(output => (output.lotId && output.movementId)) && multipleResult.result.outputLots.every(output => output.commercialQuantity > 0), 'cada destino múltiple conserva lote, movimiento y cantidad comercial propia')

  const partial = await seedBase({ lotId: `${prefix}-partial-source`, targetId: `${prefix}-partial-target`, reservationId: `${prefix}-partial-hold`, repackId: `${prefix}-partial`, quantity: 2, weightG: 2000, costCents: 1000 })
  const partialInput = makeInput(partial, { openedCommercialQuantity: 1, openedPhysicalWeightG: 1000, outputs: [{ id: 'partial-dest', productId: partial.targetId, commercialUnit: 'package', commercialQuantity: 4, measuredNetWeightG: 1000, lotCode: 'OUT-PARTIAL', manufacturedOn: '2026-10-01', packagedOn: '2026-10-28', expiresOn: '2026-11-10' }] })
  const partialResult = await command(ids.admin, 'confirmProcessingRepack', partialInput, `${prefix}-partial-confirm`)
  const partialReservation = (await root.collection('distStockReservations').doc(partial.reservationId).get()).data()
  const partialSourceBalance = (await root.collection('distBalances').doc(`central__${partial.sourceProductId}`).get()).data()
  pass(partialResult.result.openedPhysicalWeightG === 1000 && partialResult.result.costCents === 500 && partialReservation.remainingQuantity === 1 && partialReservation.remainingWeightG === 1000 && partialReservation.remainingCostCents === 500, 'reenvasado parcial conserva 1 kg, 1.000 g y Bs 5,00 en la reserva')
  pass(partialSourceBalance.quantity === 1 && (await root.collection('distLots').doc(partial.lotId).get()).data().processingUnavailable.central.repackPending === 1, 'el origen y agregado inmovilizado disminuyen solo por la porción reenvasada')

  const fractional = await seedBase({ lotId: `${prefix}-fractional-source`, targetId: `${prefix}-fractional-target`, reservationId: `${prefix}-fractional-hold`, repackId: `${prefix}-fractional`, quantity: 1.5, weightG: 1500, costCents: 751 })
  const fractionalInput = makeInput(fractional, { openedCommercialQuantity: 0.5, openedPhysicalWeightG: 500, outputs: [{ id: 'fractional-out', productId: fractional.targetId, commercialUnit: 'package', commercialQuantity: 2, measuredNetWeightG: 500, lotCode: 'OUT-FRACTIONAL', manufacturedOn: '2026-10-01', packagedOn: '2026-10-28', expiresOn: '2026-11-10' }] })
  const fractionalResult = await command(ids.admin, 'confirmProcessingRepack', fractionalInput, `${prefix}-fractional-confirm`)
  const fractionalReservation = (await root.collection('distStockReservations').doc(fractional.reservationId).get()).data()
  pass(fractionalResult.result.costCents === 250 && fractionalReservation.remainingQuantity === 1 && fractionalReservation.remainingWeightG === 1000 && fractionalReservation.remainingCostCents === 501, 'reenvasado parcial de 0,5 kg distribuye 751 centavos en enteros y conserva el resto de 501 centavos')

  const unknownCost = await seedBase({ lotId: `${prefix}-unknown-source`, targetId: `${prefix}-unknown-target`, reservationId: `${prefix}-unknown-hold`, repackId: `${prefix}-unknown`, costCents: null })
  const unknownResult = await command(ids.admin, 'confirmProcessingRepack', makeInput(unknownCost), `${prefix}-unknown-confirm`)
  const unknownOutput = (await root.collection('distLots').doc(unknownResult.result.outputLots[0].lotId).get()).data()
  pass(unknownResult.result.costCents === null && unknownOutput.processingCostCentsRemaining === null && unknownOutput.productionCost === null, 'costo histórico desconocido permanece null y no usa catálogo')

  const derived = await seedBase({ lotId: `${prefix}-derived-source`, targetId: `${prefix}-derived-target`, reservationId: `${prefix}-derived-hold`, repackId: `${prefix}-derived-repack`, sourceUnit: 'package', quantity: 8, weightG: 2000, costCents: 1000, derived: true })
  const derivedResult = await command(ids.admin, 'confirmProcessingRepack', makeInput(derived), `${prefix}-derived-confirm`)
  const derivedSource = (await root.collection('distLots').doc(derived.lotId).get()).data()
  pass(derivedResult.result.openedPhysicalWeightG === 2000 && derivedResult.result.costCents === 1000 && derivedSource.processingByLocation.central.segments.length === 0, 'lote derivado consume los segmentos auténticos y mantiene sus gramos/costos exactos')

  const derivedPartial = await seedBase({ lotId: `${prefix}-derived-partial-source`, targetId: `${prefix}-derived-partial-target`, reservationId: `${prefix}-derived-partial-hold`, repackId: `${prefix}-derived-partial`, sourceUnit: 'package', quantity: 8, weightG: 2000, costCents: 1000, derived: true })
  const derivedPartialInput = makeInput(derivedPartial, { openedCommercialQuantity: 4, openedPhysicalWeightG: 1000, outputs: [{ id: 'derived-partial-out', productId: derivedPartial.targetId, commercialUnit: 'package', commercialQuantity: 4, measuredNetWeightG: 1000, lotCode: 'OUT-DERIVED-PARTIAL', manufacturedOn: '2026-10-01', packagedOn: '2026-10-28', expiresOn: '2026-11-10' }] })
  const derivedPartialResult = await command(ids.admin, 'confirmProcessingRepack', derivedPartialInput, `${prefix}-derived-partial-confirm`)
  const derivedPartialReservation = (await root.collection('distStockReservations').doc(derivedPartial.reservationId).get()).data()
  const derivedPartialSource = (await root.collection('distLots').doc(derivedPartial.lotId).get()).data()
  pass(derivedPartialResult.result.costCents === 500 && derivedPartialReservation.remainingQuantity === 4 && derivedPartialReservation.remainingWeightG === 1000 && derivedPartialReservation.remainingCostCents === 500, 'reenvasado parcial derivado conserva el costo y los gramos seleccionados, y deja resto exacto en la reserva')
  pass(derivedPartialSource.processingByLocation.central.segments[0].remainingQuantity === 4 && derivedPartialSource.processingByLocation.central.segments[0].remainingWeightG === 1000 && derivedPartialSource.processingByLocation.central.segments[0].remainingCostCents === 500, 'el lote derivado original mantiene el segmento restante sin duplicar paquetes, gramos ni costo')

  const badEvidence = await seedBase({ lotId: `${prefix}-bad-evidence-source`, targetId: `${prefix}-bad-evidence-target`, reservationId: `${prefix}-bad-evidence-hold`, repackId: `${prefix}-bad-evidence` })
  const badEvidenceResult = await command(ids.admin, 'confirmProcessingRepack', makeInput(badEvidence, { evidenceRefs: ['missing-evidence'] }), `${prefix}-bad-evidence-op`, 'rejected')
  pass(badEvidenceResult.error.includes('evidencia') && (await root.collection('distBalances').doc(`central__${badEvidence.sourceProductId}`).get()).data().quantity === 2, 'evidencia inexistente bloquea la transacción sin descuento')

  const foreignEvidence = await seedBase({ lotId: `${prefix}-foreign-evidence-source`, targetId: `${prefix}-foreign-evidence-target`, reservationId: `${prefix}-foreign-evidence-hold`, repackId: `${prefix}-foreign-evidence` })
  await root.collection('distProcessingEvidence').doc(`${prefix}-evidence-${foreignEvidence.lotId}`).update({ lotId: 'another-lot' })
  const foreignEvidenceResult = await command(ids.admin, 'confirmProcessingRepack', makeInput(foreignEvidence), `${prefix}-foreign-evidence-op`, 'rejected')
  pass(foreignEvidenceResult.error.includes('evidencia') && (await root.collection('distBalances').doc(`central__${foreignEvidence.sourceProductId}`).get()).data().quantity === 2, 'evidencia válida de otro lote no autoriza el consumo y no deja escrituras parciales')

  const staleEvidence = await seedBase({ lotId: `${prefix}-stale-evidence-source`, targetId: `${prefix}-stale-evidence-target`, reservationId: `${prefix}-stale-evidence-hold`, repackId: `${prefix}-stale-evidence` })
  await root.collection('distProcessingEvidence').doc(`${prefix}-evidence-${staleEvidence.lotId}`).update({ reviewRevision: 0 })
  const staleEvidenceResult = await command(ids.admin, 'confirmProcessingRepack', makeInput(staleEvidence), `${prefix}-stale-evidence-op`, 'rejected')
  pass(staleEvidenceResult.error.includes('evidencia') && (await root.collection('distBalances').doc(`central__${staleEvidence.sourceProductId}`).get()).data().quantity === 2, 'evidencia de otra revisión no autoriza el reenvasado')

  const unknownTarget = await seedBase({ lotId: `${prefix}-unknown-target-source`, targetId: `${prefix}-unknown-target-product`, reservationId: `${prefix}-unknown-target-hold`, repackId: `${prefix}-unknown-target` })
  const unknownTargetResult = await command(ids.admin, 'confirmProcessingRepack', makeInput(unknownTarget, { outputs: [{ ...makeInput(unknownTarget).outputs[0], productId: `${prefix}-missing-sku` }] }), `${prefix}-unknown-target-op`, 'rejected')
  pass(Boolean(unknownTargetResult.error) && (await root.collection('distBalances').doc(`central__${unknownTarget.sourceProductId}`).get()).data().quantity === 2, 'SKU de salida inexistente bloquea antes de consumir la reserva')

  const badMass = await seedBase({ lotId: `${prefix}-bad-mass-source`, targetId: `${prefix}-bad-mass-target`, reservationId: `${prefix}-bad-mass-hold`, repackId: `${prefix}-bad-mass` })
  const badMassResult = await command(ids.admin, 'confirmProcessingRepack', makeInput(badMass, { outputs: [{ ...makeInput(badMass).outputs[0], measuredNetWeightG: 1999 }] }), `${prefix}-bad-mass-op`, 'rejected')
  pass(badMassResult.error.includes('masa') && (await root.collection('distBalances').doc(`central__${badMass.sourceProductId}`).get()).data().quantity === 2, 'un gramo sin destino se rechaza y no se oculta como merma')

  const stale = await seedBase({ lotId: `${prefix}-stale-source`, targetId: `${prefix}-stale-target`, reservationId: `${prefix}-stale-hold`, repackId: `${prefix}-stale` })
  const staleResult = await command(ids.admin, 'confirmProcessingRepack', makeInput(stale, { expectedReviewRevision: 0 }), `${prefix}-stale-op`, 'rejected')
  pass(staleResult.error.includes('cambió') || staleResult.error.includes('autorizada') && (await root.collection('distBalances').doc(`central__${stale.sourceProductId}`).get()).data().quantity === 2, 'revisión obsoleta bloquea sin escrituras')

  const revoked = await seedBase({ lotId: `${prefix}-revoked-source`, targetId: `${prefix}-revoked-target`, reservationId: `${prefix}-revoked-hold`, repackId: `${prefix}-revoked` })
  await root.collection('distProcessingQualityAuthorizations').doc(ids.admin).update({ status: 'revoked', revokedAt: new Date().toISOString(), revokedBy: ids.admin })
  const revokedResult = await command(ids.admin, 'confirmProcessingRepack', makeInput(revoked), `${prefix}-revoked-op`, 'rejected')
  pass(revokedResult.error.includes('revocada') && (await root.collection('distBalances').doc(`central__${revoked.sourceProductId}`).get()).data().quantity === 2, 'revocación de calidad bloquea el reenvasado antes de tocar stock')

  const expired = await seedBase({ lotId: `${prefix}-expired-source`, targetId: `${prefix}-expired-target`, reservationId: `${prefix}-expired-hold`, repackId: `${prefix}-expired`, expired: true })
  const expiredResult = await command(ids.admin, 'confirmProcessingRepack', makeInput(expired), `${prefix}-expired-op`, 'rejected')
  pass(expiredResult.error.includes('vencido') && (await root.collection('distBalances').doc(`central__${expired.sourceProductId}`).get()).data().quantity === 2, 'lote vencido no se reenvasó ni alteró')

  const synthetic = await seedBase({ lotId: `${prefix}-synthetic-source`, targetId: `${prefix}-synthetic-target`, reservationId: `${prefix}-synthetic-hold`, repackId: `${prefix}-synthetic` })
  await root.collection('distLots').doc(synthetic.lotId).update({ synthetic: true })
  const syntheticResult = await command(ids.admin, 'confirmProcessingRepack', makeInput(synthetic), `${prefix}-synthetic-op`, 'rejected')
  pass(Boolean(syntheticResult.error) && (await root.collection('distBalances').doc(`central__${synthetic.sourceProductId}`).get()).data().quantity === 2, 'lote sintético sin procedencia verificable no se consume')

  const extendedExpiry = await seedBase({ lotId: `${prefix}-extended-expiry-source`, targetId: `${prefix}-extended-expiry-target`, reservationId: `${prefix}-extended-expiry-hold`, repackId: `${prefix}-extended-expiry` })
  const extendedExpiryResult = await command(ids.admin, 'confirmProcessingRepack', makeInput(extendedExpiry, { outputs: [{ ...makeInput(extendedExpiry).outputs[0], expiresOn: '2026-12-01' }] }), `${prefix}-extended-expiry-op`, 'rejected')
  pass(Boolean(extendedExpiryResult.error) && (await root.collection('distBalances').doc(`central__${extendedExpiry.sourceProductId}`).get()).data().quantity === 2, 'el lote de salida no puede extender el vencimiento del origen')

  const changedManufactureDate = await seedBase({ lotId: `${prefix}-changed-date-source`, targetId: `${prefix}-changed-date-target`, reservationId: `${prefix}-changed-date-hold`, repackId: `${prefix}-changed-date` })
  const changedDateResult = await command(ids.admin, 'confirmProcessingRepack', makeInput(changedManufactureDate, { outputs: [{ ...makeInput(changedManufactureDate).outputs[0], manufacturedOn: '2026-10-02' }] }), `${prefix}-changed-date-op`, 'rejected')
  pass(Boolean(changedDateResult.error) && (await root.collection('distBalances').doc(`central__${changedManufactureDate.sourceProductId}`).get()).data().quantity === 2, 'el reenvasado no puede cambiar la fecha de elaboración original del producto')

  const returned = await seedBase({ lotId: `${prefix}-returned-source`, targetId: `${prefix}-returned-target`, reservationId: `${prefix}-returned-hold`, repackId: `${prefix}-returned`, sourceUnit: 'package', quantity: 2, weightG: 500, costCents: 250, derived: true, returned: true })
  const returnedResult = await command(ids.admin, 'confirmProcessingRepack', makeInput(returned), `${prefix}-returned-op`, 'rejected')
  pass(returnedResult.error.includes('económica pendiente') && (await root.collection('distBalances').doc(`central__${returned.sourceProductId}`).get()).data().quantity === 2, 'producto vendido y devuelto permanece bloqueado por política contable pendiente')

  const nonDivisible = await seedBase({ lotId: `${prefix}-nondiv-source`, targetId: `${prefix}-nondiv-target`, reservationId: `${prefix}-nondiv-hold`, repackId: `${prefix}-nondiv`, sourceUnit: 'package', quantity: 3, weightG: 1001, costCents: 502, derived: true })
  const nonDivisibleInput = makeInput(nonDivisible, { outputs: [{ id: 'three-output', productId: nonDivisible.targetId, commercialUnit: 'package', commercialQuantity: 3, measuredNetWeightG: 1001, lotCode: 'OUT-NONDIV', manufacturedOn: '2026-10-01', packagedOn: '2026-10-28', expiresOn: '2026-11-10' }] })
  const nonDivisibleResult = await command(ids.admin, 'confirmProcessingRepack', nonDivisibleInput, `${prefix}-nondiv-op`)
  const nonDivisibleLot = (await root.collection('distLots').doc(nonDivisibleResult.result.outputLots[0].lotId).get()).data()
  pass(nonDivisibleLot.processingPhysicalWeightGRemaining === 1001 && nonDivisibleLot.processingCostCentsRemaining === 502, 'gramos y centavos indivisibles se conservan como enteros exactos')

  const concurrent = await seedBase({ lotId: `${prefix}-concurrent-source`, targetId: `${prefix}-concurrent-target`, reservationId: `${prefix}-concurrent-hold`, repackId: `${prefix}-concurrent` })
  const concurrentPayload = makeInput(concurrent)
  const concurrentIds = [`${prefix}-concurrent-op-a`, `${prefix}-concurrent-op-b`]
  const concurrentRefs = concurrentIds.map(id => root.collection('distOperations').doc(id))
  await Promise.all(concurrentRefs.map((ref, index) => ref.set({ id: concurrentIds[index], restaurantId: 'sanjose', createdBy: ids.admin, createdAt: new Date().toISOString(), type: 'confirmProcessingRepack', payload: { ...concurrentPayload, operationId: concurrentIds[index] }, status: 'queued' })))
  await Promise.all(concurrentRefs.map(ref => processCommand(db, ref)))
  const concurrentMovements = await root.collection('distStockMovements').where('repackId', '==', concurrent.repackId).get()
  const concurrentSource = (await root.collection('distBalances').doc(`central__${concurrent.sourceProductId}`).get()).data()
  pass(concurrentMovements.size === 2 && concurrentSource.quantity === 0, 'dos confirmaciones simultáneas del mismo repackId producen una sola transformación')

  const reservedProductId = `${prefix}-reserved-traditional-product`, reservedLotId = `${prefix}-reserved-traditional-lot`
  await root.collection('distProducts').doc(reservedProductId).set({ id: reservedProductId, restaurantId: 'sanjose', name: 'QA costo unitario', unitType: 'kg', active: true, productionCost: 5.003 })
  await root.collection('distLots').doc(reservedLotId).set({ id: reservedLotId, restaurantId: 'sanjose', productId: reservedProductId, productName: 'QA costo unitario', unitType: 'kg', lotCode: 'QA-COST-ROUNDING', manufacturedOn: '2026-10-01', expiresOn: '2026-11-20', productionCost: 5.003, quantities: { central: 2 }, processingUnavailable: { central: { courtesy: 0, repackPending: 0, reviewHold: 0 } } })
  await root.collection('distBalances').doc(`central__${reservedProductId}`).set({ id: `central__${reservedProductId}`, restaurantId: 'sanjose', locationKind: 'central', warehouseId: 'central', productId: reservedProductId, unitType: 'kg', quantity: 2 })
  const reserved = await command(ids.admin, 'reserveProcessingStock', { productId: reservedProductId, lotId: reservedLotId, location: 'central', purpose: 'repack_pending', quantity: 1.5, reservationId: `${prefix}-cost-reservation`, reason: 'Reserva de costo QA' }, `${prefix}-cost-reserve`)
  const storedReservation = (await root.collection('distStockReservations').doc(`${prefix}-cost-reservation`).get()).data()
  pass(reserved.status === 'confirmed' && storedReservation.remainingWeightG === 1500 && storedReservation.remainingCostCents === 750, 'la reserva tradicional fija gramos y costo en centavos una sola vez para preservar el resto parcial')
  const duplicateReserve = await command(ids.admin, 'reserveProcessingStock', { productId: reservedProductId, lotId: reservedLotId, location: 'central', purpose: 'repack_pending', quantity: 0.5, reservationId: `${prefix}-second-cost-reservation`, reason: 'Segunda reserva concurrente QA' }, `${prefix}-cost-reserve-second`, 'rejected')
  pass(Boolean(duplicateReserve.error) && (await root.collection('distStockReservations').where('lotId', '==', reservedLotId).get()).size === 1, 'segunda reserva repack_pending no crea una asignación de costo solapada')

  const distributorQueue = queueDb(ids.distributor)
  await assertFails(setDoc(doc(distributorQueue, 'restaurants', 'sanjose', 'distOperations', `${prefix}-distributor-repack`), { id: `${prefix}-distributor-repack`, restaurantId: 'sanjose', createdBy: ids.distributor, createdAt: new Date().toISOString(), type: 'confirmProcessingRepack', payload: {}, status: 'queued' })); checks++
  await assertFails(setDoc(doc(queueDb(ids.admin), 'restaurants', 'sanjose', 'distProcessingRepackings', `${prefix}-direct-repack`), { location: 'central' })); checks++
  await assertFails(setDoc(doc(queueDb(ids.admin), 'restaurants', 'sanjose', 'distProcessingEvidence', `${prefix}-fake-evidence`), { location: 'central', status: 'verified' })); checks++
  pass(true, 'Rules impiden reenvasado por distribuidor y escrituras directas de reenvaso/evidencia')

  const noSales = await command(ids.admin, 'sale', { sourceLocation: 'centralWarehouse', routeId: 'administracion', lines: [{ productId: full.targetId, quantity: 1, actualUnitPrice: 1, unitPrice: 1, unitType: 'package' }], cashAmount: 1, qrAmount: 0, creditAmount: 0, paymentKind: 'cash' }, `${prefix}-blocked-sale`, 'rejected')
  pass(noSales.error.includes('bloqueada') || noSales.error.includes('bloqueado'), 'los lotes de salida siguen protegidos contra venta aun en el entorno de prueba salvo la suite aislada')

  const commercial = await seedBase({ lotId: `${prefix}-commercial-source`, targetId: `${prefix}-commercial-target`, reservationId: `${prefix}-commercial-hold`, repackId: `${prefix}-commercial-repack` })
  const commercialResult = await command(ids.admin, 'confirmProcessingRepack', makeInput(commercial), `${prefix}-commercial-confirm`)
  const commercialLotId = commercialResult.result.outputLots[0].lotId
  const correctReview = (await root.collection('distProcessingReviews').doc(commercial.reviewId).get()).data()
  await root.collection('distProcessingReviews').doc(commercial.reviewId).update({ lotId: 'different-source-lot' })
  await command(ids.admin, 'releaseProcessingLot', { lotId: commercialLotId, authorizationReference: commercial.authId, reason: 'QA incompatible review must not release stock' }, `${prefix}-commercial-bad-review`, 'rejected')
  pass(!(await root.collection('distLots').doc(commercialLotId).get()).data().processingCommercialRelease, 'revisión de otro lote no libera el producto reenvasado')
  await root.collection('distProcessingReviews').doc(commercial.reviewId).set(correctReview)
  await command(ids.admin, 'releaseProcessingLot', { lotId: commercialLotId, reason: 'Producto apto para despacho y venta' }, `${prefix}-commercial-no-auth`, 'rejected')
  pass(!(await root.collection('distLots').doc(commercialLotId).get()).data().processingCommercialRelease, 'salida de reenvasado conserva el requisito específico de autorización de Calidad')
  await command(ids.admin, 'releaseProcessingLot', { lotId: commercialLotId, authorizationReference: commercial.authId, reason: 'QA measured repack output approved for commerce' }, `${prefix}-commercial-release`)
  pass((await root.collection('distLots').doc(commercialLotId).get()).data().processingCommercialRelease.status === 'released', 'Calidad puede liberar la salida reenvasada mediante la misma transición comercial')
  await command(ids.admin, 'sale', { sourceLocation: 'centralWarehouse', routeId: 'administracion', lines: [{ productId: commercial.targetId, quantity: 1, actualUnitPrice: 10 }], cashAmount: 10, qrAmount: 0, creditAmount: 0, paymentKind: 'cash' }, `${prefix}-commercial-sale`)
  const soldRepack = (await root.collection('distLots').doc(commercialLotId).get()).data()
  pass(soldRepack.quantities.central === 7 && soldRepack.processingPhysicalWeightGRemaining === 1750 && soldRepack.processingCostCentsRemaining === 875 && soldRepack.processingCommercialBlocked === true, 'venta posterior al reenvasado consume 250 g y 125 centavos sin activar ventas experimentales')
  console.log(`processing repack emulator: ${checks} checks PASS`)
} finally {
  await env.cleanup()
  await app.delete()
}

function sourceLotQuantity(lot, location) { return Number(lot.quantities?.[location] || 0) }
