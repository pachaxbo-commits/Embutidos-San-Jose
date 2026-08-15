import {
  buildReconciliation,
  computeLoadedByProduct,
  computeMoneySummary,
  computeSaleTotal,
  computeSellerBreakdown,
  computeSoldByProduct,
  computeSoldKilograms,
  computeSoldPackages,
  describeVariance,
  nextReceivableStatus,
  round2,
  splitPayment,
  toDayKey,
  validateCollection,
  validateSalePayment,
  validateStockAvailability,
} from '../engine.ts'
import type { DistCollection, DistDispatch, DistExpense, DistSale } from '../../types.ts'

/**
 * Suite de pruebas del motor de distribucion.
 * Sigue el estilo del resto del repo (suite ejecutable que devuelve resultados)
 * y ademas puede correrse en consola con:
 *   node --experimental-strip-types src/modules/distribution/domain/__tests__/distributionEngine.test.ts
 */

const BASE = {
  restaurantId: 'sanjose',
  branchId: 'main',
  createdBy: 'hugo',
  dayKey: '2026-08-14',
  schemaVersion: 1,
}

function makeDispatch(): DistDispatch {
  return {
    ...BASE,
    id: 'disp-1',
    createdAt: '2026-08-14T08:00:00.000Z',
    routeId: 'route-norte',
    routeName: 'Zona Norte',
    distributorUid: 'hugo',
    distributorName: 'Hugo Herbas',
    status: 'open',
    lines: [
      { productId: 'p-viena-granel', productName: 'Salchicha Viena granel', unitType: 'kg', quantity: 20 },
      { productId: 'p-chorizo-granel', productName: 'Chorizo parrillero granel', unitType: 'kg', quantity: 10 },
    ],
    additions: [
      {
        id: 'add-1',
        createdAt: '2026-08-14T09:30:00.000Z',
        createdBy: 'almacen',
        createdByName: 'Almacen',
        quantityByProduct: [
          { productId: 'p-viena-granel', productName: 'Salchicha Viena granel', unitType: 'kg', quantity: 5 },
        ],
      },
    ],
  }
}

function makeSales(): DistSale[] {
  return [
    {
      ...BASE,
      id: 'sale-1',
      operationId: 'sale-1',
      createdAt: '2026-08-14T10:00:00.000Z',
      sourceLocation: 'route',
      routeId: 'route-norte',
      routeName: 'Zona Norte',
      sellerUid: 'hugo',
      sellerName: 'Hugo Herbas',
      dispatchId: 'disp-1',
      lines: [
        {
          productId: 'p-viena-granel',
          productNameSnapshot: 'Salchicha Viena granel',
          quantity: 6,
          unitType: 'kg',
          actualUnitPrice: 48,
          subtotal: 288,
        },
      ],
      total: 288,
      paymentKind: 'cash',
      cashAmount: 288,
      qrAmount: 0,
      creditAmount: 0,
    },
    {
      ...BASE,
      id: 'sale-2',
      operationId: 'sale-2',
      createdAt: '2026-08-14T11:00:00.000Z',
      sourceLocation: 'route',
      routeId: 'route-norte',
      routeName: 'Zona Norte',
      sellerUid: 'hugo',
      sellerName: 'Hugo Herbas',
      dispatchId: 'disp-1',
      customerId: 'cust-demo',
      customerName: 'Cliente Demo',
      lines: [
        {
          productId: 'p-chorizo-granel',
          productNameSnapshot: 'Chorizo parrillero granel',
          quantity: 3,
          unitType: 'kg',
          actualUnitPrice: 53,
          subtotal: 159,
        },
      ],
      total: 159,
      paymentKind: 'credit',
      cashAmount: 0,
      qrAmount: 0,
      creditAmount: 159,
    },
  ]
}

