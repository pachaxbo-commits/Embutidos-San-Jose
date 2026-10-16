import type { DistExpenseCategory, ExpenseGroup } from '../types.ts'
import registry from '../../../../functions/expense-presets.json' with { type: 'json' }

export const EXPENSE_GROUPS: { id: ExpenseGroup; label: string }[] = [
  { id: 'administration', label: 'Gastos de administración' },
  { id: 'indirect', label: 'Gastos indirectos' },
  { id: 'equipment', label: 'Gastos de equipamiento' },
  { id: 'other', label: 'Otros egresos operativos' },
  { id: 'production_additional', label: 'Gasto de producción adicional' },
  { id: 'production_input', label: 'Compras para producción' },
]

const INITIAL = registry.defaults as Record<ExpenseGroup, string[]>

export const DEFAULT_EXPENSE_CATEGORIES: DistExpenseCategory[] = Object.entries(INITIAL).flatMap(([group, names], groupIndex) =>
  names.map((name, order) => ({
    id: `${group}-${order + 1}`,
    restaurantId: 'sanjose',
    branchId: 'main',
    createdAt: '',
    createdBy: 'system',
    dayKey: '',
    schemaVersion: 1,
    group: group as ExpenseGroup,
    name,
    active: true,
    order: groupIndex * 100 + order,
  })),
)

export function mergeExpenseCategories(overrides: DistExpenseCategory[]): DistExpenseCategory[] {
  const byId = new Map(DEFAULT_EXPENSE_CATEGORIES.map((category) => [category.id, category]))
  for (const category of overrides) byId.set(category.id, category)
  return [...byId.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'es'))
}

export function expenseGroupLabel(group?: ExpenseGroup): string {
  return EXPENSE_GROUPS.find((entry) => entry.id === group)?.label ?? 'Otros / Por clasificar'
}

export function effectiveExpenseGroup(expense: { group?: ExpenseGroup; categoryId?: string }): ExpenseGroup {
  return expense.group ?? 'other'
}
