import { Fragment, useMemo, useState } from 'react'
import { Download, FileSpreadsheet, FileText, Printer, Share2 } from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import { Modal } from '../../../components/ui/Modal'
import { Segmented } from '../../../components/ui/Form'
import { printHtmlDocument } from '../../../services/printing/documentPrintService'
import { exportExcel, exportPdf, type ReportSheet } from '../data/reportExports'
import { RangePicker, describeRange } from './RangePicker'
import { EmptyBlock, Screen } from '../../../components/ui/Screen'
import { formatBs, SecondaryButton } from './shared'
import { computeOperatingResult, type OperatingResultDetail } from '../domain/operatingResult'
import { EXPENSE_GROUPS } from '../domain/expenseCategories'
import type { DistributionViewProps } from './DistributionApp'

type ViewMode = 'easy' | 'classic'

function sheetForResult(result: ReturnType<typeof computeOperatingResult>, period: string, mode: ViewMode): ReportSheet {
  const sections: Array<[string, number | null]> = [
    ['Ventas brutas', result.grossSales], ['Cambios y devoluciones', result.adjustments],
    ['Ventas netas', result.netSales], ['Costo de lo vendido', result.costOfSales], ['Margen bruto', result.grossMargin],
    ...EXPENSE_GROUPS.map((group) => [group.label, result.expenseTotals[group.id]] as [string, number | null]),
    ['Mermas y pérdidas', result.losses], ['Costo de cortesías', result.courtesyCost],
    ['Resultado operativo estimado', result.operatingResult],
  ]
  if (mode === 'easy') return {
    name: 'Resultado del negocio', headers: ['Resumen', 'Monto (Bs)'], rows: [
      ['EMBUTIDOS SAN JOSÉ · RESULTADO DEL NEGOCIO', period], ['Emitido', new Date().toLocaleString('es-BO')],
      ...sections.filter(([label]) => label !== 'Resultado operativo estimado').map(([label, value]) => [label, value === null ? 'No disponible: falta costo histórico' : value]),
      ['RESULTADO OPERATIVO ESTIMADO', result.operatingResult === null ? 'No disponible: falta costo histórico' : result.operatingResult],
      ['Fórmula', 'Ventas netas - costo de lo vendido - egresos - pérdidas - cortesías'],
      ['Nota', 'Estimación operativa; no es contabilidad formal.'],
    ],
  }
  const classicRows: (string | number | null)[][] = [
    ['EMBUTIDOS SAN JOSÉ', 'RESULTADO DEL NEGOCIO', '', '', ''],
    ['Período', period, 'Fecha de emisión', new Date().toLocaleString('es-BO'), ''],
    ...sections.map(([label, value]) => [label, '', '', '', value === null ? 'No disponible: falta costo histórico' : value]),
    ['DETALLE DE EGRESOS', '', '', '', ''],
    ['Grupo', 'Categoría', 'Concepto', 'Origen / Responsable', 'Monto (Bs)'],
    ...EXPENSE_GROUPS.flatMap((group) => {
      const items = result.expenses.filter((expense) => expense.group === group.id)
      return items.length ? [[group.label, '', '', '', ''], ...items.map((item) => ['', item.category, item.concept, `${item.origin} / ${item.responsible}`, item.amount]), ['', `Subtotal ${group.label}`, '', '', result.expenseTotals[group.id]]] : []
    }),
    ['Nota', 'Estimación operativa; no es contabilidad formal.', '', '', ''],
  ]
  return { name: 'Resultado del negocio', headers: ['Grupo', 'Categoría', 'Concepto', 'Origen / Responsable', 'Monto (Bs)'], rows: classicRows }
}

