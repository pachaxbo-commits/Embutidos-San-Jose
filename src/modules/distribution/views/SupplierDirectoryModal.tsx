import { useMemo, useState } from 'react'
import { Field, TextArea, TextInput } from '../../../components/ui/Form'
import { Modal } from '../../../components/ui/Modal'
import { saveExpenseSupplier, newOperationId } from '../data/distributionRepository'
import type { DistPayable, DistSupplier } from '../types'
import { PrimaryButton, SecondaryButton, formatBs } from './shared'

type SupplierForm = Pick<DistSupplier, 'name' | 'legalName' | 'nit' | 'address' | 'contactName' | 'phone' | 'email' | 'note'>
const blankSupplier = (): SupplierForm => ({ name: '', legalName: '', nit: '', address: '', contactName: '', phone: '', email: '', note: '' })

export function SupplierDirectoryModal({ suppliers, payables, readOnly, initialCreate = false, onClose, onSaved }: {
  suppliers: DistSupplier[]
  payables: DistPayable[]
  readOnly: boolean
  initialCreate?: boolean
  onClose: () => void
  onSaved: (supplierId: string) => void
}) {
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [editingId, setEditingId] = useState(initialCreate ? '__new__' : '')
  const [form, setForm] = useState<SupplierForm>(blankSupplier)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const selected = suppliers.find(row => row.id === selectedId) || null
  const purchases = useMemo(() => selected ? payables.filter(row => row.supplierId === selected.id).sort((a, b) => b.dayKey.localeCompare(a.dayKey)) : [], [payables, selected])
  const visible = useMemo(() => suppliers.filter(row => `${row.name} ${row.legalName || ''}`.toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es'))).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'es')), [suppliers, search])
  const beginNew = () => { setSelectedId(''); setEditingId('__new__'); setForm(blankSupplier()); setError('') }
  const beginEdit = (supplier: DistSupplier) => {
    setSelectedId(supplier.id); setEditingId(supplier.id); setForm({ name: supplier.name || '', legalName: supplier.legalName || '', nit: supplier.nit || '', address: supplier.address || '', contactName: supplier.contactName || '', phone: supplier.phone || '', email: supplier.email || '', note: supplier.note || '' }); setError('')
  }
  const save = async () => {
    if (!form.name.trim()) { setError('El nombre comercial es obligatorio.'); return }
    setBusy(true); setError('')
    try {
      const isNew = editingId === '__new__'
      const id = isNew ? newOperationId('supplier') : editingId
      const current = suppliers.find(row => row.id === id)
      await saveExpenseSupplier({ supplierId: id, ...form, active: current?.active ?? true })
      setSelectedId(id); setEditingId(''); onSaved(id)
    } catch (failure) { setError((failure as Error).message || 'No se pudo guardar el proveedor.') }
    finally { setBusy(false) }
  }
  const toggleActive = async (supplier: DistSupplier) => {
    const next = !supplier.active
    if (!window.confirm(`${next ? 'Reactivar' : 'Desactivar'} a ${supplier.name}? Su historial de compras y pagos se conservará.`)) return
    setBusy(true); setError('')
    try {
      await saveExpenseSupplier({ supplierId: supplier.id, name: supplier.name, legalName: supplier.legalName, nit: supplier.nit, address: supplier.address, contactName: supplier.contactName, phone: supplier.phone, email: supplier.email, note: supplier.note, active: next })
      setSelectedId(supplier.id)
    } catch (failure) { setError((failure as Error).message || 'No se pudo cambiar el estado del proveedor.') }
    finally { setBusy(false) }
  }
  const set = (key: keyof SupplierForm, value: string) => setForm(current => ({ ...current, [key]: value }))
  const status = (row: DistPayable) => row.status === 'paid' ? 'Pagada' : row.status === 'partial' ? 'Parcial' : row.status === 'voided' ? 'Anulada' : 'Pendiente'
  return <Modal isOpen onClose={() => !busy && onClose()} title="Proveedores" subtitle="Directorio administrativo e historial de compras. Los cambios no reescriben documentos históricos." footer={editingId ? <div className="grid grid-cols-2 gap-2"><SecondaryButton full disabled={busy} onClick={() => setEditingId('')}>Cancelar</SecondaryButton><PrimaryButton full disabled={readOnly || busy || !form.name.trim()} onClick={() => void save()}>{busy ? 'Guardando…' : 'Guardar proveedor'}</PrimaryButton></div> : <div className="grid grid-cols-2 gap-2"><SecondaryButton full onClick={onClose}>Cerrar</SecondaryButton><PrimaryButton full disabled={readOnly} onClick={beginNew}>Nuevo proveedor</PrimaryButton></div>}>
    <div className="grid min-w-0 gap-4">
      <Field label="Buscar por nombre o razón social"><TextInput value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar proveedor"/></Field>
      <div className="max-h-52 overflow-y-auto rounded-xl border border-slate-200">{visible.length ? visible.map(row => <article key={row.id} className={`flex flex-wrap items-center gap-2 border-b border-slate-100 p-2 last:border-b-0 ${selectedId === row.id ? 'bg-sky-50' : ''}`}><button type="button" className="min-w-0 flex-1 text-left" onClick={() => { setSelectedId(row.id); setEditingId('') }}><strong className="block break-words text-sm">{row.name}</strong><span className="block text-xs text-slate-600">{row.legalName || 'Sin razón social'} · {row.active ? 'Activo' : 'Inactivo'}</span></button><SecondaryButton onClick={() => beginEdit(row)}>Editar</SecondaryButton></article>) : <p className="p-3 text-sm text-slate-500">No hay proveedores que coincidan.</p>}</div>
      {editingId ? <section className="grid gap-3 rounded-xl border border-sky-200 bg-sky-50/40 p-3 sm:grid-cols-2"><Field label="Nombre comercial" required><TextInput value={form.name} maxLength={100} onChange={event => set('name', event.target.value)}/></Field><Field label="Razón social"><TextInput value={form.legalName || ''} maxLength={160} onChange={event => set('legalName', event.target.value)}/></Field><Field label="NIT"><TextInput value={form.nit || ''} maxLength={30} inputMode="text" placeholder="Opcional; conservar ceros iniciales" onChange={event => set('nit', event.target.value)}/></Field><Field label="Dirección"><TextInput value={form.address || ''} maxLength={300} onChange={event => set('address', event.target.value)}/></Field><Field label="Persona de contacto"><TextInput value={form.contactName || ''} maxLength={100} onChange={event => set('contactName', event.target.value)}/></Field><Field label="Teléfono / WhatsApp"><TextInput value={form.phone || ''} maxLength={40} type="tel" onChange={event => set('phone', event.target.value)}/></Field><Field label="Correo electrónico"><TextInput value={form.email || ''} maxLength={254} type="email" onChange={event => set('email', event.target.value)}/></Field><div className="sm:col-span-2"><Field label="Observaciones"><TextArea value={form.note || ''} maxLength={1000} onChange={event => set('note', event.target.value)}/></Field></div></section> : selected ? <section className="grid gap-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-black">{selected.name}</h3><p className="text-xs text-slate-600">{selected.active ? 'Activo' : 'Inactivo'}</p></div><SecondaryButton disabled={readOnly || busy} onClick={() => void toggleActive(selected)}>{selected.active ? 'Desactivar' : 'Reactivar'}</SecondaryButton></div><dl className="grid gap-1 rounded-xl bg-slate-50 p-3 text-sm sm:grid-cols-2"><dt className="font-bold">Razón social</dt><dd>{selected.legalName || '—'}</dd><dt className="font-bold">NIT</dt><dd>{selected.nit || '—'}</dd><dt className="font-bold">Dirección</dt><dd>{selected.address || '—'}</dd><dt className="font-bold">Contacto</dt><dd>{selected.contactName || '—'}</dd><dt className="font-bold">Teléfono</dt><dd>{selected.phone || '—'}</dd><dt className="font-bold">Correo</dt><dd>{selected.email || '—'}</dd><dt className="font-bold">Observaciones</dt><dd>{selected.note || '—'}</dd></dl><section><h4 className="mb-2 font-bold">Compras y cuentas asociadas ({purchases.length})</h4>{purchases.length ? <div className="grid max-h-56 gap-2 overflow-y-auto">{purchases.map(row => <article key={row.id} className="rounded-xl border border-slate-200 p-3 text-xs"><strong>{row.dayKey} · {row.description}</strong><p>{row.purchaseReceiptType ? `${row.purchaseReceiptType === 'invoice' ? 'Factura' : row.purchaseReceiptType === 'receipt' ? 'Recibo' : 'Otro'} ${row.purchaseReceiptNumber || ''}` : 'Sin comprobante registrado'} · {status(row)}</p><p>Total {formatBs(row.totalAmount)} · Pagado {formatBs(row.paidAmount)} · Saldo {formatBs(row.balance)}</p></article>)}</div> : <p className="text-sm text-slate-500">No hay compras registradas para este proveedor.</p>}</section></section> : <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">Selecciona un proveedor para consultar sus datos e historial.</p>}
      {error && <p role="alert" className="text-sm font-bold text-rose-700">{error}</p>}
    </div>
  </Modal>
}