export async function runDistributionEngineTestSuite(): Promise<{ passed: number; failed: number; results: string[] }> {
  const results: string[] = []
  let passed = 0
  let failed = 0

  function assert(condition: boolean, testName: string) {
    if (condition) {
      passed++
      results.push(`PASS: ${testName}`)
    } else {
      failed++
      results.push(`FAIL: ${testName}`)
    }
  }

  // --- Helpers basicos ---
  assert(round2(0.1 + 0.2) === 0.3, 'round2 elimina el ruido de punto flotante')
  assert(toDayKey(new Date(2026, 7, 14)) === '2026-08-14', 'toDayKey genera clave local YYYY-MM-DD')

  // --- Carga: inicial + aumentos ---
  const dispatch = makeDispatch()
  const loaded = computeLoadedByProduct(dispatch)
  assert(loaded.get('p-viena-granel')?.initialDispatch === 20, 'carga inicial Viena = 20')
  assert(loaded.get('p-viena-granel')?.additions === 5, 'aumentos Viena = 5')
  assert(loaded.get('p-viena-granel')?.totalLoaded === 25, 'total despachado Viena = 25')
  assert(loaded.get('p-chorizo-granel')?.totalLoaded === 10, 'total despachado Chorizo = 10')

  // --- Ventas por producto ---
  const sales = makeSales()
  const sold = computeSoldByProduct(sales)
  assert(sold.get('p-viena-granel')?.quantity === 6, 'vendido Viena = 6 kg')
  assert(sold.get('p-chorizo-granel')?.quantity === 3, 'vendido Chorizo = 3 kg')
  assert(computeSoldKilograms(sales) === 9, 'kg vendidos totales = 9')
  assert(computeSoldPackages(sales) === 0, 'paquetes vendidos = 0 (no convierte kg a paquetes)')

  // --- Conciliacion fisica ---
  const rows = buildReconciliation(dispatch, sales, { 'p-viena-granel': 18.5, 'p-chorizo-granel': 7 })
  const viena = rows.find((row) => row.productId === 'p-viena-granel')!
  const chorizo = rows.find((row) => row.productId === 'p-chorizo-granel')!
  assert(viena.expectedReturn === 19, 'Viena debe retornar 19 kg (25 - 6)')
  assert(viena.variance === -0.5, 'Viena variance = -0.5')
  assert(describeVariance(viena.variance).kind === 'FALTANTE', 'Viena se reporta como FALTANTE')
  assert(describeVariance(viena.variance).amount === 0.5, 'Faltante Viena mostrado en positivo (0.5)')
  assert(chorizo.expectedReturn === 7 && chorizo.variance === 0, 'Chorizo cuadra exacto')
  assert(describeVariance(chorizo.variance).kind === 'CUADRADO', 'Chorizo se reporta como CUADRADO')
  assert(describeVariance(0.4).kind === 'SOBRANTE', 'variance positivo = SOBRANTE')

  // --- Dinero ---
  const collections: DistCollection[] = [
    {
      ...BASE,
      id: 'col-1',
      operationId: 'col-1',
      createdAt: '2026-08-14T12:00:00.000Z',
      receivableId: 'rec-old',
      customerId: 'cust-demo',
      customerName: 'Cliente Demo',
      routeId: 'route-norte',
      collectedByUid: 'hugo',
      collectedByName: 'Hugo Herbas',
      amount: 100,
      method: 'cash',
    },
  ]
  const expenses: DistExpense[] = [
    {
      ...BASE,
      id: 'exp-1',
      operationId: 'exp-1',
      createdAt: '2026-08-14T12:30:00.000Z',
      concept: 'Gasolina',
      amount: 20,
      routeId: 'route-norte',
      routeName: 'Zona Norte',
      registeredByUid: 'hugo',
      registeredByName: 'Hugo Herbas',
    },
  ]

  const money = computeMoneySummary(sales, collections, expenses)
  assert(money.salesTotal === 447, 'ventas totales = Bs 447')
  assert(money.cashSales === 288, 'ventas efectivo = Bs 288')
  assert(money.creditGenerated === 159, 'credito generado = Bs 159')
  assert(money.cashCollections === 100, 'cobros efectivo = Bs 100')
  assert(money.cashExpenses === 20, 'gastos efectivo = Bs 20')
  assert(money.expectedCash === 368, 'efectivo esperado = 288 + 100 - 20 = Bs 368')
  assert(round2(365 - money.expectedCash) === -3, 'declarado 365 produce diferencia -3')
  assert(describeVariance(365 - money.expectedCash).kind === 'FALTANTE', 'diferencia de caja = FALTANTE Bs 3')
  assert(describeVariance(365 - money.expectedCash).amount === 3, 'faltante de caja mostrado como Bs 3')

  // Los cobros no inflan las ventas
  assert(money.salesTotal === 447 && money.collectionsTotal === 100, 'los cobros no suman a salesTotal')
  // QR no entra al efectivo fisico
  const qrMoney = computeMoneySummary(
    [{ ...sales[0], cashAmount: 0, qrAmount: 288, paymentKind: 'qr' }],
    [],
    [],
  )
  assert(qrMoney.expectedCash === 0, 'una venta QR no suma al efectivo esperado')

  // --- Pagos ---
  assert(computeSaleTotal(sales[0].lines) === 288, 'total de venta calculado desde subtotales')
  const cashSplit = splitPayment(288, 'cash')
  assert(cashSplit.cashAmount === 288 && cashSplit.creditAmount === 0, 'split efectivo')
  const creditSplit = splitPayment(159, 'credit')
  assert(creditSplit.creditAmount === 159, 'split credito')
  const mixedSplit = splitPayment(200, 'mixed', { cashAmount: 120, qrAmount: 80 })
  assert(mixedSplit.creditAmount === 0 && mixedSplit.cashAmount === 120, 'split mixto efectivo+QR')
  assert(validateSalePayment(200, mixedSplit) === null, 'split mixto valido')
  assert(validateSalePayment(250, mixedSplit) !== null, 'split mixto que no cuadra es rechazado')

  // --- Stock ---
  const available = new Map<string, number>([['p-viena-granel', 19]])
  assert(
    validateStockAvailability(
      [{ productId: 'p-viena-granel', productName: 'Viena', quantity: 6, unitType: 'kg' }],
      available,
    ) === null,
    'venta dentro del stock disponible es aceptada',
  )
  assert(
    validateStockAvailability(
      [{ productId: 'p-viena-granel', productName: 'Viena', quantity: 25, unitType: 'kg' }],
      available,
    ) !== null,
    'venta que dejaria stock negativo es rechazada',
  )
  assert(
    validateStockAvailability(
      [
        { productId: 'p-viena-granel', productName: 'Viena', quantity: 10, unitType: 'kg' },
        { productId: 'p-viena-granel', productName: 'Viena', quantity: 10, unitType: 'kg' },
      ],
      available,
    ) !== null,
    'dos lineas del mismo producto se acumulan al validar stock',
  )

  // --- Creditos y cobros ---
  assert(validateCollection(50, 159) === null, 'cobro parcial valido')
  assert(validateCollection(200, 159) !== null, 'no se puede cobrar mas que el saldo')
  assert(validateCollection(0, 159) !== null, 'no se puede cobrar cero')
  assert(nextReceivableStatus(159, 0) === 'OPEN', 'credito sin pagos = OPEN')
  assert(nextReceivableStatus(159, 50) === 'PARTIAL', 'credito con pago parcial = PARTIAL')
  assert(nextReceivableStatus(159, 159) === 'PAID', 'credito saldado = PAID')

  // --- Resumen por vendedor ---
  const breakdown = computeSellerBreakdown(sales, collections, expenses)
  const hugo = breakdown.find((row) => row.sellerUid === 'hugo')!
  assert(breakdown.length === 1, 'un solo vendedor en el resumen')
  assert(hugo.salesCount === 2, 'Hugo tiene 2 ventas')
  assert(hugo.salesTotal === 447, 'Hugo vendio Bs 447')
  assert(hugo.cashSales === 288, 'Hugo cobro Bs 288 en efectivo')
  assert(hugo.creditGenerated === 159, 'Hugo genero Bs 159 de credito')
  assert(hugo.collected === 100, 'Hugo cobro Bs 100 de cartera')
  assert(hugo.expenses === 20, 'Hugo gasto Bs 20')
  assert(hugo.kilograms === 9, 'Hugo vendio 9 kg')
  assert(hugo.packages === 0, 'Hugo no vendio paquetes')
  assert(hugo.expectedCash === 368, 'Hugo debe entregar Bs 368')

  const twoSellers = computeSellerBreakdown(
    [...sales, { ...sales[0], id: 'sale-3', sellerUid: 'ricardo', sellerName: 'Ricardo Jimenez', total: 100, cashAmount: 100, creditAmount: 0, lines: [] }],
    collections,
    expenses,
  )
  assert(twoSellers.length === 2, 'dos vendedores se listan por separado')
  assert(twoSellers[0].salesTotal >= twoSellers[1].salesTotal, 'el resumen ordena por venta descendente')

  return { passed, failed, results }
}

// Ejecucion directa por consola (npm run test:distribution)
const nodeProcess = (globalThis as { process?: { argv?: string[]; exitCode?: number } }).process
const entryPoint = nodeProcess?.argv?.[1] ?? ''

if (entryPoint.replace(/\\/g, '/').includes('distributionEngine.test')) {
  void runDistributionEngineTestSuite().then((report) => {
    report.results.forEach((line) => console.log(line))
    console.log(`\n${report.passed} passed / ${report.failed} failed`)
    if (report.failed > 0 && nodeProcess) nodeProcess.exitCode = 1
  })
}
