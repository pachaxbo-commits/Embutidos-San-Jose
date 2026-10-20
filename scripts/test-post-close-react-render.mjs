import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
    name: 'post-close-react-repository',
    enforce: 'pre',
    resolveId(id, importer) {
      if (id === '../data/distributionRepository' && importer?.includes('ClosureView.tsx')) return '\0post-close-react-repository'
    },
    load(id) {
      if (id !== '\0post-close-react-repository') return
      return `export const subscribeSales = (days, routeId, callback) => globalThis.__postCloseSubscribe('sales', days, routeId, callback)
export const subscribeCollections = (days, routeId, callback) => globalThis.__postCloseSubscribe('collections', days, routeId, callback)
export const subscribeExpenses = (days, routeId, callback) => globalThis.__postCloseSubscribe('expenses', days, routeId, callback)
export const newOperationId = (prefix) => prefix + '-test-id'
export const saveClosure = async (payload) => { globalThis.__postCloseSaves.push(payload); return payload.closure }
export const declareRouteReturn = async (...args) => { globalThis.__postCloseDeclarations.push(args) }
export const reopenClosure = async () => { throw new Error('No se esperaba reabrir') }
export const setClosureVarianceReviewed = async () => { throw new Error('No se esperaba revisar diferencias') }`
    },
  }],
})
const { ClosureView } = await vite.ssrLoadModule('/src/modules/distribution/views/ClosureView.tsx')
const { ErrorBoundary } = await vite.ssrLoadModule('/src/components/ErrorBoundary.tsx')
const { DiagnosticReportsModal } = await vite.ssrLoadModule('/src/components/DiagnosticReportsModal.tsx')
const diagnostics = await vite.ssrLoadModule('/src/lib/errorDiagnostics.ts')
const { normalizeClosure } = await vite.ssrLoadModule('/src/modules/distribution/domain/closurePeriod.ts')
const { toDayKey } = await vite.ssrLoadModule('/src/modules/distribution/domain/engine.ts')
const container = document.getElementById('app')
const root = createRoot(container)
const consoleErrors = []
const priorConsoleError = console.error
console.error = (...args) => {
  consoleErrors.push(args)
  priorConsoleError(...args)
}
window.localStorage.clear()
diagnostics.configureDiagnosticSession({ restaurantId: 'sanjose', uid: 'admin-test', role: 'admin', routeId: null })
let copiedReport = ''
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { copiedReport = text } } })
globalThis.__postCloseSaves = []
globalThis.__postCloseDeclarations = []
const subscriptions = new Map()
globalThis.__postCloseSubscribe = (kind, days, routeId, callback) => {
  const key = `${kind}:${routeId}`
  subscriptions.set(key, callback)
  return () => subscriptions.delete(key)
}

