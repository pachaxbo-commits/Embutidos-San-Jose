/**
 * Modelo de datos operativo de Embutidos San José.
 *
 * Los documentos conservan `restaurantId` y `branchId` como claves técnicas
 * compatibles con la base de datos existente. En esta aplicación,
 * `restaurantId` siempre identifica a San José.
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
  | 'sale_correction'
  | 'return' // retorno fisico de ruta a central
  | 'adjustment' // ajuste manual de almacen
  | 'dispatch_correction' // correccion auditada de despacho o aumento
  | 'shortage' // faltante detectado en conciliacion
  | 'overage' // sobrante detectado en conciliacion

export interface DistBaseDoc {
  pendingConfirmation?: boolean
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
  deleted?: boolean
  deletedAt?: string
  deletedBy?: string
  id: string
  name: string
  /** Fotografía optimizada opcional para catálogo y selección operativa. */
  photoDataUrl?: string
  /** Presentacion o categoria comercial: "Al vacio", "Granel", ... */
  category: string
  presentation?: string
  /** Descripción comercial opcional, congelada en cada venta futura. */
  description?: string
  unitType: UnitType
  productionCost?: number
  minimumStock?: number
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
  photoDataUrl?: string
  addressReference?: string
  customerCode?: string
  identityNumber?: string
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
  availableQuantity?: number
  warehouseId?: string
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

export interface DistAdjustmentRequest extends DistBaseDoc {
  productId: string
  productName: string
  unitType: UnitType
  quantity: number
  warehouseId: string
  lotId?: string
  note: string
  requestedByUid: string
  requestedByName: string
  status: 'pending' | 'approved' | 'rejected'
  reviewedBy?: string
  reviewedAt?: string
}

/** Ledger auditable e inmutable. El id es el operationId (idempotencia). */
export interface DistStockMovement extends DistBaseDoc {
  responsibleName?: string
  responsibleRole?: 'admin' | 'warehouse' | 'distributor'
  lotCode?: string
  lossCost?: number | null
  type: StockMovementType
  productId: string
  productName: string
  unitType: UnitType
  /** Cantidad positiva siempre; el signo lo dan centralDelta / routeDelta */
  quantity: number
  centralDelta: number
  routeDelta: number
  fromLocation?: string
  toLocation?: string
  routeId?: string
  /** Documento que origino el movimiento (dispatchId, saleId, closureId) */
  refType?: 'dispatch' | 'sale' | 'closure' | 'manual'
  refId?: string
  note?: string
}

export interface DistDispatchLine {
  lotCode?: string
  manufacturedOn?: string
  expiresOn?: string
  lotId?: string
  productId: string
  productName: string
  unitType: UnitType
  quantity: number
  /** Selección explícita solicitada por el operador; el servidor vuelve a validarla. */
  allocationsRequested?: Array<{ lotId: string; quantity: number }>
  allocations?: DistLotAllocation[]
}

export interface DistLotAllocation {
  lotId: string
  lotCode: string
  expiresOn: string
  quantity: number
  productionCost: number | null
}

export interface DistDispatchAddition {
  id: string
  quantityByProduct: DistDispatchLine[]
  createdAt: string
  createdBy: string
  createdByName: string
  note?: string
  warehouseResponsibleName?: string
  voided?: boolean
  voidedAt?: string
  voidedBy?: string
  voidReason?: string
}

export interface DistDispatchCorrection {
  id: string
  operationId: string
  targetType: 'initial' | 'addition'
  additionId?: string
  productId: string
  productName: string
  oldQuantity: number
  newQuantity: number
  returnedQuantity?: number
  addedQuantity?: number
  unitType: UnitType
  lotCode?: string
  lotId?: string
  reason: string
  correctedBy: string
  correctedByName: string
  correctedAt: string
}

export type DispatchStatus = 'open' | 'closed'

export interface DistDispatch extends DistBaseDoc {
  warehouseId?: string
  routeId: string
  routeName: string
  distributorUid: string
  distributorName: string
  status: DispatchStatus
  lines: DistDispatchLine[]
  additions: DistDispatchAddition[]
  corrections?: DistDispatchCorrection[]
  observation?: string
  closedAt?: string
  closureId?: string
  warehouseResponsibleName?: string
}

export interface DistSaleLine {
  costTotal?: number | null
  allocations?: { lotId: string; lotCode: string; expiresOn: string; quantity: number; productionCost: number | null }[]
  productId: string
  productNameSnapshot: string
  presentationSnapshot?: string
  descriptionSnapshot?: string
  quantity: number
  unitType: UnitType
  /** Precio realmente aplicado, congelado historicamente */
  actualUnitPrice: number
  /** Precio oficial vigente al vender; permite auditar descuentos promocionales. */
  referenceUnitPrice?: number
  isPromotional?: boolean
  subtotal: number
}

