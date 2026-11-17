import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '/src/index.css'
import { LotTraceabilityModal } from '/src/modules/distribution/views/LotTraceabilityModal'
import { SupplierPayablesView } from '/src/modules/distribution/views/SupplierPayablesView'
import { ClosureView } from '/src/modules/distribution/views/ClosureView'

const today = '2026-11-17'
const adminUid = 'qa-admin'
const route = { id: 'route-sud', name: 'Zona Sud', active: true, kind: 'route', restaurantId: 'sanjose', createdAt: '' }
const lots = [
  { id: 'lot-A', productId: 'mortadela', productName: 'Sachet Mortadela PRIMAVERA', lotCode: '101126', unitType: 'unit', quantities: { central: 9 } },
  { id: 'lot-B', productId: 'jamon', productName: 'Jamón de cerdo PORCIONADO', lotCode: '101126', unitType: 'unit', quantities: { central: 0 } },
]
const suppliers = [
  { id: 'supplier-A', name: 'LA CABAÑITA', active: true },
  { id: 'supplier-B', name: 'OTRO PROVEEDOR', active: true },
  { id: 'supplier-old', name: 'Proveedor Inactivo Histórico', active: false },
]
const payables = [
  { id: 'A-pending', supplierId: 'supplier-A', supplierName: 'LA CABAÑITA', description: 'Pendiente A', status: 'pending', totalAmount: 100, paidAmount: 0, balance: 100, dayKey: today, groupName: 'Producción', categoryName: 'Materia prima' },
  { id: 'A-paid', supplierId: 'supplier-A', supplierName: 'LA CABAÑITA', description: 'Pagada A', status: 'paid', totalAmount: 50, paidAmount: 50, balance: 0, dayKey: today, groupName: 'Producción', categoryName: 'Materia prima' },
  { id: 'B-pending', supplierId: 'supplier-B', supplierName: 'OTRO PROVEEDOR', description: 'Pendiente B', status: 'pending', totalAmount: 200, paidAmount: 0, balance: 200, dayKey: today, groupName: 'Producción', categoryName: 'Materia prima' },
  { id: 'legacy', supplierName: 'Proveedor Histórico', description: 'Legacy', status: 'pending', totalAmount: 25, paidAmount: 0, balance: 25, dayKey: today, groupName: 'Producción', categoryName: 'Materia prima' },
  { id: 'inactive', supplierId: 'supplier-old', supplierName: 'Proveedor Inactivo Histórico', description: 'Inactivo', status: 'pending', totalAmount: 30, paidAmount: 0, balance: 30, dayKey: today, groupName: 'Producción', categoryName: 'Materia prima' },
]
const payments = payables.map(row => ({ id: `payment-${row.id}`, payableId: row.id, dayKey: today, responsibleName: `Pago ${row.id}`, paymentMethod: 'cash', amount: row.paidAmount, voided: false }))
const original = {
  id: 'closure-qa-ricardo', restaurantId: 'sanjose', branchId: 'main', dispatchId: 'dispatch-qa-ricardo', routeId: route.id, routeName: route.name,
  distributorUid: 'qa-ricardo', distributorName: 'Ricardo', warehouseId: 'central', status: 'closed', dayKey: today,
  createdAt: `${today}T18:03:50.292Z`, closedAt: `${today}T18:11:09.386Z`, warehouseClosedBy: 'qa-warehouse', warehouseClosedAt: `${today}T18:00:00.000Z`,
  products: [{ productId: 'tocino', productName: 'Sachet Tocino ahumado', unitType: 'package', initialDispatch: 15, additions: 0, totalLoaded: 15, sold: 14, courtesy: 0, expectedReturn: 1, actualReturn: 1, physicalReturn: 1, returnMerma: 0, returnWaste: 0, shortage: 0, overage: 0, variance: 0 }],
  cashSales: 2626, qrSales: 585, creditGenerated: 0, cashCollections: 694, qrCollections: 0, cashExpenses: 210, claimCash: 0,
  expectedCash: 3110, physicalCashDeclared: 2936, cashDifference: -174,
}
const corrected = { ...original, cashCollections: 520, expectedCash: 2936, cashDifference: 0 }
const audit = {
  id: 'closure-qa-ricardo__rectification_v1', version: 1, closureId: original.id, dispatchId: original.dispatchId, routeId: route.id,
  distributorUid: 'qa-ricardo', dayKey: today, createdAt: `${today}T18:30:00.000Z`, createdBy: adminUid, createdByName: 'Administración QA',
  reason: 'Separar cobros de Administración recibidos físicamente en su propia caja.', operationId: 'qa-operation', original, corrected,
  changes: [{ field: 'cashCollections', before: 694, after: 520, sourceDocumentIds: ['distCollections/admin-174'] }, { field: 'expectedCash', before: 3110, after: 2936, sourceDocumentIds: ['distCollections/admin-174'] }, { field: 'cashDifference', before: -174, after: 0, sourceDocumentIds: ['distCollections/admin-174'] }],
  sourceDocumentIds: ['distCollections/admin-174'], includedSaleIds: [], excludedSaleIds: [], includedCollectionIds: ['route-520'], excludedCollectionIds: ['admin-174'],
}
const closure = { ...original, rectificationId: audit.id, rectification: audit }
const data = {
  openDispatches: [], closures: [closure], sales: [], collections: [], expenses: [], claims: [], balances: [], lots: [], products: [],
  routes: [route], warehouses: [], transfers: [], operations: [], receivables: [], receivableAdjustments: [], customers: [], movements: [], qrVerifications: [], creditStatus: [],
  supportSettings: { requireQrVerification: false }, expenseGroups: [], expenseCategories: [],
}
const session = { restaurantId: 'sanjose', restaurantName: 'Embutidos San José', uid: adminUid, userName: 'Administración QA', role: 'admin', warehouseId: 'central', routeId: null, dayKeys: [today], setDayKeys: () => {}, can: () => true }

export function App() {
  const [view, setView] = useState<'lots' | 'payables' | 'closure'>('lots')
  return <main className="mx-auto w-full max-w-6xl p-2 sm:p-4">
    <nav className="mb-3 flex flex-wrap gap-2" aria-label="Visual QA sections">
      <button className="rounded-lg bg-slate-900 px-3 py-2 text-white" onClick={() => setView('lots')}>Lotes</button>
      <button className="rounded-lg bg-slate-900 px-3 py-2 text-white" onClick={() => setView('payables')}>Cuentas por pagar</button>
      <button className="rounded-lg bg-slate-900 px-3 py-2 text-white" onClick={() => setView('closure')}>Cierre</button>
    </nav>
    {view === 'lots' && <LotTraceabilityModal isOpen onClose={() => setView('payables')} products={[{ id: 'mortadela', name: lots[0].productName, unitType: 'unit', active: true }, { id: 'jamon', name: lots[1].productName, unitType: 'unit', active: true }]} routes={[route]} />}
    {view === 'payables' && <SupplierPayablesView data={data as never} session={session as never} readOnly />}
    {view === 'closure' && <ClosureView data={data as never} session={session as never} />}
  </main>
}

Object.assign(window, { __qaLots: lots, __qaSuppliers: suppliers, __qaPayables: payables, __qaPayments: payments, __qaData: data })
createRoot(document.getElementById('app')!).render(<App />)
