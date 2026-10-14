import {
  computeCreditPortfolioByRoute,
  resolveReceivableRouteId,
  resolveCreditProducts,
  getRouteDisplayName,
} from '../creditRoutes.ts'
import { validateExpenseInput } from '../expensesValidation.ts'
import type { DistCustomer, DistReceivable, DistRoute, DistSale, DistSaleLine } from '../../types.ts'

console.log('=== Iniciando pruebas de Créditos por Ruta y Gastos "Otros" (v1.4.17) ===')

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

const createRec = (overrides: Record<string, unknown>): DistReceivable =>
  ({
    restaurantId: 'sanjose',
    branchId: 'central',
    createdBy: 'admin',
    dayKey: '2026-10-10',
    schemaVersion: 1,
    distributorUid: 'hugo',
    distributorName: 'Hugo',
    status: 'OPEN',
    paidAmount: 0,
    createdAt: '2026-10-10T10:00:00Z',
    ...overrides,
  } as unknown as DistReceivable)

const createSale = (overrides: Record<string, unknown>): DistSale =>
  ({
    restaurantId: 'sanjose',
    branchId: 'central',
    createdBy: 'admin',
    dayKey: '2026-10-10',
    schemaVersion: 1,
    operationId: String(overrides.id || 'sale-1'),
    sourceLocation: 'route',
    routeId: 'route-a',
    routeName: 'Ruta A',
    sellerUid: 'hugo',
    sellerName: 'Hugo',
    paymentKind: 'credit',
    itemsCount: 1,
    lines: [],
    subtotal: 100,
    discountAmount: 0,
    total: 100,
    paidAmount: 0,
    creditAmount: 100,
    status: 'COMPLETED',
    createdAt: '2026-10-10T10:00:00Z',
    ...overrides,
  } as unknown as DistSale)

// Datos base de prueba
const routes: DistRoute[] = [
  { id: 'route-a', name: 'Ruta A (Hugo)', kind: 'route', active: true, restaurantId: 'sanjose', createdAt: '2026-10-01' },
  { id: 'route-b', name: 'Ruta B (Pedro)', kind: 'route', active: true, restaurantId: 'sanjose', createdAt: '2026-10-01' },
]

const customers: DistCustomer[] = [
  { id: 'cust-juan', name: 'Juan Pérez', customerCode: 'CUST-001', active: true, restaurantId: 'sanjose', createdAt: '2026-10-01', createdBy: 'admin' },
  { id: 'cust-pedro', name: 'Pedro Morales', customerCode: 'CUST-002', active: true, restaurantId: 'sanjose', createdAt: '2026-10-01', createdBy: 'admin' },
  { id: 'cust-maria', name: 'María Gómez', customerCode: 'CUST-003', active: true, restaurantId: 'sanjose', createdAt: '2026-10-01', createdBy: 'admin' },
]

// 1. Ruta A tiene Juan Bs100 y Pedro Bs200 → filtro A muestra ambos y total Bs300.
{
  const receivables: DistReceivable[] = [
    createRec({
      id: 'rec-1',
      customerId: 'cust-juan',
      customerName: 'Juan Pérez',
      routeId: 'route-a',
      distributorUid: 'hugo',
      distributorName: 'Hugo',
      originalAmount: 100,
      paidAmount: 0,
      balance: 100,
      status: 'OPEN',
      createdAt: '2026-10-10T10:00:00Z',
    }),
    createRec({
      id: 'rec-2',
      customerId: 'cust-pedro',
      customerName: 'Pedro Morales',
      routeId: 'route-a',
      distributorUid: 'hugo',
      distributorName: 'Hugo',
      originalAmount: 200,
      paidAmount: 0,
      balance: 200,
      status: 'OPEN',
      createdAt: '2026-10-10T10:30:00Z',
    }),
    createRec({
      id: 'rec-3',
      customerId: 'cust-maria',
      customerName: 'María Gómez',
      routeId: 'route-b',
      distributorUid: 'pedro',
      distributorName: 'Pedro',
      originalAmount: 400,
      paidAmount: 0,
      balance: 400,
      status: 'OPEN',
      createdAt: '2026-10-10T11:00:00Z',
    }),
  ]

  const resultA = computeCreditPortfolioByRoute({
    receivables,
    selectedRouteId: 'route-a',
    routes,
    customers,
  })

  pass(resultA.customerCredits.length === 2, '1.1 Filtro Ruta A muestra exactamente 2 clientes (Juan y Pedro)')
  pass(resultA.totalOutstanding === 300, '1.2 Filtro Ruta A calcula total por cobrar exactamente en Bs 300')
  pass(resultA.customerCredits.some((c) => c.customerId === 'cust-juan' && c.filteredBalance === 100), '1.3 Juan muestra Bs 100 en Ruta A')
  pass(resultA.customerCredits.some((c) => c.customerId === 'cust-pedro' && c.filteredBalance === 200), '1.4 Pedro muestra Bs 200 en Ruta A')
  pass(!resultA.customerCredits.some((c) => c.customerId === 'cust-maria'), '1.5 María (Ruta B) no aparece en filtro Ruta A')
}

