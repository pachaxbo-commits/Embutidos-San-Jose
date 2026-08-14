import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import { DistributionApp } from './modules/distribution/views/DistributionApp'
import type { UserRole } from './types'

function Harness() {
  const [role, setRole] = useState<UserRole>('admin')

  return (
    <>
      <div style={{ display: 'flex', gap: 8, padding: 8, background: '#fff' }}>
        {(['admin', 'warehouse', 'distributor'] as UserRole[]).map((option) => (
          <button key={option} onClick={() => setRole(option)} style={{ padding: 8 }}>
            {option}
          </button>
        ))}
      </div>
      <DistributionApp
        key={role}
        restaurantId="preview"
        restaurantName="Embutidos San Jose"
        uid="preview-uid"
        userName="Hugo Herbas"
        role={role}
        routeId="route-norte"
        onSignOut={async () => undefined}
        onOpenPrinterSettings={() => undefined}
      />
    </>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Harness />
  </React.StrictMode>,
)
