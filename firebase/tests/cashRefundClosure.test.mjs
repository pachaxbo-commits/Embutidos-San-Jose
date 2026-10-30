import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'

const req = createRequire(new URL('../../functions/package.json', import.meta.url))
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085'
delete process.env.FUNCTIONS_EMULATOR
delete process.env.SANJOSE_DERIVED_SALES_EMULATOR_TEST
const { initializeApp } = req('firebase-admin/app')
const { getFirestore } = req('firebase-admin/firestore')
const { processCommand } = req('./operations.cjs')
const projectId = 'demo-pachax-audit'
const app = initializeApp({ projectId }, 'qa-cash-refund-closure')
const db = getFirestore(app)
const root = db.doc('restaurants/sanjose')
const env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8085, rules: fs.readFileSync('firebase/firestore.rules', 'utf8') } })
const prefix = `cash-${Date.now().toString(36)}`
const admin = `${prefix}-admin`
let checks = 0
const pass = (condition, label) => { assert.ok(condition, label); checks++; console.log(`PASS ${label}`) }
const read = async (collection, id) => (await root.collection(collection).doc(id).get()).data()
const seedEvent = async ({ saleId, saleDay, receiptAt, refundDay, cash, qr, refundStatus = 'executed', routeId = 'administracion', sellerUid = admin }) => {
  const snapshot = { cashAmount: cash, qrAmount: qr, paymentKind: cash && qr ? 'mixed' : qr ? 'qr' : 'cash', saleDayKey: saleDay, saleCreatedAt: receiptAt, sellerUid, sellerName: 'QA' }
  const sale = { id: saleId, operationId: saleId, restaurantId: 'sanjose', branchId: 'main', createdBy: sellerUid, createdAt: receiptAt, dayKey: saleDay, schemaVersion: 2,
    saleKind: 'sale', sourceLocation: routeId === 'administracion' ? 'centralWarehouse' : 'route', routeId, routeName: routeId === 'administracion' ? 'Administración' : 'Ruta QA', sellerUid, sellerName: 'QA', lines: [], total: cash + qr, paymentKind: snapshot.paymentKind,
    cashAmount: 0, qrAmount: 0, creditAmount: 0, voidedAt: '2026-10-29T12:00:00.000Z',
    effectiveSnapshot: { lines: [], total: 0, paymentKind: snapshot.paymentKind, cashAmount: 0, qrAmount: 0, creditAmount: 0, saleKind: 'sale' },
    derivedVoid: { correctionId: `${saleId}-correction`, cashReceiptSnapshot: snapshot } }
  await root.collection('distSales').doc(saleId).set(sale)
  const correction = { id: `${saleId}-correction`, restaurantId: 'sanjose', saleId, kind: 'derived_void', original: { lines: [], total: cash + qr, cashAmount: cash, qrAmount: qr, creditAmount: 0, paymentKind: snapshot.paymentKind } }
  await root.collection('distSaleCorrections').doc(correction.id).set(correction)
  const claimId = `${saleId}-refund`
  await root.collection('distClaims').doc(claimId).set({ id: claimId, restaurantId: 'sanjose', branchId: 'main', createdBy: admin, createdAt: `${refundDay}T20:00:00.000Z`, dayKey: refundDay, schemaVersion: 2,
    kind: 'return', isDerivedSaleVoid: true, saleId, sellerUid: admin, sellerName: 'QA Administración', saleSellerUid: sellerUid, saleSellerName: 'QA', routeId: 'administracion', originRouteId: routeId,
    cashMovementResponsibleUid: admin, cashMovementResponsibleName: 'QA Administración', cashMovementRouteId: 'administracion', cashRefundStatus: refundStatus,
    customerId: 'qa-customer', customerName: 'QA', productId: 'qa-product', productName: 'QA', quantity: 0, unitType: 'package', reason: 'QA refund', revenueDelta: 0, additionalCost: 0, debtReduction: 0,
    cashIn: 0, cashOut: cash, qrIn: 0, qrOut: qr, replacement: null })
  return { sale, claimId }
}
const closeAdmin = async (dayKey, cash, id) => {
  const opRef = root.collection('distOperations').doc(id)
  await setDoc(doc(env.authenticatedContext(admin).firestore(), 'restaurants', 'sanjose', 'distOperations', id), { id, restaurantId: 'sanjose', createdBy: admin, createdAt: new Date().toISOString(), type: 'closure', payload: { closure: { closureType: 'admin', dayKey, physicalCashDeclared: cash } }, status: 'queued' })
  await processCommand(db, opRef)
  return (await opRef.get()).data()
}
const closeRoute = async (dispatchId, cash, id) => {
  const opRef = root.collection('distOperations').doc(id)
  await setDoc(doc(env.authenticatedContext(admin).firestore(), 'restaurants', 'sanjose', 'distOperations', id), { id, restaurantId: 'sanjose', createdBy: admin, createdAt: new Date().toISOString(), type: 'closure', payload: { mode: 'final', closure: { dispatchId, physicalCashDeclared: cash } }, status: 'queued' })
  await processCommand(db, opRef)
  return (await opRef.get()).data()
}

