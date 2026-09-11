import { useMemo, useState } from 'react'
import { Check, PackagePlus, Search, Trash2, Truck } from 'lucide-react'
import { Modal } from '../../../components/ui/Modal'
import { Field, NumberInput, TextArea, TextInput } from '../../../components/ui/Form'
import { ChoiceButton, ChoiceModal } from '../../../components/ui/ChoiceModal'
import { EmptyBlock, Screen } from '../../../components/ui/Screen'
import { computeLoadedByProduct, round2, validateStockAvailability } from '../domain/engine'
import { addDispatchLoad, confirmDispatch, newOperationId, warehouseBalanceId } from '../data/distributionRepository'
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
  const [warehouseId, setWarehouseId] = useState(session.warehouseId || 'central')

  const [isNewOpen, setIsNewOpen] = useState(false)
  const [additionTarget, setAdditionTarget] = useState<DistDispatch | null>(null)
  const effectiveWarehouse = additionTarget?.warehouseId || warehouseId
  const central = new Map(data.products.map(p => [p.id, data.balances.find(b => b.id === warehouseBalanceId(effectiveWarehouse, p.id))?.availableQuantity || 0]))
  const [routeId, setRouteId] = useState('')
  const [distributorUid, setDistributorUid] = useState('')
  const [observation, setObservation] = useState('')
  const [draftLines, setDraftLines] = useState<DraftLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [search, setSearch] = useState('')
  const [isProductPickerOpen, setIsProductPickerOpen] = useState(false)
  const [isDistributorPickerOpen, setIsDistributorPickerOpen] = useState(false)
  const [isWarehousePickerOpen, setIsWarehousePickerOpen] = useState(false)

  const distributors = useMemo(
    () => members.filter((member) => member.role === 'distributor' && member.active !== false),
    [members],
  )

  const activeProducts = useMemo(() => data.products.filter((product) => product.active !== false), [data.products])

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase()
    return term ? activeProducts.filter((product) => product.name.toLowerCase().includes(term)) : activeProducts
  }, [activeProducts, search])

  /**
   * El distribuidor solo ve la carga de SU ruta. Si el despacho se registra en
   * otra, la mercaderia sale del almacen y no le aparece a nadie: por eso al
   * elegir a la persona se toma su ruta y se avisa si no coinciden.
   */
  const selectDistributor = (uid: string) => {
    setDistributorUid(uid)
    const member = distributors.find((item) => item.uid === uid)
    if (member?.routeId) setRouteId(member.routeId)
  }

  const selectedDistributor = distributors.find((member) => member.uid === distributorUid) ?? null
  const routeMismatch = Boolean(
    selectedDistributor?.routeId && routeId && selectedDistributor.routeId !== routeId,
  )

  const resetDraft = () => {
    setRouteId('')
    setDistributorUid('')
    setObservation('')
    setDraftLines([])
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
    if (!selectedDistributor?.routeId || routeMismatch) { setError('Selecciona un distribuidor y su ruta asignada.'); return }
    if (data.openDispatches.some(d => d.routeId === routeId)) { setError('La ruta ya tiene un despacho abierto. Usa Aumentar.'); return }
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
        warehouseId,
        routeId,
        routeName: route?.name ?? 'Ruta sin nombre',
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
    <div className="grid gap-3">
      <div className="grid gap-2">
        {draftLines.map((line) => {
          const product = activeProducts.find(item => item.id === line.productId)
          if (!product) return null
          return <div key={line.productId} className="grid grid-cols-[minmax(0,1fr)_96px_40px] items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2.5">
            <div className="min-w-0"><p className="text-xs font-extrabold leading-snug text-slate-900">{product.name}</p><p className="mt-0.5 text-[10px] font-semibold text-slate-500">Disponible: {formatQty(central.get(product.id) ?? 0, product.unitType)}</p></div>
            <NumberInput aria-label={`Cantidad de ${product.name}`} value={line.quantity} min={0} step={product.unitType === 'kg' ? 0.01 : 1} placeholder={product.unitType === 'kg' ? 'kg' : 'Cant.'} onChange={event => setDraftLines(current => current.map(item => item.productId === line.productId ? { ...item, quantity: event.target.value } : item))} className="px-2 text-center" />
            <button type="button" aria-label={`Quitar ${product.name}`} onClick={() => setDraftLines(current => current.filter(item => item.productId !== line.productId))} className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 hover:bg-white hover:text-rose-600"><Trash2 size={16} /></button>
          </div>
        })}
        {draftLines.length === 0 && <p className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-center text-xs font-semibold text-slate-500">Todavía no seleccionaste productos.</p>}
      </div>
      <SecondaryButton full onClick={() => setIsProductPickerOpen(true)}>
        <PackagePlus size={16} /> {draftLines.length ? 'Editar productos' : 'Seleccionar productos'}
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

        {data.openDispatches.filter(d => session.role !== 'warehouse' || (d.warehouseId || 'central') === (session.warehouseId || 'central')).map((dispatch) => {
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
                  <div key={productId} className="flex min-w-0 items-center justify-between gap-2 rounded-2xl bg-slate-50 px-3 py-2">
                    <div className="min-w-0">
                      <p className="break-words text-xs font-extrabold text-slate-900">
                        {data.products.find((product) => product.id === productId)?.name || totals.productName}
                      </p>
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
          <Field label="Almacen de origen"><ChoiceButton disabled={session.role === 'warehouse'} placeholder="Selecciona almacén" label={warehouseId === 'central' ? 'Almacén central' : data.warehouses.find(w => w.id === warehouseId)?.name} onClick={() => setIsWarehousePickerOpen(true)} /></Field>
          <Field label="Distribuidor" required hint="Al elegirlo se toma su ruta asignada.">
            <ChoiceButton placeholder="Selecciona distribuidor" label={selectedDistributor?.displayName} description={selectedDistributor?.routeId ? data.routes.find(route => route.id === selectedDistributor.routeId)?.name ?? 'Ruta de registro anterior' : undefined} onClick={() => setIsDistributorPickerOpen(true)} />
          </Field>

          <Field label="Ruta" required>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm font-bold text-slate-800">{data.routes.find(route => route.id === routeId)?.name || 'Se asigna al seleccionar distribuidor'}</div>
          </Field>

          {routeMismatch && (
            <p className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-800">
              {selectedDistributor?.displayName} trabaja en{' '}
              {data.routes.find((route) => route.id === selectedDistributor?.routeId)?.name ?? 'Ruta de registro anterior'}.
              Si despachas a otra ruta no vera esta carga en su telefono. Cambia la ruta aqui, o su ruta asignada
              desde Usuarios.
            </p>
          )}

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

      <ChoiceModal isOpen={isWarehousePickerOpen} onClose={() => setIsWarehousePickerOpen(false)} title="Almacén de origen" options={[{ value: 'central', label: 'Almacén central' }, ...data.warehouses.filter(w => w.active).map(w => ({ value: w.id, label: w.name }))]} selectedValue={warehouseId} onSelect={value => { setWarehouseId(value); setDraftLines([]) }} />
      <ChoiceModal isOpen={isDistributorPickerOpen} onClose={() => setIsDistributorPickerOpen(false)} title="Selecciona distribuidor" subtitle="La ruta se asignará automáticamente" searchable options={distributors.map(member => ({ value: member.uid, label: member.displayName, description: member.routeId ? data.routes.find(route => route.id === member.routeId)?.name ?? 'Ruta de registro anterior' : 'Sin ruta asignada', disabled: !member.routeId }))} selectedValue={distributorUid} onSelect={selectDistributor} />
      <Modal isOpen={isProductPickerOpen} onClose={() => { setIsProductPickerOpen(false); setSearch('') }} title="Productos del despacho" subtitle="Selecciona varios y escribe la cantidad" size="lg" footer={<PrimaryButton full onClick={() => { setIsProductPickerOpen(false); setSearch('') }}>Listo · {draftLines.length} producto{draftLines.length === 1 ? '' : 's'}</PrimaryButton>}>
        <div className="grid gap-3">
          <div className="relative"><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><TextInput autoFocus value={search} onChange={event => setSearch(event.target.value)} className="pl-9" placeholder="Buscar producto..." /></div>
          <div className="grid grid-cols-2 gap-2">
            {filteredProducts.filter(product => (central.get(product.id) ?? 0) > 0 || draftLines.some(line => line.productId === product.id)).map(product => {
              const draft = draftLines.find(line => line.productId === product.id)
              return <div key={product.id} className={`min-w-0 overflow-hidden rounded-2xl border ${draft ? 'border-[var(--primary)] bg-[var(--primary-soft)]' : 'border-slate-200 bg-white'}`}>
                {product.photoDataUrl && <img src={product.photoDataUrl} alt={`Foto de ${product.name}`} onError={(event) => { event.currentTarget.style.display = 'none' }} className="aspect-[16/8] w-full object-cover" />}
                <button type="button" onClick={() => setDraftLines(current => draft ? current.filter(line => line.productId !== product.id) : [...current, { productId: product.id, quantity: '' }])} className="flex min-h-[88px] w-full flex-col items-start justify-between gap-2 p-3 text-left">
                  <span className="text-xs font-extrabold leading-snug text-slate-900">{product.name}</span>
                  <span className="flex w-full items-center justify-between gap-1 text-[10px] font-bold text-slate-500"><span>{formatQty(central.get(product.id) ?? 0, product.unitType)}</span>{draft && <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--primary)] text-white"><Check size={13} /></span>}</span>
                </button>
                {draft && <div className="border-t border-[var(--primary)]/15 p-2"><NumberInput autoFocus value={draft.quantity} min={0} max={central.get(product.id) ?? undefined} step={product.unitType === 'kg' ? 0.01 : 1} placeholder={`Cantidad (${product.unitType === 'kg' ? 'kg' : product.unitType === 'package' ? 'paq' : 'u'})`} onChange={event => setDraftLines(current => current.map(line => line.productId === product.id ? { ...line, quantity: event.target.value } : line))} className="px-2 text-center text-xs" /></div>}
              </div>
            })}
          </div>
        </div>
      </Modal>
    </Screen>
  )
}
