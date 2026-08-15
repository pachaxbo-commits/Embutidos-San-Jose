import { useMemo, useState } from 'react'
import { Screen, ResponsiveTable, EmptyBlock, type ResponsiveColumn } from '../../../components/ui/Screen'
import { Segmented } from '../../../components/ui/Form'
import { computeMoneySummary, computeSoldByProduct, round2 } from '../domain/engine'
import { KpiCard, VarianceBadge, formatBs, formatQty } from './shared'
import type { DistributionViewProps } from './DistributionApp'
import type { DistCollection, DistExpense, DistSale } from '../types'

type ReportTab = 'sales' | 'products' | 'credits' | 'collections' | 'expenses' | 'closures'

function formatDayKey(dayKey: string): string {
  const [year, month, day] = (dayKey || '').split('-')
  return year ? `${day}/${month}/${year}` : dayKey
}

/**
 * Detalle del periodo consultado. En movil se muestran tarjetas compactas y
 * en escritorio tabla: nunca una cuadricula estilo Excel en el telefono.
 */
export function ReportsView({ session, data }: DistributionViewProps) {
  const [tab, setTab] = useState<ReportTab>('sales')

  const money = useMemo(
    () => computeMoneySummary(data.sales, data.collections, data.expenses),
    [data.sales, data.collections, data.expenses],
  )

  const productRows = useMemo(() => {
    const sold = computeSoldByProduct(data.sales)
    return [...sold.entries()].map(([productId, totals]) => ({ productId, ...totals }))
  }, [data.sales])

  const saleColumns: ResponsiveColumn<DistSale>[] = [
    { key: 'hora', header: 'Hora', render: (row) => new Date(row.createdAt).toLocaleTimeString('es-BO') },
    { key: 'ruta', header: 'Ruta', render: (row) => row.routeName },
    { key: 'vendedor', header: 'Vendedor', render: (row) => row.sellerName },
    { key: 'cliente', header: 'Cliente', render: (row) => row.customerName || 'Ocasional' },
    { key: 'pago', header: 'Pago', render: (row) => row.paymentKind.toUpperCase() },
    { key: 'total', header: 'Total', align: 'right', render: (row) => formatBs(row.total) },
  ]

  const collectionColumns: ResponsiveColumn<DistCollection>[] = [
    { key: 'hora', header: 'Hora', render: (row) => new Date(row.createdAt).toLocaleTimeString('es-BO') },
    { key: 'cobrador', header: 'Cobro', render: (row) => row.collectedByName },
    { key: 'metodo', header: 'Metodo', render: (row) => (row.method === 'qr' ? 'QR' : 'Efectivo') },
    { key: 'monto', header: 'Monto', align: 'right', render: (row) => formatBs(row.amount) },
  ]

  const expenseColumns: ResponsiveColumn<DistExpense>[] = [
    { key: 'hora', header: 'Hora', render: (row) => new Date(row.createdAt).toLocaleTimeString('es-BO') },
    { key: 'ruta', header: 'Ruta', render: (row) => row.routeName },
    { key: 'quien', header: 'Registro', render: (row) => row.registeredByName },
    { key: 'monto', header: 'Monto', align: 'right', render: (row) => formatBs(row.amount) },
  ]

  return (
    <Screen
      title="Reportes"
      subtitle={
        session.dayKeys.length === 1
          ? formatDayKey(session.dayKeys[0])
          : `${formatDayKey(session.dayKeys[0])} a ${formatDayKey(session.dayKeys[session.dayKeys.length - 1])}`
      }
    >
      <div className="grid w-full min-w-0 gap-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <KpiCard label="Ventas" value={formatBs(money.salesTotal)} tone="primary" />
          <KpiCard label="Cobrado" value={formatBs(money.collectionsTotal)} tone="positive" />
          <KpiCard label="Credito" value={formatBs(money.creditGenerated)} tone="warning" />
          <KpiCard label="Gastos" value={formatBs(money.cashExpenses)} tone="danger" />
        </div>

        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'sales', label: 'Ventas' },
            { value: 'products', label: 'Productos' },
            { value: 'credits', label: 'Creditos' },
            { value: 'collections', label: 'Cobros' },
            { value: 'expenses', label: 'Gastos' },
            { value: 'closures', label: 'Arqueos' },
          ]}
        />

        {tab === 'sales' &&
          (data.sales.length === 0 ? (
            <EmptyBlock title="Sin ventas en el periodo" />
          ) : (
            <ResponsiveTable
              rows={data.sales}
              columns={saleColumns}
              keyOf={(row) => row.id}
              titleOf={(row) => row.lines.map((line) => line.productNameSnapshot).join(', ')}
            />
          ))}

        {tab === 'products' &&
          (productRows.length === 0 ? (
            <EmptyBlock title="Sin productos vendidos" />
          ) : (
            <ResponsiveTable
              rows={productRows}
              columns={[
                { key: 'cantidad', header: 'Cantidad', render: (row) => formatQty(row.quantity, row.unitType) },
                { key: 'importe', header: 'Importe', align: 'right', render: (row) => formatBs(row.amount) },
              ]}
              keyOf={(row) => row.productId}
              titleOf={(row) => row.productName}
            />
          ))}

        {tab === 'credits' &&
          (data.receivables.length === 0 ? (
            <EmptyBlock title="Sin creditos" />
          ) : (
            <ResponsiveTable
              rows={data.receivables}
              columns={[
                { key: 'ruta', header: 'Ruta', render: (row) => row.routeId },
                { key: 'original', header: 'Original', render: (row) => formatBs(row.originalAmount) },
                { key: 'pagado', header: 'Pagado', render: (row) => formatBs(row.paidAmount) },
                { key: 'saldo', header: 'Saldo', align: 'right', render: (row) => formatBs(row.balance) },
                { key: 'estado', header: 'Estado', render: (row) => row.status },
              ]}
              keyOf={(row) => row.id}
              titleOf={(row) => row.customerName}
            />
          ))}

        {tab === 'collections' &&
          (data.collections.length === 0 ? (
            <EmptyBlock title="Sin cobros en el periodo" />
          ) : (
            <ResponsiveTable
              rows={data.collections}
              columns={collectionColumns}
              keyOf={(row) => row.id}
              titleOf={(row) => row.customerName}
            />
          ))}

        {tab === 'expenses' &&
          (data.expenses.length === 0 ? (
            <EmptyBlock title="Sin gastos en el periodo" />
          ) : (
            <ResponsiveTable
              rows={data.expenses}
              columns={expenseColumns}
              keyOf={(row) => row.id}
              titleOf={(row) => row.concept}
            />
          ))}

        {tab === 'closures' &&
          (data.closures.length === 0 ? (
            <EmptyBlock title="Sin arqueos guardados" />
          ) : (
            <div className="grid gap-2">
              {data.closures.map((closure) => (
                <div key={closure.id} className="w-full min-w-0 rounded-2xl border border-slate-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-extrabold text-slate-900">
                        {closure.routeName} · {closure.distributorName}
                      </p>
                      <p className="text-[11px] font-semibold text-slate-500">
                        Esperado {formatBs(closure.expectedCash)} · Declarado {formatBs(closure.physicalCashDeclared)}
                      </p>
                    </div>
                    {closure.status === 'closed' ? (
                      <VarianceBadge variance={closure.cashDifference} />
                    ) : (
                      <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-black text-slate-500">
                        CAJA PENDIENTE
                      </span>
                    )}
                  </div>
                  <div className="mt-2 grid gap-1">
                    {closure.products
                      .filter((row) => Math.abs(row.variance) > 0.001)
                      .map((row) => (
                        <div key={row.productId} className="flex items-center justify-between gap-2">
                          <span className="truncate text-[11px] font-bold text-slate-700">{row.productName}</span>
                          <VarianceBadge variance={row.variance} unitType={row.unitType} />
                        </div>
                      ))}
                  </div>
                  <p className="mt-2 text-[10px] font-bold uppercase text-slate-400">
                    Estado: {closure.status} · Credito generado {formatBs(round2(closure.creditGenerated))}
                  </p>
                </div>
              ))}
            </div>
          ))}
      </div>
    </Screen>
  )
}
