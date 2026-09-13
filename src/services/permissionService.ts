import type { Permission, UserRole } from '../types'

const ADMIN_PERMISSIONS: Permission[] = [
  'dist.dashboard.view',
  'dist.products.manage',
  'dist.inventory.view',
  'dist.inventory.adjust',
  'dist.dispatch.create',
  'dist.dispatch.addLoad',
  'dist.return.register',
  'dist.sale.create',
  'dist.sale.fromCentral',
  'dist.credit.view',
  'dist.credit.viewAll',
  'dist.collection.create',
  'dist.customer.manage',
  'dist.expense.create',
  'dist.closure.money',
  'dist.closure.warehouse',
  'dist.reports.view',
  'dist.users.manage',
  'support.settings.manage',
]

export const ROLE_PERMISSIONS_MAP: Record<UserRole, Permission[]> = {
  admin: ADMIN_PERMISSIONS,
  warehouse: [
    'dist.dashboard.view',
    'dist.inventory.view',
    'dist.inventory.adjust',
    'dist.dispatch.create',
    'dist.dispatch.addLoad',
    'dist.return.register',
    'dist.closure.warehouse',
  ],
  distributor: [
    'dist.dashboard.view',
    'dist.inventory.view',
    'dist.sale.create',
    'dist.credit.view',
    'dist.collection.create',
    'dist.customer.manage',
    'dist.expense.create',
    'dist.closure.money',
  ],
  support: [
    'support.settings.manage',
    'support.reset.prepare',
  ],
}

export function getRoleDefaultPermissions(role: UserRole): Permission[] {
  return ROLE_PERMISSIONS_MAP[role] ?? []
}

export function hasPermission(
  role: UserRole | null | undefined,
  permission: Permission,
  customPermissions?: Permission[],
): boolean {
  if (!role) return false
  const permissions = customPermissions?.length ? customPermissions : getRoleDefaultPermissions(role)
  return permissions.includes(permission)
}
