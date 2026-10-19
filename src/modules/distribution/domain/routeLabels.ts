import type { DistRoute } from '../types'

/** `direct` is kept as a legacy storage value; its current business meaning is Impulsación. */
export function routeKindLabel(kind: DistRoute['kind']): string {
  return kind === 'direct' ? 'Impulsación' : 'Ruta distribuidor'
}

/** Normalize only the old combined label for display; never rewrite the stored route name. */
export function routeDisplayName(route: Pick<DistRoute, 'name' | 'kind'>): string {
  const legacyCombinedName = /^venta directa\s*\/\s*impulsaci[oó]n$/i
  if (route.kind === 'direct' && legacyCombinedName.test(route.name.trim())) return 'Impulsación'
  return route.name
}
