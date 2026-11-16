import type { DistLot, DistProduct, DistRoute, DistSale, DistStockMovement, UnitType } from '../types.ts'
import { round2 } from './engine.ts'

export interface LotTraceCustomerDelivery {
  saleId: string
  createdAt: string
  customerName: string
  customerId?: string
  deliveredQuantity: number
  unitType: UnitType
  sellerName?: string
  routeName?: string
  status?: string
  totalAmount?: number
  paymentMethod?: string
  receiptNumber?: string
  note?: string
}

export type LotTimelineStepType = 'intake' | 'dispatch' | 'sale' | 'return' | 'waste' | 'adjustment' | 'other'

export interface LotTimelineEvent {
  id: string
  stepType: LotTimelineStepType
  date: string
  label: string
  quantity: number
  unitType: UnitType
  from?: string
  to?: string
  routeName?: string
  responsibleName?: string
  customerName?: string
  saleId?: string
  note?: string
  reversedAt?: string
}

export interface LotTraceabilitySummary {
  intakeQuantity: number
  currentStock: number
  currentStockByLocation: Record<string, number>
  dispatchedQuantity: number
  soldQuantity: number
  returnedQuantity: number
  wasteQuantity: number
  adjustmentsQuantity: number
}

export interface LotTraceabilityData {
  lot: DistLot
  product?: DistProduct
  identification: {
    productId: string
    productName: string
    lotCode: string
    manufacturedOn?: string
    expiresOn?: string
    unitType: UnitType
    productionCost?: number
    intakeDate?: string
    initialIntakeQuantity: number
    isProcessingLot: boolean
    batchId?: string
  }
  summary: LotTraceabilitySummary
  deliveries: LotTraceCustomerDelivery[]
  timeline: LotTimelineEvent[]
}

export function lotAllocatedQuantity(movement: DistStockMovement, lotId: string, lotCode?: string): number {
  if (Array.isArray(movement.allocations) && movement.allocations.length > 0) {
    const alloc = movement.allocations.find((a) => a.lotId === lotId || (lotCode && a.lotCode === lotCode))
    if (alloc && Number(alloc.quantity) > 0) return Number(alloc.quantity)
  }
  if (movement.lotId === lotId || (lotCode && movement.lotCode === lotCode)) {
    return Number(movement.quantity || 0)
  }
  return 0
}

export function isMovementRelatedToLot(movement: DistStockMovement, lotId: string, lotCode?: string): boolean {
  if (movement.lotId === lotId || (lotCode && movement.lotCode === lotCode)) return true
  if (Array.isArray(movement.allocations) && movement.allocations.some((a) => a.lotId === lotId || (lotCode && a.lotCode === lotCode))) {
    return true
  }
  return false
}

