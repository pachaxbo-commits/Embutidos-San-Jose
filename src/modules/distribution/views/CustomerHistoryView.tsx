import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Download, FileSpreadsheet, FileText, Printer, RefreshCw } from 'lucide-react'
import { Field, TextInput } from '../../../components/ui/Form'
import { EmptyBlock, Screen } from '../../../components/ui/Screen'
import { loadCustomerFullHistory } from '../data/distributionRepository'
import { exportExcel, exportPdf, type ReportSheet } from '../data/reportExports'
import { printLargeCollectionReceipt, printLargeSaleReceipt } from '../data/distributionReceiptService'
import { customerHistoryRange, filterCustomerHistory, summarizeCustomerHistory, type CustomerAccountEvent, type CustomerFullHistoryData, type CustomerHistoryPreset, type CustomerHistoryRange, type CustomerHistoryTab } from '../domain/customerFullHistory'
import { formatBs, SecondaryButton } from './shared'
import type { DistributionSession } from './DistributionApp'
import type { DistCustomer, DistRoute, DistSale, DistSaleCorrection } from '../types'

const BOLIVIA_TIME_ZONE = 'America/La_Paz'
const dateTime = (value: string) => value ? new Date(value).toLocaleString('es-BO', { timeZone: BOLIVIA_TIME_ZONE, dateStyle: 'short', timeStyle: 'short' }) : 'Fecha histórica no disponible'
const money = (value: number) => formatBs(value)
const isPending = (row: { pendingConfirmation?: boolean }) => Boolean(row.pendingConfirmation)
const isCollectionVoided = (row: unknown) => { const value = row as Record<string, unknown>; return Boolean(value.voidedAt || value.status === 'VOID') }
const asEffective = (sale: DistSale) => sale.effectiveSnapshot ? { ...sale, ...sale.effectiveSnapshot } : sale
const getSaleLines = (sale: DistSale, corrections: DistSaleCorrection[]) => {
  if (!sale.voidedAt) return asEffective(sale).lines || sale.lines || []
  const last = corrections.slice().sort((a, b) => a.revision - b.revision).at(-1)
  return last?.original.lines || sale.lines || []
}
const receiptContext = (customerName: string, sale?: DistSale) => ({ companyName: 'Embutidos San José', routeName: sale?.routeName || 'Ruta histórica', distributorName: sale?.sellerName || customerName })
const prettyMonth = (value: string) => {
  const [year, month] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('es-BO', { timeZone: BOLIVIA_TIME_ZONE, month: 'long', year: 'numeric' })
}
const prettyDay = (value: string) => {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day, 16)).toLocaleDateString('es-BO', { timeZone: BOLIVIA_TIME_ZONE, dateStyle: 'long' })
}

const PRESETS: Array<{ id: CustomerHistoryPreset; label: string }> = [
  { id: 'today', label: 'Hoy' }, { id: 'yesterday', label: 'Ayer' }, { id: 'week', label: 'Esta semana' }, { id: 'previous-week', label: 'Semana anterior' },
  { id: 'month', label: 'Este mes' }, { id: 'previous-month', label: 'Mes anterior' }, { id: 'custom', label: 'Fechas' }, { id: 'all', label: 'Todo' },
]

