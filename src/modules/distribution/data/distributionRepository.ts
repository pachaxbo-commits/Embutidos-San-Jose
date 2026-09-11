import type { PendingOperation } from './operationQueue'
import { submitOperation } from './operationQueue'
import { normalizeCI } from '../domain/customerIdentity'
import {
  collection,
  runTransaction,
  getDocs,
  doc,
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
import { centralBalanceId, round2, toDayKey } from '../domain/engine'
import type {
  DistBalance,
  DistWarehouse,
  DistQrVerification,
  DistClosure,
  DistCollection,
  DistCustomer,
  DistDispatch,
  DistDispatchLine,
  DistExpense,
  DistProduct,
  DistReceivable,
  DistRoute,
  DistSale,
  DistSaleLine,
  DistStockMovement,
  DistLot, DistTransfer, DistClaim, DistCreditStatus,
  PaymentKind,
  SourceLocation,
} from '../types'
import { DEFAULT_SUPPORT_SETTINGS, type SupportSettings } from './supportMaintenance'

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
  warehouses: 'distWarehouses',
  qrVerifications: 'distQrVerifications',
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

export function warehouseBalanceId(warehouseId: string, productId: string): string {
  return warehouseId === 'central' ? centralBalanceId(productId) : `warehouse__${warehouseId}__${productId}`
}

export function subscribeWarehouses(onData: (rows: DistWarehouse[]) => void, onError?: (error: Error) => void) {
  return subscribeQuery<DistWarehouse>(ctx => collectionRef(ctx, DIST_COLLECTIONS.warehouses), onData, onError)
}

export function subscribeQrVerifications(routeId: string | null, onData: (rows: DistQrVerification[]) => void, onError?: (error: Error) => void) {
  return subscribeQuery<DistQrVerification>(ctx => {
    const ref = collectionRef(ctx, DIST_COLLECTIONS.qrVerifications)
    return routeId ? query(ref, where('routeId', '==', routeId)) : ref
  }, onData, onError)
}

export async function createWarehouse(name: string) {
  if (!name.trim()) throw new Error('Ingresa el nombre del almacen.')
  const ctx = await getContext()
  const id = newOperationId('wh')
  const batch = writeBatch(ctx.db)
  batch.set(docRef(ctx, DIST_COLLECTIONS.warehouses, id), { id, name: name.trim(), active: true, restaurantId: ctx.restaurantId })
  await batch.commit()
}

/** Transferencias administrativas conectadas: lectura y descuento atomicos. */
export async function transferWarehouseStock(from: string, to: string, line: DistDispatchLine, note: string, operationId: string) {
  await submitOperation('transfer', { from, to, line, note }, operationId)
}

export async function verifyQr(sourceType: 'sale' | 'collection' | 'claim', sourceId: string, reference: string) {
  if (!reference.trim()) throw new Error('Ingresa la referencia bancaria de la verificacion.')
  const ctx = await getContext()
  await runTransaction(ctx.db, async tx => {
    const verificationRef = docRef(ctx, DIST_COLLECTIONS.qrVerifications, `${sourceType}_${sourceId}`)
    if ((await tx.get(verificationRef)).exists()) return
    const source = await tx.get(docRef(ctx, sourceType === 'sale' ? DIST_COLLECTIONS.sales : sourceType === 'claim' ? 'distClaims' : DIST_COLLECTIONS.collections, sourceId))
    const data = source.data()
    const amount = sourceType === 'sale' ? data?.qrAmount : sourceType === 'claim' ? data?.qrIn : data?.method === 'qr' ? data.amount : 0
    if (!data || !(amount > 0)) throw new Error('No existe un pago QR pendiente para este movimiento.')
    tx.set(verificationRef, { id: `${sourceType}_${sourceId}`, restaurantId: ctx.restaurantId, routeId: data.routeId,
      sourceType, sourceId, amount, reference: reference.trim(), verifiedBy: ctx.uid, verifiedAt: new Date().toISOString() })
  })
}

/** Declarar retorno no modifica stock; almacen confirma la recepcion posteriormente. */
export async function declareRouteReturn(dispatch: DistDispatch, quantities: Record<string, number>) {
  if (Object.values(quantities).some(q => !Number.isFinite(q) || q < 0)) throw new Error('Las cantidades deben ser positivas o cero.')
  const ctx = await getContext()
  const id = `closure_${dispatch.id}`
  const batch = writeBatch(ctx.db)
  batch.set(docRef(ctx, DIST_COLLECTIONS.closures, id), {
    id, restaurantId: ctx.restaurantId, dispatchId: dispatch.id, routeId: dispatch.routeId,
    distributorUid: dispatch.distributorUid, distributorName: dispatch.distributorName,
    declaredReturns: quantities, returnDeclaredBy: ctx.uid, returnDeclaredAt: new Date().toISOString(),
    dayKey: dispatch.dayKey,
  }, { merge: true })
  commitInBackground(batch, newOperationId('return_declaration'), 'declaracion de retorno')
}
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
  if (!context.auth.currentUser) throw new Error('Inicia sesion para registrar operaciones.')
  return {
    db: context.db,
    restaurantId: context.restaurantId,
    uid: context.auth.currentUser?.uid ?? '',
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
  lastError?: string | null
  lastSyncedAt: string | null
}

let syncState: DistSyncState = {
  isOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
  pending: 0,
  hasUnsyncedWrites: false,
  lastError: localStorage.getItem('pachax_dist_sync_error'),
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
  const update = (event: Event) => {
    syncState = { ...syncState, isOnline: event.type === 'online' }
    emitSyncState()
  }
  window.addEventListener('distribution-operation-error', () => { syncState = { ...syncState, lastError: localStorage.getItem('pachax_dist_sync_error') }; emitSyncState() })
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
      appliedOperations.delete(operationId)
      localStorage.setItem(APPLIED_OPERATIONS_KEY, JSON.stringify([...appliedOperations]))
      const message = `No se guardó ${label}. Revisa los datos y registra nuevamente la operación. ${(error as Error).message}`
      localStorage.setItem('pachax_dist_sync_error', message)
      syncState = { ...syncState, lastError: message }
      emitSyncState()
      console.error(`[distribution] fallo al sincronizar ${label} (${operationId})`, error)
    })
}

