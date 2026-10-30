import type { DistExpenseCategory, DistExpenseGroup, ExpenseGroup, ExpenseGroupId } from '../types.ts'
import registry from '../../../../functions/expense-presets.json' with { type: 'json' }

export const EXPENSE_GROUPS: { id: ExpenseGroup; label: string }[] = [
  { id: 'administration', label: 'Gastos de administración' },
  { id: 'indirect', label: 'Gastos indirectos' },
  { id: 'commercialization', label: 'Gastos de comercialización' },
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
    active: !(group === 'indirect' && ['indirect-7', 'indirect-8', 'indirect-9'].includes(`${group}-${order + 1}`)),
    order: groupIndex * 100 + order,
  })),
)

export function mergeExpenseCategories(overrides: DistExpenseCategory[]): DistExpenseCategory[] {
  const byId = new Map(DEFAULT_EXPENSE_CATEGORIES.map((category) => [category.id, category]))
  for (const category of overrides) {
    const movedPresetCategory = category.group === 'indirect' && ['indirect-7', 'indirect-8', 'indirect-9'].includes(category.id)
    byId.set(category.id, movedPresetCategory ? { ...category, active: false } : category)
  }
  return [...byId.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'es'))
}

export function expenseGroupLabel(group?: string): string {
  return EXPENSE_GROUPS.find((entry) => entry.id === group)?.label ?? 'Otros / Por clasificar'
}

export function listExpenseGroups(custom: DistExpenseGroup[]): Array<{ id: ExpenseGroupId; label: string; economicType: 'operating_expense' | 'production_input'; active: boolean; order: number }> {
  const overrides = new Map(custom.map((group) => [group.id, group]))
  const defaults = EXPENSE_GROUPS.map((group, order) => ({
    id: group.id,
    label: overrides.get(group.id)?.name || group.label,
    economicType: group.id === 'production_input' ? 'production_input' as const : 'operating_expense' as const,
    active: overrides.get(group.id)?.active ?? true,
    order: overrides.get(group.id)?.order ?? order,
  }))
  const additional = custom.filter((group) => !EXPENSE_GROUPS.some((builtin) => builtin.id === group.id)).map((group) => ({ id: group.id, label: group.name, economicType: group.economicType, active: group.active, order: group.order }))
  return [...defaults, ...additional]
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'es'))
}

export function expenseGroupDisplayName(group?: string, custom: DistExpenseGroup[] = []): string {
  return listExpenseGroups(custom).find((entry) => entry.id === group)?.label ?? EXPENSE_GROUPS.find((entry) => entry.id === group)?.label ?? 'Otros / Por clasificar'
}

export function effectiveExpenseGroup(expense: { group?: string; categoryId?: string }): string {
  return expense.group ?? 'other'
}
