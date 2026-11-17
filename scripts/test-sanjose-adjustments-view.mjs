import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const dom = new JSDOM('<div id="app"></div>', { url: 'http://localhost/' })
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  localStorage: dom.window.localStorage,
  IS_REACT_ACT_ENVIRONMENT: true,
})
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })

let searchResults = []
let loadedTraceability = null
const suppliers = [
  { id: 'supplier-A', name: 'LA CABAÑITA', active: true },
  { id: 'supplier-old', name: 'Proveedor Inactivo Histórico', active: false },
]
const payables = [
  { id: 'A-pending', supplierId: 'supplier-A', supplierName: 'LA CABAÑITA', description: 'Pendiente A', status: 'pending', totalAmount: 100, paidAmount: 0, balance: 100, dayKey: '2026-11-10', groupName: 'Producción', categoryName: 'Materia prima' },
  { id: 'A-paid', supplierId: 'supplier-A', supplierName: 'LA CABAÑITA', description: 'Pagada A', status: 'paid', totalAmount: 50, paidAmount: 50, balance: 0, dayKey: '2026-11-09', groupName: 'Producción', categoryName: 'Materia prima' },
  { id: 'B-pending', supplierId: 'supplier-B', supplierName: 'OTRO PROVEEDOR', description: 'Pendiente B', status: 'pending', totalAmount: 200, paidAmount: 0, balance: 200, dayKey: '2026-11-08', groupName: 'Producción', categoryName: 'Materia prima' },
  { id: 'legacy', supplierName: 'Proveedor Histórico', description: 'Legacy', status: 'pending', totalAmount: 25, paidAmount: 0, balance: 25, dayKey: '2026-11-07', groupName: 'Producción', categoryName: 'Materia prima' },
  { id: 'inactive', supplierId: 'supplier-old', supplierName: 'Proveedor Inactivo Histórico', description: 'Inactivo', status: 'pending', totalAmount: 30, paidAmount: 0, balance: 30, dayKey: '2026-11-06', groupName: 'Producción', categoryName: 'Materia prima' },
]
const payments = payables.map((row) => ({ id: `payment-${row.id}`, payableId: row.id, dayKey: row.dayKey, responsibleName: `Pago ${row.id}`, paymentMethod: 'cash', amount: row.paidAmount, voided: false }))

const vite = await createServer({
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  plugins: [{
    name: 'sanjose-adjustments-repository-fixture',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === '../data/distributionRepository' && /(?:LotTraceabilityModal|SupplierPayablesView|SupplierDirectoryModal)\.tsx$/.test(importer || '')) return '\0sanjose-adjustments-repository'
    },
    load(id) {
      if (id !== '\0sanjose-adjustments-repository') return
      return `
        export const searchLotsByCode = async () => globalThis.__lotSearchResults
        export const loadFullLotTraceability = async (params) => { globalThis.__loadedTraceability = params; throw new Error('QA lookup captured') }
        export const subscribeExpenseSuppliers = cb => { cb(globalThis.__qaSuppliers); return () => {} }
        export const subscribeExpensePayables = cb => { cb(globalThis.__qaPayables); return () => {} }
        export const subscribeSupplierPayments = cb => { cb(globalThis.__qaPayments); return () => {} }
        export const newOperationId = () => 'qa'
        export const registerSupplierPurchase = async () => {}
        export const paySupplierPayable = async () => {}
        export const voidSupplierPayment = async () => {}
        export const voidSupplierPurchase = async () => {}
        export const saveExpenseSupplier = async () => {}
      `
    },
  }],
})
globalThis.__lotSearchResults = searchResults
globalThis.__loadedTraceability = loadedTraceability
globalThis.__qaSuppliers = suppliers
globalThis.__qaPayables = payables
globalThis.__qaPayments = payments

const root = createRoot(document.getElementById('app'))
const container = document.getElementById('app')
const setSelect = async (select, value) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value').set.call(select, value)
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  })
}

