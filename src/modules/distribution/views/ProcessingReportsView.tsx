import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, FileSpreadsheet, FileText, Printer, RefreshCw } from 'lucide-react'
import { Field, SelectInput, TextInput } from '../../../components/ui/Form'
import { EmptyBlock, LoadingState } from '../../../components/ui/Screen'
import type { ProcessingBatch, ProcessingRepackRecord, ProcessingReviewRecord } from '../domain/processing'
import { buildProcessingBatchReport, buildProcessingLotTraceReport, buildProcessingQualityReport, filterProcessingBatches, filterProcessingRepackings, filterProcessingReviews } from '../domain/processingReports'
import { loadProcessingBatchPage, loadProcessingRepackPage, loadProcessingReviewPage, type ProcessingBatchPage } from '../data/distributionRepository'
import type { DistLot, DistProduct } from '../types'
import type { DistributionSession } from './DistributionApp'
import { SecondaryButton } from './shared'

type ReportMode = 'batches' | 'trace' | 'reviews' | 'repackings'
type Cursor = ProcessingBatchPage['cursor']

export function ProcessingReportsView({ session, products, lots, locationOptions }: { session: DistributionSession; products: DistProduct[]; lots: DistLot[]; locationOptions: Array<{ id: string; name: string }> }) {
  const [mode, setMode] = useState<ReportMode>('batches')
  const [batches, setBatches] = useState<ProcessingBatch[]>([])
  const [reviews, setReviews] = useState<ProcessingReviewRecord[]>([])
  const [repackings, setRepackings] = useState<ProcessingRepackRecord[]>([])
  const cursorRef = useRef<Cursor>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [productId, setProductId] = useState('')
  const [sourceLot, setSourceLot] = useState('')
  const [outputLot, setOutputLot] = useState('')
  const [responsible, setResponsible] = useState('')
  const [processType, setProcessType] = useState('')
  const [status, setStatus] = useState('')
  const [location, setLocation] = useState('all')
  const requestVersion = useRef(0)
  const warehouseId = session.warehouseId || 'central'
  const locationKey = session.role === 'warehouse' ? (warehouseId === 'central' ? 'central' : `warehouse__${warehouseId}`) : location === 'all' ? undefined : location === 'central' ? 'central' : `warehouse__${location}`
  const clearLoadedRows = () => {
    requestVersion.current++
    setBatches([]); setReviews([]); setRepackings([]); cursorRef.current = null; setHasMore(false)
  }
  const invalidateInFlight = useCallback(() => { requestVersion.current++ }, [])

  const loadPage = useCallback(async (reset = false) => {
    const version = reset ? ++requestVersion.current : requestVersion.current
    setLoading(true); setError('')
    try {
      if (reset) cursorRef.current = null
      const nextCursor = reset ? null : cursorRef.current
      if (mode === 'batches' || mode === 'trace') {
        const page = await loadProcessingBatchPage(locationKey, nextCursor, 20)
        if (version !== requestVersion.current) return
        setBatches(current => reset ? page.rows : [...current, ...page.rows])
        cursorRef.current = page.cursor; setHasMore(page.hasMore)
      } else if (mode === 'reviews') {
        const page = await loadProcessingReviewPage(locationKey, nextCursor, 20)
        if (version !== requestVersion.current) return
        setReviews(current => reset ? page.rows : [...current, ...page.rows])
        cursorRef.current = page.cursor; setHasMore(page.hasMore)
      } else {
        const page = await loadProcessingRepackPage(locationKey, nextCursor, 20)
        if (version !== requestVersion.current) return
        setRepackings(current => reset ? page.rows : [...current, ...page.rows])
        cursorRef.current = page.cursor; setHasMore(page.hasMore)
      }
    } catch (reason) {
      if (version === requestVersion.current) setError((reason as Error).message || 'No se pudo cargar el reporte.')
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [locationKey, mode])

  useEffect(() => {
    let active = true
    queueMicrotask(() => { if (active) void loadPage(true) })
    return () => { active = false; invalidateInFlight() }
  }, [mode, locationKey, loadPage, invalidateInFlight])

  const filteredBatches = useMemo(() => filterProcessingBatches(batches, { from, to, productId, sourceLot, outputLot, location: locationKey, responsible, processType, status }), [batches, from, to, productId, sourceLot, outputLot, locationKey, responsible, processType, status])
  const qualityRows = useMemo(() => {
    const filters = { from, to, productId, sourceLot, location: locationKey, responsible, status }
    const filteredReviews = mode === 'reviews' ? filterProcessingReviews(reviews, filters) : []
    const filteredRepackings = mode === 'repackings' ? filterProcessingRepackings(repackings, filters, lots) : []
    return buildProcessingQualityReport(filteredReviews, filteredRepackings, products, lots).rows
  }, [mode, reviews, repackings, from, to, locationKey, productId, products, lots, sourceLot, responsible, status])
  const report = useMemo(() => {
    const base = mode === 'batches'
      ? buildProcessingBatchReport(filteredBatches, products)
      : mode === 'trace'
        ? buildProcessingLotTraceReport(filteredBatches, { productId, outputLot }, products)
        : { ...buildProcessingQualityReport(reviews, repackings, products, lots), rows: qualityRows }
    const locationColumn = mode === 'batches' ? 11 : mode === 'trace' ? 11 : 14
    const readableLocation = (value: unknown) => value === 'central'
      ? 'Almacén central'
      : locationOptions.find(option => value === `warehouse__${option.id}`)?.name || String(value ?? 'No registrado')
    return { ...base, rows: base.rows.map(row => row.map((cell, index) => index === locationColumn ? readableLocation(cell) : cell)) }
  }, [mode, filteredBatches, productId, outputLot, reviews, repackings, products, lots, qualityRows, locationOptions])

  const exportReport = async (format: 'Excel' | 'PDF') => {
    if (loading || hasMore || error) {
      setError('El informe está incompleto. Completa la consulta antes de exportar.')
      return
    }
    try {
      const { exportExcel, exportPdf } = await import('../data/reportExports')
      const description = `San José · ${report.name} · ${from || 'sin inicio'} a ${to || 'sin fin'} · ${report.rows.length} registros filtrados de ${mode === 'batches' || mode === 'trace' ? batches.length : mode === 'reviews' ? reviews.length : repackings.length} cargados`
      if (format === 'Excel') await exportExcel([report], description)
      else await exportPdf([report], description)
    } catch (reason) { setError((reason as Error).message || `No se pudo generar el ${format}.`) }
  }

  const buttons: Array<[ReportMode, string]> = [['batches', 'Elaboraciones'], ['trace', 'Trazabilidad por lote'], ['reviews', 'Revisiones'], ['repackings', 'Reenvasados']]
  const activeCount = mode === 'batches' || mode === 'trace' ? batches.length : mode === 'reviews' ? reviews.length : repackings.length
  return <section className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      {buttons.map(([key, label]) => <button key={key} type="button" aria-pressed={mode === key} onClick={() => { if (mode !== key) { clearLoadedRows(); setMode(key) } }} className={`min-h-10 rounded-xl px-3 text-xs font-extrabold ${mode === key ? 'bg-slate-800 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}>{label}</button>)}
    </div>
    <div className="grid min-w-0 gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Desde · día Bolivia"><TextInput type="date" value={from} onChange={event => setFrom(event.target.value)} /></Field>
      <Field label="Hasta · día Bolivia"><TextInput type="date" value={to} onChange={event => setTo(event.target.value)} /></Field>
      <Field label="Producto"><SelectInput value={productId} onChange={event => setProductId(event.target.value)}><option value="">Todos los productos</option>{products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</SelectInput></Field>
      {session.role === 'admin' && <Field label="Almacén"><SelectInput value={location} onChange={event => { if (location !== event.target.value) clearLoadedRows(); setLocation(event.target.value) }}><option value="all">Todos</option>{locationOptions.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</SelectInput></Field>}
      <Field label="Lote de origen"><TextInput value={sourceLot} onChange={event => setSourceLot(event.target.value)} placeholder="Código o referencia" /></Field>
      {(mode === 'batches' || mode === 'trace') && <Field label="Lote resultante"><TextInput value={outputLot} onChange={event => setOutputLot(event.target.value)} placeholder="Código o referencia" /></Field>}
      <Field label="Responsable"><TextInput value={responsible} onChange={event => setResponsible(event.target.value)} /></Field>
      {(mode === 'batches' || mode === 'trace') && <Field label="Tipo de proceso"><SelectInput value={processType} onChange={event => setProcessType(event.target.value)}><option value="">Todos</option><option value="bagging">Sacheteado y embolsado</option><option value="portioning">Porcionado</option><option value="repackaging">Reenvasado</option></SelectInput></Field>}
      <Field label="Estado"><SelectInput value={status} onChange={event => setStatus(event.target.value)}><option value="">Todos</option><option value="confirmed">Confirmado</option><option value="corrected">Corregido</option><option value="reversed">Revertido</option><option value="pending_review">Pendiente de revisión</option><option value="in_review">En revisión</option><option value="authorized_for_repack">Autorizado para reenvasado</option><option value="pending_economic_disposition">Pendiente de decisión económica</option></SelectInput></Field>
    </div>
    {(from && to && from > to) && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-800">La fecha inicial no puede ser posterior a la fecha final.</p>}
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800"><AlertTriangle className="mr-1 inline" size={15} />{error}</p>}
    <div className="processing-report-controls flex flex-wrap gap-2">
      <SecondaryButton disabled={loading || Boolean(from && to && from > to)} onClick={() => void exportReport('PDF')}><FileText size={15} />PDF</SecondaryButton>
      <SecondaryButton disabled={loading || Boolean(from && to && from > to)} onClick={() => void exportReport('Excel')}><FileSpreadsheet size={15} />Excel</SecondaryButton>
      <SecondaryButton disabled={loading || report.rows.length === 0} onClick={() => window.print()}><Printer size={15} />Imprimir</SecondaryButton>
      <SecondaryButton disabled={loading} onClick={() => void loadPage(true)}><RefreshCw size={15} />Actualizar</SecondaryButton>
    </div>
    <div id="processing-report-print-root" className="min-w-0">
      <style>{'@media print { body * { visibility: hidden !important; } #processing-report-print-root, #processing-report-print-root * { visibility: visible !important; } #processing-report-print-root { position: absolute; inset: 0; width: 100%; padding: 12mm; background: white; } .processing-report-controls { display: none !important; } }'}</style>
      <h2 className="text-lg font-extrabold">{report.name}</h2>
      <p className="text-xs text-slate-600">Fechas: {from || 'sin inicio'} a {to || 'sin fin'} · zona de reporte: America/La_Paz · {report.rows.length} filtrados / {activeCount} registros cargados</p>
      {mode === 'trace' && <p className="my-2 rounded-lg bg-amber-50 p-2 text-xs">Los aportes por lote de origen son una asignación contable de la elaboración; no identifican físicamente cada paquete individual.</p>}
      {mode === 'batches' || mode === 'trace' ? report.rows.length === 0 && !loading ? <EmptyBlock title="Sin registros que coincidan" description="Prueba otros filtros o carga más páginas del historial." /> : <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[900px] border-collapse text-left text-xs"><thead><tr>{report.headers.map(head => <th key={head} className="border-b bg-slate-50 p-2">{head}</th>)}</tr></thead><tbody>{report.rows.map((row, i) => <tr key={i} className="align-top">{row.map((cell, j) => <td key={j} className="border-b border-slate-100 p-2">{cell == null ? '—' : String(cell)}</td>)}</tr>)}</tbody></table></div> : report.rows.length === 0 && !loading ? <EmptyBlock title="Sin registros que coincidan" description="Prueba otros filtros o carga más páginas." /> : <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[900px] border-collapse text-left text-xs"><thead><tr>{report.headers.map(head => <th key={head} className="border-b bg-slate-50 p-2">{head}</th>)}</tr></thead><tbody>{report.rows.map((row, i) => <tr key={i} className="align-top">{row.map((cell, j) => <td key={j} className="border-b border-slate-100 p-2">{cell == null ? '—' : String(cell)}</td>)}</tr>)}</tbody></table></div>}
    </div>
    {loading && <LoadingState label="Cargando una página del historial…" />}
    {!loading && hasMore && <SecondaryButton full onClick={() => void loadPage(false)}>Cargar siguiente página</SecondaryButton>}
    <p className="text-[11px] text-slate-500">El historial se consulta por páginas de hasta 20 documentos. Los filtros y las exportaciones abarcan los registros cargados; carga más páginas para incluir registros anteriores. Este reporte no cambia inventario ni libera lotes.</p>
  </section>
}
