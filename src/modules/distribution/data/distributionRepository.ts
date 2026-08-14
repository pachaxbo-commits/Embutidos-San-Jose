import {
  collection,
  doc,
  increment,
  onSnapshot,
  query,
  where,
  writeBatch,
  type DocumentData,
  type Firestore,
  type Query,
  type Unsubscribe,
  type WriteBatch,
} from 'firebase/firestore'
import { getFirebaseContext } from '../../../lib/firebase'
import { centralBalanceId, round2, routeBalanceId, toDayKey } from '../domain/engine'
import type {
  DistBalance,
  DistClosure,
  DistCollection,
  DistCustomer,
  DistDispatch,
  DistDispatchAddition,
  DistDispatchLine,
  DistExpense,
  DistProduct,
  DistReceivable,
  DistRoute,
  DistSale,
  DistSaleLine,
  DistStockMovement,
  PaymentKind,
  SourceLocation,
  StockMovementType,
} from '../types'

/**
 * Repositorio de distribucion movil.
 *
 * Offline: se apoya en la persistencia local ya configurada de Firestore
 * (persistentLocalCache + multi-tab) que usa el resto de PACHAX Flow. No hay
 * un segundo motor offline. Las escrituras se envian en lote y NO se esperan:
 * Firestore las aplica al cache local de inmediato (los onSnapshot disparan al
 * instante) y las reenvia sola al recuperar conexion.
 *
 * Idempotencia: cada operacion lleva un operationId estable que se usa como id
 * de documento. Ademas se guarda un registro local de operaciones ya aplicadas
 * para que un reintento nunca vuelva a sumar/restar saldos.
 */

export const DIST_COLLECTIONS = {
  products: 'distProducts',
  routes: 'distRoutes',
  customers: 'distCustomers',
  balances: 'distBalances',
  movements: 'distStockMovements',
  dispatches: 'distDispatches',
  sales: 'distSales',
  receivables: 'distReceivables',
  collections: 'distCollections',
  expenses: 'distExpenses',
  closures: 'distClosures',
} as const

const SCHEMA_VERSION = 1
const APPLIED_OPERATIONS_KEY = 'pachax_dist_applied_operations'

