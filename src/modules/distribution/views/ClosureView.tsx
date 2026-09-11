import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, ClipboardCheck, Lock, PackageCheck, Unlock } from 'lucide-react'
import { Field, NumberInput } from '../../../components/ui/Form'
import { ChoiceButton, ChoiceModal } from '../../../components/ui/ChoiceModal'
import { EmptyBlock, Screen } from '../../../components/ui/Screen'
import { buildReconciliation, computeMoneySummary, round2, toDayKey } from '../domain/engine'
import { declareRouteReturn, reopenClosure, saveClosure, subscribeSales, subscribeCollections, subscribeExpenses } from '../data/distributionRepository'
import { KpiCard, PrimaryButton, SecondaryButton, SectionCard, VarianceBadge, formatBs, formatQty } from './shared'
import type { DistributionViewProps } from './DistributionApp'
import type { DistSale, DistCollection, DistExpense, DistClosure } from '../types'

const CLOSURE_STATUS: Record<DistClosure['status'], string> = {
  draft: 'Devolución declarada; espera confirmación de almacén',
  warehouse_done: 'Devolución confirmada por almacén',
  closed: 'Cierre finalizado',
  reopened: 'Cierre reabierto',
}

/**
 * Arqueo de ruta: conciliacion fisica por producto y cuadre de dinero.
 *
 * El efectivo esperado solo considera efectivo:
 *   expectedCash = ventas efectivo + cobros efectivo - gastos efectivo
 * QR y credito no entran al efectivo fisico.
 */
