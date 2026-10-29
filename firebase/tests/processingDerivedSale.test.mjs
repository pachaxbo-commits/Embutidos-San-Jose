// Fase 3D.2A: commercial consumption of derived sachets, isolated to Firebase Emulator.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'
import { computeProductProfitReport } from '../../src/modules/distribution/domain/productProfit.ts'
import { computeOperatingResult } from '../../src/modules/distribution/domain/operatingResult.ts'

const req = createRequire(new URL('../../functions/package.json', import.meta.url))
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085'
delete process.env.FUNCTIONS_EMULATOR
delete process.env.SANJOSE_DERIVED_SALES_EMULATOR_TEST
const { initializeApp } = req('firebase-admin/app')
const { getFirestore } = req('firebase-admin/firestore')
const { processCommand } = req('./operations.cjs')
const projectId = 'demo-pachax-audit'
const app = initializeApp({ projectId }, 'qa-derived-sale')
const db = getFirestore(app)
const root = db.doc('restaurants/sanjose')
const env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8085, rules: fs.readFileSync('firebase/firestore.rules', 'utf8') } })
const prefix = `ds${Date.now().toString(36)}`
const ids = { admin: `${prefix}-admin`, seller: `${prefix}-seller`, warehouse: `${prefix}-warehouse`, route: `${prefix}-route`, product: `${prefix}-sachet`, source: `${prefix}-source`, normal: `${prefix}-normal`, customer: `${prefix}-customer` }
let checks = 0
const pass = (condition, message) => { assert.ok(condition, message); checks++; console.log(`PASS ${message}`) }
const authDb = uid => env.authenticatedContext(uid).firestore()
const read = async (collection, id) => (await root.collection(collection).doc(id).get()).data()
const command = async (actor, type, payload, operationId, expected = 'confirmed') => {
  const ref = root.collection('distOperations').doc(operationId)
  await setDoc(doc(authDb(actor), 'restaurants', 'sanjose', 'distOperations', operationId), { id: operationId, restaurantId: 'sanjose', createdBy: actor, createdAt: new Date().toISOString(), type, payload, status: 'queued' })
  await processCommand(db, ref)
  const value = (await ref.get()).data()
  if (expected) assert.equal(value.status, expected, `${type}: ${value.error || 'estado inesperado'}`)
  return { ...value, operationId }
}
const seedProduct = (id, unitType, productionCost, extra = {}) => root.collection('distProducts').doc(id).set({ id, restaurantId: 'sanjose', name: `QA ${id}`, unitType, active: true, productionCost, referencePrice: 10, ...extra })
const seedPackageLot = async ({ productId, lotId, location = 'central', quantity, weightG, costCents, batchId, expiresOn = '2027-01-10', quarantined = false, omitLedger = false, unavailable = null }) => {
  const loc = location
  const processingByLocation = omitLedger ? undefined : { [loc]: { segments: [{ segmentId: `${batchId}:${lotId}`, batchId, destinationId: `dest-${lotId}`, sourceMovementId: `output-${lotId}`, weightBasis: 'documented_average', remainingQuantity: quantity, remainingWeightG: weightG, remainingCostCents: costCents }] } }
  const lot = { id: lotId, restaurantId: 'sanjose', productId, productName: `QA ${productId}`, unitType: 'package', lotCode: `LOT-${lotId}`, manufacturedOn: '2026-10-10', expiresOn, productionCost: costCents == null ? null : costCents / 100 / quantity, quarantined, quantities: { [loc]: quantity }, processingCommercialBlocked: true, processingBatchId: batchId, processingDestinationId: `dest-${lotId}`, processingDestinationKind: 'finished', processingPhysicalWeightGRemaining: weightG, processingCostCentsRemaining: costCents, processingSourceAllocationBasis: 'batch_blend_accounting_allocation', ...(processingByLocation ? { processingByLocation } : {}), ...(unavailable ? { processingUnavailable: { [loc]: unavailable } } : {}) }
  await root.collection('distLots').doc(lotId).set(lot)
  const balanceId = `${loc}__${productId}`
  const balanceRef = root.collection('distBalances').doc(balanceId)
  const current = await balanceRef.get()
  await balanceRef.set({ id: balanceId, restaurantId: 'sanjose', locationKind: loc === 'central' ? 'central' : 'route', routeId: loc.startsWith('route__') ? loc.slice(7) : '', warehouseId: 'central', productId, unitType: 'package', quantity: Number(current.data()?.quantity || 0) + quantity })
  await root.collection('distProcessingBatches').doc(batchId).set({ id: batchId, restaurantId: 'sanjose', status: 'confirmed', result: { derivedLots: [{ lotId, productId, commercialQuantity: quantity, netWeightG: weightG, costCents }] } })
  await root.collection('distStockMovements').doc(`output-${lotId}`).set({ id: `output-${lotId}`, restaurantId: 'sanjose', productId, type: 'processing_output', fromLocation: '', toLocation: loc, quantity, physicalWeightG: weightG, costCents, batchId, lotId })
}
const salePayload = ({ role, routeId = ids.route, dispatchId = '', lines, cashAmount, qrAmount = 0, creditAmount = 0, customerId = '' }) => ({ sourceLocation: role === 'distributor' ? 'route' : 'centralWarehouse', routeId: role === 'distributor' ? routeId : 'administracion', routeName: role === 'distributor' ? 'QA Ruta' : 'Administración', dispatchId, lines, cashAmount, qrAmount, creditAmount, paymentKind: creditAmount ? 'credit' : qrAmount ? 'qr' : 'cash', ...(customerId ? { customerId } : {}), allowProcessedSale: true })

