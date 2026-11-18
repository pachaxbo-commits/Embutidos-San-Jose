const assert = require('node:assert/strict');
const { handlers, Operation } = require('../../functions/operations.cjs');

(async () => {
  const batch = { id: 'batch', status: 'confirmed', processType: 'bagging', sourceLocation: 'central', sourceProductId: 'bulk', inputWeightG: 17200, sourceCostCents: 101274,
    destinations: [{ id: 'finished', kind: 'finished', commercialQuantity: 92, netWeightG: 16120, costCents: 94914 }, { kind: 'discard', netWeightG: 1080 }],
    result: { derivedLots: [{ lotId: 'finishedLot', destinationId: 'finished' }] },
    sourceAllocations: [{ sourceLotId: 'source', measuredNetWeightG: 17200, historicalCostCents: 101274, productionCost: 58.88 }],
  };
  const lot = { id: 'finishedLot', productId: 'finished-product', processingBatchId: 'batch', unitType: 'package', quantities: { central: 75 }, processingPhysicalWeightGRemaining: 13143, processingCostCentsRemaining: 77377,
    processingByLocation: { central: { segments: [{ segmentId: 'segment', batchId: 'batch', destinationId: 'finished', remainingQuantity: 75, remainingWeightG: 13143, remainingCostCents: 77377 }] } },
  };
  const source = { id: 'source', lotCode: '141126', quantities: { central: 1 } };
  const balance = { quantity: 1 };
  const writes = [];
  const o = { id: 'rectification', base: () => ({}), admin: () => {}, read: async collection => collection === 'distLots' ? lot : batch,
    loadStock: async () => ({ p: { id: 'bulk', unitType: 'kg' }, lots: [source], balances: new Map([['central', balance]]) }),
    query: async () => [{ id: 'sale__0', type: 'sale', allocations: [{ lotId: 'finishedLot', quantity: 17, processingAllocation: { segmentId: "segment", physicalWeightG: 2977, costCents: 17537 } }] }],
    ledger: () => 'movement', put: (...args) => writes.push(args),
  };
  const payload = { batchId: 'batch', netWeightG: 12880, discardWeightG: 1080, sources: [{ id: 'source', consumedG: 13960 }] };
  lot.quantities.route__sud = 10;
  lot.quantities.central = 65;
  await assert.rejects(handlers.rectifyProcessingMass(o, { ...payload, preview: true }), /fuera del almacén fuente/);
  delete lot.quantities.route__sud;
  lot.quantities.central = 75;
  const preview = await handlers.rectifyProcessingMass(o, { ...payload, preview: true });
  assert.equal(writes.length, 0);
  assert.equal(preview.sources[0].deltaG, 3240);
  assert.equal(preview.departed, 17);
  assert.equal(preview.historical.beforeWeightG, 2977);
  assert.equal(preview.after.remainingWeightG, 10500);
  const confirmation = { ...payload, revision: preview.revision, reason: 'Corrección de peso medido', evidenceNote: 'Planilla de pesaje verificada', explicitConfirmation: true };
  await assert.rejects(handlers.rectifyProcessingMass(o, { ...confirmation, revision: 'stale' }), /cambió/);
  await assert.rejects(handlers.rectifyProcessingMass({ ...o, admin: () => { throw Error('Sin permiso'); } }, confirmation), /Sin permiso/);
  await handlers.rectifyProcessingMass(o, confirmation);
  assert.equal(balance.quantity, 4.24);
  assert.equal(source.quantities.central, 4.24);
  assert.equal(writes.find(row => row[0] === 'distLots')[2].quantities.central, 75);
  assert.equal(writes.find(row => row[0] === 'distProcessingBatchAudit')[2].event, 'mass_rectification');
  assert.ok(writes.every(row => !['distSales', 'distCollections'].includes(row[0])));
  const corrected = writes.find(row => row[0] === 'distLots')[2];
  corrected.processingCommercialBlocked = true;
  corrected.processingDestinationKind = 'finished';
  const original = { lotId: corrected.id, quantity: 17, processingAllocation: {
    quantity: 17, batchId: 'batch', destinationId: 'finished', segmentId: 'segment',
    saleMovementId: 'sale__0', physicalWeightG: 2977, costCents: 17537,
  } };
  const resolver = Operation.prototype.effectiveProcessingAllocation;
  const effective = resolver(corrected, original);
  const { slice } = require('../../functions/origin-traceability.cjs');
  const partial = slice(effective, 0, 6);
  const remainder = slice(effective, 6, 11);
  assert.equal(original.processingAllocation.physicalWeightG, 2977);
  assert.equal(effective.processingAllocation.physicalWeightG, 2380);
  for (const key of ['physicalWeightG', 'costCents']) {
    assert.equal(partial.processingAllocation[key] + remainder.processingAllocation[key], effective.processingAllocation[key]);
  }
  assert.equal(resolver(corrected, partial), partial);
  assert.throws(() => resolver(corrected, slice(original, 0, 6)), /completa antes de dividir/);
  const newSale = { ...original, processingAllocation: { ...original.processingAllocation, saleMovementId: 'new-sale' } };
  assert.equal(resolver(corrected, newSale), newSale);
  const stock = { p: { unitType: 'package' }, lots: [corrected] };
  const restoration = Object.assign(Object.create(Operation.prototype), {
    loadStock: async () => stock, move: () => {},
  });
  const applied = await restoration.restore('finished-product', 'central', [partial]);
  assert.equal(applied[0].processingAllocation.physicalWeightG, 840);
  await restoration.restore('finished-product', 'central', [remainder]);
  assert.equal(corrected.quantities.central, 92);
  assert.equal(corrected.processingPhysicalWeightGRemaining, preview.after.net);
  assert.equal(corrected.processingCostCentsRemaining, preview.after.cost);
  assert.equal(corrected.processingByLocation.central.segments[0].remainingQuantity, 92);
  batch.massRectificationId = 'rectification';
  await assert.rejects(handlers.rectifyProcessingMass(o, confirmation), /no admite/);
  console.log('PASS rectificación de masa: preview sin escrituras, saldo, auditoría, permisos y revisión');
})().catch(error => { console.error(error); process.exitCode = 1; });
