import { LotsAndHistory } from './LotsAndHistory'
import { useMemo, useRef, useState } from 'react'
import { Download, FileSpreadsheet, History, ListTree, PackagePlus, SlidersHorizontal } from 'lucide-react'
import { Modal } from '../../../components/ui/Modal'
import { Field, NumberInput, Segmented, TextArea, TextInput } from '../../../components/ui/Form'
import { ChoiceButton, ChoiceModal } from '../../../components/ui/ChoiceModal'
import { EmptyBlock, Screen } from '../../../components/ui/Screen'
import { round2, toDayKey } from '../domain/engine'
import { newOperationId, registerAdjustment, registerIntake, warehouseBalanceId } from '../data/distributionRepository'
import { useRouteStock, useStockIndex } from '../state/useDistributionStore'
import { PrimaryButton, SectionCard, formatQty } from './shared'
import type { DistributionViewProps } from './DistributionApp'
import type { DistProduct } from '../types'
import { visiblePersonName, visibleRecordText } from './displayText'
import { RangePicker, describeRange } from './RangePicker'
import { exportExcel, exportPdf, inventoryHistorySheet } from '../data/reportExports'

const MOVEMENT_LABELS: Record<string, string> = {
  intake: 'Ingreso de stock', transfer: 'Transferencia', dispatch: 'Despacho a ruta',
  sale: 'Venta', adjustment: 'Disminución por ajuste', return: 'Devolución recibida',
  shortage: 'Faltante', overage: 'Sobrante', exchange: 'Cambio de producto',
  customer_return: 'Devolución del cliente',
}

/**
 * Inventario en dos ubicaciones reales: almacen central y stock en ruta.
 * El stock en ruta no es un numero suelto: es lo despachado menos lo vendido,
 * mantenido por el ledger de movimientos.
 */
