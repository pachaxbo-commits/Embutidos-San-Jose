import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' })
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true, localStorage: dom.window.localStorage,
})
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })

const callbacks = new Map()
globalThis.__closureRouteSwitchSubscribe = (kind, routeId, callback) => {
  callbacks.set(`${kind}:${routeId}`, callback)
  return () => callbacks.delete(`${kind}:${routeId}`)
}
const vite = await createServer({
  server: { middlewareMode: true }, appType: 'custom',
  plugins: [{
    name: 'closure-route-switch-repository', enforce: 'pre',
    resolveId(id, importer) {
      if (id === '../data/distributionRepository' && importer?.includes('ClosureView.tsx')) return '\0closure-route-switch-repository'
    },
    load(id) {
      if (id !== '\0closure-route-switch-repository') return
      return `export const subscribeClosedDispatchesForRoute = (_route, callback) => { callback([]); return () => {} }
export const subscribeDispatchSettlementSales = (route, _dispatch, callback) => globalThis.__closureRouteSwitchSubscribe('sales', route, callback)
export const subscribeSales = (_days, route, callback) => globalThis.__closureRouteSwitchSubscribe('sales', route, callback)
export const subscribeCollections = (_days, route, callback) => globalThis.__closureRouteSwitchSubscribe('collections', route, callback)
export const subscribeExpenses = (_days, route, callback) => globalThis.__closureRouteSwitchSubscribe('expenses', route, callback)
export const declareRouteReturn = async () => { throw new Error('No submit in this test') }
export const reopenClosure = async () => { throw new Error('No submit in this test') }
export const saveClosure = async () => { throw new Error('No submit in this test') }
export const setClosureVarianceReviewed = async () => { throw new Error('No submit in this test') }`
    },
  }],
})
const { ClosureView } = await vite.ssrLoadModule('/src/modules/distribution/views/ClosureView.tsx')
const root = createRoot(document.getElementById('app'))
const dayKey = new Date().toISOString().slice(0, 10)
const createdAt = new Date().toISOString()
const ricardo = {
  id: 'dispatch-ricardo', restaurantId: 'sanjose', routeId: 'route-ricardo', routeName: 'Zona Sud',
  distributorUid: 'ricardo', distributorName: 'Ricardo', warehouseId: 'central', status: 'open',
  createdAt, dayKey, lines: [{ productId: 'viena', productName: 'Viena', unitType: 'kg', quantity: 100 }], additions: [],
}
const hugo = {
  ...ricardo, id: 'dispatch-hugo', routeId: 'route-hugo', routeName: 'Zona Norte',
  distributorUid: 'hugo', distributorName: 'Hugo',
  lines: [{ productId: 'viena', productName: 'Viena', unitType: 'kg', quantity: 10 }],
}
const data = {
  openDispatches: [ricardo, hugo], closures: [], claims: [], sales: [], collections: [], expenses: [],
  balances: [], lots: [], routes: [], products: [], warehouses: [], transfers: [], operations: [],
  receivables: [], customers: [], stockMovements: [], qrVerifications: [], creditStatus: [],
  supportSettings: { requireQrVerification: false },
}
const session = {
  restaurantId: 'sanjose', restaurantName: 'Embutidos San José', uid: 'admin', userName: 'Admin', role: 'admin',
  warehouseId: 'central', routeId: null, dayKeys: [dayKey], setDayKeys: () => {}, can: () => true,
}
const priorError = console.error
const errors = []
console.error = (...args) => { errors.push(args.map(String).join(' ')); priorError(...args) }
try {
  await act(async () => root.render(React.createElement(ClosureView, { session, data })))
  assert.match(document.body.textContent, /Zona Sud · Ricardo/)
  await act(async () => callbacks.get('sales:route-ricardo')([{ id: 'sale-ricardo', saleKind: 'regular', lines: [{ productId: 'viena', productNameSnapshot: 'Viena', unitType: 'kg', quantity: 50, subtotal: 500 }] }]))
  assert.match(document.body.textContent, /Debía retornar/)
  const selectRoute = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Zona Sud · Ricardo')
  assert.ok(selectRoute)
  await act(async () => selectRoute.click())
  const hugoButton = [...document.querySelectorAll('button')].find(button => button.textContent.includes('Zona Norte') && button.textContent.includes('Hugo'))
  assert.ok(hugoButton)
  await act(async () => hugoButton.click())
  assert.match(document.body.textContent, /Zona Norte · Hugo/)
  assert.doesNotMatch(document.body.textContent, /Se produjo un error al mostrar esta sección/)
  assert.ok(!errors.some(error => error.includes('Las cantidades de retorno deben ser válidas')), 'No debe conciliar las 50 kg de Ricardo con las 10 kg de Hugo')
  await act(async () => callbacks.get('sales:route-hugo')([]))
  assert.match(document.body.textContent, /Zona Norte · Hugo/)
  console.log('PASS: al cambiar Ricardo → Hugo, el render no usa ventas obsoletas de otra ruta')
} finally {
  console.error = priorError
  await act(async () => root.unmount())
  await vite.close()
  dom.window.close()
  delete globalThis.__closureRouteSwitchSubscribe
}
