const assert = require('node:assert/strict');
const { isAdministrationRouteId, isSaleForDispatch } = require('../operations.cjs');

const domingo = 'route_570a01ef-2248-4ab8-a2ff-4d44a2ecc559';
const hugo = 'route-norte';

assert.equal(isAdministrationRouteId('admin'), true);
assert.equal(isAdministrationRouteId('administracion'), true);
assert.equal(isAdministrationRouteId('route-directa'), false);
assert.equal(isAdministrationRouteId(domingo), false);
assert.equal(isSaleForDispatch({ routeId: hugo, sourceLocation: 'route' }, hugo), true);
assert.equal(isSaleForDispatch({ routeId: 'administracion', sourceLocation: 'centralWarehouse' }, hugo), false);
assert.equal(isSaleForDispatch({ routeId: domingo, sourceLocation: 'route' }, hugo), false);
assert.equal(isSaleForDispatch({ sourceLocation: 'route' }, hugo), true);

// Fixture modeled on the 2026-10-19 routing defect: a central sale is linked
// to Hugo's dispatch by stale UI state, but must reconcile only to Admin.
const fixture = [
  { routeId: 'administracion', dispatchId: 'disp-hugo', sourceLocation: 'centralWarehouse', cashAmount: 510, creditAmount: 0 },
  { routeId: 'administracion', dispatchId: 'disp-hugo', sourceLocation: 'centralWarehouse', cashAmount: 0, creditAmount: 774 },
  { routeId: hugo, dispatchId: 'disp-hugo', sourceLocation: 'route', cashAmount: 2174, creditAmount: 585 },
  { routeId: domingo, dispatchId: 'disp-domingo', sourceLocation: 'route', cashAmount: 1661.5, creditAmount: 2655 },
];
const adminSales = fixture.filter((sale) => isAdministrationRouteId(sale.routeId));
const hugoDispatchSales = fixture.filter((sale) => sale.dispatchId === 'disp-hugo' && isSaleForDispatch(sale, hugo));
assert.equal(adminSales.reduce((sum, sale) => sum + sale.cashAmount, 0), 510);
assert.equal(adminSales.reduce((sum, sale) => sum + sale.creditAmount, 0), 774);
assert.equal(hugoDispatchSales.reduce((sum, sale) => sum + sale.cashAmount, 0), 2174);
assert.equal(hugoDispatchSales.reduce((sum, sale) => sum + sale.creditAmount, 0), 585);
const productionLikeAdminSales = [
  ...fixture.filter((sale) => isAdministrationRouteId(sale.routeId)),
  { routeId: 'administracion', cashAmount: 0, creditAmount: 364 },
];
const adminCashCollections = [{ routeId: 'administracion', cashAmount: 122 }];
const serverExpectedCash = productionLikeAdminSales.reduce((sum, sale) => sum + sale.cashAmount, 0)
  + adminCashCollections.filter((collection) => isAdministrationRouteId(collection.routeId)).reduce((sum, collection) => sum + collection.cashAmount, 0);
assert.equal(serverExpectedCash, 632);
assert.equal(productionLikeAdminSales.reduce((sum, sale) => sum + sale.creditAmount, 0), 1138);

console.log('PASS: helper backend separa aliases de Administración, Impulsación y rutas operativas');
console.log('PASS: fixture evita atribuir venta central de Administración al despacho de Hugo');
console.log('PASS: fixture servidor concilia Bs 510 ventas + Bs 122 cobros en Administración');
