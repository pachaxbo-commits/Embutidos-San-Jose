// All writes are confined to Firebase Emulator. Never point this suite at production.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8085'
const [emulatorHost, emulatorPort] = process.env.FIRESTORE_EMULATOR_HOST.split(':')
const req = createRequire(new URL('../../functions/package.json', import.meta.url))
const { initializeApp } = req('firebase-admin/app')
const { getFirestore } = req('firebase-admin/firestore')
const { processCommand } = req('./operations.cjs')
const { listDistributorPurchaseSuppliers } = req('./supplier-catalog.cjs')
const projectId = 'demo-pachax-audit'
const env = await initializeTestEnvironment({ projectId, firestore: { host: emulatorHost, port: Number(emulatorPort), rules: fs.readFileSync('firebase/firestore.rules', 'utf8') } })
const adminApp = initializeApp({ projectId }, `distributor-meat-${Date.now()}`)
const db = getFirestore(adminApp)
const root = db.doc('restaurants/sanjose')
const prefix = `meat-route-${Date.now().toString(36)}`
const admin = `${prefix}-admin`, hugo = `${prefix}-hugo`, warehouse = `${prefix}-warehouse`, routeId = `${prefix}-route`
let checks = 0
const ok = (condition, message) => { assert(condition, message); checks++; console.log(`PASS ${message}`) }
async function command(actor, type, payload, expected = 'confirmed', id = `${prefix}-${type}-${Math.random().toString(36).slice(2)}`) {
  const ref = root.collection('distOperations').doc(id)
  await ref.set({ id, restaurantId: 'sanjose', createdBy: actor, createdAt: new Date().toISOString(), type, payload, status: 'queued' })
  await processCommand(db, ref)
  const result = (await ref.get()).data()
  assert.equal(result.status, expected, result.error || `${type} failed`)
  return { id, ...result }
}
async function queued(uid, type, payload) {
  const id = `${prefix}-rules-${Math.random().toString(36).slice(2)}`
  return setDoc(doc(env.authenticatedContext(uid).firestore(), 'restaurants', 'sanjose', 'distOperations', id), { id, restaurantId: 'sanjose', createdBy: uid, createdAt: new Date().toISOString(), type, payload, status: 'queued' })
}

