import { useEffect, useMemo, useState } from 'react'
import { ClipboardCheck, Lock, PackageCheck, Unlock } from 'lucide-react'
import { Field, NumberInput, SelectInput } from '../../../components/ui/Form'
import { EmptyBlock, Screen } from '../../../components/ui/Screen'
import { buildReconciliation, computeMoneySummary, round2, toDayKey } from '../domain/engine'
import { reopenClosure, saveClosure } from '../data/distributionRepository'
import { KpiCard, PrimaryButton, SecondaryButton, SectionCard, VarianceBadge, formatBs, formatQty } from './shared'
import type { DistributionViewProps } from './DistributionApp'
import type { DistClosure } from '../types'

/**
 * Arqueo de ruta: conciliacion fisica por producto y cuadre de dinero.
 *
 * El efectivo esperado solo considera efectivo:
 *   expectedCash = ventas efectivo + cobros efectivo - gastos efectivo
 * QR y credito no entran al efectivo fisico.
 */
export function ClosureView({ session, data }: DistributionViewProps) {
  const canRegisterReturn = session.can('dist.return.register')
  const canCloseMoney = session.can('dist.closure.money')

  const [selectedDispatchId, setSelectedDispatchId] = useState('')
  const [returns, setReturns] = useState<Record<string, string>>({})
  const [declaredCash, setDeclaredCash] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const dispatch = useMemo(() => {
    if (data.openDispatches.length === 0) return null
    return data.openDispatches.find((item) => item.id === selectedDispatchId) ?? data.openDispatches[0]
  }, [data.openDispatches, selectedDispatchId])

  const existingClosure = useMemo(
    () => data.closures.find((closure) => closure.dispatchId === dispatch?.id) ?? null,
    [data.closures, dispatch?.id],
  )

  const returnsAlreadyApplied = existingClosure
    ? existingClosure.status === 'warehouse_done' || existingClosure.status === 'closed' || existingClosure.status === 'reopened'
    : false

  useEffect(() => {
    if (!existingClosure) return
    setReturns((current) => {
      if (Object.keys(current).length > 0) return current
      const next: Record<string, string> = {}
      for (const row of existingClosure.products) next[row.productId] = String(row.actualReturn)
      return next
    })
    if (existingClosure.physicalCashDeclared > 0) setDeclaredCash(String(existingClosure.physicalCashDeclared))
  }, [existingClosure])

  // Solo las ventas hechas desde la ruta entran al arqueo: una venta directa
  // de almacen sale del stock central y no la responde el distribuidor.
  const routeSales = useMemo(
    () =>
      data.sales.filter(
        (sale) =>
          dispatch !== null &&
          sale.sourceLocation !== 'centralWarehouse' &&
          (sale.dispatchId === dispatch.id || sale.routeId === dispatch.routeId),
      ),
    [data.sales, dispatch],
  )
  const routeCollections = useMemo(
    () => data.collections.filter((collection) => (dispatch ? collection.routeId === dispatch.routeId : false)),
    [data.collections, dispatch],
  )
  const routeExpenses = useMemo(
    () => data.expenses.filter((expense) => (dispatch ? expense.routeId === dispatch.routeId : false)),
    [data.expenses, dispatch],
  )

  /** Un producto solo se evalua cuando almacen escribio la cantidad retornada */
  const isDeclared = (productId: string) => {
    const value = returns[productId]
    return value !== undefined && value !== '' && !Number.isNaN(Number(value))
  }

  const parsedReturns = useMemo(() => {
    const map: Record<string, number> = {}
    for (const [productId, value] of Object.entries(returns)) map[productId] = round2(Number(value) || 0)
    return map
  }, [returns])

  const productRows = useMemo(
    () => buildReconciliation(dispatch, routeSales, parsedReturns),
    [dispatch, routeSales, parsedReturns],
  )

  const money = useMemo(
    () => computeMoneySummary(routeSales, routeCollections, routeExpenses),
    [routeSales, routeCollections, routeExpenses],
  )

  const declaredValue = round2(Number(declaredCash) || 0)
  // Mientras no se declare el efectivo fisico no hay diferencia que reportar:
  // guardar -368 en un cierre a medias confundia a quien revisaba el arqueo.
  const isCashDeclared = declaredCash !== ''
  const cashDifference = isCashDeclared ? round2(declaredValue - money.expectedCash) : 0

  const buildClosureDoc = (status: DistClosure['status']): DistClosure | null => {
    if (!dispatch) return null
    const now = new Date().toISOString()
    return {
      id: `closure_${dispatch.id}`,
      restaurantId: session.restaurantId,
      branchId: 'main',
      createdAt: existingClosure?.createdAt ?? now,
      createdBy: existingClosure?.createdBy ?? session.uid,
      dayKey: existingClosure?.dayKey ?? toDayKey(now),
      schemaVersion: 1,
      dispatchId: dispatch.id,
      routeId: dispatch.routeId,
      routeName: dispatch.routeName,
      distributorUid: dispatch.distributorUid,
      distributorName: dispatch.distributorName,
      status,
      products: productRows,
      cashSales: money.cashSales,
      qrSales: money.qrSales,
      creditGenerated: money.creditGenerated,
      cashCollections: money.cashCollections,
      qrCollections: money.qrCollections,
      cashExpenses: money.cashExpenses,
      expectedCash: money.expectedCash,
      physicalCashDeclared: declaredValue,
      cashDifference,
      // Firestore rechaza undefined: los campos aun no ocurridos van vacios.
      warehouseClosedBy: status === 'warehouse_done' ? session.uid : (existingClosure?.warehouseClosedBy ?? ''),
      warehouseClosedAt: status === 'warehouse_done' ? now : (existingClosure?.warehouseClosedAt ?? ''),
      closedBy: status === 'closed' ? session.uid : (existingClosure?.closedBy ?? ''),
      closedAt: status === 'closed' ? now : (existingClosure?.closedAt ?? ''),
      note: existingClosure?.note ?? '',
    }
  }

  const submit = async (status: DistClosure['status']) => {
    if (!dispatch || isSubmitting) return
    setError(null)

    const closure = buildClosureDoc(status)
    if (!closure) return

    if (status === 'warehouse_done') {
      const sinDeclarar = productRows.filter((row) => !isDeclared(row.productId))
      if (sinDeclarar.length > 0) {
        setError(`Falta declarar el retorno de: ${sinDeclarar.map((row) => row.productName).join(', ')}.`)
        return
      }
    }

    if (status === 'closed' && !declaredCash) {
      setError('Ingresa el efectivo fisico declarado antes de cerrar la ruta.')
      return
    }

    setIsSubmitting(true)
    try {
      await saveClosure({ closure, applyStockReturn: !returnsAlreadyApplied })
    } catch (submitError) {
      setError((submitError as Error).message || 'No se pudo guardar el cierre.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!dispatch) {
    return (
      <Screen title="Cierre de ruta">
        <EmptyBlock
          title="No hay rutas abiertas"
          description="El arqueo se hace sobre un despacho abierto. Registra un despacho primero."
        />
      </Screen>
    )
  }

  return (
    <Screen title="Cierre de ruta" subtitle={`${dispatch.routeName} · ${dispatch.distributorName}`}>
      <div className="grid w-full min-w-0 gap-3">
        {data.openDispatches.length > 1 && (
          <Field label="Ruta a cerrar">
            <SelectInput value={dispatch.id} onChange={(event) => setSelectedDispatchId(event.target.value)}>
              {data.openDispatches.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.routeName} · {item.distributorName}
                </option>
              ))}
            </SelectInput>
          </Field>
        )}

        <SectionCard title="Producto">
          <div className="grid gap-2">
            {productRows.map((row) => (
              <div key={row.productId} className="w-full min-w-0 rounded-2xl border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate text-xs font-extrabold text-slate-900">{row.productName}</p>
                  {/* Sin retorno declarado no se afirma que falte: solo falta el dato. */}
                  {isDeclared(row.productId) ? (
                    <VarianceBadge variance={row.variance} unitType={row.unitType} />
                  ) : (
                    <span className="inline-flex shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-black text-slate-500">
                      SIN DECLARAR
                    </span>
                  )}
                </div>

                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4">
                  <div>
                    <dt className="text-[10px] font-bold uppercase text-slate-400">Enviado</dt>
                    <dd className="text-xs font-black tabular-nums text-slate-800">
                      {formatQty(row.initialDispatch, row.unitType)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold uppercase text-slate-400">Aumentos</dt>
                    <dd className="text-xs font-black tabular-nums text-slate-800">
                      {formatQty(row.additions, row.unitType)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold uppercase text-slate-400">Vendido</dt>
                    <dd className="text-xs font-black tabular-nums text-slate-800">{formatQty(row.sold, row.unitType)}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold uppercase text-slate-400">Debe retornar</dt>
                    <dd className="text-xs font-black tabular-nums text-slate-800">
                      {formatQty(row.expectedReturn, row.unitType)}
                    </dd>
                  </div>
                </dl>

                <div className="mt-2">
                  <Field label="Retornado">
                    <NumberInput
                      value={returns[row.productId] ?? ''}
                      min={0}
                      step={row.unitType === 'kg' ? 0.1 : 1}
                      disabled={!canRegisterReturn || returnsAlreadyApplied}
                      placeholder="0"
                      onChange={(event) =>
                        setReturns((current) => ({ ...current, [row.productId]: event.target.value }))
                      }
                    />
                  </Field>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Dinero">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <KpiCard label="Ventas efectivo" value={formatBs(money.cashSales)} />
            <KpiCard label="Ventas QR" value={formatBs(money.qrSales)} />
            <KpiCard label="Credito generado" value={formatBs(money.creditGenerated)} tone="warning" />
            <KpiCard label="Cobros efectivo" value={formatBs(money.cashCollections)} />
            <KpiCard label="Cobros QR" value={formatBs(money.qrCollections)} />
            <KpiCard label="Gastos" value={formatBs(money.cashExpenses)} tone="danger" />
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <KpiCard
              label="Efectivo esperado"
              value={formatBs(money.expectedCash)}
              hint="Ventas efectivo + cobros efectivo - gastos"
              tone="primary"
            />
            <Field label="Efectivo fisico declarado (Bs)">
              <NumberInput
                value={declaredCash}
                min={0}
                step={1}
                disabled={!canCloseMoney}
                onChange={(event) => setDeclaredCash(event.target.value)}
              />
            </Field>
          </div>

          {isCashDeclared && (
            <div className="mt-3 flex items-center justify-between gap-2 rounded-2xl bg-slate-50 px-3 py-2.5">
              <span className="text-xs font-extrabold uppercase text-slate-500">Diferencia de caja</span>
              <VarianceBadge variance={cashDifference} />
            </div>
          )}
        </SectionCard>

        {error && <p className="text-xs font-bold text-rose-600">{error}</p>}

        <div className="grid gap-2 sm:grid-cols-2">
          {canRegisterReturn && (
            <SecondaryButton full disabled={isSubmitting || returnsAlreadyApplied} onClick={() => void submit('warehouse_done')}>
              <PackageCheck size={16} />
              {returnsAlreadyApplied ? 'Retorno ya registrado' : 'Guardar retorno de almacen'}
            </SecondaryButton>
          )}
          {canCloseMoney && (
            <PrimaryButton full disabled={isSubmitting} onClick={() => void submit('closed')}>
              <Lock size={16} /> Cerrar ruta
            </PrimaryButton>
          )}
        </div>

        {existingClosure && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-bold text-slate-500">
              <ClipboardCheck size={13} className="mr-1 inline" />
              Estado del cierre: {existingClosure.status}
            </p>
            {existingClosure.status === 'closed' && session.can('dist.reports.view') && (
              <SecondaryButton onClick={() => void reopenClosure(existingClosure, session.uid)}>
                <Unlock size={15} /> Reabrir (administracion)
              </SecondaryButton>
            )}
          </div>
        )}
      </div>
    </Screen>
  )
}
