import { useCallback, useEffect, useState } from 'react'
import { listRestaurantMembers } from '../../../lib/firebase'
import type { RestaurantMember } from '../../../types'

/**
 * Usuarios activos de San José. Lee la subcolección técnica `members`
 * utilizada por autenticación y permisos.
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
