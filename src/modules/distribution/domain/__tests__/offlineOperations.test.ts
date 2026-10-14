import { provisionalReceiptNotice, shouldReturnProvisional } from '../offlineOperationPolicy.ts'
import { pendingCollectionsFromOperations, pendingExpensesFromOperations, pendingSalesFromOperations, projectBalances, projectReceivables } from '../offlineProjections.ts'
import type { PendingOperation } from '../../data/operationQueue.ts'
import type { DistBalance, DistExpense, DistLot, DistReceivable, DistSale } from '../../types.ts'

let passed = 0
const check = (condition: boolean, label: string) => { if (!condition) throw new Error(label); passed += 1; console.log(`PASS: ${label}`) }

check(shouldReturnProvisional('queued', true, true), 'false-online: una escritura local queued devuelve el provisional sin esperar servidor')
check(shouldReturnProvisional(undefined, true, true), 'Firestore puede confirmar la escritura local antes de conocer el estado remoto')
check(!shouldReturnProvisional('confirmed', true, true), 'la confirmación definitiva prevalece sobre la escritura local')
check(!shouldReturnProvisional('rejected', true, true), 'una operación rechazada nunca se presenta como venta provisional exitosa')
check(!shouldReturnProvisional('queued', true, false), 'operaciones sin resultado provisional no se autorizan offline')
check(provisionalReceiptNotice(true).includes('PENDIENTE DE SINCRONIZACIÓN') && provisionalReceiptNotice(true, true).includes('PENDIENTE DE SINCRONIZACION'), 'los tickets compartido e impreso identifican que la venta es provisional')

const op = (id: string, type: string, status: PendingOperation['status'], payload: Record<string, unknown>): PendingOperation => ({ id, type, status, payload, createdBy: 'vendedor', createdAt: '2026-10-10T12:00:00.000Z' })
const sale = (id: string, quantity: number): DistSale => ({ id, operationId: id, lines: [{ productId: 'p1', quantity }], sourceLocation: 'route', routeId: 'hugo' } as unknown as DistSale)
const queuedSales = [op('s4', 'sale', 'queued', sale('s4', 4) as unknown as Record<string, unknown>), op('s6', 'sale', 'queued', sale('s6', 6) as unknown as Record<string, unknown>)]
const projectedSales = pendingSalesFromOperations(queuedSales, [])
check(projectedSales.length === 2 && projectedSales.every(s => s.pendingConfirmation), 'dos ventas queued se muestran localmente como pendientes')
check(pendingSalesFromOperations([op('s4', 'sale', 'queued', {})], [sale('s4', 4)]).length === 0, 'la misma venta confirmada no se duplica en la proyección')
check(pendingSalesFromOperations([op('sr', 'sale', 'rejected', {})], []).length === 0, 'una venta rechazada sale de la proyección para revertir stock fantasma')

const balances: DistBalance[] = [
  { id: 'route__hugo__p1', productId: 'p1', locationKind: 'route', routeId: 'hugo', quantity: 10, availableQuantity: 10 } as DistBalance,
  { id: 'route__otra__p1', productId: 'p1', locationKind: 'route', routeId: 'otra', quantity: 5, availableQuantity: 5 } as DistBalance,
  { id: 'central__p1', productId: 'p1', locationKind: 'central', quantity: 20, availableQuantity: 20 } as DistBalance,
]
const projectedBalances = projectBalances(balances, projectedSales, [] as DistLot[], '2026-10-10')
check(projectedBalances[0].quantity === 0 && projectedBalances[0].availableQuantity === 0, 'dos ventas offline de 4 + 6 dejan 0 kg disponibles en la ruta')
check(projectedBalances[1].quantity === 5 && projectedBalances[2].quantity === 20, 'la venta pendiente solo descuenta la ubicación origen')

const receivable = { id: 'r1', balance: 100, customerId: 'c1' } as DistReceivable
const collectionPayload = { receivable, amount: 60, method: 'cash', routeId: 'hugo', collectedByName: 'Vendedor' }
const pendingCollections = pendingCollectionsFromOperations([op('c60', 'collection', 'queued', collectionPayload), op('c40', 'collection', 'queued', { ...collectionPayload, amount: 40 })], [])
check(projectReceivables([receivable], pendingCollections)[0].balance === 0, 'cobros offline acumulados reducen cartera provisional hasta cero sin duplicar')
check(pendingCollectionsFromOperations([op('cr', 'collection', 'rejected', collectionPayload)], []).length === 0, 'cobro rechazado deja de descontar la cartera y revierte su proyección')

const queuedExpense = op('e1', 'expense', 'queued', { amount: 12, concept: 'prueba' })
check(pendingExpensesFromOperations([queuedExpense], [] as DistExpense[])[0].pendingConfirmation === true, 'gasto queued aparece como pendiente local')
check(pendingExpensesFromOperations([op('er', 'expense', 'rejected', { amount: 12 })], [] as DistExpense[]).length === 0, 'gasto rechazado desaparece de la proyección local')

console.log(`OK: ${passed} pruebas offline`)
