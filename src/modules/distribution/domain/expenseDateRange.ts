import { boliviaDayKey } from '../domain/inventoryIntakeValidation'

export type RangeMode = 'today' | 'yesterday' | 'week' | 'month' | 'last_month' | 'custom' | 'all'

export function dayOffset(offset: number) {
  const date = new Date(`${boliviaDayKey()}T12:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

export function getRange(mode: RangeMode, from: string, to: string): [string | undefined, string | undefined] {
  const today = dayOffset(0)
  if (mode === 'all') return [undefined, undefined]
  if (mode === 'today') return [today, today]
  if (mode === 'yesterday') return [dayOffset(-1), dayOffset(-1)]
  if (mode === 'custom') return [from || today, to || from || today]
  const [year, month, day] = today.split('-').map(Number)
  const localToday = new Date(Date.UTC(year, month - 1, day, 12))
  if (mode === 'week') {
    const start = new Date(localToday)
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7))
    return [start.toISOString().slice(0, 10), today]
  }
  if (mode === 'month') return [new Date(Date.UTC(year, month - 1, 1, 12)).toISOString().slice(0, 10), today]
  return [
    new Date(Date.UTC(year, month - 2, 1, 12)).toISOString().slice(0, 10),
    new Date(Date.UTC(year, month - 1, 0, 12)).toISOString().slice(0, 10),
  ]
}

