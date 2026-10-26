import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Download, HandCoins, History, Printer, Search, Share2, ShieldAlert, UserPlus } from 'lucide-react'
import { RangePicker } from './RangePicker'
import { Modal } from '../../../components/ui/Modal'
import { ChoiceButton, ChoiceModal } from '../../../components/ui/ChoiceModal'
import { Field, NumberInput, Segmented, TextArea, TextInput } from '../../../components/ui/Form'
import { EmptyBlock, Screen } from '../../../components/ui/Screen'
import { toDayKey, round2 } from '../domain/engine'
import { buildProvisionalCollectionSnapshot } from '../domain/provisionalCollection'
import { creditPortfolioExportSheets } from '../domain/creditPortfolioReport'
import { adjustReceivable, loadCustomerCreditStatementData, newOperationId, registerCollection, registerOpeningBalance, saveCustomer, setCreditOverride, voidReceivable } from '../data/distributionRepository'
import { exportCustomerCreditStatement, exportExcel, exportPdf } from '../data/reportExports'
import {
  computeCreditPortfolioByRoute,
  allocateCreditBySubtotal,
  getRouteDisplayName,
  currentCustomerDisplayName,
  matchesCustomerCreditSearch,
  resolveCreditProducts,
  type CustomerCreditRouteView,
} from '../domain/creditRoutes'
import { CreditProducts } from './CreditProducts'
import { KpiCard, PrimaryButton, SecondaryButton, formatBs, formatQty } from './shared'
import type { DistributionViewProps } from './DistributionApp'
import type { DistCollection, DistReceivable, DistReceivableLineAdjustment, DistSaleLine, UnitType } from '../types'
import { printCollectionReceipt, printLargeCollectionReceipt, shareCollectionReceipt } from '../data/distributionReceiptService'
import { customerStatementFilename } from '../domain/customerCreditStatement'

/**
 * Cartera por cliente y cobranzas.
 * La interfaz trabaja por SALDO TOTAL DEL CLIENTE.
 * Permite filtrar por ruta de origen de la deuda para organización y control de cobros.
 * El servidor distribuye el pago FIFO entre las deudas activas del cliente.
 */
