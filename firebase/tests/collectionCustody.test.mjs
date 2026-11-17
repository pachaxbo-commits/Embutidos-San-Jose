// All writes are confined to the local Firestore emulator.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(localhost|127\.0\.0\.1):\d+$/, 'Local emulator required')
const req=createRequire(new URL('../../functions/package.json',import.meta.url))
const {initializeApp,deleteApp}=req('firebase-admin/app'),{getFirestore}=req('firebase-admin/firestore')
const {processCommand}=req('./operations.cjs')
const app=initializeApp({projectId:'demo-pachax-audit'},`custody-${Date.now()}`),db=getFirestore(app),root=db.doc('restaurants/sanjose')
const prefix=`custody-${Date.now().toString(36)}`,admin=`${prefix}-admin`,seller=`${prefix}-ricardo`,route='route-sud'
let checks=0
const pass=label=>{checks++;console.log(`PASS ${label}`)}
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')

async function collect(actor,originRouteId,method,cashAmount,qrAmount,spoofRoute='route-norte') {
  const customerId=`${prefix}-${actor}-${method}-${originRouteId}`
  await root.collection('distCustomers').doc(customerId).set({id:customerId,restaurantId:'sanjose',name:'Anon QA',active:true,routeId:originRouteId})
  const receivableId=`${prefix}-debt-${actor}-${method}-${originRouteId}`
  await root.collection('distReceivables').doc(receivableId).set({id:receivableId,restaurantId:'sanjose',customerId,customerName:'Anon QA',routeId:originRouteId,sourceType:'sale',saleId:`sale-${receivableId}`,originalAmount:174,paidAmount:0,balance:174,status:'OPEN',createdAt:new Date().toISOString()})
  const id=`${prefix}-collection-${method}-${originRouteId}`
  const operation={id,restaurantId:'sanjose',createdBy:actor,createdAt:new Date().toISOString(),type:'collection',status:'queued',payload:{customerId,amount:174,method,cashAmount,qrAmount,routeId:spoofRoute}}
  await root.collection('distOperations').doc(id).set(operation)
  await processCommand(db,root.collection('distOperations').doc(id))
  const result=(await root.collection('distOperations').doc(id).get()).data()
  assert.equal(result.status,'confirmed',result.error)
  return root.collection('distCollections').doc(id).get().then(s=>s.data())
}

try {
  await root.collection('members').doc(admin).set({id:admin,role:'admin',active:true,displayName:'QA Administración'})
  await root.collection('members').doc(seller).set({id:seller,role:'distributor',active:true,routeId:route,displayName:'QA Ricardo'})

  const adminCash=await collect(admin,route,'cash',174,0)
  assert.equal(adminCash.routeId,'administracion');assert.equal(adminCash.originRouteId,route);assert.equal(adminCash.collectedByUid,admin)
  assert.equal(adminCash.amount,174);assert.equal(adminCash.allocations[0].amount,174)
  pass('Admin cash collection follows custodian while keeping Ricardo debt origin and full allocation')

  const sellerCash=await collect(seller,route,'cash',174,0, 'administracion')
  assert.equal(sellerCash.routeId,route);assert.equal(sellerCash.originRouteId,route)
  pass('Distributor cash collection uses authenticated assigned route despite forged client routeId')

  const sacabaCash=await collect(admin,'route-sacaba','cash',174,0)
  assert.equal(sacabaCash.routeId,'administracion');assert.equal(sacabaCash.originRouteId,'route-sacaba')
  const adminQr=await collect(admin,route,'qr',0,174)
  assert.equal(adminQr.routeId,'administracion');assert.equal(adminQr.originRouteId,route)
  assert.equal(adminQr.cashAmount,0);assert.equal(adminQr.qrAmount,174)
  const adminMixed=await collect(admin,route,'mixed',100,74)
  assert.equal(adminMixed.routeId,'administracion');assert.equal(adminMixed.originRouteId,route)
  assert.equal(adminMixed.cashAmount,100);assert.equal(adminMixed.qrAmount,74)
  pass('Sacaba origin, QR, and mixed receipts remain in Administration custody with original route preserved')

  const adminRows=[adminCash,sacabaCash,adminQr,adminMixed].filter(row=>row.routeId==='administracion')
  const routeRows=[sellerCash,...adminRows].filter(row=>row.routeId===route)
  assert.equal(adminRows.reduce((sum,row)=>sum+row.cashAmount,0),448)
  assert.equal(adminRows.reduce((sum,row)=>sum+row.qrAmount,0),248)
  assert.equal(routeRows.reduce((sum,row)=>sum+row.cashAmount,0),174)
  pass('Physical-cash totals follow routeId; QR is segregated and never inflates cash')

  const legacyId=`${prefix}-legacy-admin-collection`,legacy={id:legacyId,restaurantId:'sanjose',createdAt:new Date().toISOString(),dayKey:'2026-11-17',createdBy:admin,collectedByUid:admin,collectedByName:'QA Administración',routeId:'route-sacaba',originRouteId:'route-sacaba',receivableId:'legacy-receivable',allocations:[{receivableId:'legacy-receivable',amount:89,sourceType:'sale',saleId:'legacy-sale'}],amount:89,cashAmount:89,qrAmount:0,method:'cash'}
  await root.collection('distCollections').doc(legacyId).set(legacy)
  const baseline=[{id:legacy.id,routeId:legacy.routeId,originRouteId:legacy.originRouteId,collectedByUid:legacy.collectedByUid,amount:legacy.amount,cashAmount:legacy.cashAmount,qrAmount:legacy.qrAmount,method:legacy.method,receivableId:legacy.receivableId,allocations:legacy.allocations,createdAt:legacy.createdAt,dayKey:legacy.dayKey}]
  const repairId=`${prefix}-legacy-custody-repair`,repair={id:repairId,restaurantId:'sanjose',createdBy:admin,createdAt:new Date().toISOString(),type:'rectifyCollectionCustody',status:'queued',payload:{reason:'QA de rectificación histórica controlada',expectedSourceHash:hash(baseline),records:[{id:legacyId,routeId:'route-sacaba',originRouteId:'route-sacaba',collectedByUid:admin}]}}
  await root.collection('distOperations').doc(repairId).set(repair)
  await processCommand(db,root.collection('distOperations').doc(repairId))
  const repairResult=(await root.collection('distOperations').doc(repairId).get()).data()
  assert.equal(repairResult.status,'confirmed',repairResult.error)
  const repaired=(await root.collection('distCollections').doc(legacyId).get()).data(),audit=(await root.collection('distCollectionCustodyRectifications').doc(`${legacyId}__custody_rectification_v1`).get()).data()
  const {routeId,...unchanged}=repaired
  assert.equal(routeId,'administracion');assert.deepEqual(unchanged,(({routeId:_routeId,...rest})=>rest)(legacy))
  assert.deepEqual(audit.before,legacy);assert.deepEqual(audit.after,repaired);assert.equal(audit.originRouteId,'route-sacaba')
  pass('Historical metadata repair validates admin UID/hash, changes only routeId, and stores before/after audit')
  console.log(`PASS ${checks} collection custody integration groups`)
} finally {await deleteApp(app)}
