import type { DistLotAllocation, UnitType } from '../types.ts'

/** Schema contracts only. These types do not imply stock is reserved or protected. */
export type ProcessingStatus = 'draft' | 'confirmed' | 'corrected' | 'reversed'
export type ProcessingDestinationKind = 'finished' | 'courtesy' | 'repack_pending' | 'review_hold' | 'discard' | 'other'
export type ProcessingApprovalStatus = 'not_required' | 'pending' | 'approved' | 'rejected'
export type ProcessingWeightBasis = 'measured_total' | 'documented_average' | 'individual_measurements'
export type ProcessingReservationStatus = 'active' | 'partially_consumed' | 'released' | 'consumed'
export type ProcessingReversalStatus = 'clear' | 'blocked' | 'approved'
export type ProcessingReviewStatus = 'pending_review' | 'in_review' | 'authorized_for_repack' | 'not_recoverable' | 'pending_information' | 'pending_economic_disposition' | 'resolved_specialized'
export type ProcessingPackageCondition = 'sealed_intact' | 'package_damaged_content_intact' | 'package_damaged_partial' | 'no_package' | 'unknown'
export type ProcessingProductObservation = 'apparently_apt' | 'uncertain' | 'confirmed_unfit' | 'not_assessed'
export type ProcessingReviewAction = 'record_observation' | 'start_review' | 'request_information' | 'authorize_repack' | 'declare_unrecoverable' | 'mark_pending_economic_disposition' | 'repack_consumed'

/** Immutable audit event for inspection; it never mutates stock, reservations or historical cost. */
export interface ProcessingReviewRecord {
  id: string
  caseId: string
  operationId: string
  restaurantId: string
  branchId: string
  schemaVersion: number
  lotId: string
  productId: string
  productName: string
  sku?: string
  lotCode: string
  batchId?: string
  sourceSaleId?: string
  sourceLotIds: string[]
  reservationId: string
  reservationPurpose: 'repack_pending' | 'review_hold'
  location: string
  commercialQuantity: number
  commercialUnit: UnitType
  historicalAssignedWeightG: number | null
  physicalWeightG: number | null
  weightDifferenceG: number | null
  costCents: number | null
  packageCondition: ProcessingPackageCondition
  productObservation: ProcessingProductObservation
  status: ProcessingReviewStatus
  action: ProcessingReviewAction
  observations: string
  reason: string
  evidenceRefs: string[]
  revision: number
  qualityAuthorizationRef?: string
  economicDispositionStatus?: 'pending_quarantine_disposition'
  previousStatus: ProcessingReviewStatus
  reviewedAt: string
  reviewedBy: string
  reviewedByName: string
  qualityDecision?: 'authorized_for_repack' | 'not_recoverable'
}

export interface RecordProcessingReviewInput {
  lotId: string
  reservationId: string
  location: string
  expectedRevision: number
  action: ProcessingReviewAction
  physicalWeightG: number | null
  packageCondition: ProcessingPackageCondition
  productObservation: ProcessingProductObservation
  observations: string
  reason: string
  /** References to evidence already stored by an approved service; never raw files. */
  evidenceRefs: string[]
  qualityAuthorizationRef?: string
}

/** Schema contract for future repacking. Validation does not perform the conversion. */
export interface RepackOperationInput {
  operationId: string
  reviewId: string
  repackId: string
  sourceLotId: string
  reservationId: string
  location: string
  expectedReviewRevision: number
  expectedReservationQuantity: number
  sourceKind: 'traditional_lot' | 'derived_lot'
  sourceUnitType: UnitType
  openedCommercialQuantity: number
  /** Segment IDs are selectors only. Server reads all quantities, weights and costs from the source lot. */
  sourceSegments: Array<{ batchId: string; segmentId: string }>
  openedPhysicalWeightG: number
  outputs: Array<{ id: string; productId: string; commercialUnit: UnitType; commercialQuantity: number; measuredNetWeightG: number; lotCode: string; manufacturedOn: string; packagedOn: string; expiresOn: string }>
  packagingMaterials: Array<{ materialId: string; quantityMilli: number; damagedQuantityMilli: number; costCents: number | null }>
  additionalCostComponents: ProcessingCostComponent[]
  authorizationReference: string
  evidenceRefs: string[]
  reason: string
}

