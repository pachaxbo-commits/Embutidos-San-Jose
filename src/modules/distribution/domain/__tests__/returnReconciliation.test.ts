import { calculateReturnBreakdown, validateReturnQuantity } from '../returnReconciliation.ts'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`FAIL: ${message}`)
  console.log(`PASS: ${message}`)
}

const a = calculateReturnBreakdown(6, 6, 0.46)
assert(a.apt === 5.54 && a.waste === 0.46 && a.shortage === 0 && a.overage === 0, '6 kg recibidos con 0,46 kg de merma dejan 5,54 kg aptos sin diferencia')
const b = calculateReturnBreakdown(9, 9, 0.44)
assert(b.apt === 8.56 && b.waste === 0.44 && b.shortage === 0 && b.overage === 0, '9 kg recibidos con 0,44 kg de merma dejan 8,56 kg aptos sin diferencia')
const c = calculateReturnBreakdown(6, 5.8, 0.46)
assert(c.apt === 5.34 && c.shortage === 0.2 && c.overage === 0, 'faltante se calcula desde la recepción física, no desde el retorno apto')
const d = calculateReturnBreakdown(6, 6.46, 0)
assert(d.apt === 6 && d.overage === 0.46 && d.shortage === 0, 'el sobrante físico sobre lo esperado va a cuarentena')
const e = calculateReturnBreakdown(6, 6.46, 0.46)
assert(e.apt === 5.54 && e.waste === 0.46 && e.overage === 0.46 && e.shortage === 0, 'merma y sobrante se separan aunque ocurran juntos')
const invalidWaste = calculateReturnBreakdown(6, 0.4, 0.46)
assert(!invalidWaste.wasteValid, 'merma mayor a la recepción física queda inválida para bloquear el guardado')
assert(!validateReturnQuantity('package', 1.5), 'paquetes rechazan fracciones')
assert(validateReturnQuantity('kg', 1.5), 'kilogramos admiten decimales')
assert(!validateReturnQuantity('kg', -1), 'ninguna unidad permite retorno negativo')
console.log('Suite de rendición de retorno: 9 comprobaciones.')
