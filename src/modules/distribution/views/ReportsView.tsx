import {
  exportExcel,
  exportPdf,
  reportAttributionError,
  reportSheets,
  type ReportSheetId,
  REPORT_OPTIONS,
  ALL_REPORT_IDS,
  defaultSheetIdForTab,
  filterReportSheets,
} from '../data/reportExports'
import { reportCreditLabel, reportPaymentLabel, reportPersonName, reportRecordName } from '../domain/reportLabels'
import { useMemo, useState } from 'react'
import { Screen, ResponsiveTable, EmptyBlock, type ResponsiveColumn } from '../../../components/ui/Screen'
import { Segmented, Field } from '../../../components/ui/Form'
import { ChoiceButton, ChoiceModal } from '../../../components/ui/ChoiceModal'
import { Modal } from '../../../components/ui/Modal'
import { Check, FileSpreadsheet, FileText, Printer, Send } from 'lucide-react'
import { printLargeSaleReceipt, printSaleReceipt, shareSaleReceipt } from '../data/distributionReceiptService'
import {
  computeMoneySummary,
  computeSellerBreakdown,
  computeSoldByProduct,
  computeSoldKilograms,
  computeSoldPackages,
  round2,
  toDayKey,
} from '../domain/engine'
import { KpiCard, PrimaryButton, SecondaryButton, SectionCard, VarianceBadge, formatBs, formatQty } from './shared'
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
  const [selectedSale, setSelectedSale] = useState<DistSale | null>(null)
  const [printFeedback, setPrintFeedback] = useState('')
  const [pendingExportKind, setPendingExportKind] = useState<'Excel' | 'PDF' | null>(null)
  const [selectedSheetIds, setSelectedSheetIds] = useState<Set<ReportSheetId>>(new Set())
  const [isExportModalOpen, setIsExportModalOpen] = useState(false)
  const attributionError = reportAttributionError(data, session.dayKeys, routeFilter, sellerFilter)

  const handleOpenExportModal = (kind: 'Excel' | 'PDF') => {
    setPendingExportKind(kind)
    setSelectedSheetIds(new Set([defaultSheetIdForTab(tab)]))
    setExportError('')
    setIsExportModalOpen(true)
  }

  const handleToggleSheet = (id: ReportSheetId) => {
    setSelectedSheetIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSelectAll = () => {
    setSelectedSheetIds(new Set(ALL_REPORT_IDS))
  }

  const handleClearSelection = () => {
    setSelectedSheetIds(new Set())
  }

  const handleConfirmExport = async () => {
    if (selectedSheetIds.size === 0 || !pendingExportKind) return
    setExporting(true)
    setExportError('')
    try {
      if (data.operations.some((o) => o.status === 'queued')) {
        throw new Error('Espera la confirmación de las operaciones pendientes antes de exportar.')
      }
      const allSheets = reportSheets(data, session.dayKeys, routeFilter, sellerFilter)
      const sheets = filterReportSheets(allSheets, selectedSheetIds)
      if (sheets.length === 0) {
        throw new Error('Selecciona al menos un reporte.')
      }
      const routeName = routeFilter
        ? reportRecordName(data.routes.find((route) => route.id === routeFilter)?.name, 'Ruta seleccionada')
        : 'Todas las rutas'
      const sellerName = sellerFilter
        ? reportPersonName(allSellers.find((seller) => seller.sellerUid === sellerFilter)?.sellerName)
        : 'Todos los vendedores'
      const description = `${describeRange(session.dayKeys)} · ruta: ${routeName} · vendedor: ${sellerName} · inventario: existencias actuales`

      if (pendingExportKind === 'Excel') {
        await exportExcel(sheets, description)
      } else {
        await exportPdf(sheets, description)
      }
      setIsExportModalOpen(false)
    } catch (e) {
      setExportError((e as Error).message)
    } finally {
      setExporting(false)
    }
  }

  const sales = useMemo(
    () =>
      data.sales
        .filter((sale) => !sale.pendingConfirmation)
        .filter((sale) => !routeFilter || sale.routeId === routeFilter)
        .filter((sale) => !sellerFilter || sale.sellerUid === sellerFilter),
    [data.sales, routeFilter, sellerFilter],
  )
  const collections = useMemo(
    () =>
      data.collections
        .filter((row) => !row.pendingConfirmation)
        .filter((row) => !routeFilter || row.routeId === routeFilter)
        .filter((row) => !sellerFilter || row.collectedByUid === sellerFilter),
    [data.collections, routeFilter, sellerFilter],
  )
  const expenses = useMemo(
    () =>
      data.expenses
        .filter((row) => !row.pendingConfirmation && !row.voided)
        .filter((row) => !routeFilter || row.routeId === routeFilter)
        .filter((row) => !sellerFilter || row.registeredByUid === sellerFilter),
    [data.expenses, routeFilter, sellerFilter],
  )
  const closures = useMemo(
    () => data.closures.filter((row) => !routeFilter || row.routeId === routeFilter),
    [data.closures, routeFilter],
  )

  const claims = useMemo(() => data.claims
    .filter(claim => session.dayKeys.includes(claim.dayKey || toDayKey(claim.createdAt)))
    .filter(claim => !routeFilter || claim.routeId === routeFilter)
    .filter(claim => !sellerFilter || claim.sellerUid === sellerFilter || (!claim.sellerUid && data.sales.some(sale => sale.id === claim.saleId && sale.sellerUid === sellerFilter))),
  [data.claims, data.sales, session.dayKeys, routeFilter, sellerFilter])
  const money = useMemo(() => {
    const base = computeMoneySummary(sales, collections, expenses)
    const claimCash = claims.reduce((sum, claim) => sum + (Number(claim.cashIn) || 0) - (Number(claim.cashOut) || 0), 0)
    return { ...base, expectedCash: round2(base.expectedCash + claimCash) }
  }, [sales, collections, expenses, claims])
  const sellers = useMemo(
    () => computeSellerBreakdown(sales, collections, expenses, claims),
    [sales, collections, expenses, claims],
  )
  const allSellers = useMemo(
    () => computeSellerBreakdown(data.sales, data.collections, data.expenses, data.claims),
    [data.sales, data.collections, data.expenses, data.claims],
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
    { key: 'precio', header: 'Precio', render: (row) => row.lines.some(line => line.isPromotional) ? <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black text-amber-800">PROMOCIONAL</span> : 'Oficial' },
    { key: 'total', header: 'Total', align: 'right', render: (row) => formatBs(row.total) },
  ]

  const collectionColumns: ResponsiveColumn<DistCollection>[] = [
    { key: 'hora', header: 'Hora', render: (row) => new Date(row.createdAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' }) },
    { key: 'cobrador', header: 'Cobro', render: (row) => row.collectedByName },
    { key: 'metodo', header: 'Metodo', render: (row) => (row.method === 'qr' ? 'QR' : row.method === 'mixed' ? `Mixto: efectivo ${formatBs(row.cashAmount || 0)} + QR ${formatBs(row.qrAmount || 0)}` : 'Efectivo') },
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
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={exporting}
            onClick={() => handleOpenExportModal('Excel')}
            className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-extrabold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
          >
            <FileSpreadsheet size={16} className="text-emerald-600" />
            Descargar Excel
          </button>
          <button
            type="button"
            disabled={exporting}
            onClick={() => handleOpenExportModal('PDF')}
            className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-extrabold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
          >
            <FileText size={16} className="text-rose-600" />
            PDF para imprimir / compartir
          </button>
        </div>
        {exportError&&<p role="alert">{exportError}</p>}
        <SectionCard title="Costos y resultado del periodo">{attributionError ? <p role="alert" className="text-xs font-bold text-rose-700">{attributionError}</p> : <div className="grid gap-2 text-xs">{reportSheets(data,session.dayKeys,routeFilter,sellerFilter)[0].rows.map((row,i)=><p key={i} className="flex justify-between gap-3"><span>{row[0]}</span><strong>{typeof row[1]==='number'?formatBs(row[1]):row[1]===null?'No corresponde o falta costo':row[1]}</strong></p>)}</div>}</SectionCard>
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
          <KpiCard label="Ventas antes de devoluciones" value={formatBs(money.salesTotal)} tone="primary" hint={`${sales.length} operaciones`} />
          <KpiCard label="Efectivo esperado" value={formatBs(money.expectedCash)} tone="positive" hint="Ventas + cobros + cambios - gastos" />
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
                titleOf={(row) => row.lines.map((line) => `${line.quantity} × ${line.productNameSnapshot}${line.isPromotional ? ` · promocional ${formatBs(line.actualUnitPrice)} (oficial ${formatBs(line.referenceUnitPrice || line.actualUnitPrice)})` : ''}`).join(', ')}
                onRowClick={setSelectedSale}
              />
              <p className="text-[11px] font-semibold text-slate-500">Toca una venta para reimprimir o compartir su comprobante.</p>
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
      <Modal
        isOpen={Boolean(selectedSale)}
        onClose={() => {
          setSelectedSale(null)
          setPrintFeedback('')
        }}
        title="Comprobante de venta"
        subtitle={selectedSale ? `${new Date(selectedSale.createdAt).toLocaleString('es-BO')} · ${formatBs(selectedSale.total)}` : ''}
      >
        {selectedSale && (
          <div className="grid gap-2">
            <p className="rounded-2xl bg-slate-50 p-3 text-xs font-semibold text-slate-700">
              {selectedSale.customerName || 'Cliente ocasional'} · {selectedSale.lines.length} producto(s)
            </p>
            <SecondaryButton full onClick={() => void printSaleReceipt(selectedSale, { companyName: data.supportSettings.companyName, receiptHeader: data.supportSettings.receiptHeader, receiptFooter: data.supportSettings.receiptFooter, taxId: data.supportSettings.taxId, address: data.supportSettings.address, phone: data.supportSettings.phone, routeName: '', distributorName: '' }, true).then(result => setPrintFeedback(result.message))}>
              <Printer size={16} /> Reimprimir ticket
            </SecondaryButton>
            <SecondaryButton full onClick={() => void printLargeSaleReceipt(selectedSale, { companyName: data.supportSettings.companyName, receiptFooter: data.supportSettings.receiptFooter, routeName: '', distributorName: '' }).catch(printError => setPrintFeedback((printError as Error).message))}>
              <Printer size={16} /> Imprimir en hoja
            </SecondaryButton>
            <SecondaryButton full onClick={() => void shareSaleReceipt(selectedSale, { companyName: data.supportSettings.companyName, receiptFooter: data.supportSettings.receiptFooter, routeName: '', distributorName: '' }).then(shared => setPrintFeedback(shared ? 'Se abrieron las opciones para compartir.' : 'Se canceló el envío.')).catch(shareError => setPrintFeedback((shareError as Error).message))}>
              <Send size={16} /> Compartir imagen
            </SecondaryButton>
            {printFeedback && <p className="rounded-xl bg-amber-50 p-2 text-xs font-bold text-amber-800">{printFeedback}</p>}
          </div>
        )}
      </Modal>

      <Modal
        isOpen={isExportModalOpen}
        onClose={() => {
          if (!exporting) setIsExportModalOpen(false)
        }}
        title="Seleccionar reportes"
        subtitle={
          pendingExportKind === 'Excel'
            ? 'Elige qué reportes incluir en el archivo Excel'
            : 'Elige qué reportes incluir en el documento PDF'
        }
        footer={
          <div className="flex w-full gap-2">
            <SecondaryButton
              disabled={exporting}
              onClick={() => setIsExportModalOpen(false)}
            >
              Cancelar
            </SecondaryButton>
            <PrimaryButton
              full
              disabled={selectedSheetIds.size === 0 || exporting}
              onClick={handleConfirmExport}
            >
              {exporting
                ? 'Generando...'
                : pendingExportKind === 'Excel'
                  ? 'Descargar Excel'
                  : 'Generar PDF'}
            </PrimaryButton>
          </div>
        }
      >
        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
            <span className="text-xs font-bold text-slate-500">
              {selectedSheetIds.size} de {REPORT_OPTIONS.length} seleccionados
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={exporting}
                onClick={handleSelectAll}
                className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-extrabold text-slate-700 transition hover:bg-slate-200 active:scale-95"
              >
                Seleccionar todos
              </button>
              <button
                type="button"
                disabled={exporting}
                onClick={handleClearSelection}
                className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-extrabold text-slate-700 transition hover:bg-slate-200 active:scale-95"
              >
                Limpiar selección
              </button>
            </div>
          </div>

          {selectedSheetIds.size === 0 && (
            <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-900">
              Selecciona al menos un reporte.
            </p>
          )}

          {exportError && (
            <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-700">
              {exportError}
            </p>
          )}

          <div className="grid max-h-[50vh] gap-2 overflow-y-auto pr-1">
            {REPORT_OPTIONS.map((option) => {
              const isChecked = selectedSheetIds.has(option.id)
              return (
                <button
                  key={option.id}
                  type="button"
                  disabled={exporting}
                  onClick={() => handleToggleSheet(option.id)}
                  className={`flex min-h-[52px] w-full items-center gap-3.5 rounded-2xl border p-3.5 text-left transition ${
                    isChecked
                      ? 'border-[var(--primary)] bg-rose-50/50 text-slate-900 shadow-sm'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-2 transition ${
                      isChecked
                        ? 'border-[var(--primary)] bg-[var(--primary)] text-white'
                        : 'border-slate-300 bg-white'
                    }`}
                  >
                    {isChecked && <Check size={16} strokeWidth={3} />}
                  </span>
                  <span className="text-sm font-extrabold">{option.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </Modal>
    </Screen>
  )
}
