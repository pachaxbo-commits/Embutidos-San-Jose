import { computeOperatingResult } from '../operatingResult.ts'
import { computeMoneySummary } from '../engine.ts'
import type { DistClaim, DistExpense, DistSale, DistStockMovement } from '../../types.ts'

const base = { id: '1', restaurantId: 'sanjose', branchId: 'main', createdAt: '2026-10-10T12:00:00Z', createdBy: 'admin', dayKey: '2026-10-10', schemaVersion: 1 }
const sale = (patch: Partial<DistSale> = {}): DistSale => ({ ...base, operationId: 'sale-1', sourceLocation: 'route', routeId: 'route-a', routeName: 'Ruta A', sellerUid: 'seller', sellerName: 'Vendedor', lines: [{ productId: 'p1', productNameSnapshot: 'Chorizo', unitType: 'kg', quantity: 10, actualUnitPrice: 10, subtotal: 100, costTotal: 60 }], total: 100, paymentKind: 'credit', cashAmount: 0, qrAmount: 0, creditAmount: 100, ...patch })
const expense = (patch: Partial<DistExpense> = {}): DistExpense => ({ ...base, operationId: 'expense-1', routeId: 'administracion', routeName: 'Administración', registeredByUid: 'admin', registeredByName: 'Admin', concept: 'Servicios', amount: 10, group: 'administration', categoryId: 'administration-1', categoryName: 'Servicios', ...patch })
const claim = (patch: Partial<DistClaim> = {}): DistClaim => ({ ...base, kind: 'return', saleId: 'sale-1', customerId: 'c1', customerName: 'Cliente', productId: 'p1', productName: 'Chorizo', quantity: 2, unitType: 'kg', reason: 'Devolución', routeId: 'route-a', revenueDelta: -20, additionalCost: 0, debtReduction: 0, cashIn: 0, cashOut: 0, qrIn: 0, qrOut: 0, ...patch } as DistClaim)
const movement = (patch: Partial<DistStockMovement> = {}): DistStockMovement => ({ ...base, type: 'shortage', productId: 'p1', productName: 'Chorizo', unitType: 'kg', quantity: 1, centralDelta: 0, routeDelta: -1, lossCost: 5, routeId: 'route-a', ...patch })
function equal(actual: unknown, expected: unknown, message: string) {
  if (!Object.is(actual, expected)) throw new Error(`${message}: esperado ${String(expected)}, recibido ${String(actual)}`)
}

const result = computeOperatingResult(
  [sale()], [claim()], [expense(), expense({ id: '2', operationId: 'expense-2', group: 'indirect', paymentMethod: 'transfer', amount: 10 })],
  [movement()], ['2026-10-10'],
)
equal(result.grossSales, 100, 'ventas a crédito cuentan cuando se realizan')
equal(result.salesByOrigin[0]?.origin, 'Ruta A', 'ventas pueden desglosarse por su origen comercial')
equal(result.salesByOrigin[0]?.amount, 100, 'el subtotal por origen cuadra con ventas brutas')
equal(result.adjustments, -20, 'devoluciones usan el revenueDelta efectivo')
equal(result.netSales, 80, 'ventas netas')
equal(result.costOfSales, 60, 'se usa costo histórico de la línea')
equal(result.grossMargin, 20, 'margen bruto')
equal(result.expenseTotals.administration, 10, 'egreso administración')
equal(result.expenseTotals.indirect, 10, 'egreso indirecto')
equal(result.losses, 5, 'el movimiento de cortesía no se cuenta como merma')
equal(result.courtesyCost, 0, 'sin cortesía vinculada a venta no se inventa costo')
equal(result.operatingResult, -5, 'resultado luego de egresos y pérdida')
equal(result.details.find((entry) => entry.key === 'result')?.rows.length, 4, 'el resultado explica el margen, egresos, pérdidas y cortesías que lo forman')
equal(result.details.find((entry) => entry.key === 'administration')?.rows[0]?.categoría, 'Servicios', 'detalle clasificado')
equal(result.details.find((entry) => entry.key === 'indirect')?.rows[0]?.['forma de pago'], 'QR / transferencia', 'detalle de egreso conserva forma de pago')
equal(result.expenses.find((row) => row.paymentMethod === 'transfer')?.amount, 10, 'detalle con forma de pago')
equal(result.details.find((entry) => entry.key === 'adjustments')?.rows[0]?.origen, 'Ruta A', 'el detalle evita mostrar el ID de la ruta')
equal(result.details.find((entry) => entry.key === 'losses')?.rows[0]?.tipo, 'Faltante', 'el detalle traduce tipos internos de movimientos')

