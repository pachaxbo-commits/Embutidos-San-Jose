import { boliviaDayKey, validateIntakeLotDates } from '../inventoryIntakeValidation.ts'
import { operationFailureMessage } from '../operationFailureMessage.ts'

function equal(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`)
  console.log('PASS', label)
}

const now = new Date('2026-10-20T03:30:00.000Z') // 19/10 23:30 en Bolivia
equal(boliviaDayKey(now), '2026-10-19', 'la jornada usa America/La_Paz y no el día UTC')
equal(validateIntakeLotDates('', '2026-10-25', now), 'Selecciona la fecha de elaboración.', 'fecha de elaboración obligatoria')
equal(validateIntakeLotDates('2026-10-10', '', now), 'Selecciona la fecha de vencimiento.', 'fecha de vencimiento obligatoria')
equal(validateIntakeLotDates('2026-10-20', '2026-10-25', now), 'La elaboración no puede tener una fecha futura.', 'rechaza elaboración futura según el día boliviano')
equal(validateIntakeLotDates('2026-10-10', '2026-10-09', now), 'El vencimiento no puede ser anterior a la elaboración.', 'rechaza vencimiento anterior')
equal(validateIntakeLotDates('2026-02-31', '2026-03-05', now), 'Selecciona una fecha de elaboración válida.', 'rechaza fechas calendario imposibles')
equal(validateIntakeLotDates('2026-10-19', '2026-10-19', now), null, 'acepta lote válido en la jornada Bolivia actual')
equal(boliviaDayKey(new Date('2026-10-20T04:00:00.000Z')), '2026-10-20', 'cambio de jornada ocurre a medianoche boliviana')

equal(operationFailureMessage('resolveQuarantine', Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })), 'No se pudo confirmar la revisión. No vuelvas a registrarla hasta comprobar su estado.', 'permiso de cuarentena muestra instrucción segura y clara')
equal(operationFailureMessage('intake', Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })), 'No se pudo confirmar el ingreso por falta de permisos. No vuelvas a registrarlo hasta comprobar su estado.', 'permiso de ingreso no se confunde con fallo de fechas')
equal(operationFailureMessage('intake', Object.assign(new Error('Revisa las fechas del lote.'), { rejected: true })), 'Ingreso de inventario rechazado. La fecha de elaboración o vencimiento necesita corregirse.', 'rechazo de ingreso identifica la fecha')
equal(operationFailureMessage('resolveQuarantine', new Error('La operación sigue pendiente de confirmación.')), 'La revisión sigue pendiente de confirmación. No vuelvas a registrarla hasta comprobar su estado.', 'revisión pendiente no se presenta como rechazada ni guardada')
console.log('PASS validación de fechas y mensajes de fallos de inventario')
