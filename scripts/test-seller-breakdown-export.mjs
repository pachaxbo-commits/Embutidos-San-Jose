import assert from 'node:assert/strict'
import { createServer } from 'vite'

const vite = await createServer({
  configFile: 'vite.config.ts',
  mode: 'emulator',
  appType: 'custom',
  server: { middlewareMode: true },
})

try {
  const { reportSheets, sellerKilogramReportError } = await vite.ssrLoadModule('/src/modules/distribution/data/reportExports.ts')
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
    movements: [], warehouses: [], transfers: [], routes: [], lots: [], balances: [], supportSettings: {}, operations: [],
  }
  const sheet = reportSheets(data, ['2026-10-29']).find(sheet => sheet.id === 'sellerSummary')
  assert.ok(sheet, 'PDF/Excel export contains sellerSummary sheet')
  assert.equal(sheet.headers[0], 'Fecha', 'first column is Fecha')
  assert.equal(sheet.headers[1], 'Chofer', 'second column is Chofer')
  const row = sheet.rows[0]
  assert.ok(row, 'PDF/Excel export has a seller summary row for a return claim from an earlier sale')
  assert.equal(row[0], '29/10/2026', 'row date matches Bolivia date format DD/MM/YYYY')
  assert.equal(row[1], 'Vendedor QA', 'row has seller name')
  assert.equal(row[2], 'Sin ruta', 'claim without routeName defaults to Sin ruta')
  assert.equal(row[3], 0, 'granel remains unchanged')
  assert.equal(row[4], 0.083, 'the export uses 333 g historical replacement minus 250 g returned')
  assert.equal(row[6], 0, 'catalog approximate weight does not replace historical grams')
  console.log('PASS export Kg por vendedor: 333 g replacement allocation, 250 g returned, net 0.083 kg; no catalog estimate substituted')
  assert.equal(sellerKilogramReportError(data, ['2026-10-29']), null, 'complete data can be reported')
  assert.match(sellerKilogramReportError({ ...data, operations: [{ status: 'queued' }] }, ['2026-10-29']), /operaciones pendientes/i)
  assert.match(sellerKilogramReportError({ ...data, sales: [{ id: 'pending', routeId: 'route-1', sellerUid: 'seller-1', createdAt: '2026-10-29T12:00:00.000Z', dayKey: '2026-10-29', pendingConfirmation: true }] }, ['2026-10-29']), /ventas pendientes/i)
  assert.match(sellerKilogramReportError({ ...data, claims: [{ ...claim, sellerUid: undefined, saleId: 'missing-sale', productId: 'missing-product' }] }, ['2026-10-29']), /devolución histórica sin chofer/i)
  console.log('PASS el reporte de kilos bloquea operaciones sin sincronizar, ventas pendientes y devoluciones sin atribución')

  const voidedCashSale = {
    id: 'voided-cash-sale', operationId: 'voided-cash-sale', restaurantId: 'sanjose', branchId: 'main',
    createdAt: '2026-10-29T10:00:00.000Z', createdBy: 'admin', dayKey: '2026-10-29', schemaVersion: 2,
    saleKind: 'sale', sourceLocation: 'centralWarehouse', routeId: 'administracion', routeName: 'Administración',
    sellerUid: 'admin', sellerName: 'Administración', lines: [], total: 0, paymentKind: 'cash', cashAmount: 0, qrAmount: 0, creditAmount: 0,
    voidedAt: '2026-10-29T11:00:00.000Z',
    derivedVoid: { cashReceiptSnapshot: { cashAmount: 10, qrAmount: 0, saleDayKey: '2026-10-29', saleCreatedAt: '2026-10-29T10:00:00.000Z' } },
  }
  const voidedCashClaim = {
    id: 'voided-cash-claim', kind: 'return', isDerivedSaleVoid: true, saleId: voidedCashSale.id,
    sellerUid: 'admin', sellerName: 'Administración', createdBy: 'admin', cashMovementResponsibleUid: 'admin',
    cashMovementRouteId: 'administracion', routeId: 'administracion', customerId: 'customer-void', customerName: 'Cliente',
    productId: 'p1', productName: 'Producto', quantity: 0, unitType: 'package', reason: 'anulación',
    createdAt: '2026-10-29T11:00:00.000Z', dayKey: '2026-10-29', revenueDelta: 0, additionalCost: 0, debtReduction: 0,
    cashIn: 0, cashOut: 10, qrIn: 0, qrOut: 0, replacement: null, cashRefundStatus: 'executed',
  }
  const cashData = { ...data, sales: [voidedCashSale], claims: [voidedCashClaim], routes: [] }
  const cashSheet = reportSheets(cashData, ['2026-10-29'], 'administracion').find(sheet => sheet.id === 'cashFlow')
  assert.ok(cashSheet, 'PDF/Excel export contains the cash flow ledger')
  const originalReceiptRow = cashSheet.rows.find(row => row[0] === 'Cobros originales de ventas anuladas')
  const refundRow = cashSheet.rows.find(row => row[0] === 'Cambios y devoluciones')
  const netFlowRow = cashSheet.rows.find(row => row[0] === 'FLUJO NETO')
  assert.equal(originalReceiptRow?.[1], 10, 'PDF/Excel keeps the original cash receipt separate from net sales')
  assert.equal(refundRow?.[1], -10, 'PDF/Excel records executed refund in the actual movement line')
  assert.equal(netFlowRow?.[3], 0, 'PDF/Excel same-day net flow is zero, not a fictitious shortage')
  console.log('PASS PDF/Excel cash-flow export: voided original receipt +10, refund -10, net 0')
} finally {
  await vite.close()
}
