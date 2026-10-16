import { useMemo, useRef, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Modal } from '../../../components/ui/Modal'
import { Field, NumberInput, Segmented, TextArea, TextInput } from '../../../components/ui/Form'
import { ChoiceButton, ChoiceModal } from '../../../components/ui/ChoiceModal'
import { EmptyBlock, Screen } from '../../../components/ui/Screen'
import { matchesRoute, toDayKey } from '../domain/engine'
import { classifyExpense, deleteExpense, newOperationId, registerExpense, saveExpenseCategory } from '../data/distributionRepository'
import { DEFAULT_EXPENSE_CATEGORIES, EXPENSE_GROUPS, expenseGroupLabel, mergeExpenseCategories } from '../domain/expenseCategories'
import { effectiveExpenseEconomicType, filterExpensesByStatus, isExpenseReviewPending, summarizeActiveExpenses } from '../domain/expenseReview'
import { customExpensePreset, EXPENSE_PRESETS, EXPENSE_PRODUCTION_PRESETS, EXPENSE_TOP_LEVEL_CHOICES, type ExpensePreset } from '../domain/expensePresets'
import { isProductionPreviewReadOnly } from '../../../lib/firebase'
import { RangePicker } from './RangePicker'
import { KpiCard, PrimaryButton, SecondaryButton, formatBs } from './shared'
import type { DistExpense, ExpenseEconomicType, ExpenseGroup } from '../types'
import type { DistributionViewProps } from './DistributionApp'

