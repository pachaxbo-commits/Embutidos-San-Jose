const assert = require('node:assert/strict')
const { handlers } = require('../../functions/operations.cjs')

const writes = []
const originalLot = {
  id: 'lot-test',
  productId: 'product-test',
  quantities: { central: 4 },
  lotCode: '171026',
  manufacturedOn: '2026-10-16',
  expiresOn: '2026-11-16',
  productionCost: 37.66,
}
const operation = {
  id: 'operation-test',
  actor: 'admin-test',
  now: '2026-10-19T11:17:29.000Z',
  today: '2026-10-19',
  member: { role: 'admin', displayName: 'QA' },
  admin() {},
  async read(collection, id) {
    assert.equal(collection, 'distLots')
    assert.equal(id, originalLot.id)
    return originalLot
  },
  base() { return { restaurantId: 'sanjose' } },
  put(collection, id, value) { writes.push({ collection, id, value }) },
}
const payload = {
  lotId: originalLot.id,
  lotCode: '161026',
  manufacturedOn: '2026-10-16',
  expiresOn: '2026-11-16',
  productionCost: 37.66,
}

async function main() {
  await assert.rejects(
    handlers.updateLot(operation, { ...payload, reason: null }),
    /Indica el motivo de la actualización\./,
  )
  assert.equal(writes.length, 0, 'sin motivo, el backend no programa cambios de lote ni auditoría')

  const updated = await handlers.updateLot(operation, { ...payload, reason: 'Corrección de fecha' })
  assert.equal(updated.lotCode, '161026')
  assert.deepEqual(updated.quantities, { central: 4 }, 'editar metadata no altera stock')
  assert.deepEqual(writes.map(write => write.collection), ['distLots', 'distLotHistory'])
  assert.equal(writes[1].value.reason, 'Corrección de fecha')
  console.log('PASS backend rechaza updateLot sin motivo antes de escribir y conserva auditoría/stock')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
