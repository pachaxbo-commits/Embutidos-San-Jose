import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { getFirebaseContext } from '../../../lib/firebase'
import type { DistSaleLine } from '../types'
import { formatBs, formatQty } from './shared'

export function CreditProducts({ lines, saleId }: { lines?: DistSaleLine[]; saleId?: string }) {
  const [historical, setHistorical] = useState<DistSaleLine[]>([])
  useEffect(() => {
    let cancelled = false
    if (!lines?.length && saleId) void (async () => {
      const ctx = await getFirebaseContext()
      if (!ctx) return
      const sale = await getDoc(doc(ctx.db, 'restaurants', ctx.restaurantId, 'distSales', saleId))
      if (!cancelled) setHistorical(sale.data()?.lines || [])
    })().catch(() => { if (!cancelled) setHistorical([]) })
    return () => { cancelled = true }
  }, [saleId, lines])
  const detail = lines?.length ? lines : historical
  return <div className="my-2 rounded-xl bg-slate-50 p-2 text-xs text-slate-700">
    <p className="mb-1 font-bold">Productos de la venta original</p>
    {detail.length ? detail.map((line, index) => <p key={index} className="break-words">
      {formatQty(line.quantity, line.unitType)} · {line.productNameSnapshot} · {formatBs(line.subtotal)}
    </p>) : <p>Venta anterior sin detalle guardado. Consulta el comprobante original.</p>}
    <p className="mt-1 text-[10px] text-slate-500">Los abonos reducen el saldo total; no se asignan a un producto especifico.</p>
  </div>
}
