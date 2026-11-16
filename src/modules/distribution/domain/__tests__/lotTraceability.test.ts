import {
  buildLotTraceability,
  isMovementRelatedToLot,
  lotAllocatedQuantity,
} from '../lotTraceability.ts'
import type { DistLot, DistProduct, DistRoute, DistSale, DistStockMovement } from '../../types.ts'

console.log('--- INICIANDO TEST SUITE: TRAZABILIDAD DE LOTES ---')

// 1. Helpers para fixtures
const createLot = (id: string, lotCode: string, extra: Record<string, unknown> = {}): DistLot => ({
  id,
  restaurantId: 'sanjose',
  productId: 'prod-sachet',
  lotCode,
  manufacturedOn: '2026-11-12',
  expiresOn: '2026-12-12',
  unitType: 'unit',
  quantities: { central: 0 },
  createdAt: '2026-11-12T09:00:00.000Z',
  createdBy: 'test-admin',
  schemaVersion: 1,
  ...extra,
} as unknown as DistLot)

const createProduct = (): DistProduct => ({
  id: 'prod-sachet',
  restaurantId: 'sanjose',
  name: 'Sachet Mortadela PRIMAVERA',
  unitType: 'unit',
  category: 'sachets',
  basePrice: 15,
  cost: 10,
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  createdBy: 'admin',
  schemaVersion: 1,
} as unknown as DistProduct)

const createRoute = (id: string, name: string): DistRoute => ({
  id,
  restaurantId: 'sanjose',
  name,
  code: id,
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  createdBy: 'admin',
  schemaVersion: 1,
} as unknown as DistRoute)

const createMovement = (id: string, type: DistStockMovement['type'], extra: Record<string, unknown> = {}): DistStockMovement => ({
  id,
  restaurantId: 'sanjose',
  type,
  productId: 'prod-sachet',
  productName: 'Sachet Mortadela PRIMAVERA',
  unitType: 'unit',
  quantity: 1,
  centralDelta: 0,
  routeDelta: 0,
  createdAt: '2026-11-12T10:00:00.000Z',
  createdBy: 'admin',
  dayKey: '2026-11-12',
  schemaVersion: 1,
  ...extra,
} as unknown as DistStockMovement)

// =========================================================================
// TEST B: Lote agotado (saldo 0) que conserva historial completo y clientes
// =========================================================================
console.log('Ejecutando Test B: Lote agotado (saldo = 0)...')
{
  const lotA = createLot('lot-A', 'LOT-001', {
    processingPackageWeightLedger: { packageCount: 39, netWeightG: 7800 },
    quantities: { central: 0 }, // Saldo 0
  })

  const movements: DistStockMovement[] = [
    createMovement('m1', 'processing_output', {
      lotId: 'lot-A',
      lotCode: 'LOT-001',
      quantity: 39,
      createdAt: '2026-11-12T09:30:00.000Z',
    }),
    createMovement('m2', 'dispatch', {
      lotId: 'lot-A',
      lotCode: 'LOT-001',
      quantity: 20,
      routeId: 'route-sud',
      createdAt: '2026-11-13T08:00:00.000Z',
    }),
    createMovement('m3', 'sale', {
      refId: 'sale-1',
      lotId: 'lot-A',
      lotCode: 'LOT-001',
      quantity: 12,
      createdAt: '2026-11-13T10:00:00.000Z',
    }),
    createMovement('m4', 'sale', {
      refId: 'sale-2',
      lotId: 'lot-A',
      lotCode: 'LOT-001',
      quantity: 8,
      createdAt: '2026-11-13T11:00:00.000Z',
    }),
  ]

  const salesById = {
    'sale-1': {
      id: 'sale-1',
      restaurantId: 'sanjose',
      customerName: 'Cliente Mayorista Norte',
      customerId: 'cust-1',
      sellerName: 'Ricardo Vendedor',
      routeId: 'route-sud',
      total: 180,
      paymentKind: 'cash',
      operationId: 'REC-001',
      lines: [],
      createdAt: '2026-11-13T10:00:00.000Z',
      createdBy: 'ricardo',
      dayKey: '2026-11-13',
      schemaVersion: 1,
    },
    'sale-2': {
      id: 'sale-2',
      restaurantId: 'sanjose',
      customerName: 'Tienda Doña Elena',
      customerId: 'cust-2',
      sellerName: 'Ricardo Vendedor',
      routeId: 'route-sud',
      total: 120,
      paymentKind: 'qr',
      operationId: 'REC-002',
      lines: [],
      createdAt: '2026-11-13T11:00:00.000Z',
      createdBy: 'ricardo',
      dayKey: '2026-11-13',
      schemaVersion: 1,
    },
  } as unknown as Record<string, DistSale>

  const result = buildLotTraceability({
    lot: lotA,
    product: createProduct(),
    movements,
    salesById,
    routes: [createRoute('route-sud', 'Ruta Sud')],
  })

  if (result.summary.currentStock !== 0) {
    throw new Error(`Test B falló: currentStock debe ser 0, got ${result.summary.currentStock}`)
  }
  if (result.summary.intakeQuantity !== 39) {
    throw new Error(`Test B falló: intakeQuantity debe ser 39, got ${result.summary.intakeQuantity}`)
  }
  if (result.summary.dispatchedQuantity !== 20) {
    throw new Error(`Test B falló: dispatchedQuantity debe ser 20, got ${result.summary.dispatchedQuantity}`)
  }
  if (result.summary.soldQuantity !== 20) {
    throw new Error(`Test B falló: soldQuantity debe ser 20 (12 + 8), got ${result.summary.soldQuantity}`)
  }
  if (result.deliveries.length !== 2) {
    throw new Error(`Test B falló: deben haber 2 entregas a clientes, got ${result.deliveries.length}`)
  }
  if (result.deliveries[0].customerName !== 'Cliente Mayorista Norte' || result.deliveries[0].deliveredQuantity !== 12) {
    throw new Error(`Test B falló: entrega 1 incorrecta: ${JSON.stringify(result.deliveries[0])}`)
  }
  if (result.deliveries[1].customerName !== 'Tienda Doña Elena' || result.deliveries[1].deliveredQuantity !== 8) {
    throw new Error(`Test B falló: entrega 2 incorrecta: ${JSON.stringify(result.deliveries[1])}`)
  }
  if (result.timeline.length !== 4) {
    throw new Error(`Test B falló: timeline debe contener 4 eventos cronológicos, got ${result.timeline.length}`)
  }
  console.log('✓ Test B PASADO: Lote agotado con 0 existencias mantiene trazabilidad perfecta y entregas a clientes.')
}