export interface ProcessingQualityAuthorization {
  id: string
  authorizationId: string
  restaurantId: string
  status: 'active' | 'revoked'
  beneficiaryUid: string
  grantedBy: string
  grantedAt: string
  grantReason: string
  expiresAt: string
  revokedAt: string | null
  revokedBy: string | null
  revokeReason: string | null
}

export interface ProcessingEvidenceRecord {
  id: string
  restaurantId: string
  status: 'verified' | 'pending' | 'rejected'
  evidenceType: string
  lotId: string
  reservationId: string
  reviewCaseId: string
  reviewRevision: number
  location: string
  uploadedBy: string
  recordedAt: string
  bucket: string
  objectPath: string
  objectGeneration: string
  sha256: string
  byteSize: number
  contentType: string
  viewers: string[]
}

export function validateRepackOperationContract(input: RepackOperationInput): void {
  const fail = (message: string): never => { throw new Error(message) }
  const validCommercialQuantity = (quantity: number, unit: UnitType) => Number.isFinite(quantity) && quantity > 0 &&
    (unit === 'kg' ? Number.isSafeInteger(quantity * 1000) : Number.isSafeInteger(quantity))
  const grams = [input.openedPhysicalWeightG, ...input.outputs.map(output => output.measuredNetWeightG)]
  if (!grams.every(value => Number.isSafeInteger(value) && value >= 0)) fail('Los pesos del reenvasado deben ser gramos enteros medidos.')
  if (!validCommercialQuantity(input.openedCommercialQuantity, input.sourceUnitType)) fail('La cantidad comercial abierta no coincide con la precisión de su unidad.')
  if (!input.operationId.trim() || !input.repackId.trim() || !input.reviewId.trim() || !input.reservationId.trim() || !input.sourceLotId.trim()) fail('El reenvasado requiere referencias estables de operación, lote y revisión.')
  if (!Number.isFinite(input.expectedReservationQuantity) || input.expectedReservationQuantity <= 0 || input.openedCommercialQuantity > input.expectedReservationQuantity) fail('La cantidad abierta debe estar cubierta por la reserva esperada.')
  if (!['traditional_lot', 'derived_lot'].includes(input.sourceKind) || (input.sourceKind === 'traditional_lot' && input.sourceSegments.length !== 0) || (input.sourceKind === 'derived_lot' && input.sourceSegments.length === 0)) fail('Las referencias de segmentos deben coincidir con el tipo de lote de origen.')
  if (!input.authorizationReference.trim() || !input.reason.trim() || input.evidenceRefs.length === 0) fail('El reenvasado requiere autorización, motivo y evidencia.')
  const validDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  if (input.sourceSegments.some(segment => !segment.batchId.trim() || !segment.segmentId.trim()) || new Set(input.sourceSegments.map(segment => `${segment.batchId}:${segment.segmentId}`)).size !== input.sourceSegments.length) fail('Los segmentos de origen deben ser únicos y verificables; no inventes segmentos para lotes tradicionales.')
  if (input.outputs.length === 0 || input.outputs.length > 30 || input.outputs.some(output => !output.id.trim() || !output.productId.trim() || !output.lotCode.trim() || !validCommercialQuantity(output.commercialQuantity, output.commercialUnit) || !validDay(output.manufacturedOn) || !validDay(output.packagedOn) || !validDay(output.expiresOn) || output.manufacturedOn > output.packagedOn || output.packagedOn > output.expiresOn)) fail('Cada presentación nueva requiere un destino, SKU, cantidad y fechas válidas.')
  if (new Set(input.outputs.map(output => output.id)).size !== input.outputs.length || new Set(input.outputs.map(output => `${output.productId}:${output.lotCode}:${output.manufacturedOn}`)).size !== input.outputs.length) fail('Los destinos y lotes nuevos deben ser únicos.')
  if (input.outputs.reduce((sum, output) => sum + output.measuredNetWeightG, 0) !== input.openedPhysicalWeightG) fail('Esta primera fase solo permite recuperación total sin descarte: los gramos de salida deben igualar los gramos medidos al abrir.')
  if (input.packagingMaterials.some(material => !Number.isSafeInteger(material.quantityMilli) || material.quantityMilli < 0 || !Number.isSafeInteger(material.damagedQuantityMilli) || material.damagedQuantityMilli < 0 || material.damagedQuantityMilli > material.quantityMilli || (material.costCents !== null && (!Number.isSafeInteger(material.costCents) || material.costCents < 0)))) fail('Los materiales de envasado deben tener cantidades y costos enteros válidos.')
  if (input.additionalCostComponents.some(component => !component.id.trim() || !['source_inventory','packaging','labor','other'].includes(component.kind) || component.amountCents !== null && (!Number.isSafeInteger(component.amountCents) || component.amountCents < 0) || typeof component.alreadyRecognizedAsOperatingExpense !== 'boolean' || typeof component.capitalizable !== 'boolean' || component.alreadyRecognizedAsOperatingExpense && component.capitalizable)) fail('Los costos adicionales deben estar identificados en centavos y no pueden reconocerse dos veces.')
  if (new Set(input.additionalCostComponents.map(component => component.id)).size !== input.additionalCostComponents.length) fail('No repitas un componente de costo en el reenvasado.')
}

