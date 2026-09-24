import { submitOperation } from '../data/operationQueue'
import type { DistCreditStatus } from '../types'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Printer, Search, Send, ShoppingCart, Trash2, UserPlus } from 'lucide-react'
import { Modal } from '../../../components/ui/Modal'
import { Field, NumberInput, Segmented, TextArea, TextInput } from '../../../components/ui/Form'
import { EmptyBlock, Screen } from '../../../components/ui/Screen'
import {
  computeSaleTotal,
  round2,
  splitPayment,
  validateSalePayment,
  validateStockAvailability,
} from '../domain/engine'
import { newOperationId, registerSale, saveCustomer } from '../data/distributionRepository'
import { printLargeSaleReceipt, printSaleReceipt, shareSaleReceipt } from '../data/distributionReceiptService'
import { useStockIndex } from '../state/useDistributionStore'
import { KpiCard, PrimaryButton, SecondaryButton, formatBs, formatQty } from './shared'
import type { DistributionViewProps } from './DistributionApp'
import type { DistProduct, DistSale, DistSaleLine, PaymentKind } from '../types'

interface CartLine extends DistSaleLine {
  lineId: string
}

const PAYMENT_OPTIONS: { value: PaymentKind; label: string }[] = [
  { value: 'cash', label: 'Efectivo' },
  { value: 'qr', label: 'QR' },
  { value: 'credit', label: 'Credito' },
  { value: 'mixed', label: 'Mixto' },
]

/**
 * Venta rapida pensada para la calle: buscar, cantidad, precio editable,
 * confirmar. El precio de referencia del producto es solo el valor por
 * defecto; lo que se guarda es el precio aplicado realmente.
 */
