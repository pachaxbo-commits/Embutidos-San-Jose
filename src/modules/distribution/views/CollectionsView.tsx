import { CreditProducts } from './CreditProducts'
import { RangePicker } from './RangePicker'
import { useMemo } from 'react'
import { useState } from 'react'
import { exportExcel, exportPdf, reportSheets } from '../data/reportExports'
import { EmptyBlock, Screen } from '../../../components/ui/Screen'
import { computeMoneySummary } from '../domain/engine'
import { KpiCard, SecondaryButton, formatBs } from './shared'
import type { DistributionViewProps } from './DistributionApp'

/**
 * Historial de cobranzas del rango consultado. Los cobros son movimientos
 * financieros separados de las ventas.
 */
export function CollectionsView({ session, data }: DistributionViewProps) {
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const summary = useMemo(() => computeMoneySummary([], data.collections, []), [data.collections])

  const exportCollections = async (kind: 'pdf' | 'excel') => {
    setExporting(true); setExportError('')
    try {
      const sheet = reportSheets(data, session.dayKeys).find(item => item.name === 'Cobros')!
      const description = `Cobros del periodo · ${session.dayKeys.join(' al ')}`
      if (kind === 'pdf') await exportPdf([sheet], description, 'SanJose-cobros.pdf')
      else await exportExcel([sheet], description, 'SanJose-cobros.xlsx')
    } catch (error) { setExportError((error as Error).message) }
    finally { setExporting(false) }
  }

  return (
    <Screen title="Cobros" subtitle="Cobranzas registradas en el periodo">
      <div className="grid w-full min-w-0 gap-3">
        <RangePicker dayKeys={session.dayKeys} onChange={session.setDayKeys} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <KpiCard label="Cobrado total" value={formatBs(summary.collectionsTotal)} tone="positive" />
          <KpiCard label="Efectivo" value={formatBs(summary.cashCollections)} />
          <KpiCard label="QR" value={formatBs(summary.qrCollections)} />
        </div>
        <div className="grid grid-cols-2 gap-2"><SecondaryButton disabled={exporting} onClick={() => void exportCollections('pdf')}>Descargar PDF</SecondaryButton><SecondaryButton disabled={exporting} onClick={() => void exportCollections('excel')}>Descargar Excel</SecondaryButton></div>
        {exportError && <p role="alert" className="text-xs font-bold text-rose-700">{exportError}</p>}

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
                    {collection.method === 'qr' ? 'QR' : collection.method === 'mixed' ? `Mixto · efectivo ${formatBs(collection.cashAmount || 0)} · QR ${formatBs(collection.qrAmount || 0)}` : 'Efectivo'}
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
