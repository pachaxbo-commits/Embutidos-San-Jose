const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { createRequire } = require('node:module');
const req = createRequire(path.resolve(__dirname, '../../functions/package.json'));
const { initializeApp } = req('firebase-admin/app');
const { getFirestore } = req('firebase-admin/firestore');
const projectId = 'demo-pachax-audit';
const app = initializeApp({ projectId }, `supplier-dependency-backfill-${Date.now()}`);
const db = getFirestore(app);
const root = db.doc('restaurants/sanjose');
const prefix = `supplier-dependency-${Date.now().toString(36)}`;

async function main() {
  const stateRef = root.collection('distControl').doc('supplierPurchaseDependencyIndex');
  const linked = root.collection('distProcessingBatches').doc(`${prefix}-linked`);
  const empty = root.collection('distProcessingBatches').doc(`${prefix}-empty`);
  await stateRef.delete();
  await linked.set({ packagingMaterials: [{ expenseId: ' expense-a ' }, { expenseId: 'expense-a' }], costComponents: [{ expenseId: 'expense-b' }] });
  await empty.set({ packagingMaterials: [], costComponents: [] });

  execFileSync(process.execPath, [path.resolve(__dirname, '../../scripts/backfill-supplier-purchase-dependencies.cjs'), '--project', projectId], {
    stdio: 'pipe',
    env: process.env,
  });
  assert.equal((await stateRef.get()).exists, false, 'dry-run no escribe estado de migración');
  assert.equal((await linked.get()).get('sourceExpenseIds'), undefined, 'dry-run no modifica documentos');

  execFileSync(process.execPath, [path.resolve(__dirname, '../../scripts/backfill-supplier-purchase-dependencies.cjs'), '--project', projectId, '--apply'], {
    stdio: 'pipe',
    env: process.env,
  });

  const [linkedAfter, emptyAfter, stateAfter] = await Promise.all([linked.get(), empty.get(), stateRef.get()]);
  assert.deepEqual(linkedAfter.get('sourceExpenseIds'), ['expense-a', 'expense-b']);
  assert.ok(emptyAfter.get('sourceExpenseIds') === undefined || emptyAfter.get('sourceExpenseIds').length === 0);
  assert.equal(stateAfter.get('status'), 'ready');
  assert.equal(stateAfter.get('schemaVersion'), 1);
  console.log('PASS backfill idempotente reconstruye referencias inversas y marca READY tras verificación');
}

main().finally(async () => {
  await Promise.all([
    root.collection('distControl').doc('supplierPurchaseDependencyIndex').delete(),
    root.collection('distProcessingBatches').doc(`${prefix}-linked`).delete(),
    root.collection('distProcessingBatches').doc(`${prefix}-empty`).delete(),
  ]);
  await app.delete();
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
