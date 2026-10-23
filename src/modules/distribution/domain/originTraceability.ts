import type { DistLot, DistStockMovement } from '../types.ts'
export const originPendingQuantity = (lot: DistLot, location: string): number =>
  Math.round((lot.pendingOrigins?.[location] || []).reduce((n, r) => n + r.quantity, 0) * 1000) / 1000
export function movementOriginNote(movement: DistStockMovement, context: DistStockMovement[] = []): string {
  const pending = movement.originReferences?.length || movement.traceabilityStatus || context.some(m => m.type === 'traceability_notice' && m.documentedMovementIds?.includes(movement.id))
  return pending ? 'Referencia contable de lote; procedencia física pendiente. No certifica el lote de las bolsas.' : ''
}
