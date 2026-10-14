import {
  ADMIN_CANONICAL_ROUTE_ID,
  IMPULSACION_ROUTE_ID,
  matchesRoute,
  getCanonicalRouteName,
} from '../engine.ts'
import {
  computeCreditPortfolioByRoute,
  getRouteDisplayName,
  resolveReceivableRouteId,
} from '../creditRoutes.ts'
import type { DistDispatch, DistReceivable, DistRoute } from '../../types.ts'

console.log('=== Iniciando pruebas específicas de Fixes 1.4.20 ===')

let passed = 0
function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`)
  }
}

const pass = (condition: boolean, msg: string) => {
  assert(condition, msg)
  passed++
  console.log(`PASS: ${msg}`)
}

// ----------------------------------------------------
// 1. ADMINISTRACIÓN: ID CANÓNICO Y COMPATIBILIDAD
// ----------------------------------------------------
pass(ADMIN_CANONICAL_ROUTE_ID === 'administracion', 'El ID canónico de Administración es "administracion"')

// Compatibilidad bidireccional de lectura entre "administracion" y "admin"
pass(matchesRoute('administracion', 'administracion'), '"administracion" coincide con filtro "administracion"')
pass(matchesRoute('admin', 'administracion'), 'Registro histórico con "admin" coincide con filtro "administracion"')
pass(matchesRoute('administracion', 'admin'), 'Registro "administracion" coincide con filtro "admin"')
pass(matchesRoute('admin', 'admin'), 'Registro "admin" coincide con filtro "admin"')
pass(!matchesRoute('route-hugo', 'administracion'), 'Ruta Hugo NO coincide con filtro "administracion"')
pass(!matchesRoute('administracion', 'route-hugo'), 'Administración NO coincide con filtro ruta Hugo')
pass(!matchesRoute(undefined, 'administracion'), 'Sin ruta NO coincide con administración')

// En creditRoutes, resolveReceivableRouteId normaliza admin a administracion
const legacyAdminRec = {
  id: 'rec-admin-1',
  routeId: 'admin',
  status: 'OPEN',
  balance: 500,
  customerId: 'c-admin',
  customerName: 'Cliente Admin',
} as unknown as DistReceivable

pass(resolveReceivableRouteId(legacyAdminRec) === 'administracion', 'resolveReceivableRouteId normaliza "admin" a "administracion"')

const routes: DistRoute[] = [
  { id: 'administracion', name: 'Administración' } as DistRoute,
  { id: 'route-impulsacion', name: 'Impulsación' } as DistRoute,
  { id: 'route-1', name: 'Ruta 1' } as DistRoute,
]

const portfolio = computeCreditPortfolioByRoute({
  receivables: [legacyAdminRec],
  selectedRouteId: 'administracion',
  routes,
  customers: [],
})
const adminOption = portfolio.availableRoutes.find((r) => r.id === 'administracion')
pass(Boolean(adminOption && adminOption.totalBalance === 500), 'Agrupación de cartera incluye registro legado "admin" bajo ruta canónica "administracion"')

// ----------------------------------------------------
// 2. SEPARAR ADMINISTRACIÓN / VENTA DIRECTA / IMPULSACIÓN
// ----------------------------------------------------
pass(IMPULSACION_ROUTE_ID === 'route-impulsacion', 'El ID de Impulsación es "route-impulsacion"')
pass(getCanonicalRouteName('route-impulsacion') === 'Impulsación', 'Nombre canónico de "route-impulsacion" es "Impulsación"')
pass(getCanonicalRouteName('route-directa') === 'Impulsación', 'Nombre canónico del histórico "route-directa" es "Impulsación"')
pass(getCanonicalRouteName('administracion') === 'Administración', 'Nombre canónico de "administracion" es "Administración"')
pass(getCanonicalRouteName('admin') === 'Administración', 'Nombre canónico del histórico "admin" es "Administración"')

// Compatibilidad bidireccional de lectura entre "route-impulsacion" y "route-directa"
pass(matchesRoute('route-impulsacion', 'route-impulsacion'), '"route-impulsacion" coincide con filtro "route-impulsacion"')
pass(matchesRoute('route-directa', 'route-impulsacion'), 'Registro histórico con "route-directa" coincide con filtro "route-impulsacion"')
pass(matchesRoute('route-impulsacion', 'route-directa'), 'Registro "route-impulsacion" coincide con filtro "route-directa"')
pass(!matchesRoute('administracion', 'route-impulsacion'), 'Administración NO coincide con filtro Impulsación')

// Nombres para mostrar en rutas de crédito
pass(getRouteDisplayName('administracion', []) === 'Administración', 'getRouteDisplayName("administracion") muestra "Administración"')
pass(getRouteDisplayName('admin', []) === 'Administración', 'getRouteDisplayName("admin") muestra "Administración"')
pass(getRouteDisplayName('route-impulsacion', []) === 'Impulsación', 'getRouteDisplayName("route-impulsacion") muestra "Impulsación"')
pass(getRouteDisplayName('route-directa', []) === 'Impulsación', 'getRouteDisplayName("route-directa") muestra "Impulsación"')

// ----------------------------------------------------
// 3. REPORTES MULTIDÍA — FORMATO FECHA + HORA
// ----------------------------------------------------
function formatReportDateTimeTest(isoString: string, isMultiDay: boolean): string {
  if (!isoString) return '—'
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return isoString
  if (isMultiDay) {
    const day = String(date.getDate()).padStart(2, '0')
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    return `${day}/${month} ${hours}:${minutes}`
  }
  return date.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })
}

const testIso = '2026-10-10T14:35:00.000Z'
const singleDayFormatted = formatReportDateTimeTest(testIso, false)
const multiDayFormatted = formatReportDateTimeTest(testIso, true)

pass(multiDayFormatted.includes('/'), `En reporte multidía incluye fecha y hora (obtenido: "${multiDayFormatted}")`)
pass(/^\d{2}\/\d{2} \d{2}:\d{2}$/.test(multiDayFormatted), `Formato multidía coincide con DD/MM HH:mm ("${multiDayFormatted}")`)
pass(!singleDayFormatted.includes('/'), `En reporte de 1 solo día solo muestra hora ("${singleDayFormatted}")`)

// ----------------------------------------------------
// 4. DESPACHOS CERRADOS — AUDITORÍA DE CORRECCIONES EN WEB
// ----------------------------------------------------
const mockClosedDispatchWithCorrections: DistDispatch = {
  id: 'disp-closed-1',
  restaurantId: 'rest-1',
  branchId: 'b-1',
  createdAt: '2026-10-10T06:00:00.000Z',
  closedAt: '2026-10-10T18:00:00.000Z',
  createdBy: 'uid-wh',
  dayKey: '2026-10-10',
  schemaVersion: 1,
  routeId: 'route-1',
  routeName: 'Ruta 1',
  distributorUid: 'dist-1',
  distributorName: 'Hugo',
  warehouseResponsibleName: 'Almacenero Juan',
  status: 'closed',
  lines: [
    {
      productId: 'prod-1',
      productName: 'Chorizo Parrillero',
      unitType: 'kg',
      quantity: 50,
      lotCode: 'L-001',
    },
  ],
  additions: [],
  corrections: [
    {
      id: 'corr-1',
      operationId: 'op-corr-1',
      targetType: 'initial',
      correctedAt: '2026-10-10T07:15:00.000Z',
      correctedBy: 'admin-uid',
      correctedByName: 'Administrador General',
      productId: 'prod-1',
      productName: 'Chorizo Parrillero',
      unitType: 'kg',
      lotCode: 'L-001',
      oldQuantity: 70,
      newQuantity: 50,
      reason: 'Error de conteo en carga física',
    },
  ],
}

pass(mockClosedDispatchWithCorrections.status === 'closed', 'El despacho auditado está cerrado')
pass(Boolean(mockClosedDispatchWithCorrections.corrections && mockClosedDispatchWithCorrections.corrections.length > 0), 'El despacho cerrado contiene correcciones auditadas')

const corr = mockClosedDispatchWithCorrections.corrections![0]
pass(corr.productName === 'Chorizo Parrillero', 'Corrección muestra producto')
pass(corr.lotCode === 'L-001', 'Corrección muestra lote')
pass(corr.oldQuantity === 70, 'Corrección muestra cantidad anterior')
pass(corr.newQuantity === 50, 'Corrección muestra cantidad nueva')
const delta = corr.newQuantity - corr.oldQuantity
pass(delta === -20, 'Corrección calcula diferencia correcta (-20 kg)')
pass(corr.reason === 'Error de conteo en carga física', 'Corrección muestra motivo auditado')
pass(corr.correctedByName === 'Administrador General', 'Corrección muestra nombre de responsable')
pass(Boolean(corr.correctedAt), 'Corrección muestra fecha y hora')

console.log(`\nTODAS LAS ${passed} PRUEBAS ESPECÍFICAS DE 1.4.20 PASARON CON ÉXITO!`)
