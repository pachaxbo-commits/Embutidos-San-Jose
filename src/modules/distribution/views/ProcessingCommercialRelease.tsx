import { useState } from 'react'
import { Field, TextInput } from '../../../components/ui/Form'
import type { DistLot } from '../types'
import { loadMyProcessingQualityAuthorization, newOperationId, releaseProcessingLot } from '../data/distributionRepository'
import { SecondaryButton } from './shared'
import { recordErrorDiagnostic } from '../../../lib/errorDiagnostics'

export function ProcessingCommercialRelease({ lot }: { lot: DistLot }) {
  const repackOutput = Boolean(lot.processingRepackId)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [operationId] = useState(() => newOperationId('processing-release'))
  const submit = async () => {
    setBusy(true); setMessage('')
    try {
      const authorization = repackOutput ? await loadMyProcessingQualityAuthorization() : null
      if (repackOutput && (!authorization || authorization.status !== 'active')) throw new Error('Necesitas una autorización vigente de Calidad para liberar la salida reenvasada.')
      await releaseProcessingLot({ lotId: lot.id, reason: reason.trim(), ...(authorization ? { authorizationReference: authorization.id } : {}) }, operationId)
      setMessage(repackOutput ? 'Liberación confirmada. El lote conserva sus pesos, costos y trazabilidad de elaboración.' : 'Lote liberado para despacho y venta.')
    } catch (error) {
      recordErrorDiagnostic({ error: error instanceof Error ? error : new Error(String(error)), source: 'handled_operation_failure', view: 'dist.processing.release' })
      setMessage(repackOutput
        ? error instanceof Error ? error.message : 'No se confirmó la liberación de la salida reenvasada.'
        : error instanceof Error ? error.message : 'No se confirmó la liberación. Revisa el fundamento y que el lote esté disponible.')
    } finally { setBusy(false) }
  }
  return <section className="mt-3 space-y-2 rounded-xl border p-3">
    <p className="text-sm font-bold">Liberación comercial · {lot.lotCode}</p>
    {lot.processingCommercialRelease?.status === 'released' ? <p className="text-xs">Autorizado para uso comercial; se mantienen los controles de inventario y reservas.</p> : <>
      <p className="text-xs">{repackOutput ? 'La salida reenvasada conserva su autorización específica de Calidad. Esta acción no libera cuarentena ni producto reservado.' : 'Administración revisa el lote terminado y registra el fundamento. Las reservas, cuarentenas y demás bloqueos siguen vigentes.'}</p>
      <Field label={repackOutput ? 'Fundamento de aptitud y liberación' : 'Fundamento de liberación'}><TextInput value={reason} disabled={busy} onChange={event => setReason(event.target.value)} placeholder="Producto apto para despacho y venta" /></Field>
      <SecondaryButton disabled={busy || reason.trim().length < 10} onClick={() => void submit()}>{busy ? 'Liberando…' : repackOutput ? 'Autorizar uso comercial' : 'Liberar para despacho y venta'}</SecondaryButton>
    </>}
    {message && <p role="status" className="text-xs">{message}</p>}
  </section>
}