try {
  await root.collection('members').doc(ids.admin).set({ role: 'admin', active: true, displayName: 'QA Admin' })
  await root.collection('members').doc(ids.seller).set({ role: 'distributor', active: true, routeId: ids.route, displayName: 'QA Seller' })
  await root.collection('members').doc(ids.warehouse).set({ role: 'warehouse', active: true, warehouseId: 'central', displayName: 'QA Warehouse' })
  await root.collection('distRoutes').doc(ids.route).set({ id: ids.route, restaurantId: 'sanjose', active: true, name: 'QA Ruta' })
  await seedProduct(ids.product, 'package', 999)
  await seedProduct(ids.source, 'kg', 5)
  await seedProduct(ids.normal, 'package', 2)
  const adminProduct = `${prefix}-admin-sachet`
  await seedProduct(adminProduct, 'package', 999)
  await root.collection('distCustomers').doc(ids.customer).set({ id: ids.customer, restaurantId: 'sanjose', active: true, name: 'QA Cliente', identityNumber: '1234567' })
  const centralLot = `${prefix}-central-lot`
  await seedPackageLot({ productId: ids.product, lotId: centralLot, quantity: 36, weightG: 9000, costCents: 4500, batchId: `${prefix}-batch-36` })
  const dispatchId = `${prefix}-dispatch`
  const dispatchOp = await command(ids.admin, 'dispatch', { warehouseId: 'central', routeId: ids.route, routeName: 'QA Ruta', distributorUid: ids.seller, distributorName: 'QA Seller', lines: [{ productId: ids.product, productName: 'QA sachets', unitType: 'package', quantity: 10, normalQuantity: 10, dispatchMerma: 0, allocationsRequested: [{ lotId: centralLot, quantity: 10 }] }] }, dispatchId)
  assert.equal(dispatchOp.status, 'confirmed')
  const dispatchMovement = (await root.collection('distStockMovements').where('refId', '==', dispatchOp.operationId).get()).docs.map(row => row.data()).find(row => row.type === 'dispatch')
  pass(dispatchMovement.processingAllocations[0].physicalWeightG === 2500 && dispatchMovement.processingAllocations[0].costCents === 1250, 'fixture: despacho real asigna 10 paquetes, 2.500 g y 1.250 centavos a la ruta')

  const productionBlocked = await command(ids.seller, 'sale', salePayload({ role: 'distributor', routeId: ids.route, dispatchId, lines: [{ productId: ids.product, quantity: 1, actualUnitPrice: 10 }], cashAmount: 10 }), `${prefix}-prod-gate`, 'rejected')
  pass(productionBlocked.error.includes('bloqueado') && (await read('distLots', centralLot)).quantities[`route__${ids.route}`] === 10, 'venta derivada continúa bloqueada si el servidor no tiene la marca de Functions Emulator, aunque el payload solicite activarla')

  process.env.FUNCTIONS_EMULATOR = 'true'
  process.env.SANJOSE_DERIVED_SALES_EMULATOR_TEST = 'true'
  const routeSale = await command(ids.seller, 'sale', salePayload({ role: 'distributor', routeId: ids.route, dispatchId, lines: [{ productId: ids.product, quantity: 7, actualUnitPrice: 10 }], cashAmount: 70 }), `${prefix}-sale-seven`)
  const sale = await read('distSales', routeSale.operationId)
  const saleMovement = (await root.collection('distStockMovements').where('refId', '==', routeSale.operationId).get()).docs.map(row => row.data()).find(row => row.type === 'sale')
  let lot = await read('distLots', centralLot)
  const routeLoc = `route__${ids.route}`
  pass(sale.lines[0].quantity === 7 && sale.lines[0].allocations.reduce((sum, row) => sum + row.processingAllocation.physicalWeightG, 0) === 1750, 'venta de 7 paquetes registra exactamente 1.750 g asignados')
  pass(sale.lines[0].costCents === 875 && sale.lines[0].costTotal === 8.75 && sale.lines[0].allocations.reduce((sum, row) => sum + row.processingAllocation.costCents, 0) === 875, 'venta conserva costo exacto Bs 8,75 en centavos y en asignaciones')
  pass(sale.lines[0].allocations.every(row => row.processingAllocation.batchId === `${prefix}-batch-36` && row.processingAllocation.saleId === sale.id && row.processingAllocation.saleMovementId === saleMovement.id && row.processingAllocation.location === routeLoc), 'venta enlaza lote, batch, segmento, ubicación y movimiento de salida')
  pass(saleMovement.quantity === 7 && saleMovement.processingCostCents === 875 && saleMovement.costCents === 875 && saleMovement.physicalWeightG === 1750 && saleMovement.processingAllocations[0].saleMovementId === saleMovement.id, 'Kardex registra una sola salida física con peso y costo exactos')
  pass(lot.quantities.central === 26 && lot.quantities[routeLoc] === 3 && lot.processingByLocation.central.segments[0].remainingWeightG === 6500 && lot.processingByLocation[routeLoc].segments[0].remainingWeightG === 750 && lot.processingByLocation.central.segments[0].remainingCostCents === 3250 && lot.processingByLocation[routeLoc].segments[0].remainingCostCents === 375, 'inventario posterior: 3 paquetes/750 g/Bs 3,75 en ruta y 26 paquetes/6.500 g/Bs 32,50 en central')
  pass((await read('distBalances', `central__${ids.product}`)).quantity === 26 && (await read('distBalances', `${routeLoc}__${ids.product}`)).quantity === 3, 'balances centrales y de ruta concilian con las cantidades comerciales')

  const profit = computeProductProfitReport([sale])
  const opResult = computeOperatingResult([sale], [], [], [saleMovement], [sale.dayKey])
  pass(profit.totals.costBs === 8.75 && profit.totals.salesBs === 70 && profit.totals.profitBs === 61.25, 'rentabilidad reconoce una sola vez el costo histórico exacto de Bs 8,75')
  pass(opResult.costOfSales === 8.75 && opResult.operatingResult === 61.25, 'Resultado del negocio incluye el costo vendido una vez, sin tratar despacho como gasto')

  const receive = await command(ids.warehouse, 'closure', { mode: 'warehouse', closure: { dispatchId, warehouseResponsibleName: 'QA Almacén', products: [{ productId: ids.product, actualReturn: 3, returnWaste: 0 }] } }, `${prefix}-warehouse-return`)
  let receivedLot = await read('distLots', centralLot)
  pass(receive.status === 'confirmed' && receivedLot.quantities[routeLoc] === 0 && receivedLot.quantities.central === 29 && receivedLot.processingByLocation.central.segments[0].remainingWeightG === 7250 && receivedLot.processingByLocation.central.segments[0].remainingCostCents === 3625, 'recepción de 3 sachets devuelve exactamente 750 g/Bs 3,75; central queda con 29, 7.250 g y Bs 36,25')
  const receiveMovement = (await root.collection('distStockMovements').where('refId', '==', receive.operationId).get()).docs.map(row => row.data()).find(row => row.type === 'return')
  pass(receiveMovement.processingAllocations[0].physicalWeightG === 750 && receiveMovement.processingAllocations[0].costCents === 375 && receiveMovement.dispatchId === dispatchId, 'movimiento de recepción enlaza despacho, segmento y costo/peso exactos')
  const routeClose = await command(ids.admin, 'closure', { mode: 'final', closure: { dispatchId, physicalCashDeclared: 70 } }, `${prefix}-route-close`)
  pass(routeClose.status === 'confirmed' && (await read('distDispatches', dispatchId)).status === 'closed', 'cierre monetario finaliza después de la recepción física confirmada')
  const reopened = await command(ids.admin, 'reopen', { closureId: `closure_${dispatchId}`, reason: 'QA validar reversión trazable de retorno de sachets' }, `${prefix}-route-reopen`)
  receivedLot = await read('distLots', centralLot)
  pass(reopened.status === 'confirmed' && (await read('distDispatches', dispatchId)).status === 'open' && receivedLot.quantities.central === 26 && receivedLot.quantities[routeLoc] === 3 && receivedLot.processingByLocation.central.segments[0].remainingWeightG === 6500 && receivedLot.processingByLocation[routeLoc].segments[0].remainingCostCents === 375, 'reapertura revierte solo el retorno exacto: central 26 paquetes y ruta 3/750 g/Bs 3,75')
  const dispatchCorrection = await command(ids.admin, 'correctDispatch', { dispatchId, reason: 'QA corrección de una unidad de carga', changes: [{ targetType: 'initial', productId: ids.product, newQuantity: 9, newDispatchMerma: 0 }] }, `${prefix}-derived-dispatch-correction`)
  const correctionMovement = (await root.collection('distStockMovements').where('refId', '==', dispatchCorrection.operationId).get()).docs.map(row => row.data()).find(row => row.type === 'dispatch_correction')
  receivedLot = await read('distLots', centralLot)
  pass(dispatchCorrection.status === 'confirmed' && correctionMovement.processingAllocations[0].physicalWeightG === 250 && correctionMovement.processingAllocations[0].costCents === 125 && receivedLot.quantities.central === 27 && receivedLot.quantities[routeLoc] === 2 && receivedLot.processingByLocation.central.segments[0].remainingWeightG === 6750, 'corrección de despacho devuelve un paquete, 250 g y Bs 1,25 a la asignación original')
  const damageAttempt = await command(ids.warehouse, 'closure', { mode: 'warehouse', closure: { dispatchId, warehouseResponsibleName: 'QA Almacén', products: [{ productId: ids.product, actualReturn: 1, returnWaste: 1, returnWasteReason: 'Envase dañado' }] } }, `${prefix}-derived-damage`, 'rejected')
  pass(damageAttempt.error.includes('no usan la merma por kg') && (await read('distLots', centralLot)).quantities[routeLoc] === 2 && !(await read('distClosures', `closure_${dispatchId}`))?.warehouseClosedBy, 'retorno dañado de sachets se rechaza para clasificación especializada, sin escrituras parciales')
  const partialReceive = await command(ids.warehouse, 'closure', { mode: 'warehouse', closure: { dispatchId, warehouseResponsibleName: 'QA Almacén', products: [{ productId: ids.product, actualReturn: 1, returnWaste: 0 }] } }, `${prefix}-partial-warehouse-return`)
  const shortageMovement = (await root.collection('distStockMovements').where('refId', '==', partialReceive.operationId).get()).docs.map(row => row.data()).find(row => row.type === 'shortage')
  receivedLot = await read('distLots', centralLot)
  pass(shortageMovement?.quantity === 1 && shortageMovement.lossCostCents === 125 && shortageMovement.lossCost === 1.25 && shortageMovement.processingAllocations[0].physicalWeightG === 250 && receivedLot.quantities.central === 28 && receivedLot.quantities[routeLoc] === 0 && receivedLot.processingByLocation.central.segments[0].remainingWeightG === 7000 && receivedLot.processingByLocation.central.segments[0].remainingCostCents === 3500, 'faltante físico registra un paquete/250 g/Bs 1,25 como pérdida única; un paquete retorna y central queda con 28')
  const shortageResult = computeOperatingResult([sale], [], [], [saleMovement, shortageMovement], [sale.dayKey])
  pass(shortageResult.costOfSales === 8.75 && shortageResult.losses === 1.25 && shortageResult.operatingResult === 60, 'Resultado separa Bs 8,75 de costo vendido y Bs 1,25 de faltante comprobado')
  await command(ids.admin, 'closure', { mode: 'final', closure: { dispatchId, physicalCashDeclared: 70 } }, `${prefix}-route-close-after-shortage`)
  await command(ids.admin, 'reopen', { closureId: `closure_${dispatchId}`, reason: 'QA revertir cierre con faltante derivado' }, `${prefix}-route-reopen-after-shortage`)
  receivedLot = await read('distLots', centralLot)
  const reversedShortage = await read('distStockMovements', shortageMovement.id)
  const reopenedResult = computeOperatingResult([sale], [], [], [saleMovement, reversedShortage], [sale.dayKey])
  pass(receivedLot.quantities.central === 27 && receivedLot.quantities[routeLoc] === 2 && receivedLot.processingByLocation.central.segments[0].remainingWeightG === 6750 && receivedLot.processingByLocation[routeLoc].segments[0].remainingCostCents === 250 && reopenedResult.losses === 0, 'reapertura revierte retorno y faltante por segmentos sin duplicar stock, costo ni pérdida')
  const beforeEconomicEditLot = await read('distLots', centralLot)
  const beforeEconomicEditMovements = (await root.collection('distStockMovements').where('refId', '==', routeSale.operationId).get()).size
  const economicEdit = await command(ids.admin, 'editSale', { saleId: routeSale.operationId, reason: 'Corrección económica de prueba', lines: [{ productId: ids.product, quantity: 7, actualUnitPrice: 9.5 }], paymentKind: 'cash', cashAmount: 66.5, qrAmount: 0, creditAmount: 0 }, `${prefix}-economic-edit`)
  const economicallyCorrected = await read('distSales', routeSale.operationId)
  pass(economicEdit.status === 'confirmed' && economicallyCorrected.effectiveSnapshot.total === 66.5 && economicallyCorrected.effectiveSnapshot.lines[0].costCents === 875 && JSON.stringify(await read('distLots', centralLot)) === JSON.stringify(beforeEconomicEditLot) && (await root.collection('distStockMovements').where('refId', '==', routeSale.operationId).get()).size === beforeEconomicEditMovements, 'corrección económica conserva asignaciones/costo y no toca paquetes, gramos ni Kardex')

  await command(ids.seller, 'sale', salePayload({ role: 'distributor', routeId: ids.route, dispatchId, lines: [{ productId: ids.product, quantity: 1, actualUnitPrice: 10 }], cashAmount: 0, qrAmount: 10 }), `${prefix}-sale-qr`)
  const qrSale = await read('distSales', `${prefix}-sale-qr`)
  pass(qrSale.qrAmount === 10 && qrSale.cashAmount === 0 && (await read('distLots', centralLot)).processingByLocation[routeLoc].segments[0].remainingQuantity === 1, 'pago QR registra ingreso QR y descuenta un paquete una sola vez')
  const creditSaleId = `${prefix}-sale-credit`
  await command(ids.seller, 'sale', salePayload({ role: 'distributor', routeId: ids.route, dispatchId, lines: [{ productId: ids.product, quantity: 1, actualUnitPrice: 10 }], cashAmount: 0, creditAmount: 10, customerId: ids.customer }), creditSaleId)
  const receivable = await read('distReceivables', creditSaleId)
  pass(receivable.balance === 10 && receivable.saleLines[0].costCents === 125 && (await read('distLots', centralLot)).quantities[routeLoc] === 0, 'crédito crea una sola cuenta por cobrar y mantiene costo/consumo histórico; ruta queda sin paquetes')

  const directLot = `${prefix}-direct-lot`
  await seedPackageLot({ productId: adminProduct, lotId: directLot, quantity: 2, weightG: 600, costCents: 301, batchId: `${prefix}-batch-direct`, expiresOn: '2027-02-01' })
  const adminSaleId = `${prefix}-admin-sale`
  const adminSale = await command(ids.admin, 'sale', salePayload({ role: 'admin', lines: [{ productId: adminProduct, quantity: 1, actualUnitPrice: 10 }], cashAmount: 10 }), adminSaleId)
  const adminSavedSale = await read('distSales', adminSaleId)
  const adminLot = await read('distLots', directLot)
  pass(adminSale.status === 'confirmed' && adminSavedSale.routeId === 'administracion' && adminSavedSale.lines[0].costCents === 150 && adminLot.processingByLocation.central.segments[0].remainingWeightG === 300, 'venta directa administrativa consume el lote FEFO central y registra ingreso más asignación histórica')

  const mixedNormalLot = `${prefix}-normal-lot`
  await root.collection('distLots').doc(mixedNormalLot).set({ id: mixedNormalLot, restaurantId: 'sanjose', productId: ids.normal, productName: 'QA normal', unitType: 'package', lotCode: `LOT-${mixedNormalLot}`, manufacturedOn: '2026-10-10', expiresOn: '2027-01-01', productionCost: 2, quantities: { central: 5 } })
  await root.collection('distBalances').doc(`central__${ids.normal}`).set({ id: `central__${ids.normal}`, restaurantId: 'sanjose', locationKind: 'central', warehouseId: 'central', productId: ids.normal, unitType: 'package', quantity: 5 })
  const mixedSaleId = `${prefix}-mixed-sale`
  await command(ids.admin, 'sale', salePayload({ role: 'admin', lines: [{ productId: ids.normal, quantity: 1, actualUnitPrice: 10 }, { productId: ids.product, quantity: 1, actualUnitPrice: 10 }], cashAmount: 20 }), mixedSaleId)
  const mixedSale = await read('distSales', mixedSaleId)
  pass(mixedSale.lines.length === 2 && mixedSale.lines.reduce((sum, row) => sum + row.costCents, 0) === 325 && mixedSale.lines[1].allocations.some(row => row.processingAllocation), 'una venta mixta conserva la línea normal y la derivada; costos suman 325 centavos')

  const unknownProduct = `${prefix}-unknown-product`
  await seedProduct(unknownProduct, 'package', 1000)
  const unknownLot = `${prefix}-unknown-lot`
  await seedPackageLot({ productId: unknownProduct, lotId: unknownLot, quantity: 2, weightG: 500, costCents: null, batchId: `${prefix}-batch-unknown` })
  const unknownSaleId = `${prefix}-unknown-sale`
  await command(ids.admin, 'sale', salePayload({ role: 'admin', lines: [{ productId: unknownProduct, quantity: 1, actualUnitPrice: 10 }], cashAmount: 10 }), unknownSaleId)
  const unknownSale = await read('distSales', unknownSaleId)
  pass(unknownSale.lines[0].costCents === null && unknownSale.lines[0].costTotal === null && unknownSale.lines[0].allocations[0].processingAllocation.costCents === null, 'costo desconocido continúa null en venta y asignación, sin usar el costo de catálogo')

  const beforeOver = await read('distLots', unknownLot)
  const over = await command(ids.admin, 'sale', salePayload({ role: 'admin', lines: [{ productId: unknownProduct, quantity: 2, actualUnitPrice: 10 }], cashAmount: 20 }), `${prefix}-over-sale`, 'rejected')
  pass(over.error.includes('disponible') && JSON.stringify(await read('distLots', unknownLot)) === JSON.stringify(beforeOver), 'venta superior a existencia disponible se rechaza sin cambios parciales')

  const reservedId = `${prefix}-reserved-sale-lot`
  const reservedProduct = `${prefix}-reserved-product`
  await seedProduct(reservedProduct, 'package', 5)
  await seedPackageLot({ productId: reservedProduct, lotId: reservedId, quantity: 2, weightG: 500, costCents: 500, batchId: `${prefix}-batch-reserved`, unavailable: { courtesy: 0, repackPending: 1, reviewHold: 0 } })
  const reservedLot = await read('distLots', reservedId)
  const reservationId = `${prefix}-repack-reservation`
  await root.collection('distStockReservations').doc(reservationId).set({ id: reservationId, restaurantId: 'sanjose', productId: reservedProduct, lotId: reservedId, location: 'central', purpose: 'repack_pending', quantity: 1, remainingQuantity: 1, status: 'active', createdAt: new Date().toISOString() })
  const reservedAttempt = await command(ids.admin, 'sale', salePayload({ role: 'admin', lines: [{ productId: reservedProduct, quantity: 2, actualUnitPrice: 10 }], cashAmount: 20 }), `${prefix}-reserved-attempt`, 'rejected')
  pass(reservedAttempt.status === 'rejected' && (await read('distLots', reservedId)).quantities.central === reservedLot.quantities.central, 'saldo reservado para reenvasado no puede venderse y permanece intacto')

  for (const [purpose, heldField] of [['courtesy', 'courtesy'], ['review_hold', 'reviewHold']]) {
    const heldProduct = `${prefix}-${purpose}-product`, heldLotId = `${prefix}-${purpose}-lot`, heldReservationId = `${prefix}-${purpose}-reservation`
    await seedProduct(heldProduct, 'package', 5)
    await seedPackageLot({ productId: heldProduct, lotId: heldLotId, quantity: 1, weightG: 250, costCents: 100, batchId: `${prefix}-${purpose}-batch`, unavailable: { courtesy: purpose === 'courtesy' ? 1 : 0, repackPending: 0, reviewHold: purpose === 'review_hold' ? 1 : 0 } })
    await root.collection('distStockReservations').doc(heldReservationId).set({ id: heldReservationId, restaurantId: 'sanjose', productId: heldProduct, lotId: heldLotId, location: 'central', purpose, quantity: 1, remainingQuantity: 1, status: 'active', createdAt: new Date().toISOString() })
    const heldAttempt = await command(ids.admin, 'sale', salePayload({ role: 'admin', lines: [{ productId: heldProduct, quantity: 1, actualUnitPrice: 10 }], cashAmount: 10 }), `${prefix}-${purpose}-sale`, 'rejected')
    pass(heldAttempt.status === 'rejected' && (await read('distLots', heldLotId)).quantities.central === 1, `${purpose} reservado permanece fuera de venta, sin descontar paquetes`)
  }

  const quarantinedId = `${prefix}-quarantine-lot`, expiredId = `${prefix}-expired-lot`, historicalId = `${prefix}-historical-lot`
  const protectedProduct = `${prefix}-protected-product`
  await seedProduct(protectedProduct, 'package', 5)
  await seedPackageLot({ productId: protectedProduct, lotId: quarantinedId, quantity: 1, weightG: 250, costCents: 100, batchId: `${prefix}-batch-q`, quarantined: true })
  await seedPackageLot({ productId: protectedProduct, lotId: expiredId, quantity: 1, weightG: 250, costCents: 100, batchId: `${prefix}-batch-e`, expiresOn: '2026-10-01' })
  await seedPackageLot({ productId: protectedProduct, lotId: historicalId, quantity: 1, weightG: 250, costCents: 100, batchId: `${prefix}-batch-h`, omitLedger: true })
  const protectedAttempt = await command(ids.admin, 'sale', salePayload({ role: 'admin', lines: [{ productId: protectedProduct, quantity: 1, actualUnitPrice: 10 }], cashAmount: 10 }), `${prefix}-protected-sale`, 'rejected')
  pass(protectedAttempt.status === 'rejected' && (await read('distLots', quarantinedId)).quantities.central === 1 && (await read('distLots', expiredId)).quantities.central === 1 && (await read('distLots', historicalId)).quantities.central === 1, 'cuarentena, vencimiento y lote histórico sin processingByLocation permanecen bloqueados')

  const movementCountBeforeBlockedActions = (await root.collection('distStockMovements').where('refId', '==', routeSale.operationId).get()).size
  const edit = await command(ids.admin, 'editSale', { saleId: routeSale.operationId, reason: 'QA no implementado', lines: [] }, `${prefix}-edit-derived`, 'rejected')
  const voided = await command(ids.admin, 'voidSale', { saleId: routeSale.operationId, reason: 'QA no implementado' }, `${prefix}-void-derived`, 'rejected')
  const claim = await command(ids.admin, 'claim', { saleId: routeSale.operationId, productId: ids.product, quantity: 1, kind: 'return', reason: 'QA no implementado' }, `${prefix}-claim-derived`, 'rejected')
  pass(edit.error.includes('conservar todos los productos') && voided.error.includes('3D.2B') && claim.error.includes('3D.2B'), 'edición física, anulación y devolución derivada sin evidencia siguen bloqueadas')
  const movementCountAfterBlockedActions = (await root.collection('distStockMovements').where('refId', '==', routeSale.operationId).get()).size
  pass((await read('distLots', centralLot)).quantities[routeLoc] === 0 && movementCountAfterBlockedActions === movementCountBeforeBlockedActions, 'rechazos de edición física/anulación/devolución no modifican stock ni agregan movimientos')

  const beforeRetry = await root.collection('distStockMovements').where('refId', '==', routeSale.operationId).get()
  await processCommand(db, root.collection('distOperations').doc(routeSale.operationId))
  pass((await root.collection('distStockMovements').where('refId', '==', routeSale.operationId).get()).size === beforeRetry.size && (await read('distLots', centralLot)).quantities[routeLoc] === 0, 'reintento del mismo operationId no duplica venta ni consumo')

  const racingLot = `${prefix}-race-lot`, raceProduct = `${prefix}-race-product`
  await seedProduct(raceProduct, 'package', 3)
  await seedPackageLot({ productId: raceProduct, lotId: racingLot, quantity: 2, weightG: 501, costCents: 301, batchId: `${prefix}-batch-race` })
  const racePayload = salePayload({ role: 'admin', lines: [{ productId: raceProduct, quantity: 2, actualUnitPrice: 10 }], cashAmount: 20 })
  const race = await Promise.all([
    command(ids.admin, 'sale', racePayload, `${prefix}-race-sale-a`, null),
    command(ids.admin, 'sale', racePayload, `${prefix}-race-sale-b`, null),
  ])
  pass(race.filter(row => row.status === 'confirmed').length === 1 && race.filter(row => row.status === 'rejected').length === 1 && (await read('distLots', racingLot)).quantities.central === 0 && (await read('distLots', racingLot)).processingPhysicalWeightGRemaining === 0, 'dos ventas simultáneas no consumen paquetes/gramos dos veces y una se rechaza')

  await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), 'restaurants', 'sanjose', 'distOperations', `${prefix}-anon-sale`), { id: `${prefix}-anon-sale`, restaurantId: 'sanjose', createdBy: ids.admin, type: 'sale', payload: {}, status: 'queued' }))
  pass(true, 'Firestore Rules bloquean la creación anónima de operaciones de venta')
  const distributorWrongRoute = `${prefix}-rules-distributor-sale`
  const wrongRouteCentralBefore = (await read('distLots', centralLot)).quantities.central
  await setDoc(doc(authDb(ids.seller), 'restaurants', 'sanjose', 'distOperations', distributorWrongRoute), { id: distributorWrongRoute, restaurantId: 'sanjose', createdBy: ids.seller, createdAt: new Date().toISOString(), type: 'sale', payload: salePayload({ role: 'distributor', routeId: 'otra-ruta', dispatchId, lines: [{ productId: ids.product, quantity: 1, actualUnitPrice: 10 }], cashAmount: 10 }), status: 'queued' })
  await processCommand(db, root.collection('distOperations').doc(distributorWrongRoute))
  const wrongRouteResult = await read('distOperations', distributorWrongRoute)
  pass(wrongRouteResult.status === 'rejected' && wrongRouteResult.error.includes('no corresponde a tu ruta') && (await read('distLots', centralLot)).quantities.central === wrongRouteCentralBefore, 'Rules autentican la solicitud y el backend rechaza otra ruta antes de consumir inventario')
  delete process.env.FUNCTIONS_EMULATOR
  delete process.env.SANJOSE_DERIVED_SALES_EMULATOR_TEST
  const beforeGateDisable = (await read('distLots', centralLot)).quantities.central
  const disabledAfterTests = await command(ids.admin, 'sale', salePayload({ role: 'admin', lines: [{ productId: ids.product, quantity: 1, actualUnitPrice: 10 }], cashAmount: 10 }), `${prefix}-gate-after`, 'rejected')
  pass(disabledAfterTests.error.includes('bloqueado') && (await read('distLots', centralLot)).quantities.central === beforeGateDisable, 'al retirar la marca de Functions Emulator el servidor vuelve a bloquear el consumo derivado, sin escrituras')

  const multiProduct = `${prefix}-multi-product`, multiLotA = `${prefix}-multi-a`, multiLotB = `${prefix}-multi-b`
  await seedProduct(multiProduct, 'package', 999)
  await seedPackageLot({ productId: multiProduct, lotId: multiLotA, quantity: 2, weightG: 600, costCents: 300, batchId: `${prefix}-multi-batch-a`, expiresOn: '2027-01-01' })
  await seedPackageLot({ productId: multiProduct, lotId: multiLotB, quantity: 2, weightG: 800, costCents: 500, batchId: `${prefix}-multi-batch-b`, expiresOn: '2027-02-01' })
  process.env.FUNCTIONS_EMULATOR = 'true'
  process.env.SANJOSE_DERIVED_SALES_EMULATOR_TEST = 'true'
  const multiSaleId = `${prefix}-multi-lot-sale`
  await command(ids.admin, 'sale', salePayload({ role: 'admin', lines: [{ productId: multiProduct, quantity: 3, actualUnitPrice: 10 }], cashAmount: 30 }), multiSaleId)
  const multiSale = await read('distSales', multiSaleId)
  pass(multiSale.lines[0].allocations.length === 2 && multiSale.lines[0].allocations.map(row => row.lotId).sort().join(',') === [multiLotA, multiLotB].sort().join(',') && multiSale.lines[0].costCents === 550 && multiSale.lines[0].allocations.reduce((sum, row) => sum + row.processingAllocation.physicalWeightG, 0) === 1000, 'venta de 3 paquetes cruza dos lotes/batches derivados y conserva 1.000 g y 550 centavos por asignación')

  const centsProduct = `${prefix}-cents-product`
  await seedProduct(centsProduct, 'package', 900)
  const centsLot = `${prefix}-cents-lot`
  await seedPackageLot({ productId: centsProduct, lotId: centsLot, quantity: 3, weightG: 1001, costCents: 502, batchId: `${prefix}-batch-cents` })
  const firstCentId = `${prefix}-cent-sale-1`
  await command(ids.admin, 'sale', salePayload({ role: 'admin', lines: [{ productId: centsProduct, quantity: 1, actualUnitPrice: 10 }], cashAmount: 10 }), firstCentId)
  const firstCent = await read('distSales', firstCentId)
  const afterFirstCent = await read('distLots', centsLot)
  pass(firstCent.lines[0].allocations[0].processingAllocation.physicalWeightG === 333 && firstCent.lines[0].costCents === 167 && afterFirstCent.processingByLocation.central.segments[0].remainingWeightG === 668 && afterFirstCent.processingByLocation.central.segments[0].remainingCostCents === 335, 'paquete no divisible consume 333 g/167 centavos y conserva el resto exacto')
  for (let i = 2; i <= 3; i++) await command(ids.admin, 'sale', salePayload({ role: 'admin', lines: [{ productId: centsProduct, quantity: 1, actualUnitPrice: 10 }], cashAmount: 10 }), `${prefix}-cent-sale-${i}`)
  const centRows = (await Promise.all([1, 2, 3].map(i => read('distSales', `${prefix}-cent-sale-${i}`)))).filter(row => row.lines[0].allocations[0].lotId === centsLot)
  pass(centRows.reduce((sum, row) => sum + row.lines[0].allocations[0].processingAllocation.physicalWeightG, 0) === 1001 && centRows.reduce((sum, row) => sum + row.lines[0].costCents, 0) === 502, 'tres ventas conservan exactamente 1.001 g y 502 centavos, incluido el resto final')

  const kgProduct = `${prefix}-normal-kg`, kgLot = `${prefix}-normal-kg-lot`
  await seedProduct(kgProduct, 'kg', 5)
  await root.collection('distLots').doc(kgLot).set({ id: kgLot, restaurantId: 'sanjose', productId: kgProduct, productName: 'QA kg normal', unitType: 'kg', lotCode: kgLot, manufacturedOn: '2026-10-01', expiresOn: '2027-10-01', productionCost: 5, quantities: { central: 2 } })
  await root.collection('distBalances').doc(`central__${kgProduct}`).set({ id: `central__${kgProduct}`, restaurantId: 'sanjose', locationKind: 'central', warehouseId: 'central', productId: kgProduct, unitType: 'kg', quantity: 2 })
  const kgSaleId = `${prefix}-normal-kg-sale`
  await command(ids.admin, 'sale', salePayload({ role: 'admin', lines: [{ productId: kgProduct, quantity: 0.5, actualUnitPrice: 10 }], cashAmount: 5 }), kgSaleId)
  pass((await read('distSales', kgSaleId)).lines[0].costTotal === 2.5 && (await read('distLots', kgLot)).quantities.central === 1.5, 'regresión: venta histórica normal por kg conserva su costo y descuento previos')
  console.log(`processing derived sale emulator: ${checks} checks PASS`)
} finally {
  delete process.env.FUNCTIONS_EMULATOR
  delete process.env.SANJOSE_DERIVED_SALES_EMULATOR_TEST
  await env.cleanup()
  await app.delete()
}
