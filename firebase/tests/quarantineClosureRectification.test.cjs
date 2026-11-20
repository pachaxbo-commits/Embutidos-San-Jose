const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { handlers } = require('../../functions/operations.cjs');

async function main() {
  const loc = 'route__test', lotId = 'claim__damaged', movementId = 'merma', dispatchId = 'dispatch';
  const lot = { id: lotId, quarantined: true, quantities: { [loc]: 0 }, productId: 'product' };
  const other = { id: 'ordinary', productId: 'product', quantities: { central: 5, [loc]: 0 } };
  const movement = { id: movementId, dispatchId, productId: 'product', fromLocation: loc, type: 'dispatch_merma_sale', quantity: 1.6, routeDelta: -1.6,
    allocations: [{ lotId: 'ordinary', quantity: 0.6 }, { lotId, quantity: 1 }] };
  const claim = { id: 'claim', kind: 'exchange', saleId: 'sale', routeId: 'test', productId: 'product', quantity: 1, cashOut: 0 };
  const receipt = { id: 'receipt', lotId, refId: claim.id, quantity: 1, toLocation: loc, type: 'customer_return' };
  const balance = { id: 'balance', quantity: 0 };
  const closure = { id: 'closure_dispatch', status: 'closed', cashDifference: -45, products: [{ productId: 'product', dispatchMermaSaleMovementId: movementId }] };
  const records = { distLots: lot, distClaims: claim, distStockMovements: movement, distClosures: closure, distSales: { dispatchId }, distDispatches: { id: dispatchId, status: 'closed', routeId: 'test' } };
  const writes = [];
  const entry = { p: { unitType: 'kg' }, balances: new Map([[loc, balance]]), lots: [structuredClone(lot), other] };
  const context = { id: 'repair', now: '2026-11-20T20:00:00Z', admin() {}, read: async col => records[col],
    query: async () => [receipt, movement], loadStock: async () => entry, assertNoActiveReservation: async () => {},
    move: (_entry, _loc, delta) => { balance.quantity += delta }, base: () => ({}), put: (...write) => writes.push(write) };
  const source = { lot, movement, claim, receipt, balance, closure };
  const expectedSourceHash = createHash('sha256').update(JSON.stringify(source, (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(k => [k, value[k]])) : value)).digest('hex');
  const payload = { lotId, movementId, claimId: claim.id, explicitConfirmation: true, reason: 'Prueba de rectificación auditada', expectedSourceHash };
  await assert.rejects(handlers.rectifyQuarantineClosureConsumption(context, { ...payload, expectedSourceHash: 'stale' }), /cambió/);
  assert.equal(writes.length, 0);
  const result = await handlers.rectifyQuarantineClosureConsumption(context, payload);
  assert.equal(result.restoredQuantity, 1);
  assert.equal(balance.quantity, 1);
  assert.equal(entry.lots[0].quantities[loc], 1);
  assert.equal(entry.lots[0].quarantined, true);
  assert.equal(other.quantities.central, 5);
  assert.deepEqual(writes.map(([collection]) => collection), ['distStockMovements', 'distLotHistory']);
  assert.equal(writes[0][2].quantity, 0.6);
  assert.equal(writes[1][2].previous.movement.quantity, 1.6);
  assert.equal(writes[1][2].next.movement.quantity, 0.6);
  assert.equal(closure.cashDifference, -45);
  console.log('PASS rectificación histórica: saldo, evidencia y hash; solo se repone el producto en cuarentena.');
}
main().catch(error => { console.error(error); process.exitCode = 1 });
