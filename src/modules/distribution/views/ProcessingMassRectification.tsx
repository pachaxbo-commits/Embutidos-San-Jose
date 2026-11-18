import { useState } from 'react'
import { newOperationId } from '../data/distributionRepository'
import { submitOperation } from '../data/operationQueue'
import type { ProcessingBatch } from '../domain/processing'

type Summary = { input: number; net: number; discard: number; cost: number; totalCost: number }
type Impact = { revision: string; before: Summary; after: Summary; quantity: number; remaining: number; departed: number; sources: { id: string; code: string; deltaG: number; stockBeforeG: number; stockAfterG: number }[] }

export function ProcessingMassRectification({ batch }: { batch: ProcessingBatch }) {
  const [net, setNet] = useState('')
  const [discard, setDiscard] = useState('')
  const [sources, setSources] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [evidence, setEvidence] = useState('')
  const [commitId, setCommitId] = useState('')
  const [checked, setChecked] = useState(false)
  const [impact, setImpact] = useState<Impact | null>(null)
  const [saved, setSaved] = useState((batch as ProcessingBatch & { massRectification?: Impact }).massRectification)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const sourceRows = batch.sourceAllocations.map(row => {
    const stored = row as typeof row & { sourceLotId?: string; sourceLotCode?: string }
    return { id: stored.sourceLotId || row.lotId, code: stored.sourceLotCode || row.lotCode, grams: row.measuredNetWeightG }
  })
  const invalidate = () => { setChecked(false); setImpact(null) }
  async function run(preview: boolean) {
    setBusy(true)
    setMessage('')
    try {
      if (!net.trim() || !discard.trim() || sourceRows.some(row => !sources[row.id]?.trim())) throw new Error('Completa todos los pesos verificados. Ingresa cero cuando corresponda.')
      const result = await submitOperation<Impact>('rectifyProcessingMass', {
        batchId: batch.id, netWeightG: Number(net), discardWeightG: Number(discard), preview,
        sources: sourceRows.map(row => ({ id: row.id, consumedG: Number(sources[row.id]) })),
        ...(preview ? {} : { revision: impact?.revision, explicitConfirmation: checked, reason, evidenceNote: evidence }),
      }, preview ? newOperationId('processing_mass_preview') : commitId)
      if (preview) { setImpact(result); setChecked(false); setCommitId(newOperationId('processing_mass_rectification')) }
      else { setSaved(result); setMessage('Rectificación confirmada.') }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo procesar la rectificación.') }
    finally { setBusy(false) }
  }
  const shown = saved || impact
  return <details className="mt-3 rounded-xl border p-3">
    <summary className="font-bold">Rectificar elaboración</summary>
    {!saved && <fieldset disabled={busy} className="mt-3 grid gap-2">
      <label>Peso terminado verificado (g)<input type="number" min="1" value={net} onChange={e => { setNet(e.target.value); invalidate() }} className="block w-full rounded border p-2" /></label>
      <label>Descarte verificado (g)<input type="number" min="0" value={discard} onChange={e => { setDiscard(e.target.value); invalidate() }} className="block w-full rounded border p-2" /></label>
      {sourceRows.map(row => <label key={row.id}>Lote {row.code} · consumo verificado (g) · registrado {row.grams} g<input type="number" min="0" value={sources[row.id] || ''} onChange={e => { setSources(current => ({ ...current, [row.id]: e.target.value })); invalidate() }} className="block w-full rounded border p-2" /></label>)}
      <button type="button" className="rounded bg-slate-100 p-2 font-bold" onClick={() => void run(true)}>Calcular impacto</button>
    </fieldset>}
    {shown && <div className="mt-3 space-y-2 text-sm">
      <p>{shown.quantity} paquetes producidos · {shown.remaining} en el lote · {shown.departed} salieron del lote.</p>
      <div className="grid gap-2 sm:grid-cols-2">{(['before', 'after'] as const).map(key => <div key={key} className="rounded bg-slate-50 p-2">
        <strong>{key === 'before' ? 'Registrado' : 'Corrección'}</strong>
        <p>{shown[key].input} g consumidos · {shown[key].net} g terminados · {shown[key].discard} g descarte</p>
        <p>{(shown[key].net / shown.quantity).toFixed(2)} g/paq · Bs {(shown[key].cost / 100 / shown.quantity).toFixed(2)}/paq</p>
        <p>Bs {(shown[key].cost / 100).toFixed(2)} terminado · Bs {(shown[key].totalCost / 100).toFixed(2)} fuente</p>
      </div>)}</div>
      {shown.sources.map(row => <p key={row.id}>Lote {row.code} · ajuste {row.deltaG / 1000} kg · saldo {row.stockBeforeG / 1000} → {row.stockAfterG / 1000} kg</p>)}
    </div>}
    {impact && !saved && <fieldset disabled={busy} className="mt-3 grid gap-2">
      <label>Motivo<textarea value={reason} onChange={e => setReason(e.target.value)} className="block w-full rounded border p-2" /></label>
      <label>Evidencia de pesaje y ubicación del excedente<textarea value={evidence} onChange={e => setEvidence(e.target.value)} className="block w-full rounded border p-2" /></label>
      <label className="flex gap-2"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} /> Verifiqué los pesos y confirmo el ajuste.</label>
      <button type="button" disabled={!checked || reason.trim().length < 12 || evidence.trim().length < 12} className="rounded bg-slate-900 p-2 font-bold text-white disabled:opacity-50" onClick={() => void run(false)}>Confirmar rectificación</button>
    </fieldset>}
    {message && <p role="status" className="mt-2 text-sm">{message}</p>}
  </details>
}
