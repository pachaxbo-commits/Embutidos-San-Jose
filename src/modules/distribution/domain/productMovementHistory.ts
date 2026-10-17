import type { DistStockMovement } from '../types.ts'

export type ProductMovementFilter = 'all' | 'losses' | 'differences' | 'dispatchReturns' | 'intakesAdjustments'

const recoverableOrLoss = new Set(['return_merma', 'return_waste', 'return_waste_unassigned', 'dispatch_waste'])
const dispatches = new Set(['dispatch', 'dispatch_addition', 'dispatch_correction'])
const returns = new Set(['return', 'return_merma', 'return_waste', 'return_waste_unassigned'])
const intakeAdjustment = new Set(['intake', 'adjustment', 'transfer', 'sale', 'sale_correction', 'courtesy'])

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
      if (filter === 'losses') return recoverableOrLoss.has(movement.type) || isDispatchWithMerma(movement)
      if (filter === 'differences') return movement.type === 'shortage' || movement.type === 'overage'
      if (filter === 'dispatchReturns') return dispatches.has(movement.type) || returns.has(movement.type) || movement.type === 'shortage' || movement.type === 'overage'
      return intakeAdjustment.has(movement.type)
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
