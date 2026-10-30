import type { DistLot } from '../types'
import { originPendingQuantity } from './originTraceability.ts'

/** Process types that the current sacheteado screen actually supports. */
export type SupportedProcessingUiType = 'bagging' | 'portioning'

/**
 * Older local drafts may contain `repackaging`, which used to be selectable
 * even though the backend only records a generic conversion batch. Treat that
 * legacy value as the supported bagging flow; it must never imply that a
 * finished, damaged package was actually repacked.
 */
export function normalizeProcessingUiType(value: unknown): SupportedProcessingUiType {
  return value === 'portioning' ? 'portioning' : 'bagging'
}

export function kgInputToGrams(value: string): number | null {
  const match = value.trim().match(/^(\d+)(?:[.,](\d{1,3}))?$/)
  if (!match) return null
  const grams = Number(match[1]) * 1000 + Number((match[2] || '').padEnd(3, '0'))
  return Number.isSafeInteger(grams) && grams > 0 ? grams : null
}

export function gramsInput(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null
  const grams = Number(value)
  return Number.isSafeInteger(grams) && grams > 0 ? grams : null
}

export function decimalInputToScaledInteger(value: string, scale: number): number | null {
  const places = scale === 1000 ? 3 : scale === 100 ? 2 : 0
  const match = value.trim().match(new RegExp(`^(\\d+)(?:[.,](\\d{1,${places}}))?$`))
  if (!match) return null
  const whole = Number(match[1])
  const fraction = Number((match[2] || '').padEnd(places, '0'))
  const scaled = whole * scale + fraction
  return Number.isSafeInteger(scaled) ? scaled : null
}

export function lotAvailableQuantity(lot: DistLot, location: string): number {
  const physical = Math.max(0, Number(lot.quantities?.[location]) || 0)
  const held = lot.processingUnavailable?.[location]
  return Math.max(0, physical - Number(held?.courtesy || 0) - Number(held?.repackPending || 0) - Number(held?.reviewHold || 0))
}

export function isEligibleProcessingLot(lot: DistLot, productId: string, location: string, today: string): boolean {
  return lot.productId === productId
    && lot.unitType === 'kg'
    && lotAvailableQuantity(lot, location) > 0
    && !lot.legacy
    && !(lot as DistLot & { synthetic?: boolean }).synthetic
    && !lot.quarantined
    && !lot.processingCommercialBlocked
    && originPendingQuantity(lot, location) === 0
    && !/^legacy_|ANTERIOR SIN FECHAS/i.test(`${lot.id} ${lot.lotCode || ''}`)
    && Boolean(lot.manufacturedOn && lot.expiresOn)
    && lot.manufacturedOn <= today
    && lot.expiresOn >= today
    && lot.expiresOn >= lot.manufacturedOn
}

export function formatKgFromGrams(grams: number): string {
  return `${(grams / 1000).toFixed(3)} kg`
}
