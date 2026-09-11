import { CreditProducts } from './CreditProducts'
import { RangePicker } from './RangePicker'
import { useMemo } from 'react'
import { EmptyBlock, Screen } from '../../../components/ui/Screen'
import { computeMoneySummary } from '../domain/engine'
import { KpiCard, formatBs } from './shared'
import type { DistributionViewProps } from './DistributionApp'

/**
 * Historial de cobranzas del rango consultado. Los cobros son movimientos
 * financieros separados de las ventas.
 */
export function CollectionsView({ session, data }: DistributionViewProps) {
  const summary = useMemo(() => computeMoneySummary([], data.collections, []), [data.collections])

  return (
    <Screen title="Cobros" subtitle="Cobranzas registradas en el periodo">
      <div className="grid w-full min-w-0 gap-3">
        <RangePicker dayKeys={session.dayKeys} onChange={session.setDayKeys} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <KpiCard label="Cobrado total" value={formatBs(summary.collectionsTotal)} tone="positive" />
          <KpiCard label="Efectivo" value={formatBs(summary.cashCollections)} />
          <KpiCard label="QR" value={formatBs(summary.qrCollections)} />
        </div>

        {data.collections.length === 0 ? (
          <EmptyBlock title="Sin cobros en el periodo" />
        ) : (
          <div className="grid gap-2">
            {data.collections.map((collection) => (
              <div
                key={collection.id}
                className="flex w-full min-w-0 items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3"
              >
                <div className="min-w-0">
                  <p className="break-words text-xs font-extrabold text-slate-900">{collection.customerName}</p>
                  {collection.pendingConfirmation && <p className="text-xs text-amber-700">Pendiente de confirmación</p>}
                  <CreditProducts saleId={data.receivables.find(r => r.id === collection.receivableId)?.saleId} lines={collection.saleLines?.length ? collection.saleLines : data.receivables.find(r => r.id === collection.receivableId)?.saleLines} />
                  <p className="break-words text-[11px] font-semibold leading-snug text-slate-500">
                    {new Date(collection.createdAt).toLocaleString('es-BO')} · {collection.collectedByName} ·{' '}
                    {collection.method === 'qr' ? 'QR' : 'Efectivo'}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-black tabular-nums text-emerald-600">
                  {formatBs(collection.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Screen>
  )
}
