// Todas las escrituras de esta prueba quedan confinadas a Firebase Emulator.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'

const req = createRequire(new URL('../../functions/package.json', import.meta.url))
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085'
const { initializeApp } = req('firebase-admin/app')
const { getFirestore } = req('firebase-admin/firestore')
const { dayKey, processCommand } = req('./operations.cjs')
const projectId = 'demo-pachax-audit'
const app = initializeApp({ projectId }, 'qa-dispatch-return-merma')
const db = getFirestore(app)
const root = db.doc('restaurants/sanjose')
const env = await initializeTestEnvironment({
  projectId,
  firestore: { host: '127.0.0.1', port: 8085, rules: fs.readFileSync('firebase/firestore.rules', 'utf8') },
})
const prefix = `return-merma-${Date.now().toString(36)}`
const admin = `${prefix}-admin`, warehouse = `${prefix}-warehouse`, seller = `${prefix}-seller`, sellerShortage = `${prefix}-seller-shortage`
const route = `${prefix}-route`, wh = 'central', productId = `${prefix}-product`, lotId = `${prefix}-lot`
let checks = 0
const pass = (condition, label) => { assert.ok(condition, label); checks += 1; console.log('PASS', label) }
const read = async (collection, id) => (await root.collection(collection).doc(id).get()).data()
async function command(actor, type, payload, expected = 'confirmed') {
  const id = `${prefix}-${type}-${Math.random().toString(36).slice(2)}`
  await setDoc(doc(env.authenticatedContext(actor).firestore(), 'restaurants', 'sanjose', 'distOperations', id), {
    id, restaurantId: 'sanjose', createdBy: actor, createdAt: new Date().toISOString(), type, payload, status: 'queued',
  })
  await processCommand(db, root.collection('distOperations').doc(id))
  const operation = await read('distOperations', id)
  assert.equal(operation.status, expected, `${type}: ${operation.error || 'sin procesar'}`)
  return { ...operation, id }
}

