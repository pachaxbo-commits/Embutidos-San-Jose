import { previewDispatchMermaSettlement } from '../dispatchMermaSettlement.ts'
import type { DistDispatch, DistSale } from '../../types.ts'

const dispatch = (normal: number, merma: number): DistDispatch => ({
  id: 'dispatch-1', restaurantId: 'sanjose', branchId: 'main', createdAt: '2026-10-22T12:00:00.000Z', createdBy: 'warehouse', dayKey: '2026-10-22', schemaVersion: 1,
  warehouseId: 'central', routeId: 'route-1', routeName: 'Zona Norte', distributorUid: 'seller', distributorName: 'Hugo', status: 'open',
  lines: [{ productId: 'p', productName: 'Viena', unitType: 'kg', quantity: normal + merma, normalQuantity: normal, dispatchMerma: merma, allocations: [] }], additions: [],
})
const sale = (id: string, quantity: number, patch: Partial<DistSale> = {}): DistSale => ({
  id, restaurantId: 'sanjose', branchId: 'main', createdAt: '2026-10-22T13:00:00.000Z', createdBy: 'seller', dayKey: '2026-10-22', schemaVersion: 1,
  operationId: id, sourceLocation: 'route', dispatchId: 'dispatch-1', routeId: 'route-1', routeName: 'Zona Norte', sellerUid: 'seller', sellerName: 'Hugo',
  lines: [{ productId: 'p', productNameSnapshot: 'Viena', unitType: 'kg', quantity, actualUnitPrice: 10, subtotal: quantity * 10, allocations: [] }],
  total: quantity * 10, paymentKind: 'cash', cashAmount: quantity * 10, qrAmount: 0, creditAmount: 0, ...patch,
})
const assertEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) throw new Error(`${label}: esperado ${expected}, recibido ${actual}`)
}

const example = previewDispatchMermaSettlement(dispatch(88, 2.1), [sale('sale', 84)], 'p', 4, 0.08, 0)
assertEqual(example.eligible, true, 'Ejemplo autorizado puede conciliarse')
assertEqual(example.includedInSales, 2.02, '88 + 2.10 / venta nominal 84 / retorno adicional .08')
assertEqual(example.expectedPhysicalReturn, 4.08, 'Retorno físico esperado no duplica la merma')

const fullyReturned = previewDispatchMermaSettlement(dispatch(10, 0.2), [], 'p', 10, 0.2, 0)
assertEqual(fullyReturned.eligible, true, 'Sin ventas se acepta cuando toda la merma fue recuperada')
assertEqual(fullyReturned.fullyReturned, true, 'Retorno completo se identifica por separado')
assertEqual(fullyReturned.includedInSales, 0, 'Retorno completo no se atribuye a ventas')

const noSalesPartial = previewDispatchMermaSettlement(dispatch(10, 0.2), [], 'p', 10, 0, 0)
assertEqual(noSalesPartial.eligible, false, 'Sin ventas, merma faltante queda pendiente')
assertEqual(noSalesPartial.expectedPhysicalReturn, 10.2, 'Sin conciliación no se reduce el retorno esperado')

const correctedSales = previewDispatchMermaSettlement(dispatch(88, 2.1), [
  sale('corrected', 83, { effectiveSnapshot: { lines: [{ productId: 'p', productNameSnapshot: 'Viena', unitType: 'kg', quantity: 84, actualUnitPrice: 10, subtotal: 840, allocations: [] }], total: 840, paymentKind: 'cash', cashAmount: 840, qrAmount: 0, creditAmount: 0, saleKind: 'sale' } }),
  sale('voided', 100, { voidedAt: '2026-10-22T14:00:00.000Z' }),
  sale('pending', 100, { pendingConfirmation: true }),
], 'p', 4, 0.08, 0)
assertEqual(correctedSales.includedInSales, 2.02, 'Usa corrección vigente y excluye anulada/pendiente')

const unfit = previewDispatchMermaSettlement(dispatch(88, 2.1), [sale('sale', 84)], 'p', 4, 0.08, 0.1)
assertEqual(unfit.eligible, true, 'No apto explícito se descuenta antes de conciliar el remanente')
assertEqual(unfit.includedInSales, 1.92, 'No apto no se atribuye a venta')
assertEqual(unfit.expectedPhysicalReturn, 4.18, 'Retorno esperado incluye el no apto físicamente recibido')

const tooMuchUnfit = previewDispatchMermaSettlement(dispatch(88, 2.1), [sale('sale', 84)], 'p', 4, 0.08, 2.1)
assertEqual(tooMuchUnfit.eligible, false, 'No apto superior al saldo adicional no se concilia automáticamente')

const mismatch = previewDispatchMermaSettlement(dispatch(88, 2.1), [sale('sale', 84)], 'p', 4.01, 0.08, 0)
assertEqual(mismatch.eligible, false, 'Retorno normal distinto deja la diferencia pendiente')

console.log('PASS dispatchMermaSettlement.test.ts')
