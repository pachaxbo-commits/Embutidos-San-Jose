import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { signInWithEmail } from '../src/lib/firebase'
import { SacheteadoView } from '../src/modules/distribution/views/SacheteadoView'
import { DistributionApp } from '../src/modules/distribution/views/DistributionApp'
import { SellView } from '../src/modules/distribution/views/SellView'
import { useDistributionData } from '../src/modules/distribution/state/useDistributionStore'
import { toDayKey } from '../src/modules/distribution/domain/engine'
import type { DistributionSession } from '../src/modules/distribution/views/DistributionApp'
import type { UserRole } from '../src/types'
import type { DistributionData } from '../src/modules/distribution/state/useDistributionStore'
import '../src/index.css'

export function Harness() {
  const params = new URLSearchParams(window.location.search)
  const fullApp = params.get('app') === '1'
  const role = (params.get('role') || 'admin') as UserRole
  const qaUsers: Record<string, { email: string; password: string; uid: string; name: string }> = {
    admin: { email: 'processing-ui-qa@example.test', password: 'QA-only-password-123!', uid: 'processing-ui-qa', name: 'Administración QA' },
    warehouse: { email: 'processing-ui-warehouse@example.test', password: 'QA-only-password-123!', uid: 'processing-ui-warehouse', name: 'Almacén QA' },
    distributor: { email: 'processing-ui-distributor@example.test', password: 'QA-only-password-123!', uid: 'processing-ui-distributor', name: 'Distribuidor QA' },
  }
  const qaUser = qaUsers[role] || qaUsers.admin
  const [uid, setUid] = useState('')
  const [error, setError] = useState('')
  const [sourceLot, setSourceLot] = useState({ id: 'qa-source-lot', restaurantId: 'sanjose', productId: 'qa-source-product', productName: 'QA Producto a granel', unitType: 'kg', lotCode: 'QA-ORIGEN-2KG', manufacturedOn: '2026-10-20', expiresOn: '2999-12-31', productionCost: 5, quantities: { central: 2 }, processingUnavailable: { central: { courtesy: 0, repackPending: 2, reviewHold: 0 } }, processingReview: { caseId: 'qa-processing-case', revision: 0, status: 'pending_review', updatedAt: '', updatedBy: '' } })
  const [otherLot, setOtherLot] = useState({ id: 'qa-other-lot', restaurantId: 'sanjose', productId: 'qa-source-product', productName: 'QA Producto a granel', unitType: 'kg', lotCode: 'QA-OTRO-1KG', manufacturedOn: '2026-10-20', expiresOn: '2999-12-31', productionCost: 5, quantities: { central: 1 }, processingUnavailable: { central: { courtesy: 0, repackPending: 0, reviewHold: 1 } }, processingReview: { caseId: 'qa-other-case', revision: 0, status: 'authorized_for_repack', updatedAt: '', updatedBy: '' } })
  const [assessmentLot, setAssessmentLot] = useState({ id: 'qa-assessment-lot', restaurantId: 'sanjose', productId: 'qa-assessment-product', productName: 'QA Paquete para evaluación', unitType: 'package', lotCode: 'QA-ASSESSMENT', manufacturedOn: '2026-10-20', expiresOn: '2999-12-31', productionCost: null, quantities: { central: 2 }, processingUnavailable: { central: { courtesy: 0, repackPending: 0, reviewHold: 2 } }, processingPhysicalWeightGRemaining: 500, processingCostCentsRemaining: 250, processingCommercialBlocked: true, processingDestinationKind: 'review_hold', quarantined: true })
  const [freeLot] = useState({ id: 'qa-free-lot', restaurantId: 'sanjose', productId: 'qa-source-product', productName: 'QA Producto a granel', unitType: 'kg', lotCode: 'QA-LIBRE-1KG', manufacturedOn: '2026-10-20', expiresOn: '2999-12-31', productionCost: 5, quantities: { central: 1 }, processingUnavailable: { central: { courtesy: 0, repackPending: 0, reviewHold: 0 } } })
  useEffect(() => {
    Object.assign(window, {
      __qaUpdateSourceLot: (lot: typeof sourceLot) => setSourceLot(lot),
      __qaUpdateOtherLot: (lot: typeof otherLot) => setOtherLot(lot),
      __qaUpdateAssessmentLot: (lot: typeof assessmentLot) => setAssessmentLot(lot),
    })
    return () => {
      delete (window as Window & { __qaUpdateSourceLot?: unknown }).__qaUpdateSourceLot
      delete (window as Window & { __qaUpdateOtherLot?: unknown }).__qaUpdateOtherLot
      delete (window as Window & { __qaUpdateAssessmentLot?: unknown }).__qaUpdateAssessmentLot
    }
  }, [])
  useEffect(() => {
    void signInWithEmail(qaUser.email, qaUser.password)
      .then(async credential => setUid(credential.user.uid))
      .catch(reason => setError((reason as Error).message))
  }, [qaUser.email, qaUser.password])

  if (error) return <main role="alert">No se pudo autenticar en Emulator: {error}</main>
  if (!uid) return <p role="status">Conectando sesión QA a Firebase Emulator…</p>

  if (params.get('sell') === '1') return <SellVoidHarness uid={uid} userName={qaUser.name} />

  if (fullApp) return <DistributionApp
    restaurantId="sanjose"
    restaurantName="Embutidos San José"
    uid={uid}
    userName={qaUser.name}
    role={role}
    routeId={role === 'distributor' ? 'qa-route' : null}
    warehouseId={role === 'warehouse' ? 'qa-warehouse' : 'central'}
    onSignOut={async () => {}}
    onOpenPrinterSettings={() => {}}
  />

  const session: DistributionSession = {
    restaurantId: 'sanjose', restaurantName: 'Embutidos San José', uid,
    userName: 'Administración QA', role: 'admin', warehouseId: 'central', routeId: null,
    can: () => true, dayKeys: [], setDayKeys: () => {},
  }
  const data = {
    products: [
      { id: 'qa-source-product', restaurantId: 'sanjose', name: 'QA Producto a granel', unitType: 'kg', active: true, productionCost: 5 },
      { id: 'qa-sachet-product', restaurantId: 'sanjose', name: 'QA Sachet 250 g', unitType: 'package', active: true, productionCost: 999 },
      { id: 'qa-assessment-product', restaurantId: 'sanjose', name: 'QA Paquete para evaluación', unitType: 'package', active: true, productionCost: null },
    ],
    lots: [sourceLot, otherLot, assessmentLot, freeLot],
    balances: [{ id: 'central__qa-source-product', restaurantId: 'sanjose', locationKind: 'central', warehouseId: 'central', productId: 'qa-source-product', unitType: 'kg', quantity: 4 }],
    warehouses: [], stockMovements: [], operations: [],
  } as unknown as DistributionData

  return <SacheteadoView session={session} data={data} />
}

function SellVoidHarness({ uid, userName }: { uid: string; userName: string }) {
  const dayKeys = [toDayKey(new Date())]
  const data = useDistributionData({ restaurantId: 'sanjose', routeId: null, dayKeys, enabled: true, canReadFinance: true })
  const session: DistributionSession = {
    restaurantId: 'sanjose', restaurantName: 'Embutidos San José', uid, userName, role: 'admin',
    warehouseId: 'central', routeId: null, can: () => true, dayKeys, setDayKeys: () => {},
  }
  return <SellView session={session} data={data} />
}

createRoot(document.getElementById('root')!).render(<Harness />)
