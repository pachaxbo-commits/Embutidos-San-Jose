import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { signInWithEmail } from '../src/lib/firebase'
import { SacheteadoView } from '../src/modules/distribution/views/SacheteadoView'
import type { DistributionSession } from '../src/modules/distribution/views/DistributionApp'
import type { DistributionData } from '../src/modules/distribution/state/useDistributionStore'
import '../src/index.css'

export function Harness() {
  const [uid, setUid] = useState('')
  const [error, setError] = useState('')
  const [sourceLot, setSourceLot] = useState({ id: 'qa-source-lot', restaurantId: 'sanjose', productId: 'qa-source-product', productName: 'QA Producto a granel', unitType: 'kg', lotCode: 'QA-ORIGEN-2KG', manufacturedOn: '2026-10-20', expiresOn: '2026-12-20', productionCost: 5, quantities: { central: 2 }, processingUnavailable: { central: { courtesy: 0, repackPending: 2, reviewHold: 0 } }, processingReview: { caseId: 'qa-processing-case', revision: 0, status: 'pending_review', updatedAt: '', updatedBy: '' } })
  useEffect(() => {
    Object.assign(window, { __qaUpdateSourceLot: (lot: typeof sourceLot) => setSourceLot(lot) })
    return () => { delete (window as Window & { __qaUpdateSourceLot?: unknown }).__qaUpdateSourceLot }
  }, [])
  useEffect(() => {
    void signInWithEmail('processing-ui-qa@example.test', 'QA-only-password-123!')
      .then(async credential => setUid(credential.user.uid))
      .catch(reason => setError((reason as Error).message))
  }, [])

  if (error) return <main role="alert">No se pudo autenticar en Emulator: {error}</main>
  if (!uid) return <p role="status">Conectando sesión QA a Firebase Emulator…</p>

  const session: DistributionSession = {
    restaurantId: 'sanjose', restaurantName: 'Embutidos San José', uid,
    userName: 'Administración QA', role: 'admin', warehouseId: 'central', routeId: null,
    can: () => true, dayKeys: [], setDayKeys: () => {},
  }
  const data = {
    products: [
      { id: 'qa-source-product', restaurantId: 'sanjose', name: 'QA Producto a granel', unitType: 'kg', active: true, productionCost: 5 },
      { id: 'qa-sachet-product', restaurantId: 'sanjose', name: 'QA Sachet 250 g', unitType: 'package', active: true, productionCost: 999 },
    ],
    lots: [sourceLot, { id: 'qa-other-lot', restaurantId: 'sanjose', productId: 'qa-source-product', productName: 'QA Producto a granel', unitType: 'kg', lotCode: 'QA-OTRO-1KG', manufacturedOn: '2026-10-20', expiresOn: '2026-12-20', productionCost: 5, quantities: { central: 1 }, processingUnavailable: { central: { courtesy: 0, repackPending: 0, reviewHold: 1 } } }, { id: 'qa-free-lot', restaurantId: 'sanjose', productId: 'qa-source-product', productName: 'QA Producto a granel', unitType: 'kg', lotCode: 'QA-LIBRE-1KG', manufacturedOn: '2026-10-20', expiresOn: '2026-12-20', productionCost: 5, quantities: { central: 1 }, processingUnavailable: { central: { courtesy: 0, repackPending: 0, reviewHold: 0 } } }],
    balances: [{ id: 'central__qa-source-product', restaurantId: 'sanjose', locationKind: 'central', warehouseId: 'central', productId: 'qa-source-product', unitType: 'kg', quantity: 4 }],
    warehouses: [], stockMovements: [], operations: [],
  } as unknown as DistributionData

  return <SacheteadoView session={session} data={data} />
}

createRoot(document.getElementById('root')!).render(<Harness />)
