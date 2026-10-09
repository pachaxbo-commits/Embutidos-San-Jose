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
import { reportCreditLabel, reportDateTime, reportPaymentLabel, reportPersonName, reportRecordName } from '../domain/reportLabels'
import { useMemo, useState } from 'react'
import { Screen, ResponsiveTable, EmptyBlock, type ResponsiveColumn } from '../../../components/ui/Screen'
import { Field } from '../../../components/ui/Form'
import { ChoiceButton, ChoiceModal } from '../../../components/ui/ChoiceModal'
import { Modal } from '../../../components/ui/Modal'
import { AlertTriangle, ArrowRight, Award, Check, ChevronDown, ChevronRight, FileSpreadsheet, FileText, HelpCircle, Printer, Send } from 'lucide-react'
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
import { aggregateCustomerPurchases } from '../domain/customerPurchases'
import { computeProductProfitReport, type ProductProfitSummaryItem } from '../domain/productProfit'

type MainCategory = 'resumen' | 'dinero' | 'ventas' | 'creditos' | 'inventario'
type DineroSubTab = 'flujo' | 'cobros' | 'gastos' | 'arqueos'
type VentasSubTab = 'ventas' | 'productos' | 'ganancias' | 'kardex' | 'clientes'
type InventarioSubTab = 'existencias' | 'movimientos'

const MAIN_CATEGORIES: { value: MainCategory; label: string }[] = [
  { value: 'resumen', label: 'Resumen' },
  { value: 'dinero', label: 'Dinero' },
  { value: 'ventas', label: 'Ventas' },
  { value: 'creditos', label: 'Créditos' },
  { value: 'inventario', label: 'Inventario' },
]

