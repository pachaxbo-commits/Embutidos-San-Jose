import type { DistLot, DistProduct } from '../../types'
import { dispatchLotIneligibility, dispatchLotFifoDate, sortDispatchLotsFefo, sortDispatchLotsFifo, sortDispatchProducts, validateDispatchLotDrafts } from '../dispatchSelection.ts'

const product = (id: string, name: string, category: string, sortOrder: number): DistProduct => ({
  id, name, category, unitType: 'kg', referencePrice: 10, active: true, sortOrder,
  restaurantId: 'sanjose', createdAt: '2026-10-01T00:00:00.000Z',
})

const pork = product('pork', 'Carne de cerdo', 'Producción', 99)
const sausage = product('sausage', 'Salchicha', 'Granel', 1)
const mortadella = product('mortadella', 'Mortadela', 'Al vacío', 0)

const lot = (value: Partial<DistLot> & Pick<DistLot, 'id' | 'lotCode' | 'productId' | 'productName'>): DistLot => ({
  ...value,
  restaurantId: value.restaurantId || 'sanjose',
  unitType: value.unitType || 'kg',
  manufacturedOn: value.manufacturedOn || '',
  expiresOn: value.expiresOn || '',
  productionCost: value.productionCost === undefined ? 1 : value.productionCost,
  quantities: value.quantities || { central: 0 },
  createdAt: value.createdAt || '2026-10-30T00:00:00.000Z',
  createdBy: value.createdBy || 'qa',
})

const oldest = lot({ id: 'lot-old', lotCode: 'P-01', productId: 'pork', productName: pork.name, manufacturedOn: '2026-10-01', expiresOn: '2026-11-20', createdAt: '2026-10-02T10:00:00.000Z', quantities: { central: 3 } })
const newer = lot({ id: 'lot-new', lotCode: 'P-02', productId: 'pork', productName: pork.name, manufacturedOn: '2026-10-10', expiresOn: '2026-11-10', createdAt: '2026-10-11T10:00:00.000Z', quantities: { central: 8 } })
const missingManufacture = lot({ id: 'lot-fallback', lotCode: 'P-00', productId: 'pork', productName: pork.name, manufacturedOn: '', createdAt: '2026-09-30T10:00:00.000Z', expiresOn: '2026-12-01', quantities: { central: 1 } })

function check(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}

const orderedProducts = sortDispatchProducts([pork, sausage, mortadella])
check(orderedProducts.map(item => item.category).join('|') === 'Al vacío|Granel|Producción', 'productos agrupados operativamente por categoría, no por creación')
check(sortDispatchProducts([pork, sausage, mortadella]).map(item => item.id).join(',') === orderedProducts.map(item => item.id).join(','), 'orden de productos estable')

const orderedFifo = sortDispatchLotsFifo([newer, oldest, missingManufacture])
check(orderedFifo.map(item => item.id).join(',') === 'lot-fallback,lot-old,lot-new', 'FIFO por elaboración y fecha de ingreso de respaldo')
check(dispatchLotFifoDate(missingManufacture) === '2026-09-30', 'fecha de ingreso usada cuando falta fecha de elaboración')
check(sortDispatchLotsFefo([oldest, newer]).map(item => item.id).join(',') === 'lot-new,lot-old', 'FEFO automático sigue priorizando vencimiento próximo')

const validDraft = [{ id: 'line', productId: 'pork', quantity: '3', allocations: [{ id: 'allocation', lotId: oldest.id, quantity: '3' }] }]
check(validateDispatchLotDrafts(validDraft, [pork], [oldest, newer], 'central', '2026-10-30').length === 0, 'cantidad igual a existencia disponible aceptada')

const overLimit = validateDispatchLotDrafts([{ ...validDraft[0], quantity: '5', allocations: [{ id: 'allocation', lotId: oldest.id, quantity: '5' }] }], [pork], [oldest, newer], 'central', '2026-10-30')
check(overLimit.some(issue => issue.message.includes('Producto Carne de cerdo · lote P-01: ingresado 5 kg, disponible 3 kg; exceso 2 kg')), 'exceso por lote identifica producto, lote, ingresado, disponible y exceso inmediatamente')

const duplicateLots = validateDispatchLotDrafts([{ ...validDraft[0], quantity: '4', allocations: [{ id: 'a', lotId: oldest.id, quantity: '2' }, { id: 'b', lotId: oldest.id, quantity: '2' }] }], [pork], [oldest, newer], 'central', '2026-10-30')
check(duplicateLots.some(issue => issue.message.includes('lote P-01: está repetido')), 'duplicación manual del mismo lote identificada')

const ineligible = lot({ id: 'quarantined', lotCode: 'P-Q', productId: 'pork', productName: pork.name, quarantined: true, quantities: { central: 2 } })
const invalidLot = validateDispatchLotDrafts([{ ...validDraft[0], allocations: [{ id: 'bad', lotId: ineligible.id, quantity: '3' }] }], [pork], [ineligible], 'central', '2026-10-30')
check(invalidLot.some(issue => issue.message.includes('Producto Carne de cerdo · lote P-Q: no se puede despachar porque está en cuarentena')), 'lote no elegible identifica producto, lote y motivo')
check(dispatchLotIneligibility(ineligible, pork.id, 'central', '2026-10-30')?.includes('cuarentena'), 'motivo de cuarentena exacto')

const missingLot = validateDispatchLotDrafts([{ ...validDraft[0], allocations: [{ id: 'missing', lotId: 'deleted-lot', quantity: '3' }] }], [pork], [oldest], 'central', '2026-10-30')
check(missingLot.some(issue => issue.message.includes('lote deleted-lot: ya no aparece en inventario')), 'lote inexistente identificado con el producto')

const multipleErrors = validateDispatchLotDrafts([
  { ...validDraft[0], id: 'line-a', quantity: '5', allocations: [{ id: 'a', lotId: oldest.id, quantity: '5' }] },
  { ...validDraft[0], id: 'line-b', quantity: '4', allocations: [{ id: 'b', lotId: ineligible.id, quantity: '4' }] },
], [pork], [oldest, ineligible], 'central', '2026-10-30')
check(multipleErrors.length >= 3, 'todos los errores de varios productos y lotes se devuelven para mostrarlos juntos')

console.log('11 comprobaciones de selección y validación de lotes aprobadas')
