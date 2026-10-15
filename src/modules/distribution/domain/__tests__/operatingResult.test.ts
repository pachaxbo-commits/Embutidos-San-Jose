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
equal(result.adjustments, -20, 'devoluciones usan el revenueDelta efectivo')
equal(result.netSales, 80, 'ventas netas')
equal(result.costOfSales, 60, 'se usa costo histórico de la línea')
equal(result.grossMargin, 20, 'margen bruto')
equal(result.expenseTotals.administration, 10, 'egreso administración')
equal(result.expenseTotals.indirect, 10, 'egreso indirecto')
equal(result.losses, 5, 'el movimiento de cortesía no se cuenta como merma')
equal(result.courtesyCost, 0, 'sin cortesía vinculada a venta no se inventa costo')
equal(result.operatingResult, -5, 'resultado luego de egresos y pérdida')
equal(result.details.find((entry) => entry.key === 'administration')?.rows[0]?.categoría, 'Servicios', 'detalle clasificado')
equal(result.expenses.find((row) => row.paymentMethod === 'transfer')?.amount, 10, 'detalle con forma de pago')

const courtesy = sale({ id: 'courtesy', operationId: 'courtesy', saleKind: 'courtesy', total: 0, cashAmount: 0, creditAmount: 0, lines: [], courtesyCost: 4 })
const withCourtesy = computeOperatingResult([sale(), courtesy], [claim()], [expense()], [movement(), movement({ id: 'c-mov', type: 'courtesy', lossCost: 4, refId: 'courtesy', refType: 'sale' })], ['2026-10-10'])
equal(withCourtesy.grossSales, 100, 'cortesías no son ventas')
equal(withCourtesy.courtesyCost, 4, 'el costo sale del snapshot de cortesía')
equal(withCourtesy.losses, 5, 'no se duplica el movimiento de cortesía')
equal(withCourtesy.operatingResult, 1, 'cortesías descontadas una sola vez')

const unknownCost = computeOperatingResult([sale({ lines: [{ productId: 'p1', productNameSnapshot: 'Chorizo', unitType: 'kg', quantity: 10, actualUnitPrice: 10, subtotal: 100 }] })], [], [], [], ['2026-10-10'])
equal(unknownCost.operatingResult, null, 'no se fabrica resultado si falta costo histórico')
equal(unknownCost.costsKnown, false, 'costos desconocidos')

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

console.log('PASS operating result: ventas, crédito, claims, egresos, pérdidas, cortesías, costos desconocidos, filtros y compatibilidad de caja')
