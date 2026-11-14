import type { PendingOperation } from '../data/operationQueue'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  getSyncState,
  loadMovementsByDispatchIds,
  loadSaleVoidMovementsBySaleIds,
  subscribeLots, subscribeOperations, subscribeMovementsByDayKeys, subscribeTransfers, subscribeClaims, subscribeCreditStatus, subscribeCreditOverrides,
  subscribeWarehouses,
  subscribeQrVerifications,
  subscribeBalances,
  subscribeClosures,
  subscribeCollections,
  subscribeCustomers,
  subscribeExpenses,
  subscribeExpenseCategories,
  subscribeExpenseGroups,
  subscribeOpenDispatches,
  subscribeProducts,
  subscribeDispatchProductOrder,
  subscribeReceivables,
  subscribeReceivableAdjustments,
  subscribeRoutes,
  subscribeSales,
  subscribeSupportSettings,
  subscribeSyncState,
  subscribeAdjustmentRequests,
} from '../data/distributionRepository'
import { centralBalanceId, routeBalanceId, toDayKey } from '../domain/engine'
import { pendingCollectionsFromOperations, pendingExpensesFromOperations, pendingSalesFromOperations, projectBalances, projectReceivables } from '../domain/offlineProjections'
import type {
  DistBalance,
  DistLot, DistStockMovement, DistTransfer, DistClaim, DistCreditStatus, DistCreditOverride, DistAdjustmentRequest,
  DistWarehouse,
  DistQrVerification,
  DistClosure,
  DistCollection,
  DistCustomer,
  DistDispatch,
  DistDispatchProductOrder,
  DistExpense,
  DistExpenseCategory,
  DistExpenseGroup,
  DistProduct,
  DistReceivable,
  DistReceivableAdjustment,
  DistRoute,
  DistSale,
} from '../types'
import { DEFAULT_SUPPORT_SETTINGS, type SupportSettings } from '../data/supportMaintenance'
import { isProductionPreviewReadOnly } from '../../../lib/firebase'
import { getDistributionSubscriptionCollections } from './distributionSubscriptionPolicy'

/**
 * Estado en vivo del modulo de distribucion.
 *
 * Solo consulta el rango de dias solicitado (nunca toda la historia) y, para
 * el rol distribuidor, limita todas las consultas a su propia ruta: asi la
 * regla de Firestore que impide leer la operacion de otros distribuidores no
 * rompe las consultas y ademas se descarga menos datos.
 */

export interface DistributionScope {
  restaurantId?: string
  warehouseId?: string
  /** UID del distribuidor autenticado; evita cargar registros de otra persona. */
  distributorUid?: string
  /** null = ve todas las rutas (admin / almacen) */
  routeId: string | null
  /** Dias a consultar, formato YYYY-MM-DD */
  dayKeys: string[]
  enabled: boolean
  /**
   * El rol puede leer cartera y cobranzas. Almacen no maneja finanzas: si se
   * suscribiera igual, Firestore le respondería permiso denegado y la pantalla
   * mostraria un error que no le corresponde.
   */
  canReadFinance: boolean
  canManageCredits?: boolean
  canManageCustomers?: boolean
  canRegisterExpenses?: boolean
}

export function useSyncStatus() {
  return useSyncExternalStore(subscribeSyncState, getSyncState, getSyncState)
}

