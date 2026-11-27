// Ciclo completo confinado a Firebase Emulator. No usa credenciales ni datos de producción.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085'
const requireFunctions = createRequire(new URL('../../functions/package.json', import.meta.url))
const { initializeApp } = requireFunctions('firebase-admin/app')
const { getFirestore } = requireFunctions('firebase-admin/firestore')
const { processCommand, dayKey } = requireFunctions('./operations.cjs')
const app = initializeApp({ projectId: 'demo-pachax-audit' }, `closure-lifecycle-${Date.now()}`)
const db = getFirestore(app)
const rootDoc = db.doc('restaurants/sanjose')
const prefix = `lifecycle-${Date.now().toString(36)}`
const adminUid = `${prefix}-admin`, warehouseUid = `${prefix}-warehouse`, sellerUid = `${prefix}-seller`
const routeId = `${prefix}-route`, productId = `${prefix}-product`
const now = () => new Date().toISOString()
const read = async (collection, id) => (await rootDoc.collection(collection).doc(id).get()).data()
async function command(actor, type, payload, expected = 'confirmed') {
  const id = `${prefix}-${type}-${Math.random().toString(36).slice(2)}`
  const ref = rootDoc.collection('distOperations').doc(id)
  await ref.set({ id, restaurantId: 'sanjose', createdBy: actor, createdAt: now(), type, payload, status: 'queued' })
  await processCommand(db, ref)
  const result = (await ref.get()).data()
  assert.equal(result.status, expected, `${type}: ${result.error || 'sin respuesta'}`)
  return { ...result, id }
}

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' })
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
const { ClosureView } = await vite.ssrLoadModule('/src/modules/distribution/views/ClosureView.tsx')
const { normalizeClosure } = await vite.ssrLoadModule('/src/modules/distribution/domain/closurePeriod.ts')
const { ErrorBoundary } = await vite.ssrLoadModule('/src/components/ErrorBoundary.tsx')
const container = document.getElementById('app')
const reactRoot = createRoot(container)
const errors = []
const originalError = console.error
console.error = (...args) => { errors.push(args.map(String).join(' ')) }
const emptyData = {
  openDispatches: [], closures: [], claims: [], sales: [], collections: [], expenses: [],
  balances: [], lots: [], routes: [], products: [], warehouses: [], transfers: [], operations: [],
  receivables: [], customers: [], movements: [], qrVerifications: [], creditStatus: [],
  supportSettings: { requireQrVerification: false },
}
const session = role => ({ restaurantId: 'sanjose', restaurantName: 'Embutidos San José',
  uid: role === 'distributor' ? sellerUid : role === 'warehouse' ? warehouseUid : adminUid,
  userName: role, role, warehouseId: 'central', routeId: role === 'distributor' ? routeId : null,
  dayKeys: [dayKey(new Date())], setDayKeys: () => {}, can: () => true })
async function render(role, dispatchIds, closureId) {
  const dispatches = (await Promise.all(dispatchIds.map(id => read('distDispatches', id)))).filter(item => item?.status === 'open')
  const closure = closureId ? await read('distClosures', closureId) : null
  await act(async () => reactRoot.render(React.createElement(ErrorBoundary, null,
    React.createElement(ClosureView, { session: session(role), data: {
      ...emptyData, openDispatches: dispatches, closures: closure ? [normalizeClosure(closure)] : [],
    } }))))
  assert.doesNotMatch(container.textContent, /Se produjo un error al mostrar esta sección/)
  const renderErrors = errors.filter(message => !message.includes('MetadataLookupWarning'))
  assert.equal(renderErrors.length, 0, `error en render ${role}: ${renderErrors.at(-1) || ''}`)
  return container.textContent
}
async function click(label) {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent.trim() === label)
  assert.ok(button, `falta botón ${label}`)
  await act(async () => button.click())
}

