import type { PendingOperation } from '../data/operationQueue'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  getSyncState,
  subscribeLots, subscribeOperations, subscribeMovements, subscribeTransfers, subscribeClaims, subscribeCreditStatus,
  subscribeWarehouses,
  subscribeQrVerifications,
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
  subscribeSupportSettings,
  subscribeSyncState,
} from '../data/distributionRepository'
import { centralBalanceId, routeBalanceId, toDayKey } from '../domain/engine'
import type {
  DistBalance,
  DistLot, DistStockMovement, DistTransfer, DistClaim, DistCreditStatus,
  DistWarehouse,
  DistQrVerification,
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
import { DEFAULT_SUPPORT_SETTINGS, type SupportSettings } from '../data/supportMaintenance'

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
  lots: DistLot[]; operations: PendingOperation[]; movements: DistStockMovement[]; transfers: DistTransfer[]; claims: DistClaim[]; creditStatus: DistCreditStatus[];
  warehouses: DistWarehouse[]
  qrVerifications: DistQrVerification[]
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
  const [supportSettings, setSupportSettings] = useState<SupportSettings>(DEFAULT_SUPPORT_SETTINGS)
  const [lots, setLots] = useState<DistLot[]>([])
  const [operations, setOperations] = useState<PendingOperation[]>([])
  const [movements, setMovements] = useState<DistStockMovement[]>([])
  const [transfers, setTransfers] = useState<DistTransfer[]>([])
  const [claims, setClaims] = useState<DistClaim[]>([])
  const [creditStatus, setCreditStatus] = useState<DistCreditStatus[]>([])
  const [warehouses, setWarehouses] = useState<DistWarehouse[]>([])
  const [qrVerifications, setQrVerifications] = useState<DistQrVerification[]>([])
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
  const { routeId, distributorUid, enabled, canReadFinance } = scope

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
      subscribeLots(setLots, onError), subscribeOperations(setOperations, onError), subscribeCreditStatus(setCreditStatus, onError),
      subscribeSupportSettings(setSupportSettings, onError),
      ...(routeId === null ? [subscribeMovements(setMovements, onError), subscribeTransfers(setTransfers, onError)] : []),
      ...(canReadFinance ? [subscribeClaims(routeId, setClaims, onError)] : []),
      subscribeWarehouses(setWarehouses, onError),
      ...(canReadFinance ? [subscribeQrVerifications(routeId, setQrVerifications, onError)] : []),
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
  }, [enabled, scope.restaurantId, canReadFinance, routeId, onError, onLoaded])

  // Los despachos son privados por distribuidor. La cartera es global para que
  // cualquier vendedor detecte una deuda pendiente antes de vender.
  useEffect(() => {
    if (!enabled) return
    const unsubscribers = [
      subscribeOpenDispatches(routeId, (rows) => {
        setOpenDispatches(rows)
        onLoaded('dispatches')
      }, onError, distributorUid),
      ...(canReadFinance
        ? [
            subscribeReceivables(null, (rows) => {
              setReceivables(rows)
              onLoaded('receivables')
            }, onError),
          ]
        : []),
    ]
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  }, [enabled, routeId, distributorUid, canReadFinance, onError, onLoaded])

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
      ...(canReadFinance
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
  }, [enabled, routeId, distributorUid, dayKeysSignature, canReadFinance, onError, onLoaded])

  const pendingSales = operations.filter(o => o.status === 'queued' && o.type === 'sale' && !sales.some(s => s.id === o.id)).map(o => ({ ...o.payload, id:o.id, createdAt:o.createdAt, dayKey:toDayKey(o.createdAt), pendingConfirmation:true } as unknown as DistSale))
  const pendingCollections = operations.filter(o => o.status === 'queued' && o.type === 'collection' && !collections.some(c => c.id === o.id)).map(o => {
    const p = o.payload as unknown as { receivable: DistReceivable; amount: number; method: 'cash'|'qr'; routeId: string; collectedByName: string }
    return { ...p, id: o.id, operationId: o.id, receivableId: p.receivable.id, customerId: p.receivable.customerId, customerName: p.receivable.customerName, collectedByUid: o.createdBy, createdAt: o.createdAt, dayKey: toDayKey(o.createdAt), pendingConfirmation: true } as unknown as DistCollection
  })
  const pendingExpenses = operations.filter(o => o.status === 'queued' && o.type === 'expense' && !expenses.some(e => e.id === o.id)).map(o => ({ ...o.payload, id:o.id, createdAt:o.createdAt, dayKey:toDayKey(o.createdAt), pendingConfirmation:true } as unknown as DistExpense))
  const visibleReceivables = receivables.map(r => {
    const pending = pendingCollections.filter(c => c.receivableId === r.id).reduce((n,c)=>n+c.amount,0)
    return { ...r, balance:Math.max(0,Math.round((r.balance-pending)*100)/100), pendingConfirmation:pending>0 }
  })
  const visibleBalances = balances.map(b => {
    const pendingQty = pendingSales.filter(s => s.sourceLocation === 'route' ? b.locationKind === 'route' && b.routeId === s.routeId : b.id === centralBalanceId(b.productId)).flatMap(s => s.lines).filter(l => l.productId === b.productId).reduce((n,l)=>n+l.quantity,0)
    const loc = b.locationKind === 'route' ? `route__${b.routeId}` : (b.warehouseId && b.warehouseId !== 'central' ? `warehouse__${b.warehouseId}` : 'central')
    const unavailable = lots.filter(l => l.productId === b.productId && (l.quarantined || (l.expiresOn && l.expiresOn < toDayKey()))).reduce((n,l)=>n+(l.quantities[loc]||0),0)
    return {...b, quantity:Math.max(0, b.quantity-pendingQty), availableQuantity:Math.max(0,b.quantity-pendingQty-unavailable)}
  })
  return {
    supportSettings,
    lots, operations, movements, transfers, claims, creditStatus,
    warehouses,
    qrVerifications,
    products,
    routes,
    customers,
    balances: visibleBalances,
    openDispatches,
    sales: [...sales, ...pendingSales],
    collections: [...collections, ...pendingCollections],
    expenses: [...expenses, ...pendingExpenses],
    receivables: visibleReceivables,
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
