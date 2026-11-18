import { SacheteadoView } from '../../src/modules/distribution/views/SacheteadoView'
import { createRoot } from 'react-dom/client'
import { ProcessingMassRectification } from '../../src/modules/distribution/views/ProcessingMassRectification'
import { LotReconciliation } from '../../src/modules/distribution/views/LotReconciliation'
import type { ProcessingBatch } from '../../src/modules/distribution/domain/processing'
import type { DistLot } from '../../src/modules/distribution/types'
import '../../src/index.css'

const batch = { id: 'qa-batch', sourceAllocations: [{ lotId: 'source', lotCode: '141126', measuredNetWeightG: 17200 }] } as ProcessingBatch
const lot = {
  id: 'qa-lot', productId: 'qa-jamon', productName: 'Jamón porcionado', lotCode: '101126',
  manufacturedOn: '2026-11-10', expiresOn: '2026-11-16', productionCost: 20,
  quantities: { central: 1 }, unitType: 'package', processingBatchId: 'qa-batch',
} as DistLot

const mode = new URLSearchParams(location.search).get('mode')
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const isHeavy = mode === 'weight'
const net = isHeavy ? '16120' : '15083'
const session = { uid: 'visual-qa', restaurantId: 'sanjose', restaurantName: 'San José QA', role: 'admin', warehouseId: 'central', routeId: null, dayKeys: [], setDayKeys: () => {}, can: () => true } as const
const data = { products: [{ id: 'bulk', name: 'Tocino granel', unitType: 'kg', active: true }, { id: 'output', name: 'Sachet Tocino', unitType: 'package', active: true }], lots: [{ ...lot, id: 'bulk-lot', productId: 'bulk', unitType: 'kg', processingBatchId: undefined, expiresOn: '2999-01-01', quantities: { central: 20 } }], balances: [{ id: 'central', productId: 'bulk', quantity: 20 }], warehouses: [], stockMovements: [], operations: [], expenses: [] }
if (mode) localStorage.setItem('sanjose_processing_draft_v1:visual-qa', JSON.stringify({
  batchId: 'qa-make', operationId: 'qa-confirm', processType: 'bagging', location: 'central', processingDate: day,
  sourceProductId: 'bulk', sources: [{ lotId: 'bulk-lot', quantityKg: String(Number(net) / 1000) }],
  destinations: [{ id: 'destination', kind: 'finished', productId: 'output', commercialQuantity: isHeavy ? '92' : '15', netWeightG: net, nominalWeightG: isHeavy ? '140' : '1000', lotCode: 'RESULT-QA', manufacturedOn: day, packagedOn: day, expiresOn: '2999-01-01', weightBasis: 'measured_total', reason: '' }],
  materials: [{ id: 'blank', description: '', quantity: '', damaged: '0', costBs: '', expenseId: '' }], costs: [], notes: '',
}))
const root = createRoot(document.getElementById('root')!)
if (mode) root.render(<SacheteadoView session={session as unknown as Parameters<typeof SacheteadoView>[0]['session']} data={data as unknown as Parameters<typeof SacheteadoView>[0]['data']} />)
else root.render(<main className="mx-auto max-w-4xl p-3">
  <ProcessingMassRectification batch={batch} />
  <LotReconciliation lot={lot} location="central" admin />
</main>)
