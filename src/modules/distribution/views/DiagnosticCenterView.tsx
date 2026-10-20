import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bug, ChevronDown, ClipboardCopy, Download, RefreshCw } from 'lucide-react'
import { Screen } from '../../../components/ui/Screen'
import { Modal } from '../../../components/ui/Modal'
import { fetchGlobalDiagnosticReports, formatDiagnosticReport, tryCopyDiagnosticText, updateGlobalDiagnosticReport, type GlobalErrorDiagnosticReport } from '../../../lib/errorDiagnostics'

type ReviewStatus = 'new' | 'reviewing' | 'resolved'
type GlobalReport = GlobalErrorDiagnosticReport

type RangeOption = 'today' | 'week' | 'month' | '30d' | 'custom'
const startFor = (range: RangeOption, referenceTime: number) => {
  const date = new Date(referenceTime)
  if (range === 'today') date.setHours(0, 0, 0, 0)
  else if (range === 'week') { date.setDate(date.getDate() - 6); date.setHours(0, 0, 0, 0) }
  else if (range === 'month') { date.setDate(1); date.setHours(0, 0, 0, 0) }
  else date.setDate(date.getDate() - 29)
  return date.getTime()
}
const statusLabel: Record<ReviewStatus, string> = { new: 'Nuevo', reviewing: 'En revisión', resolved: 'Resuelto' }
const roleLabel: Record<string, string> = { admin: 'Administración', warehouse: 'Almacén', distributor: 'Distribuidor', support: 'Soporte' }

