// Transactional processing batches; all writes are confined to Firebase Emulator.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs, limit, orderBy, query, setDoc, where } from 'firebase/firestore'

const req = createRequire(new URL('../../functions/package.json', import.meta.url))
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085'
const { initializeApp } = req('firebase-admin/app')
const { getFirestore } = req('firebase-admin/firestore')
const { processCommand } = req('./operations.cjs')
const projectId = 'demo-pachax-audit'
const adminApp = initializeApp({ projectId }, 'qa-processing-batches')
const db = getFirestore(adminApp)
const root = db.doc('restaurants/sanjose')
const env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8085, rules: fs.readFileSync('firebase/firestore.rules', 'utf8') } })
const prefix = `pb${Date.now().toString(36)}`
const ids = { admin: `${prefix}-admin`, warehouse: `${prefix}-warehouse`, otherWarehouse: `${prefix}-other-wh`, distributor: `${prefix}-seller`, warehouseId: `${prefix}-wh`, source: `${prefix}-bulk`, package: `${prefix}-sachet`, courtesy: `${prefix}-courtesy`, route: `${prefix}-route` }
let checks = 0
const pass = (condition, message) => { assert.ok(condition, message); checks++; console.log(`PASS ${message}`) }
const authDb = uid => env.authenticatedContext(uid).firestore()
const run = async (actor, type, payload, operationId = `${prefix}-${type}-${Math.random().toString(36).slice(2)}`, expected = 'confirmed') => {
  const ref = root.collection('distOperations').doc(operationId)
  await setDoc(doc(authDb(actor), 'restaurants', 'sanjose', 'distOperations', operationId), { id: operationId, restaurantId: 'sanjose', createdBy: actor, createdAt: new Date().toISOString(), type, payload, status: 'queued' })
  await processCommand(db, ref)
  const value = (await ref.get()).data()
  if (expected) assert.equal(value.status, expected, `${type}: ${value.error || 'estado inesperado'}`)
  return { ...value, operationId }
}
const read = async (collection, id) => (await root.collection(collection).doc(id).get()).data()
const fixtureProduct = async (id, unitType, productionCost = 4, approx = 0.25) => root.collection('distProducts').doc(id).set({ id, restaurantId: 'sanjose', name: `QA ${id}`, unitType, active: true, productionCost, referencePrice: 20, approximateWeightKg: approx })
const fixtureLot = async (productId, lotId, location, quantity, productionCost, extra = {}) => {
  await root.collection('distLots').doc(lotId).set({ id: lotId, restaurantId: 'sanjose', productId, productName: `QA ${productId}`, unitType: 'kg', lotCode: `LOT-${lotId}`, manufacturedOn: '2026-10-10', expiresOn: '2027-10-10', productionCost, quantities: { [location]: quantity }, ...extra })
  const balanceId = `${location}__${productId}`
  const balanceRef = root.collection('distBalances').doc(balanceId)
  const balance = await balanceRef.get()
  await balanceRef.set({ id: balanceId, restaurantId: 'sanjose', locationKind: location === 'central' ? 'central' : 'warehouse', warehouseId: location === 'central' ? 'central' : location.slice('warehouse__'.length), productId, unitType: 'kg', quantity: (balance.exists ? balance.data().quantity : 0) + quantity })
}
const validPayload = (batchId, sourceProductId = ids.source, sourceAllocations = [{ lotId: `${prefix}-source-lot`, quantity: 10, measuredNetWeightG: 10000 }]) => ({
  batchId, processType: 'bagging', sourceProductId, location: 'central', processingDate: '2026-10-28', note: 'Nota QA de proceso', inputWeightG: 10000, sourceAllocations,
  destinations: [
    { id: 'finished-sachets', kind: 'finished', productId: ids.package, commercialQuantity: 36, netWeightG: 9000, nominalWeightG: 250, weightBasis: 'documented_average', lotCode: `SACH-${batchId}`, manufacturedOn: '2026-10-28', packagedOn: '2026-10-28', expiresOn: '2027-01-10' },
    { id: 'courtesy-pieces', kind: 'courtesy', productId: ids.courtesy, commercialQuantity: 0.7, netWeightG: 700, lotCode: `COUR-${batchId}`, manufacturedOn: '2026-10-28', packagedOn: '2026-10-28', expiresOn: '2027-01-10', qualityConfirmed: true, qualityReason: 'Administración verificó integridad del contenido', reason: 'Porciones para futuras cortesías' },
    { id: 'confirmed-discard', kind: 'discard', netWeightG: 300, reason: 'Producto deteriorado verificado por Administración' },
  ],
  packagingMaterials: [{ id: 'bags', description: 'Bolsa grado alimentario', quantityMilli: 36000, damagedQuantityMilli: 1, costCents: 1200 }],
  costComponents: [{ id: 'already-paid-packaging', kind: 'packaging', amountCents: 1200, expenseId: `${prefix}-packaging-expense`, alreadyRecognizedAsOperatingExpense: true, capitalizable: false, sourceReference: 'Informativo; no volver a descontar Resultado' }],
})