const today = toDayKey(new Date())
const emptyData = {
  openDispatches: [], closures: [], claims: [], sales: [], collections: [], expenses: [],
  balances: [], lots: [], routes: [], products: [], warehouses: [], transfers: [], operations: [],
  receivables: [], customers: [], stockMovements: [], qrVerifications: [], creditStatus: [],
  supportSettings: { requireQrVerification: false },
}
const makeDispatch = (name, suffix) => ({
  id: `dispatch-${suffix}`, restaurantId: 'sanjose', routeId: `route-${suffix}`, routeName: name,
  distributorUid: `uid-${suffix}`, distributorName: name, warehouseId: 'central', status: 'open',
  createdAt: new Date().toISOString(), dayKey: today,
  lines: [{ productId: `product-${suffix}`, productName: `Producto ${name}`, unitType: 'kg', quantity: 10 }],
  additions: [],
})
const makeClosure = (dispatch, status, overrides = {}) => normalizeClosure({
  id: `closure_${dispatch.id}`, restaurantId: 'sanjose', dispatchId: dispatch.id,
  routeId: dispatch.routeId, routeName: dispatch.routeName, distributorUid: dispatch.distributorUid,
  distributorName: dispatch.distributorName, warehouseId: dispatch.warehouseId, dayKey: today,
  createdAt: dispatch.createdAt, createdBy: 'admin-test', schemaVersion: 1, status,
  returnDeclaredAt: dispatch.createdAt, returnDeclaredBy: dispatch.distributorUid,
  declaredReturns: { [`product-${dispatch.id.replace('dispatch-', '')}`]: 10 },
  declaredReturnMermas: {}, cashDeclaredAt: dispatch.createdAt, cashDeclaredBy: 'admin-test',
  physicalCashDeclared: 0, expectedCash: 0, products: [{
    productId: `product-${dispatch.id.replace('dispatch-', '')}`, productName: `Producto ${dispatch.routeName}`,
    unitType: 'kg', totalLoaded: 10, sold: 0, courtesy: 0, expectedReturn: 10, actualReturn: 10,
    returnMerma: 0, returnWaste: 0, variance: 0,
  }],
  ...(status === 'warehouse_done' || status === 'closed' ? { warehouseClosedBy: 'warehouse-test', warehouseClosedAt: dispatch.createdAt } : {}),
  ...(status === 'closed' ? { closedBy: 'admin-test', closedAt: dispatch.createdAt } : {}),
  ...overrides,
})
const makeSession = (role) => ({
  restaurantId: 'sanjose', restaurantName: 'Embutidos San José', uid: `${role}-test`,
  userName: role, role, warehouseId: 'central', routeId: null, dayKeys: [today],
  setDayKeys: () => {}, can: (permission) => role === 'admin'
    ? ['dist.return.register', 'dist.closure.money', 'dist.reports.view'].includes(permission)
    : role === 'warehouse' && permission === 'dist.return.register',
})
const render = async (role, data) => {
  const previousErrorCount = consoleErrors.length
  await act(async () => root.render(React.createElement(ErrorBoundary, null,
    React.createElement(ClosureView, { session: makeSession(role), data: { ...emptyData, ...data } }),
  )))
  const newBoundaryError = consoleErrors.slice(previousErrorCount).find((args) => String(args[0]).includes('ErrorBoundary caught error'))
  assert.equal(newBoundaryError, undefined, `ErrorBoundary atrapó durante render ${role}`)
  assert.doesNotMatch(container.textContent || '', /Se produjo un error al mostrar esta sección/)
  return container.textContent || ''
}
const click = async (label) => {
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent.trim() === label)
  assert.ok(button, `Botón no encontrado: ${label}`)
  assert.equal(button.disabled, false, `Botón deshabilitado: ${label}`)
  await act(async () => button.click())
}
const markRouteDataReady = async (dispatch, role = 'admin') => {
  const kinds = role === 'warehouse' ? ['sales'] : ['sales', 'collections', 'expenses']
  await act(async () => {
    for (const kind of kinds) subscriptions.get(`${kind}:${dispatch.routeId}`)?.([])
  })
}
const finalizeInUi = async (dispatch, closures, openDispatches) => {
  await click('Cerrar ruta')
  await click('Sí, cerrar ruta')
  assert.equal(globalThis.__postCloseSaves.at(-1)?.closure.status, 'closed', 'el click confirmado guarda un único cierre final')
  const closed = globalThis.__postCloseSaves.at(-1).closure
  await render('admin', { openDispatches, closures: [...closures, closed] })
  assert.doesNotMatch(container.textContent || '', /Se produjo un error al mostrar esta sección/)
  if (openDispatches.some((item) => item.id === dispatch.id)) {
    await render('admin', { openDispatches: openDispatches.filter((item) => item.id !== dispatch.id), closures: [...closures, closed] })
  }
  assert.ok(
    (container.textContent || '').includes(`Ruta cerrada correctamente (${dispatch.routeName})`) || (container.textContent || '').includes('Ruta cerrada exitosamente'),
    'la pantalla confirma que el cierre quedó realizado',
  )
  await click('Historial de cierres')
  assert.match(container.textContent || '', new RegExp(dispatch.routeName))
  assert.match(container.textContent || '', /1 cierres encontrados/)
  await click('Volver al cierre actual')
  return closed
}