export function ExpensesView({ session, data }: DistributionViewProps) {
  const [formOpen, setFormOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [selectedChoice, setSelectedChoice] = useState('')
  const [productionPresetId, setProductionPresetId] = useState('')
  const [choiceModal, setChoiceModal] = useState(false)
  const [productionChoiceModal, setProductionChoiceModal] = useState(false)
  const [amount, setAmount] = useState('')
  const [routeId, setRouteId] = useState(session.routeId ?? '')
  const [dayKey, setDayKey] = useState(toDayKey(new Date()))
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'transfer' | 'other'>('cash')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [operationPending, setOperationPending] = useState(false)
  const submitLock = useRef(false)
  const expenseOperationId = useRef<string | null>(null)
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
  const [categoryAutoClassifiable, setCategoryAutoClassifiable] = useState(false)
  const [categoryDistributorVisible, setCategoryDistributorVisible] = useState(false)
  const [feedback, setFeedback] = useState('')
  const readOnlyPreview = isProductionPreviewReadOnly()
  const categories = useMemo(() => mergeExpenseCategories(data.expenseCategories.length ? data.expenseCategories : DEFAULT_EXPENSE_CATEGORIES), [data.expenseCategories])
  const activeRoutes = data.routes.filter((route) => route.active !== false)
  const customPresets = useMemo(() => categories.map((item) => customExpensePreset(item, session.role === 'admin')).filter((item): item is ExpensePreset => item !== null), [categories, session.role])
  const topLevelChoices = useMemo(() => [
    ...EXPENSE_TOP_LEVEL_CHOICES,
    ...customPresets.filter((preset) => preset.group !== 'production_input').map((preset) => ({ value: preset.id, label: preset.label })),
  ], [customPresets])
  const productionChoices = useMemo(() => [
    ...EXPENSE_PRODUCTION_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
    ...customPresets.filter((preset) => preset.group === 'production_input').map((preset) => ({ value: preset.id, label: preset.label })),
  ], [customPresets])
  const selectedPreset = selectedChoice === 'production_input'
    ? [...EXPENSE_PRESETS, ...customPresets].find((preset) => preset.id === productionPresetId)
    : [...EXPENSE_PRESETS, ...customPresets].find((preset) => preset.id === selectedChoice)
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

  const resetForm = () => { setSelectedChoice(''); setProductionPresetId(''); setAmount(''); setRouteId(session.routeId ?? ''); setDayKey(toDayKey(new Date())); setPaymentMethod('cash'); setNote(''); setError(''); expenseOperationId.current = null; setOperationPending(false) }
  const openConfirmation = () => {
    if (!selectedChoice) { setError('Selecciona en qué se gastó el dinero.'); return }
    if (selectedChoice === 'production_input' && !productionPresetId) { setError('Selecciona qué se compró para producción.'); return }
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) { setError('Ingresa un monto mayor que cero.'); return }
    if (selectedPreset?.requiresDetail && !note.trim()) { setError('Explica qué se compró o pagó para que Administración pueda revisarlo.'); return }
    if (!(session.routeId ?? routeId) || !dayKey) { setError('Completa fecha y origen del egreso.'); return }
    setError('')
    setFormOpen(false)
    setConfirmOpen(true)
  }
  const submit = async () => {
    if (submitLock.current || !selectedPreset) return
    submitLock.current = true
    const origin = session.routeId ?? routeId
    setBusy(true); setError('')
    try {
      const operationId = expenseOperationId.current || (expenseOperationId.current = newOperationId('expense'))
      setOperationPending(true)
      const saved = await registerExpense({ operationId, presetId: selectedPreset.id, concept: selectedPreset.id === 'other_unsure' ? 'Otro' : selectedPreset.categoryName, amount: Number(amount), paymentMethod, dayKey, routeId: origin, routeName: routeName(origin), registeredByUid: session.uid, registeredByName: session.userName, note: note.trim() }, { group: selectedPreset.group, categoryId: selectedPreset.categoryId, categoryName: selectedPreset.categoryName, economicType: selectedPreset.economicType, affectsOperatingResult: selectedPreset.economicType === 'operating_expense', classificationStatus: selectedPreset.classificationStatus, classificationSource: selectedPreset.classificationSource })
      setFeedback(saved.pendingConfirmation ? 'Egreso guardado localmente y pendiente de sincronizar.' : 'Egreso registrado correctamente.')
      setConfirmOpen(false); resetForm()
    } catch (failure) {
      if ((failure as { rejected?: boolean }).rejected) { expenseOperationId.current = null; setOperationPending(false) }
      setError((failure as Error).message || 'No se pudo registrar el egreso.')
    }
    finally { setBusy(false); submitLock.current = false }
  }
  const persistCategory = (id: string, targetGroup: ExpenseGroup, name: string, active: boolean, order: number, autoClassifiable: boolean, distributorVisible: boolean) => saveExpenseCategory({ categoryId: id, group: targetGroup, name, active, order, autoClassifiable, distributorVisible })
  const classify = async () => {
    if (!classifyTarget || !classifyCategory) return
    setError('')
    if (!classifyEconomicType) { setError('Selecciona el tipo de salida.'); return }
    setBusy(true)
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
    {filtered.length === 0 ? <EmptyBlock title={filterState === 'voided' ? 'Sin egresos anulados' : 'Sin egresos registrados'}/> : <div className="grid gap-2">{filtered.map((expense) => { const isProductionInput = effectiveExpenseEconomicType(expense) === 'production_input'; const pending = isExpenseReviewPending(expense); const badge = pending ? ['PENDIENTE', 'bg-amber-100 text-amber-900'] : expense.classificationSource === 'admin_review' ? ['REVISADO', 'bg-sky-100 text-sky-900'] : expense.classificationSource === 'automatic' ? ['AUTO', 'bg-emerald-50 text-emerald-800'] : null; return <article key={expense.id} className="flex min-w-0 items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-3"><div className="min-w-0"><p className="break-words text-sm font-extrabold">{expense.concept} {isProductionInput && <span className="ml-1 rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-800">MATERIA PRIMA</span>} {badge && <span className={`ml-1 rounded px-2 py-0.5 text-[10px] font-black ${badge[1]}`}>{badge[0]}</span>} {expense.pendingConfirmation && <span className="ml-1 rounded bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-700">PENDIENTE DE SINCRONIZAR</span>} {expense.voided && <span className="ml-1 rounded bg-rose-100 px-2 py-0.5 text-[10px] font-black text-rose-800">ANULADO</span>}</p><p className="text-[11px] font-semibold text-slate-600">{isProductionInput ? 'Materia prima / producción' : expenseGroupLabel(expense.group)} · {expense.categoryName || 'Por clasificar'} · {expense.paymentMethod === 'transfer' ? 'QR / transferencia' : expense.paymentMethod === 'other' ? 'Otro pago' : 'Efectivo'}</p><p className="break-words text-[11px] text-slate-500">{expense.dayKey || toDayKey(expense.createdAt)} · {expense.routeName} · {expense.registeredByName}</p>{isProductionInput && <p className="mt-1 text-[11px] text-slate-500">Pendiente de vincular a producción</p>}{expense.note && <p className="mt-1 text-xs italic text-slate-500">Detalle: {expense.note}</p>}</div><div className="flex shrink-0 items-center gap-1"><strong className={`text-sm ${expense.voided ? 'text-slate-500 line-through' : 'text-slate-800'}`}>{formatBs(expense.amount)}</strong>{session.role === 'admin' && !expense.voided && <button type="button" disabled={readOnlyPreview} aria-label={`Revisar ${expense.concept}`} onClick={() => { const economic = expense.economicType || (expense.affectsOperatingResult === false ? 'production_input' : expense.affectsOperatingResult === true ? 'operating_expense' : ''); const nextGroup = expense.group || (economic === 'production_input' ? 'production_input' : 'other'); setClassifyTarget(expense); setClassifyEconomicType(economic); setClassifyGroup(nextGroup); setClassifyCategory(categories.find((item) => item.group === nextGroup && item.active)?.id || '') }} className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-700 disabled:opacity-50"><Pencil size={15}/></button>}{session.role === 'admin' && !expense.voided && <button type="button" disabled={readOnlyPreview} aria-label={`Anular ${expense.concept}`} onClick={() => { setVoidTarget(expense); setVoidReason(''); setError('') }} className="grid h-9 w-9 place-items-center rounded-xl bg-rose-50 text-rose-700 disabled:opacity-50"><Trash2 size={15}/></button>}</div></article>})}</div>}

    <Modal isOpen={formOpen} onClose={() => !busy && setFormOpen(false)} title="Nuevo egreso" subtitle="Registra la salida de dinero con una opción sencilla." footer={<PrimaryButton full disabled={busy || readOnlyPreview} onClick={openConfirmation}>Revisar egreso</PrimaryButton>}>
      <div className="grid gap-4">
        <Field label="Monto (Bs)" required><NumberInput value={amount} min={0} step={0.01} onChange={(event) => setAmount(event.target.value)}/></Field>
        <Field label="¿En qué se gastó?" required><ChoiceButton label={topLevelChoices.find((item) => item.value === selectedChoice)?.label} placeholder="Selecciona una opción" onClick={() => setChoiceModal(true)}/></Field>
        {selectedChoice === 'production_input' && <Field label="¿Qué se compró?" required><ChoiceButton label={productionChoices.find((item) => item.value === productionPresetId)?.label} placeholder="Selecciona qué se compró" onClick={() => setProductionChoiceModal(true)}/></Field>}
        {selectedPreset && <>
          <Field label={selectedPreset.requiresDetail ? 'Detalle (obligatorio)' : 'Detalle'} required={selectedPreset.requiresDetail}><TextArea value={note} onChange={(event) => setNote(event.target.value)} placeholder={selectedPreset.requiresDetail ? 'Explica qué se compró o pagó' : 'Ej.: GNV, peaje o proveedor (opcional)'}/></Field>
          {selectedPreset.economicType === 'production_input' && <p className="rounded-xl bg-emerald-50 p-3 text-xs font-semibold text-emerald-900">Esta compra sí se registra como salida de dinero, pero no se descuenta nuevamente de la ganancia porque su costo se reconoce mediante los productos.</p>}
          {selectedPreset.classificationStatus === 'pending_review' && <p className="rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-900">Administración revisará este egreso. Mientras tanto se cuenta de forma conservadora como gasto operativo.</p>}
        </>}
        <Field label="Forma de pago" required><Segmented value={paymentMethod} onChange={(value) => setPaymentMethod(value as 'cash' | 'transfer' | 'other')} options={[{value:'cash',label:'Efectivo'},{value:'transfer',label:'QR / transferencia'},{value:'other',label:'Otro'}]}/></Field>
        {session.role === 'admin' && <><Field label="Fecha" required><TextInput type="date" value={dayKey} onChange={(event) => setDayKey(event.target.value)}/></Field>{!session.routeId && <Field label="Origen" required><ChoiceButton label={selectedOrigin} placeholder="Administración, Impulsación o ruta" onClick={() => setRouteModal(true)}/></Field>}</>}
        {error && <p role="alert" className="text-xs font-bold text-rose-700">{error}</p>}
      </div>
    </Modal>
    <Modal isOpen={confirmOpen} onClose={() => { if (!busy && !operationPending) { setConfirmOpen(false); setFormOpen(true); setError('') } }} title="CONFIRMAR EGRESO" subtitle="Revisa antes de registrar." size="md" footer={<div className="grid grid-cols-2 gap-2"><SecondaryButton full disabled={busy || operationPending} onClick={() => { setError(''); setConfirmOpen(false); setFormOpen(true) }}>Corregir</SecondaryButton><PrimaryButton full disabled={busy || readOnlyPreview} onClick={() => void submit()}>{busy ? 'Registrando…' : operationPending ? 'Reintentar misma operación' : 'Confirmar y registrar'}</PrimaryButton></div>}>
      <div className="grid gap-3 text-sm">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-extrabold uppercase text-slate-500">Estás registrando</p><p className="mt-2 text-lg font-black">{selectedPreset?.id === 'other_unsure' ? 'Otro / pendiente de revisión' : selectedChoice === 'production_input' ? 'Materia prima / producción' : selectedPreset?.label}</p>{selectedChoice === 'production_input' && <p className="mt-1 text-sm font-bold text-slate-700">Categoría: {selectedPreset?.categoryName}</p>}<p className="mt-3 flex justify-between gap-3"><span>Monto</span><strong>{formatBs(Number(amount))}</strong></p><p className="flex justify-between gap-3"><span>Forma de pago</span><strong>{paymentMethod === 'cash' ? 'Efectivo' : paymentMethod === 'transfer' ? 'QR / transferencia' : 'Otro'}</strong></p>{note.trim() && <p className="mt-2 break-words"><span className="text-slate-500">Detalle: </span><strong>{note.trim()}</strong></p>}</div>
        {selectedPreset?.classificationStatus === 'pending_review' ? <p className="rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-950">Este egreso quedará pendiente de revisión por Administración.</p> : selectedPreset?.economicType === 'production_input' ? <><p className="rounded-xl bg-emerald-50 p-3 text-xs font-semibold text-emerald-950">Esta compra se registrará como materia prima.</p><p className="text-xs text-slate-700">El dinero sí sale de caja si se paga en efectivo, pero no se descontará nuevamente de la ganancia porque su costo se reconocerá mediante los productos.</p></> : <><p className="rounded-xl bg-slate-50 p-3 text-xs font-semibold text-slate-800">Clasificación automática: {expenseGroupLabel(selectedPreset?.group)} → {selectedPreset?.categoryName}.</p><p className="text-xs text-slate-700">Se descontará del Resultado del negocio.{paymentMethod === 'cash' ? ' También se descontará del efectivo esperado.' : ' No cambia el efectivo físico esperado.'}</p></>}
        {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-800">{error}</p>}
        {error && operationPending && <p className="rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-900">No cambies los datos ni generes otro registro todavía. Al reintentar se usará el mismo número de operación para evitar duplicados.</p>}
      </div>
    </Modal>
    <Modal isOpen={Boolean(voidTarget)} onClose={() => setVoidTarget(null)} title="Anular egreso" subtitle={voidTarget ? `${voidTarget.concept} · ${formatBs(voidTarget.amount)}` : ''} footer={<div className="grid grid-cols-2 gap-2"><SecondaryButton full onClick={() => setVoidTarget(null)}>Volver</SecondaryButton><PrimaryButton full disabled={busy || readOnlyPreview || !voidReason.trim()} onClick={async () => { if (!voidTarget) return; setBusy(true); try { await deleteExpense(voidTarget.id, voidReason.trim()); setFeedback('Egreso anulado con su motivo en auditoría.'); setVoidTarget(null) } catch (failure) { setError((failure as Error).message) } finally { setBusy(false) }}}>{busy ? 'Anulando…' : 'Confirmar anulación'}</PrimaryButton></div>}><p className="mb-2 text-sm">El registro no se borra; quedará fuera de los totales.</p><TextArea value={voidReason} onChange={(event) => setVoidReason(event.target.value)} placeholder="Motivo obligatorio"/>{error && <p role="alert" className="mt-2 text-xs text-rose-700">{error}</p>}</Modal>
    <Modal isOpen={Boolean(classifyTarget)} onClose={() => setClassifyTarget(null)} title="Revisar egreso histórico" subtitle={classifyTarget?.concept || ''} footer={<PrimaryButton full disabled={busy || readOnlyPreview || !classifyCategory || !classifyEconomicType} onClick={() => void classify()}>{busy ? 'Guardando…' : 'Guardar revisión'}</PrimaryButton>}><div className="grid gap-3"><p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">Se conservarán sin cambios el monto, fecha, origen, responsable y forma de pago. La decisión quedará en el historial.</p><Field label="Tipo de salida" required><Segmented value={classifyEconomicType} onChange={(value) => { const next = value as ExpenseEconomicType; setClassifyEconomicType(next); const nextGroup: ExpenseGroup = next === 'production_input' ? 'production_input' : classifyGroup === 'production_input' ? 'other' : classifyGroup; setClassifyGroup(nextGroup); setClassifyCategory(categories.find((item) => item.group === nextGroup && item.active)?.id || '') }} options={[{value:'operating_expense',label:'Gasto operativo'},{value:'production_input',label:'Materia prima / producción'}]}/><p className="mt-1 text-xs text-slate-600">{classifyEconomicType === 'production_input' ? 'Se conserva como salida de dinero, pero no se descuenta de nuevo de la ganancia.' : 'Se descuenta del Resultado del negocio.'}</p></Field>{classifyEconomicType === 'operating_expense' && <Field label="Grupo"><select value={classifyGroup === 'production_input' ? 'other' : classifyGroup} onChange={(event) => { const next = event.target.value as ExpenseGroup; setClassifyGroup(next); setClassifyCategory(categories.find((item) => item.group === next && item.active)?.id || '') }} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3">{EXPENSE_GROUPS.filter((item) => item.id !== 'production_input').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>}<Field label="Categoría"><select value={classifyCategory} onChange={(event) => setClassifyCategory(event.target.value)} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3">{categories.filter((item) => item.group === (classifyEconomicType === 'production_input' ? 'production_input' : classifyGroup) && item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>{classifyEconomicType === 'production_input' && <p className="rounded-xl bg-emerald-50 p-3 text-xs text-emerald-900">Pendiente de vincular a producción. Esto no impide guardar la clasificación.</p>}{error && <p role="alert" className="text-xs text-rose-700">{error}</p>}</div></Modal>
    <Modal isOpen={categoriesOpen} onClose={() => setCategoriesOpen(false)} title="Administrar categorías" subtitle="Las categorías nuevas no se ofrecerán a distribuidores hasta que las habilites explícitamente."><div className="grid gap-3"><Field label="Grupo"><select value={categoryGroup} onChange={(event) => setCategoryGroup(event.target.value as ExpenseGroup)} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3">{EXPENSE_GROUPS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field><Field label={editingCategoryId ? 'Nombre de la categoría' : 'Nueva categoría'}><TextInput value={categoryDraft} onChange={(event) => setCategoryDraft(event.target.value)} placeholder="Nombre"/></Field><label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 text-xs"><input type="checkbox" checked={categoryAutoClassifiable} onChange={(event) => { setCategoryAutoClassifiable(event.target.checked); if (!event.target.checked) setCategoryDistributorVisible(false) }} className="mt-0.5 h-4 w-4"/><span><strong>Permitir clasificación automática segura</strong><span className="mt-1 block text-slate-600">El grupo determina el tratamiento: compras para producción no se descuentan otra vez de la ganancia.</span></span></label><label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 text-xs"><input type="checkbox" checked={categoryDistributorVisible} disabled={!categoryAutoClassifiable} onChange={(event) => setCategoryDistributorVisible(event.target.checked)} className="mt-0.5 h-4 w-4"/><span><strong>Ofrecer esta opción a distribuidores</strong><span className="mt-1 block text-slate-600">Solo está disponible si la clasificación automática segura está habilitada.</span></span></label><PrimaryButton disabled={busy || readOnlyPreview || !categoryDraft.trim()} onClick={async () => { setBusy(true); try { const prior = categories.find((item) => item.id === editingCategoryId); await persistCategory(editingCategoryId || `custom-${categoryGroup}-${Date.now()}`, categoryGroup, categoryDraft.trim(), prior?.active ?? true, prior?.order ?? 999, categoryAutoClassifiable, categoryDistributorVisible); setCategoryDraft(''); setEditingCategoryId(''); setCategoryAutoClassifiable(false); setCategoryDistributorVisible(false); setFeedback('Categoría guardada.') } catch (failure) { setError((failure as Error).message) } finally { setBusy(false) }}}>{editingCategoryId ? 'Guardar cambio' : 'Crear categoría'}</PrimaryButton><div className="grid gap-2">{categories.filter((item) => item.group === categoryGroup).map((item) => { const builtIn = EXPENSE_PRESETS.some((preset) => preset.categoryId === item.id); const access = item.autoClassifiable && item.distributorVisible ? 'Disponible para distribuidores' : builtIn ? 'Opción estándar para distribuidores' : 'Solo para Administración'; return <div key={item.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 p-2 text-sm"><span className={item.active ? '' : 'text-slate-400 line-through'}>{item.name}<small className="block text-[10px] text-slate-500">{access}</small></span><div className="flex gap-1"><button type="button" onClick={() => { setEditingCategoryId(item.id); setCategoryDraft(item.name); setCategoryAutoClassifiable(item.autoClassifiable === true); setCategoryDistributorVisible(item.distributorVisible === true) }} className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold">Editar</button><button type="button" disabled={busy || readOnlyPreview} onClick={() => void persistCategory(item.id, item.group, item.name, !item.active, item.order, item.autoClassifiable === true, item.distributorVisible === true).then(() => setFeedback('Estado de categoría actualizado.')).catch((failure) => setError((failure as Error).message))} className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold disabled:opacity-40">{item.active ? 'Desactivar' : 'Activar'}</button></div></div>})}</div>{error && <p role="alert" className="text-xs text-rose-700">{error}</p>}</div></Modal>
    <ChoiceModal isOpen={choiceModal} onClose={() => setChoiceModal(false)} title="¿En qué se gastó?" subtitle="Elige la opción que mejor describe la salida." options={topLevelChoices} selectedValue={selectedChoice} onSelect={(value) => { setSelectedChoice(value); setProductionPresetId(''); setNote(''); setError('') }}/>
    <ChoiceModal isOpen={productionChoiceModal} onClose={() => setProductionChoiceModal(false)} title="¿Qué se compró?" subtitle="Selecciona el tipo de insumo para producción." options={productionChoices} selectedValue={productionPresetId} onSelect={(value) => { setProductionPresetId(value); setNote(''); setError('') }}/>
    <ChoiceModal isOpen={routeModal} onClose={() => setRouteModal(false)} title="Origen del egreso" searchable options={[{value:'administracion',label:'Administración'},{value:'route-impulsacion',label:'Impulsación'},...activeRoutes.filter((route) => !['route-directa','route-impulsacion','administracion','admin'].includes(route.id)).map((route) => ({value:route.id,label:route.name}))]} selectedValue={routeId} onSelect={(value) => { setRouteId(value); setRouteModal(false) }}/>
  </Screen>
}
