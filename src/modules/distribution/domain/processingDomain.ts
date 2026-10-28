import type { DistLot } from '../types.ts'
import type { PackageWeightLedger, ProcessingAvailabilityInput, ProcessingBatch, ProcessingCostComponent, ProcessingDestination, ProcessingSourceAllocation, ProcessingStatus } from './processing.ts'

export class ProcessingValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'ProcessingValidationError' }
}
const fail = (message: string): never => { throw new ProcessingValidationError(message) }
const integerNonNegative = (v: number, label: string): number => {
  if (!Number.isSafeInteger(v) || v < 0) fail(`${label} debe ser un entero no negativo seguro.`)
  return v
}

/** Validates conservation in grams. No tolerance or implicit rounding is allowed. */
export function reconcileProcessingMass(inputWeightG: number, destinations: Pick<ProcessingDestination, 'id' | 'netWeightG'>[]): { inputWeightG: number; outputWeightG: number; differenceG: number } {
  integerNonNegative(inputWeightG, 'El peso de entrada')
  if (inputWeightG === 0) fail('El peso de entrada debe ser mayor a cero.')
  const seen = new Set<string>()
  const outputWeightG = destinations.reduce((sum, item) => {
    if (!item.id || seen.has(item.id)) fail('Cada destino requiere un identificador único.')
    seen.add(item.id)
    return sum + integerNonNegative(item.netWeightG, `El peso del destino ${item.id}`)
  }, 0)
  if (!Number.isSafeInteger(outputWeightG)) fail('La suma de pesos excede el límite seguro.')
  const differenceG = inputWeightG - outputWeightG
  if (differenceG !== 0) fail(`La elaboración no concilia: diferencia de ${Math.abs(differenceG)} g (${differenceG > 0 ? 'sin destino' : 'destinos exceden la entrada'}).`)
  return { inputWeightG, outputWeightG, differenceG }
}

export function validateProcessingSources(sources: ProcessingSourceAllocation[], expectedProductId: string, today: string): void {
  if (!sources.length) fail('Selecciona al menos un lote de origen.')
  const lotIds = new Set<string>()
  for (const source of sources) {
    if (source.sourceProductId !== expectedProductId) fail('No se pueden mezclar productos de SKU diferentes.')
    if (lotIds.has(source.lotId)) fail(`El lote ${source.lotCode || source.lotId} está repetido.`)
    lotIds.add(source.lotId)
    integerNonNegative(source.quantityMilli, 'La cantidad de origen')
    integerNonNegative(source.measuredNetWeightG, 'El peso neto medido')
    if (!source.quantityMilli || !source.measuredNetWeightG) fail('La asignación de origen debe tener cantidad y peso medidos.')
    if (source.originStatus !== 'confirmed') fail('El lote es sintético o tiene origen físico pendiente; requiere conciliación previa.')
    if (source.expiresOn && source.expiresOn < today) fail(`El lote ${source.lotCode || source.lotId} está vencido.`)
    if (source.productionCost === null && source.historicalCostCents !== null) fail('El costo histórico del lote no coincide con su asignación.')
    if (source.historicalCostCents !== null) integerNonNegative(source.historicalCostCents, 'El costo histórico')
  }
}

export function conservativeExpiry(lots: Pick<DistLot, 'expiresOn'>[]): string | null {
  const dates = lots.map(l => l.expiresOn).filter((v): v is string => Boolean(v))
  if (!dates.length) return null
  if (dates.some(v => !/^\d{4}-\d{2}-\d{2}$/.test(v))) fail('El lote de origen tiene vencimiento inválido.')
  return dates.sort()[0]
}

/** Split cents deterministically. Remainder cents go to the earliest destinations. */
export function allocateKnownCost(totalCents: number | null, weightsG: number[]): Array<number | null> {
  if (!weightsG.length || weightsG.some(w => !Number.isSafeInteger(w) || w < 0)) fail('Se requieren pesos válidos para distribuir el costo.')
  const totalWeight = weightsG.reduce((a,b)=>a+b,0)
  if (!Number.isSafeInteger(totalWeight) || totalWeight <= 0) fail('El peso total excede el límite seguro o es cero.')
  if (totalCents === null) return weightsG.map(() => null)
  integerNonNegative(totalCents, 'El costo total')
  const totalBig = BigInt(totalCents)
  const weightBig = BigInt(totalWeight)
  const result = weightsG.map(w => Number((totalBig * BigInt(w)) / weightBig))
  let remainder = totalCents - result.reduce((a,b)=>a+b,0)
  for (let i=0; remainder > 0; i=(i+1)%result.length) { if (weightsG[i] > 0) { result[i]++; remainder-- } }
  return result
}

export function calculateSourceCost(sources: ProcessingSourceAllocation[]): { known: boolean; totalCents: number | null } {
  if (sources.some(s => s.historicalCostCents === null)) return { known: false, totalCents: null }
  const total = sources.reduce((sum, source) => sum + (source.historicalCostCents || 0), 0)
  if (!Number.isSafeInteger(total)) fail('El costo de origen excede el límite seguro.')
  return { known: true, totalCents: total }
}

