/**
 * Read subscriptions started by useDistributionData for each functional scope.
 * Keep these aligned with firestore.rules and test the role matrix directly.
 */
export interface DistributionSubscriptionScope {
  enabled: boolean
  routeId: string | null
  canReadFinance: boolean
  canManageCredits: boolean
  canManageCustomers: boolean
  canRegisterExpenses: boolean
}

export function getDistributionSubscriptionCollections(
  scope: DistributionSubscriptionScope,
): ReadonlySet<string> {
  if (!scope.enabled) return new Set()

  const collections = new Set([
    'supportConfig',
    'distLots',
    'distOperations',
    'distWarehouses',
    'distProducts',
    'distRoutes',
    'distBalances',
    'distDispatches',
    'distSales',
    'distExpenses',
    'distClosures',
  ])

  if (scope.canReadFinance) {
    collections.add('distCreditStatus')
    collections.add('distCreditOverrides')
    collections.add('distClaims')
    collections.add('distQrVerifications')
    collections.add('distReceivables')
    collections.add('distCollections')
  }
  if (scope.canManageCredits) collections.add('distReceivableAdjustments')
  if (scope.canManageCustomers) collections.add('distCustomers')
  if (scope.canRegisterExpenses) {
    collections.add('distExpenseCategories')
    collections.add('distExpenseGroups')
  }
  if (scope.routeId === null) {
    collections.add('distStockMovements')
    collections.add('distTransfers')
    collections.add('distAdjustmentRequests')
  }

  return collections
}

function dayKeyIndex(dayKey: string): number {
  const [y, m, d] = dayKey.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
}

/**
 * Normalizes movement dayKeys into minimal contiguous sorted ranges so separated
 * dates (e.g. a past closure date plus today) never create an unintended wide span
 * or duplicate listeners on today.
 */
export function normalizeMovementDayKeyGroups(dayKeys: readonly string[], todayKey?: string): string[][] {
  const unique = new Set<string>()
  for (const key of dayKeys) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(key)) unique.add(key)
  }
  if (todayKey && /^\d{4}-\d{2}-\d{2}$/.test(todayKey)) unique.add(todayKey)
  const sorted = [...unique].sort()
  if (sorted.length === 0) return []

  const groups: string[][] = [[sorted[0]]]
  let prevIndex = dayKeyIndex(sorted[0])
  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i]
    const index = dayKeyIndex(current)
    if (index === prevIndex + 1) groups[groups.length - 1].push(current)
    else groups.push([current])
    prevIndex = index
  }
  return groups
}