export function InventoryView({ session, data }: DistributionViewProps) {
  const [selectedWarehouse, setSelectedWarehouse] = useState('central')
  const warehouseId = session.role === 'admin' ? selectedWarehouse : session.warehouseId || 'central'
  const lotLocation = warehouseId === 'central' ? 'central' : `warehouse__${warehouseId}`
  const canIntake = ['admin','warehouse'].includes(session.role) && warehouseId === 'central'
  const operation = useRef<string | null>(null)
  const canAdjust = session.role === 'admin'
  const isDistributor = session.role === 'distributor'

  const [tab, setTab] = useState<'central' | 'route'>(isDistributor ? 'route' : 'central')
  const [search, setSearch] = useState('')
  const [intakeProduct, setIntakeProduct] = useState<DistProduct | null>(null)
  const [intakeQuantity, setIntakeQuantity] = useState('0')
  const [intakeNote, setIntakeNote] = useState('')
  const [lotCode, setLotCode] = useState('')
  const [manufacturedOn, setManufacturedOn] = useState('')
  const [expiresOn, setExpiresOn] = useState('')
  const [adjustLotId, setAdjustLotId] = useState('')
  const [intakeMode, setIntakeMode] = useState<'intake' | 'adjustment'>('intake')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [choice, setChoice] = useState<'warehouse' | 'lot' | null>(null)
  const [historyProduct, setHistoryProduct] = useState<DistProduct | null>(null)
  const [isGeneralHistoryOpen, setIsGeneralHistoryOpen] = useState(false)
  const [historyDays, setHistoryDays] = useState<string[]>([toDayKey(new Date())])
  const [historyExporting, setHistoryExporting] = useState<'pdf' | 'excel' | null>(null)

  const { route } = useStockIndex(data.balances, session.routeId)
  const central = new Map(data.products.map(p => [p.id, data.balances.find(b => b.id === warehouseBalanceId(warehouseId, p.id))?.quantity || 0]))
  const warehouseName = data.warehouses.find(w => w.id === warehouseId)?.name || 'Almacén central'
  const routeStock = useRouteStock(data.balances)
  const warehouseLocation = warehouseId === 'central' ? 'central' : `warehouse__${warehouseId}`
  const locationName = (location?: string) => {
    if (!location) return 'Salida de inventario'
    if (location === 'central') return 'Almacén central'
    if (location.startsWith('warehouse__')) return data.warehouses.find(item => item.id === location.slice(11))?.name || 'Almacén interno'
    if (location.startsWith('route__')) return data.routes.find(item => item.id === location.slice(7))?.name || 'Ruta registrada'
    return 'Ubicación registrada'
  }
  const generalMovements = useMemo(() => data.movements
    .filter(movement => historyDays.includes(movement.dayKey || toDayKey(movement.createdAt)))
    .map(movement => {
      const from = movement.fromLocation || ''
      const to = movement.toLocation || ''
      const delta = to === warehouseLocation ? movement.quantity : from === warehouseLocation ? -movement.quantity : warehouseLocation === 'central' ? movement.centralDelta : 0
      return { movement, delta }
    })
    .filter(row => Math.abs(row.delta) > 0.0001)
    .sort((a, b) => b.movement.createdAt.localeCompare(a.movement.createdAt)), [data.movements, historyDays, warehouseLocation])

  const generalHistorySheet = inventoryHistorySheet(data, historyDays, warehouseId)

  const downloadGeneralHistory = async (format: 'pdf' | 'excel') => {
    if (historyExporting) return
    setHistoryExporting(format)
    try {
      const description = `${warehouseName} · ${describeRange(historyDays)} · Emitido ${new Date().toLocaleString('es-BO')}`
      if (format === 'pdf') await exportPdf([generalHistorySheet], description, 'SanJose-historial-inventario.pdf')
      else await exportExcel([generalHistorySheet], description, 'SanJose-historial-inventario.xlsx')
    } catch (downloadError) {
      setError((downloadError as Error).message || 'No se pudo generar el historial de inventario.')
    } finally {
      setHistoryExporting(null)
    }
  }

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase()
    return data.products
      .filter((product) => product.active !== false)
      .filter((product) => !term || product.name.toLowerCase().includes(term) || product.category.toLowerCase().includes(term))
  }, [data.products, search])

  const openIntake = (product: DistProduct, mode: 'intake' | 'adjustment') => {
    operation.current = null
    setLotCode(''); setManufacturedOn(''); setExpiresOn(''); setAdjustLotId('')
    setIntakeProduct(product)
    setIntakeMode(mode)
    setIntakeQuantity('0')
    setIntakeNote('')
    setError(null)
  }

  const submitIntake = async () => {
    if (!intakeProduct || isSubmitting) return
    const quantity = round2(Number(intakeQuantity))

    if (intakeMode === 'intake' && !(quantity > 0)) {
      setError('La cantidad del ingreso debe ser mayor a cero.')
      return
    }
    if (intakeMode === 'adjustment' && quantity >= 0) {
      setError('Para dar de baja stock indica una cantidad negativa. Para aumentarlo utiliza Ingreso por lote.')
      return
    }
    if (intakeMode === 'adjustment') {
      const currentStock = central.get(intakeProduct.id) ?? 0
      if (round2(currentStock + quantity) < 0) {
        setError(`El ajuste dejaria el stock en negativo (actual ${formatQty(currentStock, intakeProduct.unitType)}).`)
        return
      }
    }

    operation.current ||= newOperationId(intakeMode === 'intake' ? 'intake' : 'adjust')
    setIsSubmitting(true)
    try {
      const line = {
        productId: intakeProduct.id,
        productName: intakeProduct.name,
        unitType: intakeProduct.unitType,
        quantity, lotCode, manufacturedOn, expiresOn, lotId: adjustLotId || undefined,
      }
      if (intakeMode === 'intake') {
        await registerIntake([line], intakeNote, operation.current)
      } else {
        await registerAdjustment(line, intakeNote, operation.current, warehouseId)
      }
      setIntakeProduct(null)
    } catch (submitError) {
      if ((submitError as { rejected?: boolean }).rejected) operation.current = null
      setError((submitError as Error).message || 'No se pudo registrar el movimiento.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Screen title="Inventario" subtitle={isDistributor ? 'Lo que llevas cargado hoy' : `${warehouseName} y stock en ruta`}>
      <div className="flex w-full min-w-0 flex-col gap-3">
        {session.role === 'admin' && <Field label="Almacén"><ChoiceButton label={warehouseName} placeholder="Selecciona almacén" onClick={() => setChoice('warehouse')} /></Field>}
        {!isDistributor && (
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'central', label: warehouseName },
              { value: 'route', label: 'En ruta' },
            ]}
          />
        )}
        {!isDistributor && <button type="button" onClick={() => setIsGeneralHistoryOpen(true)} className="mx-auto flex min-h-[42px] items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-xs font-extrabold text-slate-700 shadow-sm"><ListTree size={16} /> Historial general de inventario</button>}

        {tab === 'central' && !isDistributor && (
          <>
            <TextInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar producto..." />
            <div className="grid w-full min-w-0 gap-2 sm:grid-cols-2">
              {filteredProducts.map((product) => {
                const stock = central.get(product.id) ?? 0
                return (
                  <div key={product.id} className="flex w-full min-w-0 items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-3">
                    <div className="min-w-0">
                      <p className="break-words text-xs font-extrabold text-slate-900">{product.name}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={`text-sm font-black tabular-nums ${stock > 0 ? 'text-slate-900' : 'text-rose-500'}`}>
                        {formatQty(stock, product.unitType)}
                      </span>
                      {(canIntake || canAdjust) && (
                        <>
                          {canIntake && <button
                            type="button"
                            aria-label="Ingreso"
                            onClick={() => openIntake(product, 'intake')}
                            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
                          >
                            <PackagePlus size={16} />
                          </button>}
                          {canAdjust && <button
                            type="button"
                            aria-label="Ajuste"
                            onClick={() => openIntake(product, 'adjustment')}
                            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
                          >
                            <SlidersHorizontal size={16} />
                          </button>}
                        </>
                      )}
                      <button type="button" aria-label={`Historial de ingresos de ${product.name}`} onClick={() => setHistoryProduct(product)} className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"><History size={16} /></button>
                    </div>
                  </div>
                )
              })}
            </div>
            {filteredProducts.length === 0 && <EmptyBlock title="Sin productos en el catalogo" />}
          </>
        )}

        {(tab === 'route' || isDistributor) && (
          <div className="grid w-full min-w-0 gap-3">
            {isDistributor ? (
              <SectionCard title="Mi carga actual">
                {[...route.entries()].filter(([, quantity]) => Math.abs(quantity) > 0.001).length === 0 ? (
                  <EmptyBlock title="Sin carga activa" description="Almacen todavia no registro tu despacho de hoy." />
                ) : (
                  <div className="grid gap-1.5">
                    {[...route.entries()]
                      .filter(([, quantity]) => Math.abs(quantity) > 0.001)
                      .map(([productId, quantity]) => {
                        const product = data.products.find((item) => item.id === productId)
                        return (
                          <div key={productId} className="flex min-w-0 items-center justify-between gap-2 rounded-2xl bg-slate-50 px-3 py-2">
                            <span className="min-w-0 break-words text-xs font-bold text-slate-800">{product?.name ?? 'Producto de registro anterior'}</span>
                            <span className="shrink-0 text-sm font-black tabular-nums text-slate-900">
                              {formatQty(quantity, product?.unitType ?? 'unit')}
                            </span>
                          </div>
                        )
                      })}
                  </div>
                )}
              </SectionCard>
            ) : routeStock.size === 0 ? (
              <EmptyBlock title="Ninguna ruta tiene mercaderia" description="Confirma un despacho para cargar una ruta." />
            ) : (
              [...routeStock.entries()].map(([routeId, balances]) => (
                <SectionCard key={routeId} title={visibleRecordText(data.routes.find((item) => item.id === routeId)?.name, 'Ruta de registro anterior')}>
                  <div className="grid gap-1.5">
                    {balances.map((balance) => (
                      <div key={balance.id} className="flex min-w-0 items-center justify-between gap-2 rounded-2xl bg-slate-50 px-3 py-2">
                        <span className="min-w-0 break-words text-xs font-bold text-slate-800">{balance.productName}</span>
                        <span className="shrink-0 text-sm font-black tabular-nums text-slate-900">
                          {formatQty(balance.quantity, balance.unitType)}
                        </span>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              ))
            )}
          </div>
        )}
      </div>

      <LotsAndHistory session={session} data={data} />
      <Modal isOpen={isGeneralHistoryOpen} onClose={() => setIsGeneralHistoryOpen(false)} title="Historial general de inventario" subtitle={warehouseName}>
        <div className="grid gap-3">
          <RangePicker dayKeys={historyDays} onChange={setHistoryDays} />
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={generalMovements.length === 0 || Boolean(historyExporting)} onClick={() => void downloadGeneralHistory('pdf')} className="flex min-h-[42px] items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-3 text-xs font-extrabold text-white disabled:opacity-40"><Download size={15} /> {historyExporting === 'pdf' ? 'Generando…' : 'Descargar PDF'}</button>
            <button type="button" disabled={generalMovements.length === 0 || Boolean(historyExporting)} onClick={() => void downloadGeneralHistory('excel')} className="flex min-h-[42px] items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-700 disabled:opacity-40"><FileSpreadsheet size={15} /> {historyExporting === 'excel' ? 'Generando…' : 'Descargar Excel'}</button>
          </div>
          <p className="text-[11px] font-semibold text-slate-500">{describeRange(historyDays)} · {generalMovements.length} movimientos</p>
          <div className="grid gap-2 md:grid-cols-2">{generalMovements.map(({ movement, delta }) => <article key={movement.id} className="min-w-0 rounded-2xl border border-slate-200 p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-words text-xs font-extrabold text-slate-900">{movement.productName}</p><p className="mt-0.5 text-[10px] font-semibold text-slate-500">{new Date(movement.createdAt).toLocaleString('es-BO')}</p></div><strong className={`shrink-0 text-sm tabular-nums ${delta > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{delta > 0 ? '+' : ''}{formatQty(delta, movement.unitType)}</strong></div><p className="mt-2 text-[11px] font-bold text-slate-700">{MOVEMENT_LABELS[movement.type] || 'Movimiento de inventario'}</p><p className="mt-1 break-words text-[10px] text-slate-500">{locationName(movement.fromLocation)} → {locationName(movement.toLocation)}</p><p className="mt-1 break-words text-[10px] text-slate-500">{movement.responsibleRole === 'admin' ? 'Administración' : movement.responsibleRole === 'warehouse' ? 'Almacén' : 'Usuario'} · {visiblePersonName(movement.responsibleName)}</p>{movement.note && <p className="mt-1 break-words text-[10px] text-slate-500">{movement.note}</p>}</article>)}</div>
          {generalMovements.length === 0 && <EmptyBlock title="Sin movimientos en este periodo" description="Prueba otro rango de fechas." />}
        </div>
      </Modal>
      <Modal isOpen={!!historyProduct} onClose={() => setHistoryProduct(null)} title="Historial de ingresos" subtitle={historyProduct?.name}>
        <div className="grid gap-2">
          {data.movements.filter(movement => movement.type === 'intake' && movement.productId === historyProduct?.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(movement => <article key={movement.id} className="rounded-2xl border border-slate-200 p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-extrabold text-slate-900">Nuevo ingreso</p><p className="mt-0.5 text-[11px] font-semibold text-slate-500">{new Date(movement.createdAt).toLocaleDateString('es-BO')} · {new Date(movement.createdAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}</p></div><strong className="shrink-0 text-sm text-emerald-700">+{formatQty(movement.quantity, movement.unitType)}</strong></div><p className="mt-2 text-[11px] text-slate-600">{movement.responsibleRole === 'admin' ? 'Administración' : movement.responsibleRole === 'warehouse' ? 'Almacén' : 'Usuario'} · {visiblePersonName(movement.responsibleName)}</p>{movement.lotCode && <p className="mt-1 text-[11px] text-slate-500">Lote {movement.lotCode}</p>}{movement.note && <p className="mt-1 text-[11px] text-slate-500">{movement.note}</p>}</article>)}
          {!data.movements.some(movement => movement.type === 'intake' && movement.productId === historyProduct?.id) && <p className="rounded-2xl border border-dashed border-slate-200 p-4 text-center text-xs font-semibold text-slate-500">Todavía no hay ingresos registrados para este producto.</p>}
        </div>
      </Modal>
      <Modal
        isOpen={Boolean(intakeProduct)}
        onClose={() => setIntakeProduct(null)}
        title={intakeMode === 'intake' ? 'Ingreso a almacen' : 'Ajuste de almacen'}
        subtitle={intakeProduct?.name}
        footer={
          <PrimaryButton full disabled={isSubmitting} onClick={() => void submitIntake()}>
            {isSubmitting ? 'Guardando...' : 'Registrar movimiento'}
          </PrimaryButton>
        }
      >
        <div className="grid gap-3">
          <Field
            label={intakeMode === 'intake' ? 'Cantidad que ingresa' : 'Ajuste (usa negativo para descontar)'}
            hint={`Stock actual: ${formatQty(central.get(intakeProduct?.id ?? '') ?? 0, intakeProduct?.unitType ?? 'unit')}`}
          >
            <NumberInput
              value={intakeQuantity}
              step={intakeProduct?.unitType === 'kg' ? 0.1 : 1}
              onChange={(event) => setIntakeQuantity(event.target.value)}
            />
          </Field>
          {intakeMode === 'intake' && <>
            <Field label="Código de lote" required><TextInput value={lotCode} onChange={e => setLotCode(e.target.value)} /></Field>
            <Field label="Fecha de elaboración / lote" required><TextInput type="date" value={manufacturedOn} onChange={e => setManufacturedOn(e.target.value)} /></Field>
            <Field label="Fecha de vencimiento" required><TextInput type="date" value={expiresOn} onChange={e => setExpiresOn(e.target.value)} /></Field>
          </>}
          {intakeMode === 'adjustment' && <Field label="Lote a descontar"><ChoiceButton label={adjustLotId ? data.lots.find(lot => lot.id === adjustLotId)?.lotCode : 'Vencimiento más próximo'} placeholder="Selecciona lote" onClick={() => setChoice('lot')} /><p className="text-xs">Para aumentar stock, usa Ingreso e indica sus fechas.</p></Field>}
          <Field label="Observacion">
            <TextArea value={intakeNote} onChange={(event) => setIntakeNote(event.target.value)} placeholder="Motivo o referencia" />
          </Field>
          {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
        </div>
      </Modal>
      <ChoiceModal
        isOpen={choice === 'warehouse'}
        onClose={() => setChoice(null)}
        title="Inventario de almacén"
        searchable
        options={[{ value: 'central', label: 'Almacén central' }, ...data.warehouses.filter(warehouse => warehouse.id !== 'central' && warehouse.active).map(warehouse => ({ value: warehouse.id, label: warehouse.name }))]}
        selectedValue={warehouseId}
        onSelect={value => { setSelectedWarehouse(value); setTab('central') }}
      />
      <ChoiceModal
        isOpen={choice === 'lot'}
        onClose={() => setChoice(null)}
        title="Lote a descontar"
        subtitle="Se muestran lotes con existencia"
        options={[{ value: '', label: 'Vencimiento más próximo', description: 'El sistema aplicará el criterio PEPS' }, ...data.lots.filter(lot => lot.productId === intakeProduct?.id && lot.quantities[lotLocation] > 0).map(lot => ({ value: lot.id, label: lot.lotCode, description: `Vence ${lot.expiresOn || 'sin fecha'}`, trailing: formatQty(lot.quantities[lotLocation], intakeProduct?.unitType || 'unit') }))]}
        selectedValue={adjustLotId}
        onSelect={setAdjustLotId}
      />
    </Screen>
  )
}
