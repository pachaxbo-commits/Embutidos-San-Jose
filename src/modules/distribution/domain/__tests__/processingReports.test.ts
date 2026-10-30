import { buildProcessingBatchReport, buildProcessingLotTraceReport, buildProcessingQualityReport, filterProcessingBatches, filterProcessingRepackings, filterProcessingReviews } from '../processingReports.ts'
import type { ProcessingBatch, ProcessingRepackRecord, ProcessingReviewRecord } from '../processing.ts'
import { collectProcessingReportPages } from '../processingReportPagination.ts'

function assertEqual(actual: unknown, expected: unknown, message = 'valores distintos') { if (actual !== expected) throw new Error(`${message}: esperado ${String(expected)}, recibido ${String(actual)}`) }
function assertMatch(actual: string, pattern: RegExp, message = 'texto no coincide') { if (!pattern.test(actual)) throw new Error(`${message}: ${actual}`) }

const batch: ProcessingBatch = {
  id: 'batch-1', operationId: 'op-1', restaurantId: 'sanjose', branchId: 'central', schemaVersion: 1,
  status: 'confirmed', processType: 'bagging', processingDate: '2026-10-29', sourceProductId: 'bulk', sourceProductName: 'Viena granel',
  sourceLocation: 'central', sourceAllocations: [{ lotId: 'origin-1', lotCode: 'ORI-1', sourceProductId: 'bulk', sourceUnitType: 'kg', quantityMilli: 1000, quantity: 1, measuredNetWeightG: 1000, historicalCostCents: 250, productionCost: 2.5, expiresOn: '2026-11-20', originStatus: 'confirmed' }],
  inputWeightG: 1000, destinations: [{ id: 'dest-1', kind: 'finished', productId: 'sachet', lotId: 'derived-1', lotCode: 'DER-1', commercialUnit: 'package', commercialQuantity: 4, netWeightG: 1000, sourceAllocations: [{ sourceLotId: 'origin-1', sourceLotCode: 'ORI-1', sourceProductId: 'bulk', quantityMilli: 1000, weightG: 1000, costCents: 250, originStatus: 'accounting_allocation_not_physical_identification' }], approvalStatus: 'not_required', costCents: 250, manufacturedOn: '2026-10-20', packagedOn: '2026-10-29', expiresOn: '2026-11-10' }],
  packagingMaterials: [], costComponents: [], responsibleUid: 'warehouse-1', responsibleName: 'Almacén QA', createdAt: '2026-10-29T12:00:00.000Z', dayKey: '2026-10-29', auditEventIds: [], reversal: { status: 'blocked', dependencyIds: [], reason: 'test' }, sourceCostCents: 250,
}

assertEqual(filterProcessingBatches([batch], { from: '2026-10-29', to: '2026-10-29', productId: 'sachet', sourceLot: 'ORI-1', outputLot: 'DER-1', location: 'central', responsible: 'QA', processType: 'bagging', status: 'confirmed' }).length, 1)
assertEqual(filterProcessingBatches([batch], { from: '2026-10-30' }).length, 0)
const production = buildProcessingBatchReport([batch])
assertEqual(production.rows.length, 1)
assertEqual(production.rows[0][7], '0 g')
const trace = buildProcessingLotTraceReport([batch], { outputLot: 'DER-1' })
assertMatch(String(trace.rows[0][8]), /asignación contable, no identificación física/)
assertEqual(trace.rows[0][0], 'DER-1')
assertEqual(buildProcessingLotTraceReport([batch], { outputLot: 'NO-EXISTE' }).rows.length, 0)
assertEqual(buildProcessingLotTraceReport([batch], { productId: 'bulk' }).rows.length, 1, 'la trazabilidad inversa por producto de origen conserva sus lotes terminados')

