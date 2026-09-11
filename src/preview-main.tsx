import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import { DistributionApp } from './modules/distribution/views/DistributionApp'
import { ProductsView } from './modules/distribution/views/ProductsView'
import { SellView } from './modules/distribution/views/SellView'
import { DispatchesView } from './modules/distribution/views/DispatchesView'
import { WarehousesView } from './modules/distribution/views/WarehousesView'
import { ClaimsView } from './modules/distribution/views/ClaimsView'
import { DistributionPrinterModal } from './modules/distribution/views/DistributionPrinterModal'
import { InventoryView } from './modules/distribution/views/InventoryView'
import { QrView } from './modules/distribution/views/QrView'
import { CreditsView } from './modules/distribution/views/CreditsView'
import { ExpensesView } from './modules/distribution/views/ExpensesView'
import { CustomersView } from './modules/distribution/views/CustomersView'
import { UsersView } from './modules/distribution/views/UsersView'
import { previewData } from './preview-data'
import type { UserRole } from './types'
import type { DistributionSession } from './modules/distribution/views/DistributionApp'

type PreviewScreen = 'app' | 'products' | 'sales' | 'dispatches' | 'warehouses' | 'claims' | 'inventory' | 'qr' | 'credits' | 'expenses' | 'customers' | 'users' | 'printer'

export function Harness() {
  const [role, setRole] = useState<UserRole>('admin')
  const [screen, setScreen] = useState<PreviewScreen>(() => new URLSearchParams(window.location.search).get('screen') as PreviewScreen || 'app')
  const session: DistributionSession = { restaurantId: 'preview', restaurantName: 'Embutidos San Jose', uid: 'preview-uid', userName: 'Hugo Herbas', role, warehouseId: 'central', routeId: role === 'distributor' ? 'route-norte' : null, can: () => true, dayKeys: ['2026-09-08'], setDayKeys: () => undefined }
  const viewProps = { session, data: previewData }

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 8, background: '#fff' }}>
        {(['admin', 'warehouse', 'distributor'] as UserRole[]).map((option) => (
          <button key={option} onClick={() => setRole(option)} style={{ padding: 8 }}>
            {option}
          </button>
        ))}
        {(['app', 'products', 'sales', 'dispatches', 'warehouses', 'claims', 'inventory', 'qr', 'credits', 'expenses', 'customers', 'users', 'printer'] as PreviewScreen[]).map(option => <button key={option} onClick={() => setScreen(option)} style={{ padding: 8, fontWeight: screen === option ? 800 : 400 }}>{option}</button>)}
      </div>
      {screen === 'app' && <DistributionApp
        key={role}
        restaurantId="preview"
        restaurantName="Embutidos San Jose"
        uid="preview-uid"
        userName="Hugo Herbas"
        role={role}
        routeId="route-norte"
        onSignOut={async () => undefined}
        onOpenPrinterSettings={() => undefined}
      />}
      {screen !== 'app' && screen !== 'printer' && <main className="mx-auto w-full max-w-5xl p-3">
        {screen === 'products' && <ProductsView {...viewProps} />}
        {screen === 'sales' && <SellView {...viewProps} />}
        {screen === 'dispatches' && <DispatchesView {...viewProps} />}
        {screen === 'warehouses' && <WarehousesView {...viewProps} />}
        {screen === 'claims' && <ClaimsView {...viewProps} />}
        {screen === 'inventory' && <InventoryView {...viewProps} />}
        {screen === 'qr' && <QrView {...viewProps} />}
        {screen === 'credits' && <CreditsView {...viewProps} />}
        {screen === 'expenses' && <ExpensesView {...viewProps} />}
        {screen === 'customers' && <CustomersView {...viewProps} />}
        {screen === 'users' && <UsersView {...viewProps} membersOverride={[{ uid: 'admin-1', email: 'admin@embutidossanjose.com', displayName: 'Administración San José', role: 'admin', active: true }, { uid: 'warehouse-1', email: 'almacen@embutidossanjose.com', displayName: 'Almacén Central', role: 'warehouse', warehouseId: 'central', active: true }, { uid: 'seller-1', email: 'hugo@embutidossanjose.com', displayName: 'Hugo Herbas', role: 'distributor', routeId: 'route-norte', active: true }]} />}
      </main>}
      {screen === 'printer' && <DistributionPrinterModal restaurantId="preview" onClose={() => setScreen('app')} />}
    </>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Harness />
  </React.StrictMode>,
)
