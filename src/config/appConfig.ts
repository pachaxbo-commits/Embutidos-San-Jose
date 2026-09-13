import type { Permission, UserRole } from '../types'

export type ModuleId =
  | 'dist.claims' | 'dist.qr' | 'dist.warehouses' | 'dist.dashboard'
  | 'dist.inventory' | 'dist.dispatches' | 'dist.sales' | 'dist.credits'
  | 'dist.collections' | 'dist.customers' | 'dist.expenses' | 'dist.closure'
  | 'dist.reports' | 'dist.users' | 'dist.products' | 'dist.support'
  | 'printer-settings'

export interface ModuleDefinition {
  id: ModuleId
  label: string
  requiredPermission?: Permission
  anyOfPermissions?: Permission[]
  navigableBy?: UserRole[]
}

export interface AppTheme {
  primary: string
  primaryHover: string
  primarySoft: string
  accent: string
  accentSoft: string
  background: string
  surface: string
}

export const SAN_JOSE_APP_CONFIG = {
  modules: [
    { id: 'dist.dashboard', label: 'Inicio', requiredPermission: 'dist.dashboard.view' },
    { id: 'dist.sales', label: 'Vender', requiredPermission: 'dist.sale.create' },
    { id: 'dist.credits', label: 'Creditos', requiredPermission: 'dist.credit.view' },
    { id: 'dist.expenses', label: 'Gastos', requiredPermission: 'dist.expense.create' },
    { id: 'dist.closure', label: 'Cierre', anyOfPermissions: ['dist.closure.money', 'dist.closure.warehouse'] },
    { id: 'dist.inventory', label: 'Inventario', requiredPermission: 'dist.inventory.view', navigableBy: ['admin', 'warehouse'] },
    { id: 'dist.dispatches', label: 'Despachos', requiredPermission: 'dist.dispatch.create' },
    { id: 'dist.collections', label: 'Cobros', requiredPermission: 'dist.collection.create', navigableBy: ['admin'] },
    { id: 'dist.customers', label: 'Clientes', requiredPermission: 'dist.customer.manage', navigableBy: ['admin'] },
    { id: 'dist.products', label: 'Productos', requiredPermission: 'dist.products.manage' },
    { id: 'dist.reports', label: 'Reportes', requiredPermission: 'dist.reports.view' },
    { id: 'dist.users', label: 'Usuarios', requiredPermission: 'dist.users.manage' },
    { id: 'dist.support', label: 'Configuración', requiredPermission: 'support.settings.manage', navigableBy: ['admin', 'support'] },
    { id: 'dist.claims', label: 'Cambios y devoluciones', requiredPermission: 'dist.users.manage' },
    { id: 'dist.qr', label: 'Verificar QR', requiredPermission: 'dist.users.manage' },
    { id: 'dist.warehouses', label: 'Almacenes', requiredPermission: 'dist.dispatch.create' },
    { id: 'printer-settings', label: 'Impresoras', navigableBy: ['admin', 'distributor', 'support'] },
  ] as ModuleDefinition[],
  roles: ['admin', 'warehouse', 'distributor', 'support'] as UserRole[],
  currencyCode: 'BOB',
  currencySymbol: 'Bs',
  theme: {
    primary: '#C1121F', primaryHover: '#9D0E19', primarySoft: '#FDECEE',
    accent: '#F2B705', accentSoft: '#FFF6DA', background: '#FAF7F2', surface: '#FFFFFF',
  } satisfies AppTheme,
}

export function getVisibleModules(
  can: (permission: Permission) => boolean,
  role?: UserRole | null,
): ModuleDefinition[] {
  return SAN_JOSE_APP_CONFIG.modules.filter((module) => {
    if (module.requiredPermission && !can(module.requiredPermission)) return false
    if (module.anyOfPermissions && !module.anyOfPermissions.some((permission) => can(permission))) return false
    if (module.navigableBy && role && !module.navigableBy.includes(role)) return false
    return true
  })
}