export function ClosureView({ session, data }: DistributionViewProps) {
  const isDistributor = session.role === 'distributor'
  const availableDispatches = data.openDispatches.filter(d => session.role !== 'warehouse' || (d.warehouseId || 'central') === (session.warehouseId || 'central'))
  const canRegisterReturn = session.can('dist.return.register')
  const canCloseMoney = session.can('dist.closure.money')

  const [selectedDispatchId, setSelectedDispatchId] = useState('')
  const [returnDrafts, setReturnDrafts] = useState<Record<string, Record<string, string>>>({})
  const [cashDrafts, setCashDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDispatchOpen, setIsDispatchOpen] = useState(false)
  const [historyOpenId, setHistoryOpenId] = useState<string | null>(null)

  const dispatch = availableDispatches.find(item => item.id === selectedDispatchId) ?? availableDispatches[0] ?? null

  const existingClosure = data.closures.find((closure) => closure.dispatchId === dispatch?.id) ?? null

  const returnsAlreadyApplied = existingClosure
    ? Boolean(existingClosure.warehouseClosedBy)
    : false

  const dispatchKey = dispatch?.id || ''
  const dispatchDay = dispatch?.dayKey || ''
  const dispatchRoute = dispatch?.routeId || ''
  const dispatchCreated = dispatch?.createdAt || ''
  const savedReturns = existingClosure?.products?.length
    ? Object.fromEntries(existingClosure.products.map(row => [row.productId, String(row.actualReturn)]))
    : Object.fromEntries(Object.entries(existingClosure?.declaredReturns || {}).map(([id, q]) => [id, String(q)]))
  const returns = returnDrafts[dispatchKey] ?? savedReturns
  const declaredCash = cashDrafts[dispatchKey] ?? (existingClosure?.physicalCashDeclared != null ? String(existingClosure.physicalCashDeclared) : '')
  const setDeclaredCash = (value: string) => setCashDrafts(current => ({ ...current, [dispatchKey]: value }))
  const setReturns = (updater: (current: Record<string, string>) => Record<string, string>) => setReturnDrafts(current => ({ ...current, [dispatchKey]: updater(current[dispatchKey] ?? savedReturns) }))

  const [routeSales, setRouteSales] = useState<DistSale[]>([])
  const [routeCollections, setRouteCollections] = useState<DistCollection[]>([])
  const [routeExpenses, setRouteExpenses] = useState<DistExpense[]>([])
  const [readyDispatch, setReadyDispatch] = useState('')
  const loaded = readyDispatch === dispatchKey
  useEffect(() => {
    if (!dispatchKey) return
    const days = [dispatchDay, toDayKey(new Date())]
    const ready = new Set<string>()
    const expected = session.role === 'warehouse' ? 1 : 3
    const mark = (key: string) => { ready.add(key); if (ready.size >= expected) setReadyDispatch(dispatchKey) }
    const fail = (e: Error) => setError(e.message)
    const ownerUid = session.role === 'distributor' ? session.uid : undefined
    const stop = [subscribeSales(days, dispatchRoute, rows => { setRouteSales(rows.filter(s => s.sourceLocation !== 'centralWarehouse' && (s.dispatchId === dispatchKey || (!s.dispatchId && s.createdAt >= dispatchCreated)))); mark('sales') }, fail, ownerUid)]
    if (session.role !== 'warehouse') {
      stop.push(subscribeCollections(days, dispatchRoute, rows => { setRouteCollections(rows.filter(c => c.createdAt >= dispatchCreated)); mark('collections') }, fail, ownerUid))
      stop.push(subscribeExpenses(days, dispatchRoute, rows => { setRouteExpenses(rows.filter(e => e.createdAt >= dispatchCreated)); mark('expenses') }, fail, ownerUid))
    }
    return () => stop.forEach(fn => fn())
  }, [dispatchKey, dispatchDay, dispatchRoute, dispatchCreated, session.role, session.uid])

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

  const productRows = buildReconciliation(dispatch, routeSales, parsedReturns)

  const moneySummary = computeMoneySummary(routeSales, routeCollections, routeExpenses)
  const claimCash = data.claims.filter(c => c.routeId === dispatchRoute && c.createdAt >= dispatchCreated).reduce((n,c)=>n+c.cashIn-c.cashOut,0)
  const money = { ...moneySummary, expectedCash:round2(moneySummary.expectedCash+claimCash) }

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
      warehouseId: dispatch.warehouseId || 'central',
      routeId: dispatch.routeId,
      routeName: dispatch.routeName,
      distributorUid: dispatch.distributorUid,
      distributorName: dispatch.distributorName,
      status,
      products: productRows,
      declaredReturns: existingClosure?.declaredReturns || {},
      returnDeclaredBy: existingClosure?.returnDeclaredBy || '',
      returnDeclaredAt: existingClosure?.returnDeclaredAt || '',
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

    if (Object.values(parsedReturns).some(q => !Number.isFinite(q) || q < 0)) { setError('No se permiten retornos negativos.'); return }
    if (status === 'closed' && !returnsAlreadyApplied) { setError('Almacen debe confirmar primero el retorno fisico.'); return }
    if (status === 'closed' && (!declaredCash || !Number.isFinite(Number(declaredCash)) || Number(declaredCash) < 0)) {
      setError('Ingresa el efectivo fisico declarado antes de cerrar la ruta.')
      return
    }

    setIsSubmitting(true)
    try {
      await saveClosure({ closure, applyStockReturn: status === 'warehouse_done' && !returnsAlreadyApplied })
    } catch (submitError) {
      setError((submitError as Error).message || 'No se pudo guardar el cierre.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const historicalClosures = data.closures
    .filter(closure => session.role !== 'distributor' || closure.distributorUid === session.uid || closure.returnDeclaredBy === session.uid)
    .filter(closure => session.role !== 'warehouse' || (closure.warehouseId || 'central') === (session.warehouseId || 'central'))
    .slice()
    .sort((a, b) => (b.closedAt || b.warehouseClosedAt || b.createdAt).localeCompare(a.closedAt || a.warehouseClosedAt || a.createdAt))

  const closureHistory = (
    <SectionCard title="Historial de cierres">
      {historicalClosures.length === 0 ? <p className="text-xs font-semibold text-slate-500">Todavía no hay cierres registrados.</p> : <div className="grid gap-2">
        {historicalClosures.map(closure => {
          const expanded = historyOpenId === closure.id
          return <article key={closure.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <button type="button" onClick={() => setHistoryOpenId(expanded ? null : closure.id)} className="flex min-h-[62px] w-full items-center gap-3 p-3 text-left" aria-expanded={expanded}>
              <span className="min-w-0 flex-1"><strong className="block break-words text-sm text-slate-900">{closure.routeName || 'Ruta registrada'} · {closure.distributorName || 'Distribuidor'}</strong><span className="mt-0.5 block text-[11px] font-semibold text-slate-500">{new Date(closure.closedAt || closure.warehouseClosedAt || closure.createdAt).toLocaleString('es-BO')}</span><span className="mt-1 block text-[10px] font-extrabold text-[var(--primary)]">{CLOSURE_STATUS[closure.status] || 'Estado pendiente'}</span></span>
              {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
            </button>
            {expanded && <div className="grid gap-3 border-t border-slate-100 p-3">
              <div className="grid gap-2 md:grid-cols-2">{closure.products.length === 0 ? <p className="text-xs text-slate-500">Almacén todavía no confirmó las cantidades.</p> : closure.products.map(row => <div key={row.productId} className="rounded-xl bg-slate-50 p-3"><div className="flex items-start justify-between gap-2"><strong className="min-w-0 break-words text-xs text-slate-900">{row.productName}</strong><VarianceBadge variance={row.variance} unitType={row.unitType} /></div><dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4"><div><dt className="text-[9px] font-bold uppercase text-slate-400">Entregado</dt><dd className="text-xs font-black">{formatQty(row.totalLoaded, row.unitType)}</dd></div><div><dt className="text-[9px] font-bold uppercase text-slate-400">Vendido</dt><dd className="text-xs font-black">{formatQty(row.sold, row.unitType)}</dd></div><div><dt className="text-[9px] font-bold uppercase text-slate-400">Debía volver</dt><dd className="text-xs font-black">{formatQty(row.expectedReturn, row.unitType)}</dd></div><div><dt className="text-[9px] font-bold uppercase text-slate-400">Devuelto</dt><dd className="text-xs font-black">{formatQty(row.actualReturn, row.unitType)}</dd></div></dl></div>)}</div>
              {session.role === 'admin' && closure.status === 'closed' && <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><KpiCard label="Ventas efectivo" value={formatBs(closure.cashSales)} /><KpiCard label="Ventas QR" value={formatBs(closure.qrSales)} /><KpiCard label="Crédito" value={formatBs(closure.creditGenerated)} /><KpiCard label="Cobros efectivo" value={formatBs(closure.cashCollections)} /><KpiCard label="Cobros QR" value={formatBs(closure.qrCollections)} /><KpiCard label="Gastos" value={formatBs(closure.cashExpenses)} /><KpiCard label="Efectivo esperado" value={formatBs(closure.expectedCash)} /><KpiCard label="Efectivo declarado" value={formatBs(closure.physicalCashDeclared)} /></div>}
              {session.role === 'admin' && closure.status === 'closed' && <div className="flex flex-wrap items-center justify-between gap-2"><VarianceBadge variance={closure.cashDifference} /><SecondaryButton onClick={() => void reopenClosure(closure, session.uid).catch(e => setError(e.message))}><Unlock size={15} /> Reabrir cierre</SecondaryButton></div>}
            </div>}
          </article>
        })}
      </div>}
    </SectionCard>
  )

  if (!dispatch) {
    return (
      <Screen title="Cierre de ruta">
        {isDistributor && (
          <p className="rounded-2xl bg-amber-50 p-3 text-xs font-semibold leading-relaxed text-amber-900">
            Para cerrar tu ruta, primero declaras cuánto producto devuelves. Almacén cuenta y confirma físicamente esa devolución; después se habilita el cierre final del efectivo.
          </p>
        )}
        <EmptyBlock
          title="No hay rutas abiertas"
          description={isDistributor ? 'El arqueo se habilita cuando Almacén registra una carga abierta para tu usuario.' : 'El arqueo se hace sobre un despacho abierto. Registra un despacho primero.'}
        />
        {closureHistory}
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      </Screen>
    )
  }

  return (
    <Screen title="Cierre de ruta" subtitle={`${dispatch.routeName} · ${dispatch.distributorName}`}>
      <div className="grid w-full min-w-0 gap-3">
        {availableDispatches.length > 1 && (
          <Field label="Ruta a cerrar">
            <ChoiceButton label={`${dispatch.routeName} · ${dispatch.distributorName}`} placeholder="Selecciona despacho" onClick={() => setIsDispatchOpen(true)} />
          </Field>
        )}

        <p className="rounded-2xl bg-amber-50 p-3 text-xs font-semibold leading-relaxed text-amber-900">{isDistributor ? 'Para cerrar tu ruta, primero declara cuánto producto devuelves. Almacén debe contar y confirmar físicamente esa devolución; después se habilita el cierre final del efectivo.' : 'El distribuidor declara las cantidades. Almacén confirma la recepción física y después se habilita el cierre final. Confirmar y cerrar requieren conexión.'}</p>
        <SectionCard title="Producto">
          <div className="grid gap-2">
            {productRows.map((row) => (
              <div key={row.productId} className="w-full min-w-0 rounded-2xl border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 break-words text-xs font-extrabold text-slate-900">{row.productName}</p>
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
                      disabled={(!canRegisterReturn && !isDistributor) || returnsAlreadyApplied}
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

        {session.role !== 'warehouse' && <SectionCard title="Dinero">
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

          <div className="mt-3 grid grid-cols-2 gap-2">
            <KpiCard label="QR confirmado" value={formatBs(data.supportSettings.requireQrVerification ? data.qrVerifications.filter(v => (v.sourceType === 'sale' ? routeSales.some(s => s.id === v.sourceId) : routeCollections.some(c => c.id === v.sourceId))).reduce((sum, v) => sum + v.amount, 0) : money.qrSales + money.qrCollections)} tone="positive" />
            <KpiCard label="QR por verificar" value={formatBs(data.supportSettings.requireQrVerification ? money.qrSales + money.qrCollections - data.qrVerifications.filter(v => (v.sourceType === 'sale' ? routeSales.some(s => s.id === v.sourceId) : routeCollections.some(c => c.id === v.sourceId))).reduce((sum, v) => sum + v.amount, 0) : 0)} tone="warning" />
          </div>
          <p className="mt-2 text-xs text-slate-500">Administracion verifica los depositos en Verificar QR. El dinero del banco se concilia por separado del efectivo fisico.</p>
          {isCashDeclared && (
            <div className="mt-3 flex items-center justify-between gap-2 rounded-2xl bg-slate-50 px-3 py-2.5">
              <span className="text-xs font-extrabold uppercase text-slate-500">Diferencia de caja</span>
              <VarianceBadge variance={cashDifference} />
            </div>
          )}
        </SectionCard>}

        {error && <p className="text-xs font-bold text-rose-600">{error}</p>}

        {isDistributor && !returnsAlreadyApplied && <SecondaryButton full disabled={isSubmitting || !loaded} onClick={async () => {
          if (productRows.some(row => !isDeclared(row.productId))) { setError('Declara todos los productos, incluso si retornas cero.'); return }
          setIsSubmitting(true)
          try { await declareRouteReturn(dispatch, parsedReturns); setError(null) } catch (e) { setError((e as Error).message) } finally { setIsSubmitting(false) }
        }}>Declarar retorno para almacen</SecondaryButton>}
        {existingClosure?.returnDeclaredAt && <p className="text-xs text-emerald-700">Retorno declarado. {returnsAlreadyApplied ? 'Recepcion confirmada por almacen.' : 'Pendiente de recepcion en almacen.'}</p>}
        <div className="grid gap-2 sm:grid-cols-2">
          {canRegisterReturn && (
            <SecondaryButton full disabled={isSubmitting || !loaded || returnsAlreadyApplied} onClick={() => void submit('warehouse_done')}>
              <PackageCheck size={16} />
              {returnsAlreadyApplied ? 'Retorno ya registrado' : 'Guardar retorno de almacen'}
            </SecondaryButton>
          )}
          {canCloseMoney && (
            <PrimaryButton full disabled={isSubmitting || !loaded || !returnsAlreadyApplied} onClick={() => void submit('closed')}>
              <Lock size={16} /> Cerrar ruta
            </PrimaryButton>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-bold text-slate-500">
              <ClipboardCheck size={13} className="mr-1 inline" />
              Estado del cierre: {existingClosure ? CLOSURE_STATUS[existingClosure.status] || 'Pendiente' : 'Devolución pendiente de declarar'}
            </p>
            {existingClosure?.status === 'closed' && session.can('dist.reports.view') && (
              <SecondaryButton onClick={() => void reopenClosure(existingClosure, session.uid)}>
                <Unlock size={15} /> Reabrir (administracion)
              </SecondaryButton>
            )}
          </div>
        {closureHistory}
      </div>
      <ChoiceModal
        isOpen={isDispatchOpen}
        onClose={() => setIsDispatchOpen(false)}
        title="Ruta a cerrar"
        subtitle="Selecciona un despacho abierto"
        searchable
        options={availableDispatches.map(item => ({ value: item.id, label: item.routeName, description: `${item.distributorName} · ${new Date(item.createdAt).toLocaleString('es-BO')}` }))}
        selectedValue={dispatch.id}
        onSelect={setSelectedDispatchId}
      />
    </Screen>
  )
}
