import type { DistStockMovement } from '../types.ts'

export interface ProductKardexRow {
  movement: DistStockMovement
  entry: number
  exit: number
  delta: number
  runningBalance: number
  excludedFromBalance: boolean
}

export function movementDeltaAtLocation(movement: DistStockMovement, selectedLocation: string): number {
  if (movement.reversedAt || movement.rectifiedAt) return 0
  const from = movement.fromLocation || ''
  const to = movement.toLocation || ''
  if (selectedLocation === 'all') {
    // A transfer between two tracked locations changes composition, not total
    // physical company stock. A sale, shortage, or intake has one side absent.
    if (from && to) return 0
    if (from) return -Math.abs(Number(movement.quantity) || 0)
    if (to) return Math.abs(Number(movement.quantity) || 0)
    return Number(movement.centralDelta || 0) + Number(movement.routeDelta || 0)
  }
  if (from || to) {
    const incoming = to === selectedLocation ? Math.abs(Number(movement.quantity) || 0) : 0
    const outgoing = from === selectedLocation ? Math.abs(Number(movement.quantity) || 0) : 0
    return incoming - outgoing
  }
  if (selectedLocation === 'central') return Number(movement.centralDelta) || 0
  if (selectedLocation.startsWith('route__') && movement.routeId === selectedLocation.slice(7)) return Number(movement.routeDelta) || 0
  return 0
}

export function calculateProductKardex(
  movements: DistStockMovement[],
  productId: string,
  selectedLocation: string,
  openingBalance = 0,
): ProductKardexRow[] {
  const ordered = movements
    .filter((movement) => movement.productId === productId)
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  let balance = openingBalance
  return ordered.map((movement) => {
    const excludedFromBalance = Boolean(movement.reversedAt || movement.rectifiedAt)
    const delta = movementDeltaAtLocation(movement, selectedLocation)
    balance += delta
    return { movement, entry: Math.max(0, delta), exit: Math.max(0, -delta), delta, runningBalance: balance, excludedFromBalance }
  })
}
