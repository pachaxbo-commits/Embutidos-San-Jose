// Prueba focalizada de limpieza selectiva. Solo usa Firestore Emulator.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(new URL('../../functions/package.json', import.meta.url))
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085'
const { initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { GROUP_KEYS, RECOMMENDED_GROUPS, prepareCleanDelivery, executeCleanDelivery } = require('./maintenance.cjs')
const projectId = 'demo-pachax-selective-cleanup'
const app = initializeApp({ projectId }, `selective-${Date.now()}`)
const db = getFirestore(app)
const root = db.doc('restaurants/sanjose')
const actor = `support-${Date.now()}`
const now = Math.floor(Date.now() / 1000)
const request = data => ({ auth: { uid: actor, token: { auth_time: now } }, data })
let passed = 0
const pass = (condition, label) => { assert(condition, label); passed++; console.log(`PASS: ${label}`) }
const exists = async (collection, id) => (await root.collection(collection).doc(id).get()).exists
const set = (collection, id, data = {}) => root.collection(collection).doc(id).set({ id, restaurantId: 'sanjose', ...data })
const execute = preview => executeCleanDelivery(db, request({ requestId: preview.requestId, phrase: 'LIMPIAR EMBUTIDOS SAN JOSE', acknowledgement: true }))

try {
  await root.collection('members').doc(actor).set({ role: 'support', active: true, displayName: 'Soporte QA' })
  await set('distProducts', 'product-kept', { name: 'Producto conservado' })

  // A: preset recomendado conserva clientes e identidades.
  await set('distCustomers', 'juan', { name: 'Juan Pérez' })
  await set('distCustomerIdentities', 'ci-juan', { customerId: 'juan' })
  await set('distSales', 'sale-a', { customerId: 'juan' })
  await set('distReceivables', 'sale-a', { saleId: 'sale-a', customerId: 'juan' })
  await set('distCollections', 'collection-a', { customerId: 'juan', receivableId: 'sale-a' })
  await set('distExpenses', 'expense-a')
  const recommended = await prepareCleanDelivery(db, request({ selectedGroups: [...RECOMMENDED_GROUPS] }))
  pass(!recommended.selectedGroups.includes('customers'), 'A: preset recomendado no selecciona Clientes')
  await execute(recommended)
  pass(await exists('distCustomers', 'juan') && await exists('distCustomerIdentities', 'ci-juan'), 'A: cliente e identidad permanecen')
  pass(await exists('distProducts', 'product-kept'), 'A: catálogo siempre se conserva')

  // B: créditos/cobros desaparecen sin borrar cliente, venta ni QR de venta.
  await set('distSales', 'sale-b', { customerId: 'juan' })
  await set('distReceivables', 'sale-b', { saleId: 'sale-b', customerId: 'juan' })
  await set('distReceivableAdjustments', 'adjustment-b', { receivableId: 'sale-b', customerId: 'juan' })
  await set('distCollections', 'collection-b', { customerId: 'juan', allocations: [{ receivableId: 'sale-b', amount: 10 }] })
  await set('distCreditStatus', 'juan', { customerId: 'juan' })
  await set('distCreditOverrides', 'juan', { customerId: 'juan' })
  await set('distQrVerifications', 'collection_collection-b', { sourceType: 'collection', sourceId: 'collection-b' })
  await set('distQrVerifications', 'sale_sale-b', { sourceType: 'sale', sourceId: 'sale-b' })
  const creditsOnly = await prepareCleanDelivery(db, request({ selectedGroups: ['credits'] }))
  pass(creditsOnly.counts.distQrVerifications === 1, 'B: solo incluye el QR relacionado con el cobro')
  await execute(creditsOnly)
  pass(await exists('distCustomers', 'juan') && await exists('distSales', 'sale-b'), 'B: cliente y venta permanecen')
  const rebuiltStatus = (await root.collection('distCreditStatus').doc('juan').get()).data()
  pass(!await exists('distReceivables', 'sale-b') && !await exists('distReceivableAdjustments', 'adjustment-b') && !await exists('distCollections', 'collection-b') && rebuiltStatus?.oldestPendingAt === null, 'B: crédito/cobro y sus auditorías se eliminan; estado derivado queda limpio')
  pass(await exists('distQrVerifications', 'sale_sale-b') && !await exists('distQrVerifications', 'collection_collection-b'), 'B: QR de venta se conserva y QR de cobro se elimina')

  // C: Clientes resuelve dependencias reales, pero conserva venta sin cliente.
  await set('distClaims', 'claim-c', { customerId: 'juan', saleId: 'sale-b' })
  await set('distQrVerifications', 'claim_claim-c', { sourceType: 'claim', sourceId: 'claim-c' })
  await set('distSales', 'anonymous-sale', { customerId: '' })
  const customers = await prepareCleanDelivery(db, request({ selectedGroups: ['customers'] }))
  pass(['sales', 'credits', 'claims', 'qr'].every(key => customers.resolvedGroups.includes(key)), 'C: Clientes fuerza sus grupos dependientes')
  await execute(customers)
  pass(!await exists('distCustomers', 'juan') && !await exists('distSales', 'sale-b') && !await exists('distClaims', 'claim-c'), 'C: cliente y documentos relacionados se eliminan')
  pass(await exists('distSales', 'anonymous-sale'), 'C: venta no relacionada permanece')

  // D/E: el requestId congela IDs; documentos nuevos y alcance manipulado permanecen.
  await set('distExpenses', 'expense-preview')
  const frozen = await prepareCleanDelivery(db, request({ selectedGroups: ['expenses'] }))
  await set('distExpenses', 'expense-after-preview')
  await set('distSales', 'sale-protected', { customerId: '' })
  const frozenResult = await executeCleanDelivery(db, request({ requestId: frozen.requestId, selectedGroups: [...GROUP_KEYS], phrase: 'LIMPIAR EMBUTIDOS SAN JOSE', acknowledgement: true }))
  pass(frozenResult.deletedDocuments === frozen.totalDocuments && !await exists('distExpenses', 'expense-preview'), 'D: ejecución elimina exactamente el alcance aprobado')
  pass(await exists('distExpenses', 'expense-after-preview') && await exists('distSales', 'sale-protected'), 'E: cambios o alcance enviado después del preview no amplían el borrado')

  // F: frase incorrecta no inicia ni borra.
  const security = await prepareCleanDelivery(db, request({ selectedGroups: ['expenses'] }))
  await assert.rejects(() => executeCleanDelivery(db, request({ requestId: security.requestId, phrase: 'OTRA FRASE', acknowledgement: true })), /frase/i)
  pass(await exists('distExpenses', 'expense-after-preview'), 'F: frase incorrecta no elimina documentos')

  // G: fallo del respaldo sucede antes del primer borrado.
  const backupFailure = await prepareCleanDelivery(db, request({ selectedGroups: ['expenses'] }))
  await assert.rejects(() => executeCleanDelivery(db, request({ requestId: backupFailure.requestId, phrase: 'LIMPIAR EMBUTIDOS SAN JOSE', acknowledgement: true }), { afterBackup: async () => { throw new Error('Fallo de respaldo simulado') } }), /Fallo de respaldo simulado/)
  pass(await exists('distExpenses', 'expense-after-preview'), 'G: si falla el respaldo no se elimina ningún documento')
  pass((await root.collection('maintenanceResetRequests').doc(backupFailure.requestId).get()).data().status === 'failed', 'G: fallo queda auditado en la solicitud')

  console.log(`${passed} comprobaciones de limpieza selectiva aprobadas`)
} finally {
  await db.recursiveDelete(root)
}
