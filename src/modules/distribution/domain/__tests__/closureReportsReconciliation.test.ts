import { computeSellerBreakdown, round2, toDayKey } from '../engine.ts'
import type { DistClosure, DistCollection, DistExpense, DistProduct, DistSale } from '../../types.ts'

const assertEqual = (a: unknown, b: unknown, msg?: string) => {
  if (a !== b) throw new Error(msg || `${String(a)} !== ${String(b)}`)
}

console.log('--- Iniciando prueba de conciliación Cierre vs Reportes (Caso Ricardo Bs 89) ---')

// 1. Simulación de datos exactos del 13/11/2026
const products: DistProduct[] = [
  { id: 'prod-1', name: 'Chorizo', category: 'General', unitType: 'kg', referencePrice: 50, active: true, sortOrder: 1 } as DistProduct,
]

const ricardoUid = 'dc0SyNIoIIXAwvHXELWix3fQwxM2'
const ricardoName = 'Ricardo Jimenes'
const dayKey = '2026-11-13'
const dispatchId = 'disp_cfd691c5-daf1-4f45-914c-f284e7ee0c1f'
const dispatchRoute = 'route-sud'
const dispatchCreated = '2026-11-13T12:09:20.147Z'

// Ventas en efectivo de Ricardo (Bs 3.902,50)
const sales: DistSale[] = [
  {
    id: 'sale-1',
    operationId: 'op-1',
    sourceLocation: 'route',
    restaurantId: 'sanjose', branchId: 'main', createdAt: '2026-11-13T13:00:00Z', createdBy: ricardoUid, dayKey, schemaVersion: 1,
    sellerUid: ricardoUid, sellerName: ricardoName, routeId: dispatchRoute, routeName: 'Ruta Sur',
    paymentKind: 'cash', total: 3902.50, cashAmount: 3902.50, qrAmount: 0, creditAmount: 0, lines: [],
  },
]

// Cobranza 1 (en ruta durante el despacho): Bs 100 efectivo
const colInside: DistCollection = {
  id: 'col-inside',
  operationId: 'op-c1',
  customerId: 'cust-1',
  customerName: 'Cliente 1',
  restaurantId: 'sanjose', branchId: 'main', createdAt: '2026-11-13T14:00:00Z', createdBy: ricardoUid, dayKey, schemaVersion: 1,
  collectedByUid: ricardoUid, collectedByName: ricardoName, routeId: dispatchRoute,
  method: 'cash', amount: 100.00, cashAmount: 100.00, qrAmount: 0,
}

// Cobranza 2 (Caso Claudia Avila Obando): Bs 89,00 a las 11:58:50 UTC (10m antes de crear despacho en app)
const colMorning: DistCollection = {
  id: 'col_da78716b-99cf-4df1-9cb9-024a344bbac3',
  operationId: 'op-c2',
  customerId: 'cust_53fe72e2-b2a3-4c0e-b05e-e179efea90d8',
  customerName: 'CLAUDIA AVILA OBANDO',
  restaurantId: 'sanjose', branchId: 'main', createdAt: '2026-11-13T11:58:50.478Z', createdBy: ricardoUid, dayKey, schemaVersion: 1,
  collectedByUid: ricardoUid, collectedByName: ricardoName, routeId: dispatchRoute,
  method: 'cash', amount: 89.00, cashAmount: 89.00, qrAmount: 0,
}

// Gastos de ruta: Bs 185,00
const expenses: DistExpense[] = [
  {
    id: 'exp-1',
    operationId: 'op-e1',
    routeName: 'Ruta Sur',
    restaurantId: 'sanjose', branchId: 'main', createdAt: '2026-11-13T15:00:00Z', createdBy: ricardoUid, dayKey, schemaVersion: 1,
    registeredByUid: ricardoUid, registeredByName: ricardoName, routeId: dispatchRoute,
    amount: 185.00, concept: 'Combustible', categoryId: 'fuel',
  },
]