try {
  await rootDoc.collection('members').doc(adminUid).set({ role: 'admin', active: true, displayName: 'Admin QA' })
  await rootDoc.collection('members').doc(warehouseUid).set({ role: 'warehouse', active: true, warehouseId: 'central', displayName: 'Almacén QA' })
  await rootDoc.collection('members').doc(sellerUid).set({ role: 'distributor', active: true, routeId, displayName: 'Hugo QA' })
  await rootDoc.collection('distProducts').doc(productId).set({ id: productId, restaurantId: 'sanjose', name: 'Viena QA', unitType: 'kg', active: true, referencePrice: 40, productionCost: 10 })
  const intake = await command(adminUid, 'intake', { lines: [{ productId, quantity: 10, lotCode: 'LOTE-QA', manufacturedOn: dayKey(new Date()), expiresOn: '2027-12-31', productionCost: 10 }], note: 'Ciclo de cierre QA' })
  const customerId = prefix + '-pre-dispatch-customer'
  await rootDoc.collection('distReceivables').doc(prefix + '-pre-dispatch-debt').set({
    customerId, customerName: 'Cliente QA', routeId, sourceType: 'opening_balance', originalAmount: 270,
    balance: 270, paidAmount: 0, status: 'OPEN', createdAt: now(),
  })
  const earlyReceipt = await command(sellerUid, 'collection', { customerId, amount: 252, method: 'cash', cashAmount: 252, qrAmount: 0 })
  assert.equal((await read('distCollections', earlyReceipt.id)).dispatchId, undefined)
  const dispatched = await command(warehouseUid, 'dispatch', { warehouseId: 'central', routeId, routeName: 'Zona Norte QA', distributorUid: sellerUid, distributorName: 'Hugo QA', lines: [{ productId, quantity: 6, allocationsRequested: [{ lotId: `${intake.id}__0`, quantity: 6 }] }] })
  const dispatchId = dispatched.id, closureId = `closure_${dispatchId}`
  const activeReceipt = await command(sellerUid, 'collection', { customerId, amount: 18, method: 'qr', cashAmount: 0, qrAmount: 18 })
  assert.equal((await read('distCollections', activeReceipt.id)).dispatchId, dispatchId)
  const receiptBefore = await read('distCollections', activeReceipt.id)
  const correction = { collectionId: activeReceipt.id, revision: receiptBefore.createdAt, cash: 18, reason: 'Medio de cobro confirmado' }
  await command(sellerUid, 'rectifyCollectionPayment', correction, 'rejected')
  const correctedReceipt = await command(adminUid, 'rectifyCollectionPayment', correction)
  const cashReceipt = await read('distCollections', activeReceipt.id)
  assert.equal(cashReceipt.method, 'cash')
  assert.equal(cashReceipt.amount, receiptBefore.amount)
  assert.deepEqual(cashReceipt.allocations, receiptBefore.allocations)
  await processCommand(db, rootDoc.collection('distOperations').doc(correctedReceipt.id))
  await command(adminUid, 'rectifyCollectionPayment', { ...correction, cash: 0 }, 'rejected')
  const paymentAudit = await read('distCollectionCustodyRectifications', correctedReceipt.id)
  assert.deepEqual(paymentAudit.after, { method: 'cash', cashAmount: 18, qrAmount: 0 })
  await command(adminUid, 'rectifyCollectionPayment', { ...correction, revision: cashReceipt.paymentCorrectedAt, cash: 8 })
  const mixed = await read('distCollections', activeReceipt.id)
  assert.equal(mixed.method, 'mixed')
  await command(adminUid, 'rectifyCollectionPayment', { ...correction, revision: mixed.paymentCorrectedAt, cash: 0 })
  const supplierId = `${prefix}-supplier`
  await rootDoc.collection('distSuppliers').doc(supplierId).set({ name: 'Frial QA', active: true })
  const today = dayKey(new Date())
  const purchase = await command(sellerUid, 'registerSupplierPurchase', {
    supplierId, description: 'Carne', amount: 504, initialPayment: 0, paymentMethod: 'credit',
    dayKey: today, purchaseLines: [{ description: 'Carne', quantity: 14, unit: 'kg', unitPrice: 36, total: 504, wasteQuantity: 0, netUsableQuantity: 14 }],
  })
  const payableId = purchase.id
  const payment = { payableId, amount: 504, paymentMethod: 'cash', dayKey: today, dispatchId }
  await command(sellerUid, 'paySupplierPayable', { ...payment, amount: 505 }, 'rejected')
  await command(sellerUid, 'paySupplierPayable', payment, 'rejected')
  await rootDoc.collection('members').doc(`${sellerUid}-other`).set({ role: 'distributor', active: true, routeId })
  await command(`${sellerUid}-other`, 'paySupplierPayable', { ...payment, amount: 50 }, 'rejected')
  const adminPayment = await command(adminUid, 'paySupplierPayable', { ...payment, dispatchId: '', amount: 304 })
  assert.equal((await read('distExpenses', `${adminPayment.id}__payment`)).routeId, 'administracion')
  assert.equal((await read('distPayables', payableId)).balance, 200)
  const driverPayment = await command(sellerUid, 'paySupplierPayable', { ...payment, amount: 100 })
  const driverRef = rootDoc.collection('distOperations').doc(driverPayment.id)
  await processCommand(db, driverRef)
  assert.equal((await read('distPayables', payableId)).balance, 100)
  const remainingPayments = await Promise.allSettled([
    command(adminUid, 'paySupplierPayable', { ...payment, amount: 100 }),
    command(adminUid, 'paySupplierPayable', { ...payment, amount: 100 }),
  ])
  assert.equal(remainingPayments.filter(x => x.status === 'fulfilled').length, 1)
  assert.equal((await read('distPayables', payableId)).balance, 0)
  const paid = await rootDoc.collection('distSupplierPayments').where('payableId', '==', payableId).get()
  assert.equal(paid.size, 3)
  assert.equal(paid.docs.filter(doc => doc.data().dispatchId === dispatchId).length, 2)

  await render('distributor', [dispatchId], null)

  // La declaración real escribe un documento parcial y NO mueve inventario.
  const stockBefore = (await read('distBalances', `central__${productId}`)).quantity
  await rootDoc.collection('distClosures').doc(closureId).set({ id: closureId, restaurantId: 'sanjose', dispatchId, routeId,
    distributorUid: sellerUid, distributorName: 'Hugo QA', declaredReturns: { [productId]: 5.92 }, declaredReturnMermas: { [productId]: 0.08 },
    returnDeclaredBy: sellerUid, returnDeclaredAt: now(), dayKey: dayKey(new Date()), physicalCashDeclared: 0 }, { merge: true })
  const draft = await read('distClosures', closureId)
  assert.equal(draft.status, undefined)
  assert.equal(normalizeClosure(draft).status, 'draft')
  assert.equal((await read('distDispatches', dispatchId)).status, 'open')
  assert.equal((await read('distBalances', `central__${productId}`)).quantity, stockBefore)
  await render('distributor', [dispatchId], closureId)
  await render('warehouse', [dispatchId], closureId)
  await click('Registrar recepción')
  const normal = container.querySelector('input[placeholder="Cantidad recibida"]')
  const merma = container.querySelector('input[placeholder="0"]')
  assert.equal(normal.value, '5.92')
  assert.equal(merma.value, '0.08')
  await click('Usar cantidad declarada')
  assert.equal(normal.value, '5.92')
  assert.equal(merma.value, '0.08')
  await click('Guardar recepción')
  assert.match(container.textContent, /1 de 1 productos revisados/)
  await render('admin', [dispatchId], closureId)

  await command(warehouseUid, 'closure', { mode: 'warehouse', closure: { dispatchId, products: [{ productId, actualReturn: 5.92, returnMerma: 0.08, returnWaste: 0, physicalReturn: 6 }] } })
  const received = await read('distClosures', closureId)
  assert.equal(received.status, 'warehouse_done')
  assert.ok(received.warehouseClosedBy && received.warehouseClosedAt)
  assert.equal((await read('distDispatches', dispatchId)).status, 'open')
  assert.equal((await read('distBalances', `central__${productId}`)).quantity, stockBefore + 6)
  await render('warehouse', [dispatchId], closureId)
  await render('admin', [dispatchId], closureId)
  assert.match(container.textContent, /Devolución confirmada por almacén/)
  await command(warehouseUid, 'closure', { mode: 'warehouse', closure: { dispatchId, products: [{ productId, actualReturn: 5.92, returnMerma: 0.08, returnWaste: 0, physicalReturn: 6 }] } }, 'rejected')
  assert.equal((await read('distBalances', `central__${productId}`)).quantity, stockBefore + 6)

  await command(adminUid, 'closure', { mode: 'money', closure: { dispatchId, status: 'closed', physicalCashDeclared: 0 } })
  assert.equal((await read('distClosures', closureId)).status, 'closed')
  assert.equal((await read('distClosures', closureId)).cashCollections, 252)
  assert.equal((await read('distClosures', closureId)).qrCollections, 18)
  assert.equal((await read('distClosures', closureId)).cashExpenses, 200)
  assert.equal((await read('distClosures', closureId)).expectedCash, 52)
  const unpaid = await command(sellerUid, 'registerSupplierPurchase', {
    supplierId, description: 'Carne', amount: 36, initialPayment: 0, paymentMethod: 'credit',
    dayKey: today, purchaseLines: [{ description: 'Carne', quantity: 1, unit: 'kg', unitPrice: 36, total: 36, wasteQuantity: 0, netUsableQuantity: 1 }],
  })
  const closedAttempt = await command(sellerUid, 'paySupplierPayable', { ...payment, payableId: unpaid.id, amount: 1 }, 'rejected')
  assert.match(closedAttempt.error, /caja activa/)
  assert.equal((await read('distPayables', unpaid.id)).balance, 36)
  assert.equal((await read('distDispatches', dispatchId)).status, 'closed')
  const finalReceipt = await read('distCollections', activeReceipt.id)
  await command(adminUid, 'rectifyCollectionPayment', { ...correction, revision: finalReceipt.paymentCorrectedAt, cash: 18 }, 'rejected')
  const historicalClosure = await read('distClosures', closureId)
  const historicalExpense = await read('distExpenses', payableId)
  const historicalPayable = await read('distPayables', payableId)
  const revision = historicalPayable.updatedAt || historicalPayable.createdAt
  const wastePayload = { payableId, revision, index: 0, waste: 2.2, reason: 'Nervio separado' }
  await command(adminUid, 'rectifySupplierPurchase', { payableId, expectedRevision: revision, reason: 'Cambio financiero de prueba', amount: 500 }, 'rejected')
  await command(sellerUid, 'rectifyPurchaseWaste', wastePayload, 'rejected')
  await command(adminUid, 'rectifyPurchaseWaste', { ...wastePayload, waste: -1 }, 'rejected')
  await command(adminUid, 'rectifyPurchaseWaste', { ...wastePayload, waste: 15 }, 'rejected')
  await command(adminUid, 'rectifyPurchaseWaste', { ...wastePayload, amount: 500 }, 'rejected')
  const corrected = await command(adminUid, 'rectifyPurchaseWaste', wastePayload)
  const correctionRef = rootDoc.collection('distOperations').doc(corrected.id)
  await processCommand(db, correctionRef)
  const saved = await read('distPayables', payableId)
  assert.equal(saved.paidAmount, 504)
  assert.equal(saved.purchaseLines[0].netUsableQuantity, 11.8)
  assert.deepEqual(await read('distClosures', closureId), historicalClosure)
  const revisedExpense = await read('distExpenses', payableId)
  assert.equal(revisedExpense.amount, historicalExpense.amount)
  assert.equal(revisedExpense.cashPaidAmount, historicalExpense.cashPaidAmount)
  const audit = await read('distPurchaseCorrections', corrected.id)
  assert.equal(audit.before.wasteQuantity, 0)
  assert.equal(audit.after.wasteQuantity, 2.2)
  assert.equal(audit.stockImpact, 0)
  await command(adminUid, 'rectifyPurchaseWaste', wastePayload, 'rejected')
  const update = { ...wastePayload, revision: saved.updatedAt, waste: 1.4 }
  await command(adminUid, 'rectifyPurchaseWaste', update)
  const current = await read('distPayables', payableId)
  assert.equal(current.purchaseLines[0].netUsableQuantity, 12.6)
  const { purchaseWasteRows, purchaseWasteTotals } = await vite.ssrLoadModule('/src/modules/distribution/views/PurchaseWasteReport.tsx')
  const expenseAfter = await read('distExpenses', payableId)
  const wasteRows = purchaseWasteRows([expenseAfter,
    { ...expenseAfter, voided: true }, { ...expenseAfter, transactionKind: 'supplier_payment' }])
  assert.equal(wasteRows.length, 1)
  assert.deepEqual(purchaseWasteTotals(wasteRows), [14, 1.4, 12.6, 10, 50.4, 40])
  const blocked = { ...update, revision: current.updatedAt, waste: 1 }
  const lotRef = rootDoc.collection('distLots').doc(`${prefix}-linked`)
  await lotRef.set({ sourceExpenseId: payableId })
  assert.match((await command(adminUid, 'rectifyPurchaseWaste', blocked, 'rejected')).error, /existencias o producción/)
  await lotRef.delete()
  const batchRef = rootDoc.collection('distProcessingBatches').doc(`${prefix}-consumed`)
  await batchRef.set({ costComponents: [{ expenseId: payableId }] })
  assert.match((await command(adminUid, 'rectifyPurchaseWaste', blocked, 'rejected')).error, /existencias o producción/)
  await batchRef.delete()
  assert.equal((await read('distPayables', payableId)).purchaseLines[0].wasteQuantity, 1.4)
  console.log('PASS merma posterior y corregida con caja cerrada, auditoría, vínculos y consolidado')
  await render('admin', [dispatchId], closureId)
  await command(adminUid, 'closure', { mode: 'money', closure: { dispatchId, status: 'closed', physicalCashDeclared: 0 } }, 'rejected')
  assert.equal((await read('distBalances', `central__${productId}`)).quantity, stockBefore + 6)
  const second = await command(adminUid, 'dispatch', { warehouseId: 'central', routeId, routeName: 'Otra jornada QA',
    distributorUid: sellerUid, distributorName: 'Hugo QA', lines: [{ productId, quantity: 2, allocationsRequested: [{ lotId: `${intake.id}__0`, quantity: 2 }] }] })
  assert.match(await render('admin', [dispatchId, second.id], closureId), /Otra jornada QA/)
  await command(adminUid, 'closure', { mode: 'warehouse', closure: { dispatchId: second.id,
    products: [{ productId, actualReturn: 2, returnMerma: 0, returnWaste: 0, physicalReturn: 2 }] } })
  assert.ok((await read('distClosures', `closure_${second.id}`)).warehouseClosedBy === adminUid)
  assert.equal((await read('distDispatches', second.id)).status, 'open')
  await render('admin', [second.id], `closure_${second.id}`)
  console.log('PASS ciclo Firestore + React: distributor → draft → warehouse → warehouse_done → admin → closed → dispatch null, sin doble stock/cierre')
} finally {
  console.error = originalError
  await act(async () => reactRoot.unmount())
  await vite.close()
  dom.window.close()
  await app.delete()
}
