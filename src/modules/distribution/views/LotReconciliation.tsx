import { useEffect, useState } from 'react'
import { toDayKey } from '../domain/engine'
import type { DistLot } from '../types'
import { loadLotOriginHistory, newOperationId } from '../data/distributionRepository'
import { submitOperation } from '../data/operationQueue'

export function LotReconciliation({ lot, location, admin }: { lot: DistLot; location: string; admin: boolean }) {
  const refs = lot.pendingOrigins?.[location] || []
  const pending = Math.round(refs.reduce((sum, ref) => sum + ref.quantity, 0) * 1000) / 1000
  const [openedLot, setOpenedLot] = useState<DistLot | null>(null)
  const [mode, setMode] = useState<'origin' | 'identity' | null>(null)
  const [quantity, setQuantity] = useState(String(pending))
  const [kind, setKind] = useState('physical_check')
  const [reason, setReason] = useState('')
  const [evidence, setEvidence] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [code, setCode] = useState(lot.lotCode || '')
  const [manufactured, setManufactured] = useState(lot.manufacturedOn || '')
  const [expiry, setExpiry] = useState(lot.expiresOn || '')
  const [history, setHistory] = useState<Awaited<ReturnType<typeof loadLotOriginHistory>>>([])
  const [historyError, setHistoryError] = useState('')
  const exceptionIds = refs.map(ref => ref.exceptionId).sort().join('|')
  useEffect(() => {
    if (!admin || !exceptionIds) return
    let active = true
    void loadLotOriginHistory(exceptionIds.split('|')).then(rows => { if (active) setHistory(rows) }).catch(() => { if (active) setHistoryError('No se pudo consultar la excepción histórica. Actualiza antes de conciliar.') })
    return () => { active = false }
  }, [admin, exceptionIds])
  const blockedIdentity = Object.values(lot.pendingOrigins || {}).some(rows => rows.some(ref => ref.quantity > 0))
  async function save() {
    if (busy || !confirmed || reason.trim().length < 12 || evidence.trim().length < 12) return
    const expected = openedLot || lot
    const expectedPending = Math.round((expected.pendingOrigins?.[location] || []).reduce((sum, ref) => sum + ref.quantity, 0) * 1000) / 1000
    setBusy(true); setMessage('')
    try {
      await submitOperation(mode === 'origin' ? 'confirmPhysicalOrigin' : 'rectifyLotIdentity', mode === 'origin' ? {
        productId: lot.productId, lotId: lot.id, location, quantity: Number(quantity), expectedPendingQuantity: expectedPending, confirmationType: kind, reason, evidenceNote: evidence, explicitConfirmation: true,
      } : {
        productId: lot.productId, lotId: lot.id, lotCode: code, manufacturedOn: manufactured, expiresOn: expiry, expectedLotCode: expected.lotCode, expectedManufacturedOn: expected.manufacturedOn, expectedExpiresOn: expected.expiresOn, expectedQuantities: expected.quantities, reason, evidenceNote: evidence, explicitConfirmation: true,
      }, newOperationId('lot-reconciliation'))
      setMode(null); setConfirmed(false); setMessage('Operación confirmada por el servidor. El stock físico y costo se conservaron. Conciliar origen no elimina un vencimiento.')
    } catch (error) { setMessage((error as Error).message || 'No se confirmó la operación. Consulta el estado antes de volver a enviarla.') }
    finally { setBusy(false) }
  }
  const field = 'min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white p-2 text-sm'
  return <div className="min-w-0 space-y-2 rounded-xl border border-amber-200 p-3 text-xs">
    {lot.expiresOn && lot.expiresOn < toDayKey() && <p className="font-semibold text-rose-800">Vencido según sistema desde {lot.expiresOn}. Conciliar origen no cambia el vencimiento.</p>}
    {pending > 0 && <p>Origen físico pendiente: <strong>{pending.toFixed(3)}</strong>. Confirma la procedencia mediante revisión física o documental; no cambia código ni fechas.</p>}
    {history.map(row => <div key={row.id} className="break-words text-[11px]"><p>Excepción {row.id} · {row.createdAt} · {row.createdBy}</p><p>{row.reason}</p><p>Movimiento original: {row.sourceMovementId}</p></div>)}
    {historyError && <p role="alert">{historyError}</p>}
    {admin && !mode && <div className="flex flex-wrap gap-2">{pending > 0 && <button type="button" className={field} onClick={() => { setOpenedLot(structuredClone(lot)); setMode('origin'); setQuantity(String(pending)); setConfirmed(false) }}>Conciliar origen</button>}{!blockedIdentity && !lot.processingBatchId && <button type="button" className={field} onClick={() => { setOpenedLot(structuredClone(lot)); setCode(lot.lotCode || ''); setManufactured(lot.manufacturedOn || ''); setExpiry(lot.expiresOn || ''); setMode('identity'); setConfirmed(false) }}>Rectificar datos del lote</button>}</div>}
    {mode && <div className="space-y-3">
      <p className="break-words">Producto: {lot.productName} · Lote {lot.lotCode} · Existencia {lot.quantities[location]} · Elaboración {lot.manufacturedOn} · Vencimiento {lot.expiresOn}</p>
      {mode === 'origin' ? <><label className="block">Cantidad que se está conciliando<input className={field} type="number" min="0.001" step={lot.unitType === 'kg' ? '0.001' : '1'} max={pending} value={quantity} onChange={e => setQuantity(e.target.value)} /></label><label className="block">Tipo de comprobación<select className={field} value={kind} onChange={e => setKind(e.target.value)}><option value="physical_check">Verificación física en almacén</option><option value="label_check">Revisión de etiqueta/lote</option><option value="document_check">Revisión documental</option><option value="supported_correction">Corrección administrativa respaldada</option></select></label></> : <><p>Antes: {lot.lotCode} · {lot.manufacturedOn} · {lot.expiresOn}. Después:</p><label className="block">Código correcto<input className={field} value={code} onChange={e => setCode(e.target.value)} /></label><label className="block">Elaboración real<input className={field} type="date" value={manufactured} onChange={e => setManufactured(e.target.value)} /></label><label className="block">Vencimiento real<input className={field} type="date" value={expiry} onChange={e => setExpiry(e.target.value)} /></label></>}
      <label className="block">Motivo (mínimo 12 caracteres)<textarea className={field} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <label className="block">Evidencia revisada / nota documental (mínimo 12 caracteres)<textarea className={field} value={evidence} onChange={e => setEvidence(e.target.value)} /></label>
      <label className="flex min-h-11 items-start gap-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /><span>{mode === 'origin' ? 'Confirmo que el producto existe físicamente y que los datos coinciden con la revisión realizada.' : 'Confirmo que los nuevos datos corresponden a la identificación física/documental real y no a una renovación artificial del vencimiento.'}</span></label>
      <button type="button" disabled={busy || !confirmed || reason.trim().length < 12 || evidence.trim().length < 12 || (mode === 'origin' && (historyError !== '' || history.length !== refs.length || !(Number(quantity) > 0) || Number(quantity) > pending))} className={field + ' disabled:opacity-50'} onClick={() => void save()}>{busy ? 'Esperando confirmación del servidor…' : 'Confirmar ' + (mode === 'origin' ? 'conciliación' : 'rectificación')}</button><button type="button" disabled={busy} onClick={() => setMode(null)}>Cancelar</button>
    </div>}
    {message && <p role="status" className="break-words">{message}</p>}
  </div>
}
