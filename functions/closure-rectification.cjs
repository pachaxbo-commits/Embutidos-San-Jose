const { createHash } = require('node:crypto');
const round = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const fingerprint = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const sorted = rows => rows.slice().sort((a,b) => a.id.localeCompare(b.id));

function planClosureRectification(original, dispatch, sources) {
  requireValue(original?.status === 'closed' && original.warehouseClosedBy && dispatch?.status === 'closed', 'El cierre y el despacho deben seguir finalizados.');
  requireValue(original.id === `closure_${dispatch.id}` && original.dispatchId === dispatch.id && original.routeId === dispatch.routeId, 'Cierre y despacho no corresponden.');
  requireValue(!original.rectification && !original.rectificationId, 'Este cierre ya tiene una rectificación.');
  requireValue(!original.preserveFinancialSnapshot, 'Este cierre preserva una caja anterior y requiere revisión especializada.');
  requireValue(original.dayKey === dispatch.dayKey, 'La jornada del cierre no coincide con el despacho.');
  const effective = sources.sales.map(s => ({...s,...s.effectiveSnapshot}));
  requireValue(sources.sales.every(s => s.dispatchId === dispatch.id && !s.pendingConfirmation), 'Existen ventas fuera del despacho o pendientes.');
  const excluded = effective.filter(s => s.sourceLocation === 'centralWarehouse' || (s.routeId && s.routeId !== original.routeId));
  requireValue(excluded.every(s => s.sourceLocation === 'centralWarehouse' && ['admin','administracion'].includes(s.routeId)), 'La atribución excluida no está comprobada como Administración central.');
  const included = effective.filter(s => !excluded.some(x => x.id === s.id));
  const sum = (rows,key) => round(rows.reduce((n,r)=>n+(Number(r[key])||0),0));
  const commercial = rows => rows.filter(s=>s.saleKind !== 'courtesy');
  const qty = (rows,pid,courtesy=false) => round(rows.filter(s=>(s.saleKind==='courtesy')===courtesy).flatMap(s=>s.lines||[]).filter(l=>l.productId===pid).reduce((n,l)=>n+l.quantity,0));
  for (const [field,key] of [['cashSales','cashAmount'],['qrSales','qrAmount'],['creditGenerated','creditAmount']]) {
    requireValue(round(original[field])===sum(commercial(effective),key), `El snapshot original de ${field} no coincide con sus fuentes; no se rectificó.`);
  }
  requireValue(Array.isArray(original.products), 'Falta el detalle de productos original.');
  const changes = [];
  const evidence = (field,rows=excluded,collectionName='distSales') => ({field,sourceDocumentIds:rows.map(row=>`${collectionName}/${row.id}`).sort()});
  const products = original.products.map(row=>{
    requireValue(round(row.sold)===qty(effective,row.productId) && round(row.courtesy||0)===qty(effective,row.productId,true), `El detalle original de ${row.productName} no coincide con las ventas.`);
    const next={...row,sold:qty(included,row.productId),courtesy:qty(included,row.productId,true)};
    for(const key of ['sold','courtesy']) if(Number(row[key]||0)!==next[key]) changes.push({...evidence(`products.${row.productId}.${key}`,excluded.filter(s=>(s.lines||[]).some(l=>l.productId===row.productId))),before:Number(row[key]||0),after:next[key]});
    return next;
  });
  const inPeriod = row => row.createdAt >= dispatch.createdAt && row.createdAt <= original.closedAt;
  const adminCollectorUids = new Set(sources.adminCollectorUids || []);
  const collections=sources.collections.filter(row => inPeriod(row) &&
    (row.routeId === original.routeId || row.originRouteId === original.routeId));
  const expenses=sources.expenses.filter(row => inPeriod(row));
  const claims=sources.claims.filter(row => inPeriod(row));
  const routeCollections=collections.filter(row => row.routeId === original.routeId &&
    !adminCollectorUids.has(row.collectedByUid) && !['admin','administracion'].includes(row.routeId));
  const amountFor = (rows, field, legacyMethod) => round(rows.reduce((n,row) => n +
    (Number.isFinite(row[field]) ? row[field] : row.method === legacyMethod ? row.amount : 0), 0));
  const originalCashCollections=amountFor(collections,'cashAmount','cash');
  const originalQrCollections=amountFor(collections,'qrAmount','qr');
  const cashCollections=amountFor(routeCollections,'cashAmount','cash');
  const qrCollections=amountFor(routeCollections,'qrAmount','qr');
  const cashExpenses=sum(expenses.filter(x=>(x.paymentMethod||'cash')==='cash'),'amount');
  const claimCash=round(sum(claims,'cashIn')-sum(claims,'cashOut'));
  for(const [key,value] of Object.entries({cashCollections:originalCashCollections,qrCollections:originalQrCollections,cashExpenses,claimCash})) requireValue(round(original[key]||0)===value, `Las fuentes históricas de ${key} han cambiado; revisión necesaria.`);
  requireValue(Number.isFinite(original.physicalCashDeclared), 'Falta el efectivo declarado original.');
  requireValue(round(original.expectedCash) === round(original.cashSales+originalCashCollections-cashExpenses+claimCash)
    && round(original.cashDifference) === round(original.physicalCashDeclared-original.expectedCash), 'La caja original contiene otra discrepancia no explicada por la atribución.');
  const patch={products,cashSales:sum(commercial(included),'cashAmount'),qrSales:sum(commercial(included),'qrAmount'),creditGenerated:sum(commercial(included),'creditAmount'),cashCollections,qrCollections};
  patch.expectedCash=round(patch.cashSales+cashCollections-cashExpenses+claimCash);
  patch.cashDifference=round(original.physicalCashDeclared-patch.expectedCash);
  for(const key of ['cashSales','qrSales','creditGenerated','cashCollections','qrCollections','expectedCash','cashDifference']) if(original[key]!==patch[key]) {
    const sourceKey=key==='qrSales'||key==='qrCollections'?'qrAmount':key==='cashCollections'?'cashAmount':key==='creditGenerated'?'creditAmount':'cashAmount';
    const sourceRows=key==='cashCollections'||key==='qrCollections'
      ? collections.filter(row => !routeCollections.some(kept => kept.id===row.id) && Number(row[sourceKey]||0)!==0)
      : excluded.filter(s=>Number(s[sourceKey])!==0);
    const evidenceRows=key==='cashCollections'||key==='qrCollections'
      ? evidence(key,sourceRows,'distCollections')
      : key==='expectedCash'||key==='cashDifference'
        ? {field:key,sourceDocumentIds:[...excluded.filter(s=>Number(s.cashAmount)!==0).map(s=>`distSales/${s.id}`),...collections.filter(row => !routeCollections.some(kept => kept.id===row.id) && Number(row.cashAmount||0)!==0).map(row=>`distCollections/${row.id}`)].sort()}
        : evidence(key,sourceRows);
    changes.push({...evidenceRows,before:original[key],after:patch[key]});
  }
  requireValue(changes.length>0,'No hay diferencias verificadas que rectificar.');
  const corrected={...original,...patch};
  const sourceSnapshot={dispatch,sales:sorted(sources.sales),collections:sorted(collections),adminCollectorUids:[...adminCollectorUids].sort(),expenses:sorted(expenses),claims:sorted(claims)};
  return {originalHash:fingerprint(original),sourceHash:fingerprint(sourceSnapshot),original,corrected,changes,
    includedSaleIds:included.map(s=>s.id).sort(),excludedSaleIds:excluded.map(s=>s.id).sort(),
    includedCollectionIds:routeCollections.map(c=>c.id).sort(),excludedCollectionIds:collections.filter(c=>!routeCollections.some(row=>row.id===c.id)).map(c=>c.id).sort(),
    sourceDocumentIds:[`distDispatches/${dispatch.id}`,...sources.sales.map(s=>`distSales/${s.id}`),...collections.map(c=>`distCollections/${c.id}`),...expenses.map(e=>`distExpenses/${e.id}`),...claims.map(c=>`distClaims/${c.id}`)].sort()};
}
module.exports={planClosureRectification,fingerprint};

