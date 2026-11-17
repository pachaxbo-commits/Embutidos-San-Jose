import { resolveLotSearchResults } from '../lotSearch.ts'
import { buildLotTraceability } from '../lotTraceability.ts'
import type { DistLot, DistProduct, DistStockMovement } from '../../types.ts'

const assert = {
  equal(actual: unknown, expected: unknown) {
    if (actual !== expected) throw new Error(`Expected ${String(expected)}, got ${String(actual)}`)
  },
  deepEqual(actual: unknown, expected: unknown) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    }
  },
}

const makeLot = (id: string, productId: string, productName: string, stock: number): DistLot => ({
  id,
  restaurantId: 'sanjose',
  productId,
  productName,
  lotCode: '101126',
  manufacturedOn: '2026-11-10',
  expiresOn: '2026-12-10',
  unitType: 'unit',
  productionCost: null,
  quantities: { central: stock },
  createdAt: '2026-11-10T09:00:00.000Z',
  createdBy: 'test',
} as DistLot)

const productA = { id: 'mortadela', name: 'Sachet Mortadela PRIMAVERA', unitType: 'unit' } as DistProduct
const productB = { id: 'jamon', name: 'Jamón de cerdo PORCIONADO', unitType: 'unit' } as DistProduct
const lotA = makeLot('lot-A', productA.id, productA.name, 9)
const lotB = makeLot('lot-B', productB.id, productB.name, 0)

const results = resolveLotSearchResults([lotA, lotB], [productA, productB])
assert.deepEqual(results.map(({ lot, productName, currentStock }) => [lot.id, productName, currentStock]), [
  ['lot-A', 'Sachet Mortadela PRIMAVERA', 9],
  ['lot-B', 'Jamón de cerdo PORCIONADO', 0],
])
assert.equal(
  resolveLotSearchResults([makeLot('old-lot', 'removed-product', 'legacy name', 0)], [])[0].productName,
  'Producto histórico / no disponible en catálogo',
)
assert.equal(
  buildLotTraceability({ lot: makeLot('old-lot', 'removed-product', 'legacy name', 0), movements: [] }).identification.productName,
  'Producto histórico / no disponible en catálogo',
)

const movement = (id: string, productId: string, lotId: string, quantity: number): DistStockMovement => ({
  id,
  restaurantId: 'sanjose',
  type: 'sale',
  productId,
  productName: 'producto',
  unitType: 'unit',
  quantity,
  centralDelta: 0,
  routeDelta: -quantity,
  createdAt: '2026-11-11T10:00:00.000Z',
  createdBy: 'test',
  dayKey: '2026-11-11',
  lotId,
  lotCode: '101126',
} as DistStockMovement)

const movements = [
  movement('sale-A', productA.id, lotA.id, 2),
  movement('sale-B', productB.id, lotB.id, 3),
] as DistStockMovement[]
const traceA = buildLotTraceability({ lot: lotA, product: productA, movements })
const traceB = buildLotTraceability({ lot: lotB, product: productB, movements })
assert.equal(traceA.summary.soldQuantity, 2)
assert.equal(traceB.summary.soldQuantity, 3)
assert.deepEqual(traceA.timeline.map((event) => event.id), ['sale-A'])
assert.deepEqual(traceB.timeline.map((event) => event.id), ['sale-B'])

console.log('✓ Búsqueda con códigos duplicados resuelve producto, stock y trazabilidad por lot.id + productId.')
