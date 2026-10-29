import { submitOperation } from '../data/operationQueue'
import type { DistCreditStatus } from '../types'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  History,
  Minus,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react'
import { Modal } from '../../../components/ui/Modal'
import { ChoiceModal } from '../../../components/ui/ChoiceModal'
import { Field, NumberInput, Segmented, TextArea, TextInput } from '../../../components/ui/Form'
import { EmptyBlock, Screen } from '../../../components/ui/Screen'
import {
  computeSaleTotal,
  round2,
  splitPayment,
  validateSalePayment,
  validateStockAvailability,
} from '../domain/engine'
import { correctSale, newOperationId, registerSale, saveCustomer, voidSale } from '../data/distributionRepository'
import { printLargeSaleReceipt, printSaleReceipt, shareSaleReceipt } from '../data/distributionReceiptService'
import { useStockIndex } from '../state/useDistributionStore'
import { KpiCard, PrimaryButton, SecondaryButton, formatBs, formatQty } from './shared'
import type { DistributionViewProps } from './DistributionApp'
import type { DistProduct, DistSale, DistSaleLine, PaymentKind, UnitType } from '../types'
import { getProductPresentation } from '../domain/productPresentation'
import {
  checkSaleCorrectionAvailability,
  getSaleAuditSummary,
} from '../domain/saleCorrectionAudit'

interface CartLine extends DistSaleLine {
  lineId: string
}

