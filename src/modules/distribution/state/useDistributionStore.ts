import type { PendingOperation } from '../data/operationQueue'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  getSyncState,
  subscribeLots, subscribeOperations, subscribeMovements, subscribeTransfers, subscribeClaims, subscribeCreditStatus, subscribeCreditOverrides,
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
  const [movements, setMovements] = useState<DistStockMovement[]>([])
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
      ...(subscriptionCollections.has('distStockMovements') ? [subscribeMovements(setMovements, onError)] : []),
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

  // Los despachos son privados por distribuidor. La cartera es global para que
  // cualquier vendedor detecte una deuda pendiente antes de vender.
  useEffect(() => {
    if (!enabled) return
    const unsubscribers = [
      subscribeOpenDispatches(routeId, (rows) => {
        setOpenDispatches(rows)
        onLoaded('dispatches')
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

  // Movimientos del rango consultado.
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
      subscribeClosures(dayKeys, routeId, (rows) => {
        setClosures(rows)
        onLoaded('closures')
      }, onError, distributorUid),
    ]
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  }, [enabled, routeId, distributorUid, dayKeysSignature, subscriptionCollections, onError, onLoaded])

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
