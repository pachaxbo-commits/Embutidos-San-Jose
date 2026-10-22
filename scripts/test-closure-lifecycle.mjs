import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' })
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
  localStorage: dom.window.localStorage,
})
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
const { ClosureView } = await vite.ssrLoadModule('/src/modules/distribution/views/ClosureView.tsx')
const { normalizeClosure } = await vite.ssrLoadModule('/src/modules/distribution/domain/closurePeriod.ts')
const container = document.getElementById('app')
const root = createRoot(container)
const capturedErrors = []
const priorError = console.error
console.error = (...args) => { capturedErrors.push(args.map(String).join(' ')); priorError(...args) }

const dayKey = new Date().toISOString().slice(0, 10)
const dispatch = {
  id: 'dispatch-hugo-qa', restaurantId: 'sanjose', routeId: 'route-hugo-qa', routeName: 'Zona Norte',
  distributorUid: 'hugo-qa', distributorName: 'Hugo QA', warehouseId: 'central', status: 'open',
  createdAt: new Date().toISOString(), dayKey,
  lines: [{ productId: 'viena-qa', productName: 'Viena QA', unitType: 'kg', quantity: 6 }], additions: [],
}
const rawDraft = {
  id: `closure_${dispatch.id}`, restaurantId: 'sanjose', dispatchId: dispatch.id,
  routeId: dispatch.routeId, distributorUid: dispatch.distributorUid, distributorName: dispatch.distributorName,
  declaredReturns: { 'viena-qa': 3 }, declaredReturnMermas: { 'viena-qa': 0.08 },
  returnDeclaredBy: 'hugo-qa', returnDeclaredAt: new Date().toISOString(), dayKey,
  physicalCashDeclared: 100,
}
const emptyData = {
  openDispatches: [], closures: [], claims: [], sales: [], collections: [], expenses: [],
  balances: [], lots: [], routes: [], products: [], warehouses: [], transfers: [], operations: [],
  receivables: [], customers: [], stockMovements: [], qrVerifications: [], creditStatus: [],
  supportSettings: { requireQrVerification: false },
}
const session = (role) => ({
  restaurantId: 'sanjose', restaurantName: 'Embutidos San José',
  uid: role === 'distributor' ? 'hugo-qa' : `${role}-qa`, userName: `${role} QA`, role,
  warehouseId: 'central', routeId: role === 'distributor' ? dispatch.routeId : null,
  dayKeys: [dayKey], setDayKeys: () => {}, can: () => true,
})
async function render(role, data) {
  await act(async () => { root.render(React.createElement(ClosureView, { session: session(role), data: { ...emptyData, ...data } })) })
  assert.ok(!capturedErrors.some(message => message.includes('ErrorBoundary caught error')), `ErrorBoundary en ${role}`)
  return container.textContent
}
async function clickButton(label) {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent.trim() === label)
  assert.ok(button, `No se encontró botón: ${label}`)
  await act(async () => button.click())
}

try {
  assert.equal(normalizeClosure(rawDraft).status, 'draft')
  assert.deepEqual(normalizeClosure(rawDraft).products, [])
  assert.equal(normalizeClosure(rawDraft).declaredReturnMermas['viena-qa'], 0.08)
  const distributorText = await render('distributor', { openDispatches: [dispatch] })
  assert.doesNotMatch(distributorText, /Merma de retorno|Producto no apto/i, 'el formulario activo del distribuidor no expone controles/etiquetas de merma')
  assert.ok([...container.querySelectorAll('label')].some(label => /CANTIDAD QUE DEVUELVES/i.test(label.textContent)), 'distribuidor conserva únicamente el campo de cantidad normal')
  const draft = normalizeClosure(rawDraft)
  // La lista histórica jamás debe evaluar products de una declaración parcial.
  await render('admin', { openDispatches: [dispatch], closures: [rawDraft] })
  await render('distributor', { openDispatches: [dispatch], closures: [draft] })
  const warehouseText = await render('warehouse', { openDispatches: [dispatch], closures: [draft] })
  assert.match(warehouseText, /Devolución declarada/)
  await clickButton('Registrar recepción')
  const normalInput = container.querySelector('input[placeholder="Cantidad recibida"]')
  const mermaInput = container.querySelector('input[placeholder="0"]')
  assert.equal(normalInput?.value, '3')
  assert.equal(mermaInput?.value, '0.08')
  await clickButton('Usar cantidad declarada')
  assert.equal(normalInput?.value, '3', 'Usar cantidad declarada no debe duplicar la merma en el campo normal')
  assert.equal(mermaInput?.value, '0.08')
  await clickButton('Cancelar')
  await clickButton('Historial de cierres')
  assert.match(container.textContent, /0 cierres encontrados/)
  assert.doesNotMatch(container.textContent, /Ver detalle/)
  await clickButton('Volver al cierre actual')
  assert.match(container.textContent, /Registrar recepción/)
  const adminText = await render('admin', { openDispatches: [dispatch], closures: [draft] })
  assert.match(adminText, /Devolución declarada/)
  const warehouseDone = normalizeClosure({ ...rawDraft, status: 'warehouse_done', warehouseClosedBy: 'warehouse-qa', warehouseClosedAt: new Date().toISOString(), products: [] })
  await render('warehouse', { openDispatches: [dispatch], closures: [warehouseDone] })
  await render('admin', { openDispatches: [dispatch], closures: [warehouseDone] })
  const closed = normalizeClosure({ ...warehouseDone, status: 'closed', closedBy: 'admin-qa', closedAt: new Date().toISOString() })
  await render('admin', { openDispatches: [], closures: [closed] })
  const nextDispatch = { ...dispatch, id: 'dispatch-other-route-qa', routeId: 'route-other-qa', routeName: 'Otra ruta QA' }
  assert.match(await render('admin', { openDispatches: [nextDispatch], closures: [closed] }), /Otra ruta QA/)
  const oldStyleDraft = normalizeClosure({ ...rawDraft, declaredReturnMermas: undefined })
  assert.deepEqual(oldStyleDraft.declaredReturnMermas, {})
  await render('warehouse', { openDispatches: [dispatch], closures: [oldStyleDraft] })
  await clickButton('Registrar recepción')
  assert.equal(container.querySelector('input[placeholder="Cantidad recibida"]')?.value, '3')
  assert.equal(container.querySelector('input[placeholder="0"]')?.value, '0')
  console.log('PASS: renders de distribuidor, borrador parcial, almacén, administración, warehouse_done, closed y dispatch null')
} finally {
  console.error = priorError
  await act(async () => root.unmount())
  await vite.close()
  dom.window.close()
}