try {
  const { LotTraceabilityModal } = await vite.ssrLoadModule('/src/modules/distribution/views/LotTraceabilityModal.tsx')
  const { SupplierPayablesView } = await vite.ssrLoadModule('/src/modules/distribution/views/SupplierPayablesView.tsx')
  const lotA = { id: 'lot-A', productId: 'mortadela', productName: 'Sachet Mortadela PRIMAVERA', lotCode: '101126', unitType: 'unit', quantities: { central: 9 } }
  const lotB = { id: 'lot-B', productId: 'jamon', productName: 'Jamón de cerdo PORCIONADO', lotCode: '101126', unitType: 'unit', quantities: { central: 0 } }
  const products = [{ id: 'mortadela', name: 'Sachet Mortadela PRIMAVERA', unitType: 'unit' }, { id: 'jamon', name: 'Jamón de cerdo PORCIONADO', unitType: 'unit' }]
  searchResults = [lotA, lotB]
  globalThis.__lotSearchResults = searchResults
  await act(async () => root.render(React.createElement(LotTraceabilityModal, { isOpen: true, onClose: () => {}, products, routes: [] })))
  const input = container.querySelector('input[placeholder^="Código de lote"]')
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, '101126')
    const reactPropsKey = Object.keys(input).find((key) => key.startsWith('__reactProps$'))
    assert.ok(reactPropsKey, 'React controla la búsqueda de lote')
    input[reactPropsKey].onChange({ target: input })
  })
  await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent.includes('Rastrear lote')).click())
  assert.match(container.textContent, /Sachet Mortadela PRIMAVERA/)
  assert.match(container.textContent, /Jamón de cerdo PORCIONADO/)
  assert.match(container.textContent, /9 u disponibles/)
  assert.match(container.textContent, /0 existencias · Lote agotado/)
  assert.match([...container.querySelectorAll('button')].find((button) => button.textContent.includes('Sachet Mortadela PRIMAVERA'))?.querySelector('p')?.className || '', /break-words/)
  await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent.includes('Jamón de cerdo PORCIONADO')).click())
  await act(async () => Promise.resolve())
  assert.equal(globalThis.__loadedTraceability.lotId, 'lot-B')
  assert.equal(globalThis.__loadedTraceability.productId, 'jamon')
  assert.equal(globalThis.__loadedTraceability.existingLot.id, 'lot-B')
  assert.equal(globalThis.__loadedTraceability.skipProductLookup, true)
  console.log('PASS UI lotes: presenta ambos productos y stock (incluye agotado); abrir envía lot.id + productId sin leer productos.')

  const data = { expenseGroups: [], expenseCategories: [] }
  const session = { restaurantId: 'sanjose', restaurantName: 'Embutidos San José', uid: 'qa', userName: 'QA', role: 'admin', warehouseId: 'central', routeId: null, dayKeys: [], setDayKeys: () => {}, can: () => true }
  await act(async () => root.render(React.createElement(SupplierPayablesView, { data, session, readOnly: true })))
  const selects = [...container.querySelectorAll('select')]
  assert.equal(selects.length, 2)
  const supplierOptions = [...selects[1].options].map((option) => option.textContent)
  for (const expected of ['Todos los proveedores', 'LA CABAÑITA', 'Proveedor Histórico', 'Proveedor Inactivo Histórico']) assert.ok(supplierOptions.includes(expected), `Falta proveedor histórico ${expected}`)
  assert.match(container.textContent, /Pagado en compras registradas.*?Bs/)
  await setSelect(selects[0], 'pending')
  assert.match(container.textContent, /Pendiente A/)
  assert.match(container.textContent, /Pendiente B/)
  await setSelect(selects[1], 'supplier-A')
  assert.match(container.textContent, /Pendiente A/)
  assert.doesNotMatch(container.textContent, /Pendiente B/)
  assert.doesNotMatch(container.textContent, /Pagada A/)
  const aRow = [...container.querySelectorAll('details')].find((row) => row.textContent.includes('Pendiente A'))
  assert.match(aRow.textContent, /Pago A-pending/)
  assert.doesNotMatch(aRow.textContent, /Pago B-pending/)
  assert.match(container.textContent, /Bs 100\.00/)
  await setSelect(selects[0], 'paid')
  assert.match(container.textContent, /Pagada A/)
  assert.doesNotMatch(container.textContent, /Pendiente A/)
  assert.match(container.textContent, /Bs 50\.00/)
  console.log('PASS UI cuentas: combina estado/proveedor, incluye legacy e inactivo y mantiene pagos por cuenta.')
} finally {
  await act(async () => root.unmount())
  await vite.close()
  dom.window.close()
}