export function SellView({ session, data }: DistributionViewProps) {
  const isDistributor = session.role === 'distributor'
  const sourceLocation = isDistributor ? 'route' : 'centralWarehouse'

  const openDispatch = useMemo(
    () => data.openDispatches.find((dispatch) => !session.routeId || dispatch.routeId === session.routeId) ?? null,
    [data.openDispatches, session.routeId],
  )

  const routeId = isDistributor ? (session.routeId ?? '') : 'administracion'
  const routeName = isDistributor ? (data.routes.find((route) => route.id === routeId)?.name ?? 'Ruta asignada') : 'Administración'

  const { central, route } = useStockIndex(data.balances, isDistributor ? session.routeId : null)
  const availableStock = isDistributor ? route : central

  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [editingProduct, setEditingProduct] = useState<DistProduct | null>(null)
  const [quantity, setQuantity] = useState('1')
  const [unitPrice, setUnitPrice] = useState('0')
  const [isPromotional, setIsPromotional] = useState(false)
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false)
  const [paymentKind, setPaymentKind] = useState<PaymentKind | ''>('')
  const [mixedCash, setMixedCash] = useState('0')
  const [mixedQr, setMixedQr] = useState('0')
  const [customerId, setCustomerId] = useState('')
  const [customerChoiceMade, setCustomerChoiceMade] = useState(false)
  const [customerSearch, setCustomerSearch] = useState('')
  const [isCustomerOpen, setIsCustomerOpen] = useState(false)
  const [newCustomerName, setNewCustomerName] = useState('')
  const [newCustomerIdentity, setNewCustomerIdentity] = useState('')
  const [newCustomerPhone, setNewCustomerPhone] = useState('')
  const [isQuickCustomerOpen, setIsQuickCustomerOpen] = useState(false)
  const [cashReceived, setCashReceived] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [lastSale, setLastSale] = useState<DistSale | null>(null)
  const [printState, setPrintState] = useState<{ ok: boolean; message: string; uncertain?: boolean } | null>(null)
  const [isPrinting, setIsPrinting] = useState(false)
  useEffect(() => {
    if (!lastSale?.pendingConfirmation) return
    const confirmed = data.sales.find(s => s.id === lastSale.id && !s.pendingConfirmation)
    if (!confirmed) return
    const update = window.setTimeout(() => { setLastSale(confirmed); setPrintState(null) }, 0)
    return () => window.clearTimeout(update)
  }, [data.sales, lastSale])

  // Un id de operacion por intento de venta: evita duplicar por doble toque y
  // permite reintentar la sincronizacion sin crear una venta nueva.
  const operationIdRef = useRef<string | null>(null)

  const activeProducts = useMemo(() => data.products.filter((product) => product.active !== false && (availableStock.get(product.id) ?? 0) > 0), [data.products, availableStock])

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase()
    const list = term
      ? activeProducts.filter(
          (product) =>
            product.name.toLowerCase().includes(term) ||
            (product.presentation || '').toLowerCase().includes(term) ||
            product.category.toLowerCase().includes(term),
        )
      : activeProducts
    return list
  }, [activeProducts, search])

  const total = computeSaleTotal(cart)
  const selectedCustomer = data.customers.find((customer) => customer.id === customerId) ?? null

  const filteredCustomers = useMemo(() => {
    const term = customerSearch.trim().toLowerCase()
    const list = term ? data.customers.filter((customer) => [customer.name, customer.customerCode, customer.identityNumber, customer.phone].join(' ').toLowerCase().includes(term)) : data.customers
    return list.filter(customer => customer.active !== false).slice(0, 30)
  }, [customerSearch, data.customers])

  const openProduct = (product: DistProduct) => {
    setError(null)
    setEditingProduct(product)
    setQuantity('1')
    setUnitPrice(String(product.referencePrice))
    setIsPromotional(false)
  }

  const addToCart = () => {
    if (!editingProduct) return
    const qty = round2(Number(quantity))
    const price = round2(Number(unitPrice))
    if (!(qty > 0)) {
      setError('La cantidad debe ser mayor a cero.')
      return
    }
    if (!(price > 0)) {
      setError('El precio debe ser mayor a cero.')
      return
    }

    setCart((current) => [
      ...current,
      {
        lineId: newOperationId('line'),
        productId: editingProduct.id,
        productNameSnapshot: editingProduct.presentation
          ? `${editingProduct.name} - ${editingProduct.presentation}`
          : editingProduct.name,
        quantity: qty,
        unitType: editingProduct.unitType,
        actualUnitPrice: price,
        referenceUnitPrice: editingProduct.referencePrice,
        isPromotional: round2(price) !== round2(editingProduct.referencePrice),
        subtotal: round2(qty * price),
      },
    ])
    setEditingProduct(null)
    setError(null)
  }

  const removeLine = (lineId: string) => {
    setCart((current) => current.filter((line) => line.lineId !== lineId))
  }

  const resetSale = () => {
    setCart([])
    setCustomerId('')
    setCustomerChoiceMade(false)
    setPaymentKind('')
    setMixedCash('0')
    setMixedQr('0')
    setCashReceived('')
    setNote('')
    setLastSale(null)
    setError(null)
    setPrintState(null)
    setIsCheckoutOpen(false)
    operationIdRef.current = null
  }

  const createCustomer = async () => {
    if (!newCustomerName.trim()) return
    try {
    const customer = await saveCustomer({
      name: newCustomerName,
      identityNumber: newCustomerIdentity,
      phone: newCustomerPhone,
      routeId: routeId || undefined,
    })
    setCustomerId(customer.id)
    setCustomerChoiceMade(true)
    setNewCustomerName('')
    setNewCustomerPhone('')
    setNewCustomerIdentity('')
    setIsCustomerOpen(false)
    setIsQuickCustomerOpen(false)
    setIsCheckoutOpen(true)
    } catch (err) { setError((err as Error).message) }
  }

  const confirmSale = async () => {
    if (isSubmitting) return
    setError(null)

    if (!customerChoiceMade) {
      setError('Selecciona un cliente o la opción Sin cliente antes de cobrar.')
      return
    }
    if (!paymentKind) {
      setError('Selecciona una forma de pago.')
      return
    }
    if (!customerId && paymentKind === 'credit') {
      setError('Sin cliente no se permite vender a crédito.')
      return
    }

    if (selectedCustomer) {
      let credit = data.creditStatus.find(c => c.id === selectedCustomer.id)
      if (!selectedCustomer.identityNumber) { setError('Completa el CI del cliente antes de vender.'); return }
      if (!credit) {
        setIsSubmitting(true)
        try { credit = await submitOperation<DistCreditStatus>('creditStatus', { customerId:selectedCustomer.id }, newOperationId('credit-status')) }
        catch (e) { setError((e as Error).message); return }
        finally { setIsSubmitting(false) }
      }
      // Se evalúa al confirmar, no durante el render de React.
      // eslint-disable-next-line react-hooks/purity
      const blockDays = data.supportSettings.creditBlockDays
      if (credit.oldestPendingAt && Date.parse(credit.oldestPendingAt) + blockDays * 86400000 <= Date.now()) { setError(`Venta bloqueada: el cliente tiene créditos pendientes de ${blockDays} días o más.`); return }
    }
    if (cart.length === 0) {
      setError('Agrega al menos un producto.')
      return
    }
    if (isDistributor && !openDispatch) {
      setError('Tu ruta no tiene un despacho abierto. Pide a almacen que registre tu carga.')
      return
    }

    const cashInput = round2(Number(mixedCash) || 0)
    const qrInput = round2(Number(mixedQr) || 0)
    const split = splitPayment(total, paymentKind, {
      cashAmount: cashInput,
      qrAmount: qrInput,
      creditAmount: round2(total - cashInput - qrInput),
    })

    const paymentError = validateSalePayment(total, split)
    if (paymentError) {
      setError(paymentError)
      return
    }
    if (split.creditAmount > 0 && !customerId) {
      setError('Una venta con credito necesita cliente.')
      return
    }
    if (paymentKind === 'cash' && !cashReceived.trim()) {
      setError('Ingresa el efectivo recibido para calcular el cambio.')
      return
    }
    if (paymentKind === 'cash' && (!Number.isFinite(Number(cashReceived)) || round2(Number(cashReceived)) < total)) {
      setError('El efectivo recibido debe ser igual o mayor al total de la venta.')
      return
    }

    const stockError = validateStockAvailability(
      cart.map((line) => ({
        productId: line.productId,
        productName: line.productNameSnapshot,
        quantity: line.quantity,
        unitType: line.unitType,
      })),
      availableStock,
    )
    if (stockError) {
      setError(stockError)
      return
    }

    setIsSubmitting(true)
    try {
      if (!operationIdRef.current) operationIdRef.current = newOperationId('sale')

      const sale = await registerSale({
        operationId: operationIdRef.current,
        sourceLocation,
        routeId,
        routeName,
        sellerUid: session.uid,
        sellerName: session.userName,
        dispatchId: openDispatch?.id,
        customerId: customerId || undefined,
        customerName: selectedCustomer?.name,
        customerCode: selectedCustomer?.customerCode || selectedCustomer?.identityNumber,
        lines: cart.map(line => ({ productId: line.productId, productNameSnapshot: line.productNameSnapshot, quantity: line.quantity, unitType: line.unitType, actualUnitPrice: line.actualUnitPrice, referenceUnitPrice: line.referenceUnitPrice, isPromotional: line.isPromotional, subtotal: line.subtotal })),
        total,
        paymentKind,
        cashAmount: split.cashAmount,
        qrAmount: split.qrAmount,
        creditAmount: split.creditAmount,
        cashReceived: paymentKind === 'cash' ? round2(Number(cashReceived)) : split.cashAmount,
        changeAmount: paymentKind === 'cash' ? round2(Math.max(0, Number(cashReceived) - total)) : 0,
        note: note.trim(),
      })

      setIsCheckoutOpen(false)
      setCart([])
      operationIdRef.current = null
      setPrintState(sale.pendingConfirmation ? { ok: false, message: 'Venta pendiente de confirmación al sincronizar. Revisa Operaciones pendientes.' } : null)
      setLastSale(sale)
    } catch (submitError) {
      if ((submitError as {rejected?: boolean}).rejected) operationIdRef.current = null
      setError((submitError as Error).message || 'No se pudo registrar la venta.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const receiptContext = {
    companyName: data.supportSettings.companyName || session.restaurantName,
    receiptHeader: data.supportSettings.receiptHeader,
    receiptFooter: data.supportSettings.receiptFooter,
    taxId: data.supportSettings.taxId,
    address: data.supportSettings.address,
    phone: data.supportSettings.phone,
    routeName,
    distributorName: session.userName,
    creditBalance: lastSale?.creditAmount,
  }

  const mixedRemainder = round2(total - (Number(mixedCash) || 0) - (Number(mixedQr) || 0))
  const changeAmount = paymentKind === 'cash' ? round2(Math.max(0, (Number(cashReceived) || 0) - total)) : 0

  return (
    <Screen
      title="Vender"
      subtitle={
        isDistributor
          ? openDispatch
            ? `Ruta ${routeName} · despacho abierto`
            : 'Sin despacho abierto'
          : 'Venta directa desde almacen central'
      }
    >
      <div className="flex w-full min-w-0 flex-col gap-3">
        {!isDistributor && (
          <div className="w-full rounded-2xl border border-slate-200 bg-white p-3">
            <Field label="Canal de la venta" hint="Las ventas administrativas no se atribuyen a ninguna zona ni distribuidor."><div className="rounded-2xl border-2 border-slate-300 bg-slate-50 px-3.5 py-3 text-sm font-extrabold text-slate-800">Administración</div></Field>
          </div>
        )}

        {isDistributor && !openDispatch && (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
            Tu ruta no tiene despacho abierto: no se pueden registrar ventas todavia.
          </p>
        )}

        <div className="relative w-full">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <TextInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar producto..."
            className="pl-9"
          />
        </div>

        <div className="grid w-full min-w-0 grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
          {filteredProducts.map((product) => {
            const stock = availableStock.get(product.id) ?? 0
            return (
              <button
                key={product.id}
                type="button"
                onClick={() => openProduct(product)}
                className="flex min-h-[116px] w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition active:scale-[0.99] active:bg-slate-50"
              >
                {product.photoDataUrl && <img src={product.photoDataUrl} alt={`Foto de ${product.name}`} onError={(event) => { event.currentTarget.style.display = 'none' }} className="aspect-[16/9] w-full object-cover" />}
                <span className="flex min-w-0 flex-1 flex-col justify-between gap-2 p-3">
                  <span className="block text-xs font-extrabold leading-snug text-slate-900">{product.name}</span>
                  <span className="flex flex-wrap items-end justify-between gap-1">
                    <span className={`text-[10px] font-bold tabular-nums ${stock > 0 ? 'text-slate-500' : 'text-rose-600'}`}>
                      {stock > 0 ? `${formatQty(stock, product.unitType)} disponibles` : 'Sin existencia'}
                    </span>
                    <span className="text-xs font-black tabular-nums" style={{ color: 'var(--primary)' }}>
                    {formatBs(product.referencePrice)}
                    </span>
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        {filteredProducts.length === 0 && (
          <EmptyBlock title="Sin productos" description="Revisa el catalogo o el termino de busqueda." />
        )}

        {/* Espacio para que la barra de carrito no tape el ultimo producto */}
        {cart.length > 0 && <div className="h-20" aria-hidden />}
      </div>

      {cart.length > 0 && (
        <div
          className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white px-3 py-2.5"
          style={{ paddingBottom: 'calc(0.625rem + var(--safe-bottom) + var(--bottom-nav-height))' }}
        >
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-extrabold uppercase text-slate-500">
                {cart.length} linea{cart.length > 1 ? 's' : ''}
              </p>
              <p className="truncate text-lg font-black tabular-nums text-slate-900">{formatBs(total)}</p>
            </div>
            <PrimaryButton onClick={() => { setError(null); setIsCustomerOpen(true) }}>
              <ShoppingCart size={16} /> Cobrar
            </PrimaryButton>
          </div>
        </div>
      )}

      {/* Cantidad y precio */}
      <Modal
        isOpen={Boolean(editingProduct)}
        onClose={() => setEditingProduct(null)}
        title={editingProduct?.name ?? ''}
        subtitle={editingProduct?.presentation}
        footer={
          <PrimaryButton full onClick={addToCart}>
            <Plus size={16} /> Agregar {formatBs(round2(Number(quantity) * Number(unitPrice)))}
          </PrimaryButton>
        }
      >
        <div className="grid gap-3">
          <Field
            label={editingProduct?.unitType === 'kg' ? 'Cantidad (kg)' : 'Cantidad'}
            hint={`Disponible: ${formatQty(availableStock.get(editingProduct?.id ?? '') ?? 0, editingProduct?.unitType ?? 'unit')}`}
          >
            <NumberInput
              value={quantity}
              min={0}
              step={editingProduct?.unitType === 'kg' ? 0.1 : 1}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </Field>
          <Field
            label={editingProduct?.unitType === 'kg' ? 'Precio por kilo (Bs)' : 'Precio unitario (Bs)'}
            hint={isDistributor ? (isPromotional ? 'Precio promocional: quedará destacado y se conservará el precio original.' : 'Precio oficial definido por Administración.') : 'Administración puede modificar el precio.'}
          >
            <NumberInput disabled={isDistributor && !isPromotional} value={unitPrice} min={0} step={0.5} onChange={(event) => setUnitPrice(event.target.value)} />
          </Field>
          {isDistributor && <button type="button" onClick={() => { const next = !isPromotional; setIsPromotional(next); if (!next && editingProduct) setUnitPrice(String(editingProduct.referencePrice)) }} className={`min-h-[44px] rounded-2xl border-2 px-3 text-xs font-black ${isPromotional ? 'border-amber-500 bg-amber-50 text-amber-800' : 'border-slate-300 bg-white text-slate-700'}`}>VENTA PROMOCIONAL {isPromotional ? 'ACTIVADA' : ''}</button>}

          {/* En granel el calculo tiene que estar a la vista: se pesa y se cobra. */}
          <div className="flex items-center justify-between gap-2 rounded-2xl bg-slate-50 px-3 py-2.5">
            <span className="text-[11px] font-bold text-slate-500">
              {round2(Number(quantity) || 0)}
              {editingProduct?.unitType === 'kg' ? ' kg' : editingProduct?.unitType === 'package' ? ' paq' : ' u'} ×{' '}
              {formatBs(round2(Number(unitPrice) || 0))}
            </span>
            <span className="text-base font-black tabular-nums text-slate-900">
              {formatBs(round2((Number(quantity) || 0) * (Number(unitPrice) || 0)))}
            </span>
          </div>

          {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
        </div>
      </Modal>

      {/* Cobro */}
      <Modal
        isOpen={isCheckoutOpen}
        onClose={() => setIsCheckoutOpen(false)}
        title="Cobrar venta"
        subtitle={formatBs(total)}
        footer={
          <PrimaryButton full disabled={isSubmitting} onClick={() => void confirmSale()}>
            {isSubmitting ? 'Registrando...' : `Confirmar ${formatBs(total)}`}
          </PrimaryButton>
        }
      >
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            {cart.map((line) => (
              <div key={line.lineId} className="flex items-center justify-between gap-2 rounded-2xl bg-slate-50 px-3 py-2">
                <div className="min-w-0">
                  <p className="break-words text-xs font-extrabold text-slate-900">{line.productNameSnapshot}</p>
                  <p className="text-[11px] font-semibold text-slate-500">
                    {formatQty(line.quantity, line.unitType)} × {formatBs(line.actualUnitPrice)}
                  </p>
                  {line.isPromotional && <p className="text-[10px] font-black text-amber-700">PRECIO PROMOCIONAL · original {formatBs(line.referenceUnitPrice || line.actualUnitPrice)}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs font-black tabular-nums text-slate-900">{formatBs(line.subtotal)}</span>
                  <button
                    type="button"
                    onClick={() => removeLine(line.lineId)}
                    aria-label="Quitar linea"
                    className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-white hover:text-rose-600"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 px-3 py-2.5">
            <p className="text-[10px] font-extrabold uppercase text-emerald-700">Cliente seleccionado</p>
            <div className="mt-1 flex items-center justify-between gap-2">
              <p className="min-w-0 break-words text-xs font-black text-emerald-950">{selectedCustomer ? selectedCustomer.name : 'Sin cliente · venta rápida'}</p>
              <button type="button" className="shrink-0 text-[11px] font-extrabold text-emerald-800 underline" onClick={() => { setIsCheckoutOpen(false); setIsCustomerOpen(true) }}>Cambiar</button>
            </div>
          </div>

          <Field label="Forma de pago" required hint={!customerId ? 'Sin cliente permite efectivo, QR o mixto, siempre al contado.' : 'Selecciona una opción para continuar.'}>
            <Segmented value={paymentKind} options={customerId ? PAYMENT_OPTIONS : PAYMENT_OPTIONS.filter(option => option.value !== 'credit')} onChange={setPaymentKind} />
          </Field>

          {paymentKind === 'mixed' && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Efectivo (Bs)">
                <NumberInput value={mixedCash} min={0} onChange={(event) => setMixedCash(event.target.value)} />
              </Field>
              <Field label="QR (Bs)">
                <NumberInput value={mixedQr} min={0} onChange={(event) => setMixedQr(event.target.value)} />
              </Field>
              <p className="text-[11px] font-bold text-slate-500 sm:col-span-2">
                Resto a credito: {formatBs(Math.max(0, mixedRemainder))}
                {mixedRemainder < 0 ? ' (el desglose supera el total)' : ''}
              </p>
            </div>
          )}
          {paymentKind === 'cash' && <div className="grid grid-cols-2 gap-2"><Field label="Efectivo recibido (Bs)"><NumberInput value={cashReceived} min={0} placeholder={String(total)} onChange={event => setCashReceived(event.target.value)} /></Field><div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-3"><p className="text-[10px] font-extrabold uppercase text-emerald-700">Cambio a devolver</p><p className="mt-1 text-lg font-black text-emerald-800">{formatBs(changeAmount)}</p></div></div>}
          <Field label="Observaciones" hint="Se guarda con la venta, pero no aparecerá en el ticket."><TextArea value={note} onChange={event => setNote(event.target.value)} /></Field>

          {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
        </div>
      </Modal>

      {/* Cliente */}
      <Modal isOpen={isCustomerOpen} onClose={() => setIsCustomerOpen(false)} title="Seleccionar cliente" subtitle="Paso 1 de 2 · elige una opción para continuar" size="lg">
        <div className="grid gap-3">
          <div className="relative rounded-2xl bg-sky-50"><Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sky-700" /><TextInput value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Buscar por nombre, código o carnet..." className="border-2 border-sky-300 bg-sky-50 pl-10" /></div>
          <div className="grid max-h-[52dvh] gap-2 overflow-y-auto pr-1">
            <button
              type="button"
              onClick={() => {
                setCustomerId('')
                setCustomerChoiceMade(true)
                setPaymentKind('')
                setIsCustomerOpen(false)
                setIsCheckoutOpen(true)
              }}
              className="min-h-[52px] rounded-2xl border-2 border-slate-300 bg-slate-50 px-3 py-2 text-left text-xs font-bold leading-snug text-slate-700"
            >
              Sin cliente (venta rapida al contado)
            </button>
            {filteredCustomers.map((customer) => (
              <button
                key={customer.id}
                type="button"
                onClick={() => {
                  setCustomerId(customer.id)
                  setCustomerChoiceMade(true)
                  setPaymentKind('')
                  setIsCustomerOpen(false)
                  setIsCheckoutOpen(true)
                }}
                className={`min-h-[52px] rounded-2xl border-2 px-3 py-2 text-left text-xs font-bold leading-snug ${customer.id === customerId ? 'border-emerald-500 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-white text-slate-800'}`}
              >
                <span className="block break-words text-sm font-extrabold">{customer.name}</span>
                <span className="mt-0.5 block break-words text-[11px] text-slate-500">{customer.customerCode || customer.identityNumber || 'CI pendiente'}{customer.phone ? ` · ${customer.phone}` : ''}</span>
              </button>
            ))}
          </div>

          <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-3">
            <button type="button" onClick={() => setIsQuickCustomerOpen(value => !value)} className="flex min-h-[40px] w-full items-center justify-between text-left text-[11px] font-extrabold uppercase text-amber-900"><span>Registrar cliente rápido</span>{isQuickCustomerOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</button>
            {isQuickCustomerOpen && <div className="mt-2 grid gap-2">
              <TextInput
                value={newCustomerName}
                onChange={(event) => setNewCustomerName(event.target.value)}
                placeholder="Nombre"
              />
              <TextInput
                value={newCustomerPhone}
                onChange={(event) => setNewCustomerPhone(event.target.value)}
                placeholder="Telefono (opcional)"
              />
              <TextInput value={newCustomerIdentity} onChange={e => setNewCustomerIdentity(e.target.value)} placeholder="CI / código del cliente" />
              {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
              <SecondaryButton full onClick={() => void createCustomer()}>
                <UserPlus size={16} /> Crear y seleccionar
              </SecondaryButton>
            </div>}
          </div>
        </div>
      </Modal>

      {/* Venta confirmada */}
      <Modal
        isOpen={Boolean(lastSale)}
        onClose={resetSale}
        title="Venta registrada"
        subtitle={lastSale ? formatBs(lastSale.total) : ''}
        footer={
          <PrimaryButton full onClick={resetSale}>
            <Plus size={16} /> Nueva venta
          </PrimaryButton>
        }
      >
        {lastSale && (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-2">
              <KpiCard label="Total" value={formatBs(lastSale.total)} tone="primary" />
              <KpiCard
                label={lastSale.creditAmount > 0 ? 'Saldo generado' : 'Cobrado'}
                value={formatBs(lastSale.creditAmount > 0 ? lastSale.creditAmount : lastSale.total)}
                tone={lastSale.creditAmount > 0 ? 'warning' : 'positive'}
              />
            </div>
            {/* Un fallo de impresion no revierte ni duplica la venta: solo se reintenta. */}
            <SecondaryButton
              full
              disabled={isPrinting || lastSale.pendingConfirmation}
              onClick={() => {
                setIsPrinting(true)
                void printSaleReceipt(lastSale, receiptContext, Boolean(printState?.ok || printState?.uncertain))
                  .then(setPrintState)
                  .finally(() => setIsPrinting(false))
              }}
            >
              <Printer size={16} />
              {isPrinting ? 'Imprimiendo...' : printState?.uncertain ? 'Imprimir copia (revisa el papel)' : printState?.ok ? 'Imprimir copia' : printState ? 'Reintentar impresion' : 'Imprimir ticket'}
            </SecondaryButton>

            {printState && (
              <p
                className={`rounded-2xl px-3 py-2 text-[11px] font-bold ${
                  printState.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'
                }`}
              >
                {printState.message}
              </p>
            )}
            <SecondaryButton full onClick={() => void shareSaleReceipt(lastSale, receiptContext)}>
              <Send size={16} /> Compartir por WhatsApp
            </SecondaryButton>
            {session.role === 'admin' && <SecondaryButton full onClick={() => printLargeSaleReceipt(lastSale, receiptContext)}><Printer size={16} /> Imprimir en hoja normal</SecondaryButton>}
          </div>
        )}
      </Modal>
    </Screen>
  )
}
