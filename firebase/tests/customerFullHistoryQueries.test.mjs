import fs from 'node:fs'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { collection, doc, documentId, getDocs, limit, orderBy, query, setDoc, startAfter, where } from 'firebase/firestore'

const restaurantId = 'sanjose'
const page = async (db, collectionName, field, value, pageSize = 2) => {
  const rows = []
  let cursor
  while (true) {
    const constraints = [where(field, Array.isArray(value) ? 'in' : '==', value), orderBy(documentId(), 'asc')]
    if (cursor) constraints.push(startAfter(cursor))
    constraints.push(limit(pageSize))
    const snapshot = await getDocs(query(collection(db, `restaurants/${restaurantId}/${collectionName}`), ...constraints))
    rows.push(...snapshot.docs.map(row => ({ id: row.id, ...row.data() })))
    if (snapshot.docs.length < pageSize) return rows
    cursor = snapshot.docs.at(-1)
  }
}

const env = await initializeTestEnvironment({
  projectId: 'demo-pachax-audit',
  firestore: { host: '127.0.0.1', port: 8085, rules: fs.readFileSync('firebase/firestore.rules', 'utf8') },
})
try {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await setDoc(doc(db, `restaurants/${restaurantId}`), { ownerUid: 'admin' })
    await setDoc(doc(db, `restaurants/${restaurantId}/members/admin`), { uid: 'admin', role: 'admin', active: true })
    await setDoc(doc(db, `restaurants/${restaurantId}/members/seller`), { uid: 'seller', role: 'distributor', routeId: 'route-a', active: true })
    for (const id of ['s1', 's2', 's3']) await setDoc(doc(db, `restaurants/${restaurantId}/distSales/${id}`), { id, customerId: 'customer-a', sellerUid: 'seller', customerName: 'Ana', total: 10 })
    await setDoc(doc(db, `restaurants/${restaurantId}/distSales/legacy-name`), { id: 'legacy-name', sellerUid: 'seller', customerName: 'Ana Antigua', total: 7 })
    await setDoc(doc(db, `restaurants/${restaurantId}/distSales/s4`), { id: 's4', customerId: 'customer-b', sellerUid: 'seller', customerName: 'Beto', total: 99 })
    for (const id of ['r1', 'r2', 'r3']) await setDoc(doc(db, `restaurants/${restaurantId}/distReceivables/${id}`), { id, customerId: 'customer-a', routeId: 'route-a', balance: 1 })
    for (const id of ['p1', 'p2', 'p3']) await setDoc(doc(db, `restaurants/${restaurantId}/distCollections/${id}`), { id, customerId: 'customer-a', collectedByUid: 'seller', amount: 1 })
    await setDoc(doc(db, `restaurants/${restaurantId}/distReceivableAdjustments/a1`), { id: 'a1', customerId: 'customer-a' })
    await setDoc(doc(db, `restaurants/${restaurantId}/distSaleCorrections/c1`), { id: 'c1', saleId: 's1', sellerUid: 'seller' })
    await setDoc(doc(db, `restaurants/${restaurantId}/distSaleCorrections/c2`), { id: 'c2', saleId: 's3', sellerUid: 'seller' })
  })

  const admin = env.authenticatedContext('admin').firestore()
  const seller = env.authenticatedContext('seller').firestore()
  const sales = await assertSucceeds(page(admin, 'distSales', 'customerId', 'customer-a'))
  if (sales.length !== 3 || sales.some(row => row.customerId !== 'customer-a')) throw new Error('La paginación debe recuperar solamente las ventas del cliente elegido.')
  const debts = await assertSucceeds(page(admin, 'distReceivables', 'customerId', 'customer-a'))
  const payments = await assertSucceeds(page(admin, 'distCollections', 'customerId', 'customer-a'))
  const adjustments = await assertSucceeds(page(admin, 'distReceivableAdjustments', 'customerId', 'customer-a'))
  const corrections = await assertSucceeds(page(admin, 'distSaleCorrections', 'saleId', ['s1', 's2', 's3']))
  const legacyNames = await assertSucceeds(page(admin, 'distSales', 'customerName', ['Ana', 'Ana Antigua']))
  if (debts.length !== 3 || payments.length !== 3 || adjustments.length !== 1 || corrections.length !== 2 || !legacyNames.some(row => row.id === 'legacy-name' && !row.customerId)) throw new Error('Faltaron documentos históricos paginados, correcciones vinculadas o candidatas de nombre legacy.')
  await assertFails(page(seller, 'distSales', 'customerId', 'customer-a'))
  await assertFails(page(seller, 'distCollections', 'customerId', 'customer-a'))
  console.log('PASS customer-history emulator: paginación por cliente, correcciones vinculadas y permisos administrativos')
} finally {
  await env.cleanup()
}
