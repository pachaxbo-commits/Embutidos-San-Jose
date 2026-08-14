import { useEffect, useMemo, useState } from 'react'
import { AdminView } from './components/AdminView'
import { CajaView } from './components/CajaView'
import { FloatingOrderAlert } from './components/FloatingOrderAlert'
import { BotView } from './components/BotView'
import { CocinaView } from './components/CocinaView'
import { HistorialView } from './components/HistorialView'
import { LoginView } from './components/LoginView'
import { RegisterView } from './components/RegisterView'
import { Sidebar, type ViewType } from './components/Sidebar'
import { TenantCustomizerModal } from './components/TenantCustomizerModal'
import { PrinterSettingsModal } from './components/PrinterSettingsModal'
import { PrinterDiagnosticView } from './components/PrinterDiagnosticView'
import { PrinterSettingsView } from './components/PrinterSettingsView'
import { CashSessionView } from './components/CashSessionView'
import { AppHeader } from './components/ui/AppHeader'
import { MobileBottomNavigation } from './components/ui/MobileBottomNavigation'
import { UnauthorizedView } from './components/UnauthorizedView'
import { DistributionApp } from './modules/distribution/views/DistributionApp'
import { notifyBotOrderConfirmed } from './lib/botApi'
import { fetchRestaurantAccount, updateRestaurantBranding } from './lib/firebase'
import { useBackButtonBridge } from './hooks/useBackHandler'
import { useAuthStore } from './store/authStore'
import { useCatalogStore } from './store/catalogStore'
import { useOrdersStore } from './store/appStore'
import { startContinuousOrderAlert, stopContinuousOrderAlert } from './lib/sound'
import type { Order, OrderStatus, RestaurantBranding, UserRole } from './types'