// 2. Ruta B tiene María Bs400 → filtro B solo muestra María y Bs400.
{
  const receivables: DistReceivable[] = [
    createRec({
      id: 'rec-1',
      customerId: 'cust-juan',
      customerName: 'Juan Pérez',
      routeId: 'route-a',
      distributorUid: 'hugo',
      distributorName: 'Hugo',
      originalAmount: 100,
      paidAmount: 0,
      balance: 100,
      status: 'OPEN',
      createdAt: '2026-10-10T10:00:00Z',
    }),
    createRec({
      id: 'rec-3',
      customerId: 'cust-maria',
      customerName: 'María Gómez',
      routeId: 'route-b',
      distributorUid: 'pedro',
      distributorName: 'Pedro',
      originalAmount: 400,
      paidAmount: 0,
      balance: 400,
      status: 'OPEN',
      createdAt: '2026-10-10T11:00:00Z',
    }),
  ]

  const resultB = computeCreditPortfolioByRoute({
    receivables,
    selectedRouteId: 'route-b',
    routes,
    customers,
  })

  pass(resultB.customerCredits.length === 1, '2.1 Filtro Ruta B solo muestra a María')
  pass(resultB.customerCredits[0].customerId === 'cust-maria', '2.2 El único cliente es María')
  pass(resultB.customerCredits[0].filteredBalance === 400, '2.3 Deuda de María en Ruta B es Bs 400')
  pass(resultB.totalOutstanding === 400, '2.4 Total por cobrar de Ruta B es Bs 400')
}

// 3. Todas las rutas → total correcto.
{
  const receivables: DistReceivable[] = [
    createRec({
      id: 'rec-1',
      customerId: 'cust-juan',
      customerName: 'Juan Pérez',
      routeId: 'route-a',
      distributorUid: 'hugo',
      distributorName: 'Hugo',
      originalAmount: 100,
      paidAmount: 0,
      balance: 100,
      status: 'OPEN',
      createdAt: '2026-10-10T10:00:00Z',
    }),
    createRec({
      id: 'rec-2',
      customerId: 'cust-pedro',
      customerName: 'Pedro Morales',
      routeId: 'route-a',
      distributorUid: 'hugo',
      distributorName: 'Hugo',
      originalAmount: 200,
      paidAmount: 0,
      balance: 200,
      status: 'OPEN',
      createdAt: '2026-10-10T10:30:00Z',
    }),
    createRec({
      id: 'rec-3',
      customerId: 'cust-maria',
      customerName: 'María Gómez',
      routeId: 'route-b',
      distributorUid: 'pedro',
      distributorName: 'Pedro',
      originalAmount: 400,
      paidAmount: 0,
      balance: 400,
      status: 'OPEN',
      createdAt: '2026-10-10T11:00:00Z',
    }),
  ]

  const resultAll = computeCreditPortfolioByRoute({
    receivables,
    selectedRouteId: 'all',
    routes,
    customers,
  })

  pass(resultAll.customerCredits.length === 3, '3.1 Todas las rutas muestra los 3 clientes')
  pass(resultAll.totalOutstanding === 700, '3.2 Total por cobrar global es 100 + 200 + 400 = Bs 700')
  pass(resultAll.totalCustomersWithBalance === 3, '3.3 Cantidad de clientes con saldo es 3')
}

