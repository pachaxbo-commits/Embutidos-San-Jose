import type { DistRoute } from '../types'

/** `direct` is kept as a legacy storage value; its current business meaning is Impulsación. */
export function routeKindLabel(kind: DistRoute['kind']): string {
  return kind === 'direct' ? 'Impulsación' : 'Ruta distribuidor'
}

/** Administration is a sales channel, never an assignable distributor route. */
export function isAssignableDistributorRoute(route: Pick<DistRoute, 'id'>): boolean {
  return route.id !== 'administracion' && route.id !== 'admin'
}

/** Normalize only the old combined label for display; never rewrite the stored route name. */
export function routeDisplayName(route: Pick<DistRoute, 'id' | 'name' | 'kind'>): string {
  const isImpulsionRoute = route.kind === 'direct' || route.id === 'route-impulsacion' || route.id === 'route-directa'
  return isImpulsionRoute ? 'Impulsación' : route.name
}
