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
export type SaleKind = 'sale' | 'courtesy'

export type SourceLocation = 'route' | 'centralWarehouse'

export type StockLocationKind = 'central' | 'route'

export type StockMovementType =
  | 'traceability_notice' // incidencia documental; efecto físico y económico cero
  | 'intake' // ingreso a almacen central
  | 'dispatch' // salida a ruta
  | 'dispatch_addition' // aumento de carga sobre despacho abierto
  | 'sale' // venta (descuenta ruta o central)
  | 'sale_correction'
  | 'return' // retorno fisico de ruta a central
  | 'return_merma' // merma operativa recuperable que también vuelve a stock vendible
  | 'adjustment' // ajuste manual de almacen
  | 'dispatch_correction' // correccion auditada de despacho o aumento
  | 'dispatch_waste' // merma descontada al despachar productos al peso
  | 'dispatch_merma_sale' // merma adicional físicamente entregada dentro de ventas; su costo forma parte del COGS, no es pérdida
  | 'return_waste' // merma confirmada por almacén al recibir una ruta
  | 'return_waste_unassigned' // pérdida recibida sin lote de origen trazable
  | 'courtesy' // producto entregado gratuitamente
  | 'shortage' // faltante detectado en conciliacion
  | 'overage' // sobrante detectado en conciliacion
  | 'quarantine_release' // lote liberado a inventario vendible con trazabilidad
  | 'quarantine_discard' // descarte auditado desde cuarentena
  | 'customer_return' // devolución física de cliente, inicialmente en cuarentena
  | 'transfer' // movimiento entre almacenes
  | 'sale_void' // reversión auditada de venta
  | 'reservation_created' // reserva: cambio de disponibilidad sin cambio físico
  | 'reservation_released' // liberación de reserva: sin cambio físico
  | 'processing_consumption' // consumo físico del producto de origen en elaboración
  | 'processing_output' // entrada de una presentación derivada (bloqueada si falta trazabilidad posterior)
  | 'processing_discard' // clasificación de gramos descartados dentro del consumo del batch; sin segundo delta físico

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
  /** 'route' = ruta de distribuidor, 'direct' = valor histórico para el canal Impulsación */
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

/** Ledger auditable; las reaperturas agregan metadata de reversión sin borrar el movimiento. */
export interface DistStockMovement extends DistBaseDoc {
  batchId?: string
  destinationId?: string
  destinationKind?: string
  physicalWeightG?: number
  commercialQuantity?: number
  costCents?: number | null
  processingCostCents?: number | null
  costTotal?: number | null
  processingAllocations?: import('./domain/processing.ts').ProcessingMovementAllocation[]
  processingBatchIds?: string[]
  processingWeightBasis?: import('./domain/processing.ts').ProcessingWeightBasis[]
  processingAllocationMethod?: 'documented_average_not_individual_measurement'
  processingCommercialBlocked?: boolean
  sourceLotIds?: string[]
  sourceAllocations?: import('./domain/processing.ts').ProcessingDestinationSourceAllocation[]
  allocations?: DistLotAllocation[]
  sourceAllocationBasis?: 'batch_blend_accounting_allocation'
  originReferences?: OriginReference[]
  traceabilityStatus?: 'physical_origin_pending'
  documentedMovementIds?: string[]
  responsibleName?: string
  responsibleRole?: 'admin' | 'warehouse' | 'distributor'
  lotCode?: string
  lossCost?: number | null
  lossClassification?: 'confirmed_physical_loss'
  type: StockMovementType
  productId: string
  productName: string
  unitType: UnitType
  /** Cantidad positiva siempre; el signo lo dan centralDelta / routeDelta */
  quantity: number
  /** Desglose informativo de carga física; no representa pérdida. */
  normalQuantity?: number
  dispatchMerma?: number
  /** Costo histórico de la merma adicional conciliada como salida física dentro de ventas. */
  costOfSales?: number | null
  chargedQuantity?: number
  excessWeightQuantity?: number
  centralDelta: number
  routeDelta: number
  fromLocation?: string
  toLocation?: string
  routeId?: string
  /** Documento que origino el movimiento (dispatchId, saleId, closureId) */
  refType?: 'dispatch' | 'sale' | 'closure' | 'operation' | 'manual'
  refId?: string
  /** Despacho relacionado, presente en movimientos de retorno/faltante/sobrante. */
  dispatchId?: string
  lotId?: string
  destinationLotId?: string
  quarantineSourceLotId?: string
  resolution?: 'released_existing_lot' | 'released_new_lot' | 'discarded'
  note?: string
  reversedAt?: string
  reversedBy?: string
  reversalOperationId?: string
  reversalReason?: string
  /** Auditoría bidireccional de un movimiento corregido sin borrarlo. */
  rectifiedAt?: string
  rectifiedByOperationId?: string
  rectifiedByMovementId?: string
  rectificationReason?: string
}

