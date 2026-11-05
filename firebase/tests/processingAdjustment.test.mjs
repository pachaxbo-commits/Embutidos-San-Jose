// Administrative inventory reduction for commercially released sacheteado lots.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { computeOperatingResult } from '../../src/modules/distribution/domain/operatingResult.ts'

const req = createRequire(new URL('../../functions/package.json', import.meta.url))
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085'
process.env.FUNCTIONS_EMULATOR = 'true'
process.env.SANJOSE_DERIVED_SALES_EMULATOR_TEST = 'true'
const { initializeApp } = req('firebase-admin/app')
const { getFirestore } = req('firebase-admin/firestore')
const { processCommand } = req('./operations.cjs')
const projectId = 'demo-pachax-audit'
const app = initializeApp({ projectId }, 'qa-processing-adjustment')
const db = getFirestore(app)
const root = db.doc('restaurants/sanjose')
const env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8085, rules: fs.readFileSync('firebase/firestore.rules', 'utf8') } })
const prefix = `pa${Date.now().toString(36)}`
const ids = { admin: `${prefix}-admin`, warehouse: `${prefix}-warehouse`, distributor: `${prefix}-distributor`, warehouseId: `${prefix}-wh`, route: `${prefix}-route` }
let checks = 0
const pass = (condition, message) => { assert.ok(condition, message); checks++; console.log(`PASS ${message}`) }
const authDb = uid => env.authenticatedContext(uid).firestore()
const read = async (collection, id) => (await root.collection(collection).doc(id).get()).data()
const command = async (actor, type, payload, operationId, expected = 'confirmed') => {
  const ref = root.collection('distOperations').doc(operationId)
  await setDoc(doc(authDb(actor), 'restaurants', 'sanjose', 'distOperations', operationId), { id: operationId, restaurantId: 'sanjose', createdBy: actor, createdAt: new Date().toISOString(), type, payload, status: 'queued' })
  await processCommand(db, ref)
  const operation = (await ref.get()).data()
  if (expected) assert.equal(operation.status, expected, `${type}: ${operation.error || 'estado inesperado'}`)
  return { ...operation, operationId }
}
const backendCommand = async (actor, type, payload, operationId, expected = 'confirmed') => {
  const ref = root.collection('distOperations').doc(operationId)
  await ref.set({ id: operationId, restaurantId: 'sanjose', createdBy: actor, createdAt: new Date().toISOString(), type, payload, status: 'queued' })
  await processCommand(db, ref)
  const operation = (await ref.get()).data()
  if (expected) assert.equal(operation.status, expected, `${type}: ${operation.error || 'estado inesperado'}`)
  return { ...operation, operationId }
}

async function seedDerived(suffix, overrides = {}) {
  const productId = `${prefix}-${suffix}-product`
  const lotId = `${prefix}-${suffix}-lot`
  const batchId = `${prefix}-${suffix}-batch`
  const reservation = overrides.reservation
  const hold = reservation || {}
  const quantity = 39
  const weightG = 19539
  const costCents = 3900
  await root.collection('distProducts').doc(productId).set({ id: productId, restaurantId: 'sanjose', name: `QA Sachet ${suffix}`, unitType: 'package', active: true, referencePrice: 10, productionCost: 1 })
  const release = overrides.unreleased ? undefined : { status: 'released', batchId, approvedBy: ids.admin, approvedAt: new Date().toISOString(), operationId: `${prefix}-release-${suffix}`, reason: 'Producto apto para despacho y venta', physicalWeightG: weightG, costCents }
  const lot = {
    id: lotId, restaurantId: 'sanjose', productId, productName: `QA Sachet ${suffix}`, unitType: 'package', lotCode: `QA-${suffix.toUpperCase()}`,
    manufacturedOn: '2026-10-30', packagedOn: '2026-10-31', expiresOn: '2026-11-30', productionCost: null,
    quantities: { central: quantity }, processingCommercialBlocked: true, processingDestinationKind: 'finished', processingBatchId: batchId,
    processingSourceLotIds: [`${prefix}-bulk-origin`], processingSourceAllocationBasis: 'documented_average',
    processingByLocation: { central: { segments: [{ segmentId: `${prefix}-${suffix}-segment`, batchId, destinationId: 'finished', sourceMovementId: `${prefix}-${suffix}-batch-op__1`, weightBasis: 'measured_total', remainingQuantity: quantity, remainingWeightG: weightG, remainingCostCents: costCents }] } },
    processingPhysicalWeightGRemaining: weightG, processingCostCentsRemaining: costCents,
    processingUnavailable: { central: { courtesy: Number(hold.courtesy || 0), repackPending: Number(hold.repackPending || 0), reviewHold: Number(hold.reviewHold || 0) } },
    ...(overrides.quarantined ? { quarantined: true } : {}), ...(overrides.repack ? { processingRepackId: `${prefix}-${suffix}-repack` } : {}),
    ...(release ? { processingCommercialRelease: release } : {}),
  }
  await root.collection('distProcessingBatches').doc(batchId).set({ id: batchId, restaurantId: 'sanjose', status: 'confirmed', processType: 'bagging', result: { derivedLots: [{ lotId, destinationKind: 'finished' }] } })
  await root.collection('distLots').doc(lotId).set(lot)
  await root.collection('distBalances').doc(`central__${productId}`).set({ id: `central__${productId}`, restaurantId: 'sanjose', locationKind: 'central', warehouseId: 'central', productId, unitType: 'package', quantity })
  if (reservation) await root.collection('distStockReservations').doc(`${prefix}-${suffix}-reservation`).set({
    id: `${prefix}-${suffix}-reservation`, restaurantId: 'sanjose', productId, lotId, location: 'central', purpose: reservation.purpose,
    originalQuantity: quantity, remainingQuantity: quantity, consumedQuantity: 0, status: 'active',
  })
  return { productId, lotId, batchId, weightG, costCents }
}