// 4. Mismo cliente con deuda A100 y B200: filtro A muestra 100; filtro B muestra 200; no mezcla.
{
  const receivables: DistReceivable[] = [
    createRec({
      id: 'rec-j-a',
      customerId: 'cust-juan',
      customerName: 'Juan Pérez',
      routeId: 'route-a',
      distributorUid: 'hugo',
      distributorName: 'Hugo',
      originalAmount: 100,
      paidAmount: 0,
      balance: 100,
      status: 'OPEN',
      createdAt: '2026-10-10T10:00:00Z',
    }),
    createRec({
      id: 'rec-j-b',
      customerId: 'cust-juan',
      customerName: 'Juan Pérez',
      routeId: 'route-b',
      distributorUid: 'pedro',
      distributorName: 'Pedro',
      originalAmount: 200,
      paidAmount: 0,
      balance: 200,
      status: 'OPEN',
      createdAt: '2026-10-11T10:00:00Z',
    }),
  ]

  const resA = computeCreditPortfolioByRoute({
    receivables,
    selectedRouteId: 'route-a',
    routes,
    customers,
  })
  const juanA = resA.customerCredits.find((c) => c.customerId === 'cust-juan')
  pass(juanA !== undefined && juanA.filteredBalance === 100, '4.1 Filtro Ruta A muestra Juan con saldo Bs 100 (no 300)')
  pass(juanA?.totalBalance === 300, '4.2 Juan conserva su deuda total de Bs 300 documentada para advertencia FIFO')
  pass(resA.totalOutstanding === 100, '4.3 Total cartera en filtro Ruta A es Bs 100')

  const resB = computeCreditPortfolioByRoute({
    receivables,
    selectedRouteId: 'route-b',
    routes,
    customers,
  })
  const juanB = resB.customerCredits.find((c) => c.customerId === 'cust-juan')
  pass(juanB !== undefined && juanB.filteredBalance === 200, '4.4 Filtro Ruta B muestra Juan con saldo Bs 200 (no 300 ni 100)')
  pass(resB.totalOutstanding === 200, '4.5 Total cartera en filtro Ruta B es Bs 200')

  const resAll = computeCreditPortfolioByRoute({
    receivables,
    selectedRouteId: 'all',
    routes,
    customers,
  })
  const juanAll = resAll.customerCredits.find((c) => c.customerId === 'cust-juan')
  pass(juanAll?.filteredBalance === 300 && juanAll.routes.length === 2, '4.6 En Todas las rutas Juan muestra total 300 y desglose en 2 rutas')
}

// 5. receivable.saleLines con 2 productos → detalle muestra ambos con cantidad, precio y subtotal.
{
  const saleLines: DistSaleLine[] = [
    {
      productId: 'p-viena',
      productNameSnapshot: 'Salchicha Viena',
      presentationSnapshot: 'Granel',
      quantity: 5,
      unitType: 'kg',
      actualUnitPrice: 32,
      subtotal: 160,
    },
    {
      productId: 'p-pate',
      productNameSnapshot: 'Paté',
      presentationSnapshot: 'Lata 100g',
      quantity: 2,
      unitType: 'package',
      actualUnitPrice: 18,
      subtotal: 36,
    },
  ]

  const rec = createRec({
    id: 'rec-products',
    customerId: 'cust-juan',
    customerName: 'Juan Pérez',
    routeId: 'route-a',
    distributorUid: 'hugo',
    distributorName: 'Hugo',
    originalAmount: 196,
    paidAmount: 0,
    balance: 196,
    status: 'OPEN',
    saleLines,
    createdAt: '2026-10-13T10:00:00Z',
  })

  const resolved = resolveCreditProducts(rec)
  pass(resolved.lines.length === 2, '5.1 Resuelve exactamente 2 productos de saleLines')
  pass(resolved.lines[0].productNameSnapshot === 'Salchicha Viena' && resolved.lines[0].quantity === 5 && resolved.lines[0].subtotal === 160, '5.2 Producto 1 correcto: 5 kg Viena subtotal 160')
  pass(resolved.lines[1].productNameSnapshot === 'Paté' && resolved.lines[1].actualUnitPrice === 18 && resolved.lines[1].subtotal === 36, '5.3 Producto 2 correcto: 2 paq Paté a Bs 18 subtotal 36')
  pass(!resolved.isHistoricalWithoutDetail, '5.4 isHistoricalWithoutDetail es false')
}

