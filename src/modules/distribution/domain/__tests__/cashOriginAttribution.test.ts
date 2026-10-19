import { isSaleForDispatch, matchesRoute } from '../engine.ts'

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message)
  console.log(`PASS: ${message}`)
}

const domingo = 'route_570a01ef-2248-4ab8-a2ff-4d44a2ecc559'
const hugo = 'route-norte'

assert(matchesRoute('administracion', 'admin'), 'administracion y admin son alias de la misma caja')
assert(matchesRoute('admin', 'administracion'), 'el alias legacy se incluye en Administración')
assert(!matchesRoute(domingo, 'administracion'), 'Domingos no coincide con Administración')
assert(!matchesRoute('route-directa', 'administracion'), 'Impulsación no coincide con Administración')
assert(isSaleForDispatch({ routeId: hugo, sourceLocation: 'route' }, hugo), 'venta de ruta pertenece al despacho de su propia ruta')
assert(!isSaleForDispatch({ routeId: 'administracion', sourceLocation: 'centralWarehouse' }, hugo), 'venta central de Administración se excluye aunque conserve un dispatchId ajeno')
assert(!isSaleForDispatch({ routeId: domingo, sourceLocation: 'route' }, hugo), 'venta de Domingos no entra en el cierre de Hugo')
assert(isSaleForDispatch({ sourceLocation: 'route' }, hugo), 'venta legacy sin routeId sigue conciliándose por despacho')

const sales = [
  { routeId: 'administracion', cashAmount: 510, creditAmount: 1138 },
  { routeId: domingo, cashAmount: 1661.5, creditAmount: 2655 },
]
const adminSales = sales.filter((sale) => matchesRoute(sale.routeId, 'administracion'))
const adminCashCollections = [{ routeId: 'administracion', cashAmount: 122 }]
const adminExpectedCash = adminSales.reduce((sum, sale) => sum + sale.cashAmount, 0)
  + adminCashCollections.filter((collection) => matchesRoute(collection.routeId, 'administracion')).reduce((sum, collection) => sum + collection.cashAmount, 0)
assert(adminSales.reduce((sum, sale) => sum + sale.creditAmount, 0) === 1138, 'crédito de Domingos no entra en las ventas de Administración')
assert(adminExpectedCash === 632, 'fixture de Administración concilia Bs 510 ventas + Bs 122 cobros')

console.log('OK: atribución frontend de ventas y cajas')
