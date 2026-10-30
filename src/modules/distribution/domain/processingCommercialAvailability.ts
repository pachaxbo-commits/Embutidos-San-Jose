import type { DistLot } from '../types.ts'

/** Server writes this authorization; the protected accounting path remains active. */
export function processingCommerciallyAvailable(lot: DistLot): boolean {
  return !lot.processingCommercialBlocked || lot.processingDestinationKind === 'finished'
    && lot.processingCommercialRelease?.status === 'released'
    && lot.processingCommercialRelease.batchId === lot.processingBatchId
}
