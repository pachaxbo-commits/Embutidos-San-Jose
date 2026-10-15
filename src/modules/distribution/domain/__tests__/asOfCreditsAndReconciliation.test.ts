import {
  allocateCreditBySubtotal,
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

const proportional = allocateCreditBySubtotal([{ subtotal: 70 }, { subtotal: 30 }], 55)
pass(proportional[0] === 38.5 && proportional[1] === 16.5 && Math.round((proportional[0] + proportional[1]) * 100) / 100 === 55,
  'distribuye deuda según subtotal y conserva exactamente los centavos')
const pennySplit = allocateCreditBySubtotal([{ subtotal: 1 }, { subtotal: 1 }, { subtotal: 1 }], 1)
pass(Math.round(pennySplit.reduce((sum, amount) => sum + amount, 0) * 100) / 100 === 1, 'reparte residuos de centavos de forma determinista sin diferencia')

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

// 7. Ajustes y anulaciones son eventos históricos: no reescriben cortes anteriores.
{
  const original = baseReceivable({ id: 'rec-adjusted', originalAmount: 200, paidAmount: 0, balance: 200, status: 'OPEN', dayKey: '2026-08-10' })
  const snapshot = (originalAmount: number, balance: number, status: 'OPEN' | 'VOID') => ({
    originalAmount, paidAmount: 0, balance, status, sourceDate: original.sourceDate || '', note: original.note || '',
    saleLines: [], adjustedSaleLines: [], voided: status === 'VOID', voidedAt: status === 'VOID' ? '2026-08-20T10:00:00.000Z' : '',
    voidReason: status === 'VOID' ? 'Registro duplicado' : '',
  })
  const adjustments = [
    { id: 'adj-1', receivableId: original.id, effectiveAt: '2026-08-18T10:00:00.000Z', effectiveDayKey: '2026-08-18', previous: snapshot(200, 200, 'OPEN'), next: snapshot(150, 150, 'OPEN') },
    { id: 'adj-2', receivableId: original.id, effectiveAt: '2026-08-20T10:00:00.000Z', effectiveDayKey: '2026-08-20', previous: snapshot(150, 150, 'OPEN'), next: snapshot(150, 0, 'VOID') },
  ] as unknown as import('../../types.ts').DistReceivableAdjustment[]
  const before = computeAsOfReceivablesPortfolio({ receivables: [original], collections: [], adjustments, cutoffDayKey: '2026-08-15' })
  const afterEdit = computeAsOfReceivablesPortfolio({ receivables: [original], collections: [], adjustments, cutoffDayKey: '2026-08-19' })
  const afterVoid = computeAsOfReceivablesPortfolio({ receivables: [original], collections: [], adjustments, cutoffDayKey: '2026-08-21' })
  pass(before[0].originalAmount === 200 && before[0].balance === 200, 'corte anterior conserva monto original antes de la edición')
  pass(afterEdit[0].originalAmount === 150 && afterEdit[0].balance === 150, 'corte posterior a la edición refleja deuda corregida')
  pass(afterVoid[0].status === 'VOID' && afterVoid[0].balance === 0, 'corte posterior a la anulación excluye deuda activa')
  const voidPortfolio = computeCreditPortfolioByRoute({ receivables: afterVoid, selectedRouteId: 'all', routes: [], customers: [] })
  pass(voidPortfolio.totalOutstanding === 0 && voidPortfolio.customerCredits[0]?.allReceivables[0]?.status === 'VOID', 'deuda anulada no suma a cartera y permanece accesible en historial')
}

console.log(`\nTODAS LAS PRUEBAS AS-OF PASARON (${passed} assertions)\n`)
