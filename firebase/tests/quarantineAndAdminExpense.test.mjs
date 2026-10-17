// All writes in this test are isolated to Firestore Emulator.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085'
const req = createRequire(new URL('../../functions/package.json', import.meta.url))
const { initializeApp } = req('firebase-admin/app')
const { getFirestore } = req('firebase-admin/firestore')
const { processCommand } = req('./operations.cjs')
const app = initializeApp({ projectId: 'demo-pachax-audit' }, `quarantine-admin-${Date.now()}`)
const db = getFirestore(app)
const root = db.doc('restaurants/sanjose')
const prefix = `qadmin-${Date.now().toString(36)}`
const admin = `${prefix}-admin`, warehouse = `${prefix}-warehouse`, seller = `${prefix}-seller`
let assertions = 0
const pass = (value, label) => { assert.ok(value, label); assertions++; console.log('PASS', label) }
const read = async (collection, id) => (await root.collection(collection).doc(id).get()).data()
async function run(actor, type, payload, expected = 'confirmed', id = `${prefix}-${type}-${Math.random().toString(36).slice(2)}`) {
  const ref = root.collection('distOperations').doc(id)
  await ref.set({ id, restaurantId: 'sanjose', createdBy: actor, createdAt: new Date().toISOString(), type, payload, status: 'queued' })
  await processCommand(db, ref)
  const operation = (await ref.get()).data()
  assert.equal(operation.status, expected, operation.error || `${type} terminó en ${operation.status}`)
  return operation
}
async function seedQuarantine(productId, lotId, quantity, cost = null) {
  await root.collection('distProducts').doc(productId).set({ id: productId, restaurantId: 'sanjose', name: `Producto ${productId}`, unitType: 'kg', active: true })
  await root.collection('distBalances').doc(`central__${productId}`).set({ id: `central__${productId}`, restaurantId: 'sanjose', locationKind: 'central', productId, quantity })
  await root.collection('distLots').doc(lotId).set({ id: lotId, restaurantId: 'sanjose', productId, productName: `Producto ${productId}`, unitType: 'kg', lotCode: 'SOBRANTE POR REVISAR', manufacturedOn: '', expiresOn: '', productionCost: cost, quarantined: true, quantities: { central: quantity }, createdAt: '2026-10-16T12:00:00.000Z', createdBy: admin })
  await root.collection('distStockMovements').doc(`${lotId}-overage`).set({ id: `${lotId}-overage`, restaurantId: 'sanjose', branchId: 'main', createdAt: '2026-10-16T12:00:00.000Z', createdBy: admin, dayKey: '2026-10-16', schemaVersion: 1, type: 'overage', productId, productName: `Producto ${productId}`, unitType: 'kg', quantity, centralDelta: quantity, routeDelta: 0, fromLocation: '', toLocation: 'central', lotId, dispatchId: `${lotId}-dispatch`, note: 'Sobrante detectado en cierre' })
}

