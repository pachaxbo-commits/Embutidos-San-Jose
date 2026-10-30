import {
  exportExcel,
  exportPdf,
  reportAttributionError,
  sellerKilogramReportError,
  reportSheets,
  type ReportSheetId,
  REPORT_OPTIONS,
  ALL_REPORT_IDS,
  defaultSheetIdForTab,
  filterReportSheets,
} from '../data/reportExports'
import { reportDateTime, reportPaymentLabel, reportPersonName, reportRecordName } from '../domain/reportLabels'
import { useMemo, useState } from 'react'
import { Screen, ResponsiveTable, EmptyBlock, type ResponsiveColumn } from '../../../components/ui/Screen'
import { Field, TextInput } from '../../../components/ui/Form'
import { ChoiceButton, ChoiceModal } from '../../../components/ui/ChoiceModal'
import { Modal } from '../../../components/ui/Modal'
import { AlertTriangle, ArrowRight, Award, Check, ChevronDown, ChevronRight, FileSpreadsheet, FileText, HelpCircle, Printer, Search, Send } from 'lucide-react'
import { printLargeSaleReceipt, printSaleReceipt, shareSaleReceipt } from '../data/distributionReceiptService'
import {
  computeMoneySummary,
  computeSellerBreakdown,
  computeSellerKilogramsByProduct,
  cashMovementRouteId,
  cashMovementSellerUid,
  computeSoldByProduct,
  computeSoldKilograms,
  computeSoldPackages,
  matchesRoute,
  round2,
  toDayKey,
} from '../domain/engine'
import { KpiCard, PrimaryButton, SecondaryButton, SectionCard, VarianceBadge, formatBs, formatQty } from './shared'
import { ClosureRectificationAudit } from './ClosureRectificationAudit'
import { RangePicker, describeRange } from './RangePicker'
import { printHtmlDocument } from '../../../services/printing/documentPrintService'
import type { DistributionViewProps } from './DistributionApp'
import type { DistCollection, DistExpense, DistSale } from '../types'
import { aggregateCustomerPurchases } from '../domain/customerPurchases'
import { expenseCashPaidAmount } from '../domain/expenseAccounting'
import { computeProductProfitReport, type ProductProfitSummaryItem } from '../domain/productProfit'
import {
  computeAsOfReceivablesPortfolio,
  computeCreditPortfolioByRoute,
  resolveCreditProducts,
} from '../domain/creditRoutes'
import { closuresInPeriod } from '../domain/closurePeriod'
import { closureReopenEvents } from '../domain/closureAudit'
import { computeDistributorDifferences } from '../domain/distributorDifferences'
import { MermaReportView } from './MermaReportView'

