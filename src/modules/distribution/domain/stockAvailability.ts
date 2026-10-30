import { processingCommerciallyAvailable } from './processingCommercialAvailability.ts'
import type { DistBalance, DistLot, UnitType } from '../types.ts'
import { originPendingQuantity } from './originTraceability.ts'

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
  let quarantine = 0
  let expired = 0
  let originPending = 0
  let processingBlocked = 0
  let processingHeld = 0
  let courtesyReserved = 0
  let repackPending = 0
  let reviewHold = 0
  for (const lot of lots) {
    if (lot.productId !== balance?.productId) continue
    const quantity = Math.max(0, Number(lot.quantities?.[location]) || 0)
    if (!processingCommerciallyAvailable(lot)) processingBlocked += quantity
    else if (lot.quarantined) quarantine += quantity
    else if (lot.expiresOn && lot.expiresOn < today) expired += quantity
    else {
      if (!location.startsWith('route__')) originPending += originPendingQuantity(lot, location)
      const held = lot.processingUnavailable?.[location]
      courtesyReserved += Number(held?.courtesy || 0)
      repackPending += Number(held?.repackPending || 0)
      reviewHold += Number(held?.reviewHold || 0)
      processingHeld += Number(held?.courtesy || 0) + Number(held?.repackPending || 0) + Number(held?.reviewHold || 0)
    }
  }
  const lotUnavailable = roundStockQuantity(processingBlocked + quarantine + expired + originPending + processingHeld, unitType)
  const effectiveAvailable = roundStockQuantity(Math.min(available, Math.max(0, physical - lotUnavailable)), unitType)
  const effectiveUnavailable = roundStockQuantity(Math.max(0, physical - effectiveAvailable), unitType)
  let unclassifiedUnavailable = effectiveUnavailable
  const quarantineVisible = roundStockQuantity(Math.min(unclassifiedUnavailable, quarantine), unitType); unclassifiedUnavailable = roundStockQuantity(unclassifiedUnavailable - quarantineVisible, unitType)
  const expiredVisible = roundStockQuantity(Math.min(unclassifiedUnavailable, expired), unitType); unclassifiedUnavailable = roundStockQuantity(unclassifiedUnavailable - expiredVisible, unitType)
  const processingBlockedVisible = roundStockQuantity(Math.min(unclassifiedUnavailable, processingBlocked), unitType); unclassifiedUnavailable = roundStockQuantity(unclassifiedUnavailable - processingBlockedVisible, unitType)
  const originPendingVisible = roundStockQuantity(Math.min(unclassifiedUnavailable, originPending), unitType); unclassifiedUnavailable = roundStockQuantity(unclassifiedUnavailable - originPendingVisible, unitType)
  const processingHeldVisible = roundStockQuantity(Math.min(unclassifiedUnavailable, processingHeld), unitType); unclassifiedUnavailable = roundStockQuantity(unclassifiedUnavailable - processingHeldVisible, unitType)
  let heldVisible = processingHeldVisible
  const courtesyVisible = roundStockQuantity(Math.min(heldVisible, courtesyReserved), unitType); heldVisible = roundStockQuantity(heldVisible - courtesyVisible, unitType)
  const repackVisible = roundStockQuantity(Math.min(heldVisible, repackPending), unitType); heldVisible = roundStockQuantity(heldVisible - repackVisible, unitType)
  const reviewVisible = roundStockQuantity(Math.min(heldVisible, reviewHold), unitType)
  return { physical, available: effectiveAvailable, unavailable: effectiveUnavailable, quarantine: quarantineVisible, expired: expiredVisible, other: unclassifiedUnavailable, processingBlocked: processingBlockedVisible, processingHeld: processingHeldVisible, courtesyReserved: courtesyVisible, repackPending: repackVisible, reviewHold: reviewVisible, ...(originPendingVisible > 0 ? { originPending: originPendingVisible } : {}) }
}
