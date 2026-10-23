// Production audit: GET and Firestore runQuery only. Never submits operations.
const path = require('node:path');
const auth = require(path.join(process.env.APPDATA, 'npm/node_modules/firebase-tools/lib/auth.js'));
const fs = require('node:fs');
const base = 'https://firestore.googleapis.com/v1/projects/pachax-flow/databases/(default)/documents';
const root = 'restaurants/sanjose';
function decode(v) {
  if ('nullValue' in v) return null;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k,x]) => [k,decode(x)]));
  return v;
}
const document = d => ({ id:d.name.split('/').pop(), ...Object.fromEntries(Object.entries(d.fields || {}).map(([k,v]) => [k,decode(v)])) });
(async () => {
  const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount();
  if (!account) throw Error('No authorized Firebase CLI account');
  const token = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
  async function request(path, body) {
    const response = await fetch(base + '/' + root + path, { method:body ? 'POST':'GET', headers:{Authorization:`Bearer ${token.access_token}`, ...(body ? {'Content-Type':'application/json'}:{})}, ...(body ? {body:JSON.stringify(body)}:{}) });
    if (response.status === 404) return null;
    if (!response.ok) throw Error(`Read-only Firestore request failed: ${response.status} ${await response.text()}`);
    return response.json();
  }
  const get = async (col,id) => { const d = await request('/'+col+'/'+encodeURIComponent(id)); return d ? document(d) : null; };
  const query = async (col,field,value,limit=300) => (await request(':runQuery',{structuredQuery:{from:[{collectionId:col}],where:{fieldFilter:{field:{fieldPath:field},op:'EQUAL',value:{stringValue:value}}},limit}})).filter(x=>x.document).map(x=>document(x.document));
  const wastes = await query('distStockMovements','type','dispatch_waste');
  const targets = {'gra-viena':1.54,'gra-chorizo-parrillero-precocido':.48,'gra-chorizo-parrillero-crudo':.58};
  const matches = wastes.filter(x=>targets[x.productId] !== undefined && Math.abs(Number(x.quantity)-targets[x.productId])<.00001);
  const cases=[];
  for (const movement of matches) {
    const sourceOperation=movement.refId ? await get('distOperations',movement.refId) : null;
    const dispatchId=sourceOperation?.payload?.dispatch?.id || sourceOperation?.payload?.dispatchId || movement.dispatchId || movement.refId;
    const dispatch=dispatchId ? await get('distDispatches',dispatchId) : null;
    const closure=dispatchId ? await get('distClosures','closure_'+dispatchId) : null;
    const sales=dispatchId ? await query('distSales','dispatchId',dispatchId) : [];
    const movements=dispatchId ? await query('distStockMovements','refId',dispatchId) : [];
    const related=dispatchId ? await query('distStockMovements','dispatchId',dispatchId) : [];
    const lotIds=new Set([...(movement.allocations||[]).map(x=>x.lotId), ...(dispatch?.lines||[]).filter(x=>x.productId===movement.productId).flatMap(x=>(x.allocations||[]).map(a=>a.lotId))]);
    const lots=[]; for (const id of lotIds) if(id) lots.push(await get('distLots',id));
    const sourceMember=sourceOperation?.createdBy ? await get('members',sourceOperation.createdBy) : null;
    const balances={central:await get('distBalances','central__'+movement.productId),route:dispatch?.routeId ? await get('distBalances','route__'+dispatch.routeId+'__'+movement.productId) : null};
    cases.push({movement,sourceOperation,sourceMember,dispatch,closure,sales,movements,related,lots,balances});
  }
  const diagnostics=await query('distErrorDiagnostics','code','ERR-3427D7',10);
  const report={auditedAt:new Date().toISOString(),readOnly:true,wasteQueryCount:wastes.length,possiblyTruncated:wastes.length===300,cases,diagnostics};
  fs.mkdirSync('output/audit',{recursive:true});
  fs.writeFileSync('output/audit/dispatch-waste-pdf.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({auditedAt:report.auditedAt,wasteQueryCount:wastes.length,possiblyTruncated:report.possiblyTruncated,cases:cases.map(c=>({movementId:c.movement.id,productId:c.movement.productId,product:c.movement.productName,quantity:c.movement.quantity,lossCost:c.movement.lossCost,createdAt:c.movement.createdAt,dispatchId:c.dispatch?.id,route:c.dispatch?.routeName,distributor:c.dispatch?.distributorName,status:c.dispatch?.status,dispatchCreatedAt:c.dispatch?.createdAt,responsible:c.sourceMember?.displayName,actorRole:c.sourceMember?.role,payloadLine:c.sourceOperation?.payload?.lines?.find(x=>x.productId===c.movement.productId),closureStatus:c.closure?.status||null,saleCount:c.sales.length,balances:c.balances})),diagnostics},null,2));
})().catch(error=>{console.error(error.message);process.exitCode=1});