export function buildDayRange(from: Date, to: Date): string[] {
  const days: string[] = []
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate())
  while (cursor <= end && days.length < 366) {
    days.push(toDayKey(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return days.length > 0 ? days : [toDayKey(new Date())]
}

export interface DistributionData {
  supportSettings: SupportSettings
  lots: DistLot[]; operations: PendingOperation[]; movements: DistStockMovement[]; transfers: DistTransfer[]; claims: DistClaim[]; creditStatus: DistCreditStatus[]; creditOverrides: DistCreditOverride[];
  warehouses: DistWarehouse[]
  qrVerifications: DistQrVerification[]
  adjustmentRequests: DistAdjustmentRequest[]
  products: DistProduct[]
  dispatchProductOrder: DistDispatchProductOrder | null
  dispatchProductOrderLoading: boolean
  routes: DistRoute[]
  customers: DistCustomer[]
  balances: DistBalance[]
  openDispatches: DistDispatch[]
  sales: DistSale[]
  collections: DistCollection[]
  expenses: DistExpense[]
  expenseCategories: DistExpenseCategory[]
  expenseGroups: DistExpenseGroup[]
  receivables: DistReceivable[]
  receivableAdjustments: DistReceivableAdjustment[]
  closures: DistClosure[]
  isLoading: boolean
  error: string | null
}

export function useDistributionData(scope: DistributionScope): DistributionData {
  const [supportSettings, setSupportSettings] = useState<SupportSettings>(DEFAULT_SUPPORT_SETTINGS)
  const [lots, setLots] = useState<DistLot[]>([])
  const [operations, setOperations] = useState<PendingOperation[]>([])
  const [scopedMovements, setScopedMovements] = useState<DistStockMovement[]>([])
  const [supplementalMovements, setSupplementalMovements] = useState<DistStockMovement[]>([])
  const fetchedDispatchIdsRef = useRef(new Set<string>())
  const fetchedVoidSaleIdsRef = useRef(new Set<string>())
  const [transfers, setTransfers] = useState<DistTransfer[]>([])
  const [claims, setClaims] = useState<DistClaim[]>([])
  const [creditStatus, setCreditStatus] = useState<DistCreditStatus[]>([])
  const [creditOverrides, setCreditOverrides] = useState<DistCreditOverride[]>([])
  const [warehouses, setWarehouses] = useState<DistWarehouse[]>([])
  const [qrVerifications, setQrVerifications] = useState<DistQrVerification[]>([])
  const [adjustmentRequests, setAdjustmentRequests] = useState<DistAdjustmentRequest[]>([])
  const [products, setProducts] = useState<DistProduct[]>([])
  const [dispatchProductOrder, setDispatchProductOrder] = useState<DistDispatchProductOrder | null>(null)
  const [dispatchProductOrderLoading, setDispatchProductOrderLoading] = useState(true)
  const [routes, setRoutes] = useState<DistRoute[]>([])
  const [customers, setCustomers] = useState<DistCustomer[]>([])
  const [balances, setBalances] = useState<DistBalance[]>([])
  const [openDispatches, setOpenDispatches] = useState<DistDispatch[]>([])
  const [sales, setSales] = useState<DistSale[]>([])
  const [collections, setCollections] = useState<DistCollection[]>([])
  const [expenses, setExpenses] = useState<DistExpense[]>([])
  const [expenseCategories, setExpenseCategories] = useState<DistExpenseCategory[]>([])
  const [expenseGroups, setExpenseGroups] = useState<DistExpenseGroup[]>([])
  const [receivables, setReceivables] = useState<DistReceivable[]>([])
  const [receivableAdjustments, setReceivableAdjustments] = useState<DistReceivableAdjustment[]>([])
  const [closures, setClosures] = useState<DistClosure[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loadedCount, setLoadedCount] = useState(0)

  const dayKeysSignature = scope.dayKeys.join(',')
  const {
    routeId,
    distributorUid,
    enabled,
    canReadFinance,
    canManageCredits = false,
    canManageCustomers = false,
    canRegisterExpenses = false,
  } = scope
  const subscriptionCollections = useMemo(() => getDistributionSubscriptionCollections({
    enabled,
    routeId,
    canReadFinance,
    canManageCredits,
    canManageCustomers,
    canRegisterExpenses,
  }), [enabled, routeId, canReadFinance, canManageCredits, canManageCustomers, canRegisterExpenses])

  const markLoaded = useRef(new Set<string>())
  const onLoaded = useCallback((key: string) => {
    if (markLoaded.current.has(key)) return
    markLoaded.current.add(key)
    setLoadedCount(markLoaded.current.size)
  }, [])

  const onError = useCallback((err: Error) => {
    setError(err.message || 'No se pudieron cargar los datos de distribucion.')
  }, [])

  // Catalogo, rutas, clientes y saldos: no dependen del rango de fechas.
  useEffect(() => {
    if (!enabled) return
    const unsubscribers = [
      subscribeLots(setLots, onError), subscribeOperations(setOperations, onError),
      ...(subscriptionCollections.has('distCreditStatus') ? [subscribeCreditStatus(setCreditStatus, onError)] : [((() => { setCreditStatus([]); return () => {} })())]),
      ...(subscriptionCollections.has('distCreditOverrides') ? [subscribeCreditOverrides(setCreditOverrides, onError)] : [((() => { setCreditOverrides([]); return () => {} })())]),
      subscribeSupportSettings(setSupportSettings, onError),
      ...(subscriptionCollections.has('distReceivableAdjustments') ? [subscribeReceivableAdjustments((rows) => {
        setReceivableAdjustments(rows)
        onLoaded('receivableAdjustments')
      }, onError)] : []),
      ...(!subscriptionCollections.has('distStockMovements') ? [((() => {
        setScopedMovements([])
        setSupplementalMovements([])
        onLoaded('movements')
        return () => {}
      })())] : []),
      ...(subscriptionCollections.has('distTransfers') ? [subscribeTransfers(setTransfers, onError)] : []),
      ...(subscriptionCollections.has('distClaims') ? [subscribeClaims(routeId, setClaims, onError)] : []),
      subscribeWarehouses(setWarehouses, onError),
      ...(subscriptionCollections.has('distAdjustmentRequests') ? [subscribeAdjustmentRequests(setAdjustmentRequests, onError)] : []),
      ...(subscriptionCollections.has('distQrVerifications') ? [subscribeQrVerifications(routeId, setQrVerifications, onError)] : []),
      subscribeProducts((rows) => {
        setProducts(rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name)))
        onLoaded('products')
      }, onError),
      subscribeDispatchProductOrder(order => {
        setDispatchProductOrder(order)
      }, error => {
        setDispatchProductOrderLoading(false)
        onError(error)
      }, () => setDispatchProductOrderLoading(false)),
      subscribeRoutes((rows) => {
        setRoutes(rows.sort((a, b) => a.name.localeCompare(b.name)))
        onLoaded('routes')
      }, onError),
      ...(subscriptionCollections.has('distCustomers') ? [subscribeCustomers((rows) => {
        setCustomers(rows.sort((a, b) => a.name.localeCompare(b.name)))
        onLoaded('customers')
      }, onError)] : [((() => { setCustomers([]); onLoaded('customers'); return () => {} })())]),
      ...(!subscriptionCollections.has('distExpenseCategories') || isProductionPreviewReadOnly() ? [((() => { setExpenseCategories([]); setExpenseGroups([]); onLoaded('expenseCategories'); onLoaded('expenseGroups'); return () => {} })())] : [subscribeExpenseCategories((rows) => {
        setExpenseCategories(rows)
        onLoaded('expenseCategories')
      }, onError)]),
      ...(!subscriptionCollections.has('distExpenseGroups') || isProductionPreviewReadOnly() ? [] : [subscribeExpenseGroups((rows) => {
        setExpenseGroups(rows)
        onLoaded('expenseGroups')
      }, onError)]),
      subscribeBalances((rows) => {
        setBalances(rows)
        onLoaded('balances')
      }, onError),
    ]
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  }, [enabled, scope.restaurantId, subscriptionCollections, routeId, onError, onLoaded])

  // Los despachos son privados por distribuidor. La cartera y el historial de
  // cierres no dependen del rango de fechas consultado.
  useEffect(() => {
    if (!enabled) return
    const unsubscribers = [
      subscribeOpenDispatches(routeId, (rows) => {
        setOpenDispatches(rows)
        onLoaded('dispatches')
      }, onError, distributorUid),
      subscribeClosures([], routeId, (rows) => {
        setClosures(rows)
        onLoaded('closures')
      }, onError, distributorUid),
      ...(subscriptionCollections.has('distReceivables')
        ? [
            subscribeReceivables(null, (rows) => {
              setReceivables(rows)
              onLoaded('receivables')
            }, onError),
          ]
        : []),
    ]
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  }, [enabled, routeId, distributorUid, subscriptionCollections, onError, onLoaded])

  // Movimientos y operaciones del rango consultado.
  useEffect(() => {
    if (!enabled) return
    const dayKeys = dayKeysSignature.split(',').filter(Boolean)
    if (dayKeys.length === 0) return

    const unsubscribers = [
      subscribeSales(dayKeys, routeId, (rows) => {
        setSales(rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
        onLoaded('sales')
      }, onError, distributorUid),
      ...(subscriptionCollections.has('distCollections')
        ? [
            subscribeCollections(dayKeys, routeId, (rows) => {
              setCollections(rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
              onLoaded('collections')
            }, onError, distributorUid),
          ]
        : []),
      subscribeExpenses(dayKeys, routeId, (rows) => {
        setExpenses(rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
        onLoaded('expenses')
      }, onError, distributorUid),
      ...(subscriptionCollections.has('distStockMovements')
        ? [
            subscribeMovementsByDayKeys(dayKeys, (rows) => {
              setScopedMovements(rows)
              onLoaded('movements')
            }, onError, { includeToday: true }),
          ]
        : []),
    ]
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  }, [enabled, routeId, distributorUid, dayKeysSignature, subscriptionCollections, onError, onLoaded])

  // Suplemento puntual bajo demanda para excepciones cross-day (faltantes o ventas
  // anuladas de periodos mostrados cuya nota/movimiento ocurrió en otro dayKey).
  useEffect(() => {
    if (!enabled || !subscriptionCollections.has('distStockMovements')) return
    const selectedDays = new Set(dayKeysSignature.split(',').filter(Boolean))
    if (selectedDays.size === 0) return

    const activeShortages = scopedMovements.filter(m => m.type === 'shortage' && !m.reversedAt)
    const shortageIds = new Set(activeShortages.map(m => m.id))
    const missingDispatchIds: string[] = []
    for (const closure of closures) {
      const closureDay = closure.dayKey || toDayKey(closure.warehouseClosedAt || closure.closedAt || closure.createdAt)
      if (!selectedDays.has(closureDay) || !closure.dispatchId || fetchedDispatchIdsRef.current.has(closure.dispatchId)) continue
      const needsShortage = closure.products.some(p => {
        if ((Number(p.shortage) || 0) <= 0) return false
        if (p.shortageMovementId && shortageIds.has(p.shortageMovementId)) return false
        return !activeShortages.some(m => m.dispatchId === closure.dispatchId && m.routeId === closure.routeId && m.productId === p.productId)
      })
      if (needsShortage) missingDispatchIds.push(closure.dispatchId)
    }

    const salesById = new Set(sales.map(s => s.id))
    const voidedIds = new Set(scopedMovements.filter(m => m.type === 'sale_void' && !m.reversedAt).map(m => m.refId).filter(Boolean))
    const missingVoidCheckSaleIds: string[] = []
    for (const m of scopedMovements) {
      const mDay = m.dayKey || toDayKey(m.createdAt)
      if (m.type !== 'sale' || m.reversedAt || !selectedDays.has(mDay)) continue
      if (m.routeId !== 'admin' && m.routeId !== 'administracion') continue
      if ((Number(m.excessWeightQuantity) || 0) <= 0 || !m.refId) continue
      if (!salesById.has(m.refId) && !voidedIds.has(m.refId) && !fetchedVoidSaleIdsRef.current.has(m.refId)) {
        missingVoidCheckSaleIds.push(m.refId)
      }
    }

    if (missingDispatchIds.length === 0 && missingVoidCheckSaleIds.length === 0) return
    let cancelled = false
    missingDispatchIds.forEach(id => fetchedDispatchIdsRef.current.add(id))
    missingVoidCheckSaleIds.forEach(id => fetchedVoidSaleIdsRef.current.add(id))
    void Promise.all([
      missingDispatchIds.length ? loadMovementsByDispatchIds(missingDispatchIds) : Promise.resolve([]),
      missingVoidCheckSaleIds.length ? loadSaleVoidMovementsBySaleIds(missingVoidCheckSaleIds) : Promise.resolve([]),
    ]).then(([byDispatch, bySale]) => {
      if (cancelled || (byDispatch.length === 0 && bySale.length === 0)) return
      setSupplementalMovements(prev => {
        const merged = new Map(prev.map(row => [row.id, row]))
        for (const row of byDispatch) merged.set(row.id, row)
        for (const row of bySale) merged.set(row.id, row)
        return [...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      })
    }).catch(onError)
    return () => { cancelled = true }
  }, [enabled, subscriptionCollections, dayKeysSignature, closures, scopedMovements, sales, onError])

  const movements = useMemo(() => {
    if (supplementalMovements.length === 0) return scopedMovements
    const merged = new Map<string, DistStockMovement>()
    for (const row of supplementalMovements) merged.set(row.id, row)
    for (const row of scopedMovements) merged.set(row.id, row)
    return [...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [scopedMovements, supplementalMovements])

  const pendingSales = pendingSalesFromOperations(operations, sales)
  const pendingCollections = pendingCollectionsFromOperations(operations, collections)
  const pendingExpenses = pendingExpensesFromOperations(operations, expenses)
  const visibleReceivables = projectReceivables(receivables, pendingCollections)
  const visibleBalances = projectBalances(balances, pendingSales, lots, toDayKey())
  return {
    supportSettings,
    lots, operations, movements, transfers, claims, creditStatus, creditOverrides,
    warehouses,
    qrVerifications,
    adjustmentRequests,
    products,
    dispatchProductOrder,
    dispatchProductOrderLoading,
    routes,
    customers,
    balances: visibleBalances,
    openDispatches,
    sales: [...sales, ...pendingSales],
    collections: [...collections, ...pendingCollections],
    expenses: [...expenses, ...pendingExpenses],
    expenseCategories,
    expenseGroups,
    receivables: visibleReceivables,
    receivableAdjustments,
    closures,
    isLoading: enabled && loadedCount < (canManageCredits ? 5 : 4),
    error,
  }
}

/** Indice rapido de saldos por producto para almacen central y para una ruta */
export function useStockIndex(balances: DistBalance[], routeId: string | null) {
  return useMemo(() => {
    const central = new Map<string, number>()
    const route = new Map<string, number>()

    for (const balance of balances) {
      if (balance.id === centralBalanceId(balance.productId)) {
        central.set(balance.productId, Number(balance.availableQuantity ?? balance.quantity) || 0)
      }
      if (routeId && balance.id === routeBalanceId(routeId, balance.productId)) {
        route.set(balance.productId, Number(balance.availableQuantity ?? balance.quantity) || 0)
      }
    }

    return { central, route }
  }, [balances, routeId])
}

/** Saldos de ruta agrupados por ruta (para la vista de almacen) */
export function useRouteStock(balances: DistBalance[]) {
  return useMemo(() => {
    const byRoute = new Map<string, DistBalance[]>()
    for (const balance of balances) {
      if (balance.locationKind !== 'route' || !balance.routeId) continue
      if (Math.abs(Number(balance.availableQuantity ?? balance.quantity) || 0) < 0.001) continue
      const list = byRoute.get(balance.routeId) ?? []
      list.push(balance)
      byRoute.set(balance.routeId, list)
    }
    return byRoute
  }, [balances])
}
