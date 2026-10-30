import { useState } from 'react'
import { Field, TextInput } from '../../../components/ui/Form'
import type { DistLot } from '../types'
import { loadMyProcessingQualityAuthorization, newOperationId, releaseProcessingLot } from '../data/distributionRepository'
import { SecondaryButton } from './shared'

export function ProcessingCommercialRelease({ lot }: { lot: DistLot }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [operationId] = useState(() => newOperationId('processing-release'))
  const submit = async () => {
    setBusy(true); setMessage('')
    try {
      const authorization = await loadMyProcessingQualityAuthorization()
      if (!authorization || authorization.status !== 'active') throw new Error('Necesitas una autorización vigente de Calidad para liberar este lote.')
      await releaseProcessingLot({ lotId: lot.id, authorizationReference: authorization.id, reason }, operationId)
      setMessage('Liberación confirmada. El lote conserva sus pesos, costos y trazabilidad de elaboración.')
    } catch {
      setMessage('No se confirmó la liberación. Verifica tu autorización de Calidad, las reservas, las fechas y la conciliación del lote antes de reintentar.')
    } finally { setBusy(false) }
  }
  return <section className="mt-3 space-y-2 rounded-xl border p-3">
    <p className="text-sm font-bold">Liberación comercial · {lot.lotCode}</p>
    {lot.processingCommercialRelease?.status === 'released' ? <p className="text-xs">Autorizado para uso comercial; se mantienen los controles de inventario y reservas.</p> : <>
      <p className="text-xs">Calidad debe verificar la aptitud del lote terminado. Esta acción no libera cuarentena ni producto reservado.</p>
      <Field label="Fundamento de aptitud y liberación"><TextInput value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></Field>
      <SecondaryButton disabled={busy || reason.trim().length < 10} onClick={() => void submit()}>{busy ? 'Comprobando…' : 'Autorizar uso comercial'}</SecondaryButton>
    </>}
    {message && <p role="status" className="text-xs">{message}</p>}
  </section>
}
