import { matchesRoute, toDayKey } from './engine.ts'
import type { DistClosure, DistDispatch, DistProduct, DistRoute, DistStockMovement, UnitType } from '../types.ts'

export type MermaReportKind = 'dispatch_merma' | 'dispatch_waste' | 'return_merma' | 'unfit' | 'shortage' | 'overage'

export interface MermaReportRow {
  id: string
  dayKey: string
  createdAt: string
  kind: MermaReportKind
  label: string
  productId: string
  productName: string
  unitType: UnitType
  quantity: number
  physicalQuantity: number
  normalQuantity?: number
  dispatchMerma?: number
  routeId: string
  routeName: string
  distributorUid: string
  distributorName: string
  lotCode: string
  note: string
  reason: string
  lossCost: number | null
  reversed: boolean
}

export interface MermaReportFilters {
  dayKeys: string[]
  routeId?: string
  distributorUid?: string
  productId?: string
  kind?: MermaReportKind | 'all'
}

export interface MermaReportResult {
  rows: MermaReportRow[]
  byProduct: Array<{ productId: string; productName: string; unitType: UnitType; dispatchMerma: number; dispatchWaste: number; returnMerma: number; unfit: number; shortage: number; overage: number }>
  byRoute: Array<{ routeId: string; routeName: string; unitType: UnitType; dispatchMerma: number; dispatchWaste: number; returnMerma: number; unfit: number; shortage: number; overage: number }>
  totals: Record<MermaReportKind, { kg: number; package: number; unit: number }>
}

const labels: Record<MermaReportKind, string> = {
  dispatch_merma: 'Merma adicional recuperable en despacho',
  dispatch_waste: 'Pérdida histórica registrada al despachar',
  return_merma: 'Merma recuperable al retorno',
  unfit: 'Producto no apto / pérdida',
  shortage: 'Faltante',
  overage: 'Sobrante',
}

function roundQuantity(value: number, unitType: UnitType): number {
  const scale = unitType === 'kg' ? 1000 : 100
  return Math.round((Number(value) || 0) * scale) / scale
}

function kindForMovement(movement: DistStockMovement): MermaReportKind | null {
  if ((movement.type === 'dispatch' || movement.type === 'dispatch_addition') && Number(movement.dispatchMerma) > 0) return 'dispatch_merma'
  if (movement.type === 'dispatch_waste') return 'dispatch_waste'
  if (movement.type === 'return_merma') return 'return_merma'
  if (movement.type === 'return_waste' || movement.type === 'return_waste_unassigned') return 'unfit'
  if (movement.type === 'shortage') return 'shortage'
  if (movement.type === 'overage') return 'overage'
  return null
}

