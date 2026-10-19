const assert = require('node:assert/strict')
const { handlers } = require('../../functions/operations.cjs')

const product = { id: 'product-date-qa', name: 'Producto QA', unitType: 'kg', productionCost: 5 }
async function attempt(manufacturedOn, expiresOn) {
  const writes = []
  const entity = { p: product, lots: [] }
  const operation = {
    id: 'intake-date-qa', actor: 'admin-qa', now: '2026-10-19T23:30:00.000Z', today: '2026-10-19',
    owns(location) { assert.equal(location, 'central') },
    async loadStock(productId, location) { assert.equal(productId, product.id); assert.equal(location, 'central'); return entity },
    amount(value) { return value },
    move(...args) { writes.push(['movement', ...args]) },
    ledger(...args) { writes.push(['ledger', ...args]); return 'movement-qa' },
  }
  const result = await handlers.intake(operation, { lines: [{ productId: product.id, quantity: 1, lotCode: 'LOTE-QA', manufacturedOn, expiresOn }] })
  return { writes, entity, result }
}

async function rejectsDates(manufacturedOn, expiresOn, expected) {
  const operation = {
    id: 'intake-date-qa', actor: 'admin-qa', now: '2026-10-19T23:30:00.000Z', today: '2026-10-19',
    owns() {}, async loadStock() { return { p: product, lots: [] } }, amount(value) { return value },
    move() { throw new Error('No debe tocar stock si falla fecha') }, ledger() { throw new Error('No debe crear movimiento si falla fecha') },
  }
  await assert.rejects(handlers.intake(operation, { lines: [{ productId: product.id, quantity: 1, lotCode: 'LOTE-QA', manufacturedOn, expiresOn }] }), new RegExp(expected))
}

async function main() {
  await rejectsDates('', '2026-10-25', 'fechas válidas')
  await rejectsDates('2026-10-10', '', 'fechas válidas')
  await rejectsDates('2026-10-20', '2026-10-25', 'Revisa las fechas del lote')
  await rejectsDates('2026-10-10', '2026-10-09', 'Revisa las fechas del lote')
  const valid = await attempt('2026-10-19', '2026-10-20')
  assert.equal(valid.result.id, 'intake-date-qa')
  assert.equal(valid.entity.lots[0].manufacturedOn, '2026-10-19')
  assert.equal(valid.writes.length, 2, 'un ingreso válido conserva movimiento y ledger')
  console.log('PASS backend intake conserva validación de fechas Bolivia y solo acepta lote válido')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
