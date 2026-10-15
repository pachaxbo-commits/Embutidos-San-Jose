import type { UnitType } from '../types'
const round2 = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100

export interface ReturnBreakdown {
  apt: number
  waste: number
  shortage: number
  overage: number
}

/** Calcula la rendición física sin confundir producto vendible, merma y faltante. */
export function calculateReturnBreakdown(expected: number, apt: number, waste: number): ReturnBreakdown {
  const expectedQty = round2(expected)
  const aptQty = round2(apt)
  const wasteQty = round2(waste)
  const valid = [expectedQty, aptQty, wasteQty].every(Number.isFinite)
    && expectedQty >= 0 && aptQty >= 0 && wasteQty >= 0
  if (!valid) throw new Error('Las cantidades de retorno deben ser válidas y no negativas.')
  const normalApt = Math.min(aptQty, Math.max(0, round2(expectedQty - wasteQty)))
  return {
    apt: aptQty,
    waste: wasteQty,
    shortage: round2(Math.max(0, expectedQty - aptQty - wasteQty)),
    overage: round2(Math.max(0, aptQty - normalApt)),
  }
}

export function validateReturnQuantity(unitType: UnitType, value: number): boolean {
  return Number.isFinite(value) && value >= 0 && (unitType === 'kg' || Number.isInteger(value))
}