const recoverableMerma = movement({ id: 'return-merma', type: 'return_merma', lossCost: 8 })
const returnLoss = movement({ id: 'return-loss-unassigned', type: 'return_waste_unassigned', lossCost: 3 })
const withReturnMovements = computeOperatingResult([], [], [], [recoverableMerma, returnLoss], ['2026-10-10'])
equal(withReturnMovements.losses, 3, 'la merma recuperable no es pérdida y sí se incluye la pérdida sin lote trazable')
equal(withReturnMovements.details.find((entry) => entry.key === 'losses')?.rows[0]?.tipo, 'Pérdida sin lote de origen identificado', 'la pérdida sin lote tiene etiqueta comprensible')
const dispatchMermaMovement = movement({ id: 'dispatch-merma', type: 'dispatch', normalQuantity: 80, dispatchMerma: 2.3, quantity: 82.3, lossCost: null })
const withDispatchMerma = computeOperatingResult([], [], [], [dispatchMermaMovement], ['2026-10-10'])
equal(withDispatchMerma.losses, 0, 'la merma adicional entregada físicamente a ruta no se cuenta como pérdida')
equal(withDispatchMerma.operatingResult, 0, 'dispatchMerma no reduce el resultado operativo')
const commercialMermaCost = computeOperatingResult(
  [sale({ id: 'commercial-merma-sale', operationId: 'commercial-merma-sale', routeId: 'route-a', lines: [{ productId: 'p1', productNameSnapshot: 'Chorizo', unitType: 'kg', quantity: 84, actualUnitPrice: 10, subtotal: 840, costTotal: 840 }] })],
  [], [], [movement({ id: 'commercial-merma-cost', type: 'dispatch_merma_sale', quantity: 2.02, dispatchId: 'dispatch-commercial', costOfSales: 20.2, routeDelta: -2.02, lossCost: null })], ['2026-10-10'],
)
equal(commercialMermaCost.costOfSales, 860.2, 'el costo del peso adicional completa una vez el costo físico vendido')
equal(commercialMermaCost.losses, 0, 'el costo comercial no se registra como pérdida operativa')
equal(commercialMermaCost.report.items[0]?.quantity, 84, 'el peso adicional agregado no inventa peso cobrado ni cantidad de venta')
const quarantineDiscard = movement({ id: 'quarantine-discard', type: 'quarantine_discard', lossCost: 5 })
const withQuarantineDiscard = computeOperatingResult([], [], [], [quarantineDiscard], ['2026-10-10'])
equal(withQuarantineDiscard.losses, 0, 'el descarte de cuarentena conserva el costo auditado pero no altera fórmulas históricas de Resultado')
equal(withQuarantineDiscard.operatingResult, 0, 'la nueva resolución de cuarentena no se integra automáticamente al resultado económico')
const legacyDispatchWaste = computeOperatingResult([], [], [], [movement({ id: 'legacy-dispatch-waste', type: 'dispatch_waste', lossCost: 5 })], ['2026-10-10'])
equal(legacyDispatchWaste.losses, 5, 'dispatch_waste histórico conserva su significado de pérdida')
const unknownReturnLoss = computeOperatingResult([], [], [], [{ ...returnLoss, id: 'unknown-return-loss', lossCost: null }], ['2026-10-10'])
equal(unknownReturnLoss.operatingResult, null, 'no se inventa el resultado si una pérdida de retorno no tiene costo histórico')
const processingOnly = computeOperatingResult([], [], [], [
  movement({ id: 'processing-consume', type: 'processing_consumption', lossCost: null, centralDelta: -10, refId: 'batch-1' }),
  movement({ id: 'processing-output', type: 'processing_output', lossCost: null, centralDelta: 9, refId: 'batch-1' }),
  movement({ id: 'processing-loss', type: 'processing_discard', lossCost: 1.5, quantity: 1, centralDelta: 0, refId: 'batch-1' }),
], ['2026-10-10'])
equal(processingOnly.losses, 1.5, 'solo el descarte confirmado reduce el resultado; consumo y entrada de elaboración no crean gastos')
equal(processingOnly.operatingResult, -1.5, 'el costo de descarte se reconoce una sola vez')
equal(processingOnly.details.find((entry) => entry.key === 'losses')?.rows[0]?.tipo, 'Descarte confirmado de elaboración', 'el descarte queda identificado semánticamente')

