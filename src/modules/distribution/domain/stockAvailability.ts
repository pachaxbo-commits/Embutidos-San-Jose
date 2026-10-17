import type { DistBalance, DistLot, UnitType } from '../types.ts'

export const roundStockQuantity = (value: number, unitType: UnitType): number => {
  const precision = unitType === 'kg' ? 1000 : 100
  return Math.round((Number(value) + Number.EPSILON) * precision) / precision
}

/** Separa la existencia física de lo que realmente puede venderse o despacharse. */
export function stockAvailability(
  balance: DistBalance | undefined,
  lots: DistLot[],
  location: string,
  today: string,
) {
  const unitType = balance?.unitType ?? 'unit'
  const physical = roundStockQuantity(Math.max(0, Number(balance?.quantity) || 0), unitType)
  const available = roundStockQuantity(Math.max(0, Number(balance?.availableQuantity ?? balance?.quantity) || 0), unitType)
  const unavailable = roundStockQuantity(Math.max(0, physical - available), unitType)
  let quarantine = 0
  let expired = 0
  for (const lot of lots) {
    if (lot.productId !== balance?.productId) continue
    const quantity = Math.max(0, Number(lot.quantities?.[location]) || 0)
    if (lot.quarantined) quarantine += quantity
    else if (lot.expiresOn && lot.expiresOn < today) expired += quantity
  }
  quarantine = roundStockQuantity(Math.min(unavailable, quarantine), unitType)
  expired = roundStockQuantity(Math.min(Math.max(0, unavailable - quarantine), expired), unitType)
  const other = roundStockQuantity(Math.max(0, unavailable - quarantine - expired), unitType)
  return { physical, available, unavailable, quarantine, expired, other }
}
