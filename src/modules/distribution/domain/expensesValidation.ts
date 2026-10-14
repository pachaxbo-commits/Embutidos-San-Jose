import { round2 } from './engine.ts'

export const QUICK_CONCEPTS = ['Combustible', 'Estacionamiento', 'Refrigerio', 'Mantenimiento', 'Otros'] as const
export type QuickConcept = typeof QUICK_CONCEPTS[number]

export interface ExpenseValidationInput {
  selectedConcept: string
  customConcept: string
  amount: string | number
  routeId: string
  note?: string
}

export interface ExpenseValidationResult {
  valid: boolean
  error?: string
  concept?: string
  amount?: number
  routeId?: string
  note?: string
}

/**
 * Valida y resuelve el concepto real del gasto según las reglas de negocio:
 * - Si es "Otros", exige un concepto personalizado escrito (no vacío ni solo espacios)
 *   y guarda ese texto como el concept real (ej: "Peaje").
 * - Si es un botón rápido estándar (ej: "Combustible"), guarda ese nombre directamente
 *   ignorando cualquier texto previo de "Otros".
 * - La observación (note) se mantiene estrictamente separada del concepto.
 */
export function validateExpenseInput(input: ExpenseValidationInput): ExpenseValidationResult {
  const selected = (input.selectedConcept || '').trim()
  const custom = (input.customConcept || '').trim()
  const note = (input.note || '').trim()

  let finalConcept = ''

  if (selected === 'Otros') {
    if (!custom) {
      return {
        valid: false,
        error: 'Especifica el tipo de gasto.',
      }
    }
    finalConcept = custom
  } else {
    finalConcept = selected
  }

  if (!finalConcept) {
    return {
      valid: false,
      error: 'Indica el concepto del gasto.',
    }
  }

  const value = round2(Number(input.amount))
  if (!Number.isFinite(value) || !(value > 0)) {
    return {
      valid: false,
      error: 'El monto debe ser mayor a cero.',
    }
  }

  const routeId = (input.routeId || '').trim()
  if (!routeId) {
    return {
      valid: false,
      error: 'Selecciona la ruta a la que corresponde el gasto.',
    }
  }

  return {
    valid: true,
    concept: finalConcept,
    amount: value,
    routeId,
    note,
  }
}