// 2. Comprobar filtro de ClosureView corregido
const allCollections = [colInside, colMorning]
const oldClosureFilter = allCollections.filter(c => c.createdAt >= dispatchCreated)
assertEqual(oldClosureFilter.length, 1, 'El filtro antiguo excluía erróneamente la cobranza de las 11:58')

const newClosureFilter = allCollections.filter(c => c.createdAt >= dispatchCreated || (c.dayKey || toDayKey(new Date(c.createdAt))) === dayKey)
assertEqual(newClosureFilter.length, 2, 'El filtro corregido incluye la cobranza matutina del mismo día')

// 3. Snapshot histórico de cierre existente de Ricardo (3.817,50 declarado vs 3.817,50 esperado -> CUADRADO)
const historicalClosure: DistClosure = {
  id: 'closure_disp_cfd691c5-daf1-4f45-914c-f284e7ee0c1f',
  restaurantId: 'sanjose', branchId: 'main', createdAt: '2026-11-13T20:41:31.717Z', createdBy: 'admin', dayKey, schemaVersion: 1,
  dispatchId, routeId: dispatchRoute, routeName: 'Ruta Sur', distributorUid: ricardoUid, distributorName: ricardoName,
  status: 'closed', products: [],
  cashSales: 3902.50, qrSales: 1617.00, creditGenerated: 2677.50,
  cashCollections: 100.00, qrCollections: 225.00, cashExpenses: 185.00,
  expectedCash: 3817.50, physicalCashDeclared: 3817.50, cashDifference: 0.00,
  closedAt: '2026-11-13T20:46:19.571Z',
}

// 4. Cálculo del período en Reportes con todas las cobranzas atribuidas a Ricardo
const sellers = computeSellerBreakdown(sales, allCollections, expenses, [], products)
const ricardoSeller = sellers.find(s => s.sellerUid === ricardoUid)
if (!ricardoSeller) throw new Error('Ricardo debe figurar en el desglose de vendedores')
assertEqual(ricardoSeller.salesTotal, 3902.50)
assertEqual(ricardoSeller.cashSales, 3902.50)
assertEqual(ricardoSeller.collected, 189.00) // 100 + 89
assertEqual(ricardoSeller.expenses, 185.00)
assertEqual(ricardoSeller.expectedCash, 3906.50) // 3902.50 + 189 - 185 = 3906.50

// 5. Conciliación en ReportsView con la lógica corregida
const sellerClosures = [historicalClosure].filter(c => c.distributorUid === ricardoSeller.sellerUid)
const hasClosures = sellerClosures.length > 0
const closuresExpected = hasClosures
  ? round2(sellerClosures.reduce((sum, c) => sum + (c.expectedCash ?? 0), 0))
  : null
const closuresDeclared = hasClosures
  ? round2(sellerClosures.reduce((sum, c) => sum + (c.physicalCashDeclared ?? 0), 0))
  : null
const closureDifference = (closuresDeclared !== null && closuresExpected !== null)
  ? round2(closuresDeclared - closuresExpected)
  : null
const unclosedDelta = hasClosures && closuresExpected !== null
  ? round2(ricardoSeller.expectedCash - closuresExpected)
  : 0

// Verificaciones contables clave:
assertEqual(closuresExpected, 3817.50, 'El efectivo esperado en el arqueo cerrado debe ser Bs 3.817,50')
assertEqual(closuresDeclared, 3817.50, 'El efectivo declarado en el arqueo debe ser Bs 3.817,50')
assertEqual(closureDifference, 0.00, 'El arqueo histórico de Ricardo debe estar CUADRADO (diferencia 0)')
assertEqual(unclosedDelta, 89.00, 'El delta de movimientos no integrados al arqueo debe ser exactamente Bs +89,00')

console.log('PASS: Arqueo histórico de Ricardo permanece CUADRADO (Bs 0,00 diferencia)')
console.log('PASS: Movimiento no integrado de Bs 89,00 queda identificado limpiamente como delta a conciliar')
console.log('PASS: Se evita falso FALTANTE para el distribuidor en Reportes')
