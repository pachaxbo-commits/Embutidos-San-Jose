import { useMemo, useState } from 'react'
import { FileSpreadsheet, FileText, Printer } from 'lucide-react'
import { Field } from '../../../components/ui/Form'
import { EmptyBlock } from '../../../components/ui/Screen'
import { RangePicker, describeRange } from './RangePicker'
import { SecondaryButton, SectionCard, formatBs, formatQty } from './shared'
import { exportExcel, exportPdf, type ReportSheet } from '../data/reportExports'
import { computeMermaReport, type MermaReportKind } from '../domain/mermaReport'
import { reportDateTime, reportUnitLabel } from '../domain/reportLabels'
import type { DistributionViewProps } from './DistributionApp'

const kinds: Array<{ value: MermaReportKind | 'all'; label: string }> = [
  { value: 'all', label: 'Todos los movimientos' }, { value: 'dispatch_merma', label: 'Merma adicional en despacho' },
  { value: 'dispatch_waste', label: 'Pérdida histórica al despachar' }, { value: 'return_merma', label: 'Merma recuperable al retorno' },
  { value: 'unfit', label: 'Producto no apto / pérdida' }, { value: 'shortage', label: 'Faltantes' }, { value: 'overage', label: 'Sobrantes' },
]

const quantityText = (values: { kg: number; package: number; unit: number }) =>
  [`${values.kg.toFixed(3)} kg`, `${values.package.toFixed(2)} paq`, `${values.unit.toFixed(2)} u`].join(' · ')

function escapeHtml(value: string) { return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] || char) }

