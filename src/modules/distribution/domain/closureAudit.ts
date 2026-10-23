import type { DistClosure, DistClosureProductRow } from '../types.ts'

export interface ClosureReopenEvent {
  reopenedAt?: string
  reopenedBy?: string
  reopenedByName?: string
  reason?: string
  previousClosedAt?: string
  previousWarehouseClosedAt?: string
  previousClosedBy?: string
  previousClosedByName?: string
}

export function closureReopenEvents(closure: DistClosure): ClosureReopenEvent[] {
  const events: ClosureReopenEvent[] = (closure.reopenHistory || []).map((entry) => ({
    reopenedAt: entry.reopenedAt || undefined,
    reopenedBy: entry.reopenedBy,
    reopenedByName: entry.reopenedByName,
    reason: entry.reason,
    previousClosedAt: entry.previousClosedAt || undefined,
    previousWarehouseClosedAt: entry.warehouseClosedAt || undefined,
    previousClosedBy: entry.previousClosedBy,
    previousClosedByName: entry.previousClosedByName,
  }))
  if (closure.reopenedAt && !events.some((event) => event.reopenedAt === closure.reopenedAt)) {
    events.push({
      reopenedAt: closure.reopenedAt,
      reopenedBy: closure.reopenedBy,
      reopenedByName: closure.reopenedByName,
      reason: closure.reopenReason,
    })
  }
  return events.sort((a, b) => (a.reopenedAt || '').localeCompare(b.reopenedAt || ''))
}

export interface ClosureReturnSummary {
  normal: number
  recoverableMerma: number
  totalApto: number
  nonSellable: number
  returnsToSellableStock: number
  quarantinedSellableOverage: number
  originPendingReceived: number
}

export function closureReturnSummary(row: DistClosureProductRow): ClosureReturnSummary {
  const precision = row.unitType === 'kg' ? 1000 : 100
  const roundQuantity = (value: number) => Math.round(value * precision) / precision
  const normal = roundQuantity(Math.max(0, Number(row.actualReturn) || 0))
  const recoverableMerma = roundQuantity(Math.max(0, Number(row.returnMerma) || 0))
  const totalApto = roundQuantity(normal + recoverableMerma)
  const originPendingReceived = roundQuantity(Math.max(0, Number(row.originPendingReceived) || 0))
  const recognized = Math.min(Math.max(0, Number(row.expectedReturn) || 0), totalApto)
  const returnsToSellableStock = roundQuantity(Math.max(0, recognized - originPendingReceived))
  return {
    normal,
    recoverableMerma,
    totalApto,
    nonSellable: Math.max(0, Number(row.returnWaste) || 0),
    returnsToSellableStock,
    quarantinedSellableOverage: roundQuantity(Math.max(0, totalApto - recognized)),
    originPendingReceived,
  }
}
