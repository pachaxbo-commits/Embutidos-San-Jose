/**
 * Pila central de navegacion "atras".
 *
 * El boton fisico de Android (y la tecla Escape en web) tiene que respetar
 * un orden claro: primero cierra el elemento mas superficial (modal, hoja,
 * formulario secundario) y solo cuando no queda nada abierto sale de la
 * pantalla o de la app. Antes cada pantalla resolvia esto por su cuenta, que
 * es como el usuario terminaba atrapado sin forma de volver.
 *
 * Cualquier componente que abra "una capa" registra aqui su handler y lo
 * quita al desmontarse.
 */

export type BackHandler = () => boolean | void

interface RegisteredHandler {
  id: number
  handler: BackHandler
}

let nextId = 1
const stack: RegisteredHandler[] = []

/** Registra un handler de retroceso. Devuelve la funcion para quitarlo. */
export function pushBackHandler(handler: BackHandler): () => void {
  const entry: RegisteredHandler = { id: nextId++, handler }
  stack.push(entry)

  return () => {
    const index = stack.findIndex((item) => item.id === entry.id)
    if (index >= 0) stack.splice(index, 1)
  }
}

/**
 * Ejecuta el handler mas reciente.
 * @returns true si alguien consumio el retroceso (no hay que salir de la pantalla).
 */
export function handleBackNavigation(): boolean {
  for (let index = stack.length - 1; index >= 0; index--) {
    const result = stack[index].handler()
    if (result !== false) return true
  }
  return false
}

export function hasBackHandlers(): boolean {
  return stack.length > 0
}

/** Solo para pruebas/reinicio de sesion */
export function resetBackHandlers(): void {
  stack.length = 0
}