export interface ProcessingSourceAllocation extends DistLotAllocation {
  sourceProductId: string
  sourceUnitType: UnitType
  quantityMilli: number
  measuredNetWeightG: number
  /** Total allocated historical cost for this source portion, in cents. */
  historicalCostCents: number | null
  originStatus: 'confirmed' | 'pending' | 'synthetic'
}

/** Asignación contable determinista por destino; no certifica qué lote físico quedó en cada sachet. */
export interface ProcessingDestinationSourceAllocation {
  sourceLotId: string
  sourceLotCode: string
  sourceProductId: string
  quantityMilli: number
  weightG: number
  costCents: number | null
  originStatus: 'accounting_allocation_not_physical_identification'
}

export interface ProcessingCostComponent {
  id: string
  kind: 'source_inventory' | 'packaging' | 'labor' | 'other'
  amountCents: number | null
  expenseId?: string
  alreadyRecognizedAsOperatingExpense: boolean
  capitalizable: boolean
  sourceReference?: string
}

export interface ProcessingDestination {
  id: string
  kind: ProcessingDestinationKind
  productId?: string
  lotId?: string
  lotCode?: string
  commercialUnit?: UnitType
  commercialQuantity: number
  /** Actual net product mass. Packaging tare is never included. */
  netWeightG: number
  nominalWeightG?: number
  weightBasis?: ProcessingWeightBasis
  /** Remainder grams are explicitly retained with the package range. */
  packageWeight?: PackageWeightLedger
  sourceAllocations: ProcessingDestinationSourceAllocation[]
  reason?: string
  approvalStatus: ProcessingApprovalStatus
  manufacturedOn?: string
  packagedOn?: string
  expiresOn?: string
  sourceLotIds?: string[]
  sourceAllocationBasis?: 'batch_blend_accounting_allocation'
  costCents?: number | null
  qualityConfirmedBy?: string
  qualityConfirmedAt?: string
  qualityReason?: string
  approvedBy?: string
  approvedByName?: string
}

export interface ConfirmProcessingBatchInput {
  batchId: string
  processType: ProcessingBatch['processType']
  sourceProductId: string
  location: string
  inputWeightG: number
  processingDate: string
  note?: string
  sourceAllocations: Array<{ lotId: string; quantity: number; measuredNetWeightG: number }>
  destinations: Array<Omit<ProcessingDestination, 'sourceAllocations' | 'approvalStatus'> & { lotCode?: string; qualityConfirmed?: boolean; qualityReason?: string }>
  packagingMaterials?: ProcessingPackagingMaterial[]
  costComponents?: ProcessingCostComponent[]
  otherDestinationsG?: number
}

