import { aggregateCustomerPurchases, formatKgBreakdown } from '../customerPurchases.ts'
import { getProductPresentation, getLinePresentation } from '../productPresentation.ts'
import type { DistProduct, DistSale, DistCustomer } from '../../types.ts'

const products: DistProduct[] = [
  {
    id: 'prod-viena',
    name: 'Salchicha Viena',
    presentation: 'Paquete 500 g',
    category: 'Embutidos',
    unitType: 'package',
    approximateWeightKg: 0.5,
    referencePrice: 18,
    active: true,
    sortOrder: 1,
    restaurantId: 'sanjose',
    createdAt: '2026-03-01T00:00:00Z',
  },
  {
    id: 'prod-chorizo',
    name: 'Chorizo Parrillero',
    presentation: 'Granel',
    category: 'Chorizos',
    unitType: 'kg',
    referencePrice: 32,
    active: true,
    sortOrder: 2,
    restaurantId: 'sanjose',
    createdAt: '2026-03-01T00:00:00Z',
  },
]

const customers: DistCustomer[] = [
  {
    id: 'cust-1',
    name: 'Doña Julia',
    customerCode: 'CLI-001',
    identityNumber: '1234567',
    active: true,
    restaurantId: 'sanjose',
    createdAt: '2026-03-01T00:00:00Z',
    createdBy: 'admin',
  },
  {
    id: 'cust-2',
    name: 'Frialsur',
    customerCode: 'CLI-002',
    identityNumber: '7654321',
    active: true,
    restaurantId: 'sanjose',
    createdAt: '2026-03-01T00:00:00Z',
    createdBy: 'admin',
  },
]

const sales: DistSale[] = [
  {
    id: 'sale-1',
    operationId: 'op-sale-1',
    restaurantId: 'sanjose',
    branchId: 'central',
    dayKey: '2026-03-10',
    createdAt: '2026-03-10T10:00:00Z',
    createdBy: 'seller-1',
    schemaVersion: 1,
    sourceLocation: 'route',
    routeId: 'route-norte',
    routeName: 'Ruta Norte',
    sellerUid: 'seller-1',
    sellerName: 'Hugo Choque',
    customerId: 'cust-1',
    customerName: 'Doña Julia',
    total: 320,
    paymentKind: 'cash',
    cashAmount: 320,
    qrAmount: 0,
    creditAmount: 0,
    lines: [
      {
        productId: 'prod-chorizo',
        productNameSnapshot: 'Chorizo Parrillero',
        unitType: 'kg',
        quantity: 10,
        actualUnitPrice: 32,
        subtotal: 320,
      },
    ],
  },
  {
    id: 'sale-2',
    operationId: 'op-sale-2',
    restaurantId: 'sanjose',
    branchId: 'central',
    dayKey: '2026-03-10',
    createdAt: '2026-03-10T11:00:00Z',
    createdBy: 'seller-1',
    schemaVersion: 1,
    sourceLocation: 'route',
    routeId: 'route-norte',
    routeName: 'Ruta Norte',
    sellerUid: 'seller-1',
    sellerName: 'Hugo Choque',
    customerId: 'cust-1',
    customerName: 'Doña Julia',
    total: 90,
    paymentKind: 'cash',
    cashAmount: 90,
    qrAmount: 0,
    creditAmount: 0,
    lines: [
      {
        productId: 'prod-viena',
        productNameSnapshot: 'Salchicha Viena',
        presentationSnapshot: 'Paquete 500 g',
        unitType: 'package',
        quantity: 5,
        actualUnitPrice: 18,
        subtotal: 90,
      },
    ],
  },
  {
    id: 'sale-3',
    operationId: 'op-sale-3',
    restaurantId: 'sanjose',
    branchId: 'central',
    dayKey: '2026-03-10',
    createdAt: '2026-03-10T12:00:00Z',
    createdBy: 'seller-1',
    schemaVersion: 1,
    sourceLocation: 'route',
    routeId: 'route-norte',
    routeName: 'Ruta Norte',
    sellerUid: 'seller-1',
    sellerName: 'Hugo Choque',
    customerId: 'cust-2',
    customerName: 'Frialsur',
    total: 160,
    paymentKind: 'cash',
    cashAmount: 160,
    qrAmount: 0,
    creditAmount: 0,
    lines: [
      {
        productId: 'prod-chorizo',
        productNameSnapshot: 'Chorizo Parrillero',
        unitType: 'kg',
        quantity: 5,
        actualUnitPrice: 32,
        subtotal: 160,
      },
    ],
  },
]

const mockData = {
  products,
  customers,
  sales,
}

let passed = 0
let failed = 0

function ok(condition: boolean, msg: string) {
  if (condition) {
    passed++
    console.log(`PASS: ${msg}`)
  } else {
    failed++
    console.error(`FAIL: ${msg}`)
  }
}

console.log('--- Corriendo pruebas de compras por cliente ---')

// 1. Agregación general
const result = aggregateCustomerPurchases(mockData, ['2026-03-10'])

ok(result.clients.length === 2, 'Debe haber 2 clientes en el resumen')
ok(result.topClient?.customerName === 'Doña Julia', 'Top client debe ser Doña Julia')
ok(result.topClient?.totalBs === 410, 'Doña Julia totalBs debe ser 320 + 90 = 410')
ok(result.topClient?.exactKg === 10, 'Doña Julia exactKg debe ser 10')
ok(result.topClient?.estimatedKg === 2.5, 'Doña Julia estimatedKg debe ser 5 paquetes * 0.5 = 2.5')
ok(result.topClient?.totalEquivalentKg === 12.5, 'Doña Julia total equiv kg debe ser 12.5')
ok(result.topClient?.totalPackages === 5, 'Doña Julia paquetes debe ser 5')

// 2. Cuadre total absoluto
ok(result.grandTotalBs === 570, 'Grand total Bs debe ser 410 + 160 = 570')
ok(result.grandTotalExactKg === 15, 'Grand total exact kg debe ser 10 + 5 = 15')
ok(result.grandTotalEstimatedKg === 2.5, 'Grand total estimated kg debe ser 2.5')
ok(result.grandTotalEquivalentKg === 17.5, 'Grand total equivalent kg debe ser 17.5')
ok(result.grandTotalPackages === 5, 'Grand total packages debe ser 5')

// 3. Formato explicativo de kg
const formattedBreakdown = formatKgBreakdown(result.topClient!.exactKg, result.topClient!.estimatedKg)
ok(/equiv\./.test(formattedBreakdown), 'Debe indicar equiv. cuando hay ambos tipos de kg')
ok(/exactos/.test(formattedBreakdown), 'Debe indicar kg exactos')
ok(/est\./.test(formattedBreakdown), 'Debe indicar kg estimados')

// 4. Presentación única y fallback
ok(
  getProductPresentation({ presentation: 'Paquete al vacío de 500 g', description: 'Antigua descripción' }) ===
    'Paquete al vacío de 500 g',
  'Prioriza presentation',
)
ok(
  getProductPresentation({ description: 'Antigua descripción fallback' }) === 'Antigua descripción fallback',
  'Fallback a description cuando presentation está vacía',
)
ok(
  getLinePresentation({ descriptionSnapshot: 'Línea histórica' }, { presentation: 'Nuevo' }) === 'Línea histórica',
  'Respeta snapshot histórico de la línea',
)

if (failed > 0) {
  throw new Error(`Fallaron ${failed} pruebas.`)
} else {
  console.log(`PASS: Todas las pruebas (${passed}) pasaron con éxito.`)
}
