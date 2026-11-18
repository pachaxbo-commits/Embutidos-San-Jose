const assert = require('node:assert/strict');
const { routeCollectionsForDispatch } = require('../../functions/route-collections.cjs');
const { planPreDispatchCollections } = require('../../functions/closure-rectification.cjs');

const scope = { routeId: 'route-norte', distributorUid: 'hugo', dayKey: '2026-11-18' };
const iso = time => '2026-11-18T' + time + ':00.000Z';
const first = { ...scope, id: 'first', status: 'closed', createdAt: iso('12:30'), closedAt: iso('14:00') };
const second = { ...scope, id: 'second', createdAt: iso('14:30') };
const row = (id, time, extra = {}) => ({ id, routeId: scope.routeId, dayKey: scope.dayKey, collectedByUid: 'hugo', createdAt: iso(time), cashAmount: 252, qrAmount: 0, ...extra });
const early = row('early', '12:00');
const regular = row('regular', '13:00', { cashAmount: 270 });
const qr = row('qr', '13:30', { cashAmount: 0, qrAmount: 1136 });
const rows = [
  early, regular, qr,
  row('admin', '12:10', { routeId: 'administracion', originRouteId: scope.routeId, collectedByUid: 'admin', cashAmount: 174 }),
  row('misattributed-admin', '12:15', { originRouteId: scope.routeId, collectedByUid: 'admin', cashAmount: 174 }),
  row('other-route', '12:05', { routeId: 'route-sud' }),
  row('other-user', '12:05', { collectedByUid: 'other' }),
  row('yesterday', '12:05', { dayKey: '2026-11-17' }),
  row('gap', '14:15'), row('later', '15:00'),
  row('explicit', '13:05', { dispatchId: second.id }),
];
const assigned = (d, peers = [first, second]) => routeCollectionsForDispatch(d, peers, rows, iso('16:00')).map(r => r.id);
assert.deepEqual(assigned(first), ['early', 'regular', 'qr']);
assert.deepEqual(assigned(second), ['gap', 'later', 'explicit']);
const reopened = { ...first, status: 'open', closedAt: '', firstClosedAt: first.closedAt };
assert.deepEqual(assigned(reopened, [reopened, second]), assigned(first));
assert.deepEqual(assigned(second, [reopened, second]), assigned(second));

const original = { ...scope, id: 'closure_first', dispatchId: first.id, status: 'closed', warehouseClosedBy: 'warehouse', closedAt: first.closedAt,
  cashSales: 1536.50, cashCollections: 270, qrCollections: 1136, cashExpenses: 1383.58, expectedCash: 422.92, physicalCashDeclared: 675, cashDifference: 252.08 };
const sources = { collections: [early, regular, qr], dispatches: [first] };
const result = planPreDispatchCollections(original, first, sources, [early.id]);
assert.deepEqual(result.changes.map(c => [c.field, c.before, c.after]), [['cashCollections', 270, 522], ['expectedCash', 422.92, 674.92], ['cashDifference', 252.08, 0.08]]);
assert.equal(result.corrected.physicalCashDeclared, 675);
assert.equal(result.corrected.qrCollections, 1136);
assert.throws(() => planPreDispatchCollections(original, first, sources, ['other']), /IDs/);
assert.throws(() => planPreDispatchCollections(original, first, { ...sources, dispatches: [first, second] }, [early.id]), /otros despachos/);
console.log('PASS atribución por custodia, jornada y despacho; QR separado, reapertura y rectificación Hugo.');
