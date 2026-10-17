import { closureReopenEvents, closureReturnSummary } from '../closureAudit.ts'
import type { DistClosure } from '../../types.ts'

const closure = {
  id: 'reopened',
  restaurantId: 'sanjose', branchId: 'main', createdAt: '2026-10-16T18:00:00Z', createdBy: 'admin', dayKey: '2026-10-16', schemaVersion: 1,
  dispatchId: 'dispatch-1', routeId: 'route-1', routeName: 'Ruta Norte', distributorUid: 'ricardo', distributorName: 'Ricardo', status: 'closed' as const,
  products: [], cashSales: 0, qrSales: 0, creditGenerated: 0, cashCollections: 0, qrCollections: 0, cashExpenses: 0, expectedCash: 0, cashDifference: 0,
  closedAt: '2026-10-17T14:45:00Z',
  reopenHistory: [
    { reopenedAt: '2026-10-17T14:32:00Z', reason: 'Cobro faltante', warehouseClosedBy: 'wh', warehouseClosedAt: '2026-10-16T21:00:00Z', products: [], reopenedByName: 'Administración', previousClosedAt: '2026-10-16T21:15:00Z' },
    { reopenedAt: '2026-10-17T14:40:00Z', reason: 'Ajustar arqueo', warehouseClosedBy: 'wh', warehouseClosedAt: '2026-10-17T14:35:00Z', products: [], reopenedByName: 'Administración' },
  ],
} satisfies DistClosure

const events = closureReopenEvents(closure)
if (events.length !== 2 || events[0]?.reason !== 'Cobro faltante' || events[1]?.reason !== 'Ajustar arqueo') throw new Error('Cada reapertura debe conservarse en orden sin duplicar la última.')
if (events[0]?.previousClosedAt !== '2026-10-16T21:15:00Z' || events[0]?.previousWarehouseClosedAt !== '2026-10-16T21:00:00Z') throw new Error('Debe conservar por separado la fecha de cierre anterior y la recepción de almacén.')

const summary = closureReturnSummary({
  productId: 'viena', productName: 'Viena', unitType: 'kg', initialDispatch: 6, additions: 0, totalLoaded: 6, sold: 0, expectedReturn: 6,
  actualReturn: 2.92, returnMerma: 0.16, returnWaste: 0, variance: 0,
})
if (summary.totalApto !== 3.08 || summary.returnsToSellableStock !== 3.08 || summary.nonSellable !== 0) throw new Error('2.92 normal + 0.16 recuperable debe ser 3.08 aptos y vendibles.')
const overage = closureReturnSummary({
  productId: 'viena', productName: 'Viena', unitType: 'kg', initialDispatch: 6, additions: 0, totalLoaded: 6, sold: 0, expectedReturn: 6,
  actualReturn: 6, returnMerma: 0.2, returnWaste: 0, variance: 0.2,
})
if (overage.totalApto !== 6.2 || overage.returnsToSellableStock !== 6 || overage.quarantinedSellableOverage !== 0.2) throw new Error('El total apto distingue el excedente que queda en cuarentena.')

console.log('PASS auditoría ordena reaperturas y suma retorno normal + merma recuperable sin confundir producto no apto')