export function newOperationId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}_${random}`
}

function loadAppliedOperations(): Set<string> {
  try {
    const raw = localStorage.getItem(APPLIED_OPERATIONS_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as string[]
    return new Set(Array.isArray(parsed) ? parsed.slice(-500) : [])
  } catch {
    return new Set()
  }
}

const appliedOperations = loadAppliedOperations()

function markOperationApplied(operationId: string) {
  appliedOperations.add(operationId)
  try {
    localStorage.setItem(APPLIED_OPERATIONS_KEY, JSON.stringify(Array.from(appliedOperations).slice(-500)))
  } catch {
    // Sin almacenamiento local seguimos igual: el id de documento ya evita duplicar el registro.
  }
}

export function isOperationApplied(operationId: string): boolean {
  return appliedOperations.has(operationId)
}

interface RepoContext {
  db: Firestore
  restaurantId: string
  uid: string
}

async function getContext(): Promise<RepoContext> {
  const context = await getFirebaseContext()
  if (!context) throw new Error('Firebase no esta configurado.')
  return {
    db: context.db,
    restaurantId: context.restaurantId,
    uid: context.auth.currentUser?.uid ?? 'system',
  }
}

function collectionRef(context: RepoContext, name: string) {
  return collection(context.db, 'restaurants', context.restaurantId, name)
}

function docRef(context: RepoContext, name: string, id: string) {
  return doc(context.db, 'restaurants', context.restaurantId, name, id)
}

// ---------------------------------------------------------------------------
// Estado de sincronizacion visible para el usuario
// ---------------------------------------------------------------------------

export interface DistSyncState {
  isOnline: boolean
  /** Operaciones de esta sesion que aun no confirmo el servidor */
  pending: number
  /**
   * Firestore reporta escrituras locales sin confirmar. Sobrevive al cierre y
   * reapertura de la app, cosa que el contador en memoria no puede hacer.
   */
  hasUnsyncedWrites: boolean
  lastSyncedAt: string | null
}

let syncState: DistSyncState = {
  isOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
  pending: 0,
  hasUnsyncedWrites: false,
  lastSyncedAt: null,
}

/** Consultas que reportan escrituras locales pendientes de confirmar */
const queriesWithPendingWrites = new Set<string>()

function reportPendingWrites(queryKey: string, hasPendingWrites: boolean) {
  const had = queriesWithPendingWrites.size > 0
  if (hasPendingWrites) queriesWithPendingWrites.add(queryKey)
  else queriesWithPendingWrites.delete(queryKey)

  const has = queriesWithPendingWrites.size > 0
  if (had !== has) {
    syncState = { ...syncState, hasUnsyncedWrites: has }
    emitSyncState()
  }
}

const syncListeners = new Set<() => void>()

function emitSyncState() {
  syncListeners.forEach((listener) => listener())
}

export function getSyncState(): DistSyncState {
  return syncState
}

export function subscribeSyncState(listener: () => void): () => void {
  syncListeners.add(listener)
  return () => syncListeners.delete(listener)
}

if (typeof window !== 'undefined') {
  const update = () => {
    syncState = { ...syncState, isOnline: navigator.onLine }
    emitSyncState()
  }
  window.addEventListener('online', update)
  window.addEventListener('offline', update)
}

/**
 * Envia el lote sin bloquear la interfaz. Offline la promesa no se resuelve
 * hasta reconectar, pero el cache local ya refleja el cambio.
 */
function commitInBackground(batch: WriteBatch, operationId: string, label: string) {
  markOperationApplied(operationId)
  syncState = { ...syncState, pending: syncState.pending + 1 }
  emitSyncState()

  void batch
    .commit()
    .then(() => {
      syncState = {
        ...syncState,
        pending: Math.max(0, syncState.pending - 1),
        lastSyncedAt: new Date().toISOString(),
      }
      emitSyncState()
    })
    .catch((error: unknown) => {
      syncState = { ...syncState, pending: Math.max(0, syncState.pending - 1) }
      emitSyncState()
      console.error(`[distribution] fallo al sincronizar ${label} (${operationId})`, error)
    })
}

/**
 * Firestore rechaza los campos con valor undefined. Un cierre en curso tiene
 * varios datos que todavia no ocurrieron, asi que se limpian antes de escribir.
 */
function stripUndefined<T extends Record<string, unknown>>(data: T): T {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) as T
}

function baseDocFields(context: RepoContext, createdAt: string) {
  return {
    restaurantId: context.restaurantId,
    branchId: 'main',
    createdAt,
    createdBy: context.uid,
    dayKey: toDayKey(createdAt),
    schemaVersion: SCHEMA_VERSION,
  }
}

// ---------------------------------------------------------------------------
// Suscripciones
// ---------------------------------------------------------------------------

let querySequence = 0

function subscribeQuery<T>(
  build: (context: RepoContext) => Query<DocumentData>,
  onData: (rows: T[]) => void,
  onError?: (error: Error) => void,
): () => void {
  let unsubscribe: Unsubscribe | null = null
  let cancelled = false
  const queryKey = `q${querySequence++}`

  void (async () => {
    try {
      const context = await getContext()
      if (cancelled) return
      unsubscribe = onSnapshot(
        build(context),
        { includeMetadataChanges: true },
        (snapshot) => {
          reportPendingWrites(queryKey, snapshot.metadata.hasPendingWrites)
          onData(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as T))
        },
        (error) => {
          console.error('[distribution] error de suscripcion', error)
          onError?.(error)
        },
      )
    } catch (error) {
      onError?.(error as Error)
    }
  })()

  return () => {
    cancelled = true
    reportPendingWrites(queryKey, false)
    if (unsubscribe) unsubscribe()
  }
}

export function subscribeProducts(onData: (rows: DistProduct[]) => void, onError?: (error: Error) => void) {
  return subscribeQuery<DistProduct>((context) => collectionRef(context, DIST_COLLECTIONS.products), onData, onError)
}

export function subscribeRoutes(onData: (rows: DistRoute[]) => void, onError?: (error: Error) => void) {
  return subscribeQuery<DistRoute>((context) => collectionRef(context, DIST_COLLECTIONS.routes), onData, onError)
}

export function subscribeCustomers(onData: (rows: DistCustomer[]) => void, onError?: (error: Error) => void) {
  return subscribeQuery<DistCustomer>((context) => collectionRef(context, DIST_COLLECTIONS.customers), onData, onError)
}

export function subscribeBalances(onData: (rows: DistBalance[]) => void, onError?: (error: Error) => void) {
  return subscribeQuery<DistBalance>((context) => collectionRef(context, DIST_COLLECTIONS.balances), onData, onError)
}

/** Despachos abiertos. Con routeId se limita a la ruta del distribuidor. */
export function subscribeOpenDispatches(
  routeId: string | null,
  onData: (rows: DistDispatch[]) => void,
  onError?: (error: Error) => void,
) {
  return subscribeQuery<DistDispatch>(
    (context) => {
      const base = collectionRef(context, DIST_COLLECTIONS.dispatches)
      return routeId
        ? query(base, where('status', '==', 'open'), where('routeId', '==', routeId))
        : query(base, where('status', '==', 'open'))
    },
    onData,
    onError,
  )
}

function subscribeDayScoped<T>(
  collectionName: string,
  dayKeys: string[],
  routeId: string | null,
  onData: (rows: T[]) => void,
  onError?: (error: Error) => void,
) {
  return subscribeQuery<T>(
    (context) => {
      const base = collectionRef(context, collectionName)
      const filters = []
      if (dayKeys.length === 1) filters.push(where('dayKey', '==', dayKeys[0]))
      else filters.push(where('dayKey', 'in', dayKeys.slice(0, 30)))
      if (routeId) filters.push(where('routeId', '==', routeId))
      return query(base, ...filters)
    },
    onData,
    onError,
  )
}

export function subscribeSales(
  dayKeys: string[],
  routeId: string | null,
  onData: (rows: DistSale[]) => void,
  onError?: (error: Error) => void,
) {
  return subscribeDayScoped<DistSale>(DIST_COLLECTIONS.sales, dayKeys, routeId, onData, onError)
}

export function subscribeCollections(
  dayKeys: string[],
  routeId: string | null,
  onData: (rows: DistCollection[]) => void,
  onError?: (error: Error) => void,
) {
  return subscribeDayScoped<DistCollection>(DIST_COLLECTIONS.collections, dayKeys, routeId, onData, onError)
}

export function subscribeExpenses(
  dayKeys: string[],
  routeId: string | null,
  onData: (rows: DistExpense[]) => void,
  onError?: (error: Error) => void,
) {
  return subscribeDayScoped<DistExpense>(DIST_COLLECTIONS.expenses, dayKeys, routeId, onData, onError)
}

/** Cartera. El distribuidor solo ve la de su ruta. */
export function subscribeReceivables(
  routeId: string | null,
  onData: (rows: DistReceivable[]) => void,
  onError?: (error: Error) => void,
) {
  return subscribeQuery<DistReceivable>(
    (context) => {
      const base = collectionRef(context, DIST_COLLECTIONS.receivables)
      return routeId ? query(base, where('routeId', '==', routeId)) : base
    },
    onData,
    onError,
  )
}

export function subscribeClosures(
  dayKeys: string[],
  routeId: string | null,
  onData: (rows: DistClosure[]) => void,
  onError?: (error: Error) => void,
) {
  return subscribeDayScoped<DistClosure>(DIST_COLLECTIONS.closures, dayKeys, routeId, onData, onError)
}

// ---------------------------------------------------------------------------
// Catalogo, rutas y clientes
// ---------------------------------------------------------------------------

export async function saveProduct(product: Omit<DistProduct, 'restaurantId' | 'createdAt'> & { createdAt?: string }) {
  const context = await getContext()
  const batch = writeBatch(context.db)
  const now = new Date().toISOString()
  batch.set(
    docRef(context, DIST_COLLECTIONS.products, product.id),
    {
      ...product,
      referencePrice: round2(product.referencePrice),
      restaurantId: context.restaurantId,
      createdAt: product.createdAt ?? now,
      updatedAt: now,
    },
    { merge: true },
  )
  commitInBackground(batch, `product_${product.id}_${now}`, 'producto')
}

export async function saveRoute(route: Omit<DistRoute, 'restaurantId' | 'createdAt'> & { createdAt?: string }) {
  const context = await getContext()
  const batch = writeBatch(context.db)
  batch.set(
    docRef(context, DIST_COLLECTIONS.routes, route.id),
    { ...route, restaurantId: context.restaurantId, createdAt: route.createdAt ?? new Date().toISOString() },
    { merge: true },
  )
  commitInBackground(batch, `route_${route.id}`, 'ruta')
}

export interface CustomerInput {
  id?: string
  name: string
  phone?: string
  address?: string
  routeId?: string
  notes?: string
  active?: boolean
}

export async function saveCustomer(input: CustomerInput): Promise<DistCustomer> {
  const context = await getContext()
  const now = new Date().toISOString()
  const id = input.id || newOperationId('cust')

  const customer: DistCustomer = {
    id,
    name: input.name.trim(),
    phone: input.phone?.trim() || '',
    address: input.address?.trim() || '',
    routeId: input.routeId || '',
    notes: input.notes?.trim() || '',
    active: input.active ?? true,
    restaurantId: context.restaurantId,
    createdAt: now,
    createdBy: context.uid,
    updatedAt: now,
  }

  const batch = writeBatch(context.db)
  batch.set(docRef(context, DIST_COLLECTIONS.customers, id), customer, { merge: true })
  commitInBackground(batch, `customer_${id}_${now}`, 'cliente')
  return customer
}

// ---------------------------------------------------------------------------
// Movimientos de stock
// ---------------------------------------------------------------------------

interface MovementInput {
  type: StockMovementType
  productId: string
  productName: string
  unitType: DistDispatchLine['unitType']
  quantity: number
  centralDelta: number
  routeDelta: number
  routeId?: string
  refType?: DistStockMovement['refType']
  refId?: string
  note?: string
}

/**
 * Escribe una entrada de ledger y ajusta los saldos cacheados en el mismo lote.
 * El ledger es la fuente auditable; los saldos son un acumulado con increment().
 */
function appendMovement(
  batch: WriteBatch,
  context: RepoContext,
  operationId: string,
  createdAt: string,
  movement: MovementInput,
) {
  const movementDoc: DistStockMovement = {
    id: operationId,
    ...baseDocFields(context, createdAt),
    type: movement.type,
    productId: movement.productId,
    productName: movement.productName,
    unitType: movement.unitType,
    quantity: round2(Math.abs(movement.quantity)),
    centralDelta: round2(movement.centralDelta),
    routeDelta: round2(movement.routeDelta),
    routeId: movement.routeId || '',
    refType: movement.refType || 'manual',
    refId: movement.refId || '',
    note: movement.note || '',
  }
  batch.set(docRef(context, DIST_COLLECTIONS.movements, operationId), movementDoc)

  if (movementDoc.centralDelta !== 0) {
    batch.set(
      docRef(context, DIST_COLLECTIONS.balances, centralBalanceId(movement.productId)),
      {
        id: centralBalanceId(movement.productId),
        locationKind: 'central',
        productId: movement.productId,
        productName: movement.productName,
        unitType: movement.unitType,
        quantity: increment(movementDoc.centralDelta),
        restaurantId: context.restaurantId,
        updatedAt: createdAt,
      },
      { merge: true },
    )
  }

  if (movementDoc.routeDelta !== 0 && movement.routeId) {
    const balanceId = routeBalanceId(movement.routeId, movement.productId)
    batch.set(
      docRef(context, DIST_COLLECTIONS.balances, balanceId),
      {
        id: balanceId,
        locationKind: 'route',
        routeId: movement.routeId,
        productId: movement.productId,
        productName: movement.productName,
        unitType: movement.unitType,
        quantity: increment(movementDoc.routeDelta),
        restaurantId: context.restaurantId,
        updatedAt: createdAt,
      },
      { merge: true },
    )
  }
}

/** Ingreso de mercaderia al almacen central */
export async function registerIntake(lines: DistDispatchLine[], note: string, operationId = newOperationId('intake')) {
  if (isOperationApplied(operationId)) return operationId
  const context = await getContext()
  const createdAt = new Date().toISOString()
  const batch = writeBatch(context.db)

  lines.forEach((line, index) => {
    appendMovement(batch, context, `${operationId}__${index}`, createdAt, {
      type: 'intake',
      productId: line.productId,
      productName: line.productName,
      unitType: line.unitType,
      quantity: line.quantity,
      centralDelta: line.quantity,
      routeDelta: 0,
      refType: 'manual',
      refId: operationId,
      note,
    })
  })

  commitInBackground(batch, operationId, 'ingreso a almacen')
  return operationId
}

/** Ajuste manual de almacen central (puede ser negativo) */
export async function registerAdjustment(
  line: DistDispatchLine,
  note: string,
  operationId = newOperationId('adjust'),
) {
  if (isOperationApplied(operationId)) return operationId
  const context = await getContext()
  const createdAt = new Date().toISOString()
  const batch = writeBatch(context.db)

  appendMovement(batch, context, operationId, createdAt, {
    type: 'adjustment',
    productId: line.productId,
    productName: line.productName,
    unitType: line.unitType,
    quantity: line.quantity,
    centralDelta: line.quantity,
    routeDelta: 0,
    refType: 'manual',
    refId: operationId,
    note,
  })

  commitInBackground(batch, operationId, 'ajuste de almacen')
  return operationId
}

// ---------------------------------------------------------------------------
// Despachos
// ---------------------------------------------------------------------------

export interface ConfirmDispatchInput {
  routeId: string
  routeName: string
  distributorUid: string
  distributorName: string
  lines: DistDispatchLine[]
  observation?: string
  operationId?: string
}

/** Confirma un despacho: descuenta central y carga la ruta (una sola vez). */
export async function confirmDispatch(input: ConfirmDispatchInput): Promise<string> {
  const operationId = input.operationId || newOperationId('disp')
  if (isOperationApplied(operationId)) return operationId

  const context = await getContext()
  const createdAt = new Date().toISOString()
  const batch = writeBatch(context.db)

  const dispatch: DistDispatch = {
    id: operationId,
    ...baseDocFields(context, createdAt),
    routeId: input.routeId,
    routeName: input.routeName,
    distributorUid: input.distributorUid,
    distributorName: input.distributorName,
    status: 'open',
    lines: input.lines.map((line) => ({ ...line, quantity: round2(line.quantity) })),
    additions: [],
    observation: input.observation || '',
  }
  batch.set(docRef(context, DIST_COLLECTIONS.dispatches, operationId), dispatch)

  input.lines.forEach((line, index) => {
    appendMovement(batch, context, `${operationId}__line${index}`, createdAt, {
      type: 'dispatch',
      productId: line.productId,
      productName: line.productName,
      unitType: line.unitType,
      quantity: line.quantity,
      centralDelta: -line.quantity,
      routeDelta: line.quantity,
      routeId: input.routeId,
      refType: 'dispatch',
      refId: operationId,
    })
  })

  commitInBackground(batch, operationId, 'despacho')
  return operationId
}

export interface AddDispatchLoadInput {
  dispatch: DistDispatch
  lines: DistDispatchLine[]
  registeredByName: string
  note?: string
  operationId?: string
}

/** Aumento de carga sobre un despacho abierto, conservando el historial. */
export async function addDispatchLoad(input: AddDispatchLoadInput): Promise<string> {
  const operationId = input.operationId || newOperationId('add')
  if (isOperationApplied(operationId)) return operationId

  const context = await getContext()
  const createdAt = new Date().toISOString()
  const batch = writeBatch(context.db)

  const addition: DistDispatchAddition = {
    id: operationId,
    quantityByProduct: input.lines.map((line) => ({ ...line, quantity: round2(line.quantity) })),
    createdAt,
    createdBy: context.uid,
    createdByName: input.registeredByName,
    note: input.note || '',
  }

  // Se reescribe el arreglo completo (y no arrayUnion) para que el aumento
  // tambien quede aplicado en el cache local mientras se esta sin conexion.
  batch.set(
    docRef(context, DIST_COLLECTIONS.dispatches, input.dispatch.id),
    { additions: [...(input.dispatch.additions || []), addition] },
    { merge: true },
  )

  input.lines.forEach((line, index) => {
    appendMovement(batch, context, `${operationId}__line${index}`, createdAt, {
      type: 'dispatch_addition',
      productId: line.productId,
      productName: line.productName,
      unitType: line.unitType,
      quantity: line.quantity,
      centralDelta: -line.quantity,
      routeDelta: line.quantity,
      routeId: input.dispatch.routeId,
      refType: 'dispatch',
      refId: input.dispatch.id,
    })
  })

  commitInBackground(batch, operationId, 'aumento de carga')
  return operationId
}

// ---------------------------------------------------------------------------
// Ventas
// ---------------------------------------------------------------------------

export interface RegisterSaleInput {
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

/**
 * Registra una venta real: documento de venta + ledger + saldos + cuenta por
 * cobrar cuando hay credito. Funciona sin conexion.
 */
export async function registerSale(input: RegisterSaleInput): Promise<DistSale> {
  const context = await getContext()
  const createdAt = new Date().toISOString()

  const sale: DistSale = {
    id: input.operationId,
    operationId: input.operationId,
    ...baseDocFields(context, createdAt),
    sourceLocation: input.sourceLocation,
    routeId: input.routeId,
    routeName: input.routeName,
    sellerUid: input.sellerUid,
    sellerName: input.sellerName,
    dispatchId: input.dispatchId || '',
    customerId: input.customerId || '',
    customerName: input.customerName || '',
    lines: input.lines.map((line) => ({
      ...line,
      quantity: round2(line.quantity),
      actualUnitPrice: round2(line.actualUnitPrice),
      subtotal: round2(line.subtotal),
    })),
    total: round2(input.total),
    paymentKind: input.paymentKind,
    cashAmount: round2(input.cashAmount),
    qrAmount: round2(input.qrAmount),
    creditAmount: round2(input.creditAmount),
    note: input.note || '',
  }

  if (isOperationApplied(input.operationId)) return sale

  const batch = writeBatch(context.db)
  batch.set(docRef(context, DIST_COLLECTIONS.sales, input.operationId), sale)

  const fromCentral = input.sourceLocation === 'centralWarehouse'
  sale.lines.forEach((line, index) => {
    appendMovement(batch, context, `${input.operationId}__line${index}`, createdAt, {
      type: 'sale',
      productId: line.productId,
      productName: line.productNameSnapshot,
      unitType: line.unitType,
      quantity: line.quantity,
      centralDelta: fromCentral ? -line.quantity : 0,
      routeDelta: fromCentral ? 0 : -line.quantity,
      routeId: fromCentral ? undefined : input.routeId,
      refType: 'sale',
      refId: input.operationId,
    })
  })

  if (sale.creditAmount > 0 && input.customerId) {
    const receivable: DistReceivable = {
      id: input.operationId,
      ...baseDocFields(context, createdAt),
      saleId: input.operationId,
      customerId: input.customerId,
      customerName: input.customerName || '',
      routeId: input.routeId,
      distributorUid: input.sellerUid,
      distributorName: input.sellerName,
      originalAmount: sale.creditAmount,
      paidAmount: 0,
      balance: sale.creditAmount,
      status: 'OPEN',
      note: input.note || '',
    }
    batch.set(docRef(context, DIST_COLLECTIONS.receivables, input.operationId), receivable)
  }

  commitInBackground(batch, input.operationId, 'venta')
  return sale
}

// ---------------------------------------------------------------------------
// Cobranzas
// ---------------------------------------------------------------------------

export interface RegisterCollectionInput {
  operationId: string
  receivable: DistReceivable
  amount: number
  method: 'cash' | 'qr'
  collectedByUid: string
  collectedByName: string
  routeId: string
  note?: string
}

/**
 * Un cobro es un movimiento financiero, no una venta: no toca stock ni
 * salesTotal. Reduce el saldo de la cuenta por cobrar y conserva el historial.
 */
export async function registerCollection(input: RegisterCollectionInput): Promise<DistCollection> {
  const context = await getContext()
  const createdAt = new Date().toISOString()
  const amount = round2(input.amount)

  const collectionDoc: DistCollection = {
    id: input.operationId,
    operationId: input.operationId,
    ...baseDocFields(context, createdAt),
    receivableId: input.receivable.id,
    customerId: input.receivable.customerId,
    customerName: input.receivable.customerName,
    routeId: input.routeId,
    collectedByUid: input.collectedByUid,
    collectedByName: input.collectedByName,
    amount,
    method: input.method,
    note: input.note || '',
  }

  if (isOperationApplied(input.operationId)) return collectionDoc

  const paidAmount = round2(input.receivable.paidAmount + amount)
  const balance = round2(input.receivable.originalAmount - paidAmount)

  const batch = writeBatch(context.db)
  batch.set(docRef(context, DIST_COLLECTIONS.collections, input.operationId), collectionDoc)
  batch.set(
    docRef(context, DIST_COLLECTIONS.receivables, input.receivable.id),
    {
      paidAmount,
      balance,
      status: balance <= 0 ? 'PAID' : 'PARTIAL',
      updatedAt: createdAt,
    },
    { merge: true },
  )

  commitInBackground(batch, input.operationId, 'cobro')
  return collectionDoc
}

// ---------------------------------------------------------------------------
// Gastos
// ---------------------------------------------------------------------------

export interface RegisterExpenseInput {
  operationId: string
  concept: string
  amount: number
  routeId: string
  routeName: string
  registeredByUid: string
  registeredByName: string
  note?: string
}

export async function registerExpense(input: RegisterExpenseInput): Promise<DistExpense> {
  const context = await getContext()
  const createdAt = new Date().toISOString()

  const expense: DistExpense = {
    id: input.operationId,
    operationId: input.operationId,
    ...baseDocFields(context, createdAt),
    concept: input.concept.trim(),
    amount: round2(input.amount),
    routeId: input.routeId,
    routeName: input.routeName,
    registeredByUid: input.registeredByUid,
    registeredByName: input.registeredByName,
    note: input.note || '',
  }

  if (isOperationApplied(input.operationId)) return expense

  const batch = writeBatch(context.db)
  batch.set(docRef(context, DIST_COLLECTIONS.expenses, input.operationId), expense)
  commitInBackground(batch, input.operationId, 'gasto')
  return expense
}

// ---------------------------------------------------------------------------
// Retorno, conciliacion y cierre de ruta
// ---------------------------------------------------------------------------

export interface SaveClosureInput {
  closure: DistClosure
  /** Solo la primera vez que almacen registra el retorno se mueve el stock */
  applyStockReturn: boolean
}

/**
 * Guarda el arqueo. Cuando almacen confirma el retorno fisico:
 * - devuelve al almacen central exactamente lo retornado
 * - descarga la ruta por lo retornado y ajusta el faltante/sobrante,
 *   de modo que la ruta queda en cero y nunca se descuenta dos veces central.
 */
export async function saveClosure(input: SaveClosureInput): Promise<string> {
  const context = await getContext()
  const createdAt = new Date().toISOString()
  const closure = input.closure
  const batch = writeBatch(context.db)

  batch.set(
    docRef(context, DIST_COLLECTIONS.closures, closure.id),
    stripUndefined({ ...closure, updatedAt: createdAt }),
    { merge: true },
  )

  if (input.applyStockReturn) {
    closure.products.forEach((row, index) => {
      if (row.actualReturn > 0) {
        appendMovement(batch, context, `${closure.id}__ret${index}`, createdAt, {
          type: 'return',
          productId: row.productId,
          productName: row.productName,
          unitType: row.unitType,
          quantity: row.actualReturn,
          centralDelta: row.actualReturn,
          routeDelta: -row.actualReturn,
          routeId: closure.routeId,
          refType: 'closure',
          refId: closure.id,
        })
      }

      // El faltante/sobrante ajusta solo la ruta: el faltante no vuelve a
      // almacen porque fisicamente no existe.
      if (row.variance !== 0) {
        appendMovement(batch, context, `${closure.id}__var${index}`, createdAt, {
          type: row.variance < 0 ? 'shortage' : 'overage',
          productId: row.productId,
          productName: row.productName,
          unitType: row.unitType,
          quantity: Math.abs(row.variance),
          centralDelta: 0,
          routeDelta: row.variance,
          routeId: closure.routeId,
          refType: 'closure',
          refId: closure.id,
          note: row.variance < 0 ? 'Faltante de ruta' : 'Sobrante de ruta',
        })
      }
    })
  }

  if (closure.status === 'closed' && closure.dispatchId) {
    batch.set(
      docRef(context, DIST_COLLECTIONS.dispatches, closure.dispatchId),
      { status: 'closed', closedAt: createdAt, closureId: closure.id },
      { merge: true },
    )
  }

  commitInBackground(batch, `${closure.id}_${closure.status}_${createdAt}`, 'cierre de ruta')
  return closure.id
}

/** Reapertura administrativa de una ruta cerrada */
export async function reopenClosure(closure: DistClosure, reopenedBy: string): Promise<void> {
  const context = await getContext()
  const now = new Date().toISOString()
  const batch = writeBatch(context.db)

  batch.set(
    docRef(context, DIST_COLLECTIONS.closures, closure.id),
    { status: 'reopened', reopenedBy, reopenedAt: now },
    { merge: true },
  )
  if (closure.dispatchId) {
    batch.set(
      docRef(context, DIST_COLLECTIONS.dispatches, closure.dispatchId),
      { status: 'open', closedAt: '', closureId: '' },
      { merge: true },
    )
  }

  commitInBackground(batch, `reopen_${closure.id}_${now}`, 'reapertura de ruta')
}
