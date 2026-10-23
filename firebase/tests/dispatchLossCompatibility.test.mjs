// All writes in this suite are confined to Firestore Emulator.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'
import fs from 'node:fs'
const require = createRequire(new URL('../../functions/package.json', import.meta.url))
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085'
const { initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { processCommand, dayKey } = require('./operations.cjs')
const db = getFirestore(initializeApp({projectId:'demo-pachax-audit'}, 'dispatch-loss-qa'))
const root = db.doc('restaurants/sanjose')
const env = await initializeTestEnvironment({projectId:'demo-pachax-audit',firestore:{host:'127.0.0.1',port:8085,rules:fs.readFileSync('firebase/firestore.rules','utf8')}})
const prefix = 'loss-qa-'+Date.now()
const admin=prefix+'-admin', warehouse=prefix+'-warehouse', productId=prefix+'-p'
const read = async (collection,id) => (await root.collection(collection).doc(id).get()).data()
async function command(actor,type,payload,status='confirmed') {
  const id=prefix+'-'+Math.random().toString(36).slice(2)
  const ref=root.collection('distOperations').doc(id)
  await setDoc(doc(env.authenticatedContext(actor).firestore(),ref.path),{id,restaurantId:'sanjose',createdBy:actor,createdAt:new Date().toISOString(),type,payload,status:'queued'})
  await processCommand(db,ref)
  const operation=await read('distOperations',id)
  assert.equal(operation.status,status,operation.error)
  return {id,ref,...operation}
}
try {
  await root.collection('members').doc(admin).set({role:'admin',active:true,displayName:'QA Admin'})
  await root.collection('members').doc(warehouse).set({role:'warehouse',active:true,warehouseId:'central',displayName:'QA Almacén'})
  await root.collection('distProducts').doc(productId).set({name:'Producto QA',unitType:'kg',active:true,referencePrice:40,productionCost:10})
  for(const suffix of ['legacy','explicit']) await root.collection('members').doc(prefix+'-'+suffix).set({role:'distributor',active:true,routeId:prefix+'-'+suffix,displayName:suffix})
  await command(admin,'intake',{warehouseId:'central',lines:[{productId,quantity:100,lotCode:'QA',manufacturedOn:dayKey(),expiresOn:'2027-12-31',productionCost:10}]})
  const payload = (suffix,line) => ({warehouseId:'central',routeId:prefix+'-'+suffix,distributorUid:prefix+'-'+suffix,routeName:suffix,distributorName:suffix,lines:[{productId,quantity:10,...line}]})
  for(const line of [{waste:1.54},{waste:.48,dispatchMerma:0,normalQuantity:10},{waste:-1},{waste:'abc'}]) {
    const rejected=await command(warehouse,'dispatch',payload('legacy',line),'rejected')
    assert.match(rejected.error,/Actualiza la aplicación/)
    assert.equal((await read('distBalances','central__'+productId)).quantity,100)
    assert.equal((await root.collection('distStockMovements').where('operationId','==',rejected.id).get()).size,0)
    assert.equal(await read('distDispatches',rejected.id),undefined)
  }
  const multi=payload('legacy',{});multi.lines=[{productId,quantity:1},{productId,quantity:1,waste:.48}]
  await command(warehouse,'dispatch',multi,'rejected')
  assert.equal((await read('distBalances','central__'+productId)).quantity,100,'A later invalid line rolls back the complete dispatch')
  const legacy = await command(warehouse,'dispatch',payload('legacy',{waste:0}))
  assert.equal((await read('distBalances','central__'+productId)).quantity,90)
  await command(warehouse,'addition',{dispatch:{id:legacy.id},lines:[{productId,quantity:1,waste:.2}]},'rejected')
  assert.equal((await read('distBalances','central__'+productId)).quantity,90,'Legacy ambiguous additions also leave stock unchanged')
  for(const warehouseLoss of [{quantity:.2,reason:'Deteriorado'},{quantity:.2,reason:'',confirmation:'CONFIRMAR_PERDIDA_REAL'},{quantity:-.2,reason:'Deteriorado',confirmation:'CONFIRMAR_PERDIDA_REAL'}]) await command(warehouse,'dispatch',payload('explicit',{warehouseLoss}),'rejected')
  assert.equal((await read('distBalances','central__'+productId)).quantity,90)
  const loss=await command(warehouse,'dispatch',payload('explicit',{quantity:10.5,normalQuantity:10,dispatchMerma:.5,warehouseLoss:{quantity:.2,reason:'Producto deteriorado antes de cargar',confirmation:'CONFIRMAR_PERDIDA_REAL'}}))
  assert.equal((await read('distBalances','central__'+productId)).quantity,79.3)
  assert.equal((await read('distBalances','route__'+prefix+'-explicit__'+productId)).quantity,10.5)
  const movements=(await root.collection('distStockMovements').where('refId','==',loss.id).get()).docs.map(d=>d.data())
  const waste=movements.find(m=>m.type==='dispatch_waste')
  assert.equal(waste.quantity,.2); assert.equal(waste.lossCost,2)
  assert.equal(waste.lossClassification,'confirmed_physical_loss')
  assert.equal(waste.reason,'Producto deteriorado antes de cargar')
  assert.equal(movements.find(m=>m.type==='dispatch').dispatchMerma,.5)
  await processCommand(db,loss.ref)
  assert.equal((await read('distBalances','central__'+productId)).quantity,79.3)
  assert.equal((await root.collection('distStockMovements').where('refId','==',loss.id).get()).size,movements.length)
  const legacyMovement=movements.find(m=>m.type==='dispatch')
  assert.equal(legacyMovement.quantity,10.5)
  console.log('PASS: payloads ambiguos bloqueados sin stock; carga legacy normal compatible; pérdida real explícita, costo, lotes y reintento idempotente.')
} finally { await env.cleanup(); await db.terminate() }
