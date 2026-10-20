// One authorized historical closure only. The sole production write is creation
// of an idempotent queued command; the Function performs the audited transaction.
const fs = require('node:fs');
const auth = require('C:/Users/fabri/AppData/Roaming/npm/node_modules/firebase-tools/lib/auth.js');
const { planClosureRectification, fingerprint } = require('../functions/closure-rectification.cjs');
const closureId='closure_disp_675dc300-76b0-4e8d-a2d9-69af60e4a466';
const operationId='rectify-ricardo-20261017-attribution-v1';
const actor='4wK61O6ZOUSppzKIZDPizUUSgRV2';
const baselineHash='2200e270f83d35ba182a58fc1b086fd24468283a82101f6d8b72b421f239c613';
const baselineSourceHash='60339a9ad7d7ee1d8e117f5b2b2760fc119a3ac1ad9ea3c9bba81db6ac8a7bd2';
const folder='output/audits/ricardo-rectification';
const root='https://firestore.googleapis.com/v1/projects/pachax-flow/databases/(default)/documents/restaurants/sanjose';
function decode(v) {
  if('nullValue'in v)return null;
  for(const k of ['stringValue','timestampValue','booleanValue','doubleValue'])if(k in v)return v[k];
  if('integerValue'in v)return Number(v.integerValue);
  if('arrayValue'in v)return(v.arrayValue.values||[]).map(decode);
  if('mapValue'in v)return fields(v.mapValue.fields);
  throw Error('Unsupported Firestore value');
}
function fields(f={}) {return Object.fromEntries(Object.entries(f).map(([k,v])=>[k,decode(v)]));}
function encode(v){if(v===null)return{nullValue:null};if(typeof v==='string')return{stringValue:v};if(typeof v==='number')return{doubleValue:v};if(typeof v==='boolean')return{booleanValue:v};if(Array.isArray(v))return{arrayValue:{values:v.map(encode)}};return{mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]))}};}
const check=(c,m)=>{if(!c)throw Error(m);};
(async()=>{
  const account=auth.getAllAccounts().find(a=>a.user.email==='pachax.bo@gmail.com');
  check(account,'Falta la cuenta propietaria de Firebase CLI');
  const token=await auth.getAccessToken(account.tokens.refresh_token,['https://www.googleapis.com/auth/cloud-platform']);
  const headers={Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json'};
  async function get(path,optional=false){const r=await fetch(`${root}/${path}`,{method:'GET',headers});if(optional&&r.status===404)return null;check(r.ok,`Lectura ${path}: HTTP ${r.status}`);const d=await r.json();return{data:fields(d.fields),updateTime:d.updateTime};}
  async function list(col){let token='',rows=[];do{const r=await fetch(`${root}/${col}?pageSize=1000${token?'&pageToken='+encodeURIComponent(token):''}`,{method:'GET',headers});check(r.ok,`Lectura ${col}: ${r.status}`);const b=await r.json();rows.push(...(b.documents||[]).map(d=>({id:d.name.split('/').pop(),...fields(d.fields)})));token=b.nextPageToken||'';}while(token);return rows;}
  const current=await get(`distClosures/${closureId}`);
  if(current.data.rectification){console.log(JSON.stringify({alreadyApplied:true,id:current.data.rectificationId,corrected:current.data.rectification.corrected.expectedCash,difference:current.data.rectification.corrected.cashDifference}));return;}
  check(fingerprint(current.data)===baselineHash,'El cierre cambió desde la auditoría; se detuvo sin escribir.');
  check(current.updateTime==='2026-10-17T20:47:33.861062Z','El documento tiene otra fecha de actualización.');
  const member=(await get(`members/${actor}`)).data;
  check(member.active===true&&member.role==='admin','La responsable no tiene membresía administrativa activa.');
  const collections=['distDispatches','distSales','distCollections','distExpenses','distClaims','distLots','distBalances','distStockMovements','distClosures'];
  const before=Object.fromEntries(await Promise.all(collections.map(async col=>[col,await list(col)])));
  const d=before.distDispatches.find(d=>d.id===current.data.dispatchId);
  const plan=planClosureRectification(current.data,d,{sales:before.distSales.filter(s=>s.dispatchId===d.id),collections:before.distCollections,expenses:before.distExpenses,claims:before.distClaims});
  check(plan.originalHash===baselineHash&&plan.sourceHash===baselineSourceHash,'Las fuentes difieren de la auditoría autorizada.');
  check(plan.corrected.expectedCash===3315&&plan.corrected.cashDifference===-80&&plan.corrected.physicalCashDeclared===3235,'La conciliación no coincide con la autorización.');
  const already=await get(`distOperations/${operationId}`,true);
  check(!already,'La operación ya existe. Comprobar su estado antes de continuar.');
  check(!await get(`distClosureRectifications/${closureId}__rectification_v1`,true),'Ya existe una rectificación.');
  fs.mkdirSync(folder,{recursive:true});
  fs.writeFileSync(`${folder}/before.json`,JSON.stringify({at:new Date().toISOString(),closureUpdateTime:current.updateTime,...before},null,2));
  fs.writeFileSync(`${folder}/plan.json`,JSON.stringify(plan,null,2));
  console.log(JSON.stringify({execute:process.argv.includes('--execute'),closureId,originalHash:plan.originalHash,sourceHash:plan.sourceHash,changes:plan.changes,actor:member.displayName},null,2));
  if(!process.argv.includes('--execute'))return;
  const command={id:operationId,restaurantId:'sanjose',createdBy:actor,createdAt:new Date().toISOString(),type:'rectifyClosureAttribution',status:'queued',payload:{closureId,expectedOriginalHash:plan.originalHash,expectedSourceHash:plan.sourceHash,reason:'Rectificación autorizada por la propietaria: separar ventas centrales de Administración vinculadas indebidamente al despacho de Ricardo del 17/10/2026. Original y efectivo declarado preservados; sin movimientos de inventario ni operaciones compensatorias.'}};
  const r=await fetch(`${root}/distOperations?documentId=${operationId}`,{method:'POST',headers,body:JSON.stringify({fields:encode(command).mapValue.fields})});
  check(r.ok,`No se pudo crear la operación auditada: HTTP ${r.status}`);
  console.log(`Operación auditada creada: ${operationId}`);
  let op;
  for(let n=0;n<90;n++){op=(await get(`distOperations/${operationId}`)).data;if(op.status!=='queued')break;await new Promise(resolve=>setTimeout(resolve,1000));}
  check(op.status==='confirmed',`Operación ${op.status}: ${op.error||'No reintentar hasta comprobar su estado.'}`);
  const after=Object.fromEntries(await Promise.all(collections.map(async col=>[col,await list(col)])));
  const raw=after.distClosures.find(c=>c.id===closureId),audit=(await get(`distClosureRectifications/${op.result.id}`)).data;
  check(fingerprint(audit.original)===baselineHash&&fingerprint(raw.rectification.original)===baselineHash,'No se pudo verificar el original preservado.');
  const {rectification,rectificationId,...preserved}=raw;
  check(fingerprint(preserved)===baselineHash,'Cambió un campo original del cierre.');
  check(rectification.id===audit.id&&rectificationId===audit.id,'Registro y puntero de auditoría inconsistentes.');
  const changed=collections.filter(col=>col!=='distClosures'&&fingerprint(before[col].sort((a,b)=>a.id.localeCompare(b.id)))!==fingerprint(after[col].sort((a,b)=>a.id.localeCompare(b.id))));
  const otherClosuresUnchanged=fingerprint(before.distClosures.filter(c=>c.id!==closureId).sort((a,b)=>a.id.localeCompare(b.id)))===fingerprint(after.distClosures.filter(c=>c.id!==closureId).sort((a,b)=>a.id.localeCompare(b.id)));
  const proof={at:new Date().toISOString(),operationId,rectificationId:audit.id,confirmed:op.status,originalPreserved:true,changedProtectedCollections:changed,otherClosuresUnchanged,expectedCash:audit.corrected.expectedCash,physicalCashDeclared:audit.corrected.physicalCashDeclared,cashDifference:audit.corrected.cashDifference};
  fs.writeFileSync(`${folder}/after.json`,JSON.stringify(after,null,2));
  fs.writeFileSync(`${folder}/proof.json`,JSON.stringify(proof,null,2));
  console.log(JSON.stringify(proof,null,2));
  check(changed.length===0&&otherClosuresUnchanged,'Hubo cambios concurrentes en fuentes protegidas; revisar evidencia antes de declarar inventario intacto.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
