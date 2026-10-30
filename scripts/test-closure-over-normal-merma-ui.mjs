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

const sales = [{
  id: 'sale-77', restaurantId: 'sanjose', createdAt: '2026-10-24T20:12:02.026Z', createdBy: 'luciano', dayKey: '2026-10-24',
  operationId: 'sale-77', sourceLocation: 'route', dispatchId: 'dispatch-luciano', routeId: 'route-sacaba', routeName: 'Sacaba',
  sellerUid: 'luciano', sellerName: 'Luciano', lines: [{ productId: 'viena', productNameSnapshot: 'Salchicha Viena', quantity: 77, unitType: 'kg', subtotal: 3465, actualUnitPrice: 45, allocations: [] }],
  total: 3465, paymentKind: 'cash', cashAmount: 3465, qrAmount: 0, creditAmount: 0,
}]
let savePayload
const vite = await createServer({
  optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true }, appType: 'custom',
  plugins: [{
    name: 'mock-over-normal-closure-repository', enforce: 'pre',
    resolveId(source, importer) { return importer?.endsWith('/ClosureView.tsx') && source === '../data/distributionRepository' ? '\0mock-over-normal-closure-repository' : null },
    load(id) {
      if (id !== '\0mock-over-normal-closure-repository') return null
      return `
        export const declareRouteReturn = async () => {}
        export const newOperationId = () => 'closure-over-normal-ui-test'
        export const reopenClosure = async () => {}
        export const saveClosure = async (payload) => { globalThis.__savedClosurePayload = payload }
        export const setClosureVarianceReviewed = async () => {}
        export const subscribeClosedDispatchesForRoute = (_route, onData) => { onData([]); return () => {} }
        export const subscribeDispatchSettlementSales = (_route, _dispatch, onData) => { onData(globalThis.__closureTestSales); return () => {} }
        export const subscribeSales = (_days, _route, onData) => { onData(globalThis.__closureTestSales); return () => {} }
        export const subscribeCollections = (_days, _route, onData) => { onData([]); return () => {} }
        export const subscribeExpenses = (_days, _route, onData) => { onData([]); return () => {} }
      `
    },
  }],
})

try {
  globalThis.__closureTestSales = sales
  globalThis.__savedClosurePayload = undefined
  const { ClosureView } = await vite.ssrLoadModule('/src/modules/distribution/views/ClosureView.tsx')
  const dispatch = {
    id: 'dispatch-luciano', restaurantId: 'sanjose', routeId: 'route-sacaba', routeName: 'Sacaba',
    distributorUid: 'luciano', distributorName: 'Luciano', warehouseId: 'central', status: 'open',
    createdAt: '2026-10-24T11:59:45.000Z', dayKey: '2026-10-24',
    lines: [{ productId: 'viena', productName: 'Salchicha tipo Viena Granel 1', unitType: 'kg', quantity: 77.88, normalQuantity: 76, dispatchMerma: 1.88, allocations: [] }], additions: [],
  }
  const closure = {
    id: 'closure_dispatch-luciano', restaurantId: 'sanjose', dispatchId: dispatch.id, routeId: dispatch.routeId,
    routeName: dispatch.routeName, distributorUid: dispatch.distributorUid, distributorName: dispatch.distributorName,
    status: 'draft', products: [], declaredReturns: { viena: 0 }, declaredReturnMermas: {},
    returnDeclarationMode: 'normal_only', returnDeclaredBy: 'luciano', returnDeclaredAt: '2026-10-24T20:52:31.000Z', dayKey: dispatch.dayKey,
    cashSales: 3465, qrSales: 0, creditGenerated: 0, cashCollections: 0, qrCollections: 0, cashExpenses: 0, expectedCash: 3465, cashDifference: 0,
  }
  const data = {
    openDispatches: [dispatch], closures: [closure], claims: [], sales, collections: [], expenses: [],
    balances: [], lots: [], routes: [], products: [{ id: 'viena', name: dispatch.lines[0].productName, unitType: 'kg' }], warehouses: [], transfers: [], operations: [],
    receivables: [], customers: [], stockMovements: [], qrVerifications: [], creditStatus: [], supportSettings: { requireQrVerification: false },
  }
  const session = {
    restaurantId: 'sanjose', restaurantName: 'Embutidos San José', uid: 'warehouse', userName: 'Almacén QA', role: 'warehouse',
    warehouseId: 'central', routeId: null, dayKeys: ['2026-10-24'], setDayKeys: () => {}, can: () => true,
  }
  const container = document.getElementById('app')
  const root = createRoot(container)
  await act(async () => root.render(React.createElement(ClosureView, { session, data })))
  const receiveButton = [...container.querySelectorAll('button')].find(button => button.textContent.includes('Registrar recepción'))
  assert.ok(receiveButton, 'Almacén puede abrir la recepción declarada')
  await act(async () => receiveButton.click())
  assert.match(container.textContent, /77 kg/)
  assert.match(container.textContent, /76 kg/)
  assert.match(container.textContent, /1 kg de la merma adicional ya están comprendidos/)
  assert.match(container.textContent, /Faltante/)
  const confirmation = [...container.querySelectorAll('label')].find(label => label.textContent.includes('Confirmo físicamente'))
  assert.ok(confirmation, 'Almacén ve confirmación explícita para el peso adicional no cobrado')
  const checkbox = confirmation.querySelector('input[type="checkbox"]')
  const propsKey = Object.keys(checkbox).find(key => key.startsWith('__reactProps$'))
  await act(async () => checkbox[propsKey].onChange({ target: { checked: true } }))
  assert.equal(checkbox.checked, true)
  assert.match(container.textContent, /0\.88 kg adicionales salieron dentro de bolsas/)
  assert.doesNotMatch(container.textContent, /Retorno normal: -1 kg/)
  const reason = container.querySelector('input[placeholder="Describe brevemente la comprobación física"]')
  assert.ok(reason, 'la confirmación exige un motivo documental')
  const reasonPropsKey = Object.keys(reason).find(key => key.startsWith('__reactProps$'))
  await act(async () => reason[reasonPropsKey].onChange({ target: { value: 'Almacén verificó el peso físico en las bolsas.' } }))
  const saveEditor = [...container.querySelectorAll('button')].find(button => button.textContent.includes('Guardar recepción'))
  await act(async () => saveEditor.click())
  const saveWarehouse = [...container.querySelectorAll('button')].find(button => button.textContent.includes('Guardar retorno de almacén'))
  await act(async () => saveWarehouse.click())
  const confirmWarehouse = [...container.querySelectorAll('button')].find(button => button.textContent.includes('Confirmar recepción'))
  assert.ok(confirmWarehouse, 'Almacén ve la confirmación final antes de grabar')
  await act(async () => confirmWarehouse.click())
  assert.equal(globalThis.__savedClosurePayload.closure.products[0].dispatchMermaEmbeddedInSalesConfirmed, true)
  assert.equal(globalThis.__savedClosurePayload.closure.products[0].dispatchMermaEmbeddedInSalesReason, 'Almacén verificó el peso físico en las bolsas.')
  await act(async () => root.unmount())
  console.log('PASS UI recepción: sobrepeso requiere confirmación y motivo; ambos llegan al payload del cierre')
} finally {
  await vite.close()
  dom.window.close()
  delete globalThis.__closureTestSales
  delete globalThis.__savedClosurePayload
}
