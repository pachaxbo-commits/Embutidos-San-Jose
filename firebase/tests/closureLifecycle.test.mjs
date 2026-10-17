// Ciclo completo confinado a Firebase Emulator. No usa credenciales ni datos de producción.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085'
const requireFunctions = createRequire(new URL('../../functions/package.json', import.meta.url))
const { initializeApp } = requireFunctions('firebase-admin/app')
const { getFirestore } = requireFunctions('firebase-admin/firestore')
const { processCommand, dayKey } = requireFunctions('./operations.cjs')
const app = initializeApp({ projectId: 'demo-pachax-audit' }, `closure-lifecycle-${Date.now()}`)
const db = getFirestore(app)
const rootDoc = db.doc('restaurants/sanjose')
const prefix = `lifecycle-${Date.now().toString(36)}`
const adminUid = `${prefix}-admin`, warehouseUid = `${prefix}-warehouse`, sellerUid = `${prefix}-seller`
const routeId = `${prefix}-route`, productId = `${prefix}-product`
const now = () => new Date().toISOString()
const read = async (collection, id) => (await rootDoc.collection(collection).doc(id).get()).data()
async function command(actor, type, payload, expected = 'confirmed') {
  const id = `${prefix}-${type}-${Math.random().toString(36).slice(2)}`
  const ref = rootDoc.collection('distOperations').doc(id)
  await ref.set({ id, restaurantId: 'sanjose', createdBy: actor, createdAt: now(), type, payload, status: 'queued' })
  await processCommand(db, ref)
  const result = (await ref.get()).data()
  assert.equal(result.status, expected, `${type}: ${result.error || 'sin respuesta'}`)
  return { ...result, id }
}

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' })
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
const { ClosureView } = await vite.ssrLoadModule('/src/modules/distribution/views/ClosureView.tsx')
const { normalizeClosure } = await vite.ssrLoadModule('/src/modules/distribution/domain/closurePeriod.ts')
const { ErrorBoundary } = await vite.ssrLoadModule('/src/components/ErrorBoundary.tsx')
const container = document.getElementById('app')
const reactRoot = createRoot(container)
const errors = []
const originalError = console.error
console.error = (...args) => { errors.push(args.map(String).join(' ')) }
const emptyData = {
  openDispatches: [], closures: [], claims: [], sales: [], collections: [], expenses: [],
  balances: [], lots: [], routes: [], products: [], warehouses: [], transfers: [], operations: [],
  receivables: [], customers: [], movements: [], qrVerifications: [], creditStatus: [],
  supportSettings: { requireQrVerification: false },
}
const session = role => ({ restaurantId: 'sanjose', restaurantName: 'Embutidos San José',
  uid: role === 'distributor' ? sellerUid : role === 'warehouse' ? warehouseUid : adminUid,
  userName: role, role, warehouseId: 'central', routeId: role === 'distributor' ? routeId : null,
  dayKeys: [dayKey(new Date())], setDayKeys: () => {}, can: () => true })
async function render(role, dispatchIds, closureId) {
  const dispatches = (await Promise.all(dispatchIds.map(id => read('distDispatches', id)))).filter(item => item?.status === 'open')
  const closure = closureId ? await read('distClosures', closureId) : null
  await act(async () => reactRoot.render(React.createElement(ErrorBoundary, null,
    React.createElement(ClosureView, { session: session(role), data: {
      ...emptyData, openDispatches: dispatches, closures: closure ? [normalizeClosure(closure)] : [],
    } }))))
  assert.doesNotMatch(container.textContent, /Se produjo un error al mostrar esta sección/)
  const renderErrors = errors.filter(message => !message.includes('MetadataLookupWarning'))
  assert.equal(renderErrors.length, 0, `error en render ${role}: ${renderErrors.at(-1) || ''}`)
  return container.textContent
}
async function click(label) {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent.trim() === label)
  assert.ok(button, `falta botón ${label}`)
  await act(async () => button.click())
}

