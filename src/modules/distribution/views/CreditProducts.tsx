import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { getFirebaseContext } from '../../../lib/firebase'
import type { DistReceivableLineAdjustment, DistSaleLine } from '../types'
import { formatBs, formatQty } from './shared'

export function CreditProducts({
  lines,
  saleId,
  creditLines,
  isVoid = false,
}: {
  lines?: DistSaleLine[]
  saleId?: string
  creditLines?: DistReceivableLineAdjustment[]
  isVoid?: boolean
}) {
  const [historical, setHistorical] = useState<{ saleId: string; lines: DistSaleLine[] } | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!lines?.length && saleId) {
      void (async () => {
        const ctx = await getFirebaseContext()
        if (!ctx) {
          if (!cancelled) setHistorical({ saleId, lines: [] })
          return
        }
        const snap = await getDoc(doc(ctx.db, 'restaurants', ctx.restaurantId, 'distSales', saleId))
        if (!cancelled) {
          const data = snap.data()
          // Si la venta tiene effectiveSnapshot con líneas válidas (ej: corrección), usarlas; si no, lines originales
          const effectiveLines: DistSaleLine[] =
            data?.effectiveSnapshot?.lines && data.effectiveSnapshot.lines.length > 0
              ? data.effectiveSnapshot.lines
              : data?.lines || []
          setHistorical({ saleId, lines: effectiveLines })
        }
      })().catch(() => {
        if (!cancelled) setHistorical({ saleId, lines: [] })
      })
    }
    return () => {
      cancelled = true
    }
  }, [saleId, lines])

  const cachedDetail = historical && historical.saleId === saleId ? historical.lines : []
  const detail = lines?.length ? lines : cachedDetail
  const loading = !lines?.length && Boolean(saleId) && historical?.saleId !== saleId
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
                  {creditLines?.[index] && <span className="block text-amber-800">Importe de deuda asignado: {formatBs(creditLines[index].creditAmount)}</span>}
                </p>
              </div>
              <span className="shrink-0 font-extrabold tabular-nums text-slate-900">
                {formatBs(line.subtotal)}
              </span>
            </div>
          ))}
          <p className="mt-2 text-[10px] font-medium text-slate-400">
            {creditLines?.length
              ? 'El importe de deuda por producto es una distribución administrativa; no cambia cantidades, precios ni la venta original.'
              : 'Los abonos reducen el saldo total de la deuda; no se asignan a un producto específico.'}
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
