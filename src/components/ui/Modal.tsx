import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useBackHandler } from '../../hooks/useBackHandler'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  /** Acciones fijas al pie: siempre visibles, nunca fuera del viewport */
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  /** En movil se presenta como hoja inferior; en escritorio como dialogo centrado */
  variant?: 'sheet' | 'dialog'
}

const SIZE_CLASS: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-3xl',
}

/**
 * Modal responsive base de PACHAX Flow.
 *
 * Reglas que resuelve de forma reutilizable (no parcheada por pantalla):
 * - nunca supera el viewport: usa 100dvh y scroll interno en el cuerpo
 * - respeta safe-area superior/inferior y el teclado de Android
 * - el pie de acciones queda siempre accesible
 * - el boton fisico "atras" cierra primero el modal
 */
export function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
  variant = 'sheet',
}: ModalProps) {
  useBackHandler(isOpen, () => {
    onClose()
    return true
  })

  useEffect(() => {
    if (!isOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isOpen])

  if (!isOpen) return null

  const isSheet = variant === 'sheet'

  return (
    <div
      className={`fixed inset-0 z-50 flex bg-slate-900/40 ${
        isSheet ? 'items-end sm:items-center' : 'items-center'
      } justify-center sm:p-4`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="Cerrar"
        className="absolute inset-0 h-full w-full cursor-default"
        onClick={onClose}
      />

      <div
        className={`relative z-10 flex w-full ${SIZE_CLASS[size]} flex-col overflow-hidden bg-white shadow-modal ${
          isSheet ? 'rounded-t-3xl sm:rounded-3xl' : 'rounded-3xl'
        }`}
        style={{ maxHeight: 'calc(100dvh - var(--safe-top) - 1rem)' }}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <h2 className="break-words text-sm font-extrabold tracking-tight text-slate-900">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[11px] font-medium text-slate-500">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          >
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>

        {footer && (
          <footer
            className="shrink-0 border-t border-slate-200 bg-white px-4 py-3"
            style={{ paddingBottom: 'calc(0.75rem + var(--safe-bottom))' }}
          >
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}
