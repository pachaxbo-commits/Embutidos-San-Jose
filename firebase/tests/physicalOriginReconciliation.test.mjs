// Multi-lot dispatch and correction integration tests. Emulator only.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'

const require = createRequire(new URL('../../functions/package.json', import.meta.url))
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9095'
const { initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { processCommand, dayKey } = require('./operations.cjs')
const projectId = 'demo-pachax-audit'
const app = initializeApp({ projectId }, `qa-multilot-${Date.now()}`)
const db = getFirestore(app)
const root = db.doc('restaurants/sanjose')
const env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8085, rules: fs.readFileSync('firebase/firestore.rules', 'utf8') } })
const prefix = `ml${Date.now().toString(36)}`
const admin = `${prefix}-admin`, warehouse = `${prefix}-warehouse`, sellerA = `${prefix}-seller-a`, sellerB = `${prefix}-seller-b`, sellerAdmin = `${prefix}-seller-admin`, sellerHistoric = `${prefix}-seller-historic`, sellerBad = `${prefix}-seller-bad`
let passed = 0
const pass = (condition, label) => { assert(condition, label); passed++; console.log(`PASS: ${label}`) }
const read = async (collection, id) => (await root.collection(collection).doc(id).get()).data()
async function command(actor, type, payload, expected = 'confirmed') {
  const id = `${prefix}-${type}-${Math.random().toString(36).slice(2)}`
  await setDoc(doc(env.authenticatedContext(actor).firestore(), 'restaurants', 'sanjose', 'distOperations', id), { id, restaurantId: 'sanjose', createdBy: actor, createdAt: new Date().toISOString(), type, payload, status: 'queued' })
  await processCommand(db, root.collection('distOperations').doc(id))
  const ref = root.collection('distOperations').doc(id)
  const until = Date.now() + 60000
  let row
  while (Date.now() < until) {
    row = (await ref.get()).data()
    if (row?.status !== 'queued') break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.equal(row?.status, expected, `${type}: ${row?.error || 'sin procesar'}`)
  return { ...row, id }
}

try {
  for (const [uid, role] of [[admin,'admin'],[warehouse,'warehouse'],[sellerA,'distributor']]) await root.collection('members').doc(uid).set({ active:true, role, displayName:role })
  const pid = `${prefix}-origin-product`, lid = `${prefix}-origin-lot`, exceptionId = `${prefix}-exception`
  await root.collection('distProducts').doc(pid).set({ id:pid, name:'Synthetic origin', unitType:'kg', active:true })
  const initial = { id:lid, productId:pid, productName:'Synthetic origin', lotCode:'201026', manufacturedOn:'2026-10-20', expiresOn:'2026-10-30', productionCost:10, quantities:{central:1.740}, pendingOrigins:{central:[{ exceptionId, accountingLotId:lid, sourceMovementId:'synthetic-movement', physicalOriginConfirmed:false, basis:'original_accounting_debit_only', historicalUnitCost:10, quantity:1.740 }]} }
  await root.collection('distLots').doc(lid).set(initial)
  await root.collection('distBalances').doc(`central__${pid}`).set({ productId:pid, quantity:1.740 })
  await root.collection('distLotHistory').doc(exceptionId).set({ id:exceptionId, action:'physical_origin_pending', productId:pid, createdAt:new Date().toISOString(), createdBy:admin, reason:'Synthetic accounting origin' })
  const payload = { productId:pid, lotId:lid, location:'central', quantity:1, expectedPendingQuantity:1.740, confirmationType:'physical_check', explicitConfirmation:true, reason:'Verified synthetic stock in warehouse', evidenceNote:'Synthetic label and physical weighing' }
  const part = await command(admin,'confirmPhysicalOrigin',payload)
  const after = await read('distLots',lid)
  pass(after.pendingOrigins.central[0].quantity === 0.740, 'partial reconciliation conserves 0.740 pending')
  pass(JSON.stringify(after.quantities) === JSON.stringify(initial.quantities) && after.productionCost === initial.productionCost, 'physical quantity and cost unchanged')
  pass((await read('distBalances',`central__${pid}`)).quantity === 1.740, 'balance unchanged')
  pass((await read('distStockMovements',part.id)).physicalEffect === false, 'audit is nonphysical')
  await processCommand(db,root.collection('distOperations').doc(part.id))
  pass((await read('distLots',lid)).pendingOrigins.central[0].quantity === 0.740, 'same operationId is idempotent')
  await command(admin,'confirmPhysicalOrigin',payload,'rejected')
  pass(true,'stale pending amount rejected')
  const identity = { productId:pid, lotId:lid, expectedLotCode:initial.lotCode, expectedManufacturedOn:initial.manufacturedOn, expectedExpiresOn:initial.expiresOn, expectedQuantities:initial.quantities, lotCode:'CORRECT-LABEL', manufacturedOn:'2026-10-25', expiresOn:'2026-11-10', explicitConfirmation:true, evidenceNote:'Synthetic documentary label correction', reason:'Synthetic correction verified by administrator' }
  await command(admin,'rectifyLotIdentity',identity,'rejected')
  pass(true,'identity blocked while partial pending remains')
  await command(admin,'confirmPhysicalOrigin',{...payload,quantity:0.740,expectedPendingQuantity:0.740})
  const reconciled = await read('distLots',lid)
  pass(reconciled.pendingOrigins.central.length === 0 && reconciled.expiresOn === initial.expiresOn, 'origin fully reconciled; expired date remains unchanged')
  const rectification = await command(admin,'rectifyLotIdentity',identity)
  await processCommand(db,root.collection('distOperations').doc(rectification.id))
  const corrected = await read('distLots',lid)
  pass(corrected.lotCode === 'CORRECT-LABEL' && corrected.productionCost === 10 && corrected.quantities.central === 1.740, 'identity rectification conserves cost and quantity')
  await command(admin,'rectifyLotIdentity',identity,'rejected')
  pass(true,'stale identity snapshot rejected')
  for (const uid of [warehouse,sellerA]) {
    await assert.rejects(()=>command(uid,'confirmPhysicalOrigin',payload))
    await assert.rejects(()=>command(uid,'rectifyLotIdentity',identity))
  }
  pass(true,'warehouse and distributor forbidden by Rules')
  await root.collection('distLots').doc(lid).set(initial)
  const secondAdmin = `${prefix}-second-admin`
  await root.collection('members').doc(secondAdmin).set({ active:true,role:'admin',displayName:'Second admin' })
  const concurrent = [`${prefix}-concurrent-a`, `${prefix}-concurrent-b`]
  for (const id of concurrent) await root.collection('distOperations').doc(id).set({ id, restaurantId:'sanjose', createdBy:id.endsWith('-b') ? secondAdmin : admin, createdAt:new Date().toISOString(), type:'confirmPhysicalOrigin', payload:{...payload,quantity:1.740}, status:'queued' })
  await Promise.all(concurrent.map(id=>processCommand(db,root.collection('distOperations').doc(id))))
  const statuses = await Promise.all(concurrent.map(async id=>(await read('distOperations',id)).status))
  pass(statuses.sort().join(',') === 'confirmed,rejected', 'concurrent administrators cannot confirm stale balance twice')
  console.log(`${passed} physical origin checks passed`)
} finally { await env.cleanup() }
