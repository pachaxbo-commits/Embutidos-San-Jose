import type { BusinessType, Permission, UserRole } from '../types'

/**
 * Registro central de tipos de empresa.
 *
 * Toda decision de "que ve este tenant" sale de aqui: no debe haber
 * condicionales dispersos por email, nombre de empresa ni id hardcodeado.
 * Un tenant sin `businessType` se resuelve como 'restaurant', por lo que
 * los tenants existentes no cambian de comportamiento.
 */

export type ModuleId =
  // Restaurante (existente)
  | 'caja'
  | 'cocina'
  | 'historial'
  | 'admin'
  | 'bot'
  // Distribucion movil
  | 'dist.dashboard'
  | 'dist.inventory'
  | 'dist.dispatches'
  | 'dist.sales'
  | 'dist.credits'
  | 'dist.collections'
  | 'dist.customers'
  | 'dist.expenses'
  | 'dist.closure'
  | 'dist.reports'
  | 'dist.users'
  | 'dist.products'
  // Transversales
  | 'printer-settings'
  | 'printer-diagnostic'
  | 'cash-session'

export interface ModuleDefinition {
  id: ModuleId
  label: string
  /** Permiso minimo requerido para ver el modulo */
  requiredPermission?: Permission
}

export interface BusinessTypeTheme {
  /** Color principal de marca */
  primary: string
  primaryHover: string
  primarySoft: string
  /** Color de acento */
  accent: string
  accentSoft: string
  /** Fondo base de la aplicacion (siempre claro) */
  background: string
  surface: string
}

export interface BusinessTypeDefinition {
  id: BusinessType
  label: string
  /** Modulos disponibles para el tipo de empresa, en orden de navegacion */
  modules: ModuleDefinition[]
  /** Roles que tienen sentido para este tipo de empresa */
  roles: UserRole[]
  defaultCurrencyCode: string
  defaultCurrencySymbol: string
  theme: BusinessTypeTheme
}

const RESTAURANT: BusinessTypeDefinition = {
  id: 'restaurant',
  label: 'Restaurante',
  modules: [
    { id: 'caja', label: 'Caja' },
    { id: 'cocina', label: 'Cocina' },
    { id: 'historial', label: 'Historial' },
    { id: 'admin', label: 'Admin' },
    { id: 'bot', label: 'Bot' },
    { id: 'printer-settings', label: 'Impresoras' },
    { id: 'printer-diagnostic', label: 'Diagnostico' },
    { id: 'cash-session', label: 'Caja & Turnos' },
  ],
  roles: ['admin', 'caja', 'cocina', 'pedidos'],
  defaultCurrencyCode: 'BOB',
  defaultCurrencySymbol: 'Bs',
  theme: {
    primary: '#2563EB',
    primaryHover: '#1D4ED8',
    primarySoft: '#EAF2FF',
    accent: '#0EA5A8',
    accentSoft: '#E6F7F7',
    background: '#F6F8FC',
    surface: '#FFFFFF',
  },
}

const MOBILE_DISTRIBUTION: BusinessTypeDefinition = {
  id: 'mobile_distribution',
  label: 'Distribucion movil',
  modules: [
    { id: 'dist.dashboard', label: 'Inicio', requiredPermission: 'dist.dashboard.view' },
    { id: 'dist.sales', label: 'Vender', requiredPermission: 'dist.sale.create' },
    { id: 'dist.inventory', label: 'Inventario', requiredPermission: 'dist.inventory.view' },
    { id: 'dist.dispatches', label: 'Despachos', requiredPermission: 'dist.dispatch.create' },
    { id: 'dist.credits', label: 'Creditos', requiredPermission: 'dist.credit.view' },
    { id: 'dist.collections', label: 'Cobros', requiredPermission: 'dist.collection.create' },
    { id: 'dist.customers', label: 'Clientes', requiredPermission: 'dist.customer.manage' },
    { id: 'dist.expenses', label: 'Gastos', requiredPermission: 'dist.expense.create' },
    { id: 'dist.closure', label: 'Cierre', requiredPermission: 'dist.closure.money' },
    { id: 'dist.products', label: 'Productos', requiredPermission: 'dist.products.manage' },
    { id: 'dist.reports', label: 'Reportes', requiredPermission: 'dist.reports.view' },
    { id: 'dist.users', label: 'Usuarios', requiredPermission: 'dist.users.manage' },
    { id: 'printer-settings', label: 'Impresoras' },
  ],
  roles: ['admin', 'warehouse', 'distributor'],
  defaultCurrencyCode: 'BOB',
  defaultCurrencySymbol: 'Bs',
  theme: {
    // Rojo San Jose sobre base clara/crema. Nunca fondos negros.
    primary: '#C1121F',
    primaryHover: '#9D0E19',
    primarySoft: '#FDECEE',
    accent: '#F2B705',
    accentSoft: '#FFF6DA',
    background: '#FAF7F2',
    surface: '#FFFFFF',
  },
}

const REGISTRY: Record<BusinessType, BusinessTypeDefinition> = {
  restaurant: RESTAURANT,
  mobile_distribution: MOBILE_DISTRIBUTION,
}

export function resolveBusinessType(value?: string | null): BusinessType {
  return value === 'mobile_distribution' ? 'mobile_distribution' : 'restaurant'
}

export function getBusinessTypeDefinition(value?: BusinessType | string | null): BusinessTypeDefinition {
  return REGISTRY[resolveBusinessType(typeof value === 'string' ? value : value ?? null)]
}

/** Modulos visibles para un rol concreto dentro de un tipo de empresa */
export function getVisibleModules(
  businessType: BusinessType | string | null | undefined,
  can: (permission: Permission) => boolean,
): ModuleDefinition[] {
  return getBusinessTypeDefinition(businessType).modules.filter(
    (module) => !module.requiredPermission || can(module.requiredPermission),
  )
}