const courtesy = sale({ id: 'courtesy', operationId: 'courtesy', saleKind: 'courtesy', total: 0, cashAmount: 0, creditAmount: 0, lines: [], courtesyCost: 4 })
const withCourtesy = computeOperatingResult([sale(), courtesy], [claim()], [expense()], [movement(), movement({ id: 'c-mov', type: 'courtesy', lossCost: 4, refId: 'courtesy', refType: 'sale' })], ['2026-10-10'])
equal(withCourtesy.grossSales, 100, 'cortesías no son ventas')
equal(withCourtesy.courtesyCost, 4, 'el costo sale del snapshot de cortesía')
equal(withCourtesy.losses, 5, 'no se duplica el movimiento de cortesía')
equal(withCourtesy.operatingResult, 1, 'cortesías descontadas una sola vez')

const unknownCost = computeOperatingResult([sale({ lines: [{ productId: 'p1', productNameSnapshot: 'Chorizo', unitType: 'kg', quantity: 10, actualUnitPrice: 10, subtotal: 100 }] })], [], [], [], ['2026-10-10'])
equal(unknownCost.operatingResult, null, 'no se fabrica resultado si falta costo histórico')
equal(unknownCost.costsKnown, false, 'costos desconocidos')

const legacyCourtesyWithoutCost = sale({ id: 'legacy-courtesy', operationId: 'legacy-courtesy', saleKind: 'courtesy', total: 0, cashAmount: 0, creditAmount: 0, lines: [] })
const unknownCourtesyCost = computeOperatingResult([sale(), legacyCourtesyWithoutCost], [], [], [], ['2026-10-10'])
equal(unknownCourtesyCost.courtesyCost, null, 'no presenta como completo el costo de una cortesía histórica sin costo verificable')
equal(unknownCourtesyCost.details.find((entry) => entry.key === 'courtesies')?.amount, null, 'el detalle marca el costo de cortesías no disponible')
equal(unknownCourtesyCost.operatingResult, null, 'no calcula resultado cuando el costo de cortesía no puede verificarse')

const money = computeMoneySummary([], [], [expense(), expense({ id: '2', operationId: 'e2', amount: 10, paymentMethod: 'transfer' }), expense({ id: '3', operationId: 'e3', amount: 3, paymentMethod: 'other' })])
equal(money.cashExpenses, 10, 'solo efectivo reduce caja; QR/transferencia y otros no')
equal(money.expectedCash, -10, 'efectivo esperado')
const historicalMoney = computeMoneySummary([], [], [expense({ paymentMethod: undefined })])
equal(historicalMoney.cashExpenses, 10, 'egresos históricos sin forma de pago conservan el criterio efectivo')

const filtered = computeOperatingResult([sale()], [], [expense()], [], ['2026-10-10'], 'administracion')
equal(filtered.grossSales, 0, 'el filtro de origen elimina ventas de otra ruta')
equal(filtered.expenseTotals.administration, 10, 'filtro de origen incluye administración')
const historicalFiltered = computeOperatingResult([sale()], [], [], [], ['2026-10-09'])
equal(historicalFiltered.grossSales, 0, 'el período histórico filtra por dayKey local')

