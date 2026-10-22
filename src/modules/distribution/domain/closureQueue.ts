import type { DistClosure, DistDispatch } from '../types.ts'

export type ClosureQueueStage = 'undeclared' | 'awaiting_warehouse' | 'warehouse_confirmed' | 'closed'
export type ClosureQueueFilter = 'all' | ClosureQueueStage | 'reviewing_here' | 'differences'

export interface ClosureQueueItem {
  dispatch: DistDispatch | null
  closure: DistClosure | null
  stage: ClosureQueueStage
  hasDifferences: boolean
  hasPhysicalDifferences: boolean
  hasCashDifference: boolean
  hasMerma: boolean
  isReopened: boolean
  reviewStartedHere: boolean
  reviewedProductCount: number
  totalProductCount: number
}

const positive = (value: unknown) => (Number(value) || 0) > 0.001

function differenceFlags(closure: DistClosure | null) {
  const rows = closure?.products || []
  const hasPhysicalDifferences = rows.some(row =>
    Math.abs(Number(row.variance) || 0) > 0.001 || positive(row.shortage) || positive(row.overage),
  )
  const hasCashDifference = closure?.physicalCashDeclared != null && Math.abs(Number(closure.cashDifference) || 0) >= 0.01
  const hasMerma = rows.some(row => positive(row.returnMerma) || positive(row.returnWaste)) ||
    Object.values(closure?.declaredReturnMermas || {}).some(positive)
  return { hasPhysicalDifferences, hasCashDifference, hasMerma, hasDifferences: hasPhysicalDifferences || hasCashDifference }
}

export function boliviaDayKey(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const get = (type: string) => parts.find(part => part.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/**
 * Creates an operational queue from open dispatches plus closures finalized today.
 * Stage comes only from persisted milestones; local review is an additive hint.
 */
export function buildClosureQueue(
  dispatches: DistDispatch[],
  closures: DistClosure[],
  reviewedByDispatch: Record<string, string[]> = {},
  todayDayKey = '',
): ClosureQueueItem[] {
  const dispatchById = new Map(dispatches.map(dispatch => [dispatch.id, dispatch]))
  const relevantClosures = closures.filter(closure => {
    if (closure.closureType === 'admin') return false
    if (dispatchById.has(closure.dispatchId)) return true
    return closure.status === 'closed' && boliviaDayKey(closure.closedAt) === todayDayKey
  })
  const includedIds = new Set(relevantClosures.map(closure => closure.dispatchId))
  const dispatchOnly = dispatches.filter(dispatch => !includedIds.has(dispatch.id))
  const pairs: Array<{ dispatch: DistDispatch | null; closure: DistClosure | null }> = [
    ...relevantClosures.map(closure => ({ dispatch: dispatchById.get(closure.dispatchId) || null, closure })),
    ...dispatchOnly.map(dispatch => ({ dispatch, closure: null })),
  ]

  const items = pairs.map(({ dispatch, closure }) => {
    const id = closure?.dispatchId || dispatch?.id || ''
    const reviewedProductCount = new Set(reviewedByDispatch[id] || []).size
    const flags = differenceFlags(closure)
    let stage: ClosureQueueStage
    if (closure?.status === 'closed' || dispatch?.status === 'closed') stage = 'closed'
    else if (closure?.warehouseClosedBy || closure?.status === 'warehouse_done') stage = 'warehouse_confirmed'
    else if (closure?.returnDeclaredAt) stage = 'awaiting_warehouse'
    else stage = 'undeclared'

    return {
      dispatch,
      closure,
      stage,
      ...flags,
      isReopened: Boolean(closure?.reopenedAt || closure?.reopenReason || closure?.reopenHistory?.length || closure?.status === 'reopened'),
      reviewStartedHere: stage === 'awaiting_warehouse' && reviewedProductCount > 0,
      reviewedProductCount,
      totalProductCount: closure?.products?.length || dispatch?.lines?.length || 0,
    }
  })

  const priority: Record<ClosureQueueStage, number> = {
    awaiting_warehouse: 0,
    warehouse_confirmed: 1,
    undeclared: 2,
    closed: 3,
  }
  return items.sort((a, b) =>
    priority[a.stage] - priority[b.stage] ||
    (b.closure?.returnDeclaredAt || '').localeCompare(a.closure?.returnDeclaredAt || '') ||
    (b.closure?.closedAt || '').localeCompare(a.closure?.closedAt || '') ||
    (b.dispatch?.createdAt || '').localeCompare(a.dispatch?.createdAt || ''),
  )
}

export function filterClosureQueue(items: ClosureQueueItem[], filter: ClosureQueueFilter): ClosureQueueItem[] {
  if (filter === 'all') return items
  if (filter === 'differences') return items.filter(item => item.hasDifferences)
  if (filter === 'reviewing_here') return items.filter(item => item.reviewStartedHere)
  return items.filter(item => item.stage === filter)
}

export function closureQueueCounts(items: ClosureQueueItem[]) {
  return {
    undeclared: items.filter(item => item.stage === 'undeclared').length,
    awaitingWarehouse: items.filter(item => item.stage === 'awaiting_warehouse').length,
    warehouseConfirmed: items.filter(item => item.stage === 'warehouse_confirmed').length,
    closed: items.filter(item => item.stage === 'closed').length,
    reviewingHere: items.filter(item => item.reviewStartedHere).length,
    differences: items.filter(item => item.hasDifferences).length,
  }
}

/** Limit warehouse-visible queue entries to the assigned warehouse; admin sees all. */
export function filterClosureQueueForRole(
  items: ClosureQueueItem[],
  role: string,
  warehouseId?: string,
): ClosureQueueItem[] {
  if (role === 'admin') return items
  if (role !== 'warehouse') return []
  const assignedWarehouseId = warehouseId || 'central'
  return items.filter(item => (item.closure?.warehouseId || item.dispatch?.warehouseId || 'central') === assignedWarehouseId)
}
