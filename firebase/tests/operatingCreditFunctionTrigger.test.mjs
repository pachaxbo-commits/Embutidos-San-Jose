// End-to-end Functions Emulator smoke test for operating credit and its later payment.
// All data is synthetic and is written only to Firebase Emulator.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085').split(':')
process.env.FIRESTORE_EMULATOR_HOST ||= `${host}:${port}`
const require = createRequire(new URL('../../functions/package.json', import.meta.url))
const { initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const projectId = process.env.GCLOUD_PROJECT || 'demo-pachax-audit'
assert.match(projectId, /^demo-/, 'This test must run against a demo Firebase project.')

const app = initializeApp({ projectId }, `operating-credit-trigger-${Date.now()}`)
const db = getFirestore(app)
const root = db.doc('restaurants/sanjose')
const prefix = `operating-credit-trigger-${Date.now().toString(36)}`
const adminId = `${prefix}-admin`
const supplierId = `${prefix}-supplier`
const expenseId = `${prefix}-expense`
const paymentId = `${prefix}-payment`
const operationRefs = []

async function enqueueAndWait(type, payload, id) {
  const ref = root.collection('distOperations').doc(id)
  operationRefs.push(ref)
  await ref.create({ id, restaurantId: 'sanjose', createdBy: adminId, createdAt: new Date().toISOString(), type, payload, status: 'queued' })
  for (let attempt = 0; attempt < 100; attempt++) {
    const operation = (await ref.get()).data()
    if (operation.status === 'confirmed') return operation
    if (operation.status === 'rejected') throw new Error(`${type} was rejected: ${operation.error}`)
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`${type} was not confirmed by processSanJoseOperation.`)
}

try {
  await root.collection('members').doc(adminId).set({ role: 'admin', active: true, displayName: 'Synthetic Admin' })
  await root.collection('distSuppliers').doc(supplierId).set({ id: supplierId, name: `${prefix} supplier`, active: true, createdBy: adminId })

  await enqueueAndWait('expense', {
    presetId: 'admin-category:administration-4', amount: 100, paymentMethod: 'credit', supplierId,
    dayKey: '2026-10-30', routeId: 'administracion', routeName: 'Administración', note: 'Functions trigger smoke',
  }, expenseId)

  let expense = (await root.collection('distExpenses').doc(expenseId).get()).data()
  let payable = (await root.collection('distPayables').doc(expenseId).get()).data()
  assert.equal(expense?.amount, 100)
  assert.equal(expense?.cashPaidAmount, 0)
  assert.equal(expense?.transferPaidAmount, 0)
  assert.equal(payable?.sourceKind, 'operating_expense')
  assert.equal(payable?.balance, 100)

  await enqueueAndWait('paySupplierPayable', {
    payableId: expenseId, amount: 40, paymentMethod: 'cash', dayKey: '2026-10-30', note: 'Synthetic partial payment',
  }, paymentId)

  payable = (await root.collection('distPayables').doc(expenseId).get()).data()
  const payments = await root.collection('distSupplierPayments').where('payableId', '==', expenseId).get()
  expense = (await root.collection('distExpenses').doc(expenseId).get()).data()
  assert.equal(payable?.balance, 60)
  assert.equal(payments.size, 1)
  assert.equal(payments.docs[0].data().amount, 40)
  assert.equal(expense?.amount, 100)
  console.log('PASS processSanJoseOperation: operating expense Bs 100 on credit; partial cash payment Bs 40; balance Bs 60; one payment; no duplicate expense')
} finally {
  await Promise.all(operationRefs.map(ref => ref.delete().catch(() => {})))
  await Promise.all([
    root.collection('distExpenses').doc(expenseId).delete().catch(() => {}),
    root.collection('distPayables').doc(expenseId).delete().catch(() => {}),
    root.collection('distSuppliers').doc(supplierId).delete().catch(() => {}),
    root.collection('members').doc(adminId).delete().catch(() => {}),
  ])
  await app.delete()
}
