import { matchesRoute, toDayKey } from './engine.ts'
import type { DistClosure, DistDispatch, DistLot, DistProduct, DistRoute, DistSale, DistStockMovement, UnitType } from '../types.ts'

export type MermaReportKind = 'dispatch_merma' | 'dispatch_waste' | 'return_merma' | 'unfit' | 'shortage' | 'overage' | 'admin_sale_excess'
export type MermaReviewState = 'reintegrated_stock' | 'recorded_not_reintegrated' | 'quarantine_released' | 'quarantine_discarded' | 'quarantine_rectified' | 'quarantine_resolution_unknown' | 'confirmed_loss' | 'physical_difference' | 'pending_review' | 'informational'
export interface MermaQuantities { kg: number; package: number; unit: number }

export interface MermaDispatchReconciliationRow {
  dispatchId: string; dayKey: string; routeId: string; routeName: string; distributorUid: string; distributorName: string
  productId: string; productName: string; unitType: UnitType; expectedReturn: number | null; physicalReturn: number | null
  dispatchMermaSent: number; recoverableMermaRecordedAtWarehouse: number; recoverableMermaReturnedToStock: number; recoverableMermaStockGap: number
  legacyDispatchWastePending: number; legacyWasteReturnDifferenceCandidate: number; unreturnedNewMermaPending: number; shortage: number; overage: number
}

export interface MermaConsolidatedSummary {
  dispatchMermaSent: MermaQuantities; recoverableMermaRecordedAtWarehouse: MermaQuantities
  recoverableMermaReturnedToStock: MermaQuantities; recoverableMermaStockGap: MermaQuantities; unreturnedNewMermaPending: MermaQuantities
  legacyDispatchWastePending: MermaQuantities; legacyDispatchWasteCost: { amount: number | null; complete: boolean }
  legacyWasteReturnDifferenceCandidate: MermaQuantities
  confirmedUnfit: MermaQuantities; confirmedUnfitCost: { amount: number | null; complete: boolean }
  shortage: MermaQuantities; overagePendingReview: MermaQuantities; overageResolved: MermaQuantities
  overageReleasedToSellable: MermaQuantities; overageDiscarded: MermaQuantities; overageOtherResolved: MermaQuantities
  overageStatusUnknown: MermaQuantities; administrativeExcess: MermaQuantities
  byDispatchProduct: MermaDispatchReconciliationRow[]
}

export interface MermaReportRow {
  id: string
  dayKey: string
  createdAt: string
  kind: MermaReportKind
  label: string
  productId: string
  productName: string
  unitType: UnitType
  quantity: number
  physicalQuantity: number
  normalQuantity?: number
  dispatchMerma?: number
  chargedQuantity?: number
  excessWeightQuantity?: number
  saleReference?: string
  lotId?: string
  routeId: string
  routeName: string
  distributorUid: string
  distributorName: string
  lotCode: string
  note: string
  reason: string
  lossCost: number | null
  quarantineResolution?: DistLot['quarantineResolution']
  quarantineResolvedAt?: string
  quarantineResolvedByName?: string
  quarantineDestinationLotCode?: string
  reversed: boolean
  dispatchId: string
  reviewState: MermaReviewState
}

export interface MermaReportFilters {
  dayKeys: string[]
  routeId?: string
  distributorUid?: string
  productId?: string
  kind?: MermaReportKind | 'all'
  warehouseId?: string
}

export interface MermaReportResult {
  rows: MermaReportRow[]
  byProduct: Array<{ productId: string; productName: string; unitType: UnitType; dispatchMerma: number; dispatchWaste: number; returnMerma: number; returnMermaStockConfirmed: number; unfit: number; shortage: number; overage: number; adminSaleExcess: number }>
  byRoute: Array<{ routeId: string; routeName: string; unitType: UnitType; dispatchMerma: number; dispatchWaste: number; returnMerma: number; returnMermaStockConfirmed: number; unfit: number; shortage: number; overage: number; adminSaleExcess: number }>
  byDate: Array<{ dayKey: string; unitType: UnitType; dispatchMerma: number; dispatchWaste: number; returnMerma: number; returnMermaStockConfirmed: number; unfit: number; shortage: number; overage: number; adminSaleExcess: number }>
  byWeek: Array<{ periodKey: string; unitType: UnitType; dispatchMerma: number; dispatchWaste: number; returnMerma: number; returnMermaStockConfirmed: number; unfit: number; shortage: number; overage: number; adminSaleExcess: number }>
  byMonth: Array<{ periodKey: string; unitType: UnitType; dispatchMerma: number; dispatchWaste: number; returnMerma: number; returnMermaStockConfirmed: number; unfit: number; shortage: number; overage: number; adminSaleExcess: number }>
  totals: Record<MermaReportKind, { kg: number; package: number; unit: number }>
  consolidated: MermaConsolidatedSummary
}

