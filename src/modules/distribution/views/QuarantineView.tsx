import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, FileSpreadsheet, PackageCheck, ShieldAlert } from 'lucide-react'
import { Modal } from '../../../components/ui/Modal'
import { Field, Segmented, TextInput } from '../../../components/ui/Form'
import { EmptyBlock } from '../../../components/ui/Screen'
import { exportExcel, exportPdf, type ReportSheet } from '../data/reportExports'
import { newOperationId, resolveQuarantine } from '../data/distributionRepository'
import { filterQuarantineRows, quarantineRows, summarizeQuarantine, type QuarantineRow, type QuarantineStatusFilter } from '../domain/quarantine'
import { operationFailureMessage } from '../domain/operationFailureMessage'
import { toDayKey } from '../domain/engine'
import type { DistributionData } from '../state/useDistributionStore'
import type { DistributionSession } from './DistributionApp'
import type { DistClosure, DistLot } from '../types'
import { RangePicker, describeRange } from './RangePicker'
import { formatQty, PrimaryButton, SecondaryButton } from './shared'

type Props = { session: DistributionSession; data: DistributionData; isOpen: boolean; onClose: () => void; defaultLocation?: string }
type Resolution = 'released_existing_lot' | 'released_new_lot' | 'discarded'

function displayDate(value?: string) {
  return value ? new Date(value).toLocaleString('es-BO') : 'No disponible'
}

function formatQuarantineQty(value: number, unit: 'kg' | 'package' | 'unit') {
  if (unit === 'kg') return `${(Math.round((Number(value) + Number.EPSILON) * 1000) / 1000).toFixed(3)} kg`
  return formatQty(value, unit)
}

function closureReference(closures: DistClosure[], dispatchId?: string) {
  if (!dispatchId) return ''
  const closure = closures.find(item => item.dispatchId === dispatchId)
  return closure ? `Cierre de ruta · ${closure.routeName} · jornada ${closure.dayKey}` : 'Cierre de ruta relacionado'
}

function compatibleQuarantineLots(lots: DistLot[], row: QuarantineRow | null) {
  if (!row) return []
  const day = toDayKey(new Date())
  return lots.filter(lot => lot.productId === row.lot.productId && lot.id !== row.lot.id && !lot.quarantined && lot.lotCode.trim() && /^\d{4}-\d{2}-\d{2}$/.test(lot.manufacturedOn) && /^\d{4}-\d{2}-\d{2}$/.test(lot.expiresOn) && lot.manufacturedOn <= day && lot.expiresOn >= day && Number.isFinite(lot.productionCost) && Number(lot.productionCost) >= 0)
}

