/** Roles existentes en la aplicación de Embutidos San José. */
export type UserRole = 'admin' | 'warehouse' | 'distributor' | 'support'

export type Permission =
  | 'dist.dashboard.view'
  | 'dist.products.manage'
  | 'dist.inventory.view'
  | 'dist.inventory.adjust'
  | 'dist.dispatch.create'
  | 'dist.dispatch.addLoad'
  | 'dist.return.register'
  | 'dist.sale.create'
  | 'dist.sale.fromCentral'
  | 'dist.credit.view'
  | 'dist.credit.viewAll'
  | 'dist.collection.create'
  | 'dist.customer.manage'
  | 'dist.expense.create'
  | 'dist.closure.money'
  | 'dist.closure.warehouse'
  | 'dist.reports.view'
  | 'dist.users.manage'
  | 'support.settings.manage'
  | 'support.reset.prepare'

/** Datos compartidos por los documentos que pertenecen a San José. */
export interface TenantScopedEntity {
  schemaVersion: number
  restaurantId: string
  branchId: string
  createdAt: string
  updatedAt?: string
  createdBy?: string
  updatedBy?: string
  deletedAt?: string
  deletedBy?: string
  isDeleted?: boolean
}

export interface RestaurantMember {
  passwordChangedAt?: string
  passwordChangedBy?: string
  uid: string
  email: string
  displayName: string
  role: UserRole
  active: boolean
  permissions?: Permission[]
  createdAt?: string
  restaurantId?: string
  branchId?: string
  routeId?: string
  warehouseId?: string
}
