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
  movement('wrong-product', 'intake', { productId: 'p2' }),
]

if (filterProductMovementHistory(rows, 'p1', 'all').length !== 9) throw new Error('Historial completo debe incluir los movimientos del producto.')
const losses = filterProductMovementHistory(rows, 'p1', 'losses')
if (losses.length !== 4 || !losses.some(isDispatchWithMerma) || !losses.some((row) => row.type === 'return_merma') || !losses.some((row) => row.type === 'return_waste') || !losses.some((row) => row.type === 'quarantine_discard')) throw new Error('Filtro Mermas distingue merma de despacho, recuperable, pérdida y descarte de cuarentena.')
if (filterProductMovementHistory(rows, 'p1', 'differences').length !== 2) throw new Error('Filtro diferencias incluye faltantes y sobrantes.')
if (filterProductMovementHistory(rows, 'p1', 'dispatchReturns').length !== 6) throw new Error('Filtro despachos/retornos incluye despacho, devoluciones y diferencias.')
if (filterProductMovementHistory(rows, 'p1', 'intakesAdjustments').length !== 2) throw new Error('Filtro ingresos/ajustes incluye ingresos y liberaciones auditadas de cuarentena.')

console.log('PASS historial por producto incluye ledger completo y filtros de merma/diferencias/despachos/ingresos')
