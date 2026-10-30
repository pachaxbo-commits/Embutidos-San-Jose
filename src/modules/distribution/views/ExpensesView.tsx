import { useMemo, useRef, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Modal } from '../../../components/ui/Modal'
import { Field, NumberInput, Segmented, TextArea, TextInput } from '../../../components/ui/Form'
import { ChoiceButton, ChoiceModal } from '../../../components/ui/ChoiceModal'
import { EmptyBlock, Screen } from '../../../components/ui/Screen'
import { matchesRoute, round2, toDayKey } from '../domain/engine'
import { classifyExpense, deleteExpense, listDistributorPurchaseSuppliers, newOperationId, registerExpense, registerSupplierPurchase, saveExpenseGroup } from '../data/distributionRepository'
import { expenseCategoriesForGroup, expenseGroupDisplayName, listExpenseGroups, mergeExpenseCategories, reconcileExpenseCategoryFilter } from '../domain/expenseCategories'
import { effectiveExpenseEconomicType, filterExpensesByStatus, isExpenseReviewPending, summarizeActiveExpenses } from '../domain/expenseReview'
import { adminExpensePreset, customExpensePreset, EXPENSE_PRESETS, EXPENSE_PRODUCTION_PRESETS, EXPENSE_TOP_LEVEL_CHOICES, type ExpensePreset } from '../domain/expensePresets'
import { isProductionPreviewReadOnly } from '../../../lib/firebase'
import { ExpenseConfigurationModal } from './ExpenseConfigurationModal'
import { ExpenseReportsView } from './ExpenseReportsView'
import { SupplierPayablesView } from './SupplierPayablesView'
import { RangePicker } from './RangePicker'
import { KpiCard, PrimaryButton, SecondaryButton, formatBs } from './shared'
import type { DistExpense, ExpenseEconomicType, ExpenseGroupId } from '../types'
import type { DistributionViewProps } from './DistributionApp'

