export type CategoryId = string

export type OrderStatus =
  | 'pending'
  | 'preparing'
  | 'ready'
  | 'ready_for_pickup'
  | 'ready_for_dispatch'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'

export type PaymentMethod = 'cash' | 'qr' | 'mixed'
export type OrderSource = 'local' | 'whatsapp'
export type FulfillmentType = 'table' | 'pickup' | 'delivery'
export type ProductAvailability = 'available' | 'soldout'
export type UserRole =
  | 'superadmin'
  | 'owner'
  | 'admin'
  | 'manager'
  | 'caja'
  | 'cocina'
  | 'pedidos'
  | 'delivery'
  | 'accountant'
  | 'readonly'
  // Roles de distribucion movil (businessType: 'mobile_distribution')
  | 'warehouse'
  | 'distributor'
  | 'support'

/**
 * Tipo de negocio del tenant. Determina que modulos, roles y experiencia
 * se renderizan. 'restaurant' es el valor por defecto/heredado: cualquier
 * tenant existente sin este campo se comporta exactamente como antes.
 */
export type BusinessType = 'restaurant' | 'mobile_distribution'

export type RepositoryConnectionMode = 'connected' | 'connecting' | 'local' | 'offline'

export interface RepositoryStatus {
  mode: RepositoryConnectionMode
  label: string
  detail: string
  source: 'firebase' | 'local'
  hasPendingWrites: boolean
  isOnline: boolean
}

/** Base interface for all tenant-scoped entities supporting versioning & soft deletes */
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

export interface Branch {
  id: string
  restaurantId: string
  name: string
  code: string
  address?: string
  phone?: string
  isActive: boolean
  isMain: boolean
  createdAt: string
}

export type Permission =
  | 'orders.create'
  | 'orders.edit'
  | 'orders.cancel'
  | 'orders.applyDiscount'
  | 'orders.reopen'
  | 'orders.viewAll'
  | 'payments.create'
  | 'payments.refund'
  | 'cash.open'
  | 'cash.close'
  | 'cash.openDrawer'
  | 'catalog.create'
  | 'catalog.edit'
  | 'catalog.delete'
  | 'inventory.view'
  | 'reports.view'
  | 'users.create'
  | 'settings.manage'
  | 'printers.manage'
  | 'branches.manage'
  | 'printing.manage'
  | 'printing.reprint'
  | 'printing.reprintReceipt'
  | 'printing.reprintKitchen'
  // --- Distribucion movil ---
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

export type PlanFeature =
  | 'pos'
  | 'tables'
  | 'delivery'
  | 'kitchenDisplay'
  | 'thermalPrinting'
  | 'advancedPrinting'
  | 'cashSessions'
  | 'inventory'
  | 'reports'
  | 'advancedReports'
  | 'multiBranch'
  | 'customRoles'
  | 'auditLogs'
  | 'customBranding'
  | 'offlineMode'

export interface RestaurantEntitlements {
  planId: string
  featureOverrides: Partial<Record<PlanFeature, boolean>>
  limitOverrides: {
    branches?: number | null
    users?: number | null
    printers?: number | null
    products?: number | null
    monthlyOrders?: number | null
  }
}

export interface RestaurantBranding {
  name: string
  /** Color de fondo/base de la marca (claro). Opcional. */
  surfaceColor?: string
  logoUrl?: string
  primaryColor?: string
  accentColor?: string
  receiptHeader?: string
  receiptFooter?: string
  tablesCount?: number
}

export interface RestaurantAccount {
  id: string
  name: string
  slug: string
  ownerUid: string
  createdAt: string
  plan: 'basic' | 'pro' | 'enterprise'
  branding: RestaurantBranding
  schemaVersion?: number
  /** Ausente == 'restaurant' (compatibilidad hacia atras) */
  businessType?: BusinessType
  currencyCode?: string
  currencySymbol?: string
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
  /** Ruta/canal asignado (solo roles de distribucion) */
  routeId?: string
  warehouseId?: string
}

export interface ProductExtra {
  id: string
  name: string
  price: number
}

export interface ProductOption {
  id: string
  label: string
}

export interface CatalogCategory extends Partial<TenantScopedEntity> {
  id: string
  name: string
  subtitle?: string
  emoji: string
  sortOrder: number
  isActive: boolean
  isVisible: boolean
}

