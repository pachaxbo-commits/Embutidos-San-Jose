import { useMemo, useRef, useState } from 'react'
import { ArrowRight, Boxes, ChevronDown, ChevronRight, History, Plus } from 'lucide-react'
import { ChoiceButton, ChoiceModal } from '../../../components/ui/ChoiceModal'
import { Field, NumberInput, TextInput } from '../../../components/ui/Form'
import { Modal } from '../../../components/ui/Modal'
import { Screen } from '../../../components/ui/Screen'
import { createWarehouse, newOperationId, transferWarehouseStock, warehouseBalanceId } from '../data/distributionRepository'
import { PrimaryButton, SecondaryButton, formatQty } from './shared'
import { visiblePersonName, visibleRecordText } from './displayText'
import type { DistributionViewProps } from './DistributionApp'

export function WarehousesView({ session, data }: DistributionViewProps) {
  const warehouses = useMemo(() => [{ id: 'central', name: 'Almacén central' }, ...data.warehouses.filter(warehouse => warehouse.active)], [data.warehouses])
  const [name, setName] = useState('')
  const [from, setFrom] = useState(session.warehouseId || 'central')
  const [to, setTo] = useState('')
  const [productId, setProductId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [note, setNote] = useState('')
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  const [isTransferOpen, setIsTransferOpen] = useState(false)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [choice, setChoice] = useState<'from' | 'to' | 'product' | null>(null)
  const [openWarehouse, setOpenWarehouse] = useState<string | null>(null)
  const [transfersOpen, setTransfersOpen] = useState(false)
  const operation = useRef<string | null>(null)
  const isAdmin = session.can('dist.users.manage')
  const selected = data.products.find(product => product.id === productId)
  const available = selected ? data.balances.find(balance => balance.id === warehouseBalanceId(from, selected.id))?.availableQuantity || 0 : 0
  const availableProducts = data.products.filter(product => product.active && (data.balances.find(balance => balance.id === warehouseBalanceId(from, product.id))?.availableQuantity || 0) > 0)

  const resetTransfer = () => {
    setTo('')
    setProductId('')
    setQuantity('')
    setNote('')
    setFeedback('')
    operation.current = null
  }

  const submit = async () => {
    if (busy || !selected) return
    setBusy(true)
    setFeedback('')
    operation.current ||= newOperationId('transfer')
    try {
      await transferWarehouseStock(from, to, { productId, productName: selected.name, unitType: selected.unitType, quantity: Number(quantity) }, note, operation.current)
      operation.current = null
      setIsTransferOpen(false)
      resetTransfer()
      setFeedback('Transferencia registrada. El stock ya está en el almacén destino.')
    } catch (error) {
      setFeedback((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return <Screen title="Almacenes" subtitle="Existencias y transferencias internas">
    <div className="grid gap-3">
      <div className={`grid gap-2 ${isAdmin ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <PrimaryButton full onClick={() => { resetTransfer(); setIsTransferOpen(true) }}><ArrowRight size={16} /> Transferir</PrimaryButton>
        {isAdmin && <SecondaryButton full onClick={() => { setName(''); setFeedback(''); setIsCreateOpen(true) }}><Plus size={16} /> Nuevo almacén</SecondaryButton>}
      </div>

      <div className="grid gap-3 md:grid-cols-1 lg:grid-cols-2">
        {warehouses.map(warehouse => {
          const balances = data.balances.filter(balance => balance.locationKind === 'central' && (balance.warehouseId || 'central') === warehouse.id && (balance.availableQuantity ?? balance.quantity) > 0)
          const expanded = openWarehouse === warehouse.id
          return <section key={warehouse.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white"><button type="button" onClick={() => setOpenWarehouse(expanded ? null : warehouse.id)} className="flex min-h-[60px] w-full items-center gap-3 px-4 text-left"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--primary-soft)] text-[var(--primary)]"><Boxes size={17} /></span><span className="min-w-0 flex-1"><strong className="block break-words text-sm text-slate-900">{warehouse.name}</strong><span className="text-[11px] font-semibold text-slate-500">{balances.length} productos con stock</span></span>{expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</button>
            {expanded && <div className="grid gap-1.5 border-t border-slate-100 p-3">
              {balances.map(balance => <div key={balance.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-xl bg-slate-50 px-3 py-2">
                <span className="text-xs font-bold leading-snug text-slate-800">{balance.productName}</span>
                <strong className="shrink-0 text-xs tabular-nums text-slate-900">{formatQty(balance.availableQuantity ?? balance.quantity, balance.unitType)}</strong>
              </div>)}
              {balances.length === 0 && <div className="flex items-center gap-2 rounded-xl border border-dashed border-slate-200 p-4 text-xs font-semibold text-slate-500"><Boxes size={16} /> Sin stock disponible</div>}
            </div>}
          </section>
        })}
      </div>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white"><button type="button" onClick={() => setTransfersOpen(value => !value)} className="flex min-h-[60px] w-full items-center gap-3 px-4 text-left"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600"><History size={17} /></span><span className="min-w-0 flex-1"><strong className="block text-sm text-slate-900">Transferencias recientes</strong><span className="text-[11px] font-semibold text-slate-500">{data.transfers.length} registros</span></span>{transfersOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</button>
        {transfersOpen && <div className="grid gap-2 border-t border-slate-100 p-3">
          {[...data.transfers].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(transfer => <article key={transfer.id} className="rounded-2xl border border-slate-200 p-3">
            <div className="flex items-start justify-between gap-3"><strong className="text-xs leading-snug text-slate-900">{visibleRecordText(data.products.find(product => product.id === transfer.line.productId)?.name || transfer.line.productName, 'Producto de registro anterior')}</strong><strong className="shrink-0 text-xs tabular-nums text-[var(--primary)]">{formatQty(transfer.line.quantity, transfer.line.unitType)}</strong></div>
            <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-slate-600"><span>{warehouses.find(item => item.id === transfer.fromWarehouseId)?.name || 'Almacén anterior'}</span><ArrowRight size={12} className="shrink-0" /><span>{warehouses.find(item => item.id === transfer.toWarehouseId)?.name || 'Almacén anterior'}</span></p>
            <p className="mt-1 text-[10px] font-medium text-slate-400">{new Date(transfer.createdAt).toLocaleString('es-BO')} · {visiblePersonName(transfer.responsibleName)}</p>
            {transfer.note && <p className="mt-1 text-[11px] text-slate-600">{transfer.note}</p>}
          </article>)}
          {data.transfers.length === 0 && <p className="py-4 text-center text-xs font-semibold text-slate-500">Todavía no hay transferencias.</p>}
        </div>}
      </section>

      {feedback && !isTransferOpen && !isCreateOpen && <p role="status" className="rounded-2xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{feedback}</p>}
    </div>

    <Modal isOpen={isTransferOpen} onClose={() => setIsTransferOpen(false)} title="Transferir mercadería" subtitle="El stock se mueve en una sola operación" footer={<PrimaryButton full disabled={busy || !to || !selected || !(Number(quantity) > 0) || Number(quantity) > available} onClick={() => void submit()}>{busy ? 'Transfiriendo...' : 'Confirmar transferencia'}</PrimaryButton>}>
      <div className="grid gap-3">
        <Field label="Origen"><ChoiceButton disabled={!isAdmin || busy} placeholder="Selecciona origen" label={warehouses.find(warehouse => warehouse.id === from)?.name} onClick={() => setChoice('from')} /></Field>
        <Field label="Destino"><ChoiceButton disabled={busy} placeholder="Selecciona destino" label={warehouses.find(warehouse => warehouse.id === to)?.name} onClick={() => setChoice('to')} /></Field>
        <Field label="Producto"><ChoiceButton disabled={busy} placeholder="Selecciona producto" label={selected?.name} description={selected ? `${formatQty(available, selected.unitType)} disponibles` : undefined} onClick={() => setChoice('product')} /></Field>
        {selected && <Field label={`Cantidad (${selected.unitType === 'kg' ? 'kg' : selected.unitType === 'package' ? 'paquetes' : 'unidades'})`} error={Number(quantity) > available ? `Solo hay ${formatQty(available, selected.unitType)} disponibles.` : undefined}><NumberInput disabled={busy} value={quantity} min={0} max={available} step={selected.unitType === 'kg' ? 0.01 : 1} onChange={event => { setQuantity(event.target.value); operation.current = null }} /></Field>}
        <Field label="Referencia" hint="Opcional"><TextInput value={note} onChange={event => setNote(event.target.value)} placeholder="Motivo o destino de la transferencia" /></Field>
        {selected && Number(quantity) > 0 && <div className="rounded-2xl bg-[var(--primary-soft)] p-3 text-sm font-extrabold text-slate-900">{warehouses.find(warehouse => warehouse.id === from)?.name} → {warehouses.find(warehouse => warehouse.id === to)?.name || 'Destino'}<span className="mt-1 block text-xs font-semibold text-slate-600">{selected.name} · {formatQty(Number(quantity), selected.unitType)}</span></div>}
        {feedback && <p role="status" className="rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-800">{feedback}</p>}
      </div>
    </Modal>

    <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Nuevo almacén" footer={<PrimaryButton full disabled={busy || !name.trim()} onClick={async () => { setBusy(true); setFeedback(''); try { await createWarehouse(name); setName(''); setIsCreateOpen(false); setFeedback('Almacén creado. Asigna su responsable desde Usuarios.') } catch (error) { setFeedback((error as Error).message) } finally { setBusy(false) } }}>{busy ? 'Creando...' : 'Crear almacén'}</PrimaryButton>}>
      <Field label="Nombre"><TextInput autoFocus value={name} onChange={event => setName(event.target.value)} placeholder="Ej. Almacén zona norte" /></Field>
      {feedback && <p role="status" className="mt-3 rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-800">{feedback}</p>}
    </Modal>

    <ChoiceModal isOpen={choice === 'from'} onClose={() => setChoice(null)} title="Almacén de origen" options={warehouses.map(warehouse => ({ value: warehouse.id, label: warehouse.name }))} selectedValue={from} onSelect={value => { setFrom(value); setProductId(''); setQuantity(''); operation.current = null }} />
    <ChoiceModal isOpen={choice === 'to'} onClose={() => setChoice(null)} title="Almacén de destino" options={warehouses.filter(warehouse => warehouse.id !== from).map(warehouse => ({ value: warehouse.id, label: warehouse.name }))} selectedValue={to} onSelect={value => { setTo(value); operation.current = null }} />
    <ChoiceModal isOpen={choice === 'product'} onClose={() => setChoice(null)} title="Producto disponible" searchable options={availableProducts.map(product => ({ value: product.id, label: product.name, trailing: formatQty(data.balances.find(balance => balance.id === warehouseBalanceId(from, product.id))?.availableQuantity || 0, product.unitType) }))} selectedValue={productId} onSelect={value => { setProductId(value); setQuantity(''); operation.current = null }} emptyLabel="No hay productos disponibles en este almacén" />
  </Screen>
}