export interface DistSale extends DistBaseDoc {
  pendingConfirmation?: boolean
  customerCode?: string
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
  linesProductIds?: string[]
  total: number
  paymentKind: PaymentKind
  cashAmount: number
  qrAmount: number
  creditAmount: number
  cashReceived?: number
  changeAmount?: number
  note?: string
  /** La venta original no se reemplaza: esta referencia apunta a la última corrección auditada. */
  latestCorrectionId?: string
  editedAt?: string
  editedBy?: string
  editReason?: string
  revision?: number
  /** Resultado vigente; los campos originales del documento no se sobrescriben. */
  effectiveSnapshot?: Pick<DistSale, 'lines' | 'total' | 'paymentKind' | 'cashAmount' | 'qrAmount' | 'creditAmount'>
  /** Instantánea original antes de cualquier corrección auditada */
  originalSnapshot?: Pick<DistSale, 'lines' | 'total' | 'paymentKind' | 'cashAmount' | 'qrAmount' | 'creditAmount'>
  /** Historial acumulado de correcciones auditadas de esta venta */
  revisions?: DistSaleCorrection[]
}

export interface DistSaleCorrection extends DistBaseDoc {
  saleId: string
  revision: number
  reason: string
  original: Pick<DistSale, 'lines' | 'total' | 'paymentKind' | 'cashAmount' | 'qrAmount' | 'creditAmount'>
  corrected: Pick<DistSale, 'lines' | 'total' | 'paymentKind' | 'cashAmount' | 'qrAmount' | 'creditAmount'>
  stockDeltas: Array<{ productId: string; quantity: number; allocations?: DistLotAllocation[] }>
  moneyDelta: number
  creditDelta: number
  correctedByName: string
}

export type ReceivableStatus = 'OPEN' | 'PARTIAL' | 'PAID'

export interface DistReceivable extends DistBaseDoc {
  creditedAmount?: number
  saleLines?: DistSaleLine[]
  customerCode?: string
  saleId?: string
  sourceType?: 'sale' | 'opening_balance'
  sourceDate?: string
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
  saleLines?: DistSaleLine[]
  customerCode?: string
  operationId: string
  receivableId?: string
  allocations?: Array<{ receivableId: string; amount: number; sourceType?: 'sale' | 'opening_balance'; saleId?: string }>
  /** Saldos congelados al momento del cobro para reimpresión histórica. */
  portfolioBalanceBefore?: number
  portfolioBalanceAfter?: number
  customerId: string
  customerName: string
  routeId: string
  originRouteId?: string
  collectedByUid: string
  collectedByName: string
  amount: number
  method: 'cash' | 'qr' | 'mixed'
  cashAmount?: number
  qrAmount?: number
  note?: string
}

export interface DistExpense extends DistBaseDoc {
  voided?: boolean
  voidedAt?: string
  voidedBy?: string
  voidedByName?: string
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
  warehouseId?: string
  declaredReturns?: Record<string, number>
  returnDeclaredBy?: string
  returnDeclaredAt?: string
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
  physicalCashDeclared?: number
  cashDeclaredBy?: string
  cashDeclaredAt?: string
  cashDifference: number
  warehouseClosedBy?: string
  warehouseClosedAt?: string
  warehouseResponsibleName?: string
  closedBy?: string
  closedAt?: string
  reopenedBy?: string
  reopenedAt?: string
  /** La revisión reconoce la diferencia sin modificar el cierre ni el stock. */
  varianceReviewedBy?: string
  varianceReviewedAt?: string
  note?: string
}

export interface DistWarehouse {
  id: string
  name: string
  active: boolean
  restaurantId: string
}

export interface DistQrVerification {
  id: string
  restaurantId: string
  routeId: string
  sourceType: 'sale' | 'collection' | 'claim'
  sourceId: string
  amount: number
  verifiedBy: string
  verifiedAt: string
  reference: string
}

export interface DistLot {
 id: string; restaurantId: string; productId: string; productName: string; unitType: UnitType;
 lotCode: string; manufacturedOn: string; expiresOn: string; productionCost: number | null;
 quantities: Record<string, number>; quarantined?: boolean; legacy?: boolean; createdAt: string; createdBy: string;
}
export interface DistTransfer { id: string; fromWarehouseId: string; toWarehouseId: string; line: DistDispatchLine; createdAt: string; createdBy: string; responsibleName?: string; note?: string }
export interface DistClaim { id: string; kind: 'exchange'|'return'; saleId: string; sellerUid?: string; sellerName?: string; customerId: string; customerName: string; productId: string; productName: string; quantity: number; unitType: UnitType; reason: string; routeId: string; createdAt: string; dayKey: string; revenueDelta: number; additionalCost: number | null; debtReduction: number; cashIn: number; cashOut: number; qrIn: number; qrOut: number; replacement: {productId: string;productName: string;quantity: number;unitType: UnitType;total: number} | null }
export interface DistCreditStatus { id: string; oldestPendingAt: string | null; checkedAt: string }
export interface DistCreditOverride { id: string; customerId: string; activeUntil: string; reason: string; grantedAt: string; grantedBy: string; grantedByName: string; revokedAt?: string; revokedBy?: string }
export interface DistWarehouseShift { id: string; warehouseId: string; responsibleName: string; openedAt: string; openedBy: string; closedAt?: string; closedBy?: string; active: boolean }
