import { exportExcel, exportPdf, reportSheets } from '../data/reportExports'
import { reportCreditLabel, reportPaymentLabel, reportPersonName, reportRecordName } from '../domain/reportLabels'
import { useMemo, useState } from 'react'
import { Screen, ResponsiveTable, EmptyBlock, type ResponsiveColumn } from '../../../components/ui/Screen'
import { Segmented, Field } from '../../../components/ui/Form'
import { ChoiceButton, ChoiceModal } from '../../../components/ui/ChoiceModal'
import {
  computeMoneySummary,
  computeSellerBreakdown,
  computeSoldByProduct,
  computeSoldKilograms,
  computeSoldPackages,
  round2,
} from '../domain/engine'
import { KpiCard, SectionCard, VarianceBadge, formatBs, formatQty } from './shared'
import { RangePicker, describeRange } from './RangePicker'
import type { DistributionViewProps } from './DistributionApp'
import type { DistCollection, DistExpense, DistSale } from '../types'

type ReportTab = 'resumen' | 'ventas' | 'productos' | 'creditos' | 'cobros' | 'gastos' | 'arqueos'

const TABS: { value: ReportTab; label: string }[] = [
  { value: 'resumen', label: 'Resumen' },
  { value: 'ventas', label: 'Ventas' },
  { value: 'productos', label: 'Productos' },
  { value: 'creditos', label: 'Creditos' },
  { value: 'cobros', label: 'Cobros' },
  { value: 'gastos', label: 'Gastos' },
  { value: 'arqueos', label: 'Arqueos' },
]

/**
 * Todo lo que paso en el periodo, en un solo lugar.
 *
 * "Resumen" responde la pregunta que la duena hace primero: cuanto vendio cada
 * persona y cuanto efectivo deberia entregar. Las demas pestanas son el detalle.
 */
