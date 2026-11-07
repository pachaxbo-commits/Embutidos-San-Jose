import { processingCommerciallyAvailable } from '../domain/processingCommercialAvailability'
import { useEffect, useState } from 'react'
import { toDayKey } from '../domain/engine'
import type { DistLot } from '../types'
import { loadLotFromServer, loadLotOriginHistory, newOperationId } from '../data/distributionRepository'
import { submitOperation } from '../data/operationQueue'

export function LotReconciliation({ lot: observedLot, location, admin, lots = [] }: { lot: DistLot; location: string; admin: boolean; lots?: DistLot[] }) {
  const [refresh, setRefresh] = useState<{ previous: DistLot; current: DistLot } | null>(null)
  const [resolving, setResolving] = useState(false)
  const lot = refresh?.previous === observedLot ? refresh.current : observedLot
  async function reloadLot() {
    setRefresh({ previous: observedLot, current: await loadLotFromServer(observedLot.id) })
  }
  const refs = lot.pendingOrigins?.[location] || []
  const pending = Math.round(refs.reduce((sum, ref) => sum + ref.quantity, 0) * 1000) / 1000
  const physical = Number(lot.quantities[location] || 0)
  const held = lot.processingUnavailable?.[location]
  const expired = Boolean(lot.expiresOn && lot.expiresOn < toDayKey())
  const commercialBlocked = !processingCommerciallyAvailable(lot)
  const available = expired || lot.quarantined || commercialBlocked ? 0 : Math.max(0,
    physical - pending - Number(held?.courtesy || 0) - Number(held?.repackPending || 0) - Number(held?.reviewHold || 0))

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
      const result = await submitOperation<{ previousPendingQuantity?: number; remainingPendingQuantity?: number }>(mode === 'origin' ? 'confirmPhysicalOrigin' : 'rectifyLotIdentity', mode === 'origin' ? {
        productId: lot.productId, lotId: lot.id, location, quantity: Number(quantity), expectedPendingQuantity: expectedPending, confirmationType: kind, reason, evidenceNote: evidence, explicitConfirmation: true,
      } : {
        productId: lot.productId, lotId: lot.id, lotCode: code, manufacturedOn: manufactured, expiresOn: expiry, expectedLotCode: expected.lotCode, expectedManufacturedOn: expected.manufacturedOn, expectedExpiresOn: expected.expiresOn, expectedQuantities: expected.quantities, reason, evidenceNote: evidence, explicitConfirmation: true,
      }, newOperationId('lot-reconciliation'))
      setMode(null)
      setConfirmed(false)
      const pendingMessage = mode === 'origin' && result?.remainingPendingQuantity !== undefined
        ? `Conciliado: ${Number(quantity).toFixed(3)}. Pendiente: ${result.remainingPendingQuantity.toFixed(3)}.`
        : 'Operación confirmada por el servidor.'
      try {
        await reloadLot()
        setMessage(pendingMessage)
      } catch {
        setMessage(pendingMessage + ' Consulta Actualizar lote para cargar el estado confirmado.')
      }
    } catch (error) { setMessage((error as Error).message || 'No se confirmó la operación. Consulta el estado antes de volver a enviarla.') }
    finally { setBusy(false) }
  }
  const field = 'min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white p-2 text-sm'
  return <div className="min-w-0 space-y-2 rounded-xl border border-amber-200 p-3 text-xs">
    <p>Existencia {physical} {lot.unitType} · Disponible {available.toFixed(lot.unitType === 'kg' ? 3 : 0)} {lot.unitType}</p>
    {lot.quarantined && <p>Cuarentena: {physical} {lot.unitType}</p>}
    {commercialBlocked && <p>Bloqueo comercial de elaboración: {physical} {lot.unitType}</p>}
    {Number(held?.courtesy || 0) > 0 && <p>Cortesía: {held?.courtesy} {lot.unitType}</p>}
    {Number(held?.reviewHold || 0) > 0 && <p>Revisión: {held?.reviewHold} {lot.unitType}</p>}
    {Number(held?.repackPending || 0) > 0 && <p>Reenvasado: {held?.repackPending} {lot.unitType}</p>}
    {expired && <p className="font-semibold text-rose-800">Vencido según sistema desde {lot.expiresOn}: {physical} {lot.unitType}. Conciliar origen no cambia el vencimiento.</p>}
    {pending > 0 && <p>Origen físico pendiente: <strong>{pending.toFixed(3)}</strong>. Confirma la procedencia mediante revisión física o documental; no cambia código ni fechas.</p>}
    {history.map(row => <div key={row.id} className="break-words text-[11px]"><p>Excepción {row.id} · {row.createdAt} · {row.createdBy}</p><p>{row.reason}</p><p>Movimiento original: {row.sourceMovementId}</p></div>)}
    {historyError && <p role="alert">{historyError}</p>}
    {blockedIdentity && <p>Para rectificar todo el lote, primero resuelve el origen pendiente en todas las ubicaciones.</p>}
    {admin && !mode && !lot.processingBatchId && !lot.legacy && !lot.quarantined && Number(lot.quantities[location]) > 0 && (
      <button type="button" className={field} onClick={() => setResolving(value => !value)}>Resolver cantidad del lote</button>
    )}
    {resolving && <LotQuantityResolution lot={lot} lots={lots} location={location} onConfirmed={async () => {
      setResolving(false)
      setMessage('Destino confirmado por el servidor.')
      try { await reloadLot() } catch { setMessage('Destino confirmado. Usa Actualizar lote para consultar el saldo.') }
    }} />}

    {admin && !mode && <div className="flex flex-wrap gap-2">{pending > 0 && <button type="button" className={field} onClick={() => { setResolving(false); setOpenedLot(structuredClone(lot)); setMode('origin'); setQuantity(String(pending)); setConfirmed(false) }}>Conciliar origen</button>}{!blockedIdentity && !lot.processingBatchId && <button type="button" className={field} onClick={() => { setResolving(false); setOpenedLot(structuredClone(lot)); setCode(lot.lotCode || ''); setManufactured(lot.manufacturedOn || ''); setExpiry(lot.expiresOn || ''); setMode('identity'); setConfirmed(false) }}>Rectificar datos del lote</button>}</div>}
    {mode && <div className="space-y-3">
      <p className="break-words">Producto: {lot.productName} · Lote {lot.lotCode} · Existencia {lot.quantities[location]} · Elaboración {lot.manufacturedOn} · Vencimiento {lot.expiresOn} · Ubicación {location}</p>
      {mode === 'origin' ? <><label className="block">Cantidad que se está conciliando<input className={field} type="number" min="0.001" step={lot.unitType === 'kg' ? '0.001' : '1'} max={pending} value={quantity} onChange={e => setQuantity(e.target.value)} /></label><label className="block">Tipo de comprobación<select className={field} value={kind} onChange={e => setKind(e.target.value)}><option value="physical_check">Verificación física en almacén</option><option value="label_check">Revisión de etiqueta/lote</option><option value="document_check">Revisión documental</option><option value="supported_correction">Corrección administrativa respaldada</option></select></label></> : <><p>Antes: {lot.lotCode} · {lot.manufacturedOn} · {lot.expiresOn}. Después:</p><label className="block">Código correcto<input className={field} value={code} onChange={e => setCode(e.target.value)} /></label><label className="block">Elaboración real<input className={field} type="date" value={manufactured} onChange={e => setManufactured(e.target.value)} /></label><label className="block">Vencimiento real<input className={field} type="date" value={expiry} onChange={e => setExpiry(e.target.value)} /></label></>}
      <label className="block">Motivo (mínimo 12 caracteres)<textarea className={field} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <label className="block">Evidencia revisada / nota documental (mínimo 12 caracteres)<textarea className={field} value={evidence} onChange={e => setEvidence(e.target.value)} /></label>
      <label className="flex min-h-11 items-start gap-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /><span>{mode === 'origin' ? 'Confirmo que el producto existe físicamente y que los datos coinciden con la revisión realizada.' : 'Confirmo que los nuevos datos corresponden a la identificación física/documental real y no a una renovación artificial del vencimiento.'}</span></label>
      <button type="button" disabled={busy || !confirmed || reason.trim().length < 12 || evidence.trim().length < 12 || (mode === 'origin' && (historyError !== '' || history.length !== refs.length || !(Number(quantity) > 0) || Number(quantity) > pending))} className={field + ' disabled:opacity-50'} onClick={() => void save()}>{busy ? 'Esperando confirmación del servidor…' : 'Confirmar ' + (mode === 'origin' ? 'conciliación' : 'rectificación')}</button><button type="button" disabled={busy} onClick={() => setMode(null)}>Cancelar</button>
    </div>}
    {message && <p role="status" className="break-words">{message}</p>}
    {admin && message && <button type="button" onClick={() => void reloadLot().catch(error => setMessage(error.message))}>Actualizar lote</button>}
  </div>
}

