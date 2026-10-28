// Backend transaction regression using Firestore Emulator only.
const { createRequire } = require('node:module');
const functionsRequire = createRequire(require.resolve('../../functions/package.json'));
const { initializeApp } = functionsRequire('firebase-admin/app');
const { getFirestore } = functionsRequire('firebase-admin/firestore');
const { processCommand } = require('../../functions/operations.cjs');

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8085';
const app = initializeApp({ projectId: 'demo-pachax-audit' }, 'processing-availability-test');
const db = getFirestore(app);
const root = db.doc('restaurants/sanjose');
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const pid = `processing-${suffix}`;
const admin = `admin-${suffix}`;
const lotId = `lot-${suffix}`;
let checks = 0;
const ok = (condition, message) => { if (!condition) throw new Error(message); checks++; console.log(`PASS ${message}`); };

async function operation(id, quantity) {
  const ref = root.collection('distOperations').doc(id);
  await ref.set({ id, restaurantId: 'sanjose', createdBy: admin, createdAt: new Date().toISOString(), status: 'queued', type: 'adjustment', payload: { warehouseId: 'central', line: { productId: pid, quantity: -quantity }, note: 'QA reserva sacheteado' } });
  await processCommand(db, ref);
  return (await ref.get()).data();
}

async function main() {
try {
  await root.collection('members').doc(admin).set({ role: 'admin', active: true, displayName: 'QA' });
  await root.collection('distProducts').doc(pid).set({ id: pid, restaurantId: 'sanjose', name: 'Producto ficticio', unitType: 'kg', active: true, productionCost: 4, referencePrice: 8 });
  await root.collection('distLots').doc(lotId).set({ id: lotId, restaurantId: 'sanjose', productId: pid, productName: 'Producto ficticio', unitType: 'kg', lotCode: 'QA', manufacturedOn: '2026-10-01', expiresOn: '2027-10-01', productionCost: 4, quantities: { central: 20 }, processingUnavailable: { central: { courtesy: 2, repackPending: 0, reviewHold: 0 } }, createdAt: new Date().toISOString(), createdBy: admin });
  await root.collection('distBalances').doc(`central__${pid}`).set({ id: `central__${pid}`, restaurantId: 'sanjose', locationKind: 'central', warehouseId: 'central', productId: pid, productName: 'Producto ficticio', unitType: 'kg', quantity: 20, updatedAt: new Date().toISOString() });

  const beforeRejected = await operation(`reject-${suffix}`, 19);
  ok(beforeRejected.status === 'rejected', 'rechaza consumo superior al stock libre con reserva');
  ok((await root.collection('distBalances').doc(`central__${pid}`).get()).data().quantity === 20, 'rechazo no cambia balance físico');
  ok((await root.collection('distLots').doc(lotId).get()).data().quantities.central === 20, 'rechazo no modifica lote');
  ok((await root.collection('distStockMovements').where('refId', '==', beforeRejected.id).get()).empty, 'rechazo no crea movimientos parciales');

  const consume = await operation(`consume-${suffix}`, 5);
  ok(consume.status === 'confirmed', 'permite consumir 5 kg libres de 18 kg');
  const balance = (await root.collection('distBalances').doc(`central__${pid}`).get()).data();
  const lot = (await root.collection('distLots').doc(lotId).get()).data();
  const physical = balance.quantity;
  const reserved = lot.processingUnavailable.central.courtesy;
  ok(physical === 15 && reserved === 2 && physical - reserved === 13, 'físico 15 kg, reserva 2 kg, disponible 13 kg');

  const [raceA, raceB] = await Promise.all([operation(`race-a-${suffix}`, 10), operation(`race-b-${suffix}`, 10)]);
  const finalBalance = (await root.collection('distBalances').doc(`central__${pid}`).get()).data().quantity;
  const finalReserved = (await root.collection('distLots').doc(lotId).get()).data().processingUnavailable.central.courtesy;
  ok([raceA.status, raceB.status].filter(s => s === 'confirmed').length === 1, 'dos consumos concurrentes no gastan una misma existencia dos veces');
  ok(finalBalance === 5 && finalReserved === 2 && finalBalance >= finalReserved, 'la reserva permanece protegida tras concurrencia');
  console.log(`processing availability emulator: ${checks} checks PASS`);
} finally {
  await app.delete();
}
}
main().catch(error => { console.error(error); process.exitCode = 1; });