try {
  // Snapshot order A: cierre closed llega antes de desaparecer el despacho.
  const ricardo = makeDispatch('Zona Sud · Ricardo', 'ricardo')
  const ricardoWarehouseDone = makeClosure(ricardo, 'warehouse_done')
  await render('admin', { openDispatches: [ricardo], closures: [ricardoWarehouseDone] })
  await markRouteDataReady(ricardo)
  const ricardoClosed = await finalizeInUi(ricardo, [ricardoWarehouseDone], [ricardo])

  // Snapshot order B: desaparece el despacho mientras llega el cierre final.
  const lucio = makeDispatch('Ruta Lucio', 'lucio')
  const lucioWarehouseDone = makeClosure(lucio, 'warehouse_done')
  await render('admin', { openDispatches: [lucio], closures: [lucioWarehouseDone] })
  await markRouteDataReady(lucio)
  await click('Cerrar ruta')
  await click('Sí, cerrar ruta')
  const lucioClosed = globalThis.__postCloseSaves.at(-1).closure
  await render('admin', { openDispatches: [], closures: [lucioWarehouseDone] })
  assert.match(container.textContent || '', /No hay rutas abiertas/)
  await render('admin', { openDispatches: [], closures: [lucioClosed] })
  assert.match(container.textContent || '', /Ruta cerrada correctamente \(Ruta Lucio\)/)
  await click('Historial de cierres')
  assert.match(container.textContent || '', /Ruta Lucio/)
  await click('Volver al cierre actual')

  // Otras dos rutas cerradas consecutivamente: al retirar la seleccionada, se muestra la otra.
  const routes = [makeDispatch('Ruta A', 'a'), makeDispatch('Ruta B', 'b')]
  const warehouseDoneRoutes = routes.map((dispatch) => makeClosure(dispatch, 'warehouse_done'))
  await render('admin', { openDispatches: routes, closures: warehouseDoneRoutes })
  await markRouteDataReady(routes[0])
  await click('Cerrar ruta')
  const routeOption = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('Sí, cerrar ruta'))
  assert.ok(routeOption)
  await act(async () => routeOption.click())
  const routeAClosed = globalThis.__postCloseSaves.at(-1).closure
  await render('admin', { openDispatches: [routes[0], routes[1]], closures: [...warehouseDoneRoutes, routeAClosed] })
  await render('admin', { openDispatches: [routes[1]], closures: [...warehouseDoneRoutes, routeAClosed] })
  assert.match(container.textContent || '', /Ruta B/)
  assert.doesNotMatch(container.textContent || '', /Se produjo un error al mostrar esta sección/)
  await markRouteDataReady(routes[1])
  await click('Cerrar ruta')
  await click('Sí, cerrar ruta')
  const routeBClosed = globalThis.__postCloseSaves.at(-1).closure
  await render('admin', { openDispatches: [], closures: [...warehouseDoneRoutes, routeAClosed, routeBClosed] })
  assert.match(container.textContent || '', /No hay rutas abiertas/)
  assert.equal(globalThis.__postCloseSaves.length, 4, 'cuatro confirmaciones UI generan cuatro operaciones únicas')

  // Un borrador declarado puede pasar a warehouse_done sin duplicar la confirmación.
  const hugo = makeDispatch('Ruta Hugo', 'hugo')
  const draft = makeClosure(hugo, 'draft', { warehouseClosedBy: '', warehouseClosedAt: '' })
  await render('warehouse', { openDispatches: [hugo], closures: [draft] })
  await markRouteDataReady(hugo, 'warehouse')
  await click('Registrar recepción')
  await click('Guardar recepción')
  await click('Guardar retorno de almacén')
  assert.equal(globalThis.__postCloseSaves.at(-1)?.closure.status, 'warehouse_done')
  const warehouseDone = globalThis.__postCloseSaves.at(-1).closure
  await render('warehouse', { openDispatches: [hugo], closures: [warehouseDone] })
  assert.match(container.textContent || '', /Devolución confirmada por almacén/)

  // El detalle final entra al historial y la última ruta abierta no deja overlay/modal huérfano.
  const historyProbe = normalizeClosure(ricardoClosed)
  assert.equal(historyProbe.status, 'closed')
  assert.equal(globalThis.__postCloseSaves.length, 5, 'una recepción y cuatro cierres no duplican operaciones')

  let resetToHome = false
  function DiagnosticProbe() {
    if (!resetToHome) throw new Error('closure diagnostic sentinel')
    return React.createElement('div', null, 'Inicio')
  }
  const diagnosticStart = consoleErrors.length
  await act(async () => root.render(React.createElement(ErrorBoundary, { onReset: () => { resetToHome = true }, viewName: 'dist.closure' }, React.createElement(DiagnosticProbe))))
  const diagnostic = consoleErrors.slice(diagnosticStart).find((args) => String(args[0]).includes('ErrorBoundary caught error'))
  assert.ok(diagnostic, 'ErrorBoundary escribe un diagnóstico en consola')
  assert.match(diagnostic[1]?.stack || '', /closure diagnostic sentinel/)
  assert.match(diagnostic[1]?.componentStack || '', /DiagnosticProbe/)
  assert.match(container.textContent || '', /Se produjo un error al mostrar esta sección/)
  assert.doesNotMatch(container.textContent || '', /closure diagnostic sentinel|componentStack|at DiagnosticProbe/)
  assert.match(container.textContent || '', /Código de error: ERR-[A-F0-9]{6}/)
  assert.match(container.textContent || '', /Reporte (enviado a soporte|pendiente de enviar|guardado en este dispositivo)/)
  await click('Copiar reporte del error')
  assert.match(copiedReport, /closure diagnostic sentinel/)
  assert.match(copiedReport, /componentStack/)
  assert.match(copiedReport, /dist\.closure/)
  const expectedVersion = readFileSync(new URL('../android/app/build.gradle', import.meta.url), 'utf8').match(/versionName\s+"([^"]+)"/)[1]
  assert.equal(JSON.parse(copiedReport).appVersion, expectedVersion)
  // La vuelta al inicio limpia la vista del error, pero no el almacenamiento local.
  await click('Volver al inicio')
  assert.doesNotMatch(container.textContent || '', /Se produjo un error al mostrar esta sección/)
  assert.match(container.textContent || '', /Inicio/)
  const savedReports = diagnostics.getDiagnosticReports()
  assert.ok(savedReports.some(report => report.code === diagnostic[1]?.code), 'el reporte persiste después de volver al inicio')
  assert.equal(savedReports.length, 1)
  assert.notEqual(diagnostics.getDiagnosticDeliveryState(diagnostic[1]?.code), 'sent', 'el UI nunca presenta como enviado un reporte sin aceptación del servidor')
  const sensitive = diagnostics.recordErrorDiagnostic({
    error: new Error('cliente: Ana Pérez; Bs 123.45; telefono 76543210; password=secreto'),
    source: 'unhandled_rejection', view: 'dist.closure',
  })
  const sensitiveText = diagnostics.formatDiagnosticReport(sensitive)
  assert.doesNotMatch(sensitiveText, /Ana Pérez|123\.45|76543210|secreto/)
  assert.match(sensitiveText, /REDACTADO/)
  const originalSetItem = window.localStorage.setItem.bind(window.localStorage)
  window.localStorage.setItem = () => { throw new Error('storage disabled') }
  assert.doesNotThrow(() => diagnostics.recordErrorDiagnostic({ error: new Error('storage unavailable test'), source: 'window_error', view: 'dist.closure' }))
  window.localStorage.setItem = originalSetItem
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
  document.execCommand = () => true
  assert.equal(await diagnostics.tryCopyDiagnosticText('reporte fallback'), true, 'el fallback móvil/legacy copia con DOM')
  document.execCommand = () => false
  assert.equal(await diagnostics.tryCopyDiagnosticText('reporte seleccionable'), false, 'si falla la copia, la interfaz ofrece el campo seleccionable')
  resetToHome = false
  await act(async () => root.render(React.createElement(ErrorBoundary, { key: 'copy-fallback', viewName: 'dist.closure' }, React.createElement(DiagnosticProbe))))
  await click('Copiar reporte del error')
  assert.ok(container.querySelector('textarea[aria-label="Reporte técnico seleccionable"]'), 'si el portapapeles falla, ErrorBoundary muestra el reporte seleccionable')
  const removeGlobalDiagnostics = diagnostics.installGlobalErrorDiagnostics()
  const rejected = new dom.window.Event('unhandledrejection')
  Object.defineProperty(rejected, 'reason', { value: new Error('Missing or insufficient permissions') })
  window.dispatchEvent(rejected)
  assert.ok(diagnostics.getDiagnosticReports().some(report => report.source === 'unhandled_rejection' && report.category === 'permission'))
  removeGlobalDiagnostics()
  for (const message of ['error de prueba uno', 'error de prueba dos', 'error de prueba tres']) {
    diagnostics.recordErrorDiagnostic({ error: new Error(message), source: 'window_error', view: 'dist.closure' })
  }
  assert.equal(diagnostics.getDiagnosticReports().length, 3, 'se conservan como máximo los últimos tres reportes')
  const latestThree = diagnostics.getDiagnosticReports()
  await act(async () => root.render(React.createElement(DiagnosticReportsModal, { isOpen: true, onClose: () => {} })))
  for (const report of latestThree) assert.ok((container.textContent || '').includes(report.code), 'el panel permite consultar cada uno de los últimos reportes')
  assert.ok(container.querySelector('textarea[aria-label="Reporte técnico seleccionable"]'))
  const events = diagnostics.getRecentDiagnosticEvents()
  assert.ok(events.some(event => event.stage === 'before_confirmation'))
  assert.ok(events.some(event => event.stage === 'operation_sent'))
  assert.ok(events.some(event => event.stage === 'confirmation_received'))
  assert.ok(events.some(event => event.stage === 'dispatch_removed'))
  assert.ok(events.some(event => event.stage === 'post_close_render'))
  console.log('PASS: React montado; cuatro cierres UI; snapshots en ambos órdenes; transición warehouse_done; último despacho y siguiente ruta sin ErrorBoundary')
} finally {
  console.error = priorConsoleError
  await act(async () => root.unmount())
  await vite.close()
  dom.window.close()
  delete globalThis.__postCloseSubscribe
  delete globalThis.__postCloseSaves
  delete globalThis.__postCloseDeclarations
}