try {
  await rootDoc.collection('members').doc(adminUid).set({ role: 'admin', active: true, displayName: 'Admin QA' })
  await rootDoc.collection('members').doc(warehouseUid).set({ role: 'warehouse', active: true, warehouseId: 'central', displayName: 'Almacén QA' })
  await rootDoc.collection('members').doc(sellerUid).set({ role: 'distributor', active: true, routeId, displayName: 'Hugo QA' })
  await rootDoc.collection('distProducts').doc(productId).set({ id: productId, restaurantId: 'sanjose', name: 'Viena QA', unitType: 'kg', active: true, referencePrice: 40, productionCost: 10 })
  const intake = await command(adminUid, 'intake', { lines: [{ productId, quantity: 10, lotCode: 'LOTE-QA', manufacturedOn: dayKey(new Date()), expiresOn: '2027-12-31', productionCost: 10 }], note: 'Ciclo de cierre QA' })
  const dispatched = await command(warehouseUid, 'dispatch', { warehouseId: 'central', routeId, routeName: 'Zona Norte QA', distributorUid: sellerUid, distributorName: 'Hugo QA', lines: [{ productId, quantity: 6, allocationsRequested: [{ lotId: `${intake.id}__0`, quantity: 6 }] }] })
  const dispatchId = dispatched.id, closureId = `closure_${dispatchId}`
  await render('distributor', [dispatchId], null)

  // La declaración real escribe un documento parcial y NO mueve inventario.
  const stockBefore = (await read('distBalances', `central__${productId}`)).quantity
  await rootDoc.collection('distClosures').doc(closureId).set({ id: closureId, restaurantId: 'sanjose', dispatchId, routeId,
    distributorUid: sellerUid, distributorName: 'Hugo QA', declaredReturns: { [productId]: 5.92 }, declaredReturnMermas: { [productId]: 0.08 },
    returnDeclaredBy: sellerUid, returnDeclaredAt: now(), dayKey: dayKey(new Date()), physicalCashDeclared: 0 }, { merge: true })
  const draft = await read('distClosures', closureId)
  assert.equal(draft.status, undefined)
  assert.equal(normalizeClosure(draft).status, 'draft')
  assert.equal((await read('distDispatches', dispatchId)).status, 'open')
  assert.equal((await read('distBalances', `central__${productId}`)).quantity, stockBefore)
  await render('distributor', [dispatchId], closureId)
  await render('warehouse', [dispatchId], closureId)
  await click('Registrar recepción')
  const normal = container.querySelector('input[placeholder="Cantidad recibida"]')
  const merma = container.querySelector('input[placeholder="0"]')
  assert.equal(normal.value, '5.92')
  assert.equal(merma.value, '0.08')
  await click('Usar cantidad declarada')
  assert.equal(normal.value, '5.92')
  assert.equal(merma.value, '0.08')
  await click('Guardar recepción')
  assert.match(container.textContent, /1 de 1 productos revisados/)
  await render('admin', [dispatchId], closureId)

  await command(warehouseUid, 'closure', { mode: 'warehouse', closure: { dispatchId, products: [{ productId, actualReturn: 5.92, returnMerma: 0.08, returnWaste: 0, physicalReturn: 6 }] } })
  const received = await read('distClosures', closureId)
  assert.equal(received.status, 'warehouse_done')
  assert.ok(received.warehouseClosedBy && received.warehouseClosedAt)
  assert.equal((await read('distDispatches', dispatchId)).status, 'open')
  assert.equal((await read('distBalances', `central__${productId}`)).quantity, stockBefore + 6)
  await render('warehouse', [dispatchId], closureId)
  await render('admin', [dispatchId], closureId)
  assert.match(container.textContent, /Devolución confirmada por almacén/)
  await command(warehouseUid, 'closure', { mode: 'warehouse', closure: { dispatchId, products: [{ productId, actualReturn: 5.92, returnMerma: 0.08, returnWaste: 0, physicalReturn: 6 }] } }, 'rejected')
  assert.equal((await read('distBalances', `central__${productId}`)).quantity, stockBefore + 6)

  await command(adminUid, 'closure', { mode: 'money', closure: { dispatchId, status: 'closed', physicalCashDeclared: 0 } })
  assert.equal((await read('distClosures', closureId)).status, 'closed')
  assert.equal((await read('distDispatches', dispatchId)).status, 'closed')
  await render('admin', [dispatchId], closureId)
  await command(adminUid, 'closure', { mode: 'money', closure: { dispatchId, status: 'closed', physicalCashDeclared: 0 } }, 'rejected')
  assert.equal((await read('distBalances', `central__${productId}`)).quantity, stockBefore + 6)
  const second = await command(adminUid, 'dispatch', { warehouseId: 'central', routeId, routeName: 'Otra jornada QA',
    distributorUid: sellerUid, distributorName: 'Hugo QA', lines: [{ productId, quantity: 2, allocationsRequested: [{ lotId: `${intake.id}__0`, quantity: 2 }] }] })
  assert.match(await render('admin', [dispatchId, second.id], closureId), /Otra jornada QA/)
  await command(adminUid, 'closure', { mode: 'warehouse', closure: { dispatchId: second.id,
    products: [{ productId, actualReturn: 2, returnMerma: 0, returnWaste: 0, physicalReturn: 2 }] } })
  assert.ok((await read('distClosures', `closure_${second.id}`)).warehouseClosedBy === adminUid)
  assert.equal((await read('distDispatches', second.id)).status, 'open')
  await render('admin', [second.id], `closure_${second.id}`)
  console.log('PASS ciclo Firestore + React: distributor → draft → warehouse → warehouse_done → admin → closed → dispatch null, sin doble stock/cierre')
} finally {
  console.error = originalError
  await act(async () => reactRoot.unmount())
  await vite.close()
  dom.window.close()
  await app.delete()
}
