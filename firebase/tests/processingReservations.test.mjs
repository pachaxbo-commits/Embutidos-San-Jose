// End-to-end reservation operations and Security Rules tests; emulator only.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing'
import { collection, doc, setDoc, getDoc } from 'firebase/firestore'

const req = createRequire(new URL('../../functions/package.json', import.meta.url))
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085'
const { initializeApp } = req('firebase-admin/app')
const { getFirestore } = req('firebase-admin/firestore')
const { processCommand } = req('./operations.cjs')
const projectId = 'demo-pachax-audit'
const adminApp = initializeApp({ projectId }, 'qa-processing-reservations')
const db = getFirestore(adminApp)
const root = db.doc('restaurants/sanjose')
const env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8085, rules: fs.readFileSync('firebase/firestore.rules', 'utf8') } })
const prefix = `rs${Date.now().toString(36)}`
const ids = { admin: `${prefix}-admin`, warehouse: `${prefix}-warehouse`, distributor: `${prefix}-distributor`, product: `${prefix}-product`, lot: `${prefix}-lot`, route: `${prefix}-route`, warehouseId: `${prefix}-wh` }
let checks = 0
const pass = (condition, message) => { assert.ok(condition, message); checks++; console.log(`PASS ${message}`) }
const queueDb = uid => env.authenticatedContext(uid).firestore()
async function command(actor, type, payload, operationId = `${prefix}-${type}-${Math.random().toString(36).slice(2)}`, expected = 'confirmed') {
  const ref = root.collection('distOperations').doc(operationId)
  await setDoc(doc(queueDb(actor), 'restaurants', 'sanjose', 'distOperations', operationId), { id: operationId, restaurantId: 'sanjose', createdBy: actor, createdAt: new Date().toISOString(), type, payload, status: 'queued' })
  await processCommand(db, ref)
  const operation = (await ref.get()).data()
  if (expected) assert.equal(operation.status, expected, `${type}: ${operation.error || 'estado inesperado'}`)
  return operation
}
const balanceRef = () => root.collection('distBalances').doc(`central__${ids.product}`)
async function seedLot(productId, lotId, quantity, lotFields = {}, unitType = 'kg', location = 'central') {
  await root.collection('distProducts').doc(productId).set({ id: productId, restaurantId: 'sanjose', name: `QA ${productId}`, unitType, active: true, productionCost: 4, referencePrice: 8 })
  await root.collection('distLots').doc(lotId).set({ id: lotId, restaurantId: 'sanjose', productId, unitType, lotCode: `QA-${lotId}`, manufacturedOn: '2026-10-01', expiresOn: '2027-10-01', productionCost: 4, quantities: { [location]: quantity }, ...lotFields })
  await root.collection('distBalances').doc(`${location}__${productId}`).set({ id: `${location}__${productId}`, restaurantId: 'sanjose', locationKind: location === 'central' ? 'central' : 'warehouse', warehouseId: location === 'central' ? 'central' : location.slice(11), productId, unitType, quantity })
}

