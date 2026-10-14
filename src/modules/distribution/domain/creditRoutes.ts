import { matchesRoute, round2, toDayKey } from './engine.ts'
import type { DistCollection, DistCustomer, DistReceivable, DistRoute, DistSale, DistSaleLine } from '../types.ts'

export interface CustomerRouteDebt {
  routeId: string
  routeName: string
  balance: number
  originalAmount: number
  receivables: DistReceivable[]
}

export interface CustomerCreditRouteView {
  customerId: string
  customerName: string
  customerCode?: string
  identityNumber?: string
  totalBalance: number
  filteredBalance: number
  lastMovementAt: string
  routes: CustomerRouteDebt[]
  allReceivables: DistReceivable[]
  filteredReceivables: DistReceivable[]
}

export interface RouteOption {
  id: string
  name: string
  totalBalance: number
  customerCount: number
}

export interface CreditPortfolioResult {
  customerCredits: CustomerCreditRouteView[]
  totalOutstanding: number
  totalCustomersWithBalance: number
  availableRoutes: RouteOption[]
}

/**
 * Resuelve la ruta a la que pertenece un crédito / cuenta por cobrar.
 * 1. Prioridad: receivable.routeId (origen de la deuda).
 * 2. Fallback: ruta de la venta relacionada si existe.
 * 3. Fallback: ruta actual del cliente.
 * 4. Fallback final: 'no-route' ("Sin ruta / Histórico").
 */
export function resolveReceivableRouteId(
  receivable: DistReceivable,
  salesById?: Map<string, DistSale>,
  customersById?: Map<string, DistCustomer>,
): string {
  if (receivable.routeId && receivable.routeId.trim()) {
    const rId = receivable.routeId.trim()
    if (rId === 'admin') return 'administracion'
    return rId
  }
  if (receivable.saleId && salesById) {
    const sale = salesById.get(receivable.saleId)
    if (sale?.routeId && sale.routeId.trim()) {
      const rId = sale.routeId.trim()
      if (rId === 'admin') return 'administracion'
      return rId
    }
  }
  if (customersById) {
    const customer = customersById.get(receivable.customerId)
    if (customer?.routeId && customer.routeId.trim()) {
      const rId = customer.routeId.trim()
      if (rId === 'admin') return 'administracion'
      return rId
    }
  }
  return 'no-route'
}

/**
 * Obtiene el nombre legible de una ruta.
 */
export function getRouteDisplayName(routeId: string, routes: DistRoute[]): string {
  if (routeId === 'administracion' || routeId === 'admin' || routeId === 'central') return 'Administración'
  if (routeId === 'route-impulsacion' || routeId === 'route-directa') return 'Impulsación'
  if (routeId === 'no-route') return 'Sin ruta / Histórico'
  const found = routes.find((r) => r.id === routeId)
  if (found?.name === 'Venta directa / Impulsacion' || found?.name === 'Venta directa / Impulsación') {
    return 'Impulsación'
  }
  return found?.name || routeId
}

/**
 * Resuelve los productos efectivos de un crédito, soportando histórico, correcciones y fallback seguro.
 */
export function resolveCreditProducts(
  receivable: DistReceivable,
  sale?: DistSale | null,
): {
  lines: DistSaleLine[]
  isHistoricalWithoutDetail: boolean
  isVoid: boolean
  voidReason?: string
} {
  const isVoid = Boolean(
    receivable.status === 'PAID' &&
      receivable.balance === 0 &&
      (sale?.voidedAt || (receivable as unknown as Record<string, unknown>).voidedAt || receivable.note?.toLowerCase().includes('anulad')),
  )
  const voidReason =
    (sale?.voidReason as string | undefined) ||
    ((receivable as unknown as Record<string, unknown>).voidReason as string | undefined) ||
    (isVoid ? 'Venta anulada' : undefined)

  // 1. Si receivable ya tiene saleLines guardadas directamente
  if (receivable.saleLines && receivable.saleLines.length > 0) {
    return {
      lines: receivable.saleLines,
      isHistoricalWithoutDetail: false,
      isVoid,
      voidReason,
    }
  }

  // 2. Si hay venta vinculada, buscar en effectiveSnapshot o lines
  if (sale) {
    const lines = sale.effectiveSnapshot?.lines ?? sale.lines ?? []
    if (lines.length > 0) {
      return {
        lines,
        isHistoricalWithoutDetail: false,
        isVoid: Boolean(sale.voidedAt || isVoid),
        voidReason: (sale.voidReason as string | undefined) || voidReason,
      }
    }
  }

  // 3. Saldo inicial / Deuda anterior: no exige productos
  if (receivable.sourceType === 'opening_balance') {
    return {
      lines: [],
      isHistoricalWithoutDetail: false,
      isVoid: false,
    }
  }

  // 4. Histórico imposible de recuperar
  return {
    lines: [],
    isHistoricalWithoutDetail: true,
    isVoid,
    voidReason,
  }
}

