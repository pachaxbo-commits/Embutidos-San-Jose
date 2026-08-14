import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Modal } from '../../../components/ui/Modal'
import { Field, NumberInput, SelectInput, TextArea, TextInput } from '../../../components/ui/Form'
import { EmptyBlock, Screen } from '../../../components/ui/Screen'
import { round2 } from '../domain/engine'
import { newOperationId, registerExpense } from '../data/distributionRepository'
import { KpiCard, PrimaryButton, formatBs } from './shared'
import type { DistributionViewProps } from './DistributionApp'

const QUICK_CONCEPTS = ['Combustible', 'Estacionamiento', 'Refrigerio', 'Mantenimiento', 'Otros']

/**
 * Gastos de ruta. Restan del efectivo esperado en el arqueo, igual que en el
 * Excel actual de la empresa.
 */
export function ExpensesView({ session, data }: DistributionViewProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [concept, setConcept] = useState('Combustible')
  const [amount, setAmount] = useState('')
  const [routeId, setRouteId] = useState(session.routeId ?? '')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const total = round2(data.expenses.reduce((sum, expense) => sum + expense.amount, 0))

  const submit = async () => {
    if (isSubmitting) return
    const value = round2(Number(amount))
    if (!concept.trim()) {
      setError('Indica el concepto del gasto.')
      return
    }
    if (!(value > 0)) {
      setError('El monto debe ser mayor a cero.')
      return
    }
    const targetRoute = session.routeId ?? routeId
    if (!targetRoute) {
      setError('Selecciona la ruta a la que corresponde el gasto.')
      return
    }

    setIsSubmitting(true)
    try {
      await registerExpense({
        operationId: newOperationId('exp'),
        concept,
        amount: value,
        routeId: targetRoute,
        routeName: data.routes.find((route) => route.id === targetRoute)?.name ?? targetRoute,
        registeredByUid: session.uid,
        registeredByName: session.userName,
        note,
      })
      setIsOpen(false)
      setAmount('')
      setNote('')
      setError(null)
    } catch (submitError) {
      setError((submitError as Error).message || 'No se pudo registrar el gasto.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Screen
      title="Gastos"
      subtitle="Gastos del periodo por ruta"
      actions={
        session.can('dist.expense.create') ? (
          <PrimaryButton onClick={() => setIsOpen(true)}>
            <Plus size={16} /> Nuevo
          </PrimaryButton>
        ) : undefined
      }
    >
      <div className="grid w-full min-w-0 gap-3">
        <KpiCard label="Total gastos" value={formatBs(total)} tone="danger" />

        {data.expenses.length === 0 ? (
          <EmptyBlock title="Sin gastos registrados" />
        ) : (
          <div className="grid gap-2">
            {data.expenses.map((expense) => (
              <div
                key={expense.id}
                className="flex w-full min-w-0 items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-extrabold text-slate-900">{expense.concept}</p>
                  <p className="truncate text-[11px] font-semibold text-slate-500">
                    {new Date(expense.createdAt).toLocaleString('es-BO')} · {expense.routeName} ·{' '}
                    {expense.registeredByName}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-black tabular-nums text-rose-600">
                  {formatBs(expense.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title="Nuevo gasto"
        footer={
          <PrimaryButton full disabled={isSubmitting} onClick={() => void submit()}>
            {isSubmitting ? 'Guardando...' : 'Registrar gasto'}
          </PrimaryButton>
        }
      >
        <div className="grid gap-3">
          <Field label="Concepto" required>
            <SelectInput value={concept} onChange={(event) => setConcept(event.target.value)}>
              {QUICK_CONCEPTS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </SelectInput>
          </Field>
          {concept === 'Otros' && (
            <Field label="Detalle del concepto">
              <TextInput value={note} onChange={(event) => setNote(event.target.value)} placeholder="Describe el gasto" />
            </Field>
          )}
          <Field label="Monto (Bs)" required>
            <NumberInput value={amount} min={0} step={1} onChange={(event) => setAmount(event.target.value)} />
          </Field>
          {!session.routeId && (
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
          <Field label="Observacion">
            <TextArea value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
          {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
        </div>
      </Modal>
    </Screen>
  )
}
