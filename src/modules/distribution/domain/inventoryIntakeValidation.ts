export function boliviaDayKey(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/La_Paz',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function isValidDayKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const timestamp = Date.parse(`${value}T00:00:00.000Z`)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
}

export function validateIntakeLotDates(
  manufacturedOn: string,
  expiresOn: string,
  now: Date = new Date(),
): string | null {
  if (!manufacturedOn) return 'Selecciona la fecha de elaboración.'
  if (!expiresOn) return 'Selecciona la fecha de vencimiento.'
  if (!isValidDayKey(manufacturedOn)) return 'Selecciona una fecha de elaboración válida.'
  if (!isValidDayKey(expiresOn)) return 'Selecciona una fecha de vencimiento válida.'
  if (manufacturedOn > boliviaDayKey(now)) return 'La elaboración no puede tener una fecha futura.'
  if (expiresOn < manufacturedOn) return 'El vencimiento no puede ser anterior a la elaboración.'
  return null
}
