import { Check, ChevronRight, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Modal } from './Modal'
import { TextInput } from './Form'

export interface ChoiceOption {
  value: string
  label: string
  description?: string
  trailing?: string
  disabled?: boolean
}

export function ChoiceButton({ label, description, placeholder, onClick, disabled }: {
  label?: string
  description?: string
  placeholder: string
  onClick: () => void
  disabled?: boolean
}) {
  return <button type="button" disabled={disabled} onClick={onClick} className="flex min-h-[48px] w-full min-w-0 items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-left outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary-soft)] disabled:bg-slate-100 disabled:text-slate-400">
    <span className="min-w-0">
      <span className={`block text-sm font-bold leading-snug ${label ? 'text-slate-900' : 'text-slate-400'}`}>{label || placeholder}</span>
      {description && <span className="mt-0.5 block text-[11px] font-medium leading-snug text-slate-500">{description}</span>}
    </span>
    <ChevronRight size={17} className="shrink-0 text-slate-400" />
  </button>
}

export function ChoiceModal({ isOpen, onClose, title, subtitle, options, selectedValue, onSelect, searchable = false, emptyLabel = 'Sin opciones disponibles' }: {
  isOpen: boolean
  onClose: () => void
  title: string
  subtitle?: string
  options: ChoiceOption[]
  selectedValue?: string
  onSelect: (value: string) => void
  searchable?: boolean
  emptyLabel?: string
}) {
  const [search, setSearch] = useState('')
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es')
    return term ? options.filter(option => `${option.label} ${option.description || ''}`.toLocaleLowerCase('es').includes(term)) : options
  }, [options, search])

  return <Modal isOpen={isOpen} onClose={() => { setSearch(''); onClose() }} title={title} subtitle={subtitle}>
    <div className="grid gap-2.5">
      {searchable && <div className="relative"><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><TextInput autoFocus value={search} onChange={event => setSearch(event.target.value)} className="pl-9" placeholder="Buscar..." /></div>}
      <div className="grid gap-2">
        {filtered.map(option => {
          const selected = option.value === selectedValue
          return <button key={option.value} type="button" disabled={option.disabled} onClick={() => { onSelect(option.value); setSearch(''); onClose() }} className={`flex min-h-[56px] w-full min-w-0 items-center gap-3 rounded-2xl border p-3 text-left transition disabled:opacity-45 ${selected ? 'border-[var(--primary)] bg-[var(--primary-soft)]' : 'border-slate-200 bg-white active:bg-slate-50'}`}>
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-[var(--primary)] bg-[var(--primary)] text-white' : 'border-slate-300 text-transparent'}`}><Check size={14} /></span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-extrabold leading-snug text-slate-900">{option.label}</span>{option.description && <span className="mt-0.5 block text-[11px] font-medium leading-snug text-slate-500">{option.description}</span>}</span>
            {option.trailing && <span className="shrink-0 text-xs font-black tabular-nums text-slate-700">{option.trailing}</span>}
          </button>
        })}
        {filtered.length === 0 && <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-xs font-semibold text-slate-500">{emptyLabel}</p>}
      </div>
    </div>
  </Modal>
}