try {
  await root.collection('members').doc(admin).set({ role: 'admin', active: true, displayName: 'Administración QA' })
  await root.collection('members').doc(hugo).set({ role: 'distributor', active: true, routeId, displayName: 'Hugo QA' })
  await root.collection('members').doc(warehouse).set({ role: 'warehouse', active: true, warehouseId: 'central' })
  await root.collection('distRoutes').doc(routeId).set({ id: routeId, name: 'Ruta Hugo QA', active: true })
  const supplierId = `${prefix}-supplier`
  const inactiveSupplierId = `${prefix}-inactive`
  await command(admin, 'saveExpenseSupplier', { supplierId, name: 'Proveedor Carnes QA', legalName: 'Datos fiscales privados QA', nit: '00112233', address: 'Dirección privada', active: true })
  await command(admin, 'saveExpenseSupplier', { supplierId: inactiveSupplierId, name: 'Proveedor Inactivo QA', active: false })

  const options = await listDistributorPurchaseSuppliers(db, hugo)
  ok(options.length === 1 && options[0].id === supplierId && options[0].name === 'Proveedor Carnes QA' && !('nit' in options[0]) && !('address' in options[0]), 'el catálogo callable solo entrega nombre e ID de proveedores activos')
  await assert.rejects(() => listDistributorPurchaseSuppliers(db, warehouse), error => error.code === 'permission-denied'); checks++
  const distributorDb = env.authenticatedContext(hugo).firestore()
  await assertFails(getDoc(doc(distributorDb, 'restaurants', 'sanjose', 'distSuppliers', supplierId))); checks++
  await assertSucceeds(queued(hugo, 'registerSupplierPurchase', { sample: true })); checks++
  await assertFails(queued(warehouse, 'registerSupplierPurchase', { sample: true })); checks++
  ok(true, 'Rules permiten únicamente encolar la compra al distribuidor; bloquean lectura directa del catálogo y a Almacén')

  const purchase = (method, id, receipt = '') => ({ supplierId, description: 'Compra de carne', amount: 700, initialPayment: method === 'credit' ? 0 : 700, paymentMethod: method, dayKey: '2026-10-30', ...(receipt ? { purchaseReceiptType: 'receipt', purchaseReceiptNumber: receipt } : {}), purchaseLines: [{ description: 'Carne', quantity: 20, unit: 'kg', unitPrice: 35, total: 700, wasteQuantity: 0, netUsableQuantity: 20 }] })
  const cash = await command(hugo, 'registerSupplierPurchase', purchase('cash', 'cash', 'R-001'), 'confirmed', `${prefix}-cash`)
  const cashExpense = (await root.collection('distExpenses').doc(cash.id).get()).data()
  const cashPayable = (await root.collection('distPayables').doc(cash.id).get()).data()
  ok(cashExpense.amount === 700 && cashExpense.cashPaidAmount === 700 && cashExpense.transferPaidAmount === 0 && cashExpense.routeId === routeId && cashExpense.registeredByUid === hugo && cashExpense.purchaseLines[0].quantity === 20 && cashExpense.purchaseReceiptNumber === 'R-001' && cashPayable.balance === 0, '20 kg × Bs 35 registra Bs 700 una vez, en efectivo de Hugo, con ruta y recibo')
  await assertFails(updateDoc(doc(distributorDb, 'restaurants', 'sanjose', 'distExpenses', cash.id), { amount: 1 })); checks++
  const adminExpense = await getDoc(doc(env.authenticatedContext(admin).firestore(), 'restaurants', 'sanjose', 'distExpenses', cash.id))
  ok(adminExpense.exists() && adminExpense.data().supplierId === supplierId, 'Administración puede consultar el egreso y el proveedor de Hugo; Hugo no puede editar el registro')
  await processCommand(db, root.collection('distOperations').doc(cash.id))
  ok((await root.collection('distExpenses').where('operationId', '==', cash.id).get()).size === 1 && (await root.collection('distPayables').doc(cash.id).get()).data().balance === 0, 'reintentar la operación confirmada no duplica egreso ni cuenta por pagar')

  const transfer = await command(hugo, 'registerSupplierPurchase', purchase('transfer', 'transfer'), 'confirmed', `${prefix}-transfer`)
  const transferExpense = (await root.collection('distExpenses').doc(transfer.id).get()).data()
  ok(transferExpense.transferPaidAmount === 700 && transferExpense.cashPaidAmount === 0 && transferExpense.routeId === routeId, 'compra QR registra salida por transferencia y cero efectivo físico')

  const credit = await command(hugo, 'registerSupplierPurchase', purchase('credit', 'credit'), 'confirmed', `${prefix}-credit`)
  const creditExpense = (await root.collection('distExpenses').doc(credit.id).get()).data()
  const creditPayable = (await root.collection('distPayables').doc(credit.id).get()).data()
  ok(creditExpense.amount === 700 && creditExpense.cashPaidAmount === 0 && creditExpense.transferPaidAmount === 0 && creditPayable.totalAmount === 700 && creditPayable.paidAmount === 0 && creditPayable.balance === 700 && creditPayable.status === 'pending', 'compra a crédito crea deuda Bs 700 y no descuenta caja ni transferencia')
  await command(admin, 'paySupplierPayable', { payableId: credit.id, amount: 200, paymentMethod: 'cash', dayKey: '2026-10-30' }, 'confirmed', `${prefix}-credit-partial`)
  const afterPayment = (await root.collection('distPayables').doc(credit.id).get()).data()
  const paymentExpense = (await root.collection('distExpenses').doc(`${prefix}-credit-partial__payment`).get()).data()
  ok(afterPayment.paidAmount === 200 && afterPayment.balance === 500 && paymentExpense.transactionKind === 'supplier_payment' && paymentExpense.amount === 200 && paymentExpense.affectsOperatingResult === false, 'abono posterior reduce deuda y registra salida sin duplicar la compra/costo')
  const visibleForAdmin = await getDoc(doc(env.authenticatedContext(admin).firestore(), 'restaurants', 'sanjose', 'distPayables', credit.id))
  ok(visibleForAdmin.exists() && visibleForAdmin.data().balance === 500, 'Administración puede consultar el saldo de la compra del distribuidor')

  await command(hugo, 'registerSupplierPurchase', { ...purchase('cash'), amount: 701 }, 'rejected', `${prefix}-tampered`)
  await command(hugo, 'registerSupplierPurchase', { ...purchase('cash'), supplierId: inactiveSupplierId }, 'rejected', `${prefix}-inactive`)
  await command(hugo, 'registerSupplierPurchase', { ...purchase('cash'), routeId: 'another-route' }, 'rejected', `${prefix}-route-injection`)
  await command(warehouse, 'registerSupplierPurchase', purchase('cash'), 'rejected', `${prefix}-warehouse-backend`)
  ok(true, 'servidor rechaza total manipulado, proveedor inactivo, ruta enviada por cliente y rol Almacén')

  const routePurchases = await root.collection('distExpenses').where('routeId', '==', routeId).get()
  const stockMovements = await root.collection('distStockMovements').get()
  const lots = await root.collection('distLots').get()
  ok(routePurchases.size === 3 && stockMovements.empty && lots.empty, 'hay un egreso por cada compra de ruta y registrar compra no crea lotes ni movimientos de inventario')
  console.log(`PASS ${checks} comprobaciones totales de compras de distribuidor`)
} finally {
  await env.clearFirestore()
  await env.cleanup()
  await adminApp.delete()
}
