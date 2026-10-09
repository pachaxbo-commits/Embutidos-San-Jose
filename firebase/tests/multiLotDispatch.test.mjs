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
  for (const [uid, value] of [[admin, { role: 'admin', displayName: 'Administración QA' }], [warehouse, { role: 'warehouse', warehouseId: 'central', displayName: 'Almacén QA' }], [sellerA, { role: 'distributor', routeId: `${prefix}-route-a`, displayName: 'Ruta A' }], [sellerB, { role: 'distributor', routeId: `${prefix}-route-b`, displayName: 'Ruta B' }], [sellerAdmin, { role: 'distributor', routeId: `${prefix}-route-admin`, displayName: 'Ruta Admin' }], [sellerHistoric, { role: 'distributor', routeId: `${prefix}-route-historic`, displayName: 'Ruta Histórica' }], [sellerBad, { role: 'distributor', routeId: `${prefix}-bad-sum`, displayName: 'Ruta Bad' }]]) await root.collection('members').doc(uid).set({ active: true, ...value })
  const products = { main: `${prefix}-main`, admin: `${prefix}-admin-product`, warehouse: `${prefix}-warehouse-product`, historic: `${prefix}-historic` }
  for (const id of Object.values(products)) await root.collection('distProducts').doc(id).set({ id, restaurantId: 'sanjose', name: id, unitType: id === products.main ? 'kg' : 'package', active: true, referencePrice: 10, productionCost: 4 })
  const today = dayKey(new Date())
  const intake = await command(admin, 'intake', { lines: [
    { productId: products.main, quantity: 20, lotCode: 'A', manufacturedOn: today, expiresOn: '2099-01-01' },
    { productId: products.main, quantity: 20, lotCode: 'B', manufacturedOn: today, expiresOn: '2099-02-01' },
    { productId: products.main, quantity: 30, lotCode: 'C', manufacturedOn: today, expiresOn: '2099-03-01' },
    { productId: products.admin, quantity: 6, lotCode: 'ADMIN', manufacturedOn: today, expiresOn: '2099-01-01' },
    { productId: products.warehouse, quantity: 6, lotCode: 'WAREHOUSE', manufacturedOn: today, expiresOn: '2099-01-01' },
    { productId: products.historic, quantity: 8, lotCode: 'HIST-A', manufacturedOn: today, expiresOn: '2099-01-01' },
    { productId: products.historic, quantity: 8, lotCode: 'HIST-B', manufacturedOn: today, expiresOn: '2099-02-01' },
  ], note: 'QA multi-lote' })
  void intake
  const lotRows = await root.collection('distLots').where('createdBy', '==', admin).get()
  const lotIds = new Map(lotRows.docs.map(row => [row.data().lotCode, row.id]))
  const lot = code => { const id = lotIds.get(code); assert(id, `Lote ${code} no encontrado`); return id }

  const multi = await command(admin, 'dispatch', { warehouseId: 'central', routeId: `${prefix}-route-a`, routeName: 'Ruta A', distributorUid: sellerA, distributorName: 'Ruta A', warehouseResponsibleName: 'QA', lines: [{ productId: products.main, quantity: 50, allocationsRequested: [{ lotId: lot('A'), quantity: 20 }, { lotId: lot('B'), quantity: 20 }, { lotId: lot('C'), quantity: 10 }] }] })
  const multiDoc = await read('distDispatches', multi.id)
  pass(multiDoc.lines.length === 1 && multiDoc.lines[0].quantity === 50 && multiDoc.lines[0].allocations.length === 3, 'nuevo despacho guarda una línea y tres lotes')
  pass((await read('distBalances', `central__${products.main}`)).quantity === 20 && (await read('distBalances', `route__${prefix}-route-a__${products.main}`)).quantity === 50, 'multi-lote mueve exactamente 50 al destino')
  pass((await read('distLots', lot('A'))).quantities.central === 0 && (await read('distLots', lot('B'))).quantities.central === 0 && (await read('distLots', lot('C'))).quantities.central === 20, 'cada lote descuenta su cantidad exacta')

  await command(admin, 'addition', { dispatch: { id: multi.id }, warehouseResponsibleName: 'QA', lines: [{ productId: products.main, quantity: 10, allocationsRequested: [{ lotId: lot('C'), quantity: 10 }] }] })
  const afterAddition = await read('distDispatches', multi.id)
  pass(afterAddition.additions.at(-1).quantityByProduct[0].allocations[0].quantity === 10, 'aumento multi-lote conserva asignación explícita')

  await command(admin, 'dispatch', { warehouseId: 'central', routeId: `${prefix}-bad-sum`, routeName: 'Bad', distributorUid: sellerBad, distributorName: 'Ruta Bad', warehouseResponsibleName: 'QA', lines: [{ productId: products.main, quantity: 50, allocationsRequested: [{ lotId: lot('C'), quantity: 5 }] }] }, 'rejected')
  pass(true, 'rechaza asignaciones cuya suma no coincide')
  await command(admin, 'addition', { dispatch: { id: multi.id }, warehouseResponsibleName: 'QA', lines: [{ productId: products.main, quantity: 15, allocationsRequested: [{ lotId: lot('C'), quantity: 15 }] }] }, 'rejected')
  pass(true, 'rechaza cantidad superior a la disponible del lote')
  await command(admin, 'addition', { dispatch: { id: multi.id }, warehouseResponsibleName: 'QA', lines: [{ productId: products.main, quantity: 2, allocationsRequested: [{ lotId: lot('C'), quantity: 1 }, { lotId: lot('C'), quantity: 1 }] }] }, 'rejected')
  pass(true, 'rechaza el mismo lote repetido')

  await command(admin, 'correctDispatch', { dispatchId: multi.id, reason: 'Reducir carga multi-lote', changes: [{ targetType: 'initial', productId: products.main, newQuantity: 35 }] })
  const corrected = await read('distDispatches', multi.id)
  pass(corrected.lines[0].quantity === 35 && corrected.corrections.at(-1).returnedQuantity === 15, 'corrección reduce 50 a 35 con auditoría')
  pass((await read('distLots', lot('C'))).quantities.central === 20 && (await read('distLots', lot('B'))).quantities.central === 5, 'corrección devuelve 15 exactamente a los lotes reales almacenados')

  const adminDispatch = await command(admin, 'dispatch', { warehouseId: 'central', routeId: `${prefix}-route-admin`, routeName: 'Admin', distributorUid: sellerAdmin, distributorName: 'Ruta Admin', warehouseResponsibleName: 'QA', lines: [{ productId: products.admin, quantity: 6, allocationsRequested: [{ lotId: lot('ADMIN'), quantity: 6 }] }] })
  await command(admin, 'correctDispatch', { dispatchId: adminDispatch.id, reason: 'Corrección administración', changes: [{ targetType: 'initial', productId: products.admin, newQuantity: 0 }] })
  pass((await read('distLots', lot('ADMIN'))).quantities.central === 6, 'Administración corrige 6 a 0 y devuelve al lote original')

  const warehouseDispatch = await command(warehouse, 'dispatch', { warehouseId: 'central', routeId: `${prefix}-route-b`, routeName: 'Ruta B', distributorUid: sellerB, distributorName: 'Ruta B', warehouseResponsibleName: 'QA', lines: [{ productId: products.warehouse, quantity: 6, allocationsRequested: [{ lotId: lot('WAREHOUSE'), quantity: 6 }] }] })
  await command(warehouse, 'correctDispatch', { dispatchId: warehouseDispatch.id, reason: 'Corrección almacén', changes: [{ targetType: 'initial', productId: products.warehouse, newQuantity: 0 }] })
  pass((await read('distLots', lot('WAREHOUSE'))).quantities.central === 6, 'Almacén corrige 6 a 0 y devuelve al lote original')
  const warehouseMovement = await root.collection('distStockMovements').where('dispatchId', '==', warehouseDispatch.id).get()
  pass(warehouseMovement.docs.some(row => row.data().type === 'dispatch_correction'), 'corrección crea movimiento dispatch_correction')

  const historicDispatch = await command(admin, 'dispatch', { warehouseId: 'central', routeId: `${prefix}-route-historic`, routeName: 'Histórica', distributorUid: sellerHistoric, distributorName: 'Ruta Histórica', warehouseResponsibleName: 'QA', lines: [{ productId: products.historic, quantity: 4, lotId: lot('HIST-A') }, { productId: products.historic, quantity: 4, lotId: lot('HIST-B') }] })
  await root.collection('distDispatches').doc(historicDispatch.id).update({ lines: [
    { productId: products.historic, productName: 'Histórico', unitType: 'package', quantity: 4, allocations: [{ lotId: lot('HIST-A'), lotCode: 'HIST-A', expiresOn: '2099-01-01', quantity: 4, productionCost: 4 }] },
    { productId: products.historic, productName: 'Histórico', unitType: 'package', quantity: 4, allocations: [{ lotId: lot('HIST-B'), lotCode: 'HIST-B', expiresOn: '2099-02-01', quantity: 4, productionCost: 4 }] },
  ] })
  await command(admin, 'correctDispatch', { dispatchId: historicDispatch.id, reason: 'Normalizar histórico', changes: [{ targetType: 'initial', productId: products.historic, newQuantity: 3 }] })
  const historicCorrected = await read('distDispatches', historicDispatch.id)
  pass(historicCorrected.lines.length === 1 && historicCorrected.lines[0].quantity === 3, 'histórico duplicado se normaliza sin duplicar stock')
  pass((await read('distBalances', `route__${prefix}-route-historic__${products.historic}`)).quantity === 3, 'histórico duplicado conserva saldo exacto en ruta')

  console.log(`${passed} comprobaciones multi-lote aprobadas`)
} finally {
  await env.cleanup()
}
