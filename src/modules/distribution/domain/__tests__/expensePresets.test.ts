import { isExpenseReviewPending } from '../expenseReview.ts'
import type { DistExpense } from '../../types.ts'
import registry from '../../../../../functions/expense-presets.json' with { type: 'json' }
import { adminExpensePreset, customExpensePreset } from '../expensePresets.ts'
import { DEFAULT_EXPENSE_CATEGORIES } from '../expenseCategories.ts'

const check = (ok: boolean, message: string) => { if (!ok) throw new Error(message); console.log(`PASS ${message}`) }

const byId = new Map([...registry.choices, ...registry.production].map((preset) => [preset.id, preset]))
for (const id of ['fuel', 'toll_parking', 'refreshments_travel', 'maintenance_repair', 'tools_equipment']) {
  const preset = byId.get(id)
  check(Boolean(preset && preset.classificationStatus === 'classified' && preset.classificationSource === 'automatic' && preset.economicType === 'operating_expense'), `${id} tiene clasificación operativa automática`)
}
for (const preset of registry.production) {
  check(preset.group === 'production_input' && preset.categoryId.startsWith('production_input-') && preset.economicType === 'production_input' && preset.classificationStatus === 'classified', `${preset.label} queda como materia prima sin afectar el resultado`)
}
const other = byId.get('other_unsure')
check(Boolean(other && other.group === 'other' && other.classificationStatus === 'pending_review' && other.classificationSource === 'user_pending' && other.economicType === 'operating_expense'), 'Otro queda pendiente y se computa conservadoramente como egreso operativo')

const base = { id: 'pending', restaurantId: 'sanjose', branchId: 'main', createdAt: '2026-10-16T12:00:00Z', createdBy: 'seller', dayKey: '2026-10-16', schemaVersion: 1, operationId: 'pending', concept: 'Otro', amount: 30, routeId: 'route-a', routeName: 'Ruta A', registeredByUid: 'seller', registeredByName: 'Vendedor', group: 'other' as const, categoryId: 'other-2', economicType: 'operating_expense' as const, affectsOperatingResult: true }
const pendingExpense = { ...base, classificationStatus: 'pending_review' as const, classificationSource: 'user_pending' as const } as DistExpense
const autoExpense = { ...base, id: 'auto', operationId: 'auto', classificationStatus: 'classified' as const, classificationSource: 'automatic' as const } as DistExpense
const reviewedExpense = { ...base, id: 'reviewed', operationId: 'reviewed', classificationStatus: 'reviewed' as const, classificationSource: 'admin_review' as const } as DistExpense
check(isExpenseReviewPending(pendingExpense) && !isExpenseReviewPending(autoExpense) && !isExpenseReviewPending(reviewedExpense), 'la bandeja distingue pendientes, automáticos y revisados')
check(isExpenseReviewPending({ ...autoExpense, id: 'legacy', classificationStatus: undefined, economicType: undefined, affectsOperatingResult: undefined }), 'históricos sin decisión económica continúan pendientes')
const cleaning = DEFAULT_EXPENSE_CATEGORIES.find(category => category.id === 'administration-2')!
check(cleaning.name === 'Limpieza' && adminExpensePreset(cleaning)?.classificationSource === 'admin_review' && adminExpensePreset(cleaning)?.classificationStatus === 'reviewed', 'Administración puede seleccionar Limpieza activa sin autoClassifiable y queda revisada')
check(customExpensePreset(cleaning, false) === null, 'Limpieza no se habilita automáticamente para distribuidores')
check(adminExpensePreset({ ...cleaning, id: 'custom-production', group: 'production_input', name: 'Insumo adicional' })?.economicType === 'production_input', 'el grupo de producción conserva el tratamiento de materia prima')
check(adminExpensePreset({ ...cleaning, active: false }) === null, 'categorías inactivas no se ofrecen a Administración')
console.log('PASS expense presets: opciones seguras, materia prima y revisión')
