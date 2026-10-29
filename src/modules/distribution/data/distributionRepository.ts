import type { PendingOperation } from './operationQueue'
import { submitOperation } from './operationQueue'
import { normalizeCI } from '../domain/customerIdentity'
import type { ProvisionalCollectionSnapshot } from '../domain/provisionalCollection'
import {
  collection,
  runTransaction,
  getDocs,
  getDocsFromServer,
  getDoc,
  getDocFromServer,
  doc,
  deleteField,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  documentId,
  writeBatch,
  type DocumentData,
  type Firestore,
  type Query,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type Unsubscribe,
  type WriteBatch,
} from 'firebase/firestore'
import { assertFirebaseWritesAllowed, getFirebaseContext } from '../../../lib/firebase'
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
  DistExpenseCategory,
  DistExpenseGroup,
  DistSupplier,
  DistPayable,
  DistSupplierPayment,
  ExpenseGroupId,
  ExpenseEconomicType,
  DistProduct,
  DistReceivable,
  DistReceivableAdjustment,
  DistSaleCorrection,
  DistRoute,
  DistSale,
  DistSaleLine,
  DistQuote,
  DistStockMovement,
  DistLot, DistTransfer, DistClaim, DistCreditStatus, DistCreditOverride, DistAdjustmentRequest,
  PaymentKind,
  SourceLocation,
  UnitType,
  SupplierPurchaseLine,
} from '../types'
import { DEFAULT_SUPPORT_SETTINGS, type SupportSettings } from './supportMaintenance'
import { recordQrVerification, type QrSourceType } from './qrVerification'

/**
 * Repositorio de distribucion movil.
 *
 * Offline: se apoya en la persistencia local ya configurada de Firestore
 * (persistentLocalCache + multi-tab) de la aplicación. No hay
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
  receivableAdjustments: 'distReceivableAdjustments',
  collections: 'distCollections',
  expenses: 'distExpenses',
  expenseCategories: 'distExpenseCategories',
  expenseGroups: 'distExpenseGroups',
  suppliers: 'distSuppliers',
  payables: 'distPayables',
  supplierPayments: 'distSupplierPayments',
  closures: 'distClosures',
  adjustmentRequests: 'distAdjustmentRequests',
  quotes: 'distQuotes',
  saleCorrections: 'distSaleCorrections',
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
  const ctx = await getContext(true)
  const id = newOperationId('wh')
  const batch = writeBatch(ctx.db)
  batch.set(docRef(ctx, DIST_COLLECTIONS.warehouses, id), { id, name: name.trim(), active: true, restaurantId: ctx.restaurantId })
  await batch.commit()
}

/** Transferencias administrativas conectadas: lectura y descuento atomicos. */
export async function transferWarehouseStock(from: string, to: string, line: DistDispatchLine, note: string, operationId: string) {
  await submitOperation('transfer', { from, to, line, note }, operationId)
}

export async function verifyQr(sourceType: QrSourceType, sourceId: string, reference: string, expectedRevision?: number) {
  const ctx = await getContext(true)
  return recordQrVerification(ctx.db, ctx.restaurantId, ctx.uid, sourceType, sourceId, reference, expectedRevision)
}

import { normalizeClosure } from '../domain/closurePeriod'
export { normalizeClosure }