function htmlForResult(result: ReturnType<typeof computeOperatingResult>, period: string) {
  const amount = (value: number | null) => value === null ? 'No disponible: falta costo histórico' : formatBs(value)
  const rows = result.details.filter((item) => item.key !== 'netSales' && item.key !== 'result').map((item) => `<tr><td>${item.label}</td><td>${amount(item.amount)}</td></tr>`).join('')
  return `<!doctype html><html lang="es"><meta charset="utf-8"><title>Resultado del negocio</title><style>body{font:15px Arial;color:#172033;margin:36px}header{border-top:10px solid #bd1024;padding-top:22px}.brand{display:flex;align-items:center;gap:16px}header img{width:74px;height:auto}h1{margin:0}h2{color:#bd1024}.hero{background:#f9f3f1;padding:18px;margin:24px 0;font-size:28px;font-weight:bold}table{width:100%;border-collapse:collapse}td{padding:10px;border-bottom:1px solid #dce1e8}td:last-child{text-align:right;font-weight:bold}.note{color:#566174;font-size:12px;margin-top:22px}</style><header><div class="brand"><img src="/brand/san-jose-logo.png" alt="San José"><div><h1>EMBUTIDOS SAN JOSÉ</h1><h2>RESULTADO DEL NEGOCIO</h2></div></div><p>Período: ${period} · Emitido: ${new Date().toLocaleString('es-BO')}</p></header><div class="hero">Resultado operativo estimado: ${amount(result.operatingResult)}</div><p>Ventas netas − costo de lo vendido − egresos − pérdidas − costo de cortesías</p><table>${rows}</table><p class="note">Cálculo según operaciones, costos, egresos y pérdidas registrados. Es una estimación operativa, no contabilidad formal.</p></html>`
}

async function renderSummaryPng(result: ReturnType<typeof computeOperatingResult>, period: string): Promise<Blob> {
  const canvas = document.createElement('canvas')
  const rows: Array<[string, number | null]> = [['Ventas brutas', result.grossSales], ['Cambios y devoluciones', result.adjustments], ['Ventas netas', result.netSales], ['Costo de lo vendido', result.costOfSales], ['Margen bruto', result.grossMargin], ...EXPENSE_GROUPS.map((g) => [g.label, result.expenseTotals[g.id]] as [string, number]), ['Mermas y pérdidas', result.losses], ['Costo de cortesías', result.courtesyCost]]
  canvas.width = 1100; canvas.height = 435 + rows.length * 38 + 70
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Este dispositivo no pudo crear la imagen.')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#bd1024'; ctx.fillRect(0, 0, canvas.width, 14)
  const logo = new Image(); logo.src = '/brand/san-jose-logo.png'
  await new Promise<void>((resolve) => { logo.onload = () => resolve(); logo.onerror = () => resolve() })
  if (logo.complete && logo.naturalWidth) ctx.drawImage(logo, 55, 28, 105, 78)
  ctx.fillStyle = '#172033'; ctx.font = 'bold 38px Arial'; ctx.fillText('EMBUTIDOS SAN JOSÉ', 185, 68)
  ctx.fillStyle = '#bd1024'; ctx.font = 'bold 30px Arial'; ctx.fillText('RESULTADO DEL NEGOCIO', 185, 112)
  ctx.fillStyle = '#566174'; ctx.font = '20px Arial'; ctx.fillText(`Período: ${period}`, 185, 150)
  ctx.fillStyle = '#fbf5f3'; ctx.fillRect(55, 220, 990, 145)
  ctx.fillStyle = '#566174'; ctx.font = 'bold 22px Arial'; ctx.fillText('RESULTADO OPERATIVO ESTIMADO', 85, 270)
  ctx.fillStyle = '#bd1024'; ctx.font = 'bold 48px Arial'; ctx.fillText(result.operatingResult === null ? 'No disponible' : formatBs(result.operatingResult), 85, 335)
  ctx.font = '22px Arial'
  rows.forEach(([label, value], index) => {
    const y = 415 + index * 38
    ctx.fillStyle = '#344054'; ctx.fillText(label, 65, y)
    ctx.textAlign = 'right'; ctx.fillText(value === null ? 'Falta costo histórico' : formatBs(value), 1035, y); ctx.textAlign = 'left'
  })
  ctx.fillStyle = '#687386'; ctx.font = '15px Arial'; ctx.fillText('Estimación operativa basada en datos registrados; no es contabilidad formal.', 60, canvas.height - 24)
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('No se pudo crear la imagen.')), 'image/png'))
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

async function shareSummaryImage(blob: Blob) {
  if (Capacitor.isNativePlatform()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')])
    const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob) })
    const file = await Filesystem.writeFile({ path: 'reports/SanJose-resultado-operativo.png', directory: Directory.Cache, data: base64, recursive: true })
    await Share.share({ title: 'Resultado del negocio · Embutidos San José', dialogTitle: 'Compartir resultado', files: [file.uri] })
    return
  }
  const file = new File([blob], 'SanJose-resultado-operativo.png', { type: 'image/png' })
  const nav = navigator as Navigator & { share?: (data: { title?: string; files?: File[] }) => Promise<void>; canShare?: (data: { files: File[] }) => boolean }
  if (nav.share && (!nav.canShare || nav.canShare({ files: [file] }))) { await nav.share({ title: 'Resultado del negocio', files: [file] }); return }
  downloadBlob(blob, file.name)
}

