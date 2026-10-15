// QA isolado en Firestore Emulator. Nunca apunta a producción.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing'
import { doc, setDoc, getDoc } from 'firebase/firestore'

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085'
const require = createRequire(new URL('../../functions/package.json', import.meta.url))
const { initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { processCommand, dayKey } = require('./operations.cjs')
const projectId = 'demo-pachax-audit'
const app = initializeApp({ projectId }, `courtesy-quotes-${Date.now()}`)
const db = getFirestore(app)
const root = db.doc('restaurants/sanjose')
const env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8085, rules: fs.readFileSync('firebase/firestore.rules', 'utf8') } })
const prefix = `cq-${Date.now().toString(36)}`
const admin = `${prefix}-admin`, seller = `${prefix}-seller`, other = `${prefix}-other`, warehouse = `${prefix}-warehouse`
const product = `${prefix}-product`, route = `${prefix}-route`, customer = `${prefix}-customer`
let checks = 0
const pass = (condition, message) => { assert(condition, message); checks++; console.log('PASS', message) }
const read = async (collection, id) => (await root.collection(collection).doc(id).get()).data()
async function run(actor, type, payload, id = `${prefix}-${type}-${Math.random().toString(36).slice(2)}`, expected = 'confirmed') {
  const ref = root.collection('distOperations').doc(id)
  await ref.set({ id, restaurantId: 'sanjose', createdBy: actor, createdAt: new Date().toISOString(), type, payload, status: 'queued' })
  await processCommand(db, ref)
  const op = (await ref.get()).data()
  assert.equal(op.status, expected, `${type}: ${op.error || 'sin error'}`)
  return op
}
try {
  for (const uid of [admin, seller, other, warehouse]) await root.collection('members').doc(uid).set({ active: true, role: uid === admin ? 'admin' : uid === warehouse ? 'warehouse' : 'distributor', routeId: route, warehouseId: 'central', displayName: uid })
  await root.collection('distRoutes').doc(route).set({ id: route, restaurantId: 'sanjose', name: 'Ruta QA', active: true })
  await root.collection('distProducts').doc(product).set({ id: product, restaurantId: 'sanjose', name: 'Producto QA', unitType: 'kg', active: true, referencePrice: 20 })
  await root.collection('distCustomers').doc(customer).set({ id: customer, restaurantId: 'sanjose', name: 'Cliente QA', active: true, identityNumber: '9990001' })
  await root.collection('distBalances').doc(`route__${route}__${product}`).set({ id: `route__${route}__${product}`, restaurantId: 'sanjose', locationKind: 'route', routeId: route, productId: product, quantity: 10 })
  await root.collection('distLots').doc(`${prefix}-lot`).set({ id: `${prefix}-lot`, restaurantId: 'sanjose', productId: product, productName: 'Producto QA', unitType: 'kg', lotCode: 'QA-LOTE', expiresOn: '2099-01-01', productionCost: 8, quantities: { [`route__${route}`]: 10, central: 0 } })
  const dispatchId = `${prefix}-dispatch`
  await root.collection('distDispatches').doc(dispatchId).set({ id: dispatchId, restaurantId: 'sanjose', status: 'open', routeId: route, routeName: 'Ruta QA', distributorUid: seller, distributorName: seller, warehouseId: 'central', lines: [{ productId: product, productName: 'Producto QA', unitType: 'kg', quantity: 10, allocations: [{ lotId: `${prefix}-lot`, lotCode: 'QA-LOTE', expiresOn: '2099-01-01', quantity: 10, productionCost: 8 }] }], additions: [] })

  const beforeBalance = (await read('distBalances', `route__${route}__${product}`)).quantity
  const courtesy = await run(seller, 'sale', { saleKind: 'courtesy', courtesyReason: 'Muestra comercial', sourceLocation: 'route', routeId: route, routeName: 'Ruta QA', dispatchId, customerId: customer, lines: [{ productId: product, quantity: 1.5, unitType: 'kg', actualUnitPrice: 20 }], cashAmount: 0, qrAmount: 0, creditAmount: 0, paymentKind: 'cash' })
  const courtesySale = courtesy.result
  pass(courtesySale.total === 0 && courtesySale.cashAmount === 0 && courtesySale.qrAmount === 0 && courtesySale.creditAmount === 0 && courtesySale.courtesyCost === 12, 'cortesía registra costo histórico y no crea ingresos')
  pass((await read('distBalances', `route__${route}__${product}`)).quantity === beforeBalance - 1.5 && !(await root.collection('distReceivables').doc(courtesySale.id).get()).exists, 'cortesía consume stock y no crea cartera')
  pass((await root.collection('distStockMovements').where('refId', '==', courtesySale.id).get()).docs.some(d => d.data().type === 'courtesy'), 'movimiento de cortesía queda separado y trazable')

  const closureId = `${prefix}-warehouse-closure`
  await run(warehouse, 'closure', { mode: 'warehouse', closure: { dispatchId, products: [{ productId: product, actualReturn: 8, returnWaste: 0.5, returnWasteReason: 'Dañado al manipular' }] } }, closureId)
  const closure = await read('distClosures', `closure_${dispatchId}`)
  const row = closure.products[0]
  const balAfter = (await read('distBalances', `route__${route}__${product}`)).quantity
  const centralAfter = (await read('distBalances', `central__${product}`)).quantity
  const lotAfter = await read('distLots', `${prefix}-lot`)
  pass(row.sold === 0 && row.courtesy === 1.5 && row.returnWaste === 0.5 && row.shortage === 0 && row.actualReturn === 8, 'cierre distingue venta, cortesía, retorno apto y merma del faltante')
  pass(balAfter === 0 && centralAfter === 8 && lotAfter.quantities.central === 8 && lotAfter.quantities[`route__${route}`] === 0, 'merma no vuelve al inventario vendible y retorno apto vuelve a su lote')
  pass((await root.collection('distStockMovements').where('refId', '==', closureId).get()).docs.some(d => d.data().type === 'return_waste' && d.data().lossCost === 4), 'merma conserva costo de lote y movimiento independiente')

  const overProduct = `${prefix}-overage-product`, overDispatchId = `${prefix}-overage-dispatch`
  await root.collection('distProducts').doc(overProduct).set({ id: overProduct, restaurantId: 'sanjose', name: 'Producto sobrante QA', unitType: 'kg', active: true, referencePrice: 20 })
  await root.collection('distBalances').doc(`route__${route}__${overProduct}`).set({ id: `route__${route}__${overProduct}`, restaurantId: 'sanjose', locationKind: 'route', routeId: route, productId: overProduct, quantity: 10 })
  await root.collection('distLots').doc(`${prefix}-overage-lot`).set({ id: `${prefix}-overage-lot`, restaurantId: 'sanjose', productId: overProduct, productName: 'Producto sobrante QA', unitType: 'kg', lotCode: 'QA-LOTE-SOBRANTE', expiresOn: '2099-01-01', productionCost: 7, quantities: { [`route__${route}`]: 10, central: 0 } })
  await root.collection('distDispatches').doc(overDispatchId).set({ id: overDispatchId, restaurantId: 'sanjose', status: 'open', routeId: route, routeName: 'Ruta QA', distributorUid: seller, distributorName: seller, warehouseId: 'central', lines: [{ productId: overProduct, productName: 'Producto sobrante QA', unitType: 'kg', quantity: 10, allocations: [{ lotId: `${prefix}-overage-lot`, lotCode: 'QA-LOTE-SOBRANTE', expiresOn: '2099-01-01', quantity: 10, productionCost: 7 }] }], additions: [] })
  const overageClosureId = `${prefix}-overage-close`
  await run(warehouse, 'closure', { mode: 'warehouse', closure: { dispatchId: overDispatchId, products: [{ productId: overProduct, actualReturn: 12, returnWaste: 0, returnWasteReason: '' }] } }, overageClosureId)
  const overageClosure = await read('distClosures', `closure_${overDispatchId}`)
  const overageLots = await root.collection('distLots').where('productId', '==', overProduct).get()
  const quarantined = overageLots.docs.find(d => d.data().quarantined === true)
  pass(overageClosure.products[0].overage === 2 && overageClosure.products[0].shortage === 0, 'sobrante físico sobre el stock disponible se separa del faltante')
  pass(quarantined?.data().quantities.central === 2 && (await read('distBalances', `central__${overProduct}`)).quantity === 12, 'sobrante queda en cuarentena sin consumir ni inventar asignaciones de lote de ruta')
  pass((await read('distBalances', `route__${route}__${overProduct}`)).quantity === 0, 'retorno con sobrante no deja stock de ruta negativo')

  const quoteInput = { routeId: route, customerId: customer, validUntil: dayKey(new Date(Date.now() + 7 * 86400000)), lines: [{ productId: product, unitType: 'kg', quantity: 2, unitPrice: 19 }], note: 'Oferta QA' }
  const quoteOperationId = `${prefix}-quote-create`
  const sellerDb = env.authenticatedContext(seller).firestore()
  await setDoc(doc(sellerDb, 'restaurants', 'sanjose', 'distOperations', quoteOperationId), { id: quoteOperationId, restaurantId: 'sanjose', createdBy: seller, createdAt: new Date().toISOString(), type: 'quoteCreate', payload: quoteInput, status: 'queued' })
  await processCommand(db, root.collection('distOperations').doc(quoteOperationId))
  const quoteOp = await read('distOperations', quoteOperationId)
  assert.equal(quoteOp.status, 'confirmed', quoteOp.error)
  const quote = quoteOp.result
  pass(quote.total === 38 && quote.status === 'vigente' && quote.quoteNumber.startsWith('COT-'), 'cotización crea número legible, total y vigencia')
  pass((await read('distBalances', `central__${product}`)).quantity === centralAfter && (await read('distBalances', `route__${route}__${product}`)).quantity === balAfter, 'crear cotización no altera balances')
  pass(!(await root.collection('distSales').doc(quote.id).get()).exists && !(await root.collection('distReceivables').doc(quote.id).get()).exists, 'cotización no crea venta ni deuda')
  const otherUpdate = await run(other, 'quoteUpdate', { quoteId: quote.id, ...quoteInput }, `${prefix}-other-edit`, 'rejected')
  pass(otherUpdate.error.includes('permiso'), 'otro distribuidor no puede editar cotización ajena')
  const update = await run(seller, 'quoteUpdate', { quoteId: quote.id, ...quoteInput, lines: [{ productId: product, unitType: 'kg', quantity: 3, unitPrice: 18 }] })
  pass(update.result.total === 54 && update.result.revision === 2 && update.result.history.length === 1, 'edición guarda nuevo total e historial de versiones')
  const cancel = await run(seller, 'quoteCancel', { quoteId: quote.id, reason: 'Cliente desistió' })
  pass(cancel.result.status === 'cancelada' && cancel.result.cancelReason === 'Cliente desistió', 'cancelación requiere y conserva el motivo')

  await assertFails(setDoc(doc(sellerDb, 'restaurants', 'sanjose', 'distQuotes', `${prefix}-forged`), { id: `${prefix}-forged`, sellerUid: seller }))
  const otherDb = env.authenticatedContext(other).firestore()
  await assertFails(getDoc(doc(otherDb, 'restaurants', 'sanjose', 'distQuotes', quote.id)))
  pass(true, 'Rules prohíben escrituras directas y lectura de cotización ajena')
  console.log(`${checks} comprobaciones de cortesías y cotizaciones aprobadas`)
} finally {
  await env.cleanup()
  await app.delete()
}