function LotQuantityResolution({ lot, lots, location, onConfirmed }: {
  lot: DistLot; lots: DistLot[]; location: string; onConfirmed: () => Promise<void>
}) {
  const [action, setAction] = useState('keep')
  const [quantity, setQuantity] = useState('')
  const [observed, setObserved] = useState('')
  const [target, setTarget] = useState('')
  const [code, setCode] = useState('')
  const [made, setMade] = useState('')
  const [expiry, setExpiry] = useState('')
  const [reason, setReason] = useState('')
  const [evidence, setEvidence] = useState('')
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [expected] = useState(Number(lot.quantities[location] || 0))
  const scale = lot.unitType === 'kg' ? 1000 : 1
  const pending = (lot.pendingOrigins?.[location] || []).reduce((sum, row) => sum + Number(row.quantity), 0)
  const identified = Math.round((expected - pending) * scale) / scale
  const moving = action === 'move' || action === 'new_lot'
  const amount = action === 'shortage' ? Math.round((expected - Number(observed)) * scale) / scale : Number(quantity)
  const candidates = lots.filter(row => row.id !== lot.id && row.productId === lot.productId
    && !row.legacy && !row.quarantined && !row.processingBatchId && row.productionCost === lot.productionCost)
  const control = 'min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white p-2 text-sm'
  async function save() {
    setBusy(true)
    setError('')
    try {
      await submitOperation('resolveLotQuantity', {
        productId: lot.productId, sourceLotId: lot.id, location, expectedSourceQuantity: expected,
        action, quantity: amount, observedQuantity: action === 'shortage' ? Number(observed) : undefined,
        destinationLotId: target, lotCode: code, manufacturedOn: made, expiresOn: expiry,
        reason, evidenceNote: evidence, explicitConfirmation: checked,
      }, newOperationId('resolve-lot-quantity'))
      await onConfirmed()
    } catch (failure) { setError((failure as Error).message) }
    finally { setBusy(false) }
  }
  return <div className="grid min-w-0 gap-2 rounded-xl bg-slate-50 p-3">
    <p className="break-words">{lot.productName} · {lot.lotCode} · {location} · Existencia {expected} {lot.unitType} · Vence {lot.expiresOn || 'Sin fecha'} · Costo histórico {lot.productionCost ?? 'Sin registrar'}</p>
    <label>Destino<select aria-label="Destino" className={control} value={action} onChange={e => { setAction(e.target.value); setChecked(false) }}><option value="keep">Mantener en este lote</option><option value="move">Mover a lote existente</option><option value="new_lot">Crear lote correcto y mover</option><option value="discard">Desechar físicamente</option><option value="shortage">Registrar faltante por pesaje</option></select></label>
    {moving && <p>Identificado para mover: {identified} {lot.unitType}. La cantidad con procedencia pendiente requiere conciliación previa. Corrige fechas solo con evidencia de la etiqueta real.</p>}
    {action === 'keep' ? <p>Para mantener el lote actual, cierra esta sección. Para corregir toda su identidad, usa Rectificar datos del lote.</p> : <>
      {action === 'shortage'
        ? <label>Existencia física pesada<input className={control} type="number" min="0" step={1 / scale} value={observed} onChange={e => setObserved(e.target.value)} />Faltante: {amount} {lot.unitType}</label>
        : <label>Cantidad<input className={control} type="number" min={1 / scale} step={1 / scale} value={quantity} onChange={e => setQuantity(e.target.value)} /></label>}
      {action === 'move' && <label>Lote destino con el mismo costo<select className={control} value={target} onChange={e => setTarget(e.target.value)}><option value="">Selecciona lote</option>{candidates.map(row => <option key={row.id} value={row.id}>{row.lotCode} · {row.manufacturedOn} · vence {row.expiresOn}</option>)}</select></label>}
      {action === 'new_lot' && <>
        <label>Código real<input className={control} value={code} onChange={e => setCode(e.target.value)} /></label>
        <label>Elaboración real<input className={control} type="date" value={made} onChange={e => setMade(e.target.value)} /></label>
        <label>Vencimiento real<input className={control} type="date" value={expiry} onChange={e => setExpiry(e.target.value)} /></label>
      </>}
      <label>Motivo<textarea className={control} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <label>Evidencia revisada<textarea className={control} value={evidence} onChange={e => setEvidence(e.target.value)} /></label>
      <label className="flex items-start gap-2"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} />{action === 'discard' ? 'Confirmo que esta cantidad fue desechada físicamente.' : action === 'shortage' ? 'Confirmo el peso observado y que esta diferencia ya no existe físicamente.' : 'Confirmo que la cantidad corresponde al lote identificado por la evidencia física y que las fechas son reales.'}</label>
      <button type="button" className={control + ' disabled:opacity-50'} disabled={busy || !checked || reason.trim().length < 12 || evidence.trim().length < 12 || !(amount > 0) || amount > expected || (moving && amount > identified) || (action === 'shortage' && observed === '') || (action === 'move' && !target) || (action === 'new_lot' && (!code.trim() || !made || !expiry))} onClick={() => void save()}>{busy ? 'Confirmando…' : 'Registrar destino'}</button>
    </>}
    {error && <p role="alert" className="break-words">{error}</p>}
  </div>
}
