/** Evita mostrar identificadores técnicos de Firebase en la interfaz. */
export function isInternalIdentifier(value?: string | null) {
  const text = value?.trim() || ''
  if (!text) return false
  return (
    /^[A-Za-z0-9_-]{18,}$/.test(text) ||
    /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(text) ||
    /^(?:route|warehouse|legacy)__/.test(text)
  )
}

export function visiblePersonName(value?: string | null, fallback = 'Usuario de registro anterior') {
  return !value || isInternalIdentifier(value) ? fallback : value
}

export function visibleRecordText(value: string | undefined, fallback: string) {
  return !value || isInternalIdentifier(value) ? fallback : value
}