export function CreditsView({ session, data }: DistributionViewProps) {
  const customersById = useMemo(() => new Map(data.customers.map(customer => [customer.id, customer])), [data.customers])
  const customerDisplayName = (customerId: string, historicalName?: string) => currentCustomerDisplayName(customerId, historicalName, customersById)
  const [period, setPeriod] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [selectedRouteId, setSelectedRouteId] = useState<string>('all')
  const [isRouteModalOpen, setIsRouteModalOpen] = useState(false)
  const [selected, setSelected] = useState<CustomerCreditRouteView | null>(null)
  const [collectCustomer, setCollectCustomer] = useState<CustomerCreditRouteView | null>(null)
  const [openingBalanceOpen, setOpeningBalanceOpen] = useState(false)
  const [openingCustomerId, setOpeningCustomerId] = useState('')
  const [openingAmount, setOpeningAmount] = useState('')
  const [openingDate, setOpeningDate] = useState(toDayKey(new Date()))
  const [openingNote, setOpeningNote] = useState('')
  const [overrideCustomer, setOverrideCustomer] = useState<CustomerCreditRouteView | null>(null)
  const [overrideDays, setOverrideDays] = useState('1')
  const [overrideReason, setOverrideReason] = useState('')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<'cash' | 'qr' | 'mixed'>('cash')
  const [cashAmount, setCashAmount] = useState('')
  const [qrAmount, setQrAmount] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [lastCollection, setLastCollection] = useState<DistCollection | null>(null)
  const [receiptFeedback, setReceiptFeedback] = useState('')
  const [paidOpen, setPaidOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [statementCustomer, setStatementCustomer] = useState<CustomerCreditRouteView | null>(null)
  const [statementError, setStatementError] = useState('')
  const [statementExporting, setStatementExporting] = useState<'pdf' | 'excel' | null>(null)
  const [editingReceivable, setEditingReceivable] = useState<DistReceivable | null>(null)
  const [editAmount, setEditAmount] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editNote, setEditNote] = useState('')
  const [editReason, setEditReason] = useState('')
  const [editCreditLines, setEditCreditLines] = useState<DistReceivableLineAdjustment[]>([])
  const [editOriginalCreditLines, setEditOriginalCreditLines] = useState<DistReceivableLineAdjustment[]>([])
  const [voidingReceivable, setVoidingReceivable] = useState<DistReceivable | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [voidPhrase, setVoidPhrase] = useState('')
  const [voidConfirmationStep, setVoidConfirmationStep] = useState<1 | 2>(1)

  const [isCustomerPickerOpen, setIsCustomerPickerOpen] = useState(false)
  const [customerPickerSearch, setCustomerPickerSearch] = useState('')
  const [isNewCustomerOpen, setIsNewCustomerOpen] = useState(false)
  const [newCustName, setNewCustName] = useState('')
  const [newCustCI, setNewCustCI] = useState('')
  const [newCustPhone, setNewCustPhone] = useState('')
  const [newCustAddress, setNewCustAddress] = useState('')
  const [newCustRouteId, setNewCustRouteId] = useState('')
  const [isCreatingCustomer, setIsCreatingCustomer] = useState(false)
  const [customerCreateError, setCustomerCreateError] = useState<string | null>(null)

  const filteredPickerCustomers = useMemo(() => {
    const term = customerPickerSearch.trim().toLowerCase()
    const active = data.customers.filter((c) => c.active !== false)
    if (!term) return active
    return active.filter(
      (c) =>
        c.name.toLowerCase().includes(term) ||
        (c.identityNumber && c.identityNumber.toLowerCase().includes(term)) ||
        (c.customerCode && c.customerCode.toLowerCase().includes(term)) ||
        (c.phone && c.phone.toLowerCase().includes(term)),
    )
  }, [data.customers, customerPickerSearch])

  const salesById = useMemo(() => new Map(data.sales.map((s) => [s.id, s])), [data.sales])

  const pendingProductSummary = useMemo(() => {
    if (!selected) return []
    const summary = new Map<string, { name: string; presentation: string; unitType: string; quantity: number }>()
    for (const receivable of selected.allReceivables) {
      const isVoid = Boolean(receivable.voided || receivable.status === 'VOID' || receivable.voidedAt || receivable.voidReason || (receivable as unknown as Record<string, unknown>).isVoid || receivable.note?.toLowerCase().includes('anulad'))
      if (isVoid || receivable.sourceType === 'opening_balance' || Number(receivable.balance) <= 0) continue
      const sale = salesById.get(receivable.saleId || '')
      for (const line of resolveCreditProducts(receivable, sale).lines) {
        const presentation = line.presentationSnapshot || ''
        const key = `${line.productId}__${presentation}__${line.unitType}`
        const existing = summary.get(key)
        summary.set(key, { name: line.productNameSnapshot || 'Producto histórico', presentation, unitType: line.unitType, quantity: round2((existing?.quantity || 0) + Number(line.quantity || 0)) })
      }
    }
    return [...summary.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [selected, salesById])

  const creditLineDetails = (receivable: DistReceivable): DistReceivableLineAdjustment[] => {
    if (receivable.adjustedSaleLines?.length) return receivable.adjustedSaleLines
    const linkedSale = salesById.get(receivable.saleId || '')
    const lines = receivable.saleLines?.length ? receivable.saleLines : linkedSale?.effectiveSnapshot?.lines || linkedSale?.lines || []
    const allocation = allocateCreditBySubtotal(lines, receivable.originalAmount)
    return lines.map((line, index) => ({
      productId: line.productId,
      productNameSnapshot: line.productNameSnapshot,
      presentationSnapshot: line.presentationSnapshot,
      quantity: line.quantity,
      unitType: line.unitType,
      creditAmount: allocation[index] || 0,
    }))
  }

  const beginReceivableEdit = (receivable: DistReceivable) => {
    setError(null)
    setEditingReceivable(receivable)
    setEditAmount(String(receivable.originalAmount))
    setEditDate(receivable.sourceDate || toDayKey(new Date(receivable.createdAt)))
    setEditNote(receivable.note || '')
    setEditReason('')
    const lines: DistSaleLine[] = receivable.saleLines?.length
      ? receivable.saleLines
      : (salesById.get(receivable.saleId || '')?.effectiveSnapshot?.lines || salesById.get(receivable.saleId || '')?.lines || [])
    const allocation = receivable.adjustedSaleLines?.length
      ? receivable.adjustedSaleLines.map((line) => Number(line.creditAmount) || 0)
      : allocateCreditBySubtotal(lines, receivable.originalAmount)
    setEditCreditLines(lines.map((line, index) => ({
      productId: line.productId,
      productNameSnapshot: line.productNameSnapshot,
      presentationSnapshot: line.presentationSnapshot,
      quantity: line.quantity,
      unitType: line.unitType,
      creditAmount: allocation[index] || 0,
    })))
    setEditOriginalCreditLines(lines.map((line, index) => ({
      productId: line.productId,
      productNameSnapshot: line.productNameSnapshot,
      presentationSnapshot: line.presentationSnapshot,
      quantity: line.quantity,
      unitType: line.unitType,
      creditAmount: allocation[index] || 0,
    })))
  }

  const submitReceivableEdit = async () => {
    if (!editingReceivable) return
    const value = round2(Number(editAmount))
    const totalLines = round2(editCreditLines.reduce((sum, line) => sum + Number(line.creditAmount || 0), 0))
    if (!editReason.trim() || !Number.isFinite(value) || value <= 0 || value < Number(editingReceivable.paidAmount)) {
      setError('Indica un motivo y un monto mayor a cero que no sea menor a lo ya cobrado.')
      return
    }
    if (editingReceivable.sourceType !== 'opening_balance' && editCreditLines.length && totalLines !== value) {
      setError('La suma asignada a los productos debe coincidir exactamente con el nuevo monto de la deuda.')
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      await adjustReceivable({
        receivableId: editingReceivable.id,
        originalAmount: value,
        reason: editReason.trim(),
        ...(editingReceivable.sourceType === 'opening_balance' ? { sourceDate: editDate, note: editNote.trim() } : {}),
        adjustedSaleLines: editingReceivable.sourceType === 'opening_balance' ? [] : editCreditLines.map(({ productId, creditAmount }) => ({ productId, creditAmount: round2(Number(creditAmount)) })),
      })
      setEditingReceivable(null)
      setSelected(null)
      setToast('Deuda actualizada. La venta y el inventario no fueron modificados.')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const submitReceivableVoid = async () => {
    if (!voidingReceivable) return
    if (!voidReason.trim() || voidPhrase !== 'ELIMINAR DEUDA') {
      setError('Escribe el motivo y la frase exacta ELIMINAR DEUDA.')
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      await voidReceivable({ receivableId: voidingReceivable.id, reason: voidReason.trim(), confirmationText: voidPhrase })
      setVoidingReceivable(null)
      setSelected(null)
      setToast('Deuda anulada y guardada en el historial. La venta y el inventario no fueron modificados.')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const { customerCredits, totalOutstanding, totalCustomersWithBalance, availableRoutes } = useMemo(() => {
    return computeCreditPortfolioByRoute({
      receivables: data.receivables,
      selectedRouteId,
      routes: data.routes,
      customers: data.customers,
      salesById,
      period,
    })
  }, [data.receivables, selectedRouteId, data.routes, data.customers, salesById, period])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return term
      ? customerCredits.filter((entry) => matchesCustomerCreditSearch(entry, term))
      : customerCredits
  }, [customerCredits, search])

  const grandTotalBalance = useMemo(() => computeCreditPortfolioByRoute({
    receivables: data.receivables,
    selectedRouteId: 'all',
    routes: data.routes,
    customers: data.customers,
    salesById,
    period,
  }).totalOutstanding, [data.receivables, data.routes, data.customers, salesById, period])

  const exportCredits = async (kind: 'pdf' | 'excel') => {
    setExporting(true)
    setExportError('')
    try {
      const generatedAt = new Date().toLocaleString('es-BO', { timeZone: 'America/La_Paz' })
      const sheets = creditPortfolioExportSheets({
        entries: filtered,
        routeName: selectedRouteName,
        period,
        searchTerm: search,
        generatedAt,
      })
      const scope = period.length
        ? `saldo actual de créditos originados entre ${period[0]} y ${period.at(-1)}`
        : 'cartera pendiente actual de todos los períodos'
      const description = `${selectedRouteName} · ${scope}${search.trim() ? ` · búsqueda: ${search.trim()}` : ''} · generado ${generatedAt}`
      const safeScope = `${selectedRouteId}-${period[0] || 'todo'}-${period.at(-1) || 'actual'}`.replace(/[^\p{L}\p{N}-]+/gu, '-')
      if (kind === 'pdf') await exportPdf(sheets, description, `SanJose-creditos-${safeScope}.pdf`)
      else await exportExcel(sheets, description, `SanJose-creditos-${safeScope}.xlsx`)
    } catch (exportFailure) {
      setExportError((exportFailure as Error).message)
    } finally {
      setExporting(false)
    }
  }

  const exportCustomerStatement = async (entry: CustomerCreditRouteView, kind: 'pdf' | 'excel') => {
    if (statementExporting) return
    setStatementExporting(kind)
    setStatementError('')
    try {
      const distributorUid = session.role === 'distributor' ? session.uid : undefined
      const sources = await loadCustomerCreditStatementData(entry.customerId, distributorUid)
      const customer = data.customers.find((item) => item.id === entry.customerId)
      const salesById = new Map([...data.sales, ...sources.sales].map((sale) => [sale.id, sale]))
      const customerForStatement = {
        id: entry.customerId,
        name: currentCustomerDisplayName(entry.customerId, entry.customerName, customersById),
        identityNumber: customer?.identityNumber || entry.identityNumber,
        customerCode: customer?.customerCode || entry.customerCode,
      }
      const filename = customerStatementFilename(customerForStatement.name, entry.customerId, kind === 'pdf' ? 'pdf' : 'xlsx')
      await exportCustomerCreditStatement({
        customer: customerForStatement,
        receivables: sources.receivables,
        collections: sources.collections,
        adjustments: session.can('dist.credit.adjust') ? data.receivableAdjustments : [],
        routes: data.routes,
        salesById,
        adjustmentsAvailable: session.can('dist.credit.adjust'),
      }, filename, kind)
      setStatementCustomer(null)
    } catch (exportFailure) {
      setStatementError((exportFailure as Error).message || 'No se pudo generar el estado de cuenta completo. Verifica la conexión y vuelve a intentar.')
    } finally {
      setStatementExporting(null)
    }
  }

  const [collectionReferenceDebt, setCollectionReferenceDebt] = useState<number | undefined>(undefined)
  const [confirmingCollection, setConfirmingCollection] = useState(false)

  const openCustomerCollection = (entry: CustomerCreditRouteView, referenceDebt?: number) => {
    setCollectCustomer(entry)
    const suggested = referenceDebt !== undefined ? Math.min(referenceDebt, entry.totalBalance) : entry.filteredBalance || entry.totalBalance
    setCollectionReferenceDebt(referenceDebt !== undefined ? Math.min(referenceDebt, entry.totalBalance) : undefined)
    setAmount(String(suggested))
    setMethod('cash')
    setCashAmount(String(suggested))
    setQrAmount('0')
    setNote('')
    setError(null)
    setConfirmingCollection(false)
  }

  const handleAmountChange = (newVal: string) => {
    setAmount(newVal)
    if (method === 'cash') {
      setCashAmount(newVal)
      setQrAmount('0')
    } else if (method === 'qr') {
      setQrAmount(newVal)
      setCashAmount('0')
    }
  }

  const handleMethodChange = (newMethod: 'cash' | 'qr' | 'mixed') => {
    setMethod(newMethod)
    if (newMethod === 'cash') {
      setCashAmount(amount)
      setQrAmount('0')
    } else if (newMethod === 'qr') {
      setQrAmount(amount)
      setCashAmount('0')
    }
  }

  const requestCollectionConfirmation = () => {
    if (!collectCustomer || isSubmitting) return
    const value = round2(Number(amount))
    if (!(value > 0)) {
      setError('Ingresa el monto que realmente vas a cobrar.')
      return
    }
    if (value > collectCustomer.totalBalance) {
      setError(`El monto no puede superar la deuda total del cliente (${formatBs(collectCustomer.totalBalance)}).`)
      return
    }

    const cash = method === 'cash' ? value : method === 'qr' ? 0 : round2(Number(cashAmount))
    const qr = method === 'qr' ? value : method === 'cash' ? 0 : round2(Number(qrAmount))
    if (cash < 0 || qr < 0 || round2(cash + qr) !== value || (method === 'mixed' && (!(cash > 0) || !(qr > 0)))) {
      setError('El efectivo y el QR deben ser mayores a cero y sumar exactamente el monto cobrado.')
      return
    }

    setError(null)
    setConfirmingCollection(true)
  }

  const executeConfirmedCollection = async () => {
    if (!collectCustomer || isSubmitting) return
    const value = round2(Number(amount))
    if (!(value > 0)) {
      setError('Ingresa el monto que realmente vas a cobrar.')
      setConfirmingCollection(false)
      return
    }
    if (value > collectCustomer.totalBalance) {
      setError(`El monto no puede superar la deuda total del cliente (${formatBs(collectCustomer.totalBalance)}).`)
      setConfirmingCollection(false)
      return
    }

    const cash = method === 'cash' ? value : method === 'qr' ? 0 : round2(Number(cashAmount))
    const qr = method === 'qr' ? value : method === 'cash' ? 0 : round2(Number(qrAmount))
    if (cash < 0 || qr < 0 || round2(cash + qr) !== value || (method === 'mixed' && (!(cash > 0) || !(qr > 0)))) {
      setError('El efectivo y el QR deben ser mayores a cero y sumar exactamente el monto cobrado.')
      setConfirmingCollection(false)
      return
    }

    setIsSubmitting(true)
    setError(null)
    try {
      const customer = data.customers.find((item) => item.id === collectCustomer.customerId)
      const provisionalSnapshot = buildProvisionalCollectionSnapshot(
        collectCustomer.allReceivables,
        value,
        customer?.customerCode || customer?.identityNumber || collectCustomer.customerCode || collectCustomer.identityNumber,
      )
      const oldestDebt = collectCustomer.allReceivables.find((item) => item.id === provisionalSnapshot.receivableId)

      const registered = await registerCollection({
        operationId: newOperationId('col'),
        customerId: collectCustomer.customerId,
        customerName: customerDisplayName(collectCustomer.customerId, collectCustomer.customerName),
        receivable: oldestDebt,
        amount: value,
        method,
        cashAmount: cash,
        qrAmount: qr,
        collectedByUid: session.uid,
        collectedByName: session.userName,
        routeId: session.routeId || oldestDebt?.routeId || '',
        note,
        provisionalSnapshot,
      })
      setConfirmingCollection(false)
      setCollectCustomer(null)
      setSelected(null)
      setLastCollection(registered)
      setReceiptFeedback('')
    } catch (submitError) {
      setError((submitError as Error).message || 'No se pudo registrar el cobro.')
      setConfirmingCollection(false)
    } finally {
      setIsSubmitting(false)
    }
  }

  const receiptContext = {
    companyName: data.supportSettings.companyName || session.restaurantName,
    receiptHeader: data.supportSettings.receiptHeader,
    receiptFooter: data.supportSettings.receiptFooter,
    taxId: data.supportSettings.taxId,
    address: data.supportSettings.address,
    phone: data.supportSettings.phone,
    routeName: data.routes.find((route) => route.id === session.routeId)?.name || 'Administración',
    distributorName: session.userName,
  }

  const printCollection = async (collection: DistCollection) => {
    setReceiptFeedback('')
    const result = await printCollectionReceipt(collection, receiptContext, true)
    setReceiptFeedback(result.message)
  }

  const submitOpeningBalance = async () => {
    const value = round2(Number(openingAmount))
    if (!openingCustomerId || !(value > 0) || !openingNote.trim()) {
      setError('Selecciona cliente, monto y describe el origen de la deuda.')
      return
    }
    setIsSubmitting(true)
    try {
      await registerOpeningBalance({
        customerId: openingCustomerId,
        amount: value,
        sourceDate: openingDate,
        note: openingNote.trim(),
      })
      setOpeningBalanceOpen(false)
      setOpeningAmount('')
      setOpeningNote('')
      setToast('Deuda anterior registrada exitosamente.')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const nowIso = new Date().toISOString()
  const activeOverride = selected
    ? data.creditOverrides.find((o) => o.customerId === selected.customerId && !o.revokedAt && o.activeUntil > nowIso)
    : null

  const selectedRouteName =
    selectedRouteId === 'all' || !selectedRouteId
      ? 'Todas las rutas'
      : availableRoutes.find((r) => r.id === selectedRouteId)?.name || 'Ruta seleccionada'

  return (
    <Screen
      title="Créditos"
      subtitle="Cartera general de clientes por saldo total"
      actions={
        session.role === 'admin' ? (
          <PrimaryButton
            onClick={() => {
              setOpeningBalanceOpen(true)
              setError(null)
            }}
          >
            Saldo anterior
          </PrimaryButton>
        ) : undefined
      }
    >
      <div className="grid w-full min-w-0 gap-3">
        {toast && (
          <div className="flex items-center justify-between rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-800">
            <span>{toast}</span>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="ml-2 text-emerald-600 hover:text-emerald-900"
            >
              ✕
            </button>
          </div>
        )}

        <p className="text-xs text-slate-600">
          La cobranza amortiza la deuda total del cliente. El sistema distribuye automáticamente el abono a las ventas más antiguas.
        </p>

        {/* Filtro de Ruta */}
        <div className="w-full">
          <ChoiceButton
            label={selectedRouteName}
            description={
              selectedRouteId === 'all' || !selectedRouteId
                ? `Cartera general completa (${formatBs(totalOutstanding)})`
                : `Filtrando por ${selectedRouteName} (${formatBs(totalOutstanding)})`
            }
            placeholder="Selecciona ruta"
            onClick={() => setIsRouteModalOpen(true)}
          />
        </div>

        <RangePicker dayKeys={period.length ? period : [toDayKey(new Date())]} onChange={setPeriod} />
        <p className="-mt-1 text-[11px] leading-4 text-slate-500">
          {period.length
            ? 'El período selecciona la fecha de origen del crédito; los importes muestran el saldo pendiente actual de esas cuentas, no un saldo histórico al cierre del período.'
            : 'Se muestra la cartera pendiente actual. Selecciona un período para consultar el saldo actual de los créditos originados en esas fechas.'}
        </p>
        <button className="text-left text-sm font-bold text-[var(--primary)]" onClick={() => setPeriod([])}>
          {period.length ? 'Ver todos los créditos' : 'Mostrando todos los créditos'}
        </button>

        <div className="grid grid-cols-2 gap-2">
          <KpiCard
            label={selectedRouteId === 'all' || !selectedRouteId ? 'Cartera pendiente' : `Cartera (${selectedRouteName})`}
            value={formatBs(totalOutstanding)}
            tone="warning"
          />
          <KpiCard
            label="Clientes con saldo"
            value={String(totalCustomersWithBalance)}
          />
        </div>
        <p className="-mt-1 text-center text-[10px] leading-4 text-slate-500">
          PDF y Excel incluirán los clientes visibles según ruta, período y búsqueda.
        </p>

        <div className="grid grid-cols-2 gap-2">
          <SecondaryButton disabled={exporting} onClick={() => void exportCredits('pdf')}>
            Descargar PDF
          </SecondaryButton>
          <SecondaryButton disabled={exporting} onClick={() => void exportCredits('excel')}>
            Descargar Excel
          </SecondaryButton>
        </div>
        {exportError && (
          <p role="alert" className="text-xs font-bold text-rose-700">
            {exportError}
          </p>
        )}

        <div className="relative w-full">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <TextInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar cliente..."
            className="pl-9"
          />
        </div>

        {filtered.length === 0 && <EmptyBlock title="Sin créditos registrados" />}

        <div className="grid gap-2">
          {filtered.map((entry) => {
            const hasOpeningBalance = entry.filteredReceivables.some(
              (r) => r.sourceType === 'opening_balance' && r.balance > 0,
            )
            const openingDebtSum = entry.filteredReceivables
              .filter((r) => r.sourceType === 'opening_balance' && r.balance > 0)
              .reduce((sum, r) => sum + r.balance, 0)
            const overrideActive = data.creditOverrides.some(
              (o) => o.customerId === entry.customerId && !o.revokedAt && o.activeUntil > nowIso,
            )

            const isCrossRoute =
              entry.totalBalance > entry.filteredBalance &&
              entry.filteredBalance > 0 &&
              selectedRouteId !== 'all' &&
              Boolean(selectedRouteId)

            return (
              <div
                key={entry.customerId}
                className="flex w-full min-w-0 flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-1 items-start gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setSelected(entry)
                    setPaidOpen(false)
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex items-center gap-2">
                    <p className="break-words text-sm font-extrabold text-slate-900">{entry.customerName}</p>
                    {overrideActive && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-black text-amber-800">
                        AUTORIZADO
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    {entry.customerCode || entry.identityNumber}
                  </p>

                  {/* Detalle de ruta de origen */}
                  <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-slate-600">
                    {selectedRouteId && selectedRouteId !== 'all' ? (
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-bold text-slate-700">
                        Ruta: {selectedRouteName}
                      </span>
                    ) : entry.routes.length === 1 ? (
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-bold text-slate-700">
                        Ruta: {entry.routes[0].routeName}
                      </span>
                    ) : entry.routes.length > 1 ? (
                      <span className="rounded-md bg-amber-50 px-1.5 py-0.5 font-bold text-amber-800">
                        {entry.routes.map((r) => `${r.routeName}: ${formatBs(r.balance)}`).join(' · ')}
                      </span>
                    ) : null}
                  </div>

                  {isCrossRoute && (
                    <p className="mt-0.5 text-[11px] font-semibold text-slate-500">
                      Deuda total del cliente: {formatBs(entry.totalBalance)}
                    </p>
                  )}

                  <p className="text-[11px] font-semibold text-slate-400">
                    Último movimiento: {new Date(entry.lastMovementAt).toLocaleDateString('es-BO')}
                  </p>
                  {hasOpeningBalance && (
                    <p className="mt-1 text-[11px] font-bold text-amber-700">
                      Deuda anterior pendiente: {formatBs(openingDebtSum)}
                    </p>
                  )}
                </button>
                <button
                  type="button"
                  aria-label={`Descargar estado de cuenta de ${entry.customerName}`}
                  title="Descargar cartera completa del cliente"
                  disabled={statementExporting !== null}
                  onClick={() => { setStatementCustomer(entry); setStatementError('') }}
                  className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  <Download size={16} />
                </button>
                </div>

                <div className="flex shrink-0 items-center justify-between gap-3 sm:flex-col sm:items-end sm:justify-center">
                  <div className="text-right">
                    <p className="text-[10px] font-bold uppercase text-slate-400">
                      {selectedRouteId !== 'all' && selectedRouteId ? 'En esta ruta' : 'Deuda pendiente'}
                    </p>
                    <span
                      className={`text-base font-black tabular-nums ${
                        entry.filteredBalance > 0 ? 'text-[var(--primary)]' : 'text-emerald-600'
                      }`}
                    >
                      {formatBs(entry.filteredBalance)}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    {hasOpeningBalance && session.can('dist.collection.create') && (
                      <button
                        type="button"
                        onClick={() => openCustomerCollection(entry, openingDebtSum)}
                        className="rounded-xl border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-extrabold text-amber-900 hover:bg-amber-100"
                      >
                        Cobrar deuda anterior
                      </button>
                    )}
                    {entry.filteredBalance > 0 && session.can('dist.collection.create') && (
                      <button
                        type="button"
                        onClick={() => openCustomerCollection(entry, entry.filteredBalance)}
                        className="flex items-center gap-1 rounded-xl bg-[var(--primary)] px-3 py-1 text-xs font-extrabold text-white hover:opacity-90"
                      >
                        <HandCoins size={13} /> Cobrar
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <Modal
        isOpen={Boolean(statementCustomer)}
        onClose={() => { if (!statementExporting) { setStatementCustomer(null); setStatementError('') } }}
        title="Descargar estado de cuenta"
        subtitle={statementCustomer ? customerDisplayName(statementCustomer.customerId, statementCustomer.customerName) : undefined}
        size="sm"
      >
        <div className="grid gap-3">
          <p className="text-xs leading-5 text-slate-600">Se incluirá la cartera vigente completa del cliente y su historial confirmado, sin aplicar los filtros de fecha o ruta usados para localizarlo.</p>
          {session.role === 'distributor' && <p className="rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-[11px] font-semibold text-amber-900">El documento se limita a las deudas y cobros autorizados para esta cuenta.</p>}
          {statementError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs font-bold text-rose-800">{statementError}</p>}
          <div className="grid grid-cols-2 gap-2">
            <SecondaryButton disabled={statementExporting !== null} onClick={() => statementCustomer && void exportCustomerStatement(statementCustomer, 'pdf')}>
              {statementExporting === 'pdf' ? 'Generando…' : 'Descargar PDF'}
            </SecondaryButton>
            <SecondaryButton disabled={statementExporting !== null} onClick={() => statementCustomer && void exportCustomerStatement(statementCustomer, 'excel')}>
              {statementExporting === 'excel' ? 'Generando…' : 'Descargar Excel'}
            </SecondaryButton>
          </div>
        </div>
      </Modal>

      {/* Modal de Selector de Ruta */}
      <ChoiceModal
        isOpen={isRouteModalOpen}
        onClose={() => setIsRouteModalOpen(false)}
        title="Ruta de cartera"
        subtitle="Filtra clientes y deudas por la ruta de origen del crédito"
        searchable
        options={[
          {
            value: 'all',
            label: 'Todas las rutas',
            description: 'Cartera general completa',
            trailing: formatBs(grandTotalBalance),
          },
          ...availableRoutes.map((r) => ({
            value: r.id,
            label: r.name,
            description: `${r.customerCount} cliente${r.customerCount === 1 ? '' : 's'} con saldo`,
            trailing: formatBs(r.totalBalance),
          })),
        ]}
        selectedValue={selectedRouteId || 'all'}
        onSelect={(val) => {
          setSelectedRouteId(val)
          setIsRouteModalOpen(false)
        }}
      />

      {/* Modal de Detalle de Cartera del Cliente */}
      <Modal
        isOpen={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? customerDisplayName(selected.customerId, selected.customerName) : ''}
        subtitle={
          selected
            ? selectedRouteId !== 'all' && selectedRouteId
              ? `Deuda en ${selectedRouteName}: ${formatBs(selected.filteredBalance)} · Deuda total: ${formatBs(selected.totalBalance)}`
              : `Deuda total acumulada: ${formatBs(selected.totalBalance)}`
            : ''
        }
        size="lg"
      >
        {selected && (
          <div className="grid gap-3">
            {activeOverride && (
              <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 shadow-sm">
                <div className="flex items-center gap-2 font-black uppercase tracking-wide text-amber-800">
                  <ShieldAlert size={16} /> AUTORIZADO TEMPORALMENTE
                </div>
                <p className="mt-1 font-bold">
                  Por: {activeOverride.grantedByName || 'Administración'} · Válido hasta:{' '}
                  {new Date(activeOverride.activeUntil).toLocaleString('es-BO')}
                </p>
                {activeOverride.reason && (
                  <p className="mt-0.5 text-[11px] text-amber-700 italic">Motivo: {activeOverride.reason}</p>
                )}
              </div>
            )}

            {selected.totalBalance > 0 && <section className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-3">
              <h3 className="text-[10px] font-black uppercase tracking-wide text-indigo-900">Productos en créditos pendientes</h3>
              <p className="mt-1 text-[10px] leading-relaxed text-indigo-800">Son las cantidades originales de ventas que aún conservan saldo. Los abonos se aplican a la deuda completa; no se atribuye el saldo a un producto específico.</p>
              {pendingProductSummary.length ? <div className="mt-2 grid gap-1.5 sm:grid-cols-2">{pendingProductSummary.map((item) => <div key={`${item.name}-${item.presentation}-${item.unitType}`} className="flex min-w-0 items-center justify-between gap-2 rounded-xl bg-white px-2.5 py-2 text-xs"><span className="min-w-0 break-words font-bold text-slate-800">{item.name}{item.presentation ? ` · ${item.presentation}` : ''}</span><strong className="shrink-0 tabular-nums text-indigo-900">{formatQty(item.quantity, item.unitType as UnitType)}</strong></div>)}</div> : <p className="mt-2 text-xs font-semibold text-slate-600">Los saldos pendientes no tienen detalle de productos recuperable.</p>}
            </section>}

            {selected.totalBalance > 0 && session.can('dist.collection.create') && (
              <button
                type="button"
                onClick={() => openCustomerCollection(selected, selected.filteredBalance || selected.totalBalance)}
                className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl text-xs font-black text-white shadow-sm"
                style={{ backgroundColor: 'var(--primary)' }}
              >
                <HandCoins size={16} /> REGISTRAR COBRO (DEUDA TOTAL: {formatBs(selected.totalBalance)})
              </button>
            )}

            {selected.allReceivables.some((r) => r.sourceType === 'opening_balance' && r.balance > 0) &&
              session.can('dist.collection.create') && (
                <button
                  type="button"
                  onClick={() => {
                    const debtSum = selected.allReceivables
                      .filter((r) => r.sourceType === 'opening_balance' && r.balance > 0)
                      .reduce((sum, r) => sum + r.balance, 0)
                    openCustomerCollection(selected, debtSum)
                  }}
                  className="flex min-h-[40px] w-full items-center justify-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 text-xs font-extrabold text-amber-900 shadow-sm hover:bg-amber-100"
                >
                  <HandCoins size={15} /> Cobrar deuda anterior (
                  {formatBs(
                    selected.allReceivables
                      .filter((r) => r.sourceType === 'opening_balance' && r.balance > 0)
                      .reduce((sum, r) => sum + r.balance, 0),
                  )}
                  )
                </button>
              )}

            {session.role === 'admin' && (
              <div className="grid grid-cols-2 gap-2">
                {activeOverride ? (
                  <SecondaryButton
                    onClick={async () => {
                      try {
                        await setCreditOverride({ customerId: selected.customerId, revoke: true })
                        setToast('Autorización temporal retirada')
                      } catch (e) {
                        setError((e as Error).message)
                      }
                    }}
                  >
                    Revocar permiso
                  </SecondaryButton>
                ) : (
                  <SecondaryButton
                    onClick={() => {
                      setOverrideCustomer(selected)
                      setOverrideDays('1')
                      setOverrideReason('')
                    }}
                  >
                    Autorizar temporalmente
                  </SecondaryButton>
                )}
              </div>
            )}

            <div className="grid gap-2">
              <p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">Origen de las deudas</p>
              {selected.allReceivables
                .slice()
                .sort((a, b) => (b.sourceDate || b.createdAt).localeCompare(a.sourceDate || a.createdAt))
                .filter((r) => r.balance > 0 || paidOpen || r.voided === true)
                .map((receivable) => {
                  const isVoid = Boolean(
                    receivable.voided || receivable.status === 'VOID' ||
                    (receivable as unknown as Record<string, unknown>).voidedAt ||
                      (receivable as unknown as Record<string, unknown>).voidReason ||
                      (receivable as unknown as Record<string, unknown>).isVoid ||
                      receivable.note?.toLowerCase().includes('anulad'),
                  )
                  const isOpening = receivable.sourceType === 'opening_balance'

                  return (
                    <div key={receivable.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-xs font-extrabold text-slate-900">
                              {isOpening ? 'Saldo inicial / Deuda anterior' : isVoid ? 'Venta anulada' : 'Venta a crédito'}
                            </p>
                            {isVoid && (
                              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[9px] font-black text-rose-800">
                                ANULADA
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] font-semibold text-slate-500">
                            {new Date(receivable.sourceDate || receivable.createdAt).toLocaleDateString('es-BO')} ·{' '}
                            {receivable.distributorName || 'Registro anterior'}
                            {receivable.routeId && (
                              <span> · {getRouteDisplayName(receivable.routeId, data.routes)}</span>
                            )}
                          </p>
                          {receivable.note && (
                            <p className="mt-0.5 text-[11px] text-slate-500 italic">{receivable.note}</p>
                          )}

                          {/* Detalle de productos cuando no es opening balance */}
                          {!isOpening && (
                            <CreditProducts
                              lines={receivable.saleLines}
                              creditLines={creditLineDetails(receivable)}
                              saleId={receivable.saleId}
                              isVoid={isVoid}
                            />
                          )}

                          <p className="mt-1 text-[11px] font-semibold text-slate-600">
                            Monto original: {formatBs(receivable.originalAmount)} · Pagado: {formatBs(receivable.paidAmount)}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <span
                            className={`text-xs font-black tabular-nums ${
                              receivable.balance > 0 ? 'text-[var(--primary)]' : 'text-emerald-600'
                            }`}
                          >
                            Saldo: {formatBs(receivable.balance)}
                          </span>
                        </div>
                      </div>
                      {session.can('dist.credit.adjust') && !isVoid && (
                        <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-2">
                          <SecondaryButton onClick={() => beginReceivableEdit(receivable)}>Editar deuda</SecondaryButton>
                          {Number(receivable.paidAmount) === 0 ? (
                            <button
                              type="button"
                              className="min-h-[38px] rounded-xl border border-rose-200 px-3 text-xs font-extrabold text-rose-700"
                              onClick={() => { setVoidingReceivable(receivable); setVoidReason(''); setVoidPhrase(''); setVoidConfirmationStep(1); setError(null) }}
                            >Eliminar deuda</button>
                          ) : (
                            <span className="self-center text-[10px] font-semibold text-slate-500">No se puede anular: ya tiene pagos aplicados.</span>
                          )}
                        </div>
                      )}
                      {isVoid && receivable.voidReason && <p className="mt-2 text-[11px] font-semibold text-rose-700">Motivo de anulación: {receivable.voidReason}</p>}
                      {session.can('dist.credit.adjust') && data.receivableAdjustments.some((adjustment) => adjustment.receivableId === receivable.id) && (
                        <details className="mt-2 border-t border-slate-100 pt-2 text-[11px]">
                          <summary className="cursor-pointer font-extrabold text-slate-600">Historial de cambios de esta deuda</summary>
                          <div className="mt-2 grid gap-2">
                            {data.receivableAdjustments.filter((adjustment) => adjustment.receivableId === receivable.id).sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt)).map((adjustment) => (
                              <div key={adjustment.id} className="rounded-lg bg-slate-50 p-2 text-slate-700">
                                <p className="font-bold">{adjustment.action === 'void' ? 'Deuda anulada' : 'Deuda editada'} · {new Date(adjustment.effectiveAt).toLocaleString('es-BO')} · {adjustment.actorName || 'Administración'}</p>
                                <p>{formatBs(adjustment.previous.originalAmount)} → {formatBs(adjustment.next.originalAmount)} · Saldo {formatBs(adjustment.previous.balance)} → {formatBs(adjustment.next.balance)}</p>
                                {adjustment.action === 'edit' && adjustment.next.adjustedSaleLines?.length > 0 && <p>{adjustment.next.adjustedSaleLines.map((line, index) => `${line.productNameSnapshot}: ${formatBs(adjustment.previous.adjustedSaleLines?.[index]?.creditAmount || 0)} → ${formatBs(line.creditAmount)}`).join(' · ')}</p>}
                                <p className="italic">Motivo: {adjustment.reason}</p>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  )
                })}

              {selected.allReceivables.some((r) => r.balance <= 0) && (
                <button
                  type="button"
                  onClick={() => setPaidOpen((value) => !value)}
                  className="mt-1 flex min-h-[40px] w-full items-center justify-between rounded-2xl border border-slate-200 px-3 text-left text-xs font-extrabold text-slate-700"
                >
                  <span>Créditos saldados ({selected.allReceivables.filter((r) => r.balance <= 0).length})</span>
                  {paidOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wide text-slate-500">
                <History size={14} /> Historial de pagos
              </div>
              <div className="grid gap-2">
                {data.collections
                  .filter((collection) => collection.customerId === selected.customerId)
                  .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                  .map((collection) => (
                    <div key={collection.id} className="rounded-xl border border-slate-200 bg-white p-2.5 text-[11px]">
                      <div className="flex items-center justify-between font-bold text-slate-900">
                        <span>{new Date(collection.createdAt).toLocaleString('es-BO')}</span>
                        <span className="text-xs font-black text-emerald-700 tabular-nums">
                          +{formatBs(collection.amount)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-slate-600">
                        {collection.method === 'cash' ? 'Efectivo' : collection.method === 'qr' ? 'QR' : 'Mixto'} · Por:{' '}
                        {collection.collectedByName}
                      </p>
                      {collection.note && <p className="mt-0.5 text-slate-500 italic">{collection.note}</p>}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void printCollection(collection)}
                          className="flex min-h-[36px] items-center gap-1 rounded-xl border border-slate-200 px-3 font-extrabold text-slate-700"
                        >
                          <Printer size={14} /> Imprimir
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void shareCollectionReceipt(collection, receiptContext).catch((error) =>
                              setReceiptFeedback((error as Error).message),
                            )
                          }
                          className="flex min-h-[36px] items-center gap-1 rounded-xl border border-slate-200 px-3 font-extrabold text-slate-700"
                        >
                          <Share2 size={14} /> Compartir
                        </button>
                      </div>
                    </div>
                  ))}
                {!data.collections.some((collection) => collection.customerId === selected.customerId) && (
                  <p className="text-[11px] text-slate-500">Todavía no hay pagos registrados para este cliente.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={Boolean(editingReceivable)}
        onClose={() => setEditingReceivable(null)}
        title="Editar deuda"
        subtitle={editingReceivable ? customerDisplayName(editingReceivable.customerId, editingReceivable.customerName) : undefined}
        size="lg"
        footer={<PrimaryButton full disabled={isSubmitting} onClick={() => void submitReceivableEdit()}>Guardar cambios</PrimaryButton>}
      >
        {editingReceivable && <div className="grid gap-3">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            Solo se modifica la deuda. La venta, sus productos, precios, stock y cierres permanecen intactos.
          </div>
          {editingReceivable.sourceType === 'opening_balance' ? <>
            <Field label="Monto de la deuda (Bs)" required><NumberInput min={editingReceivable.paidAmount} step="0.01" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} /></Field>
            <Field label="Fecha de origen" required><TextInput type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} /></Field>
            <Field label="Descripción" required><TextArea value={editNote} onChange={(e) => setEditNote(e.target.value)} /></Field>
          </> : <>
            <p className="text-xs font-bold text-slate-700">Productos y cantidades de la venta (solo lectura). Distribuye el monto de crédito entre los productos:</p>
            {!editCreditLines.length ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Esta deuda histórica no tiene detalle de productos recuperable. Se podrá ajustar el monto total sin inventar líneas.</div> : editCreditLines.map((line, index) => <div key={line.productId} className="grid gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-[1fr_150px] sm:items-center">
              <div><p className="text-sm font-extrabold text-slate-900">{line.productNameSnapshot}</p><p className="text-xs text-slate-500">{line.quantity} {line.unitType}{line.presentationSnapshot ? ` · ${line.presentationSnapshot}` : ''} · Crédito actual: {formatBs(editOriginalCreditLines[index]?.creditAmount || 0)}</p></div>
              <Field label="Crédito asignado (Bs)" required><NumberInput min={0} step="0.01" value={String(line.creditAmount)} onChange={(e) => { const nextLines = editCreditLines.map((item, i) => i === index ? { ...item, creditAmount: Number(e.target.value) } : item); setEditCreditLines(nextLines); setEditAmount(String(round2(nextLines.reduce((sum, item) => sum + Number(item.creditAmount || 0), 0)))) }} /></Field>
            </div>)}
            <p className="text-xs font-black text-slate-800">Total asignado: {formatBs(round2(editCreditLines.reduce((sum, line) => sum + Number(line.creditAmount || 0), 0)))} · Pagado: {formatBs(editingReceivable.paidAmount)} · Saldo nuevo: {formatBs(Math.max(0, round2(Number(editAmount) - editingReceivable.paidAmount)))}</p>
            <Field label="Monto total nuevo (Bs)" required><NumberInput min={editingReceivable.paidAmount} step="0.01" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} /></Field>
          </>}
          <Field label="Motivo del cambio" required><TextArea value={editReason} onChange={(e) => setEditReason(e.target.value)} placeholder="Explica por qué se corrige esta deuda" /></Field>
          {error && <p role="alert" className="text-xs font-bold text-rose-700">{error}</p>}
        </div>}
      </Modal>

      <Modal
        isOpen={Boolean(voidingReceivable)}
        onClose={() => { setVoidingReceivable(null); setVoidConfirmationStep(1) }}
        title={voidConfirmationStep === 1 ? 'Revisar anulación de deuda' : 'Confirmar eliminación'}
        subtitle={voidingReceivable ? `${customerDisplayName(voidingReceivable.customerId, voidingReceivable.customerName)} · ${formatBs(voidingReceivable.balance)}` : ''}
        footer={voidConfirmationStep === 1
          ? <PrimaryButton full disabled={isSubmitting || !voidReason.trim() || Number(voidingReceivable?.paidAmount) > 0} onClick={() => setVoidConfirmationStep(2)}>Continuar a segunda confirmación</PrimaryButton>
          : <PrimaryButton full disabled={isSubmitting || voidPhrase !== 'ELIMINAR DEUDA'} onClick={() => void submitReceivableVoid()}>Confirmar eliminación</PrimaryButton>}
      >
        {voidingReceivable && <div className="grid gap-3">
          {voidConfirmationStep === 1 ? <>
          <div className="rounded-xl border-2 border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-900">Esta acción retirará la deuda de la cartera activa. La venta original y el inventario NO se borran ni se modifican.</div>
          <div className="rounded-xl border border-slate-200 p-3 text-xs text-slate-700">
            <p><b>Origen:</b> {voidingReceivable.sourceType === 'opening_balance' ? 'Saldo anterior' : 'Venta a crédito'}</p>
            <p><b>Monto original:</b> {formatBs(voidingReceivable.originalAmount)} · <b>Pagado:</b> {formatBs(voidingReceivable.paidAmount)} · <b>Saldo:</b> {formatBs(voidingReceivable.balance)}</p>
            {voidingReceivable.saleLines?.length ? <p className="mt-1"><b>Productos:</b> {voidingReceivable.saleLines.map((line) => `${line.productNameSnapshot} (${line.quantity} ${line.unitType})`).join(', ')}</p> : null}
          </div>
          {Number(voidingReceivable.paidAmount) > 0 && <p className="text-xs font-bold text-rose-700">No puede anularse porque ya tiene pagos aplicados.</p>}
          <Field label="Motivo obligatorio" required><TextArea value={voidReason} onChange={(e) => setVoidReason(e.target.value)} /></Field>
          </> : <>
          <div className="rounded-xl border-2 border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-900">Última confirmación: se anulará la deuda de {customerDisplayName(voidingReceivable.customerId, voidingReceivable.customerName)} por {formatBs(voidingReceivable.balance)}. La venta y el stock permanecerán sin cambios. Motivo: {voidReason}</div>
          <Field label="Escribe exactamente: ELIMINAR DEUDA" required><TextInput value={voidPhrase} onChange={(e) => setVoidPhrase(e.target.value)} /></Field>
          </>}
          {error && <p role="alert" className="text-xs font-bold text-rose-700">{error}</p>}
        </div>}
      </Modal>

      <Modal
        isOpen={Boolean(lastCollection)}
        onClose={() => setLastCollection(null)}
        title="Cobro registrado correctamente"
        subtitle={lastCollection ? `${customerDisplayName(lastCollection.customerId, lastCollection.customerName)} · ${formatBs(lastCollection.amount)}` : ''}
        footer={
          <PrimaryButton full onClick={() => setLastCollection(null)}>
            Finalizar
          </PrimaryButton>
        }
      >
        {lastCollection && (
          <div className="grid gap-3">
            <div className="rounded-2xl bg-emerald-50 p-4 text-center">
              <p className="text-xs font-extrabold uppercase text-emerald-700">Monto recibido</p>
              <p className="mt-1 text-2xl font-black text-emerald-800">{formatBs(lastCollection.amount)}</p>
              {lastCollection.portfolioBalanceAfter !== undefined && (
                <p className="mt-1 text-xs font-bold text-emerald-700">
                  Saldo restante: {formatBs(lastCollection.portfolioBalanceAfter)}
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <SecondaryButton onClick={() => void printCollection(lastCollection)}>
                <Printer size={16} /> Imprimir ticket
              </SecondaryButton>
              <SecondaryButton
                onClick={() =>
                  void shareCollectionReceipt(lastCollection, receiptContext)
                    .then((shared) => setReceiptFeedback(shared ? 'Opciones para compartir abiertas.' : 'Envío cancelado.'))
                    .catch((error) => setReceiptFeedback((error as Error).message))
                }
              >
                <Share2 size={16} /> Compartir
              </SecondaryButton>
            </div>
            <SecondaryButton
              full
              onClick={() =>
                void printLargeCollectionReceipt(lastCollection, receiptContext).catch((error) =>
                  setReceiptFeedback((error as Error).message),
                )
              }
            >
              <Printer size={16} /> Imprimir hoja / PDF
            </SecondaryButton>
            {receiptFeedback && <p className="text-center text-xs font-bold text-slate-600">{receiptFeedback}</p>}
          </div>
        )}
      </Modal>

      {/* Modal de Cobro a Nivel Cliente */}
      <Modal
        isOpen={Boolean(collectCustomer && !confirmingCollection)}
        onClose={() => {
          if (!isSubmitting) {
            setCollectCustomer(null)
            setConfirmingCollection(false)
          }
        }}
        title="Registrar cobro de cliente"
        subtitle={collectCustomer ? customerDisplayName(collectCustomer.customerId, collectCustomer.customerName) : ''}
        footer={
          <PrimaryButton full disabled={isSubmitting} onClick={requestCollectionConfirmation}>
            Cobrar
          </PrimaryButton>
        }
      >
        <div className="grid gap-3">
          {collectCustomer && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-600">Deuda total del cliente:</span>
                <span className="font-black text-rose-700 tabular-nums">
                  {formatBs(collectCustomer.totalBalance)}
                </span>
              </div>
              {collectCustomer.filteredBalance > 0 &&
                collectCustomer.totalBalance > collectCustomer.filteredBalance &&
                selectedRouteId !== 'all' && (
                  <div className="mt-1 flex items-center justify-between border-t border-slate-200 pt-1">
                    <span className="font-semibold text-slate-700">Deuda en esta ruta ({selectedRouteName}):</span>
                    <span className="font-black text-amber-800 tabular-nums">
                      {formatBs(collectCustomer.filteredBalance)}
                    </span>
                  </div>
                )}
              {collectionReferenceDebt !== undefined && (
                <div className="mt-1 flex items-center justify-between border-t border-slate-200 pt-1">
                  <span className="font-semibold text-amber-700">Monto sugerido / seleccionado:</span>
                  <span className="font-black text-amber-800 tabular-nums">
                    {formatBs(collectionReferenceDebt)}
                  </span>
                </div>
              )}
            </div>
          )}

          {collectCustomer &&
            collectCustomer.totalBalance > collectCustomer.filteredBalance &&
            collectCustomer.filteredBalance > 0 &&
            selectedRouteId !== 'all' && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <p className="font-black">Cliente con deudas en múltiples rutas</p>
                <p className="mt-0.5 text-[11px] leading-tight text-amber-800">
                  Aviso: Las cobranzas se amortizan contablemente por orden de antigüedad (FIFO) a la cartera total del cliente.
                </p>
              </div>
            )}

          <Field
            label="Monto a cobrar (Bs)"
            required
            hint="Escribe el monto recibido. Debe ser mayor a 0 y no superar la deuda total."
          >
            <NumberInput
              value={amount}
              min={0}
              max={collectCustomer?.totalBalance}
              step={1}
              onChange={(event) => handleAmountChange(event.target.value)}
            />
          </Field>
          <Field label="Forma de cobro">
            <Segmented
              value={method}
              onChange={handleMethodChange}
              options={[
                { value: 'cash', label: 'Efectivo' },
                { value: 'qr', label: 'QR' },
                { value: 'mixed', label: 'Mixto' },
              ]}
            />
          </Field>
          {method === 'mixed' && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Efectivo (Bs)" required>
                <NumberInput value={cashAmount} min={0} onChange={(event) => setCashAmount(event.target.value)} />
              </Field>
              <Field label="QR (Bs)" required>
                <NumberInput value={qrAmount} min={0} onChange={(event) => setQrAmount(event.target.value)} />
              </Field>
            </div>
          )}
          <Field label="Observación">
            <TextArea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Ej: Abono cuenta general"
            />
          </Field>
          <p className="text-[11px] font-semibold text-slate-500">
            El pago amortiza la deuda general del cliente y se distribuye a las ventas pendientes por orden de antigüedad.
          </p>
          {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
        </div>
      </Modal>

      {/* Modal Dedicado de Confirmación de Cobro */}
      <Modal
        isOpen={Boolean(confirmingCollection && collectCustomer)}
        onClose={() => {
          if (!isSubmitting) setConfirmingCollection(false)
        }}
        title="Confirmar cobro"
        subtitle="Verifica los datos antes de registrar el cobro"
        footer={
          <div className="grid grid-cols-2 gap-2 w-full">
            <SecondaryButton disabled={isSubmitting} onClick={() => setConfirmingCollection(false)}>
              Volver a revisar
            </SecondaryButton>
            <PrimaryButton disabled={isSubmitting} onClick={() => void executeConfirmedCollection()}>
              {isSubmitting ? 'Guardando...' : `Sí, cobrar ${formatBs(round2(Number(amount)))}`}
            </PrimaryButton>
          </div>
        }
      >
        {collectCustomer && (
          <div className="grid gap-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs">
              <p className="font-extrabold text-slate-900">{customerDisplayName(collectCustomer.customerId, collectCustomer.customerName)}</p>
              <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2">
                <span className="font-semibold text-slate-600">Monto a cobrar:</span>
                <span className="text-base font-black text-emerald-700 tabular-nums">
                  {formatBs(round2(Number(amount)))}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="font-semibold text-slate-600">Método de pago:</span>
                <span className="font-bold text-slate-800">
                  {method === 'cash' ? 'Efectivo' : method === 'qr' ? 'QR' : `Mixto (Efectivo ${formatBs(round2(Number(cashAmount)))} + QR ${formatBs(round2(Number(qrAmount)))})`}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between border-t border-slate-200 pt-1">
                <span className="font-semibold text-slate-600">Saldo restante estimado:</span>
                <span className="font-black text-slate-900 tabular-nums">
                  {formatBs(Math.max(0, round2(collectCustomer.totalBalance - Number(amount))))}
                </span>
              </div>
            </div>
            {note && (
              <p className="text-xs text-slate-600 italic">
                <span className="font-bold not-italic">Nota:</span> {note}
              </p>
            )}
            <p className="text-[11px] font-semibold text-slate-500">
              Al confirmar, el cobro se registrará en el servidor y amortizará las ventas más antiguas del cliente.
            </p>
          </div>
        )}
      </Modal>

      {/* Modal de Saldo Anterior */}
      <Modal
        isOpen={openingBalanceOpen}
        onClose={() => setOpeningBalanceOpen(false)}
        title="Registrar deuda anterior"
        subtitle="Añade una deuda previa a la cartera de un cliente"
        footer={
          <PrimaryButton full disabled={isSubmitting} onClick={() => void submitOpeningBalance()}>
            {isSubmitting ? 'Guardando...' : 'Guardar saldo anterior'}
          </PrimaryButton>
        }
      >
        <div className="grid gap-3">
          <Field label="Cliente" required>
            <ChoiceButton
              label={data.customers.find((c) => c.id === openingCustomerId)?.name}
              placeholder="Seleccionar cliente"
              description={
                openingCustomerId
                  ? `CI: ${
                      data.customers.find((c) => c.id === openingCustomerId)?.identityNumber ||
                      data.customers.find((c) => c.id === openingCustomerId)?.customerCode ||
                      'Sin carnet'
                    }${
                      data.customers.find((c) => c.id === openingCustomerId)?.phone
                        ? ` · Tel: ${data.customers.find((c) => c.id === openingCustomerId)?.phone}`
                        : ''
                    }`
                  : undefined
              }
              onClick={() => {
                setCustomerPickerSearch('')
                setIsCustomerPickerOpen(true)
              }}
            />
          </Field>
          <Field label="Monto adeudado (Bs)" required>
            <NumberInput value={openingAmount} min={0} step={1} onChange={(e) => setOpeningAmount(e.target.value)} />
          </Field>
          <Field label="Fecha de la deuda">
            <TextInput type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />
          </Field>
          <Field label="Origen / Motivo de la deuda" required>
            <TextArea
              value={openingNote}
              onChange={(e) => setOpeningNote(e.target.value)}
              placeholder="Ej: Deuda pendiente del mes anterior según libreta..."
            />
          </Field>
          {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
        </div>
      </Modal>

      {/* Modal de Búsqueda y Selección de Cliente para Saldo Anterior */}
      <Modal
        isOpen={isCustomerPickerOpen}
        onClose={() => {
          setIsCustomerPickerOpen(false)
          setCustomerPickerSearch('')
        }}
        title="Selecciona el cliente"
        subtitle="Busca por nombre, carnet/código o teléfono"
        size="lg"
        footer={
          <div className="flex w-full items-center justify-between gap-2">
            <SecondaryButton onClick={() => setIsCustomerPickerOpen(false)}>
              Cancelar
            </SecondaryButton>
            <PrimaryButton
              onClick={() => {
                setNewCustName(customerPickerSearch.trim())
                setNewCustCI('')
                setNewCustPhone('')
                setNewCustAddress('')
                setNewCustRouteId('')
                setCustomerCreateError(null)
                setIsNewCustomerOpen(true)
              }}
            >
              <UserPlus size={15} /> + REGISTRAR CLIENTE
            </PrimaryButton>
          </div>
        }
      >
        <div className="grid gap-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <TextInput
                value={customerPickerSearch}
                onChange={(e) => setCustomerPickerSearch(e.target.value)}
                placeholder="Buscar por nombre, CI o teléfono..."
                className="pl-9"
              />
            </div>
            <PrimaryButton
              onClick={() => {
                setNewCustName(customerPickerSearch.trim())
                setNewCustCI('')
                setNewCustPhone('')
                setNewCustAddress('')
                setNewCustRouteId('')
                setCustomerCreateError(null)
                setIsNewCustomerOpen(true)
              }}
            >
              <UserPlus size={15} /> + REGISTRAR
            </PrimaryButton>
          </div>

          <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
            {filteredPickerCustomers.map((cust) => {
              const isSelected = cust.id === openingCustomerId
              return (
                <button
                  key={cust.id}
                  type="button"
                  onClick={() => {
                    setOpeningCustomerId(cust.id)
                    setIsCustomerPickerOpen(false)
                    setCustomerPickerSearch('')
                  }}
                  className={`flex w-full items-center justify-between rounded-2xl border p-3 text-left transition ${
                    isSelected
                      ? 'border-[var(--primary)] bg-[var(--primary-soft)]'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-black text-slate-900">{cust.name}</p>
                    <p className="text-[11px] font-semibold text-slate-500">
                      CI: {cust.identityNumber || cust.customerCode || 'Sin carnet'}
                      {cust.phone ? ` · Tel: ${cust.phone}` : ''}
                      {cust.address ? ` · ${cust.address}` : ''}
                    </p>
                  </div>
                  {isSelected && (
                    <span className="rounded-full bg-[var(--primary)] px-2 py-0.5 text-[10px] font-black text-white">
                      SELECCIONADO
                    </span>
                  )}
                </button>
              )
            })}
            {filteredPickerCustomers.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center">
                <p className="text-xs font-semibold text-slate-600">
                  No se encontró ningún cliente con ese dato.
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  Puedes registrarlo de inmediato sin salir de esta pantalla.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setNewCustName(customerPickerSearch.trim())
                    setNewCustCI('')
                    setNewCustPhone('')
                    setNewCustAddress('')
                    setNewCustRouteId('')
                    setCustomerCreateError(null)
                    setIsNewCustomerOpen(true)
                  }}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-3 py-1.5 text-xs font-black text-white"
                >
                  <UserPlus size={14} /> Registrar como nuevo cliente
                </button>
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* Modal de Registro Rápido de Cliente */}
      <Modal
        isOpen={isNewCustomerOpen}
        onClose={() => setIsNewCustomerOpen(false)}
        title="Registrar nuevo cliente"
        subtitle="Se creará en el sistema y quedará seleccionado para el saldo anterior"
        footer={
          <PrimaryButton
            full
            disabled={isCreatingCustomer}
            onClick={async () => {
              if (!newCustName.trim()) {
                setCustomerCreateError('El nombre del cliente es obligatorio.')
                return
              }
              if (!newCustCI.trim()) {
                setCustomerCreateError('El CI / Carnet es obligatorio para registrar un cliente.')
                return
              }
              setIsCreatingCustomer(true)
              setCustomerCreateError(null)
              try {
                const created = await saveCustomer({
                  name: newCustName.trim(),
                  identityNumber: newCustCI.trim(),
                  phone: newCustPhone.trim(),
                  address: newCustAddress.trim(),
                  routeId: newCustRouteId || undefined,
                })
                setOpeningCustomerId(created.id)
                setIsNewCustomerOpen(false)
                setIsCustomerPickerOpen(false)
                setToast(`Cliente ${created.name} registrado y seleccionado.`)
              } catch (e) {
                setCustomerCreateError((e as Error).message)
              } finally {
                setIsCreatingCustomer(false)
              }
            }}
          >
            {isCreatingCustomer ? 'Guardando cliente...' : 'Guardar y seleccionar cliente'}
          </PrimaryButton>
        }
      >
        <div className="grid gap-3">
          <Field label="Nombre completo" required>
            <TextInput
              value={newCustName}
              onChange={(e) => setNewCustName(e.target.value)}
              placeholder="Ej: Doña María Pérez"
            />
          </Field>
          <Field label="Carnet de Identidad (CI)" required hint="Número único de identificación">
            <TextInput
              value={newCustCI}
              onChange={(e) => setNewCustCI(e.target.value)}
              placeholder="Ej: 4892019"
            />
          </Field>
          <Field label="Teléfono / Celular">
            <TextInput
              value={newCustPhone}
              onChange={(e) => setNewCustPhone(e.target.value)}
              placeholder="Ej: 71234567"
            />
          </Field>
          <Field label="Dirección o referencia">
            <TextInput
              value={newCustAddress}
              onChange={(e) => setNewCustAddress(e.target.value)}
              placeholder="Ej: Calle Bolívar #123, Puesto 4"
            />
          </Field>
          <Field label="Ruta asignada">
            <select
              className="min-h-[44px] w-full rounded-2xl border-2 border-slate-300 px-3 text-xs font-bold text-slate-800"
              value={newCustRouteId}
              onChange={(e) => setNewCustRouteId(e.target.value)}
            >
              <option value="">Sin ruta asignada (General)</option>
              {data.routes.filter(r => r.active !== false).map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </Field>
          {customerCreateError && (
            <p className="text-xs font-bold text-rose-600">{customerCreateError}</p>
          )}
        </div>
      </Modal>

      {/* Modal de Autorización Temporal de Crédito */}
      <Modal
        isOpen={Boolean(overrideCustomer)}
        onClose={() => setOverrideCustomer(null)}
        title="Autorizar crédito temporal"
        subtitle={overrideCustomer ? customerDisplayName(overrideCustomer.customerId, overrideCustomer.customerName) : undefined}
        footer={
          <PrimaryButton
            full
            disabled={isSubmitting}
            onClick={async () => {
              const days = Number(overrideDays)
              if (!Number.isInteger(days) || days < 1 || days > 90 || !overrideReason.trim()) {
                setError('Indica entre 1 y 90 días y un motivo claro de la autorización.')
                return
              }
              setIsSubmitting(true)
              try {
                await setCreditOverride({
                  customerId: overrideCustomer!.customerId,
                  days,
                  reason: overrideReason.trim(),
                })
                setOverrideCustomer(null)
                setToast('Autorización temporal concedida exitosamente.')
              } catch (e) {
                setError((e as Error).message)
              } finally {
                setIsSubmitting(false)
              }
            }}
          >
            Guardar autorización
          </PrimaryButton>
        }
      >
        <div className="grid gap-3">
          <Field label="Duración">
            <Segmented
              value={['1', '2', '3', '7'].includes(overrideDays) ? overrideDays : 'custom'}
              onChange={(value) => setOverrideDays(value === 'custom' ? '' : value)}
              options={[
                { value: '1', label: '1 día' },
                { value: '2', label: '2 días' },
                { value: '3', label: '3 días' },
                { value: '7', label: '7 días' },
                { value: 'custom', label: 'Otro' },
              ]}
            />
          </Field>
          {!['1', '2', '3', '7'].includes(overrideDays) && (
            <Field label="Días personalizados" required>
              <NumberInput min={1} max={90} value={overrideDays} onChange={(e) => setOverrideDays(e.target.value)} />
            </Field>
          )}
          <Field label="Motivo de la autorización" required>
            <TextArea
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="Ej: Autorizado por la dueña para pedido especial de fin de semana"
            />
          </Field>
          {error && <p className="text-xs font-bold text-rose-700">{error}</p>}
        </div>
      </Modal>
    </Screen>
  )
}
