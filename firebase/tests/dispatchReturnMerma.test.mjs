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
  const sellerDb = env.authenticatedContext(seller).firestore()
  await setDoc(doc(sellerDb, 'restaurants', 'sanjose', 'distClosures', closureId), {
    id: closureId, restaurantId: 'sanjose', dispatchId: dispatch.id, routeId: route,
    distributorUid: seller, distributorName: 'QA distribuidor',
    declaredReturns: { [productId]: 89 }, declaredReturnMermas: { [productId]: 2.6 },
    returnDeclaredBy: seller, returnDeclaredAt: new Date().toISOString(), dayKey: dispatchDoc.dayKey,
    physicalCashDeclared: 0, cashDeclaredBy: seller, cashDeclaredAt: new Date().toISOString(),
  })
  const declaration = await read('distClosures', closureId)
  pass(declaration.declaredReturns[productId] === 89 && declaration.declaredReturnMermas[productId] === 2.6, 'declaración conserva normal 89 y merma 2.6 en campos distintos')
  await assertFails(setDoc(doc(sellerDb, 'restaurants', 'sanjose', 'distClosures', `${prefix}-forged`), {
    id: `${prefix}-forged`, restaurantId: 'sanjose', dispatchId: dispatch.id, routeId: `${route}-otra`,
    distributorUid: seller, distributorName: 'QA distribuidor', declaredReturns: { [productId]: 91.6 },
    declaredReturnMermas: { [productId]: 2.6 }, returnDeclaredBy: seller,
    returnDeclaredAt: new Date().toISOString(), dayKey: dispatchDoc.dayKey,
  }))
  checks += 1
  await assertFails(setDoc(doc(sellerDb, 'restaurants', 'sanjose', 'distClosures', closureId), { products: [{ returnWaste: 0 }] }, { merge: true }))
  checks += 1
  pass(true, 'Rules permiten declarar solo en ruta propia y bloquean escritura de recepción')

  const beforeReceipt = (await read('distBalances', `central__${productId}`)).quantity
  await command(warehouse, 'closure', {
    mode: 'warehouse', closure: { dispatchId: dispatch.id, products: [{ productId, actualReturn: 89, returnMerma: 2.6, returnWaste: 0, physicalReturn: 91.6 }] },
    warehouseResponsibleName: 'QA almacén',
  })
  const receivedClosure = await read('distClosures', closureId)
  pass(receivedClosure.products[0].actualReturn === 89 && receivedClosure.products[0].returnMerma === 2.6 && receivedClosure.products[0].returnWaste === 0, 'almacén confirma 89 normal + 2.6 merma con pérdida cero')
  pass((await read('distBalances', `central__${productId}`)).quantity === beforeReceipt + 91.6, 'retorno normal más merma recuperable vuelve completo al stock')
  pass((await read('distBalances', `route__${route}__${productId}`)).quantity === 0, 'al confirmar retorno la ruta queda conciliada en cero')
  const returnMovements = await root.collection('distStockMovements').where('dispatchId', '==', dispatch.id).get()
  pass(returnMovements.docs.some(row => row.data().type === 'return_merma' && row.data().quantity === 2.6), 'la merma recuperable usa return_merma y no se registra como pérdida')
  pass(!returnMovements.docs.some(row => row.data().type === 'return_waste' || row.data().type === 'return_waste_unassigned'), 'la recepción confirmada no genera pérdida económica')

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
