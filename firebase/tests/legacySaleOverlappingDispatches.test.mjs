import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8085'
const requireFunctions = createRequire(new URL('../../functions/package.json', import.meta.url))
const { initializeApp } = requireFunctions('firebase-admin/app')
const { getFirestore } = requireFunctions('firebase-admin/firestore')
const { processCommand } = requireFunctions('./operations.cjs')
const app = initializeApp({ projectId: 'demo-pachax-audit' }, `legacy-sale-overlap-${Date.now()}`)
const db = getFirestore(app)
const root = db.doc('restaurants/sanjose')
const token = `legacy-overlap-${Date.now().toString(36)}`
const routeId = `${token}-route`
const warehouseUid = `${token}-warehouse`
const dispatchA = `${token}-dispatch-a`
const dispatchB = `${token}-dispatch-b`
const saleId = `${token}-sale`

try {
  await root.collection('members').doc(warehouseUid).set({ role: 'warehouse', active: true, warehouseId: 'central', displayName: 'QA Almacén' })
  await root.collection('distDispatches').doc(dispatchA).set({ id: dispatchA, restaurantId: 'sanjose', routeId, routeName: 'QA Route', distributorUid: 'qa-distributor', distributorName: 'QA Distributor', status: 'open', createdAt: '2026-10-28T09:00:00.000Z', lines: [], additions: [] })
  await root.collection('distDispatches').doc(dispatchB).set({ id: dispatchB, restaurantId: 'sanjose', routeId, routeName: 'QA Route', distributorUid: 'qa-distributor', distributorName: 'QA Distributor', status: 'open', createdAt: '2026-10-28T10:00:00.000Z', lines: [], additions: [] })
  await root.collection('distSales').doc(saleId).set({ id: saleId, restaurantId: 'sanjose', routeId, sourceLocation: 'route', createdAt: '2026-10-28T11:00:00.000Z', lines: [], total: 0, cashAmount: 0, qrAmount: 0, creditAmount: 0 })
  const movementCountBefore = (await root.collection('distStockMovements').get()).size
  const operationId = `${token}-close`
  const operationRef = root.collection('distOperations').doc(operationId)
  await operationRef.set({ id: operationId, restaurantId: 'sanjose', createdBy: warehouseUid, createdAt: new Date().toISOString(), type: 'closure', payload: { mode: 'warehouse', closure: { dispatchId: dispatchB, products: [] } }, status: 'queued' })
  await processCommand(db, operationRef)
  const operation = (await operationRef.get()).data()
  assert.equal(operation.status, 'rejected')
  assert.match(operation.error, /ventas históricas.*no se pueden atribuir con seguridad/i)
  assert.equal((await root.collection('distClosures').doc(`closure_${dispatchB}`).get()).exists, false)
  assert.equal((await root.collection('distStockMovements').get()).size, movementCountBefore)
  assert.equal((await root.collection('distDispatches').doc(dispatchA).get()).data().status, 'open')
  assert.equal((await root.collection('distDispatches').doc(dispatchB).get()).data().status, 'open')

  for (const inactiveField of ['voidedAt', 'pendingConfirmation']) {
    const caseRoute = `${token}-route-${inactiveField}`
    const firstDispatch = `${token}-${inactiveField}-a`
    const targetDispatch = `${token}-${inactiveField}-b`
    const inactiveSale = `${token}-${inactiveField}-sale`
    await root.collection('distDispatches').doc(firstDispatch).set({ id: firstDispatch, restaurantId: 'sanjose', routeId: caseRoute, routeName: 'QA Route', distributorUid: 'qa-distributor', distributorName: 'QA Distributor', status: 'open', createdAt: '2026-10-28T09:00:00.000Z', lines: [], additions: [] })
    await root.collection('distDispatches').doc(targetDispatch).set({ id: targetDispatch, restaurantId: 'sanjose', routeId: caseRoute, routeName: 'QA Route', distributorUid: 'qa-distributor', distributorName: 'QA Distributor', status: 'open', createdAt: '2026-10-28T10:00:00.000Z', lines: [], additions: [] })
    await root.collection('distSales').doc(inactiveSale).set({
      id: inactiveSale, restaurantId: 'sanjose', routeId: caseRoute, sourceLocation: 'route',
      createdAt: '2026-10-28T11:00:00.000Z', lines: [], total: 0, cashAmount: 0, qrAmount: 0, creditAmount: 0,
      [inactiveField]: inactiveField === 'voidedAt' ? '2026-10-28T11:30:00.000Z' : true,
    })
    const inactiveOperationId = `${token}-${inactiveField}-close`
    const inactiveOperationRef = root.collection('distOperations').doc(inactiveOperationId)
    await inactiveOperationRef.set({ id: inactiveOperationId, restaurantId: 'sanjose', createdBy: warehouseUid, createdAt: new Date().toISOString(), type: 'closure', payload: { mode: 'warehouse', closure: { dispatchId: targetDispatch, products: [] } }, status: 'queued' })
    await processCommand(db, inactiveOperationRef)
    const inactiveOperation = (await inactiveOperationRef.get()).data()
    assert.equal(inactiveOperation.status, 'confirmed', `${inactiveField}: la venta no efectiva no debe bloquear recepción`)
    assert.equal((await root.collection('distClosures').doc(`closure_${targetDispatch}`).get()).data().warehouseClosedBy, warehouseUid)
  }

  const closeWarehouse = async (caseRoute, dispatchId, operationId) => {
    const ref = root.collection('distOperations').doc(operationId)
    await ref.set({ id: operationId, restaurantId: 'sanjose', createdBy: warehouseUid, createdAt: new Date().toISOString(), type: 'closure', payload: { mode: 'warehouse', closure: { dispatchId, products: [] } }, status: 'queued' })
    await processCommand(db, ref)
    return (await ref.get()).data()
  }
  const closedDispatchRoute = `${token}-closed-route`
  const closedDispatchId = `${token}-closed-a`
  const overlappingOpenId = `${token}-closed-b`
  await root.collection('distDispatches').doc(closedDispatchId).set({ id: closedDispatchId, restaurantId: 'sanjose', routeId: closedDispatchRoute, routeName: 'QA Route', distributorUid: 'qa-distributor', distributorName: 'QA Distributor', status: 'closed', createdAt: '2026-10-28T09:00:00.000Z', closedAt: '2026-10-28T12:00:00.000Z', lines: [], additions: [] })
  await root.collection('distDispatches').doc(overlappingOpenId).set({ id: overlappingOpenId, restaurantId: 'sanjose', routeId: closedDispatchRoute, routeName: 'QA Route', distributorUid: 'qa-distributor', distributorName: 'QA Distributor', status: 'open', createdAt: '2026-10-28T10:00:00.000Z', lines: [], additions: [] })
  await root.collection('distClosures').doc(`closure_${closedDispatchId}`).set({ id: `closure_${closedDispatchId}`, restaurantId: 'sanjose', routeId: closedDispatchRoute, dispatchId: closedDispatchId, status: 'closed', closedAt: '2026-10-28T12:00:00.000Z', products: [] })
  await root.collection('distSales').doc(`${token}-closed-overlap-sale`).set({ id: `${token}-closed-overlap-sale`, restaurantId: 'sanjose', routeId: closedDispatchRoute, sourceLocation: 'route', createdAt: '2026-10-28T11:00:00.000Z', lines: [], total: 0, cashAmount: 0, qrAmount: 0, creditAmount: 0 })
  const overlapClose = await closeWarehouse(closedDispatchRoute, overlappingOpenId, `${token}-closed-overlap-close`)
  assert.equal(overlapClose.status, 'rejected', 'una venta a las 11:00 se mantiene ambigua entre el despacho cerrado al mediodía y el que abrió a las 10:00')
  assert.match(overlapClose.error, /ventas históricas.*no se pueden atribuir con seguridad/i)

  const postCloseRoute = `${token}-post-close-route`
  const postCloseA = `${token}-post-close-a`
  const postCloseB = `${token}-post-close-b`
  await root.collection('distDispatches').doc(postCloseA).set({ id: postCloseA, restaurantId: 'sanjose', routeId: postCloseRoute, routeName: 'QA Route', distributorUid: 'qa-distributor', distributorName: 'QA Distributor', status: 'closed', createdAt: '2026-10-28T09:00:00.000Z', closedAt: '2026-10-28T12:00:00.000Z', lines: [], additions: [] })
  await root.collection('distDispatches').doc(postCloseB).set({ id: postCloseB, restaurantId: 'sanjose', routeId: postCloseRoute, routeName: 'QA Route', distributorUid: 'qa-distributor', distributorName: 'QA Distributor', status: 'open', createdAt: '2026-10-28T10:00:00.000Z', lines: [], additions: [] })
  await root.collection('distSales').doc(`${token}-post-close-sale`).set({ id: `${token}-post-close-sale`, restaurantId: 'sanjose', routeId: postCloseRoute, sourceLocation: 'route', createdAt: '2026-10-28T13:00:00.000Z', lines: [], total: 0, cashAmount: 0, qrAmount: 0, creditAmount: 0 })
  const postCloseResult = await closeWarehouse(postCloseRoute, postCloseB, `${token}-post-close-operation`)
  assert.equal(postCloseResult.status, 'confirmed', 'una venta a las 13:00 solo puede atribuirse al despacho que sigue abierto')

  const reopenedRoute = `${token}-reopened-route`
  const reopenedA = `${token}-reopened-a`
  const reopenedB = `${token}-reopened-b`
  await root.collection('distDispatches').doc(reopenedA).set({ id: reopenedA, restaurantId: 'sanjose', routeId: reopenedRoute, routeName: 'QA Route', distributorUid: 'qa-distributor', distributorName: 'QA Distributor', status: 'open', createdAt: '2026-10-28T09:00:00.000Z', lines: [], additions: [] })
  await root.collection('distDispatches').doc(reopenedB).set({ id: reopenedB, restaurantId: 'sanjose', routeId: reopenedRoute, routeName: 'QA Route', distributorUid: 'qa-distributor', distributorName: 'QA Distributor', status: 'open', createdAt: '2026-10-28T10:00:00.000Z', lines: [], additions: [] })
  await root.collection('distClosures').doc(`closure_${reopenedA}`).set({ id: `closure_${reopenedA}`, restaurantId: 'sanjose', routeId: reopenedRoute, dispatchId: reopenedA, status: 'reopened', reopenedAt: '2026-10-28T15:00:00.000Z', reopenHistory: [{ reopenedAt: '2026-10-28T15:00:00.000Z', previousClosedAt: '2026-10-28T12:00:00.000Z' }], products: [] })
  await root.collection('distSales').doc(`${token}-reopen-gap-sale`).set({ id: `${token}-reopen-gap-sale`, restaurantId: 'sanjose', routeId: reopenedRoute, sourceLocation: 'route', createdAt: '2026-10-28T13:00:00.000Z', lines: [], total: 0, cashAmount: 0, qrAmount: 0, creditAmount: 0 })
  const reopenGapResult = await closeWarehouse(reopenedRoute, reopenedB, `${token}-reopen-gap-close`)
  assert.equal(reopenGapResult.status, 'confirmed', 'una venta durante el intervalo cerrado no se atribuye al despacho reabierto')

  const reopenedOverlapRoute = `${token}-reopened-overlap-route`
  const reopenedOverlapA = `${token}-reopened-overlap-a`
  const reopenedOverlapB = `${token}-reopened-overlap-b`
  await root.collection('distDispatches').doc(reopenedOverlapA).set({ id: reopenedOverlapA, restaurantId: 'sanjose', routeId: reopenedOverlapRoute, routeName: 'QA Route', distributorUid: 'qa-distributor', distributorName: 'QA Distributor', status: 'open', createdAt: '2026-10-28T09:00:00.000Z', lines: [], additions: [] })
  await root.collection('distDispatches').doc(reopenedOverlapB).set({ id: reopenedOverlapB, restaurantId: 'sanjose', routeId: reopenedOverlapRoute, routeName: 'QA Route', distributorUid: 'qa-distributor', distributorName: 'QA Distributor', status: 'open', createdAt: '2026-10-28T10:00:00.000Z', lines: [], additions: [] })
  await root.collection('distClosures').doc(`closure_${reopenedOverlapA}`).set({ id: `closure_${reopenedOverlapA}`, restaurantId: 'sanjose', routeId: reopenedOverlapRoute, dispatchId: reopenedOverlapA, status: 'reopened', reopenedAt: '2026-10-28T15:00:00.000Z', reopenHistory: [{ reopenedAt: '2026-10-28T15:00:00.000Z', previousClosedAt: '2026-10-28T12:00:00.000Z' }], products: [] })
  await root.collection('distSales').doc(`${token}-reopen-overlap-sale`).set({ id: `${token}-reopen-overlap-sale`, restaurantId: 'sanjose', routeId: reopenedOverlapRoute, sourceLocation: 'route', createdAt: '2026-10-28T16:00:00.000Z', lines: [], total: 0, cashAmount: 0, qrAmount: 0, creditAmount: 0 })
  const reopenOverlapResult = await closeWarehouse(reopenedOverlapRoute, reopenedOverlapB, `${token}-reopen-overlap-close`)
  assert.equal(reopenOverlapResult.status, 'rejected', 'una venta durante la reapertura se mantiene ambigua cuando ambos despachos estaban abiertos')

  const undatedRoute = `${token}-undated-route`
  const undatedDispatch = `${token}-undated-dispatch`
  await root.collection('distDispatches').doc(undatedDispatch).set({ id: undatedDispatch, restaurantId: 'sanjose', routeId: undatedRoute, routeName: 'QA Route', distributorUid: 'qa-distributor', distributorName: 'QA Distributor', status: 'open', createdAt: '2026-10-28T09:00:00.000Z', lines: [], additions: [] })
  await root.collection('distSales').doc(`${token}-undated-sale`).set({ id: `${token}-undated-sale`, restaurantId: 'sanjose', routeId: undatedRoute, sourceLocation: 'route', lines: [], total: 0, cashAmount: 0, qrAmount: 0, creditAmount: 0 })
  const undatedResult = await closeWarehouse(undatedRoute, undatedDispatch, `${token}-undated-close`)
  assert.equal(undatedResult.status, 'rejected', 'una venta efectiva sin fecha confiable sigue bloqueando aunque solo exista un despacho')
  assert.match(undatedResult.error, /ventas históricas.*no se pueden atribuir con seguridad/i)

  assert.equal((await root.collection('distStockMovements').get()).size, movementCountBefore, 'ventas inactivas sin líneas no generan movimientos ni cambios físicos')
  console.log('PASS Emulator: anuladas/pendientes excluidas; ventas ambiguas bloquean en traslapes cerrados y reabiertos, mientras los intervalos inequívocos concilian sin alterar stock')
} finally {
  await app.delete()
}
