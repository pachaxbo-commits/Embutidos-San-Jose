import { useMemo, useRef, useState } from 'react'
import { ArrowRight, CheckCircle2, RotateCcw } from 'lucide-react'
import { ChoiceButton, ChoiceModal } from '../../../components/ui/ChoiceModal'
import { Field, NumberInput, Segmented, TextArea } from '../../../components/ui/Form'
import { Screen } from '../../../components/ui/Screen'
import { RangePicker } from './RangePicker'
import { PrimaryButton, SectionCard, formatBs, formatQty } from './shared'
import { registerClaim, newOperationId } from '../data/distributionRepository'
import type { DistributionViewProps } from './DistributionApp'

type ClaimChoice = 'customer' | 'sale' | 'product' | 'warehouse' | 'replacement' | null

export function ClaimsView({ data, session }: DistributionViewProps) {
  const [customerId, setCustomerId] = useState('')
  const [saleId, setSaleId] = useState('')
  const [productId, setProductId] = useState('')
  const [kind, setKind] = useState<'exchange' | 'return'>('exchange')
  const [quantity, setQuantity] = useState('1')
  const [replacementProductId, setReplacementProductId] = useState('')
  const [replacementQuantity, setReplacementQuantity] = useState('1')
  const [warehouseId, setWarehouseId] = useState('central')
  const [reason, setReason] = useState('')
  const [method, setMethod] = useState<'cash' | 'qr'>('cash')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [choice, setChoice] = useState<ClaimChoice>(null)
  const op = useRef<string | null>(null)

  const periodSales = useMemo(() => data.sales.filter(sale => !sale.pendingConfirmation && session.dayKeys.includes(sale.dayKey)), [data.sales, session.dayKeys])
  const customersWithSales = useMemo(() => data.customers.filter(customer => periodSales.some(sale => sale.customerId === customer.id)), [data.customers, periodSales])
  const customer = data.customers.find(item => item.id === customerId)
  const customerSales = periodSales.filter(sale => sale.customerId === customerId)
  const sale = customerSales.find(item => item.id === saleId)
  const line = sale?.lines.find(item => item.productId === productId)
  const replacement = data.products.find(product => product.id === replacementProductId)
  const warehouses = [{ id: 'central', name: 'Almacén central' }, ...data.warehouses.filter(warehouse => warehouse.active)]
  const replacementProducts = data.products.filter(product => product.active && data.balances.some(balance => balance.productId === product.id && balance.locationKind === 'central' && (balance.warehouseId || 'central') === warehouseId && (balance.availableQuantity ?? balance.quantity) > 0))
  const difference = (kind === 'exchange' ? (replacement?.referencePrice || 0) * Number(replacementQuantity) : 0) - (line?.actualUnitPrice || 0) * Number(quantity)
  const returnedQuantityValid = Boolean(line && Number(quantity) > 0 && Number(quantity) <= line.quantity)
  const replacementValid = kind === 'return' || Boolean(replacement && Number(replacementQuantity) > 0)
  const canSubmit = returnedQuantityValid && replacementValid && reason.trim().length > 0

  const resetOperation = () => {
    op.current = null
    setMessage('')
  }

  const clearClaim = () => {
    setCustomerId('')
    setSaleId('')
    setProductId('')
    setQuantity('1')
    setReplacementProductId('')
    setReplacementQuantity('1')
    setReason('')
    resetOperation()
  }

  const saleDescription = sale ? `${new Date(sale.createdAt).toLocaleString('es-BO')} · ${sale.lines.length} producto${sale.lines.length === 1 ? '' : 's'} · ${formatBs(sale.total)}` : undefined

  return <Screen title="Cambios y devoluciones" subtitle="Selecciona al cliente y su compra">
    <div className="grid gap-3">
      <RangePicker dayKeys={session.dayKeys} onChange={value => { session.setDayKeys(value); clearClaim() }} />

      <div className="grid grid-cols-4 gap-1.5" aria-label="Progreso del reclamo">
        {['Cliente', 'Venta', 'Producto', 'Solución'].map((label, index) => {
          const complete = [Boolean(customer), Boolean(sale), Boolean(line), canSubmit][index]
          const active = [!customer, customer && !sale, sale && !line, Boolean(line)][index]
          return <div key={label} className={`rounded-xl px-1 py-2 text-center text-[9px] font-extrabold ${complete ? 'bg-emerald-50 text-emerald-700' : active ? 'bg-[var(--primary-soft)] text-[var(--primary)]' : 'bg-slate-100 text-slate-400'}`}>{complete ? '✓ ' : ''}{label}</div>
        })}
      </div>

      <SectionCard title="1. Compra original">
        <div className="grid gap-3">
          <Field label="Cliente"><ChoiceButton placeholder="Buscar cliente con compras" label={customer?.name} description={customer ? `CI ${customer.customerCode || customer.identityNumber}` : undefined} onClick={() => setChoice('customer')} /></Field>
          <Field label="Venta"><ChoiceButton disabled={!customer} placeholder={customer ? 'Selecciona una compra' : 'Primero selecciona al cliente'} label={sale ? `Compra del ${new Date(sale.createdAt).toLocaleDateString('es-BO')}` : undefined} description={saleDescription} onClick={() => setChoice('sale')} /></Field>
          <Field label="Producto a devolver"><ChoiceButton disabled={!sale} placeholder={sale ? 'Selecciona el producto vendido' : 'Primero selecciona una compra'} label={line?.productNameSnapshot} description={line ? `Compró ${formatQty(line.quantity, line.unitType)} · ${formatBs(line.subtotal)}` : undefined} onClick={() => setChoice('product')} /></Field>
          {line && <Field label={`Cantidad devuelta (${line.unitType === 'kg' ? 'kg' : line.unitType === 'package' ? 'paquetes' : 'unidades'})`} error={Number(quantity) > line.quantity ? `No puede superar ${formatQty(line.quantity, line.unitType)}.` : undefined}><NumberInput min={0} max={line.quantity} step={line.unitType === 'kg' ? 0.01 : 1} value={quantity} onChange={event => { setQuantity(event.target.value); resetOperation() }} /></Field>}
        </div>
      </SectionCard>

      {line && <SectionCard title="2. Solución para el cliente">
        <div className="grid gap-3">
          <Field label="¿Qué se realizará?"><Segmented value={kind} options={[{ value: 'exchange', label: 'Cambiar producto' }, { value: 'return', label: 'Devolver dinero' }]} onChange={value => { setKind(value); setReplacementProductId(''); resetOperation() }} /></Field>
          <Field label="Almacén que atiende"><ChoiceButton placeholder="Selecciona almacén" label={warehouses.find(warehouse => warehouse.id === warehouseId)?.name} onClick={() => setChoice('warehouse')} /></Field>
          {kind === 'exchange' && <>
            <Field label="Producto de reemplazo"><ChoiceButton placeholder="Selecciona producto disponible" label={replacement?.name} description={replacement ? formatBs(replacement.referencePrice) : undefined} onClick={() => setChoice('replacement')} /></Field>
            {replacement && <Field label={`Cantidad entregada (${replacement.unitType === 'kg' ? 'kg' : replacement.unitType === 'package' ? 'paquetes' : 'unidades'})`}><NumberInput min={0} step={replacement.unitType === 'kg' ? 0.01 : 1} value={replacementQuantity} onChange={event => { setReplacementQuantity(event.target.value); resetOperation() }} /></Field>}
          </>}
          <Field label="Motivo" required><TextArea value={reason} onChange={event => { setReason(event.target.value); resetOperation() }} placeholder="Ej. producto mal envasado o deteriorado antes de vencer" /></Field>
          {kind === 'return' && Math.abs(difference) > 0 && <Field label="Medio para devolver el dinero"><Segmented value={method} options={[{ value: 'cash', label: 'Efectivo' }, { value: 'qr', label: 'QR / transferencia' }]} onChange={value => { setMethod(value); resetOperation() }} /></Field>}
          <div className="rounded-2xl bg-slate-50 p-3">
            <p className="text-[10px] font-extrabold uppercase text-slate-500">Resumen</p>
            <p className="mt-1 text-sm font-extrabold leading-snug text-slate-900">{formatQty(Number(quantity), line.unitType)} de {line.productNameSnapshot}</p>
            <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-slate-600"><ArrowRight size={13} />{kind === 'exchange' && replacement ? `${formatQty(Number(replacementQuantity), replacement.unitType)} de ${replacement.name}` : 'Devolución al cliente'}</p>
            <p className="mt-2 text-xs font-bold text-[var(--primary)]">{formatBs(Math.abs(difference))} {difference > 0 ? 'a cobrar' : difference < 0 ? 'a compensar o devolver' : 'sin diferencia'}</p>
          </div>
          <PrimaryButton full disabled={busy || !canSubmit} onClick={async () => {
            setBusy(true)
            op.current ||= newOperationId('claim')
            try {
              await registerClaim({ saleId, productId, kind, quantity: Number(quantity), replacementProductId, replacementQuantity: Number(replacementQuantity), warehouseId, reason, method: kind === 'return' ? method : 'none' }, op.current)
              setMessage('Reclamo registrado. Se actualizaron stock y saldo.')
              op.current = null
              setSaleId('')
              setProductId('')
            } catch (error) {
              setMessage((error as Error).message)
            } finally {
              setBusy(false)
            }
          }}>{busy ? 'Registrando...' : 'Confirmar cambio o devolución'}</PrimaryButton>
          {message && <p role="status" className={`rounded-2xl p-3 text-xs font-bold ${message.startsWith('Reclamo registrado') ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>{message}</p>}
        </div>
      </SectionCard>}

      <SectionCard title="Historial">
        <div className="grid gap-2">
          {data.claims.filter(claim => session.dayKeys.includes(claim.dayKey)).map(claim => <article key={claim.id} className="rounded-2xl border border-slate-200 p-3">
            <div className="flex items-start gap-2"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--primary-soft)] text-[var(--primary)]"><RotateCcw size={15} /></span><div className="min-w-0 flex-1"><p className="text-xs font-extrabold leading-snug text-slate-900">{claim.customerName || 'Cliente ocasional'}</p><p className="mt-0.5 text-[11px] font-semibold text-slate-600">{claim.productName} · {formatQty(claim.quantity, claim.unitType)}</p></div><CheckCircle2 size={16} className="shrink-0 text-emerald-600" /></div>
            <p className="mt-2 text-[11px] leading-snug text-slate-600">{claim.replacement ? `Cambio por ${claim.replacement.productName} (${formatQty(claim.replacement.quantity, claim.replacement.unitType)})` : 'Devolución'} · {claim.reason}</p>
            <p className="mt-1 text-[10px] text-slate-400">{new Date(claim.createdAt).toLocaleString('es-BO')} · ajuste {formatBs(claim.revenueDelta)}</p>
          </article>)}
          {!data.claims.some(claim => session.dayKeys.includes(claim.dayKey)) && <p className="py-4 text-center text-xs font-semibold text-slate-500">No hay reclamos en el período.</p>}
        </div>
      </SectionCard>
    </div>

    <ChoiceModal isOpen={choice === 'customer'} onClose={() => setChoice(null)} title="Selecciona cliente" subtitle="Solo aparecen clientes con compras en el período" searchable options={customersWithSales.map(item => ({ value: item.id, label: item.name, description: `CI ${item.customerCode || item.identityNumber || 'sin registrar'}`, trailing: `${periodSales.filter(saleItem => saleItem.customerId === item.id).length} compra(s)` }))} selectedValue={customerId} onSelect={value => { setCustomerId(value); setSaleId(''); setProductId(''); resetOperation() }} emptyLabel="No hay clientes con compras en estas fechas" />
    <ChoiceModal isOpen={choice === 'sale'} onClose={() => setChoice(null)} title={`Compras de ${customer?.name || 'cliente'}`} options={customerSales.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(item => ({ value: item.id, label: new Date(item.createdAt).toLocaleString('es-BO'), description: item.lines.map(saleLine => saleLine.productNameSnapshot).join(' · '), trailing: formatBs(item.total) }))} selectedValue={saleId} onSelect={value => { setSaleId(value); setProductId(''); resetOperation() }} />
    <ChoiceModal isOpen={choice === 'product'} onClose={() => setChoice(null)} title="Producto vendido" options={(sale?.lines || []).map(item => ({ value: item.productId, label: item.productNameSnapshot, description: `${formatQty(item.quantity, item.unitType)} vendidos a ${formatBs(item.actualUnitPrice)}`, trailing: formatBs(item.subtotal) }))} selectedValue={productId} onSelect={value => { setProductId(value); setQuantity('1'); resetOperation() }} />
    <ChoiceModal isOpen={choice === 'warehouse'} onClose={() => setChoice(null)} title="Almacén que atiende" options={warehouses.map(warehouse => ({ value: warehouse.id, label: warehouse.name }))} selectedValue={warehouseId} onSelect={value => { setWarehouseId(value); setReplacementProductId(''); resetOperation() }} />
    <ChoiceModal isOpen={choice === 'replacement'} onClose={() => setChoice(null)} title="Producto de reemplazo" subtitle="Solo se muestra mercadería disponible" searchable options={replacementProducts.map(product => ({ value: product.id, label: product.name, description: formatBs(product.referencePrice), trailing: formatQty(data.balances.find(balance => balance.productId === product.id && balance.locationKind === 'central' && (balance.warehouseId || 'central') === warehouseId)?.availableQuantity || 0, product.unitType) }))} selectedValue={replacementProductId} onSelect={value => { setReplacementProductId(value); setReplacementQuantity('1'); resetOperation() }} emptyLabel="No hay productos disponibles en este almacén" />
  </Screen>
}