export function ReportsView({ session, data }: DistributionViewProps) {
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [mainCategory, setMainCategory] = useState<MainCategory>('resumen')
  const [dineroSubTab, setDineroSubTab] = useState<DineroSubTab>('flujo')
  const [ventasSubTab, setVentasSubTab] = useState<VentasSubTab>('ventas')
  const [inventarioSubTab, setInventarioSubTab] = useState<InventarioSubTab>('existencias')

  const [routeFilter, setRouteFilter] = useState('')
  const [sellerFilter, setSellerFilter] = useState('')
  const [isSellerOpen, setIsSellerOpen] = useState(false)
  const [selectedSale, setSelectedSale] = useState<DistSale | null>(null)
  const [printFeedback, setPrintFeedback] = useState('')
  const [pendingExportKind, setPendingExportKind] = useState<'Excel' | 'PDF' | null>(null)
  const [selectedSheetIds, setSelectedSheetIds] = useState<Set<ReportSheetId>>(new Set())
  const [isExportModalOpen, setIsExportModalOpen] = useState(false)
  const [expandedClientId, setExpandedClientId] = useState<string | null>(null)
  const [selectedProfitProduct, setSelectedProfitProduct] = useState<ProductProfitSummaryItem | null>(null)

  const attributionError = reportAttributionError(data, session.dayKeys, routeFilter, sellerFilter)

  const currentTabCode = useMemo(() => {
    if (mainCategory === 'resumen') return 'resumen'
    if (mainCategory === 'creditos') return 'creditos'
    if (mainCategory === 'dinero') {
      if (dineroSubTab === 'flujo') return 'dinero'
      return dineroSubTab
    }
    if (mainCategory === 'ventas') {
      return ventasSubTab
    }
    if (mainCategory === 'inventario') {
      return inventarioSubTab === 'existencias' ? 'inventario' : 'movimientos'
    }
    return 'resumen'
  }, [mainCategory, dineroSubTab, ventasSubTab, inventarioSubTab])

  const allSellers = useMemo(
    () => computeSellerBreakdown(data.sales, data.collections, data.expenses, data.claims),
    [data.sales, data.collections, data.expenses, data.claims],
  )

  const handleOpenExportModal = (kind: 'Excel' | 'PDF') => {
    setPendingExportKind(kind)
    setSelectedSheetIds(new Set([defaultSheetIdForTab(currentTabCode)]))
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

  const claims = useMemo(
    () =>
      data.claims
        .filter((claim) => session.dayKeys.includes(claim.dayKey || toDayKey(claim.createdAt)))
        .filter((claim) => !routeFilter || claim.routeId === routeFilter)
        .filter(
          (claim) =>
            !sellerFilter ||
            claim.sellerUid === sellerFilter ||
            (!claim.sellerUid && data.sales.some((sale) => sale.id === claim.saleId && sale.sellerUid === sellerFilter)),
        ),
    [data.claims, data.sales, session.dayKeys, routeFilter, sellerFilter],
  )

  const money = useMemo(() => {
    const base = computeMoneySummary(sales, collections, expenses)
    const claimCash = claims.reduce((sum, claim) => sum + (Number(claim.cashIn) || 0) - (Number(claim.cashOut) || 0), 0)
    return { ...base, expectedCash: round2(base.expectedCash + claimCash) }
  }, [sales, collections, expenses, claims])

  const sellers = useMemo(
    () => computeSellerBreakdown(sales, collections, expenses, claims),
    [sales, collections, expenses, claims],
  )

  const productRows = useMemo(() => {
    const sold = computeSoldByProduct(sales)
    return [...sold.entries()]
      .map(([productId, totals]) => ({ productId, ...totals }))
      .sort((a, b) => b.amount - a.amount)
  }, [sales])

  const customerPurchasesAgg = useMemo(
    () => aggregateCustomerPurchases(data, session.dayKeys, routeFilter, sellerFilter),
    [data, session.dayKeys, routeFilter, sellerFilter],
  )

  const productProfitReport = useMemo(
    () =>
      computeProductProfitReport(
        sales,
        claims,
        expenses,
        data.movements,
        session.dayKeys,
        routeFilter,
        sellerFilter,
      ),
    [sales, claims, expenses, data.movements, session.dayKeys, routeFilter, sellerFilter],
  )

  const operatingFinancials = useMemo(() => {
    const lines = sales.flatMap((s) => s.lines)
    const revenue = round2(
      sales.reduce((n, s) => n + s.total, 0) + claims.reduce((n, c) => n + c.revenueDelta, 0),
    )
    const costKnown =
      lines.every((l) => typeof l.costTotal === 'number') &&
      claims.every((c) => typeof c.additionalCost === 'number')
    const cost = round2(
      lines.reduce((n, l) => n + (l.costTotal || 0), 0) + claims.reduce((n, c) => n + (c.additionalCost || 0), 0),
    )
    const grossMargin = costKnown ? round2(revenue - cost) : null
    const spent = round2(expenses.reduce((n, e) => n + e.amount, 0))

    const losses = data.movements
      .filter((m) => session.dayKeys.includes(m.dayKey || toDayKey(m.createdAt)))
      .filter((m) => !routeFilter || m.routeId === routeFilter)
      .filter((m) => m.type === 'shortage' || (m.type === 'adjustment' && m.centralDelta < 0))
    const lossCost = round2(losses.reduce((n, l) => n + (l.lossCost || 0), 0))
    const operatingProfit =
      costKnown && !sellerFilter ? round2(revenue - cost - spent - lossCost) : null

    return {
      revenue,
      cost,
      costKnown,
      grossMargin,
      spent,
      lossCost,
      operatingProfit,
    }
  }, [sales, claims, expenses, data.movements, session.dayKeys, routeFilter, sellerFilter])

  const saleColumns: ResponsiveColumn<DistSale>[] = [
    {
      key: 'hora',
      header: 'Hora',
      render: (row) => new Date(row.createdAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' }),
    },
    { key: 'vendedor', header: 'Vendedor', render: (row) => row.sellerName },
    { key: 'ruta', header: 'Ruta', render: (row) => row.routeName, hideOnMobile: true },
    { key: 'cliente', header: 'Cliente', render: (row) => row.customerName || 'Ocasional' },
    { key: 'pago', header: 'Pago', render: (row) => reportPaymentLabel(row.paymentKind) },
    {
      key: 'precio',
      header: 'Precio',
      render: (row) =>
        row.lines.some((line) => line.isPromotional) ? (
          <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black text-amber-800">
            PROMOCIONAL
          </span>
        ) : (
          'Oficial'
        ),
    },
    { key: 'total', header: 'Total', align: 'right', render: (row) => formatBs(row.total) },
  ]

  const collectionColumns: ResponsiveColumn<DistCollection>[] = [
    {
      key: 'hora',
      header: 'Hora',
      render: (row) => new Date(row.createdAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' }),
    },
    { key: 'cobrador', header: 'Cobro', render: (row) => row.collectedByName },
    {
      key: 'metodo',
      header: 'Método',
      render: (row) =>
        row.method === 'qr'
          ? 'QR'
          : row.method === 'mixed'
            ? `Mixto: efectivo ${formatBs(row.cashAmount || 0)} + QR ${formatBs(row.qrAmount || 0)}`
            : 'Efectivo',
    },
    { key: 'monto', header: 'Monto', align: 'right', render: (row) => formatBs(row.amount) },
  ]

  const expenseColumns: ResponsiveColumn<DistExpense>[] = [
    {
      key: 'hora',
      header: 'Hora',
      render: (row) => new Date(row.createdAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' }),
    },
    { key: 'ruta', header: 'Ruta', render: (row) => row.routeName },
    { key: 'quien', header: 'Registro', render: (row) => row.registeredByName },
    { key: 'monto', header: 'Monto', align: 'right', render: (row) => formatBs(row.amount) },
  ]

  return (
    <Screen title="Reportes" subtitle={describeRange(session.dayKeys)}>
      <div className="grid w-full min-w-0 gap-3">
        {/* Botones de Descarga */}
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

        {exportError && <p role="alert" className="text-xs font-bold text-rose-700">{exportError}</p>}

        {/* Filtros de Rango y Rutas */}
        <RangePicker
          dayKeys={session.dayKeys}
          onChange={session.setDayKeys}
          routes={data.routes}
          routeFilter={routeFilter}
          onRouteFilterChange={setRouteFilter}
        />

        {allSellers.length > 1 && (
          <Field label="Vendedor">
            <ChoiceButton
              label={sellerFilter ? allSellers.find((s) => s.sellerUid === sellerFilter)?.sellerName : 'Todos los vendedores'}
              placeholder="Todos los vendedores"
              onClick={() => setIsSellerOpen(true)}
            />
          </Field>
        )}

        {/* 5 CATEGORÍAS PRINCIPALES */}
        <div className="flex flex-wrap gap-1.5 rounded-2xl border border-slate-200 bg-slate-50 p-1.5">
          {MAIN_CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              type="button"
              onClick={() => setMainCategory(cat.value)}
              className={`min-h-[40px] flex-1 rounded-xl px-3 text-xs font-black transition ${
                mainCategory === cat.value
                  ? 'bg-[var(--primary)] text-white shadow-xs'
                  : 'bg-transparent text-slate-600 hover:bg-slate-200/60'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* ========================================================= */}
        {/* 1. SECCIÓN: RESUMEN                                      */}
        {/* ========================================================= */}
        {mainCategory === 'resumen' && (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <KpiCard label="Ventas netas" value={formatBs(operatingFinancials.revenue)} tone="primary" hint={`${sales.length} ventas`} />
              <KpiCard label="Efectivo esperado" value={formatBs(money.expectedCash)} tone="positive" hint="Ventas + cobros + cambios - gastos" />
              <KpiCard label="Crédito generado" value={formatBs(money.creditGenerated)} tone="warning" />
              <KpiCard label="Gastos de ruta" value={formatBs(money.cashExpenses)} tone="danger" />
            </div>

            {/* Resultado Operativo Estimado */}
            <SectionCard title="Resultado operativo estimado">
              {attributionError ? (
                <p role="alert" className="text-xs font-bold text-rose-700">{attributionError}</p>
              ) : (
                <div className="grid gap-3">
                  <div className="rounded-2xl border-2 border-[var(--primary)]/30 bg-rose-50/50 p-4">
                    <span className="text-[10px] font-black uppercase tracking-wider text-rose-800">
                      Resultado operativo estimado / Ganancia operativa estimada
                    </span>
                    <p className="mt-1 text-2xl font-black text-rose-950 sm:text-3xl">
                      {operatingFinancials.operatingProfit !== null
                        ? formatBs(operatingFinancials.operatingProfit)
                        : 'Costo pendiente de registro'}
                    </p>
                    <p className="mt-1 text-xs font-medium text-slate-600">
                      Rendimiento de las ventas del periodo tras cubrir el costo de producción registrado de los productos entregados, los gastos de ruta y las mermas.
                    </p>
                  </div>

                  {/* Desglose de Fórmula */}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <span className="text-[10px] font-bold uppercase text-slate-400">1. Ventas netas</span>
                      <p className="mt-1 text-sm font-black text-slate-900">{formatBs(operatingFinancials.revenue)}</p>
                      <span className="text-[10px] text-slate-500">Tras devoluciones</span>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <span className="text-[10px] font-bold uppercase text-slate-400">2. Costo producción</span>
                      <p className="mt-1 text-sm font-black text-rose-700">
                        {operatingFinancials.costKnown ? `- ${formatBs(operatingFinancials.cost)}` : 'Incompleto'}
                      </p>
                      <span className="text-[10px] text-slate-500">De lo vendido/reemplazos</span>
                    </div>

                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
                      <span className="text-[10px] font-bold uppercase text-amber-800">= Margen bruto</span>
                      <p className="mt-1 text-sm font-black text-amber-900">
                        {operatingFinancials.grossMargin !== null ? formatBs(operatingFinancials.grossMargin) : 'Incompleto'}
                      </p>
                      <span className="text-[10px] text-amber-700">Ventas netas − costo</span>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <span className="text-[10px] font-bold uppercase text-slate-400">3. Gastos de ruta</span>
                      <p className="mt-1 text-sm font-black text-rose-700">- {formatBs(operatingFinancials.spent)}</p>
                      <span className="text-[10px] text-slate-500">Combustible/viáticos</span>
                    </div>

                    <div className="col-span-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:col-span-1">
                      <span className="text-[10px] font-bold uppercase text-slate-400">4. Mermas auditadas</span>
                      <p className="mt-1 text-sm font-black text-rose-700">
                        {operatingFinancials.costKnown ? `- ${formatBs(operatingFinancials.lossCost)}` : '-'}
                      </p>
                      <span className="text-[10px] text-slate-500">Faltantes en almacén</span>
                    </div>
                  </div>

                  {/* Guía Explicativa para la Dueña */}
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
                    <div className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-slate-800">
                      <HelpCircle size={15} className="text-slate-500" />
                      Guía de consulta para Administración (Cómo entender este reporte)
                    </div>
                    <dl className="mt-2.5 grid gap-2.5 text-xs sm:grid-cols-2">
                      <div className="rounded-xl border border-slate-200 bg-white p-2.5">
                        <dt className="font-extrabold text-slate-900">Ventas netas</dt>
                        <dd className="mt-0.5 text-slate-600">Total vendido inicialmente menos cambios o devoluciones recibidos en ruta.</dd>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-2.5">
                        <dt className="font-extrabold text-slate-900">Costo de lo vendido y reemplazos</dt>
                        <dd className="mt-0.5 text-slate-600">Costo de producción registrado de los productos comercializados y entregados como reemplazo.</dd>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-2.5">
                        <dt className="font-extrabold text-slate-900">Margen bruto</dt>
                        <dd className="mt-0.5 text-slate-600">Diferencia entre las ventas netas y el costo de producción de los productos entregados.</dd>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-2.5">
                        <dt className="font-extrabold text-slate-900">Cobros de cartera vs Ventas</dt>
                        <dd className="mt-0.5 text-slate-600">Cobrar créditos anteriores recupera efectivo, pero no vuelve a sumarse como venta nueva.</dd>
                      </div>
                    </dl>
                  </div>
                </div>
              )}
            </SectionCard>

            {/* Resumen por Vendedor */}
            {sellers.length === 0 ? (
              <EmptyBlock title="Sin movimiento en el periodo" description="Cambia las fechas o el filtro de ruta." />
            ) : (
              <div className="grid gap-2">
                {sellers.map((seller) => (
                  <SectionCard key={seller.sellerUid} title={seller.sellerName}>
                    <p className="-mt-2 mb-2 text-[11px] font-semibold text-slate-500">
                      {seller.routeNames.join(' · ') || 'Sin ruta'} · {seller.salesCount} venta(s)
                    </p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <KpiCard label="Vendió" value={formatBs(seller.salesTotal)} tone="primary" />
                      <KpiCard label="Efectivo" value={formatBs(seller.cashSales)} />
                      <KpiCard label="QR" value={formatBs(seller.qrSales)} />
                      <KpiCard label="Crédito" value={formatBs(seller.creditGenerated)} tone="warning" />
                      <KpiCard label="Cobró cartera" value={formatBs(seller.collected)} tone="positive" />
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
            )}
          </div>
        )}

        {/* ========================================================= */}
        {/* 2. SECCIÓN: DINERO                                       */}
        {/* ========================================================= */}
        {mainCategory === 'dinero' && (
          <div className="grid gap-3">
            <div className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-2">
              {[
                { value: 'flujo', label: 'Movimiento general' },
                { value: 'cobros', label: 'Cobros' },
                { value: 'gastos', label: 'Gastos' },
                { value: 'arqueos', label: 'Arqueos' },
              ].map((sub) => (
                <button
                  key={sub.value}
                  type="button"
                  onClick={() => setDineroSubTab(sub.value as DineroSubTab)}
                  className={`min-h-[36px] rounded-xl px-3 text-xs font-bold transition ${
                    dineroSubTab === sub.value
                      ? 'bg-slate-900 text-white'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {sub.label}
                </button>
              ))}
            </div>

            {dineroSubTab === 'flujo' && (() => {
              const sheet = reportSheets(data, session.dayKeys, routeFilter, sellerFilter).find((s) => s.id === 'cashFlow')
              if (!sheet || sheet.rows.length <= 1) return <EmptyBlock title="Sin movimientos de efectivo en el periodo" />
              return (
                <SectionCard title="Movimiento de efectivo">
                  <div className="grid gap-2">
                    {sheet.rows.map((row, index) => (
                      <div key={index} className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5 text-xs font-bold text-slate-800">
                        <span>{row[0]}</span>
                        <span className="tabular-nums">{typeof row[3] === 'number' ? formatBs(row[3]) : row[3]}</span>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              )
            })()}

            {dineroSubTab === 'cobros' && (
              collections.length === 0 ? (
                <EmptyBlock title="Sin cobros en el periodo" />
              ) : (
                <ResponsiveTable
                  rows={collections}
                  columns={collectionColumns}
                  keyOf={(row) => row.id}
                  titleOf={(row) => row.customerName}
                />
              )
            )}

            {dineroSubTab === 'gastos' && (
              expenses.length === 0 ? (
                <EmptyBlock title="Sin gastos en el periodo" />
              ) : (
                <ResponsiveTable
                  rows={expenses}
                  columns={expenseColumns}
                  keyOf={(row) => row.id}
                  titleOf={(row) => row.concept}
                />
              )
            )}

            {dineroSubTab === 'arqueos' && (
              closures.length === 0 ? (
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
                            Esperado {formatBs(closure.expectedCash)} · Declarado {formatBs(closure.physicalCashDeclared ?? 0)}
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
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        )}

        {/* ========================================================= */}
        {/* 3. SECCIÓN: VENTAS                                       */}
        {/* ========================================================= */}
        {mainCategory === 'ventas' && (
          <div className="grid gap-3">
            <div className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-2">
              {[
                { value: 'ventas', label: 'Ventas' },
                { value: 'productos', label: 'Productos vendidos' },
                { value: 'ganancias', label: 'Ganancias' },
                { value: 'kardex', label: 'Kardex de ventas' },
                { value: 'clientes', label: 'Compras por cliente' },
              ].map((sub) => (
                <button
                  key={sub.value}
                  type="button"
                  onClick={() => setVentasSubTab(sub.value as VentasSubTab)}
                  className={`min-h-[36px] rounded-xl px-3 text-xs font-bold transition ${
                    ventasSubTab === sub.value
                      ? 'bg-slate-900 text-white'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {sub.label}
                </button>
              ))}
            </div>

            {ventasSubTab === 'ventas' && (
              sales.length === 0 ? (
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
                    titleOf={(row) =>
                      row.lines
                        .map(
                          (line) =>
                            `${line.quantity} × ${line.productNameSnapshot}${line.isPromotional ? ` · promocional ${formatBs(line.actualUnitPrice)}` : ''}`,
                        )
                        .join(', ')
                    }
                    onRowClick={setSelectedSale}
                  />
                  <p className="text-[11px] font-semibold text-slate-500">Toca una venta para reimprimir o compartir su comprobante.</p>
                </>
              )
            )}

            {ventasSubTab === 'productos' && (
              productRows.length === 0 ? (
                <EmptyBlock title="Sin productos vendidos" />
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-bold text-slate-500">
                      Volumen de productos comercializados
                    </p>
                    <button
                      type="button"
                      onClick={() => setVentasSubTab('ganancias')}
                      className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-700 hover:bg-rose-100 transition"
                    >
                      <span>Ver ganancias</span>
                      <ArrowRight size={13} />
                    </button>
                  </div>
                  <ResponsiveTable
                    rows={productRows}
                    columns={[
                      { key: 'cantidad', header: 'Cantidad', render: (row) => formatQty(row.quantity, row.unitType) },
                      { key: 'importe', header: 'Importe', align: 'right', render: (row) => formatBs(row.amount) },
                    ]}
                    keyOf={(row) => row.productId}
                    titleOf={(row) => row.productName}
                  />
                </>
              )
            )}

            {ventasSubTab === 'ganancias' && (
              <div className="grid gap-3">
                {/* 1. KPIs Principales de Ganancia Bruta */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <KpiCard
                    label="Ventas netas"
                    value={formatBs(productProfitReport.totals.salesBs)}
                    tone="primary"
                  />
                  <KpiCard
                    label="Costo de productos"
                    value={
                      productProfitReport.totals.costKnown
                        ? formatBs(productProfitReport.totals.costBs ?? 0)
                        : 'Incompleto'
                    }
                    tone="neutral"
                  />
                  <KpiCard
                    label="Ganancia bruta"
                    value={
                      productProfitReport.totals.costKnown
                        ? formatBs(productProfitReport.totals.profitBs ?? 0)
                        : 'No disponible'
                    }
                    tone={
                      productProfitReport.totals.costKnown && (productProfitReport.totals.profitBs ?? 0) >= 0
                        ? 'positive'
                        : 'warning'
                    }
                  />
                  <KpiCard
                    label="Margen bruto"
                    value={
                      productProfitReport.totals.costKnown && productProfitReport.totals.marginPct !== null
                        ? `${productProfitReport.totals.marginPct.toFixed(1)} %`
                        : 'No disponible'
                    }
                    tone="positive"
                  />
                </div>

                {/* 2. Advertencia si existen costos incompletos */}
                {!productProfitReport.totals.costKnown && (
                  <div className="flex items-start gap-2.5 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 shadow-xs">
                    <AlertTriangle size={18} className="shrink-0 text-amber-600 mt-0.5" />
                    <div>
                      <p className="font-extrabold text-amber-950">
                        Hay ventas históricas sin costo de producción registrado
                      </p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-amber-800">
                        Para no distorsionar la rentabilidad ni proyectar márgenes engañosos, la ganancia bruta de los productos afectados y el total del periodo se indican como no disponibles.
                      </p>
                    </div>
                  </div>
                )}

                {/* 3. Bloque Secundario: Ganancia Operativa Estimada (cuando aplique) */}
                {productProfitReport.operationalTotals.isAvailable ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs">
                    <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2">
                      <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider">
                        Resultado operativo estimado (periodo completo)
                      </span>
                      <span className="text-xs font-black text-slate-900">
                        {formatBs(productProfitReport.operationalTotals.operatingProfit ?? 0)}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[11px]">
                      <div>
                        <span className="block text-[10px] text-slate-500 font-semibold">Gastos de ruta</span>
                        <span className="font-extrabold text-slate-800">
                          - {formatBs(productProfitReport.operationalTotals.spent)}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-slate-500 font-semibold">Pérdidas y mermas</span>
                        <span className="font-extrabold text-slate-800">
                          - {formatBs(productProfitReport.operationalTotals.lossCost)}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-slate-500 font-semibold">Ganancia operativa</span>
                        <span
                          className={`font-black ${
                            (productProfitReport.operationalTotals.operatingProfit ?? 0) >= 0
                              ? 'text-emerald-700'
                              : 'text-rose-700'
                          }`}
                        >
                          {formatBs(productProfitReport.operationalTotals.operatingProfit ?? 0)}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : productProfitReport.operationalTotals.reasonNotAvailable ? (
                  <p className="rounded-xl bg-slate-50 px-3 py-2 text-[10px] font-semibold text-slate-500 italic">
                    * {productProfitReport.operationalTotals.reasonNotAvailable}
                  </p>
                ) : null}

                {/* 4. Tabla y Responsive Cards de Ganancia por Producto */}
                {productProfitReport.items.length === 0 ? (
                  <EmptyBlock
                    title="Sin ventas de productos"
                    description="No se registraron ventas en los filtros seleccionados."
                  />
                ) : (
                  <>
                    <p className="text-[11px] font-bold text-slate-500">
                      Toca cualquier producto para ver las ventas y comprobantes que forman su cálculo.
                    </p>
                    <ResponsiveTable
                      rows={productProfitReport.items}
                      columns={[
                        {
                          key: 'producto',
                          header: 'Producto',
                          render: (row) => (
                            <div>
                              <p className="font-extrabold text-slate-900">{row.productName}</p>
                              {row.presentation && (
                                <p className="text-[10px] text-slate-500">{row.presentation}</p>
                              )}
                            </div>
                          ),
                        },
                        {
                          key: 'cantidad',
                          header: 'Cantidad',
                          align: 'right',
                          render: (row) => formatQty(row.quantity, row.unitType),
                        },
                        {
                          key: 'ventas',
                          header: 'Ventas',
                          align: 'right',
                          render: (row) => formatBs(row.salesBs),
                        },
                        {
                          key: 'costo',
                          header: 'Costo',
                          align: 'right',
                          render: (row) =>
                            row.costBs !== null ? (
                              formatBs(row.costBs)
                            ) : (
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-800">
                                Incompleto
                              </span>
                            ),
                        },
                        {
                          key: 'ganancia',
                          header: 'Ganancia',
                          align: 'right',
                          render: (row) =>
                            row.profitBs !== null ? (
                              <span
                                className={`font-black ${
                                  row.profitBs >= 0 ? 'text-emerald-700' : 'text-rose-700'
                                }`}
                              >
                                {formatBs(row.profitBs)}
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-400 font-semibold">—</span>
                            ),
                        },
                        {
                          key: 'margen',
                          header: 'Margen',
                          align: 'right',
                          render: (row) =>
                            row.marginPct !== null ? (
                              <span className="font-extrabold text-slate-800">
                                {row.marginPct.toFixed(1)} %
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-400 font-semibold">—</span>
                            ),
                        },
                      ]}
                      keyOf={(row) => row.productId}
                      titleOf={(row) => row.productName}
                      onRowClick={(row) => setSelectedProfitProduct(row)}
                    />
                  </>
                )}
              </div>
            )}

            {ventasSubTab === 'kardex' && (() => {
              const sheet = reportSheets(data, session.dayKeys, routeFilter, sellerFilter).find((s) => s.id === 'salesKardex')
              if (!sheet || sheet.rows.length <= 1) return <EmptyBlock title="Sin kardex de ventas en el periodo" />
              return (
                <SectionCard title="Kardex de ventas">
                  <p className="mb-3 text-[11px] font-semibold text-slate-500">
                    Detalle cronológico por línea vendida con lote, cliente y comprobante.
                  </p>
                  <div className="grid gap-2">
                    {sheet.rows.slice(0, 30).map((row, index) => (
                      <div key={index} className="rounded-xl border border-slate-100 bg-slate-50 p-2.5 text-[11px]">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <strong className="text-slate-900">{row[1]}</strong>
                            {row[2] && <span className="ml-1 text-slate-500">· {row[2]}</span>}
                            <p className="text-[10px] text-slate-500 mt-0.5">{row[0]} · Cliente: {row[3]} · Comp: {row[10]}</p>
                          </div>
                          <strong className="text-slate-900 tabular-nums shrink-0">{row[9] !== '' ? formatBs(Number(row[9])) : ''}</strong>
                        </div>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              )
            })()}

            {/* Compras por Cliente */}
            {ventasSubTab === 'clientes' && (
              <div className="grid gap-4">
                {customerPurchasesAgg.clients.length === 0 ? (
                  <EmptyBlock title="Sin compras de clientes en el periodo" />
                ) : (
                  <>
                    {/* Tarjeta Destacada: Cliente que más compró (Responsive) */}
                    {customerPurchasesAgg.topClient && (
                      <div className="w-full min-w-0 max-w-full overflow-hidden rounded-3xl bg-gradient-to-r from-red-600 to-rose-700 p-5 text-white shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-white">
                            <Award size={13} /> Cliente que más compró en el periodo
                          </span>
                          <h2 className="mt-2 truncate text-xl font-black tracking-tight sm:text-2xl">
                            {customerPurchasesAgg.topClient.customerName}
                          </h2>
                          <p className="mt-0.5 text-xs font-semibold text-red-100">
                            {customerPurchasesAgg.topClient.customerCode ? `CI/Código: ${customerPurchasesAgg.topClient.customerCode} · ` : ''}
                            {customerPurchasesAgg.topClient.purchasesCount} pedidos realizados
                          </p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 w-full md:w-auto shrink-0 rounded-2xl bg-white p-3 text-slate-900 shadow-xs">
                          <div className="text-center">
                            <span className="block text-[9px] font-bold uppercase text-slate-400">Total Bs</span>
                            <strong className="text-sm font-black text-rose-700 tabular-nums">
                              {formatBs(customerPurchasesAgg.topClient.totalBs)}
                            </strong>
                          </div>
                          <div className="text-center">
                            <span className="block text-[9px] font-bold uppercase text-slate-400">Kg exactos</span>
                            <strong className="text-sm font-black text-slate-900 tabular-nums">
                              {customerPurchasesAgg.topClient.exactKg.toFixed(1)} kg
                            </strong>
                          </div>
                          <div className="text-center">
                            <span className="block text-[9px] font-bold uppercase text-slate-400">Kg estimados</span>
                            <strong className="text-sm font-black text-slate-700 tabular-nums">
                              {customerPurchasesAgg.topClient.estimatedKg.toFixed(1)} kg
                            </strong>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Ranking de Clientes */}
                    <SectionCard title="Ranking de compras por cliente">
                      <div className="grid gap-2">
                        {customerPurchasesAgg.clients.map((client, index) => {
                          const isExpanded = expandedClientId === client.customerId
                          return (
                            <div key={client.customerId} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                              <button
                                type="button"
                                onClick={() => setExpandedClientId(isExpanded ? null : client.customerId)}
                                className="flex min-h-[56px] w-full items-center justify-between gap-3 p-3 text-left transition hover:bg-slate-50"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-black text-rose-700">#{index + 1}</span>
                                    <p className="truncate text-xs font-extrabold text-slate-900">{client.customerName}</p>
                                    {client.customerCode && (
                                      <span className="text-[10px] text-slate-400">· {client.customerCode}</span>
                                    )}
                                  </div>
                                  <p className="mt-0.5 text-[10px] font-semibold text-slate-500">
                                    {client.kgBreakdown} · {client.purchasesCount} compra(s)
                                  </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="text-xs font-black tabular-nums text-slate-900">
                                    {formatBs(client.totalBs)}
                                  </span>
                                  {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                </div>
                              </button>

                              {isExpanded && (
                                <div className="border-t border-slate-100 bg-slate-50/50 p-3">
                                  <table className="w-full text-left text-xs">
                                    <thead>
                                      <tr className="border-b border-slate-200 text-[10px] font-bold uppercase text-slate-400">
                                        <th className="pb-1.5">Producto</th>
                                        <th className="pb-1.5">Presentación</th>
                                        <th className="pb-1.5 text-right">Cantidad</th>
                                        <th className="pb-1.5 text-right">Kg calc.</th>
                                        <th className="pb-1.5 text-right">Total Bs</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 font-semibold text-slate-700">
                                      {client.products.map((p) => (
                                        <tr key={p.productId}>
                                          <td className="py-1.5 font-bold text-slate-900">{p.productName}</td>
                                          <td className="py-1.5 text-slate-500">{p.presentation}</td>
                                          <td className="py-1.5 text-right tabular-nums">
                                            {formatQty(p.quantity, p.unitType)}
                                          </td>
                                          <td className="py-1.5 text-right tabular-nums text-slate-600">
                                            {p.totalEquivalentKg > 0 ? `${p.totalEquivalentKg.toFixed(1)} kg` : '-'}
                                          </td>
                                          <td className="py-1.5 text-right font-black tabular-nums text-slate-900">
                                            {formatBs(p.totalBs)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>

                      {/* Consolidado Global */}
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-50 p-3.5 text-xs font-bold text-slate-800">
                        <span>Total general compras del periodo:</span>
                        <div className="flex items-center gap-3">
                          <span className="text-slate-600">
                            {customerPurchasesAgg.grandTotalEquivalentKg.toFixed(1)} kg equiv.
                          </span>
                          <span className="text-sm font-black text-rose-700 tabular-nums">
                            {formatBs(customerPurchasesAgg.grandTotalBs)}
                          </span>
                        </div>
                      </div>
                    </SectionCard>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* ========================================================= */}
        {/* 4. SECCIÓN: CRÉDITOS                                     */}
        {/* ========================================================= */}
        {mainCategory === 'creditos' && (
          <div className="grid gap-3">
            {data.receivables.length === 0 ? (
              <EmptyBlock title="Sin créditos registrados" />
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
            )}
          </div>
        )}

        {/* ========================================================= */}
        {/* 5. SECCIÓN: INVENTARIO                                    */}
        {/* ========================================================= */}
        {mainCategory === 'inventario' && (
          <div className="grid gap-3">
            <div className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-2">
              {[
                { value: 'existencias', label: 'Existencias actuales' },
                { value: 'movimientos', label: 'Movimientos' },
              ].map((sub) => (
                <button
                  key={sub.value}
                  type="button"
                  onClick={() => setInventarioSubTab(sub.value as InventarioSubTab)}
                  className={`min-h-[36px] rounded-xl px-3 text-xs font-bold transition ${
                    inventarioSubTab === sub.value
                      ? 'bg-slate-900 text-white'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {sub.label}
                </button>
              ))}
            </div>

            {inventarioSubTab === 'existencias' && (() => {
              const sheet = reportSheets(data, session.dayKeys, routeFilter, sellerFilter).find((s) => s.id === 'inventory')
              if (!sheet || sheet.rows.length <= 1) return <EmptyBlock title="Sin existencias en almacenes" />
              return (
                <SectionCard title="Existencias por almacén">
                  <div className="grid gap-2">
                    {sheet.rows.map((row, index) => (
                      <div key={index} className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5 text-xs font-semibold text-slate-800">
                        <div>
                          <strong className="text-slate-900">{row[1]}</strong>
                          <span className="ml-1 text-[11px] text-slate-500">· {row[0]}</span>
                        </div>
                        <span className="font-black tabular-nums">{row[3]} {row[5]}</span>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              )
            })()}

            {inventarioSubTab === 'movimientos' && (() => {
              const sheet = reportSheets(data, session.dayKeys, routeFilter, sellerFilter).find((s) => s.id === 'movements')
              if (!sheet || sheet.rows.length <= 1) return <EmptyBlock title="Sin movimientos de inventario en el periodo" />
              return (
                <SectionCard title="Movimientos de inventario">
                  <div className="grid gap-2">
                    {sheet.rows.slice(0, 30).map((row, index) => (
                      <div key={index} className="rounded-xl border border-slate-100 bg-slate-50 p-2.5 text-[11px]">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <strong className="text-slate-900">{row[1]}</strong>
                            <p className="mt-0.5 text-[10px] text-slate-500">{row[0]} · {row[2]} · {row[5]} → {row[6]}</p>
                          </div>
                          <span className="font-black tabular-nums text-slate-900">{row[3]} {row[4]}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              )
            })()}
          </div>
        )}
      </div>

      <ChoiceModal
        isOpen={isSellerOpen}
        onClose={() => setIsSellerOpen(false)}
        title="Filtrar por vendedor"
        searchable
        options={[{ value: '', label: 'Todos los vendedores' }, ...allSellers.map((s) => ({ value: s.sellerUid, label: s.sellerName }))]}
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
        isOpen={Boolean(selectedProfitProduct)}
        onClose={() => setSelectedProfitProduct(null)}
        title={selectedProfitProduct ? selectedProfitProduct.productName : ''}
        subtitle={
          selectedProfitProduct
            ? `${selectedProfitProduct.presentation || 'Sin presentación'} · ${formatQty(selectedProfitProduct.quantity, selectedProfitProduct.unitType)} vendidos`
            : ''
        }
      >
        {selectedProfitProduct && (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="rounded-xl bg-slate-50 p-2.5">
                <span className="text-[10px] font-bold text-slate-500 uppercase">Ventas</span>
                <p className="text-xs font-black text-slate-900 tabular-nums">
                  {formatBs(selectedProfitProduct.salesBs)}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-2.5">
                <span className="text-[10px] font-bold text-slate-500 uppercase">Costo</span>
                <p className="text-xs font-black text-slate-900 tabular-nums">
                  {selectedProfitProduct.costBs !== null
                    ? formatBs(selectedProfitProduct.costBs)
                    : 'Incompleto'}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-2.5">
                <span className="text-[10px] font-bold text-slate-500 uppercase">Ganancia Bruta</span>
                <p
                  className={`text-xs font-black tabular-nums ${
                    selectedProfitProduct.profitBs !== null
                      ? selectedProfitProduct.profitBs >= 0
                        ? 'text-emerald-700'
                        : 'text-rose-700'
                      : 'text-slate-500'
                  }`}
                >
                  {selectedProfitProduct.profitBs !== null
                    ? formatBs(selectedProfitProduct.profitBs)
                    : 'No disponible'}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-2.5">
                <span className="text-[10px] font-bold text-slate-500 uppercase">Margen</span>
                <p className="text-xs font-black text-slate-900 tabular-nums">
                  {selectedProfitProduct.marginPct !== null
                    ? `${selectedProfitProduct.marginPct.toFixed(1)} %`
                    : '—'}
                </p>
              </div>
            </div>

            {!selectedProfitProduct.costKnown && (
              <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-2.5 text-xs text-amber-800">
                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600" />
                <span>
                  Este producto tiene ventas históricas sin costo registrado en el momento de la venta.
                  No se muestra ganancia ni margen para no proyectar cifras inexactas.
                </span>
              </div>
            )}

            <div>
              <p className="mb-1.5 text-xs font-bold text-slate-700">
                Detalle de movimientos y ventas ({selectedProfitProduct.lineDetails.length})
              </p>
              <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
                {selectedProfitProduct.lineDetails.length === 0 ? (
                  <p className="p-3 text-center text-xs text-slate-400">Sin movimientos detallados</p>
                ) : (
                  selectedProfitProduct.lineDetails.map((detail, idx) => (
                    <div key={`${detail.saleId}-${idx}`} className="p-2.5 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-extrabold text-slate-900">{detail.voucherCode}</span>
                            {detail.isCorrected && (
                              <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[9px] font-bold text-sky-800">
                                CORREGIDA
                              </span>
                            )}
                            {detail.isClaimRelated && (
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-800">
                                {detail.claimKind === 'return' ? 'DEVOLUCIÓN' : 'CAMBIO'}
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-[11px] text-slate-600">
                            {detail.customerName} · {detail.routeName} ({detail.sellerName})
                          </p>
                          <p className="text-[10px] text-slate-400">
                            {reportDateTime(detail.createdAt)}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-bold text-slate-900 tabular-nums">
                            {formatQty(detail.quantity, detail.unitType)} × {formatBs(detail.actualUnitPrice)}
                          </p>
                          <p className="text-[11px] font-extrabold text-slate-800 tabular-nums">
                            Venta: {formatBs(detail.saleBs)}
                          </p>
                          {detail.costBs !== null && (
                            <p className="text-[10px] text-slate-500 tabular-nums">
                              Costo: {formatBs(detail.costBs)}
                              {detail.profitBs !== null && (
                                <span
                                  className={`ml-1 font-bold ${
                                    detail.profitBs >= 0 ? 'text-emerald-700' : 'text-rose-700'
                                  }`}
                                >
                                  (Gan: {formatBs(detail.profitBs)})
                                </span>
                              )}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal de Selección de Reportes para Exportar */}
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