function getDayKey(value: string | Date = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getAllowedViews(role: UserRole | 'demo'): ViewType[] {
  if (role === 'admin' || role === 'demo') {
    return ['caja', 'cocina', 'historial', 'admin', 'bot']
  }
  if (role === 'caja') {
    return ['caja', 'historial']
  }
  if (role === 'cocina') {
    return ['cocina']
  }
  return ['caja']
}

function MainShell({
  mode,
  role,
  userName,
  userId,
  restaurantId,
  onSignOut,
}: {
  mode: 'firebase' | 'local'
  role: UserRole | 'demo'
  userName: string
  userId: string
  restaurantId: string | null
  onSignOut: () => Promise<void>
}) {
  const catalog = useCatalogStore()
  const ordersStore = useOrdersStore()
  const availableViews = getAllowedViews(role)
  const [selectedView, setSelectedView] = useState<ViewType>(availableViews[0] ?? 'caja')
  const view = availableViews.includes(selectedView) ? selectedView : availableViews[0]
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isCustomizerOpen, setIsCustomizerOpen] = useState(false)
  const [isPrinterSettingsOpen, setIsPrinterSettingsOpen] = useState(false)

  // El boton fisico atras pasa por la pila central: primero cierra modales /
  // capas abiertas y solo despues vuelve de pantalla o sale de la app.
  useBackButtonBridge(() => {
    if (view !== availableViews[0]) {
      setSelectedView(availableViews[0])
      return true
    }
    return false
  })

  useEffect(() => {
    if (mode !== 'firebase' || !restaurantId) return

    fetchRestaurantAccount(restaurantId)
      .then((account) => {
        if (account?.branding) {
          void catalog.saveQuickExtras([])
        }
      })
      .catch((error: Error) => {
        console.error('Error fetching restaurant branding:', error)
      })
  }, [mode, restaurantId])

  const [branding, setBranding] = useState<RestaurantBranding>({
    name: 'PACHAX Comandero',
    primaryColor: '#0B132B',
    accentColor: '#00F0FF',
    tablesCount: 12,
  })

  const categories = catalog.state.categories
  const products = catalog.state.products
  const quickExtras = catalog.state.quickExtras
  const orders = ordersStore.state.orders

  const pendingCount = useMemo(
    () => orders.filter((o: Order) => o.status === 'pending').length,
    [orders],
  )

  useEffect(() => {
    if (pendingCount > 0) {
      startContinuousOrderAlert()
    } else {
      stopContinuousOrderAlert()
    }

    return () => {
      stopContinuousOrderAlert()
    }
  }, [pendingCount])

  const nextOrderNumber = useMemo(() => `#${String((ordersStore.state.sequence ?? 0) + 1).padStart(3, '0')}`, [ordersStore.state.sequence])

  const dailyOrders = useMemo(() => {
    const todayKey = getDayKey()
    return orders.filter((o: Order) => getDayKey(o.createdAt) === todayKey && o.status !== 'cancelled')
  }, [orders])

  const dailyTotal = useMemo(
    () => dailyOrders.reduce((sum: number, o: Order) => sum + o.total, 0),
    [dailyOrders],
  )

  const activeTodayCount = dailyOrders.length

  const handleSaveBranding = async (nextBranding: Partial<RestaurantBranding>) => {
    setBranding((prev) => ({ ...prev, ...nextBranding }))
    if (mode === 'firebase' && restaurantId) {
      await updateRestaurantBranding(restaurantId, nextBranding)
    }
  }

  const handleSubmitOrder = async (input: any): Promise<boolean> => {
    setErrorMessage(null)
    try {
      await ordersStore.placeOrder(input)
      return true
    } catch (err: any) {
      const msg = err?.message || 'Error al guardar el pedido.'
      setErrorMessage(msg)
      return false
    }
  }

  const confirmPayment = async (orderId: string, summary: any): Promise<void> => {
    setErrorMessage(null)
    try {
      await ordersStore.confirmPayment(orderId, summary)
      const order = orders.find((o) => o.id === orderId)
      if (order && order.whatsappChatId) {
        notifyBotOrderConfirmed(order.id, 10).catch(() => undefined)
      }
    } catch (err: any) {
      const msg = err?.message || 'Error al procesar pago.'
      setErrorMessage(msg)
      throw err
    }
  }

  const handleAdvanceStatus = async (orderId: string, nextStatus: OrderStatus, delayMinutes?: number): Promise<boolean> => {
    setErrorMessage(null)
    try {
      await ordersStore.setOrderStatus(orderId, nextStatus, delayMinutes)
      return true
    } catch (err: any) {
      const msg = err?.message || 'Error al actualizar estado.'
      setErrorMessage(msg)
      return false
    }
  }

  const handleCancelOrder = async (orderId: string, cancelledBy: string, reason?: string): Promise<boolean> => {
    setErrorMessage(null)
    try {
      await ordersStore.cancelOrder(orderId, cancelledBy, reason)
      return true
    } catch (err: any) {
      const msg = err?.message || 'Error al anular pedido.'
      setErrorMessage(msg)
      return false
    }
  }

  const createCategory = async (cat: any) => catalog.createCategory(cat)
  const updateCategory = async (id: string, cat: any) => catalog.updateCategory(id, cat)
  const deleteCategory = async (id: string) => catalog.deleteCategory(id)
  const setCategoryActive = async (id: string, active: boolean) => catalog.setCategoryActive(id, active)
  const setCategoryVisibility = async (id: string, visible: boolean) => catalog.setCategoryVisibility(id, visible)
  const moveCategory = async (id: string, dir: 'up' | 'down') => catalog.moveCategory(id, dir)

  const createProduct = async (p: any) => catalog.createProduct(p)
  const updateProduct = async (id: string, p: any) => catalog.updateProduct(id, p)
  const deleteProduct = async (id: string) => catalog.deleteProduct(id)
  const setProductActive = async (id: string, active: boolean) => catalog.setProductActive(id, active)
  const setProductAvailability = async (id: string, avail: any) => catalog.setProductAvailability(id, avail)
  const setProductVisibility = async (id: string, visible: boolean) => catalog.setProductVisibility(id, visible)
  const moveProduct = async (id: string, dir: 'up' | 'down') => catalog.moveProduct(id, dir)
  const saveQuickExtras = async (extras: any[]) => catalog.saveQuickExtras(extras)

  const deleteOrder = async (orderId: string): Promise<void> => {
    setErrorMessage(null)
    try {
      await ordersStore.deleteOrder(orderId)
    } catch (err: any) {
      setErrorMessage(err?.message || 'Error al eliminar pedido.')
    }
  }

  const updateOrder = async (orderId: string, updates: any): Promise<void> => {
    setErrorMessage(null)
    try {
      await ordersStore.updateOrder(orderId, updates)
    } catch (err: any) {
      setErrorMessage(err?.message || 'Error al modificar pedido.')
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20 md:pb-6">
      {/* Compact App Header */}
      <AppHeader
        restaurantName={branding.name}
        branchName="Sucursal Principal"
        viewTitle={view.toUpperCase()}
        userRole={role}
        userName={userName}
        dailyTotal={dailyTotal}
        activeTodayCount={activeTodayCount}
      />

      {errorMessage && (
        <div className="max-w-7xl mx-auto px-4 mt-3">
          <div className="bg-rose-50 border border-rose-200 text-rose-800 px-4 py-3 rounded-2xl text-xs font-semibold">
            {errorMessage}
          </div>
        </div>
      )}

      <FloatingOrderAlert
        orders={orders.filter((o: Order) => o.orderSource === 'whatsapp' && Boolean(o.whatsappChatId))}
        onConfirmOrder={async (orderId, delay) => {
          await handleAdvanceStatus(orderId, 'preparing', delay)
        }}
      />

      {/* Main Layout Grid */}
      <div className="flex gap-4 items-start max-w-7xl mx-auto px-2 sm:px-4 mt-4">
        {/* Sleek Sidebar for Desktop / Tablet */}
        <Sidebar
          currentView={view}
          availableViews={availableViews}
          onChangeView={setSelectedView}
          userRole={role}
          userName={userName}
          restaurantName={branding.name}
          logoUrl={branding.logoUrl}
          pendingOrdersCount={pendingCount}
          onSignOut={onSignOut}
          onOpenCustomizer={role === 'admin' || role === 'demo' ? () => setIsCustomizerOpen(true) : undefined}
          onOpenPrinterSettings={() => setIsPrinterSettingsOpen(true)}
        />

        {/* Main Content Area */}
        <main className="flex-1 min-w-0">
          <div>
            {view === 'caja' && (
              <CajaView
                categories={categories}
                nextOrderNumber={nextOrderNumber}
                onSubmitOrder={handleSubmitOrder}
                products={products}
                orders={orders}
                quickExtras={quickExtras ?? []}
                userRole={role}
                userId={userId}
                userName={userName}
                onConfirmPayment={confirmPayment}
                onCancelOrder={handleCancelOrder}
                onDeleteOrder={deleteOrder}
                onUpdateOrder={updateOrder}
                onSetOrderStatus={handleAdvanceStatus}
              />
            )}
            {view === 'cocina' && <CocinaView orders={orders} onAdvanceStatus={handleAdvanceStatus} />}
            {view === 'historial' && (
              <HistorialView
                onAdvanceStatus={handleAdvanceStatus}
                onCancelOrder={handleCancelOrder}
                orders={orders}
                userName={userName}
                userRole={role}
              />
            )}
            {view === 'admin' && (
              <AdminView
                categories={categories}
                onCreateCategory={createCategory}
                onCreateProduct={createProduct}
                onDeleteCategory={deleteCategory}
                onDeleteProduct={deleteProduct}
                onMoveCategory={moveCategory}
                onMoveProduct={moveProduct}
                onSetCategoryActive={setCategoryActive}
                onSetCategoryVisibility={setCategoryVisibility}
                onSetProductActive={setProductActive}
                onSetProductAvailability={setProductAvailability}
                onSetProductVisibility={setProductVisibility}
                onUpdateCategory={updateCategory}
                onUpdateProduct={updateProduct}
                products={products}
                quickExtras={quickExtras ?? []}
                onSaveQuickExtras={saveQuickExtras}
              />
            )}
            {view === 'bot' && <BotView />}
            {view === 'printer-diagnostic' && <PrinterDiagnosticView />}
            {view === 'printer-settings' && <PrinterSettingsView onBack={() => setSelectedView('caja')} />}
            {view === 'cash-session' && <CashSessionView />}
          </div>
        </main>
      </div>

      {/* Mobile Fixed Bottom Navigation (4 items + "Más") */}
      <MobileBottomNavigation
        currentView={view}
        onChangeView={setSelectedView}
        pendingOrdersCount={pendingCount}
        onSignOut={onSignOut}
        onOpenPrinterSettings={() => setIsPrinterSettingsOpen(true)}
      />

      {/* Tenant Customizer Modal */}
      <TenantCustomizerModal
        isOpen={isCustomizerOpen}
        onClose={() => setIsCustomizerOpen(false)}
        initialBranding={branding}
        onSave={handleSaveBranding}
        restaurantId={restaurantId}
      />

      {/* Printer Settings Modal */}
      <PrinterSettingsModal
        isOpen={isPrinterSettingsOpen}
        onClose={() => setIsPrinterSettingsOpen(false)}
      />
    </div>
  )
}

/** Shell del tipo de empresa "distribucion movil" (Embutidos San Jose). */
function DistributionShell(props: {
  restaurantId: string
  restaurantName: string
  uid: string
  userName: string
  role: UserRole
  routeId: string | null
  onSignOut: () => Promise<void>
}) {
  const [isPrinterSettingsOpen, setIsPrinterSettingsOpen] = useState(false)

  return (
    <>
      <DistributionApp {...props} onOpenPrinterSettings={() => setIsPrinterSettingsOpen(true)} />
      <PrinterSettingsModal isOpen={isPrinterSettingsOpen} onClose={() => setIsPrinterSettingsOpen(false)} />
    </>
  )
}

function App() {
  const auth = useAuthStore()
  const [authView, setAuthView] = useState<'login' | 'register'>('login')

  if (auth.mode === 'local') {
    return (
      <MainShell
        mode="local"
        onSignOut={auth.signOut}
        role={auth.role ?? 'demo'}
        userName={auth.userDisplayName ?? 'Modo demo'}
        userId={auth.member?.uid || `mock-${auth.role || 'admin'}`}
        restaurantId={auth.restaurantId}
      />
    )
  }

  if (auth.status === 'loading' && auth.userEmail === null) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 text-slate-800">
        <h1 className="text-2xl font-bold tracking-tight text-blue-600 mb-2">
          Pachax Flow
        </h1>
        <p className="text-xs text-slate-500 font-semibold animate-pulse">Cargando sistema operativo POS...</p>
      </div>
    )
  }

  if (auth.status === 'signed_out' || authView === 'register') {
    if (authView === 'register') {
      return (
        <RegisterView
          onSuccess={() => setAuthView('login')}
          onSwitchToLogin={() => setAuthView('login')}
        />
      )
    }
    return (
      <LoginView
        error={auth.error}
        isLoading={false}
        onSubmit={auth.signIn}
        onSwitchToRegister={() => setAuthView('register')}
      />
    )
  }

  if (auth.status === 'authenticating' || auth.status === 'loading') {
    return (
      <LoginView
        error={auth.error}
        isLoading={true}
        onSubmit={auth.signIn}
        onSwitchToRegister={() => setAuthView('register')}
      />
    )
  }

  if (auth.status === 'unauthorized') {
    return <UnauthorizedView email={auth.error} message={auth.error ?? 'Acceso no autorizado.'} onSignOut={auth.signOut} />
  }

  // El tipo de empresa decide la experiencia completa. Sin businessType (o con
  // 'restaurant') se renderiza exactamente el comandero de siempre.
  if (auth.businessType === 'mobile_distribution') {
    return (
      <DistributionShell
        restaurantId={auth.restaurantId ?? ''}
        restaurantName={auth.account?.name ?? 'Mi empresa'}
        uid={auth.member?.uid ?? ''}
        userName={auth.userDisplayName ?? auth.userEmail ?? 'Usuario'}
        role={(auth.role ?? 'distributor') as UserRole}
        routeId={auth.member?.routeId ?? null}
        onSignOut={auth.signOut}
      />
    )
  }

  return (
    <MainShell
      mode="firebase"
      onSignOut={auth.signOut}
      role={auth.role ?? 'caja'}
      userName={auth.userDisplayName ?? auth.userEmail ?? 'Usuario'}
      userId={auth.member?.uid ?? ''}
      restaurantId={auth.restaurantId}
    />
  )
}

export default App
