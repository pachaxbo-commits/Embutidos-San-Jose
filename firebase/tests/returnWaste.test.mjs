// QA focalizado con Firestore Emulator. Nunca apunta a producción.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8085'
const require = createRequire(new URL('../../functions/package.json', import.meta.url))
const { initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { processCommand } = require('./operations.cjs')
const projectId = 'demo-pachax-audit'
const app = initializeApp({ projectId }, `return-waste-${Date.now()}`)
const db = getFirestore(app)
const root = db.doc('restaurants/sanjose')
const prefix = `rw-${Date.now().toString(36)}`
const admin = `${prefix}-admin`, warehouse = `${prefix}-warehouse`, seller = `${prefix}-seller`
const route = `${prefix}-route`, product = `${prefix}-product`, dispatchId = `${prefix}-dispatch`
const routeLoc = `route__${route}`, lotId = `${prefix}-lot-a`, lotIdB = `${prefix}-lot-b`
let checks = 0
const pass = (condition, message) => { assert.ok(condition, message); checks++; console.log('PASS', message) }
const read = async (collection, id) => (await root.collection(collection).doc(id).get()).data()
async function run(actor, type, payload, id = `${prefix}-${type}-${Math.random().toString(36).slice(2)}`, expected = 'confirmed') {
  const ref = root.collection('distOperations').doc(id)
  await ref.set({ id, restaurantId: 'sanjose', createdBy: actor, createdAt: new Date().toISOString(), type, payload, status: 'queued' })
  await processCommand(db, ref)
  const result = (await ref.get()).data()
  assert.equal(result.status, expected, `${type}: ${result.error || 'sin error'}`)
  return result
}

try {
  await root.collection('members').doc(admin).set({ active: true, role: 'admin', warehouseId: 'central', displayName: 'Admin QA' })
  await root.collection('members').doc(warehouse).set({ active: true, role: 'warehouse', warehouseId: 'central', displayName: 'Almacén QA' })
  await root.collection('members').doc(seller).set({ active: true, role: 'distributor', routeId: route, displayName: 'Vendedor QA' })
  await root.collection('distProducts').doc(product).set({ id: product, restaurantId: 'sanjose', name: 'Chorizo QA', unitType: 'kg', active: true })
  await root.collection('distRoutes').doc(route).set({ id: route, restaurantId: 'sanjose', name: 'Ruta QA', active: true })
  await root.collection('distBalances').doc(`${routeLoc}__${product}`).set({ id: `${routeLoc}__${product}`, restaurantId: 'sanjose', locationKind: 'route', routeId: route, productId: product, quantity: 6 })
  await root.collection('distBalances').doc(`central__${product}`).set({ id: `central__${product}`, restaurantId: 'sanjose', locationKind: 'central', productId: product, quantity: 0 })
  await root.collection('distLots').doc(lotId).set({ id: lotId, restaurantId: 'sanjose', productId: product, productName: 'Chorizo QA', unitType: 'kg', lotCode: 'LOTE-QA-A', expiresOn: '2099-01-01', productionCost: 8, quantities: { [routeLoc]: 2, central: 0 } })
  await root.collection('distLots').doc(lotIdB).set({ id: lotIdB, restaurantId: 'sanjose', productId: product, productName: 'Chorizo QA', unitType: 'kg', lotCode: 'LOTE-QA-B', expiresOn: '2099-01-01', productionCost: 8, quantities: { [routeLoc]: 4, central: 0 } })
  await root.collection('distDispatches').doc(dispatchId).set({ id: dispatchId, restaurantId: 'sanjose', status: 'open', routeId: route, routeName: 'Ruta QA', distributorUid: seller, distributorName: 'Vendedor QA', warehouseId: 'central', lines: [{ productId: product, productName: 'Chorizo QA', unitType: 'kg', quantity: 6, allocations: [{ lotId, lotCode: 'LOTE-QA-A', quantity: 2, productionCost: 8 }, { lotId: lotIdB, lotCode: 'LOTE-QA-B', quantity: 4, productionCost: 8 }] }], additions: [] })
  const closureId = `closure_${dispatchId}`
  await root.collection('distClosures').doc(closureId).set({ id: closureId, restaurantId: 'sanjose', dispatchId, routeId: route, routeName: 'Ruta QA', distributorUid: seller, distributorName: 'Vendedor QA', status: 'draft', declaredReturns: { [product]: 6 }, returnDeclaredAt: new Date().toISOString(), products: [] })

  const invalid = await run(warehouse, 'closure', { mode: 'warehouse', closure: { dispatchId, products: [{ productId: product, actualReturn: 0, physicalReturn: 0.46, returnWaste: 0.47, returnWasteReason: 'Prueba inválida' }] } }, `${prefix}-invalid-waste`, 'rejected')
  pass(invalid.error.includes('merma'), 'backend bloquea merma mayor que lo recibido sin cambiar stock')
  pass((await read('distBalances', `${routeLoc}__${product}`)).quantity === 6 && (await read('distBalances', `central__${product}`)).quantity === 0, 'rechazo de cantidades no modifica balances')

  const first = await run(warehouse, 'closure', { mode: 'warehouse', closure: { dispatchId, products: [{ productId: product, actualReturn: 5.54, physicalReturn: 6, returnWaste: 0.46, returnWasteReason: 'Producto deteriorado' }] } })
  let closure = await read('distClosures', closureId)
  let row = closure.products[0]
  pass(row.declaredReturn === 6 && closure.declaredReturns[product] === 6, 'recepción conserva intacta la declaración previa de 6 kg')
  pass(row.physicalReturn === 6 && row.actualReturn === 5.54 && row.shortage === 0 && row.overage === 0, '6 kg recibidos y 0,46 kg de merma registran 5,54 aptos sin faltante ni sobrante')
  pass((await read('distBalances', `${routeLoc}__${product}`)).quantity === 0 && (await read('distBalances', `central__${product}`)).quantity === 5.54, 'ruta se reconcilia en cero y solo 5,54 kg vendibles vuelven a almacén')
  let lot = await read('distLots', lotId)
  let lotB = await read('distLots', lotIdB)
  pass(lot.quantities[routeLoc] === 0 && lot.quantities.central === 2 && lotB.quantities[routeLoc] === 0 && lotB.quantities.central === 3.54, 'retorno apto vuelve proporcionalmente a los dos lotes originales sin mezclar asignaciones')
  const firstMovements = await root.collection('distStockMovements').where('refId', '==', first.id).get()
  const wasteMovement = firstMovements.docs.map((doc) => doc.data()).find((movement) => movement.type === 'return_waste')
  pass(wasteMovement?.lossCost === 3.68 && wasteMovement.allocations[0].lotCode === 'LOTE-QA-B', 'merma conserva lote, costo histórico y costo de pérdida sin volver al stock vendible')

  await run(admin, 'closure', { mode: 'money', closure: { dispatchId, status: 'closed', physicalCashDeclared: 0 } })
  const reopened = await run(admin, 'reopen', { closureId, reason: 'Corregir pesaje de recepción' })
  closure = await read('distClosures', closureId)
  const reversedWaste = (await root.collection('distStockMovements').where('refId', '==', first.id).get()).docs.map((doc) => doc.data()).find((movement) => movement.type === 'return_waste')
  pass(reopened.result.id === closureId && closure.status === 'reopened' && closure.warehouseClosedBy === '', 'reapertura deja corregir la recepción nuevamente')
  pass(closure.declaredReturns[product] === 6 && closure.reopenHistory[0].products[0].physicalReturn === 6, 'reapertura preserva declaración y snapshot de la recepción anterior')
  pass(Boolean(reversedWaste?.reversedAt && reversedWaste.reversalOperationId), 'la merma anterior queda auditada como revertida para no duplicar pérdidas en reportes')
  pass((await read('distBalances', `${routeLoc}__${product}`)).quantity === 6 && (await read('distBalances', `central__${product}`)).quantity === 0, 'reapertura revierte exactamente la aplicación previa al lote y balances originales')
  lot = await read('distLots', lotId)
  lotB = await read('distLots', lotIdB)
  pass(lot.quantities[routeLoc] === 2 && lot.quantities.central === 0 && lotB.quantities[routeLoc] === 4 && lotB.quantities.central === 0, 'reapertura devuelve al lote de ruta las cantidades aptas y mermadas')

  await run(warehouse, 'closure', { mode: 'warehouse', closure: { dispatchId, products: [{ productId: product, actualReturn: 5.34, physicalReturn: 5.8, returnWaste: 0.46, returnWasteReason: 'Producto deteriorado' }] } })
  closure = await read('distClosures', closureId)
  row = closure.products[0]
  pass(row.physicalReturn === 5.8 && row.actualReturn === 5.34 && row.shortage === 0.2 && row.overage === 0, 'tras reabrir, nueva recepción calcula apto y faltante contra el peso físico')
  pass(closure.declaredReturns[product] === 6, 'segunda confirmación tampoco sobrescribe la declaración original')
  pass((await read('distBalances', `${routeLoc}__${product}`)).quantity === 0 && (await read('distBalances', `central__${product}`)).quantity === 5.34, 'segunda aplicación vuelve a reconciliar la ruta una sola vez')
  const wasteMovements = (await root.collection('distStockMovements').where('productId', '==', product).get()).docs.map((doc) => doc.data()).filter((movement) => movement.type === 'return_waste' && !movement.reversedAt)
  pass(wasteMovements.length === 1 && wasteMovements[0].lossCost === 3.68, 'al cerrar de nuevo, reportes solo conservan el costo de la merma vigente')

  const overProduct = `${prefix}-over-product`, overDispatch = `${prefix}-over-dispatch`, overLot = `${prefix}-over-lot`
  await root.collection('distProducts').doc(overProduct).set({ id: overProduct, restaurantId: 'sanjose', name: 'Producto sobrante QA', unitType: 'kg', active: true })
  await root.collection('distBalances').doc(`${routeLoc}__${overProduct}`).set({ id: `${routeLoc}__${overProduct}`, restaurantId: 'sanjose', locationKind: 'route', routeId: route, productId: overProduct, quantity: 6 })
  await root.collection('distBalances').doc(`central__${overProduct}`).set({ id: `central__${overProduct}`, restaurantId: 'sanjose', locationKind: 'central', productId: overProduct, quantity: 0 })
  await root.collection('distLots').doc(overLot).set({ id: overLot, restaurantId: 'sanjose', productId: overProduct, productName: 'Producto sobrante QA', unitType: 'kg', lotCode: 'LOTE-SOBRANTE-QA', expiresOn: '2099-01-01', productionCost: 8, quantities: { [routeLoc]: 6, central: 0 } })
  await root.collection('distDispatches').doc(overDispatch).set({ id: overDispatch, restaurantId: 'sanjose', status: 'open', routeId: route, routeName: 'Ruta QA', distributorUid: seller, distributorName: 'Vendedor QA', warehouseId: 'central', lines: [{ productId: overProduct, productName: 'Producto sobrante QA', unitType: 'kg', quantity: 6, allocations: [{ lotId: overLot, lotCode: 'LOTE-SOBRANTE-QA', quantity: 6, productionCost: 8 }] }], additions: [] })
  const overClosureId = `closure_${overDispatch}`
  await root.collection('distClosures').doc(overClosureId).set({ id: overClosureId, restaurantId: 'sanjose', dispatchId: overDispatch, routeId: route, routeName: 'Ruta QA', distributorUid: seller, distributorName: 'Vendedor QA', status: 'draft', declaredReturns: { [overProduct]: 6 }, returnDeclaredAt: new Date().toISOString(), products: [] })
  await run(warehouse, 'closure', { mode: 'warehouse', closure: { dispatchId: overDispatch, products: [{ productId: overProduct, actualReturn: 5.54, physicalReturn: 6.46, returnWaste: 0.46, returnWasteReason: 'Producto deteriorado' }] } })
  const overClosure = await read('distClosures', overClosureId)
  const overRow = overClosure.products[0]
  const overLots = await root.collection('distLots').where('productId', '==', overProduct).get()
  const quarantineLot = overLots.docs.map((doc) => doc.data()).find((item) => item.quarantined)
  const overageMovement = (await root.collection('distStockMovements').where('dispatchId', '==', overDispatch).get()).docs.map((doc) => doc.data()).find((movement) => movement.type === 'overage')
  pass(overRow.actualReturn === 5.54 && overRow.returnWaste === 0.46 && overRow.overage === 0.46 && overRow.shortage === 0, 'sobrante real y merma se mantienen separados en la misma recepción')
  pass((await read('distBalances', `${routeLoc}__${overProduct}`)).quantity === 0 && (await read('distBalances', `central__${overProduct}`)).quantity === 6 && quarantineLot?.quantities.central === 0.46, 'solo 5,54 kg vendibles y 0,46 kg en cuarentena llegan al almacén; ruta queda en cero')
  pass(overageMovement?.routeDelta === 0 && overageMovement.centralDelta === 0.46, 'sobrante sin lote de ruta verificable no inventa una salida en la ruta')

  console.log(`${checks} comprobaciones de retorno/merma aprobadas`)
} finally {
  await app.delete()
}