try {
  await root.collection('members').doc(admin).set({ role: 'admin', active: true, displayName: 'QA admin' })
  await root.collection('members').doc(warehouse).set({ role: 'warehouse', active: true, warehouseId: wh, displayName: 'QA almacén' })
  await root.collection('members').doc(seller).set({ role: 'distributor', active: true, routeId: route, displayName: 'QA distribuidor' })
  await root.collection('members').doc(sellerShortage).set({ role: 'distributor', active: true, routeId: `${route}-shortage`, displayName: 'QA distribuidor faltante' })
  await root.collection('distProducts').doc(productId).set({ id: productId, restaurantId: 'sanjose', name: 'Producto QA', unitType: 'kg', active: true, referencePrice: 40, productionCost: 10 })

  const intake = await command(admin, 'intake', { warehouseId: wh, lines: [{ productId, quantity: 200, lotCode: 'LOTE-QA', manufacturedOn: dayKey(new Date()), expiresOn: '2027-12-31', productionCost: 10 }], note: 'Prueba de merma de despacho' })
  const dispatch = await command(warehouse, 'dispatch', {
    warehouseId: wh, routeId: route, routeName: 'Ruta QA', distributorUid: seller, distributorName: 'QA distribuidor',
    lines: [{ productId, quantity: 82.3, normalQuantity: 80, dispatchMerma: 2.3, allocationsRequested: [{ lotId: `${intake.id}__0`, quantity: 82.3 }] }],
  })
  const dispatchDoc = await read('distDispatches', dispatch.id)
  pass(dispatch.result.lines[0].quantity === 82.3 && dispatch.result.lines[0].normalQuantity === 80 && dispatch.result.lines[0].dispatchMerma === 2.3, 'despacho persiste normal, merma y total físico por separado')
  pass((await read('distBalances', `central__${productId}`)).quantity === 117.7, '80 + 2.3 descuenta 82.3 kg del almacén')
  pass((await read('distBalances', `route__${route}__${productId}`)).quantity === 82.3, '80 + 2.3 carga exactamente 82.3 kg en ruta')
  const dispatchMovements = await root.collection('distStockMovements').where('refId', '==', dispatch.id).get()
  pass(dispatchMovements.docs.some(row => row.data().type === 'dispatch' && row.data().normalQuantity === 80 && row.data().dispatchMerma === 2.3), 'movimiento de traslado conserva normal y merma para trazabilidad')
  pass(!dispatchMovements.docs.some(row => row.data().type === 'dispatch_waste'), 'la nueva merma no crea dispatch_waste')
  pass(!dispatchMovements.docs.some(row => typeof row.data().lossCost === 'number'), 'la nueva merma no genera costo de pérdida')

  const addition = await command(warehouse, 'addition', {
    dispatch: { id: dispatch.id }, lines: [{ productId, quantity: 10.3, normalQuantity: 10, dispatchMerma: 0.3, allocationsRequested: [{ lotId: `${intake.id}__0`, quantity: 10.3 }] }],
    note: 'Aumento QA', warehouseResponsibleName: 'QA almacén',
  })
  pass((await read('distBalances', `route__${route}__${productId}`)).quantity === 92.6, 'aumento de 10 + 0.3 entrega 10.3 kg físicos a la ruta')
  pass((await read('distBalances', `central__${productId}`)).quantity === 107.4, 'el aumento descuenta exactamente 10.3 kg del almacén')

  await command(warehouse, 'correctDispatch', {
    dispatchId: dispatch.id, reason: 'Corrección controlada de prueba',
    changes: [{ targetType: 'initial', productId, newQuantity: 81.3, newDispatchMerma: 2.3 }],
  })
  const correctedDispatch = await read('distDispatches', dispatch.id)
  pass(correctedDispatch.lines[0].quantity === 81.3 && correctedDispatch.lines[0].dispatchMerma === 2.3 && correctedDispatch.lines[0].normalQuantity === 79, 'corrección conserva merma y ajusta la cantidad normal')
  pass((await read('distBalances', `route__${route}__${productId}`)).quantity === 91.6, 'corrección devuelve solo 1 kg físico a la ruta de origen correspondiente')
  pass((await read('distLots', `${intake.id}__0`)).quantities.central === 108.4, 'corrección devuelve al lote original sin FEFO inverso')

  const closureId = `closure_${dispatch.id}`
  await command(seller, 'closure', {
    mode: 'declaration', dispatchId: dispatch.id,
    declaredReturns: { [productId]: 89 }, declaredReturnMermas: { [productId]: -0.1 }, physicalCashDeclared: 0,
  }, 'rejected')
  pass(!(await read('distClosures', closureId)), 'el servidor rechaza mermas declaradas negativas sin crear cierre')
  await command(seller, 'closure', {
    mode: 'declaration', dispatchId: dispatch.id,
    declaredReturns: { [productId]: 89 }, declaredReturnMermas: { [productId]: 2.6 }, physicalCashDeclared: 0,
  }, 'rejected')
  pass(!(await read('distClosures', closureId)), 'el servidor rechaza merma recuperable enviada por payload del distribuidor')
  const sellerDb = env.authenticatedContext(seller).firestore()
  const declarationOperation = await command(seller, 'closure', {
    mode: 'declaration', dispatchId: dispatch.id,
    declaredReturns: { [productId]: 89 }, declaredReturnMermas: {}, physicalCashDeclared: 0,
  })
  const declaration = await read('distClosures', closureId)
  pass(declaration.declaredReturns[productId] === 89 && declaration.declaredReturnMermas[productId] === 0 && declaration.returnDeclarationMode === 'normal_only', 'declaración nueva conserva solo cantidad normal y el servidor registra merma como cero por producto')
  const balancesAfterDeclaration = (await read('distBalances', `central__${productId}`)).quantity
  await processCommand(db, root.collection('distOperations').doc(declarationOperation.id))
  pass((await read('distBalances', `central__${productId}`)).quantity === balancesAfterDeclaration, 'reintentar la misma declaración confirmada no mueve stock')
  await assertFails(setDoc(doc(sellerDb, 'restaurants', 'sanjose', 'distClosures', `${prefix}-forged`), {
    id: `${prefix}-forged`, restaurantId: 'sanjose', dispatchId: dispatch.id, routeId: route,
    distributorUid: seller, distributorName: 'QA distribuidor', declaredReturns: { [productId]: 91.6 },
    declaredReturnMermas: { [productId]: 2.6 }, returnDeclaredBy: seller,
    returnDeclaredAt: new Date().toISOString(), dayKey: dispatchDoc.dayKey,
  }))
  await assertFails(setDoc(doc(sellerDb, 'restaurants', 'sanjose', 'distClosures', closureId), {
    declaredReturnMermas: { [productId]: 2.6 },
  }, { merge: true }))
  checks += 1
  await assertFails(setDoc(doc(sellerDb, 'restaurants', 'sanjose', 'distClosures', closureId), { products: [{ returnWaste: 0 }] }, { merge: true }))
  checks += 1
  pass(true, 'Rules bloquean escritura directa de declaraciones y de recepción; el servidor valida la ruta propia')

  const beforeReceipt = (await read('distBalances', `central__${productId}`)).quantity
  await command(warehouse, 'closure', {
    mode: 'warehouse', closure: { dispatchId: dispatch.id, products: [{ productId, actualReturn: 89, returnMerma: 2.6, returnWaste: 0, physicalReturn: 91.6 }] },
    warehouseResponsibleName: 'QA almacén',
  })
  const receivedClosure = await read('distClosures', closureId)
  pass(receivedClosure.products[0].actualReturn === 89 && receivedClosure.products[0].returnMerma === 2.6 && receivedClosure.products[0].returnWaste === 0, 'almacén confirma 89 normal + 2.6 merma con pérdida cero aunque declaración nueva no incluye merma')
  pass(receivedClosure.products[0].expectedReturn === 91.6 && receivedClosure.products[0].dispatchMermaReconciliationStatus === 'returned', 'sin ventas, retorno normal más toda la merma enviada concilia sin sobrante')
  pass((await read('distBalances', `central__${productId}`)).quantity === beforeReceipt + 91.6, 'retorno normal más merma recuperable vuelve completo al stock')
  pass((await read('distBalances', `route__${route}__${productId}`)).quantity === 0, 'al confirmar retorno la ruta queda conciliada en cero')
  const returnMovements = await root.collection('distStockMovements').where('dispatchId', '==', dispatch.id).get()
  pass(returnMovements.docs.some(row => row.data().type === 'return_merma' && row.data().quantity === 2.6), 'la merma recuperable usa return_merma y no se registra como pérdida')
  pass(!returnMovements.docs.some(row => row.data().type === 'return_waste' || row.data().type === 'return_waste_unassigned'), 'la recepción confirmada no genera pérdida económica')

  const settlementProduct = `${prefix}-settlement-product`, settlementSeller = `${prefix}-settlement-seller`, settlementRoute = `${prefix}-settlement-route`
  await root.collection('members').doc(settlementSeller).set({ role: 'distributor', active: true, routeId: settlementRoute, displayName: 'QA distribuidor conciliación' })
  await root.collection('distProducts').doc(settlementProduct).set({ id: settlementProduct, restaurantId: 'sanjose', name: 'Producto merma conciliable QA', unitType: 'kg', active: true, referencePrice: 40, productionCost: 10 })
  const settlementIntake = await command(admin, 'intake', { lines: [{ productId: settlementProduct, quantity: 200, lotCode: 'LOTE-CONCILIA-QA', manufacturedOn: dayKey(new Date()), expiresOn: '2027-12-31', productionCost: 10 }], note: 'Fixture de conciliación comercial' })
  const settlementDispatch = await command(warehouse, 'dispatch', {
    warehouseId: wh, routeId: settlementRoute, routeName: 'Ruta QA conciliación', distributorUid: settlementSeller, distributorName: 'QA distribuidor conciliación',
    lines: [{ productId: settlementProduct, quantity: 90.1, normalQuantity: 88, dispatchMerma: 2.1, allocationsRequested: [{ lotId: `${settlementIntake.id}__0`, quantity: 90.1 }] }],
  })
  const settlementSale = await command(settlementSeller, 'sale', {
    sourceLocation: 'route', dispatchId: settlementDispatch.id, routeId: settlementRoute, routeName: 'Ruta QA conciliación',
    lines: [{ productId: settlementProduct, quantity: 84, actualUnitPrice: 40 }], paymentKind: 'cash', cashAmount: 3360, qrAmount: 0, creditAmount: 0,
  })
  pass((await read('distBalances', `route__${settlementRoute}__${settlementProduct}`)).quantity === 6.1, 'venta nominal de 84 deja el saldo físico de ruta de 6.1 kg')
  const settlementClosureId = `closure_${settlementDispatch.id}`
  await command(settlementSeller, 'closure', { mode: 'declaration', dispatchId: settlementDispatch.id, declaredReturns: { [settlementProduct]: 4 }, declaredReturnMermas: {}, physicalCashDeclared: 3360 })
  const warehouseSettlement = await command(warehouse, 'closure', {
    mode: 'warehouse', closure: { dispatchId: settlementDispatch.id, products: [{ productId: settlementProduct, actualReturn: 4, returnMerma: 0.08, returnWaste: 0, physicalReturn: 4.08 }] },
    warehouseResponsibleName: 'QA almacén',
  })
  const settledClosure = await read('distClosures', settlementClosureId)
  const settledRow = settledClosure.products.find(row => row.productId === settlementProduct)
  pass(settledRow.expectedReturn === 4.08 && settledRow.shortage === 0 && settledRow.overage === 0, '88 + 2.10; vendió 84; retornó 4 + .08 produce 4.08 esperado sin diferencia')
  pass(settledRow.normalExpectedReturn === 4 && settledRow.dispatchMermaSent === 2.1 && settledRow.dispatchMermaIncludedInSales === 2.02 && settledRow.dispatchMermaReconciliationStatus === 'included_in_sales', 'el cierre vincula 2.02 kg adicionales a la salida agregada de las ventas')
  const settlementMovements = await root.collection('distStockMovements').where('dispatchId', '==', settlementDispatch.id).get()
  const mermaSaleMovements = settlementMovements.docs.map(row => row.data()).filter(row => row.type === 'dispatch_merma_sale' && !row.reversedAt)
  pass(mermaSaleMovements.length === 1 && mermaSaleMovements[0].quantity === 2.02 && mermaSaleMovements[0].routeDelta === -2.02 && mermaSaleMovements[0].centralDelta === 0, 'la conciliación comercial descuenta 2.02 kg de ruta una sola vez sin alterar central')
  pass(mermaSaleMovements[0].costOfSales === 20.2 && mermaSaleMovements[0].allocations.reduce((sum, row) => sum + row.quantity, 0) === 2.02, 'COGS conserva costo y trazabilidad de lote sin registrarlo como pérdida')
  pass(!settlementMovements.docs.some(row => ['shortage', 'overage', 'dispatch_waste'].includes(row.data().type) && !row.data().reversedAt), 'la conciliación no genera faltante, sobrante ni pérdida artificial')
  pass((await read('distBalances', `central__${settlementProduct}`)).quantity === 113.98 && (await read('distBalances', `route__${settlementRoute}__${settlementProduct}`)).quantity === 0, 'saldo final físico y ruta concilian: 200 - 90.1 + 4.08 = 113.98')
  await processCommand(db, root.collection('distOperations').doc(warehouseSettlement.id))
  pass((await read('distBalances', `central__${settlementProduct}`)).quantity === 113.98 && (await root.collection('distStockMovements').where('dispatchId', '==', settlementDispatch.id).get()).docs.map(row => row.data()).filter(row => row.type === 'dispatch_merma_sale' && !row.reversedAt).length === 1, 'reintentar la misma confirmación de almacén no duplica descuento ni movimiento')
  await command(admin, 'closure', { mode: 'closed', closure: { dispatchId: settlementDispatch.id, physicalCashDeclared: 3360 } })
  pass((await read('distDispatches', settlementDispatch.id)).status === 'closed' && (await read('distClosures', settlementClosureId)).status === 'closed', 'Administración finaliza el mismo cierre después de warehouse_done')
  const reopen = await command(admin, 'reopen', { closureId: settlementClosureId, reason: 'Prueba QA de reversión de conciliación comercial' })
  pass((await read('distClosures', settlementClosureId)).status === 'reopened' && (await read('distDispatches', settlementDispatch.id)).status === 'open', 'reapertura vuelve a abrir el despacho para revisión')
  const reopenedBalances = { central: (await read('distBalances', `central__${settlementProduct}`)).quantity, route: (await read('distBalances', `route__${settlementRoute}__${settlementProduct}`)).quantity }
  pass(reopenedBalances.central === 109.9 && reopenedBalances.route === 6.1, 'reapertura revierte retornos y conciliación a los saldos físicos anteriores')
  await processCommand(db, root.collection('distOperations').doc(reopen.id))
  pass((await read('distBalances', `central__${settlementProduct}`)).quantity === 109.9 && (await read('distBalances', `route__${settlementRoute}__${settlementProduct}`)).quantity === 6.1, 'reintentar reapertura no vuelve a mover stock')

  const unfitProduct = `${prefix}-unfit-merma-product`, unfitSeller = `${prefix}-unfit-merma-seller`, unfitRoute = `${prefix}-unfit-merma-route`
  await root.collection('members').doc(unfitSeller).set({ role: 'distributor', active: true, routeId: unfitRoute, displayName: 'QA no apto' })
  await root.collection('distProducts').doc(unfitProduct).set({ id: unfitProduct, restaurantId: 'sanjose', name: 'Producto no apto QA', unitType: 'kg', active: true, referencePrice: 40, productionCost: 10 })
  const unfitIntake = await command(admin, 'intake', { lines: [{ productId: unfitProduct, quantity: 200, lotCode: 'LOTE-NO-APTO-QA', manufacturedOn: dayKey(new Date()), expiresOn: '2027-12-31', productionCost: 10 }], note: 'Fixture no apto' })
  const unfitDispatch = await command(warehouse, 'dispatch', {
    warehouseId: wh, routeId: unfitRoute, routeName: 'Ruta QA no apto', distributorUid: unfitSeller, distributorName: 'QA no apto',
    lines: [{ productId: unfitProduct, quantity: 90.1, normalQuantity: 88, dispatchMerma: 2.1, allocationsRequested: [{ lotId: `${unfitIntake.id}__0`, quantity: 90.1 }] }],
  })
  await command(unfitSeller, 'sale', {
    sourceLocation: 'route', dispatchId: unfitDispatch.id, routeId: unfitRoute, routeName: 'Ruta QA no apto',
    lines: [{ productId: unfitProduct, quantity: 84, actualUnitPrice: 40 }], paymentKind: 'cash', cashAmount: 3360, qrAmount: 0, creditAmount: 0,
  })
  await command(warehouse, 'closure', {
    mode: 'warehouse', closure: { dispatchId: unfitDispatch.id, products: [{ productId: unfitProduct, actualReturn: 4, returnMerma: 0.08, returnWaste: 0.1, returnWasteReason: 'Producto deteriorado', physicalReturn: 4.18 }] },
    warehouseResponsibleName: 'QA almacén',
  })
  const unfitClosure = await read('distClosures', `closure_${unfitDispatch.id}`)
  const unfitRow = unfitClosure.products.find(row => row.productId === unfitProduct)
  const unfitMovements = (await root.collection('distStockMovements').where('dispatchId', '==', unfitDispatch.id).get()).docs.map(row => row.data())
  pass(unfitRow.dispatchMermaIncludedInSales === 1.92 && unfitRow.returnWaste === 0.1 && unfitRow.shortage === 0 && unfitRow.overage === 0, 'no apto queda separado y solo el remanente demostrado se atribuye a ventas')
  pass(unfitMovements.some(row => row.type === 'return_waste' && row.quantity === 0.1 && row.lossCost === 1), 'producto no apto conserva motivo y costo de lote como pérdida real')
  pass(unfitMovements.some(row => row.type === 'dispatch_merma_sale' && row.quantity === 1.92 && row.costOfSales === 19.2), 'el costo de merma restante entra separado al costo de venta, sin duplicar pérdida')
  pass((await read('distBalances', `central__${unfitProduct}`)).quantity === 113.98 && (await read('distBalances', `route__${unfitRoute}__${unfitProduct}`)).quantity === 0, 'no apto no retorna a central y el saldo de ruta queda en cero')

  const pendingProduct = `${prefix}-pending-merma-product`, pendingSeller = `${prefix}-pending-merma-seller`, pendingRoute = `${prefix}-pending-merma-route`
  await root.collection('members').doc(pendingSeller).set({ role: 'distributor', active: true, routeId: pendingRoute, displayName: 'QA merma pendiente' })
  await root.collection('distProducts').doc(pendingProduct).set({ id: pendingProduct, restaurantId: 'sanjose', name: 'Producto diferencia pendiente QA', unitType: 'kg', active: true, referencePrice: 40, productionCost: 10 })
  const pendingIntake = await command(admin, 'intake', { lines: [{ productId: pendingProduct, quantity: 20, lotCode: 'LOTE-PENDIENTE-QA', manufacturedOn: dayKey(new Date()), expiresOn: '2027-12-31', productionCost: 10 }], note: 'Fixture pendiente sin ventas' })
  const pendingDispatch = await command(warehouse, 'dispatch', {
    warehouseId: wh, routeId: pendingRoute, routeName: 'Ruta QA pendiente', distributorUid: pendingSeller, distributorName: 'QA merma pendiente',
    lines: [{ productId: pendingProduct, quantity: 10.2, normalQuantity: 10, dispatchMerma: 0.2, allocationsRequested: [{ lotId: `${pendingIntake.id}__0`, quantity: 10.2 }] }],
  })
  const pendingBefore = { central: (await read('distBalances', `central__${pendingProduct}`)).quantity, route: (await read('distBalances', `route__${pendingRoute}__${pendingProduct}`)).quantity }
  const rejectedReceipt = await command(warehouse, 'closure', {
    mode: 'warehouse', closure: { dispatchId: pendingDispatch.id, products: [{ productId: pendingProduct, actualReturn: 10, returnMerma: 0, returnWaste: 0, physicalReturn: 10 }] },
    warehouseResponsibleName: 'QA almacén',
  }, 'rejected')
  pass(rejectedReceipt.error.includes('merma adicional enviada'), 'sin ventas y con merma faltante el servidor comunica revisión pendiente')
  pass((await read('distBalances', `central__${pendingProduct}`)).quantity === pendingBefore.central && (await read('distBalances', `route__${pendingRoute}__${pendingProduct}`)).quantity === pendingBefore.route, 'recepción ambigua rechazada no modifica balances ni crea cuarentena artificial')
  pass(!(await read('distClosures', `closure_${pendingDispatch.id}`))?.warehouseClosedBy, 'recepción ambigua no marca warehouse_done')

  const shortageProduct = `${prefix}-shortage-product`
  await root.collection('distProducts').doc(shortageProduct).set({ id: shortageProduct, restaurantId: 'sanjose', name: 'Producto faltante QA', unitType: 'kg', active: true, referencePrice: 40, productionCost: 10 })
  const shortageIntake = await command(admin, 'intake', { lines: [{ productId: shortageProduct, quantity: 10, lotCode: 'LOTE-FALTANTE-QA', manufacturedOn: dayKey(new Date()), expiresOn: '2027-12-31', productionCost: 10 }], note: 'Prueba de faltante real' })
  const shortageDispatch = await command(warehouse, 'dispatch', {
    warehouseId: 'central', routeId: `${route}-shortage`, routeName: 'Ruta QA faltante', distributorUid: sellerShortage, distributorName: 'QA distribuidor faltante',
    lines: [{ productId: shortageProduct, quantity: 2, allocationsRequested: [{ lotId: `${shortageIntake.id}__0`, quantity: 2 }] }],
  })
  await command(warehouse, 'closure', {
    mode: 'warehouse', closure: { dispatchId: shortageDispatch.id, products: [{ productId: shortageProduct, actualReturn: 1.765, returnMerma: 0, returnWaste: 0, physicalReturn: 1.765 }] },
    warehouseResponsibleName: 'QA almacén',
  })
  const shortageClosure = await read('distClosures', `closure_${shortageDispatch.id}`)
  pass(shortageClosure.products[0].shortage === 0.235, '2 kg esperados y 1.765 recibidos registran faltante real de 0.235 kg')
  const shortageMovement = (await root.collection('distStockMovements').where('dispatchId', '==', shortageDispatch.id).get()).docs.map(row => row.data()).find(row => row.type === 'shortage' && !row.reversedAt)
  pass(shortageClosure.products[0].shortageMovementId === shortageMovement?.id, 'cierre conserva enlace exacto al movimiento de faltante con costo histórico')
  pass((await read('distBalances', `route__${route}-shortage__${shortageProduct}`)).quantity === 0, 'el faltante real se concilia sin completar artificialmente el retorno')
  pass((await read('distBalances', `central__${shortageProduct}`)).quantity === 9.765, 'almacén recibe exactamente 1.765 kg sin redondearlo a 1.77')
  pass((await read('distLots', `${shortageIntake.id}__0`)).quantities.central === 9.765, 'el lote original conserva exactamente las milésimas recibidas')

  console.log(`\n${checks} pruebas de merma de despacho/retorno pasaron.`)
} finally {
  await env.cleanup()
  await app.delete()
}
