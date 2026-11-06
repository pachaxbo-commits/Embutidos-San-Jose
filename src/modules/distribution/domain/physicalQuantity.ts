export function quantityPrecisionForUnit(unitType: string): number {
  return unitType === 'kg' ? 3 : 0
}

export function roundQuantityForUnit(value: number, unitType = 'kg'): number {
  const scale = 10 ** quantityPrecisionForUnit(unitType)
  return Math.round((value + Number.EPSILON) * scale) / scale
}

/** Receives lots already ordered by FEFO. Uses integer physical quanta. */
export function allocatePhysicalQuantity(target: number, lots: readonly { id: string; available: number }[], unitType: string) {
  const scale = 10 ** quantityPrecisionForUnit(unitType)
  let remaining = Math.round(target * scale)
  const allocations: { lotId: string; quantity: number }[] = []
  for (const lot of lots) {
    const taken = Math.min(remaining, Math.max(0, Math.round(lot.available * scale)))
    if (taken > 0) allocations.push({ lotId: lot.id, quantity: taken / scale })
    remaining -= taken
  }
  return { allocations, remaining: remaining / scale }
}
