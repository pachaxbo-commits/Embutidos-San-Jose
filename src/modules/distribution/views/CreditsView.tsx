import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, HandCoins, History, Search, ShieldAlert } from 'lucide-react'
import { RangePicker } from './RangePicker'
import { Modal } from '../../../components/ui/Modal'
import { Field, NumberInput, Segmented, TextArea, TextInput } from '../../../components/ui/Form'
import { EmptyBlock, Screen } from '../../../components/ui/Screen'
import { toDayKey, round2 } from '../domain/engine'
import { newOperationId, registerCollection, registerOpeningBalance, setCreditOverride } from '../data/distributionRepository'
import { exportExcel, exportPdf, reportSheets } from '../data/reportExports'
import { KpiCard, PrimaryButton, SecondaryButton, formatBs } from './shared'
import type { DistributionViewProps } from './DistributionApp'
import type { DistReceivable } from '../types'

interface CustomerCredit {
  customerId: string
  customerName: string
  balance: number
  originalAmount: number
  lastMovementAt: string
  receivables: DistReceivable[]
}

/**
 * Cartera por cliente y cobranzas.
 * La interfaz trabaja por SALDO TOTAL DEL CLIENTE.
 * No se cobra por producto ni se topa el cobro a la venta más antigua.
 * El servidor distribuye el pago FIFO entre las deudas activas.
 */
