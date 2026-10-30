import { processingCommerciallyAvailable } from './processingCommercialAvailability.ts'
import { roundStockQuantity } from './stockAvailability.ts'
import { originPendingQuantity } from './originTraceability.ts'
import type { DistBalance, DistLot, UnitType } from '../types.ts'

export type WarehouseLotStatus = 'Disponible' | 'Disponible · trazabilidad incompleta' | 'Disponible parcialmente · origen pendiente' | 'Disponible parcialmente · reserva de elaboración' | 'Reservado · origen pendiente' | 'Reservado para cortesías' | 'Pendiente de reenvasado' | 'En revisión' | 'Vencido' | 'Cuarentena' | 'Bloqueado · elaboración pendiente de integración comercial'

export interface WarehouseLotRow {
  lot: DistLot
  physical: number
  available: number
  originPending: number
  status: WarehouseLotStatus
  hasFractionalCountQuantity: boolean
}

export function productWarehouseLotRows(
  productId: string,
  unitType: UnitType,
  lots: DistLot[],
  location: string,
  today: string,
): WarehouseLotRow[] {
  return lots
    .filter((lot) => lot.productId === productId)
    .map((lot) => ({ lot, physical: roundStockQuantity(Number(lot.quantities?.[location]) || 0, unitType) }))
    .filter((row) => row.physical > 0)
    .map(({ lot, physical }) => {
      const expired = Boolean(lot.expiresOn && lot.expiresOn < today)
      const traceIncomplete = !lot.lotCode?.trim() || !lot.manufacturedOn || !lot.expiresOn
      const held = lot.processingUnavailable?.[location]
      const heldQuantity = Number(held?.courtesy || 0) + Number(held?.repackPending || 0) + Number(held?.reviewHold || 0)
      const status: WarehouseLotStatus = !processingCommerciallyAvailable(lot)
        ? 'Bloqueado · elaboración pendiente de integración comercial'
        : lot.quarantined
        ? 'Cuarentena'
        : expired
          ? 'Vencido'
          : originPendingQuantity(lot, location) > 0
            ? originPendingQuantity(lot, location) >= physical ? 'Reservado · origen pendiente' : 'Disponible parcialmente · origen pendiente'
              : heldQuantity >= physical && Number(held?.reviewHold || 0) > 0 ? 'En revisión'
              : heldQuantity >= physical && Number(held?.repackPending || 0) > 0 ? 'Pendiente de reenvasado'
              : heldQuantity >= physical && Number(held?.courtesy || 0) > 0 ? 'Reservado para cortesías'
              : heldQuantity > 0 ? 'Disponible parcialmente · reserva de elaboración'
          : traceIncomplete
            ? 'Disponible · trazabilidad incompleta'
            : 'Disponible'
      return {
        lot,
        physical,
        available: status.startsWith('Disponible') ? Math.max(0, physical - originPendingQuantity(lot, location) - Number(lot.processingUnavailable?.[location]?.courtesy || 0) - Number(lot.processingUnavailable?.[location]?.repackPending || 0) - Number(lot.processingUnavailable?.[location]?.reviewHold || 0)) : 0,
        originPending: originPendingQuantity(lot, location),
        status,
        // Keep anomalous historical values visible as stored; never round a
        // fractional package/unit count into a fabricated integer.
        hasFractionalCountQuantity: unitType !== 'kg' && Math.abs(physical - Math.round(physical)) > 0.000001,
      }
    })
    .sort((a, b) => {
      const aValid = Boolean(a.lot.expiresOn && /^\d{4}-\d{2}-\d{2}$/.test(a.lot.expiresOn))
      const bValid = Boolean(b.lot.expiresOn && /^\d{4}-\d{2}-\d{2}$/.test(b.lot.expiresOn))
      if (aValid && bValid) return a.lot.expiresOn.localeCompare(b.lot.expiresOn) || a.lot.lotCode.localeCompare(b.lot.lotCode)
      if (aValid !== bValid) return aValid ? -1 : 1
      return a.lot.lotCode.localeCompare(b.lot.lotCode)
    })
}

export function warehouseLotReconciliation(
  rows: WarehouseLotRow[],
  balance: DistBalance | undefined,
  unitType: UnitType,
) {
  const lotPhysical = roundStockQuantity(rows.reduce((sum, row) => sum + row.physical, 0), unitType)
  const lotAvailable = roundStockQuantity(rows.reduce((sum, row) => sum + row.available, 0), unitType)
  const balancePhysical = roundStockQuantity(Number(balance?.quantity) || 0, unitType)
  const balanceAvailable = roundStockQuantity(Number(balance?.availableQuantity ?? balance?.quantity) || 0, unitType)
  const lotUnavailable = roundStockQuantity(Math.max(0, lotPhysical - lotAvailable), unitType)
  const untracedPhysical = roundStockQuantity(Math.max(0, balancePhysical - lotPhysical), unitType)
  return {
    lotPhysical,
    lotAvailable,
    lotUnavailable,
    balancePhysical,
    balanceAvailable,
    balanceUnavailable: roundStockQuantity(Math.max(0, balancePhysical - balanceAvailable), unitType),
    untracedPhysical,
    isBalanced: Math.abs(balancePhysical - lotPhysical) < 0.001,
  }
}
