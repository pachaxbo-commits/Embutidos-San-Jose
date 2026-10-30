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

const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  plugins: [{
    name: 'sacheteado-navigation-test-doubles',
    enforce: 'pre',
    resolveId(id, importer) {
      if (id === '../data/distributionRepository' && (importer?.includes('SacheteadoView.tsx') || importer?.includes('ProcessingReportsView.tsx'))) return '\0sacheteado-repository'
      if (id === './ProcessingOperationsView' && importer?.includes('SacheteadoView.tsx')) return '\0sacheteado-operations-view'
    },
    load(id) {
      if (id === '\0sacheteado-repository') return `
        export const newOperationId = prefix => prefix + '-test'
        export const warehouseBalanceId = () => 'central'
        export const loadProcessingBatchPage = async () => ({ rows: [], cursor: null, hasMore: false })
        export const getProcessingOperationState = async () => ({ status: 'missing' })
        export const confirmProcessingBatch = async () => { throw new Error('unexpected submit') }
        export const loadProcessingReviewPage = async () => ({ rows: [], cursor: null, hasMore: false })
        export const loadProcessingRepackPage = async () => ({ rows: [], cursor: null, hasMore: false })
      `
      if (id === '\0sacheteado-operations-view') return `
        import React from 'react'
        export function ProcessingOperationsView({ mode }) { return React.createElement('section', { 'data-testid': 'operations-mode' }, mode) }
      `
    },
  }],
})

try {
  const { SacheteadoView } = await vite.ssrLoadModule('/src/modules/distribution/views/SacheteadoView.tsx')
  const { ProcessingGuide } = await vite.ssrLoadModule('/src/modules/distribution/views/ProcessingGuide.tsx')
  const { TextInput } = await vite.ssrLoadModule('/src/components/ui/Form.tsx')
  const container = document.getElementById('app')
  const root = createRoot(container)
  const session = {
    uid: 'navigation-test', restaurantId: 'sanjose', restaurantName: 'Embutidos San José',
    role: 'admin', warehouseId: 'central', routeId: null, dayKeys: [], setDayKeys: () => {},
    can: () => true,
  }
  const data = { products: [], lots: [], balances: [], warehouses: [], stockMovements: [], operations: [] }
  const readPanel = async () => {
    await act(async () => { await Promise.resolve() })
    return container.textContent || ''
  }
  const renderedOperationMode = () => container.querySelector('[data-testid="operations-mode"]')?.textContent || ''
  const selectTab = async (label) => {
    const button = [...container.querySelectorAll('button')].find(item => item.textContent.trim() === label)
    assert.ok(button, `Pestaña inexistente: ${label}`)
    await act(async () => button.click())
    return readPanel()
  }

  await act(async () => root.render(React.createElement(SacheteadoView, { session, data })))
  let panel = await readPanel()
  assert.match(panel, /Origen/)
  assert.match(panel, /Tutorial · Nueva elaboración/)
  const materialStep = [...container.querySelectorAll('button')].find(item => item.textContent.includes('Materiales'))
  assert.ok(materialStep, 'paso Materiales disponible')
  await act(async () => materialStep.click())
  assert.match(await readPanel(), /Materiales adicionales \(opcional\)/)
  const optionalDetails = [...container.querySelectorAll('details')].find(item => item.querySelector('summary')?.textContent.includes('Materiales adicionales'))
  assert.ok(optionalDetails && !optionalDetails.open, 'los materiales adicionales comienzan colapsados')
  await act(async () => root.render(React.createElement(ProcessingGuide, { topic: 'evidence' })))
  assert.match(await readPanel(), /JPG\/PNG o un PDF de hasta 15 MB/)
  await act(async () => root.render(React.createElement(TextInput, { type: 'date', 'aria-label': 'Fecha del proceso' })))
  const dateInput = container.querySelector('input[type="date"]')
  assert.ok(dateInput?.className.includes('box-border') && dateInput.className.includes('min-w-0') && dateInput.className.includes('max-w-full'), 'los controles compartidos no exceden el ancho del formulario')

  await act(async () => root.render(React.createElement(SacheteadoView, { session, data })))
  panel = await readPanel()
  assert.doesNotMatch(panel, /reservations|review|repack|Historial de elaboraciones/)

  panel = await selectTab('Mercadería reservada')
  assert.equal(renderedOperationMode(), 'reservations')
  assert.doesNotMatch(panel, /Origen/)

  panel = await selectTab('Revisión de producto')
  assert.equal(renderedOperationMode(), 'review')
  assert.doesNotMatch(panel, /Origen/)

  panel = await selectTab('Reenvasado')
  assert.equal(renderedOperationMode(), 'repack')
  assert.doesNotMatch(panel, /Origen/)

  panel = await selectTab('Historial')
  assert.match(panel, /Todavía no hay elaboraciones/)
  assert.equal(renderedOperationMode(), '')
  assert.doesNotMatch(panel, /Origen/)
  const reportsTab = [...container.querySelectorAll('button')].find(item => item.textContent.trim() === 'Reportes')
  assert.ok(reportsTab, 'pestaña de reportes disponible dentro del módulo')
  await act(async () => reportsTab.click())
  panel = await readPanel()
  assert.match(panel, /Trazabilidad por lote/)
  assert.match(panel, /Los filtros y las exportaciones abarcan los registros cargados/)

  await act(async () => root.unmount())
  console.log('PASS: navegación, tutoriales, materiales colapsados y límites de ancho de controles verificados en React/DOM.')
} finally {
  await vite.close()
  dom.window.close()
}
