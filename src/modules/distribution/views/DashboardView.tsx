import { StockAlerts } from './LotsAndHistory'
import { useMemo, useState } from 'react'
import { Screen } from '../../../components/ui/Screen'
import {
  buildReconciliation,
  computeMoneySummary,
  computeSoldByProduct,
  computeSoldKilograms,
  computeSoldPackages,
  round2,
} from '../domain/engine'
import { KpiCard, SectionCard, VarianceBadge, formatBs, formatQty } from './shared'
import { RangePicker, describeRange } from './RangePicker'
import type { DistributionViewProps } from './DistributionApp'


/**
 * Panel de administracion: primero resultados, no una copia del Excel.
 * Solo consulta el rango pedido; nunca toda la historia.
 */
export function DashboardView({ session, data }: DistributionViewProps) {
  const [routeFilter, setRouteFilter] = useState('')
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
      visibleClosures.reduce(
        (count, closure) => count + closure.products.filter((row) => Math.abs(row.variance) > 0.001).length,
        0,
      ),
    [visibleClosures],
  )

  const openRoutes = visibleOpenDispatches.length
  const closedRoutes = visibleClosures.filter((closure) => closure.status === 'closed').length

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

    for (const closure of visibleClosures) {
      const entry = map.get(closure.routeId)
      if (entry && closure.status === 'closed') {
        entry.isOpen = false
        entry.cashDifference = closure.cashDifference
      }
      // Un cierre a medias no reporta diferencia de caja todavia.
    }

    return [...map.values()].sort((a, b) => b.salesTotal - a.salesTotal)
  }, [visibleOpenDispatches, visibleClosures, sales, collections])

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

    for (const closure of visibleClosures) {
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
  }, [visibleClosures, visibleOpenDispatches, sales, routeFilter])

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
          <KpiCard label="Diferencias de producto" value={String(pendingVariances)} tone={pendingVariances > 0 ? 'danger' : 'positive'} />
          <KpiCard label="Rutas abiertas" value={String(openRoutes)} />
          <KpiCard label="Rutas cerradas" value={String(closedRoutes)} />
        </div>

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
