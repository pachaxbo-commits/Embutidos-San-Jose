import type { DistExpense } from '../../types.ts'
import { computeSellerBreakdown } from '../engine.ts'
import { expenseCashPaidAmount, expenseMatchesPaymentFilter, expenseOtherPaidAmount, expenseTransferPaidAmount } from '../expenseAccounting.ts'
import { summarizeActiveExpenses } from '../expenseReview.ts'
import { DEFAULT_EXPENSE_CATEGORIES, listExpenseGroups, mergeExpenseCategories } from '../expenseCategories.ts'

const base: DistExpense = {
  id: 'expense', restaurantId: 'sanjose', branchId: 'main', createdAt: '2026-10-27T12:00:00.000Z', createdBy: 'admin', dayKey: '2026-10-27', schemaVersion: 2,
  operationId: 'expense', concept: 'Compra', amount: 2_000, routeId: 'administracion', routeName: 'Administración', registeredByUid: 'admin', registeredByName: 'Admin',
}
function check(value: boolean, message: string) { if (!value) throw new Error(message); console.log(`PASS ${message}`) }

const creditPurchase = { ...base, id: 'purchase-credit', transactionKind: 'supplier_purchase', paymentMethod: 'credit', amount: 2_000, economicType: 'production_input', group: 'production_input', cashPaidAmount: 0 } as DistExpense
const cashPayment = { ...base, id: 'payment-cash', operationId: 'payment-op', transactionKind: 'supplier_payment', paymentMethod: 'cash', amount: 800, cashPaidAmount: 800, economicType: 'production_input', group: 'production_input' } as DistExpense
const qrAdvance = { ...base, id: 'purchase-partial', operationId: 'partial-op', transactionKind: 'supplier_purchase', paymentMethod: 'mixed', amount: 500, cashPaidAmount: 0, transferPaidAmount: 200, otherPaidAmount: 0, economicType: 'production_input', group: 'production_input' } as DistExpense
const mixedPay = { ...base, id: 'purchase-mixed', operationId: 'mixed-op', transactionKind: 'supplier_purchase', paymentMethod: 'mixed', amount: 1_000, cashPaidAmount: 100, transferPaidAmount: 150, economicType: 'production_input', group: 'production_input' } as DistExpense
const operatingCredit = { ...base, id: 'maintenance-credit', operationId: 'maintenance-credit', transactionKind: 'expense', paymentMethod: 'credit', amount: 100, cashPaidAmount: 0, economicType: 'operating_expense', affectsOperatingResult: true, group: 'administration', payableId: 'maintenance-credit' } as DistExpense
const operatingCreditPayment = { ...base, id: 'maintenance-payment', operationId: 'maintenance-payment', transactionKind: 'supplier_payment', paymentMethod: 'cash', amount: 40, cashPaidAmount: 40, economicType: 'operating_expense', affectsOperatingResult: true, group: 'administration', payableId: 'maintenance-credit' } as DistExpense

check(expenseCashPaidAmount(creditPurchase) === 0, 'una compra a crédito no sale de la caja al registrarse')
check(expenseCashPaidAmount(cashPayment) === 800, 'el pago posterior descuenta el efectivo realmente abonado')
check(expenseTransferPaidAmount(qrAdvance) === 200, 'el adelanto por QR se conserva separado del efectivo')
check(expenseCashPaidAmount(mixedPay) === 100 && expenseTransferPaidAmount(mixedPay) === 150, 'el pago mixto conserva cada medio sin atribuir el total a caja')
check(expenseOtherPaidAmount({ ...base, paymentMethod: 'other', amount: 45 }) === 45, 'pagos de otro tipo no se confunden con efectivo')
check(expenseMatchesPaymentFilter(creditPurchase, 'credit'), 'el filtro crédito identifica una compra con saldo pendiente')
check(expenseMatchesPaymentFilter(qrAdvance, 'transfer') && !expenseMatchesPaymentFilter(qrAdvance, 'cash'), 'el filtro de medio identifica el adelanto real de una compra mixta')
check(expenseMatchesPaymentFilter(mixedPay, 'mixed') && expenseMatchesPaymentFilter(mixedPay, 'cash') && expenseMatchesPaymentFilter(mixedPay, 'transfer'), 'una operación mixta puede consultarse por su tipo y por cada medio realmente pagado')
check(expenseCashPaidAmount(operatingCredit) === 0 && expenseMatchesPaymentFilter(operatingCredit, 'credit'), 'un egreso operativo a crédito es deuda y no descuenta caja')

