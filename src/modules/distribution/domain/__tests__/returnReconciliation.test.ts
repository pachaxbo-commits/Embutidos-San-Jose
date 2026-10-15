import { calculateReturnBreakdown, validateReturnQuantity } from '../returnReconciliation.ts'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`FAIL: ${message}`)
  console.log(`PASS: ${message}`)
}

const a = calculateReturnBreakdown(10, 10, 0)
assert(a.shortage === 0 && a.overage === 0, '10 kg aptos no generan faltante ni sobrante')
const b = calculateReturnBreakdown(10, 8, 2)
assert(b.shortage === 0 && b.overage === 0, '8 kg aptos + 2 kg de merma cuadran')
const c = calculateReturnBreakdown(10, 8, 1)
assert(c.shortage === 1, 'faltante solo refleja el kilogramo no explicado')
const d = calculateReturnBreakdown(10, 11, 0)
assert(d.overage === 1 && d.shortage === 0, 'sobrante conserva su clasificación separada')
const e = calculateReturnBreakdown(10, 12, 1)
assert(e.overage === 3 && e.shortage === 0, 'separa sobrante físico cuando retorno y merma exceden lo registrado')
assert(!validateReturnQuantity('package', 1.5), 'paquetes rechazan fracciones')
assert(validateReturnQuantity('kg', 1.5), 'kilogramos admiten decimales')
assert(!validateReturnQuantity('kg', -1), 'ninguna unidad permite retorno negativo')
console.log('Suite de rendición de retorno: 8 comprobaciones.')
