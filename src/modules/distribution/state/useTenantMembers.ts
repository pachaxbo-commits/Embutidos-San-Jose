import { useCallback, useEffect, useState } from 'react'
import { subscribeRestaurantMembers } from '../../../lib/firebase'
import type { RestaurantMember } from '../../../types'

/**
 * Usuarios activos de San José. Lee la subcolección técnica `members`
 * utilizada por autenticación y permisos.
 */
export function useTenantMembers() {
  const [members, setMembers] = useState<RestaurantMember[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [revision, setRevision] = useState(0)
  const reload = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    setRevision(value => value + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined
    const timeout = window.setTimeout(() => {
      if (!cancelled) {
        setIsLoading(false)
        setError('La lista de usuarios tardó demasiado. Revisa la conexión e intenta nuevamente.')
      }
    }, 12000)
    void subscribeRestaurantMembers(
      rows => {
        if (cancelled) return
        window.clearTimeout(timeout)
        setMembers(rows)
        setError(null)
        setIsLoading(false)
      },
      loadError => {
        if (cancelled) return
        window.clearTimeout(timeout)
        setError(loadError.message || 'No se pudieron cargar los usuarios.')
        setIsLoading(false)
      },
    ).then(stop => {
      if (cancelled) stop()
      else unsubscribe = stop
    }).catch(loadError => {
      if (cancelled) return
      window.clearTimeout(timeout)
      setError((loadError as Error).message || 'No se pudieron cargar los usuarios.')
      setIsLoading(false)
    })
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
      unsubscribe?.()
    }
  }, [revision])

  return { members, isLoading, error, reload }
}