try {
  await root.collection('members').doc(admin).set({ role: 'admin', active: true, displayName: 'QA Administración' })
  const sameSaleId = `${prefix}-same-day-sale`
  await seedEvent({ saleId: sameSaleId, saleDay: '2026-10-28', receiptAt: '2026-10-28T10:00:00.000Z', refundDay: '2026-10-28', cash: 10, qr: 0 })
  const sameResult = await closeAdmin('2026-10-28', 0, `${prefix}-close-same`)
  const sameClosure = await read('distClosures', sameResult.result.id)
  pass(sameResult.status === 'confirmed' && sameClosure.cashSales === 0 && sameClosure.voidedCashReceipts === 10 && sameClosure.claimCash === -10 && sameClosure.expectedCash === 0 && sameClosure.cashDifference === 0,
    'Admin closure persists same-day sale receipt +10 and executed refund -10 as expectedCash 0, without fictitious variance')

  const laterSaleId = `${prefix}-later-sale`
  await seedEvent({ saleId: laterSaleId, saleDay: '2026-10-26', receiptAt: '2026-10-26T10:00:00.000Z', refundDay: '2026-10-27', cash: 10, qr: 0 })
  const dayOneResult = await closeAdmin('2026-10-26', 10, `${prefix}-close-day-one`)
  const dayTwoResult = await closeAdmin('2026-10-27', 0, `${prefix}-close-day-two`)
  const dayOne = await read('distClosures', dayOneResult.result.id)
  const dayTwo = await read('distClosures', dayTwoResult.result.id)
  pass(dayOne.expectedCash === 10 && dayOne.cashDifference === 0, 'original day keeps only the actual Bs 10 receipt')
  pass(dayTwo.expectedCash === -10 && dayTwo.claimCash === -10, 'later day records the Bs 10 executed refund, not retroactively')

  const mixedSaleId = `${prefix}-mixed-sale`
  await seedEvent({ saleId: mixedSaleId, saleDay: '2026-10-25', receiptAt: '2026-10-25T10:00:00.000Z', refundDay: '2026-10-25', cash: 6, qr: 4 })
  const mixedResult = await closeAdmin('2026-10-25', 0, `${prefix}-close-mixed`)
  const mixedClosure = await read('distClosures', mixedResult.result.id)
  pass(mixedClosure.expectedCash === 0 && mixedClosure.voidedCashReceipts === 6 && mixedClosure.voidedQrReceipts === 4 && mixedClosure.claimCash === -6 && mixedClosure.claimQr === -4,
    'mixed refund persists cash and QR components separately; only the cash component affects expectedCash')

  const pendingSaleId = `${prefix}-pending-sale`
  await seedEvent({ saleId: pendingSaleId, saleDay: '2026-10-24', receiptAt: '2026-10-24T10:00:00.000Z', refundDay: '2026-10-24', cash: 10, qr: 0, refundStatus: 'pending' })
  const pendingResult = await closeAdmin('2026-10-24', 10, `${prefix}-close-pending`)
  const pendingClosure = await read('distClosures', pendingResult.result.id)
  pass(pendingClosure.expectedCash === 10 && pendingClosure.claimCash === 0, 'a pending refund is not counted as a cash disbursement')

  const routeId = `${prefix}-route`, dispatchId = `${prefix}-dispatch`, routeSaleId = `${prefix}-route-sale`
  const routeEvent = await seedEvent({ saleId: routeSaleId, saleDay: '2026-10-23', receiptAt: '2026-10-23T10:00:00.000Z', refundDay: '2026-10-23', cash: 10, qr: 0, routeId, sellerUid: `${prefix}-seller` })
  await root.collection('distRoutes').doc(routeId).set({ id: routeId, restaurantId: 'sanjose', active: true, name: 'Ruta QA' })
  await root.collection('distDispatches').doc(dispatchId).set({ id: dispatchId, restaurantId: 'sanjose', routeId, routeName: 'Ruta QA', distributorUid: `${prefix}-seller`, distributorName: 'Vendedor QA', warehouseId: 'central', status: 'open', createdAt: routeEvent.sale.createdAt, dayKey: '2026-10-23', lines: [], additions: [] })
  await root.collection('distSales').doc(routeSaleId).update({ dispatchId })
  await root.collection('distClosures').doc(`closure_${dispatchId}`).set({ id: `closure_${dispatchId}`, restaurantId: 'sanjose', routeId, dispatchId, status: 'warehouse_done', warehouseClosedBy: admin, createdAt: routeEvent.sale.createdAt, dayKey: '2026-10-23', products: [] })
  const routeCloseResult = await closeRoute(dispatchId, 10, `${prefix}-close-route`)
  const routeClosure = await read('distClosures', routeCloseResult.result.id)
  pass(routeCloseResult.status === 'confirmed' && routeClosure.expectedCash === 10 && routeClosure.claimCash === 0,
    'route closure keeps the seller receipt in the route box; the Administration refund is not deducted from the route')
  const adminRefundClose = await closeAdmin('2026-10-23', 0, `${prefix}-close-admin-refund`)
  const adminRefundClosure = await read('distClosures', adminRefundClose.result.id)
  pass(adminRefundClose.status === 'confirmed' && adminRefundClosure.expectedCash === -10 && adminRefundClosure.claimCash === -10,
    'Administration closure records the executed route-sale refund against the actual administrative cashbox')

  await processCommand(db, root.collection('distOperations').doc(`${prefix}-close-same`))
  const afterRetry = await read('distClosures', sameResult.result.id)
  pass(afterRetry.expectedCash === 0 && (await root.collection('distClosures').where('dayKey', '==', '2026-10-28').get()).size === 1,
    'retry of the same closure operation preserves one persisted closure and does not double count')
  console.log(`PASS cash refund persisted closure suite: ${checks} assertions`)
} finally {
  await env.cleanup()
  await app.delete()
}