/**
 * Firestore rechaza los campos con valor undefined. Un cierre en curso tiene
 * varios datos que todavia no ocurrieron, asi que se limpian antes de escribir.
 */
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
  return subscribeQuery<DistProduct>((context) => collectionRef(context, DIST_COLLECTIONS.products), rows => onData(rows.filter(product => !product.deleted)), onError)
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
  distributorUid?: string,
) {
  return subscribeQuery<DistDispatch>(
    (context) => {
      const base = collectionRef(context, DIST_COLLECTIONS.dispatches)
      if (distributorUid) return query(base, where('distributorUid', '==', distributorUid))
      return routeId
        ? query(base, where('status', '==', 'open'), where('routeId', '==', routeId))
        : query(base, where('status', '==', 'open'))
    },
    rows => onData(rows.filter(row => row.status === 'open')),
    onError,
  )
}

function subscribeDayScoped<T>(
  collectionName: string,
  dayKeys: string[],
  routeId: string | null,
  onData: (rows: T[]) => void,
  onError?: (error: Error) => void,
  owner?: { field: string; uid: string },
) {
  return subscribeQuery<T>(
    (context) => {
      const base = collectionRef(context, collectionName)
      const filters = []
      if (dayKeys.length === 1) filters.push(where('dayKey', '==', dayKeys[0]))
      else {
        const sorted = [...dayKeys].sort()
        filters.push(where('dayKey', '>=', sorted[0]), where('dayKey', '<=', sorted[sorted.length - 1]))
      }
      if (owner) filters.push(where(owner.field, '==', owner.uid))
      else if (routeId) filters.push(where('routeId', '==', routeId))
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
  distributorUid?: string,
) {
  return subscribeDayScoped<DistSale>(DIST_COLLECTIONS.sales, dayKeys, routeId, onData, onError, distributorUid ? { field: 'sellerUid', uid: distributorUid } : undefined)
}

export function subscribeCollections(
  dayKeys: string[],
  routeId: string | null,
  onData: (rows: DistCollection[]) => void,
  onError?: (error: Error) => void,
  distributorUid?: string,
) {
  return subscribeDayScoped<DistCollection>(DIST_COLLECTIONS.collections, dayKeys, routeId, onData, onError, distributorUid ? { field: 'collectedByUid', uid: distributorUid } : undefined)
}

export function subscribeExpenses(
  dayKeys: string[],
  routeId: string | null,
  onData: (rows: DistExpense[]) => void,
  onError?: (error: Error) => void,
  distributorUid?: string,
) {
  return subscribeDayScoped<DistExpense>(DIST_COLLECTIONS.expenses, dayKeys, routeId, rows => onData(rows.filter(expense => !expense.voided)), onError, distributorUid ? { field: 'registeredByUid', uid: distributorUid } : undefined)
}

/** Cartera global. Todos los roles con acceso a creditos ven la misma deuda. */
export function subscribeReceivables(
  routeId: string | null,
  onData: (rows: DistReceivable[]) => void,
  onError?: (error: Error) => void,
  distributorUid?: string,
) {
  return subscribeQuery<DistReceivable>(
    (context) => {
      const base = collectionRef(context, DIST_COLLECTIONS.receivables)
      if (distributorUid) return query(base, where('distributorUid', '==', distributorUid))
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
  distributorUid?: string,
) {
  void dayKeys
  return subscribeQuery<DistClosure>(
    ctx => distributorUid
      ? query(collectionRef(ctx, DIST_COLLECTIONS.closures), where('distributorUid', '==', distributorUid))
      : routeId ? query(collectionRef(ctx, DIST_COLLECTIONS.closures), where('routeId', '==', routeId)) : collectionRef(ctx, DIST_COLLECTIONS.closures),
    // Una declaración todavía no tiene conciliación física. La lista vacía
    // permite consultarla sin confundirla con una recepción confirmada.
    rows => onData(rows.map(row => ({ ...row, products: Array.isArray(row.products) ? row.products : [] }))),
    onError,
  )
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
  photoDataUrl?: string
  addressReference?: string
  id?: string
  name: string
  customerCode?: string
  identityNumber?: string
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

  if (!input.name.trim()) throw new Error('El nombre es obligatorio.')
  const identityNumber = normalizeCI(input.identityNumber || '')
  if (!identityNumber) throw new Error('El CI del cliente es obligatorio.')
  if (input.photoDataUrl && (!input.photoDataUrl.startsWith('data:image/jpeg;base64,') || input.photoDataUrl.length > 130000)) throw new Error('La fotografía supera el tamaño permitido.')
  const duplicates = await getDocs(query(collectionRef(context, DIST_COLLECTIONS.customers), where('identityNumber', '==', identityNumber)))
  if (duplicates.docs.some(customer => customer.id !== id)) throw new Error('Ya existe un cliente con este CI. Busca su registro para evitar duplicarlo.')
  const customer: DistCustomer = {
    id,
    name: input.name.trim(),
    customerCode: identityNumber,
    identityNumber,
    photoDataUrl: input.photoDataUrl || '',
    addressReference: input.addressReference?.trim() || '',
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

  await runTransaction(context.db, async tx => {
    const ref = docRef(context, DIST_COLLECTIONS.customers, id)
    const previous = await tx.get(ref)
    const identityRef = docRef(context, 'distCustomerIdentities', identityNumber)
    const reserved = await tx.get(identityRef)
    if (reserved.exists() && reserved.data().customerId !== id) throw new Error('Este CI ya pertenece a otro cliente.')
    if (previous.exists()) {
      customer.createdAt = previous.data().createdAt
      customer.createdBy = previous.data().createdBy
    }
    tx.set(identityRef, { restaurantId: context.restaurantId, customerId: id, identityNumber })
    tx.set(ref, customer, { merge: true })
    const oldCI = previous.data()?.identityNumber
    if (oldCI && oldCI !== identityNumber) tx.delete(docRef(context, 'distCustomerIdentities', oldCI))
  })
  return customer
}

// ---------------------------------------------------------------------------
// Movimientos de stock
// ---------------------------------------------------------------------------

/** Ingreso de mercaderia al almacen central */
export async function registerIntake(lines: DistDispatchLine[], note: string, operationId = newOperationId('intake')) {
  await submitOperation('intake', { lines, note }, operationId)
  return operationId
}

/** Ajuste manual de almacen central (puede ser negativo) */
export async function registerAdjustment(
  line: DistDispatchLine,
  note: string,
  operationId = newOperationId('adjust'),
  warehouseId = 'central',
) {
  await submitOperation('adjustment', { line, note, warehouseId }, operationId)
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
  warehouseId?: string
  operationId?: string
}

/** Confirma un despacho: descuenta central y carga la ruta (una sola vez). */
export async function confirmDispatch(input: ConfirmDispatchInput): Promise<string> {
  const id = input.operationId || newOperationId('disp')
  await submitOperation('dispatch', input, id)
  return id
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
  const id = input.operationId || newOperationId('add')
  await submitOperation('addition', input, id)
  return id
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
  customerCode?: string
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
  const provisional = { ...input, ...baseDocFields(context, new Date().toISOString()), id: input.operationId, pendingConfirmation: true } as DistSale
  return submitOperation<DistSale>('sale', input, input.operationId, provisional)
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
  const provisional = { ...baseDocFields(context, new Date().toISOString()), id: input.operationId, operationId: input.operationId, receivableId: input.receivable.id, customerId: input.receivable.customerId, customerName: input.receivable.customerName, routeId: input.routeId, collectedByUid: context.uid, collectedByName: input.collectedByName, amount: input.amount, method: input.method } as DistCollection
  return submitOperation<DistCollection>('collection', input, input.operationId, provisional)
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
  const provisional = { ...input, ...baseDocFields(context, new Date().toISOString()), id: input.operationId } as DistExpense
  return submitOperation<DistExpense>('expense', input, input.operationId, provisional)
}

export function subscribeSupportSettings(onData: (settings: SupportSettings) => void, onError?: (error: Error) => void) {
  return subscribeQuery<SupportSettings>(ctx => collectionRef(ctx, 'supportConfig'), rows => onData({ ...DEFAULT_SUPPORT_SETTINGS, ...(rows[0] || {}) }), onError)
}

export async function deleteExpense(expenseId: string): Promise<void> {
  await submitOperation('deleteExpense', { expenseId }, newOperationId('delete-expense'))
}

export async function deleteProduct(productId: string): Promise<void> {
  await submitOperation('deleteProduct', { productId }, newOperationId('delete-product'))
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
  await submitOperation('closure', { ...input, mode: input.applyStockReturn ? 'warehouse' : 'money' }, newOperationId('closure'))
  return input.closure.id
}

/** Reapertura administrativa de una ruta cerrada */
export async function reopenClosure(closure: DistClosure, _reopenedBy: string): Promise<void> {
  await submitOperation('reopen', { closureId: closure.id }, newOperationId('reopen'))
}

export function subscribeLots(onData: (rows: DistLot[]) => void, onError?: (error: Error) => void) { return subscribeQuery<DistLot>(ctx => collectionRef(ctx, 'distLots'), onData, onError) }
export function subscribeOperations(onData: (rows: PendingOperation[]) => void, onError?: (error: Error) => void) { return subscribeQuery<PendingOperation>(ctx => query(collectionRef(ctx, 'distOperations'), where('createdBy', '==', ctx.uid), where('status', 'in', ['queued', 'rejected'])), onData, onError) }
export function subscribeMovements(onData: (rows: DistStockMovement[]) => void, onError?: (error: Error) => void) { return subscribeQuery<DistStockMovement>(ctx => collectionRef(ctx, 'distStockMovements'), onData, onError) }
export function subscribeTransfers(onData: (rows: DistTransfer[]) => void, onError?: (error: Error) => void) { return subscribeQuery<DistTransfer>(ctx => collectionRef(ctx, 'distTransfers'), onData, onError) }
export function subscribeClaims(routeId: string | null, onData: (rows: DistClaim[]) => void, onError?: (error: Error) => void) { return subscribeQuery<DistClaim>(ctx => routeId ? query(collectionRef(ctx, 'distClaims'), where('routeId', '==', routeId)) : collectionRef(ctx, 'distClaims'), onData, onError) }
export function subscribeCreditStatus(onData: (rows: DistCreditStatus[]) => void, onError?: (error: Error) => void) { return subscribeQuery<DistCreditStatus>(ctx => collectionRef(ctx, 'distCreditStatus'), onData, onError) }
export async function registerClaim(payload: Record<string, unknown>, operationId: string) { return submitOperation<DistClaim>('claim', payload, operationId) }

export function dismissSyncError() {
  localStorage.removeItem('pachax_dist_sync_error')
  syncState = { ...syncState, lastError: null }
  emitSyncState()
}
