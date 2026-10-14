import { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Modal } from '../../../components/ui/Modal'
import { Field, NumberInput, Segmented, TextArea, TextInput } from '../../../components/ui/Form'
import { ChoiceButton, ChoiceModal } from '../../../components/ui/ChoiceModal'
import { EmptyBlock, Screen } from '../../../components/ui/Screen'
import { round2 } from '../domain/engine'
import { deleteExpense, newOperationId, registerExpense } from '../data/distributionRepository'
import { QUICK_CONCEPTS, validateExpenseInput } from '../domain/expensesValidation'
import { KpiCard, PrimaryButton, SecondaryButton, formatBs } from './shared'
import type { DistExpense } from '../types'
import type { DistributionViewProps } from './DistributionApp'

/**
 * Gastos de ruta. Restan del efectivo esperado en el arqueo, igual que en el
 * Excel actual de la empresa.
 */
export function ExpensesView({ session, data }: DistributionViewProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedConcept, setSelectedConcept] = useState('Combustible')
  const [customConcept, setCustomConcept] = useState('')
  const [amount, setAmount] = useState('')
  const [routeId, setRouteId] = useState(session.routeId ?? '')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isRouteOpen, setIsRouteOpen] = useState(false)
  const [deleteMode, setDeleteMode] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DistExpense | null>(null)
  const [feedback, setFeedback] = useState('')

  const total = round2(data.expenses.reduce((sum, expense) => sum + expense.amount, 0))

  const resetForm = () => {
    setSelectedConcept('Combustible')
    setCustomConcept('')
    setAmount('')
    setNote('')
    setError(null)
  }

  const handleOpenNew = () => {
    resetForm()
    setIsOpen(true)
  }

  const handleCloseModal = () => {
    if (!isSubmitting) {
      resetForm()
      setIsOpen(false)
    }
  }

  const submit = async () => {
    if (isSubmitting) return

    const validation = validateExpenseInput({
      selectedConcept,
      customConcept,
      amount,
      routeId: session.routeId ?? routeId,
      note,
    })

    if (!validation.valid) {
      setError(validation.error || 'Revisa los campos.')
      return
    }

    setIsSubmitting(true)
    try {
      await registerExpense({
        operationId: newOperationId('exp'),
        concept: validation.concept!,
        amount: validation.amount!,
        routeId: validation.routeId!,
        routeName: data.routes.find((route) => route.id === validation.routeId)?.name ?? validation.routeId!,
        registeredByUid: session.uid,
        registeredByName: session.userName,
        note: validation.note || '',
      })
      resetForm()
      setIsOpen(false)
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
          <div className="flex items-center gap-2">
            {session.role === 'admin' && (
              <button
                type="button"
                aria-label="Eliminar gastos"
                onClick={() => setDeleteMode((value) => !value)}
                className={`flex h-11 w-11 items-center justify-center rounded-2xl border ${
                  deleteMode
                    ? 'border-rose-300 bg-rose-50 text-rose-700'
                    : 'border-slate-200 bg-white text-slate-600'
                }`}
              >
                <Pencil size={17} />
              </button>
            )}
            <PrimaryButton onClick={handleOpenNew}>
              <Plus size={16} /> Nuevo
            </PrimaryButton>
          </div>
        ) : undefined
      }
    >
      <div className="grid w-full min-w-0 gap-3">
        <KpiCard label="Total gastos" value={formatBs(total)} tone="danger" />
        {feedback && (
          <p role="status" className="rounded-2xl bg-emerald-50 p-3 text-xs font-bold text-emerald-800">
            {feedback}
          </p>
        )}
        {deleteMode && (
          <p className="rounded-2xl bg-amber-50 p-3 text-xs font-bold text-amber-800">
            Toca el icono de un gasto para eliminarlo de los totales y reportes.
          </p>
        )}

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
                  <p className="break-words text-xs font-extrabold text-slate-900">{expense.concept}</p>
                  <p className="break-words text-[11px] font-semibold leading-snug text-slate-500">
                    {new Date(expense.createdAt).toLocaleString('es-BO')} · {expense.routeName} ·{' '}
                    {expense.registeredByName}
                  </p>
                  {expense.note && (
                    <p className="break-words text-[11px] text-slate-500 italic mt-0.5">{expense.note}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-sm font-black tabular-nums text-rose-600">{formatBs(expense.amount)}</span>
                  {deleteMode && (
                    <button
                      type="button"
                      aria-label={`Eliminar gasto ${expense.concept}`}
                      onClick={() => {
                        setDeleteTarget(expense)
                        setError(null)
                      }}
                      className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-rose-700"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        isOpen={isOpen}
        onClose={handleCloseModal}
        title="Nuevo gasto"
        footer={
          <PrimaryButton full disabled={isSubmitting} onClick={() => void submit()}>
            {isSubmitting ? 'Guardando...' : 'Registrar gasto'}
          </PrimaryButton>
        }
      >
        <div className="grid gap-3">
          <Field label="Concepto" required>
            <Segmented
              value={selectedConcept}
              onChange={(val) => {
                setSelectedConcept(val)
                setError(null)
              }}
              options={QUICK_CONCEPTS.map((option) => ({ value: option, label: option }))}
            />
          </Field>

          {selectedConcept === 'Otros' && (
            <Field label="Especificar gasto" required>
              <TextInput
                value={customConcept}
                onChange={(event) => {
                  setCustomConcept(event.target.value)
                  setError(null)
                }}
                placeholder="Ej: Peaje, lavado del vehículo, hielo..."
                autoFocus
              />
            </Field>
          )}

          <Field label="Monto (Bs)" required>
            <NumberInput value={amount} min={0} step={1} onChange={(event) => setAmount(event.target.value)} />
          </Field>

          {!session.routeId && (
            <Field label="Ruta" required>
              <ChoiceButton
                label={data.routes.find((route) => route.id === routeId)?.name}
                placeholder="Selecciona ruta"
                onClick={() => setIsRouteOpen(true)}
              />
            </Field>
          )}

          <Field label="Observación">
            <TextArea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Observación opcional..."
            />
          </Field>

          {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Eliminar gasto"
        subtitle={deleteTarget ? `${deleteTarget.concept} · ${formatBs(deleteTarget.amount)}` : ''}
        footer={
          <div className="grid grid-cols-2 gap-2">
            <SecondaryButton full disabled={isSubmitting} onClick={() => setDeleteTarget(null)}>
              Cancelar
            </SecondaryButton>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={async () => {
                if (!deleteTarget) return
                setIsSubmitting(true)
                setError(null)
                try {
                  await deleteExpense(deleteTarget.id)
                  setFeedback('Gasto eliminado de totales y reportes.')
                  setDeleteTarget(null)
                } catch (e) {
                  setError((e as Error).message)
                } finally {
                  setIsSubmitting(false)
                }
              }}
              className="min-h-[44px] rounded-2xl bg-rose-600 px-3 text-sm font-extrabold text-white disabled:opacity-50"
            >
              {isSubmitting ? 'Eliminando...' : 'Sí, eliminar'}
            </button>
          </div>
        }
      >
        <p className="text-sm text-slate-700">
          La acción queda registrada para auditoría, pero el gasto ya no contará en ningún total o reporte.
        </p>
        {error && <p className="mt-3 text-xs font-bold text-rose-600">{error}</p>}
      </Modal>

      <ChoiceModal
        isOpen={isRouteOpen}
        onClose={() => setIsRouteOpen(false)}
        title="Ruta del gasto"
        searchable
        options={data.routes.map((route) => ({ value: route.id, label: route.name }))}
        selectedValue={routeId}
        onSelect={setRouteId}
      />
    </Screen>
  )
}
