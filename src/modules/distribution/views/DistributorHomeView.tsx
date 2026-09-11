import { useMemo } from 'react'
import { ClipboardList, HandCoins, ShoppingCart, Wallet } from 'lucide-react'
import { Screen } from '../../../components/ui/Screen'
import { computeMoneySummary, computeSoldKilograms, computeSoldPackages, round2 } from '../domain/engine'
import { KpiCard, SectionCard, formatBs, formatQty } from './shared'
import type { ModuleId } from '../../../config/businessTypes'
import type { DistributionViewProps } from './DistributionApp'

/**
 * Inicio del distribuidor: solo su operacion del dia, con accesos grandes.
 * No ve reportes administrativos ni datos de otros distribuidores.
 */
export function DistributorHomeView({
  session,
  data,
  onNavigate,
}: DistributionViewProps & { onNavigate: (module: ModuleId) => void }) {
  const money = useMemo(
    () => computeMoneySummary(data.sales, data.collections, data.expenses),
    [data.sales, data.collections, data.expenses],
  )
  // Se muestran las dos magnitudes por separado: los paquetes y sachets no se
  // convierten a kilos, asi que un dia de solo paquetes daria "0 kg" y parece
  // que no se vendio nada.
  const soldKg = useMemo(() => computeSoldKilograms(data.sales), [data.sales])
  const soldPackages = useMemo(() => computeSoldPackages(data.sales), [data.sales])

  const openDispatch = data.openDispatches[0] ?? null

  const globalOutstanding = round2(
    data.receivables.reduce((sum, receivable) => sum + (Number(receivable.balance) || 0), 0),
  )

  const routeStock = useMemo(
    () =>
      data.balances
        .filter((balance) => balance.locationKind === 'route' && balance.routeId === session.routeId)
        .filter((balance) => Math.abs(Number(balance.quantity) || 0) > 0.001),
    [data.balances, session.routeId],
  )

  const actions: { id: ModuleId; label: string; icon: typeof ShoppingCart }[] = [
    { id: 'dist.sales', label: 'Vender', icon: ShoppingCart },
    { id: 'dist.credits', label: 'Creditos y cobros', icon: HandCoins },
    { id: 'dist.expenses', label: 'Gastos', icon: Wallet },
    { id: 'dist.closure', label: 'Cerrar ruta', icon: ClipboardList },
  ]

  return (
    <Screen
      title={`Hola, ${session.userName.split(' ')[0]}`}
      subtitle={openDispatch ? `Ruta ${openDispatch.routeName} · en ruta` : 'Sin despacho abierto'}
    >
      <div className="grid w-full min-w-0 gap-3">
        <div className="grid grid-cols-2 gap-2">
          <KpiCard label="Venta de hoy" value={formatBs(money.salesTotal)} tone="primary" />
          <KpiCard label="Efectivo esperado" value={formatBs(money.expectedCash)} tone="positive" />
          <KpiCard label="Credito generado" value={formatBs(money.creditGenerated)} tone="warning" />
          <KpiCard label="Cartera general" value={formatBs(globalOutstanding)} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => onNavigate(action.id)}
              className="flex min-h-[76px] w-full min-w-0 flex-col items-start justify-center gap-1.5 rounded-2xl border border-slate-200 bg-white p-3 text-left"
            >
              <span
                className="flex h-9 w-9 items-center justify-center rounded-xl"
                style={{ backgroundColor: 'var(--primary-soft)', color: 'var(--primary)' }}
              >
                <action.icon size={17} />
              </span>
              <span className="min-w-0 break-words text-xs font-extrabold text-slate-900">{action.label}</span>
            </button>
          ))}
        </div>

        <SectionCard title="Mi carga">
          {routeStock.length === 0 ? (
            <p className="text-xs font-semibold text-slate-500">Almacen todavia no registro tu carga de hoy.</p>
          ) : (
            <div className="grid gap-1.5">
              {routeStock.map((balance) => (
                <div key={balance.id} className="flex min-w-0 items-center justify-between gap-2 rounded-2xl bg-slate-50 px-3 py-2">
                  <span className="min-w-0 break-words text-xs font-bold text-slate-800">{balance.productName}</span>
                  <span className="shrink-0 text-sm font-black tabular-nums text-slate-900">
                    {formatQty(balance.quantity, balance.unitType)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Mis movimientos de hoy">
          <div className="grid grid-cols-3 gap-2">
            <KpiCard label="Ventas" value={String(data.sales.length)} />
            <KpiCard label="Cobros" value={formatBs(money.collectionsTotal)} />
            <KpiCard label="Gastos" value={formatBs(money.cashExpenses)} tone="danger" />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <KpiCard label="Granel vendido" value={`${soldKg} kg`} />
            <KpiCard label="Paquetes / unidades" value={String(soldPackages)} />
          </div>
        </SectionCard>
      </div>
    </Screen>
  )
}
