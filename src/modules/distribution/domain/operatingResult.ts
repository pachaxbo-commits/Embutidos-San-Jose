import type { DistClaim, DistExpense, DistRoute, DistSale, DistStockMovement } from '../types.ts'
import { matchesRoute, round2, toDayKey } from './engine.ts'
import { computeProductProfitReport, type ProductProfitReport } from './productProfit.ts'
import { effectiveExpenseGroup, expenseGroupLabel } from './expenseCategories.ts'
import { effectiveExpenseEconomicType, isExpenseReviewPending } from './expenseReview.ts'

export interface OperatingResultExpenseRow {
  id: string; dayKey: string; group: string; groupLabel: string; category: string; concept: string
  origin: string; responsible: string; amount: number; paymentMethod: 'cash' | 'transfer' | 'other' | 'credit' | 'mixed'; economicType: 'operating_expense' | 'production_input'
}
export interface OperatingResultDetail {
  key: 'grossSales' | 'adjustments' | 'netSales' | 'costOfSales' | 'grossMargin' | string | 'losses' | 'courtesies' | 'result'
  label: string; amount: number | null; rows: Array<Record<string, string | number>>; explanation?: string
}
export interface OperatingResult {
  grossSales: number; adjustments: number; netSales: number; costOfSales: number | null; grossMargin: number | null
  expenseTotals: Record<string, number>; expenseGroupLabels: Array<{ id: string; label: string }>; productionInputTotal: number; losses: number | null; courtesyCost: number | null
  operatingResult: number | null; costsKnown: boolean; report: ProductProfitReport; details: OperatingResultDetail[]
  expenses: OperatingResultExpenseRow[]; salesByOrigin: Array<{ origin: string; amount: number }>
  pendingClassificationCount: number; pendingEconomicDecisionCount: number
}

const ZERO: Record<string, number> = { administration: 0, indirect: 0, equipment: 0, other: 0, production_additional: 0, production_input: 0 }

