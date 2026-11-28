import type { DistStockMovement } from '../types.ts'

/** An inventory correction is a physical loss only when explicitly classified. */
export function isAuditedPhysicalLoss(movement: DistStockMovement): boolean {
  if (movement.reversedAt || movement.pendingConfirmation) return false
  if (movement.type === 'adjustment') {
    return movement.lossClassification === 'confirmed_physical_loss' &&
      (movement.centralDelta < 0 || movement.routeDelta < 0)
  }
  return movement.type === 'shortage' || movement.type === 'return_waste' ||
    movement.type === 'return_waste_unassigned' || movement.type === 'dispatch_waste' ||
    movement.type === 'processing_discard'
}
