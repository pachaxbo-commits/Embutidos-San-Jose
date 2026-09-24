import { StockAlerts } from './LotsAndHistory'
import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Screen } from '../../../components/ui/Screen'
import {
  buildReconciliation,
  computeMoneySummary,
  computeSoldByProduct,
  computeSoldKilograms,
  computeSoldPackages,
  round2,
} from '../domain/engine'
import { closuresInPeriod, pendingDifferenceClosures as findPendingDifferenceClosures } from '../domain/closurePeriod'
import { setClosureVarianceReviewed } from '../data/distributionRepository'
import { KpiCard, SectionCard, VarianceBadge, formatBs, formatQty } from './shared'
import { RangePicker, describeRange } from './RangePicker'
import type { DistributionViewProps } from './DistributionApp'
import type { ModuleDefinition, ModuleId } from '../../../config/appConfig'


/**
 * Panel de administracion: primero resultados, no una copia del Excel.
 * Solo consulta el rango pedido; nunca toda la historia.
 */
const MODULE_SEARCH_TERMS: Partial<Record<ModuleId, string>> = {
  'dist.inventory': 'inventario stock existencias lotes vencimientos almacén almacen',
  'dist.warehouses': 'almacenes depósitos depositos',
  'dist.dispatches': 'despachos entregas rutas vendedores',
  'dist.sales': 'vender ventas cobro ticket',
  'dist.credits': 'créditos creditos deuda cartera fiado',
  'dist.collections': 'cobros abonos pagos',
  'dist.customers': 'clientes compradores',
  'dist.expenses': 'gastos egresos',
  'dist.closure': 'cierre caja ruta devolución devolucion',
  'dist.products': 'productos catálogo catalogo precios costos',
  'dist.reports': 'reportes informes excel pdf rentabilidad ganancias',
  'dist.users': 'usuarios personal permisos',
  'dist.claims': 'cambios devoluciones reclamos',
  'dist.qr': 'qr verificar pagos',
  'printer-settings': 'impresora ticket bluetooth impresión impresion',
}