export interface DistDispatchLine {
  lotCode?: string
  manufacturedOn?: string
  expiresOn?: string
  lotId?: string
  productId: string
  productName: string
  unitType: UnitType
  /** Cantidad normal; solo existe en despachos creados con la semántica nueva. */
  normalQuantity?: number
  /** Merma adicional que se entrega físicamente a la ruta; no es pérdida. */
  dispatchMerma?: number
  dispatchMermaAllocations?: DistLotAllocation[]
  quantity: number
  waste?: number
  warehouseLoss?: { quantity: number; reason: string; confirmation: 'CONFIRMAR_PERDIDA_REAL' }
  wasteCost?: number | null
  wasteAllocations?: DistLotAllocation[]
  /** Selección explícita solicitada por el operador; el servidor vuelve a validarla. */
  allocationsRequested?: Array<{ lotId: string; quantity: number }>
  allocations?: DistLotAllocation[]
}

export interface DistLotAllocation {
  originReferences?: OriginReference[]
  lotId: string
  lotCode: string
  expiresOn: string
  quantity: number
  productionCost: number | null
  processingAllocation?: import('./domain/processing.ts').ProcessingMovementAllocation
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
  oldDispatchMerma?: number
  newDispatchMerma?: number
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
  costCents?: number | null
  allocations?: DistLotAllocation[]
  productId: string
  productNameSnapshot: string
  presentationSnapshot?: string
  descriptionSnapshot?: string
  quantity: number
  unitType: UnitType
  /** En ventas de Administración por kg: cantidad realmente entregada; el cobro usa quantity. */
  physicalQuantity?: number
  /** Diferencia entregada sin cobro; no es merma de retorno ni pérdida. */
  excessWeightQuantity?: number
  /** Precio realmente aplicado, congelado historicamente */
  actualUnitPrice: number
  /** Precio oficial vigente al vender; permite auditar descuentos promocionales. */
  referenceUnitPrice?: number
  isPromotional?: boolean
  subtotal: number
  /** Valor de referencia no financiero cuando la línea es una cortesía. */
  referenceSubtotal?: number
}

export interface DistSale extends DistBaseDoc {
  saleKind?: SaleKind
  courtesyReason?: string
  courtesyCost?: number | null
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
  voidedAt?: string
  voidedBy?: string
  voidedByName?: string
  voidReason?: string
  revision?: number
  /** Resultado vigente; los campos originales del documento no se sobrescriben. */
  effectiveSnapshot?: Pick<DistSale, 'lines' | 'total' | 'paymentKind' | 'cashAmount' | 'qrAmount' | 'creditAmount' | 'saleKind'>
  /** Instantánea original antes de cualquier corrección auditada */
  originalSnapshot?: Pick<DistSale, 'lines' | 'total' | 'paymentKind' | 'cashAmount' | 'qrAmount' | 'creditAmount' | 'saleKind'>
  /** Historial acumulado de correcciones auditadas de esta venta */
  revisions?: DistSaleCorrection[]
}

