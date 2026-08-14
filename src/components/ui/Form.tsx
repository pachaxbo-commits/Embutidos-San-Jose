import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

/**
 * Primitivos de formulario mobile-first.
 *
 * Todos los controles son width:100% dentro de su contenedor y usan
 * min-height 44px (touch target). Ningun control define anchos fijos en px,
 * que era la causa real de los formularios mas anchos que la pantalla.
 */

const CONTROL_CLASS =
  'w-full min-w-0 min-h-[44px] rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-900 outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary-soft)] disabled:bg-slate-100 disabled:text-slate-400'

interface FieldProps {
  label: string
  hint?: string
  error?: string | null
  required?: boolean
  children: ReactNode
}

export function Field({ label, hint, error, required, children }: FieldProps) {
  return (
    <label className="block w-full min-w-0">
      <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
        {label}
        {required && <span className="ml-1 text-[var(--danger)]">*</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-[11px] font-medium text-slate-400">{hint}</span>}
      {error && <span className="mt-1 block text-[11px] font-bold text-[var(--danger)]">{error}</span>}
    </label>
  )
}

export function TextInput({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${CONTROL_CLASS} ${className}`} />
}

/**
 * Entrada numerica pensada para cantidades/precios en calle:
 * teclado decimal en Android, sin flechas, sin scroll accidental.
 */
export function NumberInput({
  className = '',
  onWheel,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      type="number"
      inputMode="decimal"
      onWheel={(event) => {
        ;(event.target as HTMLInputElement).blur()
        onWheel?.(event)
      }}
      className={`${CONTROL_CLASS} tabular-nums ${className}`}
    />
  )
}

export function SelectInput({ className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`${CONTROL_CLASS} ${className}`}>
      {children}
    </select>
  )
}

export function TextArea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${CONTROL_CLASS} min-h-[88px] resize-y ${className}`} />
}

/** Rejilla de formulario: 1 columna en movil, 2 solo en pantallas amplias. */
export function FormGrid({ children, columns = 2 }: { children: ReactNode; columns?: 1 | 2 }) {
  return (
    <div className={`grid w-full min-w-0 gap-3 ${columns === 2 ? 'sm:grid-cols-2' : ''}`}>{children}</div>
  )
}

interface SegmentedOption<T extends string> {
  value: T
  label: string
}

/** Selector de pocas opciones, con targets tactiles grandes. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: SegmentedOption<T>[]
  onChange: (value: T) => void
}) {
  return (
    <div className="flex w-full min-w-0 flex-wrap gap-1.5 rounded-2xl bg-slate-100 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`min-h-[40px] flex-1 basis-[calc(50%-0.375rem)] rounded-xl px-3 text-xs font-extrabold transition sm:basis-0 ${
            value === option.value
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