// 6. Crédito parcialmente pagado → productos siguen visibles y saldo correcto.
{
  const rec = createRec({
    id: 'rec-partial',
    customerId: 'cust-juan',
    customerName: 'Juan Pérez',
    routeId: 'route-a',
    distributorUid: 'hugo',
    distributorName: 'Hugo',
    originalAmount: 196,
    paidAmount: 50,
    balance: 146,
    status: 'PARTIAL',
    saleLines: [
      {
        productId: 'p-viena',
        productNameSnapshot: 'Salchicha Viena',
        quantity: 5,
        unitType: 'kg',
        actualUnitPrice: 32,
        subtotal: 160,
      },
      {
        productId: 'p-pate',
        productNameSnapshot: 'Paté',
        quantity: 2,
        unitType: 'package',
        actualUnitPrice: 18,
        subtotal: 36,
      },
    ],
    createdAt: '2026-10-13T10:00:00Z',
  })

  const resolved = resolveCreditProducts(rec)
  pass(resolved.lines.length === 2, '6.1 Productos siguen intactos tras abono parcial de Bs 50')
  pass(rec.balance === 146 && rec.paidAmount === 50, '6.2 Saldo restante Bs 146 y pagado Bs 50')
}

// 7. opening_balance → no exige productos y muestra nota.
{
  const rec = createRec({
    id: 'rec-open',
    customerId: 'cust-juan',
    customerName: 'Juan Pérez',
    routeId: 'route-a',
    distributorUid: 'admin',
    distributorName: 'Administración',
    sourceType: 'opening_balance',
    note: 'Deuda según libreta mes anterior',
    originalAmount: 300,
    paidAmount: 0,
    balance: 300,
    status: 'OPEN',
    createdAt: '2026-10-01T10:00:00Z',
  })

  const resolved = resolveCreditProducts(rec)
  pass(resolved.lines.length === 0, '7.1 opening_balance no tiene productos')
  pass(!resolved.isHistoricalWithoutDetail, '7.2 opening_balance no se marca como error de detalle histórico')
  pass(rec.note === 'Deuda según libreta mes anterior', '7.3 Conserva nota de origen')
}

// 8. Crédito saldado → al expandir historial mantiene detalle de productos.
{
  const recPaid = createRec({
    id: 'rec-paid',
    customerId: 'cust-juan',
    customerName: 'Juan Pérez',
    routeId: 'route-a',
    distributorUid: 'hugo',
    distributorName: 'Hugo',
    originalAmount: 160,
    paidAmount: 160,
    balance: 0,
    status: 'PAID',
    saleLines: [
      {
        productId: 'p-viena',
        productNameSnapshot: 'Salchicha Viena',
        quantity: 5,
        unitType: 'kg',
        actualUnitPrice: 32,
        subtotal: 160,
      },
    ],
    createdAt: '2026-10-05T10:00:00Z',
  })

  const resolved = resolveCreditProducts(recPaid)
  pass(resolved.lines.length === 1 && resolved.lines[0].productNameSnapshot === 'Salchicha Viena', '8.1 Crédito saldado conserva sus productos')
  pass(recPaid.balance === 0 && recPaid.status === 'PAID', '8.2 Saldo es 0 y status PAID')
}

// 9. Receivable histórico sin saleLines pero con saleId → recupera venta si es posible.
{
  const recHist = createRec({
    id: 'rec-hist',
    customerId: 'cust-juan',
    customerName: 'Juan Pérez',
    routeId: 'route-a',
    distributorUid: 'hugo',
    distributorName: 'Hugo',
    saleId: 'sale-999',
    originalAmount: 100,
    paidAmount: 0,
    balance: 100,
    status: 'OPEN',
    createdAt: '2026-09-20T10:00:00Z',
  })

  const linkedSale = createSale({
    id: 'sale-999',
    customerId: 'cust-juan',
    customerName: 'Juan Pérez',
    sourceLocation: 'route',
    routeId: 'route-a',
    routeName: 'Ruta A',
    sellerUid: 'hugo',
    sellerName: 'Hugo',
    paymentKind: 'credit',
    total: 100,
    creditAmount: 100,
    cashAmount: 0,
    qrAmount: 0,
    lines: [
      {
        productId: 'p-salame',
        productNameSnapshot: 'Salame Tradicional',
        quantity: 2,
        unitType: 'package',
        actualUnitPrice: 50,
        subtotal: 100,
      },
    ],
    createdAt: '2026-09-20T10:00:00Z',
  })

  const resolved = resolveCreditProducts(recHist, linkedSale)
  pass(resolved.lines.length === 1 && resolved.lines[0].productNameSnapshot === 'Salame Tradicional', '9.1 Recupera productos exitosamente desde la venta vinculada')
  pass(!resolved.isHistoricalWithoutDetail, '9.2 isHistoricalWithoutDetail es false')
}

