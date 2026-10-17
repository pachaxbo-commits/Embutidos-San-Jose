import { closureHistoryOwnerKey, filterClosureHistory, visibleClosureHistory } from '../closureHistory.ts'
import type { DistClosure } from '../../types.ts'

const makeClosure = (overrides: Partial<DistClosure>): DistClosure => ({
  id: 'closure', restaurantId: 'sanjose', branchId: 'main', createdAt: '2026-10-17T12:00:00-04:00', createdBy: 'admin',
  dayKey: '2026-10-16', schemaVersion: 1, dispatchId: 'dispatch', routeId: 'south', routeName: 'Zona Sud',
  distributorUid: 'ricardo', distributorName: 'Ricardo Jimenes', status: 'closed', products: [], cashSales: 0, qrSales: 0,
  creditGenerated: 0, cashCollections: 0, qrCollections: 0, cashExpenses: 0, expectedCash: 0, cashDifference: 0,
  ...overrides,
})

const oldJourneyReclosedNextDay = makeClosure({ closedAt: '2026-10-17T08:10:00-04:00', reopenedAt: '2026-10-17T07:50:00-04:00' })
const otherDistributor = makeClosure({ id: 'other', routeId: 'north', routeName: 'Zona Norte', distributorUid: 'hugo', distributorName: 'Hugo' })
const filtered = filterClosureHistory([oldJourneyReclosedNextDay, otherDistributor], ['2026-10-16'])
if (filtered.length !== 2 || filtered[0]?.id !== 'closure') throw new Error('El filtro debe usar dayKey, no la fecha de reapertura/cierre posterior.')
const ricardoOnly = filterClosureHistory([oldJourneyReclosedNextDay, otherDistributor], ['2026-10-16'], closureHistoryOwnerKey(oldJourneyReclosedNextDay))
if (ricardoOnly.length !== 1 || ricardoOnly[0]?.distributorUid !== 'ricardo') throw new Error('El filtro ruta/distribuidor debe limitar al responsable elegido.')
const legacy = makeClosure({ id: 'legacy', dayKey: '', createdAt: '2026-10-15T12:00:00-04:00' })
if (filterClosureHistory([legacy], ['2026-10-15']).length !== 1) throw new Error('Los documentos antiguos sin dayKey usan un respaldo temporal seguro.')
if (visibleClosureHistory(Array.from({ length: 27 }, (_, index) => index), 20).length !== 20) throw new Error('La lista inicial debe estar acotada a 20 registros.')

console.log('PASS historial de cierres filtra por jornada, responsable y limita los resultados visibles')
