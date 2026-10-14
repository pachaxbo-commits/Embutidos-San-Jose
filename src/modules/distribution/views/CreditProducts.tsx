import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { getFirebaseContext } from '../../../lib/firebase'
import type { DistSaleLine } from '../types'
import { formatBs, formatQty } from './shared'

export function CreditProducts({
  lines,
  saleId,
  isVoid = false,
}: {
  lines?: DistSaleLine[]
  saleId?: string
  isVoid?: boolean
}) {
  const [historical, setHistorical] = useState<DistSaleLine[] | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!lines?.length && saleId) {
      setLoading(true)
      void (async () => {
        const ctx = await getFirebaseContext()
        if (!ctx) return
        const snap = await getDoc(doc(ctx.db, 'restaurants', ctx.restaurantId, 'distSales', saleId))
        if (!cancelled) {
          const data = snap.data()
          // Si la venta tiene effectiveSnapshot con líneas válidas (ej: corrección), usarlas; si no, lines originales
          const effectiveLines: DistSaleLine[] =
            data?.effectiveSnapshot?.lines && data.effectiveSnapshot.lines.length > 0
              ? data.effectiveSnapshot.lines
              : data?.lines || []
          setHistorical(effectiveLines)
          setLoading(false)
        }
      })().catch(() => {
        if (!cancelled) {
          setHistorical([])
          setLoading(false)
        }
      })
    } else {
      setHistorical(null)
      setLoading(false)
    }
    return () => {
      cancelled = true
    }
  }, [saleId, lines])

  const detail = lines?.length ? lines : (historical ?? [])
  const hasNoDetail = !detail.length && !loading

  return (
    <div className="my-2 rounded-xl border border-slate-200/70 bg-slate-50 p-2.5 text-xs text-slate-800">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">
          {isVoid ? 'Productos originales (Venta anulada)' : 'Productos de la venta'}
        </p>
        {isVoid && (
          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[9px] font-black text-rose-800">
            ANULADA
          </span>
        )}
      </div>

      {loading ? (
        <p className="text-[11px] font-semibold text-slate-400">Consultando detalle de productos...</p>
      ) : detail.length > 0 ? (
        <div className="space-y-1.5">
          {detail.map((line, index) => (
            <div
              key={index}
              className="flex items-baseline justify-between gap-2 border-b border-slate-200/60 pb-1 last:border-0 last:pb-0"
            >
              <div className="min-w-0 flex-1">
                <p className="break-words font-extrabold text-slate-900">
                  {line.productNameSnapshot}
                  {line.presentationSnapshot && (
                    <span className="font-normal text-slate-500"> · {line.presentationSnapshot}</span>
                  )}
                </p>
                <p className="text-[11px] font-semibold text-slate-600">
                  {formatQty(line.quantity, line.unitType)} × {formatBs(line.actualUnitPrice)} = {formatBs(line.subtotal)}
                </p>
              </div>
              <span className="shrink-0 font-extrabold tabular-nums text-slate-900">
                {formatBs(line.subtotal)}
              </span>
            </div>
          ))}
          <p className="mt-2 text-[10px] font-medium text-slate-400">
            Los abonos reducen el saldo total de la deuda; no se asignan a un producto específico.
          </p>
        </div>
      ) : hasNoDetail ? (
        <p className="text-[11px] font-semibold text-slate-500 italic">
          Detalle de productos no disponible para este registro histórico
        </p>
      ) : null}
    </div>
  )
}
