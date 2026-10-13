// Integración de corrección de precio/cantidad. Solo emuladores locales.
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
const { dayKey, processCommand } = require('./operations.cjs')
const projectId = 'demo-pachax-audit'
const app = initializeApp({ projectId }, `qa-sale-price-${Date.now()}`)
const db = getFirestore(app)
const root = db.doc('restaurants/sanjose')
const env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8085, rules: fs.readFileSync('firebase/firestore.rules', 'utf8') } })
const prefix = `sp${Date.now().toString(36)}`
const admin = `${prefix}-admin`, seller = `${prefix}-seller`, route = `${prefix}-route`, customer = `${prefix}-customer`
let passed = 0
const pass = (condition, label) => { assert(condition, label); passed++; console.log(`PASS: ${label}`) }
const read = async (collection, id) => (await root.collection(collection).doc(id).get()).data()
async function command(actor, type, payload, expected = 'confirmed') {
  const id = `${prefix}-${type}-${Math.random().toString(36).slice(2)}`
  await setDoc(doc(env.authenticatedContext(actor).firestore(), 'restaurants', 'sanjose', 'distOperations', id), { id, restaurantId: 'sanjose', createdBy: actor, createdAt: new Date().toISOString(), type, payload, status: 'queued' })
  await processCommand(db, root.collection('distOperations').doc(id))
  const until = Date.now() + 60000
  let operation
  while (Date.now() < until) {
    operation = await read('distOperations', id)
    if (operation?.status !== 'queued') break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.equal(operation?.status, expected, `${type}: ${operation?.error || 'sin procesar'}`)
  return { ...operation, id }
}
const payment = (total, kind = 'cash') => ({ paymentKind: kind, cashAmount: kind === 'cash' ? total : 0, qrAmount: kind === 'qr' ? total : 0, creditAmount: kind === 'credit' ? total : 0 })
const correction = (saleId, lines, total, kind = 'cash', reason = 'Corrección QA') => ({ saleId, reason, lines: lines.map(line => ({ ...line, isPromotional: line.actualUnitPrice !== 30 })), ...payment(total, kind) })

try {
  await root.collection('members').doc(admin).set({ role: 'admin', active: true, displayName: 'Administración QA' })
  await root.collection('members').doc(seller).set({ role: 'distributor', active: true, routeId: route, displayName: 'Hugo QA' })
  await root.collection('distCustomers').doc(customer).set({ id: customer, restaurantId: 'sanjose', name: 'Cliente QA', identityNumber: '9999001', customerCode: '9999001', active: true })
  const ids = Object.fromEntries(['a', 'b', 'delete', 'central', 'credit'].map(key => [key, `${prefix}-${key}`]))
  for (const id of Object.values(ids)) await root.collection('distProducts').doc(id).set({ id, restaurantId: 'sanjose', name: id, unitType: 'kg', active: true, referencePrice: 30, productionCost: 20 })
  const today = dayKey(new Date())
  const intake = await command(admin, 'intake', { note: 'QA', lines: [
    { productId: ids.a, quantity: 30, lotCode: 'A1', manufacturedOn: today, expiresOn: '2099-01-01' },
    { productId: ids.a, quantity: 170, lotCode: 'A2', manufacturedOn: today, expiresOn: '2099-02-01' },
    { productId: ids.b, quantity: 30, lotCode: 'B1', manufacturedOn: today, expiresOn: '2099-01-01' },
    { productId: ids.delete, quantity: 100, lotCode: 'D1', manufacturedOn: today, expiresOn: '2099-01-01' },
    { productId: ids.central, quantity: 100, lotCode: 'C1', manufacturedOn: today, expiresOn: '2099-01-01' },
    { productId: ids.credit, quantity: 100, lotCode: 'CR1', manufacturedOn: today, expiresOn: '2099-01-01' },
  ] })
  const lots = await root.collection('distLots').where('createdBy', '==', admin).get()
  const lotByCode = new Map(lots.docs.map(row => [row.data().lotCode, row.id]))
  const dispatch = await command(admin, 'dispatch', { warehouseId: 'central', routeId: route, routeName: 'Ruta Hugo QA', distributorUid: seller, distributorName: 'Hugo QA', warehouseResponsibleName: 'QA', lines: [
    { productId: ids.a, quantity: 200, allocationsRequested: [{ lotId: lotByCode.get('A1'), quantity: 30 }, { lotId: lotByCode.get('A2'), quantity: 170 }] },
    { productId: ids.b, quantity: 30 },
    { productId: ids.delete, quantity: 100 },
    { productId: ids.credit, quantity: 100 },
  ] })
  const deletionSale = await command(seller, 'sale', { sourceLocation: 'route', routeId: route, routeName: 'Ruta Hugo QA', dispatchId: dispatch.id, customerId: customer, lines: [{ productId: ids.delete, quantity: 70, actualUnitPrice: 30 }, { productId: ids.b, quantity: 10, actualUnitPrice: 30 }], ...payment(2400) })
  await command(seller, 'editSale', correction(deletionSale.id, [{ productId: ids.b, quantity: 10, actualUnitPrice: 30 }], 300))
  pass((await read('distBalances', `route__${route}__${ids.delete}`)).quantity === 100, 'eliminación directa 70 a 0 devuelve exactamente 70 a ruta')
  const sale = await command(seller, 'sale', { sourceLocation: 'route', routeId: route, routeName: 'Ruta Hugo QA', dispatchId: dispatch.id, customerId: customer, lines: [{ productId: ids.a, quantity: 70, actualUnitPrice: 30 }, { productId: ids.b, quantity: 10, actualUnitPrice: 30 }], ...payment(2400) })
  pass((await read('distBalances', `route__${route}__${ids.a}`)).quantity === 130, 'venta 70 deja 130 en ruta')

  const priceOnly = await command(seller, 'editSale', correction(sale.id, [{ productId: ids.a, quantity: 70, actualUnitPrice: 40 }, { productId: ids.b, quantity: 10, actualUnitPrice: 30 }], 3100))
  const afterPrice = await read('distSales', sale.id)
  pass((await read('distBalances', `route__${route}__${ids.a}`)).quantity === 130, 'cambio solo de precio no altera stock')
  pass(afterPrice.effectiveSnapshot.total === 3100 && afterPrice.effectiveSnapshot.lines[0].costTotal === 1400, 'precio recalcula total y conserva costo histórico')
  pass(priceOnly.result.corrected.lines[0].isPromotional === true && priceOnly.result.corrected.lines[0].referenceUnitPrice === 30, 'precio distinto conserva referencia y promoción')
  pass(priceOnly.result.stockDeltas[0].quantity === 0, 'auditoría de precio registra delta de stock cero')

  await command(seller, 'editSale', correction(sale.id, [{ productId: ids.a, quantity: 20, actualUnitPrice: 40 }, { productId: ids.b, quantity: 10, actualUnitPrice: 30 }], 1100))
  pass((await read('distBalances', `route__${route}__${ids.a}`)).quantity === 180, 'reducción 70 a 20 devuelve 50 a ruta')
  await command(seller, 'editSale', correction(sale.id, [{ productId: ids.a, quantity: 50, actualUnitPrice: 40 }, { productId: ids.b, quantity: 10, actualUnitPrice: 30 }], 2300))
  pass((await read('distBalances', `route__${route}__${ids.a}`)).quantity === 150, 'precio y cantidad recalculan total y descuentan diferencia')
  const beforeSecondPrice = await read('distBalances', `route__${route}__${ids.a}`)
  await command(seller, 'editSale', correction(sale.id, [{ productId: ids.a, quantity: 50, actualUnitPrice: 45 }, { productId: ids.b, quantity: 10, actualUnitPrice: 30 }], 2550))
  pass((await read('distBalances', `route__${route}__${ids.a}`)).quantity === beforeSecondPrice.quantity, 'segunda corrección parte del snapshot efectivo sin duplicar stock')
  await command(seller, 'editSale', correction(sale.id, [{ productId: ids.b, quantity: 10, actualUnitPrice: 30 }], 300))
  pass((await read('distBalances', `route__${route}__${ids.a}`)).quantity === 200, 'eliminación devuelve todo lo efectivo a ruta')
  pass((await read('distLots', lotByCode.get('A1'))).quantities[`route__${route}`] === 30 && (await read('distLots', lotByCode.get('A2'))).quantities[`route__${route}`] === 170, 'devolución multi-lote vuelve a los lotes exactos')

  const centralSale = await command(admin, 'sale', { sourceLocation: 'centralWarehouse', lines: [{ productId: ids.central, quantity: 70, actualUnitPrice: 30 }], ...payment(2100) })
  await command(admin, 'editSale', correction(centralSale.id, [{ productId: ids.central, quantity: 20, actualUnitPrice: 30 }], 600))
  pass((await read('distBalances', `central__${ids.central}`)).quantity === 80, 'venta administrativa devuelve 50 al almacén central')

  const creditSale = await command(seller, 'sale', { sourceLocation: 'route', routeId: route, routeName: 'Ruta Hugo QA', dispatchId: dispatch.id, customerId: customer, lines: [{ productId: ids.credit, quantity: 10, actualUnitPrice: 30 }], ...payment(300, 'credit') })
  await command(seller, 'editSale', correction(creditSale.id, [{ productId: ids.credit, quantity: 10, actualUnitPrice: 40 }], 400, 'credit'))
  const debt = await read('distReceivables', creditSale.id)
  pass(debt.originalAmount === 400 && debt.balance === 400 && debt.status === 'OPEN' && debt.saleLines[0].actualUnitPrice === 40, 'precio a crédito actualiza cartera y líneas')
  await root.collection('distReceivables').doc(creditSale.id).update({ paidAmount: 350, balance: 50, status: 'PARTIAL' })
  await command(seller, 'editSale', correction(creditSale.id, [{ productId: ids.credit, quantity: 10, actualUnitPrice: 30 }], 300, 'credit'), 'rejected')
  pass((await read('distReceivables', creditSale.id)).originalAmount === 400, 'crédito parcial rechaza total menor que lo cobrado')

  await command(seller, 'editSale', correction(creditSale.id, [], 0, 'credit'), 'rejected')
  pass((await read('distBalances', `route__${route}__${ids.credit}`)).quantity === 90, 'venta de una sola línea a cero se rechaza sin alterar stock')
  const noOp = await command(seller, 'editSale', correction(creditSale.id, [{ productId: ids.credit, quantity: 10, actualUnitPrice: 40 }], 400, 'credit'), 'rejected')
  pass(/al menos un cambio/i.test(noOp.error), 'corrección sin cambios se rechaza con mensaje claro')

  const auditRows = await root.collection('distSaleCorrections').where('saleId', '==', sale.id).get()
  pass(auditRows.docs.some(row => row.data().original.lines[0].actualUnitPrice === 30 && row.data().corrected.lines[0].actualUnitPrice === 40), 'auditoría conserva precio anterior y nuevo')
  console.log(`${passed} comprobaciones de precio y stock aprobadas`)
} finally {
  await env.cleanup()
}
