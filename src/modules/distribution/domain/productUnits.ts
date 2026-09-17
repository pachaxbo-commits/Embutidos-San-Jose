import type { UnitType } from '../types'

/** Solo estas presentaciones determinan una unidad de venta inequívoca. */
export function unitForCategory(category: string): UnitType | null {
  if (category === 'Granel') return 'kg'
  if (category === 'Al vacio') return 'package'
  return null
}