export function computeOperatingResult(
  sales: DistSale[], claims: DistClaim[], expenses: DistExpense[], movements: DistStockMovement[], dayKeys: string[], routeFilter = '', routes: Pick<DistRoute, 'id' | 'name'>[] = [],
): OperatingResult {
  const inScope = (dayKey: string, routeId?: string) =>
    (dayKeys.length === 0 || dayKeys.includes(dayKey)) && (!routeFilter || matchesRoute(routeId || '', routeFilter))
  const scopedSales = sales.filter((sale) => !sale.voidedAt && !sale.pendingConfirmation && inScope(sale.dayKey || toDayKey(sale.createdAt), sale.routeId))
  const scopedClaims = claims.filter((claim) => inScope(claim.dayKey || toDayKey(claim.createdAt), claim.routeId))
  const allScopedActiveExpenses = expenses.filter((expense) => !expense.voided && expense.transactionKind !== 'supplier_payment' && inScope(expense.dayKey || toDayKey(expense.createdAt), expense.routeId))
  const scopedExpenses = allScopedActiveExpenses.filter((expense) => effectiveExpenseEconomicType(expense) === 'operating_expense')
  const productionInputs = allScopedActiveExpenses.filter((expense) => effectiveExpenseEconomicType(expense) === 'production_input')
  const pendingClassificationCount = allScopedActiveExpenses.filter(isExpenseReviewPending).length
  const pendingEconomicDecisionCount = pendingClassificationCount
  const scopedMovements = movements.filter((movement) => !movement.reversedAt && inScope(movement.dayKey || toDayKey(movement.createdAt), movement.routeId))
  const routeNames = new Map(routes.map((route) => [route.id, route.name]))
  for (const sale of scopedSales) {
    if (sale.routeName && !sale.routeName.startsWith('route-')) routeNames.set(sale.routeId, sale.routeName)
  }
  const displayOrigin = (routeId?: string, fallback?: string) => {
    if (routeId === 'administracion' || routeId === 'admin') return 'Administración'
    if (routeId === 'route-impulsacion' || routeId === 'route-directa') return 'Impulsación'
    return routeNames.get(routeId || '') || (fallback && !fallback.startsWith('route-') ? fallback : undefined) || (routeId ? 'Ruta registrada' : 'Sin origen')
  }
  const report = computeProductProfitReport(scopedSales, scopedClaims, scopedExpenses, scopedMovements, dayKeys, routeFilter)
  const commercialSales = scopedSales.filter((sale) => sale.saleKind !== 'courtesy' && sale.effectiveSnapshot?.saleKind !== 'courtesy')
  const grossSales = round2(commercialSales.reduce((sum, sale) => sum + (sale.effectiveSnapshot?.total ?? sale.total), 0))
  const salesByOriginMap = new Map<string, number>()
  for (const sale of commercialSales) {
    const origin = displayOrigin(sale.routeId, sale.routeName)
    salesByOriginMap.set(origin, round2((salesByOriginMap.get(origin) || 0) + (sale.effectiveSnapshot?.total ?? sale.total)))
  }
  const salesByOrigin = [...salesByOriginMap.entries()].map(([origin, amount]) => ({ origin, amount }))
  const adjustments = round2(scopedClaims.reduce((sum, claim) => sum + claim.revenueDelta, 0))
  const netSales = round2(report.totals.salesBs)
  const costOfSales = report.totals.costBs
  const grossMargin = report.totals.profitBs
  const expenseTotals = { ...ZERO }
  const expenseRows: OperatingResultExpenseRow[] = [...scopedExpenses, ...productionInputs].map((expense) => {
    const group = effectiveExpenseGroup(expense)
    const economicType = effectiveExpenseEconomicType(expense)
    if (economicType === 'operating_expense') expenseTotals[group] = round2(expenseTotals[group] + expense.amount)
    else expenseTotals.production_input = round2(expenseTotals.production_input + expense.amount)
    return {
      id: expense.id,
      dayKey: expense.dayKey || toDayKey(expense.createdAt),
      group,
      groupLabel: expense.groupName || expenseGroupLabel(group),
      category: expense.categoryName || 'Por clasificar',
      concept: expense.concept,
      origin: displayOrigin(expense.routeId, expense.routeName),
      responsible: expense.registeredByName || 'Sin responsable',
      amount: expense.amount,
      paymentMethod: expense.paymentMethod || 'cash',
      economicType,
    }
  })
  const losses = scopedMovements.filter((movement) =>
    movement.type === 'shortage' || movement.type === 'return_waste' || movement.type === 'return_waste_unassigned' || movement.type === 'dispatch_waste' ||
    (movement.type === 'adjustment' && movement.centralDelta < 0),
  )
  const lossCostsKnown = losses.every((movement) => typeof movement.lossCost === 'number' && Number.isFinite(movement.lossCost))
  const lossCost = lossCostsKnown ? round2(losses.reduce((sum, movement) => sum + (movement.lossCost || 0), 0)) : null
  const courtesies = scopedSales.filter((sale) => sale.saleKind === 'courtesy' || sale.effectiveSnapshot?.saleKind === 'courtesy')
  const courtesyMovements = scopedMovements.filter((movement) => movement.type === 'courtesy')
  const courtesyCostBySale = courtesies.map((sale) => sale.courtesyCost ?? courtesyMovements.find((movement) => movement.refId === sale.id)?.lossCost)
  const unlinkedCourtesyMovements = courtesyMovements.filter((movement) => !movement.refId || !courtesies.some((sale) => sale.id === movement.refId))
  const courtesyKnown = courtesyCostBySale.every((cost) => typeof cost === 'number' && Number.isFinite(cost)) && unlinkedCourtesyMovements.every((movement) => typeof movement.lossCost === 'number' && Number.isFinite(movement.lossCost))
  const courtesyCostValue = round2(courtesyCostBySale.reduce<number>((sum, cost) => sum + (typeof cost === 'number' ? cost : 0), 0) + unlinkedCourtesyMovements.reduce((sum, movement) => sum + (movement.lossCost || 0), 0))
  const courtesyCost = courtesyKnown ? courtesyCostValue : null
  const costsKnown = costOfSales !== null && lossCostsKnown && courtesyKnown
  const operatingExpenseTotal = round2(Object.entries(expenseTotals).filter(([group]) => group !== 'production_input').reduce((sum, [, amount]) => sum + amount, 0))
  const productionInputTotal = round2(productionInputs.reduce((sum, expense) => sum + expense.amount, 0))
  const operatingResult = costsKnown
    ? round2((grossMargin ?? 0) - operatingExpenseTotal - (lossCost ?? 0) - courtesyCostValue)
    : null
  const expenseRowsFor = (group?: string) => expenseRows.filter((expense) => !group || expense.group === group).map((expense) => ({
    fecha: expense.dayKey, categoría: expense.category, concepto: expense.concept, origen: expense.origin,
    responsable: expense.responsible,
    'forma de pago': expense.paymentMethod === 'cash' ? 'Efectivo' : expense.paymentMethod === 'transfer' ? 'QR / transferencia' : 'Otro',
    monto: expense.amount,
  }))
  const saleRows = report.allLineDetails.filter((line) => !line.isClaimRelated && !line.isDispatchMermaCost).map((line) => ({
    fecha: line.dayKey, producto: line.productName, cantidad: line.quantity, cliente: line.customerName,
    origen: displayOrigin(undefined, line.routeName), responsable: line.sellerName, monto: line.saleBs,
  }))
  const claimRows = scopedClaims.map((claim) => ({ fecha: claim.dayKey || toDayKey(claim.createdAt), producto: claim.productName,
    tipo: claim.kind === 'return' ? 'Devolución' : 'Cambio', cliente: claim.customerName,
    origen: displayOrigin(claim.routeId, scopedSales.find((sale) => sale.id === claim.saleId)?.routeName), monto: claim.revenueDelta }))
  const movementTypeLabel: Record<DistStockMovement['type'], string> = {
    traceability_notice: 'Origen físico pendiente (incidencia documental sin efecto económico)',
    reservation_created: 'Reserva de producto (sin movimiento físico)', reservation_released: 'Liberación de reserva (sin movimiento físico)',
    intake: 'Ingreso de inventario', dispatch: 'Despacho', dispatch_addition: 'Aumento de despacho', sale: 'Venta',
    sale_correction: 'Corrección de venta', return: 'Retorno', adjustment: 'Ajuste de inventario',
    dispatch_correction: 'Corrección de despacho', dispatch_waste: 'Merma al despachar', dispatch_merma_sale: 'Merma adicional dentro de ventas', return_waste: 'Merma al retorno',
    return_merma: 'Merma recuperable al retorno', return_waste_unassigned: 'Pérdida sin lote de origen identificado',
    courtesy: 'Cortesía', shortage: 'Faltante', overage: 'Sobrante',
    quarantine_release: 'Liberación auditada de cuarentena', quarantine_discard: 'Descarte auditado de cuarentena',
    customer_return: 'Devolución de cliente', transfer: 'Transferencia entre almacenes', sale_void: 'Anulación de venta',
  }
  const movementRows = losses.map((movement) => ({ fecha: movement.dayKey || toDayKey(movement.createdAt), tipo: movementTypeLabel[movement.type],
    producto: movement.productName || 'Producto no disponible', origen: displayOrigin(movement.routeId), monto: movement.lossCost ?? 'Costo no registrado' }))
  const courtesyRows = courtesies.map((sale, index) => ({ fecha: sale.dayKey || toDayKey(sale.createdAt), motivo: sale.courtesyReason || 'Cortesía',
    origen: displayOrigin(sale.routeId, sale.routeName), responsable: sale.sellerName, monto: courtesyCostBySale[index] ?? 'Costo no registrado' }))
  courtesyRows.push(...unlinkedCourtesyMovements.map((movement) => ({ fecha: movement.dayKey || toDayKey(movement.createdAt), motivo: 'Cortesía sin venta vinculada', origen: displayOrigin(movement.routeId), responsable: movement.responsibleName || 'Sin responsable', monto: movement.lossCost ?? 'Costo no registrado' })))
  const details: OperatingResultDetail[] = [
    { key: 'grossSales', label: 'Ventas brutas', amount: grossSales, rows: saleRows },
    { key: 'adjustments', label: 'Cambios y devoluciones', amount: adjustments, rows: claimRows },
    { key: 'netSales', label: 'Ventas netas', amount: netSales, rows: [...saleRows, ...claimRows] },
    { key: 'costOfSales', label: 'Costo de lo vendido', amount: costOfSales, rows: report.allLineDetails.map((line) => ({ fecha: line.dayKey, producto: line.productName, cantidad: line.quantity, costo: line.costBs ?? 'Costo histórico no registrado' })) },
    { key: 'grossMargin', label: 'Margen bruto', amount: grossMargin, rows: report.items.map((item) => ({ producto: item.productName, ventas: item.salesBs, costo: item.costBs ?? 'No registrado', margen: item.profitBs ?? 'No disponible' })) },
    ...[...new Map(expenseRows.filter((row) => row.economicType === 'operating_expense').map((row) => [row.group, row.groupLabel])).entries()].map(([group, label]) => ({ key: group, label, amount: expenseTotals[group] || 0, rows: expenseRowsFor(group) })),
    { key: 'production_input', label: 'Compras de materia prima', amount: productionInputTotal, rows: expenseRowsFor('production_input'), explanation: 'Salida de dinero no descontada nuevamente porque su costo se reconoce en los productos.' },
    { key: 'losses', label: 'Mermas y pérdidas', amount: lossCost, rows: movementRows, explanation: lossCostsKnown ? undefined : 'Hay movimientos sin costo histórico; no se estima una cifra incompleta.' },
    { key: 'courtesies', label: 'Costo de cortesías', amount: courtesyCost, rows: courtesyRows },
    { key: 'result', label: 'Resultado operativo estimado', amount: operatingResult, rows: [
      { concepto: 'Margen bruto', monto: grossMargin ?? 'No disponible por costo histórico faltante' },
      { concepto: 'Egresos operativos', monto: operatingExpenseTotal },
      { concepto: 'Pérdidas / mermas', monto: lossCost ?? 'No disponible por costo histórico faltante' },
      { concepto: 'Costo de cortesías', monto: courtesyCost ?? 'No disponible por costo histórico faltante' },
    ] },
  ]
  const expenseGroupLabels = [...new Map(expenseRows.map((row) => [row.group, row.groupLabel])).entries()].map(([id, label]) => ({ id, label }))
  return { grossSales, adjustments, netSales, costOfSales, grossMargin, expenseTotals, expenseGroupLabels, productionInputTotal, losses: lossCost, courtesyCost, operatingResult, costsKnown, report, details, expenses: expenseRows, salesByOrigin, pendingClassificationCount, pendingEconomicDecisionCount }
}
