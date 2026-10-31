import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { PROCESSING_WALKTHROUGH_STEPS } from './processingWalkthroughContent'

type Position = { left: number; top: number; width: number; height: number; cardLeft: number; cardTop: number; cardWidth: number; cardHeight: number; line: string }

function resolveAnchor(anchor: string): HTMLElement | null {
  if (anchor === 'discard') return document.querySelector<HTMLElement>('[data-processing-anchor="discard"]') ?? document.querySelector<HTMLElement>('[data-processing-anchor="destination-kind"]')
  if (anchor === 'source-lots') return document.querySelector<HTMLElement>('[data-processing-anchor="source-lots"]') ?? document.querySelector<HTMLElement>('[data-processing-anchor="source-product"]')
  if (anchor === 'source-quantity') return document.querySelector<HTMLElement>('[data-processing-anchor="source-quantity"]') ?? document.querySelector<HTMLElement>('[data-processing-anchor="source-lots"]') ?? document.querySelector<HTMLElement>('[data-processing-anchor="source-product"]')
  if (anchor === 'weight-basis') return document.querySelector<HTMLElement>('[data-processing-anchor="weight-basis"]') ?? document.querySelector<HTMLElement>('[data-processing-anchor="net-weight"]')
  return document.querySelector<HTMLElement>(`[data-processing-anchor="${anchor}"]`)
}

