import assert from 'node:assert/strict'
import { createServer } from 'vite'

const vite = await createServer({
  configFile: 'vite.config.ts',
  mode: 'emulator',
  appType: 'custom',
  server: { middlewareMode: true },
})

try {
  const { reportSheets } = await vite.ssrLoadModule('/src/modules/distribution/data/reportExports.ts')
  const processing = (overrides = {}) => ({
    segmentId: 'segment-1', batchId: 'batch-1', destinationId: 'lot-1', sourceMovementId: 'move-1',
    quantity: 1, physicalWeightG: 250, costCents: 125, weightBasis: 'documented_average',
    allocationMethod: 'documented_average', physicalOriginConfirmed: false, sourceLocation: 'route', ...overrides,
  })
  const claim = {
    id: 'exchange-export', kind: 'exchange', saleId: 'old-sale-outside-period', sellerUid: 'seller-1', sellerName: 'Vendedor QA',
    customerId: 'customer-1', customerName: 'Cliente QA', productId: 'old-derived', productName: 'Sachet original', quantity: 1,
    unitType: 'package', reason: 'cambio', routeId: 'route-1', createdAt: '2026-10-29T12:00:00.000Z', dayKey: '2026-10-29',
    revenueDelta: 0, additionalCost: 0, debtReduction: 0, cashIn: 0, cashOut: 0, qrIn: 0, qrOut: 0,
    returnedProcessingAllocations: [{ lotId: 'old-lot', quantity: 1, allocations: [{ lotId: 'old-lot', lotCode: 'OLD', expiresOn: '2027-01-01', quantity: 1, productionCost: 1.25, processingAllocation: processing() }] }],
    replacement: { productId: 'replacement-derived', productName: 'Sachet reemplazo', quantity: 1, unitType: 'package', total: 5,
      documentedPackageWeightKgSnapshot: 0.25, allocations: [{ lotId: 'new-lot', lotCode: 'NEW', expiresOn: '2027-01-01', quantity: 1, productionCost: 1.67,
        processingAllocation: processing({ segmentId: 'replacement-segment', batchId: 'replacement-batch', quantity: 1, physicalWeightG: 333, costCents: 167 }) }] },
  }
  const data = {
    closures: [], customers: [], sales: [], receivables: [], collections: [], receivableAdjustments: [], expenses: [], claims: [claim],
    products: [
      { id: 'old-derived', unitType: 'package', approximateWeightKg: 0.1 },
      { id: 'replacement-derived', unitType: 'package', approximateWeightKg: 0.25, documentedPackageWeightKg: 0.25 },
    ],
    movements: [], warehouses: [], transfers: [], routes: [], lots: [], balances: [], supportSettings: {},
  }
  const row = reportSheets(data, ['2026-10-29']).find(sheet => sheet.id === 'sellerSummary')?.rows[0]
  assert.ok(row, 'PDF/Excel export has a seller summary row for a return claim from an earlier sale')
  assert.equal(row[2], 0, 'granel remains unchanged')
  assert.equal(row[3], 0.083, 'the export uses 333 g historical replacement minus 250 g returned')
  assert.equal(row[4], 0, 'catalog approximate weight does not replace historical grams')
  console.log('PASS export Kg por vendedor: 333 g replacement allocation, 250 g returned, net 0.083 kg; no catalog estimate substituted')
} finally {
  await vite.close()
}
