import { useCallback, useEffect, useState } from 'react'
import { listRestaurantMembers } from '../../../lib/firebase'
import type { RestaurantMember } from '../../../types'

/**
 * Miembros del tenant activo. Reutiliza el listado seguro ya existente
 * (subcoleccion members del restaurante) en vez de duplicar usuarios.
 */
export function useTenantMembers() {
  const [members, setMembers] = useState<RestaurantMember[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setIsLoading(true)
    try {
      const rows = await listRestaurantMembers()
      setMembers(rows)
      setError(null)
    } catch (loadError) {
      setError((loadError as Error).message || 'No se pudieron cargar los usuarios.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { members, isLoading, error, reload }
}
