import type { DistClosure } from '../types.ts'
import { toDayKey } from './engine.ts'

export function closureHistoryOwnerKey(closure: Pick<DistClosure, 'routeId' | 'distributorUid'>): string {
  return `${closure.routeId}\u001f${closure.distributorUid}`
}

export function closureOperationalDayKey(closure: DistClosure): string {
  if (closure.dayKey) return closure.dayKey
  const timestamp = closure.returnDeclaredAt || closure.warehouseClosedAt || closure.closedAt || closure.createdAt
  return timestamp ? toDayKey(new Date(timestamp)) : ''
}

/** Filtra por la jornada operativa; las reaperturas no mueven cierres de día. */
export function filterClosureHistory(
  closures: DistClosure[],
  dayKeys: string[],
  ownerKey = '',
): DistClosure[] {
  const days = new Set(dayKeys)
  return closures.filter((closure) =>
    days.has(closureOperationalDayKey(closure)) &&
    (!ownerKey || closureHistoryOwnerKey(closure) === ownerKey),
  )
}

export function visibleClosureHistory<T>(items: T[], limit: number): T[] {
  return items.slice(0, Math.max(0, limit))
}