/** Ledger canonical: each event appears once; dispatchMerma is a component of dispatch movements, not a second movement. */
export function computeMermaReport(
  movements: DistStockMovement[],
  products: DistProduct[],
  routes: DistRoute[],
  closures: DistClosure[],
  filters: MermaReportFilters,
  openDispatches: DistDispatch[] = [],
): MermaReportResult {
  const closureByDispatch = new Map(closures.filter((closure) => closure.dispatchId).map((closure) => [closure.dispatchId, closure]))
  const openDispatchById = new Map(openDispatches.map((dispatch) => [dispatch.id, dispatch]))
  const routeById = new Map(routes.map((route) => [route.id, route]))
  const productById = new Map(products.map((product) => [product.id, product]))
  const rows = movements.flatMap((movement): MermaReportRow[] => {
    // Keep the original overage auditable, but exclude it from active summaries
    // after its fictitious quantity has been rectified.
    if (movement.rectifiedAt || movement.rectifiedByMovementId) return []
    const kind = kindForMovement(movement)
    if (!kind || movement.reversedAt || movement.pendingConfirmation) return []
    const dayKey = movement.dayKey || toDayKey(movement.createdAt)
    if (!filters.dayKeys.includes(dayKey)) return []
    if (filters.kind && filters.kind !== 'all' && kind !== filters.kind) return []
    if (filters.productId && movement.productId !== filters.productId) return []
    const dispatchKey = movement.dispatchId || movement.refId || ''
    const closure = closureByDispatch.get(dispatchKey)
    const dispatch = openDispatchById.get(dispatchKey)
    const routeId = movement.routeId || closure?.routeId || dispatch?.routeId || ''
    if (filters.routeId && !matchesRoute(routeId, filters.routeId)) return []
    if (filters.distributorUid && closure?.distributorUid !== filters.distributorUid) return []
    const route = routeById.get(routeId)
    const product = productById.get(movement.productId)
    const quantity = kind === 'dispatch_merma' ? Number(movement.dispatchMerma) : Number(movement.quantity)
    return [{
      id: movement.id, dayKey, createdAt: movement.createdAt, kind, label: labels[kind],
      productId: movement.productId, productName: movement.productName || product?.name || 'Producto',
      unitType: movement.unitType || product?.unitType || 'unit', quantity: roundQuantity(quantity, movement.unitType || product?.unitType || 'unit'),
      physicalQuantity: Number(movement.quantity) || 0, normalQuantity: movement.normalQuantity, dispatchMerma: movement.dispatchMerma,
      routeId, routeName: route?.name || closure?.routeName || dispatch?.routeName || (routeId === 'admin' || routeId === 'administracion' ? 'Administración' : routeId === 'route-impulsacion' || routeId === 'route-directa' ? 'Impulsación' : 'Ruta no disponible'),
      distributorUid: closure?.distributorUid || dispatch?.distributorUid || '', distributorName: closure?.distributorName || dispatch?.distributorName || movement.responsibleName || 'No disponible',
      lotCode: movement.lotCode || '', note: movement.note || '', reason: (movement as DistStockMovement & { reason?: string }).reason || '',
      lossCost: kind === 'unfit' || kind === 'shortage' || kind === 'dispatch_waste' ? (typeof movement.lossCost === 'number' && Number.isFinite(movement.lossCost) ? movement.lossCost : null) : null,
      reversed: false,
    }]
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  const totals: MermaReportResult['totals'] = {
    dispatch_merma: { kg: 0, package: 0, unit: 0 }, dispatch_waste: { kg: 0, package: 0, unit: 0 },
    return_merma: { kg: 0, package: 0, unit: 0 }, unfit: { kg: 0, package: 0, unit: 0 }, shortage: { kg: 0, package: 0, unit: 0 }, overage: { kg: 0, package: 0, unit: 0 },
  }
  const byProductMap = new Map<string, MermaReportResult['byProduct'][number]>()
  const byRouteMap = new Map<string, MermaReportResult['byRoute'][number]>()
  for (const row of rows) {
    totals[row.kind][row.unitType] = roundQuantity(totals[row.kind][row.unitType] + row.quantity, row.unitType)
    const product = byProductMap.get(row.productId) || { productId: row.productId, productName: row.productName, unitType: row.unitType, dispatchMerma: 0, dispatchWaste: 0, returnMerma: 0, unfit: 0, shortage: 0, overage: 0 }
    const productKey = row.kind === 'dispatch_merma' ? 'dispatchMerma' : row.kind === 'dispatch_waste' ? 'dispatchWaste' : row.kind === 'return_merma' ? 'returnMerma' : row.kind
    product[productKey] = roundQuantity(product[productKey] + row.quantity, row.unitType)
    byProductMap.set(row.productId, product)
    const routeKey = `${row.routeId}__${row.unitType}`
    const route = byRouteMap.get(routeKey) || { routeId: row.routeId, routeName: row.routeName, unitType: row.unitType, dispatchMerma: 0, dispatchWaste: 0, returnMerma: 0, unfit: 0, shortage: 0, overage: 0 }
    route[productKey] = roundQuantity(route[productKey] + row.quantity, row.unitType)
    byRouteMap.set(routeKey, route)
  }
  return { rows, totals, byProduct: [...byProductMap.values()].sort((a, b) => a.productName.localeCompare(b.productName)), byRoute: [...byRouteMap.values()].sort((a, b) => a.routeName.localeCompare(b.routeName)) }
}

export function mermaReportKindLabel(kind: MermaReportKind): string { return labels[kind] }