type MainCategory = 'resumen' | 'dinero' | 'ventas' | 'creditos' | 'inventario'
type DineroSubTab = 'flujo' | 'cobros' | 'gastos' | 'arqueos'
type VentasSubTab = 'ventas' | 'sellerKg' | 'cortesias' | 'productos' | 'ganancias' | 'kardex' | 'clientes'
type InventarioSubTab = 'existencias' | 'movimientos' | 'diferencias' | 'mermas'

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
  const [selectedDifferenceClosure, setSelectedDifferenceClosure] = useState<DistributionViewProps['data']['closures'][number] | null>(null)
  const [customerSearchTerm, setCustomerSearchTerm] = useState('')
  const [showSellerProductDetails, setShowSellerProductDetails] = useState(false)

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
      return inventarioSubTab === 'existencias' ? 'inventario' : inventarioSubTab === 'movimientos' ? 'movimientos' : inventarioSubTab === 'mermas' ? 'mermas' : 'diferencias'
    }
    return 'resumen'
  }, [mainCategory, dineroSubTab, ventasSubTab, inventarioSubTab])

  const allSellers = useMemo(
    () => computeSellerBreakdown(data.sales, data.collections, data.expenses, data.claims, data.products),
    [data.sales, data.collections, data.expenses, data.claims, data.products],
  )
  const sellerOptions = useMemo(() => {
    const sellers = new Map(allSellers.map((seller) => [seller.sellerUid, seller.sellerName]))
    for (const closure of data.closures) if (closure.distributorUid && closure.distributorName) sellers.set(closure.distributorUid, closure.distributorName)
    return [...sellers.entries()].map(([sellerUid, sellerName]) => ({ sellerUid, sellerName }))
  }, [allSellers, data.closures])
  const distributorDifferences = useMemo(
    () => computeDistributorDifferences(data.closures, data.movements, session.dayKeys, routeFilter, sellerFilter),
    [data.closures, data.movements, session.dayKeys, routeFilter, sellerFilter],
  )

  const handleOpenExportModal = (kind: 'Excel' | 'PDF') => {
    setPendingExportKind(kind)
    setSelectedSheetIds(new Set([defaultSheetIdForTab(currentTabCode)]))
    setExportError('')
    setIsExportModalOpen(true)
  }

  const sellerKgError = sellerKilogramReportError(data, session.dayKeys, routeFilter, sellerFilter)
  const printSellerKilograms = async () => {
    if (sellerKgError) { setExportError(sellerKgError); return }
    try {
      const sheet = reportSheets(data, session.dayKeys, routeFilter, sellerFilter).find(row => row.id === 'sellerSummary')
      if (!sheet) throw new Error('No se pudo preparar el reporte por chofer.')
      const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character))
      const tableRows = sheet.rows.map(row => `<tr>${row.map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')
      const productRows = showSellerProductDetails ? sellerProductKilograms.map(row => `<tr><td>${esc(row.sellerName)}</td><td>${esc(row.routeNames.join(' · '))}</td><td>${esc(row.productName)}</td><td>${row.granelKilograms.toFixed(3)}</td><td>${row.documentedSachetKilograms.toFixed(3)}</td><td>${row.estimatedSachetKilograms.toFixed(3)}</td><td>${row.totalDocumentedKilograms.toFixed(3)}</td><td>${row.unknownWeightPackages}</td></tr>`).join('') : ''
      const productDetailTable = showSellerProductDetails ? `<h3>Detalle por producto</h3><table><thead><tr><th>Chofer</th><th>Ruta</th><th>Producto</th><th>Granel kg</th><th>Sachets doc. kg</th><th>Estimados kg</th><th>Total doc. kg</th><th>Paquetes sin peso</th></tr></thead><tbody>${productRows || '<tr><td colspan="8">Sin detalle por producto en el período.</td></tr>'}</tbody></table>` : ''
      const routeName = routeFilter ? reportRecordName(data.routes.find(route => route.id === routeFilter)?.name, routeFilter) : 'Todas las rutas'
      const sellerName = sellerFilter ? reportPersonName(sellerOptions.find(seller => seller.sellerUid === sellerFilter)?.sellerName) : 'Todos los choferes'
      const html = `<!doctype html><html lang="es"><meta charset="utf-8"><title>Kg vendidos por chofer</title><style>body{font:12px Arial,sans-serif;color:#172033;margin:24px}h1{color:#a20f25;margin-bottom:4px}.meta{color:#475569;margin:4px 0 18px}table{width:100%;border-collapse:collapse;font-size:10px;margin-bottom:18px}thead{display:table-header-group}tr{break-inside:avoid}th,td{border:1px solid #cbd5e1;padding:6px;text-align:left}th{background:#f1f5f9}tr:last-child{font-weight:bold;background:#f8fafc}.note{margin-top:12px;color:#475569;font-size:10px}@page{size:landscape;margin:12mm}@media print{body{margin:0}}</style><h1>EMBUTIDOS SAN JOSÉ</h1><h2>KG VENDIDOS POR CHOFER</h2><p class="meta">Período: ${esc(describeRange(session.dayKeys))} · Ruta: ${esc(routeName)} · Chofer: ${esc(sellerName)}<br>Emitido: ${esc(new Date().toLocaleString('es-BO'))}</p><table><thead><tr>${sheet.headers.map(header => `<th>${esc(header)}</th>`).join('')}</tr></thead><tbody>${tableRows}</tbody></table>${productDetailTable}<p class="note">Los sachets estimados se muestran separados. Paquetes sin peso fiable no se convierten en kilogramos documentados.</p></html>`
      await printHtmlDocument(html, 'Kg vendidos por chofer')
      setExportError('')
    } catch (failure) { setExportError((failure as Error).message || 'No se pudo abrir la impresión.') }
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
      if (selectedSheetIds.has('sellerSummary')) {
        const kgError = sellerKilogramReportError(data, session.dayKeys, routeFilter, sellerFilter)
        if (kgError) throw new Error(kgError)
      }
      const sheets = filterReportSheets(allSheets, selectedSheetIds)
      if (sheets.length === 0) {
        throw new Error('Selecciona al menos un reporte.')
      }
      const routeName = routeFilter
        ? (routeFilter === 'administracion' || routeFilter === 'admin'
            ? 'Administración'
            : routeFilter === 'route-impulsacion' || routeFilter === 'route-directa'
              ? 'Impulsación'
              : reportRecordName(data.routes.find((route) => route.id === routeFilter)?.name, 'Ruta seleccionada'))
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
        .filter((sale) => !sale.pendingConfirmation && sale.saleKind !== 'courtesy')
        .filter((sale) => !routeFilter || matchesRoute(sale.routeId, routeFilter))
        .filter((sale) => !sellerFilter || sale.sellerUid === sellerFilter),
    [data.sales, routeFilter, sellerFilter],
  )
  const courtesySales = useMemo(() => data.sales.filter(sale => !sale.pendingConfirmation && sale.saleKind === 'courtesy' && (!routeFilter || matchesRoute(sale.routeId, routeFilter)) && (!sellerFilter || sale.sellerUid === sellerFilter)), [data.sales, routeFilter, sellerFilter])
  const collections = useMemo(
    () =>
      data.collections
        .filter((row) => !row.pendingConfirmation)
        .filter((row) => !routeFilter || matchesRoute(row.routeId, routeFilter))
        .filter((row) => !sellerFilter || row.collectedByUid === sellerFilter),
    [data.collections, routeFilter, sellerFilter],
  )
  const expenses = useMemo(
    () =>
      data.expenses
        .filter((row) => !row.pendingConfirmation && !row.voided)
        .filter((row) => !routeFilter || matchesRoute(row.routeId, routeFilter))
        .filter((row) => !sellerFilter || row.registeredByUid === sellerFilter),
    [data.expenses, routeFilter, sellerFilter],
  )
  const closures = useMemo(
    () => closuresInPeriod(data.closures, session.dayKeys).filter((row) => !routeFilter || matchesRoute(row.routeId, routeFilter)),
    [data.closures, session.dayKeys, routeFilter],
  )

  const claims = useMemo(
    () =>
      data.claims
        .filter((claim) => session.dayKeys.includes(claim.dayKey || toDayKey(claim.createdAt)))
        .filter((claim) => !routeFilter || matchesRoute(cashMovementRouteId(claim), routeFilter))
        .filter(
          (claim) =>
            !sellerFilter ||
            cashMovementSellerUid(claim) === sellerFilter ||
            (!claim.sellerUid && data.sales.some((sale) => sale.id === claim.saleId && sale.sellerUid === sellerFilter)),
        ),
    [data.claims, data.sales, session.dayKeys, routeFilter, sellerFilter],
  )

  const money = useMemo(() => {
    return computeMoneySummary(sales, collections, expenses, claims)
  }, [sales, collections, expenses, claims])

  const sellers = useMemo(
    () => computeSellerBreakdown(sales, collections, expenses, claims, data.products),
    [sales, collections, expenses, claims, data.products],
  )
  const sellerProductKilograms = computeSellerKilogramsByProduct(sales, claims, data.products, sellerFilter)

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

  const filteredCustomerPurchases = useMemo(() => {
    const term = customerSearchTerm.trim().toLowerCase()
    if (!term) return customerPurchasesAgg.clients
    return customerPurchasesAgg.clients.filter((client) =>
      [client.customerName, client.customerCode].join(' ').toLowerCase().includes(term),
    )
  }, [customerPurchasesAgg.clients, customerSearchTerm])

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
    const commercialSales = sales
      .filter((s) => !s.voidedAt && !s.pendingConfirmation && s.saleKind !== 'courtesy')
      .map((s) => s.effectiveSnapshot ? { ...s, ...s.effectiveSnapshot } : s)
    const lines = commercialSales.flatMap((s) => s.lines)
    const revenue = round2(
      commercialSales.reduce((n, s) => n + s.total, 0) + claims.reduce((n, c) => n + c.revenueDelta, 0),
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
      .filter((m) => !m.reversedAt)
      .filter((m) => session.dayKeys.includes(m.dayKey || toDayKey(m.createdAt)))
      .filter((m) => !routeFilter || matchesRoute(m.routeId, routeFilter))
      .filter((m) => m.type === 'shortage' || m.type === 'return_waste' || m.type === 'return_waste_unassigned' || m.type === 'courtesy' || m.type === 'processing_discard' || (m.type === 'adjustment' && m.centralDelta < 0))
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

  const [creditSearchTerm, setCreditSearchTerm] = useState('')
  const [expandedCreditCustomerId, setExpandedCreditCustomerId] = useState<string | null>(null)

  const cutoffDayKey = useMemo(() => {
    if (!session.dayKeys || session.dayKeys.length === 0) return undefined
    const sorted = [...session.dayKeys].sort()
    return sorted[sorted.length - 1]
  }, [session.dayKeys])

  const asOfReceivables = useMemo(() => {
    return computeAsOfReceivablesPortfolio({
      receivables: data.receivables,
      collections: data.collections,
      adjustments: data.receivableAdjustments,
      cutoffDayKey,
    })
  }, [data.receivables, data.collections, data.receivableAdjustments, cutoffDayKey])

  const salesMap = useMemo(() => new Map(data.sales.map((s) => [s.id, s])), [data.sales])

  const creditPortfolio = useMemo(() => {
    return computeCreditPortfolioByRoute({
      receivables: asOfReceivables,
      selectedRouteId: routeFilter,
      routes: data.routes,
      customers: data.customers,
      salesById: salesMap,
    })
  }, [asOfReceivables, routeFilter, data.routes, data.customers, salesMap])

  const filteredCustomerCredits = useMemo(() => {
    let list = creditPortfolio.customerCredits
    if (sellerFilter) {
      list = list.filter((c) =>
        c.filteredReceivables.some((r) => r.distributorUid === sellerFilter),
      )
    }
    if (creditSearchTerm.trim()) {
      const term = creditSearchTerm.toLowerCase().trim()
      list = list.filter(
        (c) =>
          c.customerName.toLowerCase().includes(term) ||
          (c.customerCode && c.customerCode.toLowerCase().includes(term)) ||
          (c.identityNumber && c.identityNumber.toLowerCase().includes(term)),
      )
    }
    return list
  }, [creditPortfolio.customerCredits, sellerFilter, creditSearchTerm])

  const periodCollections = useMemo(() => {
    return data.collections.filter((c) => {
      const day = c.dayKey || toDayKey(c.createdAt)
      const inPeriod = session.dayKeys.includes(day)
      const matchRoute = !routeFilter || matchesRoute(c.routeId, routeFilter) || matchesRoute(c.originRouteId, routeFilter)
      const matchSeller = !sellerFilter || c.collectedByUid === sellerFilter
      return inPeriod && matchRoute && matchSeller
    })
  }, [data.collections, session.dayKeys, routeFilter, sellerFilter])

  const totalCollectedInPeriod = useMemo(() => {
    return round2(periodCollections.reduce((sum, c) => sum + (c.amount || 0), 0))
  }, [periodCollections])

  const reconciliation = useMemo(() => {
    const periodSalesTotal = money.salesTotal
    const periodCashSales = money.cashSales
    const periodQrSales = money.qrSales
    const periodCreditSales = money.creditGenerated

    const periodCashCollections = round2(
      collections.reduce((sum, c) => sum + (c.cashAmount ?? (c.method === 'cash' ? c.amount : 0)), 0),
    )
    const periodCashExpenses = round2(expenses.reduce((sum, e) => sum + expenseCashPaidAmount(e), 0))

    const claimsCashNet = money.claimCash

    const expectedCash = money.expectedCash
    const declaredCash = round2(closures.reduce((sum, cl) => sum + (cl.physicalCashDeclared ?? 0), 0))
    const cashDifference = round2(declaredCash - expectedCash)

    return {
      salesTotal: periodSalesTotal,
      cashSales: periodCashSales,
      qrSales: periodQrSales,
      creditSales: periodCreditSales,
      cashCollections: periodCashCollections,
      cashExpenses: periodCashExpenses,
      claimsCashNet,
      voidedCashReceipts: money.voidedCashReceipts,
      voidedQrReceipts: money.voidedQrReceipts,
      claimQr: money.claimQr,
      expectedCash,
      declaredCash,
      cashDifference,
    }
  }, [collections, expenses, closures, money.cashSales, money.claimCash, money.claimQr, money.creditGenerated, money.expectedCash, money.qrSales, money.salesTotal, money.voidedCashReceipts, money.voidedQrReceipts])

  const isMultiDay = session.dayKeys.length > 1
  const formatReportDateTime = (isoDate: string) => {
    const d = new Date(isoDate)
    if (isNaN(d.getTime())) return isoDate
    const timeStr = d.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })
    if (!isMultiDay) return timeStr
    const day = String(d.getDate()).padStart(2, '0')
    const month = String(d.getMonth() + 1).padStart(2, '0')
    return `${day}/${month} ${timeStr}`
  }

  const saleColumns: ResponsiveColumn<DistSale>[] = [
    {
      key: 'hora',
      header: isMultiDay ? 'Fecha / Hora' : 'Hora',
      render: (row) => formatReportDateTime(row.createdAt),
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
      header: isMultiDay ? 'Fecha / Hora' : 'Hora',
      render: (row) => formatReportDateTime(row.createdAt),
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
      header: isMultiDay ? 'Fecha / Hora' : 'Hora',
      render: (row) => formatReportDateTime(row.createdAt),
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
          <button type="button" onClick={() => { setMainCategory('ventas'); setVentasSubTab('sellerKg'); setExportError('') }} className="flex min-h-11 items-center gap-2 rounded-2xl bg-[var(--primary)] px-4 py-3 text-sm font-extrabold text-white shadow-sm"><Award size={16}/> Kg vendidos por chofer</button>
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

        {(sellerOptions.length > 1 || (mainCategory === 'inventario' && inventarioSubTab === 'diferencias') || (mainCategory === 'ventas' && ventasSubTab === 'sellerKg')) && (
          <Field label="Distribuidor / vendedor">
            <ChoiceButton
              label={sellerFilter ? sellerOptions.find((s) => s.sellerUid === sellerFilter)?.sellerName : 'Todos los vendedores'}
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
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-7">
              <KpiCard label="Ventas netas" value={formatBs(operatingFinancials.revenue)} tone="primary" hint={`${sales.length} ventas`} />
              <KpiCard label="Efectivo esperado" value={formatBs(money.expectedCash)} tone="positive" hint="Ventas + cobros + cambios - gastos" />
              <KpiCard label="Cobro original anulado" value={formatBs(money.voidedCashReceipts)} hint="Movimiento histórico de caja; no es venta neta" />
              <KpiCard label="Reembolsos efectivo netos" value={formatBs(Math.min(0, money.claimCash))} hint="Registrados en su jornada y caja" />
              <KpiCard label="Movimientos QR de anulaciones" value={formatBs(money.voidedQrReceipts + money.claimQr)} hint="Separados del efectivo físico" />
              <KpiCard label="Crédito generado" value={formatBs(money.creditGenerated)} tone="warning" />
              <KpiCard label="Gastos de ruta" value={formatBs(money.cashExpenses)} tone="danger" />
              <KpiCard label="Entregas de cortesía" value={`${courtesySales.length}`} tone="warning" hint="No son ventas ni cobros" />
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
                      <span className="text-[10px] text-slate-500">Faltantes, mermas de retorno y cortesías</span>
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
                      <KpiCard label="Kg vendidos a granel" value={`${seller.kilograms.toFixed(3)} kg`} />
                      <KpiCard label="Kg en sachets documentados" value={`${seller.documentedSachetKilograms.toFixed(3)} kg`} />
                      <KpiCard label="Total kg documentados" value={`${seller.totalDocumentedKilograms.toFixed(3)} kg`} tone="positive" />
                      <KpiCard label="Sachets (peso estimado)" value={seller.estimatedSachetKilograms > 0 ? `≈ ${seller.estimatedSachetKilograms.toFixed(3)} kg` : '—'} />
                      <KpiCard label="Paquetes vendidos" value={String(seller.packages)} />
                      <KpiCard label="Paquetes sin peso fiable" value={seller.unknownWeightPackages > 0 ? `${seller.unknownWeightPackages} · peso no disponible` : '0'} />
                    </div>
                    {(() => {
                      const sellerClosures = closures.filter((c) => c.distributorUid === seller.sellerUid)
                      const declaredBySeller = sellerClosures.length > 0
                        ? round2(sellerClosures.reduce((sum, c) => sum + (c.physicalCashDeclared ?? 0), 0))
                        : null
                      const sellerDifference = declaredBySeller !== null ? round2(declaredBySeller - seller.expectedCash) : null

                      return (
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-50 px-3 py-2.5">
                          <div>
                            <span className="block text-[11px] font-extrabold uppercase text-slate-500">Efectivo esperado</span>
                            <span className="text-base font-black tabular-nums text-slate-900">{formatBs(seller.expectedCash)}</span>
                          </div>
                          {declaredBySeller !== null ? (
                            <div className="flex items-center gap-3">
                              <div>
                                <span className="block text-[11px] font-extrabold uppercase text-slate-500">Declarado en arqueo</span>
                                <span className="text-base font-black tabular-nums text-slate-900">{formatBs(declaredBySeller)}</span>
                              </div>
                              <div>
                                <span className="block text-[11px] font-extrabold uppercase text-slate-500">Diferencia</span>
                                <VarianceBadge variance={sellerDifference!} />
                              </div>
                            </div>
                          ) : (
                            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                              Sin arqueo registrado
                            </span>
                          )}
                        </div>
                      )
                    })()}
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

            {dineroSubTab === 'flujo' && (
              <div className="grid gap-3">
                {/* Conciliación Matemática: Ventas Totales vs Efectivo Físico */}
                <SectionCard title="Conciliación matemática: Ventas vs Efectivo físico">
                  <div className="grid gap-3 text-xs">
                    <p className="text-slate-500 text-[11px] font-medium leading-relaxed">
                      Explica el puente contable entre el total de ventas facturadas y el efectivo real esperado/declarado en caja.
                    </p>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
                      <div className="flex items-center justify-between font-bold text-slate-800">
                        <span>1. Ventas Totales del Periodo (Brutas):</span>
                        <span className="text-sm font-black text-slate-900">{formatBs(reconciliation.salesTotal)}</span>
                      </div>
                      <div className="mt-2 grid gap-1.5 pl-3 text-[11px] text-slate-600">
                        <div className="flex justify-between">
                          <span>• Ventas cobradas en efectivo:</span>
                          <span className="font-bold text-emerald-700">{formatBs(reconciliation.cashSales)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>• Ventas por QR (no entran en efectivo físico):</span>
                          <span className="font-bold text-slate-500">- {formatBs(reconciliation.qrSales)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>• Ventas a Crédito (no entran en efectivo físico):</span>
                          <span className="font-bold text-amber-700">- {formatBs(reconciliation.creditSales)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
                      <span className="font-bold text-slate-800">2. Flujos adicionales de caja en efectivo:</span>
                      <div className="mt-2 grid gap-1.5 pl-3 text-[11px] text-slate-600">
                        <div className="flex justify-between">
                          <span>+ Cobranzas de créditos en efectivo:</span>
                          <span className="font-bold text-emerald-700">+ {formatBs(reconciliation.cashCollections)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>- Gastos operativos de ruta en efectivo:</span>
                          <span className="font-bold text-rose-700">- {formatBs(reconciliation.cashExpenses)}</span>
                        </div>
                        {reconciliation.claimsCashNet !== 0 && (
                          <div className="flex justify-between">
                            <span>± Ajuste neto por reclamos en efectivo:</span>
                            <span className="font-bold text-slate-700">{formatBs(reconciliation.claimsCashNet)}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border-2 border-slate-900 bg-slate-900 p-3.5 text-white">
                      <div>
                        <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-300">
                          = Efectivo Físico Esperado en Caja:
                        </span>
                        <span className="text-[11px] text-slate-400">
                          Ventas Ef. + Cobros Ef. - Gastos Ef. ± Reclamos
                        </span>
                      </div>
                      <span className="text-lg font-black tabular-nums text-white">{formatBs(reconciliation.expectedCash)}</span>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-3.5">
                      <div>
                        <span className="block text-xs font-bold text-slate-800">Efectivo Físico Declarado en Arqueos:</span>
                        <span className="text-[11px] text-slate-500">Monto real contado y entregado por distribuidores</span>
                      </div>
                      <span className="text-base font-black tabular-nums text-slate-900">{formatBs(reconciliation.declaredCash)}</span>
                    </div>

                    <div className={`flex items-center justify-between rounded-2xl p-3.5 text-xs font-bold ${
                      reconciliation.cashDifference === 0
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : reconciliation.cashDifference > 0
                          ? 'bg-blue-50 text-blue-800 border border-blue-200'
                          : 'bg-rose-50 text-rose-800 border border-rose-200'
                    }`}>
                      <span>
                        {reconciliation.cashDifference === 0
                          ? 'Caja exacta sin diferencia (Cuadre perfecto)'
                          : reconciliation.cashDifference > 0
                            ? 'Sobrante en arqueo físico (+):'
                            : 'Faltante en arqueo físico (-):'}
                      </span>
                      <span className="text-sm font-black tabular-nums">{formatBs(reconciliation.cashDifference)}</span>
                    </div>
                  </div>
                </SectionCard>

                {(() => {
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
              </div>
            )}

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
                <EmptyBlock title="Sin arqueos guardados" description="Aparecen cuando se cierra una ruta o la caja de administración." />
              ) : (
                <div className="grid gap-3">
                  {closures.map((closure) => (
                    <article key={closure.id} className="w-full min-w-0 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-black uppercase text-slate-600">
                              {closure.closureType === 'admin' ? 'Arqueo Administración' : 'Arqueo Ruta'}
                            </span>
                            <h4 className="text-sm font-extrabold text-slate-900">
                              {closure.routeName} · {closure.distributorName}
                            </h4>
                          </div>
                          <p className="mt-0.5 text-[11px] font-semibold text-slate-500">
                            {closure.dayKey ? `Jornada ${closure.dayKey}` : ''}{closure.closedAt ? ` · Cierre actual ${new Date(closure.closedAt).toLocaleString('es-BO')}` : (closure.createdAt ? ` · Creado el ${new Date(closure.createdAt).toLocaleString('es-BO')}` : '')}
                            {closure.warehouseResponsibleName ? ` · Recepción almacén: ${closure.warehouseResponsibleName}` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {(closure.reopenedAt || (closure.reopenHistory?.length || 0) > 0) && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black text-amber-900">REABIERTO</span>}
                          {closure.rectification && <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-black text-blue-900">RECTIFICADO</span>}
                          {closure.status === 'closed' ? (
                            <VarianceBadge variance={closure.cashDifference} />
                          ) : (
                            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-black text-amber-800">
                              CAJA PENDIENTE
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Auditoría de reapertura si fue reabierto */}
                      <ClosureRectificationAudit closure={closure} />
                      {closureReopenEvents(closure).length > 0 && (
                        <div className="mt-2.5 rounded-2xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
                          <p className="mb-1 font-extrabold">HISTORIAL DE REAPERTURAS</p>
                          {closureReopenEvents(closure).map((event, index) => <p key={`${event.reopenedAt || 'reopen'}-${index}`} className="mt-1 break-words">
                            {event.reopenedAt && <>Reabierto: {new Date(event.reopenedAt).toLocaleString('es-BO')}. </>}
                            {event.previousClosedAt && <>Cierre anterior: {new Date(event.previousClosedAt).toLocaleString('es-BO')}. </>}
                            {event.previousWarehouseClosedAt && <>Recepción anterior de almacén: {new Date(event.previousWarehouseClosedAt).toLocaleString('es-BO')}. </>}
                            {(event.reopenedByName || event.reopenedBy) && <>Por: {event.reopenedByName || event.reopenedBy}. </>}
                            {event.reason && <>Motivo: “{event.reason}”.</>}
                          </p>)}
                        </div>
                      )}

                      {/* Grilla con los 8 valores financieros */}
                      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-2.5">
                          <span className="text-[10px] font-bold uppercase text-slate-400">1. Ventas Efectivo</span>
                          <p className="mt-0.5 text-xs font-extrabold text-slate-900">{formatBs(closure.cashSales)}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-2.5">
                          <span className="text-[10px] font-bold uppercase text-slate-400">2. Ventas QR</span>
                          <p className="mt-0.5 text-xs font-extrabold text-slate-900">{formatBs(closure.qrSales)}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-2.5">
                          <span className="text-[10px] font-bold uppercase text-slate-400">3. Crédito Generado</span>
                          <p className="mt-0.5 text-xs font-extrabold text-amber-800">{formatBs(closure.creditGenerated)}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-2.5">
                          <span className="text-[10px] font-bold uppercase text-slate-400">4. Cobros Efectivo</span>
                          <p className="mt-0.5 text-xs font-extrabold text-emerald-700">{formatBs(closure.cashCollections)}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-2.5">
                          <span className="text-[10px] font-bold uppercase text-slate-400">5. Cobros QR</span>
                          <p className="mt-0.5 text-xs font-extrabold text-slate-900">{formatBs(closure.qrCollections)}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-2.5">
                          <span className="text-[10px] font-bold uppercase text-slate-400">6. Gastos Ruta</span>
                          <p className="mt-0.5 text-xs font-extrabold text-rose-700">{formatBs(closure.cashExpenses)}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-100 p-2.5">
                          <span className="text-[10px] font-extrabold uppercase text-slate-600">7. Efectivo Esperado</span>
                          <p className="mt-0.5 text-xs font-black text-slate-900">{formatBs(closure.expectedCash)}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-100 p-2.5">
                          <span className="text-[10px] font-extrabold uppercase text-slate-600">8. Efectivo Declarado</span>
                          <p className="mt-0.5 text-xs font-black text-slate-900">{formatBs(closure.physicalCashDeclared ?? 0)}</p>
                        </div>
                      </div>
                    </article>
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
                { value: 'sellerKg', label: 'Kg por chofer' },
                { value: 'cortesias', label: 'Cortesías' },
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

            {ventasSubTab === 'sellerKg' && (() => {
              const rows = sellers.filter(seller => seller.salesCount > 0 || seller.kilograms !== 0 || seller.documentedSachetKilograms !== 0 || seller.estimatedSachetKilograms !== 0 || seller.packages !== 0 || seller.unknownWeightPackages !== 0)
              const sheet = sellerKgError ? undefined : reportSheets(data, session.dayKeys, routeFilter, sellerFilter).find(report => report.id === 'sellerSummary')
              return <SectionCard title="Kg vendidos por chofer">
                <p className="mb-3 text-xs text-slate-600">Kilos de granel y peso documentado de sachets. Las estimaciones y paquetes sin peso fiable se informan por separado.</p>
                {sellerKgError && <p role="alert" className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-bold text-amber-900">{sellerKgError}</p>}
                <div className="mb-3 flex flex-wrap gap-2"><SecondaryButton onClick={() => setShowSellerProductDetails(value => !value)}><Search size={15}/>{showSellerProductDetails ? 'Ocultar detalle por producto' : 'Ver detalle por producto'}</SecondaryButton><SecondaryButton disabled={Boolean(sellerKgError)} onClick={() => void printSellerKilograms()}><Printer size={15}/> Imprimir reporte</SecondaryButton><SecondaryButton disabled={Boolean(sellerKgError)} onClick={() => handleOpenExportModal('PDF')}><FileText size={15}/> Descargar PDF</SecondaryButton><SecondaryButton disabled={Boolean(sellerKgError)} onClick={() => handleOpenExportModal('Excel')}><FileSpreadsheet size={15}/> Descargar Excel</SecondaryButton></div>
                {rows.length === 0 ? <EmptyBlock title="Sin ventas en el período" description="No se convirtieron despachos, cobros ni paquetes sin peso en ventas por kilogramo."/> : <div className="grid gap-2">{rows.map(seller => <article key={seller.sellerUid} className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex flex-wrap justify-between gap-2"><strong>{seller.sellerName}</strong><span className="text-xs font-semibold text-slate-600">{seller.routeNames.join(' · ') || 'Sin ruta'}</span></div><dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4"><div><dt>Granel</dt><dd className="font-black">{seller.kilograms.toFixed(3)} kg</dd></div><div><dt>Sachets documentados</dt><dd className="font-black">{seller.documentedSachetKilograms.toFixed(3)} kg</dd></div><div><dt>Total documentado</dt><dd className="font-black text-emerald-800">{seller.totalDocumentedKilograms.toFixed(3)} kg</dd></div><div><dt>Sachets estimados</dt><dd className="font-black">{seller.estimatedSachetKilograms > 0 ? `≈ ${seller.estimatedSachetKilograms.toFixed(3)} kg` : '—'}</dd></div><div><dt>Paquetes sin peso fiable</dt><dd className="font-black">{seller.unknownWeightPackages}</dd></div><div><dt>Paquetes contabilizados</dt><dd className="font-black">{seller.packages}</dd></div></dl></article>)}<p className="text-xs font-black text-slate-800">Total general documentado: {rows.reduce((sum, seller) => sum + seller.totalDocumentedKilograms, 0).toFixed(3)} kg · estimado separado: ≈ {rows.reduce((sum, seller) => sum + seller.estimatedSachetKilograms, 0).toFixed(3)} kg</p></div>}
                {showSellerProductDetails && <div className="mt-3 grid gap-2">{sellerProductKilograms.length === 0 ? <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">Sin detalle por producto en el período.</p> : sellerProductKilograms.map(row => <article key={`${row.sellerUid}-${row.productId}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="flex flex-wrap justify-between gap-1"><strong className="text-xs">{row.productName}</strong><span className="text-[10px] text-slate-600">{row.sellerName} · {row.routeNames.join(' · ') || 'Sin ruta'}</span></div><p className="mt-1 text-[10px] text-slate-700">Granel {row.granelKilograms.toFixed(3)} kg · Sachets documentados {row.documentedSachetKilograms.toFixed(3)} kg · Total documentado {row.totalDocumentedKilograms.toFixed(3)} kg · Estimado ≈ {row.estimatedSachetKilograms.toFixed(3)} kg · Paquetes sin peso: {row.unknownWeightPackages}</p></article>)}</div>}
                {!sellerKgError && sheet && <p className="mt-3 text-[10px] text-slate-500">El PDF y Excel usan la hoja existente “{sheet.name}” y los filtros de fecha, ruta y chofer seleccionados.</p>}
              </SectionCard>
            })()}

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

            {ventasSubTab === 'cortesias' && (
              courtesySales.length === 0 ? <EmptyBlock title="Sin entregas de cortesía en el periodo" /> : <SectionCard title="Entregas gratuitas · no son ventas ni cobros"><div className="grid gap-2">{courtesySales.map(sale=><article key={sale.id} className="rounded-xl border-2 border-fuchsia-200 bg-fuchsia-50 p-3"><div className="flex flex-wrap justify-between gap-2"><strong className="text-sm text-fuchsia-950">{sale.customerName || 'Sin cliente'} · {sale.sellerName}</strong><span className="text-xs font-bold text-fuchsia-800">{new Date(sale.createdAt).toLocaleString('es-BO')}</span></div><p className="mt-1 text-xs text-slate-700">{sale.lines.map(line=>`${formatQty(line.quantity,line.unitType)} · ${line.productNameSnapshot}`).join(' / ')}</p><p className="mt-1 text-xs font-bold text-slate-700">Motivo: {sale.courtesyReason || 'No especificado'} · Valor referencial {formatBs(sale.lines.reduce((sum,line)=>sum+(line.referenceSubtotal||0),0))} · Costo {sale.courtesyCost == null ? 'No disponible' : formatBs(sale.courtesyCost)}</p></article>)}</div></SectionCard>
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
                        <div className="relative">
                          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                          <TextInput
                            value={customerSearchTerm}
                            onChange={(e) => setCustomerSearchTerm(e.target.value)}
                            placeholder="Buscar cliente por nombre o CI..."
                            className="pl-9 h-8 text-xs font-medium"
                          />
                        </div>
                        {filteredCustomerPurchases.length === 0 ? (
                          <p className="p-3 text-center text-xs text-slate-500 font-semibold">
                            No se encontraron compras de clientes que coincidan con la búsqueda.
                          </p>
                        ) : (
                          filteredCustomerPurchases.map((client, index) => {
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
                        }))}
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
          data.isLoading ? (
            <EmptyBlock title="Cargando el historial de créditos" description="Espera un momento para ver la cartera al corte correcto." />
          ) : (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <KpiCard
                label="Cartera pendiente"
                value={formatBs(creditPortfolio.totalOutstanding)}
                tone="warning"
                hint={cutoffDayKey ? `Al corte de: ${cutoffDayKey}` : 'Cartera vigente'}
              />
              <KpiCard
                label="Clientes con saldo"
                value={String(creditPortfolio.totalCustomersWithBalance)}
                tone="neutral"
                hint={`${filteredCustomerCredits.length} cliente(s) en reporte`}
              />
              <KpiCard
                label="Cobrado en el periodo"
                value={formatBs(totalCollectedInPeriod)}
                tone="positive"
                hint={`${periodCollections.length} cobranza(s)`}
              />
            </div>

            {/* Buscador de clientes */}
            <div className="relative">
              <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
              <TextInput
                value={creditSearchTerm}
                onChange={(e) => setCreditSearchTerm(e.target.value)}
                placeholder="Buscar cliente por nombre o CI..."
                className="pl-9 h-8 text-xs font-medium"
              />
            </div>

            {filteredCustomerCredits.length === 0 ? (
              <EmptyBlock
                title="Sin créditos para los filtros seleccionados"
                description="Prueba cambiando la ruta o el vendedor seleccionado."
              />
            ) : (
              <div className="grid gap-2">
                {filteredCustomerCredits.map((customer, index) => {
                  const isExpanded = expandedCreditCustomerId === customer.customerId
                  return (
                    <article
                      key={customer.customerId}
                      className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
                    >
                      <button
                        type="button"
                        onClick={() => setExpandedCreditCustomerId(isExpanded ? null : customer.customerId)}
                        className="flex min-h-[56px] w-full items-center justify-between gap-3 p-3.5 text-left transition hover:bg-slate-50"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-black text-rose-700">#{index + 1}</span>
                            <h4 className="truncate text-xs font-extrabold text-slate-900">{customer.customerName}</h4>
                            {customer.identityNumber && (
                              <span className="text-[10px] text-slate-400">· CI: {customer.identityNumber}</span>
                            )}
                            {customer.customerCode && !customer.identityNumber && (
                              <span className="text-[10px] text-slate-400">· Cód: {customer.customerCode}</span>
                            )}
                          </div>
                          <p className="mt-0.5 text-[11px] font-semibold text-slate-500">
                            {customer.routes.map((r) => `${r.routeName}: ${formatBs(r.balance)}`).join(' · ')}
                            {` · ${customer.filteredReceivables.length} crédito(s)`}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-sm font-black tabular-nums text-slate-900">
                            {formatBs(customer.filteredBalance)}
                          </span>
                          {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="border-t border-slate-100 bg-slate-50/50 p-3">
                          <div className="grid gap-2">
                            {customer.filteredReceivables.map((rec) => {
                              const sale = salesMap.get(rec.saleId || '')
                              const creditInfo = resolveCreditProducts(rec, sale)
                              return (
                                <div
                                  key={rec.id}
                                  className="rounded-2xl border border-slate-200 bg-white p-3 text-xs"
                                >
                                  <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <span className="font-extrabold text-slate-800">
                                          {data.routes.find((route) => route.id === rec.routeId)?.name || (rec.routeId === 'administracion' || rec.routeId === 'admin' ? 'Administración' : rec.routeId === 'route-impulsacion' || rec.routeId === 'route-directa' ? 'Impulsación' : rec.routeId || 'Ruta')}
                                        </span>
                                        <span className="text-[11px] text-slate-400">
                                          · Por: {rec.distributorName || 'Distribuidor'}
                                        </span>
                                      </div>
                                      <p className="mt-0.5 text-[11px] text-slate-500">
                                        Fecha: {new Date(rec.createdAt).toLocaleDateString('es-BO')}
                                        {rec.note && <span className="italic"> · {rec.note}</span>}
                                      </p>
                                    </div>
                                    <span
                                      className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${
                                        rec.status === 'PAID'
                                          ? 'bg-emerald-100 text-emerald-800'
                                          : rec.status === 'PARTIAL'
                                            ? 'bg-amber-100 text-amber-800'
                                            : 'bg-rose-100 text-rose-800'
                                      }`}
                                    >
                                      {rec.status === 'PAID' ? 'PAGADO' : rec.status === 'PARTIAL' ? 'ABONO PARCIAL' : 'PENDIENTE'}
                                    </span>
                                  </div>

                                  {/* Detalle de productos en el crédito */}
                                  <div className="mt-2 rounded-xl bg-slate-50 p-2 text-[11px]">
                                    <span className="font-bold text-slate-700">Productos: </span>
                                    {creditInfo.lines.length > 0 ? (
                                      <span className="text-slate-600">
                                        {creditInfo.lines
                                          .map((l) => `${l.productNameSnapshot} (${formatQty(l.quantity, l.unitType)})`)
                                          .join(', ')}
                                      </span>
                                    ) : (
                                      <span className="text-slate-500 italic">
                                        {rec.sourceType === 'opening_balance'
                                          ? 'Saldo inicial / Deuda anterior'
                                          : 'Crédito anterior sin desglose de ítems'}
                                      </span>
                                    )}
                                  </div>

                                  <div className="mt-2.5 flex items-center justify-between border-t border-slate-100 pt-2 text-xs">
                                    <span className="text-slate-500">
                                      Original: <strong className="text-slate-800">{formatBs(rec.originalAmount)}</strong>
                                      {' · '}
                                      Pagado: <strong className="text-emerald-700">{formatBs(rec.paidAmount)}</strong>
                                    </span>
                                    <span className="font-black text-rose-700 tabular-nums">
                                      Saldo: {formatBs(rec.balance)}
                                    </span>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            )}
          </div>
          )
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
                { value: 'diferencias', label: 'Diferencias por distribuidor' },
                { value: 'mermas', label: 'Mermas' },
              ].map((sub) => (
                <button
                  key={sub.value}
                  type="button"
                  onClick={() => { if (sub.value === 'mermas') session.setDayKeys([toDayKey(new Date())]); setInventarioSubTab(sub.value as InventarioSubTab) }}
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
            {inventarioSubTab === 'diferencias' && (
              <SectionCard title="Diferencias por distribuidor">
                <div className="grid gap-3">
                  <p className="text-xs text-slate-600">Faltantes y sobrantes de recepciones de almacén para el periodo seleccionado. No compensa sobrantes contra faltantes ni genera descuentos de sueldo.</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <div className="rounded-xl border border-rose-100 bg-rose-50 p-3"><p className="text-[10px] font-black uppercase text-rose-800">Faltantes · kg</p><p className="mt-1 text-sm font-black text-rose-900">{formatQty(distributorDifferences.shortages.kg, 'kg')}</p></div>
                    <div className="rounded-xl border border-rose-100 bg-rose-50 p-3"><p className="text-[10px] font-black uppercase text-rose-800">Faltantes · paquetes</p><p className="mt-1 text-sm font-black text-rose-900">{formatQty(distributorDifferences.shortages.packages, 'package')}</p></div>
                    <div className="rounded-xl border border-rose-100 bg-rose-50 p-3"><p className="text-[10px] font-black uppercase text-rose-800">Faltantes · unidades</p><p className="mt-1 text-sm font-black text-rose-900">{formatQty(distributorDifferences.shortages.units, 'unit')}</p></div>
                    <div className="rounded-xl border border-amber-100 bg-amber-50 p-3"><p className="text-[10px] font-black uppercase text-amber-900">Sobrantes · kg</p><p className="mt-1 text-sm font-black text-amber-950">{formatQty(distributorDifferences.overages.kg, 'kg')}</p></div>
                    <div className="rounded-xl border border-amber-100 bg-amber-50 p-3"><p className="text-[10px] font-black uppercase text-amber-900">Sobrantes · paquetes</p><p className="mt-1 text-sm font-black text-amber-950">{formatQty(distributorDifferences.overages.packages, 'package')}</p></div>
                    <div className="rounded-xl border border-amber-100 bg-amber-50 p-3"><p className="text-[10px] font-black uppercase text-amber-900">Sobrantes · unidades</p><p className="mt-1 text-sm font-black text-amber-950">{formatQty(distributorDifferences.overages.units, 'unit')}</p></div>
                  </div>
                  <div className={`rounded-xl border p-3 ${distributorDifferences.missingShortageCostCount ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
                    <p className="text-[10px] font-black uppercase text-slate-600">Valor histórico de faltantes</p>
                    <p className="mt-1 text-sm font-black text-slate-900">{distributorDifferences.missingShortageCostCount ? `INCOMPLETO · subtotal conocido ${formatBs(distributorDifferences.knownShortageValue)}` : formatBs(distributorDifferences.knownShortageValue)}</p>
                    {distributorDifferences.missingShortageCostCount > 0 && <p className="mt-1 text-[11px] font-semibold text-amber-900">Hay {distributorDifferences.missingShortageCostCount} movimiento(s) sin costo histórico disponible; no se estimó su valor.</p>}
                  </div>
                  {distributorDifferences.rows.length === 0 ? <EmptyBlock title="Sin faltantes ni sobrantes en este periodo" description="Prueba otro periodo o distribuidor." /> : <div className="grid gap-2">
                    {distributorDifferences.rows.map((row) => {
                      const reopened = closureReopenEvents(row.closure).length > 0
                      return <button key={`${row.closure.id}-${row.productId}`} type="button" onClick={() => setSelectedDifferenceClosure(row.closure)} className="w-full rounded-2xl border border-slate-200 bg-white p-3 text-left transition hover:border-slate-400 hover:bg-slate-50">
                        <div className="flex items-start justify-between gap-2"><span className="min-w-0"><strong className="block break-words text-xs text-slate-900">{row.distributorName} · {row.productName}</strong><span className="mt-0.5 block text-[10px] text-slate-500">{new Date(row.closure.warehouseClosedAt || row.closure.closedAt || row.closure.createdAt).toLocaleDateString('es-BO')} · {row.routeName} · Cierre {row.closure.id.slice(-6).toUpperCase()}</span></span>{reopened && <span className="shrink-0 rounded-full bg-amber-100 px-2 py-1 text-[9px] font-black text-amber-900">REABIERTO</span>}</div>
                        <span className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-slate-600 sm:grid-cols-4"><span>Debía: <b>{formatQty(row.expected, row.unitType)}</b></span><span>Recibió: <b>{formatQty(row.received, row.unitType)}</b></span><span>Faltante: <b className="text-rose-700">{formatQty(row.shortage, row.unitType)}</b></span><span>Sobrante: <b className="text-amber-800">{formatQty(row.overage, row.unitType)}</b></span></span>
                        <span className="mt-1 block text-[10px] font-bold text-slate-700">Valor histórico del faltante: {row.shortageValueKnown ? formatBs(row.shortageValue || 0) : 'Incompleto · costo no disponible'}</span>
                        {reopened && closureReopenEvents(row.closure).at(-1)?.reason && <span className="mt-1 block break-words text-[10px] text-amber-900">Motivo de reapertura: {closureReopenEvents(row.closure).at(-1)?.reason}</span>}
                      </button>
                    })}
                  </div>}
                  <p className="text-[10px] font-medium text-slate-500">La exportación PDF y Excel usa los filtros actuales de periodo, ruta y distribuidor.</p>
                </div>
              </SectionCard>
            )}
            {inventarioSubTab === 'mermas' && <MermaReportView session={session} data={data} />}
          </div>
        )}
      </div>

      <ChoiceModal
        isOpen={isSellerOpen}
        onClose={() => setIsSellerOpen(false)}
        title="Filtrar por distribuidor o vendedor"
        searchable
              options={[{ value: '', label: 'Todos los vendedores' }, ...sellerOptions.map((s) => ({ value: s.sellerUid, label: s.sellerName }))]}
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
        isOpen={Boolean(selectedDifferenceClosure)}
        onClose={() => setSelectedDifferenceClosure(null)}
        title="Detalle del cierre y sus diferencias"
        subtitle={selectedDifferenceClosure ? `${selectedDifferenceClosure.routeName} · ${selectedDifferenceClosure.distributorName} · Jornada ${selectedDifferenceClosure.dayKey || 'sin fecha'}` : ''}
      >
        {selectedDifferenceClosure && <div className="grid gap-3">
          {closureReopenEvents(selectedDifferenceClosure).length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950"><strong>REABIERTO</strong>{closureReopenEvents(selectedDifferenceClosure).map((event, index) => <p key={`${event.reopenedAt || 'reopen'}-${index}`} className="mt-1 break-words">{event.reopenedAt ? `${new Date(event.reopenedAt).toLocaleString('es-BO')} · ` : ''}{event.reopenedByName || event.reopenedBy || ''}{event.reason ? ` · Motivo: ${event.reason}` : ''}</p>)}</div>}
          <div className="grid gap-2">{selectedDifferenceClosure.products.map((row) => <article key={row.productId} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs"><strong>{row.productName}</strong><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3"><span>Debía retornar: <b>{formatQty(row.expectedReturn, row.unitType)}</b></span><span>Recibió: <b>{formatQty(row.physicalReturn ?? row.actualReturn + (row.returnMerma || 0) + (row.returnWaste || 0), row.unitType)}</b></span><span>Faltante: <b className="text-rose-700">{formatQty(row.shortage ?? 0, row.unitType)}</b></span><span>Sobrante: <b className="text-amber-800">{formatQty(row.overage || 0, row.unitType)}</b></span><span>Retorno normal: <b>{formatQty(row.actualReturn, row.unitType)}</b></span><span>Merma recuperable: <b>{formatQty(row.returnMerma || 0, row.unitType)}</b></span></div></article>)}</div>
          {selectedDifferenceClosure.closedAt && <p className="text-[11px] text-slate-500">Cierre actual: {new Date(selectedDifferenceClosure.closedAt).toLocaleString('es-BO')}</p>}
        </div>}
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
                          {detail.costAccountingStatus === 'pending_quarantine_disposition' && (
                            <p className="mt-1 text-[10px] font-semibold text-amber-800">
                              Costo histórico en cuarentena pendiente de disposición: {detail.pendingQuarantineCostBs === null || detail.pendingQuarantineCostBs === undefined ? 'no disponible' : formatBs(detail.pendingQuarantineCostBs)}. No se revirtió ni se duplicó en Resultado.
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
