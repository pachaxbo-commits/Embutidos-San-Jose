import { calculateProductKardex } from '../productKardex.ts'
import type { DistStockMovement } from '../../types.ts'

const row = (id: string, extra: Partial<DistStockMovement>): DistStockMovement => ({
  id, restaurantId: 'sanjose', branchId: 'main', createdAt: `2026-10-${String(Number(id)).padStart(2, '0')}T10:00:00Z`, createdBy: 'qa', dayKey: '2026-10-01', schemaVersion: 1,
  type: 'intake', productId: 'p', productName: 'Producto', unitType: 'kg', quantity: 0, centralDelta: 0, routeDelta: 0, ...extra,
})

const movements = [
  row('1', { type: 'intake', quantity: 100, toLocation: 'central', centralDelta: 100 }),
  row('2', { type: 'dispatch', quantity: 20, fromLocation: 'central', toLocation: 'route__r', routeId: 'r', centralDelta: -20, routeDelta: 20 }),
  row('3', { type: 'sale', quantity: 5, fromLocation: 'route__r', routeId: 'r', routeDelta: -5 }),
  row('4', { type: 'return', quantity: 3, fromLocation: 'route__r', toLocation: 'central', routeId: 'r', centralDelta: 3, routeDelta: -3 }),
  row('5', { type: 'adjustment', quantity: 2, fromLocation: 'central', centralDelta: -2 }),
  row('6', { type: 'adjustment', quantity: 10, fromLocation: 'central', centralDelta: -10, reversedAt: '2026-10-07T11:00:00Z' }),
  row('7', { type: 'adjustment', quantity: 1, fromLocation: 'central', centralDelta: -1, rectifiedAt: '2026-10-08T11:00:00Z' }),
  row('8', { type: 'adjustment', quantity: 1, toLocation: 'central', centralDelta: 1 }),
]

const central = calculateProductKardex(movements, 'p', 'central')
const route = calculateProductKardex(movements, 'p', 'route__r')
const company = calculateProductKardex(movements, 'p', 'all')
if (central.at(-1)?.runningBalance !== 82) throw new Error(`Saldo central: esperado 82, obtenido ${central.at(-1)?.runningBalance}`)
if (route.at(-1)?.runningBalance !== 12) throw new Error(`Saldo ruta: esperado 12, obtenido ${route.at(-1)?.runningBalance}`)
if (company.at(-1)?.runningBalance !== 94) throw new Error(`Saldo empresa: esperado 94, obtenido ${company.at(-1)?.runningBalance}`)
if (central.find((entry) => entry.movement.id === '2')?.delta !== -20) throw new Error('El despacho debe salir de central.')
if (route.find((entry) => entry.movement.id === '2')?.delta !== 20) throw new Error('El despacho debe entrar a la ruta.')
if (company.find((entry) => entry.movement.id === '2')?.delta !== 0) throw new Error('El despacho a una ruta no es salida de inventario de la empresa.')
if (central.find((entry) => entry.movement.id === '6')?.delta !== 0 || central.find((entry) => entry.movement.id === '7')?.delta !== 0) throw new Error('Movimientos revertidos/rectificados no se suman dos veces.')
console.log('PASS Kardex separa ubicaciones, transferencias, reversión y rectificación sin netear salidas internas.')