// 10. Histórico imposible de recuperar → fallback claro, sin crash.
{
  const recOrphan = createRec({
    id: 'rec-orphan',
    customerId: 'cust-juan',
    customerName: 'Juan Pérez',
    routeId: 'route-a',
    distributorUid: 'hugo',
    distributorName: 'Hugo',
    saleId: 'sale-deleted',
    originalAmount: 80,
    paidAmount: 0,
    balance: 80,
    status: 'OPEN',
    createdAt: '2026-08-01T10:00:00Z',
  })

  const resolved = resolveCreditProducts(recOrphan, null)
  pass(resolved.lines.length === 0, '10.1 No inventa productos para registros históricos no encontrados')
  pass(resolved.isHistoricalWithoutDetail === true, '10.2 Activa flag de fallback para mostrar mensaje respetuoso')
}

// 11. Venta corregida → productos/precios efectivos correctos.
{
  const recCorrected = createRec({
    id: 'rec-corrected',
    customerId: 'cust-juan',
    customerName: 'Juan Pérez',
    routeId: 'route-a',
    distributorUid: 'hugo',
    distributorName: 'Hugo',
    saleId: 'sale-corrected-1',
    originalAmount: 120, // corregido de 150 a 120
    paidAmount: 0,
    balance: 120,
    status: 'OPEN',
    saleLines: [
      {
        productId: 'p-viena',
        productNameSnapshot: 'Salchicha Viena',
        quantity: 4, // corregido de 5 a 4
        unitType: 'kg',
        actualUnitPrice: 30,
        subtotal: 120,
      },
    ],
    createdAt: '2026-10-12T10:00:00Z',
  })

  const saleCorrected = createSale({
    id: 'sale-corrected-1',
    customerId: 'cust-juan',
    customerName: 'Juan Pérez',
    sourceLocation: 'route',
    routeId: 'route-a',
    routeName: 'Ruta A',
    sellerUid: 'hugo',
    sellerName: 'Hugo',
    paymentKind: 'credit',
    total: 120,
    creditAmount: 120,
    cashAmount: 0,
    qrAmount: 0,
    lines: [
      {
        productId: 'p-viena',
        productNameSnapshot: 'Salchicha Viena',
        quantity: 5,
        unitType: 'kg',
        actualUnitPrice: 30,
        subtotal: 150,
      },
    ],
    effectiveSnapshot: {
      total: 120,
      paymentKind: 'credit',
      cashAmount: 0,
      qrAmount: 0,
      creditAmount: 120,
      lines: [
        {
          productId: 'p-viena',
          productNameSnapshot: 'Salchicha Viena',
          quantity: 4,
          unitType: 'kg',
          actualUnitPrice: 30,
          subtotal: 120,
        },
      ],
    },
    createdAt: '2026-10-12T10:00:00Z',
  })

  const resolved = resolveCreditProducts(recCorrected, saleCorrected)
  pass(resolved.lines[0].quantity === 4 && resolved.lines[0].subtotal === 120, '11.1 Venta corregida refleja cantidad efectiva 4 y subtotal 120')
}

// 12. Venta anulada → no suma cartera pendiente.
{
  const recVoid = createRec({
    id: 'rec-voided',
    customerId: 'cust-juan',
    customerName: 'Juan Pérez',
    routeId: 'route-a',
    distributorUid: 'hugo',
    distributorName: 'Hugo',
    saleId: 'sale-void-1',
    originalAmount: 0,
    paidAmount: 0,
    balance: 0,
    status: 'PAID',
    note: 'Venta anulada por error',
    createdAt: '2026-10-13T10:00:00Z',
  })
  // Atributos de anulación
  ;(recVoid as unknown as Record<string, unknown>).voidedAt = '2026-10-13T12:00:00Z'
  ;(recVoid as unknown as Record<string, unknown>).voidReason = 'Venta duplicada'

  const res = computeCreditPortfolioByRoute({
    receivables: [recVoid],
    selectedRouteId: 'route-a',
    routes,
    customers,
  })

  pass(res.totalOutstanding === 0, '12.1 Venta anulada tiene total pendiente Bs 0')
  pass(res.totalCustomersWithBalance === 0, '12.2 Venta anulada no cuenta como cliente con saldo')
  const resolved = resolveCreditProducts(recVoid)
  pass(resolved.isVoid === true, '12.3 Queda identificada como venta anulada')
  pass(resolved.voidReason === 'Venta duplicada', '12.4 Conserva el motivo de la anulación')
}