const review = { id: 'review-1', caseId: 'case-1', operationId: 'op-r', restaurantId: 'sanjose', branchId: 'central', schemaVersion: 1, lotId: 'lot-r', productId: 'sachet', productName: 'Sachet Viena', lotCode: 'REV-1', sourceLotIds: [], reservationId: 'reservation-1', reservationPurpose: 'review_hold', location: 'central', commercialQuantity: 2, commercialUnit: 'package', historicalAssignedWeightG: null, physicalWeightG: null, weightDifferenceG: null, costCents: null, packageCondition: 'unknown', productObservation: 'not_assessed', status: 'in_review', action: 'record_observation', observations: '', reason: '', evidenceRefs: [], revision: 1, previousStatus: 'pending_review', reviewedAt: '2026-10-29T12:00:00.000Z', reviewedBy: 'warehouse-1', reviewedByName: 'Almacén QA' } satisfies ProcessingReviewRecord
const repack = { id: 'repack-1', operationId: 'op-p', status: 'confirmed', sourceLotId: 'lot-r', sourceProductId: 'sachet', sourceProductName: 'Sachet Viena', sourceUnitType: 'package', location: 'central', reservationId: 'reservation-1', reviewId: 'review-1', reviewCaseId: 'case-1', authorizationId: 'quality-auth', evidenceRefs: ['evidence-1'], openedCommercialQuantity: 2, openedPhysicalWeightG: 500, sourceCostCents: 125, outputLots: [{ id: 'out-1', lotId: 'new-lot', productId: 'sachet', productName: 'Sachet Viena', lotCode: 'NEW-1', commercialQuantity: 2, commercialUnit: 'package', netWeightG: 500, costCents: 125, movementId: 'movement-1' }], movementIds: ['movement-1'], responsibleUid: 'admin-1', responsibleName: 'Admin QA', confirmedAt: '2026-10-29T13:00:00.000Z', reversal: { status: 'blocked', dependencyIds: [], reason: 'test' } } satisfies ProcessingRepackRecord
const quality = buildProcessingQualityReport([review], [repack])
assertEqual(quality.rows.length, 2)
assertEqual(quality.rows[0][4], 'No medido', 'sin medición no se inventan gramos')
assertEqual(quality.rows[0][7], 'En revisión', 'la presentación de estado está localizada')
assertEqual(quality.rows[1][4], '500 g', 'el reenvasado aparece una sola vez como entrada medida')
assertEqual(filterProcessingReviews([review], { from: '2026-10-29', to: '2026-10-29', productId: 'sachet', sourceLot: 'REV-1', location: 'central', responsible: 'QA', status: 'in_review' }).length, 1, 'la revisión filtra contra estados del modelo, no etiquetas localizadas')
assertEqual(filterProcessingReviews([review], { status: 'En revisión' }).length, 0, 'una etiqueta presentada no se acepta como valor interno')
assertEqual(filterProcessingRepackings([repack], { productId: 'sachet', sourceLot: 'lot-r', location: 'central', responsible: 'Admin', status: 'confirmed' }).length, 1)
assertEqual(filterProcessingRepackings([repack], { status: 'pending_review' }).length, 0)
const lateReview = { ...review, reviewedAt: '2026-10-30T02:30:00.000Z' }
assertEqual(filterProcessingReviews([lateReview], { from: '2026-10-29', to: '2026-10-29' }).length, 1, 'la madrugada UTC pertenece al día anterior en Bolivia')
const transformed = { ...repack, sourceProductId: 'bulk', outputLots: repack.outputLots }
assertEqual(filterProcessingRepackings([transformed], { productId: 'sachet' }).length, 1, 'el producto de salida también coincide aunque el origen sea distinto')
console.log('PASS: reportes filtran y trazan lotes; pesos desconocidos y costo histórico no se duplican.')
let calls = 0
const complete = await collectProcessingReportPages(async (cursor: number | null) => {
  calls++
  return cursor === null ? { rows: [{ id: 'a' }, { id: 'b' }], cursor: 1, hasMore: true } : { rows: [{ id: 'b' }, { id: 'c' }], cursor: 2, hasMore: false }
}, () => true)
assertEqual(complete?.length, 3, 'las páginas se completan sin duplicar documentos')
assertEqual(calls, 2)
let failed = false
try { await collectProcessingReportPages(async (cursor: number | null) => { if (cursor) throw new Error('network failed'); return { rows: [{ id: 'a' }], cursor: 1, hasMore: true } }, () => true) } catch { failed = true }
assertEqual(failed, true, 'un fallo intermedio no devuelve el informe parcial')
let active = true
const stale = await collectProcessingReportPages(async () => { active = false; return { rows: [{ id: 'a' }], cursor: null, hasMore: false } }, () => active)
assertEqual(stale, null, 'se descarta la respuesta de filtros obsoletos')
let overLimit = false
try { await collectProcessingReportPages(async () => ({ rows: Array.from({ length: 10001 }, (_, i) => ({ id: String(i) })), cursor: null, hasMore: false }), () => true) } catch { overLimit = true }
assertEqual(overLimit, true, '10.001 registros bloquean el informe completo y las exportaciones')
console.log('PASS: paginación completa, deduplicación, fallo intermedio, cancelación y límite de 10.000 registros.')
