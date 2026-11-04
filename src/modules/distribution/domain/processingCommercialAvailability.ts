import type { DistLot } from '../types.ts'

/** Server writes this authorization; the protected accounting path remains active. */
export function processingCommerciallyAvailable(lot: DistLot): boolean {
  return !lot.processingCommercialBlocked || lot.processingDestinationKind === 'finished'
    && lot.processingCommercialRelease?.status === 'released'
    && lot.processingCommercialRelease.batchId === lot.processingBatchId
}

/** Mirrors the server movement gate for derived finished lots in dispatches. */
export function processingDispatchIneligibility(lot: DistLot, location: string, today: string): string | null {
  if (!lot.processingCommercialBlocked) return null
  if (lot.processingDestinationKind !== 'finished') return 'no es un lote terminado elegible para despacho'
  if (!processingCommerciallyAvailable(lot)) return 'está pendiente de liberación comercial por Administración'
  if (lot.quarantined) return 'está en cuarentena y no puede salir en un despacho'
  if (lot.expiresOn && lot.expiresOn < today) return `está vencido desde ${lot.expiresOn}`
  if (Number(lot.pendingOrigins?.[location]?.reduce((sum, row) => sum + Number(row.quantity || 0), 0) || 0) > 0) return 'tiene origen físico pendiente de revisión'
  const held = lot.processingUnavailable?.[location] || { courtesy: 0, repackPending: 0, reviewHold: 0 }
  if (Number(held.courtesy || 0) > 0) return 'tiene producto reservado para cortesía'
  if (Number(held.repackPending || 0) > 0) return 'tiene producto pendiente de reenvasado'
  if (Number(held.reviewHold || 0) > 0) return 'tiene producto inmovilizado para revisión'
  if (!lot.processingSourceAllocationBasis) return 'no conserva una asignación de origen trazable'
  const segments = lot.processingByLocation?.[location]?.segments
  if (!Array.isArray(segments) || segments.length === 0) return 'no conserva segmentos trazables en este almacén'
  const quantity = Number(lot.quantities?.[location] || 0)
  if (!(quantity > 0)) return 'no tiene unidades disponibles en este almacén'
  const segmentQuantity = segments.reduce((sum, segment) => sum + Number(segment.remainingQuantity || 0), 0)
  if (segmentQuantity !== quantity) return 'la cantidad no concilia con sus segmentos trazables'
  return null
}
