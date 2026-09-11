import type { Permission, PlanFeature, UserRole } from '../types'

export interface AuthorizationQuery {
  permission: Permission
  userRole?: UserRole | null
  userCustomPermissions?: Permission[]
  requiredPlanFeature?: PlanFeature
  planFeatures?: Partial<Record<PlanFeature, boolean>>
  restaurantFeatureOverrides?: Partial<Record<string, boolean>>
  isSubscriptionActive?: boolean
}

export interface AuthorizationResult {
  allowed: boolean
  reason?: string
}

/**
 * Paquetes de permisos de distribucion movil.
 * Se componen dentro de ROLE_PERMISSIONS_MAP para no duplicar listas largas.
 */
const DIST_ADMIN_PERMISSIONS: Permission[] = [
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
]

const DIST_WAREHOUSE_PERMISSIONS: Permission[] = [
  'dist.dashboard.view',
  'dist.inventory.view',
  'dist.inventory.adjust',
  'dist.dispatch.create',
  'dist.dispatch.addLoad',
  'dist.return.register',
  'dist.closure.warehouse',
]

const DIST_DISTRIBUTOR_PERMISSIONS: Permission[] = [
  'dist.dashboard.view',
  'dist.inventory.view',
  'dist.sale.create',
  'dist.credit.view',
  'dist.collection.create',
  'dist.customer.manage',
  'dist.expense.create',
  'dist.closure.money',
]

const DIST_SUPPORT_PERMISSIONS: Permission[] = [
  'settings.manage',
  'printers.manage',
  'printing.manage',
  'support.settings.manage',
  'support.reset.prepare',
]

/** Role permissions matrix defining default permissions assigned to each role */
export const ROLE_PERMISSIONS_MAP: Record<UserRole, Permission[]> = {
  superadmin: [
    'orders.create',
    'orders.edit',
    'orders.cancel',
    'orders.applyDiscount',
    'orders.reopen',
    'orders.viewAll',
    'payments.create',
    'payments.refund',
    'cash.open',
    'cash.close',
    'catalog.create',
    'catalog.edit',
    'catalog.delete',
    'inventory.view',
    'reports.view',
    'users.create',
    'settings.manage',
    'printers.manage',
    'branches.manage',
    ...DIST_ADMIN_PERMISSIONS,
  ],
  owner: [
    'orders.create',
    'orders.edit',
    'orders.cancel',
    'orders.applyDiscount',
    'orders.reopen',
    'orders.viewAll',
    'payments.create',
    'payments.refund',
    'cash.open',
    'cash.close',
    'catalog.create',
    'catalog.edit',
    'catalog.delete',
    'inventory.view',
    'reports.view',
    'users.create',
    'settings.manage',
    'printers.manage',
    'branches.manage',
    ...DIST_ADMIN_PERMISSIONS,
  ],
  admin: [
    'orders.create',
    'orders.edit',
    'orders.cancel',
    'orders.applyDiscount',
    'orders.reopen',
    'orders.viewAll',
    'payments.create',
    'payments.refund',
    'cash.open',
    'cash.close',
    'catalog.create',
    'catalog.edit',
    'catalog.delete',
    'inventory.view',
    'reports.view',
    'users.create',
    'settings.manage',
    'printers.manage',
    'branches.manage',
    'printing.manage',
    'printing.reprint',
    'printing.reprintReceipt',
    'printing.reprintKitchen',
    'cash.openDrawer',
    ...DIST_ADMIN_PERMISSIONS,
  ],
  manager: [
    'orders.create',
    'orders.edit',
    'orders.cancel',
    'orders.applyDiscount',
    'orders.reopen',
    'orders.viewAll',
    'payments.create',
    'payments.refund',
    'cash.open',
    'cash.close',
    'catalog.create',
    'catalog.edit',
    'inventory.view',
    'reports.view',
    'printers.manage',
    'printing.manage',
    'printing.reprint',
    'printing.reprintReceipt',
    'printing.reprintKitchen',
    'cash.openDrawer',
  ],
  caja: [
    'orders.create',
    'orders.edit',
    'orders.cancel',
    'orders.applyDiscount',
    'orders.viewAll',
    'payments.create',
    'cash.open',
    'cash.close',
    'printers.manage',
    'printing.reprint',
    'printing.reprintReceipt',
    'cash.openDrawer',
  ],
  cocina: ['orders.viewAll'],
  pedidos: ['orders.create', 'orders.edit', 'orders.viewAll'],
  delivery: ['orders.viewAll'],
  accountant: ['reports.view', 'cash.open', 'cash.close', ...DIST_ADMIN_PERMISSIONS],
  readonly: ['reports.view'],
  warehouse: DIST_WAREHOUSE_PERMISSIONS,
  distributor: DIST_DISTRIBUTOR_PERMISSIONS,
  support: DIST_SUPPORT_PERMISSIONS,
}

export function getRoleDefaultPermissions(role: UserRole): Permission[] {
  return ROLE_PERMISSIONS_MAP[role] || []
}

/**
 * Multi-factor authorization evaluator pipeline:
 * Evaluates Role, Custom Permissions, Subscription Status, Plan Features, and Feature Overrides.
 */
export function evaluateAuthorization(query: AuthorizationQuery): AuthorizationResult {
  const {
    permission,
    userRole,
    userCustomPermissions,
    requiredPlanFeature,
    planFeatures,
    restaurantFeatureOverrides,
    isSubscriptionActive = true,
  } = query

  // 1. Subscription active check
  if (!isSubscriptionActive) {
    return { allowed: false, reason: 'La suscripcion del restaurante esta inactiva o suspendida.' }
  }

  // 2. Superadmin & Owner bypass
  if (userRole === 'superadmin' || userRole === 'owner') {
    return { allowed: true }
  }

  // 3. Plan feature check if specified
  if (requiredPlanFeature) {
    const isOverrideEnabled = restaurantFeatureOverrides?.[requiredPlanFeature]
    const isPlanEnabled = planFeatures?.[requiredPlanFeature]

    if (isOverrideEnabled === false) {
      return { allowed: false, reason: `La funcion '${requiredPlanFeature}' fue desactivada para este restaurante.` }
    }

    if (!isOverrideEnabled && isPlanEnabled === false) {
      return { allowed: false, reason: `Tu plan actual no incluye la funcion '${requiredPlanFeature}'.` }
    }
  }

  // 4. User permission grant check
  if (!userRole) {
    return { allowed: false, reason: 'No se especifico el rol del usuario.' }
  }

  const permissions = userCustomPermissions && userCustomPermissions.length > 0
    ? userCustomPermissions
    : getRoleDefaultPermissions(userRole)

  if (permissions.includes(permission)) {
    return { allowed: true }
  }

  return { allowed: false, reason: `El usuario no tiene el permiso '${permission}'.` }
}

/** Backward-compatible helper wrapper around evaluateAuthorization */
export function hasPermission(
  role: UserRole | null | undefined,
  permission: Permission,
  customPermissions?: Permission[]
): boolean {
  return evaluateAuthorization({
    permission,
    userRole: role,
    userCustomPermissions: customPermissions,
  }).allowed
}
