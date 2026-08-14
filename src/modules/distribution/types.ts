/**
 * Modelo de datos de distribucion movil (businessType: 'mobile_distribution').
 *
 * Todo documento vive bajo restaurants/{restaurantId}/dist*  y lleva
 * restaurantId + branchId para respetar el multitenancy existente.
 */

/** kg = granel por peso, unit = pieza suelta, package = paquete/sachet cerrado */
export type UnitType = 'kg' | 'unit' | 'package'

export type PaymentKind = 'cash' | 'qr' | 'credit' | 'mixed'

export type SourceLocation = 'route' | 'centralWarehouse'

export type StockLocationKind = 'central' | 'route'

export type StockMovementType =
  | 'intake' // ingreso a almacen central
  | 'dispatch' // salida a ruta
  | 'dispatch_addition' // aumento de carga sobre despacho abierto
  | 'sale' // venta (descuenta ruta o central)
  | 'return' // retorno fisico de ruta a central
  | 'adjustment' // ajuste manual de almacen
  | 'shortage' // faltante detectado en conciliacion
  | 'overage' // sobrante detectado en conciliacion

export interface DistBaseDoc {
  id: string
  restaurantId: string
  branchId: string
  createdAt: string
  createdBy: string
  /** Clave de dia local YYYY-MM-DD, usada para consultas por rango */
  dayKey: string
  schemaVersion: number
}

export interface DistProduct {
  id: string
  name: string
  /** Presentacion o categoria comercial: "Al vacio", "Granel", ... */
  category: string
  presentation?: string
  unitType: UnitType
  referencePrice: number
  /** Peso aproximado por paquete/unidad. NO se usa para convertir reportes. */
  approximateWeightKg?: number
  active: boolean
  sortOrder: number
  restaurantId: string
  createdAt: string
  updatedAt?: string
}

export interface DistRoute {
  id: string
  name: string
  /** 'route' = ruta de distribuidor, 'direct' = venta directa / impulsacion */
  kind: 'route' | 'direct'
  active: boolean
  restaurantId: string
  createdAt: string
}

export interface DistCustomer {
  id: string
  name: string
  phone?: string
  address?: string
  routeId?: string
  notes?: string
  active: boolean
  restaurantId: string
  createdAt: string
  createdBy: string
  updatedAt?: string
}

/** Saldo cacheado por ubicacion. Se mantiene con increment() atomico. */
export interface DistBalance {
  id: string
  locationKind: StockLocationKind
  /** routeId cuando locationKind === 'route' */
  routeId?: string
  productId: string
  productName: string
  unitType: UnitType
  quantity: number
  restaurantId: string
  updatedAt: string
}

/** Ledger auditable e inmutable. El id es el operationId (idempotencia). */
export interface DistStockMovement extends DistBaseDoc {
  type: StockMovementType
  productId: string
  productName: string
  unitType: UnitType
  /** Cantidad positiva siempre; el signo lo dan centralDelta / routeDelta */
  quantity: number
  centralDelta: number
  routeDelta: number
  routeId?: string
  /** Documento que origino el movimiento (dispatchId, saleId, closureId) */
  refType?: 'dispatch' | 'sale' | 'closure' | 'manual'
  refId?: string
  note?: string
}

export interface DistDispatchLine {
  productId: string
  productName: string
  unitType: UnitType
  quantity: number
}

export interface DistDispatchAddition {
  id: string
  quantityByProduct: DistDispatchLine[]
  createdAt: string
  createdBy: string
  createdByName: string
  note?: string
}

export type DispatchStatus = 'open' | 'closed'

export interface DistDispatch extends DistBaseDoc {
  routeId: string
  routeName: string
  distributorUid: string
  distributorName: string
  status: DispatchStatus
  lines: DistDispatchLine[]
  additions: DistDispatchAddition[]
  observation?: string
  closedAt?: string
  closureId?: string
}

export interface DistSaleLine {
  productId: string
  productNameSnapshot: string
  quantity: number
  unitType: UnitType
  /** Precio realmente aplicado, congelado historicamente */
  actualUnitPrice: number
  subtotal: number
}

export interface DistSale extends DistBaseDoc {
  /** Igual a id. Explicito para trazabilidad de operaciones offline. */
  operationId: string
  sourceLocation: SourceLocation
  routeId: string
  routeName: string
  sellerUid: string
  sellerName: string
  dispatchId?: string
  customerId?: string
  customerName?: string
  lines: DistSaleLine[]
  total: number
  paymentKind: PaymentKind
  cashAmount: number
  qrAmount: number
  creditAmount: number
  note?: string
}

export type ReceivableStatus = 'OPEN' | 'PARTIAL' | 'PAID'

export interface DistReceivable extends DistBaseDoc {
  saleId: string
  customerId: string
  customerName: string
  routeId: string
  distributorUid: string
  distributorName: string
  originalAmount: number
  paidAmount: number
  balance: number
  status: ReceivableStatus
  note?: string
}

export interface DistCollection extends DistBaseDoc {
  operationId: string
  receivableId: string
  customerId: string
  customerName: string
  routeId: string
  collectedByUid: string
  collectedByName: string
  amount: number
  method: 'cash' | 'qr'
  note?: string
}

export interface DistExpense extends DistBaseDoc {
  operationId: string
  concept: string
  amount: number
  routeId: string
  routeName: string
  registeredByUid: string
  registeredByName: string
  note?: string
}

export interface DistClosureProductRow {
  productId: string
  productName: string
  unitType: UnitType
  initialDispatch: number
  additions: number
  totalLoaded: number
  sold: number
  expectedReturn: number
  actualReturn: number
  variance: number
}

export type ClosureStatus = 'draft' | 'warehouse_done' | 'closed' | 'reopened'

export interface DistClosure extends DistBaseDoc {
  dispatchId: string
  routeId: string
  routeName: string
  distributorUid: string
  distributorName: string
  status: ClosureStatus
  products: DistClosureProductRow[]
  cashSales: number
  qrSales: number
  creditGenerated: number
  cashCollections: number
  qrCollections: number
  cashExpenses: number
  expectedCash: number
  physicalCashDeclared: number
  cashDifference: number
  warehouseClosedBy?: string
  warehouseClosedAt?: string
  closedBy?: string
  closedAt?: string
  reopenedBy?: string
  reopenedAt?: string
  note?: string
}
