import { useEffect, useMemo, useState } from 'react'
import { Download, FileSpreadsheet, FileText, Printer } from 'lucide-react'
import { Field } from '../../../components/ui/Form'
import { EmptyBlock } from '../../../components/ui/Screen'
import { printHtmlDocument } from '../../../services/printing/documentPrintService'
import { exportExcel, exportPdf, type ReportSheet } from '../data/reportExports'
import { loadAllExpenseReportRows, loadAllSupplierPayables, loadAllSupplierPayments } from '../data/distributionRepository'
import { expenseCashPaidAmount, expenseMatchesPaymentFilter, expenseOtherPaidAmount, expenseTransferPaidAmount } from '../domain/expenseAccounting'
import { round2 } from '../domain/engine'
import { boliviaDayKey } from '../domain/inventoryIntakeValidation'
import { describeRange } from './RangePicker'
import { formatBs, KpiCard, SecondaryButton } from './shared'
import type { DistExpense, DistPayable, DistSupplierPayment } from '../types'
import type { DistributionViewProps } from './DistributionApp'

type RangeMode = 'today' | 'yesterday' | 'week' | 'month' | 'last_month' | 'custom' | 'all'
type PaymentMode = 'all' | 'cash' | 'transfer' | 'other' | 'credit' | 'mixed'

function dayOffset(offset: number) { const date = new Date(`${boliviaDayKey()}T12:00:00.000Z`); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0,10) }
function getRange(mode: RangeMode, from: string, to: string): [string | undefined, string | undefined] {
  const today = dayOffset(0)
  if (mode === 'all') return [undefined, undefined]
  if (mode === 'today') return [today, today]
  if (mode === 'yesterday') return [dayOffset(-1), dayOffset(-1)]
  if (mode === 'custom') return [from || today, to || from || today]
  const [year, month, day] = today.split('-').map(Number)
  const localToday = new Date(Date.UTC(year, month - 1, day, 12))
  if (mode === 'week') { const start = new Date(localToday); start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7)); return [start.toISOString().slice(0,10), today] }
  if (mode === 'month') return [new Date(Date.UTC(year, month - 1, 1, 12)).toISOString().slice(0,10), today]
  return [new Date(Date.UTC(year, month - 2, 1, 12)).toISOString().slice(0,10), new Date(Date.UTC(year, month - 1, 0, 12)).toISOString().slice(0,10)]
}
const moneyMethod = (value?: string) => value === 'cash' ? 'Efectivo' : value === 'transfer' ? 'QR / transferencia' : value === 'credit' ? 'Crédito' : value === 'mixed' ? 'Mixto' : 'Otro'