export function buildLotTraceability(params: {
  lot: DistLot
  product?: DistProduct
  movements: DistStockMovement[]
  salesById?: Record<string, DistSale>
  routes?: DistRoute[]
}): LotTraceabilityData {
  const { lot, product, movements, salesById = {}, routes = [] } = params
  const unitType = product?.unitType || lot.unitType || 'unit'
  const lotCode = lot.lotCode?.trim() || 'Sin código'
  const lotId = lot.id

  // 1. Filter movements directly related to this lot
  const relatedMovements = movements.filter((m) => isMovementRelatedToLot(m, lotId, lotCode))

  // 2. Sort chronologically (oldest to newest)
  const sortedMovements = [...relatedMovements].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))

  // 3. Initial Intake quantity
  let initialIntakeQuantity = 0
  if (Number(lot.processingPackageWeightLedger?.packageCount || 0) > 0) {
    initialIntakeQuantity = Number(lot.processingPackageWeightLedger?.packageCount)
  } else {
    const intakeMoves = sortedMovements.filter((m) => ['intake', 'processing_output', 'quarantine_release'].includes(m.type))
    if (intakeMoves.length > 0) {
      initialIntakeQuantity = intakeMoves.reduce((sum, m) => sum + lotAllocatedQuantity(m, lotId, lotCode), 0)
    }
  }

  // 4. Current stock from lot quantities map
  let currentStock = 0
  const currentStockByLocation: Record<string, number> = {}
  if (lot.quantities && typeof lot.quantities === 'object') {
    for (const [loc, val] of Object.entries(lot.quantities)) {
      const q = Number(val || 0)
      currentStockByLocation[loc] = q
      currentStock += q
    }
  }
  currentStock = round2(currentStock)

  // 5. Build deliveries ("¿A quiénes se entregó?")
  const deliveries: LotTraceCustomerDelivery[] = []
  let soldQuantity = 0
  let dispatchedQuantity = 0
  let returnedQuantity = 0
  let wasteQuantity = 0
  let adjustmentsQuantity = 0

  const routeName = (routeId?: string) => {
    if (!routeId) return undefined
    return routes.find((r) => r.id === routeId)?.name || `Ruta ${routeId}`
  }

  const timeline: LotTimelineEvent[] = []

  for (const m of sortedMovements) {
    const allocQty = lotAllocatedQuantity(m, lotId, lotCode)
    const qty = allocQty > 0 ? allocQty : Number(m.quantity || 0)

    let stepType: LotTimelineStepType = 'other'
    let stepLabel: string = m.type

    if (m.type === 'intake' || m.type === 'processing_output') {
      stepType = 'intake'
      stepLabel = m.type === 'processing_output' ? 'Ingreso por elaboración (Sacheteado)' : 'Ingreso inicial a almacén'
    } else if (m.type === 'dispatch' || m.type === 'dispatch_addition') {
      stepType = 'dispatch'
      stepLabel = m.type === 'dispatch_addition' ? 'Aumento de carga a ruta' : 'Despacho a ruta'
      dispatchedQuantity = round2(dispatchedQuantity + qty)
    } else if (m.type === 'sale') {
      stepType = 'sale'
      stepLabel = 'Venta realizada'
      soldQuantity = round2(soldQuantity + qty)

      const saleId = m.refId || m.saleId || m.id
      const sale = salesById[saleId]
      const rawCustomerName = sale?.customerName?.trim() || m.customerName?.trim()
      const customerName = rawCustomerName ? rawCustomerName : 'Venta sin cliente registrado'
      const customerId = sale?.customerId || m.customerId
      const sellerName = sale?.sellerName || m.responsibleName || 'Vendedor'
      const paymentMethod = sale?.paymentKind || 'cash'
      const status = sale?.voidedAt ? 'Anulado' : sale?.pendingConfirmation ? 'Pendiente' : 'Confirmado'

      deliveries.push({
        saleId,
        createdAt: m.createdAt,
        customerName,
        customerId,
        deliveredQuantity: qty,
        unitType,
        sellerName,
        routeName: routeName(m.routeId || sale?.routeId),
        status,
        totalAmount: sale?.total,
        paymentMethod,
        receiptNumber: sale?.operationId || sale?.id,
        note: m.note || sale?.note,
      })
    } else if (['return', 'customer_return', 'return_merma'].includes(m.type)) {
      stepType = 'return'
      stepLabel = m.type === 'customer_return' ? 'Devolución de cliente' : m.type === 'return_merma' ? 'Retorno de merma recuperable' : 'Retorno de ruta a almacén'
      returnedQuantity = round2(returnedQuantity + qty)
    } else if (['dispatch_waste', 'return_waste', 'return_waste_unassigned', 'quarantine_discard', 'processing_discard', 'shortage'].includes(m.type)) {
      stepType = 'waste'
      stepLabel = m.type === 'dispatch_waste' ? 'Merma confirmada al despachar' : m.type === 'shortage' ? 'Faltante de inventario' : 'Pérdida / descarte físico confirmado'
      wasteQuantity = round2(wasteQuantity + qty)
    } else if (['adjustment', 'transfer', 'processing_commercial_rectification', 'overage'].includes(m.type)) {
      stepType = 'adjustment'
      stepLabel = m.type === 'transfer' ? 'Transferencia interna' : m.type === 'overage' ? 'Sobrante en cierre' : 'Ajuste manual de inventario'
      adjustmentsQuantity = round2(adjustmentsQuantity + qty)
    }

    const sale = m.refId ? salesById[m.refId] : undefined
    const customer = sale?.customerName?.trim() || m.customerName?.trim()

    timeline.push({
      id: m.id,
      stepType,
      date: m.createdAt,
      label: stepLabel,
      quantity: qty,
      unitType,
      from: m.fromLocation,
      to: m.toLocation,
      routeName: routeName(m.routeId || sale?.routeId),
      responsibleName: m.responsibleName,
      customerName: customer ? customer : m.type === 'sale' ? 'Venta sin cliente registrado' : undefined,
      saleId: m.refId || m.saleId,
      note: m.note,
      reversedAt: m.reversedAt,
    })
  }

  // If initial intake was not captured by movements but lot exists
  if (initialIntakeQuantity === 0 && (soldQuantity > 0 || currentStock > 0 || dispatchedQuantity > 0)) {
    initialIntakeQuantity = round2(currentStock + soldQuantity + wasteQuantity - returnedQuantity)
  }

  return {
    lot,
    product,
    identification: {
      productId: lot.productId,
      productName: product?.name || lot.productName || 'Producto',
      lotCode,
      manufacturedOn: lot.manufacturedOn,
      expiresOn: lot.expiresOn,
      unitType,
      productionCost: lot.productionCost ?? undefined,
      intakeDate: lot.createdAt,
      initialIntakeQuantity,
      isProcessingLot: Boolean(lot.id?.startsWith('processing_') || lot.processingBatchId),
      batchId: lot.processingBatchId,
    },
    summary: {
      intakeQuantity: initialIntakeQuantity,
      currentStock,
      currentStockByLocation,
      dispatchedQuantity,
      soldQuantity,
      returnedQuantity,
      wasteQuantity,
      adjustmentsQuantity,
    },
    deliveries,
    timeline,
  }
}
