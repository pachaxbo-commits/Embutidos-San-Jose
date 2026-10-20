import type { DistClosure } from '../types'
import { formatBs } from './shared'

export function ClosureRectificationAudit({ closure, onSelect }: {
  closure: DistClosure
  onSelect?: (mode: 'original' | 'corrected') => void
}) {
  const audit = closure.rectification
  if (!audit) return null
  const mode = closure.rectificationView || 'corrected'
  const fieldLabel = (field: string) => {
    const parts = field.split('.')
    if (parts[0] === 'products') return `${audit.original.products.find(p => p.productId === parts[1])?.productName || 'Producto'} · ${parts[2] === 'sold' ? 'Vendido' : 'Cortesía'}`
    return ({ cashSales: 'Ventas efectivo', qrSales: 'Ventas QR', creditGenerated: 'Crédito generado', expectedCash: 'Efectivo esperado', cashDifference: 'Diferencia de caja' } as Record<string,string>)[field] || field
  }
  return <section aria-label="Auditoría de rectificación" className="grid min-w-0 gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-slate-800">
    <strong className="text-blue-900">RECTIFICADO · Versión {audit.version}</strong>
    <p>{new Date(audit.createdAt).toLocaleString('es-BO', { timeZone: 'America/La_Paz' })} · {audit.createdByName}</p>
    <p className="break-words"><strong>Motivo:</strong> {audit.reason}</p>
    <p>El original conserva su diferencia calculada de <strong>{formatBs(audit.original.cashDifference)}</strong>. El cierre conciliado muestra <strong>{formatBs(audit.corrected.cashDifference)}</strong>. El efectivo declarado no cambió.</p>
    {onSelect && <div className="flex flex-wrap gap-2">{(['corrected','original'] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} onClick={() => onSelect(value)} className={`min-h-11 rounded-xl border px-3 py-2 font-bold ${mode === value ? 'border-blue-700 bg-blue-700 text-white' : 'border-blue-200 bg-white text-blue-900'}`}>{value === 'original' ? 'Ver cierre original' : 'Ver cierre conciliado'}</button>)}</div>}
    <p className="font-bold">Mostrando: {mode === 'original' ? 'cierre original preservado' : 'cierre conciliado'}</p>
    <details><summary className="cursor-pointer py-2 font-bold">Campos modificados y evidencia</summary><ul className="grid gap-2">{audit.changes.map(change => <li key={change.field} className="min-w-0 rounded-lg bg-white p-2"><strong>{fieldLabel(change.field)}</strong>: {change.field.startsWith('products.') ? `${change.before} → ${change.after}` : `${formatBs(change.before)} → ${formatBs(change.after)}`}<p className="break-all text-[10px] text-slate-500">{change.sourceDocumentIds.join(' · ')}</p></li>)}</ul></details>
  </section>
}