export function ExpenseReportsView(props: DistributionViewProps) {
  void props
  const [rangeMode, setRangeMode] = useState<RangeMode>('today')
  const [from, setFrom] = useState(dayOffset(0))
  const [to, setTo] = useState(dayOffset(0))
  const [group, setGroup] = useState('all')
  const [category, setCategory] = useState('all')
  const [payment, setPayment] = useState<PaymentMode>('all')
  const [state, setState] = useState<'all' | 'pending' | 'partial' | 'paid' | 'voided'>('all')
  const [origin, setOrigin] = useState('all')
  const [responsible, setResponsible] = useState('all')
  const [expenses, setExpenses] = useState<DistExpense[]>([])
  const [payables, setPayables] = useState<DistPayable[]>([])
  const [payments, setPayments] = useState<DistSupplierPayment[]>([])
  const [loadedQuery, setLoadedQuery] = useState<{ key: string; error: string }>({ key: '', error: '' })
  const [feedback, setFeedback] = useState('')
  const [reload, setReload] = useState(0)
  const [start, end] = getRange(rangeMode, from, to)
  const queryKey = `${start || ''}:${end || ''}:${reload}`
  const loading = loadedQuery.key !== queryKey
  const error = loadedQuery.key === queryKey ? loadedQuery.error : ''
  useEffect(() => {
    let active = true
    Promise.all([loadAllExpenseReportRows(start, end), loadAllSupplierPayables(), loadAllSupplierPayments(start, end)])
      .then(([expenseRows, payableRows, paymentRows]) => { if (active) { setExpenses(expenseRows); setPayables(payableRows); setPayments(paymentRows); setLoadedQuery({ key: queryKey, error: '' }) } })
      .catch(reason => { if (active) setLoadedQuery({ key: queryKey, error: (reason as Error).message || 'No se pudo completar la consulta histórica.' }) })
    return () => { active = false }
  }, [start, end, reload, queryKey])

  const visibleExpenses = useMemo(() => expenses.filter(row => {
    if (row.voided || row.pendingConfirmation || row.transactionKind === 'supplier_payment' || state === 'voided') return false
    if (state !== 'all') {
      if (row.transactionKind === 'supplier_purchase') {
        const payable = payables.find(item => item.purchaseExpenseId === row.id)
        if (payable?.status !== state) return false
      } else if (state !== 'paid') return false
    }
    if (group !== 'all' && (row.group || 'other') !== group) return false
    if (category !== 'all' && row.categoryId !== category) return false
    if (!expenseMatchesPaymentFilter(row, payment)) return false
    if (origin !== 'all' && row.routeId !== origin) return false
    if (responsible !== 'all' && row.registeredByUid !== responsible) return false
    return true
  }), [expenses, payables, group, category, payment, origin, responsible, state])
  const payableScope = useMemo(() => payables.filter(row => {
    if (state !== 'all' && row.status !== state) return false
    if (group !== 'all' && row.groupId !== group) return false
    if (category !== 'all' && row.categoryId !== category) return false
    if (origin !== 'all' && row.routeId !== origin) return false
    if (responsible !== 'all' && row.createdBy !== responsible) return false
    return true
  }), [payables, state, group, category, origin, responsible])
  const visiblePayables = useMemo(() => payableScope.filter(row => (!start || row.dayKey >= start) && (!end || row.dayKey <= end)), [payableScope, start, end])
  const visiblePayments = useMemo(() => payments.filter(row => {
    if (row.id.endsWith('__initial')) return false
    if (state === 'voided' && !row.voided) return false
    if (state !== 'all' && state !== 'voided' && row.voided) return false
    if (start && row.dayKey < start) return false
    if (end && row.dayKey > end) return false
    if (payment !== 'all' && row.paymentMethod !== payment) return false
    if (origin !== 'all' && row.routeId !== origin) return false
    if (responsible !== 'all' && row.responsibleUid !== responsible) return false
    return payables.some(payable => payable.id === row.payableId
      && (state === 'all' || state === 'voided' || payable.status === state)
      && (group === 'all' || payable.groupId === group)
      && (category === 'all' || payable.categoryId === category))
  }), [payments, payment, origin, responsible, payables, start, end, state, group, category])
  const totals = useMemo(() => {
    const groups = new Map<string, { label: string; amount: number; cash: number; transfer: number; other: number; paid: number; pending: number; count: number }>()
    const categories = new Map<string, { group: string; label: string; amount: number; cash: number; transfer: number; other: number; paid: number; pending: number; count: number }>()
    for (const row of visibleExpenses) {
      const groupId = row.group || 'other', groupLabel = row.groupName || groupId
      const g = groups.get(groupId) || { label: groupLabel, amount: 0, cash: 0, transfer: 0, other: 0, paid: 0, pending: 0, count: 0 }
      g.amount = round2(g.amount + row.amount); g.cash = round2(g.cash + expenseCashPaidAmount(row)); g.transfer = round2(g.transfer + expenseTransferPaidAmount(row)); g.other = round2(g.other + expenseOtherPaidAmount(row)); g.count++; groups.set(groupId, g)
      const key = `${groupId}:${row.categoryId || 'unclassified'}`
      const c = categories.get(key) || { group: groupLabel, label: row.categoryName || 'Por clasificar', amount: 0, cash: 0, transfer: 0, other: 0, paid: 0, pending: 0, count: 0 }
      c.amount = round2(c.amount + row.amount); c.cash = round2(c.cash + expenseCashPaidAmount(row)); c.transfer = round2(c.transfer + expenseTransferPaidAmount(row)); c.other = round2(c.other + expenseOtherPaidAmount(row)); c.count++; categories.set(key, c)
    }
    for (const row of visiblePayables) {
      const groupId = row.groupId, key = `${groupId}:${row.categoryId || 'unclassified'}`
      const group = groups.get(groupId) || { label: row.groupName, amount: 0, cash: 0, transfer: 0, other: 0, paid: 0, pending: 0, count: 0 }
      group.paid = round2(group.paid + row.paidAmount); group.pending = round2(group.pending + row.balance); groups.set(groupId, group)
      const category = categories.get(key) || { group: row.groupName, label: row.categoryName, amount: 0, cash: 0, transfer: 0, other: 0, paid: 0, pending: 0, count: 0 }
      category.paid = round2(category.paid + row.paidAmount); category.pending = round2(category.pending + row.balance); categories.set(key, category)
    }
    const purchaseTotal = round2(visibleExpenses.filter(row => row.transactionKind === 'supplier_purchase').reduce((sum, row) => sum + row.amount, 0))
    const operatingTotal = round2(visibleExpenses.filter(row => row.transactionKind !== 'supplier_purchase' && row.economicType !== 'production_input').reduce((sum, row) => sum + row.amount, 0))
    const activePayments = visiblePayments.filter(row => !row.voided)
    const paidCash = round2(visibleExpenses.reduce((sum, row) => sum + expenseCashPaidAmount(row), 0) + activePayments.filter(row => row.paymentMethod === 'cash').reduce((sum, row) => sum + row.amount, 0))
    const paidTransfer = round2(visibleExpenses.reduce((sum, row) => sum + expenseTransferPaidAmount(row), 0) + activePayments.filter(row => row.paymentMethod === 'transfer').reduce((sum, row) => sum + row.amount, 0))
    const paidOther = round2(visibleExpenses.reduce((sum, row) => sum + expenseOtherPaidAmount(row), 0) + activePayments.filter(row => row.paymentMethod === 'other').reduce((sum, row) => sum + row.amount, 0))
    const paidOut = round2(paidCash + paidTransfer + paidOther)
    const pending = round2(visiblePayables.reduce((sum, row) => sum + row.balance, 0))
    const payablePaid = round2(visiblePayables.reduce((sum, row) => sum + row.paidAmount, 0))
    return { groups, categories, purchaseTotal, operatingTotal, paidOut, paidCash, paidTransfer, paidOther, payablePaid, pending }
  }, [visibleExpenses, visiblePayables, visiblePayments])
  const period = rangeMode === 'all' ? 'Todo el historial' : describeRange(start && end ? [start, end] : [])
  const sheets = (): ReportSheet[] => [
    { name: 'Resumen', headers: ['Concepto', 'Monto (Bs)'], rows: [['EMBUTIDOS SAN JOSÉ · REPORTE DE EGRESOS', period], ['Fecha de generación', new Date().toLocaleString('es-BO')], ['Compras / gastos registrados', round2(visibleExpenses.reduce((sum, row) => sum + row.amount, 0))], ['Compras de producción', totals.purchaseTotal], ['Gastos operativos', totals.operatingTotal], ['Salida en efectivo', totals.paidCash], ['Salida QR / transferencia', totals.paidTransfer], ['Otros pagos realizados', totals.paidOther], ['Total salida real de dinero', totals.paidOut], ['Pagado en cuentas por pagar incluidas', totals.payablePaid], ['Saldo de cuentas por pagar filtradas', totals.pending]] },
    { name: 'Grupos', headers: ['Grupo', 'Operaciones', 'Monto registrado (Bs)', 'Efectivo pagado (Bs)', 'QR / transferencia (Bs)', 'Otros pagos (Bs)', 'Pagado en estas cuentas (Bs)', 'Saldo actual por pagar (Bs)'], rows: [...[...totals.groups.entries()].map(([, row]) => [row.label, row.count, row.amount, row.cash, row.transfer, row.other, row.paid, row.pending] as (string|number|null)[]), ['TOTAL', visibleExpenses.length, round2(visibleExpenses.reduce((sum, row) => sum + row.amount, 0)), round2(visibleExpenses.reduce((sum, row) => sum + expenseCashPaidAmount(row), 0)), round2(visibleExpenses.reduce((sum, row) => sum + expenseTransferPaidAmount(row), 0)), round2(visibleExpenses.reduce((sum, row) => sum + expenseOtherPaidAmount(row), 0)), totals.payablePaid, totals.pending]] },
    { name: 'Categorías', headers: ['Grupo', 'Categoría', 'Operaciones', 'Monto (Bs)', 'Efectivo (Bs)', 'QR / transferencia (Bs)', 'Otros (Bs)', 'Pagado en estas cuentas (Bs)', 'Saldo actual por pagar (Bs)'], rows: [...[...totals.categories.values()].map(row => [row.group,row.label,row.count,row.amount,row.cash,row.transfer,row.other,row.paid,row.pending] as (string|number|null)[])] },
    { name: 'Detalle de egresos', headers: ['Fecha', 'Grupo', 'Categoría', 'Descripción', 'Importe (Bs)', 'Pago registrado', 'Efectivo pagado (Bs)', 'QR / transferencia pagado (Bs)', 'Otro pagado (Bs)', 'Origen', 'Responsable', 'Proveedor'], rows: visibleExpenses.map(row => [row.dayKey, row.groupName || row.group || 'Histórico', row.categoryName || 'Histórico', row.concept, row.amount, moneyMethod(row.paymentMethod), expenseCashPaidAmount(row), expenseTransferPaidAmount(row), expenseOtherPaidAmount(row), row.routeName, row.registeredByName, row.supplierName || '']) },
    { name: 'Cuentas por pagar', headers: ['Fecha compra', 'Proveedor', 'Descripción', 'Grupo', 'Categoría', 'Total (Bs)', 'Pagado (Bs)', 'Saldo (Bs)', 'Estado', 'Vence'], rows: visiblePayables.map(row => [row.dayKey,row.supplierName,row.description,row.groupName,row.categoryName,row.totalAmount,row.paidAmount,row.balance,row.status,row.dueDayKey || '']) },
    { name: 'Pagos a proveedores', headers: ['Fecha pago', 'Proveedor', 'Importe (Bs)', 'Método', 'Estado', 'Motivo de corrección', 'Responsable', 'Referencia'], rows: visiblePayments.map(row => [row.dayKey,row.supplierName,row.amount,moneyMethod(row.paymentMethod),row.voided?'Anulado':'Vigente',row.voidReason || '',row.responsibleName,row.payableId]) },
  ]
  const runExport = async (kind: 'pdf' | 'excel') => { try { const data = sheets(); if (kind === 'pdf') await exportPdf(data, `Egresos · ${period}`, 'SanJose-egresos.pdf'); else await exportExcel(data, `Egresos · ${period}`, 'SanJose-egresos.xlsx'); setFeedback(kind === 'pdf' ? 'PDF preparado con los filtros actuales.' : 'Excel preparado con los filtros actuales.') } catch (failure) { setFeedback((failure as Error).message || 'No se pudo preparar el reporte.') } }
  const print = async () => {
    try {
      const htmlValue = (value: string | number | null | undefined) => String(value ?? '—').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
      const printSheets = sheets().map(sheet => `<section><h2>${htmlValue(sheet.name)}</h2><table><thead><tr>${sheet.headers.map(value => `<th>${htmlValue(value)}</th>`).join('')}</tr></thead><tbody>${sheet.rows.map(row => `<tr>${row.map(value => `<td>${htmlValue(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`).join('')
      await printHtmlDocument(`<html><meta charset="utf-8"><title>Reporte de egresos</title><style>body{font:12px Arial;margin:24px;color:#182230}h1{color:#b42332}h2{margin:18px 0 8px;break-after:avoid}section{break-inside:auto}table{border-collapse:collapse;width:100%;margin-bottom:20px}thead{display:table-header-group}tr{break-inside:avoid}th,td{padding:6px;border:1px solid #ddd;text-align:left;vertical-align:top}th{background:#f3f4f6}td:last-child{text-align:right}@media print{body{margin:12mm}}</style><h1>EMBUTIDOS SAN JOSÉ</h1><p>Reporte de egresos · Período: ${htmlValue(period)}</p>${printSheets}</html>`, 'Reporte de egresos')
      setFeedback('Reporte listo para imprimir.')
    } catch (failure) { setFeedback((failure as Error).message || 'No se pudo imprimir.') }
  }
  const groupPairs: Array<[string, string]> = [...expenses.map(row => [row.group || 'other', row.groupName || row.group || 'Otros'] as [string,string]), ...payables.map(row => [row.groupId, row.groupName] as [string,string])]
  const groups = [...new Map(groupPairs).entries()]
  const categoryPairs: Array<[string, string]> = expenses.filter(row => group === 'all' || row.group === group).map(row => [row.categoryId || '', row.categoryName || 'Por clasificar'] as [string,string])
  const filteredCategories = [...new Map(categoryPairs).entries()].filter(([id]) => id)
  const responsiblePairs: Array<[string, string]> = [...expenses.map(row => [row.registeredByUid, row.registeredByName] as [string,string]), ...payments.map(row => [row.responsibleUid, row.responsibleName] as [string,string])]
  const filteredResponsibles = [...new Map(responsiblePairs).entries()]
  const originPairs: Array<[string, string]> = [...expenses.map(row => [row.routeId, row.routeName] as [string,string]), ...payables.map(row => [row.routeId, row.routeName] as [string,string])]
  const origins = [...new Map(originPairs).entries()]

  return <section className="grid min-w-0 gap-4">
    <div><h2 className="text-lg font-black">Reportes de egresos</h2><p className="text-xs text-slate-600">Consulta histórica paginada desde Firestore. No se presenta como completa hasta terminar la carga.</p></div>
    <div className="grid min-w-0 gap-3 rounded-2xl border border-slate-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Período"><select value={rangeMode} onChange={event => setRangeMode(event.target.value as RangeMode)} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3"><option value="today">Hoy</option><option value="yesterday">Ayer</option><option value="week">Semana actual</option><option value="month">Mes actual</option><option value="last_month">Mes anterior</option><option value="custom">Fechas</option><option value="all">Todo el historial</option></select></Field>
      {rangeMode === 'custom' && <><Field label="Desde"><input type="date" value={from} onChange={event => setFrom(event.target.value)} className="h-11 w-full rounded-xl border-2 border-slate-200 px-3"/></Field><Field label="Hasta"><input type="date" min={from} value={to} onChange={event => setTo(event.target.value)} className="h-11 w-full rounded-xl border-2 border-slate-200 px-3"/></Field></>}
      <Field label="Grupo"><select value={group} onChange={event => { setGroup(event.target.value); setCategory('all') }} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3"><option value="all">Todos</option>{groups.map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select></Field>
      <Field label="Categoría"><select value={category} onChange={event => setCategory(event.target.value)} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3"><option value="all">Todas</option>{filteredCategories.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></Field>
      <Field label="Forma de pago"><select value={payment} onChange={event => setPayment(event.target.value as PaymentMode)} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3"><option value="all">Todas</option><option value="cash">Efectivo</option><option value="transfer">QR / transferencia</option><option value="credit">Crédito</option><option value="mixed">Mixto</option><option value="other">Otro</option></select></Field>
      <Field label="Estado de pago"><select value={state} onChange={event => setState(event.target.value as typeof state)} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3"><option value="all">Todos</option><option value="pending">Pendiente</option><option value="partial">Parcial</option><option value="paid">Pagado</option><option value="voided">Anulado</option></select></Field>
      <Field label="Origen"><select value={origin} onChange={event => setOrigin(event.target.value)} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3"><option value="all">Todos</option>{origins.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></Field>
      <Field label="Responsable"><select value={responsible} onChange={event => setResponsible(event.target.value)} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3"><option value="all">Todos</option>{filteredResponsibles.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></Field>
    </div>
    <div className="flex flex-wrap gap-2"><SecondaryButton disabled={loading || Boolean(error)} onClick={() => void runExport('pdf')}><FileText size={15}/> Descargar PDF</SecondaryButton><SecondaryButton disabled={loading || Boolean(error)} onClick={() => void runExport('excel')}><FileSpreadsheet size={15}/> Descargar Excel</SecondaryButton><SecondaryButton disabled={loading || Boolean(error)} onClick={() => void print()}><Printer size={15}/> Imprimir</SecondaryButton><SecondaryButton onClick={() => setReload(value => value + 1)}><Download size={15}/> Actualizar</SecondaryButton></div>
    {loading && <p role="status" className="rounded-xl bg-slate-50 p-3 text-sm">Cargando páginas históricas…</p>}{error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-800">{error}</p>}{feedback && <p role="status" className="text-xs font-bold text-emerald-800">{feedback}</p>}
    {!loading && !error && <><p className="text-xs text-slate-600">Período consultado: {period}. Compras/gastos y pagos a proveedores se muestran por separado; el pago de una deuda anterior es salida de dinero, no una compra nueva. En las cuentas de este período se muestra lo pagado acumulado y el saldo actual.</p><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"><KpiCard label="Compras y gastos registrados" value={formatBs(visibleExpenses.reduce((sum,row)=>sum+row.amount,0))}/><KpiCard label="Compras de producción" value={formatBs(totals.purchaseTotal)}/><KpiCard label="Salida efectivo" value={formatBs(totals.paidCash)}/><KpiCard label="Salida QR / transferencia" value={formatBs(totals.paidTransfer)}/><KpiCard label="Pagado en cuentas" value={formatBs(totals.payablePaid)}/><KpiCard label="Saldo por pagar" value={formatBs(totals.pending)}/></div>{visibleExpenses.length === 0 ? <EmptyBlock title="Sin egresos para estos filtros"/> : <div className="grid gap-3">{[...totals.groups.entries()].map(([id,row])=><details key={id} className="rounded-2xl border border-slate-200 bg-white"><summary className="cursor-pointer px-4 py-3 font-bold">{row.label} · {row.count} operaciones · {formatBs(row.amount)} registrado · efectivo {formatBs(row.cash)} · QR/transferencia {formatBs(row.transfer)} · otros {formatBs(row.other)} · pagado en cuentas {formatBs(row.paid)} · pendiente actual {formatBs(row.pending)}</summary><div className="grid gap-2 border-t border-slate-100 p-3">{[...totals.categories.entries()].filter(([key])=>key.startsWith(`${id}:`)).map(([key,cat])=><details key={key} className="rounded-xl bg-slate-50 p-3"><summary className="cursor-pointer text-sm font-bold">{cat.label} · {cat.count} operaciones · registrado {formatBs(cat.amount)} · pagado en cuentas {formatBs(cat.paid)} · pendiente actual {formatBs(cat.pending)}</summary><div className="mt-2 grid gap-2">{visibleExpenses.filter(row=>(row.group||'other')===id&&(row.categoryId||'unclassified')===key.split(':').slice(1).join(':')).map(row=><article key={row.id} className="grid gap-1 rounded-lg bg-white p-3 text-xs sm:grid-cols-[1fr_auto]"><div><strong>{row.dayKey} · {row.concept}</strong><p>{row.routeName} · {row.registeredByName} · {moneyMethod(row.paymentMethod)}</p>{row.transactionKind==='supplier_purchase'&&<p>Proveedor: {row.supplierName} · el detalle de su deuda aparece en Cuentas por pagar.</p>}</div><strong>{formatBs(row.amount)}</strong></article>)}</div></details>)}</div></details>)}</div>}{visiblePayables.length>0&&<section><h3 className="mb-2 font-black">Cuentas por pagar en el período de compra</h3><div className="grid gap-2">{visiblePayables.map(row=><article key={row.id} className="grid gap-1 rounded-xl border border-slate-200 bg-white p-3 text-sm sm:grid-cols-[1fr_auto]"><div><strong>{row.supplierName} · {row.description}</strong><p>{row.dayKey} · {row.groupName} / {row.categoryName} · {row.status} · pagado {formatBs(row.paidAmount)}</p></div><strong>{formatBs(row.balance)} pendiente de {formatBs(row.totalAmount)}</strong></article>)}</div></section>}{visiblePayments.length>0&&<section><h3 className="mb-2 font-black">Pagos a proveedores en el período</h3><div className="grid gap-2">{visiblePayments.map(row=><article key={row.id} className="flex justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm"><span>{row.dayKey} · {row.supplierName} · {moneyMethod(row.paymentMethod)} · {row.responsibleName}{row.voided?` · ANULADO: ${row.voidReason || 'sin motivo'}`:''}</span><strong>{formatBs(row.amount)}</strong></article>)}</div></section>}</>}
  </section>
}
