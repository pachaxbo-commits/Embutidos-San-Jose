import { exportCustomerStatement } from '../data/reportExports'
import { prepareCustomerPhoto } from '../data/customerPhoto'
import { useMemo, useState } from 'react'
import { ArrowDownUp, Plus, Search } from 'lucide-react'
import { Modal } from '../../../components/ui/Modal'
import { Field, TextArea, TextInput } from '../../../components/ui/Form'
import { ChoiceButton, ChoiceModal } from '../../../components/ui/ChoiceModal'
import { EmptyBlock, Screen } from '../../../components/ui/Screen'
import { round2 } from '../domain/engine'
import { saveCustomer } from '../data/distributionRepository'
import { PrimaryButton, formatBs } from './shared'
import type { DistributionViewProps } from './DistributionApp'
import type { DistCustomer } from '../types'

/**
 * Directorio simple de clientes. La estructura queda lista para importar
 * despues el historico del Excel sin cambiar el modelo.
 */
export function CustomersView({ session, data }: DistributionViewProps) {
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<DistCustomer | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [name, setName] = useState('')
  const [photoDataUrl, setPhotoDataUrl] = useState('')
  const [addressReference, setAddressReference] = useState('')
  const [identityNumber, setIdentityNumber] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [routeId, setRouteId] = useState(session.routeId ?? '')
  const [notes, setNotes] = useState('')
  const [active, setActive] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isRouteOpen, setIsRouteOpen] = useState(false)
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest')

  const balanceByCustomer = useMemo(() => {
    const map = new Map<string, number>()
    for (const receivable of data.receivables) {
      map.set(receivable.customerId, round2((map.get(receivable.customerId) ?? 0) + (Number(receivable.balance) || 0)))
    }
    return map
  }, [data.receivables])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    const matching = term ? data.customers.filter((customer) => [customer.name, customer.customerCode, customer.identityNumber, customer.phone].join(' ').toLowerCase().includes(term)) : data.customers
    return [...matching].sort((a, b) => sortOrder === 'newest' ? (b.createdAt || '').localeCompare(a.createdAt || '') : (a.createdAt || '').localeCompare(b.createdAt || ''))
  }, [data.customers, search, sortOrder])

  const openCreate = () => {
    setEditing(null)
    setName('')
    setPhotoDataUrl('')
    setAddressReference('')
    setIdentityNumber('')
    setPhone('')
    setAddress('')
    setRouteId(session.routeId ?? '')
    setNotes('')
    setActive(true)
    setError(null)
    setIsOpen(true)
  }

  const openEdit = (customer: DistCustomer) => {
    setEditing(customer)
    setName(customer.name)
    setPhotoDataUrl(customer.photoDataUrl || '')
    setAddressReference(customer.addressReference || '')
    setIdentityNumber(customer.identityNumber || '')
    setPhone(customer.phone ?? '')
    setAddress(customer.address ?? '')
    setRouteId(customer.routeId ?? '')
    setNotes(customer.notes ?? '')
    setActive(customer.active !== false)
    setError(null)
    setIsOpen(true)
  }

  const submit = async () => {
    if (isSubmitting) return
    if (!name.trim()) {
      setError('El nombre es obligatorio.')
      return
    }

    setIsSubmitting(true)
    try {
      await saveCustomer({ id: editing?.id, name, photoDataUrl, addressReference, identityNumber, phone, address, routeId, notes, active })
      setIsOpen(false)
    } catch (submitError) {
      setError((submitError as Error).message || 'No se pudo guardar el cliente.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Screen
      title="Clientes"
      subtitle={`${data.customers.length} clientes registrados`}
      actions={
        <PrimaryButton onClick={openCreate}>
          <Plus size={16} /> Nuevo
        </PrimaryButton>
      }
    >
      <div className="grid w-full min-w-0 gap-3">
        <div className="relative w-full">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <TextInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nombre, codigo, carnet o telefono..."
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2 text-[11px] font-bold text-slate-500"><ArrowDownUp size={14} /><span>Orden:</span><button type="button" onClick={() => setSortOrder('newest')} className={`rounded-full px-3 py-1.5 ${sortOrder === 'newest' ? 'bg-[var(--primary-soft)] text-[var(--primary)]' : 'bg-white'}`}>Más nuevos</button><button type="button" onClick={() => setSortOrder('oldest')} className={`rounded-full px-3 py-1.5 ${sortOrder === 'oldest' ? 'bg-[var(--primary-soft)] text-[var(--primary)]' : 'bg-white'}`}>Más antiguos</button></div>

        {filtered.length === 0 ? (
          <EmptyBlock title="Sin clientes" description="Puedes crearlos aqui o directamente al vender." />
        ) : (
          <div className="grid gap-2">
            {filtered.map((customer) => {
              const balance = balanceByCustomer.get(customer.id) ?? 0
              return (
                <button
                  key={customer.id}
                  type="button"
                  onClick={() => openEdit(customer)}
                  className="flex w-full min-w-0 items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left"
                >
                  {customer.photoDataUrl && <img src={customer.photoDataUrl} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" />}
                  <div className="min-w-0">
                    <p className="break-words text-sm font-extrabold text-slate-900">{customer.name}</p>
                    <p className="break-words text-[11px] font-semibold leading-snug text-slate-500">
                      {[customer.identityNumber ? `CI: ${customer.identityNumber}` : 'CI pendiente', customer.phone, customer.address].filter(Boolean).join(' · ') || 'Sin datos de contacto'}
                    </p>
                  </div>
                  {balance > 0 && (
                    <span className="shrink-0 rounded-full bg-[var(--primary-soft)] px-2 py-1 text-[11px] font-black text-[var(--primary)]">
                      {formatBs(balance)}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={editing ? 'Editar cliente' : 'Nuevo cliente'}
        footer={
          <PrimaryButton full disabled={isSubmitting} onClick={() => void submit()}>
            {isSubmitting ? 'Guardando...' : 'Guardar cliente'}
          </PrimaryButton>
        }
      >
        <div className="grid gap-3">
          {editing && session.role==='admin' && <button type="button" className="rounded-xl border p-3 text-sm font-bold" onClick={async()=>{try{await exportCustomerStatement(data,editing)}catch(e){setError((e as Error).message)}}}>Estado de cuenta PDF / imprimir</button>}
          <Field label="Nombre" required>
            <TextInput value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="CI / código del cliente" required hint="El CI identifica al cliente. Incluye el complemento si corresponde.">
            <TextInput value={identityNumber} onChange={event => setIdentityNumber(event.target.value)} />
          </Field>
          <Field label="Fotografía (opcional)" hint="Se guarda una imagen reducida para identificar al cliente.">
            <input type="file" accept="image/*" onChange={async event => {
              const file = event.target.files?.[0]; if (!file) return
              try { setPhotoDataUrl(await prepareCustomerPhoto(file)); setError(null) } catch (err) { setError((err as Error).message) }
              event.target.value = ''
            }} />
            {photoDataUrl && <div><img src={photoDataUrl} alt="Foto del cliente" className="h-24 w-24 rounded-xl object-cover" /><button type="button" onClick={() => setPhotoDataUrl('')}>Quitar fotografía</button></div>}
          </Field>
          <Field label="Telefono">
            <TextInput value={phone} inputMode="tel" onChange={(event) => setPhone(event.target.value)} />
          </Field>
          <Field label="Direccion">
            <TextInput value={address} onChange={(event) => setAddress(event.target.value)} />
          </Field>
          <Field label="Referencia de dirección"><TextInput value={addressReference} onChange={event => setAddressReference(event.target.value)} /></Field>
          <Field label="Zona / ruta">
            <ChoiceButton label={routeId ? data.routes.find(route => route.id === routeId)?.name : 'Sin asignar'} placeholder="Selecciona ruta" onClick={() => setIsRouteOpen(true)} />
          </Field>
          <Field label="Observaciones">
            <TextArea value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
          <label className="flex min-h-[44px] items-center gap-2 text-xs font-bold text-slate-700">
            <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} className="h-5 w-5" />
            Cliente activo
          </label>
          {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
        </div>
      </Modal>
      <ChoiceModal
        isOpen={isRouteOpen}
        onClose={() => setIsRouteOpen(false)}
        title="Zona o ruta del cliente"
        searchable
        options={[{ value: '', label: 'Sin asignar' }, ...data.routes.map(route => ({ value: route.id, label: route.name }))]}
        selectedValue={routeId}
        onSelect={setRouteId}
      />
    </Screen>
  )
}
