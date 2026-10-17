import { computeDistributorDifferences } from '../distributorDifferences.ts'
import type { DistClosure, DistStockMovement } from '../../types.ts'

const makeClosure = (id: string, product: DistClosure['products'][number], status: DistClosure['status'] = 'closed'): DistClosure => ({
  id,
  restaurantId: 'sanjose',
  branchId: 'main',
  createdAt: '2026-10-16T18:00:00.000Z',
  createdBy: 'admin',
  dayKey: '2026-10-16',
  schemaVersion: 1,
  dispatchId: `dispatch-${id}`,
  routeId: 'route-ricardo',
  routeName: 'Zona Norte',
  distributorUid: 'ricardo',
  distributorName: 'Ricardo',
  status,
  products: [product],
  cashSales: 0,
  qrSales: 0,
  creditGenerated: 0,
  cashCollections: 0,
  qrCollections: 0,
  cashExpenses: 0,
  expectedCash: 0,
  cashDifference: 0,
})

const makeRow = (shortage: number, overage = 0, shortageMovementId?: string) => ({
  productId: 'viena',
  productName: 'Viena granel',
  unitType: 'kg' as const,
  initialDispatch: 2,
  additions: 0,
  totalLoaded: 2,
  sold: 0,
  expectedReturn: 2,
  actualReturn: 2 - shortage + overage,
  physicalReturn: 2 - shortage + overage,
  shortage,
  overage,
  variance: overage - shortage,
  ...(shortageMovementId ? { shortageMovementId } : {}),
})

const movement = (id: string, dispatchId: string, quantity: number, lossCost: number | null, reversedAt?: string): DistStockMovement & { dispatchId: string } => ({
  id,
  restaurantId: 'sanjose',
  branchId: 'main',
  createdAt: '2026-10-16T18:01:00.000Z',
  createdBy: 'warehouse',
  dayKey: '2026-10-16',
  schemaVersion: 1,
  type: 'shortage',
  productId: 'viena',
  productName: 'Viena granel',
  unitType: 'kg',
  quantity,
  centralDelta: 0,
  routeDelta: -quantity,
  routeId: 'route-ricardo',
  fromLocation: 'route__route-ricardo',
  toLocation: '',
  refType: 'operation',
  refId: `operation-${id}`,
  dispatchId,
  lossCost,
  ...(reversedAt ? { reversedAt } : {}),
})

const rows = [makeClosure('day-1', makeRow(0.235)), makeClosure('day-2', makeRow(0.1)), makeClosure('day-3', makeRow(0, 0.05))]
const activeShortages = [movement('loss-1', 'dispatch-day-1', 0.235, 10), movement('loss-2', 'dispatch-day-2', 0.1, 5)]
const report = computeDistributorDifferences(rows, activeShortages, ['2026-10-16'], '', 'ricardo')
if (report.shortages.kg !== 0.335) throw new Error(`Esperaba faltante 0.335, obtuvo ${report.shortages.kg}`)
if (report.overages.kg !== 0.05) throw new Error(`Esperaba sobrante 0.05, obtuvo ${report.overages.kg}`)
if (report.knownShortageValue !== 15 || report.missingShortageCostCount !== 0) throw new Error('Debe sumar únicamente los costos históricos activos (Bs 15).')

const reversedOnly = computeDistributorDifferences(
  [makeClosure('reopened-final', makeRow(0.1, 0, 'old-loss'))],
  [movement('old-loss', 'dispatch-reopened-final', 0.1, 50, '2026-10-17T10:00:00.000Z')],
  ['2026-10-16'],
)
if (reversedOnly.knownShortageValue !== 0 || reversedOnly.missingShortageCostCount !== 1) throw new Error('Un costo revertido no debe valorizar el faltante vigente.')

const missing = computeDistributorDifferences([makeClosure('unknown-cost', makeRow(0.2, 0, 'missing-cost'))], [], ['2026-10-16'])
if (missing.rows[0]?.shortage !== 0.2 || missing.rows[0]?.shortageValue !== null || missing.missingShortageCostCount !== 1) throw new Error('Debe mostrar cantidad, pero marcar valor histórico incompleto si falta el costo.')

const excluded = computeDistributorDifferences([makeClosure('still-reopened', makeRow(1), 'reopened')], [], ['2026-10-16'])
if (excluded.rows.length !== 0) throw new Error('No se deben contar cierres actualmente reabiertos.')

console.log('PASS diferencias agregan faltantes por unidad, costos históricos activos y sobrantes separados')
console.log('PASS reapertura excluye movimiento revertido y evita doble conteo')
console.log('PASS faltante sin costo histórico se marca incompleto sin inventar valor')
