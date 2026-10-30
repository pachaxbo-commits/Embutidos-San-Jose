import { getPossibleDispatchIdsForLegacySale, isSaleForDispatchSettlement, partitionDispatchSettlementSales } from '../engine.ts'
const base = { createdAt: '2026-10-29T12:00:00.000Z', routeId: 'route-1', sourceLocation: 'route' }
const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message) }
assert(isSaleForDispatchSettlement({ ...base }, 'dispatch-1', 'route-1', '2026-10-29T11:00:00.000Z'), 'legacy sale on same route after dispatch belongs to settlement')
assert(isSaleForDispatchSettlement({ ...base, dispatchId: 'dispatch-1' }, 'dispatch-1', 'route-1', '2026-10-29T13:00:00.000Z'), 'sale with exact dispatch ID remains in scope')
assert(!isSaleForDispatchSettlement({ ...base, routeId: 'route-2' }, 'dispatch-1', 'route-1', '2026-10-29T11:00:00.000Z'), 'sale from another route is excluded')
assert(!isSaleForDispatchSettlement({ ...base, createdAt: '2026-10-29T10:00:00.000Z' }, 'dispatch-1', 'route-1', '2026-10-29T11:00:00.000Z'), 'legacy sale before the dispatch is excluded')
assert(!isSaleForDispatchSettlement({ ...base, sourceLocation: 'centralWarehouse' }, 'dispatch-1', 'route-1', '2026-10-29T11:00:00.000Z'), 'central warehouse sale is excluded')
const overlapping = [
  { id: 'dispatch-1', routeId: 'route-1', createdAt: '2026-10-29T11:00:00.000Z', status: 'open' as const },
  { id: 'dispatch-2', routeId: 'route-1', createdAt: '2026-10-29T12:00:00.000Z', status: 'open' as const },
]
const ambiguous = { ...base, createdAt: '2026-10-29T13:00:00.000Z' }
assert(!isSaleForDispatchSettlement(ambiguous, 'dispatch-1', 'route-1', '2026-10-29T11:00:00.000Z', overlapping), 'legacy sale matching overlapping dispatches is not assigned to the older dispatch')
assert(!isSaleForDispatchSettlement(ambiguous, 'dispatch-2', 'route-1', '2026-10-29T12:00:00.000Z', overlapping), 'legacy sale matching overlapping dispatches is not arbitrarily assigned to the newer dispatch')
assert(isSaleForDispatchSettlement({ ...base, createdAt: '2026-10-29T11:30:00.000Z' }, 'dispatch-1', 'route-1', '2026-10-29T11:00:00.000Z', overlapping), 'legacy sale before the next dispatch belongs to the unique open dispatch')

const closedAtNoon = { id: 'dispatch-closed', routeId: 'route-1', createdAt: '2026-10-29T09:00:00.000Z', status: 'closed' as const, closedAt: '2026-10-29T12:00:00.000Z' }
const openAtTen = { id: 'dispatch-open', routeId: 'route-1', createdAt: '2026-10-29T10:00:00.000Z', status: 'open' as const }
const overlapAtEleven = { ...base, createdAt: '2026-10-29T11:00:00.000Z' }
assert(JSON.stringify(getPossibleDispatchIdsForLegacySale(overlapAtEleven, 'route-1', [closedAtNoon, openAtTen])) === JSON.stringify(['dispatch-closed', 'dispatch-open']), 'la venta dentro del traslape ve ambos despachos, incluso si uno ya cerró')
assert(!isSaleForDispatchSettlement(overlapAtEleven, 'dispatch-open', 'route-1', openAtTen.createdAt, [closedAtNoon, openAtTen]), 'no atribuye al despacho abierto una venta ambigua con uno ya cerrado')
const afterClose = { ...base, createdAt: '2026-10-29T13:00:00.000Z' }
assert(JSON.stringify(getPossibleDispatchIdsForLegacySale(afterClose, 'route-1', [closedAtNoon, openAtTen])) === JSON.stringify(['dispatch-open']), 'el despacho cerrado no compite después de su hora de cierre')

const reopened = {
  id: 'dispatch-reopened', routeId: 'route-1', createdAt: '2026-10-29T09:00:00.000Z', status: 'open' as const,
  reopenHistory: [{ reopenedAt: '2026-10-29T15:00:00.000Z', previousClosedAt: '2026-10-29T12:00:00.000Z' }],
}
assert(JSON.stringify(getPossibleDispatchIdsForLegacySale({ ...base, createdAt: '2026-10-29T13:00:00.000Z' }, 'route-1', [reopened])) === JSON.stringify([]), 'el intervalo cerrado de un despacho reabierto no captura ventas del receso')
assert(JSON.stringify(getPossibleDispatchIdsForLegacySale({ ...base, createdAt: '2026-10-29T16:00:00.000Z' }, 'route-1', [reopened])) === JSON.stringify(['dispatch-reopened']), 'la reapertura inicia un intervalo nuevo')

const partition = partitionDispatchSettlementSales([
  { ...base, id: 'ambiguous-active', createdAt: '2026-10-29T11:00:00.000Z' },
  { ...base, id: 'ambiguous-void', createdAt: '2026-10-29T11:00:00.000Z', voidedAt: '2026-10-29T14:00:00.000Z' },
  { ...base, id: 'ambiguous-pending', createdAt: '2026-10-29T11:00:00.000Z', pendingConfirmation: true },
], 'dispatch-open', 'route-1', [closedAtNoon, openAtTen])
assert(partition.ambiguous.length === 1, 'solo la venta efectiva ambigua aparece en la advertencia')
assert(partition.excluded.length === 2, 'anulada y pendiente se conservan fuera de cantidades efectivas')
const undatedPartition = partitionDispatchSettlementSales([
  { id: 'legacy-without-time', routeId: 'route-1', sourceLocation: 'route' },
], 'only-dispatch', 'route-1', [{ id: 'only-dispatch', routeId: 'route-1', createdAt: '2026-10-29T09:00:00.000Z', status: 'open' }])
assert(undatedPartition.ambiguous.length === 1, 'venta activa sin fecha confiable sigue visible como ambigua aunque solo haya un despacho conocido, igual que en el servidor')
console.log('PASS alcance de ventas vinculadas y ventas históricas sin dispatchId')
