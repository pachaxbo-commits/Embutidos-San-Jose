import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  getSyncState,
  subscribeBalances,
  subscribeClosures,
  subscribeCollections,
  subscribeCustomers,
  subscribeExpenses,
  subscribeOpenDispatches,
  subscribeProducts,
  subscribeReceivables,
  subscribeRoutes,
  subscribeSales,
  subscribeSyncState,
} from '../data/distributionRepository'
import { centralBalanceId, routeBalanceId, toDayKey } from '../domain/engine'
import type {
  DistBalance,
  DistClosure,
  DistCollection,
  DistCustomer,
  DistDispatch,
  DistExpense,
  DistProduct,
  DistReceivable,
  DistRoute,
  DistSale,
} from '../types'

/**
 * Estado en vivo del modulo de distribucion.
 *
 * Solo consulta el rango de dias solicitado (nunca toda la historia) y, para
 * el rol distribuidor, limita todas las consultas a su propia ruta: asi la
 * regla de Firestore que impide leer la operacion de otros distribuidores no
 * rompe las consultas y ademas se descarga menos datos.
 */

export interface DistributionScope {
  /** null = ve todas las rutas (admin / almacen) */
  routeId: string | null
  /** Dias a consultar, formato YYYY-MM-DD */
  dayKeys: string[]
  enabled: boolean
}

export function useSyncStatus() {
  return useSyncExternalStore(subscribeSyncState, getSyncState, getSyncState)
}

export function buildDayRange(from: Date, to: Date): string[] {
  const days: string[] = []
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate())
  while (cursor <= end && days.length < 31) {
    days.push(toDayKey(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return days.length > 0 ? days : [toDayKey(new Date())]
}

export interface DistributionData {
  products: DistProduct[]
  routes: DistRoute[]
  customers: DistCustomer[]
  balances: DistBalance[]
  openDispatches: DistDispatch[]
  sales: DistSale[]
  collections: DistCollection[]
  expenses: DistExpense[]
  receivables: DistReceivable[]
  closures: DistClosure[]
  isLoading: boolean
  error: string | null
}

export function useDistributionData(scope: DistributionScope): DistributionData {
  const [products, setProducts] = useState<DistProduct[]>([])
  const [routes, setRoutes] = useState<DistRoute[]>([])
  const [customers, setCustomers] = useState<DistCustomer[]>([])
  const [balances, setBalances] = useState<DistBalance[]>([])
  const [openDispatches, setOpenDispatches] = useState<DistDispatch[]>([])
  const [sales, setSales] = useState<DistSale[]>([])
  const [collections, setCollections] = useState<DistCollection[]>([])
  const [expenses, setExpenses] = useState<DistExpense[]>([])
  const [receivables, setReceivables] = useState<DistReceivable[]>([])
  const [closures, setClosures] = useState<DistClosure[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loadedCount, setLoadedCount] = useState(0)

  const dayKeysSignature = scope.dayKeys.join(',')
  const { routeId, enabled } = scope

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
      subscribeProducts((rows) => {
        setProducts(rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name)))
        onLoaded('products')
      }, onError),
      subscribeRoutes((rows) => {
        setRoutes(rows.sort((a, b) => a.name.localeCompare(b.name)))
        onLoaded('routes')
      }, onError),
      subscribeCustomers((rows) => {
        setCustomers(rows.sort((a, b) => a.name.localeCompare(b.name)))
        onLoaded('customers')
      }, onError),
      subscribeBalances((rows) => {
        setBalances(rows)
        onLoaded('balances')
      }, onError),
    ]
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  }, [enabled, onError, onLoaded])

  // Despachos abiertos y cartera: limitados por ruta cuando corresponde.
  useEffect(() => {
    if (!enabled) return
    const unsubscribers = [
      subscribeOpenDispatches(routeId, (rows) => {
        setOpenDispatches(rows)
        onLoaded('dispatches')
      }, onError),
      subscribeReceivables(routeId, (rows) => {
        setReceivables(rows)
        onLoaded('receivables')
      }, onError),
    ]
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  }, [enabled, routeId, onError, onLoaded])

  // Movimientos del rango consultado.
  useEffect(() => {
    if (!enabled) return
    const dayKeys = dayKeysSignature.split(',').filter(Boolean)
    if (dayKeys.length === 0) return

    const unsubscribers = [
      subscribeSales(dayKeys, routeId, (rows) => {
        setSales(rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
        onLoaded('sales')
      }, onError),
      subscribeCollections(dayKeys, routeId, (rows) => {
        setCollections(rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
        onLoaded('collections')
      }, onError),
      subscribeExpenses(dayKeys, routeId, (rows) => {
        setExpenses(rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
        onLoaded('expenses')
      }, onError),
      subscribeClosures(dayKeys, routeId, (rows) => {
        setClosures(rows)
        onLoaded('closures')
      }, onError),
    ]
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  }, [enabled, routeId, dayKeysSignature, onError, onLoaded])

  return {
    products,
    routes,
    customers,
    balances,
    openDispatches,
    sales,
    collections,
    expenses,
    receivables,
    closures,
    isLoading: enabled && loadedCount < 4,
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
        central.set(balance.productId, Number(balance.quantity) || 0)
      }
      if (routeId && balance.id === routeBalanceId(routeId, balance.productId)) {
        route.set(balance.productId, Number(balance.quantity) || 0)
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
      if (Math.abs(Number(balance.quantity) || 0) < 0.001) continue
      const list = byRoute.get(balance.routeId) ?? []
      list.push(balance)
      byRoute.set(balance.routeId, list)
    }
    return byRoute
  }, [balances])
}
