import { useMemo, useState } from 'react'
import { PackagePlus, Plus, Truck } from 'lucide-react'
import { Modal } from '../../../components/ui/Modal'
import { Field, NumberInput, SelectInput, TextArea, TextInput } from '../../../components/ui/Form'
import { EmptyBlock, Screen } from '../../../components/ui/Screen'
import { computeLoadedByProduct, round2, validateStockAvailability } from '../domain/engine'
import { addDispatchLoad, confirmDispatch, newOperationId } from '../data/distributionRepository'
import { useStockIndex } from '../state/useDistributionStore'
import { useTenantMembers } from '../state/useTenantMembers'
import { PrimaryButton, SecondaryButton, SectionCard, formatQty } from './shared'
import type { DistributionViewProps } from './DistributionApp'
import type { DistDispatch, DistDispatchLine } from '../types'

interface DraftLine {
  productId: string
  quantity: string
}

/**
 * Despachos a ruta. Confirmar descuenta el almacen central y carga la ruta una
 * sola vez; los aumentos posteriores se registran aparte y conservan historial.
 */
export function DispatchesView({ session, data }: DistributionViewProps) {
  const { members } = useTenantMembers()
  const { central } = useStockIndex(data.balances, null)

  const [isNewOpen, setIsNewOpen] = useState(false)
  const [additionTarget, setAdditionTarget] = useState<DistDispatch | null>(null)
  const [routeId, setRouteId] = useState('')
  const [distributorUid, setDistributorUid] = useState('')
  const [observation, setObservation] = useState('')
  const [draftLines, setDraftLines] = useState<DraftLine[]>([{ productId: '', quantity: '' }])
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [search, setSearch] = useState('')

  const distributors = useMemo(
    () => members.filter((member) => member.role === 'distributor' && member.active !== false),
    [members],
  )

  const activeProducts = useMemo(() => data.products.filter((product) => product.active !== false), [data.products])

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase()
    return term ? activeProducts.filter((product) => product.name.toLowerCase().includes(term)) : activeProducts
  }, [activeProducts, search])

  const resetDraft = () => {
    setRouteId('')
    setDistributorUid('')
    setObservation('')
    setDraftLines([{ productId: '', quantity: '' }])
    setError(null)
    setSearch('')
  }

  const buildLines = (): DistDispatchLine[] => {
    const lines: DistDispatchLine[] = []
    for (const draft of draftLines) {
      const quantity = round2(Number(draft.quantity))
      if (!draft.productId || !(quantity > 0)) continue
      const product = activeProducts.find((item) => item.id === draft.productId)
      if (!product) continue
      lines.push({
        productId: product.id,
        productName: product.presentation ? `${product.name} - ${product.presentation}` : product.name,
        unitType: product.unitType,
        quantity,
      })
    }
    return lines
  }

  const submitDispatch = async () => {
    if (isSubmitting) return
    setError(null)

    const lines = buildLines()
    if (!routeId) {
      setError('Selecciona la ruta.')
      return
    }
    if (lines.length === 0) {
      setError('Agrega al menos un producto con cantidad.')
      return
    }

    const stockError = validateStockAvailability(lines, central)
    if (stockError) {
      setError(stockError)
      return
    }

    const distributor = distributors.find((member) => member.uid === distributorUid)
    const route = data.routes.find((item) => item.id === routeId)

    setIsSubmitting(true)
    try {
      await confirmDispatch({
        routeId,
        routeName: route?.name ?? routeId,
        distributorUid: distributor?.uid ?? '',
        distributorName: distributor?.displayName ?? 'Sin asignar',
        lines,
        observation,
        operationId: newOperationId('disp'),
      })
      setIsNewOpen(false)
      resetDraft()
    } catch (submitError) {
      setError((submitError as Error).message || 'No se pudo confirmar el despacho.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const submitAddition = async () => {
    if (!additionTarget || isSubmitting) return
    setError(null)

    const lines = buildLines()
    if (lines.length === 0) {
      setError('Agrega al menos un producto con cantidad.')
      return
    }

    const stockError = validateStockAvailability(lines, central)
    if (stockError) {
      setError(stockError)
      return
    }

    setIsSubmitting(true)
    try {
      await addDispatchLoad({
        dispatch: additionTarget,
        lines,
        registeredByName: session.userName,
        note: observation,
        operationId: newOperationId('add'),
      })
      setAdditionTarget(null)
      resetDraft()
    } catch (submitError) {
      setError((submitError as Error).message || 'No se pudo registrar el aumento.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const canDispatch = session.can('dist.dispatch.create')

  const lineEditor = (
    <div className="grid gap-2">
      <TextInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filtrar productos..." />
      {draftLines.map((line, index) => (
        <div key={index} className="grid gap-2 rounded-2xl border border-slate-200 p-2 sm:grid-cols-[2fr_1fr]">
          <SelectInput
            value={line.productId}
            onChange={(event) => {
              const value = event.target.value
              setDraftLines((current) => current.map((item, i) => (i === index ? { ...item, productId: value } : item)))
            }}
          >
            <option value="">Selecciona producto</option>
            {filteredProducts.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} {product.presentation ? `· ${product.presentation}` : ''} ({formatQty(central.get(product.id) ?? 0, product.unitType)})
              </option>
            ))}
          </SelectInput>
          <NumberInput
            value={line.quantity}
            min={0}
            step={0.1}
            placeholder="Cantidad"
            onChange={(event) => {
              const value = event.target.value
              setDraftLines((current) => current.map((item, i) => (i === index ? { ...item, quantity: value } : item)))
            }}
          />
        </div>
      ))}
      <SecondaryButton full onClick={() => setDraftLines((current) => [...current, { productId: '', quantity: '' }])}>
        <Plus size={16} /> Agregar otro producto
      </SecondaryButton>
      <Field label="Observacion">
        <TextArea value={observation} onChange={(event) => setObservation(event.target.value)} />
      </Field>
      {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
    </div>
  )

  return (
    <Screen
      title="Despachos"
      subtitle="Salidas a ruta y aumentos de carga"
      actions={
        canDispatch ? (
          <PrimaryButton
            onClick={() => {
              resetDraft()
              setIsNewOpen(true)
            }}
          >
            <Truck size={16} /> Nuevo
          </PrimaryButton>
        ) : undefined
      }
    >
      <div className="grid w-full min-w-0 gap-3">
        {data.openDispatches.length === 0 && (
          <EmptyBlock title="Sin despachos abiertos" description="Crea un despacho para cargar una ruta." />
        )}

        {data.openDispatches.map((dispatch) => {
          const loaded = computeLoadedByProduct(dispatch)
          return (
            <SectionCard
              key={dispatch.id}
              title={`${dispatch.routeName} · ${dispatch.distributorName}`}
              action={
                session.can('dist.dispatch.addLoad') ? (
                  <SecondaryButton
                    onClick={() => {
                      resetDraft()
                      setAdditionTarget(dispatch)
                    }}
                  >
                    <PackagePlus size={16} /> Aumentar
                  </SecondaryButton>
                ) : undefined
              }
            >
              <div className="grid gap-1.5">
                {[...loaded.entries()].map(([productId, totals]) => (
                  <div key={productId} className="flex items-center justify-between gap-2 rounded-2xl bg-slate-50 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-extrabold text-slate-900">{totals.productName}</p>
                      <p className="text-[11px] font-semibold text-slate-500">
                        Carga inicial {formatQty(totals.initialDispatch, totals.unitType)} · Aumentos{' '}
                        {formatQty(totals.additions, totals.unitType)}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-black tabular-nums text-slate-900">
                      {formatQty(totals.totalLoaded, totals.unitType)}
                    </span>
                  </div>
                ))}
              </div>

              {dispatch.additions.length > 0 && (
                <div className="mt-2 rounded-2xl border border-dashed border-slate-200 p-2">
                  <p className="mb-1 text-[10px] font-extrabold uppercase text-slate-400">Historial de aumentos</p>
                  {dispatch.additions.map((addition) => (
                    <p key={addition.id} className="text-[11px] font-semibold text-slate-500">
                      {new Date(addition.createdAt).toLocaleString('es-BO')} · {addition.createdByName} ·{' '}
                      {addition.quantityByProduct
                        .map((line) => `${line.productName} +${formatQty(line.quantity, line.unitType)}`)
                        .join(', ')}
                    </p>
                  ))}
                </div>
              )}
            </SectionCard>
          )
        })}
      </div>

      <Modal
        isOpen={isNewOpen}
        onClose={() => setIsNewOpen(false)}
        title="Nuevo despacho"
        subtitle="Descuenta almacen central y carga la ruta"
        size="lg"
        footer={
          <PrimaryButton full disabled={isSubmitting} onClick={() => void submitDispatch()}>
            {isSubmitting ? 'Confirmando...' : 'Confirmar despacho'}
          </PrimaryButton>
        }
      >
        <div className="grid gap-3">
          <Field label="Ruta" required>
            <SelectInput value={routeId} onChange={(event) => setRouteId(event.target.value)}>
              <option value="">Selecciona ruta</option>
              {data.routes.map((route) => (
                <option key={route.id} value={route.id}>
                  {route.name}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Distribuidor">
            <SelectInput value={distributorUid} onChange={(event) => setDistributorUid(event.target.value)}>
              <option value="">Sin asignar</option>
              {distributors.map((member) => (
                <option key={member.uid} value={member.uid}>
                  {member.displayName}
                </option>
              ))}
            </SelectInput>
          </Field>
          {lineEditor}
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(additionTarget)}
        onClose={() => setAdditionTarget(null)}
        title="Aumento de carga"
        subtitle={additionTarget ? `${additionTarget.routeName} · ${additionTarget.distributorName}` : ''}
        size="lg"
        footer={
          <PrimaryButton full disabled={isSubmitting} onClick={() => void submitAddition()}>
            {isSubmitting ? 'Guardando...' : 'Registrar aumento'}
          </PrimaryButton>
        }
      >
        {lineEditor}
      </Modal>
    </Screen>
  )
}
