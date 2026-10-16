import registry from '../../../../functions/expense-presets.json' with { type: 'json' }
import type { DistExpenseCategory, ExpenseEconomicType, ExpenseGroup } from '../types.ts'

export interface ExpensePreset {
  id: string
  label: string
  group: ExpenseGroup
  categoryId: string
  categoryName: string
  economicType: ExpenseEconomicType
  classificationStatus: 'classified' | 'pending_review'
  classificationSource: 'automatic' | 'user_pending'
  requiresDetail: boolean
}

export const EXPENSE_PRESETS = [...registry.choices, ...registry.production] as ExpensePreset[]
export const EXPENSE_PRODUCTION_PRESETS = registry.production as ExpensePreset[]
export const EXPENSE_TOP_LEVEL_CHOICES = [
  ...registry.choices.map(({ id, label }) => ({ value: id, label })),
  { value: 'production_input', label: 'Materia prima / producción' },
]

export function customExpensePreset(category: DistExpenseCategory, includeAdminOnly = false): ExpensePreset | null {
  if (!category.active || !category.autoClassifiable || (!category.distributorVisible && !includeAdminOnly)) return null
  if (!['administration', 'indirect', 'equipment', 'other', 'production_additional', 'production_input'].includes(category.group)) return null
  return {
    id: `category:${category.id}`,
    label: category.name,
    group: category.group,
    categoryId: category.id,
    categoryName: category.name,
    economicType: category.group === 'production_input' ? 'production_input' : 'operating_expense',
    classificationStatus: 'classified',
    classificationSource: 'automatic',
    requiresDetail: false,
  }
}