export function DiagnosticCenterView() {
  const [referenceTime] = useState(() => Date.now())
  const [reports, setReports] = useState<GlobalReport[]>([])
  const cursorRef = useRef<{ id: string; lastOccurredAt: string } | null>(null)
  const loadingRef = useRef(false)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [range, setRange] = useState<RangeOption>('week')
  const [roleFilter, setRoleFilter] = useState('')
  const [sectionFilter, setSectionFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [userFilter, setUserFilter] = useState('')
  const [routeFilter, setRouteFilter] = useState('')
  const [versionFilter, setVersionFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [selected, setSelected] = useState<GlobalReport | null>(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [copied, setCopied] = useState(false)

  const load = useCallback(async (append = false) => {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    setError('')
    try {
      const result = await fetchGlobalDiagnosticReports(append ? cursorRef.current : null)
      const page = result.reports
      setReports(current => append ? [...current, ...page] : page)
      cursorRef.current = result.nextCursor
      setHasMore(Boolean(result.nextCursor))
    } catch (cause) {
      setError((cause as Error)?.message || 'No se pudieron cargar los diagnósticos.')
    } finally { loadingRef.current = false; setLoading(false) }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(false) }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const visible = useMemo(() => {
    const minTime = range === 'custom' && fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : startFor(range, referenceTime)
    const maxTime = range === 'custom' && toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY
    const normalizedUser = userFilter.trim().toLocaleLowerCase('es-BO')
    return reports.filter(report => (range !== 'custom' || Boolean(fromDate && toDate))
      && Date.parse(report.lastOccurredAt || report.occurredAt) >= minTime
      && Date.parse(report.lastOccurredAt || report.occurredAt) <= maxTime
      && (!roleFilter || report.actorRole === roleFilter)
      && (!sectionFilter || report.view === sectionFilter)
      && (!categoryFilter || report.category === categoryFilter)
      && (!statusFilter || report.reviewStatus === statusFilter)
      && (!routeFilter || report.actorRouteId === routeFilter)
      && (!versionFilter || report.appVersion === versionFilter)
      && (!normalizedUser || `${report.actorName} ${report.actorUid} ${report.actorRouteId || ''}`.toLocaleLowerCase('es-BO').includes(normalizedUser)))
  }, [reports, range, fromDate, toDate, roleFilter, sectionFilter, categoryFilter, statusFilter, userFilter, routeFilter, versionFilter, referenceTime])
  const today = referenceTime - 24 * 60 * 60 * 1000
  const week = referenceTime - 7 * 24 * 60 * 60 * 1000
  const stats = useMemo(() => ({
    today: reports.filter(report => Date.parse(report.lastOccurredAt || report.occurredAt) >= today).length,
    week: reports.filter(report => Date.parse(report.lastOccurredAt || report.occurredAt) >= week).length,
    users: new Set(reports.filter(report => Date.parse(report.lastOccurredAt || report.occurredAt) >= week).map(report => report.actorUid)).size,
    pending: reports.filter(report => report.reviewStatus !== 'resolved').length,
  }), [reports, today, week])

  const update = async (reviewStatus: ReviewStatus) => {
    if (!selected) return
    setSaving(true); setNotice('')
    try {
      await updateGlobalDiagnosticReport({ reportId: selected.id, reviewStatus, internalNote: note })
      const next = { ...selected, reviewStatus, internalNote: note }
      setSelected(next)
      setReports(items => items.map(item => item.id === selected.id ? next : item))
      setNotice('Cambios guardados.')
    } catch (cause) { setNotice((cause as Error)?.message || 'No se pudo guardar el estado de revisión.') }
    finally { setSaving(false) }
  }
  const download = () => {
    if (!selected) return
    const blob = new Blob([formatDiagnosticReport(selected)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = `${selected.code}.json`; anchor.click()
    URL.revokeObjectURL(url)
  }

  return <Screen title="Diagnóstico de errores" subtitle="Incidentes técnicos recibidos de los usuarios de la empresa">
    <div className="grid min-w-0 gap-4">
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[['Errores hoy', stats.today], ['Últimos 7 días', stats.week], ['Usuarios afectados', stats.users], ['Pendientes de revisar', stats.pending]].map(([label, value]) => <article key={label} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3"><p className="text-[11px] font-bold text-slate-500">{label}</p><p className="mt-1 text-xl font-black text-slate-900">{value}</p></article>)}
      </section>
      <section className="grid min-w-0 gap-2 rounded-2xl border border-slate-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1 text-xs font-bold text-slate-600">Período<select className="min-h-11 min-w-0 rounded-xl border border-slate-300 px-3" value={range} onChange={event => setRange(event.target.value as RangeOption)}><option value="today">Hoy</option><option value="week">Semana</option><option value="month">Mes</option><option value="custom">Fechas</option><option value="30d">Últimos 30 días</option></select></label>
        {range === 'custom' && <><label className="grid gap-1 text-xs font-bold text-slate-600">Desde<input type="date" className="min-h-11 min-w-0 rounded-xl border border-slate-300 px-3" value={fromDate} onChange={event => setFromDate(event.target.value)} /></label><label className="grid gap-1 text-xs font-bold text-slate-600">Hasta<input type="date" className="min-h-11 min-w-0 rounded-xl border border-slate-300 px-3" value={toDate} onChange={event => setToDate(event.target.value)} /></label></>}
        <label className="grid gap-1 text-xs font-bold text-slate-600">Usuario<input className="min-h-11 min-w-0 rounded-xl border border-slate-300 px-3" value={userFilter} onChange={event => setUserFilter(event.target.value)} placeholder="Nombre, UID o ruta" /></label>
        <label className="grid gap-1 text-xs font-bold text-slate-600">Rol<select className="min-h-11 min-w-0 rounded-xl border border-slate-300 px-3" value={roleFilter} onChange={event => setRoleFilter(event.target.value)}><option value="">Todos</option>{Object.entries(roleLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="grid gap-1 text-xs font-bold text-slate-600">Ruta<input className="min-h-11 min-w-0 rounded-xl border border-slate-300 px-3" value={routeFilter} onChange={event => setRouteFilter(event.target.value)} placeholder="ID de ruta" /></label>
        <label className="grid gap-1 text-xs font-bold text-slate-600">Sección<input className="min-h-11 min-w-0 rounded-xl border border-slate-300 px-3" value={sectionFilter} onChange={event => setSectionFilter(event.target.value)} placeholder="dist.closure" /></label>
        <label className="grid gap-1 text-xs font-bold text-slate-600">Tipo de error<select className="min-h-11 min-w-0 rounded-xl border border-slate-300 px-3" value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}><option value="">Todos</option>{['render', 'asynchronous', 'permission', 'synchronization', 'data', 'unknown'].map(item => <option key={item}>{item}</option>)}</select></label>
        <label className="grid gap-1 text-xs font-bold text-slate-600">Revisión<select className="min-h-11 min-w-0 rounded-xl border border-slate-300 px-3" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="">Todos</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="grid gap-1 text-xs font-bold text-slate-600">Versión<input className="min-h-11 min-w-0 rounded-xl border border-slate-300 px-3" value={versionFilter} onChange={event => setVersionFilter(event.target.value)} placeholder="1.4.x" /></label>
        <div className="flex items-end"><button type="button" onClick={() => void load(false)} disabled={loading} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-xs font-extrabold text-slate-700"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Actualizar</button></div>
      </section>
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{error}</p>}
      <p className="text-xs font-semibold text-slate-500">Mostrando {visible.length} de {reports.length} incidentes cargados (retención de 30 días).</p>
      {visible.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center"><Bug className="mx-auto text-slate-400" /><p className="mt-2 text-sm font-bold text-slate-700">No hay incidentes que coincidan con estos filtros.</p></div> : <div className="grid min-w-0 gap-2">{visible.map(report => <article key={report.id} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="break-words text-sm font-extrabold text-slate-900">{report.actorName || 'Usuario'} · {roleLabel[report.actorRole] || report.actorRole}{report.actorRouteId ? ` · ${report.actorRouteId}` : ''}</p><p className="mt-1 break-words text-xs text-slate-600">{report.view} · {new Date(report.lastOccurredAt || report.occurredAt).toLocaleString('es-BO')} · {report.appVersion}</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ${report.reviewStatus === 'resolved' ? 'bg-emerald-50 text-emerald-800' : report.reviewStatus === 'reviewing' ? 'bg-amber-50 text-amber-800' : 'bg-rose-50 text-rose-800'}`}>{statusLabel[report.reviewStatus] || 'Nuevo'}</span></div>
        <p className="mt-2 break-words text-xs font-semibold text-slate-700">{report.errorName}: {report.message}</p><p className="mt-1 text-[10px] text-slate-500">Código {report.code} · {report.occurrenceCount} ocurrencia(s)</p>
        <button type="button" onClick={() => { setSelected(report); setNote(report.internalNote || ''); setNotice('') }} className="mt-3 inline-flex min-h-10 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-extrabold text-slate-700">Ver diagnóstico <ChevronDown size={14} /></button>
      </article>)}</div>}
      {hasMore && <button type="button" disabled={loading} onClick={() => void load(true)} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-extrabold text-slate-700">{loading ? 'Cargando…' : 'Cargar más'}</button>}
    </div>
    <Modal isOpen={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.code || 'Diagnóstico'} subtitle={selected ? `${selected.actorName} · ${selected.view} · ${new Date(selected.occurredAt).toLocaleString('es-BO')}` : undefined} size="lg" footer={selected ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><button type="button" onClick={async () => { const ok = await tryCopyDiagnosticText(formatDiagnosticReport(selected)); setCopied(ok) }} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 text-xs font-bold"><ClipboardCopy size={14} />{copied ? 'Copiado' : 'Copiar'}</button><button type="button" onClick={download} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 text-xs font-bold"><Download size={14} />JSON</button><button type="button" disabled={saving} onClick={() => void update('reviewing')} className="min-h-11 rounded-xl bg-amber-100 px-3 text-xs font-bold text-amber-900">En revisión</button><button type="button" disabled={saving} onClick={() => void update('resolved')} className="min-h-11 rounded-xl bg-emerald-700 px-3 text-xs font-bold text-white">Resolver</button></div> : undefined}>
      {selected && <div className="grid min-w-0 gap-3"><div className="grid grid-cols-2 gap-2 text-xs"><p><b>Usuario:</b> {selected.actorName}</p><p><b>Rol:</b> {roleLabel[selected.actorRole] || selected.actorRole}</p><p><b>UID:</b> {selected.actorUid}</p><p><b>Ruta:</b> {selected.actorRouteId || '—'}</p><p><b>Cliente:</b> {selected.browser} / {selected.operatingSystem}</p><p><b>Versión / build:</b> {selected.appVersion} / {selected.build}</p></div>
        <p className="break-words rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-900">{selected.errorName}: {selected.message}</p>
        <details className="rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-xs font-extrabold">Detalles técnicos y traza</summary><pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all text-[10px] text-slate-700">{selected.stack || 'Sin stack'}{selected.componentStack ? `\n\nComponent stack:\n${selected.componentStack}` : ''}</pre></details>
        {selected.closureContext && <details className="rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-xs font-extrabold">Contexto técnico del cierre</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap text-[10px]">{JSON.stringify(selected.closureContext, null, 2)}</pre></details>}
        <details className="rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-xs font-extrabold">Eventos recientes</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap text-[10px]">{JSON.stringify(selected.recentEvents, null, 2)}</pre></details>
        <label className="grid gap-1 text-xs font-bold text-slate-700">Nota interna<textarea className="min-h-20 w-full rounded-xl border border-slate-300 p-3" maxLength={500} value={note} onChange={event => setNote(event.target.value)} placeholder="Observación de soporte (máximo 500 caracteres)" /></label>
        {notice && <p role="status" className="text-xs font-bold text-slate-700">{notice}</p>}
      </div>}
    </Modal>
  </Screen>
}
