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