// =========================================================================
// TEST C: Trazabilidad multi-lote (venta con allocations compartidas)
// =========================================================================
console.log('Ejecutando Test C: Venta multi-lote...')
{
  const lotA = createLot('lot-A', 'LOTE-A')
  const lotB = createLot('lot-B', 'LOTE-B')

  // Una venta de 20 unidades en total: 9 de Lote A y 11 de Lote B
  const saleMovement: DistStockMovement = createMovement('m-multi', 'sale', {
    quantity: 20,
    allocations: [
      { lotId: 'lot-A', lotCode: 'LOTE-A', quantity: 9, expiresOn: '2026-12-12', productionCost: 10 },
      { lotId: 'lot-B', lotCode: 'LOTE-B', quantity: 11, expiresOn: '2026-12-12', productionCost: 10 },
    ],
    refId: 'sale-multi',
  })

  // Al verificar relación
  if (!isMovementRelatedToLot(saleMovement, 'lot-A', 'LOTE-A')) {
    throw new Error('Test C falló: el movimiento multi-lote debe relacionarse con Lote A')
  }
  if (!isMovementRelatedToLot(saleMovement, 'lot-B', 'LOTE-B')) {
    throw new Error('Test C falló: el movimiento multi-lote debe relacionarse con Lote B')
  }

  // Al consultar Lote A: debe atribuir SOLO 9 unidades
  const qtyA = lotAllocatedQuantity(saleMovement, 'lot-A', 'LOTE-A')
  if (qtyA !== 9) {
    throw new Error(`Test C falló: Lote A debe recibir únicamente 9 unidades, got ${qtyA}`)
  }

  // Al consultar Lote B: debe atribuir SOLO 11 unidades
  const qtyB = lotAllocatedQuantity(saleMovement, 'lot-B', 'LOTE-B')
  if (qtyB !== 11) {
    throw new Error(`Test C falló: Lote B debe recibir únicamente 11 unidades, got ${qtyB}`)
  }

  const resultA = buildLotTraceability({
    lot: lotA,
    product: createProduct(),
    movements: [saleMovement],
    salesById: {},
  })
  if (resultA.summary.soldQuantity !== 9) {
    throw new Error(`Test C falló: buildLotTraceability para Lote A debe reportar 9 vendidos, got ${resultA.summary.soldQuantity}`)
  }
  if (resultA.deliveries[0].deliveredQuantity !== 9) {
    throw new Error(`Test C falló: entrega de Lote A debe ser 9, got ${resultA.deliveries[0].deliveredQuantity}`)
  }

  const resultB = buildLotTraceability({
    lot: lotB,
    product: createProduct(),
    movements: [saleMovement],
    salesById: {},
  })
  if (resultB.summary.soldQuantity !== 11) {
    throw new Error(`Test C falló: buildLotTraceability para Lote B debe reportar 11 vendidos, got ${resultB.summary.soldQuantity}`)
  }
  console.log('✓ Test C PASADO: Venta multi-lote atribuye estrictamente las unidades asignadas a cada lote.')
}

