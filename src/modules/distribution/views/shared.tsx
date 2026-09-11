import type { ReactNode } from 'react'
import { CloudOff, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import { describeVariance, round2 } from '../domain/engine'
import type { DistSyncState } from '../data/distributionRepository'
import type { UnitType } from '../types'

/** Formato monetario de la demo: Bs con dos decimales. */
export function formatBs(value: number): string {
  return `Bs ${round2(value).toFixed(2)}`
}

export function formatQty(value: number, unitType: UnitType): string {
  const amount = round2(value)
  if (unitType === 'kg') return `${amount} kg`
  if (unitType === 'package') return `${amount} paq`
  return `${amount} u`
}

export function unitLabel(unitType: UnitType): string {
  if (unitType === 'kg') return 'Granel (kg)'
  if (unitType === 'package') return 'Paquete'
  return 'Unidad'
}

/** Tarjeta de indicador: el numero manda, la etiqueta acompana. */
export function KpiCard({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'neutral' | 'primary' | 'positive' | 'warning' | 'danger'
}) {
  const toneStyle: Record<string, string> = {
    neutral: 'text-slate-900',
    primary: 'text-[var(--primary)]',
    positive: 'text-emerald-600',
    warning: 'text-amber-600',
    danger: 'text-rose-600',
  }

  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3">
      <p className="break-words text-[10px] font-extrabold uppercase leading-tight tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 break-words text-xl font-black leading-tight tabular-nums ${toneStyle[tone]}`}>{value}</p>
      {hint && <p className="mt-0.5 break-words text-[11px] font-semibold leading-snug text-slate-400">{hint}</p>}
    </div>
  )
}

export function SectionCard({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="w-full min-w-0 rounded-3xl border border-slate-200 bg-white p-3 sm:p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="break-words text-xs font-extrabold uppercase tracking-wide text-slate-500">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  )
}

/** Etiqueta de faltante/sobrante sin signos ambiguos */
export function VarianceBadge({ variance, unitType }: { variance: number; unitType?: UnitType }) {
  const { kind, amount } = describeVariance(variance)
  const styles: Record<string, string> = {
    FALTANTE: 'bg-rose-50 text-rose-700 border-rose-200',
    SOBRANTE: 'bg-amber-50 text-amber-700 border-amber-200',
    CUADRADO: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  }
  const text =
    kind === 'CUADRADO' ? 'CUADRADO' : `${kind} ${unitType ? formatQty(amount, unitType) : formatBs(amount)}`

  return (
    <span
      className={`inline-flex shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-black ${styles[kind]}`}
    >
      {text}
    </span>
  )
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = 'button',
  full,
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  type?: 'button' | 'submit'
  full?: boolean
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl px-4 text-sm font-extrabold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${
        full ? 'w-full' : ''
      }`}
      style={{ backgroundColor: 'var(--primary)' }}
    >
      {children}
    </button>
  )
}

export function SecondaryButton({
  children,
  onClick,
  disabled,
  full,
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  full?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 ${
        full ? 'w-full' : ''
      }`}
    >
      {children}
    </button>
  )
}

/** Estado de sincronizacion siempre visible mientras se trabaja en calle */
export function SyncStatusPill({ state, compact = false }: { state: DistSyncState; compact?: boolean }) {
  // El contador vive en memoria; hasUnsyncedWrites viene de Firestore y
  // sobrevive a cerrar y reabrir la aplicacion.
  const pendingLabel = state.pending > 0 ? `${state.pending} PENDIENTES` : 'CON PENDIENTES'

  if (!state.isOnline) {
    return (
      <span title={pendingLabel} aria-label={`Sin conexión. ${pendingLabel}`} className={`${compact ? 'h-9 w-9 justify-center px-0' : 'px-2.5'} inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 py-1 text-[10px] font-black text-amber-800`}>
        <CloudOff size={12} />
        {compact ? <span className="sr-only">Sin conexión</span> : <>SIN CONEXION{(state.pending > 0 || state.hasUnsyncedWrites) && <span>· {pendingLabel}</span>}</>}
      </span>
    )
  }

  if (state.pending > 0 || state.hasUnsyncedWrites) {
    return (
      <span title="Sincronizando" aria-label="Sincronizando" className={`${compact ? 'h-9 w-9 justify-center px-0' : 'px-2.5'} inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 py-1 text-[10px] font-black text-sky-800`}>
        <Loader2 size={12} className="animate-spin" />
        {compact ? <span className="sr-only">Sincronizando</span> : <>SINCRONIZANDO{state.pending > 0 ? ` · ${state.pending}` : ''}</>}
      </span>
    )
  }

  return (
    <span title="Sincronizado" aria-label="Sincronizado" className={`${compact ? 'h-9 w-9 justify-center px-0' : 'px-2.5'} inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 py-1 text-[10px] font-black text-emerald-800`}>
      <ShieldCheck size={compact ? 17 : 12} />
      {compact ? <span className="sr-only">Sincronizado</span> : 'SINCRONIZADO'}
    </span>
  )
}

export function InlineRefreshHint({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
      <RefreshCw size={12} /> {label}
    </p>
  )
}
