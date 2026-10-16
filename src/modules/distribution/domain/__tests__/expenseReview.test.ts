import { filterExpensesByStatus, isExpenseReviewPending, summarizeActiveExpenses } from '../expenseReview.ts'
import type { DistExpense } from '../../types.ts'

const seed = { id: 'x', restaurantId: 'sanjose', branchId: 'main', createdAt: '2026-10-15T12:00:00Z', createdBy: 'admin', dayKey: '2026-10-15', schemaVersion: 1, operationId: 'op', concept: 'Gasto', amount: 10, routeId: 'administracion', routeName: 'Administración', registeredByUid: 'admin', registeredByName: 'Admin' }
const active = { ...seed, id: 'active', group: 'indirect', categoryId: 'indirect-1', affectsOperatingResult: true } as DistExpense
const excludedFromResult = { ...active, id: 'included', amount: 30, economicType: 'production_input', affectsOperatingResult: false, group: 'production_input', categoryId: 'production_input-1' } as DistExpense
const voided = { ...active, id: 'voided', amount: 90, voided: true } as DistExpense
const unclassified = { ...seed, id: 'old', group: undefined, categoryId: undefined, affectsOperatingResult: true } as DistExpense
const check = (ok: boolean, message: string) => { if (!ok) throw new Error(message); console.log(`PASS ${message}`) }

const fixtures = [active, excludedFromResult, voided, unclassified]
check(filterExpensesByStatus(fixtures, 'active').length === 3, 'la vista Activos omite los egresos anulados')
check(filterExpensesByStatus(fixtures, 'voided').length === 1 && filterExpensesByStatus(fixtures, 'voided')[0].id === 'voided', 'la vista Anulados permite consultar registros históricos anulados')
check(filterExpensesByStatus(fixtures, 'all').length === 4, 'la vista Todos incluye activos y anulados')
const totals = summarizeActiveExpenses(fixtures)
check(totals.total === 50 && totals.operatingTotal === 20 && totals.productionInputTotal === 30 && totals.groups.indirect === 10 && totals.groups.production_input === 30 && totals.groups.other === 10, 'totales distinguen salidas, operación y materia prima excluyendo anulados')
check(isExpenseReviewPending(unclassified) && !isExpenseReviewPending(active) && !isExpenseReviewPending(voided), 'pendientes considera grupo/categoría/decisión faltantes y omite anulados')
check(isExpenseReviewPending({ ...active, affectsOperatingResult: undefined }), 'una decisión histórica no definida queda pendiente de revisión')
console.log('PASS expense review: estados, totales activos y pendientes')
