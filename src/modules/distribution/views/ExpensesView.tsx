import { useMemo, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Modal } from '../../../components/ui/Modal'
import { Field, NumberInput, Segmented, TextArea, TextInput } from '../../../components/ui/Form'
import { ChoiceButton, ChoiceModal } from '../../../components/ui/ChoiceModal'
import { EmptyBlock, Screen } from '../../../components/ui/Screen'
import { matchesRoute, toDayKey } from '../domain/engine'
import { classifyExpense, deleteExpense, newOperationId, registerExpense, saveExpenseCategory } from '../data/distributionRepository'
import { DEFAULT_EXPENSE_CATEGORIES, EXPENSE_GROUPS, expenseGroupLabel, mergeExpenseCategories } from '../domain/expenseCategories'
import { effectiveExpenseEconomicType, filterExpensesByStatus, isExpenseReviewPending, summarizeActiveExpenses } from '../domain/expenseReview'
import { isProductionPreviewReadOnly } from '../../../lib/firebase'
import { RangePicker } from './RangePicker'
import { KpiCard, PrimaryButton, SecondaryButton, formatBs } from './shared'
import type { DistExpense, ExpenseEconomicType, ExpenseGroup } from '../types'
import type { DistributionViewProps } from './DistributionApp'

export function ExpensesView({ session, data }: DistributionViewProps) {
  const [formOpen, setFormOpen] = useState(false)
  const [concept, setConcept] = useState('')
  const [group, setGroup] = useState<ExpenseGroup>('indirect')
  const [economicType, setEconomicType] = useState<ExpenseEconomicType>('operating_expense')
  const [categoryId, setCategoryId] = useState('indirect-1')
  const [amount, setAmount] = useState('')
  const [routeId, setRouteId] = useState(session.routeId ?? '')
  const [dayKey, setDayKey] = useState(toDayKey(new Date()))
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'transfer' | 'other'>('cash')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [routeModal, setRouteModal] = useState(false)
  const [filterRoute, setFilterRoute] = useState('all')
  const [filterGroup, setFilterGroup] = useState('all')
  const [filterCategory, setFilterCategory] = useState('all')
  const [filterPayment, setFilterPayment] = useState('all')
  const [filterResponsible, setFilterResponsible] = useState('all')
  const [filterState, setFilterState] = useState<'active' | 'voided' | 'all'>('active')
  const [pendingOnly, setPendingOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [voidTarget, setVoidTarget] = useState<DistExpense | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [classifyTarget, setClassifyTarget] = useState<DistExpense | null>(null)
  const [classifyGroup, setClassifyGroup] = useState<ExpenseGroup>('other')
  const [classifyCategory, setClassifyCategory] = useState('')
  const [classifyEconomicType, setClassifyEconomicType] = useState<ExpenseEconomicType | ''>('')
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [categoryGroup, setCategoryGroup] = useState<ExpenseGroup>('administration')
  const [categoryDraft, setCategoryDraft] = useState('')
  const [editingCategoryId, setEditingCategoryId] = useState('')
  const [feedback, setFeedback] = useState('')
  const readOnlyPreview = isProductionPreviewReadOnly()
  const categories = useMemo(() => mergeExpenseCategories(data.expenseCategories.length ? data.expenseCategories : DEFAULT_EXPENSE_CATEGORIES), [data.expenseCategories])
  const activeRoutes = data.routes.filter((route) => route.active !== false)
  const formGroup = economicType === 'production_input' ? 'production_input' : group === 'production_input' ? 'indirect' : group
  const activeCategories = categories.filter((item) => item.group === formGroup && item.active)
  const matchingExpenses = useMemo(() => data.expenses.filter((expense) => {
    const routeMatch = filterRoute === 'all' || matchesRoute(expense.routeId, filterRoute)
    const groupMatch = filterGroup === 'all' || (expense.group || 'other') === filterGroup
    const categoryMatch = filterCategory === 'all' || (filterCategory === 'unclassified' ? !expense.group || !expense.categoryId : expense.categoryId === filterCategory)
    const paymentMatch = filterPayment === 'all' || (expense.paymentMethod || 'cash') === filterPayment
    const personMatch = filterResponsible === 'all' || expense.registeredByUid === filterResponsible
    const queryMatch = !search || `${expense.concept} ${expense.note || ''} ${expense.categoryName || ''}`.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es'))
    const pendingMatch = !pendingOnly || isExpenseReviewPending(expense)
    return routeMatch && groupMatch && categoryMatch && paymentMatch && personMatch && queryMatch && pendingMatch
  }), [data.expenses, filterRoute, filterGroup, filterCategory, filterPayment, filterResponsible, search, pendingOnly])
  const activeFiltered = useMemo(() => filterExpensesByStatus(matchingExpenses, 'active'), [matchingExpenses])
  const filtered = useMemo(() => filterExpensesByStatus(matchingExpenses, filterState), [matchingExpenses, filterState])
  const activeSummary = useMemo(() => summarizeActiveExpenses(activeFiltered), [activeFiltered])
  const total = activeSummary.total
  const pendingCount = data.expenses.filter(isExpenseReviewPending).length
  const routeName = (id: string) => id === 'administracion' || id === 'admin' ? 'Administración' : id === 'route-impulsacion' || id === 'route-directa' ? 'Impulsación' : data.routes.find((route) => route.id === id)?.name || id
  const selectedOrigin = routeName(routeId)

  const resetForm = () => { setConcept(''); setGroup('indirect'); setEconomicType('operating_expense'); setCategoryId('indirect-1'); setAmount(''); setRouteId(session.routeId ?? ''); setDayKey(toDayKey(new Date())); setPaymentMethod('cash'); setNote(''); setError('') }
  const submit = async () => {
    const origin = session.routeId ?? routeId
    const selectedGroup = economicType === 'production_input' ? 'production_input' : group
    if (!concept.trim() || !Number.isFinite(Number(amount)) || Number(amount) <= 0 || !dayKey || !categoryId || !origin) { setError('Completa tipo de salida, categoría, concepto, monto, fecha y origen.'); return }
    setBusy(true); setError('')
    try {
      await registerExpense({ operationId: newOperationId('expense'), concept: concept.trim(), amount: Number(amount), group: selectedGroup, categoryId, categoryName: categories.find((item) => item.id === categoryId)?.name || 'Por clasificar', paymentMethod, economicType, dayKey, routeId: origin, routeName: routeName(origin), registeredByUid: session.uid, registeredByName: session.userName, note: note.trim() })
      setFeedback('Egreso registrado correctamente.'); setFormOpen(false); resetForm()
    } catch (failure) { setError((failure as Error).message || 'No se pudo registrar el egreso.') }
    finally { setBusy(false) }
  }
  const persistCategory = (id: string, targetGroup: ExpenseGroup, name: string, active: boolean, order: number) => saveExpenseCategory({ categoryId: id, group: targetGroup, name, active, order })
  const classify = async () => {
    if (!classifyTarget || !classifyCategory) return
    setBusy(true); setError('')
    if (!classifyEconomicType) { setError('Selecciona el tipo de salida.'); return }
    const selectedGroup = classifyEconomicType === 'production_input' ? 'production_input' : classifyGroup === 'production_input' ? 'other' : classifyGroup
    try { await classifyExpense({ expenseId: classifyTarget.id, group: selectedGroup, categoryId: classifyCategory, economicType: classifyEconomicType }); setFeedback('La clasificación y revisión se guardaron con su historial.'); setClassifyTarget(null) }
    catch (failure) { setError((failure as Error).message) }
    finally { setBusy(false) }
  }

  return <Screen title="Egresos" subtitle={session.role === 'admin' ? 'Salidas de dinero por grupo, origen y forma de pago' : 'Egresos registrados para tu ruta'}>
    <div className="mb-3 flex min-w-0 flex-wrap justify-end gap-2">{session.role === 'admin' && <SecondaryButton disabled={readOnlyPreview} onClick={() => setCategoriesOpen(true)}><Pencil size={15}/> Categorías</SecondaryButton>}{session.can('dist.expense.create') && <PrimaryButton disabled={readOnlyPreview} onClick={() => { resetForm(); setFormOpen(true) }}><Plus size={16}/> Nuevo egreso</PrimaryButton>}</div>
    {readOnlyPreview && <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-bold text-amber-900">Vista previa — los cambios están deshabilitados porque esta versión está conectada a producción.</p>}
    <RangePicker dayKeys={session.dayKeys} onChange={session.setDayKeys}/>
    {session.role === 'admin' && <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Origen"><select value={filterRoute} onChange={(event) => setFilterRoute(event.target.value)} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3"><option value="all">Todos los orígenes</option><option value="administracion">Administración</option><option value="route-impulsacion">Impulsación</option>{activeRoutes.filter((r) => !['route-directa','route-impulsacion','administracion','admin'].includes(r.id)).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
      <Field label="Grupo"><select value={filterGroup} onChange={(event) => setFilterGroup(event.target.value)} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3"><option value="all">Todos los grupos</option>{EXPENSE_GROUPS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>
      <Field label="Categoría"><select value={filterCategory} onChange={(event) => setFilterCategory(event.target.value)} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3"><option value="all">Todas las categorías</option><option value="unclassified">Por clasificar</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <Field label="Estado"><select value={filterState} onChange={(event) => setFilterState(event.target.value as typeof filterState)} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3"><option value="active">Activos</option><option value="voided">Anulados</option><option value="all">Todos</option></select></Field>
      <Field label="Forma de pago"><select value={filterPayment} onChange={(event) => setFilterPayment(event.target.value)} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3"><option value="all">Todas las formas</option><option value="cash">Efectivo</option><option value="transfer">QR / transferencia</option><option value="other">Otro</option></select></Field>
      <Field label="Responsable"><select value={filterResponsible} onChange={(event) => setFilterResponsible(event.target.value)} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3"><option value="all">Todos</option>{[...new Map(data.expenses.map((item) => [item.registeredByUid, item.registeredByName])).entries()].map(([uid, name]) => <option key={uid} value={uid}>{name}</option>)}</select></Field>
      <Field label="Buscar"><TextInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Concepto u observación"/></Field>
    </div>}
    {session.role === 'admin' && pendingCount > 0 && <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><span>{pendingCount} egreso{pendingCount === 1 ? '' : 's'} pendiente{pendingCount === 1 ? '' : 's'} de revisar o clasificar.</span><button type="button" onClick={() => { setPendingOnly((current) => !current); setFilterState('active'); setFilterGroup('all'); setFilterCategory('all'); setFilterRoute('all'); setFilterPayment('all'); setFilterResponsible('all'); setSearch('') }} className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-amber-900">{pendingOnly ? 'Mostrar todos' : 'Revisar pendientes'}</button></div>}
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"><KpiCard label="Total salidas de dinero" value={formatBs(total)}/><KpiCard label="Egresos operativos" value={formatBs(activeSummary.operatingTotal)}/><KpiCard label="Compras de materia prima" value={formatBs(activeSummary.productionInputTotal)}/>{EXPENSE_GROUPS.filter((item) => item.id !== 'production_input').map((item) => <KpiCard key={item.id} label={item.label.replace('Gastos de ', '')} value={formatBs(activeSummary.groups[item.id])}/>)}</div>
    {feedback && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-xs font-bold text-emerald-800">{feedback}</p>}
    {filtered.length === 0 ? <EmptyBlock title={filterState === 'voided' ? 'Sin egresos anulados' : 'Sin egresos registrados'}/> : <div className="grid gap-2">{filtered.map((expense) => { const isProductionInput = effectiveExpenseEconomicType(expense) === 'production_input'; return <article key={expense.id} className="flex min-w-0 items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-3"><div className="min-w-0"><p className="break-words text-sm font-extrabold">{expense.concept} {isProductionInput && <span className="ml-1 rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-800">MATERIA PRIMA</span>} {expense.voided && <span className="ml-1 rounded bg-rose-100 px-2 py-0.5 text-[10px] font-black text-rose-800">ANULADO</span>}</p><p className="text-[11px] font-semibold text-slate-600">{isProductionInput ? 'Materia prima / producción' : expenseGroupLabel(expense.group)} · {expense.categoryName || 'Por clasificar'} · {expense.paymentMethod === 'transfer' ? 'QR / transferencia' : expense.paymentMethod === 'other' ? 'Otro pago' : 'Efectivo'}</p><p className="break-words text-[11px] text-slate-500">{expense.dayKey || toDayKey(expense.createdAt)} · {expense.routeName} · {expense.registeredByName}</p>{isProductionInput && <p className="mt-1 text-[11px] text-slate-500">Pendiente de vincular a producción</p>}{expense.note && <p className="mt-1 text-xs italic text-slate-500">{expense.note}</p>}</div><div className="flex shrink-0 items-center gap-1"><strong className={`text-sm ${expense.voided ? 'text-slate-500 line-through' : 'text-slate-800'}`}>{formatBs(expense.amount)}</strong>{session.role === 'admin' && !expense.voided && <button type="button" disabled={readOnlyPreview} aria-label={`Revisar ${expense.concept}`} onClick={() => { const economic = expense.economicType || (expense.affectsOperatingResult === false ? 'production_input' : expense.affectsOperatingResult === true ? 'operating_expense' : ''); const nextGroup = expense.group || (economic === 'production_input' ? 'production_input' : 'other'); setClassifyTarget(expense); setClassifyEconomicType(economic); setClassifyGroup(nextGroup); setClassifyCategory(categories.find((item) => item.group === nextGroup && item.active)?.id || '') }} className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-700 disabled:opacity-50"><Pencil size={15}/></button>}{session.role === 'admin' && !expense.voided && <button type="button" disabled={readOnlyPreview} aria-label={`Anular ${expense.concept}`} onClick={() => { setVoidTarget(expense); setVoidReason(''); setError('') }} className="grid h-9 w-9 place-items-center rounded-xl bg-rose-50 text-rose-700 disabled:opacity-50"><Trash2 size={15}/></button>}</div></article>})}</div>}

    <Modal isOpen={formOpen} onClose={() => !busy && setFormOpen(false)} title="Nuevo egreso" subtitle="Registra la salida de dinero y cómo debe reflejarse en el resultado." footer={<PrimaryButton full disabled={busy || readOnlyPreview} onClick={() => void submit()}>{busy ? 'Guardando…' : 'Registrar egreso'}</PrimaryButton>}>
      <div className="grid gap-3">
        <Field label="Concepto" required><TextInput value={concept} onChange={(event) => setConcept(event.target.value)} placeholder="Ej.: Gasolina Ruta Norte"/></Field>
        <Field label="Monto (Bs)" required><NumberInput value={amount} min={0} step={0.01} onChange={(event) => setAmount(event.target.value)}/></Field>
        {session.role === 'admin' && <Field label="Tipo de salida" required><Segmented value={economicType} onChange={(value) => { const next = value as ExpenseEconomicType; setEconomicType(next); if (next === 'production_input') setCategoryId(categories.find((item) => item.group === 'production_input' && item.active)?.id || 'production_input-1'); else if (group === 'production_input') { setGroup('indirect'); setCategoryId('indirect-1') } }} options={[{value:'operating_expense',label:'Gasto operativo'},{value:'production_input',label:'Materia prima / producción'}]}/><p className="mt-1 text-xs text-slate-600">{economicType === 'production_input' ? 'Esta compra se registra como salida de dinero, pero no se descuenta nuevamente de la ganancia porque formará parte del costo de los productos.' : 'Este gasto se descontará del Resultado del negocio.'}</p></Field>}
        {economicType === 'operating_expense' && <Field label="Grupo" required><select value={group === 'production_input' ? 'indirect' : group} onChange={(event) => { const next = event.target.value as ExpenseGroup; setGroup(next); setCategoryId(categories.find((item) => item.group === next && item.active)?.id || '') }} className="h-12 w-full rounded-xl border-2 border-slate-200 bg-white px-3">{EXPENSE_GROUPS.filter((item) => item.id !== 'production_input').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>}
        <Field label="Categoría" required><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="h-12 w-full rounded-xl border-2 border-slate-200 bg-white px-3">{activeCategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        <Field label="Fecha" required><TextInput type="date" value={dayKey} onChange={(event) => setDayKey(event.target.value)}/></Field>
        {!session.routeId && <Field label="Origen" required><ChoiceButton label={selectedOrigin} placeholder="Administración, Impulsación o ruta" onClick={() => setRouteModal(true)}/></Field>}
        <Field label="Forma de pago" required><Segmented value={paymentMethod} onChange={(value) => setPaymentMethod(value as 'cash' | 'transfer' | 'other')} options={[{value:'cash',label:'Efectivo'},{value:'transfer',label:'QR / transferencia'},{value:'other',label:'Otro'}]}/></Field>
        {session.role !== 'admin' && <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">Los egresos de ruta se registran como gastos operativos. Administración puede clasificar una compra de producción.</p>}
        {group === 'production_additional' && <p className="rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-900">Utiliza este grupo solo para costos de producción que no estén incluidos en el costo configurado de los productos.</p>}
        <Field label="Observación"><TextArea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Detalle opcional"/></Field>
        {error && <p role="alert" className="text-xs font-bold text-rose-700">{error}</p>}
      </div>
    </Modal>
    <Modal isOpen={Boolean(voidTarget)} onClose={() => setVoidTarget(null)} title="Anular egreso" subtitle={voidTarget ? `${voidTarget.concept} · ${formatBs(voidTarget.amount)}` : ''} footer={<div className="grid grid-cols-2 gap-2"><SecondaryButton full onClick={() => setVoidTarget(null)}>Volver</SecondaryButton><PrimaryButton full disabled={busy || readOnlyPreview || !voidReason.trim()} onClick={async () => { if (!voidTarget) return; setBusy(true); try { await deleteExpense(voidTarget.id, voidReason.trim()); setFeedback('Egreso anulado con su motivo en auditoría.'); setVoidTarget(null) } catch (failure) { setError((failure as Error).message) } finally { setBusy(false) }}}>{busy ? 'Anulando…' : 'Confirmar anulación'}</PrimaryButton></div>}><p className="mb-2 text-sm">El registro no se borra; quedará fuera de los totales.</p><TextArea value={voidReason} onChange={(event) => setVoidReason(event.target.value)} placeholder="Motivo obligatorio"/>{error && <p role="alert" className="mt-2 text-xs text-rose-700">{error}</p>}</Modal>
    <Modal isOpen={Boolean(classifyTarget)} onClose={() => setClassifyTarget(null)} title="Revisar egreso histórico" subtitle={classifyTarget?.concept || ''} footer={<PrimaryButton full disabled={busy || readOnlyPreview || !classifyCategory || !classifyEconomicType} onClick={() => void classify()}>{busy ? 'Guardando…' : 'Guardar revisión'}</PrimaryButton>}><div className="grid gap-3"><p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">Se conservarán sin cambios el monto, fecha, origen, responsable y forma de pago. La decisión quedará en el historial.</p><Field label="Tipo de salida" required><Segmented value={classifyEconomicType} onChange={(value) => { const next = value as ExpenseEconomicType; setClassifyEconomicType(next); const nextGroup: ExpenseGroup = next === 'production_input' ? 'production_input' : classifyGroup === 'production_input' ? 'other' : classifyGroup; setClassifyGroup(nextGroup); setClassifyCategory(categories.find((item) => item.group === nextGroup && item.active)?.id || '') }} options={[{value:'operating_expense',label:'Gasto operativo'},{value:'production_input',label:'Materia prima / producción'}]}/><p className="mt-1 text-xs text-slate-600">{classifyEconomicType === 'production_input' ? 'Se conserva como salida de dinero, pero no se descuenta de nuevo de la ganancia.' : 'Se descuenta del Resultado del negocio.'}</p></Field>{classifyEconomicType === 'operating_expense' && <Field label="Grupo"><select value={classifyGroup === 'production_input' ? 'other' : classifyGroup} onChange={(event) => { const next = event.target.value as ExpenseGroup; setClassifyGroup(next); setClassifyCategory(categories.find((item) => item.group === next && item.active)?.id || '') }} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3">{EXPENSE_GROUPS.filter((item) => item.id !== 'production_input').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>}<Field label="Categoría"><select value={classifyCategory} onChange={(event) => setClassifyCategory(event.target.value)} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3">{categories.filter((item) => item.group === (classifyEconomicType === 'production_input' ? 'production_input' : classifyGroup) && item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>{classifyEconomicType === 'production_input' && <p className="rounded-xl bg-emerald-50 p-3 text-xs text-emerald-900">Pendiente de vincular a producción. Esto no impide guardar la clasificación.</p>}{error && <p role="alert" className="text-xs text-rose-700">{error}</p>}</div></Modal>
    <Modal isOpen={categoriesOpen} onClose={() => setCategoriesOpen(false)} title="Administrar categorías" subtitle="Se pueden crear, renombrar o desactivar; los egresos anteriores se conservan."><div className="grid gap-3"><Field label="Grupo"><select value={categoryGroup} onChange={(event) => setCategoryGroup(event.target.value as ExpenseGroup)} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3">{EXPENSE_GROUPS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field><Field label={editingCategoryId ? 'Nuevo nombre' : 'Nueva categoría'}><TextInput value={categoryDraft} onChange={(event) => setCategoryDraft(event.target.value)} placeholder="Nombre"/></Field><PrimaryButton disabled={busy || readOnlyPreview || !categoryDraft.trim()} onClick={async () => { setBusy(true); try { const prior = categories.find((item) => item.id === editingCategoryId); await persistCategory(editingCategoryId || `custom-${categoryGroup}-${Date.now()}`, categoryGroup, categoryDraft.trim(), prior?.active ?? true, prior?.order ?? 999); setCategoryDraft(''); setEditingCategoryId(''); setFeedback('Categoría guardada.') } catch (failure) { setError((failure as Error).message) } finally { setBusy(false) }}}>{editingCategoryId ? 'Guardar cambio' : 'Crear categoría'}</PrimaryButton><div className="grid gap-2">{categories.filter((item) => item.group === categoryGroup).map((item) => <div key={item.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 p-2 text-sm"><span className={item.active ? '' : 'text-slate-400 line-through'}>{item.name}</span><div className="flex gap-1"><button type="button" onClick={() => { setEditingCategoryId(item.id); setCategoryDraft(item.name) }} className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold">Renombrar</button><button type="button" disabled={busy || readOnlyPreview} onClick={() => void persistCategory(item.id, item.group, item.name, !item.active, item.order).then(() => setFeedback('Estado de categoría actualizado.')).catch((failure) => setError((failure as Error).message))} className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold disabled:opacity-40">{item.active ? 'Desactivar' : 'Activar'}</button></div></div>)}</div>{error && <p role="alert" className="text-xs text-rose-700">{error}</p>}</div></Modal>
    <ChoiceModal isOpen={routeModal} onClose={() => setRouteModal(false)} title="Origen del egreso" searchable options={[{value:'administracion',label:'Administración'},{value:'route-impulsacion',label:'Impulsación'},...activeRoutes.filter((route) => !['route-directa','route-impulsacion','administracion','admin'].includes(route.id)).map((route) => ({value:route.id,label:route.name}))]} selectedValue={routeId} onSelect={(value) => { setRouteId(value); setRouteModal(false) }}/>
  </Screen>
}