export function CreditsView({ session, data }: DistributionViewProps) {
  const [period, setPeriod] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<CustomerCredit | null>(null)
  const [collectCustomer, setCollectCustomer] = useState<CustomerCredit | null>(null)
  const [openingBalanceOpen, setOpeningBalanceOpen] = useState(false)
  const [openingCustomerId, setOpeningCustomerId] = useState('')
  const [openingAmount, setOpeningAmount] = useState('')
  const [openingDate, setOpeningDate] = useState(toDayKey(new Date()))
  const [openingNote, setOpeningNote] = useState('')
  const [overrideCustomer, setOverrideCustomer] = useState<CustomerCredit | null>(null)
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
  const [paidOpen, setPaidOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  const byCustomer = useMemo(() => {
    const map = new Map<string, CustomerCredit>()
    for (const receivable of data.receivables) {
      if (period.length && !period.includes(receivable.dayKey || toDayKey(receivable.createdAt))) continue
      const current = map.get(receivable.customerId)
      const entry: CustomerCredit = current ?? {
        customerId: receivable.customerId,
        customerName: receivable.customerName || 'Cliente',
        balance: 0,
        originalAmount: 0,
        lastMovementAt: receivable.createdAt,
        receivables: [],
      }
      entry.balance = round2(entry.balance + (Number(receivable.balance) || 0))
      entry.originalAmount = round2(entry.originalAmount + (Number(receivable.originalAmount) || 0))
      entry.receivables.push(receivable)
      if (receivable.createdAt > entry.lastMovementAt) entry.lastMovementAt = receivable.createdAt
      map.set(receivable.customerId, entry)
    }
    return [...map.values()].sort((a, b) => b.balance - a.balance)
  }, [data.receivables, period])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return term
      ? byCustomer.filter((entry) =>
          [
            entry.customerName,
            data.customers.find((c) => c.id === entry.customerId)?.customerCode,
            data.customers.find((c) => c.id === entry.customerId)?.identityNumber,
          ]
            .join(' ')
            .toLowerCase()
            .includes(term),
        )
      : byCustomer
  }, [byCustomer, search, data.customers])

  const totalOutstanding = round2(byCustomer.reduce((sum, entry) => sum + entry.balance, 0))

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

  const openCustomerCollection = (entry: CustomerCredit, initialAmount?: number) => {
    setCollectCustomer(entry)
    const targetAmt = initialAmount !== undefined ? Math.min(initialAmount, entry.balance) : entry.balance
    setAmount(String(targetAmt))
    setMethod('cash')
    setCashAmount(String(targetAmt))
    setQrAmount('0')
    setNote('')
    setError(null)
  }

  const submitCollection = async () => {
    if (!collectCustomer || isSubmitting) return
    const value = round2(Number(amount))
    if (!(value > 0)) {
      setError('El monto cobrado debe ser mayor a cero.')
      return
    }
    if (value > collectCustomer.balance) {
      setError(`El monto no puede superar la deuda total del cliente (${formatBs(collectCustomer.balance)}).`)
      return
    }

    const cash = method === 'cash' ? value : method === 'qr' ? 0 : round2(Number(cashAmount))
    const qr = method === 'qr' ? value : method === 'cash' ? 0 : round2(Number(qrAmount))
    if (cash < 0 || qr < 0 || round2(cash + qr) !== value || (method === 'mixed' && (!(cash > 0) || !(qr > 0)))) {
      setError('El efectivo y el QR deben ser mayores a cero y sumar exactamente el monto cobrado.')
      return
    }

    setIsSubmitting(true)
    try {
      const oldestDebt = collectCustomer.receivables
        .filter((item) => item.balance > 0)
        .sort((a, b) => (a.sourceDate || a.createdAt).localeCompare(b.sourceDate || b.createdAt))[0]

      await registerCollection({
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
      setCollectCustomer(null)
      setSelected(null)
      setToast(`Cobro de ${formatBs(value)} registrado correctamente.`)
    } catch (submitError) {
      setError((submitError as Error).message || 'No se pudo registrar el cobro.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const submitOpeningBalance = async (andCollectNow = false) => {
    const value = round2(Number(openingAmount))
    if (!openingCustomerId || !(value > 0) || !openingNote.trim()) {
      setError('Selecciona cliente, monto y describe el origen de la deuda.')
      return
    }
    setIsSubmitting(true)
    try {
      const customer = data.customers.find((c) => c.id === openingCustomerId)
      await registerOpeningBalance({
        customerId: openingCustomerId,
        amount: value,
        sourceDate: openingDate,
        note: openingNote.trim(),
      })
      setOpeningBalanceOpen(false)
      setOpeningAmount('')
      setOpeningNote('')

      if (andCollectNow && customer) {
        const existing = byCustomer.find((c) => c.customerId === openingCustomerId)
        const target: CustomerCredit = existing
          ? {
              ...existing,
              balance: round2(existing.balance + value),
            }
          : {
              customerId: customer.id,
              customerName: customer.name,
              balance: value,
              originalAmount: value,
              lastMovementAt: new Date().toISOString(),
              receivables: [],
            }
        openCustomerCollection(target, value)
      } else {
        setToast('Deuda anterior registrada exitosamente.')
      }
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

  return (
    <Screen
      title="Créditos"
      subtitle="Cartera general de clientes por saldo total"
      actions={
        session.role === 'admin' ? (
          <PrimaryButton onClick={() => { setOpeningBalanceOpen(true); setError(null) }}>Saldo anterior</PrimaryButton>
        ) : undefined
      }
    >
      <div className="grid w-full min-w-0 gap-3">
        {toast && (
          <div className="flex items-center justify-between rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-800">
            <span>{toast}</span>
            <button type="button" onClick={() => setToast(null)} className="ml-2 text-emerald-600 hover:text-emerald-900">
              ✕
            </button>
          </div>
        )}

        <p className="text-xs text-slate-600">
          La cobranza amortiza la deuda total del cliente. El sistema distribuye automáticamente el abono a las ventas más antiguas.
        </p>
        <RangePicker dayKeys={period.length ? period : [toDayKey(new Date())]} onChange={setPeriod} />
        <button className="text-left text-sm font-bold text-[var(--primary)]" onClick={() => setPeriod([])}>
          {period.length ? 'Ver todos los créditos' : 'Mostrando todos los créditos'}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <KpiCard label="Cartera pendiente" value={formatBs(totalOutstanding)} tone="warning" />
          <KpiCard label="Clientes con saldo" value={String(byCustomer.filter((entry) => entry.balance > 0).length)} />
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
            const hasOpeningBalance = entry.receivables.some((r) => r.sourceType === 'opening_balance' && r.balance > 0)
            const openingDebtSum = entry.receivables
              .filter((r) => r.sourceType === 'opening_balance' && r.balance > 0)
              .reduce((sum, r) => sum + r.balance, 0)
            const overrideActive = data.creditOverrides.some(
              (o) => o.customerId === entry.customerId && !o.revokedAt && o.activeUntil > nowIso,
            )

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
                    {data.customers.find((c) => c.id === entry.customerId)?.customerCode ||
                      data.customers.find((c) => c.id === entry.customerId)?.identityNumber}
                  </p>
                  <p className="text-[11px] font-semibold text-slate-500">
                    Último movimiento: {new Date(entry.lastMovementAt).toLocaleDateString('es-BO')}
                  </p>
                  {hasOpeningBalance && (
                    <p className="mt-1 text-[11px] font-bold text-amber-700">
                      Deuda anterior pendiente: {formatBs(openingDebtSum)}
                    </p>
                  )}
                </button>

                <div className="flex shrink-0 items-center justify-between gap-3 sm:flex-col sm:items-end sm:justify-center">
                  <span
                    className={`text-base font-black tabular-nums ${entry.balance > 0 ? 'text-[var(--primary)]' : 'text-emerald-600'}`}
                  >
                    {formatBs(entry.balance)}
                  </span>
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
                    {entry.balance > 0 && session.can('dist.collection.create') && (
                      <button
                        type="button"
                        onClick={() => openCustomerCollection(entry)}
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

      {/* Modal de Detalle de Cartera del Cliente */}
      <Modal
        isOpen={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.customerName ?? ''}
        subtitle={selected ? `Deuda total acumulada: ${formatBs(selected.balance)}` : ''}
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

            {selected.balance > 0 && session.can('dist.collection.create') && (
              <button
                type="button"
                onClick={() => openCustomerCollection(selected)}
                className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl text-xs font-black text-white shadow-sm"
                style={{ backgroundColor: 'var(--primary)' }}
              >
                <HandCoins size={16} /> REGISTRAR COBRO (DEUDA TOTAL: {formatBs(selected.balance)})
              </button>
            )}

            {selected.receivables.some((r) => r.sourceType === 'opening_balance' && r.balance > 0) &&
              session.can('dist.collection.create') && (
                <button
                  type="button"
                  onClick={() => {
                    const debtSum = selected.receivables
                      .filter((r) => r.sourceType === 'opening_balance' && r.balance > 0)
                      .reduce((sum, r) => sum + r.balance, 0)
                    openCustomerCollection(selected, debtSum)
                  }}
                  className="flex min-h-[40px] w-full items-center justify-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 text-xs font-extrabold text-amber-900 shadow-sm hover:bg-amber-100"
                >
                  <HandCoins size={15} /> Cobrar deuda anterior (
                  {formatBs(
                    selected.receivables
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
              {selected.receivables
                .slice()
                .sort((a, b) => (b.sourceDate || b.createdAt).localeCompare(a.sourceDate || a.createdAt))
                .filter((r) => r.balance > 0 || paidOpen)
                .map((receivable) => (
                  <div key={receivable.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-extrabold text-slate-900">
                          {receivable.sourceType === 'opening_balance'
                            ? 'Saldo inicial / Deuda anterior'
                            : 'Venta a crédito'}
                        </p>
                        <p className="text-[11px] font-semibold text-slate-500">
                          {new Date(receivable.sourceDate || receivable.createdAt).toLocaleDateString('es-BO')} ·{' '}
                          {receivable.distributorName || 'Registro anterior'}
                        </p>
                        {receivable.note && (
                          <p className="mt-0.5 text-[11px] text-slate-500 italic">{receivable.note}</p>
                        )}
                        <p className="mt-1 text-[11px] font-semibold text-slate-600">
                          Monto original: {formatBs(receivable.originalAmount)} · Pagado: {formatBs(receivable.paidAmount)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <span
                          className={`text-xs font-black tabular-nums ${receivable.balance > 0 ? 'text-[var(--primary)]' : 'text-emerald-600'}`}
                        >
                          Saldo: {formatBs(receivable.balance)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}

              {selected.receivables.some((r) => r.balance <= 0) && (
                <button
                  type="button"
                  onClick={() => setPaidOpen((value) => !value)}
                  className="mt-1 flex min-h-[40px] w-full items-center justify-between rounded-2xl border border-slate-200 px-3 text-left text-xs font-extrabold text-slate-700"
                >
                  <span>Créditos saldados ({selected.receivables.filter((r) => r.balance <= 0).length})</span>
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

      {/* Modal de Cobro a Nivel Cliente */}
      <Modal
        isOpen={Boolean(collectCustomer)}
        onClose={() => setCollectCustomer(null)}
        title="Registrar cobro de cliente"
        subtitle={
          collectCustomer
            ? `${collectCustomer.customerName} · Deuda total: ${formatBs(collectCustomer.balance)}`
            : ''
        }
        footer={
          <PrimaryButton full disabled={isSubmitting} onClick={() => void submitCollection()}>
            {isSubmitting ? 'Guardando...' : 'Confirmar cobro'}
          </PrimaryButton>
        }
      >
        <div className="grid gap-3">
          <Field
            label="Monto a cobrar (Bs)"
            required
            hint={`Deuda total: ${collectCustomer ? formatBs(collectCustomer.balance) : '0'}`}
          >
            <NumberInput
              value={amount}
              min={0}
              max={collectCustomer?.balance}
              step={1}
              onChange={(event) => setAmount(event.target.value)}
            />
          </Field>
          <Field label="Forma de cobro">
            <Segmented
              value={method}
              onChange={setMethod}
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
            <TextArea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ej: Abono cuenta general" />
          </Field>
          <p className="text-[11px] font-semibold text-slate-500">
            El pago amortiza la deuda general del cliente y se distribuye a las ventas pendientes por orden de antigüedad.
          </p>
          {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
        </div>
      </Modal>

      {/* Modal de Saldo Inicial / Deuda Anterior */}
      <Modal
        isOpen={openingBalanceOpen}
        onClose={() => setOpeningBalanceOpen(false)}
        title="Saldo inicial / Deuda anterior"
        subtitle="Registra deudas previas que el cliente traía de gestiones anteriores"
        footer={
          <div className="grid grid-cols-2 gap-2 w-full">
            <SecondaryButton disabled={isSubmitting} onClick={() => void submitOpeningBalance(false)}>
              Guardar deuda
            </SecondaryButton>
            <PrimaryButton disabled={isSubmitting} onClick={() => void submitOpeningBalance(true)}>
              Cobrar ahora
            </PrimaryButton>
          </div>
        }
      >
        <div className="grid gap-3">
          <Field label="Cliente" required>
            <select
              className="min-h-[44px] w-full rounded-2xl border-2 border-slate-300 px-3 text-xs font-bold text-slate-800"
              value={openingCustomerId}
              onChange={(e) => setOpeningCustomerId(e.target.value)}
            >
              <option value="">Selecciona cliente</option>
              {data.customers
                .filter((c) => c.active !== false)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.identityNumber ? `· ${c.identityNumber}` : ''}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Monto (Bs)" required>
            <NumberInput value={openingAmount} min={0} onChange={(e) => setOpeningAmount(e.target.value)} />
          </Field>
          <Field label="Fecha de origen" required>
            <TextInput type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />
          </Field>
          <Field label="Origen / Observación" required>
            <TextArea
              value={openingNote}
              onChange={(e) => setOpeningNote(e.target.value)}
              placeholder="Ej: Saldo de libreta antigua / Deuda gestión anterior"
            />
          </Field>
          {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
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