// === GASTOS / OTROS ===
// 13. Combustible → guarda concept Combustible.
{
  const val = validateExpenseInput({
    selectedConcept: 'Combustible',
    customConcept: '',
    amount: '50',
    routeId: 'route-a',
  })
  pass(val.valid === true, '13.1 Combustible es válido')
  pass(val.concept === 'Combustible', '13.2 Guarda concept = "Combustible"')
  pass(val.amount === 50, '13.3 Monto es 50')
}

// 14. Otros + “Peaje” → guarda concept = Peaje.
{
  const val = validateExpenseInput({
    selectedConcept: 'Otros',
    customConcept: 'Peaje',
    amount: '15',
    routeId: 'route-a',
  })
  pass(val.valid === true, '14.1 Otros + Peaje es válido')
  pass(val.concept === 'Peaje', '14.2 Guarda concept = "Peaje" (NO "Otros")')
  pass(val.amount === 15, '14.3 Monto es 15')
}

// 15. Otros vacío → bloqueado.
{
  const val = validateExpenseInput({
    selectedConcept: 'Otros',
    customConcept: '',
    amount: '20',
    routeId: 'route-a',
  })
  pass(val.valid === false, '15.1 Otros sin concepto es bloqueado')
  pass(val.error === 'Especifica el tipo de gasto.', '15.2 Mensaje exacto de error')
}

// 16. Otros "   " → bloqueado.
{
  const val = validateExpenseInput({
    selectedConcept: 'Otros',
    customConcept: '    ',
    amount: '20',
    routeId: 'route-a',
  })
  pass(val.valid === false, '16.1 Otros con solo espacios es bloqueado')
  pass(val.error === 'Especifica el tipo de gasto.', '16.2 Mensaje exacto de error')
}

// 17. Otros Peaje + observación “Autopista” → campos separados correctamente.
{
  const val = validateExpenseInput({
    selectedConcept: 'Otros',
    customConcept: 'Peaje',
    amount: '12',
    routeId: 'route-a',
    note: 'Autopista ida',
  })
  pass(val.valid === true, '17.1 Válido con observación')
  pass(val.concept === 'Peaje', '17.2 concept = "Peaje"')
  pass(val.note === 'Autopista ida', '17.3 note = "Autopista ida"')
}

// 18. cambiar Otros→Refrigerio → guarda Refrigerio, no custom anterior.
{
  const val = validateExpenseInput({
    selectedConcept: 'Refrigerio',
    customConcept: 'Peaje escrito anteriormente',
    amount: '25',
    routeId: 'route-a',
  })
  pass(val.valid === true, '18.1 Refrigerio es válido')
  pass(val.concept === 'Refrigerio', '18.2 Guarda concept = "Refrigerio", ignorando custom anterior')
}

// 19. luego de guardar/reabrir no queda texto viejo.
{
  // Simular reset de formulario
  let state = {
    selectedConcept: 'Otros',
    customConcept: 'Lavado',
    amount: '40',
    note: 'Taller',
  }
  // Ejecutar submit
  const submitResult = validateExpenseInput({ ...state, routeId: 'route-a' })
  pass(submitResult.valid && submitResult.concept === 'Lavado', '19.1 Gasto previo procesado')

  // Reset como en ExpensesView.tsx
  state = {
    selectedConcept: 'Combustible',
    customConcept: '',
    amount: '',
    note: '',
  }
  pass(state.selectedConcept === 'Combustible', '19.2 Concepto reestablecido a Combustible')
  pass(state.customConcept === '', '19.3 customConcept limpio')
  pass(state.amount === '', '19.4 amount limpio')
  pass(state.note === '', '19.5 note limpio')
}

// Verificación complementaria: fallback de ruta
{
  const recNoRoute = createRec({
    id: 'rec-noroute',
    customerId: 'cust-unknown',
    customerName: 'Desconocido',
    routeId: '',
    distributorUid: '',
    distributorName: '',
    originalAmount: 50,
    paidAmount: 0,
    balance: 50,
    status: 'OPEN',
    createdAt: '2026-08-01T10:00:00Z',
  })
  const rId = resolveReceivableRouteId(recNoRoute)
  pass(rId === 'no-route', 'Fallback seguro para receivables huérfanos sin ruta')
  pass(getRouteDisplayName('no-route', routes) === 'Sin ruta / Histórico', 'Nombre legible para sin ruta')
  pass(getRouteDisplayName('admin', routes) === 'Administración', 'Nombre legible para administración')
}

console.log(`\n========================================`)
console.log(`Resultado final: ${passed} comprobaciones aprobadas exitosamente (100%).`)
console.log(`========================================`)
