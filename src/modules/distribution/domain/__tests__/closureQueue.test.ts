import { buildClosureQueue, closureQueueCounts, filterClosureQueue, filterClosureQueueForRole } from '../closureQueue.ts'
import type { DistClosure, DistDispatch } from '../../types.ts'

const dispatch = (id: string, warehouseId = 'central', createdAt = '2026-10-22T10:00:00-04:00'): DistDispatch => ({
  id, restaurantId: 'sanjose', branchId: 'main', createdAt, createdBy: 'warehouse', dayKey: '2026-10-22', schemaVersion: 1,
  warehouseId, routeId: `route-${id}`, routeName: `Ruta ${id}`, distributorUid: `user-${id}`, distributorName: `Distribuidor ${id}`,
  status: 'open', lines: [], additions: [],
})

const closure = (dispatchId: string, overrides: Partial<DistClosure> = {}): DistClosure => ({
  id: `closure-${dispatchId}`, restaurantId: 'sanjose', branchId: 'main', createdAt: '2026-10-22T10:00:00-04:00', createdBy: 'admin',
  dayKey: '2026-10-22', schemaVersion: 1, dispatchId, routeId: `route-${dispatchId}`, routeName: `Ruta ${dispatchId}`,
  distributorUid: `user-${dispatchId}`, distributorName: `Distribuidor ${dispatchId}`, status: 'draft', products: [],
  cashSales: 0, qrSales: 0, creditGenerated: 0, cashCollections: 0, qrCollections: 0, cashExpenses: 0, expectedCash: 0, cashDifference: 0,
  ...overrides,
})

// Tres rutas declaran con segundos de diferencia: solo la declarada espera a Almacén.
const dispatches = [dispatch('ricardo'), dispatch('luciano'), dispatch('hugo')]
const declarations = [closure('ricardo', { returnDeclaredAt: '2026-10-22T10:00:03-04:00' })]
const initialQueue = buildClosureQueue(dispatches, declarations, {}, '2026-10-22')
if (initialQueue.map(item => item.dispatch?.id).join(',') !== 'ricardo,luciano,hugo') {
  throw new Error('La ruta declarada debe ir primero; rutas simultáneas sin declarar permanecen visibles después.')
}
if (initialQueue[0].stage !== 'awaiting_warehouse' || initialQueue[1].stage !== 'undeclared' || initialQueue[2].stage !== 'undeclared') {
  throw new Error('Declarada y sin declarar deben ser estados principales distintos.')
}
if (filterClosureQueue(initialQueue, 'awaiting_warehouse').length !== 1 || filterClosureQueue(initialQueue, 'undeclared').length !== 2) {
  throw new Error('Los filtros deben seguir los hitos persistidos del cierre.')
}

// El trabajo local no sustituye ni altera el estado compartido esperado por Almacén.
const reviewedQueue = buildClosureQueue(dispatches, declarations, { ricardo: ['p1'] }, '2026-10-22')
const ricardo = reviewedQueue[0]
if (ricardo.stage !== 'awaiting_warehouse' || !ricardo.reviewStartedHere || ricardo.reviewedProductCount !== 1) {
  throw new Error('La revisión local debe ser una señal aditiva, no un estado persistido.')
}
if (filterClosureQueue(reviewedQueue, 'reviewing_here').length !== 1) throw new Error('El filtro local debe mostrar solamente trabajo iniciado aquí.')
const afterReload = buildClosureQueue(dispatches, declarations, {}, '2026-10-22')
if (afterReload[0].stage !== 'awaiting_warehouse' || afterReload[0].reviewStartedHere) {
  throw new Error('Al recargar, la declaración persiste y la señal local de revisión desaparece.')
}

const confirmed = closure('confirmed', {
  status: 'warehouse_done', warehouseClosedBy: 'warehouse-1', warehouseClosedAt: '2026-10-22T11:00:00-04:00',
  physicalCashDeclared: 100, cashDifference: -2,
  products: [{ productId: 'p1', productName: 'Producto', unitType: 'kg', initialDispatch: 2, additions: 0, totalLoaded: 2,
    sold: 0, expectedReturn: 2, actualReturn: 2, variance: 0, shortage: 0, overage: 0, returnMerma: 0.08 }],
})
const closedToday = closure('closed-today', {
  status: 'closed', warehouseClosedBy: 'warehouse-1', warehouseClosedAt: '2026-10-22T08:00:00-04:00', closedAt: '2026-10-22T12:00:00-04:00',
})
const closedYesterday = closure('closed-yesterday', {
  status: 'closed', closedAt: '2026-10-21T23:30:00-04:00',
})
const completeQueue = buildClosureQueue(
  [...dispatches, dispatch('confirmed'), dispatch('closed-today')],
  [...declarations, confirmed, closedToday, closedYesterday],
  {},
  '2026-10-22',
)
const confirmedItem = completeQueue.find(item => item.closure?.dispatchId === 'confirmed')!
if (confirmedItem.stage !== 'warehouse_confirmed' || !confirmedItem.hasCashDifference || !confirmedItem.hasMerma) {
  throw new Error('Recepción confirmada conserva estado principal y señales de caja/merma adicionales.')
}
if (filterClosureQueue(completeQueue, 'differences').length !== 1) throw new Error('Diferencias es un filtro complementario sin ocultar etapa.')
if (!completeQueue.some(item => item.stage === 'closed' && item.closure?.dispatchId === 'closed-today')) throw new Error('El cierre finalizado hoy permanece visible aunque ya no tenga despacho abierto.')
if (completeQueue.some(item => item.closure?.dispatchId === 'closed-yesterday')) throw new Error('La cola operativa no debe cargar cierres finalizados de otros días.')
const counts = closureQueueCounts(completeQueue)
if (counts.awaitingWarehouse !== 1 || counts.undeclared !== 2 || counts.warehouseConfirmed !== 1 || counts.closed !== 1 || counts.differences !== 1) {
  throw new Error('Los contadores deben derivarse de las mismas etapas visibles y señales adicionales.')
}

// Compatibilidad: documentos antiguos sin returnDeclaredAt se guían por estado real o quedan sin declarar.
const oldDraft = closure('old-draft', { status: 'draft' })
const oldConfirmed = closure('old-confirmed', { status: 'warehouse_done', warehouseClosedBy: 'warehouse-1' })
const oldQueue = buildClosureQueue([dispatch('old-draft'), dispatch('old-confirmed')], [oldDraft, oldConfirmed], {}, '2026-10-22')
if (oldQueue.find(item => item.closure?.dispatchId === 'old-draft')?.stage !== 'undeclared' || oldQueue.find(item => item.closure?.dispatchId === 'old-confirmed')?.stage !== 'warehouse_confirmed') {
  throw new Error('Documentos históricos sin fecha de declaración deben usar defaults seguros según sus hitos disponibles.')
}

const otherWarehouse = filterClosureQueueForRole(buildClosureQueue([dispatch('central-route'), dispatch('north-route', 'north')], [], {}, '2026-10-22'), 'warehouse', 'north')
if (otherWarehouse.length !== 1 || otherWarehouse[0].dispatch?.id !== 'north-route') throw new Error('Almacén solo ve rutas de su almacén asignado.')
if (filterClosureQueueForRole(completeQueue, 'distributor').length !== 0) throw new Error('Distribuidor no debe ver la cola administrativa compartida.')
if (filterClosureQueueForRole(completeQueue, 'admin').length !== completeQueue.length) throw new Error('Administración conserva el alcance completo de cierres permitido.')

console.log('PASS cola de cierres: etapas persistidas, señales locales, alcance, prioridad, filtros y conteos')