export function ExpensesView({ session, data }: DistributionViewProps) {
  const [formOpen, setFormOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [selectedChoice, setSelectedChoice] = useState('')
  const [productionPresetId, setProductionPresetId] = useState('')
  const [choiceModal, setChoiceModal] = useState(false)
  const [productionChoiceModal, setProductionChoiceModal] = useState(false)
  const [moreCategoriesOpen, setMoreCategoriesOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [purchaseSupplierId, setPurchaseSupplierId] = useState('')
  const [purchaseSuppliers, setPurchaseSuppliers] = useState<Array<{ id: string; name: string }>>([])
  const [purchaseSuppliersLoaded, setPurchaseSuppliersLoaded] = useState(false)
  const [purchaseSuppliersLoading, setPurchaseSuppliersLoading] = useState(false)
  const [purchaseQuantity, setPurchaseQuantity] = useState('')
  const [purchaseUnitPrice, setPurchaseUnitPrice] = useState('')
  const [purchaseReceiptNumber, setPurchaseReceiptNumber] = useState('')
  const [routeId, setRouteId] = useState(session.routeId ?? '')
  const [dayKey, setDayKey] = useState(toDayKey(new Date()))
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'transfer' | 'other' | 'credit'>('cash')
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
  const [classifyGroup, setClassifyGroup] = useState<ExpenseGroupId>('other')
  const [classifyCategory, setClassifyCategory] = useState('')
  const [classifyEconomicType, setClassifyEconomicType] = useState<ExpenseEconomicType | ''>('')
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [section, setSection] = useState<'expenses' | 'payables' | 'reports'>('expenses')
  const [groupCategoryOpen, setGroupCategoryOpen] = useState(false)
  const [groupCategoryGroup, setGroupCategoryGroup] = useState('administration')
  const [feedback, setFeedback] = useState('')
  const readOnlyPreview = isProductionPreviewReadOnly()
  const categories = useMemo(() => mergeExpenseCategories(data.expenseCategories), [data.expenseCategories])
  const filterCategories = useMemo(() => expenseCategoriesForGroup(categories, filterGroup), [categories, filterGroup])
  const effectiveFilterCategory = reconcileExpenseCategoryFilter(filterCategory, filterGroup, categories)
  const activeRoutes = data.routes.filter((route) => route.active !== false)
  const groups = useMemo(() => listExpenseGroups(data.expenseGroups), [data.expenseGroups])
  const customPresets = useMemo(() => categories.map((item) => customExpensePreset(item, session.role === 'admin', data.expenseGroups)).filter((item): item is ExpensePreset => item !== null), [categories, session.role, data.expenseGroups])
  const adminPresets = useMemo(() => categories.map((item) => adminExpensePreset(item, data.expenseGroups)).filter((item): item is ExpensePreset => item !== null), [categories, data.expenseGroups])
  const frequentAdminChoiceIds = useMemo(() => new Set(EXPENSE_PRESETS.map(preset => preset.categoryId)), [])
  const moreAdminPresetsByGroup = useMemo(() => groups.filter(group => group.active).map(group => ({ ...group, presets: adminPresets.filter(preset => preset.group === group.id && !frequentAdminChoiceIds.has(preset.categoryId)) })), [adminPresets, frequentAdminChoiceIds, groups])
  const topLevelChoices = useMemo(() => session.role === 'admin'
    ? EXPENSE_TOP_LEVEL_CHOICES
    : [...EXPENSE_TOP_LEVEL_CHOICES, ...customPresets.filter((preset) => preset.group !== 'production_input').map((preset) => ({ value: preset.id, label: preset.label }))], [customPresets, session.role])
  const productionChoices = useMemo(() => [
    ...EXPENSE_PRODUCTION_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
    ...(session.role === 'admin' ? adminPresets.filter((preset) => preset.group === 'production_input' && !frequentAdminChoiceIds.has(preset.categoryId)).map((preset) => ({ value: preset.id, label: preset.label })) : customPresets.filter((preset) => preset.group === 'production_input').map((preset) => ({ value: preset.id, label: preset.label }))),
  ], [adminPresets, customPresets, frequentAdminChoiceIds, session.role])
  const selectedPreset = selectedChoice.startsWith('group-category:')
    ? (() => { const selectedCategory = categories.find((category) => category.id === selectedChoice.slice('group-category:'.length)); const selectedGroup = groups.find((group) => group.id === groupCategoryGroup); return selectedCategory && selectedGroup ? { id: selectedChoice, label: selectedCategory.name, group: selectedGroup.id, categoryId: selectedCategory.id, categoryName: selectedCategory.name, economicType: selectedGroup.economicType, classificationStatus: 'reviewed' as const, classificationSource: 'admin_review' as const, requiresDetail: false } : undefined })()
    : selectedChoice === 'production_input'
    ? [...EXPENSE_PRESETS, ...customPresets, ...adminPresets].find((preset) => preset.id === productionPresetId)
    : [...EXPENSE_PRESETS, ...customPresets, ...adminPresets].find((preset) => preset.id === selectedChoice)
  const distributorMeatPurchase = session.role === 'distributor' && selectedChoice === 'production_input' && productionPresetId === 'production_meat'
  const distributorPurchaseTotal = round2((Number(purchaseQuantity) || 0) * (Number(purchaseUnitPrice) || 0))
  const matchingExpenses = useMemo(() => data.expenses.filter((expense) => {
    const routeMatch = filterRoute === 'all' || matchesRoute(expense.routeId, filterRoute)
    const groupMatch = filterGroup === 'all' || (expense.group || 'other') === filterGroup
    const categoryMatch = effectiveFilterCategory === 'all' || (effectiveFilterCategory === 'unclassified' ? !expense.group || !expense.categoryId : expense.categoryId === effectiveFilterCategory)
    const paymentMatch = filterPayment === 'all' || (expense.paymentMethod || 'cash') === filterPayment
    const personMatch = filterResponsible === 'all' || expense.registeredByUid === filterResponsible
    const queryMatch = !search || `${expense.concept} ${expense.note || ''} ${expense.categoryName || ''}`.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es'))
    const pendingMatch = !pendingOnly || isExpenseReviewPending(expense)
    return routeMatch && groupMatch && categoryMatch && paymentMatch && personMatch && queryMatch && pendingMatch
  }), [data.expenses, filterRoute, filterGroup, effectiveFilterCategory, filterPayment, filterResponsible, search, pendingOnly])
  const activeFiltered = useMemo(() => filterExpensesByStatus(matchingExpenses, 'active'), [matchingExpenses])
  const filtered = useMemo(() => filterExpensesByStatus(matchingExpenses, filterState), [matchingExpenses, filterState])
  const activeSummary = useMemo(() => summarizeActiveExpenses(activeFiltered), [activeFiltered])
  const total = activeSummary.total
  const pendingCount = data.expenses.filter(isExpenseReviewPending).length
  const routeName = (id: string) => id === 'administracion' || id === 'admin' ? 'Administración' : id === 'route-impulsacion' || id === 'route-directa' ? 'Impulsación' : data.routes.find((route) => route.id === id)?.name || id
  const selectedOrigin = routeName(routeId)

  const resetForm = () => { setSelectedChoice(''); setProductionPresetId(''); setAmount(''); setPurchaseSupplierId(''); setPurchaseSuppliers([]); setPurchaseSuppliersLoaded(false); setPurchaseSuppliersLoading(false); setPurchaseQuantity(''); setPurchaseUnitPrice(''); setPurchaseReceiptNumber(''); setRouteId(session.routeId ?? ''); setDayKey(toDayKey(new Date())); setPaymentMethod('cash'); setNote(''); setError(''); expenseOperationId.current = null; setOperationPending(false) }
  const loadPurchaseSuppliers = () => {
    if (session.role !== 'distributor') return
    setPurchaseSuppliers([]); setPurchaseSupplierId(''); setPurchaseSuppliersLoaded(false); setPurchaseSuppliersLoading(true)
    void listDistributorPurchaseSuppliers().then(rows => {
      setPurchaseSuppliers(rows)
      setPurchaseSuppliersLoaded(true)
    }).catch(failure => {
      setPurchaseSuppliersLoaded(true)
      setError((failure as Error).message || 'No se pudo cargar el catálogo de proveedores activos.')
    }).finally(() => setPurchaseSuppliersLoading(false))
  }
  const openConfirmation = () => {
    if (!selectedChoice) { setError('Selecciona en qué se gastó el dinero.'); return }
    if (selectedChoice === 'production_input' && !productionPresetId) { setError('Selecciona qué se compró para producción.'); return }
    if (distributorMeatPurchase) {
      if (!purchaseSuppliers.some(supplier => supplier.id === purchaseSupplierId)) { setError('Selecciona un proveedor activo.'); return }
      if (!(Number(purchaseQuantity) > 0) || !(Number(purchaseUnitPrice) > 0) || !(distributorPurchaseTotal > 0)) { setError('Ingresa kilogramos y precio unitario válidos.'); return }
      if (purchaseReceiptNumber.trim().length > 100) { setError('El número de comprobante debe tener hasta 100 caracteres.'); return }
      setAmount(String(distributorPurchaseTotal))
    } else if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) { setError('Ingresa un monto mayor que cero.'); return }
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
      const operationId = expenseOperationId.current || (expenseOperationId.current = newOperationId(distributorMeatPurchase ? 'supplier-purchase' : 'expense'))
      setOperationPending(true)
      if (distributorMeatPurchase) {
        await registerSupplierPurchase({
          operationId,
          supplierId: purchaseSupplierId,
          description: 'Compra de carne',
          amount: distributorPurchaseTotal,
          initialPayment: paymentMethod === 'credit' ? 0 : distributorPurchaseTotal,
          paymentMethod: paymentMethod === 'credit' ? 'credit' : paymentMethod,
          dayKey,
          ...(purchaseReceiptNumber.trim() ? { purchaseReceiptType: 'receipt' as const, purchaseReceiptNumber: purchaseReceiptNumber.trim() } : {}),
          note: note.trim(),
          purchaseLines: [{ description: 'Carne', quantity: Number(purchaseQuantity), unit: 'kg', unitPrice: Number(purchaseUnitPrice), total: distributorPurchaseTotal, wasteQuantity: 0, netUsableQuantity: Number(purchaseQuantity) }],
        })
        setFeedback(paymentMethod === 'credit' ? 'Compra registrada; la cuenta por pagar quedó pendiente para Administración.' : 'Compra y salida de ruta registradas correctamente.')
        setConfirmOpen(false); resetForm(); return
      }
      const saved = await registerExpense({ operationId, presetId: selectedPreset.id.startsWith('group-category:') ? `group-category:${selectedPreset.categoryId}` : selectedPreset.id, groupId: selectedPreset.group, groupName: groups.find(group => group.id === selectedPreset.group)?.label, concept: selectedPreset.id === 'other_unsure' ? 'Otro' : selectedPreset.categoryName, amount: Number(amount), paymentMethod: paymentMethod === 'credit' ? 'cash' : paymentMethod, dayKey, routeId: origin, routeName: routeName(origin), registeredByUid: session.uid, registeredByName: session.userName, note: note.trim() }, { group: selectedPreset.group, categoryId: selectedPreset.categoryId, categoryName: selectedPreset.categoryName, economicType: selectedPreset.economicType, affectsOperatingResult: selectedPreset.economicType === 'operating_expense', classificationStatus: selectedPreset.classificationStatus, classificationSource: selectedPreset.classificationSource })
      setFeedback(saved.pendingConfirmation ? 'Egreso guardado localmente y pendiente de sincronizar.' : 'Egreso registrado correctamente.')
      setConfirmOpen(false); resetForm()
    } catch (failure) {
      if ((failure as { rejected?: boolean }).rejected) { expenseOperationId.current = null; setOperationPending(false) }
      setError((failure as Error).message || 'No se pudo registrar el egreso.')
    }
    finally { setBusy(false); submitLock.current = false }
  }
  const classify = async () => {
    if (!classifyTarget || !classifyCategory) return
    setError('')
    if (!classifyEconomicType) { setError('Selecciona el tipo de salida.'); return }
    setBusy(true)
    const selectedGroup = classifyEconomicType === 'production_input' ? (groups.find(group => group.economicType === 'production_input' && group.id === classifyGroup)?.id || 'production_input') : groups.find(group => group.id === classifyGroup)?.economicType === 'operating_expense' ? classifyGroup : 'other'
    try { await classifyExpense({ expenseId: classifyTarget.id, group: selectedGroup, categoryId: classifyCategory, economicType: classifyEconomicType }); setFeedback('La clasificación y revisión se guardaron con su historial.'); setClassifyTarget(null) }
    catch (failure) { setError((failure as Error).message) }
    finally { setBusy(false) }
  }

  return <Screen title="Egresos" subtitle={session.role === 'admin' ? 'Salidas de dinero por grupo, origen y forma de pago' : 'Egresos registrados para tu ruta'}>
    <div className="mb-3 flex min-w-0 flex-wrap justify-between gap-2">{session.role === 'admin' ? <Segmented value={section} onChange={(value) => setSection(value as 'expenses' | 'payables' | 'reports')} options={[{value:'expenses',label:'Egresos'},{value:'payables',label:'Cuentas por pagar'},{value:'reports',label:'Reportes'}]}/> : <span/>}<div className="flex flex-wrap justify-end gap-2">{session.role === 'admin' && section === 'expenses' && <SecondaryButton disabled={readOnlyPreview} onClick={() => setCategoriesOpen(true)}><Pencil size={15}/> Grupos y categorías</SecondaryButton>}{session.can('dist.expense.create') && section === 'expenses' && <PrimaryButton disabled={readOnlyPreview} onClick={() => { resetForm(); setFormOpen(true) }}><Plus size={16}/> Nuevo egreso</PrimaryButton>}</div></div>
    {session.role === 'admin' && section !== 'expenses' ? section === 'payables' ? <SupplierPayablesView session={session} data={data} readOnly={readOnlyPreview}/> : <ExpenseReportsView session={session} data={data}/> : <>
    {readOnlyPreview && <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-bold text-amber-900">Vista previa — los cambios están deshabilitados porque esta versión está conectada a producción.</p>}
    <RangePicker dayKeys={session.dayKeys} onChange={session.setDayKeys}/>
    {session.role === 'admin' && <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Origen"><select value={filterRoute} onChange={(event) => setFilterRoute(event.target.value)} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3"><option value="all">Todos los orígenes</option><option value="administracion">Administración</option><option value="route-impulsacion">Impulsación</option>{activeRoutes.filter((r) => !['route-directa','route-impulsacion','administracion','admin'].includes(r.id)).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
      <Field label="Grupo"><select value={filterGroup} onChange={(event) => { const nextGroup = event.target.value; setFilterGroup(nextGroup); setFilterCategory(current => reconcileExpenseCategoryFilter(current, nextGroup, categories)) }} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3"><option value="all">Todos los grupos</option>{groups.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>
      <Field label="Categoría"><select value={effectiveFilterCategory} onChange={(event) => setFilterCategory(event.target.value)} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3"><option value="all">Todas las categorías</option>{filterGroup === 'all' && <option value="unclassified">Por clasificar</option>}{filterCategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <Field label="Estado"><select value={filterState} onChange={(event) => setFilterState(event.target.value as typeof filterState)} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3"><option value="active">Activos</option><option value="voided">Anulados</option><option value="all">Todos</option></select></Field>
      <Field label="Forma de pago"><select value={filterPayment} onChange={(event) => setFilterPayment(event.target.value)} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3"><option value="all">Todas las formas</option><option value="cash">Efectivo</option><option value="transfer">QR / transferencia</option><option value="other">Otro</option><option value="credit">A crédito</option><option value="mixed">Pago parcial / mixto</option></select></Field>
      <Field label="Responsable"><select value={filterResponsible} onChange={(event) => setFilterResponsible(event.target.value)} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3"><option value="all">Todos</option>{[...new Map(data.expenses.map((item) => [item.registeredByUid, item.registeredByName])).entries()].map(([uid, name]) => <option key={uid} value={uid}>{name}</option>)}</select></Field>
      <Field label="Buscar"><TextInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Concepto u observación"/></Field>
    </div>}
    {session.role === 'admin' && pendingCount > 0 && <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><span>{pendingCount} egreso{pendingCount === 1 ? '' : 's'} pendiente{pendingCount === 1 ? '' : 's'} de revisar o clasificar.</span><button type="button" onClick={() => { setPendingOnly((current) => !current); setFilterState('active'); setFilterGroup('all'); setFilterCategory('all'); setFilterRoute('all'); setFilterPayment('all'); setFilterResponsible('all'); setSearch('') }} className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-amber-900">{pendingOnly ? 'Mostrar todos' : 'Revisar pendientes'}</button></div>}
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"><KpiCard label="Compras y egresos registrados" value={formatBs(total)}/><KpiCard label="Salida real de dinero" value={formatBs(activeSummary.cashOutflow)}/><KpiCard label="Egresos operativos" value={formatBs(activeSummary.operatingTotal)}/><KpiCard label="Compras de materia prima" value={formatBs(activeSummary.productionInputTotal)}/>{groups.filter((item) => item.active && item.economicType === 'operating_expense').map((item) => <KpiCard key={item.id} label={item.label.replace('Gastos de ', '')} value={formatBs(activeSummary.groups[item.id])}/>)}</div>
    {feedback && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-xs font-bold text-emerald-800">{feedback}</p>}
    {filtered.length === 0 ? <EmptyBlock title={filterState === 'voided' ? 'Sin egresos anulados' : 'Sin egresos registrados'}/> : <div className="grid gap-2">{filtered.map((expense) => { const isProductionInput = effectiveExpenseEconomicType(expense) === 'production_input'; const pending = isExpenseReviewPending(expense); const badge = pending ? ['PENDIENTE', 'bg-amber-100 text-amber-900'] : expense.classificationSource === 'admin_review' ? ['REVISADO', 'bg-sky-50 text-sky-900'] : expense.classificationSource === 'automatic' ? ['AUTO', 'bg-emerald-50 text-emerald-800'] : null; const method = expense.paymentMethod === 'transfer' ? 'QR / transferencia' : expense.paymentMethod === 'other' ? 'Otro pago' : expense.paymentMethod === 'credit' ? 'A crédito' : expense.paymentMethod === 'mixed' ? 'Pago parcial / mixto' : 'Efectivo'; return <article key={expense.id} className="flex min-w-0 items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-3"><div className="min-w-0"><p className="break-words text-sm font-extrabold">{expense.concept} {expense.transactionKind === 'supplier_payment' && <span className="ml-1 rounded bg-sky-50 px-2 py-0.5 text-[10px] font-black text-sky-800">PAGO A PROVEEDOR</span>} {isProductionInput && <span className="ml-1 rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-800">MATERIA PRIMA</span>} {badge && <span className={`ml-1 rounded px-2 py-0.5 text-[10px] font-black ${badge[1]}`}>{badge[0]}</span>} {expense.pendingConfirmation && <span className="ml-1 rounded bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-700">PENDIENTE DE SINCRONIZAR</span>} {expense.voided && <span className="ml-1 rounded bg-rose-100 px-2 py-0.5 text-[10px] font-black text-rose-800">ANULADO</span>}</p><p className="text-[11px] font-semibold text-slate-600">{isProductionInput ? 'Materia prima / producción' : expense.groupName || expenseGroupDisplayName(expense.group, data.expenseGroups)} · {expense.categoryName || 'Por clasificar'} · {method}</p><p className="break-words text-[11px] text-slate-500">{expense.dayKey || toDayKey(expense.createdAt)} · {expense.routeName} · {expense.registeredByName}</p>{expense.transactionKind === 'supplier_purchase' && <p className="mt-1 text-[11px] text-amber-800">Proveedor: {expense.supplierName}{expense.purchaseReceiptType ? ` · ${expense.purchaseReceiptType === 'invoice' ? 'Factura' : expense.purchaseReceiptType === 'receipt' ? 'Recibo' : 'Otro'}${expense.purchaseReceiptNumber ? ` ${expense.purchaseReceiptNumber}` : ''}` : ''} · Pagado al registrar {formatBs((expense.cashPaidAmount || 0) + (expense.transferPaidAmount || 0) + (expense.otherPaidAmount || 0))} · Saldo pendiente {formatBs(Math.max(0, expense.amount - (expense.cashPaidAmount || 0) - (expense.transferPaidAmount || 0) - (expense.otherPaidAmount || 0)))}</p>}{expense.transactionKind === 'supplier_payment' && <p className="mt-1 text-[11px] text-sky-800">Abono a una cuenta por pagar; no es una compra nueva.</p>}{isProductionInput && expense.transactionKind !== 'supplier_payment' && <p className="mt-1 text-[11px] text-slate-500">Pendiente de vincular a producción</p>}{expense.note && <p className="mt-1 text-xs italic text-slate-500">Detalle: {expense.note}</p>}</div><div className="flex shrink-0 items-center gap-1"><strong className={`text-sm ${expense.voided ? 'text-slate-500 line-through' : 'text-slate-800'}`}>{formatBs(expense.amount)}</strong>{session.role === 'admin' && !expense.voided && expense.transactionKind === 'expense' && <button type="button" disabled={readOnlyPreview} aria-label={`Revisar ${expense.concept}`} onClick={() => { const economic = expense.economicType || (expense.affectsOperatingResult === false ? 'production_input' : expense.affectsOperatingResult === true ? 'operating_expense' : ''); const nextGroup = expense.group || (economic === 'production_input' ? 'production_input' : 'other'); setClassifyTarget(expense); setClassifyEconomicType(economic); setClassifyGroup(nextGroup); setClassifyCategory(categories.find((item) => item.group === nextGroup && item.active)?.id || '') }} className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-700 disabled:opacity-50"><Pencil size={15}/></button>}{session.role === 'admin' && !expense.voided && expense.transactionKind === 'expense' && <button type="button" disabled={readOnlyPreview} aria-label={`Anular ${expense.concept}`} onClick={() => { setVoidTarget(expense); setVoidReason(''); setError('') }} className="grid h-9 w-9 place-items-center rounded-xl bg-rose-50 text-rose-700 disabled:opacity-50"><Trash2 size={15}/></button>}</div></article>})}</div>}

    <Modal isOpen={formOpen} onClose={() => !busy && setFormOpen(false)} title="Nuevo egreso" subtitle="Registra la salida de dinero con una opción sencilla." footer={<PrimaryButton full disabled={busy || readOnlyPreview} onClick={openConfirmation}>Revisar egreso</PrimaryButton>}>
      <div className="grid gap-4">
        {!distributorMeatPurchase && <Field label="Monto (Bs)" required><NumberInput value={amount} min={0} step={0.01} onChange={(event) => setAmount(event.target.value)}/></Field>}
        <Field label="¿En qué se gastó?" required><div className="grid gap-2"><ChoiceButton label={selectedPreset?.label || topLevelChoices.find((item) => item.value === selectedChoice)?.label} placeholder="Selecciona una opción" onClick={() => setChoiceModal(true)}/>{session.role === 'admin' && <div className="grid gap-2 sm:grid-cols-2"><SecondaryButton full onClick={() => setGroupCategoryOpen(true)}>Elegir grupo y categoría</SecondaryButton><SecondaryButton full onClick={() => setMoreCategoriesOpen(true)}>Opciones frecuentes</SecondaryButton></div>}</div></Field>
        {selectedChoice === 'production_input' && <Field label="¿Qué se compró?" required><ChoiceButton label={productionChoices.find((item) => item.value === productionPresetId)?.label} placeholder="Selecciona qué se compró" onClick={() => setProductionChoiceModal(true)}/></Field>}
        {distributorMeatPurchase && <>
          <Field label="Proveedor" required><select value={purchaseSupplierId} onChange={event => setPurchaseSupplierId(event.target.value)} disabled={purchaseSuppliersLoading || !purchaseSuppliersLoaded} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3 disabled:bg-slate-100"><option value="">{purchaseSuppliersLoading ? 'Cargando proveedores…' : purchaseSuppliersLoaded && purchaseSuppliers.length === 0 ? 'No hay proveedores activos' : 'Selecciona un proveedor activo'}</option>{purchaseSuppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></Field>
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Cantidad (kg)" required><NumberInput value={purchaseQuantity} min={0.001} step={0.001} onChange={event => setPurchaseQuantity(event.target.value)}/></Field><Field label="Precio por kg (Bs)" required><NumberInput value={purchaseUnitPrice} min={0.01} step={0.01} onChange={event => setPurchaseUnitPrice(event.target.value)}/></Field></div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"><span className="text-xs font-bold text-emerald-900">Total calculado</span><strong className="float-right text-lg text-emerald-950">{formatBs(distributorPurchaseTotal)}</strong></div>
          <Field label="Número de comprobante (opcional)"><TextInput value={purchaseReceiptNumber} maxLength={100} onChange={event => setPurchaseReceiptNumber(event.target.value)} placeholder="Factura o recibo"/></Field>
        </>}
        {selectedPreset && <>
          <Field label={selectedPreset.requiresDetail ? 'Detalle (obligatorio)' : 'Detalle'} required={selectedPreset.requiresDetail}><TextArea value={note} onChange={(event) => setNote(event.target.value)} placeholder={selectedPreset.requiresDetail ? 'Explica qué se compró o pagó' : 'Ej.: GNV, peaje o proveedor (opcional)'}/></Field>
          {selectedPreset.economicType === 'production_input' && <p className="rounded-xl bg-emerald-50 p-3 text-xs font-semibold text-emerald-900">Esta compra sí se registra como salida de dinero, pero no se descuenta nuevamente de la ganancia porque su costo se reconoce mediante los productos.</p>}
          {selectedPreset.classificationStatus === 'pending_review' && <p className="rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-900">Administración revisará este egreso. Mientras tanto se cuenta de forma conservadora como gasto operativo.</p>}
        </>}
        <Field label="Forma de pago" required><Segmented value={paymentMethod} onChange={(value) => setPaymentMethod(value as 'cash' | 'transfer' | 'other' | 'credit')} options={distributorMeatPurchase ? [{value:'cash',label:'Efectivo'},{value:'transfer',label:'QR / transferencia'},{value:'credit',label:'A crédito'}] : [{value:'cash',label:'Efectivo'},{value:'transfer',label:'QR / transferencia'},{value:'other',label:'Otro'}]}/></Field>
        {session.role === 'admin' && <><Field label="Fecha" required><TextInput type="date" value={dayKey} onChange={(event) => setDayKey(event.target.value)}/></Field>{!session.routeId && <Field label="Origen" required><ChoiceButton label={selectedOrigin} placeholder="Administración, Impulsación o ruta" onClick={() => setRouteModal(true)}/></Field>}</>}
        {error && <p role="alert" className="text-xs font-bold text-rose-700">{error}</p>}
      </div>
    </Modal>
    <Modal isOpen={confirmOpen} onClose={() => { if (!busy && !operationPending) { setConfirmOpen(false); setFormOpen(true); setError('') } }} title="CONFIRMAR EGRESO" subtitle="Revisa antes de registrar." size="md" footer={<div className="grid grid-cols-2 gap-2"><SecondaryButton full disabled={busy || operationPending} onClick={() => { setError(''); setConfirmOpen(false); setFormOpen(true) }}>Corregir</SecondaryButton><PrimaryButton full disabled={busy || readOnlyPreview} onClick={() => void submit()}>{busy ? 'Registrando…' : operationPending ? 'Reintentar misma operación' : 'Confirmar y registrar'}</PrimaryButton></div>}>
      <div className="grid gap-3 text-sm">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-extrabold uppercase text-slate-500">Estás registrando</p><p className="mt-2 text-lg font-black">{distributorMeatPurchase ? 'Compra de carne a proveedor' : selectedPreset?.id === 'other_unsure' ? 'Otro / pendiente de revisión' : selectedChoice === 'production_input' ? 'Materia prima / producción' : selectedPreset?.label}</p>{distributorMeatPurchase ? <><p className="mt-1 text-sm font-bold text-slate-700">Proveedor: {purchaseSuppliers.find(supplier => supplier.id === purchaseSupplierId)?.name} · {Number(purchaseQuantity).toFixed(3)} kg × {formatBs(Number(purchaseUnitPrice))}/kg</p>{purchaseReceiptNumber.trim() && <p className="mt-1 text-xs text-slate-600">Comprobante: {purchaseReceiptNumber.trim()}</p>}</> : selectedChoice === 'production_input' && <p className="mt-1 text-sm font-bold text-slate-700">Categoría: {selectedPreset?.categoryName}</p>}<p className="mt-3 flex justify-between gap-3"><span>Total</span><strong>{formatBs(distributorMeatPurchase ? distributorPurchaseTotal : Number(amount))}</strong></p><p className="flex justify-between gap-3"><span>Forma de pago</span><strong>{paymentMethod === 'cash' ? 'Efectivo' : paymentMethod === 'transfer' ? 'QR / transferencia' : paymentMethod === 'credit' ? 'A crédito' : 'Otro'}</strong></p>{note.trim() && <p className="mt-2 break-words"><span className="text-slate-500">Detalle: </span><strong>{note.trim()}</strong></p>}</div>
        {selectedPreset?.classificationStatus === 'pending_review' ? <p className="rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-950">Este egreso quedará pendiente de revisión por Administración.</p> : selectedPreset?.economicType === 'production_input' ? <><p className="rounded-xl bg-emerald-50 p-3 text-xs font-semibold text-emerald-950">Esta compra se registrará como materia prima.</p><p className="text-xs text-slate-700">El dinero sí sale de caja si se paga en efectivo, pero no se descontará nuevamente de la ganancia porque su costo se reconocerá mediante los productos.</p></> : <><p className="rounded-xl bg-slate-50 p-3 text-xs font-semibold text-slate-800">{selectedPreset?.classificationSource === 'admin_review' ? 'Decisión de Administración' : 'Clasificación automática'}: {expenseGroupDisplayName(selectedPreset?.group, data.expenseGroups)} → {selectedPreset?.categoryName}.</p><p className="text-xs text-slate-700">Se descontará del Resultado del negocio.{paymentMethod === 'cash' ? ' También se descontará del efectivo esperado.' : ' No cambia el efectivo físico esperado.'}</p></>}
        {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-800">{error}</p>}
        {error && operationPending && <p className="rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-900">No cambies los datos ni generes otro registro todavía. Al reintentar se usará el mismo número de operación para evitar duplicados.</p>}
      </div>
    </Modal>
    <Modal isOpen={Boolean(voidTarget)} onClose={() => setVoidTarget(null)} title="Anular egreso" subtitle={voidTarget ? `${voidTarget.concept} · ${formatBs(voidTarget.amount)}` : ''} footer={<div className="grid grid-cols-2 gap-2"><SecondaryButton full onClick={() => setVoidTarget(null)}>Volver</SecondaryButton><PrimaryButton full disabled={busy || readOnlyPreview || !voidReason.trim()} onClick={async () => { if (!voidTarget) return; setBusy(true); try { await deleteExpense(voidTarget.id, voidReason.trim()); setFeedback('Egreso anulado con su motivo en auditoría.'); setVoidTarget(null) } catch (failure) { setError((failure as Error).message) } finally { setBusy(false) }}}>{busy ? 'Anulando…' : 'Confirmar anulación'}</PrimaryButton></div>}><p className="mb-2 text-sm">El registro no se borra; quedará fuera de los totales.</p><TextArea value={voidReason} onChange={(event) => setVoidReason(event.target.value)} placeholder="Motivo obligatorio"/>{error && <p role="alert" className="mt-2 text-xs text-rose-700">{error}</p>}</Modal>
    <Modal isOpen={Boolean(classifyTarget)} onClose={() => setClassifyTarget(null)} title="Revisar egreso histórico" subtitle={classifyTarget?.concept || ''} footer={<PrimaryButton full disabled={busy || readOnlyPreview || !classifyCategory || !classifyEconomicType} onClick={() => void classify()}>{busy ? 'Guardando…' : 'Guardar revisión'}</PrimaryButton>}><div className="grid gap-3"><p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">Se conservarán sin cambios el monto, fecha, origen, responsable y forma de pago. La decisión quedará en el historial.</p><Field label="Tipo de salida" required><Segmented value={classifyEconomicType} onChange={(value) => { const next = value as ExpenseEconomicType; setClassifyEconomicType(next); const nextGroup: ExpenseGroupId = next === 'production_input' ? groups.find(group => group.economicType === 'production_input')?.id || 'production_input' : groups.find(group => group.economicType === 'operating_expense')?.id || 'other'; setClassifyGroup(nextGroup); setClassifyCategory(categories.find((item) => item.group === nextGroup && item.active)?.id || '') }} options={[{value:'operating_expense',label:'Gasto operativo'},{value:'production_input',label:'Materia prima / producción'}]}/><p className="mt-1 text-xs text-slate-600">{classifyEconomicType === 'production_input' ? 'Se conserva como salida de dinero, pero no se descuenta de nuevo de la ganancia.' : 'Se descuenta del Resultado del negocio.'}</p></Field>{<Field label="Grupo"><select value={classifyGroup} onChange={(event) => { const next = event.target.value as ExpenseGroupId; setClassifyGroup(next); setClassifyCategory(categories.find((item) => item.group === next && item.active)?.id || '') }} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3">{groups.filter((item) => item.active && item.economicType === classifyEconomicType).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>}<Field label="Categoría"><select value={classifyCategory} onChange={(event) => setClassifyCategory(event.target.value)} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3">{categories.filter((item) => item.group === classifyGroup && item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>{classifyEconomicType === 'production_input' && <p className="rounded-xl bg-emerald-50 p-3 text-xs text-emerald-900">Pendiente de vincular a producción. Esto no impide guardar la clasificación.</p>}{error && <p role="alert" className="text-xs text-rose-700">{error}</p>}</div></Modal>
    <ExpenseConfigurationModal isOpen={categoriesOpen} onClose={() => setCategoriesOpen(false)} groups={groups} categories={categories} readOnly={readOnlyPreview} onSaveGroup={saveExpenseGroup} onSaved={(message) => { setFeedback(message); setError('') }} onError={(message) => setError(message)}/>
    <ChoiceModal isOpen={choiceModal} onClose={() => setChoiceModal(false)} title="¿En qué se gastó?" subtitle="Elige la opción que mejor describe la salida." options={topLevelChoices} selectedValue={selectedChoice} onSelect={(value) => { setSelectedChoice(value); setProductionPresetId(''); setNote(''); setError('') }}/>
    <ChoiceModal isOpen={productionChoiceModal} onClose={() => setProductionChoiceModal(false)} title="¿Qué se compró?" subtitle="Selecciona el tipo de insumo para producción." options={productionChoices} selectedValue={productionPresetId} onSelect={(value) => { setProductionPresetId(value); if (value === 'production_meat' && session.role === 'distributor') loadPurchaseSuppliers(); setNote(''); setError('') }}/>
    <Modal isOpen={groupCategoryOpen} onClose={() => setGroupCategoryOpen(false)} title="Seleccionar grupo y categoría" subtitle="Solo se muestran categorías activas de Administración." size="md"><div className="grid gap-3"><Field label="Grupo" required><select value={groupCategoryGroup} onChange={(event) => setGroupCategoryGroup(event.target.value)} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3">{groups.filter(group => group.active).map(group => <option key={group.id} value={group.id}>{group.label}</option>)}</select></Field><Field label="Categoría" required><select value={selectedChoice.startsWith('group-category:') ? selectedChoice.slice('group-category:'.length) : ''} onChange={(event) => { const category = categories.find(row => row.id === event.target.value); if (category) { setSelectedChoice(`group-category:${category.id}`); setProductionPresetId(''); setNote(''); setError('') } }} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3"><option value="">Selecciona una categoría</option>{categories.filter(category => category.active && category.group === groupCategoryGroup).map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field>{groups.find(group => group.id === groupCategoryGroup)?.economicType === 'production_input' && <p className="rounded-xl bg-emerald-50 p-3 text-xs text-emerald-900">Compra para producción: se registra como costo de insumo y no se descuenta otra vez del resultado.</p>}<PrimaryButton full disabled={!selectedChoice.startsWith('group-category:') || !categories.some(category => category.id === selectedChoice.slice('group-category:'.length) && category.group === groupCategoryGroup && category.active)} onClick={() => setGroupCategoryOpen(false)}>Usar categoría</PrimaryButton></div></Modal>
    <Modal isOpen={moreCategoriesOpen} onClose={() => setMoreCategoriesOpen(false)} title="Opciones frecuentes" subtitle="Elige una categoría activa; su grupo define cómo se contabiliza." size="lg"><div className="grid min-w-0 gap-4">{moreAdminPresetsByGroup.filter(group => group.presets.length > 0).map(group => <section key={group.id} className="min-w-0"><h3 className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">{group.label}</h3><div className="grid gap-2 sm:grid-cols-2">{group.presets.map(preset => <button key={preset.categoryId} type="button" onClick={() => { setSelectedChoice(preset.id); setProductionPresetId(''); setNote(''); setError(''); setMoreCategoriesOpen(false) }} className="min-h-12 min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm font-bold text-slate-800 hover:bg-slate-50">{preset.categoryName}</button>)}</div></section>)}{moreAdminPresetsByGroup.every(group => group.presets.length === 0) && <p className="text-sm text-slate-600">No hay más categorías activas.</p>}</div></Modal>
    <ChoiceModal isOpen={routeModal} onClose={() => setRouteModal(false)} title="Origen del egreso" searchable options={[{value:'administracion',label:'Administración'},{value:'route-impulsacion',label:'Impulsación'},...activeRoutes.filter((route) => !['route-directa','route-impulsacion','administracion','admin'].includes(route.id)).map((route) => ({value:route.id,label:route.name}))]} selectedValue={routeId} onSelect={(value) => { setRouteId(value); setRouteModal(false) }}/>
    </>}
  </Screen>
}
