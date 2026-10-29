import { listExpenseGroups, mergeExpenseCategories } from '../expenseCategories.ts'
const groups = listExpenseGroups([])
const categories = mergeExpenseCategories([])
const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message) }
assert(groups.some(group => group.id === 'commercialization' && group.economicType === 'operating_expense'), 'Gastos de comercialización existe como gasto operativo')
assert(categories.find(category => category.id === 'commercialization-1')?.name === 'Peaje / estacionamiento', 'peaje se clasifica en comercialización')
assert(categories.find(category => category.id === 'commercialization-2')?.name === 'Refrigerio / viáticos', 'viáticos se clasifican en comercialización')
assert(categories.find(category => category.id === 'commercialization-3')?.name === 'Mantenimiento / reparación', 'mantenimiento se clasifica en comercialización')
assert(!categories.find(category => category.id === 'indirect-7')?.active, 'categoría de peaje antigua queda desactivada en gastos indirectos')
console.log('PASS grupos económicos y categorías movidas para nuevos egresos; historial intacto')
