import { useMemo, useRef, useState } from 'react'
import { Plus, Printer, Search, Send, ShoppingCart, Trash2, UserPlus } from 'lucide-react'
import { Modal } from '../../../components/ui/Modal'
import { Field, NumberInput, Segmented, TextInput } from '../../../components/ui/Form'
import { EmptyBlock, Screen } from '../../../components/ui/Screen'
import {
  computeSaleTotal,
  round2,
  splitPayment,
  validateSalePayment,
  validateStockAvailability,
} from '../domain/engine'
import { newOperationId, registerSale, saveCustomer } from '../data/distributionRepository'
import { printSaleReceipt, shareSaleReceipt } from '../data/distributionReceiptService'
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

  const [directRouteId, setDirectRouteId] = useState('route-directa')
  const routeId = isDistributor ? (session.routeId ?? '') : directRouteId
  const routeName = data.routes.find((route) => route.id === routeId)?.name ?? 'Venta directa'

  const { central, route } = useStockIndex(data.balances, isDistributor ? session.routeId : null)
  const availableStock = isDistributor ? route : central

  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [editingProduct, setEditingProduct] = useState<DistProduct | null>(null)
  const [quantity, setQuantity] = useState('1')
  const [unitPrice, setUnitPrice] = useState('0')
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false)
  const [paymentKind, setPaymentKind] = useState<PaymentKind>('cash')
  const [mixedCash, setMixedCash] = useState('0')
  const [mixedQr, setMixedQr] = useState('0')
  const [customerId, setCustomerId] = useState('')
  const [customerSearch, setCustomerSearch] = useState('')
  const [isCustomerOpen, setIsCustomerOpen] = useState(false)
  const [newCustomerName, setNewCustomerName] = useState('')
  const [newCustomerPhone, setNewCustomerPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [lastSale, setLastSale] = useState<DistSale | null>(null)
  const [printState, setPrintState] = useState<{ ok: boolean; message: string } | null>(null)
  const [isPrinting, setIsPrinting] = useState(false)

  // Un id de operacion por intento de venta: evita duplicar por doble toque y
  // permite reintentar la sincronizacion sin crear una venta nueva.
  const operationIdRef = useRef<string | null>(null)

  const activeProducts = useMemo(() => data.products.filter((product) => product.active !== false), [data.products])

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
    return list.slice(0, 40)
  }, [activeProducts, search])

  const total = computeSaleTotal(cart)
  const selectedCustomer = data.customers.find((customer) => customer.id === customerId) ?? null

  const filteredCustomers = useMemo(() => {
    const term = customerSearch.trim().toLowerCase()
    const list = term ? data.customers.filter((customer) => customer.name.toLowerCase().includes(term)) : data.customers
    return list.slice(0, 30)
  }, [customerSearch, data.customers])

  const openProduct = (product: DistProduct) => {
    setError(null)
    setEditingProduct(product)
    setQuantity('1')
    setUnitPrice(String(product.referencePrice))
  }

  const addToCart = () => {
    if (!editingProduct) return
    const qty = round2(Number(quantity))
    const price = round2(Number(unitPrice))
    if (!(qty > 0)) {
      setError('La cantidad debe ser mayor a cero.')
      return
    }
    if (price < 0) {
      setError('El precio no puede ser negativo.')
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
    setPaymentKind('cash')
    setMixedCash('0')
    setMixedQr('0')
    setLastSale(null)
    setError(null)
    setPrintState(null)
    setIsCheckoutOpen(false)
    operationIdRef.current = null
  }

  const createCustomer = async () => {
    if (!newCustomerName.trim()) return
    const customer = await saveCustomer({
      name: newCustomerName,
      phone: newCustomerPhone,
      routeId: routeId || undefined,
    })
    setCustomerId(customer.id)
    setNewCustomerName('')
    setNewCustomerPhone('')
    setIsCustomerOpen(false)
  }

  const confirmSale = async () => {
    if (isSubmitting) return
    setError(null)

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
        lines: cart.map(({ lineId: _lineId, ...line }) => line),
        total,
        paymentKind,
        cashAmount: split.cashAmount,
        qrAmount: split.qrAmount,
        creditAmount: split.creditAmount,
      })

      setIsCheckoutOpen(false)
      setPrintState(null)
      setLastSale(sale)
    } catch (submitError) {
      setError((submitError as Error).message || 'No se pudo registrar la venta.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const receiptContext = {
    companyName: session.restaurantName,
    routeName,
    distributorName: session.userName,
    creditBalance: lastSale?.creditAmount,
  }

  const mixedRemainder = round2(total - (Number(mixedCash) || 0) - (Number(mixedQr) || 0))

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
            <Field label="Canal de la venta" hint="El stock se descuenta del almacen central.">
              <select
                value={directRouteId}
                onChange={(event) => setDirectRouteId(event.target.value)}
                className="min-h-[44px] w-full rounded-2xl border border-slate-200 px-3 text-sm font-bold"
              >
                {data.routes.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </Field>
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

        <div className="grid w-full min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {filteredProducts.map((product) => {
            const stock = availableStock.get(product.id) ?? 0
            return (
              <button
                key={product.id}
                type="button"
                onClick={() => openProduct(product)}
                className="flex min-h-[64px] w-full min-w-0 items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-3 text-left transition active:bg-slate-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs font-extrabold text-slate-900">{product.name}</span>
                  <span className="block truncate text-[11px] font-semibold text-slate-500">
                    {product.presentation || product.category}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-xs font-black tabular-nums" style={{ color: 'var(--primary)' }}>
                    {formatBs(product.referencePrice)}
                  </span>
                  <span className={`block text-[10px] font-bold tabular-nums ${stock > 0 ? 'text-slate-400' : 'text-rose-500'}`}>
                    {formatQty(stock, product.unitType)}
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
            <PrimaryButton onClick={() => setIsCheckoutOpen(true)}>
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
          <Field label="Precio unitario (Bs)" hint="Editable: el precio del catalogo es solo referencia.">
            <NumberInput value={unitPrice} min={0} step={0.5} onChange={(event) => setUnitPrice(event.target.value)} />
          </Field>
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
                  <p className="truncate text-xs font-extrabold text-slate-900">{line.productNameSnapshot}</p>
                  <p className="text-[11px] font-semibold text-slate-500">
                    {formatQty(line.quantity, line.unitType)} × {formatBs(line.actualUnitPrice)}
                  </p>
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

          <Field label="Forma de pago">
            <Segmented value={paymentKind} options={PAYMENT_OPTIONS} onChange={setPaymentKind} />
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

          <Field
            label="Cliente"
            hint={paymentKind === 'credit' || mixedRemainder > 0 ? 'Obligatorio cuando hay credito.' : 'Opcional en venta al contado.'}
          >
            <SecondaryButton full onClick={() => setIsCustomerOpen(true)}>
              {selectedCustomer ? selectedCustomer.name : 'Seleccionar cliente'}
            </SecondaryButton>
          </Field>

          {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
        </div>
      </Modal>

      {/* Cliente */}
      <Modal isOpen={isCustomerOpen} onClose={() => setIsCustomerOpen(false)} title="Cliente">
        <div className="grid gap-3">
          <TextInput
            value={customerSearch}
            onChange={(event) => setCustomerSearch(event.target.value)}
            placeholder="Buscar cliente por nombre..."
          />
          <div className="grid max-h-56 gap-1.5 overflow-y-auto">
            <button
              type="button"
              onClick={() => {
                setCustomerId('')
                setIsCustomerOpen(false)
              }}
              className="min-h-[44px] rounded-2xl border border-slate-200 px-3 text-left text-xs font-bold text-slate-600"
            >
              Sin cliente (venta rapida al contado)
            </button>
            {filteredCustomers.map((customer) => (
              <button
                key={customer.id}
                type="button"
                onClick={() => {
                  setCustomerId(customer.id)
                  setIsCustomerOpen(false)
                }}
                className="min-h-[44px] rounded-2xl border border-slate-200 px-3 text-left text-xs font-bold text-slate-800"
              >
                {customer.name}
                {customer.phone ? <span className="ml-2 text-slate-400">{customer.phone}</span> : null}
              </button>
            ))}
          </div>

          <div className="rounded-2xl border border-dashed border-slate-300 p-3">
            <p className="mb-2 text-[11px] font-extrabold uppercase text-slate-500">Cliente nuevo</p>
            <div className="grid gap-2">
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
              <SecondaryButton full onClick={() => void createCustomer()}>
                <UserPlus size={16} /> Crear y seleccionar
              </SecondaryButton>
            </div>
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
              disabled={isPrinting}
              onClick={() => {
                setIsPrinting(true)
                void printSaleReceipt(lastSale, receiptContext)
                  .then(setPrintState)
                  .finally(() => setIsPrinting(false))
              }}
            >
              <Printer size={16} />
              {isPrinting ? 'Imprimiendo...' : printState && !printState.ok ? 'Reintentar impresion' : 'Imprimir ticket'}
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
          </div>
        )}
      </Modal>
    </Screen>
  )
}
