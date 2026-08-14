import { useMemo, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import { Modal } from '../../../components/ui/Modal'
import { Field, SelectInput, TextArea, TextInput } from '../../../components/ui/Form'
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
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [routeId, setRouteId] = useState(session.routeId ?? '')
  const [notes, setNotes] = useState('')
  const [active, setActive] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const balanceByCustomer = useMemo(() => {
    const map = new Map<string, number>()
    for (const receivable of data.receivables) {
      map.set(receivable.customerId, round2((map.get(receivable.customerId) ?? 0) + (Number(receivable.balance) || 0)))
    }
    return map
  }, [data.receivables])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return term ? data.customers.filter((customer) => customer.name.toLowerCase().includes(term)) : data.customers
  }, [data.customers, search])

  const openCreate = () => {
    setEditing(null)
    setName('')
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
      await saveCustomer({ id: editing?.id, name, phone, address, routeId, notes, active })
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
            placeholder="Buscar por nombre..."
            className="pl-9"
          />
        </div>

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
                  <div className="min-w-0">
                    <p className="truncate text-sm font-extrabold text-slate-900">{customer.name}</p>
                    <p className="truncate text-[11px] font-semibold text-slate-500">
                      {[customer.phone, customer.address].filter(Boolean).join(' · ') || 'Sin datos de contacto'}
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
          <Field label="Nombre" required>
            <TextInput value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Telefono">
            <TextInput value={phone} inputMode="tel" onChange={(event) => setPhone(event.target.value)} />
          </Field>
          <Field label="Direccion">
            <TextInput value={address} onChange={(event) => setAddress(event.target.value)} />
          </Field>
          <Field label="Zona / ruta">
            <SelectInput value={routeId} onChange={(event) => setRouteId(event.target.value)}>
              <option value="">Sin asignar</option>
              {data.routes.map((route) => (
                <option key={route.id} value={route.id}>
                  {route.name}
                </option>
              ))}
            </SelectInput>
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
    </Screen>
  )
}
