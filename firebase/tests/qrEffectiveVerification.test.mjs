// End-to-end regression for correcting a cash sale to QR and verifying the
// current economic revision through the Firestore client SDK + Security Rules.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing'
import { collection, doc, getDocs, setDoc } from 'firebase/firestore'
import { recordQrVerification } from '../../src/modules/distribution/data/qrVerification.ts'
import { hasCurrentSaleQrVerification, saleQrPaymentState } from '../../src/modules/distribution/domain/qrPayment.ts'

const projectId = 'demo-pachax-audit'
const host = '127.0.0.1'
const port = 8085
process.env.FIRESTORE_EMULATOR_HOST = `${host}:${port}`
const require = createRequire(new URL('../../functions/package.json', import.meta.url))
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { processCommand, dayKey } = require('./operations.cjs')
const adminApp = initializeApp({ projectId }, `qa-qr-effective-${Date.now()}`)
const adminDb = getFirestore(adminApp)
const root = adminDb.doc('restaurants/sanjose')
const rules = fs.readFileSync('firebase/firestore.rules', 'utf8')
const env = await initializeTestEnvironment({ projectId, firestore: { host, port, rules } })
const prefix = `qr${Date.now().toString(36)}`
const admin = `${prefix}-admin`
const admin2 = `${prefix}-admin2`
const warehouse = `${prefix}-warehouse`
const distributor = `${prefix}-distributor`
const route = `${prefix}-route`
const product = `${prefix}-product`
const adminDbClient = env.authenticatedContext(admin).firestore()
const admin2DbClient = env.authenticatedContext(admin2).firestore()
const read = async (collectionName, id) => (await root.collection(collectionName).doc(id).get()).data()
let checks = 0
const pass = label => { checks++; console.log(`PASS: ${label}`) }

async function command(actor, type, payload, suffix = type, expected = 'confirmed') {
  const id = `${prefix}-${suffix}-${Math.random().toString(36).slice(2)}`
  const reference = root.collection('distOperations').doc(id)
  await reference.set({ id, restaurantId: 'sanjose', createdBy: actor, createdAt: new Date().toISOString(), type, payload, status: 'queued' })
  await processCommand(adminDb, reference)
  const operation = await read('distOperations', id)
  assert.equal(operation.status, expected, operation.error || `${type} no terminó en ${expected}`)
  return operation.result
}

async function createSale(kind = 'cash', amount = 270, suffix = 'sale') {
  return command(admin, 'sale', {
    sourceLocation: 'centralWarehouse',
    lines: [{ productId: product, quantity: 1, actualUnitPrice: 270 }],
    paymentKind: kind,
    cashAmount: kind === 'cash' ? amount : 0,
    qrAmount: kind === 'qr' ? amount : 0,
    creditAmount: 0,
  }, suffix)
}

async function editPayment(sale, values, suffix = 'edit', expected = 'confirmed') {
  return command(admin, 'editSale', {
    saleId: sale.id,
    reason: 'Corrección de método de pago confirmada para QA',
    lines: sale.lines.map(line => ({ productId: line.productId, quantity: line.quantity, actualUnitPrice: line.actualUnitPrice })),
    ...values,
  }, suffix, expected)
}