const totals = summarizeActiveExpenses([creditPurchase, cashPayment, qrAdvance, mixedPay])
check(totals.productionInputTotal === 3_500 && totals.total === 3_500, 'la compra a crédito y parcial se reconocen como compras económicas una sola vez')
check(totals.cashOutflow === 900, 'la salida de efectivo suma adelantos en efectivo y pagos posteriores, no el total a crédito')
const operatingCreditTotals = summarizeActiveExpenses([operatingCredit, operatingCreditPayment])
check(operatingCreditTotals.total === 100 && operatingCreditTotals.operatingTotal === 100 && operatingCreditTotals.cashOutflow === 40, 'pagar Bs 40 de una obligación de Bs 100 reconoce el gasto una vez y solo registra Bs 40 de caja')
const routeSale = { id: 'sale-route', sellerUid: 'hugo', sellerName: 'Hugo', routeId: 'route-hugo', routeName: 'Ruta Hugo', createdAt: base.createdAt, dayKey: base.dayKey, saleKind: 'sale', total: 1_000, cashAmount: 1_000, qrAmount: 0, creditAmount: 0, lines: [] } as never
const routePurchase = { ...creditPurchase, id: 'route-purchase-cash', operationId: 'route-purchase-cash', transactionKind: 'supplier_purchase', routeId: 'route-hugo', routeName: 'Ruta Hugo', registeredByUid: 'hugo', registeredByName: 'Hugo', amount: 700, paymentMethod: 'cash', cashPaidAmount: 700 } as DistExpense
const routeQrPurchase = { ...routePurchase, id: 'route-purchase-qr', operationId: 'route-purchase-qr', paymentMethod: 'transfer', cashPaidAmount: 0, transferPaidAmount: 700 } as DistExpense
const routeCreditPurchase = { ...routePurchase, id: 'route-purchase-credit', operationId: 'route-purchase-credit', paymentMethod: 'credit', cashPaidAmount: 0, transferPaidAmount: 0 } as DistExpense
check(computeSellerBreakdown([routeSale], [], [routePurchase]).find(row => row.sellerUid === 'hugo')?.expectedCash === 300, 'el cierre de ruta descuenta los Bs 700 pagados en efectivo de Hugo')
check(computeSellerBreakdown([routeSale], [], [routeQrPurchase]).find(row => row.sellerUid === 'hugo')?.expectedCash === 1_000, 'una compra QR no reduce el efectivo físico esperado de la ruta')
check(computeSellerBreakdown([routeSale], [], [routeCreditPurchase]).find(row => row.sellerUid === 'hugo')?.expectedCash === 1_000, 'una compra a crédito no reduce el efectivo físico esperado de la ruta')
const customCategory = { ...DEFAULT_EXPENSE_CATEGORIES[0], id: 'custom-services', group: 'custom-admin', name: 'Servicios de oficina' }
const mergedCategories = mergeExpenseCategories([customCategory])
check(mergedCategories.some(category => category.id === 'administration-1') && mergedCategories.some(category => category.id === 'custom-services'), 'las categorías personalizadas no ocultan los valores predeterminados')
const customGroup = { id: 'custom-admin', restaurantId: 'sanjose', branchId: 'main', createdAt: '', createdBy: 'admin', dayKey: '', schemaVersion: 1, name: 'Administración local', active: true, order: 20, economicType: 'operating_expense' as const }
check(listExpenseGroups([customGroup]).some(group => group.id === customGroup.id && group.label === customGroup.name), 'los grupos personalizados usan nombres visibles sin perder su ID')
console.log('PASS expense accounting: compra, crédito, pagos y caja separados')
