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
  requireValue(excluded.length > 0 && excluded.every(s => s.sourceLocation === 'centralWarehouse' && ['admin','administracion'].includes(s.routeId)), 'La atribución excluida no está comprobada como Administración central.');
  const included = effective.filter(s => !excluded.some(x => x.id === s.id));
  const sum = (rows,key) => round(rows.reduce((n,r)=>n+(Number(r[key])||0),0));
  const commercial = rows => rows.filter(s=>s.saleKind !== 'courtesy');
  const qty = (rows,pid,courtesy=false) => round(rows.filter(s=>(s.saleKind==='courtesy')===courtesy).flatMap(s=>s.lines||[]).filter(l=>l.productId===pid).reduce((n,l)=>n+l.quantity,0));
  for (const [field,key] of [['cashSales','cashAmount'],['qrSales','qrAmount'],['creditGenerated','creditAmount']]) {
    requireValue(round(original[field])===sum(commercial(effective),key), `El snapshot original de ${field} no coincide con sus fuentes; no se rectificó.`);
  }
  requireValue(Array.isArray(original.products), 'Falta el detalle de productos original.');
  const changes = [];
  const evidence = (field,rows=excluded) => ({field,sourceDocumentIds:rows.map(s=>`distSales/${s.id}`).sort()});
  const products = original.products.map(row=>{
    requireValue(round(row.sold)===qty(effective,row.productId) && round(row.courtesy||0)===qty(effective,row.productId,true), `El detalle original de ${row.productName} no coincide con las ventas.`);
    const next={...row,sold:qty(included,row.productId),courtesy:qty(included,row.productId,true)};
    for(const key of ['sold','courtesy']) if(Number(row[key]||0)!==next[key]) changes.push({...evidence(`products.${row.productId}.${key}`,excluded.filter(s=>(s.lines||[]).some(l=>l.productId===row.productId))),before:Number(row[key]||0),after:next[key]});
    return next;
  });
  const inPeriod = row => row.routeId === original.routeId && row.createdAt >= dispatch.createdAt && row.createdAt <= original.closedAt;
  const collections=sources.collections.filter(inPeriod),expenses=sources.expenses.filter(x=>inPeriod(x)&&!x.voided),claims=sources.claims.filter(inPeriod);
  const cashCollections=round(collections.reduce((n,c)=>n+(Number.isFinite(c.cashAmount)?c.cashAmount:c.method==='cash'?c.amount:0),0));
  const qrCollections=round(collections.reduce((n,c)=>n+(Number.isFinite(c.qrAmount)?c.qrAmount:c.method==='qr'?c.amount:0),0));
  const cashExpenses=sum(expenses.filter(x=>(x.paymentMethod||'cash')==='cash'),'amount');
  const claimCash=round(sum(claims,'cashIn')-sum(claims,'cashOut'));
  for(const [key,value] of Object.entries({cashCollections,qrCollections,cashExpenses,claimCash})) requireValue(round(original[key]||0)===value, `Las fuentes históricas de ${key} han cambiado; revisión necesaria.`);
  requireValue(Number.isFinite(original.physicalCashDeclared), 'Falta el efectivo declarado original.');
  requireValue(round(original.expectedCash) === round(original.cashSales+cashCollections-cashExpenses+claimCash)
    && round(original.cashDifference) === round(original.physicalCashDeclared-original.expectedCash), 'La caja original contiene otra discrepancia no explicada por la atribución.');
  const patch={products,cashSales:sum(commercial(included),'cashAmount'),qrSales:sum(commercial(included),'qrAmount'),creditGenerated:sum(commercial(included),'creditAmount')};
  patch.expectedCash=round(patch.cashSales+cashCollections-cashExpenses+claimCash);
  patch.cashDifference=round(original.physicalCashDeclared-patch.expectedCash);
  for(const key of ['cashSales','qrSales','creditGenerated','expectedCash','cashDifference']) if(original[key]!==patch[key]) {
    const sourceKey=key==='qrSales'?'qrAmount':key==='creditGenerated'?'creditAmount':'cashAmount';
    changes.push({...evidence(key,excluded.filter(s=>Number(s[sourceKey])!==0)),before:original[key],after:patch[key]});
  }
  requireValue(changes.length>0,'No hay diferencias verificadas que rectificar.');
  const corrected={...original,...patch};
  const sourceSnapshot={dispatch,sales:sorted(sources.sales),collections:sorted(collections),expenses:sorted(expenses),claims:sorted(claims)};
  return {originalHash:fingerprint(original),sourceHash:fingerprint(sourceSnapshot),original,corrected,changes,
    includedSaleIds:included.map(s=>s.id).sort(),excludedSaleIds:excluded.map(s=>s.id).sort(),
    sourceDocumentIds:[`distDispatches/${dispatch.id}`,...sources.sales.map(s=>`distSales/${s.id}`),...collections.map(c=>`distCollections/${c.id}`),...expenses.map(e=>`distExpenses/${e.id}`),...claims.map(c=>`distClaims/${c.id}`)].sort()};
}
module.exports={planClosureRectification,fingerprint};
