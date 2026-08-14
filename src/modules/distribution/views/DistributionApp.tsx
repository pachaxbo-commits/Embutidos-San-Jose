import { useEffect, useMemo, useState } from 'react'
import {
  Boxes,
  ClipboardList,
  Grid3x3,
  Home,
  LogOut,
  Receipt,
  ShoppingCart,
  Truck,
  Users,
  Wallet,
  HandCoins,
  UserCog,
  BarChart3,
  Printer,
} from 'lucide-react'
import { getVisibleModules, getBusinessTypeDefinition, type ModuleId } from '../../../config/businessTypes'
import { hasPermission } from '../../../services/permissionService'
import { applyTenantTheme } from '../../../lib/tenantTheme'
import { BottomNav, type BottomNavItem } from '../../../components/ui/BottomNav'
import { Modal } from '../../../components/ui/Modal'
import { useBackButtonBridge } from '../../../hooks/useBackHandler'
import { buildDayRange, useDistributionData, useSyncStatus } from '../state/useDistributionStore'
import { toDayKey } from '../domain/engine'
import { SyncStatusPill } from './shared'
import { DashboardView } from './DashboardView'
import { DistributorHomeView } from './DistributorHomeView'
import { InventoryView } from './InventoryView'
import { DispatchesView } from './DispatchesView'
import { SellView } from './SellView'
import { CreditsView } from './CreditsView'
import { CollectionsView } from './CollectionsView'
import { CustomersView } from './CustomersView'
import { ExpensesView } from './ExpensesView'
import { ClosureView } from './ClosureView'
import { ProductsView } from './ProductsView'
import { ReportsView } from './ReportsView'
import { UsersView } from './UsersView'
import type { Permission, UserRole } from '../../../types'
import type { DistributionData } from '../state/useDistributionStore'

export interface DistributionSession {
  restaurantId: string
  restaurantName: string
  uid: string
  userName: string
  role: UserRole
  /** Ruta del distribuidor; null para admin/almacen (ven todas) */
  routeId: string | null
  can: (permission: Permission) => boolean
  /** Rango consultado actualmente */
  dayKeys: string[]
  setDayKeys: (dayKeys: string[]) => void
}

export interface DistributionViewProps {
  session: DistributionSession
  data: DistributionData
}

const MODULE_ICONS: Partial<Record<ModuleId, BottomNavItem<ModuleId>['icon']>> = {
  'dist.dashboard': Home,
  'dist.sales': ShoppingCart,
  'dist.inventory': Boxes,
  'dist.dispatches': Truck,
  'dist.credits': Receipt,
  'dist.collections': HandCoins,
  'dist.customers': Users,
  'dist.expenses': Wallet,
  'dist.closure': ClipboardList,
  'dist.products': Grid3x3,
  'dist.reports': BarChart3,
  'dist.users': UserCog,
  'printer-settings': Printer,
}

