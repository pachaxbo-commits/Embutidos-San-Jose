import { collectProcessingReportPages, ProcessingReportLimitError } from '../domain/processingReportPagination'
import { recordErrorDiagnostic } from '../../../lib/errorDiagnostics'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, FileSpreadsheet, FileText, Printer, RefreshCw } from 'lucide-react'
import { Field, SelectInput, TextInput } from '../../../components/ui/Form'
import { EmptyBlock, LoadingState } from '../../../components/ui/Screen'
import type { ProcessingBatch, ProcessingRepackRecord, ProcessingReviewRecord } from '../domain/processing'
import { buildProcessingBatchReport, buildProcessingLotTraceReport, buildProcessingQualityReport, filterProcessingBatches, filterProcessingRepackings, filterProcessingReviews } from '../domain/processingReports'
import { loadProcessingReportPage, type ProcessingBatchPage } from '../data/distributionRepository'
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
  const [completedScope, setCompletedScope] = useState('')
  const [from, setFrom] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()))
  const [to, setTo] = useState(from)
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
  const scope = JSON.stringify([mode, locationKey, from, to])
  const incomplete = completedScope !== scope
  const clearLoadedRows = () => {
    requestVersion.current++
    setBatches([]); setReviews([]); setRepackings([]); cursorRef.current = null; setHasMore(false)
  }
  const invalidateInFlight = useCallback(() => { requestVersion.current++ }, [])

  const loadPage = useCallback(async (reset = false) => {
    const version = reset ? ++requestVersion.current : requestVersion.current
    setLoading(true); setError('')
    try {
      setBatches([]); setReviews([]); setRepackings([]); setHasMore(true)
      const rows = await collectProcessingReportPages((cursor: Cursor) => loadProcessingReportPage(mode, locationKey, from, to, cursor), () => version === requestVersion.current)
      if (!rows) return
      if (mode === 'batches' || mode === 'trace') setBatches(rows as unknown as ProcessingBatch[])
      else if (mode === 'reviews') setReviews(rows as unknown as ProcessingReviewRecord[])
      else setRepackings(rows as unknown as ProcessingRepackRecord[])
      setHasMore(false)
      setCompletedScope(JSON.stringify([mode, locationKey, from, to]))
    } catch (reason) {
      if (version === requestVersion.current) {
        recordErrorDiagnostic({ error: reason instanceof Error ? reason : new Error(String(reason)), source: 'handled_operation_failure', view: 'dist.processing.reports' })
        setError(reason instanceof ProcessingReportLimitError ? reason.message : 'No se completó el informe. Reintenta o selecciona un período menor; los resultados incompletos no pueden exportarse ni imprimirse.')
      }
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [locationKey, mode, from, to])

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
    if (loading || incomplete || hasMore || error) {
      setError('El informe está incompleto. Completa la consulta antes de exportar.')
      return
    }
    try {
      const { exportExcel, exportPdf } = await import('../data/reportExports')
      const description = `San José · ${report.name} · ${from || 'sin inicio'} a ${to || 'sin fin'} · ${report.rows.length} registros filtrados de ${mode === 'batches' || mode === 'trace' ? batches.length : mode === 'reviews' ? reviews.length : repackings.length} cargados`
      if (format === 'Excel') await exportExcel([report], description)
      else await exportPdf([report], description)
    } catch (reason) {
      recordErrorDiagnostic({ error: reason instanceof Error ? reason : new Error(String(reason)), source: 'handled_operation_failure', view: 'dist.processing.reports.export' })
      setError(`No se pudo generar el ${format}. Reintenta la exportación.`)
    }
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
      <Field label="Estado"><SelectInput value={status} onChange={event => setStatus(event.target.value)}><option value="">Todos</option><option value="confirmed">Confirmado</option><option value="corrected">Corregido</option><option value="reversed">Revertido</option><option value="pending_review">Pendiente de revisión</option><option value="in_review">En revisión</option><option value="authorized_for_repack">Autorizado para reenvasado</option><option value="not_recoverable">No recuperable</option><option value="pending_information">Falta información</option><option value="resolved_specialized">Resuelto con procedimiento especializado</option><option value="pending_economic_disposition">Pendiente de decisión económica</option></SelectInput></Field>
    </div>
    {(from && to && from > to) && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-800">La fecha inicial no puede ser posterior a la fecha final.</p>}
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800"><AlertTriangle className="mr-1 inline" size={15} />{error}</p>}
    <div className="processing-report-controls flex flex-wrap gap-2">
      <SecondaryButton disabled={loading || incomplete || hasMore || Boolean(error) || !from || !to || from > to} onClick={() => void exportReport('PDF')}><FileText size={15} />PDF</SecondaryButton>
      <SecondaryButton disabled={loading || incomplete || hasMore || Boolean(error) || !from || !to || from > to} onClick={() => void exportReport('Excel')}><FileSpreadsheet size={15} />Excel</SecondaryButton>
      <SecondaryButton disabled={loading || incomplete || hasMore || Boolean(error) || report.rows.length === 0} onClick={() => window.print()}><Printer size={15} />Imprimir</SecondaryButton>
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
    <p className="text-[11px] text-slate-500">El período se consulta completo por páginas de hasta 50 documentos. Pantalla, PDF, Excel e impresión usan los mismos registros. Si falla una página, el informe queda incompleto y no puede exportarse ni imprimirse.</p>
  </section>
}
