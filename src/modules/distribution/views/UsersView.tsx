import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, KeyRound, Pencil, Plus, ShieldCheck, Trash2, Users } from 'lucide-react'
import { Modal } from '../../../components/ui/Modal'
import { Field, TextInput } from '../../../components/ui/Form'
import { ChoiceButton, ChoiceModal } from '../../../components/ui/ChoiceModal'
import { EmptyBlock, ErrorBlock, LoadingState, Screen } from '../../../components/ui/Screen'
import { changeRestaurantMemberPassword, createRestaurantMember, deleteRestaurantMemberAccess, updateRestaurantMember } from '../../../lib/firebase'
import { useTenantMembers } from '../state/useTenantMembers'
import { PrimaryButton, SecondaryButton } from './shared'
import type { DistributionViewProps } from './DistributionApp'
import type { RestaurantMember, UserRole } from '../../../types'

const ROLES: { value: UserRole; label: string; description: string }[] = [
  { value: 'admin', label: 'Administración', description: 'Acceso completo a la empresa y a todas las rutas.' },
  { value: 'warehouse', label: 'Almacén', description: 'Inventario, despachos, retornos y conciliación física.' },
  { value: 'distributor', label: 'Distribuidores', description: 'Venta, cobranza, gastos y cierre de su ruta asignada.' },
  { value: 'support', label: 'Soporte técnico', description: 'Configuración, impresoras y entrega limpia; sin acceso a información comercial.' },
]

