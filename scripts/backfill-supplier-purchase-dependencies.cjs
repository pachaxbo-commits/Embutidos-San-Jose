#!/usr/bin/env node
// Backfills the reverse reference used to protect purchase rectification.
// Default mode is read-only. Production writes require both --apply and
// --confirm-production pachax-flow. No secrets are read from command arguments.
const { createRequire } = require('node:module');
const path = require('node:path');
const req = createRequire(path.resolve(__dirname, '../functions/package.json'));
const { initializeApp, getApps } = req('firebase-admin/app');
const { getFirestore, FieldPath } = req('firebase-admin/firestore');

const args = process.argv.slice(2);
const value = (name) => {
  const exact = args.indexOf(name);
  if (exact >= 0) return args[exact + 1] || '';
  const prefixed = args.find((arg) => arg.startsWith(`${name}=`));
  return prefixed ? prefixed.slice(name.length + 1) : '';
};
const has = (name) => args.includes(name);
const projectId = value('--project');
const apply = has('--apply');
const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const rootPath = 'restaurants/sanjose';
const stateId = 'supplierPurchaseDependencyIndex';
const pageSize = 200;

if (!projectId) throw new Error('Indica --project <firebase-project>.');
if (projectId !== 'demo-pachax-audit' && !emulator && (!apply || value('--confirm-production') !== 'pachax-flow')) {
  throw new Error('Production exige --apply --confirm-production pachax-flow.');
}
if (emulator && projectId !== 'demo-pachax-audit') {
  throw new Error('El emulador debe usar el proyecto sintético demo-pachax-audit.');
}
if (apply && !emulator && projectId !== 'pachax-flow') {
  throw new Error('La escritura habilitada solo acepta el proyecto Production pachax-flow.');
}

const app = getApps()[0] || initializeApp({ projectId });
const db = getFirestore(app);
const root = db.doc(rootPath);
const batches = root.collection('distProcessingBatches');
const derivedIds = (data) => [...new Set([
  ...(Array.isArray(data.packagingMaterials) ? data.packagingMaterials : []).map((item) => item?.expenseId),
  ...(Array.isArray(data.costComponents) ? data.costComponents : []).map((item) => item?.expenseId),
].filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()))].sort();

async function* pages() {
  let cursor = null;
  while (true) {
    let query = batches.orderBy(FieldPath.documentId()).limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    if (snapshot.empty) return;
    yield snapshot;
    cursor = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < pageSize) return;
  }
}

async function main() {
  const stateRef = root.collection('distControl').doc(stateId);
  const counts = { batchesRead: 0, withPurchaseLinks: 0, missingOrIncorrect: 0, batchesUpdated: 0 };
  if (apply) {
    await db.runTransaction(async (tx) => {
      const state = await tx.get(stateRef);
      if (state.exists && state.get('status') === 'ready' && state.get('schemaVersion') === 1) {
        throw new Error('El backfill ya está marcado READY; no se ejecutará de nuevo.');
      }
      tx.set(stateRef, { status: 'backfilling', schemaVersion: 1, startedAt: new Date().toISOString(), startedBy: 'backfill-supplier-purchase-dependencies' });
    });
  }

  for await (const snapshot of pages()) {
    for (const doc of snapshot.docs) {
      counts.batchesRead++;
      const expected = derivedIds(doc.data());
      if (expected.length) counts.withPurchaseLinks++;
      const actual = Array.isArray(doc.get('sourceExpenseIds')) ? [...new Set(doc.get('sourceExpenseIds'))].sort() : [];
      if (JSON.stringify(actual) === JSON.stringify(expected)) continue;
      counts.missingOrIncorrect++;
      if (!apply) continue;
      const changed = await db.runTransaction(async (tx) => {
        const current = await tx.get(doc.ref);
        if (!current.exists) return false;
        const latest = derivedIds(current.data());
        const currentIndex = Array.isArray(current.get('sourceExpenseIds')) ? [...new Set(current.get('sourceExpenseIds'))].sort() : [];
        if (JSON.stringify(currentIndex) === JSON.stringify(latest)) return false;
        tx.update(doc.ref, { sourceExpenseIds: latest });
        return true;
      });
      if (changed) counts.batchesUpdated++;
    }
  }

  if (apply) {
    let mismatches = 0;
    for await (const snapshot of pages()) {
      for (const doc of snapshot.docs) {
        const expected = derivedIds(doc.data());
        const actual = Array.isArray(doc.get('sourceExpenseIds')) ? [...new Set(doc.get('sourceExpenseIds'))].sort() : [];
        if (JSON.stringify(actual) !== JSON.stringify(expected)) mismatches++;
      }
    }
    if (mismatches) throw new Error(`Verificación final encontró ${mismatches} lotes con referencias inconsistentes. El índice permanece bloqueado.`);
    await stateRef.set({ status: 'ready', schemaVersion: 1, completedAt: new Date().toISOString(), verifiedBatchCount: counts.batchesRead, batchesWithPurchaseLinks: counts.withPurchaseLinks, updatedBatchCount: counts.batchesUpdated }, { merge: true });
  }

  console.log(JSON.stringify({ projectId, mode: apply ? 'apply' : 'dry-run', emulator, counts, state: apply ? 'ready' : 'unchanged' }, null, 2));
}

main().then(() => app.delete()).catch(async (error) => {
  console.error(error.message || error);
  await app.delete().catch(() => {});
  process.exitCode = 1;
});
