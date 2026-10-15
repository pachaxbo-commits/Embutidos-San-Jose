import type { UnitType } from '../types'
const round2 = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100

export interface ReturnBreakdown {
  apt: number
  waste: number
  shortage: number
  overage: number
  wasteValid: boolean
}

/** Calcula la rendición física sin confundir producto vendible, merma y faltante. */
export function calculateReturnBreakdown(expected: number, received: number, waste: number): ReturnBreakdown {
  const expectedQty = round2(expected)
  const receivedQty = round2(received)
  const wasteQty = round2(waste)
  const valid = [expectedQty, receivedQty, wasteQty].every(Number.isFinite)
    && expectedQty >= 0 && receivedQty >= 0 && wasteQty >= 0
  if (!valid) throw new Error('Las cantidades de retorno deben ser válidas y no negativas.')
  const recognizedReceived = Math.min(receivedQty, expectedQty)
  const wasteValid = wasteQty <= recognizedReceived + 0.001
  const aptQty = round2(Math.max(0, recognizedReceived - wasteQty))
  return {
    apt: aptQty,
    waste: wasteQty,
    shortage: round2(Math.max(0, expectedQty - receivedQty)),
    overage: round2(Math.max(0, receivedQty - expectedQty)),
    wasteValid,
  }
}

export function validateReturnQuantity(unitType: UnitType, value: number): boolean {
  return Number.isFinite(value) && value >= 0 && (unitType === 'kg' || Number.isInteger(value))
}
