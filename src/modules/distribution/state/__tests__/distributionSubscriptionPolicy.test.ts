import { hasPermission } from '../../../../services/permissionService.ts'
import { getDistributionSubscriptionCollections } from '../distributionSubscriptionPolicy.ts'
import type { Permission, UserRole } from '../../../../types.ts'

const roleScope = (role: UserRole) => {
  const can = (permission: Permission) => hasPermission(role, permission)
  return {
    enabled: role !== 'support',
    routeId: role === 'distributor' ? 'route-test' : null,
    canReadFinance: can('dist.credit.view') || can('dist.credit.viewAll'),
    canManageCredits: can('dist.credit.adjust'),
    canManageCustomers: can('dist.customer.manage'),
    canRegisterExpenses: can('dist.expense.create'),
  }
}

const expectedByRole: Record<UserRole, string[]> = {
  admin: [
    'supportConfig', 'distLots', 'distOperations', 'distWarehouses', 'distProducts', 'distRoutes',
    'distBalances', 'distDispatches', 'distSales', 'distExpenses', 'distClosures',
    'distCreditStatus', 'distCreditOverrides', 'distClaims', 'distQrVerifications',
    'distReceivables', 'distCollections', 'distReceivableAdjustments', 'distCustomers',
    'distExpenseCategories', 'distExpenseGroups', 'distStockMovements', 'distTransfers', 'distAdjustmentRequests',
  ],
  warehouse: [
    'supportConfig', 'distLots', 'distOperations', 'distWarehouses', 'distProducts', 'distRoutes',
    'distBalances', 'distDispatches', 'distSales', 'distExpenses', 'distClosures',
    'distStockMovements', 'distTransfers', 'distAdjustmentRequests',
  ],
  distributor: [
    'supportConfig', 'distLots', 'distOperations', 'distWarehouses', 'distProducts', 'distRoutes',
    'distBalances', 'distDispatches', 'distSales', 'distExpenses', 'distClosures',
    'distCreditStatus', 'distCreditOverrides', 'distClaims', 'distQrVerifications',
    'distReceivables', 'distCollections', 'distCustomers', 'distExpenseCategories', 'distExpenseGroups',
  ],
  support: [],
}

for (const role of ['admin', 'warehouse', 'distributor', 'support'] as const) {
  const actual = [...getDistributionSubscriptionCollections(roleScope(role))].sort()
  assertEqual(actual.join(','), [...expectedByRole[role]].sort().join(','), `${role}: solo se suscriben colecciones previstas por sus permisos y Rules`)
}

const warehouseSubscriptions = getDistributionSubscriptionCollections(roleScope('warehouse'))
for (const forbidden of [
  'distCreditOverrides', 'distCreditStatus', 'distReceivables', 'distReceivableAdjustments',
  'distClaims', 'distQrVerifications', 'distCollections', 'distCustomers', 'distExpenseCategories',
]) {
  assertEqual(warehouseSubscriptions.has(forbidden), false, `Almacén no inicia listener de ${forbidden}`)
}
for (const required of [
  'distProducts', 'distLots', 'distBalances', 'distRoutes', 'distWarehouses', 'distDispatches',
  'distSales', 'distExpenses', 'distClosures', 'distStockMovements', 'distTransfers',
  'distAdjustmentRequests', 'distOperations',
]) {
  assertEqual(warehouseSubscriptions.has(required), true, `Almacén conserva listener autorizado de ${required}`)
}

console.log('PASS matriz de suscripciones y permisos: Administración, Almacén, Distribuidor y Soporte')

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) throw new Error(`${message}: esperado ${String(expected)}, recibido ${String(actual)}`)
}