export function QuarantineView({ session, data, isOpen, onClose, defaultLocation }: Props) {
  const admin = session.role === 'admin'
  const fixedLocation = session.role === 'warehouse' && session.warehouseId && session.warehouseId !== 'central'
    ? `warehouse__${session.warehouseId}` : 'central'
  const allRows = useMemo(() => quarantineRows(data.lots, data.movements, data.warehouses), [data.lots, data.movements, data.warehouses])
  const [status, setStatus] = useState<QuarantineStatusFilter>('pending')
  const [location, setLocation] = useState(defaultLocation || fixedLocation)
  const [dayKeys, setDayKeys] = useState<string[]>(() => {
    const today = toDayKey(new Date())
    return [`${today.slice(0, 8)}01`, today]
  })
  const [exporting, setExporting] = useState(false)
  const [reviewRow, setReviewRow] = useState<QuarantineRow | null>(null)
  const [resolution, setResolution] = useState<Resolution>('released_existing_lot')
  const [destinationLotId, setDestinationLotId] = useState('')
  const [newLotCode, setNewLotCode] = useState('')
  const [manufacturedOn, setManufacturedOn] = useState('')
  const [expiresOn, setExpiresOn] = useState('')
  const [productionCost, setProductionCost] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const operationId = useRef<string | null>(null)
  const submitLock = useRef(false)

  const selectedLocation = admin ? location : fixedLocation
  const rows = useMemo(() => filterQuarantineRows(allRows, { status, location: selectedLocation, dayKeys }), [allRows, status, selectedLocation, dayKeys])
  const pendingTotal = useMemo(() => allRows.filter(row => row.status === 'pending' && row.location === selectedLocation).length, [allRows, selectedLocation])
  const totals = summarizeQuarantine(rows)
  const targetLots = useMemo(() => {
    return compatibleQuarantineLots(data.lots, reviewRow)
  }, [data.lots, reviewRow])

  const openReview = (row: QuarantineRow) => {
    setReviewRow(row); setResolution(compatibleQuarantineLots(data.lots, row).length > 0 ? 'released_existing_lot' : 'released_new_lot')
    setDestinationLotId(''); setNewLotCode(''); setManufacturedOn(''); setExpiresOn(''); setProductionCost(''); setReason(''); setError(''); operationId.current = null
  }
  const submitResolution = async () => {
    if (!reviewRow || submitLock.current) return
    if (!reason.trim()) { setError('Describe el motivo o la evidencia de la revisión.'); return }
    if (resolution === 'released_existing_lot' && !targetLots.some(lot => lot.id === destinationLotId)) { setError('Selecciona un lote destino vigente y trazable.'); return }
    if (resolution === 'released_new_lot' && (!newLotCode.trim() || !manufacturedOn || !expiresOn || productionCost === '' || !Number.isFinite(Number(productionCost)) || Number(productionCost) < 0)) { setError('Completa código, fechas y costo de producción del nuevo lote.'); return }
    if (resolution === 'discarded' && !reason.trim()) { setError('El motivo del descarte es obligatorio.'); return }
    submitLock.current = true
    setBusy(true); setError('')
    try {
      operationId.current ||= newOperationId('quarantine-resolution')
      await resolveQuarantine({ lotId: reviewRow.lot.id, location: reviewRow.location, resolution, reason: reason.trim(), ...(resolution === 'released_existing_lot' ? { destinationLotId } : {}), ...(resolution === 'released_new_lot' ? { newLotCode: newLotCode.trim(), manufacturedOn, expiresOn, productionCost: Number(productionCost) } : {}) }, operationId.current)
      operationId.current = null
      setReviewRow(null)
    } catch (failure) {
      if ((failure as { rejected?: boolean }).rejected) operationId.current = null
      setError(operationFailureMessage('resolveQuarantine', failure))
    } finally { setBusy(false); submitLock.current = false }
  }

  const makeSheet = (): ReportSheet => ({
    name: 'Cuarentena',
    headers: ['Estado', 'Producto', 'Cantidad', 'Unidad', 'Almacén', 'Origen', 'Lote', 'Fecha ingreso', 'Motivo', 'Resolución', 'Fecha resolución', 'Responsable resolución'],
    rows: rows.map(row => [row.status === 'pending' ? 'Pendiente' : row.resolutionLabel || 'Resuelto', row.lot.productName, row.quantity.toFixed(row.lot.unitType === 'kg' ? 3 : 0), row.lot.unitType === 'kg' ? 'kg' : row.lot.unitType === 'package' ? 'paquetes' : 'unidades', row.warehouseName, row.source, row.lot.quarantineOriginalLotCode || row.lot.lotCode || 'Sin código', displayDate(row.enteredAt), row.reason || 'No especificado', row.resolutionLabel || '—', row.lot.quarantineResolvedAt ? displayDate(row.lot.quarantineResolvedAt) : '—', row.lot.quarantineResolvedByName || row.lot.quarantineResolvedBy || '—']),
  })
  const download = async (kind: 'pdf' | 'excel') => {
    if (exporting) return
    setExporting(true)
    try {
      const sheet = makeSheet()
      const label = status === 'pending' ? 'Pendientes' : status === 'resolved' ? 'Resueltos' : 'Todos'
      const period = dayKeys.length === 1 && dayKeys[0] === toDayKey(new Date()) ? 'Hoy' : describeRange(dayKeys)
      const description = `Productos en cuarentena · ${label} · ${period} · ${admin ? (selectedLocation === 'central' ? 'Almacén central' : data.warehouses.find(item => `warehouse__${item.id}` === selectedLocation)?.name || 'Almacén') : ''} · Emitido ${new Date().toLocaleString('es-BO')}`
      if (kind === 'pdf') await exportPdf([sheet], description, 'SanJose-productos-en-cuarentena.pdf')
      else await exportExcel([sheet], description, 'SanJose-productos-en-cuarentena.xlsx')
    } catch (failure) { setError((failure as Error).message || 'No se pudo generar el reporte de cuarentena.') }
    finally { setExporting(false) }
  }

  return <>
    <Modal isOpen={isOpen} onClose={onClose} title="Productos en cuarentena" subtitle="Stock físico pendiente de identificar o revisar." size="lg">
      <div className="grid min-w-0 gap-4">
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-center gap-2 text-amber-950"><ShieldAlert size={18}/><h3 className="text-sm font-black">Productos en cuarentena</h3></div>
          <p className="mt-2 text-xs font-bold text-amber-900">Pendientes: {pendingTotal}</p>
          <div className="mt-2 grid grid-cols-3 gap-2 text-xs"><p>kg<strong className="block text-base">{totals.kg.toFixed(3)}</strong></p><p>Paquetes<strong className="block text-base">{totals.package}</strong></p><p>Unidades<strong className="block text-base">{totals.unit}</strong></p></div>
        </section>
        <div className="grid gap-3">
          <Segmented value={status} onChange={value => setStatus(value as QuarantineStatusFilter)} options={[{value:'pending',label:'Pendientes'},{value:'resolved',label:'Resueltos'},{value:'all',label:'Todos'}]}/>
          <RangePicker dayKeys={dayKeys} initialPreset="month" onChange={setDayKeys}/>
          {admin && <Field label="Almacén"><select className="min-h-11 w-full min-w-0 rounded-xl border-2 border-slate-200 bg-white px-3" value={location} onChange={event => setLocation(event.target.value)}><option value="central">Almacén central</option>{data.warehouses.filter(item => item.active).map(item => <option key={item.id} value={`warehouse__${item.id}`}>{item.name}</option>)}</select></Field>}
          <div className="grid grid-cols-2 gap-2"><SecondaryButton disabled={exporting} onClick={() => void download('pdf')}>PDF</SecondaryButton><SecondaryButton disabled={exporting} onClick={() => void download('excel')}><FileSpreadsheet size={15}/> Excel</SecondaryButton></div>
        </div>
        <p className="text-xs font-semibold text-slate-500">{rows.length} registro{rows.length === 1 ? '' : 's'} · {describeRange(dayKeys)}</p>
        {rows.length === 0 ? <EmptyBlock title="No hay cuarentenas para estos filtros" description="Prueba otro periodo o cambia entre pendientes y resueltos."/> : <div className="grid min-w-0 gap-2 md:grid-cols-2">
          {rows.map(row => <article key={`${row.lot.id}:${row.location}`} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3">
            <div className="flex min-w-0 items-start justify-between gap-2"><div className="min-w-0"><p className="break-words text-sm font-extrabold text-slate-900">{row.lot.productName}</p><p className="mt-1 text-lg font-black tabular-nums">{formatQuarantineQty(row.quantity,row.lot.unitType)}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black ${row.status === 'pending' ? 'bg-amber-100 text-amber-950' : 'bg-emerald-100 text-emerald-900'}`}>{row.status === 'pending' ? 'PENDIENTE DE REVISIÓN' : row.resolutionLabel?.toUpperCase()}</span></div>
            <dl className="mt-3 grid min-w-0 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-2"><div><dt className="font-bold text-slate-500">Origen</dt><dd className="break-words text-slate-800">{row.source}</dd></div><div><dt className="font-bold text-slate-500">Almacén</dt><dd className="break-words text-slate-800">{row.warehouseName}</dd></div><div><dt className="font-bold text-slate-500">{row.status === 'resolved' ? 'Lote original' : 'Lote actual'}</dt><dd className="break-words text-slate-800">{row.lot.quarantineOriginalLotCode || row.lot.lotCode || 'Sin código'}</dd></div><div><dt className="font-bold text-slate-500">Fecha de ingreso</dt><dd className="break-words text-slate-800">{displayDate(row.enteredAt)}</dd></div>{row.sourceMovement?.dispatchId && <div><dt className="font-bold text-slate-500">Referencia</dt><dd className="text-slate-800">{closureReference(data.closures,row.sourceMovement.dispatchId)}</dd></div>}{row.reason && <div className="sm:col-span-2"><dt className="font-bold text-slate-500">Motivo / nota</dt><dd className="break-words text-slate-800">{row.reason}</dd></div>}{row.status === 'resolved' && <><div><dt className="font-bold text-slate-500">Fecha de resolución</dt><dd className="break-words text-slate-800">{displayDate(row.lot.quarantineResolvedAt)}</dd></div><div><dt className="font-bold text-slate-500">Responsable</dt><dd className="break-words text-slate-800">{row.lot.quarantineResolvedByName || row.lot.quarantineResolvedBy || 'No disponible'}</dd></div>{row.lot.quarantineDestinationLotCode && <div><dt className="font-bold text-slate-500">Lote destino</dt><dd className="break-words text-slate-800">{row.lot.quarantineDestinationLotCode}</dd></div>}</>}</dl>
            {row.status === 'pending' && admin && <PrimaryButton full onClick={() => openReview(row)}><PackageCheck size={16}/> Revisar</PrimaryButton>}
          </article>)}
        </div>}
        {error && !reviewRow && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-800">{error}</p>}
      </div>
    </Modal>
    <Modal isOpen={Boolean(reviewRow)} onClose={() => !busy && setReviewRow(null)} title="Revisar producto en cuarentena" subtitle={reviewRow?.lot.productName} size="lg" footer={<div className="grid grid-cols-2 gap-2"><SecondaryButton disabled={busy} onClick={() => setReviewRow(null)}>Cancelar</SecondaryButton><PrimaryButton disabled={busy} onClick={() => void submitResolution()}>{busy ? 'Guardando…' : resolution === 'discarded' ? 'Confirmar descarte' : 'Confirmar liberación'}</PrimaryButton></div>}>
      {reviewRow && <div className="grid min-w-0 gap-4">
        <div className="rounded-2xl bg-slate-50 p-3 text-sm"><p><b>Producto:</b> {reviewRow.lot.productName}</p><p><b>Cantidad:</b> {formatQuarantineQty(reviewRow.quantity,reviewRow.lot.unitType)}</p><p><b>Origen:</b> {reviewRow.source} · {reviewRow.warehouseName}</p><p><b>Fecha:</b> {displayDate(reviewRow.enteredAt)}</p><p><b>Lote actual:</b> {reviewRow.lot.lotCode || 'Sin código'}</p>{reviewRow.reason && <p><b>Información:</b> {reviewRow.reason}</p>}</div>
        <div className="grid grid-cols-2 gap-2"><button type="button" aria-pressed={resolution !== 'discarded'} onClick={() => setResolution('released_existing_lot')} className={`min-h-12 rounded-xl border px-3 text-xs font-extrabold ${resolution !== 'discarded' ? 'border-emerald-700 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-white text-slate-700'}`}>Aprobar para venta</button><button type="button" aria-pressed={resolution === 'discarded'} onClick={() => setResolution('discarded')} className={`min-h-12 rounded-xl border px-3 text-xs font-extrabold ${resolution === 'discarded' ? 'border-rose-700 bg-rose-50 text-rose-900' : 'border-slate-200 bg-white text-slate-700'}`}>No apto / descartar</button></div>
        {resolution !== 'discarded' && <Segmented value={resolution === 'released_new_lot' ? 'new' : 'existing'} onChange={value => setResolution(value === 'new' ? 'released_new_lot' : 'released_existing_lot')} options={[{value:'existing',label:'Vincular a lote existente'},{value:'new',label:'Identificar nuevo lote'}]}/>}
        {resolution === 'released_existing_lot' && <Field label="Lote destino" required><select className="min-h-12 w-full min-w-0 rounded-xl border-2 border-slate-200 bg-white px-3" value={destinationLotId} onChange={event => setDestinationLotId(event.target.value)}><option value="">Selecciona un lote compatible</option>{targetLots.map(lot => <option key={lot.id} value={lot.id}>{lot.lotCode} · elab. {lot.manufacturedOn} · vence {lot.expiresOn} · costo Bs {Number(lot.productionCost).toFixed(2)} · actual {formatQty(Number(lot.quantities?.[reviewRow.location] || 0),lot.unitType)}</option>)}</select>{targetLots.length === 0 && <p className="mt-1 text-xs text-amber-800">No hay lotes compatibles. Identifica uno nuevo si verificaste físicamente su trazabilidad.</p>}</Field>}
        {resolution === 'released_new_lot' && <div className="grid min-w-0 gap-3 sm:grid-cols-2"><Field label="Código de lote" required><TextInput className="w-full min-w-0" value={newLotCode} onChange={event => setNewLotCode(event.target.value)} maxLength={80}/></Field><Field label="Costo de producción por unidad" required><TextInput className="w-full min-w-0" inputMode="decimal" value={productionCost} onChange={event => setProductionCost(event.target.value.replace(',','.'))}/></Field><Field label="Fecha de elaboración" required><TextInput type="date" className="w-full min-w-0" value={manufacturedOn} onChange={event => setManufacturedOn(event.target.value)}/></Field><Field label="Fecha de vencimiento" required><TextInput type="date" className="w-full min-w-0" value={expiresOn} onChange={event => setExpiresOn(event.target.value)}/></Field></div>}
        <Field label={resolution === 'discarded' ? 'Motivo del descarte' : 'Motivo / evidencia de revisión'} required><TextInput className="w-full min-w-0" value={reason} onChange={event => setReason(event.target.value)} placeholder="Describe qué se verificó" maxLength={500}/></Field>
        <div className={`rounded-2xl p-3 text-sm ${resolution === 'discarded' ? 'border border-rose-200 bg-rose-50 text-rose-950' : 'border border-emerald-200 bg-emerald-50 text-emerald-950'}`}><div className="flex items-center gap-2 font-extrabold">{resolution === 'discarded' ? <AlertTriangle size={17}/> : <PackageCheck size={17}/>} {resolution === 'discarded' ? 'Se retirarán de la existencia física' : 'Estás liberando a venta'}</div><p className="mt-1">{formatQuarantineQty(reviewRow.quantity,reviewRow.lot.unitType)} · {reviewRow.lot.productName}</p>{resolution === 'discarded' ? <p className="mt-1 text-xs">No se modificará el costo histórico si no está disponible. El resultado económico no se recalcula automáticamente.</p> : <p className="mt-1 text-xs">La existencia física no cambia; la cantidad quedará disponible con trazabilidad de lote.</p>}</div>
        {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-800">{error}</p>}
      </div>}
    </Modal>
  </>
}