/**
 * Agrupa la cartera de créditos considerando el filtro por ruta seleccionado y calculando
 * totales por ruta sin mezclar deudas cruzadas.
 */
export function computeCreditPortfolioByRoute({
  receivables,
  selectedRouteId,
  routes,
  customers,
  salesById,
  period,
}: {
  receivables: DistReceivable[]
  selectedRouteId: string
  routes: DistRoute[]
  customers: DistCustomer[]
  salesById?: Map<string, DistSale>
  period?: string[]
}): CreditPortfolioResult {
  const customersById = new Map<string, DistCustomer>(customers.map((c) => [c.id, c]))
  const filterRoute = selectedRouteId.trim()
  const isAll = !filterRoute || filterRoute === 'all'

  // Mapear cada receivable con su ruta resuelta
  interface EnrichedReceivable {
    receivable: DistReceivable
    resolvedRouteId: string
    resolvedRouteName: string
  }

  const enriched: EnrichedReceivable[] = []
  const routeTotals = new Map<string, { balance: number; customerIds: Set<string> }>()

  for (const r of receivables) {
    if (period && period.length > 0) {
      const day = r.dayKey || toDayKey(r.createdAt)
      if (!period.includes(day)) continue
    }

    const rRouteId = resolveReceivableRouteId(r, salesById, customersById)
    const rRouteName = getRouteDisplayName(rRouteId, routes)
    enriched.push({
      receivable: r,
      resolvedRouteId: rRouteId,
      resolvedRouteName: rRouteName,
    })

    const bal = Number(r.balance) || 0
    if (bal > 0) {
      const current = routeTotals.get(rRouteId) ?? { balance: 0, customerIds: new Set<string>() }
      current.balance = round2(current.balance + bal)
      current.customerIds.add(r.customerId)
      routeTotals.set(rRouteId, current)
    }
  }

  // Opciones de rutas disponibles para el selector
  const availableRoutes: RouteOption[] = []
  // Agregar rutas activas de la empresa (sin mezclar Venta directa / Impulsación)
  for (const route of routes) {
    if (route.id === 'route-directa' || route.id === 'administracion' || route.id === 'admin') continue
    const stats = routeTotals.get(route.id)
    const name = route.id === 'route-impulsacion'
      ? 'Impulsación'
      : (route.name === 'Venta directa / Impulsacion' || route.name === 'Venta directa / Impulsación')
        ? 'Impulsación'
        : route.name
    availableRoutes.push({
      id: route.id,
      name,
      totalBalance: stats ? stats.balance : 0,
      customerCount: stats ? stats.customerIds.size : 0,
    })
  }
  // Si hay deudas en Administración (administracion o admin)
  const adminBalance = round2(
    (routeTotals.get('administracion')?.balance || 0) +
    (routeTotals.get('admin')?.balance || 0)
  )
  const adminCustomers = new Set<string>([
    ...(routeTotals.get('administracion')?.customerIds || []),
    ...(routeTotals.get('admin')?.customerIds || []),
  ])
  if (adminBalance > 0 || routeTotals.has('administracion') || routeTotals.has('admin')) {
    availableRoutes.push({
      id: 'administracion',
      name: 'Administración',
      totalBalance: adminBalance,
      customerCount: adminCustomers.size,
    })
  }
  // Si hay deudas históricas sin ruta que no estén en routes
  if (routeTotals.has('no-route') && !routes.some((r) => r.id === 'no-route')) {
    const stats = routeTotals.get('no-route')!
    availableRoutes.push({
      id: 'no-route',
      name: 'Sin ruta / Histórico',
      totalBalance: stats.balance,
      customerCount: stats.customerIds.size,
    })
  }

  // Agrupar por cliente
  const customerMap = new Map<string, CustomerCreditRouteView>()

  for (const item of enriched) {
    const r = item.receivable
    const cId = r.customerId
    const customer = customersById.get(cId)
    const cName = r.customerName || customer?.name || 'Cliente'

    let entry = customerMap.get(cId)
    if (!entry) {
      entry = {
        customerId: cId,
        customerName: cName,
        customerCode: customer?.customerCode || r.customerCode,
        identityNumber: customer?.identityNumber,
        totalBalance: 0,
        filteredBalance: 0,
        lastMovementAt: r.createdAt,
        routes: [],
        allReceivables: [],
        filteredReceivables: [],
      }
      customerMap.set(cId, entry)
    }

    const bal = Number(r.balance) || 0
    const orig = Number(r.originalAmount) || 0

    entry.totalBalance = round2(entry.totalBalance + bal)
    entry.allReceivables.push(r)
    if (r.createdAt > entry.lastMovementAt) {
      entry.lastMovementAt = r.createdAt
    }

    // Buscar o crear la ruta dentro del cliente
    let routeDebt = entry.routes.find((rd) => rd.routeId === item.resolvedRouteId)
    if (!routeDebt) {
      routeDebt = {
        routeId: item.resolvedRouteId,
        routeName: item.resolvedRouteName,
        balance: 0,
        originalAmount: 0,
        receivables: [],
      }
      entry.routes.push(routeDebt)
    }
    routeDebt.balance = round2(routeDebt.balance + bal)
    routeDebt.originalAmount = round2(routeDebt.originalAmount + orig)
    routeDebt.receivables.push(r)

    // Si coincide con el filtro de ruta
    if (isAll || matchesRoute(item.resolvedRouteId, filterRoute)) {
      entry.filteredBalance = round2(entry.filteredBalance + bal)
      entry.filteredReceivables.push(r)
    }
  }

  // Filtrar clientes según la ruta seleccionada
  const filteredCustomers = [...customerMap.values()].filter((entry) => {
    if (isAll) {
      // En 'todas', mostrar clientes que tienen deudas (o receivables en periodo)
      return entry.totalBalance > 0 || entry.allReceivables.length > 0
    }
    // Si se seleccionó una ruta específica: SOLO clientes que tienen deudas originadas en esa ruta
    return entry.filteredReceivables.length > 0 && (entry.filteredBalance > 0 || entry.filteredReceivables.some((r) => r.balance > 0))
  })

  // Ordenar de mayor saldo filtrado a menor
  filteredCustomers.sort((a, b) => b.filteredBalance - a.filteredBalance || b.totalBalance - a.totalBalance)

  const totalOutstanding = round2(
    filteredCustomers.reduce((sum, c) => sum + c.filteredBalance, 0),
  )

  const totalCustomersWithBalance = filteredCustomers.filter((c) => c.filteredBalance > 0).length

  return {
    customerCredits: filteredCustomers,
    totalOutstanding,
    totalCustomersWithBalance,
    availableRoutes,
  }
}

