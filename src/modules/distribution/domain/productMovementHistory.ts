import type { DistStockMovement, StockMovementType } from '../types.ts'

export type ProductMovementFilter =
  | 'all'
  | 'sales'
  | 'losses'
  | 'shortages'
  | 'overages'
  | 'dispatches'
  | 'intakes'
  | 'adjustments'
  | 'returns'
  | 'differences'
  | 'dispatchReturns'
  | 'intakesAdjustments'

export const MOVEMENT_TYPES_BY_FILTER: Record<Exclude<ProductMovementFilter, 'all'>, StockMovementType[]> = {
  sales: ['sale'],
  losses: [
    'return_waste',
    'return_waste_unassigned',
    'dispatch_waste',
    'quarantine_discard',
    'processing_discard',
    'return_merma',
  ],
  shortages: ['shortage'],
  overages: ['overage'],
  dispatches: ['dispatch', 'dispatch_addition', 'dispatch_correction', 'dispatch_merma_sale'],
  intakes: ['intake', 'processing_output', 'quarantine_release'],
  adjustments: ['adjustment', 'transfer', 'processing_consumption', 'processing_commercial_rectification', 'courtesy'],
  returns: ['return', 'customer_return', 'return_merma', 'return_waste', 'return_waste_unassigned'],
  differences: ['shortage', 'overage'],
  dispatchReturns: [
    'dispatch',
    'dispatch_addition',
    'dispatch_correction',
    'dispatch_merma_sale',
    'return',
    'customer_return',
    'return_merma',
    'return_waste',
    'return_waste_unassigned',
    'shortage',
    'overage',
  ],
  intakesAdjustments: [
    'intake',
    'adjustment',
    'transfer',
    'courtesy',
    'quarantine_release',
    'processing_consumption',
    'processing_output',
    'processing_commercial_rectification',
  ],
}

const dispatches = new Set(['dispatch', 'dispatch_addition', 'dispatch_correction', 'dispatch_merma_sale'])

export function isDispatchWithMerma(movement: DistStockMovement): boolean {
  return dispatches.has(movement.type) && Number(movement.dispatchMerma || 0) > 0
}

export function filterProductMovementHistory(
  movements: DistStockMovement[],
  productId: string,
  filter: ProductMovementFilter,
): DistStockMovement[] {
  return movements
    .filter((movement) => movement.productId === productId)
    .filter((movement) => {
      if (filter === 'all') return true
      if (filter === 'losses') return MOVEMENT_TYPES_BY_FILTER.losses.includes(movement.type) || isDispatchWithMerma(movement)
      const allowed = MOVEMENT_TYPES_BY_FILTER[filter]
      if (allowed) return allowed.includes(movement.type)
      return false
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