try {
  await root.collection('members').doc(ids.admin).set({ role: 'admin', active: true, displayName: 'QA Administración' })
  await root.collection('members').doc(ids.warehouse).set({ role: 'warehouse', active: true, warehouseId: ids.warehouseId, displayName: 'QA Almacén' })
  await root.collection('members').doc(ids.otherWarehouse).set({ role: 'warehouse', active: true, warehouseId: `${ids.warehouseId}-other`, displayName: 'QA Otro Almacén' })
  await root.collection('members').doc(ids.distributor).set({ role: 'distributor', active: true, routeId: ids.route, displayName: 'QA Distribuidor' })
  await root.collection('distWarehouses').doc(ids.warehouseId).set({ id: ids.warehouseId, restaurantId: 'sanjose', active: true, name: 'QA almacén' })
  await fixtureProduct(ids.source, 'kg', 5)
  await fixtureProduct(ids.package, 'package', 999, 0.25)
  await fixtureProduct(ids.courtesy, 'kg', 12)
  await root.collection('distExpenses').doc(`${prefix}-packaging-expense`).set({ id: `${prefix}-packaging-expense`, restaurantId: 'sanjose', amount: 12, voided: false, createdAt: new Date().toISOString() })
  const sourceLot = `${prefix}-source-lot`
  await fixtureLot(ids.source, sourceLot, 'central', 10, 5)

  const badMass = validPayload(`${prefix}-bad-mass`)
  badMass.destinations[0].netWeightG = 8999
  const rejectedMass = await run(ids.admin, 'confirmProcessingBatch', badMass, `${prefix}-bad-mass-op`, 'rejected')
  pass(rejectedMass.error.includes('diferencia 1 g') && (await read('distBalances', `central__${ids.source}`)).quantity === 10 && !(await root.collection('distProcessingBatches').doc(badMass.batchId).get()).exists && (await root.collection('distStockMovements').where('refId', '==', rejectedMass.operationId).get()).empty, 'diferencia de 1 g rechazada sin documentos ni movimientos físicos parciales')

  const batchId = `${prefix}-valid-batch`
  const payload = validPayload(batchId)
  const confirmed = await run(ids.admin, 'confirmProcessingBatch', payload, `${prefix}-valid-batch-op`)
  const batch = await read('distProcessingBatches', batchId)
  const outputLot = batch.result.derivedLots.find(row => row.destinationId === 'finished-sachets')
  const courtesyLot = batch.result.derivedLots.find(row => row.destinationId === 'courtesy-pieces')
  const discardMove = (await root.collection('distStockMovements').where('batchId', '==', batchId).get()).docs.map(s => s.data()).find(m => m.type === 'processing_discard')
  pass(confirmed.status === 'confirmed' && batch.inputWeightG === 10000 && batch.destinations.reduce((n, d) => n + d.netWeightG, 0) === 10000, 'elaboración válida conserva exactamente 10.000 g entre sachets, cortesía y descarte')
  pass(batch.note === 'Nota QA de proceso', 'observaciones del proceso quedan guardadas en el batch confirmado')
  pass((await read('distBalances', `central__${ids.source}`)).quantity === 0 && (await read('distLots', sourceLot)).quantities.central === 0, '10 kg se descuentan una vez del lote y balance de origen')
  pass((await read('distBalances', `central__${ids.package}`)).quantity === 36 && (await read('distLots', outputLot.lotId)).quantities.central === 36 && (await read('distLots', outputLot.lotId)).processingCommercialBlocked === true, '36 sachets ingresan como paquetes con 9.000 g netos y quedan bloqueados para venta')
  pass((await read('distBalances', `central__${ids.courtesy}`)).quantity === 0.7 && (await read('distLots', courtesyLot.lotId)).processingUnavailable.central.courtesy === 0.7, '700 g destinados a cortesía permanecen como existencia física reservada')
  pass(batch.destinations.every(destination => destination.sourceAllocations.reduce((sum, allocation) => sum + allocation.weightG, 0) === destination.netWeightG && destination.sourceAllocations.every(allocation => allocation.originStatus === 'accounting_allocation_not_physical_identification')) && batch.destinations.map(destination => destination.costCents).join(',') === '4500,350,150', 'cada destino conserva asignación contable exacta por lote, sin afirmar procedencia física; los centavos concilian por destino')
  pass(batch.sourceCostCents === 5000 && batch.destinations.reduce((n, d) => n + d.costCents, 0) === 5000 && discardMove.lossCostCents === 150 && batch.packagingMaterials[0].damagedQuantityMilli === 1 && batch.costComponents[0].costTreatment.includes('informational'), 'costos históricos distribuyen exactamente Bs 50.00; material informativo no vuelve a cargar Resultado y descarte conserva costo Bs 1.50')
  const batchMoves = (await root.collection('distStockMovements').where('batchId', '==', batchId).get()).docs.map(s => s.data())
  pass(batchMoves.find(m => m.type === 'processing_consumption').centralDelta === -10 && batchMoves.filter(m => m.type === 'processing_output').length === 2 && batchMoves.find(m => m.type === 'processing_discard').centralDelta === 0, 'Kardex registra una salida de origen, dos entradas por SKU y descarte sin doble delta')
  const packageSale = await run(ids.admin, 'sale', { sourceLocation: 'centralWarehouse', routeId: 'administracion', routeName: 'Administración', lines: [{ productId: ids.package, quantity: 1, actualUnitPrice: 10 }], cashAmount: 10, qrAmount: 0, creditAmount: 0, paymentKind: 'cash' }, `${prefix}-blocked-package-sale`, 'rejected')
  pass(packageSale.error.includes('no está habilitada para usuarios reales') && (await read('distBalances', `central__${ids.package}`)).quantity === 36 && !(await root.collection('distSales').doc(packageSale.operationId).get()).exists, 'la venta comercial de lotes derivados permanece bloqueada fuera del opt-in aislado de QA')

  const courtesyReservationId = batch.result.reservationIds[0]
  const delivered = await run(ids.admin, 'deliverReservedCourtesy', { reservationId: courtesyReservationId, quantity: 0.2, deliveredWeightG: 200, recipient: 'QA cliente', reason: 'Entrega de prueba', deliveryId: `${batchId}-gift-1` }, `${prefix}-batch-gift-delivery`)
  const reservationAfterGift = await read('distStockReservations', courtesyReservationId)
  const courtesyLotAfterGift = await read('distLots', courtesyLot.lotId)
  pass(delivered.result.costTotal === 1 && reservationAfterGift.remainingQuantity === 0.5 && reservationAfterGift.remainingWeightG === 500 && reservationAfterGift.remainingCostCents === 250 && courtesyLotAfterGift.processingPhysicalWeightGRemaining === 500 && courtesyLotAfterGift.processingCostCentsRemaining === 250, 'entrega futura de cortesía consume exactamente 200 g y Bs 1,00 de los Bs 3,50 asignados; preserva 500 g y Bs 2,50')

  const retry = await run(ids.admin, 'confirmProcessingBatch', payload, `${prefix}-same-batch-new-op`)
  pass(retry.result.duplicate === true && (await read('distBalances', `central__${ids.source}`)).quantity === 0 && (await root.collection('distStockMovements').where('batchId', '==', batchId).get()).size === batchMoves.length, 'reintento de batchId con otro operationId devuelve resultado previo sin nuevos movimientos')
  const changedPayload = structuredClone(payload); changedPayload.destinations[0].netWeightG = 8999; changedPayload.destinations[2].netWeightG = 301
  const changed = await run(ids.admin, 'confirmProcessingBatch', changedPayload, `${prefix}-same-batch-changed`, 'rejected')
  pass(changed.error.includes('datos diferentes') && (await read('distBalances', `central__${ids.source}`)).quantity === 0, 'batchId repetido con contenido distinto se rechaza sin alterar el lote original')
  const movementCountBeforeOperationRetry = (await root.collection('distStockMovements').where('batchId', '==', batchId).get()).size
  await processCommand(db, root.collection('distOperations').doc(`${prefix}-valid-batch-op`))
  pass((await root.collection('distStockMovements').where('batchId', '==', batchId).get()).size === movementCountBeforeOperationRetry, 'reintento del mismo operationId confirmado no repite consumo, reservas ni Kardex')

  const reservedSourceProduct = `${prefix}-reserved-source`, reservedSourceLot = `${prefix}-reserved-source-lot`
  await fixtureProduct(reservedSourceProduct, 'kg', 2); await fixtureLot(reservedSourceProduct, reservedSourceLot, 'central', 10, 2)
  await run(ids.admin, 'reserveProcessingStock', { reservationId: `${prefix}-source-reservation`, productId: reservedSourceProduct, lotId: reservedSourceLot, location: 'central', purpose: 'courtesy', quantity: 2, reason: 'QA proteger origen' })
  const overReserved = validPayload(`${prefix}-over-reserved`, reservedSourceProduct, [{ lotId: reservedSourceLot, quantity: 10, measuredNetWeightG: 10000 }])
  const rejectReserved = await run(ids.admin, 'confirmProcessingBatch', overReserved, `${prefix}-over-reserved-op`, 'rejected')
  pass(rejectReserved.status === 'rejected' && (await read('distBalances', `central__${reservedSourceProduct}`)).quantity === 10 && (await read('distLots', reservedSourceLot)).quantities.central === 10, 'elaboración no consume stock reservado y el rechazo no deja cambios parciales')

  const heldSource = `${prefix}-held-source`, heldSourceLot = `${prefix}-held-source-lot`
  await fixtureProduct(heldSource, 'kg', 2); await fixtureLot(heldSource, heldSourceLot, 'central', 2, 2)
  const heldPayload = validPayload(`${prefix}-repack-pending-batch`, heldSource, [{ lotId: heldSourceLot, quantity: 2, measuredNetWeightG: 2000 }])
  heldPayload.inputWeightG = 2000
  heldPayload.destinations = [{ id: 'needs-repacking', kind: 'repack_pending', productId: ids.package, commercialQuantity: 2, netWeightG: 2000, nominalWeightG: 1000, weightBasis: 'measured_total', lotCode: `REPACK-${prefix}`, manufacturedOn: '2026-10-28', packagedOn: '2026-10-28', expiresOn: '2027-01-10', reason: 'Envase abierto; contenido inmovilizado para reenvasado' }]
  const heldResult = await run(ids.admin, 'confirmProcessingBatch', heldPayload, `${prefix}-repack-pending-op`)
  const heldBatch = await read('distProcessingBatches', heldPayload.batchId)
  const heldReservation = await read('distStockReservations', heldBatch.result.reservationIds[0])
  const heldLot = await read('distLots', heldBatch.result.derivedLots[0].lotId)
  pass(heldResult.status === 'confirmed' && heldLot.processingUnavailable.central.repackPending === 2 && heldReservation.purpose === 'repack_pending' && heldReservation.remainingWeightG === 2000 && (await read('distBalances', `central__${ids.package}`)).quantity === 38, 'destino pendiente de reenvasado crea lote físico y reserva exacta, sin exponerlo como vendible')

  const mixedA = `${prefix}-mixed-a`
  await fixtureProduct(mixedA, 'kg', 4); await fixtureLot(mixedA, `${prefix}-mixed-lot-a`, 'central', 6, 4)
  await fixtureLot(mixedA, `${prefix}-mixed-lot-b`, 'central', 4, 6)
  const mixedPayload = validPayload(`${prefix}-two-source-lots`, mixedA, [
    { lotId: `${prefix}-mixed-lot-a`, quantity: 6, measuredNetWeightG: 6000 },
    { lotId: `${prefix}-mixed-lot-b`, quantity: 4, measuredNetWeightG: 4000 },
  ])
  const mixedResult = await run(ids.admin, 'confirmProcessingBatch', mixedPayload, `${prefix}-two-source-lots-op`)
  const mixedBatch = await read('distProcessingBatches', mixedPayload.batchId)
  pass(mixedResult.status === 'confirmed' && mixedBatch.sourceAllocations.length === 2 && mixedBatch.sourceCostCents === 4800 && mixedBatch.destinations.reduce((n,d)=>n+d.costCents,0) === 4800, 'dos lotes del mismo SKU se consumen con costos 24+24 Bs y asignación de centavos exacta')
  pass(mixedBatch.destinations.every(destination => destination.sourceAllocations.reduce((sum, allocation) => sum + allocation.weightG, 0) === destination.netWeightG && destination.sourceAllocations.reduce((sum, allocation) => sum + allocation.costCents, 0) === destination.costCents) && mixedBatch.destinations[0].sourceAllocations.map(allocation => allocation.weightG).join(',') === '5400,3600', 'mezcla de dos lotes reparte gramos y costos por destino con margen exacto y marcado solo contable')

  const unknownCostProduct = `${prefix}-unknown-cost`, unknownCostLot = `${prefix}-unknown-cost-lot`
  await fixtureProduct(unknownCostProduct, 'kg', 77); await fixtureLot(unknownCostProduct, unknownCostLot, 'central', 10, null)
  const unknownCostPayload = validPayload(`${prefix}-unknown-cost-batch`, unknownCostProduct, [{ lotId: unknownCostLot, quantity: 10, measuredNetWeightG: 10000 }])
  const unknownCostResult = await run(ids.admin, 'confirmProcessingBatch', unknownCostPayload, `${prefix}-unknown-cost-op`)
  const unknownCostBatch = await read('distProcessingBatches', unknownCostPayload.batchId)
  pass(unknownCostResult.status === 'confirmed' && unknownCostBatch.sourceCostCents === null && unknownCostBatch.destinations.every(d => d.costCents === null && d.sourceAllocations.every(allocation => allocation.costCents === null)) && (await read('distLots', unknownCostBatch.result.derivedLots[0].lotId)).productionCost === null, 'costo histórico desconocido permanece null en batch, asignaciones y lote; no se sustituye con el catálogo')

  const packageSourceProduct = `${prefix}-package-source`, packageSourceLot = `${prefix}-package-source-lot`
  await fixtureProduct(packageSourceProduct, 'package', 9, 0.5)
  await root.collection('distLots').doc(packageSourceLot).set({ id: packageSourceLot, restaurantId: 'sanjose', productId: packageSourceProduct, productName: 'QA paquete', unitType: 'package', lotCode: 'PKGS', manufacturedOn: '2026-10-10', expiresOn: '2027-10-10', productionCost: 9, quantities: { central: 20 } })
  await root.collection('distBalances').doc(`central__${packageSourceProduct}`).set({ id: `central__${packageSourceProduct}`, restaurantId: 'sanjose', productId: packageSourceProduct, locationKind: 'central', warehouseId: 'central', unitType: 'package', quantity: 20 })
  const packageSource = await run(ids.admin, 'confirmProcessingBatch', validPayload(`${prefix}-package-source-batch`, packageSourceProduct), `${prefix}-package-source-op`, 'rejected')
  pass(packageSource.error.includes('solo consume producto de origen medido en kg') && (await read('distBalances', `central__${packageSourceProduct}`)).quantity === 20, 'fuente por paquete se rechaza sin inferir peso desde approximateWeightKg')

  const rejectSourceCase = async (label, lotExtra, expectedText, requestedQuantity = 10) => {
    const productId = `${prefix}-${label}-source`, lotId = `${prefix}-${label}-lot`, batchId = `${prefix}-${label}-batch`
    await fixtureProduct(productId, 'kg', 3); await fixtureLot(productId, lotId, 'central', 10, 3, lotExtra)
    const rejectedPayload = validPayload(batchId, productId, [{ lotId, quantity: requestedQuantity, measuredNetWeightG: Math.round(requestedQuantity * 1000) }])
    rejectedPayload.inputWeightG = Math.round(requestedQuantity * 1000)
    rejectedPayload.destinations[0].netWeightG = rejectedPayload.inputWeightG - 1000
    rejectedPayload.destinations[0].commercialQuantity = (rejectedPayload.inputWeightG - 1000) / 250
    const rejected = await run(ids.admin, 'confirmProcessingBatch', rejectedPayload, `${prefix}-${label}-op`, 'rejected')
    pass(rejected.error.includes(expectedText) && (await read('distBalances', `central__${productId}`)).quantity === 10 && (await read('distLots', lotId)).quantities.central === 10 && !(await root.collection('distProcessingBatches').doc(batchId).get()).exists && (await root.collection('distStockMovements').where('batchId', '==', batchId).get()).empty, `${label}: rechazo sin escrituras parciales (${rejected.error})`)
  }
  await rejectSourceCase('synthetic', { synthetic: true }, 'sintético')
  await rejectSourceCase('expired', { expiresOn: '2026-10-27' }, 'vencido')
  await rejectSourceCase('quarantined', { quarantined: true }, 'vencido, en cuarentena')
  await rejectSourceCase('pending-origin', { pendingOrigins: { central: [{ exceptionId: `${prefix}-pending-origin`, accountingLotId: `${prefix}-pending-origin-lot`, sourceMovementId: 'accounting-only-reference', physicalOriginConfirmed: false, quantity: 1 }] } }, 'origen físico pendiente')
  await rejectSourceCase('insufficient', {}, 'no tiene cantidad libre suficiente', 11)

  const wrongSkuProduct = `${prefix}-wrong-sku`
  await fixtureProduct(wrongSkuProduct, 'kg', 3); await fixtureLot(wrongSkuProduct, `${prefix}-wrong-sku-lot`, 'central', 10, 3)
  const wrongSkuPayload = validPayload(`${prefix}-wrong-sku-batch`, ids.source, [{ lotId: `${prefix}-wrong-sku-lot`, quantity: 10, measuredNetWeightG: 10000 }])
  const wrongSku = await run(ids.admin, 'confirmProcessingBatch', wrongSkuPayload, `${prefix}-wrong-sku-op`, 'rejected')
  pass(wrongSku.error.includes('no pertenece al SKU de origen') && (await read('distBalances', `central__${wrongSkuProduct}`)).quantity === 10, 'rechaza asignar a Viena un lote de otro SKU aunque coincida la cantidad')

  const missingProductPayload = validPayload(`${prefix}-missing-target-batch`)
  missingProductPayload.destinations[0].productId = `${prefix}-missing-target`
  const missingTarget = await run(ids.admin, 'confirmProcessingBatch', missingProductPayload, `${prefix}-missing-target-op`, 'rejected')
  pass(missingTarget.status === 'rejected' && (await read('distBalances', `central__${ids.source}`)).quantity === 0 && (await root.collection('distStockMovements').where('refId', '==', missingTarget.operationId).get()).empty, 'SKU terminado no configurado se rechaza antes de consumir el origen o escribir movimientos')

  const discardPayload = validPayload(`${prefix}-warehouse-discard`)
  discardPayload.destinations = [{ id: 'warehouse-finished', kind: 'finished', productId: ids.package, commercialQuantity: 36, netWeightG: 9700, nominalWeightG: 250, weightBasis: 'documented_average', lotCode: `SACH-${prefix}-warehouse-discard`, manufacturedOn: '2026-10-28', packagedOn: '2026-10-28', expiresOn: '2027-01-10' }, { id: 'warehouse-discard', kind: 'discard', netWeightG: 300, reason: 'QA descarte sin aprobación' }]
  const warehouseLoc = `warehouse__${ids.warehouseId}`
  const warehouseSource = `${prefix}-warehouse-source`, warehouseLot = `${prefix}-warehouse-source-lot`
  await fixtureProduct(warehouseSource, 'kg', 1); await fixtureLot(warehouseSource, warehouseLot, warehouseLoc, 10, 1)
  discardPayload.sourceProductId = warehouseSource; discardPayload.location = warehouseLoc; discardPayload.sourceAllocations = [{ lotId: warehouseLot, quantity: 10, measuredNetWeightG: 10000 }]
  const warehouseDiscard = await run(ids.warehouse, 'confirmProcessingBatch', discardPayload, `${prefix}-warehouse-discard-op`, 'rejected')
  pass(warehouseDiscard.error.includes('descarte real requiere aprobación directa') && (await read('distBalances', `${warehouseLoc}__${warehouseSource}`)).quantity === 10, 'Almacén no puede confirmar descarte real sin aprobación administrativa')

  const warehouseValid = validPayload(`${prefix}-warehouse-valid`, warehouseSource, [{ lotId: warehouseLot, quantity: 10, measuredNetWeightG: 10000 }])
  warehouseValid.location = warehouseLoc
  warehouseValid.destinations = [{ id: 'warehouse-output', kind: 'finished', productId: ids.package, commercialQuantity: 40, netWeightG: 10000, nominalWeightG: 250, weightBasis: 'documented_average', lotCode: `SACH-${prefix}-warehouse-valid`, manufacturedOn: '2026-10-28', packagedOn: '2026-10-28', expiresOn: '2027-01-10' }]
  const warehouseConfirmed = await run(ids.warehouse, 'confirmProcessingBatch', warehouseValid, `${prefix}-warehouse-valid-op`)
  pass(warehouseConfirmed.status === 'confirmed', 'Almacén puede confirmar elaboración permitida dentro de su almacén asignado')

  const directBatchRef = doc(authDb(ids.admin), 'restaurants', 'sanjose', 'distProcessingBatches', `${prefix}-direct`)
  const directBatch = await assertFails(setDoc(directBatchRef, { id: `${prefix}-direct`, sourceLocation: 'central' })); void directBatch
  await assertFails(setDoc(doc(authDb(ids.distributor), 'restaurants', 'sanjose', 'distOperations', `${prefix}-seller-batch`), { id: `${prefix}-seller-batch`, restaurantId: 'sanjose', createdBy: ids.distributor, createdAt: new Date().toISOString(), type: 'confirmProcessingBatch', payload: validPayload(`${prefix}-seller`), status: 'queued' }))
  await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), 'restaurants', 'sanjose', 'distOperations', `${prefix}-anon-batch`), { id: `${prefix}-anon-batch`, restaurantId: 'sanjose', createdBy: ids.admin, type: 'confirmProcessingBatch', payload: validPayload(`${prefix}-anon`), status: 'queued' }))
  await assertFails(setDoc(doc(authDb(ids.admin), 'restaurants', 'otro-tenant', 'distOperations', `${prefix}-cross-tenant`), { id: `${prefix}-cross-tenant`, restaurantId: 'otro-tenant', createdBy: ids.admin, createdAt: new Date().toISOString(), type: 'confirmProcessingBatch', payload: validPayload(`${prefix}-cross-tenant-batch`), status: 'queued' }))
  await assertFails(setDoc(doc(authDb(ids.admin), 'restaurants', 'sanjose', 'distLots', `${prefix}-direct-lot`), { id: `${prefix}-direct-lot` }))
  const batchForRead = await getDoc(doc(authDb(ids.warehouse), 'restaurants', 'sanjose', 'distProcessingBatches', warehouseValid.batchId))
  pass(batchForRead.exists(), 'Rules permiten al almacén autorizado consultar su elaboración y bloquean escrituras directas')
  const adminBatchPage = await getDocs(query(collection(authDb(ids.admin), 'restaurants', 'sanjose', 'distProcessingBatches'), orderBy('createdAt', 'desc'), limit(20)))
  pass(adminBatchPage.docs.some(row => row.id === warehouseValid.batchId), 'Administración puede consultar historial paginado de elaboraciones')
  const warehouseBatchPage = await getDocs(query(collection(authDb(ids.warehouse), 'restaurants', 'sanjose', 'distProcessingBatches'), where('sourceLocation', '==', warehouseLoc), orderBy('createdAt', 'desc'), limit(20)))
  pass(warehouseBatchPage.docs.some(row => row.id === warehouseValid.batchId), 'Almacén puede consultar historial paginado exclusivamente de su ubicación')
  await assertFails(getDocs(query(collection(authDb(ids.warehouse), 'restaurants', 'sanjose', 'distProcessingBatches'), orderBy('createdAt', 'desc'), limit(20))))
  await assertFails(getDocs(query(collection(authDb(ids.otherWarehouse), 'restaurants', 'sanjose', 'distProcessingBatches'), where('sourceLocation', '==', warehouseLoc), orderBy('createdAt', 'desc'), limit(20))))
  await assertFails(getDocs(query(collection(authDb(ids.distributor), 'restaurants', 'sanjose', 'distProcessingBatches'), orderBy('createdAt', 'desc'), limit(20))))
  const reservationReadId = `${prefix}-reservation-read`
  await root.collection('distStockReservations').doc(reservationReadId).set({ id: reservationReadId, location: warehouseLoc, createdAt: new Date().toISOString() })
  const warehouseReservationPage = await getDocs(query(collection(authDb(ids.warehouse), 'restaurants', 'sanjose', 'distStockReservations'), where('location', '==', warehouseLoc), orderBy('createdAt', 'desc'), limit(20)))
  pass(warehouseReservationPage.docs.some(row => row.id === reservationReadId), 'Almacén puede consultar reservas paginadas solo de su ubicación')
  await assertFails(getDoc(doc(authDb(ids.warehouse), 'restaurants', 'sanjose', 'distProcessingBatches', batchId)))
  await assertFails(getDoc(doc(authDb(ids.otherWarehouse), 'restaurants', 'sanjose', 'distProcessingBatches', warehouseValid.batchId)))

  const saleRaceProduct = `${prefix}-sale-race-source`, saleRaceLot = `${prefix}-sale-race-lot`
  await fixtureProduct(saleRaceProduct, 'kg', 1); await fixtureLot(saleRaceProduct, saleRaceLot, 'central', 10, 1)
  const saleRaceBatch = validPayload(`${prefix}-sale-race-batch`, saleRaceProduct, [{ lotId: saleRaceLot, quantity: 8, measuredNetWeightG: 8000 }])
  saleRaceBatch.inputWeightG = 8000
  saleRaceBatch.destinations[0].commercialQuantity = 28; saleRaceBatch.destinations[0].netWeightG = 7000
  const concurrentSalePayload = { sourceLocation: 'centralWarehouse', routeId: 'administracion', routeName: 'Administración', lines: [{ productId: saleRaceProduct, quantity: 5, actualUnitPrice: 10 }], cashAmount: 50, qrAmount: 0, creditAmount: 0, paymentKind: 'cash' }
  const competing = await Promise.all([
    run(ids.admin, 'confirmProcessingBatch', saleRaceBatch, `${prefix}-sale-race-batch-op`, null),
    run(ids.admin, 'sale', concurrentSalePayload, `${prefix}-sale-race-sale-op`, null),
  ])
  const raceFinalBalance = (await read('distBalances', `central__${saleRaceProduct}`)).quantity
  pass(competing.filter(op => op.status === 'confirmed').length === 1 && competing.filter(op => op.status === 'rejected').length === 1 && (raceFinalBalance === 2 || raceFinalBalance === 5) && raceFinalBalance >= 0, 'venta y elaboración concurrentes no consumen dos veces el mismo stock ni dejan saldo negativo')

  const raceProduct = `${prefix}-race-source`, raceLot = `${prefix}-race-lot`
  await fixtureProduct(raceProduct, 'kg', 1); await fixtureLot(raceProduct, raceLot, 'central', 10, 1)
  const raceOne = validPayload(`${prefix}-race-batch-one`, raceProduct, [{ lotId: raceLot, quantity: 8, measuredNetWeightG: 8000 }])
  const raceTwo = validPayload(`${prefix}-race-batch-two`, raceProduct, [{ lotId: raceLot, quantity: 8, measuredNetWeightG: 8000 }])
  for (const racePayload of [raceOne, raceTwo]) {
    racePayload.inputWeightG = 8000
    racePayload.destinations[0].commercialQuantity = 28
    racePayload.destinations[0].netWeightG = 7000
  }
  const raced = await Promise.all([run(ids.admin, 'confirmProcessingBatch', raceOne, `${prefix}-race-operation-one`, null), run(ids.admin, 'confirmProcessingBatch', raceTwo, `${prefix}-race-operation-two`, null)])
  pass(raced.filter(op => op.status === 'confirmed').length === 1 && raced.filter(op => op.status === 'rejected').length === 1 && (await read('distBalances', `central__${raceProduct}`)).quantity === 2, 'elaboraciones concurrentes sobre el mismo lote serializan consumo y no dejan saldo negativo')

  const retryProduct = `${prefix}-same-batch-race-source`, retryLot = `${prefix}-same-batch-race-lot`, retryBatchId = `${prefix}-same-batch-race`
  await fixtureProduct(retryProduct, 'kg', 1); await fixtureLot(retryProduct, retryLot, 'central', 10, 1)
  const retryPayloadA = validPayload(retryBatchId, retryProduct, [{ lotId: retryLot, quantity: 10, measuredNetWeightG: 10000 }])
  const retryPayloadB = structuredClone(retryPayloadA)
  const sameBatchRace = await Promise.all([run(ids.admin, 'confirmProcessingBatch', retryPayloadA, `${prefix}-same-batch-race-op-a`, null), run(ids.admin, 'confirmProcessingBatch', retryPayloadB, `${prefix}-same-batch-race-op-b`, null)])
  const sameBatchMovements = await root.collection('distStockMovements').where('batchId', '==', retryBatchId).get()
  pass(sameBatchRace.every(op => op.status === 'confirmed') && sameBatchRace.filter(op => op.result?.duplicate).length === 1 && (await read('distBalances', `central__${retryProduct}`)).quantity === 0 && sameBatchMovements.docs.filter(s => s.data().type === 'processing_consumption').length === 1, 'dos operationId concurrentes con batchId y huella iguales confirman una sola elaboración y un solo consumo')
  console.log(`processing batches emulator: ${checks} checks PASS`)
} finally {
  await env.cleanup()
  await adminApp.delete()
}
