export type OfflineOperationStatus = 'queued' | 'confirmed' | 'rejected' | undefined

/** A provisional result is safe only while the operation remains queued. */
export function shouldReturnProvisional(
  status: OfflineOperationStatus,
  hasPendingWrites: boolean,
  hasProvisional: boolean,
): boolean {
  if (!hasProvisional || status === 'confirmed' || status === 'rejected') return false
  return status === 'queued' || hasPendingWrites
}

export function provisionalReceiptNotice(pending: boolean, thermal = false): string {
  if (!pending) return ''
  return thermal ? 'PENDIENTE DE SINCRONIZACION' : 'PENDIENTE DE SINCRONIZACIÓN'
}