export function DistributionApp({
  restaurantId,
  restaurantName,
  uid,
  userName,
  role,
  routeId,
  onSignOut,
  onOpenPrinterSettings,
}: {
  restaurantId: string
  restaurantName: string
  uid: string
  userName: string
  role: UserRole
  routeId: string | null
  onSignOut: () => Promise<void>
  onOpenPrinterSettings: () => void
}) {
  const definition = getBusinessTypeDefinition('mobile_distribution')

  useEffect(() => {
    applyTenantTheme(definition.theme)
  }, [definition.theme])

  const can = useMemo(() => (permission: Permission) => hasPermission(role, permission), [role])

  const modules = useMemo(() => getVisibleModules('mobile_distribution', can), [can])
  const [currentModule, setCurrentModule] = useState<ModuleId>(modules[0]?.id ?? 'dist.dashboard')
  const [isMoreOpen, setIsMoreOpen] = useState(false)
  const [dayKeys, setDayKeys] = useState<string[]>([toDayKey(new Date())])

  const activeModule = modules.some((module) => module.id === currentModule)
    ? currentModule
    : modules[0]?.id ?? 'dist.dashboard'

  // El distribuidor solo consulta su propia ruta y su propio dia.
  const scopeRouteId = role === 'distributor' ? routeId : null
  const data = useDistributionData({
    routeId: scopeRouteId,
    dayKeys: role === 'distributor' ? [toDayKey(new Date())] : dayKeys,
    enabled: true,
  })

  useBackButtonBridge(() => {
    if (activeModule !== modules[0]?.id) {
      setCurrentModule(modules[0]?.id ?? 'dist.dashboard')
      return true
    }
    return false
  })

  const session: DistributionSession = {
    restaurantId,
    restaurantName,
    uid,
    userName,
    role,
    routeId: scopeRouteId,
    can,
    dayKeys: role === 'distributor' ? [toDayKey(new Date())] : dayKeys,
    setDayKeys,
  }

  const syncState = useSyncStatus()

  const navItems: BottomNavItem<ModuleId>[] = modules
    .filter((module) => MODULE_ICONS[module.id])
    .slice(0, 4)
    .map((module) => ({
      id: module.id,
      label: module.label,
      icon: MODULE_ICONS[module.id]!,
    }))

  const overflowModules = modules.filter((module) => !navItems.some((item) => item.id === module.id))

  const selectModule = (id: ModuleId) => {
    setCurrentModule(id)
    setIsMoreOpen(false)
  }

  const viewProps: DistributionViewProps = { session, data }

  const renderModule = () => {
    switch (activeModule) {
      case 'dist.dashboard':
        return role === 'distributor' ? (
          <DistributorHomeView {...viewProps} onNavigate={selectModule} />
        ) : (
          <DashboardView {...viewProps} />
        )
      case 'dist.inventory':
        return <InventoryView {...viewProps} />
      case 'dist.dispatches':
        return <DispatchesView {...viewProps} />
      case 'dist.sales':
        return <SellView {...viewProps} />
      case 'dist.credits':
        return <CreditsView {...viewProps} />
      case 'dist.collections':
        return <CollectionsView {...viewProps} />
      case 'dist.customers':
        return <CustomersView {...viewProps} />
      case 'dist.expenses':
        return <ExpensesView {...viewProps} />
      case 'dist.closure':
        return <ClosureView {...viewProps} />
      case 'dist.products':
        return <ProductsView {...viewProps} />
      case 'dist.reports':
        return <ReportsView {...viewProps} />
      case 'dist.users':
        return <UsersView {...viewProps} />
      default:
        return null
    }
  }

  const roleLabel =
    role === 'distributor' ? 'Distribuidor' : role === 'warehouse' ? 'Almacen' : 'Administracion'

  return (
    <div className="flex min-h-[100dvh] w-full min-w-0 flex-col" style={{ backgroundColor: 'var(--background)' }}>
      <header
        className="sticky top-0 z-30 w-full border-b border-slate-200 bg-white px-3 py-2.5 pt-safe"
        style={{ borderBottomColor: 'var(--primary-soft)' }}
      >
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-black text-white"
              style={{ backgroundColor: 'var(--primary)' }}
            >
              SJ
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-extrabold tracking-tight text-slate-900">{restaurantName}</h1>
              <p className="truncate text-[11px] font-semibold text-slate-500">
                {roleLabel} · {userName}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <SyncStatusPill state={syncState} />
            <button
              type="button"
              onClick={() => void onSignOut()}
              aria-label="Cerrar sesion"
              className="hidden h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 sm:flex"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-1 gap-4 px-3 py-4">
        {/* Navegacion lateral en pantallas amplias */}
        <nav className="hidden w-52 shrink-0 flex-col gap-1 md:flex">
          {modules.map((module) => {
            const Icon = MODULE_ICONS[module.id]
            const isActive = module.id === activeModule
            return (
              <button
                key={module.id}
                type="button"
                onClick={() => selectModule(module.id)}
                className={`flex min-h-[44px] items-center gap-2.5 rounded-2xl px-3 text-left text-sm font-bold transition ${
                  isActive ? 'text-white' : 'text-slate-600 hover:bg-white'
                }`}
                style={isActive ? { backgroundColor: 'var(--primary)' } : undefined}
              >
                {Icon && <Icon size={17} />}
                <span className="truncate">{module.label}</span>
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => void onSignOut()}
            className="mt-2 flex min-h-[44px] items-center gap-2.5 rounded-2xl px-3 text-left text-sm font-bold text-rose-600 hover:bg-rose-50"
          >
            <LogOut size={17} /> Cerrar sesion
          </button>
        </nav>

        <main className="min-w-0 flex-1 pb-bottom-nav">{renderModule()}</main>
      </div>

      <BottomNav
        items={[
          ...navItems,
          ...(overflowModules.length > 0
            ? [{ id: '__more' as ModuleId, label: 'Mas', icon: Grid3x3 }]
            : []),
        ]}
        currentId={overflowModules.some((module) => module.id === activeModule) ? ('__more' as ModuleId) : activeModule}
        onSelect={(id) => {
          if (id === ('__more' as ModuleId)) setIsMoreOpen(true)
          else selectModule(id)
        }}
      />

      <Modal isOpen={isMoreOpen} onClose={() => setIsMoreOpen(false)} title="Mas opciones">
        <div className="grid grid-cols-2 gap-2">
          {overflowModules.map((module) => {
            const Icon = MODULE_ICONS[module.id]
            return (
              <button
                key={module.id}
                type="button"
                onClick={() => {
                  if (module.id === 'printer-settings') {
                    setIsMoreOpen(false)
                    onOpenPrinterSettings()
                    return
                  }
                  selectModule(module.id)
                }}
                className="flex min-h-[56px] items-center gap-2.5 rounded-2xl border border-slate-200 bg-white px-3 text-left text-xs font-extrabold text-slate-800"
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                  style={{ backgroundColor: 'var(--primary-soft)', color: 'var(--primary)' }}
                >
                  {Icon && <Icon size={16} />}
                </span>
                <span className="truncate">{module.label}</span>
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => void onSignOut()}
            className="flex min-h-[56px] items-center gap-2.5 rounded-2xl border border-rose-200 bg-rose-50 px-3 text-left text-xs font-extrabold text-rose-700"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-rose-600">
              <LogOut size={16} />
            </span>
            Cerrar sesion
          </button>
        </div>
      </Modal>
    </div>
  )
}

export { buildDayRange }
