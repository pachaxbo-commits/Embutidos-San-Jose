import { useEffect, useState } from 'react'
import { Field, TextInput } from '../../../components/ui/Form'
import { exportExcel, exportPdf, type ReportSheet } from '../data/reportExports'
import { loadAllExpenseReportRows } from '../data/distributionRepository'
import type { DistExpense } from '../types'
import { formatBs, SecondaryButton } from './shared'

const kg = (value: number) => Number(value.toFixed(3))
const money = (value: number) => Number(value.toFixed(2))
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' })

export function purchaseWasteRows(expenses: DistExpense[]) {
  return expenses.filter(row => row.transactionKind === 'supplier_purchase' && !row.voided && !row.pendingConfirmation)
    .flatMap(row => (row.purchaseLines || []).filter(line => line.unit === 'kg' && line.quantity > 0 &&
      /\b(carnes?|res|cerdo|pollo|vacuno|tocino)\b/i.test(`${row.categoryName || ''} ${line.description}`)).map(line => {
      const waste = line.wasteQuantity || 0
      const net = kg(line.quantity - waste)
      return {
        day: row.dayKey || row.createdAt.slice(0, 10),
        supplier: row.supplierName || 'Sin proveedor',
        route: row.routeName || 'Administración',
        worker: row.registeredByName || 'Sin responsable',
        product: line.description,
        quantity: line.quantity, waste, net, total: line.total, price: line.unitPrice,
        loss: money(waste * line.unitPrice), percent: money(100 * waste / line.quantity),
        effective: net > 0 ? money(line.total / net) : null,
        reason: line.note || '', recorded: line.wasteRecordedAt || (waste > 0 ? row.createdAt : ''),
      }
    }))
}

export function purchaseWasteTotals(rows: ReturnType<typeof purchaseWasteRows>) {
  const sum = rows.reduce((totals, row) => ({
    quantity: totals.quantity + row.quantity, waste: totals.waste + row.waste,
    net: totals.net + row.net, loss: totals.loss + row.loss, total: totals.total + row.total,
  }), { quantity: 0, waste: 0, net: 0, loss: 0, total: 0 })
  return [kg(sum.quantity), kg(sum.waste), kg(sum.net), sum.quantity ? money(100 * sum.waste / sum.quantity) : 0,
    money(sum.loss), sum.net > 0 ? money(sum.total / sum.net) : null]
}

const summaryHeaders = ['Compra (kg)', 'Merma (kg)', 'Neto (kg)', 'Merma (%)', 'Valor merma (Bs)', 'Costo por kg neto (Bs)']
const detailHeaders = ['Compra', 'Proveedor', 'Producto', 'Responsable', 'Ruta', 'Compra (kg)', 'Precio (Bs/kg)',
  'Importe (Bs)', 'Merma (kg)', 'Neto (kg)', 'Merma (%)', 'Valor merma (Bs)', 'Costo por kg neto (Bs)', 'Motivo', 'Registro (Bolivia)']

