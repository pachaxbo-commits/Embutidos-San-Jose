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
export type ProcessingReviewAction = 'record_observation' | 'start_review' | 'request_information' | 'authorize_repack' | 'declare_unrecoverable' | 'mark_pending_economic_disposition'

/** Immutable audit event for inspection; it never mutates stock, reservations or historical cost. */
export interface ProcessingReviewRecord {
  id: string
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
  sourceLotId: string
  reservationId: string
  location: string
  expectedReviewRevision: number
  sourceExpiryCeiling: string
  sourceUnitType: UnitType
  openedCommercialQuantity: number
  sourceSegments: Array<{ lotId: string; batchId: string; segmentId: string; commercialQuantity: number; historicalWeightG: number | null; costCents: number | null }>
  openedPhysicalWeightG: number
  recoveredNetWeightG: number
  confirmedDiscardWeightG: number
  otherPhysicalDestinations: Array<{ kind: string; netWeightG: number; reference: string }>
  outputs: Array<{ productId: string; commercialUnit: UnitType; commercialQuantity: number; measuredNetWeightG: number; lotCode: string; manufacturedOn: string; packagedOn: string; expiresOn: string }>
  packagingMaterials: Array<{ materialId: string; quantityMilli: number; damagedQuantityMilli: number; costCents: number | null }>
  additionalCostComponents: ProcessingCostComponent[]
  authorizationReference: string
  evidenceRefs: string[]
  reason: string
}

export function validateRepackOperationContract(input: RepackOperationInput): void {
  const fail = (message: string): never => { throw new Error(message) }
  const validCommercialQuantity = (quantity: number, unit: UnitType) => Number.isFinite(quantity) && quantity > 0 &&
    (unit === 'kg' ? Number.isSafeInteger(quantity * 1000) : Number.isSafeInteger(quantity))
  const grams = [input.openedPhysicalWeightG, input.recoveredNetWeightG, input.confirmedDiscardWeightG,
    ...input.otherPhysicalDestinations.map(destination => destination.netWeightG),
    ...input.outputs.map(output => output.measuredNetWeightG)]
  if (!grams.every(value => Number.isSafeInteger(value) && value >= 0)) fail('Los pesos del reenvasado deben ser gramos enteros medidos.')
  if (!validCommercialQuantity(input.openedCommercialQuantity, input.sourceUnitType)) fail('La cantidad comercial abierta no coincide con la precisión de su unidad.')
  if (!input.operationId.trim() || !input.reviewId.trim() || !input.reservationId.trim() || !input.sourceLotId.trim()) fail('El reenvasado requiere referencias estables de operación, revisión, reserva y lote.')
  if (!input.authorizationReference.trim() || !input.reason.trim() || input.evidenceRefs.length === 0) fail('El reenvasado requiere autorización, motivo y evidencia.')
  const validDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  if (!validDay(input.sourceExpiryCeiling)) fail('La fecha límite de vencimiento del origen debe estar documentada.')
  if (input.sourceSegments.length === 0 || input.sourceSegments.some(segment => !segment.lotId.trim() || !segment.batchId.trim() || !segment.segmentId.trim() || !validCommercialQuantity(segment.commercialQuantity, input.sourceUnitType) || segment.historicalWeightG !== null && (!Number.isSafeInteger(segment.historicalWeightG) || segment.historicalWeightG < 0) || segment.costCents !== null && (!Number.isSafeInteger(segment.costCents) || segment.costCents < 0))) fail('Los segmentos originales requieren lote, elaboración, cantidades y costos verificables.')
  if (input.outputs.some(output => !validCommercialQuantity(output.commercialQuantity, output.commercialUnit) || !output.productId.trim() || !output.lotCode.trim() || !validDay(output.manufacturedOn) || !validDay(output.packagedOn) || !validDay(output.expiresOn) || output.manufacturedOn > output.packagedOn || output.packagedOn > output.expiresOn || output.expiresOn > input.sourceExpiryCeiling)) fail('Cada presentación nueva requiere SKU, lote y fechas válidas; no se puede ampliar automáticamente el vencimiento del origen.')
  if (input.packagingMaterials.some(material => !Number.isSafeInteger(material.quantityMilli) || material.quantityMilli < 0 || !Number.isSafeInteger(material.damagedQuantityMilli) || material.damagedQuantityMilli < 0 || material.damagedQuantityMilli > material.quantityMilli || (material.costCents !== null && (!Number.isSafeInteger(material.costCents) || material.costCents < 0)))) fail('Los materiales de envasado deben tener cantidades y costos enteros válidos.')
  if (input.additionalCostComponents.some(component => !component.id.trim() || !['source_inventory','packaging','labor','other'].includes(component.kind) || component.amountCents !== null && (!Number.isSafeInteger(component.amountCents) || component.amountCents < 0) || typeof component.alreadyRecognizedAsOperatingExpense !== 'boolean' || typeof component.capitalizable !== 'boolean' || component.alreadyRecognizedAsOperatingExpense && component.capitalizable)) fail('Los costos adicionales deben estar identificados en centavos y no pueden reconocerse dos veces.')
  if (new Set(input.additionalCostComponents.map(component => component.id)).size !== input.additionalCostComponents.length) fail('No repitas un componente de costo en el reenvasado.')
  if (input.otherPhysicalDestinations.some(destination => !destination.kind.trim() || !destination.reference.trim())) fail('Cada destino físico adicional necesita tipo y referencia auditables.')
  const accounted = input.recoveredNetWeightG + input.confirmedDiscardWeightG + input.otherPhysicalDestinations.reduce((sum, destination) => sum + destination.netWeightG, 0)
  if (accounted !== input.openedPhysicalWeightG) fail('La masa medida abierta no concilia con producto recuperado, descarte confirmado y otros destinos físicos.')
  if (input.outputs.reduce((sum, output) => sum + output.measuredNetWeightG, 0) !== input.recoveredNetWeightG) fail('El peso neto de los nuevos envases debe coincidir con el producto recuperado medido.')
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

