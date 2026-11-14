import { hasPermission } from '../../../../services/permissionService.ts'
import { getDistributionSubscriptionCollections, normalizeMovementDayKeyGroups } from '../distributionSubscriptionPolicy.ts'
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

assertEqual(
  JSON.stringify(normalizeMovementDayKeyGroups(['2026-11-14'], '2026-11-14')),
  JSON.stringify([['2026-11-14']]),
  '1 día igual a hoy no debe duplicar la jornada',
)
assertEqual(
  JSON.stringify(normalizeMovementDayKeyGroups(['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'], '2026-11-14')),
  JSON.stringify([['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14']]),
  'Un rango contiguo terminado ayer más hoy se fusiona en una única ventana',
)
assertEqual(
  JSON.stringify(normalizeMovementDayKeyGroups(['2026-10-15'], '2026-11-14')),
  JSON.stringify([['2026-10-15'], ['2026-11-14']]),
  'Un día histórico separado de hoy no debe abrir un rango completo de 30 días',
)

console.log('PASS matriz de suscripciones y permisos: Administración, Almacén, Distribuidor y Soporte')

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) throw new Error(`${message}: esperado ${String(expected)}, recibido ${String(actual)}`)
}
