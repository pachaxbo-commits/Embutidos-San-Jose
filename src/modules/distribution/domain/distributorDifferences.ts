import type { DistClosure, DistStockMovement, UnitType } from '../types.ts'
import { matchesRoute, round2, toDayKey } from './engine.ts'

export interface DifferenceQuantityTotals {
  kg: number
  packages: number
  units: number
}

export interface DistributorDifferenceRow {
  closure: DistClosure
  productId: string
  productName: string
  routeId: string
  routeName: string
  distributorUid: string
  distributorName: string
  unitType: UnitType
  expected: number
  received: number
  shortage: number
  overage: number
  shortageValue: number | null
  shortageValueKnown: boolean
}

export interface DistributorDifferenceReport {
  rows: DistributorDifferenceRow[]
  shortages: DifferenceQuantityTotals
  overages: DifferenceQuantityTotals
  knownShortageValue: number
  missingShortageCostCount: number
}

function movementKey(dispatchId: string, routeId: string, productId: string) {
  return `${dispatchId}::${routeId}::${productId}`
}

function addQuantity(totals: DifferenceQuantityTotals, unitType: UnitType, quantity: number) {
  const key = unitType === 'kg' ? 'kg' : unitType === 'package' ? 'packages' : 'units'
  const places = unitType === 'kg' ? 1000 : 100
  totals[key] = Math.round((totals[key] + quantity) * places) / places
}

/**
 * Resumen de faltantes/sobrantes a partir del último estado físico vigente de
 * cada cierre. Los costos se leen solamente de movimientos activos enlazados;
 * los faltantes históricos sin enlace inequívoco quedan explícitamente incompletos.
 */
export function computeDistributorDifferences(
  closures: DistClosure[],
  movements: DistStockMovement[],
  dayKeys: string[],
  routeId = '',
  distributorUid = '',
): DistributorDifferenceReport {
  const days = new Set(dayKeys)
  const activeShortages = movements.filter(
    (movement) => movement.type === 'shortage' && !movement.reversedAt,
  )
  const shortageById = new Map(activeShortages.map((movement) => [movement.id, movement]))
  const shortageByDispatch = new Map<string, DistStockMovement[]>()
  for (const movement of activeShortages) {
    const dispatchId = movement.dispatchId
    if (!dispatchId || !movement.routeId) continue
    const key = movementKey(dispatchId, movement.routeId, movement.productId)
    shortageByDispatch.set(key, [...(shortageByDispatch.get(key) || []), movement])
  }

  const rows: DistributorDifferenceRow[] = closures
    .filter((closure) => ['warehouse_done', 'closed'].includes(closure.status))
    .filter((closure) => days.has(closure.dayKey || toDayKey(closure.warehouseClosedAt || closure.closedAt || closure.createdAt)))
    .filter((closure) => !routeId || matchesRoute(closure.routeId, routeId))
    .filter((closure) => !distributorUid || closure.distributorUid === distributorUid)
    .flatMap((closure) => closure.products.map((product) => {
      const received = Number(product.physicalReturn ?? (
        product.actualReturn + Number(product.returnMerma || 0) + Number(product.returnWaste || 0)
      ))
      const shortage = Number(product.shortage ?? Math.max(0, product.expectedReturn - received))
      const overage = Number(product.overage ?? Math.max(0, received - product.expectedReturn))
      let costMovement = product.shortageMovementId ? shortageById.get(product.shortageMovementId) : undefined
      if (!product.shortageMovementId && shortage > 0) {
        const candidates = shortageByDispatch.get(movementKey(closure.dispatchId, closure.routeId, product.productId)) || []
        const exact = candidates.filter((movement) => Math.abs(movement.quantity - shortage) < 0.001)
        if (exact.length === 1) costMovement = exact[0]
      }
      const shortageValueKnown = shortage <= 0 || (costMovement != null && typeof costMovement.lossCost === 'number' && Number.isFinite(costMovement.lossCost))
      return {
        closure,
        productId: product.productId,
        productName: product.productName,
        routeId: closure.routeId,
        routeName: closure.routeName,
        distributorUid: closure.distributorUid,
        distributorName: closure.distributorName,
        unitType: product.unitType,
        expected: product.expectedReturn,
        received,
        shortage,
        overage,
        shortageValue: shortage > 0 && shortageValueKnown ? Number(costMovement?.lossCost) : shortage === 0 ? 0 : null,
        shortageValueKnown,
      }
    }))
    .filter((row) => row.shortage > 0 || row.overage > 0)
    .sort((a, b) => (b.closure.warehouseClosedAt || b.closure.closedAt || b.closure.createdAt).localeCompare(a.closure.warehouseClosedAt || a.closure.closedAt || a.closure.createdAt))

  const shortages = { kg: 0, packages: 0, units: 0 }
  const overages = { kg: 0, packages: 0, units: 0 }
  for (const row of rows) {
    addQuantity(shortages, row.unitType, row.shortage)
    addQuantity(overages, row.unitType, row.overage)
  }
  return {
    rows,
    shortages,
    overages,
    knownShortageValue: round2(rows.reduce((sum, row) => sum + (row.shortageValue ?? 0), 0)),
    missingShortageCostCount: rows.filter((row) => row.shortage > 0 && !row.shortageValueKnown).length,
  }
}