/** La declaración no modifica stock; almacén confirma después las cantidades físicas. */
export async function declareRouteReturn(
  dispatch: DistDispatch,
  quantities: Record<string, number>,
  physicalCashDeclared?: number,
) {
  if (Object.values(quantities).some(q => !Number.isFinite(q) || q < 0)) {
    throw new Error('Las cantidades deben ser positivas o cero.')
  }
  if (physicalCashDeclared !== undefined && (!Number.isFinite(physicalCashDeclared) || physicalCashDeclared < 0)) {
    throw new Error('El efectivo físico declarado debe ser mayor o igual a cero.')
  }
  await submitOperation('closure', {
    mode: 'declaration',
    dispatchId: dispatch.id,
    declaredReturns: quantities,
    // Las declaraciones nuevas solo registran cantidades normales. El almacén
    // es el único que crea el desglose de merma recuperable en la recepción.
    declaredReturnMermas: {},
    ...(physicalCashDeclared !== undefined ? { physicalCashDeclared } : {}),
  }, `closure-declaration_${dispatch.id}`)
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

async function getContext(forWrite = false): Promise<RepoContext> {
  const context = await getFirebaseContext()
  if (!context) throw new Error('Firebase no esta configurado.')
  if (forWrite) assertFirebaseWritesAllowed(context.app.options.projectId)
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
  lastErrorDetails?: { operationType?: string; operationId?: string; occurredAt?: string; errorCode?: string; legacy?: boolean } | null
  lastSyncedAt: string | null
}

const SYNC_ERROR_KEY = 'pachax_dist_sync_error'
function readStoredSyncError(): Pick<DistSyncState, 'lastError' | 'lastErrorDetails'> {
  try {
    const stored = localStorage.getItem(SYNC_ERROR_KEY)
    if (!stored) return { lastError: null, lastErrorDetails: null }
    try {
      const parsed = JSON.parse(stored) as { message?: unknown; operationType?: unknown; operationId?: unknown; occurredAt?: unknown; errorCode?: unknown }
      if (typeof parsed?.message === 'string') return {
        lastError: parsed.message,
        lastErrorDetails: {
          ...(typeof parsed.operationType === 'string' ? { operationType: parsed.operationType } : {}),
          ...(typeof parsed.operationId === 'string' ? { operationId: parsed.operationId } : {}),
          ...(typeof parsed.occurredAt === 'string' ? { occurredAt: parsed.occurredAt } : {}),
          ...(typeof parsed.errorCode === 'string' ? { errorCode: parsed.errorCode } : {}),
        },
      }
    } catch { /* pre-metadata errors were stored as plain text */ }
    return { lastError: stored, lastErrorDetails: { legacy: true } }
  } catch {
    return { lastError: null, lastErrorDetails: null }
  }
}

let syncState: DistSyncState = {
  isOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
  pending: 0,
  hasUnsyncedWrites: false,
  ...readStoredSyncError(),
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
  window.addEventListener('distribution-operation-error', () => { syncState = { ...syncState, ...readStoredSyncError() }; emitSyncState() })
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
      const failure = error as Error & { code?: string }
      const message = `No se confirmó ${label}. Verifica el estado antes de intentar registrarla nuevamente. ${failure.message}`
      const details = { operationId, operationType: label, occurredAt: new Date().toISOString(), ...(failure.code ? { errorCode: failure.code } : {}) }
      localStorage.setItem(SYNC_ERROR_KEY, JSON.stringify({ message, ...details }))
      syncState = { ...syncState, lastError: message, lastErrorDetails: details }
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

/** Despachos cerrados. Con routeId se limita a la ruta del distribuidor. */
export function subscribeClosedDispatches(
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
        ? query(base, where('status', '==', 'closed'), where('routeId', '==', routeId))
        : query(base, where('status', '==', 'closed'))
    },
    rows => onData(
      rows
        .filter(row => row.status === 'closed')
        .sort((a, b) => (b.closedAt || b.createdAt).localeCompare(a.closedAt || a.createdAt))
    ),
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
  return subscribeDayScoped<DistSale>(
    DIST_COLLECTIONS.sales,
    dayKeys,
    routeId,
    rows =>
      onData(
        rows.map(row => {
          if (row.effectiveSnapshot) {
            return {
              ...row,
              ...row.effectiveSnapshot,
              originalSnapshot: {
                lines: row.lines,
                total: row.total,
                paymentKind: row.paymentKind,
                cashAmount: row.cashAmount,
                qrAmount: row.qrAmount,
                creditAmount: row.creditAmount,
              },
            }
          }
          return row
        }),
      ),
    onError,
    distributorUid ? { field: 'sellerUid', uid: distributorUid } : undefined,
  )
}

export function subscribeQuotes(isAdmin: boolean, onData: (rows: DistQuote[]) => void, onError?: (error: Error) => void) {
  return subscribeQuery<DistQuote>(context => {
    const ref = collectionRef(context, DIST_COLLECTIONS.quotes)
    return isAdmin ? ref : query(ref, where('sellerUid', '==', context.uid))
  }, onData, onError)
}

export async function createQuote(payload: Record<string, unknown>) {
  const id = newOperationId('quote')
  return submitOperation<DistQuote>('quoteCreate', payload, id)
}

export async function updateQuote(quoteId: string, payload: Record<string, unknown>) {
  return submitOperation<DistQuote>('quoteUpdate', { quoteId, ...payload }, newOperationId('quote-edit'))
}

export async function deleteQuote(quoteId: string) {
  return submitOperation<DistQuote>('quoteDelete', { quoteId }, newOperationId('quote-delete'))
}

export async function correctSale(input: { saleId: string; reason: string; lines: DistSaleLine[]; paymentKind: PaymentKind; cashAmount: number; qrAmount: number; creditAmount: number }): Promise<void> {
  await submitOperation('editSale', input, newOperationId('sale-correction'))
}

export async function voidSale(input: { saleId: string; reason: string }): Promise<void> {
  await submitOperation('voidSale', input, newOperationId('sale-void'))
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
  return subscribeDayScoped<DistExpense>(DIST_COLLECTIONS.expenses, dayKeys, routeId, onData, onError, distributorUid ? { field: 'registeredByUid', uid: distributorUid } : undefined)
}

export function subscribeExpenseCategories(onData: (rows: DistExpenseCategory[]) => void, onError?: (error: Error) => void) {
  return subscribeQuery<DistExpenseCategory>(ctx => collectionRef(ctx, DIST_COLLECTIONS.expenseCategories), onData, onError)
}

export function subscribeExpenseGroups(onData: (rows: DistExpenseGroup[]) => void, onError?: (error: Error) => void) {
  return subscribeQuery<DistExpenseGroup>(ctx => collectionRef(ctx, DIST_COLLECTIONS.expenseGroups), onData, onError)
}

export function subscribeExpenseSuppliers(onData: (rows: DistSupplier[]) => void, onError?: (error: Error) => void) {
  return subscribeQuery<DistSupplier>(ctx => collectionRef(ctx, DIST_COLLECTIONS.suppliers), onData, onError)
}

export function subscribeExpensePayables(onData: (rows: DistPayable[]) => void, onError?: (error: Error) => void) {
  return subscribeQuery<DistPayable>(ctx => collectionRef(ctx, DIST_COLLECTIONS.payables), onData, onError)
}

export function subscribeSupplierPayments(onData: (rows: DistSupplierPayment[]) => void, onError?: (error: Error) => void) {
  return subscribeQuery<DistSupplierPayment>(ctx => collectionRef(ctx, DIST_COLLECTIONS.supplierPayments), onData, onError)
}

async function loadAllDayKeyPages<T>(collectionName: string, fromDay?: string, toDay?: string): Promise<T[]> {
  const context = await getContext()
  const pageSize = 200
  const rows: T[] = []
  let cursor: QueryDocumentSnapshot<DocumentData> | undefined
  while (true) {
    const constraints: QueryConstraint[] = []
    if (fromDay) constraints.push(where('dayKey', '>=', fromDay))
    if (toDay) constraints.push(where('dayKey', '<=', toDay))
    constraints.push(orderBy('dayKey', 'desc'), limit(pageSize))
    if (cursor) constraints.push(startAfter(cursor))
    const snapshot = await getDocsFromServer(query(collectionRef(context, collectionName), ...constraints))
    rows.push(...snapshot.docs.map((row) => ({ ...row.data(), id: row.id }) as T))
    if (snapshot.size < pageSize) break
    cursor = snapshot.docs[snapshot.docs.length - 1]
  }
  return rows
}

async function loadAllCreatedAtPages<T>(collectionName: string, fromDay?: string, toDay?: string): Promise<T[]> {
  const context = await getContext()
  const pageSize = 200
  const rows: T[] = []
  let cursor: QueryDocumentSnapshot<DocumentData> | undefined
  const localMidnightUtc = (day: string) => new Date(`${day}T00:00:00-04:00`).toISOString()
  const nextDay = (day: string) => {
    const value = new Date(`${day}T12:00:00.000Z`)
    value.setUTCDate(value.getUTCDate() + 1)
    return value.toISOString().slice(0, 10)
  }
  while (true) {
    const constraints: QueryConstraint[] = []
    if (fromDay) constraints.push(where('createdAt', '>=', localMidnightUtc(fromDay)))
    if (toDay) constraints.push(where('createdAt', '<', localMidnightUtc(nextDay(toDay))))
    constraints.push(orderBy('createdAt', 'asc'), orderBy(documentId(), 'asc'), limit(pageSize))
    if (cursor) constraints.push(startAfter(cursor))
    const snapshot = await getDocsFromServer(query(collectionRef(context, collectionName), ...constraints))
    rows.push(...snapshot.docs.map((row) => ({ ...row.data(), id: row.id }) as T))
    if (snapshot.size < pageSize) break
    cursor = snapshot.docs[snapshot.docs.length - 1]
  }
  return rows
}

async function loadAllDocumentIdPages<T>(collectionName: string): Promise<T[]> {
  const context = await getContext()
  const pageSize = 200
  const rows: T[] = []
  let cursor: QueryDocumentSnapshot<DocumentData> | undefined
  while (true) {
    const constraints: QueryConstraint[] = [orderBy(documentId(), 'asc'), limit(pageSize)]
    if (cursor) constraints.push(startAfter(cursor))
    const snapshot = await getDocsFromServer(query(collectionRef(context, collectionName), ...constraints))
    rows.push(...snapshot.docs.map((row) => ({ ...row.data(), id: row.id }) as T))
    if (snapshot.size < pageSize) break
    cursor = snapshot.docs[snapshot.docs.length - 1]
  }
  return rows
}

export async function loadAllExpenseReportRows(fromDay?: string, toDay?: string): Promise<DistExpense[]> {
  const boliviaDayKeyFromCreatedAt = (createdAt: unknown) => {
    const date = createdAt instanceof Date ? createdAt : new Date(createdAt as string | number)
    if (Number.isNaN(date.getTime())) return 'Fecha no disponible'
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
    const part = (type: string) => parts.find(item => item.type === type)?.value || ''
    return `${part('year')}-${part('month')}-${part('day')}`
  }
  if (!fromDay && !toDay) {
    const allRows = await loadAllDocumentIdPages<DistExpense>(DIST_COLLECTIONS.expenses)
    return allRows.map((row) => ({
      ...row,
      dayKey: row.dayKey || (row.createdAt ? boliviaDayKeyFromCreatedAt(row.createdAt) : 'Fecha no disponible'),
    }))
  }
  const [keyedRows, createdAtRows] = await Promise.all([
    loadAllDayKeyPages<DistExpense>(DIST_COLLECTIONS.expenses, fromDay, toDay),
    loadAllCreatedAtPages<DistExpense>(DIST_COLLECTIONS.expenses, fromDay, toDay),
  ])
  const uniqueRows = new Map([...keyedRows, ...createdAtRows.filter((row) => !row.dayKey)].map((row) => [row.id, row]))
  return [...uniqueRows.values()].map((row) => ({
    ...row,
    ...(row.dayKey ? {} : { dayKey: row.createdAt ? boliviaDayKeyFromCreatedAt(row.createdAt) : 'Fecha no disponible' }),
  }))
}

export async function loadAllSupplierPayables(fromDay?: string, toDay?: string): Promise<DistPayable[]> {
  return loadAllDayKeyPages<DistPayable>(DIST_COLLECTIONS.payables, fromDay, toDay)
}

export async function loadAllSupplierPayments(fromDay?: string, toDay?: string): Promise<DistSupplierPayment[]> {
  return loadAllDayKeyPages<DistSupplierPayment>(DIST_COLLECTIONS.supplierPayments, fromDay, toDay)
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

/**
 * Carga, solo para exportación, el estado completo y confirmado de un cliente.
 * La consulta se hace al servidor para no presentar una cartera parcial desde
 * caché/offline; los distribuidores quedan limitados a sus propios créditos y
 * cobros. Las reglas Firestore siguen siendo la autoridad final.
 */
export async function loadCustomerCreditStatementData(customerId: string, distributorUid?: string): Promise<{
  receivables: DistReceivable[]
  collections: DistCollection[]
  sales: DistSale[]
}> {
  const context = await getContext()
  const receivablesRef = collectionRef(context, DIST_COLLECTIONS.receivables)
  const collectionsRef = collectionRef(context, DIST_COLLECTIONS.collections)
  const receivableQuery = distributorUid
    ? query(receivablesRef, where('distributorUid', '==', distributorUid))
    : query(receivablesRef, where('customerId', '==', customerId))
  const collectionQuery = distributorUid
    ? query(collectionsRef, where('collectedByUid', '==', distributorUid))
    : query(collectionsRef, where('customerId', '==', customerId))

  const [receivablesSnapshot, collectionsSnapshot] = await Promise.all([
    getDocsFromServer(receivableQuery),
    getDocsFromServer(collectionQuery),
  ])
  const receivables = receivablesSnapshot.docs
    .map((entry) => ({ id: entry.id, ...entry.data() }) as DistReceivable)
    .filter((row) => row.customerId === customerId && (!distributorUid || row.distributorUid === distributorUid))
  const collections = collectionsSnapshot.docs
    .map((entry) => ({ id: entry.id, ...entry.data() }) as DistCollection)
    .filter((row) => row.customerId === customerId && (!distributorUid || row.collectedByUid === distributorUid))
    .filter((row) => !row.pendingConfirmation)

  const linkedSaleIds = [...new Set(receivables
    .filter((row) => !row.saleLines?.length && row.saleId)
    .map((row) => row.saleId!))]
  const sales = (await Promise.all(linkedSaleIds.map(async (saleId) => {
    try {
      const snapshot = await getDocFromServer(docRef(context, 'distSales', saleId))
      if (!snapshot.exists()) return null
      const sale = { id: snapshot.id, ...snapshot.data() } as DistSale
      if (distributorUid && sale.sellerUid !== distributorUid) return null
      return sale
    } catch (error) {
      const code = (error as { code?: string }).code
      if (code === 'permission-denied' || code === 'firestore/permission-denied') return null
      throw error
    }
  }))).filter((sale): sale is DistSale => sale !== null)

  return { receivables, collections, sales }
}

/**
 * Recupera por ID de cliente todo el historial disponible desde Firestore,
 * página por página. No depende de los días que mantiene el store en vivo y
 * no descarga ventas de otros clientes. Una consulta incompleta falla completa.
 */
export async function loadCustomerFullHistory(customer: Pick<DistCustomer, 'id' | 'name'>): Promise<{
  sales: DistSale[]
  saleCorrections: DistSaleCorrection[]
  receivables: DistReceivable[]
  collections: DistCollection[]
  receivableAdjustments: DistReceivableAdjustment[]
  unlinkedNameMatches: Array<{ id: string; createdAt: string; customerName?: string; routeName?: string; sellerName?: string; total?: number }>
}> {
  const context = await getContext()
  const pageSize = 200
  const readAll = async <T,>(collectionName: string, field: string, value: string | string[]): Promise<T[]> => {
    const result: T[] = []
    let cursor: QueryDocumentSnapshot<DocumentData> | null = null
    while (true) {
      const constraints: QueryConstraint[] = [where(field, Array.isArray(value) ? 'in' : '==', value), orderBy(documentId(), 'asc')]
      if (cursor) constraints.push(startAfter(cursor))
      constraints.push(limit(pageSize))
      const snapshot = await getDocsFromServer(query(collectionRef(context, collectionName), ...constraints))
      result.push(...snapshot.docs.map(entry => ({ id: entry.id, ...entry.data() }) as T))
      if (snapshot.docs.length < pageSize) break
      cursor = snapshot.docs[snapshot.docs.length - 1]
    }
    return result
  }
  const [sales, receivables, collections, receivableAdjustments] = await Promise.all([
    readAll<DistSale>(DIST_COLLECTIONS.sales, 'customerId', customer.id),
    readAll<DistReceivable>(DIST_COLLECTIONS.receivables, 'customerId', customer.id),
    readAll<DistCollection>(DIST_COLLECTIONS.collections, 'customerId', customer.id),
    readAll<DistReceivableAdjustment>(DIST_COLLECTIONS.receivableAdjustments, 'customerId', customer.id),
  ])
  const linkedSaleIds = new Set(sales.map(sale => sale.id))
  // Legacy records may keep an earlier spelling of the same customer's name.
  // Search name snapshots from this customer's linked debt/payment docs only
  // to surface candidates; they are never silently assigned to the customer.
  const nameAliases = [...new Set([customer.name, ...receivables.map(row => row.customerName), ...collections.map(row => row.customerName)].map(name => name?.trim()).filter((name): name is string => Boolean(name)))]
  const nameChunks: string[][] = []
  for (let index = 0; index < nameAliases.length; index += 30) nameChunks.push(nameAliases.slice(index, index + 30))
  const nameMatchPages = await Promise.all(nameChunks.map(names => readAll<{ id: string; createdAt: string; customerId?: string; customerName?: string; routeName?: string; sellerName?: string; total?: number }>(DIST_COLLECTIONS.sales, 'customerName', names)))
  const nameMatches = [...new Map(nameMatchPages.flat().filter(sale => !sale.customerId && !linkedSaleIds.has(sale.id)).map(sale => [sale.id, sale])).values()]
  const saleIdList = [...linkedSaleIds]
  const correctionChunks: string[][] = []
  for (let index = 0; index < saleIdList.length; index += 30) correctionChunks.push(saleIdList.slice(index, index + 30))
  const correctionsBySale = await Promise.all(correctionChunks.map(ids => readAll<DistSaleCorrection>(DIST_COLLECTIONS.saleCorrections, 'saleId', ids)))
  const saleCorrections = correctionsBySale.flat().sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  return { sales, saleCorrections, receivables, collections, receivableAdjustments, unlinkedNameMatches: nameMatches }
}

export interface ProductMovementCursor { createdAt: string; id: string }

/** Consulta del servidor paginada para el Kardex, independiente del rango que mantiene el store en vivo. */
export async function loadProductMovementPage(productId: string, cursor: ProductMovementCursor | null, pageSize = 100): Promise<{
  movements: DistStockMovement[]
  nextCursor: ProductMovementCursor | null
  hasMore: boolean
}> {
  const context = await getContext()
  const constraints: QueryConstraint[] = [where('productId', '==', productId), orderBy('createdAt', 'desc'), orderBy(documentId(), 'desc')]
  if (cursor) constraints.push(startAfter(cursor.createdAt, cursor.id))
  constraints.push(limit(pageSize + 1))
  const snapshot = await getDocsFromServer(query(collectionRef(context, DIST_COLLECTIONS.movements), ...constraints))
  const pageDocs = snapshot.docs.slice(0, pageSize)
  const last = pageDocs.at(-1)
  return {
    movements: pageDocs.map((entry) => ({ id: entry.id, ...entry.data() }) as DistStockMovement),
    nextCursor: last ? { createdAt: String(last.data().createdAt || ''), id: last.id } : cursor,
    hasMore: snapshot.docs.length > pageSize,
  }
}

/** Saldo físico guardado en Firestore (no una proyección optimista del store). */
export async function loadProductLocationBalance(productId: string, selectedLocation: string): Promise<number | null> {
  const context = await getContext()
  if (selectedLocation === 'all') return null
  const ref = docRef(context, DIST_COLLECTIONS.balances, `${selectedLocation}__${productId}`)
  const snapshot = await getDocFromServer(ref)
  if (!snapshot.exists()) return 0
  const quantity = Number(snapshot.data().quantity)
  return Number.isFinite(quantity) ? quantity : null
}

/** Historial inmutable de ajustes de cartera: solo Administración lo consulta. */
export function subscribeReceivableAdjustments(
  onData: (rows: DistReceivableAdjustment[]) => void,
  onError?: (error: Error) => void,
) {
  return subscribeQuery<DistReceivableAdjustment>(
    (context) => collectionRef(context, DIST_COLLECTIONS.receivableAdjustments),
    (rows) => onData(rows.sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt))),
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
  // Se conserva el historial completo porque Cierre y el panel de diferencias
  // pendientes lo necesitan. Dashboard aplica el rango elegido al resumen.
  void dayKeys
  return subscribeQuery<DistClosure>(
    ctx => distributorUid
      ? query(collectionRef(ctx, DIST_COLLECTIONS.closures), where('distributorUid', '==', distributorUid))
      : routeId ? query(collectionRef(ctx, DIST_COLLECTIONS.closures), where('routeId', '==', routeId)) : collectionRef(ctx, DIST_COLLECTIONS.closures),
    // Normaliza completamente cada cierre (sea parcial o histórico) para evitar
    // campos incompletos y excepciones de renderizado en el cliente.
    rows => onData(rows.map(row => normalizeClosure(row as Partial<DistClosure> & { id: string }))),
    onError,
  )
}

// ---------------------------------------------------------------------------
// Catalogo, rutas y clientes
// ---------------------------------------------------------------------------

export async function saveProduct(product: Omit<DistProduct, 'restaurantId' | 'createdAt'> & { createdAt?: string }) {
  const context = await getContext(true)
  const batch = writeBatch(context.db)
  const now = new Date().toISOString()
  batch.set(
    docRef(context, DIST_COLLECTIONS.products, product.id),
    {
      ...product,
      approximateWeightKg: product.approximateWeightKg === undefined ? deleteField() : product.approximateWeightKg,
      documentedPackageWeightKg: product.documentedPackageWeightKg === undefined ? deleteField() : product.documentedPackageWeightKg,
      referencePrice: round2(product.referencePrice),
      restaurantId: context.restaurantId,
      createdAt: product.createdAt ?? now,
      updatedAt: now,
    },
    { merge: true },
  )
  commitInBackground(batch, `product_${product.id}_${now}`, 'producto')
}

export async function changeProductUnit(productId: string, unitType: UnitType): Promise<void> {
  await submitOperation('changeProductUnit', { productId, unitType }, newOperationId('product-unit'))
}

export async function openWarehouseShift(warehouseId: string, responsibleName: string): Promise<void> {
  await submitOperation('warehouseShift', { warehouseId, responsibleName }, newOperationId('warehouse-shift'))
}

export async function saveRoute(route: Omit<DistRoute, 'restaurantId' | 'createdAt'> & { createdAt?: string }) {
  const context = await getContext(true)
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
  const context = await getContext(true)
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
  await submitOperation('intake', { lines, note, warehouseResponsibleName: localStorage.getItem('sanjose_warehouse_responsible') || '' }, operationId)
  return operationId
}

/** Ajuste manual de almacen central (puede ser negativo) */
export async function registerAdjustment(
  line: DistDispatchLine,
  note: string,
  operationId = newOperationId('adjust'),
  warehouseId = 'central',
) {
  await submitOperation('adjustment', { line, note, warehouseId, warehouseResponsibleName: localStorage.getItem('sanjose_warehouse_responsible') || '' }, operationId)
  return operationId
}

export async function requestAdjustment(line: DistDispatchLine, note: string, operationId = newOperationId('adjust-request'), warehouseId = 'central') {
  await submitOperation('adjustmentRequest', { line, note, warehouseId, warehouseResponsibleName: localStorage.getItem('sanjose_warehouse_responsible') || '' }, operationId)
  return operationId
}

export async function reviewAdjustmentRequest(requestId: string, approve: boolean, operationId = newOperationId('adjust-review')) {
  await submitOperation('reviewAdjustmentRequest', { requestId, approve }, operationId)
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
  warehouseResponsibleName: string
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
  warehouseResponsibleName: string
  operationId?: string
}

/** Aumento de carga sobre un despacho abierto, conservando el historial. */
export async function addDispatchLoad(input: AddDispatchLoadInput): Promise<string> {
  const id = input.operationId || newOperationId('add')
  await submitOperation('addition', input, id)
  return id
}

export interface DispatchCorrectionChange {
  targetType: 'initial' | 'addition'
  additionId?: string
  productId?: string
  newQuantity?: number
  newDispatchMerma?: number
  voidAddition?: boolean
  lotId?: string
}

export interface CorrectDispatchInput {
  dispatchId: string
  targetType?: 'initial' | 'addition'
  additionId?: string
  productId?: string
  newQuantity?: number
  newDispatchMerma?: number
  voidAddition?: boolean
  reason: string
  changes?: DispatchCorrectionChange[]
  operationId?: string
}

/** Corrección auditada de despacho o aumento de carga (reintegra stock al lote de origen o añade stock de almacén). */
export async function correctDispatch(input: CorrectDispatchInput): Promise<string> {
  const id = input.operationId || newOperationId('disp-corr')
  await submitOperation('correctDispatch', input, id)
  return id
}

// ---------------------------------------------------------------------------
// Ventas
// ---------------------------------------------------------------------------

export interface RegisterSaleInput {
  saleKind?: 'sale' | 'courtesy'
  courtesyReason?: string
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
  cashReceived?: number
  changeAmount?: number
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
  receivable?: DistReceivable
  receivableId?: string
  customerId?: string
  customerName?: string
  amount: number
  method: 'cash' | 'qr' | 'mixed'
  cashAmount: number
  qrAmount: number
  collectedByUid: string
  collectedByName: string
  routeId: string
  note?: string
  provisionalSnapshot?: ProvisionalCollectionSnapshot
}

export async function registerOpeningBalance(input: { customerId: string; amount: number; sourceDate: string; note: string; routeId?: string }): Promise<DistReceivable> {
  return submitOperation<DistReceivable>('openingBalance', input, newOperationId('opening-balance'))
}

export async function adjustReceivable(input: {
  receivableId: string
  originalAmount: number
  reason: string
  sourceDate?: string
  note?: string
  adjustedSaleLines?: Array<{ productId: string; creditAmount: number }>
}): Promise<DistReceivable> {
  return submitOperation<DistReceivable>('editReceivable', input, newOperationId('receivable-adjustment'))
}

export async function voidReceivable(input: {
  receivableId: string
  reason: string
  confirmationText: string
}): Promise<DistReceivable> {
  return submitOperation<DistReceivable>('voidReceivable', input, newOperationId('receivable-void'))
}

export async function setCreditOverride(input: { customerId: string; days?: number; reason?: string; revoke?: boolean }): Promise<void> {
  await submitOperation('creditOverride', input, newOperationId('credit-override'))
}

/**
 * Un cobro es un movimiento financiero, no una venta: no toca stock ni
 * salesTotal. Reduce el saldo de la cartera del cliente y conserva el historial.
 */
export async function registerCollection(input: RegisterCollectionInput): Promise<DistCollection> {
  const context = await getContext()
  const customerId = input.customerId || input.receivable?.customerId || ''
  const customerName = input.customerName || input.receivable?.customerName || ''
  const receivableId = input.receivable?.id || input.receivableId || ''
  const provisional = {
    ...baseDocFields(context, new Date().toISOString()),
    id: input.operationId,
    operationId: input.operationId,
    receivableId,
    customerId,
    customerName,
    routeId: input.routeId,
    collectedByUid: context.uid,
    collectedByName: input.collectedByName,
    amount: input.amount,
    method: input.method,
    cashAmount: input.cashAmount,
    qrAmount: input.qrAmount,
    note: input.note || '',
    ...input.provisionalSnapshot,
    pendingConfirmation: true,
  } as DistCollection
  return submitOperation<DistCollection>('collection', input, input.operationId, provisional)
}

// ---------------------------------------------------------------------------
// Gastos
// ---------------------------------------------------------------------------

export interface RegisterExpenseInput {
  operationId: string
  presetId?: string
  concept: string
  amount: number
  group?: ExpenseGroupId
  groupId?: ExpenseGroupId
  groupName?: string
  categoryId?: string
  categoryName?: string
  paymentMethod?: 'cash' | 'transfer' | 'other'
  economicType?: ExpenseEconomicType
  affectsOperatingResult?: boolean
  dayKey?: string
  routeId: string
  routeName: string
  registeredByUid: string
  registeredByName: string
  note?: string
}

export async function registerExpense(input: RegisterExpenseInput, provisionalClassification: Pick<DistExpense, 'group' | 'categoryId' | 'categoryName' | 'economicType' | 'affectsOperatingResult' | 'classificationStatus' | 'classificationSource'>): Promise<DistExpense> {
  const context = await getContext()
  const createdAt = new Date().toISOString()
  const provisional = { ...baseDocFields(context, createdAt), ...input, ...provisionalClassification, id: input.operationId, dayKey: input.dayKey || toDayKey(createdAt), pendingConfirmation: true } as DistExpense
  return submitOperation<DistExpense>('expense', input, input.operationId, provisional)
}

export async function saveExpenseGroup(input: { groupId: string; name: string; economicType: ExpenseEconomicType; active: boolean; order: number }) {
  return submitOperation<DistExpenseGroup>('saveExpenseGroup', input, newOperationId('expense-group'))
}

export async function deleteExpenseGroup(input: { groupId: string }) {
  return submitOperation<{ id: string; deleted: true }>('deleteExpenseGroup', input, newOperationId('delete-expense-group'))
}

export async function saveExpenseSupplier(input: { supplierId: string; name: string; contactName?: string; phone?: string; note?: string; active: boolean }) {
  return submitOperation<DistSupplier>('saveExpenseSupplier', input, newOperationId('expense-supplier'))
}

export interface SupplierPurchaseInput {
  operationId: string
  supplierId: string
  groupId: string
  categoryId: string
  description: string
  amount: number
  initialPayment: number
  paymentMethod?: 'cash' | 'transfer' | 'other'
  dayKey: string
  dueDayKey?: string
  note?: string
  purchaseLines?: SupplierPurchaseLine[]
}

export async function registerSupplierPurchase(input: SupplierPurchaseInput) {
  return submitOperation<{ expense: DistExpense; payable: DistPayable }>('registerSupplierPurchase', input, input.operationId)
}

export async function paySupplierPayable(input: { payableId: string; amount: number; paymentMethod: 'cash' | 'transfer' | 'other'; dayKey: string; note?: string }, operationId = newOperationId('supplier-payment')) {
  return submitOperation<{ payment: DistSupplierPayment; payable: DistPayable }>('paySupplierPayable', input, operationId)
}

export async function voidSupplierPayment(input: { paymentId: string; reason: string }) {
  return submitOperation<{ payment: DistSupplierPayment; payable: DistPayable }>('voidSupplierPayment', input, newOperationId('void-supplier-payment'))
}

export async function voidSupplierPurchase(input: { payableId: string; reason: string }) {
  return submitOperation<DistPayable>('voidSupplierPurchase', input, newOperationId('void-supplier-purchase'))
}

export interface ResolveQuarantineInput {
  lotId: string
  location: string
  resolution: 'released_existing_lot' | 'released_new_lot' | 'discarded'
  destinationLotId?: string
  newLotCode?: string
  manufacturedOn?: string
  expiresOn?: string
  productionCost?: number
  reason: string
}

export async function resolveQuarantine(input: ResolveQuarantineInput, operationId = newOperationId('quarantine-resolution')) {
  return submitOperation('resolveQuarantine', input, operationId)
}

export function subscribeSupportSettings(onData: (settings: SupportSettings) => void, onError?: (error: Error) => void) {
  return subscribeQuery<SupportSettings>(ctx => collectionRef(ctx, 'supportConfig'), rows => onData({ ...DEFAULT_SUPPORT_SETTINGS, ...(rows[0] || {}) }), onError)
}

export async function deleteExpense(expenseId: string, reason = ''): Promise<void> {
  await submitOperation('deleteExpense', { expenseId, reason }, newOperationId('delete-expense'))
}

export async function saveExpenseCategory(input: { categoryId: string; group: ExpenseGroupId; name: string; active: boolean; order: number; autoClassifiable: boolean; distributorVisible: boolean }) {
  return submitOperation<DistExpenseCategory>('saveExpenseCategory', input, newOperationId('expense-category'))
}

export async function deleteExpenseCategory(input: { categoryId: string }) {
  return submitOperation<{ id: string; deleted: true }>('deleteExpenseCategory', input, newOperationId('delete-expense-category'))
}

export async function classifyExpense(input: { expenseId: string; group: ExpenseGroupId; categoryId: string; economicType: ExpenseEconomicType }) {
  return submitOperation<DistExpense>('classifyExpense', input, newOperationId('expense-classification'))
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
export async function saveClosure(input: SaveClosureInput, operationId = newOperationId('closure')): Promise<string> {
  await submitOperation('closure', { ...input, mode: input.applyStockReturn ? 'warehouse' : 'money', warehouseResponsibleName: localStorage.getItem('sanjose_warehouse_responsible') || '' }, operationId)
  return input.closure.id
}

/** Reapertura administrativa de una ruta o caja cerrada */
export async function reopenClosure(closure: DistClosure, reason: string, preserveFinancialSnapshot = false): Promise<void> {
  await submitOperation('reopen', { closureId: closure.id, reason: reason.trim(), preserveFinancialSnapshot }, newOperationId('reopen'))
}

/** Reconoce o devuelve a pendientes una diferencia histórica de productos. */
export async function setClosureVarianceReviewed(closureId: string, reviewed: boolean): Promise<void> {
  await submitOperation('reviewVariance', { closureId, reviewed }, newOperationId('review-variance'))
}

export function subscribeLots(onData: (rows: DistLot[]) => void, onError?: (error: Error) => void) { return subscribeQuery<DistLot>(ctx => collectionRef(ctx, 'distLots'), onData, onError) }
export function subscribeOperations(onData: (rows: PendingOperation[]) => void, onError?: (error: Error) => void) { return subscribeQuery<PendingOperation>(ctx => query(collectionRef(ctx, 'distOperations'), where('createdBy', '==', ctx.uid), where('status', 'in', ['queued', 'rejected'])), onData, onError) }
export function subscribeMovements(onData: (rows: DistStockMovement[]) => void, onError?: (error: Error) => void) { return subscribeQuery<DistStockMovement>(ctx => collectionRef(ctx, 'distStockMovements'), onData, onError) }
export function subscribeTransfers(onData: (rows: DistTransfer[]) => void, onError?: (error: Error) => void) { return subscribeQuery<DistTransfer>(ctx => collectionRef(ctx, 'distTransfers'), onData, onError) }
export function subscribeClaims(routeId: string | null, onData: (rows: DistClaim[]) => void, onError?: (error: Error) => void) {
  const sellerBySale = new Map<string, { uid: string; name: string }>()
  let revision = 0
  return subscribeQuery<DistClaim>(
    ctx => routeId ? query(collectionRef(ctx, 'distClaims'), where('routeId', '==', routeId)) : collectionRef(ctx, 'distClaims'),
    rows => {
      const current = ++revision
      // Los reclamos antiguos no guardaban el vendedor. Administración recupera
      // la venta original aunque pertenezca a otro periodo, antes de reportar.
      if (routeId || rows.every(row => row.sellerUid)) { onData(rows); return }
      void (async () => {
        try {
          const ctx = await getContext()
          const missing = [...new Set(rows.filter(row => !row.sellerUid && !sellerBySale.has(row.saleId)).map(row => row.saleId))]
          await Promise.all(missing.map(async saleId => {
            const sale = await getDoc(docRef(ctx, DIST_COLLECTIONS.sales, saleId))
            const data = sale.data()
            if (!data?.sellerUid) throw new Error('No se pudo identificar al vendedor de una devolución histórica.')
            sellerBySale.set(saleId, { uid: data.sellerUid, name: data.sellerName || '' })
          }))
          if (current === revision) onData(rows.map(row => row.sellerUid ? row : { ...row, sellerUid: sellerBySale.get(row.saleId)?.uid, sellerName: sellerBySale.get(row.saleId)?.name }))
        } catch (error) { if (current === revision) onError?.(error as Error) }
      })()
    },
    onError,
  )
}

export function subscribeAdjustmentRequests(onData: (rows: DistAdjustmentRequest[]) => void, onError?: (error: Error) => void) {
  return subscribeQuery<DistAdjustmentRequest>(ctx => collectionRef(ctx, DIST_COLLECTIONS.adjustmentRequests), onData, onError)
}
export function subscribeCreditStatus(onData: (rows: DistCreditStatus[]) => void, onError?: (error: Error) => void) { return subscribeQuery<DistCreditStatus>(ctx => collectionRef(ctx, 'distCreditStatus'), onData, onError) }
export function subscribeCreditOverrides(onData: (rows: DistCreditOverride[]) => void, onError?: (error: Error) => void) { return subscribeQuery<DistCreditOverride>(ctx => collectionRef(ctx, 'distCreditOverrides'), onData, onError) }
export async function registerClaim(payload: Record<string, unknown>, operationId: string) { return submitOperation<DistClaim>('claim', payload, operationId) }

export function dismissSyncError() {
  localStorage.removeItem(SYNC_ERROR_KEY)
  syncState = { ...syncState, lastError: null, lastErrorDetails: null }
  emitSyncState()
}