export function PurchaseWasteReport() {
  const [start, setStart] = useState(() => today().slice(0, 8) + '01')
  const [end, setEnd] = useState(today)
  const [expenses, setExpenses] = useState<DistExpense[]>([])
  const [loaded, setLoaded] = useState('')
  const [error, setError] = useState('')
  const [exportError, setExportError] = useState('')
  const [onlyWaste, setOnlyWaste] = useState(true)
  const [filters, setFilters] = useState({ supplier: '', product: '', worker: '', route: '' })
  const query = `${start}:${end}`
  const validRange = Boolean(start && end && start <= end)
  useEffect(() => {
    if (!validRange) return
    let active = true
    loadAllExpenseReportRows(start, end).then(rows => {
      if (active) { setExpenses(rows); setError(''); setLoaded(query) }
    }).catch((failure: Error) => {
      if (active) { setError(failure.message); setLoaded(query) }
    })
    return () => { active = false }
  }, [start, end, query, validRange])
  const ready = validRange && loaded === query && !error
  const allRows = ready ? purchaseWasteRows(expenses) : []
  const rows = allRows.filter(row => (!onlyWaste || row.waste > 0) &&
    Object.entries(filters).every(([key, value]) => !value || row[key as keyof typeof filters] === value))
  const totals = purchaseWasteTotals(rows)
  const bySupplier = [...new Set(rows.map(row => row.supplier))].sort().map(name =>
    [name, ...purchaseWasteTotals(rows.filter(row => row.supplier === name))])
  const values = rows.map(row => [row.day, row.supplier, row.product, row.worker, row.route, row.quantity, row.price,
    row.total, row.waste, row.net, row.percent, row.loss, row.effective, row.reason,
    row.recorded ? new Date(row.recorded).toLocaleString('es-BO', { timeZone: 'America/La_Paz' }) : ''])
  const download = async (format: 'pdf' | 'xlsx') => {
    setExportError('')
    const sheets: ReportSheet[] = [
      { name: 'Resumen', headers: summaryHeaders, rows: [totals] },
      { name: 'Por proveedor', headers: ['Proveedor', ...summaryHeaders], rows: bySupplier },
      ...format === 'pdf' ? [
        { name: 'Cantidades y costos', headers: [0, 1, 2, 5, 6, 7, 8, 9, 10, 11, 12].map(i => detailHeaders[i]),
          rows: values.map(row => [0, 1, 2, 5, 6, 7, 8, 9, 10, 11, 12].map(i => row[i])) },
        { name: 'Detalle y motivo', headers: [0, 1, 2, 3, 4, 13, 14].map(i => detailHeaders[i]),
          rows: values.map(row => [0, 1, 2, 3, 4, 13, 14].map(i => row[i])) },
      ] : [{ name: 'Detalle', headers: detailHeaders, rows: values }],
    ]
    try {
      await (format === 'pdf' ? exportPdf : exportExcel)(sheets, `Mermas de compras de carne · ${start} a ${end}`, `SanJose-mermas-compras.${format}`)
    } catch (failure) { setExportError((failure as Error).message) }
  }
  return <section className="grid gap-3">
    <h3 className="text-lg font-black">Mermas de compras de carne</h3>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Desde"><TextInput type="date" value={start} onChange={e => setStart(e.target.value)} /></Field>
      <Field label="Hasta"><TextInput type="date" value={end} onChange={e => setEnd(e.target.value)} /></Field>
      {([['supplier', 'Proveedor'], ['product', 'Producto'], ['worker', 'Responsable'], ['route', 'Ruta']] as const).map(([key, label]) =>
        <Field key={key} label={label}><select className="w-full rounded-xl border p-2" value={filters[key]} onChange={e => setFilters({ ...filters, [key]: e.target.value })}>
          <option value="">Todos</option>
          {[...new Set(allRows.map(row => row[key]))].sort().map(value => <option key={value}>{value}</option>)}
        </select></Field>)}
      <label><input type="checkbox" checked={onlyWaste} onChange={e => setOnlyWaste(e.target.checked)} /> Solo compras con merma registrada</label>
    </div>
    {!validRange && <p role="alert">Selecciona un período válido.</p>}
    {validRange && loaded !== query && <p role="status">Cargando compras…</p>}
    {loaded === query && error && <p role="alert">{error}</p>}
    {exportError && <p role="alert">{exportError}</p>}
    {ready && <>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">{summaryHeaders.map((label, index) =>
        <div key={label} className="rounded-xl bg-slate-100 p-3"><small>{label}</small><strong className="block">{totals[index] === null ? '—' : index >= 4 ? formatBs(totals[index]!) : totals[index]}</strong></div>)}</div>
      <div className="flex gap-2"><SecondaryButton disabled={!rows.length} onClick={() => void download('pdf')}>Descargar PDF</SecondaryButton><SecondaryButton disabled={!rows.length} onClick={() => void download('xlsx')}>Descargar Excel</SecondaryButton></div>
      {([['Por proveedor', ['Proveedor', ...summaryHeaders], bySupplier], ['Detalle', detailHeaders, values]] as const).map(([title, headers, body]) =>
        <section key={title} className="overflow-x-auto rounded-xl border p-3"><h4 className="font-bold">{title}</h4>
          <table className="w-full text-sm"><thead><tr>{headers.map(label => <th className="min-w-24 p-2 text-left" key={label}>{label}</th>)}</tr></thead>
            <tbody>{body.map((row, index) => <tr key={index} className="border-t">{row.map((value, i) => <td key={i} className="p-2">{value ?? '—'}</td>)}</tr>)}</tbody>
          </table>
          {!body.length && <p>Sin compras para los filtros seleccionados.</p>}
        </section>)}
    </>}
  </section>
}
