import registry from '../../../../functions/expense-presets.json' with { type: 'json' }
import type { DistExpenseCategory, DistExpenseGroup, ExpenseEconomicType, ExpenseGroupId } from '../types.ts'

export interface ExpensePreset {
  id: string
  label: string
  group: ExpenseGroupId
  categoryId: string
  categoryName: string
  economicType: ExpenseEconomicType
  classificationStatus: 'classified' | 'pending_review' | 'reviewed'
  classificationSource: 'automatic' | 'user_pending' | 'admin_review'
  requiresDetail: boolean
}

export const EXPENSE_PRESETS = [...registry.choices, ...registry.production] as ExpensePreset[]
export const EXPENSE_PRODUCTION_PRESETS = registry.production as ExpensePreset[]
export const EXPENSE_TOP_LEVEL_CHOICES = [
  ...registry.choices.map(({ id, label }) => ({ value: id, label })),
  { value: 'production_input', label: 'Materia prima / producción' },
]

/** Hides a built-in shortcut when its category was moved to another active group. */
export function isExpensePresetChoiceAvailable(choiceId: string, categories: DistExpenseCategory[]): boolean {
  const preset = EXPENSE_PRESETS.find(item => item.id === choiceId)
  if (!preset) return true
  const current = categories.find(category => category.id === preset.categoryId)
  return !current || (current.active && current.group === preset.group)
}

export function customExpensePreset(category: DistExpenseCategory, includeAdminOnly = false, customGroups: DistExpenseGroup[] = []): ExpensePreset | null {
  if (!category.active || !category.autoClassifiable || (!category.distributorVisible && !includeAdminOnly)) return null
  const customGroup = customGroups.find((group) => group.id === category.group && group.active)
  const validGroup = ['administration', 'indirect', 'equipment', 'other', 'production_additional', 'production_input'].includes(category.group) || Boolean(customGroup)
  if (!validGroup) return null
  const economicType = customGroup?.economicType || (category.group === 'production_input' ? 'production_input' : 'operating_expense')
  return {
    id: `category:${category.id}`,
    label: category.name,
    group: category.group,
    categoryId: category.id,
    categoryName: category.name,
    economicType,
    classificationStatus: 'classified',
    classificationSource: 'automatic',
    requiresDetail: false,
  }
}

/** Categorías manuales de Administración: la selección explícita queda auditada. */
export function adminExpensePreset(category: DistExpenseCategory, customGroups: DistExpenseGroup[] = []): ExpensePreset | null {
  const customGroup = customGroups.find((group) => group.id === category.group && group.active)
  if (!category.active || (!['administration', 'indirect', 'equipment', 'other', 'production_additional', 'production_input'].includes(category.group) && !customGroup)) return null
  return {
    id: `admin-category:${category.id}`,
    label: category.name,
    group: category.group,
    categoryId: category.id,
    categoryName: category.name,
    economicType: customGroup?.economicType || (category.group === 'production_input' ? 'production_input' : 'operating_expense'),
    classificationStatus: 'reviewed',
    classificationSource: 'admin_review',
    requiresDetail: false,
  }
}