export interface Product extends Partial<TenantScopedEntity> {
  id: string
  categoryId: CategoryId
  name: string
  description?: string
  price: number
  image: string
  badge?: string
  availability: ProductAvailability
  sortOrder: number
  isActive: boolean
  isVisible: boolean
  extras?: ProductExtra[]
  options?: ProductOption[]
}

export interface CatalogState {
  categories: CatalogCategory[]
  products: Product[]
  quickExtras?: ProductExtra[]
  lastUpdatedAt: number
}

export interface CatalogCategoryInput {
  name: string
  subtitle?: string
  emoji: string
}

export interface CatalogProductInput {
  categoryId: string
  name: string
  description?: string
  price: number
  image: string
  badge?: string
  extras?: ProductExtra[]
  options?: ProductOption[]
}

export interface CartItemModifier {
  extras: ProductExtra[]
  options: string[]
  note: string
}

export interface CartItem {
  lineId: string
  productId: string
  quantity: number
  modifiers: CartItemModifier
}

export interface PaymentSummary {
  method: PaymentMethod
  cashAmount: number
  qrAmount: number
  cashReceived: number
  change: number
}

/** Immutable snapshot of a sold item capturing exact prices, names, and modifier costs at purchase time */
export interface OrderItemSnapshot {
  productId?: string
  name: string
  printName?: string
  categoryName?: string
  basePrice: number
  quantity: number
  modifiers: CartItemModifier
  extrasTotal?: number
  unitPriceWithModifiers?: number
  lineTotal: number
  discountAmount?: number
  taxAmount?: number
}

/** Immutable financial snapshot attached to every historical order */
export interface OrderFinancialSnapshot {
  snapshottedAt: string
  productSubtotal: number
  discountTotal: number
  taxTotal: number
  deliveryFee: number
  grandTotal: number
  currency: string
}

export interface OrderItem extends OrderItemSnapshot {
  id: string
}

export interface Order extends Partial<TenantScopedEntity> {
  /** Internal unique UUID */
  id: string
  sequence: number
  /** User-visible order/ticket number (customizable per tenant/branch) */
  displayNumber: string
  createdAt: string
  readyAt?: string
  deliveredAt?: string
  cancelledAt?: string
  cancelledBy?: string
  cancelledReason?: string
  status: OrderStatus
  estimatedDelay?: number
  items: OrderItem[]
  total: number
  productSubtotal?: number
  deliveryFee?: number
  deliveryDistanceKm?: number | null
  deliveryQuoteStatus?: 'not_needed' | 'quoted' | 'missing_location' | 'manual_review'
  deliveryQuoteNote?: string
  payment: PaymentSummary
  paymentStatus: 'paid' | 'pending' | 'gift'
  paymentMethod: PaymentMethod | null
  expectedPaymentMethod: PaymentMethod | null
  qrProofReceived?: boolean
  paymentReviewNote?: string
  suppressWhatsappDispatchNotice?: boolean
  forceWhatsappDispatchNotice?: boolean
  paidAt?: string
  paidBy?: string
  orderSource: OrderSource
  fulfillmentType: FulfillmentType
  /** @deprecated Use fulfillmentType instead. Kept for backward compat reads. */
  orderType?: 'table' | 'delivery'
  tableInfo?: string
  customerName?: string
  customerPhone?: string
  deliveryAddress?: string
  createdBy?: string
  dayKey?: string
  whatsappChatId?: string
  /** Frozen historical financial snapshot */
  financialSnapshot?: OrderFinancialSnapshot
}

export interface CreateOrderInput {
  items: OrderItem[]
  total: number
  payment: PaymentSummary
  paymentStatus: 'paid' | 'pending' | 'gift'
  paymentMethod: PaymentMethod | null
  expectedPaymentMethod: PaymentMethod | null
  orderSource: OrderSource
  fulfillmentType: FulfillmentType
  tableInfo?: string
  customerName?: string
  customerPhone?: string
  deliveryAddress?: string
  createdBy?: string
  suppressWhatsappDispatchNotice?: boolean
  forceWhatsappDispatchNotice?: boolean
  financialSnapshot?: OrderFinancialSnapshot
}

export interface ConfirmPaymentInput {
  paymentStatus: 'paid'
  paymentMethod: PaymentMethod
  payment: PaymentSummary
  paidBy: string
}

export interface AppState {
  orders: Order[]
  sequence: number
  lastUpdatedAt: number
}
