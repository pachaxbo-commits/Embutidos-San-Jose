/**
 * Utilidades para presentación comercial unificada de productos.
 *
 * Mantiene compatibilidad con datos históricos que hayan usado
 * `presentationSnapshot` o `descriptionSnapshot`.
 */

export function getProductPresentation(
  product?: { presentation?: string; description?: string; category?: string } | null,
): string {
  if (!product) return ''
  return product.presentation?.trim() || product.description?.trim() || ''
}

export function getLinePresentation(
  line?: { presentationSnapshot?: string; descriptionSnapshot?: string } | null,
  fallbackProduct?: { presentation?: string; description?: string } | null,
): string {
  if (!line) return getProductPresentation(fallbackProduct)
  return (
    line.presentationSnapshot?.trim() ||
    line.descriptionSnapshot?.trim() ||
    getProductPresentation(fallbackProduct)
  )
}