function roundSaleQuantity(value: number, unitType: UnitType): number {
  const precision = unitType === 'kg' ? 3 : 2
  const factor = 10 ** precision
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function parseSaleQuantity(value: string, unitType: UnitType): number {
  const normalized = value.trim().replace(',', '.')
  const parsed = normalized ? Number(normalized) : 0
  return Number.isFinite(parsed) ? roundSaleQuantity(parsed, unitType) : 0
}

function hasValidQuantityPrecision(value: string, unitType: UnitType): boolean {
  const normalized = value.trim().replace(',', '.')
  return unitType === 'kg'
    ? /^\d+(?:\.\d{1,3})?$/.test(normalized)
    : /^\d+$/.test(normalized)
}

function saleLinePhysicalQuantity(line: DistSaleLine): number {
  return Number(line.physicalQuantity ?? (line.allocations?.length ? line.allocations.reduce((sum, allocation) => sum + Number(allocation.quantity || 0), 0) : line.quantity))
}

const PAYMENT_OPTIONS: { value: PaymentKind; label: string }[] = [
  { value: 'cash', label: 'Efectivo' },
  { value: 'qr', label: 'QR' },
  { value: 'credit', label: 'Credito' },
  { value: 'mixed', label: 'Mixto' },
]

function SaleStepIndicator({ currentStep }: { currentStep: 1 | 2 | 3 }) {
  return (
    <div className="mx-auto mb-3 flex w-full max-w-sm select-none items-center justify-between gap-1 rounded-2xl bg-slate-100 p-1 text-[11px] font-black">
      <div
        className={`flex items-center gap-1 rounded-xl px-2.5 py-1 transition ${
          currentStep === 1
            ? 'bg-[var(--primary)] text-white shadow-xs'
            : 'text-slate-500'
        }`}
      >
        <span>1</span>
        <span>Productos</span>
      </div>
      <ChevronRight size={13} className="shrink-0 text-slate-400" />
      <div
        className={`flex items-center gap-1 rounded-xl px-2.5 py-1 transition ${
          currentStep === 2
            ? 'bg-[var(--primary)] text-white shadow-xs'
            : 'text-slate-500'
        }`}
      >
        <span>2</span>
        <span>Cliente</span>
      </div>
      <ChevronRight size={13} className="shrink-0 text-slate-400" />
      <div
        className={`flex items-center gap-1 rounded-xl px-2.5 py-1 transition ${
          currentStep === 3
            ? 'bg-[var(--primary)] text-white shadow-xs'
            : 'text-slate-500'
        }`}
      >
        <span>3</span>
        <span>Pago</span>
      </div>
    </div>
  )
}

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
  const [quantity, setQuantity] = useState('0')
  const [physicalQuantity, setPhysicalQuantity] = useState('0')
  const [unitPrice, setUnitPrice] = useState('0')
  const [isPromotional, setIsPromotional] = useState(false)
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false)
  const [saleMode, setSaleMode] = useState<'sale' | 'courtesy'>('sale')
  const [courtesyReason, setCourtesyReason] = useState('')
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
  const [isSharing, setIsSharing] = useState(false)
  const [shareFeedback, setShareFeedback] = useState('')
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [historySearch, setHistorySearch] = useState('')
  const [historyKind, setHistoryKind] = useState<'all' | 'sale' | 'courtesy'>('all')
  const [correctionTarget, setCorrectionTarget] = useState<DistSale | null>(null)
  const [correctionQuantities, setCorrectionQuantities] = useState<Record<string, string>>({})
  const [correctionPhysicalQuantities, setCorrectionPhysicalQuantities] = useState<Record<string, string>>({})
  const [correctionPhysicalTouched, setCorrectionPhysicalTouched] = useState<Record<string, boolean>>({})
  const [correctionPrices, setCorrectionPrices] = useState<Record<string, string>>({})
  const [correctionReason, setCorrectionReason] = useState('')
  const [correctionSearch, setCorrectionSearch] = useState('')
  const [correctionAddedProductIds, setCorrectionAddedProductIds] = useState<string[]>([])
  const [isAddProductPickerOpen, setIsAddProductPickerOpen] = useState(false)
  const [correctionPaymentKind, setCorrectionPaymentKind] = useState<PaymentKind>('cash')
  const [correctionCashAmount, setCorrectionCashAmount] = useState<string>('0')
  const [correctionQrAmount, setCorrectionQrAmount] = useState<string>('0')
  const [correctionCreditAmount, setCorrectionCreditAmount] = useState<string>('0')
  const [isReviewingCorrection, setIsReviewingCorrection] = useState(false)
  const [productPendingRemoval, setProductPendingRemoval] = useState<DistProduct | null>(null)
  const [correctionSuccessMessage, setCorrectionSuccessMessage] = useState<string | null>(null)
  const [voidTarget, setVoidTarget] = useState<DistSale | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [voidScenario, setVoidScenario] = useState<'recorded_in_error_never_delivered' | 'delivered_then_returned' | ''>('')
  const [voidCustodyConfirmed, setVoidCustodyConfirmed] = useState(false)
  const [voidCashRefundConfirmed, setVoidCashRefundConfirmed] = useState(false)
  const [voidQrRefundConfirmed, setVoidQrRefundConfirmed] = useState(false)
  const [voidQrRefundReference, setVoidQrRefundReference] = useState('')
  const [auditInspectingSale, setAuditInspectingSale] = useState<DistSale | null>(null)
  const [nowMs] = useState(() => Date.now())
  const voidSnapshot = voidTarget?.effectiveSnapshot ?? voidTarget
  const voidCashAmount = Number(voidSnapshot?.cashAmount ?? voidTarget?.cashAmount ?? 0)
  const voidQrAmount = Number(voidSnapshot?.qrAmount ?? voidTarget?.qrAmount ?? 0)
  const voidCreditAmount = Number(voidSnapshot?.creditAmount ?? voidTarget?.creditAmount ?? 0)
  const voidTotal = Number(voidSnapshot?.total ?? voidTarget?.total ?? 0)

  // Validación de stock en tiempo real del carrito
  const cartStockValidation = useMemo(() => {
    const totals = new Map<string, { name: string; qty: number; unitType: UnitType }>()
    for (const line of cart) {
      const cur = totals.get(line.productId)
      totals.set(line.productId, {
        name: line.productNameSnapshot,
        qty: roundSaleQuantity((cur?.qty ?? 0) + (line.physicalQuantity ?? line.quantity), line.unitType),
        unitType: line.unitType,
      })
    }
    for (const [productId, entry] of totals) {
      const stock = roundSaleQuantity(availableStock.get(productId) ?? 0, entry.unitType)
      if (entry.qty > stock) {
        return {
          isValid: false,
          productId,
          productName: entry.name,
          requested: entry.qty,
          available: stock,
          unitType: entry.unitType,
          message: `Stock insuficiente ${isDistributor ? 'en tu ruta' : 'en almacén central'} para ${entry.name}: disponible ${formatQty(stock, entry.unitType)}, necesario para entregar ${formatQty(entry.qty, entry.unitType)}.`,
        }
      }
    }
    return {
      isValid: true,
      productId: null,
      productName: null,
      requested: 0,
      available: 0,
      unitType: null,
      message: null,
    }
  }, [cart, availableStock, isDistributor])
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
  const historySales = useMemo(() => { const term = historySearch.trim().toLowerCase(); return data.sales.filter(sale => historyKind === 'all' || (historyKind === 'courtesy' ? sale.saleKind === 'courtesy' : sale.saleKind !== 'courtesy')).filter(sale => !term || [sale.customerName, sale.sellerName, sale.routeName, ...sale.lines.map(line => line.productNameSnapshot)].join(' ').toLowerCase().includes(term)).sort((a,b) => b.createdAt.localeCompare(a.createdAt)) }, [data.sales, historySearch, historyKind])

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

  const total = saleMode === 'courtesy' ? 0 : computeSaleTotal(cart)
  const courtesyReferenceTotal = round2(cart.reduce((sum, line) => sum + line.quantity * (line.referenceUnitPrice || line.actualUnitPrice), 0))
  const selectedCustomer = data.customers.find((customer) => customer.id === customerId) ?? null

  const filteredCustomers = useMemo(() => {
    const term = customerSearch.trim().toLowerCase()
    const list = term ? data.customers.filter((customer) => [customer.name, customer.customerCode, customer.identityNumber, customer.phone].join(' ').toLowerCase().includes(term)) : data.customers
    return list.filter(customer => customer.active !== false).slice(0, 30)
  }, [customerSearch, data.customers])

  const openProduct = (product: DistProduct) => {
    setError(null)
    setEditingProduct(product)
    setQuantity('0')
    setPhysicalQuantity('0')
    setUnitPrice(String(product.referencePrice))
    setIsPromotional(false)
  }

  const addToCart = () => {
    if (!editingProduct) return
    const qty = roundSaleQuantity(Number(quantity), editingProduct.unitType)
    const physicalQty = !isDistributor && editingProduct.unitType === 'kg' ? roundSaleQuantity(Number(physicalQuantity), editingProduct.unitType) : qty
    const price = round2(Number(unitPrice))
    if (!(qty > 0)) {
      setError('La cantidad debe ser mayor a cero.')
      return
    }
    if (!(price > 0)) {
      setError('El precio debe ser mayor a cero.')
      return
    }
    if (!Number.isFinite(physicalQty) || physicalQty < qty) {
      setError('El peso entregado debe ser igual o mayor que la cantidad cobrada.')
      return
    }

    const currentStock = round2(availableStock.get(editingProduct.id) ?? 0)
    const existingInCart = cart
      .filter((l) => l.productId === editingProduct.id)
      .reduce((sum, l) => sum + (l.physicalQuantity ?? l.quantity), 0)
    const totalRequested = roundSaleQuantity(existingInCart + physicalQty, editingProduct.unitType)
    if (totalRequested > currentStock) {
      setError(
        `Stock insuficiente ${isDistributor ? 'en tu ruta' : 'en almacén central'}. Disponible: ${formatQty(currentStock, editingProduct.unitType)}, necesario para entregar: ${formatQty(totalRequested, editingProduct.unitType)}.`,
      )
      return
    }

    setCart((current) => [
      ...current,
      {
        lineId: newOperationId('line'),
        productId: editingProduct.id,
        productNameSnapshot: editingProduct.name,
        presentationSnapshot: getProductPresentation(editingProduct),
        descriptionSnapshot: editingProduct.description || '',
        quantity: qty,
        ...(physicalQty > qty ? { physicalQuantity: physicalQty, excessWeightQuantity: roundSaleQuantity(physicalQty - qty, editingProduct.unitType) } : {}),
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
    setSaleMode('sale')
    setCourtesyReason('')
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

    const isCourtesy = saleMode === 'courtesy'
    if (!customerChoiceMade) {
      setError('Selecciona un cliente o la opción Sin cliente antes de cobrar.')
      return
    }
    if (!isCourtesy && !paymentKind) {
      setError('Selecciona una forma de pago.')
      return
    }
    if (!isCourtesy && !customerId && paymentKind === 'credit') {
      setError('Sin cliente no se permite vender a crédito.')
      return
    }

    if (selectedCustomer && !isCourtesy) {
      let credit = data.creditStatus.find(c => c.id === selectedCustomer.id)
      if (!selectedCustomer.identityNumber) { setError('Completa el CI del cliente antes de vender.'); return }
      // Si falta el último estado local, no se consulta al servidor como
      // requisito previo de una venta al contado/QR: la falta de red no debe
      // congelar la venta. Para crédito sí se exige verificación explícita.
      if (!credit && paymentKind === 'credit') {
        setIsSubmitting(true)
        try { credit = await submitOperation<DistCreditStatus>('creditStatus', { customerId:selectedCustomer.id }, newOperationId('credit-status'), undefined, 3000) }
        catch (e) { setError(`No se pudo verificar el estado de crédito del cliente. La venta a crédito no se autorizó por seguridad. ${(e as Error).message}`); return }
        finally { setIsSubmitting(false) }
      }
      // Se evalúa al confirmar, no durante el render de React.
      const blockDays = data.supportSettings.creditBlockDays
      // La validación ocurre dentro del evento Confirmar, no durante el render.
      const override = data.creditOverrides.find(item => item.customerId === selectedCustomer.id && !item.revokedAt && Date.parse(item.activeUntil) > Date.now())
      // eslint-disable-next-line react-hooks/purity
      if (credit && !override && credit.oldestPendingAt && Date.parse(credit.oldestPendingAt) + blockDays * 86400000 <= Date.now()) { setError(`Venta bloqueada: el cliente tiene créditos pendientes de ${blockDays} días o más.`); return }
    }
    if (cart.length === 0) {
      setError('Agrega al menos un producto.')
      return
    }
    if (isCourtesy && !courtesyReason.trim()) { setError('Indica el motivo de la cortesía.'); return }
    if (isDistributor && !openDispatch) {
      setError('Tu ruta no tiene un despacho abierto. Pide a almacen que registre tu carga.')
      return
    }

    const cashInput = round2(Number(mixedCash) || 0)
    const qrInput = round2(Number(mixedQr) || 0)
    const split = isCourtesy ? { cashAmount: 0, qrAmount: 0, creditAmount: 0 } : splitPayment(total, paymentKind || 'cash', {
      cashAmount: cashInput,
      qrAmount: qrInput,
      creditAmount: round2(total - cashInput - qrInput),
    })

    const paymentError = isCourtesy ? null : validateSalePayment(total, split)
    if (paymentError) {
      setError(paymentError)
      return
    }
    if (!isCourtesy && split.creditAmount > 0 && !customerId) {
      setError('Una venta con credito necesita cliente.')
      return
    }
    if (!isCourtesy && paymentKind === 'cash' && !cashReceived.trim()) {
      setError('Ingresa el efectivo recibido para calcular el cambio.')
      return
    }
    if (!isCourtesy && paymentKind === 'cash' && (!Number.isFinite(Number(cashReceived)) || round2(Number(cashReceived)) < total)) {
      setError('El efectivo recibido debe ser igual o mayor al total de la venta.')
      return
    }

    const stockError = validateStockAvailability(
      cart.map((line) => ({
        productId: line.productId,
        productName: line.productNameSnapshot,
        quantity: line.physicalQuantity ?? line.quantity,
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
        // Una venta de Administración sale del almacén central y no pertenece
        // al despacho abierto que pueda estar visible en paralelo.
        dispatchId: isDistributor ? openDispatch?.id : undefined,
        customerId: customerId || undefined,
        customerName: selectedCustomer?.name,
        customerCode: selectedCustomer?.customerCode || selectedCustomer?.identityNumber,
        lines: cart.map(line => ({ productId: line.productId, productNameSnapshot: line.productNameSnapshot, presentationSnapshot: line.presentationSnapshot, descriptionSnapshot: line.descriptionSnapshot, quantity: line.quantity, ...(line.physicalQuantity !== undefined ? { physicalQuantity: line.physicalQuantity } : {}), unitType: line.unitType, actualUnitPrice: isCourtesy ? (line.referenceUnitPrice || line.actualUnitPrice) : line.actualUnitPrice, referenceUnitPrice: line.referenceUnitPrice, isPromotional: isCourtesy ? false : line.isPromotional, subtotal: isCourtesy ? 0 : line.subtotal, ...(isCourtesy ? { referenceSubtotal: round2(line.quantity * (line.referenceUnitPrice || line.actualUnitPrice)) } : {}) })),
        total,
        paymentKind: isCourtesy ? 'cash' : paymentKind || 'cash',
        cashAmount: split.cashAmount,
        qrAmount: split.qrAmount,
        creditAmount: split.creditAmount,
        cashReceived: !isCourtesy && paymentKind === 'cash' ? round2(Number(cashReceived)) : split.cashAmount,
        changeAmount: !isCourtesy && paymentKind === 'cash' ? round2(Math.max(0, Number(cashReceived) - total)) : 0,
        note: note.trim(),
        ...(isCourtesy ? { saleKind: 'courtesy', courtesyReason: courtesyReason.trim() } : {}),
      })

      setIsCheckoutOpen(false)
      setCart([])
      operationIdRef.current = null
      setPrintState(sale.pendingConfirmation ? { ok: false, message: 'Venta guardada en este dispositivo. Pendiente de sincronizar; puedes imprimir o compartir el ticket.' } : null)
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
  const activeCustomerOverride = selectedCustomer
    ? data.creditOverrides.find(
        (item) => item.customerId === selectedCustomer.id && !item.revokedAt && Date.parse(item.activeUntil) > nowMs,
      )
    : null

  const correctionOriginalByProduct = useMemo(() => {
    const grouped = new Map<string, DistSaleLine>()
    const lines = correctionTarget?.effectiveSnapshot?.lines ?? correctionTarget?.lines ?? []
    for (const line of lines) {
      const existing = grouped.get(line.productId)
      if (!existing) {
        grouped.set(line.productId, { ...line, physicalQuantity: saleLinePhysicalQuantity(line), allocations: [...(line.allocations || [])] })
        continue
      }
      const quantity = roundSaleQuantity(existing.quantity + line.quantity, line.unitType)
      const subtotal = round2(existing.subtotal + line.subtotal)
      grouped.set(line.productId, {
        ...existing,
        quantity,
        physicalQuantity: roundSaleQuantity(saleLinePhysicalQuantity(existing) + saleLinePhysicalQuantity(line), line.unitType),
        subtotal,
        actualUnitPrice: round2(subtotal / quantity),
        allocations: [...(existing.allocations || []), ...(line.allocations || [])],
      })
    }
    return grouped
  }, [correctionTarget])

  const allowedProductIds = useMemo(() => {
    if (!correctionTarget) return new Set<string>()
    const dispatch = data.openDispatches.find((d) => d.id === correctionTarget.dispatchId) || (isDistributor ? openDispatch : null)
    let allowedIds: Set<string>
    const effectiveLines = correctionTarget.effectiveSnapshot?.lines ?? correctionTarget.lines ?? []
    if (dispatch) {
      allowedIds = new Set<string>()
      dispatch.lines.forEach((l) => allowedIds.add(l.productId))
      dispatch.additions.forEach((a) => a.quantityByProduct.forEach((l) => allowedIds.add(l.productId)))
      effectiveLines.forEach((l) => allowedIds.add(l.productId))
    } else {
      allowedIds = new Set(
        data.products
          .filter(
            (p) =>
              p.active !== false &&
              ((availableStock.get(p.id) ?? 0) > 0 || effectiveLines.some((l) => l.productId === p.id)),
          )
          .map((p) => p.id),
      )
    }
    return allowedIds
  }, [correctionTarget, data.openDispatches, data.products, isDistributor, openDispatch, availableStock])

  const correctionProducts = useMemo(() => {
    if (!correctionTarget) return []
    const visibleIds = new Set<string>([
      ...Array.from(correctionOriginalByProduct.keys()),
      ...correctionAddedProductIds,
    ])
    const term = correctionSearch.trim().toLowerCase()
    return data.products
      .filter((p) => visibleIds.has(p.id) && p.active !== false)
      .filter(
        (p) =>
          !term ||
          p.name.toLowerCase().includes(term) ||
          (p.presentation || '').toLowerCase().includes(term) ||
          p.category.toLowerCase().includes(term),
      )
  }, [correctionTarget, correctionOriginalByProduct, correctionAddedProductIds, data.products, correctionSearch])

  const addableProducts = useMemo(() => {
    if (!correctionTarget) return []
    const visibleIds = new Set<string>([
      ...Array.from(correctionOriginalByProduct.keys()),
      ...correctionAddedProductIds,
    ])
    return data.products
      .filter((p) => allowedProductIds.has(p.id) && !visibleIds.has(p.id) && p.active !== false)
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
  }, [correctionTarget, allowedProductIds, correctionOriginalByProduct, correctionAddedProductIds, data.products])

  const correctionLines = useMemo(() => {
    if (!correctionTarget) return []
    return data.products
      .map((product) => {
        const qty = parseSaleQuantity(correctionQuantities[product.id] ?? '0', product.unitType)
        const originalLine = correctionOriginalByProduct.get(product.id)
        const originalPhysicalQuantity = originalLine ? saleLinePhysicalQuantity(originalLine) : 0
        const originalHadExcess = Boolean(originalLine && originalPhysicalQuantity > originalLine.quantity + 1e-9)
        const quantityChanged = Boolean(originalLine && Math.abs(qty - originalLine.quantity) > 1e-9)
        const physicalTouched = correctionPhysicalTouched[product.id] === true
        const physicalRaw = correctionPhysicalQuantities[product.id] ?? String(originalPhysicalQuantity || qty)
        const parsedPhysical = parseSaleQuantity(physicalRaw, product.unitType)
        const physicalQuantity = session.role !== 'admin' || product.unitType !== 'kg'
          ? qty
          : physicalTouched
            ? parsedPhysical
            : originalLine && !quantityChanged
              ? originalPhysicalQuantity
              : originalHadExcess
                ? originalPhysicalQuantity
                : qty
        const priceRaw = correctionPrices[product.id] ?? String(originalLine?.actualUnitPrice ?? product.referencePrice)
        const price = Number(priceRaw)
        return {
          product,
          quantity: qty,
          physicalQuantity,
          physicalRaw,
          physicalTouched,
          originalPhysicalQuantity,
          originalHadExcess,
          quantityChanged,
          physicalValid: Number.isFinite(Number(physicalRaw.trim().replace(',', '.'))) && hasValidQuantityPrecision(physicalRaw, product.unitType),
          quantityValid: hasValidQuantityPrecision(correctionQuantities[product.id] ?? '0', product.unitType),
          needsPhysicalConfirmation: Boolean(session.role === 'admin' && product.unitType === 'kg' && originalHadExcess && quantityChanged && !physicalTouched),
          unitPrice: price,
          priceRaw,
          priceValid: Number.isFinite(price) && price > 0,
          subtotal: Number.isFinite(price) && price > 0 ? round2(qty * price) : 0,
          originalQuantity: originalLine ? originalLine.quantity : 0,
          originalPrice: originalLine?.actualUnitPrice ?? product.referencePrice,
        }
      })
      .filter((item) => item.quantity > 0)
  }, [correctionTarget, correctionOriginalByProduct, correctionQuantities, correctionPhysicalQuantities, correctionPhysicalTouched, correctionPrices, data.products, session.role])

  const newCorrectionTotal = round2(correctionLines.reduce((sum, l) => sum + l.subtotal, 0))

  const parsedCorrectionPayments = useMemo(() => {
    let cash = 0
    let qr = 0
    let credit = 0
    if (correctionPaymentKind === 'cash') {
      cash = newCorrectionTotal
    } else if (correctionPaymentKind === 'qr') {
      qr = newCorrectionTotal
    } else if (correctionPaymentKind === 'credit') {
      credit = newCorrectionTotal
    } else {
      cash = round2(Number(correctionCashAmount) || 0)
      qr = round2(Number(correctionQrAmount) || 0)
      credit = round2(Number(correctionCreditAmount) || 0)
    }
    return { cash, qr, credit }
  }, [correctionPaymentKind, newCorrectionTotal, correctionCashAmount, correctionQrAmount, correctionCreditAmount])

  const validateCorrection = () => {
    if (!correctionTarget) return false
    if (!correctionReason.trim()) {
      setError('La razón de la edición es obligatoria.')
      return false
    }
    if (correctionLines.length === 0) {
      setError('La venta debe conservar al menos un producto.')
      return false
    }
    const invalidPrice = correctionLines.find((line) => !line.priceValid)
    if (invalidPrice) {
      setError(`Indica un precio mayor a Bs 0 para ${invalidPrice.product.name}.`)
      return false
    }
    const invalidQuantity = correctionLines.find((line) => !line.quantityValid)
    if (invalidQuantity) {
      setError(`Termina de escribir una cantidad válida de hasta ${invalidQuantity.product.unitType === 'kg' ? 'tres decimales' : 'unidades enteras'} para ${invalidQuantity.product.name}.`)
      return false
    }
    const ambiguousPhysical = correctionLines.find((line) => line.needsPhysicalConfirmation)
    if (ambiguousPhysical) {
      setError(`${ambiguousPhysical.product.name} tenía un excedente físico. Confirma expresamente el nuevo peso físico entregado.`)
      return false
    }
    const invalidPhysical = correctionLines.find((line) => session.role === 'admin' && line.product.unitType === 'kg' && (!line.physicalValid || line.physicalQuantity < line.quantity))
    if (invalidPhysical) {
      setError(!invalidPhysical.physicalValid
        ? `Completa el peso físico de ${invalidPhysical.product.name} con hasta tres decimales.`
        : `El peso físico de ${invalidPhysical.product.name} no puede ser menor que la cantidad cobrada.`)
      return false
    }

    const { cash: parsedCash, qr: parsedQr, credit: parsedCredit } = parsedCorrectionPayments
    if (Math.abs(newCorrectionTotal - (parsedCash + parsedQr + parsedCredit)) > 0.01) {
      setError(
        `La suma de los pagos (${formatBs(parsedCash + parsedQr + parsedCredit)}) debe coincidir con el total (${formatBs(newCorrectionTotal)}).`,
      )
      return false
    }

    if (parsedCredit > 0 && !correctionTarget.customerId) {
      setError('El crédito requiere que la venta esté asignada a un cliente.')
      return false
    }

    const existingReceivable = data.receivables.find(
      (r) => r.saleId === correctionTarget.id || r.id === correctionTarget.id,
    )
    const alreadyPaid = existingReceivable?.paidAmount || 0
    if (parsedCredit < alreadyPaid) {
      setError(
        `El crédito corregido (${formatBs(parsedCredit)}) no puede ser menor a lo ya cobrado de este crédito (${formatBs(alreadyPaid)}).`,
      )
      return false
    }

    const effective = correctionTarget.effectiveSnapshot ?? correctionTarget
    const origCash = round2(
      Number(effective.cashAmount) || (effective.paymentKind === 'cash' ? effective.total : 0),
    )
    const origQr = round2(
      Number(effective.qrAmount) || (effective.paymentKind === 'qr' ? effective.total : 0),
    )
    const origCredit = round2(
      Number(effective.creditAmount) || (effective.paymentKind === 'credit' ? effective.total : 0),
    )
    const hasPaymentChange =
      correctionPaymentKind !== effective.paymentKind ||
      Math.abs(parsedCash - origCash) > 0.01 ||
      Math.abs(parsedQr - origQr) > 0.01 ||
      Math.abs(parsedCredit - origCredit) > 0.01

    const hasLineChange =
      correctionLines.length !== correctionOriginalByProduct.size ||
      correctionLines.some(
        (line) =>
          Math.abs(line.quantity - line.originalQuantity) > 0.001 ||
          Math.abs(line.physicalQuantity - line.originalPhysicalQuantity) > 0.001 ||
          Math.abs(line.unitPrice - line.originalPrice) > 0.001,
      )
    if (!hasLineChange && !hasPaymentChange) {
      setError('Realiza al menos un cambio de cantidad, precio o forma de pago antes de confirmar.')
      return false
    }

    for (const line of correctionLines) {
      const increase = roundSaleQuantity(line.physicalQuantity - line.originalPhysicalQuantity, line.product.unitType)
      if (increase > 0) {
        const stock = availableStock.get(line.product.id) ?? 0
        if (increase > stock) {
          setError(
            `Stock insuficiente ${isDistributor ? 'en tu camión' : 'en almacén central'} para ${line.product.name}. Aumentas +${formatQty(increase, line.product.unitType)}, pero solo hay ${formatQty(stock, line.product.unitType)} disponibles.`,
          )
          return false
        }
      }
    }
    setError(null)
    return true
  }

  const reviewCorrection = () => {
    if (validateCorrection()) setIsReviewingCorrection(true)
  }

  const submitCorrection = async () => {
    if (!correctionTarget || isSubmitting || !validateCorrection()) return

    const lines: DistSaleLine[] = correctionLines.map((item) => ({
      productId: item.product.id,
      productNameSnapshot: item.product.name,
      presentationSnapshot: getProductPresentation(item.product),
      descriptionSnapshot: item.product.description,
      quantity: item.quantity,
      unitType: item.product.unitType,
      actualUnitPrice: item.unitPrice,
      referenceUnitPrice: correctionOriginalByProduct.get(item.product.id)?.referenceUnitPrice ?? item.product.referencePrice,
      isPromotional: Math.abs(item.unitPrice - (correctionOriginalByProduct.get(item.product.id)?.referenceUnitPrice ?? item.product.referencePrice)) > 0.001,
      subtotal: item.subtotal,
      ...(session.role === 'admin' && item.product.unitType === 'kg' ? { physicalQuantity: item.physicalQuantity } : {}),
    }))

    const { cash: cashAmount, qr: qrAmount, credit: creditAmount } = parsedCorrectionPayments

    setIsSubmitting(true)
    try {
      await correctSale({
        saleId: correctionTarget.id,
        reason: correctionReason.trim(),
        lines,
        paymentKind: correctionPaymentKind,
        cashAmount,
        qrAmount,
        creditAmount,
      })
      setCorrectionTarget(null)
      setIsReviewingCorrection(false)
      setCorrectionSuccessMessage('Venta corregida correctamente. Los cambios y el stock fueron actualizados.')
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const submitVoid = async () => {
    if (!voidTarget || isSubmitting) return
    if (!voidReason.trim()) {
      setError('La razón de la anulación es obligatoria.')
      return
    }
    const derived = (voidSnapshot?.lines || voidTarget.lines || []).some(line => line.allocations?.some(allocation => allocation.processingAllocation))
    if (derived && voidScenario !== 'recorded_in_error_never_delivered') {
      setError('La anulación directa es solo para una venta registrada por error y nunca entregada. Si fue entregada y luego volvió, registra el reclamo/devolución física.'); return
    }
    if (derived && (session.role !== 'admin' || !voidCustodyConfirmed || voidReason.trim().length < 10
      || (voidCashAmount > 0 && !voidCashRefundConfirmed)
      || (voidQrAmount > 0 && (!voidQrRefundConfirmed || voidQrRefundReference.trim().length < 8)))) {
      setError('Para anular sachets, Administración debe confirmar custodia, reembolsos en efectivo y la referencia bancaria de cualquier devolución QR.'); return
    }
    setIsSubmitting(true)
    try {
      await voidSale({ saleId: voidTarget.id, reason: voidReason.trim(), ...(derived ? {
        voidScenario: 'recorded_in_error_never_delivered',
        physicalCustodyConfirmed: voidCustodyConfirmed,
        custodyLocation: voidTarget.sourceLocation === 'route' ? `route__${voidTarget.routeId}` : 'central',
        physicalCustodyNote: voidReason.trim(),
        cashRefundAmount: voidCashAmount,
        qrRefundAmount: voidQrAmount,
        qrRefundConfirmed: voidQrRefundConfirmed,
        qrRefundReference: voidQrRefundReference.trim(),
      } : {}) })
      setVoidTarget(null)
      setVoidReason('')
      setVoidScenario('')
      setVoidCustodyConfirmed(false)
      setVoidCashRefundConfirmed(false)
      setVoidQrRefundConfirmed(false)
      setVoidQrRefundReference('')
      setCorrectionSuccessMessage('Venta anulada correctamente. Los productos volvieron al stock de origen.')
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Screen
      title="Ventas"
      subtitle={
        isDistributor
          ? openDispatch
            ? `Ruta ${routeName} · despacho abierto`
            : 'Sin despacho abierto'
          : 'Venta directa desde almacen central'
      }
      actions={<SecondaryButton onClick={() => setIsHistoryOpen(true)}><History size={16} /> Historial</SecondaryButton>}
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
                  {getProductPresentation(product) && (
                    <span className="block text-[10px] font-semibold text-slate-500">{getProductPresentation(product)}</span>
                  )}
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
          className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white px-3 py-2.5 shadow-lg"
          style={{ paddingBottom: 'calc(0.625rem + var(--safe-bottom) + var(--bottom-nav-height))' }}
        >
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
            {!cartStockValidation.isValid && (
              <div className="flex items-center gap-1.5 rounded-xl border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-xs font-bold text-rose-800">
                <AlertTriangle size={15} className="shrink-0 text-rose-600" />
                <span className="truncate">{cartStockValidation.message}</span>
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-extrabold uppercase text-slate-500">
                  Paso 1 · {cart.length} {cart.length > 1 ? 'líneas' : 'línea'}
                </p>
                <p className="truncate text-lg font-black tabular-nums text-slate-900">{formatBs(total)}</p>
              </div>
              <div className="flex items-center gap-2">
                <SecondaryButton onClick={resetSale}>
                  Vaciar
                </SecondaryButton>
                <PrimaryButton
                  disabled={!cartStockValidation.isValid}
                  onClick={() => {
                    setError(null)
                    setIsCustomerOpen(true)
                  }}
                >
                  <span>Siguiente: Cliente</span>
                  <ArrowRight size={16} />
                </PrimaryButton>
              </div>
            </div>
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
          (() => {
            const editingStock = editingProduct ? roundSaleQuantity(availableStock.get(editingProduct.id) ?? 0, editingProduct.unitType) : 0
            const requestedQty = roundSaleQuantity(Number(quantity) || 0, editingProduct?.unitType ?? 'unit')
            const existingInCart = editingProduct ? cart.filter(l => l.productId === editingProduct.id).reduce((sum, l) => sum + (l.physicalQuantity ?? l.quantity), 0) : 0
            const deliveredQty = session.role === 'admin' && editingProduct?.unitType === 'kg' ? roundSaleQuantity(Number(physicalQuantity) || 0, editingProduct.unitType) : requestedQty
            const totalRequested = roundSaleQuantity(existingInCart + deliveredQty, editingProduct?.unitType ?? 'unit')
            const isEditingOverStock = totalRequested > editingStock
            return (
              <PrimaryButton full disabled={isEditingOverStock || !(requestedQty > 0)} onClick={addToCart}>
                <Plus size={16} /> Agregar {formatBs(round2(requestedQty * Number(unitPrice)))}
              </PrimaryButton>
            )
          })()
        }
      >
        {(() => {
          const editingStock = editingProduct ? roundSaleQuantity(availableStock.get(editingProduct.id) ?? 0, editingProduct.unitType) : 0
          const requestedQty = roundSaleQuantity(Number(quantity) || 0, editingProduct?.unitType ?? 'unit')
          const existingInCart = editingProduct ? cart.filter(l => l.productId === editingProduct.id).reduce((sum, l) => sum + (l.physicalQuantity ?? l.quantity), 0) : 0
          const deliveredQty = session.role === 'admin' && editingProduct?.unitType === 'kg' ? roundSaleQuantity(Number(physicalQuantity) || 0, editingProduct.unitType) : requestedQty
          const totalRequested = roundSaleQuantity(existingInCart + deliveredQty, editingProduct?.unitType ?? 'unit')
          const isEditingOverStock = totalRequested > editingStock

          return (
            <div className="grid gap-3">
              {isEditingOverStock && (
                <div className="flex items-center gap-2 rounded-2xl border border-rose-300 bg-rose-50 p-2.5 text-xs font-bold text-rose-800">
                  <AlertTriangle size={17} className="shrink-0 text-rose-600" />
                  <div>
                    <p className="font-black text-rose-900">Stock insuficiente</p>
                    <p className="text-[11px] text-rose-700">
                      Disponible {isDistributor ? 'en tu ruta' : 'en almacén central'}: {formatQty(editingStock, editingProduct?.unitType ?? 'unit')}.
                      {existingInCart > 0 && ` Ya tienes ${formatQty(existingInCart, editingProduct?.unitType ?? 'unit')} en carrito.`}
                      {' '}Máximo disponible: {formatQty(editingStock, editingProduct?.unitType ?? 'unit')}.
                    </p>
                  </div>
                </div>
              )}
              <Field
                label={session.role === 'admin' && editingProduct?.unitType === 'kg' ? 'Cantidad a cobrar (kg)' : editingProduct?.unitType === 'kg' ? 'Cantidad (kg)' : 'Cantidad'}
                hint={`Disponible ${isDistributor ? 'en tu ruta' : 'en almacén central'}: ${formatQty(editingStock, editingProduct?.unitType ?? 'unit')}`}
              >
                <NumberInput
                  value={quantity}
                  min={0}
                  step={editingProduct?.unitType === 'kg' ? 0.001 : 1}
                  onChange={(event) => {
                    const next = event.target.value
                    const previous = quantity
                    setQuantity(next)
                    if (physicalQuantity === previous || !physicalQuantity) setPhysicalQuantity(next)
                  }}
                />
              </Field>
              {session.role === 'admin' && editingProduct?.unitType === 'kg' && <Field label="Peso entregado físicamente (kg)" hint="El importe se calcula con la cantidad a cobrar; el stock se descuenta con el peso físico entregado."><NumberInput value={physicalQuantity} min={0} step={0.001} inputMode="decimal" onChange={(event) => setPhysicalQuantity(event.target.value)} /></Field>}
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
                  {roundSaleQuantity(Number(quantity) || 0, editingProduct?.unitType ?? 'unit')}
                  {editingProduct?.unitType === 'kg' ? ' kg cobrados' : editingProduct?.unitType === 'package' ? ' paq' : ' u'} ×{' '}
                  {formatBs(round2(Number(unitPrice) || 0))}
                  {session.role === 'admin' && editingProduct?.unitType === 'kg' && roundSaleQuantity(Number(physicalQuantity) || 0, 'kg') !== roundSaleQuantity(Number(quantity) || 0, 'kg') ? <span className="block font-black text-amber-800">Entrega: {formatQty(Number(physicalQuantity) || 0, 'kg')} · excedente sin cobro {formatQty(Math.max(0, (Number(physicalQuantity) || 0) - (Number(quantity) || 0)), 'kg')}</span> : null}
                </span>
                <span className="text-base font-black tabular-nums text-slate-900">
                  {formatBs(round2((Number(quantity) || 0) * (Number(unitPrice) || 0)))}
                </span>
              </div>

              {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
            </div>
          )
        })()}
      </Modal>

      {/* Cobro */}
      <Modal
        isOpen={isCheckoutOpen}
        onClose={() => setIsCheckoutOpen(false)}
        title={saleMode === 'courtesy' ? 'Registrar cortesía' : 'Cobrar venta'}
        subtitle={`Paso 3 de 3 · ${saleMode === 'courtesy' ? `Valor referencial ${formatBs(courtesyReferenceTotal)} · sin cobro` : `Forma de pago · Total ${formatBs(total)}`}`}
        footer={
          <div className="flex items-center justify-between gap-2 w-full">
            <SecondaryButton
              disabled={isSubmitting}
              onClick={() => {
                setIsCheckoutOpen(false)
                setIsCustomerOpen(true)
              }}
            >
              <ArrowLeft size={16} /> Volver al cliente
            </SecondaryButton>
            <PrimaryButton
              disabled={isSubmitting || !cartStockValidation.isValid}
              onClick={() => void confirmSale()}
            >
              {isSubmitting ? 'Registrando...' : saleMode === 'courtesy' ? 'Confirmar cortesía · Bs 0,00' : `Confirmar venta · ${formatBs(total)}`}
            </PrimaryButton>
          </div>
        }
      >
        <div className="grid gap-3">
          <SaleStepIndicator currentStep={3} />
          <div className="grid grid-cols-2 gap-2 rounded-2xl border-2 border-slate-200 bg-slate-50 p-2">
            <button type="button" onClick={() => setSaleMode('sale')} className={`min-h-11 rounded-xl px-2 text-xs font-black ${saleMode === 'sale' ? 'bg-white text-[var(--primary)] shadow' : 'text-slate-600'}`}>Venta normal</button>
            <button type="button" onClick={() => setSaleMode('courtesy')} className={`min-h-11 rounded-xl px-2 text-xs font-black ${saleMode === 'courtesy' ? 'bg-fuchsia-100 text-fuchsia-900 shadow' : 'text-slate-600'}`}>Entrega de cortesía</button>
          </div>
          {saleMode === 'courtesy' && <div className="grid gap-2 rounded-2xl border-2 border-fuchsia-200 bg-fuchsia-50 p-3"><p className="text-xs font-bold text-fuchsia-900">La cortesía descuenta existencias, pero no registra dinero, deuda ni venta. Valor de referencia: {formatBs(courtesyReferenceTotal)}.</p><Field label="Motivo obligatorio"><TextArea value={courtesyReason} onChange={e=>setCourtesyReason(e.target.value)} placeholder="Ej.: muestra, promoción autorizada…" rows={2}/></Field></div>}

          {!cartStockValidation.isValid && (
            <div className="flex items-center gap-2 rounded-2xl border border-rose-300 bg-rose-50 p-2.5 text-xs font-bold text-rose-800">
              <AlertTriangle size={16} className="shrink-0 text-rose-600" />
              <span>{cartStockValidation.message}</span>
            </div>
          )}

          <div className="grid gap-1.5">
            {cart.map((line) => {
              const lineStock = round2(availableStock.get(line.productId) ?? 0)
              const physicalQty = line.physicalQuantity ?? line.quantity
              const isOver = physicalQty > lineStock
              return (
                <div
                  key={line.lineId}
                  className={`flex items-center justify-between gap-2 rounded-2xl p-3 transition ${
                    isOver ? 'border border-rose-300 bg-rose-50/70' : 'bg-slate-50'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="break-words text-xs font-extrabold text-slate-900">{line.productNameSnapshot}</p>
                    {(line.presentationSnapshot || line.descriptionSnapshot) && (
                      <p className="break-words text-[10px] font-semibold text-slate-500">
                        {[line.presentationSnapshot, line.descriptionSnapshot].filter(Boolean).join(' · ')}
                      </p>
                    )}
                    <p className="text-[11px] font-semibold text-slate-500">
                      {formatQty(line.quantity, line.unitType)} × {saleMode === 'courtesy' ? `precio referencial ${formatBs(line.referenceUnitPrice || line.actualUnitPrice)}` : formatBs(line.actualUnitPrice)}
                    </p>
                    {line.physicalQuantity !== undefined && line.physicalQuantity > line.quantity && <p className="text-[11px] font-bold text-amber-800">Entregado: {formatQty(line.physicalQuantity, line.unitType)} · excedente no cobrado: {formatQty(line.excessWeightQuantity || 0, line.unitType)}</p>}
                    {isOver && (
                      <p className="mt-1 flex items-center gap-1 text-[10px] font-black text-rose-700">
                        <AlertTriangle size={12} className="shrink-0" />
                        <span>Stock insuficiente: disponible {formatQty(lineStock, line.unitType)} {isDistributor ? 'en tu ruta' : 'en almacén central'}</span>
                      </p>
                    )}
                    {line.isPromotional && (
                      <p className="text-[10px] font-black text-amber-700">
                        PRECIO PROMOCIONAL · original {formatBs(line.referenceUnitPrice || line.actualUnitPrice)}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`text-xs font-black tabular-nums ${saleMode === 'courtesy' ? 'text-fuchsia-800' : 'text-slate-900'}`}>{saleMode === 'courtesy' ? `Ref. ${formatBs(line.quantity * (line.referenceUnitPrice || line.actualUnitPrice))}` : formatBs(line.subtotal)}</span>
                    <button
                      type="button"
                      onClick={() => removeLine(line.lineId)}
                      aria-label="Eliminar producto"
                      className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-white px-2.5 py-1 text-xs font-bold text-rose-600 hover:bg-rose-50 hover:text-rose-700 transition shadow-2xs"
                    >
                      <Trash2 size={13} /> Eliminar
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 px-3 py-2.5">
            <p className="text-[10px] font-extrabold uppercase text-emerald-700">Cliente seleccionado</p>
            <div className="mt-1 flex items-center justify-between gap-2">
              <p className="min-w-0 break-words text-xs font-black text-emerald-950">
                {selectedCustomer ? selectedCustomer.name : 'Sin cliente · venta rápida al contado'}
              </p>
              <button
                type="button"
                className="shrink-0 text-[11px] font-extrabold text-emerald-800 underline"
                onClick={() => {
                  setIsCheckoutOpen(false)
                  setIsCustomerOpen(true)
                }}
              >
                Cambiar cliente
              </button>
            </div>
          </div>

          {activeCustomerOverride && (
            <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 shadow-sm">
              <div className="flex items-center gap-1.5 font-black uppercase tracking-wide text-amber-800 text-[11px]">
                <ShieldAlert size={15} /> AUTORIZADO TEMPORALMENTE
              </div>
              <p className="mt-0.5 font-bold text-[11px]">
                Por: {activeCustomerOverride.grantedByName || 'Administración'} · Válido hasta:{' '}
                {new Date(activeCustomerOverride.activeUntil).toLocaleString('es-BO')}
              </p>
              {activeCustomerOverride.reason && (
                <p className="mt-0.5 text-[10px] text-amber-700 italic">Motivo: {activeCustomerOverride.reason}</p>
              )}
            </div>
          )}

          {saleMode === 'sale' && <><Field label="Forma de pago" required hint={!customerId ? 'Sin cliente permite efectivo, QR o mixto, siempre al contado.' : 'Selecciona una opción para continuar.'}>
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
          {paymentKind === 'cash' && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Efectivo recibido (Bs)">
                <NumberInput value={cashReceived} min={0} placeholder={String(total)} onChange={event => setCashReceived(event.target.value)} />
              </Field>
              <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-3">
                <p className="text-[10px] font-extrabold uppercase text-emerald-700">Cambio a devolver</p>
                <p className="mt-1 text-lg font-black text-emerald-800">{formatBs(changeAmount)}</p>
              </div>
            </div>
          )}
          <Field label="Observaciones" hint="Se guarda con la venta, pero no aparecerá en el ticket.">
            <TextArea value={note} onChange={event => setNote(event.target.value)} />
          </Field></>}

          {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
        </div>
      </Modal>

      {/* Cliente */}
      <Modal
        isOpen={isCustomerOpen}
        onClose={() => setIsCustomerOpen(false)}
        title="Seleccionar cliente"
        subtitle="Paso 2 de 3 · Elige una opción para continuar"
        size="lg"
        footer={
          <div className="flex items-center justify-between gap-2 w-full">
            <SecondaryButton onClick={() => setIsCustomerOpen(false)}>
              <ArrowLeft size={16} /> Volver a productos
            </SecondaryButton>
            {customerChoiceMade && (
              <PrimaryButton
                onClick={() => {
                  setIsCustomerOpen(false)
                  setIsCheckoutOpen(true)
                }}
              >
                <span>Siguiente: Pago</span>
                <ArrowRight size={16} />
              </PrimaryButton>
            )}
          </div>
        }
      >
        <div className="grid gap-3">
          <SaleStepIndicator currentStep={2} />
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
            {filteredCustomers.map((customer) => {
              const isCustOverride = data.creditOverrides.some(
                (item) => item.customerId === customer.id && !item.revokedAt && Date.parse(item.activeUntil) > nowMs,
              )
              return (
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
                  <div className="flex items-center justify-between gap-2">
                    <span className="block break-words text-sm font-extrabold">{customer.name}</span>
                    {isCustOverride && (
                      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-black text-amber-800">
                        AUTORIZADO
                      </span>
                    )}
                  </div>
                  <span className="mt-0.5 block break-words text-[11px] text-slate-500">
                    {customer.customerCode || customer.identityNumber || 'CI pendiente'}
                    {customer.phone ? ` · ${customer.phone}` : ''}
                  </span>
                </button>
              )
            })}
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
      <Modal isOpen={isHistoryOpen} onClose={() => setIsHistoryOpen(false)} title="Historial de ventas" subtitle="Operación diaria, reimpresión y correcciones auditadas" size="lg">
        <div className="grid gap-3">
          {correctionSuccessMessage && (
            <div className="flex items-center justify-between gap-2 rounded-2xl border border-emerald-300 bg-emerald-50 p-3 text-emerald-950 shadow-xs">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={18} className="shrink-0 text-emerald-600" />
                <div>
                  <p className="text-xs font-black">Operación confirmada</p>
                  <p className="text-[11px] font-semibold text-emerald-800">
                    {correctionSuccessMessage}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCorrectionSuccessMessage(null)}
                className="rounded-lg p-1 text-emerald-700 hover:bg-emerald-100 transition"
              >
                <X size={15} />
              </button>
            </div>
          )}

          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <TextInput className="pl-9" value={historySearch} onChange={e => setHistorySearch(e.target.value)} placeholder="Buscar cliente, producto o vendedor" />
          </div>
          <div className="grid grid-cols-3 gap-1 rounded-2xl bg-slate-100 p-1"><button type="button" onClick={()=>setHistoryKind('all')} className={`rounded-xl px-2 py-2 text-xs font-black ${historyKind==='all'?'bg-white shadow text-slate-900':'text-slate-500'}`}>Todo</button><button type="button" onClick={()=>setHistoryKind('sale')} className={`rounded-xl px-2 py-2 text-xs font-black ${historyKind==='sale'?'bg-white shadow text-slate-900':'text-slate-500'}`}>Ventas</button><button type="button" onClick={()=>setHistoryKind('courtesy')} className={`rounded-xl px-2 py-2 text-xs font-black ${historyKind==='courtesy'?'bg-fuchsia-100 shadow text-fuchsia-900':'text-slate-500'}`}>Cortesías</button></div>
          {historySales.map(sale => {
            const availability = checkSaleCorrectionAvailability(sale, session, data)
            const audit = getSaleAuditSummary(sale)

            return (
              <article
                key={sale.id}
                className={`rounded-2xl border p-3 ${
                  sale.saleKind === 'courtesy' ? 'border-fuchsia-300 bg-fuchsia-50/70' : sale.voidedAt ? 'border-rose-300 bg-rose-50/70' : audit.isCorrected ? 'border-amber-300 bg-amber-50/70' : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {sale.saleKind === 'courtesy' && <span className="rounded-full bg-fuchsia-100 px-2 py-1 text-[10px] font-black text-fuchsia-900">CORTESÍA · SIN COBRO · VALOR REF. {formatBs(sale.lines.reduce((n,line)=>n+(line.referenceSubtotal||0),0))}</span>}
                      <p className="text-xs font-extrabold text-slate-900">
                        {sale.customerName || 'Contado sin cliente'} · {formatBs(sale.total)}
                      </p>
                      {audit.isCorrected && !sale.voidedAt && (
                        <span className="rounded-full bg-amber-100 border border-amber-300 px-2 py-0.5 text-[9px] font-black text-amber-800 tracking-wide uppercase">
                          CORREGIDA
                        </span>
                      )}
                      {sale.voidedAt && (
                        <span className="rounded-full border border-rose-300 bg-rose-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-rose-800">
                          ANULADA
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] font-semibold text-slate-500">
                      {new Date(sale.createdAt).toLocaleString('es-BO')} · {sale.sellerName}
                    </p>
                    {audit.isCorrected && !sale.voidedAt && (
                      <div className="mt-1 flex items-center gap-2 flex-wrap">
                        <p className="text-[10px] font-bold text-amber-900">
                          Rev. {audit.revisionNumber} · {sale.editReason || 'Corregida'}{' '}
                          {sale.editedAt ? `· ${new Date(sale.editedAt).toLocaleString('es-BO')}` : ''}
                        </p>
                        <button
                          type="button"
                          onClick={() => setAuditInspectingSale(sale)}
                          className="text-[10px] font-black text-amber-900 underline hover:text-amber-700"
                        >
                          Ver historial
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <p className="my-2 text-[11px] text-slate-600">
                  {sale.voidedAt
                    ? `Anulada: ${sale.voidReason || 'sin motivo visible'}`
                    : (sale.effectiveSnapshot?.lines ?? sale.lines)
                        .map((line) => `${formatQty(line.quantity, line.unitType)} ${line.productNameSnapshot}`)
                        .join(' · ')}
                </p>
                <div className="grid grid-cols-2 gap-2 items-center sm:grid-cols-4">
                  <SecondaryButton disabled={Boolean(sale.voidedAt)} onClick={() => void printSaleReceipt(sale, receiptContext, true)}>
                    Ticket
                  </SecondaryButton>
                  <SecondaryButton disabled={Boolean(sale.voidedAt)} onClick={() => void shareSaleReceipt(sale, receiptContext)}>
                    Compartir
                  </SecondaryButton>
                  {availability.canCorrect && sale.saleKind !== 'courtesy' ? (
                    <SecondaryButton
                      onClick={() => {
                        setCorrectionTarget(sale)
                        setCorrectionReason('')
                        setCorrectionSearch('')
                        setCorrectionAddedProductIds([])
                        setIsReviewingCorrection(false)
                        setError(null)
                        const effective = sale.effectiveSnapshot ?? sale
                        const currentLines = effective.lines ?? []
                        const init: Record<string, string> = {}
                        const physicalInit: Record<string, string> = {}
                        const physicalTouchedInit: Record<string, boolean> = {}
                        const priceInit: Record<string, string> = {}
                        const subtotalInit: Record<string, number> = {}
                        currentLines.forEach((l) => {
                          const quantity = roundSaleQuantity((Number(init[l.productId]) || 0) + l.quantity, l.unitType)
                          const physicalQuantity = roundSaleQuantity((Number(physicalInit[l.productId]) || 0) + saleLinePhysicalQuantity(l), l.unitType)
                          const subtotal = round2((subtotalInit[l.productId] || 0) + l.subtotal)
                          init[l.productId] = String(quantity)
                          physicalInit[l.productId] = String(physicalQuantity)
                          physicalTouchedInit[l.productId] = false
                          subtotalInit[l.productId] = subtotal
                          priceInit[l.productId] = String(round2(subtotal / quantity))
                        })
                        setCorrectionQuantities(init)
                        setCorrectionPhysicalQuantities(physicalInit)
                        setCorrectionPhysicalTouched(physicalTouchedInit)
                        setCorrectionPrices(priceInit)
                        const effectiveKind = (effective.paymentKind ?? 'cash') as PaymentKind
                        setCorrectionPaymentKind(effectiveKind)
                        setCorrectionCashAmount(
                          String(effective.cashAmount ?? (effectiveKind === 'cash' ? effective.total : 0)),
                        )
                        setCorrectionQrAmount(
                          String(effective.qrAmount ?? (effectiveKind === 'qr' ? effective.total : 0)),
                        )
                        setCorrectionCreditAmount(
                          String(effective.creditAmount ?? (effectiveKind === 'credit' ? effective.total : 0)),
                        )
                      }}
                    >
                      <Pencil size={14} /> Corregir
                    </SecondaryButton>
                  ) : (
                    <div className="flex flex-col">
                      <button
                        type="button"
                        disabled
                        title={availability.reason}
                        className="inline-flex min-h-[36px] w-full items-center justify-center gap-1 rounded-xl border border-slate-200 bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-400 cursor-not-allowed opacity-80"
                      >
                        <Ban size={12} className="shrink-0" /> No editable
                      </button>
                      <span
                        className="mt-0.5 text-[8.5px] font-semibold text-slate-400 leading-tight truncate"
                        title={availability.reason}
                      >
                        {availability.reason}
                      </span>
                    </div>
                  )}
                  {availability.canCorrect ? (
                    <SecondaryButton
                      onClick={() => {
                        setVoidTarget(sale)
                        setVoidReason('')
                        setVoidScenario('')
                        setVoidCustodyConfirmed(false)
                        setVoidCashRefundConfirmed(false)
                        setVoidQrRefundConfirmed(false)
                        setVoidQrRefundReference('')
                        setError(null)
                      }}
                    >
                      <Trash2 size={14} /> Anular
                    </SecondaryButton>
                  ) : <span />}
                </div>
              </article>
            )
          })}
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(voidTarget)}
        onClose={() => { if (!isSubmitting) { setVoidTarget(null); setVoidReason(''); setVoidScenario(''); setVoidCustodyConfirmed(false); setVoidCashRefundConfirmed(false); setVoidQrRefundConfirmed(false); setVoidQrRefundReference(''); setError(null) } }}
        title="Anular venta completa"
        subtitle="Esta acción queda registrada y no elimina el historial."
        footer={
          <div className="grid w-full grid-cols-2 gap-2">
            <SecondaryButton disabled={isSubmitting} onClick={() => { setVoidTarget(null); setVoidReason(''); setVoidScenario(''); setVoidCustodyConfirmed(false); setVoidCashRefundConfirmed(false); setVoidQrRefundConfirmed(false); setVoidQrRefundReference(''); setError(null) }}>
              Volver
            </SecondaryButton>
            <PrimaryButton disabled={isSubmitting || !voidReason.trim() || Boolean(voidTarget && (voidSnapshot?.lines || voidTarget.lines || []).some(line => line.allocations?.some(allocation => allocation.processingAllocation)) && (session.role !== 'admin' || voidScenario !== 'recorded_in_error_never_delivered' || !voidCustodyConfirmed || voidReason.trim().length < 10 || (voidCashAmount > 0 && !voidCashRefundConfirmed) || (voidQrAmount > 0 && (!voidQrRefundConfirmed || voidQrRefundReference.trim().length < 8))))} onClick={() => void submitVoid()}>
              {isSubmitting ? 'Anulando...' : 'Confirmar anulación'}
            </PrimaryButton>
          </div>
        }
      >
        {voidTarget && (
          <div className="grid gap-3">
            <div className="rounded-2xl border-2 border-rose-300 bg-rose-50 p-3 text-sm text-rose-950">
              <p className="font-black">Se anulará la venta de {formatBs(voidTotal)}.</p>
              <p className="mt-1 text-xs font-semibold">
                {(voidSnapshot?.lines || voidTarget.lines).map(line => `${formatQty(line.quantity, line.unitType)} de ${line.productNameSnapshot}`).join(' · ')}
              </p>
              <p className="mt-2 text-xs font-bold">
                El producto volverá al stock {voidTarget.sourceLocation === 'route' ? `de la ruta ${voidTarget.routeName}` : 'del almacén central'}, respetando sus lotes originales.
              </p>
              {voidCreditAmount > 0 && <p className="mt-2 text-xs font-bold">La deuda sin cobros quedará en cero. Si ya existe algún cobro, el servidor rechazará la anulación.</p>}
            </div>
            {(voidSnapshot?.lines || voidTarget.lines || []).some(line => line.allocations?.some(allocation => allocation.processingAllocation)) && (
              <div className="grid gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                <b>Anulación de sachets: sólo si el producto sigue bajo custodia del negocio</b>
                <Field label="Qué ocurrió con esta venta"><select className="min-h-11 w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm" value={voidScenario} onChange={event => { setVoidScenario(event.target.value as typeof voidScenario); setError(null) }}><option value="">Selecciona el caso</option><option value="recorded_in_error_never_delivered">Registrada por error; nunca fue entregada</option><option value="delivered_then_returned">Fue entregada y luego devuelta físicamente</option></select></Field>
                {voidScenario === 'delivered_then_returned' && <p role="status" className="rounded-lg border border-amber-400 bg-white p-2 text-xs font-bold">No la anules aquí. Registra el reclamo/devolución física en el flujo existente; si ya existe un reclamo, el servidor impedirá un segundo reembolso.</p>}
                <label className="flex items-start gap-2"><input type="checkbox" checked={voidCustodyConfirmed} onChange={event => setVoidCustodyConfirmed(event.target.checked)} /><span>Administración verificó físicamente los paquetes en {voidTarget.sourceLocation === 'route' ? `la ruta ${voidTarget.routeName}` : 'Almacén central'}.</span></label>
                {voidCashAmount > 0 && <label className="flex items-start gap-2"><input type="checkbox" checked={voidCashRefundConfirmed} onChange={event => setVoidCashRefundConfirmed(event.target.checked)} /><span>Se devolvieron Bs {voidCashAmount.toFixed(2)} en efectivo. Si el dinero no se devolvió, no confirmes la anulación.</span></label>}
                {voidQrAmount > 0 && <><p className="font-bold">La devolución QR requiere que el pago original esté verificado y que Administración confirme el retorno bancario con su referencia.</p><label className="flex items-start gap-2"><input type="checkbox" checked={voidQrRefundConfirmed} onChange={event => setVoidQrRefundConfirmed(event.target.checked)} /><span>Confirmo que se devolvieron Bs {voidQrAmount.toFixed(2)} por QR.</span></label><Field label="Referencia bancaria de devolución QR" required><TextInput maxLength={120} value={voidQrRefundReference} onChange={event => setVoidQrRefundReference(event.target.value)} placeholder="Referencia de la devolución" /></Field></>}
                {session.role !== 'admin' && <p className="font-bold">La confirmación de custodia está reservada a Administración.</p>}
              </div>
            )}
            <Field label="Motivo obligatorio">
              <TextArea value={voidReason} onChange={event => setVoidReason(event.target.value)} placeholder="Ej.: venta registrada por error; la mercadería no fue entregada" />
            </Field>
            {error && <p role="alert" className="rounded-xl bg-rose-50 p-2 text-sm font-bold text-rose-700">{error}</p>}
          </div>
        )}
      </Modal>

      <Modal
        isOpen={Boolean(correctionTarget) && !isReviewingCorrection}
        onClose={() => {
          setCorrectionTarget(null)
          setIsReviewingCorrection(false)
        }}
        title="Corrección auditada de venta"
        subtitle={
          correctionTarget
            ? `${correctionTarget.customerName || 'Venta contado'} · Total original ${formatBs(correctionTarget.total)}`
            : ''
        }
        size="lg"
        footer={
          <PrimaryButton full disabled={isSubmitting} onClick={reviewCorrection}>
            {`Revisar corrección · Nuevo total ${formatBs(newCorrectionTotal)}`}
          </PrimaryButton>
        }
      >
        <div className="grid gap-3">
          <p className="rounded-2xl border border-amber-200 bg-amber-50 p-2.5 text-xs font-semibold text-amber-900">
            {session.role === 'admin'
              ? 'Administración puede corregir la cantidad cobrada y, para productos por kg, el peso físico realmente entregado. Toda modificación queda registrada en el historial de auditoría.'
              : 'Solo se muestran los productos asignados al despacho de tu ruta. Puedes aumentar, reducir o poner en 0 para quitar productos. Toda modificación queda registrada en el historial de auditoría.'}
          </p>

          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <TextInput
              value={correctionSearch}
              onChange={(e) => setCorrectionSearch(e.target.value)}
              placeholder="Buscar producto en tu despacho..."
              className="pl-9"
            />
          </div>

          <div className="grid max-h-[50dvh] gap-2 overflow-y-auto pr-1">
            {correctionProducts.map((product) => {
              const originalLine = correctionOriginalByProduct.get(product.id)
              const originalQty = originalLine ? originalLine.quantity : 0
              const currentVal = correctionQuantities[product.id] ?? '0'
              const currentNum = parseSaleQuantity(currentVal, product.unitType)
              const correctionLine = correctionLines.find((line) => line.product.id === product.id)
              const physicalDisplayValue = correctionLine?.physicalTouched
                ? correctionLine.physicalRaw
                : String(correctionLine?.physicalQuantity ?? currentNum)
              const originalPrice = originalLine?.actualUnitPrice ?? product.referencePrice
              const priceVal = correctionPrices[product.id] ?? String(originalPrice)
              const unitPrice = Number(priceVal)
              const validPrice = Number.isFinite(unitPrice) && unitPrice > 0
              const stock = availableStock.get(product.id) ?? 0
              const step = product.unitType === 'kg' ? 0.001 : 1
              const increase = roundSaleQuantity(Math.max(0, (correctionLine?.physicalQuantity ?? currentNum) - (correctionLine?.originalPhysicalQuantity ?? originalQty)), product.unitType)
              const isOverStock = increase > stock

              return (
                <div
                  key={product.id}
                  className={`min-w-0 rounded-2xl border p-3 transition ${
                    currentNum > 0
                      ? isOverStock
                        ? 'border-rose-300 bg-rose-50/60'
                        : 'border-[var(--primary)] bg-[var(--primary-soft)]/20'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      {product.photoDataUrl && (
                        <img
                          src={product.photoDataUrl}
                          alt={product.name}
                          className="h-12 w-12 shrink-0 rounded-xl object-cover"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none'
                          }}
                        />
                      )}
                      <div className="min-w-0">
                        <p className="break-words text-xs font-black text-slate-900">{product.name}</p>
                        {getProductPresentation(product) && (
                          <p className="break-words text-[10px] font-semibold text-slate-500">
                            {getProductPresentation(product)}
                          </p>
                        )}
                        <p className="mt-0.5 text-[10px] font-bold text-slate-600">
                          Cantidad cobrada actual: {formatQty(originalQty, product.unitType)} · Precio actual registrado: {formatBs(originalPrice)}
                        </p>
                        {session.role === 'admin' && product.unitType === 'kg' && (correctionLine?.originalHadExcess || correctionLine?.physicalQuantity !== correctionLine?.quantity) && (
                          <p className="mt-0.5 text-[10px] font-bold text-amber-800">
                            Entrega física original: {formatQty(correctionLine?.originalPhysicalQuantity ?? originalQty, 'kg')} · excedente sin cobro: {formatQty(Math.max(0, (correctionLine?.originalPhysicalQuantity ?? originalQty) - originalQty), 'kg')}
                          </p>
                        )}
                        <p className={`text-[10px] font-bold ${isOverStock ? 'text-rose-700' : 'text-slate-500'}`}>
                          Disponible {isDistributor ? 'en ruta' : 'en almacén central'}: {formatQty(stock, product.unitType)}
                          {increase > 0 && ` (+${formatQty(increase, product.unitType)} adicionales)`}
                        </p>
                        {originalQty > 0 && currentNum === 0 && (
                          <p className="mt-1.5 rounded-lg border border-rose-200 bg-rose-50/90 px-2 py-1 text-[10px] font-bold text-rose-800">
                            Línea eliminada en corrección: retornarán {formatQty(originalQty, product.unitType)} al stock {correctionTarget?.sourceLocation === 'route' ? 'de la ruta' : 'central'}.
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="text-xs font-black tabular-nums text-slate-900">
                        {validPrice ? formatBs(round2(currentNum * unitPrice)) : 'Precio inválido'}
                      </p>
                      {currentNum > 0 ? (
                        <button
                          type="button"
                          onClick={() => setProductPendingRemoval(product)}
                          className="mt-1 inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50/70 px-2 py-0.5 text-[10px] font-bold text-rose-600 hover:bg-rose-100 hover:text-rose-700 transition"
                        >
                          <Trash2 size={12} /> Eliminar producto
                        </button>
                      ) : originalQty > 0 ? (
                        <div className="mt-1 flex flex-col items-end gap-1">
                          <span className="rounded-md border border-rose-200 bg-rose-100 px-1.5 py-0.5 text-[9px] font-black uppercase text-rose-800">
                            ELIMINADO
                          </span>
                          <button
                            type="button"
                            onClick={() => setCorrectionQuantities((c) => ({ ...c, [product.id]: String(originalQty) }))}
                            className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-600 hover:text-slate-900 underline"
                          >
                            <RotateCcw size={11} /> Restaurar
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-end justify-end gap-2 border-t border-slate-200/60 pt-2">
                    <div className="w-full min-w-0 sm:mr-auto sm:w-auto sm:flex-1">
                      <label className="mb-1 block text-[10px] font-black uppercase text-slate-600">Nuevo precio (Bs)</label>
                      <NumberInput
                        min={0.01}
                        step={0.01}
                        value={priceVal}
                        disabled={currentNum <= 0}
                        aria-label={`Nuevo precio de ${product.name}`}
                        onChange={(e) => setCorrectionPrices((prices) => ({ ...prices, [product.id]: e.target.value }))}
                        className={`h-8 w-full text-xs font-bold ${!validPrice && currentNum > 0 ? 'border-rose-400' : ''}`}
                      />
                      {currentNum > 0 && validPrice && Math.abs(unitPrice - originalPrice) > 0.001 && (
                        <p className="mt-1 text-[10px] font-black text-amber-800">
                          {formatBs(originalPrice)} → {formatBs(unitPrice)}
                        </p>
                      )}
                    </div>
                    {session.role === 'admin' && product.unitType === 'kg' && currentNum > 0 && (
                      <div className="w-full min-w-0">
                        <label className="mb-1 block text-[10px] font-black uppercase text-slate-600">Peso físico entregado (kg)</label>
                        <NumberInput
                          min={0}
                          step={0.001}
                          value={physicalDisplayValue}
                          aria-label={`Peso físico entregado corregido de ${product.name}`}
                          onChange={(e) => {
                            setCorrectionPhysicalQuantities((values) => ({ ...values, [product.id]: e.target.value }))
                            setCorrectionPhysicalTouched((values) => ({ ...values, [product.id]: true }))
                          }}
                          className={`h-10 w-full text-sm font-bold ${correctionLine?.physicalTouched && (!correctionLine.physicalValid || correctionLine.physicalQuantity < currentNum) ? 'border-rose-400' : ''}`}
                        />
                        <p className="mt-1 text-[10px] font-semibold text-slate-500">
                          Cantidad cobrada: {formatQty(currentNum, 'kg')} · entrega física: {formatQty(correctionLine?.physicalQuantity ?? currentNum, 'kg')} · excedente sin cobro: {formatQty(Math.max(0, (correctionLine?.physicalQuantity ?? currentNum) - currentNum), 'kg')}
                        </p>
                        {correctionLine?.needsPhysicalConfirmation && (
                          <p className="mt-1 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-900">
                            Esta venta tenía excedente. Confirma el nuevo peso físico entregado antes de guardar.
                          </p>
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      aria-label={`Reducir cantidad de ${product.name}`}
                      disabled={currentNum <= 0}
                      onClick={() =>
                        setCorrectionQuantities((c) => ({
                          ...c,
                          [product.id]: String(Math.max(0, roundSaleQuantity(currentNum - step, product.unitType))),
                        }))
                      }
                      className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 disabled:opacity-30"
                    >
                      <Minus size={14} />
                    </button>

                    <div className="w-24">
                      <NumberInput
                        min={0}
                        step={step}
                        value={currentVal}
                        aria-label={`Cantidad corregida de ${product.name}`}
                        onChange={(e) =>
                          setCorrectionQuantities((c) => ({
                            ...c,
                            [product.id]: e.target.value,
                          }))
                        }
                        className="h-8 text-center text-xs font-bold"
                      />
                    </div>

                    <button
                      type="button"
                      aria-label={`Aumentar cantidad de ${product.name}`}
                      onClick={() =>
                        setCorrectionQuantities((c) => ({
                          ...c,
                          [product.id]: String(roundSaleQuantity(currentNum + step, product.unitType)),
                        }))
                      }
                      className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-900 text-white hover:bg-slate-800"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
              )
            })}
            {addableProducts.length > 0 && (
              <SecondaryButton
                full
                onClick={() => setIsAddProductPickerOpen(true)}
              >
                <Plus size={15} /> Agregar otro producto a la venta
              </SecondaryButton>
            )}
            {correctionProducts.length === 0 && (
              <EmptyBlock
                title="Sin productos seleccionados"
                description="Agrega al menos un producto a la venta usando el botón superior."
              />
            )}
          </div>

          {/* Forma de pago de la corrección */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <label className="mb-2 block text-[10px] font-black uppercase tracking-wider text-slate-600">
              Forma de pago
            </label>
            <Segmented
              value={correctionPaymentKind}
              options={[
                { value: 'cash', label: 'Efectivo' },
                { value: 'qr', label: 'QR' },
                { value: 'credit', label: 'Crédito' },
                { value: 'mixed', label: 'Mixto' },
              ]}
              onChange={(value) => {
                const k = value as PaymentKind
                setCorrectionPaymentKind(k)
                if (k === 'cash') {
                  setCorrectionCashAmount(String(newCorrectionTotal))
                  setCorrectionQrAmount('0')
                  setCorrectionCreditAmount('0')
                } else if (k === 'qr') {
                  setCorrectionCashAmount('0')
                  setCorrectionQrAmount(String(newCorrectionTotal))
                  setCorrectionCreditAmount('0')
                } else if (k === 'credit') {
                  setCorrectionCashAmount('0')
                  setCorrectionQrAmount('0')
                  setCorrectionCreditAmount(String(newCorrectionTotal))
                }
              }}
            />

            {correctionPaymentKind === 'mixed' && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="mb-1 block text-[10px] font-black uppercase text-slate-500">
                    Efectivo (Bs)
                  </label>
                  <NumberInput
                    min={0}
                    step={0.01}
                    value={correctionCashAmount}
                    onChange={(e) => setCorrectionCashAmount(e.target.value)}
                    className="h-8 text-xs font-bold"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-black uppercase text-slate-500">
                    QR (Bs)
                  </label>
                  <NumberInput
                    min={0}
                    step={0.01}
                    value={correctionQrAmount}
                    onChange={(e) => setCorrectionQrAmount(e.target.value)}
                    className="h-8 text-xs font-bold"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-black uppercase text-slate-500">
                    Crédito (Bs)
                  </label>
                  <NumberInput
                    min={0}
                    step={0.01}
                    value={correctionCreditAmount}
                    onChange={(e) => setCorrectionCreditAmount(e.target.value)}
                    className="h-8 text-xs font-bold"
                  />
                </div>
              </div>
            )}

            {correctionPaymentKind === 'credit' && !correctionTarget?.customerId && (
              <p className="mt-2 text-[10px] font-bold text-rose-700">
                Esta venta no tiene cliente registrado. El crédito requiere asignar un cliente.
              </p>
            )}

            <div className="mt-2 flex items-center justify-between border-t border-slate-200/80 pt-2 text-[10px] font-bold text-slate-600">
              <span>Suma de pagos: {formatBs(round2(parsedCorrectionPayments.cash + parsedCorrectionPayments.qr + parsedCorrectionPayments.credit))}</span>
              <span className={Math.abs(newCorrectionTotal - (parsedCorrectionPayments.cash + parsedCorrectionPayments.qr + parsedCorrectionPayments.credit)) > 0.01 ? 'text-rose-700' : 'text-emerald-700'}>
                {Math.abs(newCorrectionTotal - (parsedCorrectionPayments.cash + parsedCorrectionPayments.qr + parsedCorrectionPayments.credit)) > 0.01 ? `Diferencia: ${formatBs(round2(newCorrectionTotal - (parsedCorrectionPayments.cash + parsedCorrectionPayments.qr + parsedCorrectionPayments.credit)))}` : 'Cuadra exacto'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-center">
            <div><p className="text-[9px] font-bold uppercase text-slate-500">Total anterior</p><p className="text-xs font-black">{formatBs(correctionTarget?.total || 0)}</p></div>
            <div><p className="text-[9px] font-bold uppercase text-slate-500">Nuevo total</p><p className="text-xs font-black text-[var(--primary)]">{formatBs(newCorrectionTotal)}</p></div>
            <div><p className="text-[9px] font-bold uppercase text-slate-500">Diferencia</p><p className="text-xs font-black">{formatBs(round2(newCorrectionTotal - (correctionTarget?.total || 0)))}</p></div>
          </div>

          <Field label="Motivo de la corrección" required hint="Explica detalladamente por qué se realiza esta modificación.">
            <TextArea
              value={correctionReason}
              onChange={(e) => setCorrectionReason(e.target.value)}
              placeholder="Ej: Se corrigió la cantidad porque el cliente devolvió 2 paquetes en el momento de entrega."
            />
          </Field>

          {error && <p className="text-xs font-bold text-rose-700">{error}</p>}
        </div>
      </Modal>

      <ChoiceModal
        isOpen={isAddProductPickerOpen}
        onClose={() => setIsAddProductPickerOpen(false)}
        title="Agregar producto a la venta"
        subtitle="Selecciona un producto disponible en tu despacho"
        searchable
        options={addableProducts.map((p) => {
          const stock = availableStock.get(p.id) ?? 0
          return {
            value: p.id,
            label: p.name,
            description: `${getProductPresentation(p) ? `${getProductPresentation(p)} · ` : ''}Disponible: ${formatQty(stock, p.unitType)} · Ref: ${formatBs(p.referencePrice)}`,
          }
        })}
        selectedValue=""
        onSelect={(productId) => {
          const product = data.products.find((p) => p.id === productId)
          if (product) {
            setCorrectionAddedProductIds((prev) => [...prev, product.id])
            setCorrectionQuantities((prev) => ({
              ...prev,
              [product.id]: '1',
            }))
            setCorrectionPrices((prev) => ({
              ...prev,
              [product.id]: String(product.referencePrice),
            }))
          }
          setIsAddProductPickerOpen(false)
        }}
      />

      <Modal
        isOpen={Boolean(correctionTarget) && isReviewingCorrection}
        onClose={() => setIsReviewingCorrection(false)}
        title="Revisar corrección"
        subtitle="Confirma los cambios antes de actualizar la venta"
        size="md"
        footer={
          <div className="grid w-full grid-cols-2 gap-2">
            <SecondaryButton onClick={() => setIsReviewingCorrection(false)}>Volver a editar</SecondaryButton>
            <PrimaryButton disabled={isSubmitting} onClick={() => void submitCorrection()}>
              {isSubmitting ? 'Confirmando...' : 'Confirmar corrección'}
            </PrimaryButton>
          </div>
        }
      >
        {correctionTarget && (
          <div className="space-y-3 text-xs">
            <div className="max-h-[48dvh] space-y-2 overflow-y-auto pr-1">
              {Array.from(correctionOriginalByProduct.values()).filter((originalLine) => !correctionLines.some((line) => line.product.id === originalLine.productId)).map((originalLine) => (
                <div key={originalLine.productId} className="rounded-2xl border border-rose-200 bg-rose-50 p-3">
                  <p className="font-black text-rose-900">{originalLine.productNameSnapshot}</p>
                  <p className="mt-1 font-bold text-rose-800">Cantidad: {formatQty(originalLine.quantity, originalLine.unitType)} → 0</p>
                  <p className="text-slate-600">Precio: {formatBs(originalLine.actualUnitPrice)}</p>
                  <p className="mt-1 font-black text-rose-900">Subtotal: {formatBs(originalLine.subtotal)} → {formatBs(0)}</p>
                </div>
              ))}
              {correctionLines.map((line) => {
                const quantityChanged = Math.abs(line.quantity - line.originalQuantity) > 0.001
                const priceChanged = Math.abs(line.unitPrice - line.originalPrice) > 0.001
                return (
                  <div key={line.product.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                    <p className="font-black text-slate-900">{line.product.name}</p>
                    <p className={quantityChanged ? 'mt-1 font-bold text-amber-800' : 'mt-1 text-slate-600'}>
                      Cantidad cobrada: {formatQty(line.originalQuantity, line.product.unitType)} → {formatQty(line.quantity, line.product.unitType)}
                    </p>
                    {session.role === 'admin' && line.product.unitType === 'kg' && (
                      <p className="font-semibold text-slate-700">
                        Peso físico: {formatQty(line.originalPhysicalQuantity, 'kg')} → {formatQty(line.physicalQuantity, 'kg')} · excedente: {formatQty(Math.max(0, line.physicalQuantity - line.quantity), 'kg')}
                      </p>
                    )}
                    <p className={priceChanged ? 'font-bold text-amber-800' : 'text-slate-600'}>
                      Precio: {formatBs(line.originalPrice)} → {formatBs(line.unitPrice)}
                    </p>
                    <p className="mt-1 font-black text-slate-900">Subtotal corregido: {formatBs(line.subtotal)}</p>
                  </div>
                )
              })}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-3 space-y-1">
              <p className="font-black text-slate-900 mb-1">Forma de pago corregida:</p>
              <p className="text-slate-700">
                Modalidad: <span className="font-bold">{correctionPaymentKind === 'cash' ? 'Efectivo' : correctionPaymentKind === 'qr' ? 'QR' : correctionPaymentKind === 'credit' ? 'Crédito' : 'Mixto'}</span>
              </p>
              <div className="grid grid-cols-3 gap-1 pt-1 text-[11px]">
                <div>Efectivo: <strong>{formatBs(parsedCorrectionPayments.cash)}</strong></div>
                <div>QR: <strong>{formatBs(parsedCorrectionPayments.qr)}</strong></div>
                <div>Crédito: <strong>{formatBs(parsedCorrectionPayments.credit)}</strong></div>
              </div>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
              <p>Total anterior: <strong>{formatBs(correctionTarget.total)}</strong></p>
              <p>Nuevo total: <strong>{formatBs(newCorrectionTotal)}</strong></p>
              <p>Diferencia: <strong>{formatBs(round2(newCorrectionTotal - correctionTarget.total))}</strong></p>
              <p className="mt-2 border-t border-amber-200 pt-2"><strong>Motivo:</strong> {correctionReason.trim()}</p>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal de confirmación para eliminar producto de la venta */}
      <Modal
        isOpen={Boolean(productPendingRemoval)}
        onClose={() => setProductPendingRemoval(null)}
        title="¿Eliminar este producto de la venta?"
        subtitle={productPendingRemoval?.name || ''}
        size="sm"
        footer={
          <div className="flex w-full items-center justify-end gap-2">
            <SecondaryButton onClick={() => setProductPendingRemoval(null)}>
              Cancelar
            </SecondaryButton>
            <button
              type="button"
              onClick={() => {
                if (productPendingRemoval) {
                  setCorrectionQuantities((c) => ({
                    ...c,
                    [productPendingRemoval.id]: '0',
                  }))
                }
                setProductPendingRemoval(null)
              }}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl bg-rose-600 px-4 py-2 text-sm font-bold text-white shadow-xs hover:bg-rose-700 active:scale-[0.98] transition"
            >
              <Trash2 size={16} /> Sí, eliminar producto
            </button>
          </div>
        }
      >
        {productPendingRemoval && (
          <div className="space-y-3">
            <div className="rounded-2xl border border-rose-200 bg-rose-50/80 p-3.5 text-xs text-rose-950">
              <p className="font-extrabold text-sm text-rose-900 mb-1">
                {productPendingRemoval.name}
              </p>
              {getProductPresentation(productPendingRemoval) && (
                <p className="text-[11px] font-semibold text-rose-800 mb-2">
                  {getProductPresentation(productPendingRemoval)}
                </p>
              )}
              {(() => {
                const orig = correctionOriginalByProduct.get(productPendingRemoval.id)
                const origQty = orig?.quantity ?? 0
                return (
                  <div className="space-y-1.5 pt-1 border-t border-rose-200/80">
                    <p className="text-xs font-bold text-slate-800">
                      Cantidad vendida original:{' '}
                      <span className="font-extrabold text-rose-900">
                        {formatQty(origQty, productPendingRemoval.unitType)}
                      </span>
                    </p>
                    <p className="text-[11px] leading-relaxed text-slate-700">
                      Ese producto se retirará de la venta y sus{' '}
                      <strong className="text-slate-900">
                        {formatQty(origQty, productPendingRemoval.unitType)}
                      </strong>{' '}
                      se devolverán automáticamente al stock {correctionTarget?.sourceLocation === 'route' ? 'de la ruta del distribuidor' : 'del almacén central'}.
                    </p>
                  </div>
                )
              })()}
            </div>
            <p className="text-[11px] text-slate-500 italic">
              Podrás restaurar el producto antes de guardar la corrección si fue un error.
            </p>
          </div>
        )}
      </Modal>

      {/* Modal de inspección de auditoría de venta */}
      <Modal
        isOpen={Boolean(auditInspectingSale)}
        onClose={() => setAuditInspectingSale(null)}
        title="Auditoría de corrección de venta"
        subtitle={
          auditInspectingSale
            ? `${auditInspectingSale.customerName || 'Contado sin cliente'} · ${new Date(auditInspectingSale.createdAt).toLocaleString('es-BO')}`
            : ''
        }
        size="md"
        footer={
          <SecondaryButton full onClick={() => setAuditInspectingSale(null)}>
            Cerrar detalle
          </SecondaryButton>
        }
      >
        {auditInspectingSale && (() => {
          const audit = getSaleAuditSummary(auditInspectingSale)
          return (
            <div className="space-y-4 text-xs">
              {/* Resumen de cambios financieros */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-2.5">
                  <p className="text-[10px] font-bold text-slate-500 uppercase">Total Original</p>
                  <p className="text-base font-extrabold text-slate-800">{formatBs(audit.totalBefore)}</p>
                </div>
                <div className="rounded-2xl border border-amber-300 bg-amber-50 p-2.5">
                  <p className="text-[10px] font-bold text-amber-800 uppercase">Total Corregido</p>
                  <p className="text-base font-extrabold text-amber-950">{formatBs(audit.totalAfter)}</p>
                  {audit.moneyDelta !== 0 && (
                    <p className={`text-[10px] font-black ${audit.moneyDelta < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                      {audit.moneyDelta > 0 ? `+${formatBs(audit.moneyDelta)}` : formatBs(audit.moneyDelta)}
                    </p>
                  )}
                </div>
              </div>

              {/* Metadatos de la corrección */}
              <div className="rounded-2xl border border-slate-200 bg-white p-3 space-y-1.5 shadow-2xs">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-bold text-slate-500">Revisión:</span>
                  <span className="font-black text-slate-900">Rev. {audit.revisionNumber}</span>
                </div>
                {audit.correctedAt && (
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-bold text-slate-500">Fecha y hora:</span>
                    <span className="font-semibold text-slate-800">
                      {new Date(audit.correctedAt).toLocaleString('es-BO')}
                    </span>
                  </div>
                )}
                {audit.correctedBy && (
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-bold text-slate-500">Corregido por:</span>
                    <span className="font-semibold text-slate-800">{audit.correctedBy}</span>
                  </div>
                )}
                {audit.reason && (
                  <div className="pt-1.5 border-t border-slate-100">
                    <span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Motivo:</span>
                    <p className="rounded-xl bg-slate-50 p-2 text-[11px] font-medium text-slate-800 italic">
                      "{audit.reason}"
                    </p>
                  </div>
                )}
              </div>

              {/* Detalle línea por línea */}
              <div>
                <p className="mb-2 text-[11px] font-extrabold uppercase text-slate-600 tracking-wider">
                  Detalle de productos ({audit.lineChanges.length})
                </p>
                <div className="space-y-2">
                  {audit.lineChanges.map((change) => {
                    const isEliminated = change.status === 'eliminated'
                    const isModified = change.status === 'modified'
                    const isAdded = change.status === 'added'
                    return (
                      <div
                        key={change.productId}
                        className={`rounded-2xl border p-2.5 transition ${
                          isEliminated
                            ? 'border-rose-200 bg-rose-50/60'
                            : isModified
                            ? 'border-amber-200 bg-amber-50/60'
                            : isAdded
                            ? 'border-emerald-200 bg-emerald-50/60'
                            : 'border-slate-200 bg-slate-50/40'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className={`font-bold text-xs ${isEliminated ? 'line-through text-slate-500' : 'text-slate-900'}`}>
                              {change.productName}
                            </p>
                            {change.presentation && (
                              <p className="text-[10px] text-slate-500">{change.presentation}</p>
                            )}
                          </div>
                          <div>
                            {isEliminated && (
                              <span className="rounded-full border border-rose-300 bg-rose-100 px-2 py-0.5 text-[9px] font-black uppercase text-rose-800">
                                ELIMINADO EN CORRECCIÓN
                              </span>
                            )}
                            {isModified && (
                              <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[9px] font-black uppercase text-amber-800">
                                MODIFICADO
                              </span>
                            )}
                            {isAdded && (
                              <span className="rounded-full border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-[9px] font-black uppercase text-emerald-800">
                                AGREGADO
                              </span>
                            )}
                            {!isEliminated && !isModified && !isAdded && (
                              <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[9px] font-bold text-slate-500">
                                SIN CAMBIO
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="mt-1.5 flex items-center justify-between text-[11px] pt-1.5 border-t border-slate-200/50">
                          <span className="text-slate-500 font-semibold">
                            {isEliminated ? (
                              <>
                                Vendido: <span className="font-bold text-slate-700">{formatQty(change.qtyBefore, change.unitType as UnitType)}</span> → <span className="font-bold text-rose-700">0</span>
                              </>
                            ) : isModified ? (
                              <>
                                Cantidad: <span className="line-through text-slate-400">{formatQty(change.qtyBefore, change.unitType as UnitType)}</span>{' '}
                                <span className="font-bold text-amber-900">→ {formatQty(change.qtyAfter, change.unitType as UnitType)}</span>
                              </>
                            ) : isAdded ? (
                              <>
                                Nueva cantidad: <span className="font-bold text-emerald-800">+{formatQty(change.qtyAfter, change.unitType as UnitType)}</span>
                              </>
                            ) : (
                              <span>Cantidad: {formatQty(change.qtyAfter, change.unitType as UnitType)}</span>
                            )}
                          </span>

                          {change.returnedStockToRoute > 0 && (
                            <span className="font-extrabold text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-lg text-[10px]">
                              +{formatQty(change.returnedStockToRoute, change.unitType as UnitType)} devueltos a {auditInspectingSale.sourceLocation === 'route' ? 'ruta' : 'central'}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 grid grid-cols-1 gap-0.5 text-[10px] font-semibold text-slate-600">
                          <p>Precio: <span className={Math.abs(change.priceAfter - change.priceBefore) > 0.001 ? 'font-black text-amber-900' : ''}>{formatBs(change.priceBefore)} → {formatBs(change.priceAfter)}</span></p>
                          <p>Subtotal: <span className={Math.abs(change.subtotalAfter - change.subtotalBefore) > 0.001 ? 'font-black text-amber-900' : ''}>{formatBs(change.subtotalBefore)} → {formatBs(change.subtotalAfter)}</span></p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })()}
      </Modal>

      <Modal
        isOpen={Boolean(lastSale)}
        onClose={resetSale}
        title={lastSale?.saleKind === 'courtesy' ? 'Cortesía registrada' : 'Venta registrada'}
        subtitle={lastSale ? formatBs(lastSale.total) : ''}
        footer={
          <PrimaryButton full onClick={resetSale}>
            <Plus size={16} /> Nueva venta
          </PrimaryButton>
        }
      >
        {lastSale && (
          <div className="grid gap-3">
            {lastSale.pendingConfirmation && <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">Pendiente de sincronizar. La venta quedó guardada en este dispositivo; el servidor todavía debe confirmarla.</p>}
            <div className="grid grid-cols-2 gap-2">
            <KpiCard label={lastSale.saleKind === 'courtesy' ? 'Total cobrado' : 'Total'} value={formatBs(lastSale.total)} tone="primary" />
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
            <SecondaryButton full disabled={isSharing} onClick={() => { setIsSharing(true); setShareFeedback(''); void shareSaleReceipt(lastSale, receiptContext).then(shared => setShareFeedback(shared ? 'Se abrieron las opciones para compartir.' : 'Se canceló el envío.')).catch(shareError => setShareFeedback((shareError as Error).message)).finally(() => setIsSharing(false)) }}>
              <Send size={16} /> {isSharing ? 'Preparando imagen...' : 'Compartir por WhatsApp'}
            </SecondaryButton>
            {shareFeedback && <p className="rounded-xl bg-slate-50 p-2 text-xs font-bold text-slate-700">{shareFeedback}</p>}
            {session.role === 'admin' && <SecondaryButton full onClick={() => void printLargeSaleReceipt(lastSale, receiptContext).catch(printError => setShareFeedback((printError as Error).message))}><Printer size={16} /> Imprimir en hoja normal</SecondaryButton>}
          </div>
        )}
      </Modal>
    </Screen>
  )
}