function planPreDispatchCollections(original, dispatch, sources, ids) {
  const { routeCollectionsForDispatch } = require('./route-collections.cjs');
  requireValue(original?.status === 'closed' && original.warehouseClosedBy && dispatch?.status === 'closed'
    && !original.rectification && !original.rectificationId && !original.preserveFinancialSnapshot
    && original.dispatchId === dispatch.id && original.routeId === dispatch.routeId
    && original.dayKey === dispatch.dayKey && original.distributorUid === dispatch.distributorUid
    && original.closedAt === dispatch.closedAt, 'El cierre original no admite esta rectificación.');
  const peers = sources.dispatches.filter(row => row.routeId === dispatch.routeId && row.dayKey === dispatch.dayKey);
  requireValue(peers.length === 1 && peers[0].id === dispatch.id, 'La jornada tiene otros despachos. Se requiere revisión de atribución.');
  const assigned = routeCollectionsForDispatch(dispatch, peers, sources.collections, original.closedAt);
  const baseline = sources.collections.filter(row => row.routeId === dispatch.routeId && row.createdAt >= dispatch.createdAt && row.createdAt <= original.closedAt);
  const amount = (rows, field, method) => round(rows.reduce((total, row) => total + (Number.isFinite(row[field]) ? row[field] : row.method === method ? Number(row.amount || 0) : 0), 0));
  const additions = assigned.filter(row => row.createdAt < dispatch.createdAt);
  requireValue(ids.length > 0 && JSON.stringify([...ids].sort()) === JSON.stringify(additions.map(row => row.id).sort()), 'Los IDs de cobro no coinciden con la evidencia anterior al despacho.');
  requireValue(JSON.stringify(assigned.filter(row => row.createdAt >= dispatch.createdAt).map(row => row.id).sort()) === JSON.stringify(baseline.map(row => row.id).sort()), 'La atribución de los cobros posteriores al inicio no coincide.');
  requireValue(original.cashCollections === amount(baseline, 'cashAmount', 'cash') && original.qrCollections === amount(baseline, 'qrAmount', 'qr'), 'Los cobros originales no coinciden con el cierre.');
  requireValue(Number.isFinite(original.physicalCashDeclared) &&
    original.expectedCash === round(original.cashSales + (original.voidedCashReceipts || 0) + original.cashCollections - original.cashExpenses + (original.claimCash || 0)) &&
    original.cashDifference === round(original.physicalCashDeclared - original.expectedCash), 'Los totales originales no concilian.');
  const corrected = { ...original, cashCollections: amount(assigned, 'cashAmount', 'cash'), qrCollections: amount(assigned, 'qrAmount', 'qr') };
  corrected.expectedCash = round(original.expectedCash + corrected.cashCollections - original.cashCollections);
  corrected.cashDifference = round(original.physicalCashDeclared - corrected.expectedCash);
  const sourceDocumentIds = [...ids].sort().map(id => 'distCollections/' + id);
  const changes = ['cashCollections', 'qrCollections', 'expectedCash', 'cashDifference'].filter(field => original[field] !== corrected[field])
    .map(field => ({ field, sourceDocumentIds, before: original[field], after: corrected[field] }));
  requireValue(changes.length > 0, 'Los cobros revisados no cambian el cierre.');
  return { original, corrected, changes, originalHash: fingerprint(original),
    sourceHash: fingerprint({ dispatch, peers: sorted(peers), assigned: sorted(assigned) }),
    includedCollectionIds: assigned.map(row => row.id).sort(), addedCollectionIds: [...ids].sort(), sourceDocumentIds };
}
module.exports.planPreDispatchCollections = planPreDispatchCollections;
