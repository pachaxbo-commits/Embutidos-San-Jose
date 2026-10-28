import type { DistExpense } from '../../types.ts'
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

check(expenseCashPaidAmount(creditPurchase) === 0, 'una compra a crédito no sale de la caja al registrarse')
check(expenseCashPaidAmount(cashPayment) === 800, 'el pago posterior descuenta el efectivo realmente abonado')
check(expenseTransferPaidAmount(qrAdvance) === 200, 'el adelanto por QR se conserva separado del efectivo')
check(expenseCashPaidAmount(mixedPay) === 100 && expenseTransferPaidAmount(mixedPay) === 150, 'el pago mixto conserva cada medio sin atribuir el total a caja')
check(expenseOtherPaidAmount({ ...base, paymentMethod: 'other', amount: 45 }) === 45, 'pagos de otro tipo no se confunden con efectivo')
check(expenseMatchesPaymentFilter(creditPurchase, 'credit'), 'el filtro crédito identifica una compra con saldo pendiente')
check(expenseMatchesPaymentFilter(qrAdvance, 'transfer') && !expenseMatchesPaymentFilter(qrAdvance, 'cash'), 'el filtro de medio identifica el adelanto real de una compra mixta')
check(expenseMatchesPaymentFilter(mixedPay, 'mixed') && expenseMatchesPaymentFilter(mixedPay, 'cash') && expenseMatchesPaymentFilter(mixedPay, 'transfer'), 'una operación mixta puede consultarse por su tipo y por cada medio realmente pagado')

const totals = summarizeActiveExpenses([creditPurchase, cashPayment, qrAdvance, mixedPay])
check(totals.productionInputTotal === 3_500 && totals.total === 3_500, 'la compra a crédito y parcial se reconocen como compras económicas una sola vez')
check(totals.cashOutflow === 900, 'la salida de efectivo suma adelantos en efectivo y pagos posteriores, no el total a crédito')
const customCategory = { ...DEFAULT_EXPENSE_CATEGORIES[0], id: 'custom-services', group: 'custom-admin', name: 'Servicios de oficina' }
const mergedCategories = mergeExpenseCategories([customCategory])
check(mergedCategories.some(category => category.id === 'administration-1') && mergedCategories.some(category => category.id === 'custom-services'), 'las categorías personalizadas no ocultan los valores predeterminados')
const customGroup = { id: 'custom-admin', restaurantId: 'sanjose', branchId: 'main', createdAt: '', createdBy: 'admin', dayKey: '', schemaVersion: 1, name: 'Administración local', active: true, order: 20, economicType: 'operating_expense' as const }
check(listExpenseGroups([customGroup]).some(group => group.id === customGroup.id && group.label === customGroup.name), 'los grupos personalizados usan nombres visibles sin perder su ID')
console.log('PASS expense accounting: compra, crédito, pagos y caja separados')
