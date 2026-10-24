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
  optimizeDeps: { noDiscovery: true },
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
        export const declareRouteReturn = async (...args) => { globalThis.__declarationCalls.push(args) }
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
globalThis.__declarationCalls = []
const container = document.getElementById('app')
let root = createRoot(container)
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
async function clickStartingWith(label) {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent.trim().startsWith(label))
  assert.ok(button, `Falta botón que empieza con ${label}`)
  await act(async () => button.click())
}

try {
  await act(async () => root.render(React.createElement(ClosureView, { session, data })))
  assert.equal(container.querySelectorAll('input[data-return-field="merma"]').length, 0, 'el distribuidor no recibe un campo para declarar merma')
  assert.match(container.textContent, /CANTIDAD QUE DEVUELVES/)
  assert.match(container.textContent, /Almacén verificará físicamente la recepción/)
  for (const line of lines) {
    await setInput(inputFor(line.productId, 'normal'), line.productId === 'jamon' ? '1,' : '0')
  }
  await setInput(container.querySelector('input[type="number"]'), '0')
  await click('Declarar retorno para almacén')
  assert.equal(scrolledCard, 'jamon', 'el producto inválido se desplaza a la vista')
  const jamonCard = container.querySelector('[data-return-product="jamon"]')
  assert.match(jamonCard.textContent, /Revisa esta cantidad/)
  assert.match(jamonCard.textContent, /Termina de escribir el decimal/)
  assert.equal(document.activeElement, inputFor('jamon', 'normal'), 'el campo inválido queda enfocado')
  assert.equal(inputFor('product-18', 'normal').value, '0', 'corregir una línea conserva las otras 18 cantidades')
  assert.equal(container.querySelectorAll('[role="alert"]').length, 1)
  await setInput(inputFor('jamon', 'normal'), '1,765')
  await click('Declarar retorno para almacén')
  assert.match(container.textContent, /Confirmar declaración de retorno/, 'cantidades válidas avanzan a confirmación')
  assert.match(container.textContent, /1\.765 kg normal/, 'el resumen final contiene solo la cantidad normal declarada')
  assert.doesNotMatch(container.querySelector('[data-return-product="jamon"]').textContent, /FALTANTE/, 'una declaración parcial no se presenta como faltante definitivo')
  assert.doesNotMatch(container.textContent, /merma 0\.000|Normal .* \+ merma/, 'el resumen de declaración no presenta un desglose de merma')
  await clickStartingWith('Sí, declarar')
  assert.equal(globalThis.__declarationCalls.length, 1, 'la confirmación realiza una sola declaración')
  const [submittedDispatch, submittedReturns, submittedCash] = globalThis.__declarationCalls[0]
  assert.equal(submittedDispatch.id, dispatch.id)
  assert.equal(submittedReturns.jamon, 1.765, 'la declaración conserva precisión de tres decimales con coma')
  assert.equal(submittedReturns['product-18'], 0, 'los valores cero de otros productos se conservan')
  assert.equal(submittedCash, 0, 'la declaración conserva efectivo')
  assert.equal(submittedReturns.jamon, 1.765, 'una declaración parcial no agrega merma ni crea faltante confirmado')

  await act(async () => root.unmount())
  const warehouseDispatch = {
    ...dispatch,
    id: 'dispatch-warehouse-prefill-qa',
    routeId: 'route-warehouse-prefill-qa',
    distributorUid: 'seller-prefill-qa',
    distributorName: 'Distribuidor QA',
    lines: [{ productId: 'jamon', productName: 'Jamón QA', unitType: 'kg', quantity: 21.5 }],
  }
  const warehouseClosure = {
    id: `closure_${warehouseDispatch.id}`, restaurantId: 'sanjose', dispatchId: warehouseDispatch.id,
    routeId: warehouseDispatch.routeId, routeName: 'Zona QA', distributorUid: warehouseDispatch.distributorUid,
    distributorName: warehouseDispatch.distributorName, status: 'draft', products: [], declaredReturns: { jamon: 21 },
    declaredReturnMermas: {}, returnDeclarationMode: 'normal_only', returnDeclaredBy: warehouseDispatch.distributorUid,
    returnDeclaredAt: new Date().toISOString(), physicalCashDeclared: 0, dayKey,
  }
  const warehouseData = {
    ...data, openDispatches: [warehouseDispatch], closures: [warehouseClosure],
    products: [{ id: 'jamon', name: 'Jamón QA', unitType: 'kg', active: true, referencePrice: 10 }],
  }
  const warehouseSession = { ...session, uid: 'warehouse-qa', userName: 'Almacén QA', role: 'warehouse', routeId: undefined }
  root = createRoot(container)
  await act(async () => root.render(React.createElement(ClosureView, { session: warehouseSession, data: warehouseData })))
  assert.match(container.textContent, /Declarado por distribuidor: 21 kg normal/, 'almacén distingue la declaración simple')
  const jamonWarehouseCard = container.querySelector('[data-return-product="jamon"]')
  await act(async () => [...jamonWarehouseCard.querySelectorAll('button')].find(button => button.textContent.includes('Registrar recepción')).click())
  const receiptDialog = container.querySelector('[role="dialog"][aria-label="Registrar recepción"]')
  assert.ok(receiptDialog, 'almacén abre la recepción física')
  const receiptInputs = receiptDialog.querySelectorAll('input')
  assert.equal(receiptInputs.length, 3, 'recepción conserva normal, merma recuperable y no apto')
  await setInput(receiptInputs[0], '99')
  await setInput(receiptInputs[1], '0.5')
  const useDeclared = [...receiptDialog.querySelectorAll('button')].find(button => button.textContent.includes('Usar cantidad declarada'))
  assert.ok(useDeclared, 'almacén dispone de usar cantidad declarada')
  await act(async () => useDeclared.click())
  assert.equal(receiptInputs[0].value, '21', 'usar declaración copia solo el retorno normal')
  assert.equal(receiptInputs[1].value, '0.5', 'usar declaración no inventa ni reemplaza la merma de almacén')
  assert.match(receiptDialog.textContent, /Total recibido[\s\S]*21\.5 kg/, 'el total físico suma 21 kg normales + 0.5 kg de merma')
  assert.match(receiptDialog.textContent, /Vuelve al stock[\s\S]*21\.5 kg/, 'merma recuperable respaldada vuelve al stock vendible')
  await click('Guardar recepción')
  assert.match(jamonWarehouseCard.textContent, /Merma recuperable registrada por Almacén: 0\.5 kg/, 'la merma se atribuye claramente a la recepción de almacén')
  assert.match(jamonWarehouseCard.textContent, /Diferencia entre normal declarado y recibido: 0 kg/, 'la merma recuperable no se presenta como diferencia o faltante del distribuidor')
  console.log('PASS: campo único, merma exclusiva de almacén, prefill normal, total físico y stock 21.5 kg')
} finally {
  await act(async () => root.unmount())
  await vite.close()
  dom.window.close()
}
