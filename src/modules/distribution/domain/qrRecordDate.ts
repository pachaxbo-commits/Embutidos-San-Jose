const BOLIVIA_TIME_ZONE = 'America/La_Paz'

export interface QrDateDisplay {
  text: string
  precision: 'date-time' | 'date' | 'none'
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'object' && value !== null) {
    const timestamp = value as { toDate?: () => Date; seconds?: number; nanoseconds?: number }
    if (typeof timestamp.toDate === 'function') {
      try {
        const date = timestamp.toDate()
        return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null
      } catch {
        return null
      }
    }
    if (typeof timestamp.seconds === 'number') {
      const milliseconds = timestamp.seconds * 1000 + Math.floor((timestamp.nanoseconds || 0) / 1_000_000)
      const date = new Date(milliseconds)
      return Number.isNaN(date.getTime()) ? null : date
    }
  }
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  // Never interpret a timezone-less timestamp using the device's local zone.
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) return null
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatBoliviaDate(date: Date, includeTime: boolean): string {
  const parts = new Intl.DateTimeFormat('es-BO', {
    timeZone: BOLIVIA_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' as const } : {}),
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  const { day, month, year, hour, minute } = values
  if (!day || !month || !year) return ''
  const dateText = `${day}/${month}/${year}`
  return includeTime && hour && minute ? `${dateText} · ${hour}:${minute}` : dateText
}

function parseDayKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return null
  const [, year, month, day] = match
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day)) return null
  return `${day}/${month}/${year}`
}

/** Formats transaction timestamps in Bolivia, independently of the device timezone. */
export function formatQrRecordDate(timestamp: unknown, dayKey?: unknown): QrDateDisplay {
  if (typeof timestamp === 'string') {
    const dateOnly = parseDayKey(timestamp.trim())
    if (dateOnly) return { text: dateOnly, precision: 'date' }
  }

  const date = toDate(timestamp)
  if (date) return { text: formatBoliviaDate(date, true), precision: 'date-time' }

  if (typeof timestamp === 'string') {
    const localDate = /^(\d{4}-\d{2}-\d{2})T/.exec(timestamp.trim())?.[1]
    const parsedLocalDate = parseDayKey(localDate)
    if (parsedLocalDate) return { text: parsedLocalDate, precision: 'date' }
  }

  const day = parseDayKey(dayKey)
  return day ? { text: day, precision: 'date' } : { text: 'Fecha no disponible', precision: 'none' }
}
