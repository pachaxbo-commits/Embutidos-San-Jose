import { useMemo, useState } from 'react'
import { Check, CheckCircle2 } from 'lucide-react'
import { Screen } from '../../../components/ui/Screen'
import { Modal } from '../../../components/ui/Modal'
import { ChoiceButton, ChoiceModal } from '../../../components/ui/ChoiceModal'
import { Field, TextInput } from '../../../components/ui/Form'
import { RangePicker } from './RangePicker'
import { verifyQr } from '../data/distributionRepository'
import { matchesRoute } from '../domain/engine'
import { useTenantMembers } from '../state/useTenantMembers'
import { KpiCard, PrimaryButton, formatBs } from './shared'
import type { DistributionViewProps } from './DistributionApp'

export function QrView({ session, data }: DistributionViewProps) {
  const { members } = useTenantMembers()
  const [target, setTarget] = useState<{ type: 'sale' | 'collection' | 'claim'; id: string } | null>(null)
  const [reference, setReference] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [selectedSellerFilter, setSelectedSellerFilter] = useState('all')
  const [isSellerFilterOpen, setIsSellerFilterOpen] = useState(false)

  const allRows = useMemo(() => [
    ...data.sales
      .filter((s) => s.qrAmount > 0 && !s.pendingConfirmation)
      .map((s) => ({
        id: s.id,
        type: 'sale' as const,
        amount: s.qrAmount,
        name: s.customerName || 'Cliente ocasional',
        at: s.createdAt,
        sellerUid: s.sellerUid,
        sellerName: s.sellerName,
        routeId: s.routeId,
        sourceLocation: s.sourceLocation,
      })),
    ...data.collections
      .filter((c) => (c.qrAmount ?? (c.method === 'qr' ? c.amount : 0)) > 0)
      .map((c) => ({
        id: c.id,
        type: 'collection' as const,
        amount: c.qrAmount ?? (c.method === 'qr' ? c.amount : 0),
        name: c.customerName,
        at: c.createdAt,
        sellerUid: c.collectedByUid,
        sellerName: c.collectedByName,
        routeId: c.routeId,
        sourceLocation: undefined,
      })),
    ...data.claims
      .filter((c) => c.qrIn > 0)
      .map((c) => ({
        id: c.id,
        type: 'claim' as const,
        amount: c.qrIn,
        name: c.customerName,
        at: c.createdAt,
        sellerUid: c.sellerUid,
        sellerName: c.sellerName,
        routeId: c.routeId,
        sourceLocation: undefined,
      })),
  ].sort((a, b) => b.at.localeCompare(a.at)), [data.sales, data.collections, data.claims, session.dayKeys])

  const rows = useMemo(() => {
    if (selectedSellerFilter === 'all') return allRows
    if (selectedSellerFilter === 'administracion' || selectedSellerFilter === 'admin') {
      return allRows.filter((r) => matchesRoute(r.routeId, 'administracion') || (!r.routeId && r.sourceLocation === 'centralWarehouse'))
    }
    if (selectedSellerFilter === 'route-impulsacion' || selectedSellerFilter === 'direct') {
      return allRows.filter((r) => matchesRoute(r.routeId, 'route-impulsacion'))
    }
    return allRows.filter((r) => r.sellerUid === selectedSellerFilter)
  }, [allRows, selectedSellerFilter])

  const requiresVerification = data.supportSettings.requireQrVerification
  const confirmed = requiresVerification ? rows.filter((r) => data.qrVerifications.some((v) => v.id === `${r.type}_${r.id}`)) : rows
  const total = rows.reduce((sum, r) => sum + r.amount, 0)
  const verified = confirmed.reduce((sum, r) => sum + r.amount, 0)

  const distributorMembers = useMemo(
    () => members.filter((m) => m.role === 'distributor'),
    [members],
  )

  const sellerFilterLabel = useMemo(() => {
    if (selectedSellerFilter === 'all') return 'Todos los responsables'
    if (selectedSellerFilter === 'administracion' || selectedSellerFilter === 'admin') return 'Administración'
    if (selectedSellerFilter === 'route-impulsacion' || selectedSellerFilter === 'direct') return 'Impulsación'
    return members.find((m) => m.uid === selectedSellerFilter)?.displayName || 'Responsable seleccionado'
  }, [selectedSellerFilter, members])

  const submit = async () => {
    if (!target || busy) return
    setBusy(true)
    setError('')
    try {
      await verifyQr(target.type, target.id, reference)
      setTarget(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen
      title="Pagos por QR"
      subtitle={
        session.role === 'admin'
          ? 'Conciliación bancaria y verificación de transferencias QR'
          : 'Comprobantes QR registrados en el periodo'
      }
    >
      <div className="flex flex-col gap-3">
        <RangePicker
          dayKeys={session.dayKeys}
          onChange={session.setDayKeys}
        />

        {session.role === 'admin' && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-500 whitespace-nowrap">Responsable:</span>
            <div className="flex-1">
              <ChoiceButton
                label={sellerFilterLabel}
                placeholder="Seleccionar responsable"
                onClick={() => setIsSellerFilterOpen(true)}
              />
            </div>
            {selectedSellerFilter !== 'all' && (
              <button
                type="button"
                onClick={() => setSelectedSellerFilter('all')}
                className="text-xs font-semibold text-rose-600 hover:text-rose-700 underline px-1"
              >
                Limpiar
              </button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <KpiCard label="Total por QR" value={formatBs(total)} />
        <KpiCard
          label={requiresVerification ? 'Verificado en banco' : 'Confirmado'}
          value={formatBs(verified)}
          tone={requiresVerification && verified < total ? 'warning' : 'positive'}
        />
      </div>

      <div className="flex flex-col gap-2">
        {rows.map((r) => {
          const v = data.qrVerifications.find((x) => x.id === `${r.type}_${r.id}`)
          const isDone = !requiresVerification || !!v
          return (
            <article
              key={`${r.type}_${r.id}`}
              className="flex items-center justify-between rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 pr-3">
                <span className="text-xs font-semibold text-slate-400">
                  {r.type === 'sale' ? 'Venta' : r.type === 'collection' ? 'Cobranza' : 'Reclamo'} ·{' '}
                  {new Date(r.at).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="truncate text-sm font-bold text-slate-800">{r.name}</span>
                {session.role === 'admin' && r.sellerName && (
                  <span className="text-[11px] font-medium text-slate-500">
                    Por: {r.sellerName}
                  </span>
                )}
                {v && (
                  <span className="text-xs font-medium text-emerald-700">
                    Ref: {v.reference} · por {v.verifiedBy}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-base font-black tabular-nums text-slate-900">{formatBs(r.amount)}</span>
                {isDone ? (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                    <CheckCircle2 size={18} />
                  </span>
                ) : session.role === 'admin' ? (
                  <button
                    type="button"
                    onClick={() => {
                      setTarget({ type: r.type, id: r.id })
                      setReference('')
                      setError('')
                    }}
                    className="flex h-8 items-center gap-1 rounded-2xl bg-slate-900 px-3 text-xs font-bold text-white shadow-sm hover:bg-slate-800"
                  >
                    <Check size={14} /> Verificar
                  </button>
                ) : (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                    Pendiente
                  </span>
                )}
              </div>
            </article>
          )
        })}
        {rows.length === 0 && (
          <p className="p-4 text-center text-sm font-semibold text-slate-400">
            No hay operaciones por QR en el período seleccionado.
          </p>
        )}
      </div>

      <Modal
        isOpen={Boolean(target)}
        onClose={() => setTarget(null)}
        title="Verificar pago QR"
      >
        <Field label="Referencia bancaria">
          <TextInput
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Nº de comprobante / lote banco"
          />
        </Field>
        <PrimaryButton onClick={() => void submit()} disabled={busy}>
          {busy ? 'Guardando...' : 'Confirmar verificación'}
        </PrimaryButton>
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      </Modal>

      <ChoiceModal
        isOpen={isSellerFilterOpen}
        onClose={() => setIsSellerFilterOpen(false)}
        title="Filtrar por responsable / origen"
        subtitle="Selecciona el vendedor u origen de los cobros QR"
        searchable
        options={[
          { value: 'all', label: 'Todos los responsables' },
          { value: 'administracion', label: 'Administración' },
          { value: 'route-impulsacion', label: 'Impulsación' },
          ...distributorMembers.map((m) => ({
            value: m.uid,
            label: m.displayName,
            description: m.routeId ? (data.routes.find((r) => r.id === m.routeId)?.name ?? 'Ruta asignada') : 'Distribuidor',
          })),
        ]}
        selectedValue={
          selectedSellerFilter === 'admin'
            ? 'administracion'
            : selectedSellerFilter === 'direct'
              ? 'route-impulsacion'
              : selectedSellerFilter
        }
        onSelect={(value) => {
          setSelectedSellerFilter(value)
          setIsSellerFilterOpen(false)
        }}
      />
    </Screen>
  )
}
