import { toDayKey } from '../domain/engine'
import { useState } from 'react'
import { Check, CheckCircle2 } from 'lucide-react'
import { Screen } from '../../../components/ui/Screen'
import { Modal } from '../../../components/ui/Modal'
import { Field, TextInput } from '../../../components/ui/Form'
import { RangePicker } from './RangePicker'
import { verifyQr } from '../data/distributionRepository'
import { KpiCard, PrimaryButton, formatBs } from './shared'
import type { DistributionViewProps } from './DistributionApp'

export function QrView({ session, data }: DistributionViewProps) {
  const [target, setTarget] = useState<{ type: 'sale' | 'collection' | 'claim'; id: string } | null>(null)
  const [reference, setReference] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const rows = [
    ...data.sales.filter(s => s.qrAmount > 0 && !s.pendingConfirmation).map(s => ({ id: s.id, type: 'sale' as const, amount: s.qrAmount, name: s.customerName || 'Cliente ocasional', at: s.createdAt })),
    ...data.collections.filter(c => c.method === 'qr' && !c.pendingConfirmation).map(c => ({ id: c.id, type: 'collection' as const, amount: c.amount, name: c.customerName, at: c.createdAt })),
    ...data.claims.filter(c => c.qrIn > 0 && session.dayKeys.includes(toDayKey(c.createdAt))).map(c => ({ id:c.id, type:'claim' as const, amount:c.qrIn, name:c.customerName, at:c.createdAt })),
  ].sort((a, b) => b.at.localeCompare(a.at))
  const requiresVerification = data.supportSettings.requireQrVerification
  const confirmed = requiresVerification ? rows.filter(r => data.qrVerifications.some(v => v.id === `${r.type}_${r.id}`)) : rows
  const total = rows.reduce((sum, r) => sum + r.amount, 0)
  const verified = confirmed.reduce((sum, r) => sum + r.amount, 0)
  const submit = async () => {
    if (!target || busy) return
    setBusy(true); setError('')
    try { await verifyQr(target.type, target.id, reference); setTarget(null) }
    catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  return <Screen title="Verificar QR" subtitle={requiresVerification ? 'Confirma cada depósito después de revisarlo en el banco' : 'La confirmación manual está desactivada en Configuración'}>
    <div className="grid gap-3">
      <RangePicker dayKeys={session.dayKeys} onChange={session.setDayKeys} />
      <div className="grid grid-cols-2 gap-2"><KpiCard label="QR confirmado" value={formatBs(verified)} tone="positive" /><KpiCard label="QR pendiente" value={formatBs(total - verified)} tone="warning" /></div>
      <p className="text-xs text-slate-600">El QR confirmado cuenta como ingreso bancario. Nunca aumenta el efectivo que el vendedor debe entregar.</p>
      {!rows.length && <p className="p-4 text-sm text-slate-500">No hay pagos QR en este periodo.</p>}
      {rows.map(row => {
        const verification = data.qrVerifications.find(v => v.id === `${row.type}_${row.id}`)
        return <div key={`${row.type}_${row.id}`} className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border bg-white p-3 ${verification ? 'border-emerald-200' : 'border-slate-200'}`}>
          <div className="min-w-0"><p className="break-words text-sm font-bold">{row.name} · {formatBs(row.amount)}</p>
          <p className="text-[11px] text-slate-500">{row.type === 'sale' ? 'Venta' : row.type === 'claim' ? 'Diferencia de cambio' : 'Cobro'} · {new Date(row.at).toLocaleString('es-BO')}</p>
          {verification && <p className="mt-1 break-words text-[10px] font-semibold text-emerald-700">{verification.reference} · {new Date(verification.verifiedAt).toLocaleString('es-BO')}</p>}</div>
          {verification || !requiresVerification ? <span title={verification ? 'Depósito confirmado' : 'Confirmación automática'} className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><CheckCircle2 size={20} /></span> :
            <button type="button" aria-label={`Confirmar depósito de ${row.name}`} onClick={() => { setTarget({ type: row.type, id: row.id }); setReference(''); setError('') }} className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--primary)] text-white shadow-sm"><Check size={20} /></button>}
        </div>
      })}
    </div>
    <Modal isOpen={!!target} onClose={() => setTarget(null)} title="Confirmar QR recibido" footer={<PrimaryButton full disabled={busy} onClick={() => void submit()}>{busy ? 'Confirmando...' : 'Guardar verificacion'}</PrimaryButton>}>
      <Field label="Referencia bancaria / comprobante" required><TextInput value={reference} onChange={e => setReference(e.target.value)} /></Field>
      <p className="mt-2 text-xs text-slate-500">Confirma solo despues de comprobar el abono en la cuenta bancaria. Requiere conexion.</p>
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    </Modal>
  </Screen>
}