export function ProcessingWalkthrough({ open, onClose, onFormStepChange }: { open: boolean; onClose: () => void; onFormStepChange: (step: number) => void }) {
  const [index, setIndex] = useState(0)
  const [position, setPosition] = useState<Position | null>(null)
  const cardRef = useRef<HTMLElement>(null)
  const active = PROCESSING_WALKTHROUGH_STEPS[index]!

  useEffect(() => {
    if (!open) return
    onFormStepChange(active.formStep)
    let target: HTMLElement | null = null
    let anchorTimer = 0
    let measureTimer = 0
    let frame = 0
    let observer: ResizeObserver | undefined
    const measure = () => {
      if (!target?.isConnected) return
      const rect = target.getBoundingClientRect()
      const cardRect = cardRef.current?.getBoundingClientRect()
      const margin = 12
      const cardWidth = Math.min(380, Math.max(250, window.innerWidth - margin * 2))
      const cardHeight = cardRect?.height ?? 310
      const cardLeft = Math.max(margin, Math.min(window.innerWidth - cardWidth - margin, rect.left + rect.width / 2 - cardWidth / 2))
      const gap = 18
      const belowTop = rect.bottom + gap
      const aboveTop = rect.top - cardHeight - gap
      const cardTop = belowTop + cardHeight <= window.innerHeight - margin
        ? belowTop
        : aboveTop >= margin ? aboveTop : Math.max(margin, Math.min(window.innerHeight - cardHeight - margin, belowTop))
      const startX = Math.max(cardLeft + 18, Math.min(cardLeft + cardWidth - 18, rect.left + rect.width / 2))
      const startY = cardTop > rect.bottom ? cardTop : cardTop + cardHeight
      const endX = rect.left + rect.width / 2
      const endY = rect.top + rect.height / 2
      setPosition({ left: rect.left - 7, top: rect.top - 7, width: rect.width + 14, height: rect.height + 14, cardLeft, cardTop, cardWidth, cardHeight, line: `M ${startX} ${startY} L ${endX} ${endY}` })
    }
    const findTarget = (attempt = 0) => {
      target = resolveAnchor(active.anchor)
      if (!target) {
        if (attempt < 20) anchorTimer = window.setTimeout(() => findTarget(attempt + 1), 50)
        else setPosition(null)
        return
      }
      target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
      measureTimer = window.setTimeout(() => {
        measure()
        frame = requestAnimationFrame(measure)
        if (typeof ResizeObserver !== 'undefined' && target) {
          observer = new ResizeObserver(measure)
          observer.observe(target)
          if (cardRef.current) observer.observe(cardRef.current)
        }
      }, 380)
    }
    anchorTimer = window.setTimeout(() => findTarget(), 0)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.clearTimeout(measureTimer)
      window.clearTimeout(anchorTimer)
      cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [active, open, onFormStepChange])

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null
  const go = (nextIndex: number) => {
    setPosition(null)
    setIndex(Math.max(0, Math.min(PROCESSING_WALKTHROUGH_STEPS.length - 1, nextIndex)))
  }
  return createPortal(<div className="fixed inset-0 z-[1000]" data-processing-walkthrough="true">
    {position && <>
      <div aria-hidden="true" className="pointer-events-none fixed rounded-xl border-2 border-sky-400 shadow-[0_0_0_9999px_rgba(15,23,42,0.58)] transition-[top,left,width,height] duration-200" style={{ left: position.left, top: position.top, width: position.width, height: position.height, zIndex: 1000 }} />
      <svg aria-hidden="true" className="pointer-events-none fixed inset-0 h-full w-full" style={{ zIndex: 1001 }}>
        <defs><marker id="processing-guide-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="#38bdf8" /></marker></defs>
        <path data-processing-arrow="true" d={position.line} fill="none" stroke="#38bdf8" strokeWidth="3" markerEnd="url(#processing-guide-arrow)" />
      </svg>
    </>}
    <section ref={cardRef} role="dialog" aria-modal="false" aria-label={`Tutorial de sacheteado: ${active.title}`} className="fixed max-h-[62dvh] overflow-y-auto rounded-2xl border border-sky-200 bg-white p-4 text-slate-900 shadow-2xl" style={{ left: position?.cardLeft ?? 12, top: position?.cardTop ?? 12, width: position?.cardWidth ?? 'min(380px, calc(100vw - 24px))', maxHeight: 'min(62dvh, 540px)', zIndex: 1002 }}>
      <div className="mb-2 flex items-start justify-between gap-3"><div><p className="text-[11px] font-extrabold uppercase tracking-wide text-sky-700">Paso {index + 1} de {PROCESSING_WALKTHROUGH_STEPS.length}</p><h2 className="mt-1 text-lg font-black">{active.title}</h2></div><button type="button" aria-label="Cerrar tutorial" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-slate-500 hover:bg-slate-100"><X size={18} /></button></div>
      <dl className="space-y-2 text-sm leading-relaxed"><div><dt className="font-extrabold">Qué colocar</dt><dd>{active.what}</dd></div><div><dt className="font-extrabold">Por qué</dt><dd>{active.why}</dd></div><div className="rounded-lg bg-sky-50 p-2"><dt className="font-extrabold">Ejemplo</dt><dd>{active.example}</dd></div><div className="rounded-lg bg-amber-50 p-2 text-amber-950"><dt className="font-extrabold">Atención</dt><dd>{active.warning}</dd></div></dl>
      <div className="mt-3 grid grid-cols-3 gap-2"><button type="button" onClick={() => go(index - 1)} disabled={index === 0} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border border-slate-200 px-2 text-xs font-extrabold disabled:opacity-40"><ArrowLeft size={15} />Anterior</button><button type="button" onClick={() => index === PROCESSING_WALKTHROUGH_STEPS.length - 1 ? onClose() : go(index + 1)} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-sky-700 px-2 text-xs font-extrabold text-white">{index === PROCESSING_WALKTHROUGH_STEPS.length - 1 ? 'Finalizar' : <>Siguiente<ArrowRight size={15} /></>}</button><button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-slate-200 px-2 text-xs font-extrabold">Cerrar</button></div>
    </section>
  </div>, document.body)
}

const CONTEXTUAL_HELP: Record<string, string> = {
  sourceQuantity: 'Ingrese los kg que realmente retiró de este lote. Esa es la cantidad que el servidor descontará del inventario.',
  netWeight: 'Peso neto total del alimento de todos los sachets, sin bolsas. El sistema no descuenta la tara.',
  nominalWeight: 'Peso comercial por sachet; es informativo y nunca reemplaza el peso real total.',
  weightBasis: 'Peso total medido es una medición física neta. Promedio documentado requiere respaldo; esta opción no calcula el peso.',
  discard: 'Registre solo alimento físicamente descartado, con peso real y motivo. No es una diferencia para ajustar.',
  expiry: 'Vencimiento asignado al producto terminado. Puede superar al granel; debe ser igual o posterior al embolsado.',
  difference: 'La diferencia debe ser exactamente 0 g. Revise el pesaje y los destinos físicos, no ajuste cifras para habilitar Confirmar.',
}

export function ProcessingContextHelp({ topic }: { topic: keyof typeof CONTEXTUAL_HELP }) {
  const [shown, setShown] = useState(false)
  return <div className="mt-1">
    <button type="button" aria-label={`Ayuda: ${CONTEXTUAL_HELP[topic]}`} aria-expanded={shown} onClick={() => setShown(value => !value)} className="inline-flex min-h-8 items-center gap-1 rounded-lg px-1 text-[11px] font-bold text-sky-800 underline decoration-dotted underline-offset-2"><span aria-hidden="true" className="grid h-4 w-4 place-items-center rounded-full border border-sky-700 text-[10px]">?</span>Ayuda</button>
    {shown && <p role="note" className="mt-1 rounded-lg border border-sky-200 bg-sky-50 p-2 text-xs leading-relaxed text-sky-950">{CONTEXTUAL_HELP[topic]}</p>}
  </div>
}
