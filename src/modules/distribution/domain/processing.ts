import type { DistLotAllocation, UnitType } from '../types.ts'

/** Schema contracts only. These types do not imply stock is reserved or protected. */
export type ProcessingStatus = 'draft' | 'confirmed' | 'corrected' | 'reversed'
export type ProcessingDestinationKind = 'finished' | 'courtesy' | 'repack_pending' | 'review_hold' | 'discard' | 'other'
export type ProcessingApprovalStatus = 'not_required' | 'pending' | 'approved' | 'rejected'
export type ProcessingWeightBasis = 'measured_total' | 'documented_average' | 'individual_measurements'
export type ProcessingReservationStatus = 'active' | 'partially_consumed' | 'released' | 'consumed'
export type ProcessingReversalStatus = 'clear' | 'blocked' | 'approved'

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