try {
  await root.collection('members').doc(ids.admin).set({ role: 'admin', active: true, displayName: 'QA Admin' })
  await root.collection('members').doc(ids.warehouse).set({ role: 'warehouse', active: true, warehouseId: ids.warehouseId, displayName: 'QA Almacén' })
  await root.collection('members').doc(ids.distributor).set({ role: 'distributor', active: true, routeId: ids.route, displayName: 'QA Distribuidor' })
  const otherTenantAdmin = `${prefix}-other-admin`
  await db.doc(`restaurants/other/members/${otherTenantAdmin}`).set({ role: 'admin', active: true })
  await root.collection('distProducts').doc(ids.product).set({ id: ids.product, restaurantId: 'sanjose', name: 'Producto ficticio reserva', unitType: 'kg', active: true, productionCost: 12, referencePrice: 20 })
  await root.collection('distWarehouses').doc(ids.warehouseId).set({ id: ids.warehouseId, restaurantId: 'sanjose', active: true, name: 'QA' })
  await root.collection('distLots').doc(ids.lot).set({ id: ids.lot, restaurantId: 'sanjose', productId: ids.product, productName: 'Producto ficticio reserva', unitType: 'kg', lotCode: 'QA-RES', manufacturedOn: '2026-10-01', expiresOn: '2027-10-01', productionCost: 12, quantities: { central: 20 }, createdAt: new Date().toISOString(), createdBy: ids.admin })
  await balanceRef().set({ id: `central__${ids.product}`, restaurantId: 'sanjose', locationKind: 'central', warehouseId: 'central', productId: ids.product, productName: 'Producto ficticio reserva', unitType: 'kg', quantity: 20, updatedAt: new Date().toISOString() })

  const reserveId = `${prefix}-courtesy-reservation`
  const reserveOperationId = `${prefix}-reserve-op`
  const reserve = await command(ids.admin, 'reserveProcessingStock', { reservationId: reserveId, productId: ids.product, lotId: ids.lot, location: 'central', purpose: 'courtesy', quantity: 2, reason: 'QA reservado' }, reserveOperationId)
  pass(reserve.result.quantity === 2 && reserve.result.physicalQuantity === 20 && reserve.result.availableQuantity === 18, 'reserva 2 kg cambia disponibilidad, no existencia física')
  // Replaying the exact confirmed command is a no-op; its stable operation id remains the idempotency key.
  await processCommand(db, root.collection('distOperations').doc(reserveOperationId))
  const lotAfterReserve = (await root.collection('distLots').doc(ids.lot).get()).data()
  const reservation = (await root.collection('distStockReservations').doc(reserveId).get()).data()
  pass(lotAfterReserve.processingUnavailable.central.courtesy === 2 && reservation.remainingQuantity === 2, 'documento y agregado de reserva concilian')

  await assertFails(setDoc(doc(queueDb(ids.distributor), 'restaurants', 'sanjose', 'distOperations', `${prefix}-forbidden-reserve`), { id: `${prefix}-forbidden-reserve`, restaurantId: 'sanjose', createdBy: ids.distributor, createdAt: new Date().toISOString(), type: 'reserveProcessingStock', payload: {}, status: 'queued' })); checks++
  await assertFails(setDoc(doc(queueDb(ids.admin), 'restaurants', 'sanjose', 'distStockReservations', `${prefix}-direct-write`), { id: `${prefix}-direct-write` })); checks++
  await assertFails(setDoc(doc(queueDb(ids.admin), 'restaurants', 'sanjose', 'distLots', ids.lot), { ...lotAfterReserve, processingUnavailable: {} })); checks++
  await assertFails(setDoc(doc(queueDb(ids.admin), 'restaurants', 'sanjose', 'distBalances', `central__${ids.product}`), { quantity: 0 })); checks++
  await assertFails(setDoc(doc(queueDb(ids.admin), 'restaurants', 'sanjose', 'distStockMovements', `${prefix}-direct-movement`), { quantity: 1 })); checks++
  await assertFails(setDoc(doc(queueDb(otherTenantAdmin), 'restaurants', 'sanjose', 'distOperations', `${prefix}-cross-tenant`), { id: `${prefix}-cross-tenant`, restaurantId: 'sanjose', createdBy: otherTenantAdmin, type: 'reserveProcessingStock', payload: {}, status: 'queued' })); checks++
  await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), 'restaurants', 'sanjose', 'distOperations', `${prefix}-unauth`), { id: `${prefix}-unauth`, restaurantId: 'sanjose', createdBy: ids.admin, type: 'reserveProcessingStock', payload: {}, status: 'queued' })); checks++
  pass(true, 'Rules bloquean distribuidor y escrituras directas de reservas/lotes')

  // Two concurrent reservations must conflict on the shared lot document so
  // their combined unavailable quantity can never exceed physical stock.
  const raceProduct = `${prefix}-race-product`, raceLot = `${prefix}-race-lot`
  await root.collection('distProducts').doc(raceProduct).set({ id: raceProduct, restaurantId: 'sanjose', name: 'Producto ficticio concurrencia', unitType: 'kg', active: true, productionCost: 4, referencePrice: 8 })
  await root.collection('distLots').doc(raceLot).set({ id: raceLot, restaurantId: 'sanjose', productId: raceProduct, unitType: 'kg', lotCode: 'QA-RACE', manufacturedOn: '2026-10-01', expiresOn: '2027-10-01', productionCost: 4, quantities: { central: 10 } })
  await root.collection('distBalances').doc(`central__${raceProduct}`).set({ id: `central__${raceProduct}`, restaurantId: 'sanjose', locationKind: 'central', warehouseId: 'central', productId: raceProduct, unitType: 'kg', quantity: 10 })
  const reservationRace = await Promise.all([
    command(ids.admin, 'reserveProcessingStock', { productId: raceProduct, lotId: raceLot, location: 'central', purpose: 'courtesy', quantity: 6, reason: 'QA simultánea A' }, `${prefix}-race-reserve-a`, null),
    command(ids.admin, 'reserveProcessingStock', { productId: raceProduct, lotId: raceLot, location: 'central', purpose: 'courtesy', quantity: 6, reason: 'QA simultánea B' }, `${prefix}-race-reserve-b`, null),
  ])
  pass(reservationRace.filter(op => op.status === 'confirmed').length === 1 && reservationRace.filter(op => op.status === 'rejected').length === 1, 'reservas simultáneas no apartan más del stock físico')
  const raceLotAfter = (await root.collection('distLots').doc(raceLot).get()).data()
  const raceReservations = await root.collection('distStockReservations').where('lotId', '==', raceLot).get()
  pass(raceLotAfter.quantities.central === 10 && raceLotAfter.processingUnavailable.central.courtesy === 6 && raceReservations.docs.filter(d => ['active','partially_consumed'].includes(d.data().status)).reduce((n,d) => n + d.data().remainingQuantity, 0) === 6, 'transacción concurrente mantiene agregado, documentos y físico consistentes')
  await command(ids.admin, 'sale', { sourceLocation: 'centralWarehouse', routeId: 'administracion', routeName: 'Administración', lines: [{ productId: raceProduct, quantity: 5, actualUnitPrice: 8 }], cashAmount: 40, qrAmount: 0, creditAmount: 0, paymentKind: 'cash' }, `${prefix}-race-sale-blocked`, 'rejected')

  const mixedProduct = `${prefix}-mixed-product`, mixedLot = `${prefix}-mixed-lot`
  await root.collection('distProducts').doc(mixedProduct).set({ id: mixedProduct, restaurantId: 'sanjose', name: 'Producto ficticio venta-reserva', unitType: 'kg', active: true, productionCost: 4, referencePrice: 8 })
  await root.collection('distLots').doc(mixedLot).set({ id: mixedLot, restaurantId: 'sanjose', productId: mixedProduct, unitType: 'kg', lotCode: 'QA-MIXED', manufacturedOn: '2026-10-01', expiresOn: '2027-10-01', productionCost: 4, quantities: { central: 10 } })
  await root.collection('distBalances').doc(`central__${mixedProduct}`).set({ id: `central__${mixedProduct}`, restaurantId: 'sanjose', locationKind: 'central', warehouseId: 'central', productId: mixedProduct, unitType: 'kg', quantity: 10 })
  const saleReserveRace = await Promise.all([
    command(ids.admin, 'reserveProcessingStock', { productId: mixedProduct, lotId: mixedLot, location: 'central', purpose: 'courtesy', quantity: 6, reason: 'QA venta-reserva' }, `${prefix}-mixed-reserve`, null),
    command(ids.admin, 'sale', { sourceLocation: 'centralWarehouse', routeId: 'administracion', routeName: 'Administración', lines: [{ productId: mixedProduct, quantity: 6, actualUnitPrice: 8 }], cashAmount: 48, qrAmount: 0, creditAmount: 0, paymentKind: 'cash' }, `${prefix}-mixed-sale`, null),
  ])
  pass(saleReserveRace.filter(op => op.status === 'confirmed').length === 1 && saleReserveRace.filter(op => op.status === 'rejected').length === 1, 'venta y reserva simultáneas compiten por el mismo saldo sin sobreasignarlo')
  const mixedLotAfter = (await root.collection('distLots').doc(mixedLot).get()).data()
  const mixedBalanceAfter = (await root.collection('distBalances').doc(`central__${mixedProduct}`).get()).data()
  const mixedHeld = Object.values(mixedLotAfter.processingUnavailable?.central || {}).reduce((n,q) => n + Number(q || 0), 0)
  const mixedSales = await root.collection('distSales').get()
  const mixedConsumed = mixedSales.docs.map(d => d.data()).filter(sale => sale.lines?.some(line => line.productId === mixedProduct)).reduce((sum,sale) => sum + sale.lines.filter(line => line.productId === mixedProduct).reduce((n,line) => n + line.quantity, 0), 0)
  pass(mixedLotAfter.quantities.central === 10 - mixedConsumed && mixedConsumed + mixedHeld <= 10 && mixedBalanceAfter.quantity === mixedLotAfter.quantities.central, 'venta-reserva simultánea preserva balance y no sobreasigna físico')

  for (const [suffix, fields] of [
    ['expired', { expiresOn: '2026-10-27' }],
    ['quarantine', { quarantined: true }],
    ['synthetic', { legacy: true, lotCode: 'ANTERIOR SIN FECHAS', manufacturedOn: '', expiresOn: '' }],
    ['pending-origin', { pendingOrigins: { central: [{ exceptionId: `${prefix}-exception`, accountingLotId: `${prefix}-pending-origin-lot`, physicalOriginConfirmed: false, quantity: 0.5 }] } }],
  ]) {
    const productId = `${prefix}-${suffix}-product`, lotId = `${prefix}-${suffix}-lot`
    await seedLot(productId, lotId, 1, fields)
    const rejected = await command(ids.admin, 'reserveProcessingStock', { productId, lotId, location: 'central', purpose: 'courtesy', quantity: 0.5, reason: 'QA no reservable' }, `${prefix}-${suffix}-reserve`, 'rejected')
    pass(rejected.status === 'rejected' && !(await root.collection('distStockReservations').doc(`${prefix}-${suffix}-reserve__reservation`).get()).exists, `reserva rechaza lote ${suffix} sin escrituras parciales`)
  }

  const unitProduct = `${prefix}-unit-product`, unitLot = `${prefix}-unit-lot`
  await seedLot(unitProduct, unitLot, 3, {}, 'unit')
  const fractionalUnit = await command(ids.admin, 'reserveProcessingStock', { productId: unitProduct, lotId: unitLot, location: 'central', purpose: 'courtesy', quantity: 0.5 }, `${prefix}-fractional-unit`, 'rejected')
  pass(fractionalUnit.status === 'rejected' && (await root.collection('distBalances').doc(`central__${unitProduct}`).get()).data().quantity === 3, 'paquetes/unidades no aceptan reservas fraccionarias')
  const exactUnitReservationId = `${prefix}-unit-reservation__reservation`
  await command(ids.admin, 'reserveProcessingStock', { reservationId: exactUnitReservationId, productId: unitProduct, lotId: unitLot, location: 'central', purpose: 'courtesy', quantity: 2 }, `${prefix}-unit-reserve`)
  pass((await root.collection('distStockReservations').doc(exactUnitReservationId).get()).data().physicalWeightG === null, 'reservar unidades no inventa gramos a partir del peso aproximado')

  const driftProduct = `${prefix}-drift-product`, driftLot = `${prefix}-drift-lot`, driftReservation = `${prefix}-drift-reservation`
  await seedLot(driftProduct, driftLot, 5, { processingUnavailable: { central: { courtesy: 0, repackPending: 0, reviewHold: 0 } } })
  await root.collection('distStockReservations').doc(driftReservation).set({ id: driftReservation, restaurantId: 'sanjose', productId: driftProduct, lotId: driftLot, location: 'central', purpose: 'courtesy', originalQuantity: 2, remainingQuantity: 2, consumedQuantity: 0, status: 'active' })
  const driftSale = await command(ids.admin, 'sale', { sourceLocation: 'centralWarehouse', routeId: 'administracion', routeName: 'Administración', lines: [{ productId: driftProduct, quantity: 1, actualUnitPrice: 8 }], cashAmount: 8, qrAmount: 0, creditAmount: 0, paymentKind: 'cash' }, `${prefix}-drift-sale`, 'rejected')
  pass(driftSale.error.includes('no concilian') && (await root.collection('distBalances').doc(`central__${driftProduct}`).get()).data().quantity === 5, 'consumidor rechaza agregado desincronizado sin ocultar reservas')

  await root.collection('distLots').doc(`${prefix}-wh-lot`).set({ id: `${prefix}-wh-lot`, restaurantId: 'sanjose', productId: ids.product, unitType: 'kg', lotCode: 'QA-WH', manufacturedOn: '2026-10-01', expiresOn: '2027-10-01', productionCost: 12, quantities: { [`warehouse__${ids.warehouseId}`]: 1 } })
  await root.collection('distBalances').doc(`warehouse__${ids.warehouseId}__${ids.product}`).set({ id: `warehouse__${ids.warehouseId}__${ids.product}`, restaurantId: 'sanjose', locationKind: 'warehouse', warehouseId: ids.warehouseId, productId: ids.product, unitType: 'kg', quantity: 1 })
  const warehouseReservationId = `${prefix}-warehouse-reservation__reservation`
  const warehouseReservation = await command(ids.warehouse, 'reserveProcessingStock', { reservationId: warehouseReservationId, productId: ids.product, lotId: `${prefix}-wh-lot`, location: `warehouse__${ids.warehouseId}`, purpose: 'courtesy', quantity: 0.5, reason: 'QA scope warehouse' }, `${prefix}-warehouse-reserve`)
  pass(warehouseReservation.status === 'confirmed' && (await root.collection('distBalances').doc(`warehouse__${ids.warehouseId}__${ids.product}`).get()).data().quantity === 1, 'Almacén reserva solo en su ubicación y sin mover físico')
  const warehouseReservationSnapshot = await getDoc(doc(queueDb(ids.warehouse), 'restaurants', 'sanjose', 'distStockReservations', warehouseReservationId))
  pass(warehouseReservationSnapshot.exists(), 'Rules permiten a Almacén consultar la reserva de su propio almacén')
  const crossWarehouse = await command(ids.warehouse, 'reserveProcessingStock', { productId: ids.product, lotId: ids.lot, location: 'central', purpose: 'courtesy', quantity: 1 }, `${prefix}-warehouse-cross-location`, 'rejected')
  pass(crossWarehouse.status === 'rejected', 'Almacén no puede reservar fuera de su almacén autorizado')
  await assertFails(setDoc(doc(queueDb(ids.warehouse), 'restaurants', 'sanjose', 'distOperations', `${prefix}-warehouse-release`), { id: `${prefix}-warehouse-release`, restaurantId: 'sanjose', createdBy: ids.warehouse, type: 'releaseProcessingReservation', payload: {}, status: 'queued' })); checks++
  await assertFails(setDoc(doc(queueDb(ids.warehouse), 'restaurants', 'sanjose', 'distOperations', `${prefix}-warehouse-deliver`), { id: `${prefix}-warehouse-deliver`, restaurantId: 'sanjose', createdBy: ids.warehouse, type: 'deliverReservedCourtesy', payload: {}, status: 'queued' })); checks++

  await command(ids.admin, 'sale', { sourceLocation: 'centralWarehouse', routeId: 'administracion', routeName: 'Administración', lines: [{ productId: ids.product, quantity: 19, actualUnitPrice: 20 }], cashAmount: 380, qrAmount: 0, creditAmount: 0, paymentKind: 'cash' }, `${prefix}-sale-over`, 'rejected')
  await command(ids.admin, 'transfer', { from: 'central', to: ids.warehouseId, line: { productId: ids.product, quantity: 19 }, note: 'QA excede stock libre' }, `${prefix}-transfer-over`, 'rejected')
  await command(ids.admin, 'adjustment', { warehouseId: 'central', line: { productId: ids.product, quantity: -19 }, note: 'QA excede stock libre' }, `${prefix}-adjust-over`, 'rejected')
  await command(ids.admin, 'dispatch', { warehouseId: 'central', routeId: ids.route, distributorUid: ids.distributor, warehouseResponsibleName: 'QA Almacén', lines: [{ productId: ids.product, quantity: 19, normalQuantity: 19, dispatchMerma: 0, allocationsRequested: [{ lotId: ids.lot, quantity: 19 }] }] }, `${prefix}-dispatch-over`, 'rejected')
  pass((await balanceRef().get()).data().quantity === 20, 'venta, despacho, traslado y ajuste rechazados sin cambio físico parcial')

  const unknownCostProduct = `${prefix}-unknown-cost-product`, unknownCostLot = `${prefix}-unknown-cost-lot`, unknownCostReservation = `${prefix}-unknown-cost-reservation__reservation`
  await seedLot(unknownCostProduct, unknownCostLot, 2, { productionCost: null })
  await command(ids.admin, 'reserveProcessingStock', { reservationId: unknownCostReservation, productId: unknownCostProduct, lotId: unknownCostLot, location: 'central', purpose: 'courtesy', quantity: 1, reason: 'QA costo faltante' }, `${prefix}-unknown-cost-reserve`)
  const unknownCostGift = await command(ids.admin, 'deliverReservedCourtesy', { reservationId: unknownCostReservation, quantity: 1, recipient: 'Cliente QA', reason: 'QA sin costo histórico' }, `${prefix}-unknown-cost-gift`)
  const unknownCostSale = (await root.collection('distSales').doc(unknownCostGift.result.saleId).get()).data()
  pass(unknownCostSale.courtesyCost === null && unknownCostGift.result.costTotal === null, 'cortesía conserva costo no disponible y no sustituye con costo de catálogo')

  await command(ids.admin, 'sale', { sourceLocation: 'centralWarehouse', routeId: 'administracion', routeName: 'Administración', lines: [{ productId: ids.product, quantity: 5, actualUnitPrice: 20 }], cashAmount: 100, qrAmount: 0, creditAmount: 0, paymentKind: 'cash' }, `${prefix}-sale-free`)
  pass((await balanceRef().get()).data().quantity === 15, 'venta de stock libre deja 15 kg físicos')

  const firstGift = await command(ids.admin, 'deliverReservedCourtesy', { reservationId: reserveId, quantity: 0.5, recipient: 'Cliente QA', reason: 'Prueba de entrega' }, `${prefix}-gift-partial`)
  let currentLot = (await root.collection('distLots').doc(ids.lot).get()).data()
  let currentReservation = (await root.collection('distStockReservations').doc(reserveId).get()).data()
  pass(firstGift.result.deliveredQuantity === 0.5 && (await balanceRef().get()).data().quantity === 14.5 && currentLot.processingUnavailable.central.courtesy === 1.5 && currentReservation.remainingQuantity === 1.5, 'entrega parcial descuenta una vez y mantiene 1,5 kg reservados')
  const giftSale = (await root.collection('distSales').doc(firstGift.result.saleId).get()).data()
  pass(giftSale.saleKind === 'courtesy' && giftSale.total === 0 && giftSale.cashAmount === 0 && giftSale.creditAmount === 0 && giftSale.courtesyCost === 6, 'cortesía queda vinculada sin ingreso ni crédito y con costo histórico único')
  await processCommand(db, root.collection('distOperations').doc(`${prefix}-gift-partial`))
  pass((await balanceRef().get()).data().quantity === 14.5, 'reintento de entrega no duplica el descuento')

  const concurrentGifts = await Promise.all([
    command(ids.admin, 'deliverReservedCourtesy', { reservationId: reserveId, quantity: 1, recipient: 'Cliente QA', reason: 'QA cortesía concurrente A' }, `${prefix}-gift-race-a`, null),
    command(ids.admin, 'deliverReservedCourtesy', { reservationId: reserveId, quantity: 1, recipient: 'Cliente QA', reason: 'QA cortesía concurrente B' }, `${prefix}-gift-race-b`, null),
  ])
  pass(concurrentGifts.filter(op => op.status === 'confirmed').length === 1 && concurrentGifts.filter(op => op.status === 'rejected').length === 1, 'entregas de cortesía simultáneas no consumen la reserva dos veces')
  const finalGift = await command(ids.admin, 'deliverReservedCourtesy', { reservationId: reserveId, quantity: 0.5, recipient: 'Cliente QA', reason: 'Entrega final' }, `${prefix}-gift-final`)
  currentLot = (await root.collection('distLots').doc(ids.lot).get()).data()
  currentReservation = (await root.collection('distStockReservations').doc(reserveId).get()).data()
  pass(finalGift.result.remainingQuantity === 0 && currentReservation.status === 'consumed' && currentLot.processingUnavailable.central.courtesy === 0 && (await balanceRef().get()).data().quantity === 13, 'entrega total consume reserva y físico una sola vez')

  const releaseId = `${prefix}-release-reservation`
  await command(ids.admin, 'reserveProcessingStock', { reservationId: releaseId, productId: ids.product, lotId: ids.lot, location: 'central', purpose: 'repack_pending', quantity: 1, reason: 'Pendiente reenvasado' })
  await command(ids.admin, 'releaseProcessingReservation', { reservationId: releaseId, reason: 'Ya no requiere reenvasado' }, `${prefix}-release-op`)
  currentLot = (await root.collection('distLots').doc(ids.lot).get()).data()
  pass(currentLot.processingUnavailable.central.repackPending === 0 && (await balanceRef().get()).data().quantity === 13, 'liberar devuelve disponibilidad sin alterar físico')
  await processCommand(db, root.collection('distOperations').doc(`${prefix}-release-op`))
  await command(ids.admin, 'releaseProcessingReservation', { reservationId: releaseId, reason: 'Reintento' }, `${prefix}-release-again`, 'rejected')

  const events = await root.collection('distStockMovements').where('productId', '==', ids.product).get()
  const reservationEvents = events.docs.map(d => d.data()).filter(m => ['reservation_created','reservation_released'].includes(m.type))
  pass(reservationEvents.length === 4 && reservationEvents.every(m => m.centralDelta === 0 && m.routeDelta === 0), 'eventos de reserva en Kardex tienen delta físico cero')
  pass(reservationEvents.every(m => m.fromLocation === m.toLocation), 'reserva/liberación conservan ubicación y no alteran saldo Kardex')
  pass(currentLot.quantities.central === 13 && (await balanceRef().get()).data().quantity === 13, 'balance y suma de lotes mantienen conciliación final')
  console.log(`processing reservations emulator: ${checks} checks PASS`)
} finally {
  await env.cleanup()
  await adminApp.delete()
}
