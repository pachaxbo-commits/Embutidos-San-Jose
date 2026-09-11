export function normalizeCI(value: string): string {
  const ci = value.trim().toUpperCase().replace(/[.\s]/g, '')
  if (!ci) return ''
  if (!/^[0-9]{4,12}(-[0-9A-Z]{1,5})?$/.test(ci)) throw new Error('Ingresa un CI válido, con complemento separado por guion si corresponde.')
  return ci
}
