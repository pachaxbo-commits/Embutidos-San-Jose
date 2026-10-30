import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'

const req = createRequire(new URL('../../functions/package.json', import.meta.url))
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085'
process.env.FUNCTIONS_EMULATOR = 'true'
process.env.SANJOSE_DERIVED_SALES_EMULATOR_TEST = 'true'
const { initializeApp } = req('firebase-admin/app')
const { getFirestore } = req('firebase-admin/firestore')
const { processCommand } = req('./operations.cjs')
const projectId = 'demo-pachax-audit'
const app = initializeApp({ projectId }, 'qa-cash-refund-race')
const db = getFirestore(app)
const root = db.doc('restaurants/sanjose')
const env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8085, rules: fs.readFileSync('firebase/firestore.rules', 'utf8') } })
const prefix = `cash-race-${Date.now().toString(36)}`
const admin = `${prefix}-admin`, product = `${prefix}-product`, lot = `${prefix}-lot`, batch = `${prefix}-batch`, saleId = `${prefix}-sale`
const read = async (collection, id) => (await root.collection(collection).doc(id).get()).data()
const command = async (type, payload, id) => {
  const ref = root.collection('distOperations').doc(id)
  await setDoc(doc(env.authenticatedContext(admin).firestore(), 'restaurants', 'sanjose', 'distOperations', id), { id, restaurantId: 'sanjose', createdBy: admin, createdAt: new Date().toISOString(), type, payload, status: 'queued' })
  await processCommand(db, ref)
  return (await ref.get()).data()
}

try {
  await root.collection('members').doc(admin).set({ role: 'admin', active: true, displayName: 'QA Admin' })
  await root.collection('distProducts').doc(product).set({ id: product, restaurantId: 'sanjose', name: 'QA Sachet', unitType: 'package', active: true, productionCost: 9, referencePrice: 10 })
  const segment = { segmentId: `${batch}:${lot}`, batchId: batch, destinationId: `dest-${lot}`, sourceMovementId: `output-${lot}`, weightBasis: 'documented_average', remainingQuantity: 2, remainingWeightG: 500, remainingCostCents: 250 }
  await root.collection('distLots').doc(lot).set({ id: lot, restaurantId: 'sanjose', productId: product, productName: 'QA Sachet', unitType: 'package', lotCode: 'QA-LOT', manufacturedOn: '2026-10-10', expiresOn: '2027-01-10', quantities: { central: 2 }, processingCommercialBlocked: true, processingBatchId: batch, processingDestinationId: `dest-${lot}`, processingDestinationKind: 'finished', processingPhysicalWeightGRemaining: 500, processingCostCentsRemaining: 250, processingSourceAllocationBasis: 'batch_blend_accounting_allocation', processingByLocation: { central: { segments: [segment] } } })
  await root.collection('distBalances').doc(`central__${product}`).set({ id: `central__${product}`, restaurantId: 'sanjose', locationKind: 'central', warehouseId: 'central', productId: product, unitType: 'package', quantity: 2 })
  await root.collection('distProcessingBatches').doc(batch).set({ id: batch, restaurantId: 'sanjose', status: 'confirmed', result: { derivedLots: [{ lotId: lot, productId: product, commercialQuantity: 2, netWeightG: 500, costCents: 250 }] } })
  await root.collection('distStockMovements').doc(`output-${lot}`).set({ id: `output-${lot}`, restaurantId: 'sanjose', productId: product, type: 'processing_output', fromLocation: '', toLocation: 'central', quantity: 2, physicalWeightG: 500, costCents: 250, batchId: batch, lotId: lot })
  const sale = await command('sale', { sourceLocation: 'centralWarehouse', routeId: 'administracion', routeName: 'Administración', lines: [{ productId: product, quantity: 1, actualUnitPrice: 10 }], paymentKind: 'cash', cashAmount: 10, qrAmount: 0, creditAmount: 0 }, saleId)
  assert.equal(sale.status, 'confirmed', sale.error)

  const dayKey = (await read('distSales', saleId)).dayKey
  const [voidResult, closureResult] = await Promise.all([
    command('voidSale', { saleId, reason: 'Error de registro; no entregada', voidScenario: 'recorded_in_error_never_delivered', physicalCustodyConfirmed: true, custodyLocation: 'central', physicalCustodyNote: 'QA confirma custodia física en almacén', cashRefundAmount: 10 }, `${prefix}-void`),
    command('closure', { closure: { closureType: 'admin', dayKey, physicalCashDeclared: 0 } }, `${prefix}-closure`),
  ])
  const closure = await read('distClosures', closureResult.result?.id)
  const savedSale = await read('distSales', saleId)
  const savedLot = await read('distLots', lot)
  const refundRows = await root.collection('distClaims').where('saleId', '==', saleId).get()
  const voidMovements = await root.collection('distStockMovements').where('saleId', '==', saleId).get()
  assert.equal(closureResult.status, 'confirmed', closureResult.error)
  if (voidResult.status === 'confirmed') {
    assert.equal(closure.expectedCash, 0)
    assert.equal(closure.voidedCashReceipts, 10)
    assert.equal(closure.claimCash, -10)
    assert.equal(savedLot.quantities.central, 2)
    assert.equal(refundRows.size, 1)
    assert.equal(voidMovements.docs.filter(row => row.data().type === 'sale_void').length, 1)
    console.log('PASS concurrency order: void commits first; closure persists one original receipt and one refund, expectedCash 0')
  } else {
    assert.equal(voidResult.status, 'rejected')
    assert.equal(closure.expectedCash, 10)
    assert.equal(savedSale.voidedAt, undefined)
    assert.equal(savedLot.quantities.central, 1)
    assert.equal(refundRows.size, 0)
    assert.equal(voidMovements.docs.filter(row => row.data().type === 'sale_void').length, 0)
    console.log('PASS concurrency order: closure commits first; void is rejected after closure, expectedCash 10 and no refund/stock restoration')
  }
  await processCommand(db, root.collection('distOperations').doc(`${prefix}-closure`))
  assert.equal((await read('distClosures', closure.id)).expectedCash, closure.expectedCash, 'closure retry must preserve its financial snapshot')
  console.log('PASS concurrent void/closure and idempotent closure retry')
} finally {
  await env.cleanup()
  await app.delete()
}
