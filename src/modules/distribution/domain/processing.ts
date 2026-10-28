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
  sourceAllocations: Array<{ sourceLotId: string; quantityMilli: number; weightG: number; costCents: number | null }>
  reason?: string
  approvalStatus: ProcessingApprovalStatus
  manufacturedOn?: string
  expiresOn?: string
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
  batchId: string
  productId: string
  lotId: string
  location: string
  purpose: 'courtesy' | 'repack_pending' | 'review_hold'
  physicalQuantityMilli: number
  physicalWeightG: number
  remainingQuantityMilli: number
  remainingWeightG: number
  status: ProcessingReservationStatus
  createdAt: string
  createdBy: string
  approvedBy?: string
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