export function MermaReportView({ session, data }: DistributionViewProps) {
  const dayKeys = session.dayKeys
  const [routeId, setRouteId] = useState('')
  const [distributorUid, setDistributorUid] = useState('')
  const [productId, setProductId] = useState('')
  const [kind, setKind] = useState<MermaReportKind | 'all'>('all')
  const [exporting, setExporting] = useState(false)
  const owners = useMemo(() => [...new Map(data.closures.filter((c) => c.distributorUid && c.distributorName).map((c) => [c.distributorUid, c.distributorName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [data.closures])
  const report = useMemo(() => computeMermaReport(data.movements, data.products, data.routes, data.closures, { dayKeys, routeId, distributorUid, productId, kind }, data.openDispatches), [data.movements, data.products, data.routes, data.closures, data.openDispatches, dayKeys, routeId, distributorUid, productId, kind])
  const summaryRows = [
    ['Merma adicional en despachos', 'dispatch_merma'], ['Pérdida histórica registrada al despachar', 'dispatch_waste'],
    ['Merma recuperable en retornos', 'return_merma'], ['Producto no apto / pérdida', 'unfit'], ['Faltantes', 'shortage'], ['Sobrantes', 'overage'],
  ] as const
  const summarySheet: ReportSheet = { name: 'Resumen de mermas', headers: ['Concepto', 'Kg', 'Paquetes', 'Unidades'], rows: summaryRows.map(([label, key]) => [label, report.totals[key].kg, report.totals[key].package, report.totals[key].unit]) }
  const detailSheet: ReportSheet = { name: 'Detalle de mermas', headers: ['Fecha', 'Tipo', 'Producto', 'Cantidad reportada', 'Unidad', 'Normal', 'Merma adicional', 'Total físico movimiento', 'Ruta / origen', 'Distribuidor', 'Lote', 'Motivo', 'Observación', 'Costo histórico (Bs)'], rows: report.rows.map((row) => [reportDateTime(row.createdAt), row.label, row.productName, row.quantity, reportUnitLabel(row.unitType), row.normalQuantity ?? null, row.dispatchMerma ?? null, row.kind === 'dispatch_merma' ? row.physicalQuantity : null, row.routeName, row.distributorName, row.lotCode, row.reason, row.note, row.lossCost]) }
  const productSheet: ReportSheet = { name: 'Totales por producto', headers: ['Producto', 'Unidad', 'Merma despacho recuperable', 'Pérdida histórica despacho', 'Merma recuperable retorno', 'No apto / pérdida', 'Faltante', 'Sobrante'], rows: report.byProduct.map((row) => [row.productName, reportUnitLabel(row.unitType), row.dispatchMerma, row.dispatchWaste, row.returnMerma, row.unfit, row.shortage, row.overage]) }
  const routeSheet: ReportSheet = { name: 'Totales por ruta', headers: ['Ruta / origen', 'Unidad', 'Merma despacho recuperable', 'Pérdida histórica despacho', 'Merma recuperable retorno', 'No apto / pérdida', 'Faltante', 'Sobrante'], rows: report.byRoute.map((row) => [row.routeName, reportUnitLabel(row.unitType), row.dispatchMerma, row.dispatchWaste, row.returnMerma, row.unfit, row.shortage, row.overage]) }
  const selectedProductName = productId ? (data.products.find((product) => product.id === productId)?.name || 'Producto seleccionado') : 'Todos los productos'
  const selectedKindLabel = kinds.find((item) => item.value === kind)?.label || 'Todos los movimientos'
  const description = `${describeRange(dayKeys)} · ${routeId ? (data.routes.find((r) => r.id === routeId)?.name || routeId) : 'Todas las rutas/orígenes'} · ${distributorUid ? (owners.find(([uid]) => uid === distributorUid)?.[1] || 'Distribuidor') : 'Todos los distribuidores'} · ${selectedProductName} · ${selectedKindLabel}`
  const sheets = [summarySheet, productSheet, routeSheet, detailSheet]
  const runExport = async (format: 'pdf' | 'excel') => {
    if (exporting) return
    setExporting(true)
    try {
      if (format === 'pdf') await exportPdf(sheets, description, 'SanJose-reporte-mermas.pdf')
      else await exportExcel(sheets, description, 'SanJose-reporte-mermas.xlsx')
    } finally { setExporting(false) }
  }
  const printReport = () => {
    const rows = report.rows.map((row) => `<tr><td>${escapeHtml(reportDateTime(row.createdAt))}</td><td>${escapeHtml(row.label)}</td><td>${escapeHtml(row.productName)}</td><td>${row.quantity.toFixed(row.unitType === 'kg' ? 3 : 2)} ${reportUnitLabel(row.unitType)}</td><td>${row.kind === 'dispatch_merma' ? `${(row.normalQuantity || 0).toFixed(3)} normal + ${(row.dispatchMerma || 0).toFixed(3)} merma = ${row.physicalQuantity.toFixed(3)} físico` : '—'}</td><td>${escapeHtml(row.routeName)}</td><td>${escapeHtml(row.distributorName)}</td><td>${escapeHtml(row.reason || row.note || '—')}</td></tr>`).join('')
    const popup = window.open('', '_blank')
    if (!popup) return
    popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Reporte de mermas</title><style>body{font:12px Arial,sans-serif;color:#1e293b;padding:24px}h1{color:#991b1b;font-size:20px}p{color:#475569}table{border-collapse:collapse;width:100%;font-size:10px}th,td{border:1px solid #cbd5e1;padding:6px;text-align:left}th{background:#e2e8f0}@media print{body{padding:0}}</style></head><body><h1>EMBUTIDOS SAN JOSÉ</h1><h2>REPORTE DE MERMAS</h2><p>${escapeHtml(description)} · Emitido ${escapeHtml(new Date().toLocaleString('es-BO'))}</p><p>${summaryRows.map(([label, key]) => `${escapeHtml(label)}: ${escapeHtml(quantityText(report.totals[key]))}`).join('<br>')}</p><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Producto</th><th>Cantidad</th><th>Normal + merma = físico</th><th>Ruta/origen</th><th>Distribuidor</th><th>Motivo/observación</th></tr></thead><tbody>${rows}</tbody></table><script>window.onload=()=>window.print()</script></body></html>`)
    popup.document.close()
  }
  const hasRouteFilter = session.role === 'admin'
  return <div className="grid min-w-0 gap-3">
    <SectionCard title="Mermas y diferencias de inventario">
      <div className="grid min-w-0 gap-3">
        <p className="text-xs text-slate-600">Cada cifra proviene una sola vez del ledger confirmado. La merma recuperable no se considera pérdida económica; faltantes y sobrantes se presentan por separado.</p>
        <RangePicker dayKeys={dayKeys} initialPreset="today" onChange={session.setDayKeys} />
        <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {hasRouteFilter && <Field label="Ruta / origen"><select className="min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm" value={routeId} onChange={(e) => setRouteId(e.target.value)}><option value="">Todas las rutas / orígenes</option><option value="administracion">Administración</option><option value="route-impulsacion">Impulsación</option>{data.routes.filter((r) => r.active && r.kind !== 'direct').map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>}
          <Field label="Distribuidor"><select className="min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm" value={distributorUid} onChange={(e) => setDistributorUid(e.target.value)}><option value="">Todos los distribuidores</option>{owners.map(([uid, name]) => <option key={uid} value={uid}>{name}</option>)}</select></Field>
          <Field label="Producto"><select className="min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm" value={productId} onChange={(e) => setProductId(e.target.value)}><option value="">Todos los productos</option>{data.products.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Tipo de movimiento"><select className="min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm" value={kind} onChange={(e) => setKind(e.target.value as MermaReportKind | 'all')}>{kinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">{summaryRows.map(([label, key]) => <div key={key} className={`min-w-0 rounded-xl border p-2.5 ${key === 'unfit' || key === 'shortage' || key === 'dispatch_waste' ? 'border-rose-100 bg-rose-50' : key === 'overage' ? 'border-amber-100 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}><p className="text-[10px] font-black leading-snug text-slate-700">{label}</p><p className="mt-1 break-words text-[11px] font-extrabold tabular-nums text-slate-900">{quantityText(report.totals[key])}</p></div>)}</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3"><SecondaryButton disabled={exporting || !report.rows.length} onClick={() => void runExport('pdf')}><FileText size={15}/> PDF</SecondaryButton><SecondaryButton disabled={exporting || !report.rows.length} onClick={() => void runExport('excel')}><FileSpreadsheet size={15}/> Excel</SecondaryButton><SecondaryButton disabled={!report.rows.length} onClick={printReport}><Printer size={15}/> Imprimir</SecondaryButton></div>
        {report.byProduct.length > 0 && <div className="grid gap-2"><h4 className="text-xs font-black uppercase text-slate-700">Totales por producto</h4>{report.byProduct.map((row) => <details key={row.productId} className="rounded-xl border border-slate-200 bg-white p-3"><summary className="cursor-pointer break-words text-sm font-extrabold text-slate-900">{row.productName} · {reportUnitLabel(row.unitType)}</summary><div className="mt-2 grid gap-1 text-xs text-slate-700"><p>Merma adicional despacho: {formatQty(row.dispatchMerma, row.unitType)}</p><p>Pérdida histórica al despachar: {formatQty(row.dispatchWaste, row.unitType)}</p><p>Merma recuperable retorno: {formatQty(row.returnMerma, row.unitType)}</p><p>Producto no apto: {formatQty(row.unfit, row.unitType)}</p><p>Faltante: {formatQty(row.shortage, row.unitType)} · Sobrante: {formatQty(row.overage, row.unitType)}</p></div></details>)}</div>}
        {report.byRoute.length > 0 && <div className="grid gap-2"><h4 className="text-xs font-black uppercase text-slate-700">Totales por ruta / origen</h4>{report.byRoute.map((row) => <article key={`${row.routeId}-${row.unitType}`} className="rounded-xl bg-slate-50 p-3"><h5 className="text-sm font-extrabold text-slate-900">{row.routeName} · {reportUnitLabel(row.unitType)}</h5><p className="mt-1 text-xs text-slate-700">Merma despacho {formatQty(row.dispatchMerma, row.unitType)} · pérdida histórica despacho {formatQty(row.dispatchWaste, row.unitType)} · retorno recuperable {formatQty(row.returnMerma, row.unitType)} · no apto {formatQty(row.unfit, row.unitType)} · faltante {formatQty(row.shortage, row.unitType)} · sobrante {formatQty(row.overage, row.unitType)}</p></article>)}</div>}
        {report.rows.length === 0 ? <EmptyBlock title="No hay mermas ni diferencias para estos filtros" description="Prueba otro periodo, ruta, producto o tipo de movimiento."/> : <div className="grid gap-2"><p className="text-xs font-bold text-slate-600">{report.rows.length} movimientos confirmados · {description}</p>{report.rows.map((row) => <article key={row.id} className="min-w-0 rounded-xl border border-slate-200 bg-white p-3"><div className="flex min-w-0 flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="break-words text-sm font-extrabold text-slate-900">{row.productName}</p><p className="mt-0.5 text-xs font-bold text-slate-600">{row.label}</p></div><strong className="shrink-0 text-sm tabular-nums text-slate-900">{formatQty(row.quantity, row.unitType)}</strong></div><p className="mt-1 break-words text-[11px] text-slate-600">{reportDateTime(row.createdAt)} · {row.routeName} · {row.distributorName}{row.lotCode ? ` · Lote ${row.lotCode}` : ''}</p>{row.kind === 'dispatch_merma' && <p className="mt-1 text-xs font-semibold text-slate-700">Carga física: {formatQty(row.normalQuantity || 0, row.unitType)} normal + {formatQty(row.dispatchMerma || 0, row.unitType)} merma = {formatQty(row.physicalQuantity, row.unitType)} enviados.</p>}{row.reason && <p className="mt-1 text-xs text-slate-700">Motivo: {row.reason}</p>}{row.note && <p className="mt-1 text-xs text-slate-600">{row.note}</p>}{row.lossCost !== null && <p className="mt-1 text-xs font-bold text-rose-800">Costo histórico conocido: {formatBs(row.lossCost)}</p>}</article>)}</div>}
      </div>
    </SectionCard>
  </div>
}
