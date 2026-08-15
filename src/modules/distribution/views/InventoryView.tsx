import { useMemo, useState } from 'react'
import { PackagePlus, SlidersHorizontal } from 'lucide-react'
import { Modal } from '../../../components/ui/Modal'
import { Field, NumberInput, Segmented, TextArea, TextInput } from '../../../components/ui/Form'
import { EmptyBlock, Screen } from '../../../components/ui/Screen'
import { round2 } from '../domain/engine'
import { newOperationId, registerAdjustment, registerIntake } from '../data/distributionRepository'
import { useRouteStock, useStockIndex } from '../state/useDistributionStore'
import { PrimaryButton, SectionCard, formatQty } from './shared'
import type { DistributionViewProps } from './DistributionApp'
import type { DistProduct } from '../types'

/**
 * Inventario en dos ubicaciones reales: almacen central y stock en ruta.
 * El stock en ruta no es un numero suelto: es lo despachado menos lo vendido,
 * mantenido por el ledger de movimientos.
 */
export function InventoryView({ session, data }: DistributionViewProps) {
  const canAdjust = session.can('dist.inventory.adjust')
  const isDistributor = session.role === 'distributor'

  const [tab, setTab] = useState<'central' | 'route'>(isDistributor ? 'route' : 'central')
  const [search, setSearch] = useState('')
  const [intakeProduct, setIntakeProduct] = useState<DistProduct | null>(null)
  const [intakeQuantity, setIntakeQuantity] = useState('0')
  const [intakeNote, setIntakeNote] = useState('')
  const [intakeMode, setIntakeMode] = useState<'intake' | 'adjustment'>('intake')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { central, route } = useStockIndex(data.balances, session.routeId)
  const routeStock = useRouteStock(data.balances)

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase()
    return data.products
      .filter((product) => product.active !== false)
      .filter((product) => !term || product.name.toLowerCase().includes(term) || product.category.toLowerCase().includes(term))
  }, [data.products, search])

  const openIntake = (product: DistProduct, mode: 'intake' | 'adjustment') => {
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
    if (intakeMode === 'adjustment' && quantity === 0) {
      setError('Indica cuanto sube o baja el stock (puede ser negativo).')
      return
    }
    if (intakeMode === 'adjustment') {
      const currentStock = central.get(intakeProduct.id) ?? 0
      if (round2(currentStock + quantity) < 0) {
        setError(`El ajuste dejaria el stock en negativo (actual ${formatQty(currentStock, intakeProduct.unitType)}).`)
        return
      }
    }

    setIsSubmitting(true)
    try {
      const line = {
        productId: intakeProduct.id,
        productName: intakeProduct.name,
        unitType: intakeProduct.unitType,
        quantity,
      }
      if (intakeMode === 'intake') {
        await registerIntake([line], intakeNote, newOperationId('intake'))
      } else {
        await registerAdjustment(line, intakeNote || 'Ajuste manual', newOperationId('adjust'))
      }
      setIntakeProduct(null)
    } catch (submitError) {
      setError((submitError as Error).message || 'No se pudo registrar el movimiento.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Screen title="Inventario" subtitle={isDistributor ? 'Lo que llevas cargado hoy' : 'Almacen central y stock en ruta'}>
      <div className="flex w-full min-w-0 flex-col gap-3">
        {!isDistributor && (
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'central', label: 'Almacen central' },
              { value: 'route', label: 'En ruta' },
            ]}
          />
        )}

        {tab === 'central' && !isDistributor && (
          <>
            <TextInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar producto..." />
            <div className="grid w-full min-w-0 gap-2 sm:grid-cols-2">
              {filteredProducts.map((product) => {
                const stock = central.get(product.id) ?? 0
                return (
                  <div key={product.id} className="flex w-full min-w-0 items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-extrabold text-slate-900">{product.name}</p>
                      <p className="truncate text-[11px] font-semibold text-slate-500">
                        {product.presentation || product.category}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={`text-sm font-black tabular-nums ${stock > 0 ? 'text-slate-900' : 'text-rose-500'}`}>
                        {formatQty(stock, product.unitType)}
                      </span>
                      {canAdjust && (
                        <>
                          <button
                            type="button"
                            aria-label="Ingreso"
                            onClick={() => openIntake(product, 'intake')}
                            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
                          >
                            <PackagePlus size={16} />
                          </button>
                          <button
                            type="button"
                            aria-label="Ajuste"
                            onClick={() => openIntake(product, 'adjustment')}
                            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
                          >
                            <SlidersHorizontal size={16} />
                          </button>
                        </>
                      )}
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
                            <span className="min-w-0 truncate text-xs font-bold text-slate-800">{product?.name ?? productId}</span>
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
                <SectionCard key={routeId} title={data.routes.find((item) => item.id === routeId)?.name ?? routeId}>
                  <div className="grid gap-1.5">
                    {balances.map((balance) => (
                      <div key={balance.id} className="flex min-w-0 items-center justify-between gap-2 rounded-2xl bg-slate-50 px-3 py-2">
                        <span className="min-w-0 truncate text-xs font-bold text-slate-800">{balance.productName}</span>
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
          <Field label="Observacion">
            <TextArea value={intakeNote} onChange={(event) => setIntakeNote(event.target.value)} placeholder="Motivo o referencia" />
          </Field>
          {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
        </div>
      </Modal>
    </Screen>
  )
}