export interface DistSaleCorrection extends DistBaseDoc {
  kind?: 'edit' | 'void'
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

export interface DistQuoteLine {
  productId: string
  productNameSnapshot: string
  unitType: UnitType
  quantity: number
  unitPrice: number
  subtotal: number
}

export interface DistQuote extends DistBaseDoc {
  quoteNumber: string
  status: 'vigente' | 'vencida' | 'cancelada'
  validUntil: string
  sellerUid: string
  sellerName: string
  routeId: string
  routeName: string
  customerId?: string
  customerName: string
  customerPhone?: string
  lines: DistQuoteLine[]
  total: number
  note?: string
  cancelledAt?: string
  cancelledBy?: string
  deleted?: boolean
  deletedAt?: string
  deletedBy?: string
  deletedByName?: string
  history?: Array<Record<string, unknown>>
  updatedAt?: string
}

export type ReceivableStatus = 'OPEN' | 'PARTIAL' | 'PAID' | 'VOID'

export interface DistReceivableLineAdjustment {
  productId: string
  productNameSnapshot: string
  presentationSnapshot?: string
  quantity: number
  unitType: UnitType
  creditAmount: number
}

export interface DistReceivable extends DistBaseDoc {
  creditedAmount?: number
  saleLines?: DistSaleLine[]
  customerCode?: string
  saleId?: string
  sourceType?: 'sale' | 'opening_balance'
  sourceDate?: string
  adjustedSaleLines?: DistReceivableLineAdjustment[]
  voided?: boolean
  voidedAt?: string
  voidedBy?: string
  voidedByName?: string
  voidReason?: string
  voidedPreviousBalance?: number
  voidedSnapshot?: Record<string, unknown>
  lastAdjustmentId?: string
  lastAdjustedAt?: string
  lastAdjustedBy?: string
  lastAdjustmentReason?: string
  originalSnapshot?: Record<string, unknown>
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

export interface DistReceivableSnapshot {
  originalAmount: number
  paidAmount: number
  balance: number
  status: ReceivableStatus
  sourceDate: string
  note: string
  saleLines: DistSaleLine[]
  adjustedSaleLines: DistReceivableLineAdjustment[]
  voided: boolean
  voidedAt: string
  voidReason: string
}

export interface DistReceivableAdjustment extends DistBaseDoc {
  action: 'edit' | 'void'
  receivableId: string
  customerId: string
  customerName: string
  actorName?: string
  reason: string
  effectiveAt: string
  effectiveDayKey: string
  previous: DistReceivableSnapshot
  next: DistReceivableSnapshot
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
  group?: ExpenseGroupId
  groupName?: string
  categoryId?: string
  categoryName?: string
  paymentMethod?: 'cash' | 'transfer' | 'other' | 'credit' | 'mixed'
  transactionKind?: 'expense' | 'supplier_purchase' | 'supplier_payment'
  cashPaidAmount?: number
  transferPaidAmount?: number
  otherPaidAmount?: number
  initialPaymentMethod?: 'cash' | 'transfer' | 'other'
  payableId?: string
  supplierId?: string
  supplierName?: string
  economicType?: ExpenseEconomicType
  affectsOperatingResult?: boolean
  classificationStatus?: 'classified' | 'pending_review' | 'reviewed'
  classificationSource?: 'automatic' | 'user_pending' | 'admin_review' | 'legacy'
  classificationHistory?: Array<Record<string, unknown>>
  concept: string
  amount: number
  routeId: string
  routeName: string
  registeredByUid: string
  registeredByName: string
  note?: string
}

export type ExpenseEconomicType = 'operating_expense' | 'production_input'
export type ExpenseGroup = 'administration' | 'indirect' | 'equipment' | 'other' | 'production_additional' | 'production_input'
/** Group IDs are stable; built-in groups retain the ExpenseGroup IDs. */
export type ExpenseGroupId = string

export interface DistExpenseGroup extends DistBaseDoc {
  name: string
  active: boolean
  order: number
  economicType: ExpenseEconomicType
  updatedAt?: string
  updatedBy?: string
}

export interface DistExpenseCategory extends DistBaseDoc {
  group: ExpenseGroupId
  name: string
  active: boolean
  order: number
  autoClassifiable?: boolean
  distributorVisible?: boolean
  updatedAt?: string
  updatedBy?: string
}

export interface DistSupplier extends DistBaseDoc {
  name: string
  active: boolean
  contactName?: string
  phone?: string
  note?: string
  updatedAt?: string
  updatedBy?: string
}

export interface DistPayable extends DistBaseDoc {
  supplierId: string
  supplierName: string
  purchaseExpenseId: string
  dayKey: string
  description: string
  groupId: string
  groupName: string
  categoryId: string
  categoryName: string
  totalAmount: number
  paidAmount: number
  balance: number
  status: 'pending' | 'partial' | 'paid' | 'voided'
  dueDayKey?: string
  note?: string
  routeId: string
  routeName: string
  voidedAt?: string
  voidedBy?: string
  voidedByName?: string
  voidReason?: string
  history?: Array<{ action: 'payment_voided' | 'purchase_voided'; paymentId?: string; amount?: number; paymentMethod?: 'cash' | 'transfer' | 'other'; reason: string; at: string; by: string; byName: string; affectedExpenseId?: string }>
}

export interface DistSupplierPayment extends DistBaseDoc {
  payableId: string
  supplierId: string
  supplierName: string
  amount: number
  paymentMethod: 'cash' | 'transfer' | 'other'
  dayKey: string
  routeId: string
  routeName: string
  responsibleUid: string
  responsibleName: string
  note?: string
  voided?: boolean
  voidedAt?: string
  voidedBy?: string
  voidedByName?: string
  voidReason?: string
}

export interface DistClosureProductRow {
  originReferences?: OriginReference[]
  originPendingReceived?: number
  productId: string
  productName: string
  unitType: UnitType
  initialDispatch: number
  additions: number
  totalLoaded: number
  sold: number
  courtesy?: number
  expectedReturn: number
  normalExpectedReturn?: number
  normalLoaded?: number
  physicalLoaded?: number
  dispatchMermaSent?: number
  dispatchMermaIncludedInSales?: number
  /** Merma nominal ya descontada dentro de ventas que superan la carga normal. */
  dispatchMermaNominallySold?: number
  /** Confirmación de Almacén de sobrepeso adicional no cobrado dentro de bolsas vendidas. */
  dispatchMermaEmbeddedInSalesConfirmed?: boolean
  dispatchMermaEmbeddedInSalesQuantity?: number
  dispatchMermaEmbeddedInSalesConfirmedBy?: string
  dispatchMermaEmbeddedInSalesConfirmedAt?: string
  dispatchMermaEmbeddedInSalesReason?: string
  dispatchMermaReconciliationStatus?: 'included_in_sales' | 'reconciled_with_unfit' | 'returned' | 'pending_review'
  dispatchMermaSaleCost?: number | null
  dispatchMermaSaleMovementId?: string
  /** Cantidad total declarada por el distribuidor; no es necesariamente producto apto. */
  declaredReturn?: number
  declaredReturnNormal?: number
  /** Declaración separada del distribuidor; ausente significa 0 en históricos. */
  declaredReturnMerma?: number
  /** Cantidad total pesada y recibida físicamente por Almacén, incluye la merma. */
  physicalReturn?: number
  /** Retorno normal que vuelve al stock vendible. */
  actualReturn: number
  /** Merma recuperable al retorno, distinta de la pérdida histórica; ausente en cierres anteriores. */
  returnMerma?: number
  /** Producto no apto/pérdida. En cierres históricos mantiene el significado de la merma usada entonces. */
  returnWaste?: number
  returnWasteReason?: string
  /** Paquetes derivados recibidos dañados; se inmovilizan en cuarentena. */
  damagedPackageQuantity?: number
  damagedPackageCondition?: string
  damagedPackageReason?: string
  /** Medición física opcional real en gramos; null/ausente significa desconocido. */
  damagedMeasuredWeightG?: number | null
  damagedHistoricalAssignedWeightG?: number
  damagedWeightMeasurementScope?: string
  damagedQuarantineLots?: Array<{ lotId: string; reservationId: string; movementId: string; quantity: number; batchId: string; costCents: number | null }>
  shortage?: number
  overage?: number
  lossCost?: number | null
  /** Enlace exacto al movimiento de faltante activo que conserva el costo histórico. */
  shortageMovementId?: string
  variance: number
}

export interface DistClosureReopenHistoryEntry {
  reopenedAt: string
  reason: string
  preserveFinancialSnapshot?: boolean
  warehouseClosedBy: string
  warehouseClosedAt: string
  products: DistClosureProductRow[]
  reopenedBy?: string
  reopenedByName?: string
  previousClosedAt?: string
  previousClosedBy?: string
  previousClosedByName?: string
}

export type ClosureStatus = 'draft' | 'warehouse_done' | 'closed' | 'reopened'

export interface DistClosureRectification {
  id: string
  version: number
  closureId: string
  createdAt: string
  createdBy: string
  createdByName: string
  reason: string
  operationId: string
  originalHash: string
  sourceHash: string
  original: DistClosure
  corrected: DistClosure
  changes: { field: string; before: number; after: number; sourceDocumentIds: string[] }[]
  excludedSaleIds: string[]
  sourceDocumentIds: string[]
}

export interface DistClosure extends DistBaseDoc {
  rectificationId?: string
  rectification?: DistClosureRectification
  rectificationView?: 'original' | 'corrected'
  warehouseId?: string
  declaredReturns?: Record<string, number>
  declaredReturnMermas?: Record<string, number>
  /** Las declaraciones nuevas contienen solo cantidad normal; ausente en históricos. */
  returnDeclarationMode?: 'normal_only' | 'normal_and_merma'
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
  claimCash?: number
  expectedCash: number
  closureType?: 'route' | 'admin'
  physicalCashDeclared?: number
  cashDeclaredBy?: string
  cashDeclaredAt?: string
  cashDifference: number
  warehouseClosedBy?: string
  warehouseClosedAt?: string
  warehouseResponsibleName?: string
  closedBy?: string
  closedByName?: string
  closedAt?: string
  reopenedBy?: string
  reopenedByName?: string
  reopenedAt?: string
  reopenReason?: string
  preserveFinancialSnapshot?: boolean
  reopenHistory?: DistClosureReopenHistoryEntry[]
  reversedStockMovementIds?: string[]
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
  /** Revisión económica de la venta verificada; ausente en verificaciones históricas. */
  sourceRevision?: number
  amount: number
  verifiedBy: string
  verifiedAt: string
  reference: string
}

export interface DistLot {
 pendingOrigins?: Record<string, OriginReference[]>;
 /** Aggregate reservation by location. Writers must update this lot document in the same transaction as reservation documents to serialize competing stock operations. */
 processingUnavailable?: Record<string, { courtesy: number; repackPending: number; reviewHold: number }>;
 /** Server-only gate until package weight and exact historical cost are consumed end-to-end. */
 processingCommercialBlocked?: boolean;
 processingBatchId?: string;
 processingDestinationId?: string;
 processingDestinationKind?: import('./domain/processing.ts').ProcessingDestinationKind;
 processingPhysicalWeightGRemaining?: number;
 processingCostCentsRemaining?: number | null;
 processingCostTotalCents?: number | null;
 processingPackageWeightLedger?: import('./domain/processing.ts').PackageWeightLedger;
 /** Per-location remaining package/gram/cost segments; absent on legacy derived lots and required for movement. */
 processingByLocation?: Record<string, import('./domain/processing.ts').ProcessingLotLocationLedger>;
 processingSourceLotIds?: string[];
 processingSourceAllocations?: import('./domain/processing.ts').ProcessingDestinationSourceAllocation[];
 processingSourceAllocationBasis?: 'batch_blend_accounting_allocation';
 packagedOn?: string;
 id: string; restaurantId: string; productId: string; productName: string; unitType: UnitType;
 lotCode: string; manufacturedOn: string; expiresOn: string; productionCost: number | null;
 quantities: Record<string, number>; quarantined?: boolean; legacy?: boolean; createdAt: string; createdBy: string;
 quarantineResolvedAt?: string; quarantineResolvedBy?: string; quarantineResolvedByName?: string;
 quarantineResolution?: 'released_existing_lot' | 'released_new_lot' | 'discarded' | 'rectified_input_error';
 quarantineResolutionReason?: string; quarantineResolvedQuantity?: number; quarantineResolvedLocation?: string;
 quarantineOriginalLotCode?: string;
 quarantineDestinationLotId?: string; quarantineDestinationLotCode?: string; quarantineLossCost?: number | null;
}
export type DistStockReservation = import('./domain/processing.ts').ProcessingReservation
export interface OriginReference {
 historicalUnitCost?: number | null;
 exceptionId: string; accountingLotId: string; sourceMovementId: string;
 physicalOriginConfirmed: false; basis: 'original_accounting_debit_only'; quantity: number;
}
export interface DistTransfer { id: string; fromWarehouseId: string; toWarehouseId: string; line: DistDispatchLine; createdAt: string; createdBy: string; responsibleName?: string; note?: string }
export interface DistClaim { id: string; kind: 'exchange'|'return'; saleId: string; sellerUid?: string; sellerName?: string; customerId: string; customerName: string; productId: string; productName: string; quantity: number; unitType: UnitType; reason: string; routeId: string; createdAt: string; dayKey: string; revenueDelta: number; additionalCost: number | null; debtReduction: number; cashIn: number; cashOut: number; qrIn: number; qrOut: number; replacement: {productId: string;productName: string;quantity: number;unitType: UnitType;total: number} | null }
export interface DistCreditStatus { id: string; oldestPendingAt: string | null; checkedAt: string }
export interface DistCreditOverride { id: string; customerId: string; activeUntil: string; reason: string; grantedAt: string; grantedBy: string; grantedByName: string; revokedAt?: string; revokedBy?: string }
export interface DistWarehouseShift { id: string; warehouseId: string; responsibleName: string; openedAt: string; openedBy: string; closedAt?: string; closedBy?: string; active: boolean }