export function CustomerHistoryView({ customer, routes, session, onBack }: { customer: DistCustomer; routes: DistRoute[]; session: DistributionSession; onBack: () => void }) {
  const [history, setHistory] = useState<CustomerFullHistoryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [preset, setPreset] = useState<CustomerHistoryPreset>('month')
  const [customRange, setCustomRange] = useState<CustomerHistoryRange>({ from: '', to: '' })
  const [tab, setTab] = useState<CustomerHistoryTab | 'months'>('purchases')
  const [visibleCount, setVisibleCount] = useState(40)
  const [openSaleIds, setOpenSaleIds] = useState<Set<string>>(new Set())
  const [exportError, setExportError] = useState('')
  const [auditOpen, setAuditOpen] = useState(false)

  const reload = async () => {
    setLoading(true); setLoadError('')
    try { setHistory(await loadCustomerFullHistory(customer)) }
    catch (error) { setHistory(null); setLoadError((error as Error).message || 'No se pudo recuperar el historial completo del cliente.') }
    finally { setLoading(false) }
  }
  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const result = await loadCustomerFullHistory(customer)
        if (active) { setHistory(result); setLoadError('') }
      } catch (error) {
        if (active) { setHistory(null); setLoadError((error as Error).message || 'No se pudo recuperar el historial completo del cliente.') }
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [customer])

  const range = useMemo(() => {
    if (preset === 'custom' && (!customRange.from || !customRange.to || customRange.from > customRange.to)) return { from: '9999-12-31', to: '0000-00-00' }
    return customerHistoryRange(preset, new Date(), customRange)
  }, [preset, customRange])
  const summarized = useMemo(() => history ? summarizeCustomerHistory({ customer, data: history, routes, range }) : null, [history, customer, routes, range])
  const correctionsBySale = useMemo(() => {
    const map = new Map<string, DistSaleCorrection[]>()
    for (const correction of history?.saleCorrections || []) map.set(correction.saleId, [...(map.get(correction.saleId) || []), correction])
    for (const corrections of map.values()) corrections.sort((a, b) => a.revision - b.revision)
    return map
  }, [history?.saleCorrections])
  const saleRows = useMemo(() => history ? filterCustomerHistory(history.sales.filter(sale => !sale.pendingConfirmation), range).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [], [history, range])
  const paymentRows = useMemo(() => history ? filterCustomerHistory(history.collections.filter(row => !row.pendingConfirmation), range).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [], [history, range])
  const dateLabel = preset === 'custom' && (!customRange.from || !customRange.to) ? 'Selecciona desde y hasta' : range.from && range.to ? `${range.from} a ${range.to}` : 'Todo el historial registrado'
  const visibleSales = saleRows.slice(0, visibleCount)
  const visiblePayments = paymentRows.slice(0, visibleCount)

  const selectedPreset = (next: CustomerHistoryPreset) => {
    setPreset(next); setVisibleCount(40)
    if (next !== 'custom') setCustomRange({ from: '', to: '' })
  }
  const setCustomDate = (field: 'from' | 'to', value: string) => {
    const next = { ...customRange, [field]: value }
    setCustomRange(next); setPreset('custom'); setVisibleCount(40)
  }
  const invalidRange = Boolean(preset === 'custom' && customRange.from && customRange.to && customRange.from > customRange.to)

  const sheets = (): ReportSheet[] => {
    if (!history || !summarized) return []
    const sum = summarized.summary
    const purchaseRows = saleRows.map(sale => {
      const effective = asEffective(sale)
      const lines = getSaleLines(sale, correctionsBySale.get(sale.id) || [])
      const status = sale.voidedAt ? 'Anulada' : sale.latestCorrectionId ? 'Corregida' : 'Vigente'
      const saleRecord = sale as unknown as Record<string, unknown>
      return [dateTime(sale.createdAt), String(saleRecord.saleNumber || saleRecord.receiptNumber || sale.id), sale.sellerName || 'No disponible', sale.routeName || 'No disponible', status,
        lines.map(line => `${line.productNameSnapshot}: ${line.quantity} ${line.unitType} × ${money(Number(line.actualUnitPrice) || 0)}`).join('; '),
        sale.voidedAt ? 0 : Number(effective.total) || 0, sale.voidedAt ? 0 : Number(effective.cashAmount) || 0, sale.voidedAt ? 0 : Number(effective.qrAmount) || 0, sale.voidedAt ? 0 : Number(effective.creditAmount) || 0,
        sale.voidReason || sale.editReason || sale.note || '']
    })
    const paymentSheetRows = paymentRows.map(row => { const voided = isCollectionVoided(row); return [dateTime(row.createdAt), row.id, voided ? 'ANULADO' : row.method === 'cash' ? 'Efectivo' : row.method === 'qr' ? 'QR' : 'Mixto', voided ? 0 : Number(row.cashAmount ?? (row.method === 'cash' ? row.amount : 0)) || 0,
      voided ? 0 : Number(row.qrAmount ?? (row.method === 'qr' ? row.amount : 0)) || 0, voided ? 0 : row.amount, row.collectedByName, row.routeId || '', (row.allocations || []).map(allocation => allocation.saleId || allocation.receivableId).join(', ') || row.receivableId || 'Asignación no disponible', row.portfolioBalanceBefore ?? '', row.portfolioBalanceAfter ?? '', String((row as unknown as Record<string, unknown>).voidReason || row.note || '')] })
    const accountRows = summarized.filteredAccountEvents.map(event => [dateTime(event.date), event.label, event.reference, event.route, event.responsible, event.charge || '', event.payment || '', event.balance, event.note])
    return [
      { name: 'Resumen', headers: ['Indicador', 'Valor', 'Unidad / observación'], rows: [
        ['Cliente', customer.name, customer.identityNumber || customer.customerCode || 'CI/código no disponible'], ['Período', dateLabel, 'Fechas operativas de Bolivia'],
        ['Compras vigentes', sum.purchaseCount, 'ventas'], ['Total comprado', sum.totalBought, 'Bs; no es dinero cobrado'], ['Pagado al comprar', sum.paidAtPurchase, `Bs · efectivo ${sum.cashAtPurchase} · QR ${sum.qrAtPurchase}`],
        ['Crédito generado', sum.creditGenerated, 'Bs'], ['Abonos posteriores recibidos', sum.collectionsReceived, 'Bs · excluye cobros pendientes'], ['Ajustes netos de deuda', sum.debtAdjustments, 'Bs'],
        ['Saldo inicial del período', sum.openingBalance ?? 'Saldo histórico no verificable', 'Bs'], ['Saldo final del período', sum.endingBalance ?? 'Saldo histórico no verificable', 'Bs'], ['Saldo actual en cartera', sum.currentBalance, 'Bs'],
        ['Conciliación del saldo', sum.balanceVerified ? 'Verificada con cartera vigente' : 'Revisión: movimientos históricos incompletos o diferencia', ''],
      ] },
      { name: 'Compras', headers: ['Fecha y hora', 'Venta / comprobante', 'Responsable', 'Ruta', 'Estado', 'Productos y cantidades', 'Valor venta (Bs)', 'Efectivo (Bs)', 'QR (Bs)', 'Crédito (Bs)', 'Nota / corrección'], rows: purchaseRows },
      { name: 'Pagos', headers: ['Fecha y hora', 'Cobro / referencia', 'Método / estado', 'Efectivo (Bs)', 'QR (Bs)', 'Total recibido (Bs)', 'Responsable', 'Ruta', 'Deudas aplicadas', 'Saldo cartera antes (Bs)', 'Saldo cartera después (Bs)', 'Nota'], rows: paymentSheetRows },
      { name: 'Movimientos de cuenta', headers: ['Fecha y hora', 'Movimiento', 'Referencia', 'Ruta', 'Responsable', 'Cargo (Bs)', 'Abono (Bs)', 'Saldo (Bs)', 'Nota'], rows: accountRows },
    ]
  }

  const filename = `SanJose-historial-cliente-${customer.id}-${(range.from || 'inicio')}-${(range.to || 'actual')}`
  const exportFile = async (format: 'pdf' | 'excel') => {
    setExportError('')
    try {
      const exportSheets = sheets()
      if (preset === 'custom' && (!customRange.from || !customRange.to || invalidRange)) throw new Error('Selecciona un intervalo de fechas válido antes de exportar.')
      if (format === 'pdf') await exportPdf(exportSheets, `${customer.name} · ${dateLabel} · generado ${new Date().toLocaleString('es-BO', { timeZone: BOLIVIA_TIME_ZONE })}`, `${filename}.pdf`)
      else await exportExcel(exportSheets, `Embutidos San José · ${customer.name} · ${dateLabel}`, `${filename}.xlsx`)
    } catch (error) { setExportError((error as Error).message || 'No se pudo generar el documento.') }
  }
  const printHistory = () => window.print()

  const accountEventsByMonth = useMemo(() => {
    const grouped = new Map<string, CustomerAccountEvent[]>()
    for (const event of summarized?.filteredAccountEvents || []) grouped.set(event.dayKey.slice(0, 7), [...(grouped.get(event.dayKey.slice(0, 7)) || []), event])
    return [...grouped.entries()].sort(([a], [b]) => b.localeCompare(a))
  }, [summarized])

  if (session.role !== 'admin' || !session.can('dist.customer.manage')) return <Screen title="Historial del cliente" subtitle="Sin permiso para consultar el historial integral"><p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">Esta consulta está disponible para Administración con permiso de gestión de clientes.</p><SecondaryButton onClick={onBack}>Volver a Clientes</SecondaryButton></Screen>

  return <Screen title="Historial del cliente" subtitle={`${customer.name} · ${customer.identityNumber || customer.customerCode || 'CI/código no registrado'}`} actions={<SecondaryButton onClick={onBack}><ArrowLeft size={16} /> Volver a Clientes</SecondaryButton>}>
    <div className="grid min-w-0 gap-4 print:hidden">
      <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0"><h2 className="text-lg font-black text-slate-900">{customer.name}</h2><p className="break-words text-xs text-slate-600">CI / código: {customer.identityNumber || customer.customerCode || 'No registrado'} · Teléfono: {customer.phone || 'No registrado'} · Dirección: {customer.address || 'No registrada'}</p><p className="mt-1 text-xs text-slate-600">Ruta asignada: {routes.find(route => route.id === customer.routeId)?.name || customer.routeId || 'Sin ruta'} · Estado: {customer.active === false ? 'Inactivo; historial conservado' : 'Activo'}</p>
            {history && <p className="mt-1 text-xs text-slate-500">Rutas históricas: {[...new Set([...history.sales.map(sale => sale.routeName), ...history.collections.map(row => routes.find(route => route.id === row.routeId)?.name || row.routeId)].filter(Boolean))].join(', ') || 'Sin compras vinculadas'}</p>}
          </div>
          <div className="rounded-xl bg-[var(--primary-soft)] px-3 py-2 text-sm font-black text-[var(--primary)]">Saldo actual: {history ? money(summarized?.summary.currentBalance || 0) : '…'}</div>
        </div>
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
          <Metric label="Total comprado" value={money(summarized?.summary.totalBought || 0)} help="Valor vigente de compras del período" />
          <Metric label="Pagado al comprar" value={money(summarized?.summary.paidAtPurchase || 0)} help={`Efectivo ${money(summarized?.summary.cashAtPurchase || 0)} · QR ${money(summarized?.summary.qrAtPurchase || 0)}`} />
          <Metric label="Crédito generado" value={money(summarized?.summary.creditGenerated || 0)} help="Importe al originar compras; ajustes se muestran aparte" />
          <Metric label="Abonos recibidos" value={money(summarized?.summary.collectionsReceived || 0)} help="No se vuelven a sumar a las ventas" />
          <Metric label="Ajustes netos" value={money(summarized?.summary.debtAdjustments || 0)} help="Cambios de deuda en el período" />
          <Metric label="Saldo inicial" value={summarized?.summary.openingBalance == null ? 'No verificable' : money(summarized.summary.openingBalance)} help="Reconstruido con eventos anteriores" />
          <Metric label="Saldo final" value={summarized?.summary.endingBalance == null ? 'No verificable' : money(summarized.summary.endingBalance)} help="Saldo después de los movimientos del período" />
          <Metric label="Saldo vigente" value={money(summarized?.summary.currentBalance || 0)} help="Cartera actual confirmada" />
        </div>
        {summarized && !summarized.summary.balanceVerified && <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-950">No es posible verificar el saldo histórico con todos los documentos disponibles. El saldo vigente de cartera se muestra por separado; no se inventa el saldo de fechas anteriores.</p>}
      </section>

      <section className="grid min-w-0 gap-3 rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
        <div><h2 className="text-sm font-black text-slate-900">Período de consulta</h2><p className="text-xs text-slate-500">Las fechas y jornadas se interpretan en Bolivia (America/La_Paz).</p></div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PRESETS.map(option => <button key={option.id} type="button" aria-pressed={preset === option.id} onClick={() => selectedPreset(option.id)} className={`min-h-10 rounded-xl border px-2 text-xs font-bold ${preset === option.id ? 'border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]' : 'border-slate-200 bg-white text-slate-700'}`}>{option.label}</button>)}
        </div>
        {preset === 'custom' && <div className="grid gap-2 sm:grid-cols-2"><Field label="Desde"><TextInput type="date" value={customRange.from || ''} onChange={event => setCustomDate('from', event.target.value)} /></Field><Field label="Hasta"><TextInput type="date" value={customRange.to || ''} onChange={event => setCustomDate('to', event.target.value)} /></Field></div>}
        {invalidRange && <p role="alert" className="text-xs font-bold text-rose-700">La fecha inicial debe ser anterior o igual a la fecha final.</p>}
        <p className="text-xs font-semibold text-slate-600">Mostrando: {dateLabel}</p>
      </section>

      <div className="flex flex-wrap gap-2">
        <SecondaryButton disabled={loading || !history} onClick={() => void exportFile('pdf')}><FileText size={16} /> Descargar PDF</SecondaryButton>
        <SecondaryButton disabled={loading || !history} onClick={() => void exportFile('excel')}><FileSpreadsheet size={16} /> Descargar Excel</SecondaryButton>
        <SecondaryButton disabled={loading || !history} onClick={printHistory}><Printer size={16} /> Imprimir historial</SecondaryButton>
        <SecondaryButton disabled={loading} onClick={() => void reload()}><RefreshCw size={16} /> Actualizar</SecondaryButton>
      </div>
      {exportError && <p role="alert" className="text-xs font-bold text-rose-700">{exportError}</p>}

      {loading && <div role="status" className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-950">Consultando todas las compras, pagos y movimientos de cartera asociados a este cliente…</div>}
      {loadError && <div role="alert" className="grid gap-2 rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900"><p>No se pudo confirmar que el historial esté completo: {loadError}</p><SecondaryButton onClick={() => void reload()}><RefreshCw size={16} /> Reintentar consulta</SecondaryButton></div>}
      {history && history.unlinkedNameMatches.length > 0 && <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950"><strong>Hay {history.unlinkedNameMatches.length} venta(s) histórica(s) con nombres usados en la ficha, pero sin ID de cliente.</strong> Se dejan aparte para evitar asignarlas a la persona equivocada.{history.unlinkedNameMatches.slice(0, 10).map(row => <p key={row.id} className="mt-1">{dateTime(row.createdAt)} · “{row.customerName}” · {row.id} · {row.routeName || 'Ruta no disponible'} · {money(Number(row.total) || 0)}</p>)}</div>}
      {history && (history.sales.some(isPending) || history.collections.some(isPending)) && <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">Hay operaciones pendientes de confirmación ({history.sales.filter(isPending).length} ventas y {history.collections.filter(isPending).length} cobros). No se incluyen como compras o dinero recibido hasta que el servidor las confirme.</div>}

      {history && <>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {([{ id: 'purchases', label: `Compras (${saleRows.length})` }, { id: 'payments', label: `Pagos (${paymentRows.length})` }, { id: 'account', label: 'Movimientos de cuenta' }, { id: 'months', label: 'Resumen mensual' }] as const).map(option => <button key={option.id} type="button" aria-pressed={tab === option.id} onClick={() => { setTab(option.id); setVisibleCount(40) }} className={`min-h-11 rounded-xl border px-2 text-xs font-black ${tab === option.id ? 'border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]' : 'border-slate-200 bg-white text-slate-700'}`}>{option.label}</button>)}
        </div>

        {tab === 'purchases' && <section className="grid gap-2">
          {visibleSales.length === 0 ? <EmptyBlock title="Sin compras en este período" description="Prueba con otro rango o selecciona Todo el historial." /> : visibleSales.map(sale => {
            const effective = asEffective(sale); const voided = Boolean(sale.voidedAt); const corrections = correctionsBySale.get(sale.id) || []; const lines = getSaleLines(sale, corrections); const expanded = openSaleIds.has(sale.id)
            return <article key={sale.id} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="text-sm font-black text-slate-900">{voided ? 'Venta anulada' : sale.latestCorrectionId ? 'Compra corregida' : 'Compra'} · {dateTime(sale.createdAt)}</p><p className="break-all text-[11px] text-slate-500">Comprobante: {String((sale as unknown as Record<string, unknown>).saleNumber || (sale as unknown as Record<string, unknown>).receiptNumber || sale.id)} · {sale.sellerName || 'Responsable no disponible'} · {sale.routeName || 'Ruta no disponible'}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-black ${voided ? 'bg-rose-100 text-rose-800' : sale.latestCorrectionId ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>{voided ? 'ANULADA' : sale.latestCorrectionId ? 'CORREGIDA' : 'VIGENTE'}</span></div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4"><p>Valor: <b>{money(voided ? 0 : Number(effective.total) || 0)}</b></p><p>Contado: <b>{money(voided ? 0 : Number(effective.cashAmount) || 0)}</b></p><p>QR: <b>{money(voided ? 0 : Number(effective.qrAmount) || 0)}</b></p><p>Crédito: <b>{money(voided ? 0 : Number(effective.creditAmount) || 0)}</b></p></div>
              <div className="mt-2 flex flex-wrap gap-2"><SecondaryButton onClick={() => setOpenSaleIds(current => { const next = new Set(current); if (next.has(sale.id)) next.delete(sale.id); else next.add(sale.id); return next })}>{expanded ? 'Ocultar productos' : 'Ver productos y cantidades'}</SecondaryButton><SecondaryButton onClick={() => { const original = voided ? { ...sale, ...((history.saleCorrections.filter(row => row.saleId === sale.id).sort((a, b) => a.revision - b.revision)[0]?.original) || {}) } as DistSale : effective as DistSale; void printLargeSaleReceipt(original, receiptContext(customer.name, sale)).catch(() => setExportError('No se pudo abrir el comprobante de la venta.')) }}>Abrir comprobante original</SecondaryButton></div>
              {expanded && <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3">{lines.length ? lines.map((line, index) => <div key={`${sale.id}-${line.productId}-${index}`} className="flex flex-wrap justify-between gap-1 text-xs"><span>{line.productNameSnapshot} · {line.quantity} {line.unitType}{line.presentationSnapshot ? ` · ${line.presentationSnapshot}` : ''}</span><span>{money(Number(line.actualUnitPrice) || 0)} × {line.quantity} = {money(Number(line.subtotal) || 0)}</span></div>) : <p className="text-xs text-amber-800">Detalle de productos no disponible en este registro antiguo.</p>}{corrections.map(correction => <p key={correction.id} className="text-xs text-amber-800">{correction.kind === 'void' ? 'Anulación' : `Corrección ${correction.revision}`} · {correction.reason} · {correction.correctedByName || 'Responsable no disponible'} · {dateTime(correction.createdAt)} · cambio crédito {money(correction.creditDelta)}</p>)}{sale.latestCorrectionId && <p className="text-xs text-amber-800">Última corrección: {sale.editReason || 'Motivo no disponible'} · {sale.editedBy || 'responsable no registrado'} · {dateTime(sale.editedAt || '')}</p>}{voided && <p className="text-xs text-rose-800">Motivo de anulación: {sale.voidReason || 'No registrado'} · {sale.voidedByName || 'Responsable no disponible'} · {dateTime(sale.voidedAt || '')}</p>}</div>}
            </article>
          })}
          {saleRows.length > visibleCount && <SecondaryButton onClick={() => setVisibleCount(value => value + 40)}><Download size={16} /> Mostrar 40 compras más ({visibleCount} de {saleRows.length})</SecondaryButton>}
        </section>}

        {tab === 'payments' && <section className="grid gap-2">
          {visiblePayments.length === 0 ? <EmptyBlock title="Sin pagos confirmados en este período" description="Los cobros pendientes se muestran aparte y no cuentan como dinero recibido." /> : visiblePayments.map(row => <article key={row.id} className="grid min-w-0 gap-2 rounded-2xl border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap justify-between gap-2"><div><p className="text-sm font-black">{isCollectionVoided(row) ? 'Cobro anulado' : 'Abono recibido'} {money(isCollectionVoided(row) ? 0 : row.amount)} · {dateTime(row.createdAt)}</p><p className="text-[11px] text-slate-500">{row.collectedByName || 'Responsable no disponible'} · {routes.find(route => route.id === row.routeId)?.name || row.routeId || 'Ruta no disponible'}{isCollectionVoided(row) && ` · ${String((row as unknown as Record<string, unknown>).voidReason || 'Motivo no disponible')}`}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-black ${isCollectionVoided(row) ? 'bg-rose-100 text-rose-800' : 'bg-slate-100'}`}>{isCollectionVoided(row) ? 'ANULADO' : row.method === 'cash' ? 'EFECTIVO' : row.method === 'qr' ? 'QR' : 'MIXTO'}</span></div>
            <p className="text-xs">Efectivo: {money(isCollectionVoided(row) ? 0 : Number(row.cashAmount ?? (row.method === 'cash' ? row.amount : 0)) || 0)} · QR: {money(isCollectionVoided(row) ? 0 : Number(row.qrAmount ?? (row.method === 'qr' ? row.amount : 0)) || 0)}</p>
            <p className="break-words text-xs text-slate-600">Aplicación FIFO: {(row.allocations || []).map(item => `${item.saleId || item.receivableId}: ${money(item.amount)}`).join(' · ') || row.receivableId || 'Asignación histórica no disponible'}</p>
            {(() => { const accountPayment = summarized?.account.events.find(event => event.id === `payment-${row.id}`); return summarized && accountPayment && summarized.account.balanceVerified
              ? <p className="text-xs text-slate-600">Saldo reconstruido: antes {money(accountPayment.balance + accountPayment.payment)} · después {money(accountPayment.balance)}</p>
              : (row.portfolioBalanceBefore != null || row.portfolioBalanceAfter != null) && <p className="text-xs text-slate-600">Saldo de cartera guardado al cobrar: antes {row.portfolioBalanceBefore == null ? 'no disponible' : money(row.portfolioBalanceBefore)} · después {row.portfolioBalanceAfter == null ? 'no disponible' : money(row.portfolioBalanceAfter)}</p> })()}
            {row.note && <p className="text-xs text-slate-600">Nota: {row.note}</p>}
            <div><SecondaryButton onClick={() => void printLargeCollectionReceipt(row, receiptContext(customer.name, { routeName: routes.find(route => route.id === row.routeId)?.name || row.routeId || 'Ruta histórica', sellerName: row.collectedByName || customer.name } as DistSale)).catch(() => setExportError('No se pudo abrir el comprobante del cobro.'))}>Abrir comprobante</SecondaryButton></div>
          </article>)}
          {paymentRows.length > visibleCount && <SecondaryButton onClick={() => setVisibleCount(value => value + 40)}>Mostrar 40 pagos más ({visibleCount} de {paymentRows.length})</SecondaryButton>}
        </section>}

        {tab === 'account' && <section className="grid gap-2">
          {!summarized?.summary.balanceVerified && <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">Saldo histórico no verificable: hay documentos insuficientes o la suma reconstruida no coincide con la cartera vigente.</p>}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3"><p className="text-xs">Reconstrucción: <b>{money(summarized?.account.reconstructedBalance || 0)}</b> · Cartera vigente: <b>{money(summarized?.account.currentBalance || 0)}</b></p><SecondaryButton onClick={() => setAuditOpen(value => !value)}>{auditOpen ? 'Cerrar revisión' : 'Revisar diferencias de saldo'}</SecondaryButton></div>
          {auditOpen && <div className="grid gap-2 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-950"><p className="font-black">Auditoría de movimientos vinculados</p><p>Diferencia reconstrucción − cartera: <b>{money(summarized?.account.balanceDifference || 0)}</b>. {summarized?.account.balanceVerified ? 'Los documentos disponibles concilian.' : 'No se atribuye el desajuste automáticamente al cliente ni al responsable.'}</p>{summarized?.account.auditWarnings.map((warning, index) => <p key={`${index}-${warning}`}>• {warning}</p>)}{!summarized?.account.auditWarnings.length && <p>Sin diferencias detectadas en los documentos consultados.</p>}<p>Las referencias de cada compra, abono, corrección y ajuste aparecen en la cronología inferior.</p></div>}
          {summarized?.filteredAccountEvents.slice(0, visibleCount).map(event => <article key={event.id} className="grid min-w-0 grid-cols-[1fr_auto] gap-2 rounded-2xl border border-slate-200 bg-white p-3 text-xs"><div className="min-w-0"><p className="font-black text-slate-900">{event.label} · {dateTime(event.date)}</p><p className="break-words text-slate-500">{event.route} · {event.responsible} · Ref. {event.reference}</p>{event.note && <p className="mt-1 break-words text-slate-600">{event.note}</p>}</div><div className="text-right tabular-nums"><p className="font-bold">Cargo {event.charge ? money(event.charge) : '—'}</p><p className="font-bold">Abono {event.payment ? money(event.payment) : '—'}</p><p className="mt-1 font-black">Saldo {money(event.balance)}</p></div></article>)}
          {(!summarized || summarized.filteredAccountEvents.length === 0) && <EmptyBlock title="Sin movimientos de cuenta en este período" description="Las compras al contado aparecen como información comercial; no alteran el saldo de crédito." />}
          {summarized && summarized.filteredAccountEvents.length > visibleCount && <SecondaryButton onClick={() => setVisibleCount(value => value + 40)}>Mostrar 40 movimientos más ({visibleCount} de {summarized.filteredAccountEvents.length})</SecondaryButton>}
        </section>}

        {tab === 'months' && <section className="grid gap-2">
          {accountEventsByMonth.length === 0 ? <EmptyBlock title="Sin meses con movimientos" description="Selecciona otro período o Todo el historial." /> : accountEventsByMonth.map(([month, events]) => {
            const monthSummary = summarized?.monthly.find(row => row.month === month)
            const byDate = new Map<string, typeof events>()
            for (const event of events) byDate.set(event.dayKey, [...(byDate.get(event.dayKey) || []), event])
            return <details key={month} className="rounded-2xl border border-slate-200 bg-white p-3"><summary className="cursor-pointer list-none"><div className="flex flex-wrap justify-between gap-2"><div><p className="font-black capitalize">{prettyMonth(month)}</p><p className="text-xs text-slate-500">{monthSummary?.purchaseCount || 0} compras · comprado {money(monthSummary?.totalBought || 0)} · abonos {money(monthSummary?.collectionsReceived || 0)}</p></div><p className="text-xs font-bold">Saldo inicial {monthSummary?.openingBalance == null ? 'no verificable' : money(monthSummary.openingBalance)} · final {monthSummary?.endingBalance == null ? 'no verificable' : money(monthSummary.endingBalance)}</p></div></summary>
              <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3">{[...byDate.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([day, dayEvents]) => <details key={day} className="rounded-xl bg-slate-50 p-2"><summary className="cursor-pointer text-xs font-black">{prettyDay(day)} · {dayEvents.length} movimiento(s)</summary><div className="mt-2 grid gap-2">{dayEvents.map(event => <p key={event.id} className="text-xs">{event.label} · Cargo {money(event.charge)} · Abono {money(event.payment)} · Saldo {money(event.balance)} · {event.responsible}</p>)}</div></details>)}</div>
            </details>
          })}
        </section>}
      </>}
    </div>
    <div className="hidden print:block">
      <h1>Embutidos San José · Historial del cliente</h1><p>{customer.name} · {customer.identityNumber || customer.customerCode || 'CI/código no disponible'} · {dateLabel}</p>
      <p>Comprado {money(summarized?.summary.totalBought || 0)} · Pagado al comprar {money(summarized?.summary.paidAtPurchase || 0)} · Crédito generado {money(summarized?.summary.creditGenerated || 0)} · Abonos {money(summarized?.summary.collectionsReceived || 0)}</p>
      <h2>Compras</h2>{saleRows.map(sale => <p key={`print-sale-${sale.id}`}>{dateTime(sale.createdAt)} · {sale.id} · {sale.sellerName} · {sale.routeName} · {sale.voidedAt ? 'ANULADA' : money(Number(asEffective(sale).total) || 0)} · {getSaleLines(sale, correctionsBySale.get(sale.id) || []).map(line => `${line.productNameSnapshot} ${line.quantity} ${line.unitType}`).join('; ')}</p>)}
      <h2>Pagos</h2>{paymentRows.map(row => <p key={`print-payment-${row.id}`}>{dateTime(row.createdAt)} · {row.id} · {money(row.amount)} · {row.method} · {row.collectedByName} · {(row.allocations || []).map(item => item.saleId || item.receivableId).join(', ')}</p>)}
      <h2>Movimientos de cuenta</h2>{summarized?.filteredAccountEvents.map(event => <p key={`print-event-${event.id}`}>{dateTime(event.date)} · {event.label} · Cargo {money(event.charge)} · Abono {money(event.payment)} · Saldo {money(event.balance)} · {event.responsible} · {event.reference}</p>)}
    </div>
  </Screen>
}

function Metric({ label, value, help }: { label: string; value: string; help: string }) {
  return <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-2.5"><p className="text-[9px] font-black uppercase leading-tight tracking-wide text-slate-500">{label}</p><p className="mt-1 break-words text-sm font-black tabular-nums text-slate-900">{value}</p><p className="mt-0.5 text-[10px] leading-snug text-slate-500">{help}</p></div>
}