try {
  await root.collection('members').doc(admin).set({ role: 'admin', active: true, displayName: 'Administración QA' })
  await root.collection('members').doc(warehouse).set({ role: 'warehouse', active: true, warehouseId: 'central', displayName: 'Almacén QA' })
  await root.collection('members').doc(seller).set({ role: 'distributor', active: true, routeId: `${prefix}-route`, displayName: 'Distribuidor QA' })

  for (const [categoryId, expectedName, expectedGroup] of [['administration-2', 'Limpieza', 'administration'], ['administration-1', 'Servicios', 'administration'], ['administration-3', 'Papelería', 'administration'], ['administration-5', 'Personal', 'administration'], ['administration-6', 'Impuestos/tasas operativas', 'administration']]) {
    const op = await run(admin, 'expense', { presetId: `admin-category:${categoryId}`, amount: 50, paymentMethod: 'cash', routeId: 'administracion', routeName: 'Administración', concept: expectedName })
    const expense = await read('distExpenses', op.id)
    pass(expense.categoryName === expectedName && expense.group === expectedGroup && expense.classificationStatus === 'reviewed' && expense.classificationSource === 'admin_review' && expense.economicType === 'operating_expense' && expense.affectsOperatingResult === true, `Admin registra ${expectedName} desde categoría default sin override`) 
  }
  await root.collection('distExpenseCategories').doc('administration-2').set({ id: 'administration-2', group: 'administration', name: 'Limpieza', active: false })
  await run(admin, 'expense', { presetId: 'admin-category:administration-2', amount: 10, routeId: 'administracion', routeName: 'Administración' }, 'rejected')
  pass(true, 'categoría default inactiva no puede usarse aunque no tenga un override previo')
  await root.collection('distExpenseCategories').doc('administration-2').delete()
  const production = await run(admin, 'expense', { presetId: 'admin-category:production_input-1', amount: 100, paymentMethod: 'transfer', routeId: 'administracion', routeName: 'Administración', concept: 'Carne' })
  const productionExpense = await read('distExpenses', production.id)
  pass(productionExpense.categoryName === 'Carne' && productionExpense.economicType === 'production_input' && productionExpense.affectsOperatingResult === false && productionExpense.paymentMethod === 'transfer', 'categoría de compras de producción mantiene tratamiento económico y pago')
  await run(seller, 'expense', { presetId: 'admin-category:administration-2', amount: 10, routeId: `${prefix}-route`, routeName: 'Ruta QA' }, 'rejected')
  await root.collection('distExpenseCategories').doc(`${prefix}-inactive`).set({ id: `${prefix}-inactive`, group: 'administration', name: 'Inactiva QA', active: false })
  await run(admin, 'expense', { presetId: `admin-category:${prefix}-inactive`, amount: 10, routeId: 'administracion', routeName: 'Administración' }, 'rejected')
  const customId = `${prefix}-custom-category`
  await root.collection('distExpenseCategories').doc(customId).set({ id: customId, group: 'administration', name: 'Servicio especial QA', active: true, autoClassifiable: false, distributorVisible: false })
  const custom = await run(admin, 'expense', { presetId: `admin-category:${customId}`, amount: 10, routeId: 'administracion', routeName: 'Administración' })
  pass((await read('distExpenses', custom.id)).classificationSource === 'admin_review', 'Admin puede elegir categoría personalizada activa sin habilitar automatización')

  const product = `${prefix}-existing`, quarantineLot = `${prefix}-q-existing`, targetLot = `${prefix}-target`
  await seedQuarantine(product, quarantineLot, 0.02)
  const noTraceability = await run(admin, 'resolveQuarantine', { lotId: quarantineLot, location: 'central', resolution: 'released_existing_lot', destinationLotId: '', reason: 'Intento sin lote destino' }, 'rejected')
  pass(noTraceability.error.includes('lote destino') && (await read('distBalances', `central__${product}`)).quantity === 0.02, 'no se puede liberar el sobrante por revisar sin lote destino trazable')
  await root.collection('distLots').doc(targetLot).set({ id: targetLot, restaurantId: 'sanjose', productId: product, productName: `Producto ${product}`, unitType: 'kg', lotCode: 'LOTE-VALIDADO', manufacturedOn: '2026-10-01', expiresOn: '2099-12-01', productionCost: 4, quantities: { central: 2.94 }, createdAt: new Date().toISOString(), createdBy: admin })
  await root.collection('distBalances').doc(`central__${product}`).update({ quantity: 2.96 })
  await run(warehouse, 'resolveQuarantine', { lotId: quarantineLot, location: 'central', resolution: 'released_existing_lot', destinationLotId: targetLot, reason: 'Lote verificado físicamente' }, 'rejected')
  const release = await run(admin, 'resolveQuarantine', { lotId: quarantineLot, location: 'central', resolution: 'released_existing_lot', destinationLotId: targetLot, reason: 'Lote verificado físicamente' })
  const releasedSource = await read('distLots', quarantineLot), releasedTarget = await read('distLots', targetLot)
  pass(releasedSource.quarantineResolution === 'released_existing_lot' && releasedSource.quantities.central === 0 && releasedTarget.quantities.central === 2.96, 'liberación consolida los 0,020 kg en lote trazable')
  pass((await read('distBalances', `central__${product}`)).quantity === 2.96, 'liberar a lote existente no cambia balance físico')
  const releaseMove = await read('distStockMovements', release.result.movementId)
  pass(releaseMove.type === 'quarantine_release' && releaseMove.centralDelta === 0 && releaseMove.quantity === 0.02, 'liberación registra movimiento idempotente con variación física cero')
  await processCommand(db, root.collection('distOperations').doc(release.id))
  pass((await read('distLots', targetLot)).quantities.central === 2.96, 'reprocesar la misma operación no duplica la cantidad liberada')
  const history = await read('distLotHistory', `${release.id}__history`)
  pass(history.action === 'quarantine_resolution' && history.previous.quarantined === true && history.next.quarantined === true && history.actor === admin, 'historial de lote conserva antes/después y responsable de liberación')
  await run(admin, 'resolveQuarantine', { lotId: quarantineLot, location: 'central', resolution: 'released_existing_lot', destinationLotId: targetLot, reason: 'Segundo intento' }, 'rejected')

  const newProduct = `${prefix}-new`, newLot = `${prefix}-q-new`
  await seedQuarantine(newProduct, newLot, 0.4, null)
  const newResolution = await run(admin, 'resolveQuarantine', { lotId: newLot, location: 'central', resolution: 'released_new_lot', newLotCode: 'LOTE-IDENTIFICADO', manufacturedOn: '2026-10-01', expiresOn: '2099-12-01', productionCost: 0, reason: 'Identificado por etiqueta física' })
  const newResolved = await read('distLots', newLot)
  pass(newResolved.quarantined === false && newResolved.lotCode === 'LOTE-IDENTIFICADO' && newResolved.productionCost === 0 && newResolved.quarantineResolvedQuantity === 0.4, 'nuevo lote exige trazabilidad y conserva auditoría del origen')
  pass((await read('distBalances', `central__${newProduct}`)).quantity === 0.4 && (await read('distStockMovements', newResolution.result.movementId)).centralDelta === 0, 'identificar lote nuevo no aumenta existencia física')

  const discardProduct = `${prefix}-discard`, discardLot = `${prefix}-q-discard`
  await seedQuarantine(discardProduct, discardLot, 0.5, null)
  const discarded = await run(admin, 'resolveQuarantine', { lotId: discardLot, location: 'central', resolution: 'discarded', reason: 'Envase comprometido' })
  const discardDoc = await read('distLots', discardLot), discardBalance = await read('distBalances', `central__${discardProduct}`)
  const discardMove = await read('distStockMovements', discarded.result.movementId)
  pass(discardDoc.quantities.central === 0 && discardDoc.quarantineResolution === 'discarded' && discardBalance.quantity === 0, 'descarte reduce existencia física sin incrementar disponible')
  pass(discardMove.type === 'quarantine_discard' && discardMove.centralDelta === -0.5 && discardMove.lossCost === null, 'descarte registra costo desconocido como null, nunca como precio de venta')

  const reProduct = `${prefix}-reopen`, reLot = `${prefix}-q-reopen`, reDispatch = `${prefix}-dispatch`, reClosure = `closure_${reDispatch}`, closureOperationId = `${prefix}-warehouse-close`
  await seedQuarantine(reProduct, reLot, 0.1)
  await root.collection('distDispatches').doc(reDispatch).set({ id: reDispatch, restaurantId: 'sanjose', status: 'closed', routeId: `${prefix}-route`, warehouseId: 'central' })
  await root.collection('distClosures').doc(reClosure).set({ id: reClosure, restaurantId: 'sanjose', status: 'closed', dispatchId: reDispatch, routeId: `${prefix}-route`, reversedStockMovementIds: [] })
  await root.collection('distOperations').doc(closureOperationId).set({ id: closureOperationId, type: 'closure', status: 'confirmed', payload: { mode: 'warehouse', closure: { dispatchId: reDispatch } } })
  await root.collection('distStockMovements').doc(`${reLot}-overage`).set({ id: `${reLot}-overage`, restaurantId: 'sanjose', branchId: 'main', createdAt: new Date().toISOString(), createdBy: admin, dayKey: '2026-10-17', schemaVersion: 1, type: 'overage', productId: reProduct, productName: `Producto ${reProduct}`, unitType: 'kg', quantity: 0.1, centralDelta: 0.1, routeDelta: 0, fromLocation: '', toLocation: 'central', lotId: reLot, dispatchId: reDispatch, refId: closureOperationId, refType: 'operation' })
  await run(admin, 'resolveQuarantine', { lotId: reLot, location: 'central', resolution: 'discarded', reason: 'Revisión previa al test de reapertura' })
  const reopen = await run(admin, 'reopen', { closureId: reClosure, reason: 'Prueba de protección' }, 'rejected')
  pass(reopen.error.includes('sobrante que ya fue revisado') && (await read('distClosures', reClosure)).status === 'closed', 'reapertura se bloquea antes de tocar stock si el sobrante ya fue resuelto')

  console.log(`${assertions} comprobaciones aprobadas`)
} finally {
  await app.delete()
}