export function ReportsView({ session, data }: DistributionViewProps) {
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [tab, setTab] = useState<ReportTab>('resumen')
  const [routeFilter, setRouteFilter] = useState('')
  const [sellerFilter, setSellerFilter] = useState('')
  const [isSellerOpen, setIsSellerOpen] = useState(false)

  const sales = useMemo(
    () =>
      data.sales
        .filter((sale) => !routeFilter || sale.routeId === routeFilter)
        .filter((sale) => !sellerFilter || sale.sellerUid === sellerFilter),
    [data.sales, routeFilter, sellerFilter],
  )
  const collections = useMemo(
    () =>
      data.collections
        .filter((row) => !routeFilter || row.routeId === routeFilter)
        .filter((row) => !sellerFilter || row.collectedByUid === sellerFilter),
    [data.collections, routeFilter, sellerFilter],
  )
  const expenses = useMemo(
    () =>
      data.expenses
        .filter((row) => !routeFilter || row.routeId === routeFilter)
        .filter((row) => !sellerFilter || row.registeredByUid === sellerFilter),
    [data.expenses, routeFilter, sellerFilter],
  )
  const closures = useMemo(
    () => data.closures.filter((row) => !routeFilter || row.routeId === routeFilter),
    [data.closures, routeFilter],
  )

  const money = useMemo(() => computeMoneySummary(sales, collections, expenses), [sales, collections, expenses])
  const sellers = useMemo(
    () => computeSellerBreakdown(sales, collections, expenses),
    [sales, collections, expenses],
  )
  const allSellers = useMemo(
    () => computeSellerBreakdown(data.sales, data.collections, data.expenses),
    [data.sales, data.collections, data.expenses],
  )

  const productRows = useMemo(() => {
    const sold = computeSoldByProduct(sales)
    return [...sold.entries()]
      .map(([productId, totals]) => ({ productId, ...totals }))
      .sort((a, b) => b.amount - a.amount)
  }, [sales])

  const saleColumns: ResponsiveColumn<DistSale>[] = [
    { key: 'hora', header: 'Hora', render: (row) => new Date(row.createdAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' }) },
    { key: 'vendedor', header: 'Vendedor', render: (row) => row.sellerName },
    { key: 'ruta', header: 'Ruta', render: (row) => row.routeName, hideOnMobile: true },
    { key: 'cliente', header: 'Cliente', render: (row) => row.customerName || 'Ocasional' },
    { key: 'pago', header: 'Pago', render: (row) => reportPaymentLabel(row.paymentKind) },
    { key: 'total', header: 'Total', align: 'right', render: (row) => formatBs(row.total) },
  ]

  const collectionColumns: ResponsiveColumn<DistCollection>[] = [
    { key: 'hora', header: 'Hora', render: (row) => new Date(row.createdAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' }) },
    { key: 'cobrador', header: 'Cobro', render: (row) => row.collectedByName },
    { key: 'metodo', header: 'Metodo', render: (row) => (row.method === 'qr' ? 'QR' : 'Efectivo') },
    { key: 'monto', header: 'Monto', align: 'right', render: (row) => formatBs(row.amount) },
  ]

  const expenseColumns: ResponsiveColumn<DistExpense>[] = [
    { key: 'hora', header: 'Hora', render: (row) => new Date(row.createdAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' }) },
    { key: 'ruta', header: 'Ruta', render: (row) => row.routeName },
    { key: 'quien', header: 'Registro', render: (row) => row.registeredByName },
    { key: 'monto', header: 'Monto', align: 'right', render: (row) => formatBs(row.amount) },
  ]

  return (
    <Screen title="Reportes" subtitle={describeRange(session.dayKeys)}>
      <div className="grid w-full min-w-0 gap-3">
        <div className="flex flex-wrap gap-2">{(['Excel','PDF'] as const).map(kind=><button key={kind} disabled={exporting} className="rounded-xl border bg-white px-4 py-3 text-sm font-bold" onClick={async()=>{setExporting(true);setExportError('');try{if(data.operations.some(o=>o.status==='queued'))throw new Error('Espera la confirmación de las operaciones pendientes antes de exportar.');const sheets=reportSheets(data,session.dayKeys,routeFilter,sellerFilter);const routeName=routeFilter?reportRecordName(data.routes.find(route=>route.id===routeFilter)?.name,'Ruta seleccionada'):'Todas las rutas';const sellerName=sellerFilter?reportPersonName(allSellers.find(seller=>seller.sellerUid===sellerFilter)?.sellerName):'Todos los vendedores';const description=`${describeRange(session.dayKeys)} · ruta: ${routeName} · vendedor: ${sellerName} · inventario: existencias actuales`;if(kind==='Excel')await exportExcel(sheets,description);else await exportPdf(sheets,description)}catch(e){setExportError((e as Error).message)}finally{setExporting(false)}}}>{exporting?'Preparando...':kind==='Excel'?'Descargar Excel':'PDF para imprimir / compartir'}</button>)}</div>
        {exportError&&<p role="alert">{exportError}</p>}
        <SectionCard title="Costos y resultado del periodo"><div className="grid gap-2 text-xs">{reportSheets(data,session.dayKeys,routeFilter,sellerFilter)[0].rows.map((row,i)=><p key={i} className="flex justify-between gap-3"><span>{row[0]}</span><strong>{typeof row[1]==='number'?formatBs(row[1]):row[1]===null?'Sin costo completo':row[1]}</strong></p>)}</div></SectionCard>
        <RangePicker
          dayKeys={session.dayKeys}
          onChange={session.setDayKeys}
          routes={data.routes}
          routeFilter={routeFilter}
          onRouteFilterChange={setRouteFilter}
        />

        {allSellers.length > 1 && (
          <Field label="Vendedor">
            <ChoiceButton label={sellerFilter ? allSellers.find(seller => seller.sellerUid === sellerFilter)?.sellerName : 'Todos los vendedores'} placeholder="Todos los vendedores" onClick={() => setIsSellerOpen(true)} />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <KpiCard label="Ventas" value={formatBs(money.salesTotal)} tone="primary" hint={`${sales.length} operaciones`} />
          <KpiCard label="Efectivo esperado" value={formatBs(money.expectedCash)} tone="positive" hint="Ventas + cobros - gastos" />
          <KpiCard label="Credito generado" value={formatBs(money.creditGenerated)} tone="warning" />
          <KpiCard label="Gastos" value={formatBs(money.cashExpenses)} tone="danger" />
        </div>

        {/*
          Sin envoltorio de ancho libre: Segmented ya reparte las pestanas en
          varias filas en pantallas angostas. Forzar min-w-max las estiraba y
          generaba desplazamiento horizontal.
        */}
        <Segmented value={tab} onChange={setTab} options={TABS} />

        {/* --- Resumen por vendedor --- */}
        {tab === 'resumen' &&
          (sellers.length === 0 ? (
            <EmptyBlock title="Sin movimiento en el periodo" description="Cambia las fechas o el filtro de ruta." />
          ) : (
            <div className="grid gap-2">
              {sellers.map((seller) => (
                <SectionCard key={seller.sellerUid} title={seller.sellerName}>
                  <p className="-mt-2 mb-2 text-[11px] font-semibold text-slate-500">
                    {seller.routeNames.join(' · ') || 'Sin ruta'} · {seller.salesCount} venta(s)
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <KpiCard label="Vendio" value={formatBs(seller.salesTotal)} tone="primary" />
                    <KpiCard label="Efectivo" value={formatBs(seller.cashSales)} />
                    <KpiCard label="QR" value={formatBs(seller.qrSales)} />
                    <KpiCard label="Credito" value={formatBs(seller.creditGenerated)} tone="warning" />
                    <KpiCard label="Cobro cartera" value={formatBs(seller.collected)} tone="positive" />
                    <KpiCard label="Gastos" value={formatBs(seller.expenses)} tone="danger" />
                    <KpiCard label="Granel" value={`${seller.kilograms} kg`} />
                    <KpiCard label="Paquetes" value={String(seller.packages)} />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 rounded-2xl bg-slate-50 px-3 py-2.5">
                    <span className="text-[11px] font-extrabold uppercase text-slate-500">Debe entregar en efectivo</span>
                    <span className="text-base font-black tabular-nums text-slate-900">{formatBs(seller.expectedCash)}</span>
                  </div>
                </SectionCard>
              ))}
            </div>
          ))}

        {/* --- Detalle --- */}
        {tab === 'ventas' &&
          (sales.length === 0 ? (
            <EmptyBlock title="Sin ventas en el periodo" />
          ) : (
            <>
              <p className="text-[11px] font-bold text-slate-500">
                {sales.length} ventas · {computeSoldKilograms(sales)} kg · {computeSoldPackages(sales)} paquetes
              </p>
              <ResponsiveTable
                rows={sales}
                columns={saleColumns}
                keyOf={(row) => row.id}
                titleOf={(row) => row.lines.map((line) => `${line.quantity} × ${line.productNameSnapshot}`).join(', ')}
              />
            </>
          ))}

        {tab === 'productos' &&
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

        {tab === 'creditos' &&
          (data.receivables.length === 0 ? (
            <EmptyBlock title="Sin creditos" />
          ) : (
            <>
              <p className="text-[11px] font-bold text-slate-500">
                Cartera pendiente:{' '}
                {formatBs(round2(data.receivables.reduce((sum, row) => sum + (Number(row.balance) || 0), 0)))}
              </p>
              <ResponsiveTable
                rows={data.receivables.slice().sort((a, b) => b.balance - a.balance)}
                columns={[
                  { key: 'distribuidor', header: 'Distribuidor', render: (row) => row.distributorName },
                  { key: 'original', header: 'Original', render: (row) => formatBs(row.originalAmount) },
                  { key: 'pagado', header: 'Pagado', render: (row) => formatBs(row.paidAmount) },
                  { key: 'saldo', header: 'Saldo', align: 'right', render: (row) => formatBs(row.balance) },
                  { key: 'estado', header: 'Estado', render: (row) => reportCreditLabel(row.status) },
                ]}
                keyOf={(row) => row.id}
                titleOf={(row) => row.customerName}
              />
            </>
          ))}

        {tab === 'cobros' &&
          (collections.length === 0 ? (
            <EmptyBlock title="Sin cobros en el periodo" />
          ) : (
            <ResponsiveTable
              rows={collections}
              columns={collectionColumns}
              keyOf={(row) => row.id}
              titleOf={(row) => row.customerName}
            />
          ))}

        {tab === 'gastos' &&
          (expenses.length === 0 ? (
            <EmptyBlock title="Sin gastos en el periodo" />
          ) : (
            <ResponsiveTable
              rows={expenses}
              columns={expenseColumns}
              keyOf={(row) => row.id}
              titleOf={(row) => row.concept}
            />
          ))}

        {tab === 'arqueos' &&
          (closures.length === 0 ? (
            <EmptyBlock title="Sin arqueos guardados" description="Aparecen cuando se cierra una ruta." />
          ) : (
            <div className="grid gap-2">
              {closures.map((closure) => (
                <div key={closure.id} className="w-full min-w-0 rounded-2xl border border-slate-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words text-xs font-extrabold text-slate-900">
                        {closure.routeName} · {closure.distributorName}
                      </p>
                      <p className="break-words text-[11px] font-semibold leading-snug text-slate-500">
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
                        <div key={row.productId} className="flex min-w-0 items-center justify-between gap-2">
                          <span className="min-w-0 break-words text-[11px] font-bold leading-snug text-slate-700">{row.productName}</span>
                          <VarianceBadge variance={row.variance} unitType={row.unitType} />
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
      </div>
      <ChoiceModal
        isOpen={isSellerOpen}
        onClose={() => setIsSellerOpen(false)}
        title="Filtrar por vendedor"
        searchable
        options={[{ value: '', label: 'Todos los vendedores' }, ...allSellers.map(seller => ({ value: seller.sellerUid, label: seller.sellerName }))]}
        selectedValue={sellerFilter}
        onSelect={setSellerFilter}
      />
    </Screen>
  )
}
