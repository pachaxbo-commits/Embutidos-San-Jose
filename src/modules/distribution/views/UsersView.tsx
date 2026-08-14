import { useState } from 'react'
import { KeyRound, Plus, ShieldCheck } from 'lucide-react'
import { Modal } from '../../../components/ui/Modal'
import { Field, SelectInput, TextInput } from '../../../components/ui/Form'
import { EmptyBlock, ErrorBlock, LoadingState, Screen } from '../../../components/ui/Screen'
import {
  createRestaurantMember,
  sendRestaurantMemberPasswordReset,
  updateRestaurantMember,
} from '../../../lib/firebase'
import { useTenantMembers } from '../state/useTenantMembers'
import { PrimaryButton, SecondaryButton } from './shared'
import type { DistributionViewProps } from './DistributionApp'
import type { RestaurantMember, UserRole } from '../../../types'

const DIST_ROLES: { value: UserRole; label: string; description: string }[] = [
  { value: 'admin', label: 'Administracion', description: 'Ve toda la empresa y configura productos y precios.' },
  { value: 'warehouse', label: 'Almacen', description: 'Inventario, despachos, retornos y conciliacion fisica.' },
  { value: 'distributor', label: 'Distribuidor', description: 'Solo su ruta: vender, cobrar, gastos y cierre.' },
]

/**
 * Usuarios internos de la empresa.
 *
 * Reutiliza el mecanismo seguro que ya existe en PACHAX Flow: la cuenta se crea
 * en una instancia secundaria de Firebase Auth, de modo que la sesion del
 * administrador nunca se cierra. Las contrasenas las escribe la persona que
 * administra, no vienen escritas en el codigo.
 */
export function UsersView({ data }: DistributionViewProps) {
  const { members, isLoading, error, reload } = useTenantMembers()

  const [isOpen, setIsOpen] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>('distributor')
  const [routeId, setRouteId] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const submit = async () => {
    if (isSubmitting) return
    setFormError(null)

    if (!displayName.trim()) {
      setFormError('El nombre es obligatorio.')
      return
    }
    if (!email.trim()) {
      setFormError('El correo es obligatorio.')
      return
    }
    if (password.length < 6) {
      setFormError('La contrasena debe tener al menos 6 caracteres.')
      return
    }
    if (role === 'distributor' && !routeId) {
      setFormError('Un distribuidor necesita una ruta asignada.')
      return
    }

    setIsSubmitting(true)
    try {
      await createRestaurantMember({ email, password, displayName, role, routeId })
      setIsOpen(false)
      setDisplayName('')
      setEmail('')
      setPassword('')
      setRouteId('')
      setFeedback('Usuario creado correctamente.')
      await reload()
    } catch (submitError) {
      setFormError((submitError as Error).message || 'No se pudo crear el usuario.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const toggleActive = async (member: RestaurantMember) => {
    await updateRestaurantMember(member.uid, { active: !(member.active !== false) })
    await reload()
  }

  const changeRoute = async (member: RestaurantMember, nextRouteId: string) => {
    await updateRestaurantMember(member.uid, { routeId: nextRouteId })
    await reload()
  }

  const resetPassword = async (member: RestaurantMember) => {
    await sendRestaurantMemberPasswordReset(member.email)
    setFeedback(`Se envio un correo de restablecimiento a ${member.email}.`)
  }

  return (
    <Screen
      title="Usuarios"
      subtitle="Personal interno de la empresa"
      actions={
        <PrimaryButton onClick={() => setIsOpen(true)}>
          <Plus size={16} /> Nuevo
        </PrimaryButton>
      }
    >
      <div className="grid w-full min-w-0 gap-3">
        {feedback && (
          <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">
            {feedback}
          </p>
        )}

        {isLoading && <LoadingState label="Cargando usuarios..." />}
        {error && <ErrorBlock message={error} onRetry={() => void reload()} />}
        {!isLoading && !error && members.length === 0 && <EmptyBlock title="Sin usuarios registrados" />}

        <div className="grid gap-2">
          {members.map((member) => (
            <div key={member.uid} className="w-full min-w-0 rounded-2xl border border-slate-200 bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-extrabold text-slate-900">{member.displayName}</p>
                  <p className="truncate text-[11px] font-semibold text-slate-500">{member.email}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${
                    member.active !== false ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {member.active !== false ? 'ACTIVO' : 'INACTIVO'}
                </span>
              </div>

              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Field label="Rol">
                  <SelectInput
                    value={member.role}
                    onChange={async (event) => {
                      await updateRestaurantMember(member.uid, { role: event.target.value as UserRole })
                      await reload()
                    }}
                  >
                    {DIST_ROLES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
                <Field label="Ruta asignada">
                  <SelectInput
                    value={member.routeId ?? ''}
                    onChange={(event) => void changeRoute(member, event.target.value)}
                  >
                    <option value="">Sin ruta</option>
                    {data.routes.map((route) => (
                      <option key={route.id} value={route.id}>
                        {route.name}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                <SecondaryButton onClick={() => void toggleActive(member)}>
                  <ShieldCheck size={15} /> {member.active !== false ? 'Desactivar' : 'Activar'}
                </SecondaryButton>
                <SecondaryButton onClick={() => void resetPassword(member)}>
                  <KeyRound size={15} /> Restablecer contrasena
                </SecondaryButton>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title="Nuevo usuario interno"
        subtitle="La sesion del administrador no se cierra al crearlo"
        footer={
          <PrimaryButton full disabled={isSubmitting} onClick={() => void submit()}>
            {isSubmitting ? 'Creando...' : 'Crear usuario'}
          </PrimaryButton>
        }
      >
        <div className="grid gap-3">
          <Field label="Nombre" required>
            <TextInput value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </Field>
          <Field label="Correo" required>
            <TextInput
              type="email"
              inputMode="email"
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field label="Contrasena inicial" required hint="Minimo 6 caracteres. La define quien administra.">
            <TextInput
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Field label="Rol" required hint={DIST_ROLES.find((option) => option.value === role)?.description}>
            <SelectInput value={role} onChange={(event) => setRole(event.target.value as UserRole)}>
              {DIST_ROLES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectInput>
          </Field>
          {role === 'distributor' && (
            <Field label="Ruta" required>
              <SelectInput value={routeId} onChange={(event) => setRouteId(event.target.value)}>
                <option value="">Selecciona ruta</option>
                {data.routes.map((route) => (
                  <option key={route.id} value={route.id}>
                    {route.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
          )}
          {formError && <p className="text-xs font-bold text-rose-600">{formError}</p>}
        </div>
      </Modal>
    </Screen>
  )
}
