import type { UnitType } from '../types'
const round2 = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100

export interface ReturnBreakdown {
  apt: number
  waste: number
  shortage: number
  overage: number
  wasteValid: boolean
}

export interface PhysicalReturnBreakdown {
  normalReturn: number
  recoverableMerma: number
  nonSellableReturn: number
  totalReceived: number
  sellableReturn: number
  /** Porción vendible con origen verificable en el despacho; el exceso queda en cuarentena. */
  sellableFromDispatch: number
  sellableOverage: number
  shortage: number
  overage: number
}

/**
 * Lee cantidades tecleadas sin interrumpir la escritura de decimales como
 * "1," o "1.". Devuelve null mientras el valor esté incompleto o inválido.
 */
export function parseReturnQuantityInput(value: string): number | null {
  const raw = value.trim()
  if (!raw) return null
  const normalized = raw.replace(',', '.')
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized) || normalized.endsWith('.')) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed >= 0 ? round2(parsed) : null
}

/**
 * Semántica nueva de recepción:
 * - retorno normal y merma recuperable vuelven al stock vendible;
 * - producto no apto es una pérdida;
 * - las tres cantidades son partes distintas del total físico recibido.
 */
export function calculatePhysicalReturnBreakdown(
  expected: number,
  normal: number,
  recoverableMerma: number,
  nonSellable: number,
): PhysicalReturnBreakdown {
  const expectedQty = round2(expected)
  const normalQty = round2(normal)
  const mermaQty = round2(recoverableMerma)
  const nonSellableQty = round2(nonSellable)
  const values = [expectedQty, normalQty, mermaQty, nonSellableQty]
  if (!values.every(Number.isFinite) || values.some((value) => value < 0)) {
    throw new Error('Las cantidades de retorno deben ser válidas y no negativas.')
  }

  const totalReceived = round2(normalQty + mermaQty + nonSellableQty)
  const sellableReturn = round2(normalQty + mermaQty)
  const sellableFromDispatch = round2(Math.min(sellableReturn, expectedQty))
  return {
    normalReturn: normalQty,
    recoverableMerma: mermaQty,
    nonSellableReturn: nonSellableQty,
    totalReceived,
    sellableReturn,
    sellableFromDispatch,
    sellableOverage: round2(Math.max(0, sellableReturn - expectedQty)),
    shortage: round2(Math.max(0, expectedQty - totalReceived)),
    overage: round2(Math.max(0, totalReceived - expectedQty)),
  }
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