try {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    for (const [uid, role] of [[admin, 'admin'], [admin2, 'admin'], [warehouse, 'warehouse'], [distributor, 'distributor']]) {
      await setDoc(doc(db, 'restaurants', 'sanjose', 'members', uid), { uid, role, active: true, displayName: `QA ${role}` })
    }
    await setDoc(doc(db, 'restaurants', 'sanjose', 'distRoutes', route), { id: route, name: 'Ruta QR QA', active: true })
    await setDoc(doc(db, 'restaurants', 'sanjose', 'distProducts', product), { id: product, restaurantId: 'sanjose', name: 'Producto QR QA', unitType: 'unit', referencePrice: 270, productionCost: 10, active: true })
  })

  const today = dayKey(new Date())
  await command(admin, 'intake', { note: 'Stock QA QR', lines: [{ productId: product, quantity: 100, lotCode: 'QR-QA-1', manufacturedOn: today, expiresOn: '2099-12-31', productionCost: 10 }] }, 'intake')

  // Exact reported flow: a confirmed Bs 270 cash sale is audit-corrected to QR.
  const cashSale = await createSale('cash', 270, 'reported-sale')
  const before = await read('distSales', cashSale.id)
  assert.equal(before.paymentKind, 'cash')
  assert.equal(before.cashAmount, 270)
  assert.equal(before.qrAmount, 0)
  await editPayment(cashSale, { paymentKind: 'qr', cashAmount: 0, qrAmount: 270, creditAmount: 0 }, 'reported-edit')
  const corrected = await read('distSales', cashSale.id)
  assert.equal(corrected.paymentKind, 'cash', 'los campos originales de la venta no se reescriben')
  assert.equal(corrected.qrAmount, 0)
  assert.equal(corrected.effectiveSnapshot.paymentKind, 'qr')
  assert.equal(corrected.effectiveSnapshot.qrAmount, 270)
  assert.equal(corrected.revision, 1)
  assert.equal(saleQrPaymentState(corrected).amount, 270)
  pass('venta Bs 270 efectivo → QR conserva original y usa effectiveSnapshot vigente')

  // The stale pre-fix verification ID/amount is rejected by the active Rules.
  await assertFails(setDoc(doc(adminDbClient, 'restaurants', 'sanjose', 'distQrVerifications', `sale_${cashSale.id}`), {
    id: `sale_${cashSale.id}`, restaurantId: 'sanjose', routeId: corrected.routeId, sourceType: 'sale', sourceId: cashSale.id,
    sourceRevision: 1, amount: 270, reference: 'REF-OLD-STYLE', verifiedBy: admin, verifiedAt: new Date().toISOString(),
  }))
  pass('Rules rechazan la verificación antigua sin clave de revisión')

  const verificationId = saleQrPaymentState(corrected).verificationId
  await assertFails(setDoc(doc(adminDbClient, 'restaurants', 'sanjose', 'distQrVerifications', verificationId), {
    id: verificationId, restaurantId: 'sanjose', routeId: corrected.routeId, sourceType: 'sale', sourceId: cashSale.id,
    sourceRevision: 1, amount: 269, reference: 'IMPORTE-INCORRECTO', verifiedBy: admin, verifiedAt: new Date().toISOString(),
  }))
  pass('Rules comparan el monto con effectiveSnapshot y rechazan un importe distinto')

  const salesCountBeforeVerification = (await root.collection('distSales').get()).size
  const collectionsCountBeforeVerification = (await root.collection('distCollections').get()).size
  const verification = await recordQrVerification(adminDbClient, 'sanjose', admin, 'sale', cashSale.id, 'BANCO-QA-270', 1)
  assert.deepEqual(verification, { status: 'verified', amount: 270 })
  const saved = await read('distQrVerifications', verificationId)
  assert.equal(saved.amount, 270)
  assert.equal(saved.sourceRevision, 1)
  assert.equal(saved.reference, 'BANCO-QA-270')
  assert.equal(hasCurrentSaleQrVerification(corrected, saved), true)
  assert.deepEqual(await recordQrVerification(adminDbClient, 'sanjose', admin, 'sale', cashSale.id, 'OTRA-REFERENCIA', 1), { status: 'already-verified', amount: 270 })
  pass('pago corregido verifica Bs 270 una sola vez y conserva referencia/responsable/revisión')

  assert.equal((await root.collection('distSales').get()).size, salesCountBeforeVerification)
  assert.equal((await root.collection('distCollections').get()).size, collectionsCountBeforeVerification)
  pass('verificar QR no crea venta ni cobranza adicional')

  // A verified QR sale cannot be corrected/voided without a dedicated bank-review procedure.
  const qrSale = await createSale('qr', 270, 'qr-original')
  const initialVerification = await recordQrVerification(adminDbClient, 'sanjose', admin, 'sale', qrSale.id, 'BANCO-ORIGINAL', 0)
  assert.equal(initialVerification.status, 'verified')
  const originalQrSale = await read('distSales', qrSale.id)
  await editPayment(originalQrSale, { paymentKind: 'mixed', cashAmount: 70, qrAmount: 200, creditAmount: 0 }, 'qr-revised-amount', 'rejected')
  await command(admin, 'voidSale', { saleId: qrSale.id, reason: 'Intento QA de anular pago ya verificado' }, 'verified-void', 'rejected')
  const stillVerifiedSale = await read('distSales', qrSale.id)
  assert.equal(stillVerifiedSale.revision ?? 0, 0)
  assert.equal(saleQrPaymentState(stillVerifiedSale).amount, 270)
  assert.equal(hasCurrentSaleQrVerification(stillVerifiedSale, await read('distQrVerifications', `sale_${qrSale.id}`)), true)
  assert.equal((await read('distQrVerifications', `sale_${qrSale.id}`)).reference, 'BANCO-ORIGINAL', 'verificación previa sigue preservada')
  pass('venta QR ya verificada bloquea corrección/anulación sin revisión bancaria y conserva su auditoría')

  // QR -> cash before verification is allowed, and the sale disappears from the QR queue.
  const cashAgain = await createSale('qr', 270, 'qr-to-cash')
  await editPayment(cashAgain, { paymentKind: 'cash', cashAmount: 270, qrAmount: 0, creditAmount: 0 }, 'correct-qr-to-cash')
  const correctedToCash = await read('distSales', cashAgain.id)
  assert.equal(saleQrPaymentState(correctedToCash).amount, 0)
  await assert.rejects(recordQrVerification(adminDbClient, 'sanjose', admin, 'sale', cashAgain.id, 'NO-DEBE', 1), /No existe un pago QR pendiente/)
  pass('QR → efectivo antes de verificar quita la operación de la cola QR')

  const mixedSale = await createSale('cash', 270, 'cash-to-mixed')
  await editPayment(mixedSale, { paymentKind: 'mixed', cashAmount: 120, qrAmount: 150, creditAmount: 0 }, 'mixed-edit')
  assert.equal(saleQrPaymentState(await read('distSales', mixedSale.id)).amount, 150)
  pass('pago mixto verifica únicamente su componente QR')

  const changedQrAmount = await createSale('qr', 270, 'qr-change-amount')
  await editPayment(changedQrAmount, { paymentKind: 'mixed', cashAmount: 70, qrAmount: 200, creditAmount: 0 }, 'qr-amount-edit')
  const amountRevision = await read('distSales', changedQrAmount.id)
  assert.equal(saleQrPaymentState(amountRevision).amount, 200)
  assert.equal((await recordQrVerification(adminDbClient, 'sanjose', admin, 'sale', changedQrAmount.id, 'QR-200', 1)).amount, 200)
  pass('QR → monto QR diferente antes de verificar usa el nuevo importe y nueva revisión')

  const voidSale = await createSale('qr', 270, 'void-qr')
  await command(admin, 'voidSale', { saleId: voidSale.id, reason: 'Anulación QA de venta QR' }, 'void-operation')
  const voided = await read('distSales', voidSale.id)
  assert.equal(saleQrPaymentState(voided).amount, 0)
  await assert.rejects(recordQrVerification(adminDbClient, 'sanjose', admin, 'sale', voidSale.id, 'NO-DEBE', 1), /anulada/)
  pass('venta anulada no puede verificarse como pago QR')

  // Two administrators race for the same revision: transaction conflict yields one verification.
  const concurrentSale = await createSale('cash', 270, 'concurrent')
  await editPayment(concurrentSale, { paymentKind: 'qr', cashAmount: 0, qrAmount: 270, creditAmount: 0 }, 'concurrent-edit')
  const concurrentResults = await Promise.all([
    recordQrVerification(adminDbClient, 'sanjose', admin, 'sale', concurrentSale.id, 'REF-ADMIN-1', 1),
    recordQrVerification(admin2DbClient, 'sanjose', admin2, 'sale', concurrentSale.id, 'REF-ADMIN-2', 1),
  ])
  assert.deepEqual(concurrentResults.map(result => result.status).sort(), ['already-verified', 'verified'])
  pass('dos administradores concurrentes dejan exactamente una verificación para la revisión')

  const collectionId = `${prefix}-collection`
  const claimId = `${prefix}-claim`
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await setDoc(doc(db, 'restaurants', 'sanjose', 'distCollections', collectionId), { id: collectionId, restaurantId: 'sanjose', routeId: route, method: 'qr', amount: 20, qrAmount: 20 })
    await setDoc(doc(db, 'restaurants', 'sanjose', 'distClaims', claimId), { id: claimId, restaurantId: 'sanjose', routeId: route, qrIn: 12 })
  })
  assert.equal((await recordQrVerification(adminDbClient, 'sanjose', admin, 'collection', collectionId, 'COLLECTION-REF')).amount, 20)
  assert.equal((await recordQrVerification(adminDbClient, 'sanjose', admin, 'claim', claimId, 'CLAIM-REF')).amount, 12)
  pass('cobranzas y reclamos mantienen la verificación existente')

  const unauthorizedId = `sale_${cashSale.id}_r1-denied`
  const deniedDoc = { id: unauthorizedId, restaurantId: 'sanjose', routeId: corrected.routeId, sourceType: 'sale', sourceId: cashSale.id, sourceRevision: 1, amount: 270, reference: 'REF-NO', verifiedBy: warehouse, verifiedAt: new Date().toISOString() }
  await assertFails(setDoc(doc(env.authenticatedContext(warehouse).firestore(), 'restaurants', 'sanjose', 'distQrVerifications', unauthorizedId), deniedDoc))
  await assertFails(setDoc(doc(env.authenticatedContext(distributor).firestore(), 'restaurants', 'sanjose', 'distQrVerifications', `sale_${cashSale.id}_r1-dist`), { ...deniedDoc, id: `sale_${cashSale.id}_r1-dist`, verifiedBy: distributor }))
  await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), 'restaurants', 'sanjose', 'distQrVerifications', `sale_${cashSale.id}_r1-anon`), { ...deniedDoc, id: `sale_${cashSale.id}_r1-anon`, verifiedBy: 'anonymous' }))
  await assertFails(setDoc(doc(adminDbClient, 'restaurants', 'other-tenant', 'distQrVerifications', `sale_${cashSale.id}_r1-tenant`), { ...deniedDoc, id: `sale_${cashSale.id}_r1-tenant`, restaurantId: 'other-tenant', verifiedBy: admin }))
  pass('Rules mantienen verificación solo para administración activa y tenant San José')

  const verificationDocs = await getDocs(collection(adminDbClient, 'restaurants', 'sanjose', 'distQrVerifications'))
  assert.equal(verificationDocs.docs.filter(item => item.data().sourceId === cashSale.id && item.data().sourceRevision === 1).length, 1)
  pass(`sin duplicación: ${checks} grupos de regresión pasan con Firestore Security Rules activas`)
} finally {
  await env.cleanup()
  await deleteApp(adminApp)
}
