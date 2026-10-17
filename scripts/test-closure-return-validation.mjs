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
Object.defineProperty(dom.window.document, 'documentMode', { value: 11 })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
dom.window.HTMLElement.prototype.attachEvent = function () {}
dom.window.HTMLElement.prototype.detachEvent = function () {}
let scrolledCard = null
dom.window.HTMLElement.prototype.scrollIntoView = function () { scrolledCard = this.dataset.returnProduct }
const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  plugins: [{
    name: 'mock-closure-repository',
    enforce: 'pre',
    resolveId(source, importer) {
      return importer?.endsWith('/ClosureView.tsx') && source === '../data/distributionRepository' ? '\0mock-closure-repository' : null
    },
    load(id) {
      if (id !== '\0mock-closure-repository') return null
      return `
        export const declareRouteReturn = async () => {}
        export const reopenClosure = async () => {}
        export const saveClosure = async () => {}
        export const setClosureVarianceReviewed = async () => {}
        export const subscribeSales = (_days, _route, onData) => { onData([]); return () => {} }
        export const subscribeCollections = (_days, _route, onData) => { onData([]); return () => {} }
        export const subscribeExpenses = (_days, _route, onData) => { onData([]); return () => {} }
      `
    },
  }],
})
const { ClosureView } = await vite.ssrLoadModule('/src/modules/distribution/views/ClosureView.tsx')
const container = document.getElementById('app')
const root = createRoot(container)
const dayKey = new Date().toISOString().slice(0, 10)
const lines = Array.from({ length: 19 }, (_, index) => ({
  productId: index === 8 ? 'jamon' : `product-${index}`,
  productName: index === 8 ? 'Jamon de cerdo Granel' : `Producto ${index + 1}`,
  unitType: 'kg',
  quantity: 2,
}))
const dispatch = {
  id: 'dispatch-ricardo-qa', restaurantId: 'sanjose', routeId: 'route-ricardo-qa', routeName: 'Zona Sud',
  distributorUid: 'ricardo-qa', distributorName: 'Ricardo QA', warehouseId: 'central', status: 'open',
  createdAt: new Date().toISOString(), dayKey, lines, additions: [],
}
const data = {
  openDispatches: [dispatch], closures: [], claims: [], sales: [], collections: [], expenses: [],
  balances: [], lots: [], routes: [], products: [], warehouses: [], transfers: [], operations: [],
  receivables: [], customers: [], stockMovements: [], qrVerifications: [], creditStatus: [],
  supportSettings: { requireQrVerification: false },
}
const session = {
  restaurantId: 'sanjose', restaurantName: 'Embutidos San José', uid: dispatch.distributorUid,
  userName: 'Ricardo QA', role: 'distributor', warehouseId: 'central', routeId: dispatch.routeId,
  dayKeys: [dayKey], setDayKeys: () => {}, can: () => true,
}
const inputFor = (productId, field) => container.querySelector(`[data-return-product="${productId}"] input[data-return-field="${field}"]`)
async function setInput(input, value) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
  setter.call(input, value)
  const reactPropsKey = Object.keys(input).find(key => key.startsWith('__reactProps$'))
  assert.ok(reactPropsKey, 'React controla el input del retorno')
  await act(async () => input[reactPropsKey].onChange({ target: input }))
}
async function click(label) {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent.trim() === label)
  assert.ok(button, `Falta botón ${label}`)
  await act(async () => button.click())
}

try {
  await act(async () => root.render(React.createElement(ClosureView, { session, data })))
  for (const line of lines) {
    await setInput(inputFor(line.productId, 'normal'), line.productId === 'jamon' ? '1.5' : '0')
    await setInput(inputFor(line.productId, 'merma'), line.productId === 'jamon' ? '0,' : '0')
  }
  await setInput(container.querySelector('input[type="number"]'), '0')
  await click('Declarar retorno para almacén')
  assert.equal(scrolledCard, 'jamon', 'el producto inválido se desplaza a la vista')
  const jamonCard = container.querySelector('[data-return-product="jamon"]')
  assert.match(jamonCard.textContent, /Revisa esta cantidad/)
  assert.match(jamonCard.textContent, /Termina de escribir el decimal/)
  assert.equal(document.activeElement, inputFor('jamon', 'merma'), 'el campo inválido queda enfocado')
  assert.equal(inputFor('product-18', 'normal').value, '0', 'corregir una línea conserva las otras 18 cantidades')
  assert.equal(container.querySelectorAll('[role="alert"]').length, 1)
  await setInput(inputFor('jamon', 'merma'), '0,08')
  await click('Declarar retorno para almacén')
  assert.match(container.textContent, /Confirmar declaración de retorno/, 'cantidades válidas avanzan a confirmación')
  console.log('PASS: declaración enfoca/resalta el producto inválido y conserva los otros 18 borradores')
} finally {
  await act(async () => root.unmount())
  await vite.close()
  dom.window.close()
}