const labels: Record<MermaReportKind, string> = {
  dispatch_merma: 'Merma adicional recuperable en despacho',
  dispatch_waste: 'Merma histórica registrada al despachar · pendiente de validar',
  return_merma: 'Merma recuperable al retorno',
  unfit: 'Producto no apto / pérdida',
  shortage: 'Faltante',
  overage: 'Sobrante',
  admin_sale_excess: 'Excedente de peso en ventas de Administración',
}

function roundQuantity(value: number, unitType: UnitType): number {
  const scale = unitType === 'kg' ? 1000 : 100
  return Math.round((Number(value) || 0) * scale) / scale
}

function kindForMovement(movement: DistStockMovement): MermaReportKind | null {
  if ((movement.type === 'dispatch' || movement.type === 'dispatch_addition') && Number(movement.dispatchMerma) > 0) return 'dispatch_merma'
  if (movement.type === 'dispatch_waste') return 'dispatch_waste'
  if (movement.type === 'return_merma') return 'return_merma'
  if (movement.type === 'return_waste' || movement.type === 'return_waste_unassigned') return 'unfit'
  if (movement.type === 'shortage') return 'shortage'
  if (movement.type === 'overage') return 'overage'
  return null
}

/** Ledger canonical: each event appears once; dispatchMerma is a component of dispatch movements, not a second movement. */
export function computeMermaReport(
  movements: DistStockMovement[],
  products: DistProduct[],
  routes: DistRoute[],
  closures: DistClosure[],
  filters: MermaReportFilters,
  openDispatches: DistDispatch[] = [],
  sales: DistSale[] = [],
  lots: DistLot[] = [],
): MermaReportResult {
  const closureByDispatch = new Map(closures.filter((closure) => closure.dispatchId).map((closure) => [closure.dispatchId, closure]))
  const openDispatchById = new Map(openDispatches.map((dispatch) => [dispatch.id, dispatch]))
  const routeById = new Map(routes.map((route) => [route.id, route]))
  const productById = new Map(products.map((product) => [product.id, product]))
  const saleById = new Map(sales.map((sale) => [sale.id, sale]))
  const voidedSaleIds = new Set(movements.filter((movement) => movement.type === 'sale_void').map((movement) => (movement as DistStockMovement & { saleId?: string }).saleId || movement.refId || '').filter(Boolean))
  const rows = movements.flatMap((movement): MermaReportRow[] => {
    // Keep the original overage auditable, but exclude it from active summaries
    // after its fictitious quantity has been rectified.
    if (movement.rectifiedAt || movement.rectifiedByMovementId) return []
    const saleId = movement.refId || ''
    const linkedSale = movement.type === 'sale' ? saleById.get(saleId) : undefined
    const currentLines = linkedSale?.effectiveSnapshot?.lines || linkedSale?.lines || []
    const currentLine = linkedSale ? currentLines.filter((line) => line.productId === movement.productId).reduce((combined, line) => ({
      ...combined,
      quantity: combined.quantity + Number(line.quantity || 0),
      physicalQuantity: combined.physicalQuantity + Number(line.physicalQuantity ?? line.quantity ?? 0),
      allocations: [...combined.allocations, ...(line.allocations || [])],
    }), { quantity: 0, physicalQuantity: 0, allocations: [] as NonNullable<DistSale['lines'][number]['allocations']> }) : undefined
    const saleRouteId = linkedSale?.routeId || movement.routeId || ''
    const isAdminSale = movement.type === 'sale' && (saleRouteId === 'admin' || saleRouteId === 'administracion')
    const currentExcess = linkedSale ? (currentLine ? Math.max(0, currentLine.physicalQuantity - currentLine.quantity) : 0) : Number(movement.excessWeightQuantity || 0)
    const isActiveSale = !linkedSale?.voidedAt && !linkedSale?.pendingConfirmation && !voidedSaleIds.has(saleId)
    const kind = isAdminSale && isActiveSale && currentExcess > 0 ? 'admin_sale_excess' : kindForMovement(movement)
    if (!kind || movement.reversedAt || movement.pendingConfirmation) return []
    const dayKey = movement.dayKey || toDayKey(movement.createdAt)
    if (!filters.dayKeys.includes(dayKey)) return []
    if (filters.kind && filters.kind !== 'all' && kind !== filters.kind) return []
    if (filters.productId && movement.productId !== filters.productId) return []
    const dispatchKey = movement.dispatchId || movement.refId || ''
    const closure = closureByDispatch.get(dispatchKey)
    const dispatch = openDispatchById.get(dispatchKey)
    const routeId = linkedSale?.routeId || movement.routeId || closure?.routeId || dispatch?.routeId || ''
    if (filters.routeId && !matchesRoute(routeId, filters.routeId)) return []
    if (filters.distributorUid && (linkedSale ? linkedSale.sellerUid !== filters.distributorUid : closure?.distributorUid !== filters.distributorUid)) return []
    const route = routeById.get(routeId)
    const product = productById.get(movement.productId)
    const warehouseId = closure?.warehouseId || warehouseFromLocation(movement.fromLocation) || warehouseFromLocation(movement.toLocation) || 'central'
    if (filters.warehouseId && warehouseId !== filters.warehouseId) return []
    const quantity = kind === 'dispatch_merma' ? Number(movement.dispatchMerma) : kind === 'admin_sale_excess' ? currentExcess : Number(movement.quantity)
    const physicalQuantity = kind === 'admin_sale_excess' && currentLine ? currentLine.physicalQuantity : Number(movement.quantity) || 0
    const chargedQuantity = kind === 'admin_sale_excess' && currentLine ? currentLine.quantity : Number(movement.chargedQuantity ?? (physicalQuantity - quantity))
    const costAllocations = currentLine?.allocations || (movement as DistStockMovement & { allocations?: NonNullable<DistSale['lines'][number]['allocations']> }).allocations || []
    const allocatedQuantity = costAllocations.reduce((sum, allocation) => sum + Number(allocation.quantity || 0), 0)
    const allocationCosts = costAllocations.map((allocation) => allocation.productionCost)
    const exactUnitCost = allocationCosts.length > 0 && allocationCosts.every((cost) => typeof cost === 'number' && Number.isFinite(cost)) && allocationCosts.every((cost) => cost === allocationCosts[0])
      ? Number(allocationCosts[0])
      : null
    const excessCost = kind === 'admin_sale_excess' && allocatedQuantity > 0 && exactUnitCost !== null
      ? roundQuantity(quantity * exactUnitCost, movement.unitType || product?.unitType || 'unit')
      : null
    const linkedLot = movement.lotId ? lots.find((lot) => lot.id === movement.lotId) : undefined
    const reviewState: MermaReviewState = kind === 'return_merma' ? (Number(movement.centralDelta) > 0 ? 'reintegrated_stock' : 'recorded_not_reintegrated')
      : kind === 'dispatch_merma' ? 'pending_review'
      : kind === 'unfit' ? 'confirmed_loss'
        : kind === 'shortage' ? 'physical_difference'
          : kind === 'overage' ? (linkedLot?.quarantineResolution === 'released_existing_lot' || linkedLot?.quarantineResolution === 'released_new_lot' ? 'quarantine_released'
            : linkedLot?.quarantineResolution === 'discarded' ? 'quarantine_discarded'
              : linkedLot?.quarantineResolution === 'rectified_input_error' ? 'quarantine_rectified'
                : linkedLot?.quarantineResolvedAt ? 'quarantine_resolution_unknown' : 'pending_review')
            : kind === 'dispatch_waste' ? 'pending_review' : 'informational'
    return [{
      id: movement.id, dayKey, createdAt: movement.createdAt, kind, label: labels[kind],
      productId: movement.productId, productName: movement.productName || product?.name || 'Producto',
      unitType: movement.unitType || product?.unitType || 'unit', quantity: roundQuantity(quantity, movement.unitType || product?.unitType || 'unit'),
      physicalQuantity, normalQuantity: movement.normalQuantity, dispatchMerma: movement.dispatchMerma,
      chargedQuantity: kind === 'admin_sale_excess' ? roundQuantity(chargedQuantity, movement.unitType || product?.unitType || 'unit') : undefined,
      excessWeightQuantity: kind === 'admin_sale_excess' ? roundQuantity(quantity, movement.unitType || product?.unitType || 'unit') : undefined,
      saleReference: kind === 'admin_sale_excess' ? saleId : undefined,
      lotId: movement.lotId,
      routeId, routeName: route?.name || linkedSale?.routeName || closure?.routeName || dispatch?.routeName || (routeId === 'admin' || routeId === 'administracion' ? 'Administración' : routeId === 'route-impulsacion' || routeId === 'route-directa' ? 'Impulsación' : 'Ruta no disponible'),
      distributorUid: linkedSale?.sellerUid || closure?.distributorUid || dispatch?.distributorUid || '', distributorName: linkedSale?.sellerName || closure?.distributorName || dispatch?.distributorName || movement.responsibleName || 'No disponible',
      lotCode: movement.lotCode || '', note: movement.note || '', reason: (movement as DistStockMovement & { reason?: string }).reason || '',
      lossCost: kind === 'admin_sale_excess' ? excessCost : kind === 'unfit' || kind === 'shortage' || kind === 'dispatch_waste' ? (typeof movement.lossCost === 'number' && Number.isFinite(movement.lossCost) ? movement.lossCost : null) : null,
      quarantineResolution: linkedLot?.quarantineResolution,
      quarantineResolvedAt: linkedLot?.quarantineResolvedAt,
      quarantineResolvedByName: linkedLot?.quarantineResolvedByName,
      quarantineDestinationLotCode: linkedLot?.quarantineDestinationLotCode,
      reversed: false, dispatchId: movement.dispatchId || movement.refId || '', reviewState,
    }]
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  const totals: MermaReportResult['totals'] = {
    dispatch_merma: { kg: 0, package: 0, unit: 0 }, dispatch_waste: { kg: 0, package: 0, unit: 0 },
    return_merma: { kg: 0, package: 0, unit: 0 }, unfit: { kg: 0, package: 0, unit: 0 }, shortage: { kg: 0, package: 0, unit: 0 }, overage: { kg: 0, package: 0, unit: 0 }, admin_sale_excess: { kg: 0, package: 0, unit: 0 },
  }
  const byProductMap = new Map<string, MermaReportResult['byProduct'][number]>()
  const byRouteMap = new Map<string, MermaReportResult['byRoute'][number]>()
  const byDateMap = new Map<string, MermaReportResult['byDate'][number]>()
  for (const row of rows) {
    totals[row.kind][row.unitType] = roundQuantity(totals[row.kind][row.unitType] + row.quantity, row.unitType)
    const product = byProductMap.get(row.productId) || { productId: row.productId, productName: row.productName, unitType: row.unitType, dispatchMerma: 0, dispatchWaste: 0, returnMerma: 0, returnMermaStockConfirmed: 0, unfit: 0, shortage: 0, overage: 0, adminSaleExcess: 0 }
    const productKey = row.kind === 'dispatch_merma' ? 'dispatchMerma' : row.kind === 'dispatch_waste' ? 'dispatchWaste' : row.kind === 'return_merma' ? 'returnMerma' : row.kind === 'admin_sale_excess' ? 'adminSaleExcess' : row.kind
    product[productKey] = roundQuantity(product[productKey] + row.quantity, row.unitType)
    if (row.kind === 'return_merma' && row.reviewState === 'reintegrated_stock') product.returnMermaStockConfirmed = roundQuantity(product.returnMermaStockConfirmed + row.quantity, row.unitType)
    byProductMap.set(row.productId, product)
    const routeKey = `${row.routeId}__${row.unitType}`
    const route = byRouteMap.get(routeKey) || { routeId: row.routeId, routeName: row.routeName, unitType: row.unitType, dispatchMerma: 0, dispatchWaste: 0, returnMerma: 0, returnMermaStockConfirmed: 0, unfit: 0, shortage: 0, overage: 0, adminSaleExcess: 0 }
    route[productKey] = roundQuantity(route[productKey] + row.quantity, row.unitType)
    if (row.kind === 'return_merma' && row.reviewState === 'reintegrated_stock') route.returnMermaStockConfirmed = roundQuantity(route.returnMermaStockConfirmed + row.quantity, row.unitType)
    byRouteMap.set(routeKey, route)
    const dateKey = `${row.dayKey}__${row.unitType}`
    const date = byDateMap.get(dateKey) || { dayKey: row.dayKey, unitType: row.unitType, dispatchMerma: 0, dispatchWaste: 0, returnMerma: 0, returnMermaStockConfirmed: 0, unfit: 0, shortage: 0, overage: 0, adminSaleExcess: 0 }
    date[productKey] = roundQuantity(date[productKey] + row.quantity, row.unitType)
    if (row.kind === 'return_merma' && row.reviewState === 'reintegrated_stock') date.returnMermaStockConfirmed = roundQuantity(date.returnMermaStockConfirmed + row.quantity, row.unitType)
    byDateMap.set(dateKey, date)
  }
  const byDate = [...byDateMap.values()].sort((a, b) => a.dayKey.localeCompare(b.dayKey))
  const byWeek = aggregateDates(byDate, weekKey)
  const byMonth = aggregateDates(byDate, (dayKey) => dayKey.slice(0, 7))
  const consolidated = consolidateMermaReport(rows, closures, filters, lots)
  return { rows, totals, consolidated, byProduct: [...byProductMap.values()].sort((a, b) => a.productName.localeCompare(b.productName)), byRoute: [...byRouteMap.values()].sort((a, b) => a.routeName.localeCompare(b.routeName)), byDate, byWeek, byMonth }
}

export function mermaReportKindLabel(kind: MermaReportKind): string { return labels[kind] }

function warehouseFromLocation(location?: string): string | null {
  if (!location) return null
  if (location === 'central') return 'central'
  return location.startsWith('warehouse__') ? location.slice('warehouse__'.length) : null
}

function emptyQuantities(): MermaQuantities { return { kg: 0, package: 0, unit: 0 } }
function addQuantity(target: MermaQuantities, unitType: UnitType, quantity: number): void {
  target[unitType] = roundQuantity(target[unitType] + quantity, unitType)
}

function weekKey(dayKey: string): string {
  const date = new Date(`${dayKey}T00:00:00.000Z`)
  const weekday = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - weekday)
  const year = date.getUTCFullYear()
  const yearStart = new Date(Date.UTC(year, 0, 1))
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${year}-S${String(week).padStart(2, '0')}`
}

function aggregateDates<T extends { dayKey: string; unitType: UnitType; dispatchMerma: number; dispatchWaste: number; returnMerma: number; returnMermaStockConfirmed: number; unfit: number; shortage: number; overage: number; adminSaleExcess: number }>(
  dates: T[], keyForDay: (dayKey: string) => string,
): Array<Omit<T, 'dayKey'> & { periodKey: string }> {
  const grouped = new Map<string, Omit<T, 'dayKey'> & { periodKey: string }>()
  for (const row of dates) {
    const periodKey = keyForDay(row.dayKey)
    const key = `${periodKey}__${row.unitType}`
    const current = grouped.get(key) || { periodKey, unitType: row.unitType, dispatchMerma: 0, dispatchWaste: 0, returnMerma: 0, returnMermaStockConfirmed: 0, unfit: 0, shortage: 0, overage: 0, adminSaleExcess: 0 } as Omit<T, 'dayKey'> & { periodKey: string }
    for (const field of ['dispatchMerma', 'dispatchWaste', 'returnMerma', 'returnMermaStockConfirmed', 'unfit', 'shortage', 'overage', 'adminSaleExcess'] as const) {
      current[field] = roundQuantity(current[field] + row[field], row.unitType)
    }
    grouped.set(key, current)
  }
  return [...grouped.values()].sort((a, b) => a.periodKey.localeCompare(b.periodKey))
}

function consolidateMermaReport(rows: MermaReportRow[], closures: DistClosure[], filters: MermaReportFilters, lots: DistLot[]): MermaConsolidatedSummary {
  const summary: MermaConsolidatedSummary = {
    dispatchMermaSent: emptyQuantities(), recoverableMermaRecordedAtWarehouse: emptyQuantities(), recoverableMermaReturnedToStock: emptyQuantities(), recoverableMermaStockGap: emptyQuantities(),
    unreturnedNewMermaPending: emptyQuantities(), legacyDispatchWastePending: emptyQuantities(), legacyDispatchWasteCost: { amount: 0, complete: true }, legacyWasteReturnDifferenceCandidate: emptyQuantities(),
    confirmedUnfit: emptyQuantities(), confirmedUnfitCost: { amount: 0, complete: true }, shortage: emptyQuantities(),
    overagePendingReview: emptyQuantities(), overageResolved: emptyQuantities(), overageReleasedToSellable: emptyQuantities(),
    overageDiscarded: emptyQuantities(), overageOtherResolved: emptyQuantities(), overageStatusUnknown: emptyQuantities(),
    administrativeExcess: emptyQuantities(), byDispatchProduct: [],
  }
  const lotById = new Map(lots.map((lot) => [lot.id, lot]))
  const dispatchRows = new Map<string, MermaDispatchReconciliationRow>()
  const getDispatchRow = (dispatchId: string, seed: Partial<MermaDispatchReconciliationRow>): MermaDispatchReconciliationRow => {
    const key = `${dispatchId}__${seed.productId || ''}`
    const current = dispatchRows.get(key)
    if (current) return current
    const created: MermaDispatchReconciliationRow = {
      dispatchId, dayKey: seed.dayKey || '', routeId: seed.routeId || '', routeName: seed.routeName || 'Ruta no disponible',
      distributorUid: seed.distributorUid || '', distributorName: seed.distributorName || 'No disponible',
      productId: seed.productId || '', productName: seed.productName || 'Producto', unitType: seed.unitType || 'kg',
      expectedReturn: null, physicalReturn: null, dispatchMermaSent: 0, recoverableMermaRecordedAtWarehouse: 0,
      recoverableMermaReturnedToStock: 0, recoverableMermaStockGap: 0, legacyDispatchWastePending: 0, legacyWasteReturnDifferenceCandidate: 0, unreturnedNewMermaPending: 0, shortage: 0, overage: 0,
    }
    dispatchRows.set(key, created)
    return created
  }
  for (const row of rows) {
    if (row.kind === 'dispatch_merma') addQuantity(summary.dispatchMermaSent, row.unitType, row.quantity)
    if (row.kind === 'return_merma' && row.reviewState === 'reintegrated_stock') addQuantity(summary.recoverableMermaReturnedToStock, row.unitType, row.quantity)
    if (row.kind === 'dispatch_waste') {
      addQuantity(summary.legacyDispatchWastePending, row.unitType, row.quantity)
      if (row.lossCost === null) summary.legacyDispatchWasteCost.complete = false
      else summary.legacyDispatchWasteCost.amount = Math.round(((summary.legacyDispatchWasteCost.amount || 0) + row.lossCost) * 100) / 100
    }
    if (row.kind === 'unfit') {
      addQuantity(summary.confirmedUnfit, row.unitType, row.quantity)
      if (row.lossCost === null) summary.confirmedUnfitCost.complete = false
      else summary.confirmedUnfitCost.amount = Math.round(((summary.confirmedUnfitCost.amount || 0) + row.lossCost) * 100) / 100
    }
    if (row.kind === 'shortage') addQuantity(summary.shortage, row.unitType, row.quantity)
    if (row.kind === 'admin_sale_excess') addQuantity(summary.administrativeExcess, row.unitType, row.quantity)
    if (row.kind === 'overage') {
      const lot = row.lotId ? lotById.get(row.lotId) : undefined
      if (!lot) addQuantity(summary.overageStatusUnknown, row.unitType, row.quantity)
      else if (!lot.quarantineResolvedAt) addQuantity(summary.overagePendingReview, row.unitType, row.quantity)
      else {
        addQuantity(summary.overageResolved, row.unitType, row.quantity)
        if (lot.quarantineResolution === 'released_existing_lot' || lot.quarantineResolution === 'released_new_lot') addQuantity(summary.overageReleasedToSellable, row.unitType, row.quantity)
        else if (lot.quarantineResolution === 'discarded') addQuantity(summary.overageDiscarded, row.unitType, row.quantity)
        else addQuantity(summary.overageOtherResolved, row.unitType, row.quantity)
      }
    }

    if (!row.dispatchId || !['dispatch_merma', 'dispatch_waste', 'return_merma', 'shortage', 'overage'].includes(row.kind)) continue
    const target = getDispatchRow(row.dispatchId, row)
    if (row.kind === 'dispatch_merma') target.dispatchMermaSent = roundQuantity(target.dispatchMermaSent + row.quantity, row.unitType)
    if (row.kind === 'dispatch_waste') target.legacyDispatchWastePending = roundQuantity(target.legacyDispatchWastePending + row.quantity, row.unitType)
    if (row.kind === 'return_merma' && row.reviewState === 'reintegrated_stock') target.recoverableMermaReturnedToStock = roundQuantity(target.recoverableMermaReturnedToStock + row.quantity, row.unitType)
    if (row.kind === 'shortage') target.shortage = roundQuantity(target.shortage + row.quantity, row.unitType)
    if (row.kind === 'overage') target.overage = roundQuantity(target.overage + row.quantity, row.unitType)
  }
  for (const closure of closures) {
    const dayKey = closure.dayKey || toDayKey(closure.createdAt)
    if (!['closed', 'warehouse_done'].includes(closure.status) || !filters.dayKeys.includes(dayKey)) continue
    if (filters.routeId && !matchesRoute(closure.routeId, filters.routeId)) continue
    if (filters.distributorUid && closure.distributorUid !== filters.distributorUid) continue
    if (filters.warehouseId && (closure.warehouseId || 'central') !== filters.warehouseId) continue
    for (const product of closure.products || []) {
      if (filters.productId && product.productId !== filters.productId) continue
      const amount = Number(product.returnMerma || 0)
      if (!(amount > 0)) continue
      const includeReturnCategory = !filters.kind || filters.kind === 'all' || filters.kind === 'return_merma'
      const key = `${closure.dispatchId}__${product.productId}`
      const existing = dispatchRows.get(key)
      if (!includeReturnCategory && !existing) continue
      if (includeReturnCategory) addQuantity(summary.recoverableMermaRecordedAtWarehouse, product.unitType, amount)
      const target = existing || getDispatchRow(closure.dispatchId, {
        dayKey, routeId: closure.routeId, routeName: closure.routeName, distributorUid: closure.distributorUid,
        distributorName: closure.distributorName, productId: product.productId, productName: product.productName, unitType: product.unitType,
      })
      target.dayKey = dayKey
      target.expectedReturn = product.expectedReturn
      target.physicalReturn = product.physicalReturn ?? product.actualReturn + amount + (product.returnWaste || 0)
      target.recoverableMermaRecordedAtWarehouse = roundQuantity(target.recoverableMermaRecordedAtWarehouse + amount, product.unitType)
      target.shortage = product.shortage ?? target.shortage
      target.overage = product.overage ?? target.overage
    }
  }
  for (const row of dispatchRows.values()) {
    row.recoverableMermaStockGap = roundQuantity(Math.max(0, row.recoverableMermaRecordedAtWarehouse - row.recoverableMermaReturnedToStock), row.unitType)
    if (row.recoverableMermaStockGap > 0) addQuantity(summary.recoverableMermaStockGap, row.unitType, row.recoverableMermaStockGap)
    // This is only an unreconciled comparison: the unreturned portion may have
    // been sold or otherwise moved. It is never labeled or costed as a loss.
    row.unreturnedNewMermaPending = roundQuantity(Math.max(0, row.dispatchMermaSent - row.recoverableMermaRecordedAtWarehouse), row.unitType)
    if (row.unreturnedNewMermaPending > 0) addQuantity(summary.unreturnedNewMermaPending, row.unitType, row.unreturnedNewMermaPending)
    row.legacyWasteReturnDifferenceCandidate = roundQuantity(Math.max(0, row.legacyDispatchWastePending - row.recoverableMermaRecordedAtWarehouse), row.unitType)
    if (row.legacyWasteReturnDifferenceCandidate > 0) addQuantity(summary.legacyWasteReturnDifferenceCandidate, row.unitType, row.legacyWasteReturnDifferenceCandidate)
  }
  if (!summary.legacyDispatchWasteCost.complete) summary.legacyDispatchWasteCost.amount = null
  if (!summary.confirmedUnfitCost.complete) summary.confirmedUnfitCost.amount = null
  summary.byDispatchProduct = [...dispatchRows.values()].sort((a, b) => b.dayKey.localeCompare(a.dayKey) || a.routeName.localeCompare(b.routeName) || a.productName.localeCompare(b.productName))
  return summary
}