const includedExpense = expense({ id: 'included', affectsOperatingResult: false, amount: 30 })
const includedResult = computeOperatingResult([], [], [includedExpense], [], ['2026-10-10'])
equal(includedResult.expenseTotals.administration, 0, 'un gasto ya incluido en costo de producto no se resta otra vez del resultado')
const voidedExpense = expense({ id: 'voided', voided: true, amount: 90 })
const voidedResult = computeOperatingResult([], [], [voidedExpense], [], ['2026-10-10'])
equal(voidedResult.expenseTotals.administration, 0, 'egreso anulado no cuenta en Resultado del negocio')
const historicalUnclassified = expense({ id: 'historical-unclassified', group: undefined, categoryId: undefined, categoryName: undefined, amount: 7, economicType: undefined, affectsOperatingResult: undefined })
const unclassifiedResult = computeOperatingResult([], [], [historicalUnclassified], [], ['2026-10-10'])
equal(unclassifiedResult.expenseTotals.other, 7, 'egreso histórico sin grupo se incluye en Otros')
equal(unclassifiedResult.pendingClassificationCount, 1, 'egreso histórico sin grupo se muestra pendiente de clasificar')
equal(unclassifiedResult.details.find((entry) => entry.key === 'other')?.rows[0]?.categoría, 'Por clasificar', 'egreso histórico sin categoría se identifica Por clasificar')
const undecidedExpense = expense({ id: 'undecided', affectsOperatingResult: undefined, amount: 11 })
const undecidedResult = computeOperatingResult([], [], [undecidedExpense], [], ['2026-10-10'])
equal(undecidedResult.pendingEconomicDecisionCount, 1, 'egreso antiguo sin decisión económica marca el resultado para revisar')
equal(undecidedResult.expenseTotals.administration, 11, 'egreso antiguo sin decisión se conserva contando por compatibilidad')
const newPendingExpense = expense({ id: 'new-pending', group: 'other', categoryId: 'other-2', categoryName: 'Por clasificar', economicType: 'operating_expense', affectsOperatingResult: true, classificationStatus: 'pending_review', classificationSource: 'user_pending', amount: 30 })
const pendingResult = computeOperatingResult([], [], [newPendingExpense], [], ['2026-10-10'])
equal(pendingResult.pendingEconomicDecisionCount, 1, 'Otro nuevo hace que el Resultado se marque provisional hasta revisión')
equal(pendingResult.expenseTotals.other, 30, 'Otro pendiente se cuenta conservadoramente como egreso operativo')
const automaticExpense = expense({ id: 'auto-fuel', group: 'indirect', categoryId: 'indirect-1', economicType: 'operating_expense', affectsOperatingResult: true, classificationStatus: 'classified', classificationSource: 'automatic', amount: 15 })
const automaticResult = computeOperatingResult([], [], [automaticExpense], [], ['2026-10-10'])
equal(automaticResult.pendingEconomicDecisionCount, 0, 'el egreso seguro clasificado automáticamente no queda en la bandeja pendiente')
const reversedLoss = movement({ id: 'reversed-loss', type: 'return_waste', lossCost: 12, reversedAt: '2026-10-10T13:00:00Z' })
const reversedResult = computeOperatingResult([], [], [], [reversedLoss], ['2026-10-10'])
equal(reversedResult.losses, 0, 'movimiento de pérdida revertido no cuenta como pérdida activa')
equal(reversedResult.details.find((entry) => entry.key === 'losses')?.rows.length, 0, 'movimiento revertido se conserva fuera del detalle activo')
const expectedCashWithIncludedExpense = computeMoneySummary([], [], [includedExpense])
equal(expectedCashWithIncludedExpense.cashExpenses, 30, 'aunque esté incluido en costo, el gasto efectivo sigue reduciendo caja')
const productionInputCash = expense({ id: 'raw-cash', amount: 858, economicType: 'production_input', affectsOperatingResult: false, group: 'production_input', categoryId: 'production_input-1' })
const productionInputQr = expense({ id: 'raw-qr', amount: 756, paymentMethod: 'transfer', economicType: 'production_input', affectsOperatingResult: false, group: 'production_input', categoryId: 'production_input-1' })
equal(computeMoneySummary([], [], [productionInputCash]).cashExpenses, 858, 'materia prima en efectivo sí reduce el efectivo esperado')
equal(computeMoneySummary([], [], [productionInputQr]).cashExpenses, 0, 'materia prima pagada por QR no reduce efectivo físico')
const productionInputResult = computeOperatingResult([], [], [productionInputCash, productionInputQr], [], ['2026-10-10'])
equal(productionInputResult.operatingResult, 0, 'materia prima no se descuenta como gasto operativo')
equal(productionInputResult.productionInputTotal, 1614, 'compras de materia prima se muestran en total informativo separado')
equal(productionInputResult.details.find((entry) => entry.key === 'production_input')?.rows.length, 2, 'detalle informativo abre las compras de materia prima')
const realDayResult = computeOperatingResult(
  [sale({ id: 'day-sales', operationId: 'day-sales', total: 9310, cashAmount: 9310, creditAmount: 0, lines: [{ productId: 'p1', productNameSnapshot: 'Viena', unitType: 'kg', quantity: 1, actualUnitPrice: 9310, subtotal: 9310, costTotal: 7048.76 }] })],
  [],
  [expense({ id: 'operating-331', amount: 331 }), productionInputCash, productionInputQr],
  [movement({ id: 'loss-356', lossCost: 356.22 })],
  ['2026-10-10'],
)
equal(realDayResult.grossMargin, 2261.24, 'reconciliación histórica: margen bruto 2.261,24')
equal(realDayResult.expenseTotals.administration, 331, 'reconciliación histórica: solo gasto operativo restante')
equal(realDayResult.productionInputTotal, 1614, 'reconciliación histórica: materia prima separada')
equal(realDayResult.operatingResult, 1574.02, 'reconciliación histórica no descuenta materia prima doblemente')
equal(Math.round((2261.24 - 331 - (356.22 - 93.5)) * 100) / 100, 1667.52, 'comparación analítica excluye solo las pérdidas históricas conocidas')
const expectedCashWithVoidedExpense = computeMoneySummary([], [], [voidedExpense])
equal(expectedCashWithVoidedExpense.cashExpenses, 0, 'egreso anulado no reduce efectivo esperado')
const cogsAndIncludedExpense = computeOperatingResult([sale()], [], [includedExpense], [], ['2026-10-10'])
equal(cogsAndIncludedExpense.costOfSales, 60, 'COGS mantiene su costo histórico')
equal(cogsAndIncludedExpense.operatingResult, 40, 'el costo incluido no se vuelve a descontar del margen')
const cogsAndRawMaterial = computeOperatingResult([sale()], [], [productionInputCash], [], ['2026-10-10'])
equal(cogsAndRawMaterial.costOfSales, 60, 'la compra de materia prima no recalcula ni duplica el costo histórico vendido')
equal(cogsAndRawMaterial.operatingResult, 40, 'COGS más compra materia prima no descuenta el mismo costo dos veces')
const quarantineCashExpense = { ...productionInputCash, id: 'quarantine-cash', operationId: 'quarantine-cash', economicType: 'production_input' as const, affectsOperatingResult: false, amount: 100, paymentMethod: 'cash' as const }
equal(computeMoneySummary([], [], [quarantineCashExpense]).cashExpenses, 100, 'el tipo económico no cambia el movimiento de efectivo por caja')
const regroupedExpenseResult = computeOperatingResult([], [], [{ ...expense(), group: 'equipment', affectsOperatingResult: true }], [], ['2026-10-10'])
equal(regroupedExpenseResult.operatingResult, -10, 'cambiar la categoría/grupo no altera el total mientras la decisión económica no cambie')
equal(regroupedExpenseResult.expenseTotals.equipment, 10, 'la categoría solo organiza el egreso en su grupo')
const voidedSaleResult = computeOperatingResult([sale({ voidedAt: '2026-10-10T13:00:00Z' })], [], [], [], ['2026-10-10'])
equal(voidedSaleResult.grossSales, 0, 'venta anulada no permanece en ventas brutas')
equal(voidedSaleResult.costOfSales, 0, 'costo histórico de venta anulada no permanece en COGS')
equal(computeMoneySummary([sale({ voidedAt: '2026-10-10T13:00:00Z' })], [], []).salesTotal, 0, 'venta anulada tampoco afecta el resumen de caja')

console.log('PASS operating result: ventas, crédito, claims, egresos, pérdidas, cortesías, costos desconocidos, filtros y compatibilidad de caja')