export function OperatingResultView({ session, data }: DistributionViewProps) {
  const [mode, setMode] = useState<ViewMode>('easy')
  const [routeFilter, setRouteFilter] = useState('')
  const [selectedDetail, setSelectedDetail] = useState<OperatingResultDetail | null>(null)
  const [feedback, setFeedback] = useState('')
  const result = useMemo(() => computeOperatingResult(data.sales, data.claims, data.expenses, data.movements, session.dayKeys, routeFilter, data.routes), [data.sales, data.claims, data.expenses, data.movements, data.routes, session.dayKeys, routeFilter])
  const period = describeRange(session.dayKeys)
  const amount = (value: number | null) => value === null ? 'No disponible' : formatBs(value)
  const runExport = async (kind: 'pdf' | 'excel') => {
    try {
      const sheet = sheetForResult(result, period, mode)
      if (kind === 'pdf') await exportPdf([sheet], `Resultado del negocio · ${period}`, 'SanJose-resultado-operativo.pdf')
      else await exportExcel([sheet], `Resultado del negocio · ${period}`, 'SanJose-resultado-operativo.xlsx')
      setFeedback(kind === 'pdf' ? 'Documento PDF preparado.' : 'Archivo Excel preparado.')
    } catch (error) { setFeedback((error as Error).message || 'No se pudo preparar el documento.') }
  }
  const print = async () => {
    try { await printHtmlDocument(htmlForResult(result, period), 'Resultado del negocio'); setFeedback('Documento listo para imprimir.') }
    catch (error) { setFeedback((error as Error).message) }
  }
  const openDetail = (key: OperatingResultDetail['key']) => {
    const detail = result.details.find((entry) => entry.key === key)
    if (detail) setSelectedDetail(detail)
  }
  const amountButton = (label: string, value: number | null, key: OperatingResultDetail['key'], color = 'text-slate-900') => (
    <button type="button" onClick={() => openDetail(key)} className="flex w-full items-center justify-between gap-3 border-b border-slate-100 py-3 text-left hover:bg-rose-50/50">
      <span className="text-sm font-semibold text-slate-700">{label}</span><span className={`text-right text-sm font-black ${color}`}>{amount(value)}</span>
    </button>
  )

  return <Screen title="Resultado del negocio" subtitle="Estimación basada en lo registrado; no es contabilidad formal.">
    <div className="grid gap-3">
      <Segmented value={mode} onChange={(value) => setMode(value as ViewMode)} options={[{ value: 'easy', label: 'Vista fácil' }, { value: 'classic', label: 'Tabla clásica' }]} />
      <RangePicker dayKeys={session.dayKeys} onChange={session.setDayKeys} routes={data.routes} routeFilter={routeFilter} onRouteFilterChange={setRouteFilter} />
      <div className="flex flex-wrap gap-2">
        <SecondaryButton onClick={() => void runExport('pdf')}><FileText size={15} /> Descargar PDF</SecondaryButton>
        {mode === 'classic' && <SecondaryButton onClick={() => void runExport('excel')}><FileSpreadsheet size={15} /> Descargar Excel</SecondaryButton>}
        {mode === 'easy' && <SecondaryButton onClick={() => void renderSummaryPng(result, period).then((blob) => downloadBlob(blob, 'SanJose-resultado-operativo.png')).catch((error) => setFeedback((error as Error).message))}><Download size={15} /> Descargar imagen</SecondaryButton>}
        <SecondaryButton onClick={() => void print()}><Printer size={15} /> Imprimir hoja</SecondaryButton>
        {mode === 'easy' ? <SecondaryButton onClick={() => void renderSummaryPng(result, period).then(shareSummaryImage).then(() => setFeedback('Imagen preparada para compartir.')).catch((error) => setFeedback((error as Error).message))}><Share2 size={15} /> Compartir imagen</SecondaryButton> : <SecondaryButton onClick={() => void runExport('pdf')}><Share2 size={15} /> Compartir PDF</SecondaryButton>}
      </div>
      {feedback && <p role="status" className="text-xs font-semibold text-slate-600">{feedback}</p>}

      {mode === 'easy' ? <section className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-6">
        <p className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Resultado operativo del período · {period}</p>
        <p className={`mt-2 break-words text-3xl font-black sm:text-4xl ${result.operatingResult === null ? 'text-amber-700' : 'text-[var(--primary)]'}`}>{amount(result.operatingResult)}</p>
        <p className="mt-2 text-xs text-slate-500">Ventas netas − costo de lo vendido − egresos − pérdidas − cortesías</p>
        <div className="mt-5">
          {amountButton('Ventas brutas', result.grossSales, 'grossSales')}
          {amountButton('Cambios y devoluciones', result.adjustments, 'adjustments', 'text-amber-700')}
          {amountButton('Ventas netas', result.netSales, 'netSales', 'text-[var(--primary)]')}
          {amountButton('Costo de lo vendido', result.costOfSales, 'costOfSales')}
          {amountButton('Margen bruto', result.grossMargin, 'grossMargin', 'text-emerald-700')}
          {EXPENSE_GROUPS.map((group) => <Fragment key={group.id}>{amountButton(group.label, result.expenseTotals[group.id], group.id)}</Fragment>)}
          {amountButton('Mermas y pérdidas', result.losses, 'losses', 'text-amber-800')}
          {amountButton('Costo de cortesías', result.courtesyCost, 'courtesies')}
          {amountButton('Resultado operativo estimado', result.operatingResult, 'result', 'text-[var(--primary)]')}
        </div>
        {!result.costsKnown && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-900">No se muestra una cifra final porque faltan costos históricos en algunas ventas, pérdidas o cortesías.</p>}
        <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700"><h3 className="font-black">¿Cómo leer este resultado?</h3><p className="mt-2">Ventas netas: ventas después de cambios y devoluciones. Costo de lo vendido: costo histórico de lo que salió como venta. Margen bruto: lo que queda después del costo directo. Egresos: salidas de dinero registradas. Mermas y cortesías: producto que salió sin venta. El resultado operativo es una estimación con la información registrada.</p><p className="mt-2 text-xs text-slate-500">Los cobros de créditos no son ventas nuevas y no aumentan este resultado.</p></div>
      </section> : <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-4"><p className="text-xs font-bold text-slate-500">EMBUTIDOS SAN JOSÉ · {period}</p><h2 className="text-xl font-black">Resultado del negocio</h2></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[520px] border-collapse text-sm"><thead className="bg-slate-100 text-left text-xs uppercase text-slate-600"><tr><th className="p-3">Concepto</th><th className="p-3 text-right">Monto (Bs)</th></tr></thead><tbody>
          {result.details.filter((entry) => entry.key !== 'result').map((entry) => <tr key={entry.key} className="border-t border-slate-100"><td className="p-3">{entry.label}{entry.key === 'grossSales' ? ' · ingresos' : ''}</td><td className="p-3 text-right font-bold">{amount(entry.amount)}</td></tr>)}
          <tr className="border-t-2 border-[var(--primary)] bg-rose-50 text-base font-black"><td className="p-3">RESULTADO OPERATIVO ESTIMADO</td><td className="p-3 text-right text-[var(--primary)]">{amount(result.operatingResult)}</td></tr>
        </tbody></table></div>
        <p className="p-4 text-xs text-slate-500">Solo aparecen categorías con movimientos en este período. El costo de producción vendido ya está incluido en el costo histórico de las ventas.</p>
      </section>}
      {data.expenses.length === 0 && <EmptyBlock title="Sin egresos en el período" description="Los demás bloques se calculan con las ventas, costos, cambios, devoluciones y movimientos registrados." />}
    </div>
    <Modal isOpen={Boolean(selectedDetail)} onClose={() => setSelectedDetail(null)} title={selectedDetail?.label || 'Detalle'} subtitle="Registros incluidos en esta cifra">
      {!selectedDetail?.rows.length ? <EmptyBlock title="Sin movimientos en este período" /> : <div className="grid max-h-[65vh] gap-2 overflow-y-auto">{selectedDetail.rows.map((row, index) => <article key={index} className="rounded-xl border border-slate-200 p-3">{Object.entries(row).map(([label, value]) => <p key={label} className="flex justify-between gap-3 text-xs"><span className="text-slate-500">{label}</span><strong className="text-right">{typeof value === 'number' && label === 'monto' ? formatBs(value) : String(value)}</strong></p>)}</article>)}</div>}
      {selectedDetail?.explanation && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">{selectedDetail.explanation}</p>}
    </Modal>
  </Screen>
}
