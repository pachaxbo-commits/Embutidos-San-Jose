import { CreditProducts } from './CreditProducts'
import { RangePicker } from './RangePicker'
import { useMemo } from 'react'
import { useState } from 'react'
import { Printer, Share2 } from 'lucide-react'
import { Modal } from '../../../components/ui/Modal'
import { exportExcel, exportPdf, reportSheets } from '../data/reportExports'
import { EmptyBlock, Screen } from '../../../components/ui/Screen'
import { computeMoneySummary } from '../domain/engine'
import { KpiCard, SecondaryButton, formatBs } from './shared'
import type { DistributionViewProps } from './DistributionApp'
import type { DistCollection } from '../types'
import { printCollectionReceipt, printLargeCollectionReceipt, shareCollectionReceipt } from '../data/distributionReceiptService'

/**
 * Historial de cobranzas del rango consultado. Los cobros son movimientos
 * financieros separados de las ventas.
 */
export function CollectionsView({ session, data }: DistributionViewProps) {
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [selected, setSelected] = useState<DistCollection | null>(null)
  const [receiptFeedback, setReceiptFeedback] = useState('')
  const summary = useMemo(() => computeMoneySummary([], data.collections, []), [data.collections])
  const receiptContext = { companyName: data.supportSettings.companyName || session.restaurantName, receiptHeader: data.supportSettings.receiptHeader, receiptFooter: data.supportSettings.receiptFooter, taxId: data.supportSettings.taxId, address: data.supportSettings.address, phone: data.supportSettings.phone, routeName: data.routes.find(route => route.id === session.routeId)?.name || 'Administración', distributorName: session.userName }
  const printReceipt = async (collection: DistCollection) => { setReceiptFeedback(''); const result = await printCollectionReceipt(collection, receiptContext, true); setReceiptFeedback(result.message) }

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
                className="flex w-full min-w-0 flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3"
              >
                <div className="min-w-0 flex-1 basis-full sm:basis-0">
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
                <button type="button" onClick={() => { setSelected(collection); setReceiptFeedback('') }} className="ml-auto shrink-0 rounded-xl border border-slate-200 px-3 py-2 text-[11px] font-extrabold text-slate-700">Ver comprobante</button>
              </div>
            ))}
          </div>
        )}
      </div>
      <Modal isOpen={Boolean(selected)} onClose={() => setSelected(null)} title="Comprobante de cobro" subtitle={selected ? `COB-${selected.id.slice(-6).toUpperCase()} · ${selected.customerName}` : ''}>
        {selected && <div className="grid gap-3"><div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold text-slate-500">Monto recibido</p><p className="text-2xl font-black text-[var(--primary)]">{formatBs(selected.amount)}</p><p className="mt-2 text-xs font-semibold text-slate-600">{selected.portfolioBalanceBefore === undefined ? 'Saldo histórico no disponible' : `Saldo antes: ${formatBs(selected.portfolioBalanceBefore)} · Saldo restante: ${formatBs(selected.portfolioBalanceAfter || 0)}`}</p></div><div className="grid grid-cols-2 gap-2"><SecondaryButton onClick={() => void printReceipt(selected)}><Printer size={16} /> Imprimir</SecondaryButton><SecondaryButton onClick={() => void shareCollectionReceipt(selected, receiptContext).then(shared => setReceiptFeedback(shared ? 'Opciones para compartir abiertas.' : 'Envío cancelado.')).catch(error => setReceiptFeedback((error as Error).message))}><Share2 size={16} /> Compartir</SecondaryButton></div>{session.role === 'admin' && <SecondaryButton full onClick={() => void printLargeCollectionReceipt(selected, receiptContext).catch(error => setReceiptFeedback((error as Error).message))}><Printer size={16} /> Imprimir en hoja normal</SecondaryButton>}{receiptFeedback && <p className="text-center text-xs font-bold text-slate-600">{receiptFeedback}</p>}</div>}
      </Modal>
    </Screen>
  )
}