export function UsersView({ session, data, membersOverride }: DistributionViewProps & { membersOverride?: RestaurantMember[] }) {
  const liveMembers = useTenantMembers()
  const members = membersOverride ?? liveMembers.members
  const isLoading = membersOverride ? false : liveMembers.isLoading
  const error = membersOverride ? null : liveMembers.error
  const reload = membersOverride ? async () => undefined : liveMembers.reload
  const [isOpen, setIsOpen] = useState(false)
  const [displayName, setDisplayName] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>('distributor'), [warehouseId, setWarehouseId] = useState('central'), [routeId, setRouteId] = useState('')
  const [formError, setFormError] = useState<string | null>(null), [feedback, setFeedback] = useState<string | null>(null), [busy, setBusy] = useState(false)
  const [openRole, setOpenRole] = useState<UserRole | null>(null), [openMember, setOpenMember] = useState<string | null>(null)
  const [memberChoice, setMemberChoice] = useState<{ kind: 'role' | 'route' | 'warehouse'; member: RestaurantMember } | null>(null)
  const [newChoice, setNewChoice] = useState<'role' | 'route' | 'warehouse' | null>(null)
  const [passwordTarget, setPasswordTarget] = useState<RestaurantMember | null>(null)
  const [newPassword, setNewPassword] = useState(''), [confirmPassword, setConfirmPassword] = useState('')
  const [editTarget, setEditTarget] = useState<RestaurantMember | null>(null)
  const [editName, setEditName] = useState(''), [editEmail, setEditEmail] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<RestaurantMember | null>(null)
  const groups = useMemo(() => ROLES.map(option => ({ ...option, members: members.filter(member => member.role === option.value).sort((a, b) => a.displayName.localeCompare(b.displayName, 'es')) })), [members])
  const activeAdminCount = members.filter(member => member.role === 'admin' && member.active !== false).length

  const submit = async () => {
    if (busy) return
    setFormError(null)
    if (!displayName.trim() || !email.trim()) return setFormError('Nombre y correo son obligatorios.')
    if (password.length < 6) return setFormError('La contraseña debe tener al menos 6 caracteres.')
    if (role === 'distributor' && !routeId) return setFormError('Un distribuidor necesita una ruta asignada.')
    setBusy(true)
    try {
      await createRestaurantMember({ email, password, displayName, role, routeId: role === 'distributor' ? routeId : '', warehouseId: role === 'warehouse' ? warehouseId : 'central' })
      setIsOpen(false); setDisplayName(''); setEmail(''); setPassword(''); setRouteId(''); setFeedback('Usuario creado correctamente.'); await reload()
    } catch (e) { setFormError((e as Error).message || 'No se pudo crear el usuario.') } finally { setBusy(false) }
  }

  const changePassword = async () => {
    if (!passwordTarget || busy) return
    setFormError(null)
    if (newPassword.length < 6) return setFormError('La contraseña debe tener al menos 6 caracteres.')
    if (newPassword !== confirmPassword) return setFormError('Las contraseñas no coinciden.')
    setBusy(true)
    try { await changeRestaurantMemberPassword(passwordTarget.uid, newPassword); setFeedback(`Contraseña actualizada para ${passwordTarget.displayName}.`); setPasswordTarget(null) }
    catch (e) { setFormError((e as Error).message || 'No se pudo cambiar la contraseña.') } finally { setBusy(false) }
  }

  const openEdit = (member: RestaurantMember) => {
    setEditTarget(member)
    setEditName(member.displayName)
    setEditEmail(member.email)
    setFormError(null)
  }

  const saveEdit = async () => {
    if (!editTarget || busy) return
    setFormError(null)
    const name = editName.trim(), normalizedEmail = editEmail.trim().toLowerCase()
    if (name.length < 2) return setFormError('Escribe un nombre válido.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return setFormError('Escribe un correo válido.')
    setBusy(true)
    try {
      await updateRestaurantMember(editTarget.uid, { displayName: name, email: normalizedEmail })
      setEditTarget(null)
      setFeedback(`Información actualizada para ${name}.`)
      await reload()
    } catch (e) { setFormError((e as Error).message || 'No se pudo actualizar el usuario.') } finally { setBusy(false) }
  }

  const removeMember = async () => {
    if (!deleteTarget || busy) return
    setBusy(true); setFormError(null)
    try {
      await deleteRestaurantMemberAccess(deleteTarget.uid)
      setDeleteTarget(null)
      setOpenMember(null)
      setFeedback('Usuario eliminado correctamente. Ya no podrá iniciar sesión.')
      await reload()
    } catch (e) { setFormError((e as Error).message || 'No se pudo eliminar el usuario.') } finally { setBusy(false) }
  }

  return <Screen title="Usuarios" subtitle="Personal interno de la empresa" actions={<PrimaryButton onClick={() => { setFormError(null); setIsOpen(true) }}><Plus size={16} /> Nuevo</PrimaryButton>}>
    <div className="grid gap-3">
      {feedback && <p role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">{feedback}</p>}
      {isLoading && <LoadingState label="Cargando usuarios..." />}{error && <ErrorBlock message={error} onRetry={() => void reload()} />}{!isLoading && !error && !members.length && <EmptyBlock title="Sin usuarios registrados" />}
      {groups.map(group => { const expanded = openRole === group.value; return <section key={group.value} className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
        <button type="button" onClick={() => setOpenRole(expanded ? null : group.value)} className="flex min-h-[56px] w-full items-center gap-3 px-4 text-left">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--primary-soft)] text-[var(--primary)]"><Users size={17} /></span>
          <span className="min-w-0 flex-1"><strong className="block text-sm text-slate-900">{group.label}</strong><span className="text-[11px] font-semibold text-slate-500">{group.members.length} usuario{group.members.length === 1 ? '' : 's'}</span></span>{expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>
        {expanded && <div className="grid gap-2 border-t border-slate-100 p-2 sm:grid-cols-2">{group.members.map(member => { const details = openMember === member.uid; return <article key={member.uid} className="min-w-0 rounded-2xl border border-slate-200">
          <button type="button" onClick={() => setOpenMember(details ? null : member.uid)} className="flex min-h-[56px] w-full items-center gap-2 p-3 text-left"><span className="min-w-0 flex-1"><strong className="block break-words text-sm text-slate-900">{member.displayName}</strong><span className="block break-words text-[11px] font-semibold text-slate-500">{member.email}</span></span><span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${member.active !== false ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{member.active !== false ? 'ACTIVO' : 'INACTIVO'}</span>{details ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
          {details && <div className="grid gap-2 border-t border-slate-100 p-3"><Field label="Rol"><ChoiceButton disabled={member.uid === session.uid} label={ROLES.find(option => option.value === member.role)?.label} placeholder="Selecciona rol" onClick={() => setMemberChoice({ kind: 'role', member })} /></Field>
            {member.role === 'distributor' && <Field label="Ruta asignada"><ChoiceButton label={data.routes.find(r => r.id === member.routeId)?.name || 'Sin ruta'} placeholder="Selecciona ruta" onClick={() => setMemberChoice({ kind: 'route', member })} /></Field>}
            {member.role === 'warehouse' && <Field label="Almacén asignado"><ChoiceButton label={(member.warehouseId || 'central') === 'central' ? 'Almacén central' : data.warehouses.find(w => w.id === member.warehouseId)?.name} placeholder="Selecciona almacén" onClick={() => setMemberChoice({ kind: 'warehouse', member })} /></Field>}
            <div className="grid grid-cols-2 gap-2"><SecondaryButton full onClick={() => openEdit(member)}><Pencil size={15} /> Editar datos</SecondaryButton><SecondaryButton full onClick={() => { setPasswordTarget(member); setNewPassword(''); setConfirmPassword(''); setFormError(null) }}><KeyRound size={15} /> Cambiar contraseña</SecondaryButton><SecondaryButton full disabled={member.uid === session.uid || (member.role === 'admin' && member.active !== false && activeAdminCount <= 1)} onClick={() => void updateRestaurantMember(member.uid, { active: member.active === false }).then(async () => { setFeedback(member.active !== false ? 'Usuario desactivado.' : 'Usuario activado.'); await reload() }).catch(e => setFormError(e.message))}><ShieldCheck size={15} /> {member.active !== false ? 'Desactivar' : 'Activar'}</SecondaryButton><button type="button" disabled={member.uid === session.uid || (member.role === 'admin' && member.active !== false && activeAdminCount <= 1)} onClick={() => { setDeleteTarget(member); setFormError(null) }} className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-3 text-xs font-extrabold text-rose-700 disabled:cursor-not-allowed disabled:opacity-40"><Trash2 size={15} /> Eliminar</button></div>
            {member.role === 'admin' && member.active !== false && activeAdminCount <= 1 && <p className="text-[10px] font-semibold text-amber-700">Esta es la única cuenta administrativa activa y debe conservarse.</p>}
          </div>}
        </article>})}{!group.members.length && <p className="p-3 text-xs font-semibold text-slate-500">No hay usuarios en esta categoría.</p>}</div>}
      </section>})}
    </div>
    <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Nuevo usuario interno" footer={<PrimaryButton full disabled={busy} onClick={() => void submit()}>{busy ? 'Creando...' : 'Crear usuario'}</PrimaryButton>}><div className="grid gap-3"><Field label="Nombre" required><TextInput value={displayName} onChange={e => setDisplayName(e.target.value)} /></Field><Field label="Correo" required><TextInput type="email" value={email} onChange={e => setEmail(e.target.value)} /></Field><Field label="Contraseña inicial" required hint="Mínimo 6 caracteres."><TextInput type="password" value={password} onChange={e => setPassword(e.target.value)} /></Field><Field label="Rol" required hint={ROLES.find(o => o.value === role)?.description}><ChoiceButton label={ROLES.find(o => o.value === role)?.label} placeholder="Selecciona rol" onClick={() => setNewChoice('role')} /></Field>{role === 'distributor' && <Field label="Ruta" required><ChoiceButton label={data.routes.find(r => r.id === routeId)?.name} placeholder="Selecciona ruta" onClick={() => setNewChoice('route')} /></Field>}{role === 'warehouse' && <Field label="Almacén asignado"><ChoiceButton label={warehouseId === 'central' ? 'Almacén central' : data.warehouses.find(w => w.id === warehouseId)?.name} placeholder="Selecciona almacén" onClick={() => setNewChoice('warehouse')} /></Field>}{formError && <p className="text-xs font-bold text-rose-600">{formError}</p>}</div></Modal>
    <Modal isOpen={!!passwordTarget} onClose={() => setPasswordTarget(null)} title="Cambiar contraseña" subtitle={passwordTarget?.displayName} footer={<PrimaryButton full disabled={busy} onClick={() => void changePassword()}>{busy ? 'Cambiando...' : 'Guardar contraseña'}</PrimaryButton>}><div className="grid gap-3"><Field label="Nueva contraseña" required><TextInput type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} /></Field><Field label="Repetir contraseña" required><TextInput type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} /></Field>{formError && <p className="text-xs font-bold text-rose-600">{formError}</p>}</div></Modal>
    <Modal isOpen={!!editTarget} onClose={() => setEditTarget(null)} title="Editar usuario" subtitle="El nuevo correo se usará en el próximo inicio de sesión." footer={<PrimaryButton full disabled={busy} onClick={() => void saveEdit()}>{busy ? 'Guardando...' : 'Guardar cambios'}</PrimaryButton>}><div className="grid gap-3"><Field label="Nombre" required><TextInput value={editName} onChange={e => setEditName(e.target.value)} /></Field><Field label="Correo de acceso" required><TextInput type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} /></Field><p className="rounded-xl bg-sky-50 p-3 text-[11px] font-semibold text-sky-800">Si cambias el correo, el usuario deberá usar el nuevo correo la próxima vez que inicie sesión.</p>{formError && <p className="text-xs font-bold text-rose-600">{formError}</p>}</div></Modal>
    <Modal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Eliminar usuario" subtitle={deleteTarget?.displayName} footer={<button type="button" disabled={busy} onClick={() => void removeMember()} className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl bg-rose-700 px-4 text-sm font-extrabold text-white disabled:opacity-50"><Trash2 size={16} /> {busy ? 'Eliminando...' : 'Sí, eliminar usuario'}</button>}><div className="grid gap-3"><p className="text-sm font-semibold text-slate-700">Esta persona perderá el acceso inmediatamente. Sus ventas, despachos y movimientos anteriores permanecerán en los historiales.</p><p className="break-words rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-800">{deleteTarget?.displayName}<br />{deleteTarget?.email}</p>{formError && <p className="text-xs font-bold text-rose-600">{formError}</p>}</div></Modal>
    <ChoiceModal isOpen={memberChoice?.kind === 'role'} onClose={() => setMemberChoice(null)} title="Rol del usuario" options={ROLES.map(o => ({ value: o.value, label: o.label, description: o.description }))} selectedValue={memberChoice?.member.role} onSelect={value => { const member = memberChoice?.member; if (!member) return; const next = value as UserRole; void updateRestaurantMember(member.uid, { role: next, routeId: next === 'distributor' ? member.routeId || '' : '', warehouseId: next === 'warehouse' ? member.warehouseId || 'central' : 'central' }).then(reload).catch(e => setFeedback(e.message)); setMemberChoice(null) }} />
    <ChoiceModal isOpen={memberChoice?.kind === 'route'} onClose={() => setMemberChoice(null)} title="Ruta asignada" searchable options={data.routes.map(r => ({ value: r.id, label: r.name }))} selectedValue={memberChoice?.member.routeId || ''} onSelect={value => { const m = memberChoice?.member; if (m) void updateRestaurantMember(m.uid, { routeId: value }).then(reload).catch(e => setFeedback(e.message)); setMemberChoice(null) }} />
    <ChoiceModal isOpen={memberChoice?.kind === 'warehouse'} onClose={() => setMemberChoice(null)} title="Almacén asignado" searchable options={[{ value: 'central', label: 'Almacén central' }, ...data.warehouses.map(w => ({ value: w.id, label: w.name }))]} selectedValue={memberChoice?.member.warehouseId || 'central'} onSelect={value => { const m = memberChoice?.member; if (m) void updateRestaurantMember(m.uid, { warehouseId: value }).then(reload).catch(e => setFeedback(e.message)); setMemberChoice(null) }} />
    <ChoiceModal isOpen={newChoice === 'role'} onClose={() => setNewChoice(null)} title="Rol del usuario" options={ROLES.map(o => ({ value: o.value, label: o.label, description: o.description }))} selectedValue={role} onSelect={value => { const next = value as UserRole; setRole(next); if (next !== 'distributor') setRouteId('') }} />
    <ChoiceModal isOpen={newChoice === 'route'} onClose={() => setNewChoice(null)} title="Ruta del distribuidor" searchable options={data.routes.map(r => ({ value: r.id, label: r.name }))} selectedValue={routeId} onSelect={setRouteId} />
    <ChoiceModal isOpen={newChoice === 'warehouse'} onClose={() => setNewChoice(null)} title="Almacén del usuario" searchable options={[{ value: 'central', label: 'Almacén central' }, ...data.warehouses.map(w => ({ value: w.id, label: w.name }))]} selectedValue={warehouseId} onSelect={setWarehouseId} />
  </Screen>
}
