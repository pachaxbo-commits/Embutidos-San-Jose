import type { DistExpense, ExpenseEconomicType, ExpenseGroup } from '../types.ts'
import { round2 } from './engine.ts'

export type ExpenseStatusFilter = 'active' | 'voided' | 'all'
export function effectiveExpenseEconomicType(expense: DistExpense): ExpenseEconomicType {
  if (expense.economicType) return expense.economicType
  return expense.affectsOperatingResult === false ? 'production_input' : 'operating_expense'
}

export function filterExpensesByStatus(expenses: DistExpense[], status: ExpenseStatusFilter): DistExpense[] {
  if (status === 'active') return expenses.filter((expense) => !expense.voided)
  if (status === 'voided') return expenses.filter((expense) => expense.voided === true)
  return expenses
}

export function isExpenseReviewPending(expense: DistExpense): boolean {
  return !expense.voided && (expense.classificationStatus === 'pending_review' || (!expense.economicType && typeof expense.affectsOperatingResult !== 'boolean'))
}

export function summarizeActiveExpenses(expenses: DistExpense[]): { total: number; operatingTotal: number; productionInputTotal: number; groups: Record<ExpenseGroup, number> } {
  const groups: Record<ExpenseGroup, number> = { administration: 0, indirect: 0, equipment: 0, other: 0, production_additional: 0, production_input: 0 }
  let total = 0, operatingTotal = 0, productionInputTotal = 0
  for (const expense of expenses) {
    if (expense.voided) continue
    const amount = Number(expense.amount) || 0
    const group = expense.group || 'other'
    total = round2(total + amount)
    groups[group] = round2(groups[group] + amount)
    if (effectiveExpenseEconomicType(expense) === 'production_input') productionInputTotal = round2(productionInputTotal + amount)
    else operatingTotal = round2(operatingTotal + amount)
  }
  return { total, operatingTotal, productionInputTotal, groups }
}
