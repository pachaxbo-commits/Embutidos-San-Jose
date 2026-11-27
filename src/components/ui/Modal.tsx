import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
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
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** En movil se presenta como hoja inferior; en escritorio como dialogo centrado */
  variant?: 'sheet' | 'dialog'
  /** Altura máxima de la hoja en móvil; en escritorio conserva el tamaño habitual. */
  mobileMaxHeight?: string
  /** Conserva el fondo inerte en formularios donde un clic fuera puede perder trabajo. */
  closeOnBackdrop?: boolean
  /** Barra de desplazamiento visible para el formulario principal de despacho. */
  scrollbar?: 'default' | 'dispatch'
}

const SIZE_CLASS: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-3xl',
  xl: 'sm:max-w-5xl',
}

/**
 * Modal responsive de Embutidos San José.
 *
 * Reglas que resuelve de forma reutilizable (no parcheada por pantalla):
 * - nunca supera el viewport: usa 100dvh y scroll interno en el cuerpo
 * - respeta safe-area superior/inferior y el teclado de Android
 * - el pie de acciones queda siempre accesible
 * - el boton fisico "atras" cierra primero el modal
 */
let activeModalsCount = 0

export function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
  variant = 'sheet',
  mobileMaxHeight,
  closeOnBackdrop = true,
  scrollbar = 'default',
}: ModalProps) {
  const dispatchScrollRef = useRef<HTMLDivElement>(null)
  const dispatchTrackRef = useRef<HTMLDivElement>(null)
  const dragOffsetRef = useRef<number | null>(null)
  const [dispatchScroll, setDispatchScroll] = useState({ top: 0, clientHeight: 0, scrollHeight: 0 })

  useEffect(() => {
    if (!isOpen || scrollbar !== 'dispatch') return
    const node = dispatchScrollRef.current
    if (!node) return
    const update = () => setDispatchScroll({ top: node.scrollTop, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    node.addEventListener('scroll', update, { passive: true })
    return () => { observer.disconnect(); node.removeEventListener('scroll', update) }
  }, [isOpen, scrollbar, children])

  const dispatchTrackHeight = Math.max(0, dispatchScroll.clientHeight - 16)
  const dispatchThumbHeight = dispatchScroll.scrollHeight > 0
    ? Math.min(dispatchTrackHeight, Math.max(40, dispatchTrackHeight * dispatchScroll.clientHeight / dispatchScroll.scrollHeight))
    : dispatchTrackHeight
  const dispatchMaxScroll = Math.max(0, dispatchScroll.scrollHeight - dispatchScroll.clientHeight)
  const dispatchThumbTop = dispatchMaxScroll > 0
    ? (dispatchScroll.top / dispatchMaxScroll) * Math.max(0, dispatchTrackHeight - dispatchThumbHeight)
    : 0

  const moveDispatchScrollThumb = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragOffsetRef.current === null) return
    const track = dispatchTrackRef.current
    const scroller = dispatchScrollRef.current
    if (!track || !scroller) return
    const range = Math.max(1, track.clientHeight - dispatchThumbHeight)
    const thumbTop = Math.max(0, Math.min(range, event.clientY - track.getBoundingClientRect().top - dragOffsetRef.current))
    scroller.scrollTop = (thumbTop / range) * dispatchMaxScroll
  }

  const startDispatchScrollThumb = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || dispatchMaxScroll <= 0) return
    const track = dispatchTrackRef.current
    if (!track) return
    const thumb = track.querySelector<HTMLElement>('[data-scroll-thumb]')
    const thumbRect = thumb?.getBoundingClientRect()
    const onThumb = Boolean(thumb && event.target instanceof Element && event.target.closest('[data-scroll-thumb]'))
    dragOffsetRef.current = onThumb && thumbRect ? event.clientY - thumbRect.top : dispatchThumbHeight / 2
    event.currentTarget.setPointerCapture(event.pointerId)
    moveDispatchScrollThumb(event)
    event.preventDefault()
  }

  useBackHandler(isOpen, () => {
    onClose()
    return true
  })

  useEffect(() => {
    if (!isOpen) return
    activeModalsCount++
    document.body.style.overflow = 'hidden'
    return () => {
      activeModalsCount = Math.max(0, activeModalsCount - 1)
      if (activeModalsCount === 0) {
        document.body.style.overflow = ''
      }
    }
  }, [isOpen])

  if (!isOpen) return null

  const isSheet = variant === 'sheet'

  return (
    <div
      className={`fixed inset-0 z-50 flex bg-slate-900/40 ${
        isSheet ? (mobileMaxHeight ? 'items-end min-[641px]:items-center' : 'items-end sm:items-center') : 'items-center'
      } justify-center sm:p-4`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {closeOnBackdrop
        ? <button type="button" aria-label="Cerrar" className="absolute inset-0 h-full w-full cursor-default" onClick={onClose} />
        : <div aria-hidden="true" className="absolute inset-0 h-full w-full" />}

      <div
        className={`relative z-10 flex w-full ${SIZE_CLASS[size]} flex-col overflow-hidden bg-white shadow-modal ${mobileMaxHeight ? 'max-h-[var(--modal-mobile-max-height)] min-[641px]:max-h-[calc(100dvh-var(--safe-top)-1rem)]' : ''} ${
          isSheet ? (mobileMaxHeight ? 'rounded-t-3xl min-[641px]:rounded-3xl' : 'rounded-t-3xl sm:rounded-3xl') : 'rounded-3xl'
        }`}
        style={mobileMaxHeight
          ? { '--modal-mobile-max-height': mobileMaxHeight } as CSSProperties
          : { maxHeight: 'calc(100dvh - var(--safe-top) - 1rem)' }}
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

        {scrollbar === 'dispatch' ? <div className="relative min-h-0 flex-none overflow-hidden" style={{ height: 'calc(100dvh - var(--safe-top) - 12rem)' }}>
          <div id="dispatch-form-scroll" ref={dispatchScrollRef} data-dispatch-scroller className="modal-scrollbar-dispatch h-full overflow-y-auto overscroll-contain px-4 py-4 pr-8" onScroll={() => { const node = dispatchScrollRef.current; if (node) setDispatchScroll({ top: node.scrollTop, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight }) }}>{children}</div>
          <div ref={dispatchTrackRef} data-dispatch-scrollbar role="scrollbar" aria-label="Desplazamiento del despacho" aria-controls="dispatch-form-scroll" aria-orientation="vertical" aria-valuemin={0} aria-valuemax={dispatchMaxScroll} aria-valuenow={Math.round(dispatchScroll.top)} tabIndex={0} className="dispatch-scrollbar-track absolute bottom-2 right-1 top-2 hidden touch-none select-none" onPointerDown={startDispatchScrollThumb} onPointerMove={moveDispatchScrollThumb} onPointerUp={() => { dragOffsetRef.current = null }} onPointerCancel={() => { dragOffsetRef.current = null }} onLostPointerCapture={() => { dragOffsetRef.current = null }} onKeyDown={event => {
            const node = dispatchScrollRef.current
            if (!node) return
            if (event.key === 'ArrowDown') node.scrollTop += 40
            else if (event.key === 'ArrowUp') node.scrollTop -= 40
            else if (event.key === 'PageDown') node.scrollTop += node.clientHeight
            else if (event.key === 'PageUp') node.scrollTop -= node.clientHeight
            else if (event.key === 'Home') node.scrollTop = 0
            else if (event.key === 'End') node.scrollTop = node.scrollHeight
            else return
            event.preventDefault()
          }}><div data-scroll-thumb className="dispatch-scrollbar-thumb absolute left-0 right-0 rounded-full" style={{ height: dispatchThumbHeight, top: dispatchThumbTop }} /></div>
        </div> : <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>}

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
