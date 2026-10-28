import type { DistExpense } from '../types.ts'

/** Actual cash disbursed; supplier credit and QR/transfer are never cash. */
export function expenseCashPaidAmount(expense: DistExpense): number {
  if (typeof expense.cashPaidAmount === 'number' && Number.isFinite(expense.cashPaidAmount)) return Math.max(0, expense.cashPaidAmount)
  return (expense.paymentMethod ?? 'cash') === 'cash' ? Math.max(0, Number(expense.amount) || 0) : 0
}

export function expenseTransferPaidAmount(expense: DistExpense): number {
  if (typeof expense.transferPaidAmount === 'number' && Number.isFinite(expense.transferPaidAmount)) return Math.max(0, expense.transferPaidAmount)
  return expense.paymentMethod === 'transfer' ? Math.max(0, Number(expense.amount) || 0) : 0
}

export function expenseOtherPaidAmount(expense: DistExpense): number {
  if (typeof expense.otherPaidAmount === 'number' && Number.isFinite(expense.otherPaidAmount)) return Math.max(0, expense.otherPaidAmount)
  return expense.paymentMethod === 'other' ? Math.max(0, Number(expense.amount) || 0) : 0
}

export function isSupplierPayment(expense: DistExpense): boolean {
  return expense.transactionKind === 'supplier_payment'
}

export function expenseMatchesPaymentFilter(expense: DistExpense, filter: 'all' | 'cash' | 'transfer' | 'other' | 'credit' | 'mixed'): boolean {
  if (filter === 'all') return true
  if (filter === 'mixed') return expense.paymentMethod === 'mixed'
  if (filter === 'cash') return expenseCashPaidAmount(expense) > 0
  if (filter === 'transfer') return expenseTransferPaidAmount(expense) > 0
  if (filter === 'other') return expenseOtherPaidAmount(expense) > 0
  return expense.paymentMethod === 'credit' || (expense.transactionKind === 'supplier_purchase'
    && Number(expense.amount) > expenseCashPaidAmount(expense) + expenseTransferPaidAmount(expense) + expenseOtherPaidAmount(expense))
}