try {
  await root.collection('members').doc(ids.admin).set({ role: 'admin', active: true, displayName: 'QA Admin' })
  await root.collection('members').doc(ids.warehouse).set({ role: 'warehouse', active: true, warehouseId: ids.warehouseId, displayName: 'QA Almacén' })
  await root.collection('members').doc(ids.distributor).set({ role: 'distributor', active: true, routeId: ids.route, displayName: 'QA Distribuidor' })
  await root.collection('distWarehouses').doc(ids.warehouseId).set({ id: ids.warehouseId, restaurantId: 'sanjose', active: true, name: 'QA' })

  const fixture = await seedDerived('released')
  const adjustmentId = `${prefix}-adjust-minus-one`
  const adjusted = await command(ids.admin, 'adjustment', { warehouseId: 'central', line: { productId: fixture.productId, lotId: fixture.lotId, quantity: -1 }, note: 'Conciliación física de QA' }, adjustmentId)
  let lot = await read('distLots', fixture.lotId)
  let balance = await read('distBalances', `central__${fixture.productId}`)
  const movement = await read('distStockMovements', `${adjustmentId}__0`)
  pass(adjusted.status === 'confirmed' && lot.quantities.central === 38 && balance.quantity === 38, 'Administración ajusta -1 del lote sacheteado liberado y deja 38 paquetes')
  pass(lot.processingPhysicalWeightGRemaining === 19038 && lot.processingCostCentsRemaining === 3800 && lot.processingByLocation.central.segments[0].remainingQuantity === 38, 'el ajuste resta proporcionalmente 501 g y 100 centavos y conserva el segmento')
  pass(lot.processingCommercialBlocked === true && lot.processingBatchId === fixture.batchId && lot.processingCommercialRelease.status === 'released' && lot.processingSourceLotIds.length === 1, 'el lote mantiene su estado processing, liberación y trazabilidad al batch/origen')
  pass(movement.type === 'adjustment' && movement.quantity === 1 && movement.centralDelta === -1 && movement.processingAllocations.length === 1 && movement.processingAllocations[0].batchId === fixture.batchId && movement.processingAllocations[0].quantity === 1 && movement.processingAllocations[0].physicalWeightG === 501 && movement.processingAllocations[0].costCents === 100 && movement.lossCost === 1, 'Kardex registra una sola baja con asignación processing, peso, costo y pérdida histórica')

  const afterSessionRestart = await getDoc(doc(authDb(ids.admin), 'restaurants', 'sanjose', 'distLots', fixture.lotId))
  pass(afterSessionRestart.exists() && afterSessionRestart.data().quantities.central === 38, 'una sesión autenticada nueva vuelve a leer los 38 paquetes persistidos')
  await processCommand(db, root.collection('distOperations').doc(adjustmentId))
  const movementsAfterRetry = await root.collection('distStockMovements').where('refId', '==', adjustmentId).get()
  lot = await read('distLots', fixture.lotId)
  pass(lot.quantities.central === 38 && movementsAfterRetry.size === 1, 'reprocesar la misma operación confirmada no vuelve a descontar ni duplica Kardex')
  const overstock = await command(ids.admin, 'adjustment', { warehouseId: 'central', line: { productId: fixture.productId, lotId: fixture.lotId, quantity: -39 }, note: 'Intento de exceder stock QA' }, `${prefix}-adjust-overstock`, 'rejected')
  pass(overstock.error.includes('lote QA-RELEASED') && overstock.error.includes('Disponible para ajuste: 38.00 paquetes') && (await read('distLots', fixture.lotId)).quantities.central === 38, 'un ajuste superior al stock identifica lote y disponible, y se rechaza sin saldo negativo ni escrituras parciales')

  const warehouseDirectRef = doc(authDb(ids.warehouse), 'restaurants', 'sanjose', 'distOperations', `${prefix}-warehouse-direct-adjustment`)
  await assertFails(setDoc(warehouseDirectRef, { id: `${prefix}-warehouse-direct-adjustment`, restaurantId: 'sanjose', createdBy: ids.warehouse, createdAt: new Date().toISOString(), type: 'adjustment', payload: { warehouseId: 'central', line: { productId: fixture.productId, lotId: fixture.lotId, quantity: -1 }, note: 'No debe ajustar directamente' }, status: 'queued' }))
  const distributorDirectRef = doc(authDb(ids.distributor), 'restaurants', 'sanjose', 'distOperations', `${prefix}-distributor-direct-adjustment`)
  await assertFails(setDoc(distributorDirectRef, { id: `${prefix}-distributor-direct-adjustment`, restaurantId: 'sanjose', createdBy: ids.distributor, createdAt: new Date().toISOString(), type: 'adjustment', payload: { warehouseId: 'central', line: { productId: fixture.productId, lotId: fixture.lotId, quantity: -1 }, note: 'No debe ajustar directamente' }, status: 'queued' }))
  const request = await command(ids.warehouse, 'adjustmentRequest', { warehouseId: ids.warehouseId, line: { productId: fixture.productId, quantity: -1 }, note: 'Solicitar conciliación física' }, `${prefix}-warehouse-adjustment-request`)
  const warehouseBackendAttempt = await backendCommand(ids.warehouse, 'adjustment', { warehouseId: ids.warehouseId, line: { productId: fixture.productId, lotId: fixture.lotId, quantity: -1 }, note: 'Intento directo de QA' }, `${prefix}-warehouse-backend-adjust`, 'rejected')
  const distributorAttempt = await backendCommand(ids.distributor, 'adjustment', { warehouseId: 'central', line: { productId: fixture.productId, lotId: fixture.lotId, quantity: -1 }, note: 'Intento distribuidor QA' }, `${prefix}-distributor-adjust`, 'rejected')
  pass(request.status === 'confirmed' && (await read('distAdjustmentRequests', request.operationId)).status === 'pending' && (await read('distLots', fixture.lotId)).quantities.central === 38 && warehouseBackendAttempt.error.includes('Solo Administración') && distributorAttempt.error.includes('Solo Administración'), 'Almacén solo crea solicitud sin mover stock; ajuste directo de Almacén y Distribuidor es rechazado')

  const unreleased = await seedDerived('unreleased', { unreleased: true })
  const blockedUnreleased = await command(ids.admin, 'adjustment', { warehouseId: 'central', line: { productId: unreleased.productId, lotId: unreleased.lotId, quantity: -1 }, note: 'No reducir lote bloqueado' }, `${prefix}-unreleased-adjust`, 'rejected')
  pass(blockedUnreleased.error.includes('no tiene una liberación comercial válida') && (await read('distLots', unreleased.lotId)).quantities.central === 39, 'lote terminado no liberado sigue protegido contra ajuste')

  const quarantined = await seedDerived('quarantine', { quarantined: true })
  const quarantineAttempt = await command(ids.admin, 'adjustment', { warehouseId: 'central', line: { productId: quarantined.productId, lotId: quarantined.lotId, quantity: -1 }, note: 'No reducir cuarentena QA' }, `${prefix}-quarantine-adjust`, 'rejected')
  pass(quarantineAttempt.error.includes('está en cuarentena') && (await read('distLots', quarantined.lotId)).quantities.central === 39, 'cuarentena bloquea el ajuste aunque la operación permita lotes vencidos')

  for (const [purpose, field] of [['courtesy', 'courtesy'], ['repack_pending', 'repackPending'], ['review_hold', 'reviewHold']]) {
    const held = await seedDerived(field, { reservation: { purpose, [field]: 39 } })
    const attempt = await command(ids.admin, 'adjustment', { warehouseId: 'central', line: { productId: held.productId, lotId: held.lotId, quantity: -1 }, note: `No reducir ${purpose} QA` }, `${prefix}-${field}-adjust`, 'rejected')
    const purposeLabel = { courtesy: 'cortesía', repack_pending: 'reenvasado', review_hold: 'revisión' }[purpose]
    pass(attempt.error.includes(purposeLabel) && attempt.error.includes('Disponible para ajuste: 0.00 paquetes') && (await read('distLots', held.lotId)).quantities.central === 39, `${purpose} conserva bloqueados los paquetes protegidos y explica la causa`)
  }
  const repackOutput = await seedDerived('repack-output', { repack: true })
  const repackAttempt = await command(ids.admin, 'adjustment', { warehouseId: 'central', line: { productId: repackOutput.productId, lotId: repackOutput.lotId, quantity: -1 }, note: 'No ajustar reenvasado en esta ruta' }, `${prefix}-repack-adjust`, 'rejected')
  pass(repackAttempt.error.includes('no es un lote terminado de sacheteado elegible') && (await read('distLots', repackOutput.lotId)).quantities.central === 39, 'salida de reenvasado permanece fuera del permiso de ajuste de sacheteado')

  const dispatchId = `${prefix}-after-adjust-dispatch`
  const dispatch = await command(ids.admin, 'dispatch', { warehouseId: 'central', routeId: ids.route, routeName: 'QA Ruta', distributorUid: ids.distributor, distributorName: 'QA Distribuidor', warehouseResponsibleName: 'QA Almacén', lines: [{ productId: fixture.productId, quantity: 5, normalQuantity: 5, dispatchMerma: 0, allocationsRequested: [{ lotId: fixture.lotId, quantity: 5 }] }] }, dispatchId)
  const sale = await command(ids.admin, 'sale', { sourceLocation: 'centralWarehouse', routeId: 'administracion', routeName: 'Administración', lines: [{ productId: fixture.productId, quantity: 1, actualUnitPrice: 10 }], cashAmount: 10, qrAmount: 0, creditAmount: 0, paymentKind: 'cash' }, `${prefix}-after-adjust-sale`)
  lot = await read('distLots', fixture.lotId)
  const dispatchMovement = await read('distStockMovements', `${dispatchId}__0`)
  const saleMovement = (await root.collection('distStockMovements').where('refId', '==', sale.operationId).get()).docs.find(snapshot => snapshot.data().type === 'sale')?.data()
  pass(dispatch.status === 'confirmed' && dispatchMovement.processingAllocations[0].batchId === fixture.batchId && sale.status === 'confirmed' && saleMovement.processingAllocations[0].batchId === fixture.batchId, 'el lote ajustado continúa disponible para despacho y venta con su genealogía processing')
  pass(lot.quantities.central === 32 && lot.quantities[`route__${ids.route}`] === 5 && lot.processingPhysicalWeightGRemaining === 18537 && lot.processingCostCentsRemaining === 3700 && lot.processingByLocation.central.segments[0].remainingWeightG === 16032, 'después de ajuste, traslado a ruta y venta, paquetes, peso por ubicación y costo total siguen conciliados')
  const adjustmentMovements = await root.collection('distStockMovements').where('type', '==', 'adjustment').get()
  const matchingAdjustments = adjustmentMovements.docs.map(snapshot => snapshot.data()).filter(row => row.refId === adjustmentId)
  const operatingResult = computeOperatingResult([], [], [], matchingAdjustments, [matchingAdjustments[0].dayKey])
  const lossDetail = operatingResult.details.find(detail => detail.key === 'losses')
  pass(matchingAdjustments.length === 1 && matchingAdjustments[0].quantity === 1 && matchingAdjustments[0].lossCost === 1 && operatingResult.losses === 1 && lossDetail?.rows.length === 1, 'Kardex y Resultado muestran una única baja por Bs 1 para el evento')
  console.log(`processing adjustment emulator: ${checks} checks PASS`)
} finally {
  await env.cleanup()
  await app.delete()
}
