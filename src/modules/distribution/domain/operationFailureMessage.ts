type OperationFailure = Error & { code?: string; rejected?: boolean }

export function operationFailureMessage(type: 'intake' | 'resolveQuarantine' | string, failure: unknown): string {
  const error = failure as OperationFailure
  const message = error?.message || 'No se pudo confirmar la operación.'
  const code = String(error?.code || '').toLowerCase()
  const permissionDenied = code.includes('permission-denied') || /missing or insufficient permissions|permission-denied/i.test(message)

  if (permissionDenied) {
    if (type === 'resolveQuarantine') return 'No se pudo confirmar la revisión. No vuelvas a registrarla hasta comprobar su estado.'
    if (type === 'intake') return 'No se pudo confirmar el ingreso por falta de permisos. No vuelvas a registrarlo hasta comprobar su estado.'
  }

  if (/sigue pendiente de confirmación|pending.*confirmation/i.test(message)) {
    return type === 'resolveQuarantine'
      ? 'La revisión sigue pendiente de confirmación. No vuelvas a registrarla hasta comprobar su estado.'
      : 'El ingreso sigue pendiente de confirmación. No vuelvas a registrarlo hasta comprobar su estado.'
  }

  if (error?.rejected && type === 'resolveQuarantine') return `Liberación de cuarentena rechazada. ${message}`
  if (error?.rejected && type === 'intake' && /fecha|lote/i.test(message)) {
    return 'Ingreso de inventario rechazado. La fecha de elaboración o vencimiento necesita corregirse.'
  }
  if (error?.rejected && type === 'intake') return `Ingreso de inventario rechazado. ${message}`
  return message
}