// =========================================================================
// TEST D: Venta sin cliente registrado
// =========================================================================
console.log('Ejecutando Test D: Venta sin cliente registrado...')
{
  const lotA = createLot('lot-A', 'LOTE-ANONIMO')
  const saleMovement = createMovement('m-anon', 'sale', {
    lotId: 'lot-A',
    lotCode: 'LOTE-ANONIMO',
    quantity: 4,
    refId: 'sale-anon',
  })

  // Venta sin cliente o con cliente vacío
  const salesById = {
    'sale-anon': {
      id: 'sale-anon',
      restaurantId: 'sanjose',
      customerName: '', // Sin nombre
      sellerName: 'Vendedor Ruta',
      total: 60,
      lines: [],
      createdAt: '2026-11-13T12:00:00.000Z',
      createdBy: 'seller',
      dayKey: '2026-11-13',
      schemaVersion: 1,
    },
  } as unknown as Record<string, DistSale>

  const result = buildLotTraceability({
    lot: lotA,
    product: createProduct(),
    movements: [saleMovement],
    salesById,
  })

  if (result.deliveries.length !== 1) {
    throw new Error(`Test D falló: debe registrar 1 entrega, got ${result.deliveries.length}`)
  }
  if (result.deliveries[0].customerName !== 'Venta sin cliente registrado') {
    throw new Error(`Test D falló: debe mostrar 'Venta sin cliente registrado', got '${result.deliveries[0].customerName}'`)
  }
  console.log('✓ Test D PASADO: Venta sin cliente registrado muestra la leyenda adecuada sin romper la vista.')
}

// =========================================================================
// TEST E: Devolución posterior a una venta
// =========================================================================
console.log('Ejecutando Test E: Venta con devolución posterior...')
{
  const lotA = createLot('lot-A', 'LOTE-DEV')
  const movements: DistStockMovement[] = [
    createMovement('m-sale', 'sale', {
      lotId: 'lot-A',
      lotCode: 'LOTE-DEV',
      quantity: 10,
      refId: 'sale-dev',
      createdAt: '2026-11-13T10:00:00.000Z',
    }),
    createMovement('m-ret', 'customer_return', {
      lotId: 'lot-A',
      lotCode: 'LOTE-DEV',
      quantity: 2,
      note: 'Cliente devolvió 2 paquetes por ajuste de pedido',
      createdAt: '2026-11-13T14:00:00.000Z',
    }),
  ]

  const result = buildLotTraceability({
    lot: lotA,
    product: createProduct(),
    movements,
    salesById: {},
  })

  if (result.summary.soldQuantity !== 10) {
    throw new Error(`Test E falló: soldQuantity debe ser 10, got ${result.summary.soldQuantity}`)
  }
  if (result.summary.returnedQuantity !== 2) {
    throw new Error(`Test E falló: returnedQuantity debe ser 2, got ${result.summary.returnedQuantity}`)
  }
  if (result.timeline.length !== 2) {
    throw new Error(`Test E falló: timeline debe contener 2 eventos (venta y devolución), got ${result.timeline.length}`)
  }
  if (result.timeline[1].stepType !== 'return' || result.timeline[1].label !== 'Devolución de cliente') {
    throw new Error(`Test E falló: el segundo evento debe ser devolución de cliente, got ${result.timeline[1].label}`)
  }
  console.log('✓ Test E PASADO: Trazabilidad refleja venta original y devolución posterior claramente.')
}