/**
 * Calcula la cartera de créditos As-Of (al corte de una fecha determinada).
 *
 * Reglas de cálculo As-Of:
 * 1. Ignora créditos creados DESPUÉS de la fecha de corte (`cutoffDayKey`).
 * 2. Para los créditos creados en o antes de la fecha de corte, solo toma en cuenta
 *    las cobranzas realizadas EN O ANTES de la fecha de corte.
 * 3. Las cobranzas posteriores a la fecha de corte NO descuentan el saldo As-Of.
 * 4. Calcula `paidAmount`, `balance` y `status` al momento exacto del corte.
 */
export function computeAsOfReceivablesPortfolio({
  receivables,
  collections,
  cutoffDayKey,
}: {
  receivables: DistReceivable[]
  collections: DistCollection[]
  cutoffDayKey?: string
}): DistReceivable[] {
  if (!cutoffDayKey) return receivables

  // 1. Filtrar cobranzas realizadas en o antes de cutoffDayKey
  const validCollections = collections.filter((c) => {
    const day = c.dayKey || toDayKey(c.createdAt)
    return day <= cutoffDayKey
  })

  // 2. Mapear pagos acumulados por receivableId
  const paidByReceivable = new Map<string, number>()
  const unallocatedByCustomer = new Map<string, number>()

  for (const c of validCollections) {
    if (c.allocations && c.allocations.length > 0) {
      for (const a of c.allocations) {
        paidByReceivable.set(
          a.receivableId,
          round2((paidByReceivable.get(a.receivableId) || 0) + (Number(a.amount) || 0)),
        )
      }
    } else if (c.receivableId) {
      paidByReceivable.set(
        c.receivableId,
        round2((paidByReceivable.get(c.receivableId) || 0) + (Number(c.amount) || 0)),
      )
    } else {
      unallocatedByCustomer.set(
        c.customerId,
        round2((unallocatedByCustomer.get(c.customerId) || 0) + (Number(c.amount) || 0)),
      )
    }
  }

  // 3. Filtrar créditos creados en o antes de cutoffDayKey
  const eligibleReceivables = receivables
    .filter((r) => {
      const day = r.dayKey || toDayKey(r.createdAt)
      return day <= cutoffDayKey
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  // 4. Si hay cobros no asignados por cliente, aplicarlos FIFO a sus créditos hasta esa fecha
  const remainingUnallocated = new Map(unallocatedByCustomer)

  return eligibleReceivables.map((r) => {
    let paid = paidByReceivable.get(r.id) || 0

    // Si aún tiene saldo y el cliente tiene pagos sin asignar
    const unallocated = remainingUnallocated.get(r.customerId) || 0
    if (unallocated > 0 && paid < r.originalAmount) {
      const needed = round2(r.originalAmount - paid)
      const toApply = Math.min(needed, unallocated)
      paid = round2(paid + toApply)
      remainingUnallocated.set(r.customerId, round2(unallocated - toApply))
    }

    const asOfPaid = round2(Math.min(r.originalAmount, paid))
    const asOfBalance = round2(Math.max(0, r.originalAmount - asOfPaid))
    const asOfStatus = asOfBalance === 0 ? 'PAID' : (asOfPaid > 0 ? 'PARTIAL' : 'OPEN')

    return {
      ...r,
      paidAmount: asOfPaid,
      balance: asOfBalance,
      status: asOfStatus,
    }
  })
}

