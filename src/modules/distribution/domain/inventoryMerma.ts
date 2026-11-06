import type { DistStockMovement } from '../types.ts'

const physicalLossTypes = new Set([
  'dispatch_waste', 'return_merma', 'return_waste', 'return_waste_unassigned',
  'shortage', 'quarantine_discard', 'processing_discard',
])

export function isInventoryMermaMovement(movement: DistStockMovement): boolean {
  return physicalLossTypes.has(movement.type) && !movement.reversedAt && !movement.pendingConfirmation
}

/** Batch discard is already represented in the processing summary; hide its ledger echo in consolidated lists. */
export function filterInventoryMermaMovements(
  movements: DistStockMovement[],
  excludedProcessingBatchIds: ReadonlySet<string> = new Set(),
): DistStockMovement[] {
  return movements.filter(movement => isInventoryMermaMovement(movement)
    && !(movement.type === 'processing_discard' && Boolean(movement.batchId) && excludedProcessingBatchIds.has(movement.batchId!)))
}

export function summarizeInventoryMermaMovements(movements: DistStockMovement[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const movement of movements) {
    const key = movement.unitType
    totals.set(key, (totals.get(key) || 0) + Math.abs(Number(movement.quantity) || 0))
  }
  return totals
}