// =========================================================================
// TEST REAL 101126: Sachet Mortadela PRIMAVERA
// =========================================================================
console.log('Ejecutando Simulación del Caso Real Lote 101126...')
{
  const lot101126 = createLot('processing_674fca08ff10426466a2288214d4569bac018dbd', '101126', {
    processingPackageWeightLedger: { packageCount: 39, netWeightG: 7800 },
    quantities: { central: 4 }, // 4 remanentes en central
    manufacturedOn: '2026-11-12',
    expiresOn: '2026-12-12',
  })

  const movements: DistStockMovement[] = [
    // 1. Ingreso elaboración
    createMovement('m-in', 'processing_output', {
      lotId: lot101126.id,
      lotCode: '101126',
      quantity: 39,
      createdAt: '2026-11-12T09:34:14.081Z',
    }),
    // 2. Despacho a ruta Sud
    createMovement('m-disp', 'dispatch', {
      lotId: lot101126.id,
      lotCode: '101126',
      quantity: 39,
      routeId: 'route-sud',
      createdAt: '2026-11-13T12:09:20.147Z',
    }),
    // 3. Venta 1: 9 paquetes
    createMovement('m-s1', 'sale', {
      refId: 'sale-prod-1',
      allocations: [{ lotId: lot101126.id, lotCode: '101126', quantity: 9 }],
      createdAt: '2026-11-13T14:00:00.000Z',
    }),
    // 4. Venta 2: 6 paquetes
    createMovement('m-s2', 'sale', {
      refId: 'sale-prod-2',
      allocations: [{ lotId: lot101126.id, lotCode: '101126', quantity: 6 }],
      createdAt: '2026-11-13T15:00:00.000Z',
    }),
    // 5. Venta 3: 10 paquetes
    createMovement('m-s3', 'sale', {
      refId: 'sale-prod-3',
      allocations: [{ lotId: lot101126.id, lotCode: '101126', quantity: 10 }],
      createdAt: '2026-11-13T16:00:00.000Z',
    }),
    // 6. Retorno de ruta Sud a central (14 paquetes)
    createMovement('m-ret', 'return', {
      lotId: lot101126.id,
      lotCode: '101126',
      quantity: 14,
      createdAt: '2026-11-14T08:00:00.000Z',
    }),
    // 7. Venta 4: 5 paquetes desde central
    createMovement('m-s4', 'sale', {
      refId: 'sale-prod-4',
      allocations: [{ lotId: lot101126.id, lotCode: '101126', quantity: 5 }],
      createdAt: '2026-11-16T10:00:00.000Z',
    }),
  ]

  const salesById = {
    'sale-prod-1': {
      id: 'sale-prod-1',
      restaurantId: 'sanjose',
      customerName: 'Cliente R1 (9 paq)',
      sellerName: 'Ricardo',
      routeId: 'route-sud',
      total: 135,
      lines: [],
      createdAt: '2026-11-13T14:00:00.000Z',
      createdBy: 'ricardo',
      dayKey: '2026-11-13',
      schemaVersion: 1,
    },
    'sale-prod-2': {
      id: 'sale-prod-2',
      restaurantId: 'sanjose',
      customerName: 'Cliente R2 (6 paq)',
      sellerName: 'Ricardo',
      routeId: 'route-sud',
      total: 90,
      lines: [],
      createdAt: '2026-11-13T15:00:00.000Z',
      createdBy: 'ricardo',
      dayKey: '2026-11-13',
      schemaVersion: 1,
    },
    'sale-prod-3': {
      id: 'sale-prod-3',
      restaurantId: 'sanjose',
      customerName: 'Cliente R3 (10 paq)',
      sellerName: 'Ricardo',
      routeId: 'route-sud',
      total: 150,
      lines: [],
      createdAt: '2026-11-13T16:00:00.000Z',
      createdBy: 'ricardo',
      dayKey: '2026-11-13',
      schemaVersion: 1,
    },
    'sale-prod-4': {
      id: 'sale-prod-4',
      restaurantId: 'sanjose',
      customerName: 'Cliente Central (5 paq)',
      sellerName: 'Administración',
      routeId: 'central',
      total: 75,
      lines: [],
      createdAt: '2026-11-16T10:00:00.000Z',
      createdBy: 'admin',
      dayKey: '2026-11-16',
      schemaVersion: 1,
    },
  } as unknown as Record<string, DistSale>

  const result = buildLotTraceability({
    lot: lot101126,
    product: createProduct(),
    movements,
    salesById,
  })

  if (result.identification.initialIntakeQuantity !== 39) {
    throw new Error(`Caso 101126 falló: ingreso inicial debe ser 39, got ${result.identification.initialIntakeQuantity}`)
  }
  if (result.summary.soldQuantity !== 30) {
    throw new Error(`Caso 101126 falló: vendidos deben ser 30 (9+6+10+5), got ${result.summary.soldQuantity}`)
  }
  if (result.deliveries.length !== 4) {
    throw new Error(`Caso 101126 falló: deben haber exactamente 4 entregas a clientes, got ${result.deliveries.length}`)
  }
  if (result.summary.currentStock !== 4) {
    throw new Error(`Caso 101126 falló: stock remanente debe ser 4, got ${result.summary.currentStock}`)
  }
  console.log('✓ Simulación Caso Real 101126 PASADA: 39 ingresaron, 30 vendidos en 4 clientes, 14 devueltos a central, saldo 4.')
}

console.log('ALL TESTS PASSED: src/modules/distribution/domain/__tests__/lotTraceability.test.ts')
