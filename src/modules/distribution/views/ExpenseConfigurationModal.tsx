import { useMemo, useState } from 'react'
import { Modal } from '../../../components/ui/Modal'
import { Field, NumberInput, TextInput } from '../../../components/ui/Form'
import type { DistExpenseCategory, ExpenseEconomicType } from '../types'
import { PrimaryButton } from './shared'
import { deleteExpenseCategory, deleteExpenseGroup, saveExpenseCategory } from '../data/distributionRepository'

type GroupOption = { id: string; label: string; economicType: ExpenseEconomicType; active: boolean; order: number }

export function ExpenseConfigurationModal({
  isOpen, onClose, groups, categories, readOnly, onSaveGroup, onSaved, onError,
}: {
  isOpen: boolean; onClose: () => void; groups: GroupOption[]; categories: DistExpenseCategory[]; readOnly: boolean
  onSaveGroup: (input: { groupId: string; name: string; economicType: ExpenseEconomicType; active: boolean; order: number }) => Promise<unknown>
  onSaved: (message: string) => void; onError: (message: string) => void
}) {
  const [groupId, setGroupId] = useState('administration')
  const [editingGroupId, setEditingGroupId] = useState('')
  const [groupName, setGroupName] = useState('')
  const [groupEconomicType, setGroupEconomicType] = useState<ExpenseEconomicType>('operating_expense')
  const [groupOrder, setGroupOrder] = useState('0')
  const [categoryId, setCategoryId] = useState('')
  const [categoryTargetGroup, setCategoryTargetGroup] = useState('')
  const [categoryName, setCategoryName] = useState('')
  const [categoryOrder, setCategoryOrder] = useState('999')
  const [autoClassifiable, setAutoClassifiable] = useState(false)
  const [distributorVisible, setDistributorVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const selectedGroup = groups.find(group => group.id === groupId)
  const categoriesInGroup = useMemo(() => categories.filter(category => category.group === groupId).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'es')), [categories, groupId])

  const saveGroup = async (id: string, name: string, economicType: ExpenseEconomicType, active: boolean, order: number) => {
    setBusy(true)
    try { await onSaveGroup({ groupId: id, name, economicType, active, order }); onSaved('Grupo guardado. El historial conserva su identificador y clasificación.'); if (!editingGroupId) setGroupName(''); setEditingGroupId('') }
    catch (error) { onError((error as Error).message || 'No se pudo guardar el grupo.') }
    finally { setBusy(false) }
  }
  const saveCategory = async (id: string, name: string, active: boolean, order: number, auto = autoClassifiable, visible = distributorVisible, targetGroup = categoryTargetGroup || groupId) => {
    setBusy(true)
    try {
      const existing = categories.find(category => category.id === id)
      const currentCategoryGroup = existing?.group || groupId
      const sourceGroupConfig = groups.find(g => g.id === currentCategoryGroup)
      const targetGroupConfig = groups.find(g => g.id === targetGroup)

      const isCrossEconomic = Boolean(existing && sourceGroupConfig && targetGroupConfig && sourceGroupConfig.economicType !== targetGroupConfig.economicType)

      if (isCrossEconomic) {
        // Creación segura de categoría equivalente para no reclasificar egresos históricos
        const newId = `custom-${targetGroup}-${Date.now().toString(36)}`
        await saveExpenseCategory({
          categoryId: newId,
          group: targetGroup,
          name,
          active,
          order,
          autoClassifiable: auto,
          distributorVisible: auto && visible,
        })
        onSaved(`Se creó una nueva categoría equivalente en “${targetGroupConfig?.label}”. La categoría anterior y sus egresos históricos se conservan sin cambios.`)
      } else {
        await saveExpenseCategory({
          categoryId: id,
          group: targetGroup,
          name,
          active,
          order,
          autoClassifiable: auto,
          distributorVisible: auto && visible,
        })
        onSaved(targetGroup !== groupId ? 'Categoría movida para registros nuevos. Los gastos ya registrados conservan su grupo y clasificación.' : 'Categoría guardada.')
      }
      setCategoryId('')
      setCategoryName('')
      setCategoryTargetGroup('')
      setAutoClassifiable(false)
      setDistributorVisible(false)
    }
    catch (error) { onError((error as Error).message || 'No se pudo guardar la categoría.') }
    finally { setBusy(false) }
  }
  const removeCategory = async (id: string) => {
    setBusy(true)
    try { await deleteExpenseCategory({ categoryId: id }); onSaved('Categoría eliminada.'); setCategoryId(''); setCategoryName('') }
    catch (error) { onError((error as Error).message || 'No se pudo eliminar la categoría.') }
    finally { setBusy(false) }
  }
  const removeGroup = async (id: string) => {
    setBusy(true)
    try { await deleteExpenseGroup({ groupId: id }); onSaved('Grupo eliminado.'); setGroupId('administration') }
    catch (error) { onError((error as Error).message || 'No se pudo eliminar el grupo.') }
    finally { setBusy(false) }
  }

  return <Modal isOpen={isOpen} onClose={() => !busy && onClose()} title="Administrar grupos y categorías" subtitle="Los cambios de nombre preservan los registros anteriores. La clasificación económica de un grupo con historial queda protegida." size="lg">
    <div className="grid min-w-0 gap-5">
      <section className="grid gap-3 rounded-2xl border border-slate-200 p-3 sm:p-4">
        <h3 className="text-sm font-black">Grupos</h3>
        <Field label="Seleccionar grupo"><select value={groupId} onChange={event => { setGroupId(event.target.value); setCategoryId(''); setCategoryName(''); setCategoryTargetGroup(''); setAutoClassifiable(false); setDistributorVisible(false); setCategoryOrder('999') }} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3">{groups.map(group => <option key={group.id} value={group.id}>{group.label}{group.active ? '' : ' · Inactivo'}</option>)}</select></Field>
        {selectedGroup && <div className="grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-[1fr_auto] sm:items-center"><div><p className="text-sm font-bold">{selectedGroup.label}</p><p className="text-xs text-slate-600">{selectedGroup.economicType === 'production_input' ? 'Compra para producción (no se descuenta otra vez del resultado)' : 'Gasto operativo'} · orden {selectedGroup.order}</p></div><div className="flex flex-wrap gap-2"><button type="button" disabled={busy || readOnly} onClick={() => { setEditingGroupId(groupId); setGroupName(selectedGroup.label); setGroupEconomicType(selectedGroup.economicType); setGroupOrder(String(selectedGroup.order)) }} className="min-h-10 rounded-lg bg-white px-3 text-xs font-bold">Editar</button><button type="button" disabled={busy || readOnly} onClick={() => void saveGroup(groupId, selectedGroup.label, selectedGroup.economicType, !selectedGroup.active, selectedGroup.order)} className="min-h-10 rounded-lg bg-white px-3 text-xs font-bold">{selectedGroup.active ? 'Desactivar' : 'Activar'}</button>{groupId.startsWith('custom-') && <button type="button" disabled={busy || readOnly} onClick={() => void removeGroup(groupId)} className="min-h-10 rounded-lg bg-rose-50 px-3 text-xs font-bold text-rose-800">Eliminar si no tiene historial</button>}</div></div>}
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_100px_auto] sm:items-end"><Field label={editingGroupId ? 'Nombre del grupo' : 'Nuevo grupo'}><TextInput value={groupName} onChange={event => setGroupName(event.target.value)} maxLength={60} placeholder="Ej.: Transporte y fletes"/></Field><Field label="Tratamiento económico"><select value={groupEconomicType} onChange={event => setGroupEconomicType(event.target.value as ExpenseEconomicType)} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3"><option value="operating_expense">Gasto operativo</option><option value="production_input">Compra para producción</option></select></Field><Field label="Orden"><NumberInput min={0} step={1} value={groupOrder} onChange={event => setGroupOrder(event.target.value)}/></Field><PrimaryButton disabled={busy || readOnly || !groupName.trim()} onClick={() => { const id = editingGroupId || `custom-${Date.now().toString(36)}`; void saveGroup(id, groupName.trim(), groupEconomicType, true, Number(groupOrder)||0) }}>{editingGroupId ? 'Guardar grupo' : 'Crear grupo'}</PrimaryButton></div>
        <p className="text-[11px] text-slate-500">Los seis grupos iniciales no se reemplazan. Crear un grupo nuevo requiere elegir su clasificación; no se deduce del nombre.</p>
      </section>

      <section className="grid gap-3 rounded-2xl border border-slate-200 p-3 sm:p-4">
        <div><h3 className="text-sm font-black">Categorías de {selectedGroup?.label || 'grupo'}</h3><p className="text-xs text-slate-600">Solo las categorías activas aparecen para registrar egresos.</p></div>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_100px_auto] sm:items-end">
          <Field label={categoryId ? 'Editar categoría' : 'Nueva categoría'}>
            <TextInput value={categoryName} onChange={event => setCategoryName(event.target.value)} maxLength={60} placeholder="Nombre de categoría"/>
          </Field>
          <Field label="Grupo para nuevos egresos">
            <select value={categoryTargetGroup || groupId} onChange={event => setCategoryTargetGroup(event.target.value)} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3">
              <optgroup label="Gastos operativos">
                {groups.filter(group => group.active && group.economicType === 'operating_expense').map(group => (
                  <option key={group.id} value={group.id}>{group.label}</option>
                ))}
              </optgroup>
              <optgroup label="Compras para producción">
                {groups.filter(group => group.active && group.economicType === 'production_input').map(group => (
                  <option key={group.id} value={group.id}>{group.label}</option>
                ))}
              </optgroup>
            </select>
          </Field>
          <Field label="Orden"><NumberInput min={0} step={1} value={categoryOrder} onChange={event => setCategoryOrder(event.target.value)}/></Field>
          <div className="flex gap-2">
            {categoryId && <button type="button" disabled={busy} onClick={() => { setCategoryId(''); setCategoryName(''); setCategoryTargetGroup(''); setAutoClassifiable(false); setDistributorVisible(false); setCategoryOrder('999') }} className="min-h-11 rounded-xl bg-slate-100 px-3 text-xs font-bold text-slate-700 hover:bg-slate-200">Cancelar</button>}
            <PrimaryButton disabled={busy || readOnly || !categoryName.trim() || !groups.some(group => group.id === (categoryTargetGroup || groupId) && group.active)} onClick={() => { const existing = categories.find(category => category.id === categoryId); void saveCategory(categoryId || `custom-${categoryTargetGroup || groupId}-${Date.now().toString(36)}`, categoryName.trim(), existing?.active ?? true, Number(categoryOrder)||0) }}>{categoryId ? 'Guardar categoría' : 'Agregar categoría'}</PrimaryButton>
          </div>
        </div>
        {categoryId && (() => {
          const existing = categories.find(category => category.id === categoryId)
          const currentCategoryGroup = existing?.group || groupId
          const sourceGroupConfig = groups.find(g => g.id === currentCategoryGroup)
          const targetGroupConfig = groups.find(g => g.id === (categoryTargetGroup || groupId))
          if (sourceGroupConfig && targetGroupConfig && sourceGroupConfig.economicType !== targetGroupConfig.economicType) {
            return <p className="rounded-xl border border-amber-300 bg-amber-50 p-2 text-xs font-semibold text-amber-900">
              Tratamiento contable diferente: {sourceGroupConfig.label} ({sourceGroupConfig.economicType === 'production_input' ? 'Compra para producción' : 'Gasto operativo'}) → {targetGroupConfig.label} ({targetGroupConfig.economicType === 'production_input' ? 'Compra para producción' : 'Gasto operativo'}). Para no modificar egresos ni balances históricos, al guardar se creará una nueva categoría equivalente en {targetGroupConfig.label} y se conservará la original intacta.
            </p>
          }
          return null
        })()}
        <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 text-xs"><input type="checkbox" checked={autoClassifiable} onChange={event => { setAutoClassifiable(event.target.checked); if (!event.target.checked) setDistributorVisible(false) }} className="mt-0.5 h-4 w-4"/><span><strong>Permitir clasificación automática segura</strong><span className="mt-1 block text-slate-600">El grupo controla el tratamiento económico. El permiso para distribuidores es independiente.</span></span></label>
        <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 text-xs"><input type="checkbox" checked={distributorVisible} disabled={!autoClassifiable} onChange={event => setDistributorVisible(event.target.checked)} className="mt-0.5 h-4 w-4"/><span><strong>Ofrecer a distribuidores</strong><span className="mt-1 block text-slate-600">Solo aparece para usuarios distribuidores si la clasificación segura está habilitada.</span></span></label>
        <div className="grid gap-2">{categoriesInGroup.map(category => { const movedFromIndirect = category.group === 'indirect' && ['indirect-7', 'indirect-8', 'indirect-9'].includes(category.id); return <article key={category.id} className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-slate-200 p-2"><div className="min-w-0"><p className={`break-words text-sm font-semibold ${category.active ? '' : 'text-slate-400 line-through'}`}>{category.name}</p><p className="text-[10px] text-slate-500">{movedFromIndirect ? 'Movida a comercialización · conserva el historial anterior' : category.distributorVisible && category.autoClassifiable ? 'Disponible para distribuidores' : 'Solo Administración'} · orden {category.order}</p></div><div className="flex shrink-0 gap-1"><button type="button" disabled={busy || readOnly} onClick={() => { setCategoryId(category.id); setCategoryTargetGroup(category.group); setCategoryName(category.name); setCategoryOrder(String(category.order)); setAutoClassifiable(category.autoClassifiable === true); setDistributorVisible(category.distributorVisible === true) }} className="min-h-9 rounded-lg bg-slate-100 px-2 text-xs font-bold">Editar</button><button type="button" disabled={busy || readOnly || movedFromIndirect} onClick={() => void saveCategory(category.id, category.name, !category.active, category.order, category.autoClassifiable === true, category.distributorVisible === true, category.group)} className="min-h-9 rounded-lg bg-slate-100 px-2 text-xs font-bold">{movedFromIndirect ? 'Movida' : category.active ? 'Desactivar' : 'Activar'}</button>{category.id.startsWith('custom-') && <button type="button" disabled={busy || readOnly} onClick={() => void removeCategory(category.id)} className="min-h-9 rounded-lg bg-rose-50 px-2 text-xs font-bold text-rose-800">Eliminar</button>}</div></article> })}</div>
      </section>
      {busy && <p role="status" className="text-xs text-slate-600">Guardando…</p>}
    </div>
  </Modal>
}
