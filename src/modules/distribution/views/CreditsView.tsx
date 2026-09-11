import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, HandCoins, Search } from 'lucide-react'
import { RangePicker } from './RangePicker'
import { CreditProducts } from './CreditProducts'
import { Modal } from '../../../components/ui/Modal'
import { Field, NumberInput, Segmented, TextArea, TextInput } from '../../../components/ui/Form'
import { EmptyBlock, Screen } from '../../../components/ui/Screen'
import { toDayKey, round2, validateCollection } from '../domain/engine'
import { newOperationId, registerCollection } from '../data/distributionRepository'
import { KpiCard, PrimaryButton, formatBs } from './shared'
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
 * Cartera por cliente. Un credito pagado no se elimina: queda en PAID con su
 * historial, porque la clienta necesita poder auditar lo cobrado.
 */
export function CreditsView({ session, data }: DistributionViewProps) {
  const [period, setPeriod] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<CustomerCredit | null>(null)
  const [collectTarget, setCollectTarget] = useState<DistReceivable | null>(null)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<'cash' | 'qr'>('cash')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [paidOpen, setPaidOpen] = useState(false)

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
    return term ? byCustomer.filter((entry) => [entry.customerName, data.customers.find(c => c.id === entry.customerId)?.customerCode, data.customers.find(c => c.id === entry.customerId)?.identityNumber].join(' ').toLowerCase().includes(term)) : byCustomer
  }, [byCustomer, search, data.customers])

  const totalOutstanding = round2(byCustomer.reduce((sum, entry) => sum + entry.balance, 0))

  const openCollect = (receivable: DistReceivable) => {
    setCollectTarget(receivable)
    setAmount(String(round2(receivable.balance)))
    setMethod('cash')
    setNote('')
    setError(null)
  }

  const submitCollection = async () => {
    if (!collectTarget || isSubmitting) return
    const value = round2(Number(amount))
    const validation = validateCollection(value, collectTarget.balance)
    if (validation) {
      setError(validation)
      return
    }

    setIsSubmitting(true)
    try {
      await registerCollection({
        operationId: newOperationId('col'),
        receivable: collectTarget,
        amount: value,
        method,
        collectedByUid: session.uid,
        collectedByName: session.userName,
        routeId: session.routeId || collectTarget.routeId,
        note,
      })
      setCollectTarget(null)
      setSelected(null)
    } catch (submitError) {
      setError((submitError as Error).message || 'No se pudo registrar el cobro.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Screen title="Creditos" subtitle="Cartera general de todos los clientes">
      <div className="grid w-full min-w-0 gap-3">
        <p className="text-xs text-slate-600">La deuda es compartida entre administracion y distribuidores. Filtra por fecha de la venta a credito; el saldo incluye todos los cobros registrados.</p>
        <RangePicker dayKeys={period.length ? period : [toDayKey(new Date())]} onChange={setPeriod} />
        <button className="text-left text-sm font-bold text-[var(--primary)]" onClick={() => setPeriod([])}>{period.length ? 'Ver todos los creditos' : 'Mostrando todos los creditos'}</button>
        <div className="grid grid-cols-2 gap-2">
          <KpiCard label="Cartera pendiente" value={formatBs(totalOutstanding)} tone="warning" />
          <KpiCard label="Clientes con saldo" value={String(byCustomer.filter((entry) => entry.balance > 0).length)} />
        </div>

        <div className="relative w-full">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <TextInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar cliente..."
            className="pl-9"
          />
        </div>

        {filtered.length === 0 && <EmptyBlock title="Sin creditos registrados" />}

        <div className="grid gap-2">
          {filtered.map((entry) => (
            <button
              key={entry.customerId}
              type="button"
              onClick={() => { setSelected(entry); setPaidOpen(false) }}
              className="flex w-full min-w-0 items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left"
            >
              <div className="min-w-0">
                <p className="break-words text-sm font-extrabold text-slate-900">{entry.customerName}</p><p className="text-xs text-slate-500">{data.customers.find(c => c.id === entry.customerId)?.customerCode || data.customers.find(c => c.id === entry.customerId)?.identityNumber}</p>
                <p className="text-[11px] font-semibold text-slate-500">
                  Ultimo movimiento: {new Date(entry.lastMovementAt).toLocaleDateString('es-BO')}
                </p>
              </div>
              <span
                className={`shrink-0 text-base font-black tabular-nums ${entry.balance > 0 ? 'text-[var(--primary)]' : 'text-emerald-600'}`}
              >
                {formatBs(entry.balance)}
              </span>
            </button>
          ))}
        </div>
      </div>

      <Modal
        isOpen={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.customerName ?? ''}
        subtitle={selected ? `Saldo actual ${formatBs(selected.balance)}` : ''}
      >
        <div className="grid gap-2">
          {!!selected?.receivables.some(receivable => receivable.balance > 0) && <p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">Pendiente de pago</p>}
          {selected?.receivables
            .slice()
            .sort((a, b) => Number(b.balance > 0) - Number(a.balance > 0) || b.createdAt.localeCompare(a.createdAt))
            .filter(receivable => receivable.balance > 0 || paidOpen)
            .map((receivable) => (
              <div key={receivable.id} className="rounded-2xl border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-extrabold text-slate-900">
                      Venta a credito {formatBs(receivable.originalAmount)}
                    </p>
                    <p className="text-[11px] font-semibold text-slate-500">
                      {new Date(receivable.createdAt).toLocaleString('es-BO')} · {receivable.distributorName}
                    </p>
                    <p className="text-[11px] font-semibold text-slate-500">
                      Pagado {formatBs(receivable.paidAmount)} · Saldo {formatBs(receivable.balance)}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${
                      receivable.balance <= 0
                        ? 'bg-emerald-50 text-emerald-700'
                        : receivable.paidAmount > 0
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-rose-50 text-rose-700'
                    }`}
                  >
                    {receivable.balance <= 0 ? 'PAGADO' : receivable.paidAmount > 0 ? 'PARCIAL' : 'PENDIENTE'}
                  </span>
                </div>
                <CreditProducts saleId={receivable.saleId} lines={receivable.saleLines || data.sales.find(sale => sale.id === receivable.saleId)?.lines} />
                {receivable.balance > 0 && session.can('dist.collection.create') && (
                  <button
                    type="button"
                    onClick={() => openCollect(receivable)}
                    className="mt-2 flex min-h-[40px] w-full items-center justify-center gap-2 rounded-2xl text-xs font-extrabold text-white"
                    style={{ backgroundColor: 'var(--primary)' }}
                  >
                    <HandCoins size={15} /> Registrar cobro
                  </button>
                )}
              </div>
            ))}
          {!!selected?.receivables.some(receivable => receivable.balance <= 0) && <button type="button" onClick={() => setPaidOpen(value => !value)} className="mt-1 flex min-h-[44px] w-full items-center justify-between rounded-2xl border border-slate-200 px-3 text-left text-xs font-extrabold text-slate-700"><span>Créditos pagados ({selected.receivables.filter(receivable => receivable.balance <= 0).length})</span>{paidOpen ? <ChevronDown size={17} /> : <ChevronRight size={17} />}</button>}
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(collectTarget)}
        onClose={() => setCollectTarget(null)}
        title="Registrar cobro"
        subtitle={collectTarget ? `Saldo pendiente ${formatBs(collectTarget.balance)}` : ''}
        footer={
          <PrimaryButton full disabled={isSubmitting} onClick={() => void submitCollection()}>
            {isSubmitting ? 'Guardando...' : 'Confirmar cobro'}
          </PrimaryButton>
        }
      >
        <div className="grid gap-3">
          <CreditProducts saleId={collectTarget?.saleId} lines={collectTarget?.saleLines || data.sales.find(sale => sale.id === collectTarget?.saleId)?.lines} />
          <Field label="Monto cobrado (Bs)" required>
            <NumberInput value={amount} min={0} step={1} onChange={(event) => setAmount(event.target.value)} />
          </Field>
          <Field label="Forma de cobro">
            <Segmented
              value={method}
              onChange={setMethod}
              options={[
                { value: 'cash', label: 'Efectivo' },
                { value: 'qr', label: 'QR' },
              ]}
            />
          </Field>
          <Field label="Observacion">
            <TextArea value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
          <p className="text-[11px] font-semibold text-slate-500">
            Un cobro no es una venta nueva: reduce el saldo del cliente y entra al arqueo, pero no suma a las ventas.
          </p>
          {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
        </div>
      </Modal>
    </Screen>
  )
}
