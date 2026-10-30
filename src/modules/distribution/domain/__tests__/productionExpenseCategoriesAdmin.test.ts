import {
  listExpenseGroups,
  mergeExpenseCategories,
  expenseCategoriesForGroup,
} from '../expenseCategories.ts'
import {
  adminExpensePreset,
} from '../expensePresets.ts'
import type { DistExpenseCategory } from '../../types.ts'

const assert = (condition: unknown, message = '') => {
  if (!condition) throw new Error(message || 'Assertion failed')
}
const equal = (actual: unknown, expected: unknown, label = '') => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

console.log('--- TEST 1: Grupo Compras para producción disponible ---')
const groups = listExpenseGroups([])
const prodInputGroup = groups.find(g => g.id === 'production_input')
assert(prodInputGroup, 'production_input debe existir en listExpenseGroups')
equal(prodInputGroup?.label, 'Compras para producción')
equal(prodInputGroup?.economicType, 'production_input')
equal(prodInputGroup?.active, true)
console.log('PASS Compras para producción es accesible como grupo directo')

console.log('--- TEST 2: Categorías de Compras para producción ---')
const categories = mergeExpenseCategories([])
const prodCategories = expenseCategoriesForGroup(categories, 'production_input')
assert(prodCategories.length >= 5, 'debe contener las categorías por defecto de producción')
assert(prodCategories.some(c => c.name === 'Carne'))
assert(prodCategories.some(c => c.name === 'Condimentos'))
assert(prodCategories.some(c => c.name === 'Tripas / envolturas'))
assert(prodCategories.some(c => c.name === 'Insumos de producción'))
assert(prodCategories.some(c => c.name === 'Otros insumos'))
console.log('PASS categorías por defecto de producción presentes')

console.log('--- TEST 3: Creación y edición de categoría propia en Compras para producción ---')
const customCategory: DistExpenseCategory = {
  id: 'custom-production_input-test1',
  restaurantId: 'sanjose',
  branchId: 'main',
  createdAt: '2026-10-30T12:00:00.000Z',
  createdBy: 'admin',
  dayKey: '2026-10-30',
  schemaVersion: 1,
  group: 'production_input',
  name: 'Sal nitrificada',
  active: true,
  order: 50,
  autoClassifiable: true,
  distributorVisible: false,
}
const updatedCategories = mergeExpenseCategories([customCategory])
const prodCategoriesUpdated = expenseCategoriesForGroup(updatedCategories, 'production_input')
assert(prodCategoriesUpdated.some(c => c.id === customCategory.id && c.name === 'Sal nitrificada'))

// Presets para compras
const adminPreset = adminExpensePreset(customCategory)
assert(adminPreset, 'adminPreset generado para categoría de producción')
equal(adminPreset?.economicType, 'production_input')
equal(adminPreset?.group, 'production_input')
console.log('PASS categoría propia creada en Compras para producción lista para registrar compras')

console.log('--- TEST 4: Distinción contable entre Gasto operativo y Compra para producción ---')
const prodAdditionalGroup = groups.find(g => g.id === 'production_additional')
assert(prodAdditionalGroup)
equal(prodAdditionalGroup?.economicType, 'operating_expense', 'Gasto de producción adicional es gasto operativo')
assert(prodInputGroup?.economicType !== prodAdditionalGroup?.economicType, 'Tratamientos económicos deben ser distintos')

// Una categoría en operating_expense
const operatingCat: DistExpenseCategory = {
  id: 'custom-op-test',
  restaurantId: 'sanjose', branchId: 'main', createdAt: '', createdBy: 'admin', dayKey: '',
  schemaVersion: 1, group: 'production_additional', name: 'Mantenimiento molino', active: true, order: 10,
}
const opPreset = adminExpensePreset(operatingCat)
equal(opPreset?.economicType, 'operating_expense')
console.log('PASS distinción contable protegida: Gasto de producción adicional (operativo) vs Compras para producción (insumo)')

console.log('ALL PRODUCTION EXPENSE CATEGORIES TESTS PASSED!')