export function DashboardView({ session, data, modules = [], onNavigate }: DistributionViewProps & { modules?: ModuleDefinition[]; onNavigate?: (id: ModuleId) => void }) {
  const [routeFilter, setRouteFilter] = useState('')
  const [moduleSearch, setModuleSearch] = useState('')
  const [reviewingClosureId, setReviewingClosureId] = useState('')
  const [reviewError, setReviewError] = useState<string | null>(null)
  const isWarehouse = session.role === 'warehouse'
  const assignedWarehouse = session.warehouseId || 'central'
  const visibleOpenDispatches = useMemo(
    () => isWarehouse
      ? data.openDispatches.filter(dispatch => (dispatch.warehouseId || 'central') === assignedWarehouse)
      : data.openDispatches,
    [data.openDispatches, isWarehouse, assignedWarehouse],
  )
  const visibleClosures = useMemo(
    () => isWarehouse
      ? data.closures.filter(closure => (closure.warehouseId || 'central') === assignedWarehouse)
      : data.closures,
    [data.closures, isWarehouse, assignedWarehouse],
  )
  const periodClosures = useMemo(
    () => closuresInPeriod(visibleClosures, session.dayKeys),
    [visibleClosures, session.dayKeys],
  )
  const pendingDifferenceClosures = useMemo(
    () => findPendingDifferenceClosures(visibleClosures, routeFilter),
    [visibleClosures, routeFilter],
  )

  const sales = useMemo(
    () => (routeFilter ? data.sales.filter((sale) => sale.routeId === routeFilter) : data.sales),
    [data.sales, routeFilter],
  )
  const collections = useMemo(
    () => (routeFilter ? data.collections.filter((item) => item.routeId === routeFilter) : data.collections),
    [data.collections, routeFilter],
  )
  const expenses = useMemo(
    () => (routeFilter ? data.expenses.filter((item) => item.routeId === routeFilter) : data.expenses),
    [data.expenses, routeFilter],
  )

  const money = useMemo(() => computeMoneySummary(sales, collections, expenses), [sales, collections, expenses])
  const soldKg = useMemo(() => computeSoldKilograms(sales), [sales])
  const soldPackages = useMemo(() => computeSoldPackages(sales), [sales])

  const outstandingPortfolio = useMemo(
    () => round2(data.receivables.reduce((sum, receivable) => sum + (Number(receivable.balance) || 0), 0)),
    [data.receivables],
  )

  const pendingVariances = useMemo(
    () =>
      periodClosures.reduce(
        (count, closure) => count + closure.products.filter((row) => Math.abs(row.variance) > 0.001).length,
        0,
      ),
    [periodClosures],
  )

  const openRoutes = visibleOpenDispatches.length
  const closedRoutes = periodClosures.filter((closure) => closure.status === 'closed').length
  const moduleMatches = useMemo(() => {
    const term = moduleSearch.trim().toLocaleLowerCase('es')
    if (!term) return []
    return modules.filter(module => `${module.label} ${MODULE_SEARCH_TERMS[module.id] || ''}`.toLocaleLowerCase('es').includes(term)).slice(0, 6)
  }, [moduleSearch, modules])

  /** Una fila por distribuidor con lo que la duena revisa cada dia */
  const byDistributor = useMemo(() => {
    const map = new Map<
      string,
      {
        routeId: string
        routeName: string
        distributorName: string
        salesTotal: number
        kilograms: number
        credit: number
        collected: number
        isOpen: boolean
        cashDifference: number | null
      }
    >()

    for (const dispatch of visibleOpenDispatches) {
      map.set(dispatch.routeId, {
        routeId: dispatch.routeId,
        routeName: dispatch.routeName,
        distributorName: dispatch.distributorName,
        salesTotal: 0,
        kilograms: 0,
        credit: 0,
        collected: 0,
        isOpen: true,
        cashDifference: null,
      })
    }

    for (const sale of sales) {
      const entry = map.get(sale.routeId) ?? {
        routeId: sale.routeId,
        routeName: sale.routeName,
        distributorName: sale.sellerName,
        salesTotal: 0,
        kilograms: 0,
        credit: 0,
        collected: 0,
        isOpen: false,
        cashDifference: null,
      }
      entry.salesTotal = round2(entry.salesTotal + sale.total)
      entry.credit = round2(entry.credit + sale.creditAmount)
      entry.kilograms = round2(entry.kilograms + computeSoldKilograms([sale]))
      map.set(sale.routeId, entry)
    }

    for (const collection of collections) {
      const entry = map.get(collection.routeId)
      if (entry) entry.collected = round2(entry.collected + collection.amount)
    }

    for (const closure of periodClosures) {
      const entry = map.get(closure.routeId)
      if (entry && closure.status === 'closed') {
        entry.isOpen = false
        entry.cashDifference = closure.cashDifference
      }
      // Un cierre a medias no reporta diferencia de caja todavia.
    }

    return [...map.values()].sort((a, b) => b.salesTotal - a.salesTotal)
  }, [visibleOpenDispatches, periodClosures, sales, collections])

  /**
   * Conciliacion consolidada del periodo.
   *
   * La fuente es el cierre de cada ruta (que ya congela cargado, vendido y
   * retornado) y, para las rutas todavia abiertas, el despacho vivo. Antes se
   * miraban solo los despachos abiertos: al cerrar la ruta el panel mostraba
   * despachado 0 y devuelto 0.
   */
  const productRows = useMemo(() => {
    type Row = {
      name: string
      unitType: 'kg' | 'unit' | 'package'
      dispatched: number
      sold: number
      returned: number
      variance: number
      reconciled: boolean
    }
    const merged = new Map<string, Row>()

    const upsert = (productId: string, patch: Partial<Row> & { name: string; unitType: Row['unitType'] }) => {
      const current = merged.get(productId) ?? {
        name: patch.name,
        unitType: patch.unitType,
        dispatched: 0,
        sold: 0,
        returned: 0,
        variance: 0,
        reconciled: false,
      }
      merged.set(productId, {
        ...current,
        name: patch.name || current.name,
        unitType: patch.unitType || current.unitType,
        dispatched: round2(current.dispatched + (patch.dispatched ?? 0)),
        sold: round2(current.sold + (patch.sold ?? 0)),
        returned: round2(current.returned + (patch.returned ?? 0)),
        variance: round2(current.variance + (patch.variance ?? 0)),
        reconciled: current.reconciled || Boolean(patch.reconciled),
      })
    }

    const closedDispatchIds = new Set<string>()

    for (const closure of periodClosures) {
      if (routeFilter && closure.routeId !== routeFilter) continue
      closedDispatchIds.add(closure.dispatchId)
      const isReconciled = closure.status !== 'draft'
      for (const row of closure.products) {
        upsert(row.productId, {
          name: row.productName,
          unitType: row.unitType,
          dispatched: row.totalLoaded,
          sold: row.sold,
          returned: row.actualReturn,
          variance: row.variance,
          reconciled: isReconciled,
        })
      }
    }

    // Rutas todavia en curso: se concilian contra sus ventas del periodo.
    for (const dispatch of visibleOpenDispatches) {
      if (closedDispatchIds.has(dispatch.id)) continue
      if (routeFilter && dispatch.routeId !== routeFilter) continue
      const rows = buildReconciliation(
        dispatch,
        sales.filter(
          (sale) =>
            sale.sourceLocation !== 'centralWarehouse' &&
            (sale.dispatchId === dispatch.id || sale.routeId === dispatch.routeId),
        ),
        {},
      )
      for (const row of rows) {
        upsert(row.productId, {
          name: row.productName,
          unitType: row.unitType,
          dispatched: row.totalLoaded,
          sold: row.sold,
          returned: 0,
          variance: 0,
          reconciled: false,
        })
      }
    }

    // Ventas directas desde almacen central: solo suman vendido.
    const directSold = computeSoldByProduct(sales.filter((sale) => sale.sourceLocation === 'centralWarehouse'))
    for (const [productId, totals] of directSold) {
      upsert(productId, { name: totals.productName, unitType: totals.unitType, sold: totals.quantity })
    }

    return [...merged.entries()].map(([productId, totals]) => ({ productId, ...totals }))
  }, [periodClosures, visibleOpenDispatches, sales, routeFilter])

  const markDifferenceReviewed = async (closureId: string) => {
    if (reviewingClosureId) return
    setReviewError(null)
    setReviewingClosureId(closureId)
    try {
      await setClosureVarianceReviewed(closureId, true)
    } catch (error) {
      setReviewError((error as Error).message || 'No se pudo marcar la diferencia como revisada.')
    } finally {
      setReviewingClosureId('')
    }
  }

  // Se muestra la fecha real consultada: si el dispositivo tiene mal la fecha o
  // la zona horaria, el "hoy" del telefono no coincide con el de las ventas y
  // el panel apareceria vacio sin explicacion.
  if (isWarehouse) {
    return (
      <Screen title="Inicio de almacén" subtitle="Control físico de productos y devoluciones">
        <StockAlerts data={data} />
        <div className="grid w-full min-w-0 gap-3">
          <RangePicker
            dayKeys={session.dayKeys}
            onChange={session.setDayKeys}
            routes={data.routes}
            routeFilter={routeFilter}
            onRouteFilterChange={setRouteFilter}
          />
          <SectionCard title="Productos y conciliación">
            {productRows.length === 0 ? (
              <p className="text-xs font-semibold text-slate-500">Sin movimientos de productos en el periodo.</p>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {productRows.map(row => (
                  <div key={row.productId} className="min-w-0 rounded-2xl border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 break-words text-xs font-extrabold text-slate-900">{row.name}</p>
                      {row.reconciled ? <VarianceBadge variance={row.variance} unitType={row.unitType} /> : <span className="shrink-0 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-black text-sky-700">EN RUTA</span>}
                    </div>
                    <dl className="mt-2 grid grid-cols-3 gap-2">
                      <div><dt className="text-[9px] font-bold uppercase text-slate-400">Entregado</dt><dd className="text-xs font-black text-slate-800">{formatQty(row.dispatched, row.unitType)}</dd></div>
                      <div><dt className="text-[9px] font-bold uppercase text-slate-400">Vendido</dt><dd className="text-xs font-black text-slate-800">{formatQty(row.sold, row.unitType)}</dd></div>
                      <div><dt className="text-[9px] font-bold uppercase text-slate-400">Devuelto</dt><dd className="text-xs font-black text-slate-800">{formatQty(row.returned, row.unitType)}</dd></div>
                    </dl>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </Screen>
    )
  }

  return (
    <Screen title="Panel" subtitle={describeRange(session.dayKeys)}>
      {session.role === 'admin' && <div className="relative w-full rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <label htmlFor="module-search" className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">Buscar una sección</label>
        <div className="relative mt-1.5"><Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--primary)]" /><input id="module-search" value={moduleSearch} onChange={event => setModuleSearch(event.target.value)} placeholder="Ej.: créditos, almacén, reportes…" className="min-h-[44px] w-full rounded-2xl border-2 border-slate-300 bg-slate-50 pl-10 pr-3 text-sm font-semibold outline-none focus:border-[var(--primary)]" /></div>
        {moduleSearch.trim() && <div className="mt-2 grid gap-1.5 sm:grid-cols-2">{moduleMatches.length ? moduleMatches.map(module => <button key={module.id} type="button" onClick={() => { onNavigate?.(module.id); setModuleSearch('') }} className="min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-left text-xs font-extrabold text-slate-800 hover:border-[var(--primary)] hover:bg-[var(--primary-soft)]">Ir a {module.label}</button>) : <p className="px-1 py-2 text-xs font-semibold text-slate-500">No se encontró una sección con ese nombre.</p>}</div>}
      </div>}
      <StockAlerts data={data} />
      <div className="grid w-full min-w-0 gap-3">
        <RangePicker
          dayKeys={session.dayKeys}
          onChange={session.setDayKeys}
          routes={data.routes}
          routeFilter={routeFilter}
          onRouteFilterChange={setRouteFilter}
        />

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <KpiCard label="Ventas" value={formatBs(money.salesTotal)} tone="primary" />
          <KpiCard label="Venta efectivo" value={formatBs(money.cashSales)} />
          <KpiCard label="Venta QR" value={formatBs(money.qrSales)} />
          <KpiCard label="Credito generado" value={formatBs(money.creditGenerated)} tone="warning" />
          <KpiCard label="Granel vendido" value={`${soldKg} kg`} hint="Solo productos por peso" />
          <KpiCard label="Paquetes / unidades" value={String(soldPackages)} hint="Al vacio y sachets" />
          <KpiCard label="Cobrado" value={formatBs(money.collectionsTotal)} tone="positive" />
          <KpiCard label="Cartera pendiente" value={formatBs(outstandingPortfolio)} tone="warning" />
          <KpiCard label="Gastos" value={formatBs(money.cashExpenses)} tone="danger" />
          <KpiCard label="Diferencias del periodo" value={String(pendingVariances)} tone={pendingVariances > 0 ? 'danger' : 'positive'} />
          <KpiCard label="Rutas abiertas" value={String(openRoutes)} />
          <KpiCard label="Rutas cerradas" value={String(closedRoutes)} />
        </div>

        <SectionCard title={`Diferencias pendientes anteriores (${pendingDifferenceClosures.length})`}>
          {reviewError && <p role="alert" className="mb-3 rounded-xl bg-rose-50 p-3 text-xs font-semibold text-rose-700">{reviewError}</p>}
          {pendingDifferenceClosures.length === 0 ? (
            <p className="text-xs font-semibold text-slate-500">No hay diferencias históricas pendientes de revisión.</p>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {pendingDifferenceClosures.map(closure => {
                const differences = closure.products.filter(row => Math.abs(Number(row.variance) || 0) > 0.001)
                const date = closure.warehouseClosedAt || closure.closedAt || closure.createdAt
                return (
                  <article key={closure.id} className="min-w-0 rounded-2xl border border-amber-200 bg-amber-50/40 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-extrabold text-slate-900">{closure.routeName || 'Ruta registrada'} · {closure.distributorName || 'Distribuidor'}</p>
                        <p className="mt-0.5 text-[11px] font-semibold text-slate-500">Conciliado: {new Date(date).toLocaleString('es-BO')}</p>
                      </div>
                      <button
                        type="button"
                        disabled={Boolean(reviewingClosureId)}
                        onClick={() => void markDifferenceReviewed(closure.id)}
                        className="min-h-9 shrink-0 rounded-xl border border-emerald-200 bg-white px-3 text-xs font-extrabold text-emerald-700 disabled:opacity-50"
                      >
                        {reviewingClosureId === closure.id ? 'Guardando…' : 'Marcar revisada'}
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {differences.map(row => (
                        <span key={row.productId} className="inline-flex max-w-full items-center gap-1 rounded-xl bg-white px-2 py-1 text-[10px] font-bold text-slate-700">
                          <span className="min-w-0 break-words">{row.productName}</span>
                          <VarianceBadge variance={row.variance} unitType={row.unitType} />
                        </span>
                      ))}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Distribuidores">
          {byDistributor.length === 0 ? (
            <p className="text-xs font-semibold text-slate-500">Sin movimiento en el periodo.</p>
          ) : (
            <div className="grid gap-2">
              {byDistributor.map((entry) => (
                <div key={entry.routeId} className="w-full min-w-0 rounded-2xl border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-extrabold text-slate-900">{entry.distributorName}</p>
                      <p className="break-words text-[11px] font-semibold leading-snug text-slate-500">{entry.routeName}</p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${
                        entry.isOpen ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {entry.isOpen ? 'EN RUTA' : 'CERRADA'}
                    </span>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4">
                    <div>
                      <dt className="text-[10px] font-bold uppercase text-slate-400">Venta</dt>
                      <dd className="text-xs font-black tabular-nums text-slate-800">{formatBs(entry.salesTotal)}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-bold uppercase text-slate-400">Kg</dt>
                      <dd className="text-xs font-black tabular-nums text-slate-800">{entry.kilograms} kg</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-bold uppercase text-slate-400">Credito</dt>
                      <dd className="text-xs font-black tabular-nums text-slate-800">{formatBs(entry.credit)}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-bold uppercase text-slate-400">Cobrado</dt>
                      <dd className="text-xs font-black tabular-nums text-slate-800">{formatBs(entry.collected)}</dd>
                    </div>
                  </dl>
                  {entry.cashDifference !== null && (
                    <div className="mt-2">
                      <VarianceBadge variance={entry.cashDifference} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Productos y conciliacion">
          {productRows.length === 0 ? (
            <p className="text-xs font-semibold text-slate-500">Sin movimiento de productos en el periodo.</p>
          ) : (
            <div className="grid gap-2">
              {productRows.map((row) => (
                <div key={row.productId} className="w-full min-w-0 rounded-2xl border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 break-words text-xs font-extrabold text-slate-900">{row.name}</p>
                    {row.reconciled ? (
                      <VarianceBadge variance={row.variance} unitType={row.unitType} />
                    ) : (
                      <span className="shrink-0 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-black text-sky-700">
                        EN RUTA
                      </span>
                    )}
                  </div>
                  <dl className="mt-2 grid grid-cols-3 gap-x-3">
                    <div>
                      <dt className="text-[10px] font-bold uppercase text-slate-400">Despachado</dt>
                      <dd className="text-xs font-black tabular-nums text-slate-800">
                        {formatQty(row.dispatched, row.unitType)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-bold uppercase text-slate-400">Vendido</dt>
                      <dd className="text-xs font-black tabular-nums text-slate-800">{formatQty(row.sold, row.unitType)}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-bold uppercase text-slate-400">Devuelto</dt>
                      <dd className="text-xs font-black tabular-nums text-slate-800">
                        {formatQty(row.returned, row.unitType)}
                      </dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </Screen>
  )
}
