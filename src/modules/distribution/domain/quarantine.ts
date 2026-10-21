import type { DistLot, DistStockMovement, DistWarehouse } from '../types'
import { toDayKey } from './engine.ts'

export type QuarantineStatusFilter = 'pending' | 'resolved' | 'all'
export type QuarantinePeriod = 'today' | 'week' | 'month' | 'custom'

export interface QuarantineRow {
  lot: DistLot
  location: string
  quantity: number
  status: 'pending' | 'resolved'
  source: string
  sourceMovement?: DistStockMovement
  enteredAt: string
  reason: string
  warehouseName: string
  resolutionLabel?: string
}

const positive = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0

export function quarantineRows(
  lots: DistLot[],
  movements: DistStockMovement[],
  warehouses: DistWarehouse[],
): QuarantineRow[] {
  const activeMovements = movements.filter((movement) => !movement.reversedAt)
  const rows: QuarantineRow[] = []
  for (const lot of lots) {
    const resolution = lot.quarantineResolution
    const resolved = Boolean(resolution && lot.quarantineResolvedAt)
    const sourceMovement = activeMovements
      .filter((movement) => movement.productId === lot.productId && (movement.type === 'overage' || movement.type === 'customer_return') && movement.lotId === lot.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    const source = sourceMovement?.type === 'overage'
      ? 'Sobrante de cierre'
      : sourceMovement?.type === 'customer_return'
        ? 'Devolución de cliente'
        : 'Otra cuarentena'
    const locations = resolved
      ? [lot.quarantineResolvedLocation || 'central']
      : Object.keys(lot.quantities || {}).filter((location) => location === 'central' || location.startsWith('warehouse__'))
    for (const location of locations) {
      const quantity = resolved ? positive(lot.quarantineResolvedQuantity) : positive(lot.quantities?.[location])
      if (!quantity) continue
      if (!resolved && !lot.quarantined) continue
      const warehouseId = location === 'central' ? 'central' : location.slice('warehouse__'.length)
      const warehouseName = warehouseId === 'central'
        ? 'Almacén central'
        : warehouses.find((warehouse) => warehouse.id === warehouseId)?.name || 'Otro almacén'
      rows.push({
        lot,
        location,
        quantity,
        status: resolved ? 'resolved' : 'pending',
        source,
        sourceMovement,
        enteredAt: sourceMovement?.createdAt || lot.createdAt,
        reason: lot.quarantineResolutionReason || (sourceMovement as (DistStockMovement & { reason?: string }) | undefined)?.reason || sourceMovement?.note || '',
        warehouseName,
        resolutionLabel: resolution === 'released_existing_lot' || resolution === 'released_new_lot'
          ? 'Liberado a venta'
          : resolution === 'discarded' ? 'Descartado / no apto'
            : resolution === 'rectified_input_error' ? 'Rectificado — error de registro' : undefined,
      })
    }
  }
  return rows.sort((a, b) => (b.status === 'pending' ? 1 : 0) - (a.status === 'pending' ? 1 : 0) || b.enteredAt.localeCompare(a.enteredAt))
}

export function filterQuarantineRows(
  rows: QuarantineRow[],
  options: { status: QuarantineStatusFilter; location?: string; dayKeys?: string[] },
): QuarantineRow[] {
  const keys = options.dayKeys?.length ? new Set(options.dayKeys) : null
  return rows.filter((row) => {
    if (options.status !== 'all' && row.status !== options.status) return false
    if (options.location && row.location !== options.location) return false
    if (keys) {
      const timestamp = row.status === 'resolved' ? row.lot.quarantineResolvedAt : row.enteredAt
      const key = row.status === 'pending' && row.sourceMovement?.dayKey
        ? row.sourceMovement.dayKey
        : timestamp ? toDayKey(timestamp) : ''
      if (!keys.has(key)) return false
    }
    return true
  })
}

export function summarizeQuarantine(rows: QuarantineRow[]) {
  return rows.reduce((sum, row) => {
    sum[row.lot.unitType] += row.quantity
    return sum
  }, { kg: 0, package: 0, unit: 0 })
}