export interface PackageWeightLedger {
  packageCount: number
  measuredNetWeightG: number
  consumedCount: number
  consumedWeightG: number
  /** FIFO package index; the final package(s) retain the measured gram remainder. */
  nextPackageIndex: number
  weightBasis: ProcessingWeightBasis
}

/** Remaining documented-average package assignment for one derived lot at one location. */
export interface ProcessingLotLocationSegment {
  segmentId: string
  batchId: string
  destinationId: string
  sourceMovementId: string
  weightBasis: ProcessingWeightBasis
  remainingQuantity: number
  remainingWeightG: number
  remainingCostCents: number | null
}

export interface ProcessingLotLocationLedger {
  segments: ProcessingLotLocationSegment[]
}

/** A movement allocation carries its exact accounting slice so a correction restores the same grams/cents. */
export interface ProcessingMovementAllocation {
  segmentId: string
  batchId: string
  destinationId: string
  sourceMovementId: string
  quantity: number
  physicalWeightG: number
  costCents: number | null
  weightBasis: ProcessingWeightBasis
  allocationMethod: 'documented_average'
  physicalOriginConfirmed: false
  sourceLocation: string
  allocationOperationId: string
  saleId?: string
  saleMovementId?: string
  location?: string
}

export interface ProcessingPackagingMaterial {
  id: string
  description: string
  quantityMilli: number
  damagedQuantityMilli: number
  costCents: number | null
  expenseId?: string
}

export interface ProcessingBatch {
  id: string
  operationId: string
  restaurantId: string
  branchId: string
  schemaVersion: number
  status: ProcessingStatus
  processType: 'portioning' | 'bagging' | 'repackaging'
  processingDate?: string
  sourceProductId: string
  sourceProductName?: string
  sourceUnitType?: UnitType
  sourceCostCents?: number | null
  note?: string
  sourceLocation: string
  sourceAllocations: ProcessingSourceAllocation[]
  inputWeightG: number
  destinations: ProcessingDestination[]
  packagingMaterials: ProcessingPackagingMaterial[]
  costComponents: ProcessingCostComponent[]
  responsibleUid: string
  responsibleName: string
  createdAt: string
  dayKey: string
  confirmedAt?: string
  confirmedBy?: string
  auditEventIds: string[]
  reversal: { status: ProcessingReversalStatus; dependencyIds: string[]; reason?: string }
}

export interface ProcessingAuditEvent {
  id: string
  batchId: string
  operationId: string
  kind: 'confirmed' | 'reserved' | 'released' | 'courtesy_delivered' | 'repacked' | 'discard_approved' | 'document_corrected' | 'reversed'
  physicalDeltaG: number
  createdAt: string
  createdBy: string
  reason?: string
  references: string[]
}

export interface ProcessingReservation {
  id: string
  restaurantId: string
  branchId: string
  schemaVersion: number
  productId: string
  productName: string
  lotId: string
  lotCode: string
  unitType: UnitType
  location: string
  purpose: 'courtesy' | 'repack_pending' | 'review_hold'
  originalQuantity: number
  remainingQuantity: number
  consumedQuantity: number
  physicalWeightG: number | null
  remainingWeightG: number | null
  remainingCostCents?: number | null
  status: ProcessingReservationStatus
  source: string
  batchId?: string
  createdAt: string
  createdBy: string
  createdByName: string
  history: Array<{ id: string; action: string; quantity: number; at: string; by: string; byName: string; reason: string }>
  releaseReason?: string
  movementId?: string
  updatedAt?: string
  updatedBy?: string
}

export interface ProcessingAvailabilityInput {
  physicalG: number
  expiredG?: number
  quarantinedG?: number
  pendingOriginG?: number
  repackPendingG?: number
  reviewHoldG?: number
  courtesyReservedG?: number
  otherUnavailableG?: number
}

