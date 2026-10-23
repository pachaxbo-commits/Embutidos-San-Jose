// Offline maintenance adapter. No invocation, endpoint, migration or production hook.
const { fingerprint, q, bs } = require('./mixed-merma-lot-plan.cjs');
const origin = require('../../functions/origin-traceability.cjs');
const check = (v, message) => { if (!v) throw Error(message); };
const safeId = value => typeof value === 'string' && value.length > 0 && value.length < 180 && !value.includes('/') && !/^\.{1,2}$/.test(value);
async function accountingMermaRectification(db, input, { execute = false, backup } = {}) {
  check(safeId(input.operationId) && safeId(input.dispatchId) && input.actor && input.reason?.trim().length >= 10, 'Identified operation, actor and reason required');
  check(['reclassify', 'document_existing'].includes(input.mode), 'Invalid mode');
  check(input.lines?.length && new Set(input.lines.map(l => l.productId)).size === input.lines.length, 'Unique product lines required');
  if (execute) check(input.approval === 'APPROVED_ACCOUNTING_REFERENCE_NOT_PHYSICAL_ORIGIN' && typeof backup === 'function', 'Specific execution approval and verified private backup required');
  const root = db.doc('restaurants/sanjose'), ref = (c, id) => root.collection(c).doc(id), hash = fingerprint(input);
  return db.runTransaction(async tx => {
    const read = async (c, id) => { const s = await tx.get(ref(c, id)); return s.exists ? { ...s.data(), id: s.id } : null; };
    const query = async (c, f, v) => (await tx.get(root.collection(c).where(f, '==', v))).docs.map(s => ({ ...s.data(), id: s.id }));
    const prior = await read('distOperations', input.operationId);
    if (prior) { check(prior.status === 'confirmed' && prior.requestHash === hash, 'Operation ID already used for a different request'); return { ...prior.result, alreadyApplied: true }; }
    const dispatch = await read('distDispatches', input.dispatchId), source = await read('distOperations', input.dispatchId), closure = await read('distClosures', 'closure_' + input.dispatchId);
    check(dispatch?.dayKey === input.dayKey && source?.status === 'confirmed', 'Original dispatch/day changed');
    check(dispatch.status === 'open' && !closure?.warehouseClosedBy && !closure?.warehouseClosedAt && !['warehouse_done', 'closed'].includes(closure?.status), 'Dispatch already received or closed; separate authorization and plan required');
    const loc = 'route__' + dispatch.routeId, wh = dispatch.warehouseId && dispatch.warehouseId !== 'central' ? 'warehouse__' + dispatch.warehouseId : 'central';
    const sales = await query('distSales', 'dispatchId', dispatch.id), corrections = [], additions = [];
    for (const sale of sales.filter(s => s.effectiveSnapshot)) { const op = await read('distOperations', sale.latestCorrectionId); const audit = await read('distSaleCorrections', sale.latestCorrectionId); check(op?.status === 'confirmed' && fingerprint(audit?.corrected) === fingerprint(sale.effectiveSnapshot), 'Sale correction audit incomplete'); corrections.push({ op, audit }); }
    for (const a of (dispatch.additions || []).filter(a => !a.voided && !a.voidedAt)) { const op = await read('distOperations', a.id); check(op?.status === 'confirmed', 'Addition not confirmed'); additions.push(op); }
    const rows = [];
    for (const target of input.lines) {
      check(safeId(target.productId) && Number.isFinite(target.quantity) && target.quantity > 0 && q(target.quantity) === target.quantity && Number.isFinite(target.lossCost) && target.lossCost >= 0, 'Expected quantity and historical loss required');
      const product = await read('distProducts', target.productId), lots = await query('distLots', 'productId', target.productId), movements = await query('distStockMovements', 'productId', target.productId);
      check(lots.every(l => Object.values(l.quantities || {}).every(n => Number.isFinite(n) && n >= 0)), 'Negative/invalid existing lot balance requires prior investigation');
      const central = await read('distBalances', wh + '__' + target.productId), route = await read('distBalances', loc + '__' + target.productId);
      check(product?.unitType === 'kg' && central && route, 'Product/balances unavailable');
      for (const [where, balance] of [[wh, central], [loc, route]]) check(q(lots.reduce((n, l) => n + (l.quantities[where] || 0), 0)) === q(balance.quantity), 'Balance/lot mismatch');
      const line = dispatch.lines.filter(l => l.productId === target.productId), original = source.payload.lines.filter(l => l.productId === target.productId);
      check(line.length === 1 && original.length === 1 && q(original[0].waste) === target.quantity && !Number(original[0].dispatchMerma) && !original[0].warehouseLoss, 'Original ambiguous waste differs');
      check(!(dispatch.corrections || []).some(c => c.productId === target.productId), 'Dispatch correction needs separate reconstruction');
      const losses = movements.filter(m => m.type === 'dispatch_waste' && m.refId === dispatch.id);
      check(losses.length === 1, 'Ambiguous original loss'); const loss = losses[0];
      check(q(loss.quantity) === target.quantity && Number.isFinite(loss.lossCost) && bs(loss.lossCost) === target.lossCost && loss.centralDelta === -target.quantity && !Number(loss.routeDelta) && loss.fromLocation === wh, 'Loss quantity/cost/source changed');
      check(loss.allocations?.length && new Set(loss.allocations.map(a => a.lotId)).size === loss.allocations.length && q(loss.allocations.reduce((n, a) => n + a.quantity, 0)) === target.quantity && loss.allocations.every(a => a.quantity > 0 && Number.isFinite(a.productionCost) && a.productionCost >= 0) && bs(loss.allocations.reduce((n, a) => n + a.quantity * a.productionCost, 0)) === target.lossCost, 'Historical accounting allocation/cost unknown');
      check(!movements.some(m => m.traceabilitySourceMovementId === loss.id), 'This line already has a traceability exception');
      const already = input.mode === 'document_existing';
      check(already ? loss.reversedAt && loss.replacedByMovementId && q(line[0].dispatchMerma) === target.quantity : !loss.reversedAt && !loss.rectifiedAt && !loss.lossClassification && !Number(line[0].dispatchMerma) && q(line[0].waste) === target.quantity && bs(line[0].wasteCost) === target.lossCost, 'Line already corrected or classification changed');
      const replacement = already ? movements.find(m => m.id === loss.replacedByMovementId) : null;
      if (already) check(replacement && !replacement.reversedAt && fingerprint(replacement.allocations) === fingerprint(loss.allocations), 'Existing correction changed');
      const effectiveSales = sales.filter(s => !s.voidedAt && !s.pendingConfirmation).map(s => ({ ...s, ...s.effectiveSnapshot }));
      const physicalSales = effectiveSales.flatMap(s => s.lines).filter(l => l.productId === target.productId).reduce((n, l) => n + Number(l.physicalQuantity ?? l.quantity), 0);
      const added = (dispatch.additions || []).filter(a => !a.voided && !a.voidedAt).flatMap(a => a.quantityByProduct).filter(l => l.productId === target.productId).reduce((n, l) => n + l.quantity, 0);
      check(q(line[0].quantity + added - physicalSales) === q(route.quantity), 'Live sales/load/route reconciliation failed');
      const downstream = already ? movements.filter(m => !m.reversedAt && m.createdAt > replacement.createdAt && m.fromLocation === loc) : [];
      check(downstream.every(m => m.type === 'sale'), 'Downstream non-sale movement needs separate documentary reconstruction');
      const exceptionId = input.operationId + '__' + rows.length;
      const accounting = loss.allocations.map(a => ({ ...a, originReferences: [{ exceptionId, accountingLotId: a.lotId, sourceMovementId: loss.id, physicalOriginConfirmed: false, basis: 'original_accounting_debit_only', historicalUnitCost: a.productionCost, quantity: a.quantity }] }));
      const remaining = [], notices = [];
      for (const a of accounting) {
        const lot = lots.find(l => l.id === a.lotId); check(lot && lot.lotCode === a.lotCode && lot.productionCost === a.productionCost, 'Accounting lot identity/cost changed');
        let unassigned = a.quantity;
        for (const m of downstream) {
          const used = q(Math.min(unassigned, (m.allocations || []).filter(p => p.lotId === a.lotId).reduce((n, p) => n + p.quantity, 0)));
          if (used > 0) { check(m.refId, 'Downstream sale reference missing'); notices.push({ subjectSaleId: m.refId, subjectMovementId: m.id, allocation: origin.slice(a, 0, used) }); unassigned = q(unassigned - used); }
        }
        if (unassigned > 0) { check(!already || (lot.quantities[loc] || 0) - origin.pending(lot, loc) >= unassigned, 'Documented remaining quantity unavailable'); remaining.push(origin.slice(a, q(a.quantity - unassigned), unassigned)); }
      }
      rows.push({ target, product, lots, movements, central, route, loss, accounting, remaining, notices, exceptionId, neutralizedLossCost: already ? 0 : loss.lossCost, routeIncrease: already ? 0 : target.quantity });
    }
    const result = { operationId: input.operationId, mode: input.mode, neutralizedLossCost: bs(rows.reduce((n, r) => n + r.neutralizedLossCost, 0)), routeIncrease: q(rows.reduce((n, r) => n + r.routeIncrease, 0)), exceptions: rows.map(r => r.exceptionId) };
    const before = { dispatch, source, closure, sales, corrections, additions, rows };
    if (!execute) return { ...result, dryRun: true, before };
    // Full evidence is backed up privately. Store only before-images of the
    // documents this operation can affect, avoiding Firestore's 1 MiB limit.
    const auditBefore = { dispatch, source, closure, sales, corrections, additions, rows: rows.map(r => ({ target: r.target, central: r.central, route: r.route, loss: r.loss, accounting: r.accounting, remaining: r.remaining, notices: r.notices, lots: r.lots.filter(l => r.accounting.some(a => a.lotId === l.id)) })) };
    check(Buffer.byteLength(JSON.stringify(auditBefore)) < 850000, 'Affected-document audit too large; stop for scoped review');
    check(rows.reduce((n, r) => n + r.remaining.length + r.notices.length + 5, 0) < 400, 'Too many writes for one atomic maintenance operation');
    await backup({ input, hash, before, result });
    const now = new Date().toISOString(), next = structuredClone(dispatch);
    for (const row of rows) {
      const { exceptionId } = row;
      check(!await read('distLotHistory', exceptionId), 'Exception identifier exists');
    }
    // All reads completed before any write.
    for (const row of rows) {
      const { target, loss, exceptionId } = row, documented = input.mode === 'document_existing';
      for (const a of row.remaining) {
        const lot = row.lots.find(l => l.id === a.lotId);
        if (documented) { lot.pendingOrigins ||= {}; lot.pendingOrigins[loc] ||= []; lot.pendingOrigins[loc].push(...a.originReferences); origin.validate(lot, loc); }
        else origin.restore(lot, loc, a);
        tx.update(ref('distLots', lot.id), { pendingOrigins: lot.pendingOrigins, ...(documented ? {} : { ['quantities.' + loc]: lot.quantities[loc] }) });
      }
      tx.create(ref('distLotHistory', exceptionId), { id: exceptionId, restaurantId: 'sanjose', productId: target.productId, dispatchId: dispatch.id, action: 'physical_origin_pending', status: 'pending', createdAt: now, createdBy: input.actor, reason: input.reason, accountingAllocations: row.accounting, sourceMovementId: loss.id });
      for (const [i, notice] of row.notices.entries()) tx.create(ref('distLotHistory', exceptionId + '__sale' + i), { id: exceptionId + '__sale' + i, restaurantId: 'sanjose', productId: target.productId, dispatchId: dispatch.id, action: 'sale_origin_exception', ...notice, createdAt: now, createdBy: input.actor });
      const line = next.lines.find(l => l.productId === target.productId);
      line.originReferences = row.accounting.flatMap(a => a.originReferences);
      if (!documented) {
        line.normalQuantity = line.quantity; line.quantity = q(line.quantity + target.quantity); line.dispatchMerma = target.quantity; line.dispatchMermaAllocations = row.accounting; line.allocations = [...line.allocations, ...row.accounting]; line.waste = 0; line.wasteCost = 0; line.wasteAllocations = [];
        tx.update(ref('distBalances', row.route.id), { quantity: q(row.route.quantity + target.quantity), updatedAt: now });
        tx.update(ref('distStockMovements', loss.id), { reversedAt: now, reversedBy: input.actor, reversalKind: 'accounting_reclassification_physical_origin_pending', replacedByMovementId: exceptionId, replacedByOperationId: input.operationId });
      }
      tx.create(ref('distStockMovements', exceptionId), { id: exceptionId, restaurantId: 'sanjose', branchId: 'main', schemaVersion: 2, type: documented ? 'traceability_notice' : 'dispatch', productId: target.productId, productName: row.product.name, unitType: 'kg', quantity: documented ? 0 : target.quantity, normalQuantity: 0, dispatchMerma: documented ? 0 : target.quantity, centralDelta: documented ? 0 : -target.quantity, routeDelta: row.routeIncrease, fromLocation: documented ? '' : wh, toLocation: documented ? '' : loc, routeId: dispatch.routeId, dispatchId: dispatch.id, refId: dispatch.id, dayKey: dispatch.dayKey, createdAt: now, createdBy: input.actor, allocations: documented ? [] : row.accounting, originReferences: line.originReferences, traceabilityStatus: 'physical_origin_pending', traceabilitySourceMovementId: loss.id, documentedMovementIds: documented ? [loss.replacedByMovementId, ...row.notices.map(n => n.subjectMovementId)] : [], sourceMovementId: loss.id, historicalLossCostNeutralized: row.neutralizedLossCost, note: origin.note + ' ' + input.reason });
    }
    tx.set(ref('distDispatches', dispatch.id), next);
    tx.create(ref('distOperations', input.operationId), { id: input.operationId, restaurantId: 'sanjose', status: 'confirmed', type: 'audited_accounting_merma_reference', createdBy: input.actor, createdAt: now, requestHash: hash, payload: input, result, auditBefore, privateEvidenceHash: fingerprint(before) });
    return { ...result, alreadyApplied: false };
  }, { readOnly: !execute });
}
module.exports = { accountingMermaRectification };
