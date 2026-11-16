import { getInventoryProductIds, moveInventoryProduct, sortInventoryProducts } from '../inventorySelection.ts'
import type { DistProduct } from '../../types.ts'

const makeProduct = (id: string, name: string, category = 'General', sortOrder = 0): DistProduct => ({
  id,
  name,
  category,
  sortOrder,
  active: true,
  unitType: 'kg',
  restaurantId: 'sanjose',
  createdAt: '2026-10-01T00:00:00Z',
  referencePrice: 10,
})

const p1 = makeProduct('p1', 'Chorizo Parrillero', 'Chorizos', 1)
const p2 = makeProduct('p2', 'Salchicha Viena', 'Embutidos', 2)
const p3 = makeProduct('p3', 'Mortadela Jamonada', 'Embutidos', 3)
const p4 = makeProduct('p4', 'Tocino Ahumado', 'Especiales', 4)

const products = [p2, p4, p1, p3]

// 1. Default ordering preserves sortOrder / category / name
const sortedDefault = sortInventoryProducts(products)
if (sortedDefault.map(p => p.id).join(',') !== 'p1,p2,p3,p4') {
  throw new Error(`Default sort failed: expected p1,p2,p3,p4 got ${sortedDefault.map(p => p.id).join(',')}`)
}

// 2. Saved order takes precedence
const customOrder = ['p4', 'p2', 'p1', 'p3']
const sortedCustom = sortInventoryProducts(products, customOrder)
if (sortedCustom.map(p => p.id).join(',') !== 'p4,p2,p1,p3') {
  throw new Error(`Custom sort failed: expected p4,p2,p1,p3 got ${sortedCustom.map(p => p.id).join(',')}`)
}

// 3. New product not in savedOrder gets appended at end
const p5 = makeProduct('p5', 'Jamón Artesanal', 'Especiales', 5)
const sortedWithNew = sortInventoryProducts([...products, p5], customOrder)
if (sortedWithNew.map(p => p.id).join(',') !== 'p4,p2,p1,p3,p5') {
  throw new Error(`Appending new product failed: expected p4,p2,p1,p3,p5 got ${sortedWithNew.map(p => p.id).join(',')}`)
}

// 4. moveInventoryProduct moves product correctly
const reordered = moveInventoryProduct(products, 'p1', 'p4')
const movedIdx = reordered.findIndex(p => p.id === 'p1')
const targetIdx = reordered.findIndex(p => p.id === 'p4')
if (movedIdx === -1 || targetIdx === -1) {
  throw new Error('moveInventoryProduct lost products')
}

// 5. getInventoryProductIds returns ids in order
const ids = getInventoryProductIds(products, customOrder)
if (ids.join(',') !== 'p4,p2,p1,p3') {
  throw new Error(`getInventoryProductIds mismatch: ${ids.join(',')}`)
}

console.log('PASS inventorySelection tests')
