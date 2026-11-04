import type { DistLot, DistProduct } from '../../types'
import { dispatchLotIneligibility, dispatchLotFifoDate, moveDispatchProduct, sortDispatchLotsFefo, sortDispatchLotsFifo, sortDispatchProducts, toggleDispatchDraftProduct, validateDispatchLotDrafts } from '../dispatchSelection.ts'

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
const customOrder = sortDispatchProducts([pork, sausage, mortadella], ['pork', 'mortadella', 'sausage'])
check(customOrder.map(item => item.id).join(',') === 'pork,mortadella,sausage', 'orden guardado conserva posiciones incluso entre categorías')
const catalog = ['A', 'B', 'C', 'D'].map(id => product(id, `Producto ${id}`, 'Despacho', 0))
let selectedDraft: Array<{ productId: string; quantity: string }> = []
for (const productId of ['C', 'A', 'D', 'B']) {
  selectedDraft = toggleDispatchDraftProduct(selectedDraft, productId, () => ({ productId, quantity: '' }))
}
check(selectedDraft.map(line => line.productId).join(',') === 'C,A,D,B', 'borrador conserva C, A, D, B según el orden de selección aunque el catálogo sea A, B, C, D')
selectedDraft = toggleDispatchDraftProduct(selectedDraft, 'A', () => ({ productId: 'A', quantity: '' }))
check(selectedDraft.map(line => line.productId).join(',') === 'C,D,B', 'desmarcar un producto solo lo elimina de su posición')
selectedDraft = toggleDispatchDraftProduct(selectedDraft, 'A', () => ({ productId: 'A', quantity: '' }))
check(selectedDraft.map(line => line.productId).join(',') === 'C,D,B,A', 'volver a marcar un producto lo agrega al final del orden actual')
check(sortDispatchProducts(catalog).map(item => item.id).join(',') === 'A,B,C,D', 'el orden de selección del borrador no modifica el catálogo global')
const newProduct = product('new', 'Producto nuevo', 'Abarrotes', 0)
const withNewProduct = sortDispatchProducts([sausage, newProduct, mortadella, pork], ['pork', 'mortadella', 'sausage'])
check(withNewProduct.map(item => item.id).join(',') === 'pork,mortadella,sausage,new', 'producto nuevo se añade al final del orden personalizado')
const inactive = { ...product('inactive', 'Producto inactivo', 'Granel', 2), active: false }
check(sortDispatchProducts([inactive, pork, sausage].filter(item => item.active !== false), ['pork', 'sausage']).map(item => item.id).join(',') === 'pork,sausage', 'productos inactivos no aparecen en la lista ordenada')
check(moveDispatchProduct([pork, sausage, mortadella], 'sausage', 'pork').map(item => item.id).join(',') === 'sausage,pork,mortadella', 'movimiento manual puede cruzar categorías')
check(moveDispatchProduct([pork, sausage], 'missing', 'pork').map(item => item.id).join(',') === 'pork,sausage', 'movimiento de identificador inexistente deja intacta la lista')

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

const derivedBase = lot({ id: 'derived-sachet', lotCode: 'SACH-40', productId: 'pork', productName: pork.name, unitType: 'package', quantities: { central: 40 }, processingCommercialBlocked: true, processingDestinationKind: 'finished', processingBatchId: 'batch-derived', processingSourceAllocationBasis: 'batch_blend_accounting_allocation', processingPhysicalWeightGRemaining: 40500, processingCostCentsRemaining: 10000, processingUnavailable: { central: { courtesy: 0, repackPending: 0, reviewHold: 0 } }, processingByLocation: { central: { segments: [{ segmentId: 'segment-1', batchId: 'batch-derived', destinationId: 'finished-1', sourceMovementId: 'movement-1', weightBasis: 'measured_total', remainingQuantity: 40, remainingWeightG: 40500, remainingCostCents: 10000 }] } } })
const unreleasedDerived = { ...derivedBase, processingCommercialRelease: undefined }
check(dispatchLotIneligibility(unreleasedDerived, pork.id, 'central', '2026-10-30')?.includes('pendiente de liberación comercial'), 'lote terminado derivado trazable sin liberación no es apto para despacho')
const unreleasedResult = validateDispatchLotDrafts([{ id: 'derived-line', productId: pork.id, quantity: '40', allocations: [{ id: 'derived-allocation', lotId: derivedBase.id, quantity: '40' }] }], [pork], [unreleasedDerived], 'central', '2026-10-30')
check(unreleasedResult.some(issue => issue.severity === 'error' && issue.message.includes('pendiente de liberación')), 'lote derivado no liberado se clasifica como error real y bloquea continuar')
const releasedDerived = { ...derivedBase, processingCommercialRelease: { status: 'released' as const, batchId: 'batch-derived', approvedBy: 'admin', approvedAt: '2026-10-30T12:00:00.000Z', operationId: 'release-1', reason: 'Apto para despacho y venta', physicalWeightG: 40500, costCents: 10000 } }
check(dispatchLotIneligibility(releasedDerived, pork.id, 'central', '2026-10-30') === null, 'mismo lote es apto al tener liberación coincidente y segmentos conciliados')
check(dispatchLotIneligibility({ ...releasedDerived, processingCommercialRelease: { ...releasedDerived.processingCommercialRelease, batchId: 'another-batch' } }, pork.id, 'central', '2026-10-30')?.includes('pendiente de liberación comercial'), 'release cuyo batchId no coincide no habilita despacho')
check(dispatchLotIneligibility({ ...releasedDerived, quarantined: true }, pork.id, 'central', '2026-10-30')?.includes('cuarentena'), 'liberación no omite cuarentena')

const unfinished = validateDispatchLotDrafts([{ id: 'unfinished', productId: pork.id, quantity: '', allocations: [] }], [pork], [oldest], 'central', '2026-10-30')
check(unfinished.length === 1 && unfinished[0].severity === 'incomplete', 'producto aún sin cantidad se presenta como pendiente, no como error rojo')
check(overLimit.every(issue => issue.severity === 'error'), 'exceso real de stock se mantiene como error que bloquea continuar')

const multipleErrors = validateDispatchLotDrafts([
  { ...validDraft[0], id: 'line-a', quantity: '5', allocations: [{ id: 'a', lotId: oldest.id, quantity: '5' }] },
  { ...validDraft[0], id: 'line-b', quantity: '4', allocations: [{ id: 'b', lotId: ineligible.id, quantity: '4' }] },
], [pork], [oldest, ineligible], 'central', '2026-10-30')
check(multipleErrors.length >= 3, 'todos los errores de varios productos y lotes se devuelven para mostrarlos juntos')

console.log('21 comprobaciones de selección, orden de borrador y validación de lotes aprobadas')
