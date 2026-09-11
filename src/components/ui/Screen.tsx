import type { ReactNode } from 'react'
import { AlertTriangle, ArrowLeft, Inbox, Loader2 } from 'lucide-react'

/**
 * Contenedor de pantalla y estados compartidos.
 *
 * `Screen` garantiza que ninguna vista genere overflow horizontal:
 * el ancho lo define el contenedor (min-w-0 + w-full), no el contenido.
 * `onBack` obliga a que toda pantalla secundaria tenga una salida visible.
 */

interface ScreenProps {
  title: string
  subtitle?: string
  onBack?: () => void
  actions?: ReactNode
  children: ReactNode
}

export function Screen({ title, subtitle, onBack, actions, children }: ScreenProps) {
  return (
    <section className="w-full min-w-0">
      <header className="mb-3 flex w-full min-w-0 items-start gap-2.5">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Volver"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
          >
            <ArrowLeft size={18} />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-extrabold leading-tight tracking-tight text-slate-900 sm:text-xl">{title}</h1>
          {subtitle && <p className="mt-0.5 text-xs font-medium leading-snug text-slate-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </header>
      <div className="w-full min-w-0">{children}</div>
    </section>
  )
}

export function LoadingState({ label = 'Cargando...' }: { label?: string }) {
  return (
    <div className="flex w-full flex-col items-center justify-center gap-2 rounded-3xl border border-slate-200 bg-white px-4 py-10 text-slate-500">
      <Loader2 size={22} className="animate-spin text-[var(--primary)]" />
      <p className="text-xs font-bold">{label}</p>
    </div>
  )
}

export function EmptyBlock({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex w-full flex-col items-center justify-center gap-2 rounded-3xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center">
      <Inbox size={22} className="text-slate-400" />
      <p className="text-sm font-extrabold text-slate-700">{title}</p>
      {description && <p className="max-w-sm text-xs font-medium text-slate-500">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex w-full flex-col items-center justify-center gap-2 rounded-3xl border border-rose-200 bg-rose-50 px-4 py-8 text-center">
      <AlertTriangle size={22} className="text-rose-600" />
      <p className="max-w-md text-xs font-bold text-rose-800">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 min-h-[40px] rounded-2xl border border-rose-300 bg-white px-4 text-xs font-extrabold text-rose-700"
        >
          Reintentar
        </button>
      )}
    </div>
  )
}

/**
 * Tabla responsive: en movil se apila como tarjetas, en escritorio es tabla.
 * Evita rejillas gigantes estilo Excel en pantallas pequenas.
 */
export interface ResponsiveColumn<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  align?: 'left' | 'right'
  /** Se oculta en la tarjeta movil (dato secundario) */
  hideOnMobile?: boolean
}

export function ResponsiveTable<T>({
  columns,
  rows,
  keyOf,
  titleOf,
  onRowClick,
}: {
  columns: ResponsiveColumn<T>[]
  rows: T[]
  keyOf: (row: T) => string
  titleOf?: (row: T) => ReactNode
  onRowClick?: (row: T) => void
}) {
  return (
    <>
      {/* Movil: tarjetas compactas */}
      <div className="flex w-full flex-col gap-2 md:hidden">
        {rows.map((row) => (
          <div
            key={keyOf(row)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={`w-full min-w-0 rounded-2xl border border-slate-200 bg-white p-3 ${
              onRowClick ? 'cursor-pointer active:bg-slate-50' : ''
            }`}
          >
            {titleOf && <div className="mb-1.5 text-sm font-extrabold text-slate-900">{titleOf(row)}</div>}
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {columns
                .filter((column) => !column.hideOnMobile)
                .map((column) => (
                  <div key={column.key} className="min-w-0">
                    <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{column.header}</dt>
                    <dd className="break-words text-xs font-bold leading-snug text-slate-800">{column.render(row)}</dd>
                  </div>
                ))}
            </dl>
          </div>
        ))}
      </div>

      {/* Escritorio: tabla con scroll horizontal propio, nunca del body */}
      <div className="hidden w-full min-w-0 overflow-x-auto rounded-2xl border border-slate-200 bg-white md:block">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="bg-slate-50 text-[10px] font-extrabold uppercase tracking-wide text-slate-500">
            <tr>
              {titleOf && <th className="px-3 py-2">Detalle</th>}
              {columns.map((column) => (
                <th key={column.key} className={`px-3 py-2 ${column.align === 'right' ? 'text-right' : ''}`}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr
                key={keyOf(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={onRowClick ? 'cursor-pointer hover:bg-slate-50' : ''}
              >
                {titleOf && <td className="px-3 py-2 font-extrabold text-slate-900">{titleOf(row)}</td>}
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-3 py-2 font-semibold text-slate-700 ${column.align === 'right' ? 'text-right tabular-nums' : ''}`}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
