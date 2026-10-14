import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, HandCoins, History, Printer, Search, Share2, ShieldAlert, UserPlus } from 'lucide-react'
import { RangePicker } from './RangePicker'
import { Modal } from '../../../components/ui/Modal'
import { ChoiceButton, ChoiceModal } from '../../../components/ui/ChoiceModal'
import { Field, NumberInput, Segmented, TextArea, TextInput } from '../../../components/ui/Form'
import { EmptyBlock, Screen } from '../../../components/ui/Screen'
import { toDayKey, round2 } from '../domain/engine'
import { newOperationId, registerCollection, registerOpeningBalance, saveCustomer, setCreditOverride } from '../data/distributionRepository'
import { exportExcel, exportPdf, reportSheets } from '../data/reportExports'
import {
  computeCreditPortfolioByRoute,
  getRouteDisplayName,
  type CustomerCreditRouteView,
} from '../domain/creditRoutes'
import { CreditProducts } from './CreditProducts'
import { KpiCard, PrimaryButton, SecondaryButton, formatBs } from './shared'
import type { DistributionViewProps } from './DistributionApp'
import type { DistCollection } from '../types'
import { printCollectionReceipt, printLargeCollectionReceipt, shareCollectionReceipt } from '../data/distributionReceiptService'

/**
 * Cartera por cliente y cobranzas.
 * La interfaz trabaja por SALDO TOTAL DEL CLIENTE.
 * Permite filtrar por ruta de origen de la deuda para organización y control de cobros.
 * El servidor distribuye el pago FIFO entre las deudas activas del cliente.
 */
export function CreditsView({ session, data }: DistributionViewProps) {
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
      ? customerCredits.filter((entry) =>
          [entry.customerName, entry.customerCode, entry.identityNumber]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(term),
        )
      : customerCredits
  }, [customerCredits, search])

  const grandTotalBalance = useMemo(() => {
    return round2(
      data.receivables
        .filter((r) => !period.length || period.includes(r.dayKey || toDayKey(r.createdAt)))
        .reduce((sum, r) => sum + (Number(r.balance) || 0), 0),
    )
  }, [data.receivables, period])

  const exportCredits = async (kind: 'pdf' | 'excel') => {
    setExporting(true)
    setExportError('')
    try {
      const days = period.length
        ? period
        : [...new Set(data.receivables.map((receivable) => receivable.dayKey || toDayKey(receivable.createdAt)))]
      const sheet = reportSheets(data, days).find((item) => item.name === 'Créditos')!
      const description = period.length ? `Créditos del periodo · ${period.join(' al ')}` : 'Cartera completa registrada'
      if (kind === 'pdf') await exportPdf([sheet], description, 'SanJose-creditos.pdf')
      else await exportExcel([sheet], description, 'SanJose-creditos.xlsx')
    } catch (exportFailure) {
      setExportError((exportFailure as Error).message)
    } finally {
      setExporting(false)
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
      const oldestDebt = collectCustomer.allReceivables
        .filter((item) => item.balance > 0)
        .sort((a, b) => (a.sourceDate || a.createdAt).localeCompare(b.sourceDate || b.createdAt))[0]

      const registered = await registerCollection({
        operationId: newOperationId('col'),
        customerId: collectCustomer.customerId,
        customerName: collectCustomer.customerName,
        receivable: oldestDebt,
        amount: value,
        method,
        cashAmount: cash,
        qrAmount: qr,
        collectedByUid: session.uid,
        collectedByName: session.userName,
        routeId: session.routeId || oldestDebt?.routeId,
        note,
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
        title={selected?.customerName ?? ''}
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
                .filter((r) => r.balance > 0 || paidOpen)
                .map((receivable) => {
                  const isVoid = Boolean(
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
        isOpen={Boolean(lastCollection)}
        onClose={() => setLastCollection(null)}
        title="Cobro registrado correctamente"
        subtitle={lastCollection ? `${lastCollection.customerName} · ${formatBs(lastCollection.amount)}` : ''}
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
            {session.role === 'admin' && (
              <SecondaryButton
                full
                onClick={() =>
                  void printLargeCollectionReceipt(lastCollection, receiptContext).catch((error) =>
                    setReceiptFeedback((error as Error).message),
                  )
                }
              >
                <Printer size={16} /> Imprimir en hoja normal
              </SecondaryButton>
            )}
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
        subtitle={collectCustomer ? `${collectCustomer.customerName}` : ''}
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
              <p className="font-extrabold text-slate-900">{collectCustomer.customerName}</p>
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
        subtitle={overrideCustomer?.customerName}
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
