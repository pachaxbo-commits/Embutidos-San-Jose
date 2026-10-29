import { isSaleForDispatchSettlement } from '../engine.ts'
const base = { createdAt: '2026-10-29T12:00:00.000Z', routeId: 'route-1', sourceLocation: 'route' }
const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message) }
assert(isSaleForDispatchSettlement({ ...base }, 'dispatch-1', 'route-1', '2026-10-29T11:00:00.000Z'), 'legacy sale on same route after dispatch belongs to settlement')
assert(isSaleForDispatchSettlement({ ...base, dispatchId: 'dispatch-1' }, 'dispatch-1', 'route-1', '2026-10-29T13:00:00.000Z'), 'sale with exact dispatch ID remains in scope')
assert(!isSaleForDispatchSettlement({ ...base, routeId: 'route-2' }, 'dispatch-1', 'route-1', '2026-10-29T11:00:00.000Z'), 'sale from another route is excluded')
assert(!isSaleForDispatchSettlement({ ...base, createdAt: '2026-10-29T10:00:00.000Z' }, 'dispatch-1', 'route-1', '2026-10-29T11:00:00.000Z'), 'legacy sale before the dispatch is excluded')
assert(!isSaleForDispatchSettlement({ ...base, sourceLocation: 'centralWarehouse' }, 'dispatch-1', 'route-1', '2026-10-29T11:00:00.000Z'), 'central warehouse sale is excluded')
console.log('PASS alcance de ventas vinculadas y ventas históricas sin dispatchId')
