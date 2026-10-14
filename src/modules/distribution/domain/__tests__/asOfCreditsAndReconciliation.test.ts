import {
  computeAsOfReceivablesPortfolio,
  computeCreditPortfolioByRoute,
} from '../creditRoutes.ts'
import type { DistCollection, DistReceivable, DistRoute } from '../../types.ts'

console.log('=== Iniciando pruebas de Cartera As-Of y Conciliación Matemática (v1.4.19) ===')

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

function baseReceivable(overrides: Record<string, unknown>): DistReceivable {
  return {
    id: 'rec-1',
    restaurantId: 'rest-1',
    branchId: 'b-1',
    createdAt: '2026-08-10T10:00:00.000Z',
    createdBy: 'uid-1',
    dayKey: '2026-08-10',
    schemaVersion: 1,
    customerId: 'cust-1',
    customerName: 'Tienda Doña Rosa',
    routeId: 'route-1',
    distributorUid: 'dist-1',
    distributorName: 'Hugo',
    originalAmount: 1000,
    paidAmount: 1000,
    balance: 0,
    status: 'PAID',
    ...overrides,
  } as unknown as DistReceivable
}

function baseCollection(overrides: Record<string, unknown>): DistCollection {
  return {
    id: 'col-1',
    operationId: 'op-1',
    restaurantId: 'rest-1',
    branchId: 'b-1',
    createdAt: '2026-08-12T10:00:00.000Z',
    createdBy: 'uid-1',
    dayKey: '2026-08-12',
    schemaVersion: 1,
    customerId: 'cust-1',
    customerName: 'Tienda Doña Rosa',
    routeId: 'route-1',
    collectedByUid: 'dist-1',
    collectedByName: 'Hugo',
    amount: 400,
    method: 'cash',
    allocations: [{ receivableId: 'rec-1', amount: 400 }],
    ...overrides,
  } as unknown as DistCollection
}

// 1. Retorna lista intacta sin cutoff
{
  const receivables = [baseReceivable({ id: 'rec-1' })]
  const result = computeAsOfReceivablesPortfolio({
    receivables,
    collections: [],
  })
  pass(result.length === 1 && result[0].id === 'rec-1', 'Sin cutoffDayKey retorna la lista intacta')
}

// 2. Ignora créditos creados después del cutoff
{
  const r1 = baseReceivable({ id: 'rec-1', dayKey: '2026-08-10' })
  const r2 = baseReceivable({ id: 'rec-2', dayKey: '2026-08-16', createdAt: '2026-08-16T10:00:00.000Z' })

  const result = computeAsOfReceivablesPortfolio({
    receivables: [r1, r2],
    collections: [],
    cutoffDayKey: '2026-08-15',
  })

  pass(result.length === 1 && result[0].id === 'rec-1', 'Ignora créditos creados posterior a la fecha de corte')
}

// 3. Saldo As-Of ignora cobranzas posteriores a la fecha de corte
{
  const r1 = baseReceivable({
    id: 'rec-1',
    dayKey: '2026-08-10',
    originalAmount: 1000,
    paidAmount: 1000,
    balance: 0,
    status: 'PAID',
  })

  const c1 = baseCollection({
    id: 'col-1',
    dayKey: '2026-08-12',
    amount: 400,
    allocations: [{ receivableId: 'rec-1', amount: 400 }],
  })

  const c2 = baseCollection({
    id: 'col-2',
    dayKey: '2026-08-20',
    amount: 600,
    allocations: [{ receivableId: 'rec-1', amount: 600 }],
  })

  const result = computeAsOfReceivablesPortfolio({
    receivables: [r1],
    collections: [c1, c2],
    cutoffDayKey: '2026-08-15',
  })

  pass(result.length === 1, 'Mantiene crédito en fecha')
  pass(result[0].paidAmount === 400, 'Pagado As-Of es exactamente 400')
  pass(result[0].balance === 600, 'Saldo As-Of es exactamente 600')
  pass(result[0].status === 'PARTIAL', 'Estado As-Of es PARTIAL')
}

// 4. Al corte de origen, antes de cualquier cobro
{
  const r1 = baseReceivable({
    id: 'rec-1',
    dayKey: '2026-08-10',
    originalAmount: 1000,
    paidAmount: 1000,
    balance: 0,
    status: 'PAID',
  })

  const c1 = baseCollection({
    id: 'col-1',
    dayKey: '2026-08-12',
    amount: 400,
    allocations: [{ receivableId: 'rec-1', amount: 400 }],
  })

  const result = computeAsOfReceivablesPortfolio({
    receivables: [r1],
    collections: [c1],
    cutoffDayKey: '2026-08-10',
  })

  pass(result[0].paidAmount === 0, 'Pagado As-Of al origen es 0')
  pass(result[0].balance === 1000, 'Saldo As-Of al origen es 1000')
  pass(result[0].status === 'OPEN', 'Estado As-Of al origen es OPEN')
}

// 5. Al corte posterior a todos los cobros
{
  const r1 = baseReceivable({
    id: 'rec-1',
    dayKey: '2026-08-10',
    originalAmount: 1000,
  })

  const c1 = baseCollection({
    id: 'col-1',
    dayKey: '2026-08-12',
    amount: 400,
    allocations: [{ receivableId: 'rec-1', amount: 400 }],
  })

  const c2 = baseCollection({
    id: 'col-2',
    dayKey: '2026-08-20',
    amount: 600,
    allocations: [{ receivableId: 'rec-1', amount: 600 }],
  })

  const result = computeAsOfReceivablesPortfolio({
    receivables: [r1],
    collections: [c1, c2],
    cutoffDayKey: '2026-08-20',
  })

  pass(result[0].paidAmount === 1000, 'Pagado As-Of tras todos los cobros es 1000')
  pass(result[0].balance === 0, 'Saldo As-Of tras todos los cobros es 0')
  pass(result[0].status === 'PAID', 'Estado As-Of tras todos los cobros es PAID')
}

// 6. Integración con computeCreditPortfolioByRoute
{
  const r1 = baseReceivable({
    id: 'rec-1',
    customerId: 'cust-1',
    dayKey: '2026-08-10',
    routeId: 'route-1',
    originalAmount: 500,
  })

  const c1 = baseCollection({
    id: 'col-1',
    dayKey: '2026-08-12',
    amount: 200,
    allocations: [{ receivableId: 'rec-1', amount: 200 }],
  })

  const asOfReceivables = computeAsOfReceivablesPortfolio({
    receivables: [r1],
    collections: [c1],
    cutoffDayKey: '2026-08-15',
  })

  const routes: DistRoute[] = [
    { id: 'route-1', name: 'Ruta 1', kind: 'route', active: true, restaurantId: 'rest-1', createdAt: '2026-01-01' },
  ]

  const portfolio = computeCreditPortfolioByRoute({
    receivables: asOfReceivables,
    selectedRouteId: 'route-1',
    routes,
    customers: [{ id: 'cust-1', name: 'Tienda Doña Rosa', active: true, restaurantId: 'rest-1', createdAt: '2026-01-01', createdBy: 'admin' }],
  })

  pass(portfolio.totalOutstanding === 300, 'Saldo pendiente filtrado es 300')
  pass(portfolio.customerCredits.length === 1, 'Tiene 1 cliente en cartera')
  pass(portfolio.customerCredits[0].filteredBalance === 300, 'Saldo del cliente es 300')
}

console.log(`\nTODAS LAS PRUEBAS AS-OF PASARON (${passed} assertions)\n`)
