import { useMemo, useState } from 'react'
import { Screen } from '../../../components/ui/Screen'
import { Field, Segmented, SelectInput, TextInput } from '../../../components/ui/Form'
import {
  buildReconciliation,
  computeMoneySummary,
  computeSoldByProduct,
  computeSoldKilograms,
  computeSoldPackages,
  round2,
  toDayKey,
} from '../domain/engine'
import { buildDayRange } from '../state/useDistributionStore'
import { KpiCard, SectionCard, VarianceBadge, formatBs, formatQty } from './shared'
import type { DistributionViewProps } from './DistributionApp'

type RangePreset = 'today' | 'week' | 'month' | 'custom'

/**
 * Panel de administracion: primero resultados, no una copia del Excel.
 * Solo consulta el rango pedido; nunca toda la historia.
 */
export function DashboardView({ session, data }: DistributionViewProps) {
  const [preset, setPreset] = useState<RangePreset>('today')
  const [customFrom, setCustomFrom] = useState(toDayKey(new Date()))
  const [customTo, setCustomTo] = useState(toDayKey(new Date()))
  const [routeFilter, setRouteFilter] = useState('')

  const applyPreset = (next: RangePreset) => {
    setPreset(next)
    const today = new Date()
    if (next === 'today') {
      session.setDayKeys([toDayKey(today)])
      return
    }
    if (next === 'week') {
      const from = new Date(today)
      from.setDate(from.getDate() - 6)
      session.setDayKeys(buildDayRange(from, today))
      return
    }
    if (next === 'month') {
      const from = new Date(today)
      from.setDate(from.getDate() - 29)
      session.setDayKeys(buildDayRange(from, today))
    }
  }

  const applyCustomRange = (from: string, to: string) => {
    const fromDate = new Date(`${from}T00:00:00`)
    const toDate = new Date(`${to}T00:00:00`)
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return
    session.setDayKeys(buildDayRange(fromDate, toDate))
  }

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
      data.closures.reduce(
        (count, closure) => count + closure.products.filter((row) => Math.abs(row.variance) > 0.001).length,
        0,
      ),
    [data.closures],
  )

  const openRoutes = data.openDispatches.length
  const closedRoutes = data.closures.filter((closure) => closure.status === 'closed').length

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

    for (const dispatch of data.openDispatches) {
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

    for (const closure of data.closures) {
      const entry = map.get(closure.routeId)
      if (entry && closure.status === 'closed') {
        entry.isOpen = false
        entry.cashDifference = closure.cashDifference
      }
      // Un cierre a medias no reporta diferencia de caja todavia.
    }

    return [...map.values()].sort((a, b) => b.salesTotal - a.salesTotal)
  }, [data.openDispatches, data.closures, sales, collections])

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

    for (const closure of data.closures) {
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
    for (const dispatch of data.openDispatches) {
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
  }, [data.closures, data.openDispatches, sales, routeFilter])

  return (
    <Screen title="Panel" subtitle={`${session.dayKeys.length} dia(s) consultados`}>
      <div className="grid w-full min-w-0 gap-3">
        <div className="grid gap-2">
          <Segmented
            value={preset}
            onChange={applyPreset}
            options={[
              { value: 'today', label: 'Hoy' },
              { value: 'week', label: 'Semana' },
              { value: 'month', label: 'Mes' },
              { value: 'custom', label: 'Rango' },
            ]}
          />

          {preset === 'custom' && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Desde">
                <TextInput
                  type="date"
                  value={customFrom}
                  onChange={(event) => {
                    setCustomFrom(event.target.value)
                    applyCustomRange(event.target.value, customTo)
                  }}
                />
              </Field>
              <Field label="Hasta">
                <TextInput
                  type="date"
                  value={customTo}
                  onChange={(event) => {
                    setCustomTo(event.target.value)
                    applyCustomRange(customFrom, event.target.value)
                  }}
                />
              </Field>
            </div>
          )}

          <Field label="Ruta">
            <SelectInput value={routeFilter} onChange={(event) => setRouteFilter(event.target.value)}>
              <option value="">Todas las rutas</option>
              {data.routes.map((route) => (
                <option key={route.id} value={route.id}>
                  {route.name}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <KpiCard label="Ventas" value={formatBs(money.salesTotal)} tone="primary" />
          <KpiCard label="Venta efectivo" value={formatBs(money.cashSales)} />
          <KpiCard label="Venta QR" value={formatBs(money.qrSales)} />
          <KpiCard label="Credito generado" value={formatBs(money.creditGenerated)} tone="warning" />
          <KpiCard label="Kg vendidos" value={`${soldKg} kg`} />
          <KpiCard label="Paquetes / unidades" value={String(soldPackages)} />
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
                      <p className="truncate text-sm font-extrabold text-slate-900">{entry.distributorName}</p>
                      <p className="truncate text-[11px] font-semibold text-slate-500">{entry.routeName}</p>
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
                    <p className="min-w-0 truncate text-xs font-extrabold text-slate-900">{row.name}</p>
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
