import type { DistributionData } from './modules/distribution/state/useDistributionStore'

const now = '2026-09-08T14:45:00.000Z'
const photo = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#fee2e2"/><stop offset="1" stop-color="#fecaca"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/><ellipse cx="320" cy="185" rx="210" ry="82" fill="#b91c1c"/><ellipse cx="320" cy="185" rx="175" ry="55" fill="#fca5a5"/><text x="320" y="315" text-anchor="middle" font-family="sans-serif" font-size="30" font-weight="700" fill="#7f1d1d">Embutidos San José</text></svg>')}`

export const previewData: DistributionData = {
  supportSettings: {
    companyName: 'Embutidos San José', taxId: '', address: '', phone: '',
    receiptHeader: 'EMBUTIDOS SAN JOSÉ', receiptFooter: 'Gracias por su preferencia',
    expiryAlertDays: 14, creditBlockDays: 7, requireQrVerification: true, defaultPaperWidth: '80mm',
  },
  products: [
    { id: 'p1', name: 'Salchicha tipo Viena para el agua', photoDataUrl: photo, category: 'Salchichas', presentation: '10 unidades 12 cm (aprox. 350 g)', unitType: 'package', productionCost: 14, minimumStock: 10, referencePrice: 20, active: true, sortOrder: 1, restaurantId: 'preview', createdAt: now },
    { id: 'p2', name: 'Salchicha tipo Viena clásica', category: 'Salchichas', presentation: '12 unidades 19 cm (aprox. 650 g)', unitType: 'package', productionCost: 20, minimumStock: 8, referencePrice: 32, active: true, sortOrder: 2, restaurantId: 'preview', createdAt: now },
    { id: 'p3', name: 'Chorizo parrillero precocido ahumado', category: 'Chorizos', presentation: 'Con o sin picante, aprox. 500 g', unitType: 'kg', productionCost: 37, minimumStock: 12, referencePrice: 57, active: true, sortOrder: 3, restaurantId: 'preview', createdAt: now },
    { id: 'p4', name: 'Mortadela jamonada', category: 'Mortadelas', presentation: 'Sachet 200 g', unitType: 'package', productionCost: 12, minimumStock: 10, referencePrice: 22, active: true, sortOrder: 4, restaurantId: 'preview', createdAt: now },
  ],
  routes: [
    { id: 'route-norte', name: 'Zona Norte', kind: 'route', active: true, restaurantId: 'preview', createdAt: now },
    { id: 'route-sur', name: 'Zona Sur', kind: 'route', active: true, restaurantId: 'preview', createdAt: now },
  ],
  warehouses: [
    { id: 'almacen-2', name: 'Almacén zona norte', active: true, restaurantId: 'preview' },
  ],
  customers: [
    { id: 'c1', name: 'Elvia Sejas Soto', identityNumber: '6469617', customerCode: '6469617', phone: '70000001', routeId: 'route-norte', active: true, restaurantId: 'preview', createdAt: now, createdBy: 'admin' },
    { id: 'c2', name: 'Tienda La Amistad', identityNumber: '8564210', customerCode: '8564210', phone: '70000002', routeId: 'route-norte', active: true, restaurantId: 'preview', createdAt: now, createdBy: 'admin' },
  ],
  balances: [
    { id: 'central__p1', warehouseId: 'central', locationKind: 'central', productId: 'p1', productName: 'Salchicha tipo Viena para el agua', unitType: 'package', quantity: 50, availableQuantity: 50, restaurantId: 'preview', updatedAt: now },
    { id: 'central__p2', warehouseId: 'central', locationKind: 'central', productId: 'p2', productName: 'Salchicha tipo Viena clásica', unitType: 'package', quantity: 14, availableQuantity: 14, restaurantId: 'preview', updatedAt: now },
    { id: 'central__p3', warehouseId: 'central', locationKind: 'central', productId: 'p3', productName: 'Chorizo parrillero precocido ahumado', unitType: 'kg', quantity: 40, availableQuantity: 40, restaurantId: 'preview', updatedAt: now },
    { id: 'central__p4', warehouseId: 'central', locationKind: 'central', productId: 'p4', productName: 'Mortadela jamonada', unitType: 'package', quantity: 55, availableQuantity: 55, restaurantId: 'preview', updatedAt: now },
    { id: 'warehouse__almacen-2__p1', warehouseId: 'almacen-2', locationKind: 'central', productId: 'p1', productName: 'Salchicha tipo Viena para el agua', unitType: 'package', quantity: 20, availableQuantity: 20, restaurantId: 'preview', updatedAt: now },
    { id: 'warehouse__almacen-2__p3', warehouseId: 'almacen-2', locationKind: 'central', productId: 'p3', productName: 'Chorizo parrillero precocido ahumado', unitType: 'kg', quantity: 12.5, availableQuantity: 12.5, restaurantId: 'preview', updatedAt: now },
  ],
  openDispatches: [{ id: 'd1', restaurantId: 'preview', branchId: 'main', createdAt: now, createdBy: 'admin', dayKey: '2026-09-08', schemaVersion: 1, routeId: 'route-norte', routeName: 'Zona Norte', distributorUid: 'v1', distributorName: 'Hugo Herbas', status: 'open', lines: [{ productId: 'p1', productName: 'Salchicha tipo Viena para el agua - 10 unidades 12 cm (aprox. 350 g)', unitType: 'package', quantity: 20 }, { productId: 'p3', productName: 'Chorizo parrillero precocido ahumado - Con o sin picante, aprox. 500 g', unitType: 'kg', quantity: 8.5 }], additions: [] }],
  sales: [{ id: 's1', operationId: 's1', restaurantId: 'preview', branchId: 'main', createdAt: now, createdBy: 'v1', dayKey: '2026-09-08', schemaVersion: 1, sourceLocation: 'route', routeId: 'route-norte', routeName: 'Zona Norte', sellerUid: 'v1', sellerName: 'Hugo Herbas', dispatchId: 'd1', customerId: 'c1', customerName: 'Elvia Sejas Soto', customerCode: '6469617', lines: [{ productId: 'p1', productNameSnapshot: 'Salchicha tipo Viena para el agua', quantity: 2, unitType: 'package', actualUnitPrice: 20, subtotal: 40 }, { productId: 'p3', productNameSnapshot: 'Chorizo parrillero precocido ahumado', quantity: 1.25, unitType: 'kg', actualUnitPrice: 57, subtotal: 71.25 }], total: 111.25, paymentKind: 'cash', cashAmount: 111.25, qrAmount: 0, creditAmount: 0 }],
  transfers: [{ id: 't1', fromWarehouseId: 'central', toWarehouseId: 'almacen-2', line: { productId: 'p3', productName: 'Chorizo parrillero precocido ahumado', unitType: 'kg', quantity: 12.5 }, createdAt: now, createdBy: 'admin', responsibleName: 'Administración San José', note: 'Reposición semanal' }],
  lots: [], operations: [], movements: [{ id: 'm1', restaurantId: 'preview', branchId: 'main', createdAt: now, createdBy: 'uid-interno-largo-123456789', dayKey: '2026-09-08', schemaVersion: 2, type: 'intake', productId: 'p1', productName: 'Salchicha tipo Viena para el agua', unitType: 'package', quantity: 25, centralDelta: 25, routeDelta: 0, responsibleRole: 'warehouse', responsibleName: 'Almacén Central', lotCode: 'SJ-0809', note: 'Ingreso de producción' }], claims: [], creditStatus: [], qrVerifications: [], collections: [{ id: 'q1', operationId: 'q1', restaurantId: 'preview', branchId: 'main', createdAt: now, createdBy: 'v1', dayKey: '2026-09-08', schemaVersion: 2, receivableId: 'r1', customerId: 'c1', customerName: 'Elvia Sejas Soto', routeId: 'route-norte', collectedByUid: 'v1', collectedByName: 'Hugo Herbas', amount: 40, method: 'qr' }], expenses: [{ id: 'e1', operationId: 'e1', restaurantId: 'preview', branchId: 'main', createdAt: now, createdBy: 'v1', dayKey: '2026-09-08', schemaVersion: 2, concept: 'Combustible', amount: 45, routeId: 'route-norte', routeName: 'Zona Norte', registeredByUid: 'v1', registeredByName: 'Hugo Herbas' }], receivables: [{ id: 'r1', restaurantId: 'preview', branchId: 'main', createdAt: now, createdBy: 'v1', dayKey: '2026-09-08', schemaVersion: 2, saleId: 's1', customerId: 'c1', customerName: 'Elvia Sejas Soto', routeId: 'route-norte', distributorUid: 'v1', distributorName: 'Hugo Herbas', originalAmount: 120, paidAmount: 40, balance: 80, status: 'PARTIAL', saleLines: [] }, { id: 'r2', restaurantId: 'preview', branchId: 'main', createdAt: '2026-08-20T10:00:00.000Z', createdBy: 'v1', dayKey: '2026-08-20', schemaVersion: 2, saleId: 's0', customerId: 'c1', customerName: 'Elvia Sejas Soto', routeId: 'route-norte', distributorUid: 'v1', distributorName: 'Hugo Herbas', originalAmount: 55, paidAmount: 55, balance: 0, status: 'PAID', saleLines: [] }], closures: [], isLoading: false, error: null,
}