export function validateCostComponents(components: ProcessingCostComponent[]): void {
  const ids = new Set<string>()
  for (const c of components) {
    if (!c.id || ids.has(c.id)) fail('Los componentes de costo deben tener identificadores únicos.')
    ids.add(c.id)
    if (c.amountCents !== null) integerNonNegative(c.amountCents, 'El importe del costo')
    if (c.alreadyRecognizedAsOperatingExpense && c.capitalizable) fail('Un gasto ya reconocido no se puede capitalizar nuevamente.')
    if (c.capitalizable && c.amountCents === null) fail('No se puede capitalizar un costo sin importe verificable.')
    if (c.expenseId && !c.sourceReference) fail('Un costo enlazado a Egresos requiere una referencia de asignación auditada.')
  }
}

export function createPackageWeightLedger(packageCount: number, measuredNetWeightG: number, weightBasis: PackageWeightLedger['weightBasis']): PackageWeightLedger {
  integerNonNegative(packageCount, 'La cantidad de paquetes'); integerNonNegative(measuredNetWeightG, 'El peso medido')
  if (packageCount === 0 || measuredNetWeightG === 0) fail('La cantidad y el peso de paquetes deben ser mayores a cero.')
  if (weightBasis === 'individual_measurements') fail('El registro individual requiere una medición por paquete y no se crea desde un peso agregado.')
  return { packageCount, measuredNetWeightG, consumedCount: 0, consumedWeightG: 0, nextPackageIndex: 0, weightBasis }
}

/** FIFO assignment preserves every gram; the final package consumes the exact remainder. */
export function consumePackageWeight(ledger: PackageWeightLedger, count: number): { consumedWeightG: number; remaining: PackageWeightLedger } {
  for (const [key, value] of Object.entries({ packageCount: ledger.packageCount, measuredNetWeightG: ledger.measuredNetWeightG, consumedCount: ledger.consumedCount, consumedWeightG: ledger.consumedWeightG, nextPackageIndex: ledger.nextPackageIndex })) integerNonNegative(value, key)
  if (ledger.packageCount === 0 || ledger.measuredNetWeightG === 0 || ledger.consumedCount > ledger.packageCount || ledger.consumedWeightG > ledger.measuredNetWeightG || ledger.nextPackageIndex !== ledger.consumedCount) fail('El registro de peso del lote de paquetes es inconsistente.')
  integerNonNegative(count, 'La cantidad a consumir')
  const remainingCount = ledger.packageCount - ledger.consumedCount
  const remainingWeight = ledger.measuredNetWeightG - ledger.consumedWeightG
  if (!count || count > remainingCount) fail('No hay suficientes paquetes en el lote.')
  let consumedWeightG: number
  if (count === remainingCount) consumedWeightG = remainingWeight
  else {
    const base = Math.floor(ledger.measuredNetWeightG / ledger.packageCount)
    const extra = ledger.measuredNetWeightG % ledger.packageCount
    consumedWeightG = count * base + Math.max(0, Math.min(ledger.nextPackageIndex + count, extra) - Math.min(ledger.nextPackageIndex, extra))
  }
  return { consumedWeightG, remaining: { ...ledger, consumedCount: ledger.consumedCount + count, consumedWeightG: ledger.consumedWeightG + consumedWeightG, nextPackageIndex: ledger.nextPackageIndex + count } }
}

/** Categories must be disjoint; callers provide exclusive grams, not overlapping flags. */
export function calculateProcessingAvailability(input: ProcessingAvailabilityInput): { physicalG: number; unavailableG: number; availableG: number; byReason: Required<Omit<ProcessingAvailabilityInput, 'physicalG'>> } {
  const physicalG = integerNonNegative(input.physicalG, 'La existencia física')
  const keys = ['expiredG','quarantinedG','pendingOriginG','repackPendingG','reviewHoldG','courtesyReservedG','otherUnavailableG'] as const
  const byReason = Object.fromEntries(keys.map(k => [k, integerNonNegative(input[k] ?? 0, k)])) as Required<Omit<ProcessingAvailabilityInput, 'physicalG'>>
  const unavailableG = Object.values(byReason).reduce((a,b)=>a+b,0)
  if (unavailableG > physicalG) fail('Las cantidades no disponibles se solapan o superan la existencia física.')
  return { physicalG, unavailableG, availableG: physicalG - unavailableG, byReason }
}

const allowedTransitions: Record<ProcessingStatus, ProcessingStatus[]> = {
  draft: ['confirmed'], confirmed: ['corrected','reversed'], corrected: ['corrected','reversed'], reversed: [],
}
export function canTransitionProcessingStatus(from: ProcessingStatus, to: ProcessingStatus, hasPhysicalDependencies: boolean): boolean {
  return allowedTransitions[from].includes(to) && !(to === 'reversed' && hasPhysicalDependencies)
}

export function canReverseProcessingBatch(batch: Pick<ProcessingBatch, 'status' | 'reversal'>): { allowed: boolean; reason?: string } {
  if (!['confirmed','corrected'].includes(batch.status)) return { allowed: false, reason: 'Solo se pueden revisar elaboraciones confirmadas.' }
  if (batch.reversal.dependencyIds.length) return { allowed: false, reason: 'Hay lotes derivados con movimientos posteriores; requiere corrección compensatoria autorizada.' }
  if (batch.reversal.status === 'blocked') return { allowed: false, reason: batch.reversal.reason || 'La reversión está bloqueada.' }
  return { allowed: true }
}
