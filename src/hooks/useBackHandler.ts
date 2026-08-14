import { useEffect, useRef } from 'react'
import { App as AppPlugin } from '@capacitor/app'
import { handleBackNavigation } from '../lib/backNavigation'
import { pushBackHandler, type BackHandler } from '../lib/backNavigation'

/**
 * Registra un handler de "atras" mientras `active` sea true.
 * Devolver false desde el handler significa "no me corresponde, sigue bajando".
 */
export function useBackHandler(active: boolean, handler: BackHandler) {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    if (!active) return
    return pushBackHandler(() => handlerRef.current())
  }, [active])
}

/**
 * Puente unico entre el boton fisico de Android / tecla Escape y la pila de
 * retroceso. Se instala una sola vez desde el shell de la aplicacion.
 */
export function useBackButtonBridge(onExhausted?: () => boolean | void) {
  const onExhaustedRef = useRef(onExhausted)
  onExhaustedRef.current = onExhausted

  useEffect(() => {
    let removeListener: (() => void) | null = null

    const resolveBack = () => {
      if (handleBackNavigation()) return true
      if (onExhaustedRef.current && onExhaustedRef.current() !== false) return true
      return false
    }

    const setup = async () => {
      try {
        const listener = await AppPlugin.addListener('backButton', ({ canGoBack }) => {
          if (resolveBack()) return
          if (canGoBack) {
            window.history.back()
          } else {
            void AppPlugin.exitApp()
          }
        })
        removeListener = () => {
          void listener.remove()
        }
      } catch {
        // En web no existe el plugin: no pasa nada.
      }
    }

    void setup()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (handleBackNavigation()) event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (removeListener) removeListener()
    }
  }, [])
}
