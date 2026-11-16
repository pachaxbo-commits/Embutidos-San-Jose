// Pruebas unitarias de validación de duración y motivo para autorización temporal de crédito

function validateCreditOverrideInput(mode: string, customDays: string, reason: string): { valid: boolean; error?: string; days?: number } {
  const rawDays = mode === 'custom' ? customDays : mode
  const days = Number(rawDays)
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    return { valid: false, error: 'Indica entre 1 y 90 días válidos.' }
  }
  if (!reason.trim()) {
    return { valid: false, error: 'Indica el motivo de la autorización temporal.' }
  }
  return { valid: true, days }
}

// 1. Presets estándar: 1, 2, 3, 7, 10 días
for (const preset of ['1', '2', '3', '7', '10']) {
  const res = validateCreditOverrideInput(preset, '', 'Autorizado por gerencia')
  if (!res.valid || res.days !== Number(preset)) {
    throw new Error(`Preset ${preset} días falló validación: ${JSON.stringify(res)}`)
  }
}

// 2. Días personalizados: 15 días (caso reportado por la Lic)
const custom15 = validateCreditOverrideInput('custom', '15', 'Pedido especial de fin de semana')
if (!custom15.valid || custom15.days !== 15) {
  throw new Error(`Días personalizados 15 falló validación: ${JSON.stringify(custom15)}`)
}

// 3. Días personalizados: límites 1 y 90
const custom1 = validateCreditOverrideInput('custom', '1', 'Urgente')
if (!custom1.valid || custom1.days !== 1) throw new Error('Día 1 debe ser válido')

const custom90 = validateCreditOverrideInput('custom', '90', 'Convenio trimestral')
if (!custom90.valid || custom90.days !== 90) throw new Error('Día 90 debe ser válido')

// 4. Valores inválidos rechazados: 0, 91, negativos, decimales, no numéricos
const invalidDays = ['0', '91', '-5', '15.5', 'abc', '']
for (const bad of invalidDays) {
  const res = validateCreditOverrideInput('custom', bad, 'Motivo')
  if (res.valid) {
    throw new Error(`Valor inválido ${bad} fue aceptado incorrectamente`)
  }
}

// 5. Motivo obligatorio
const emptyReason = validateCreditOverrideInput('custom', '15', '   ')
if (emptyReason.valid || !emptyReason.error?.includes('motivo')) {
  throw new Error('Motivo vacío debe ser rechazado')
}

console.log('PASS creditOverrideValidation: validación de duración (1-90 días, preset 10, custom 15) y motivo obligatorio')
