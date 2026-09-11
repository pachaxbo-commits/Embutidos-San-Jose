import { useState } from 'react'
import { Field, Segmented, TextInput } from '../../../components/ui/Form'
import { ChoiceButton, ChoiceModal } from '../../../components/ui/ChoiceModal'
import { buildDayRange } from '../state/useDistributionStore'
import { toDayKey } from '../domain/engine'
import type { DistRoute } from '../types'

export type RangePreset = 'today' | 'week' | 'month' | 'custom'

/** 2026-08-14 -> 14/08/2026 */
export function formatDayKey(dayKey: string): string {
  const [year, month, day] = (dayKey || '').split('-')
  return year ? `${day}/${month}/${year}` : dayKey
}

export function describeRange(dayKeys: string[]): string {
  if (dayKeys.length === 0) return ''
  if (dayKeys.length === 1) return formatDayKey(dayKeys[0])
  return `${formatDayKey(dayKeys[0])} a ${formatDayKey(dayKeys[dayKeys.length - 1])}`
}

/**
 * Selector de periodo compartido por el panel y los reportes: la duena espera
 * elegir las fechas igual en las dos pantallas.
 */
export function RangePicker({
  dayKeys,
  onChange,
  routes,
  routeFilter,
  onRouteFilterChange,
}: {
  dayKeys: string[]
  onChange: (dayKeys: string[]) => void
  routes?: DistRoute[]
  routeFilter?: string
  onRouteFilterChange?: (routeId: string) => void
}) {
  const [rangeError, setRangeError] = useState('')
  const [preset, setPreset] = useState<RangePreset>(dayKeys.length === 1 ? 'today' : 'custom')
  const [from, setFrom] = useState(dayKeys[0] ?? toDayKey(new Date()))
  const [to, setTo] = useState(dayKeys[dayKeys.length - 1] ?? toDayKey(new Date()))
  const [isRouteOpen, setIsRouteOpen] = useState(false)

  const applyPreset = (next: RangePreset) => {
    setPreset(next)
    const today = new Date()

    if (next === 'today') {
      onChange([toDayKey(today)])
      return
    }
    if (next === 'week') {
      const start = new Date(today)
      start.setDate(start.getDate() - 6)
      onChange(buildDayRange(start, today))
      return
    }
    if (next === 'month') {
      const start = new Date(today)
      start.setDate(1)
      onChange(buildDayRange(start, today))
    }
  }

  const applyCustom = (nextFrom: string, nextTo: string) => {
    const start = new Date(`${nextFrom}T00:00:00`)
    const end = new Date(`${nextTo}T00:00:00`)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return
    if (start > end) { setRangeError('La fecha inicial debe ser anterior a la final.'); return }
    if ((end.getTime() - start.getTime()) / 86400000 > 365) { setRangeError('Consulta hasta un ano por vez.'); return }
    setRangeError('')
    onChange(buildDayRange(start, end))
  }

  return (
    <div className="grid w-full min-w-0 gap-2">
      <Segmented
        value={preset}
        onChange={applyPreset}
        options={[
          { value: 'today', label: 'Hoy' },
          { value: 'week', label: 'Semana' },
          { value: 'month', label: 'Mes' },
          { value: 'custom', label: 'Fechas' },
        ]}
      />

      {preset === 'custom' && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Desde">
            <TextInput
              type="date"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value)
                applyCustom(event.target.value, to)
              }}
            />
          </Field>
          <Field label="Hasta">
            <TextInput
              type="date"
              value={to}
              onChange={(event) => {
                setTo(event.target.value)
                applyCustom(from, event.target.value)
              }}
            />
          </Field>
        </div>
      )}

      {rangeError && <p role="alert" className="text-xs text-rose-700">{rangeError}</p>}
      {routes && onRouteFilterChange && (
        <Field label="Ruta">
          <ChoiceButton
            label={routeFilter ? routes.find(route => route.id === routeFilter)?.name : 'Todas las rutas'}
            placeholder="Todas las rutas"
            onClick={() => setIsRouteOpen(true)}
          />
        </Field>
      )}
      {routes && onRouteFilterChange && <ChoiceModal
        isOpen={isRouteOpen}
        onClose={() => setIsRouteOpen(false)}
        title="Filtrar por ruta"
        searchable
        options={[{ value: '', label: 'Todas las rutas' }, ...routes.map(route => ({ value: route.id, label: route.name }))]}
        selectedValue={routeFilter ?? ''}
        onSelect={onRouteFilterChange}
      />}
    </div>
  )
}
