// Forensic reproduction. Every write is confined to a demo Firestore emulator.
// The historical backend is loaded from Git in memory; production source is unchanged.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire, Module } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const projectId = 'demo-pachax-audit'
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/, 'Run only with a local Firestore emulator')
process.env.GCLOUD_PROJECT = projectId
const functionsPath = fileURLToPath(new URL('../../functions/', import.meta.url))
const req = createRequire(new URL('../../functions/package.json', import.meta.url))
const { initializeApp, deleteApp } = req('firebase-admin/app')
const { getFirestore } = req('firebase-admin/firestore')
const current = req('./operations.cjs')
const historicalSource = execFileSync('git', ['show', 'cc5d0e8^:functions/operations.cjs'], { encoding: 'utf8' })
const historicalModule = new Module(path.join(functionsPath, 'forensic-historical.cjs'))
historicalModule.filename = path.join(functionsPath, 'forensic-historical.cjs')
historicalModule.paths = Module._nodeModulePaths(functionsPath)
historicalModule._compile(historicalSource, historicalModule.filename)
const historical = historicalModule.exports
const app = initializeApp({ projectId }, `tocino-forensic-${Date.now()}`)
const db = getFirestore(app)
const root = db.doc('restaurants/sanjose')
const prefix = `tocino-forensic-${Date.now().toString(36)}`
const admin = `${prefix}-admin`, warehouse = `${prefix}-warehouse`, seller = `${prefix}-seller`
let seq = 0
const read = async (col,id) => (await root.collection(col).doc(id).get()).data()
async function command(backend, actor, type, payload, status = 'confirmed') {
  const id = `${prefix}-${type}-${++seq}`
  const ref = root.collection('distOperations').doc(id)
  await ref.set({ id, type, payload, restaurantId:'sanjose', createdBy:actor, createdAt:new Date().toISOString(), status:'queued' })
  await backend.processCommand(db, ref)
  const op = (await ref.get()).data()
  assert.equal(op.status, status, `${type}: ${op.error || 'unexpected status'}`)
  return op
}
async function fixture(backend, label) {
  const productId = `${prefix}-${label}-product`, routeId = `${prefix}-${label}-route`
  await root.collection('members').doc(seller).set({ role:'distributor', active:true, routeId, displayName:'Ricardo QA' })
  await root.collection('distProducts').doc(productId).set({ id:productId, name:'Sachet Tocino QA', active:true, unitType:'package', referencePrice:12.5, productionCost:9.83 })
  await command(backend, admin, 'intake', { lines:[{productId,quantity:100,lotCode:'040926-QA',manufacturedOn:'2026-09-04',expiresOn:'2030-11-04',productionCost:9.83}] })
  const dispatch = await command(backend, warehouse, 'dispatch', { warehouseId:'central',routeId,routeName:'Zona Sud QA',distributorUid:seller,distributorName:'Ricardo QA',lines:[{productId,quantity:15}] })
  const ctx = { backend,productId,routeId,dispatchId:dispatch.id,closureId:`closure_${dispatch.id}` }
  ctx.sale = (quantity, actor=seller, extra={}) => command(backend, actor, 'sale', {
    routeId:actor===seller?routeId:'administracion',routeName:actor===seller?'Zona Sud QA':'Administración',dispatchId:dispatch.id,
    sourceLocation:actor===seller?'route':'centralWarehouse',lines:[{productId,quantity,actualUnitPrice:12.5}],
    paymentKind:'cash',cashAmount:quantity*12.5,qrAmount:0,creditAmount:0,cashReceived:quantity*12.5,...extra,
  })
  ctx.receive = () => command(backend,warehouse,'closure',{mode:'warehouse',closure:{dispatchId:dispatch.id,products:[{productId,sold:12,actualReturn:3,returnMerma:0,returnWaste:0,physicalReturn:3}]}})
  ctx.close = () => command(backend,admin,'closure',{mode:'money',closure:{dispatchId:dispatch.id,physicalCashDeclared:150}})
  ctx.row = async () => (await read('distClosures',ctx.closureId)).products.find(r=>r.productId===productId)
  ctx.balance = async loc => (await read('distBalances',`${loc}__${productId}`)).quantity
  return ctx
}
async function sell12(ctx) { return [await ctx.sale(4),await ctx.sale(1),await ctx.sale(7)] }
const assertRow = (row,sold,expected=3) => {
  assert.equal(row.totalLoaded,15);assert.equal(row.sold,sold);assert.equal(row.expectedReturn,expected)
  assert.equal(row.actualReturn,3);assert.equal(row.variance,3-expected)
}
try {
  await root.collection('members').doc(admin).set({role:'admin',active:true,displayName:'Administración QA'})
  await root.collection('members').doc(warehouse).set({role:'warehouse',active:true,warehouseId:'central',displayName:'Almacén QA'})

  const baseline = await fixture(historical,'baseline')
  await sell12(baseline);await baseline.receive();await baseline.close()
  assertRow(await baseline.row(),12)
  assert.equal(await baseline.balance(`route__${baseline.routeId}`),0)
  console.log('PASS baseline histórico: 15 despachados - 12 vendidos - 3 retornados = 0; variance 0')

  const real = await fixture(historical,'actual-cause')
  await sell12(real)
  const adminSale = await real.sale(2,admin)
  assert.equal(adminSale.result.dispatchId,real.dispatchId)
  assert.equal(adminSale.result.sourceLocation,'centralWarehouse')
  assert.equal(await real.balance(`route__${real.routeId}`),3)
  assert.equal(await real.balance('central'),83)
  const receipt = await real.receive()
  assert.equal(receipt.payload.closure.products[0].sold,12)
  assertRow(await real.row(),14)
  await real.close()
  assert.equal((await read('distClosures',real.closureId)).cashSales,175)
  assert.equal(await real.balance(`route__${real.routeId}`),0)
  assert.equal(await real.balance('central'),86)
  console.log('PASS causa real reproducida: payload sold 12 → snapshot sold 14, expected 3, received 3, variance 0; venta adicional sale de central')

  const fixed = await fixture(current,'current-admin')
  await sell12(fixed)
  const fixedSale = await fixed.sale(2,admin)
  assert.equal(fixedSale.result.dispatchId,'')
  await fixed.receive();await fixed.close()
  assertRow(await fixed.row(),12)
  assert.equal((await read('distClosures',fixed.closureId)).cashSales,150)
  console.log('PASS fix ya existente cc5d0e8: backend elimina dispatchId ajeno de venta admin; cierre 12/3/3 sin contaminar caja')

  const legacy = await fixture(current,'current-legacy')
  await sell12(legacy)
  const legacySale = await legacy.sale(2,admin)
  await root.collection('distSales').doc(legacySale.id).update({dispatchId:legacy.dispatchId})
  await legacy.receive()
  assertRow(await legacy.row(),12)
  console.log('PASS backend actual también excluye venta central histórica con dispatchId ajeno')

  const correction = await fixture(current,'quantity-correction')
  const correctedSale = await correction.sale(14)
  const revision = await command(current,admin,'editSale',{saleId:correctedSale.id,reason:'Corrección auditada QA',lines:[{productId:correction.productId,quantity:12,actualUnitPrice:12.5}],paymentKind:'cash',cashAmount:150,qrAmount:0,creditAmount:0})
  assert.equal(revision.status,'confirmed')
  assert.equal(await correction.balance(`route__${correction.routeId}`),3)
  await correction.receive();assertRow(await correction.row(),12)
  console.log('PASS revisión comercial 14 → 12 restaura 2 al stock y cierre usa effectiveSnapshot 12')

  const reopen = await fixture(current,'reopen')
  await sell12(reopen);await reopen.receive();await reopen.close()
  await command(current,admin,'reopen',{closureId:reopen.closureId,reason:'Revisar cobro QA'})
  assert.equal(await reopen.balance(`route__${reopen.routeId}`),3)
  const oldMoves = (await root.collection('distStockMovements').where('dispatchId','==',reopen.dispatchId).get()).docs.map(d=>d.data())
  assert.equal(oldMoves.filter(m=>m.type==='return'&&m.reversedAt).length,1)
  await reopen.receive();await reopen.close();assertRow(await reopen.row(),12)
  const newMoves = (await root.collection('distStockMovements').where('dispatchId','==',reopen.dispatchId).get()).docs.map(d=>d.data())
  assert.equal(newMoves.filter(m=>m.type==='return'&&!m.reversedAt).reduce((n,m)=>n+m.quantity,0),3)
  assert.equal(await reopen.balance('central'),88)
  const nextDispatch = await command(current,warehouse,'dispatch',{warehouseId:'central',routeId:reopen.routeId,routeName:'Zona Sud QA',distributorUid:seller,distributorName:'Ricardo QA',lines:[{productId:reopen.productId,quantity:15}]})
  await command(current,seller,'sale',{routeId:reopen.routeId,routeName:'Zona Sud QA',dispatchId:nextDispatch.id,sourceLocation:'route',lines:[{productId:reopen.productId,quantity:12,actualUnitPrice:12.5}],cashAmount:150,qrAmount:0,creditAmount:0,cashReceived:150,paymentKind:'cash'})
  await command(current,warehouse,'closure',{mode:'warehouse',closure:{dispatchId:nextDispatch.id,products:[{productId:reopen.productId,actualReturn:3,returnMerma:0,returnWaste:0,physicalReturn:3}]}})
  assertRow((await read('distClosures',`closure_${nextDispatch.id}`)).products[0],12)
  console.log('PASS reapertura y movimientos revertidos: retorno activo 3 una sola vez; siguiente despacho tampoco mezcla ventas del cierre anterior')

  const other = await fixture(current,'wrong-dispatch')
  const otherSales = await sell12(other)
  await root.collection('distSales').doc(otherSales[0].id).update({dispatchId:'another-dispatch-qa'})
  await other.receive()
  assertRow(await other.row(),8)
  console.log('PASS hipótesis dispatch equivocado reproduce 8/3/3, no el caso real 14/3/3')

  const crossDay = await fixture(current,'different-daykeys')
  const crossSales = await sell12(crossDay)
  await root.collection('distSales').doc(crossSales[0].id).update({dayKey:'2026-10-16'})
  await crossDay.receive();assertRow(await crossDay.row(),12)
  console.log('PASS dayKey diferente en mismo despacho conserva 12; filtro de fecha por sí solo no explica los 2 reales')

  const inconsistent = await fixture(current,'commercial-without-stock')
  const inconsistentSales = await sell12(inconsistent)
  const sale = await read('distSales',inconsistentSales[0].id)
  await root.collection('distSales').doc(sale.id).update({effectiveSnapshot:{lines:[{...sale.lines[0],quantity:6}]}})
  await inconsistent.receive();assertRow(await inconsistent.row(),14)
  console.log('PASS defecto de control reproducido: alteración comercial artificial sin stock también pasa variance 0; NO es la evidencia del caso real')

  const afterReceipt = await fixture(current,'after-receipt')
  const initialSales = await sell12(afterReceipt)
  await afterReceipt.receive()
  await command(current,seller,'sale',{routeId:afterReceipt.routeId,dispatchId:afterReceipt.dispatchId,sourceLocation:'route',lines:[{productId:afterReceipt.productId,quantity:1,actualUnitPrice:12.5}],cashAmount:12.5,qrAmount:0,creditAmount:0,cashReceived:12.5,paymentKind:'cash'},'rejected')
  await root.collection('distSales').doc(initialSales[0].id).update({effectiveSnapshot:{lines:[{productId:afterReceipt.productId,quantity:6}]}})
  assertRow(await afterReceipt.row(),12)
  console.log('PASS venta después de recepción bloqueada; cambio documental artificial posterior no reescribe snapshot guardado')
  console.log('PASS 10 escenarios forenses. Sin acceso ni escritura a producción.')
} finally { await deleteApp(app) }
