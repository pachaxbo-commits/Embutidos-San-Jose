import { centralBalanceId, toDayKey } from './engine.ts'
import { originPendingQuantity } from './originTraceability.ts'
import type { DistBalance, DistCollection, DistExpense, DistLot, DistReceivable, DistSale } from '../types.ts'
import type { PendingOperation } from '../data/operationQueue.ts'

export function pendingSalesFromOperations(operations: PendingOperation[], sales: DistSale[]): DistSale[] {
  return operations.filter(o => o.status === 'queued' && o.type === 'sale' && !sales.some(s => s.id === o.id))
    .map(o => ({ ...o.payload, id: o.id, createdAt: o.createdAt, dayKey: toDayKey(o.createdAt), pendingConfirmation: true } as unknown as DistSale))
}

export function pendingCollectionsFromOperations(operations: PendingOperation[], collections: DistCollection[]): DistCollection[] {
  return operations.filter(o => o.status === 'queued' && o.type === 'collection' && !collections.some(c => c.id === o.id))
    .map(o => {
      const p = o.payload as unknown as { receivable?: DistReceivable; receivableId?: string; customerId?: string; customerName?: string; amount: number; method: 'cash' | 'qr' | 'mixed'; cashAmount?: number; qrAmount?: number; routeId: string; collectedByName: string; provisionalSnapshot?: Partial<DistCollection> }
      const snapshot = p.provisionalSnapshot || {}
      return { ...p, ...snapshot, id: o.id, operationId: o.id, receivableId: snapshot.receivableId || p.receivable?.id || p.receivableId || '', customerId: p.receivable?.customerId || p.customerId || '', customerName: p.receivable?.customerName || p.customerName || '', collectedByUid: o.createdBy, createdAt: o.createdAt, dayKey: toDayKey(o.createdAt), pendingConfirmation: true } as unknown as DistCollection
    })
}

export function pendingExpensesFromOperations(operations: PendingOperation[], expenses: DistExpense[]): DistExpense[] {
  return operations.filter(o => o.status === 'queued' && o.type === 'expense' && !expenses.some(e => e.id === o.id))
    .map(o => ({ ...o.payload, id: o.id, createdAt: o.createdAt, dayKey: toDayKey(o.createdAt), pendingConfirmation: true } as unknown as DistExpense))
}

export function projectReceivables(receivables: DistReceivable[], pendingCollections: DistCollection[]): DistReceivable[] {
  return receivables.map(r => {
    const pending = pendingCollections.reduce((total, collection) => {
      const allocationTotal = collection.allocations?.length
        ? collection.allocations.filter(allocation => allocation.receivableId === r.id).reduce((sum, allocation) => sum + allocation.amount, 0)
        : collection.receivableId === r.id ? collection.amount : 0
      return total + allocationTotal
    }, 0)
    return { ...r, balance: Math.max(0, Math.round((r.balance - pending) * 100) / 100), pendingConfirmation: pending > 0 }
  })
}

export function projectBalances(balances: DistBalance[], pendingSales: DistSale[], lots: DistLot[], today: string): DistBalance[] {
  return balances.map(b => {
    const pendingQty = pendingSales.filter(s => s.sourceLocation === 'route'
      ? b.locationKind === 'route' && b.routeId === s.routeId
      : b.id === centralBalanceId(b.productId))
      .flatMap(s => s.lines).filter(line => line.productId === b.productId).reduce((n, line) => n + line.quantity, 0)
    const location = b.locationKind === 'route' ? `route__${b.routeId}` : (b.warehouseId && b.warehouseId !== 'central' ? `warehouse__${b.warehouseId}` : 'central')
    const unavailable = lots.filter(l => l.productId === b.productId)
      .reduce((n, l) => {
        const physical = Number(l.quantities[location]) || 0
        if (l.processingCommercialBlocked || l.quarantined || l.expiresOn && l.expiresOn < today) return n + physical
        const held = l.processingUnavailable?.[location]
        return n + (location.startsWith('route__') ? 0 : originPendingQuantity(l, location)) + Number(held?.courtesy || 0) + Number(held?.repackPending || 0) + Number(held?.reviewHold || 0)
      }, 0)
    return { ...b, quantity: Math.max(0, b.quantity - pendingQty), availableQuantity: Math.max(0, b.quantity - pendingQty - unavailable) }
  })
}
