import { filterProductMovementHistory, isDispatchWithMerma } from '../productMovementHistory.ts'
import type { DistStockMovement } from '../../types.ts'

const movement = (id: string, type: DistStockMovement['type'], extra: Partial<DistStockMovement> = {}): DistStockMovement => ({
  id, restaurantId: 'sanjose', branchId: 'main', createdAt: `2026-10-${String(id.length + 1).padStart(2, '0')}T10:00:00Z`, createdBy: 'qa', dayKey: '2026-10-01', schemaVersion: 1,
  type, productId: 'p1', productName: 'Producto', unitType: 'kg', quantity: 1, centralDelta: 0, routeDelta: 0, ...extra,
})

const rows = [
  movement('intake', 'intake'),
  movement('dispatch', 'dispatch', { quantity: 82.3, normalQuantity: 80, dispatchMerma: 2.3 }),
  movement('return', 'return'),
  movement('return_merma', 'return_merma'),
  movement('return_waste', 'return_waste'),
  movement('shortage', 'shortage'),
  movement('overage', 'overage'),
  movement('quarantine-release', 'quarantine_release'),
  movement('quarantine-discard', 'quarantine_discard'),
  movement('adjustment', 'adjustment'),
  movement('sale', 'sale', { quantity: 5 }),
  movement('sale_correction', 'sale_correction', { quantity: 1 }),
  movement('wrong-product', 'intake', { productId: 'p2' }),
]

// 1. All movements of product (excluding p2)
const all = filterProductMovementHistory(rows, 'p1', 'all')
if (all.length !== 12) throw new Error(`Historial completo debe incluir 12 movimientos del producto, got ${all.length}`)

// 2. Losses filter
const losses = filterProductMovementHistory(rows, 'p1', 'losses')
if (losses.length !== 4 || !losses.some(isDispatchWithMerma) || !losses.some((row) => row.type === 'return_merma') || !losses.some((row) => row.type === 'return_waste') || !losses.some((row) => row.type === 'quarantine_discard')) {
  throw new Error('Filtro Mermas distingue merma de despacho, recuperable, pérdida y descarte de cuarentena.')
}

// 3. Shortages filter
const shortages = filterProductMovementHistory(rows, 'p1', 'shortages')
if (shortages.length !== 1 || shortages[0].type !== 'shortage') {
  throw new Error(`Filtro faltantes debe contener exactamente shortage, got ${shortages.length}`)
}

// 4. Overages filter
const overages = filterProductMovementHistory(rows, 'p1', 'overages')
if (overages.length !== 1 || overages[0].type !== 'overage') {
  throw new Error(`Filtro sobrantes debe contener exactamente overage, got ${overages.length}`)
}

// 5. Dispatches filter
const dispatches = filterProductMovementHistory(rows, 'p1', 'dispatches')
if (dispatches.length !== 1 || dispatches[0].type !== 'dispatch') {
  throw new Error(`Filtro despachos debe contener exactamente dispatch, got ${dispatches.length}`)
}

// 6. Intakes filter: MUST NOT INCLUDE SALES
const intakes = filterProductMovementHistory(rows, 'p1', 'intakes')
if (intakes.length !== 2 || !intakes.some(r => r.type === 'intake') || !intakes.some(r => r.type === 'quarantine_release')) {
  throw new Error(`Filtro ingresos debe contener intake y quarantine_release, got ${intakes.length}`)
}
if (intakes.some(r => r.type === 'sale' || r.type === 'sale_correction')) {
  throw new Error('CRITICAL BUG: Filtro ingresos NUNCA debe contener ventas ni correcciones de venta.')
}

// 7. Adjustments filter: MUST NOT INCLUDE SALES
const adjustments = filterProductMovementHistory(rows, 'p1', 'adjustments')
if (adjustments.length !== 1 || adjustments[0].type !== 'adjustment') {
  throw new Error(`Filtro ajustes debe contener adjustment, got ${adjustments.length}`)
}
if (adjustments.some(r => r.type === 'sale')) {
  throw new Error('Filtro ajustes no debe contener ventas.')
}

// 8. Returns filter
const returns = filterProductMovementHistory(rows, 'p1', 'returns')
if (returns.length !== 3 || !returns.some(r => r.type === 'return') || !returns.some(r => r.type === 'return_merma') || !returns.some(r => r.type === 'return_waste')) {
  throw new Error(`Filtro devoluciones debe contener return, return_merma y return_waste, got ${returns.length}`)
}

// 9. Sales filter: MUST ONLY CONTAIN REAL SALES (not sale_correction)
const sales = filterProductMovementHistory(rows, 'p1', 'sales')
if (sales.length !== 1 || sales[0].type !== 'sale' || sales[0].quantity !== 5) {
  throw new Error(`Filtro ventas debe contener únicamente ventas reales, got ${sales.length}`)
}
if (sales.some(r => r.type === 'sale_correction')) {
  throw new Error('CRITICAL BUG: Filtro ventas NUNCA debe duplicar una venta contando sale_correction como venta ficticia.')
}

// 10. Legacy aliases
if (filterProductMovementHistory(rows, 'p1', 'differences').length !== 2) throw new Error('Filtro diferencias incluye faltantes y sobrantes.')
if (filterProductMovementHistory(rows, 'p1', 'intakesAdjustments').length !== 3) throw new Error('Filtro intakesAdjustments incluye intake, quarantine_release y adjustment (sin ventas).')

console.log('PASS historial por producto: todos los filtros validados y ventas estrictamente aisladas')
