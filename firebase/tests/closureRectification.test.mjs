import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(localhost|127\.0\.0\.1):\d+$/, 'Local emulator required')
const projectId='demo-pachax-audit',req=createRequire(new URL('../../functions/package.json',import.meta.url))
const {initializeApp,deleteApp}=req('firebase-admin/app'),{getFirestore}=req('firebase-admin/firestore')
const {processCommand}=req('./operations.cjs'),{planClosureRectification,fingerprint}=req('./closure-rectification.cjs')
const app=initializeApp({projectId},`rectification-${Date.now()}`),db=getFirestore(app),root=db.doc('restaurants/sanjose')
const env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8085,rules:fs.readFileSync('firebase/firestore.rules','utf8')}})
const prefix=`rectify-${Date.now().toString(36)}`,users=Object.fromEntries(['admin','warehouse','distributor','support','inactive'].map(r=>[r,`${prefix}-${r}`]))
const read=async(c,id)=>(await root.collection(c).doc(id).get()).data()
let checks=0
const pass=label=>{checks++;console.log('PASS',label)}
async function fixture(suffix) {
  const dispatchId=`${prefix}-${suffix}`,closureId=`closure_${dispatchId}`,routeId=`${prefix}-route-${suffix}`,p=`${prefix}-tocino-${suffix}`
  const sales=[
    {id:`${dispatchId}-ricardo`,routeId,sourceLocation:'route',cashAmount:3217.5,qrAmount:891,creditAmount:1779.01,lines:[{productId:p,quantity:12}]},
    {id:`${dispatchId}-central-cash`,routeId:'administracion',sourceLocation:'centralWarehouse',cashAmount:119.5,qrAmount:0,creditAmount:0,lines:[{productId:p,quantity:2}]},
    {id:`${dispatchId}-central-qr`,routeId:'administracion',sourceLocation:'centralWarehouse',cashAmount:0,qrAmount:50,creditAmount:0,lines:[{productId:'other',quantity:1}]},
  ].map(s=>({...s,dispatchId,createdAt:'2026-10-17T14:00:00.000Z',saleKind:'sale'}))
  const closure={id:closureId,restaurantId:'sanjose',dispatchId,routeId,routeName:'Zona Sud',distributorUid:users.distributor,distributorName:'Ricardo QA',warehouseId:'central',status:'closed',dayKey:'2026-10-17',createdAt:'2026-10-17T20:36:59.517Z',warehouseClosedBy:users.warehouse,warehouseClosedAt:'2026-10-17T20:36:59.517Z',closedAt:'2026-10-17T20:47:32.592Z',cashSales:3337,qrSales:941,creditGenerated:1779.01,cashCollections:132.5,qrCollections:0,cashExpenses:35,claimCash:0,expectedCash:3434.5,physicalCashDeclared:3235,cashDifference:-199.5,products:[{productId:p,productName:'Sachet Tocino ahumado',unitType:'package',totalLoaded:15,initialDispatch:15,additions:0,sold:14,courtesy:0,expectedReturn:3,actualReturn:3,physicalReturn:3,returnMerma:0,returnWaste:0,shortage:0,overage:0,variance:0}]}
  const dispatch={id:dispatchId,routeId,dayKey:closure.dayKey,status:'closed',createdAt:'2026-10-17T12:08:50.445Z',lines:[{productId:p,quantity:15}]}
  const collections=[{id:`${dispatchId}-collection`,routeId,createdAt:'2026-10-17T16:00:00.000Z',cashAmount:132.5,qrAmount:0}],expenses=[{id:`${dispatchId}-expense`,routeId,createdAt:'2026-10-17T16:00:00.000Z',amount:35,paymentMethod:'cash'}]
  for(const [col,rows] of Object.entries({distClosures:[closure,{...closure,id:`closure_${dispatchId}-untouched`,dispatchId:`${dispatchId}-untouched`}],distDispatches:[dispatch],distSales:sales,distCollections:collections,distExpenses:expenses,distBalances:[{id:`central__${p}`,productId:p,quantity:153}],distLots:[{id:`${dispatchId}-lot`,productId:p,quantities:{central:153,[`route__${routeId}`]:0}}],distStockMovements:[{id:`${dispatchId}-return`,productId:p,quantity:3,type:'return',dispatchId,centralDelta:3,routeDelta:-3}]}))for(const row of rows)await root.collection(col).doc(row.id).set(row)
  const plan=planClosureRectification(closure,dispatch,{sales,collections,expenses,claims:[]})
  return{closure,dispatch,p,plan,closureId,dispatchId}
}
const payload=f=>({closureId:f.closureId,expectedOriginalHash:f.plan.originalHash,expectedSourceHash:f.plan.sourceHash,reason:'Rectificación autorizada de atribución central administrativa QA'})
const command=(id,actor,p)=>({id,restaurantId:'sanjose',createdBy:actor,createdAt:new Date().toISOString(),status:'queued',type:'rectifyClosureAttribution',payload:p})
async function submit(f,id,actor=users.admin,p=payload(f),expected='confirmed') {
  const value=command(id,actor,p)
  await assertSucceeds(setDoc(doc(env.authenticatedContext(actor).firestore(),'restaurants','sanjose','distOperations',id),value))
  await processCommand(db,root.collection('distOperations').doc(id))
  const result=await read('distOperations',id)
  assert.equal(result.status,expected,result.error)
  return result
}
async function protectedState(){const result={};for(const col of ['distBalances','distLots','distStockMovements','distSales','distCollections','distExpenses','distDispatches'])result[col]=(await root.collection(col).get()).docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.id.localeCompare(b.id));return result}
try {
  for(const [role,uid] of Object.entries(users))await root.collection('members').doc(uid).set({role:role==='inactive'?'admin':role,active:role!=='inactive',displayName:`QA ${role}`})
  const f=await fixture('valid')
  for(const role of ['warehouse','distributor','support','inactive'])await assertFails(setDoc(doc(env.authenticatedContext(users[role]).firestore(),'restaurants','sanjose','distOperations',`${prefix}-${role}`),command(`${prefix}-${role}`,users[role],payload(f))))
  await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(),'restaurants','sanjose','distOperations',`${prefix}-anon`),command(`${prefix}-anon`,users.admin,payload(f))))
  await assertFails(setDoc(doc(env.authenticatedContext(users.admin).firestore(),'restaurants','another-tenant','distOperations',`${prefix}-tenant`),command(`${prefix}-tenant`,users.admin,payload(f))))
  pass('Rules: almacén, distribuidor, support, admin inactivo, anónimo y otro tenant bloqueados')
  await assertFails(setDoc(doc(env.authenticatedContext(users.admin).firestore(),'restaurants','sanjose','distClosureRectifications',`${prefix}-direct`),{closureId:f.closureId}))
  pass('Rules: ni admin escribe directamente la auditoría')
  const before=await protectedState(),other=await read('distClosures',`closure_${f.dispatchId}-untouched`)
  const result=await submit(f,`${prefix}-valid-operation`)
  const raw=await read('distClosures',f.closureId),audit=await read('distClosureRectifications',result.result.id)
  const{rectification,rectificationId,...original}=raw
  assert.deepEqual(original,f.closure);assert.deepEqual(audit.original,f.closure);assert.deepEqual(rectification,audit);assert.equal(rectificationId,audit.id)
  assert.equal(audit.corrected.products[0].sold,12);assert.equal(audit.corrected.products[0].totalLoaded-audit.corrected.products[0].sold,3)
  assert.equal(audit.corrected.products[0].shortage,0);assert.equal(audit.corrected.expectedCash,3315);assert.equal(audit.corrected.physicalCashDeclared,3235);assert.equal(audit.corrected.cashDifference,-80)
  assert.equal(audit.createdBy,users.admin);assert.ok(audit.createdAt&&audit.reason&&audit.changes.length&&audit.sourceDocumentIds.length)
  assert.deepEqual(await protectedState(),before);assert.deepEqual(await read('distClosures',other.id),other)
  pass('Admin: original íntegro, conciliado 15−12=3; caja 3315 / 3235 / −80; evidencia, responsable y fecha completos')
  pass('Stock, lotes, movimientos, ventas, cobros, gastos, despacho y otro cierre intactos')
  const counts=(await root.collection('distClosureRectifications').get()).size
  await processCommand(db,root.collection('distOperations').doc(`${prefix}-valid-operation`))
  await submit(f,`${prefix}-duplicate`,users.admin,payload(f),'rejected')
  assert.equal((await root.collection('distClosureRectifications').get()).size,counts);assert.deepEqual(await protectedState(),before)
  pass('Mismo operationId idempotente y segunda operación rechazada sin duplicados')
  const bad=await fixture('changed')
  await submit(bad,`${prefix}-wrong-hash`,users.admin,{...payload(bad),expectedOriginalHash:'wrong'},'rejected')
  await root.collection('distSales').doc(`${bad.dispatchId}-ricardo`).update({note:'Cambio posterior a revisión'})
  await submit(bad,`${prefix}-changed-source`,users.admin,payload(bad),'rejected')
  assert.deepEqual(await read('distClosures',bad.closureId),bad.closure)
  pass('Cambios de cierre/fuentes rechazan atómicamente; original intacto')
  const malicious=command(`${prefix}-bypass`,users.warehouse,payload(bad))
  await root.collection('distOperations').doc(malicious.id).set(malicious)
  await processCommand(db,root.collection('distOperations').doc(malicious.id))
  assert.equal((await read('distOperations',malicious.id)).status,'rejected')
  pass('Backend también bloquea otro rol aunque se omitan Rules')
  const reopen=command(`${prefix}-reopen`,users.admin,{closureId:f.closureId,reason:'No debe mover inventario'})
  const beforeReopen=await protectedState()
  reopen.type='reopen';await root.collection('distOperations').doc(reopen.id).set(reopen);await processCommand(db,root.collection('distOperations').doc(reopen.id))
  assert.equal((await read('distOperations',reopen.id)).status,'rejected');assert.deepEqual(await protectedState(),beforeReopen)
  assert.equal(fingerprint(audit.original),f.plan.originalHash)
  pass('Reapertura de cierre rectificado bloqueada; original verificable por SHA-256')
  console.log(`PASS ${checks} grupos de pruebas de seguridad y rectificación`)
} finally {await env.cleanup();await deleteApp(app)}
