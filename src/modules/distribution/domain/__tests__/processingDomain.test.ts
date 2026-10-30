import { allocateKnownCost, calculateProcessingAvailability, calculateSourceCost, canReverseProcessingBatch, canTransitionProcessingStatus, conservativeExpiry, consumePackageWeight, createPackageWeightLedger, ProcessingValidationError, reconcileProcessingMass, validateCostComponents, validateProcessingSources } from '../processingDomain.ts'
import type { ProcessingCostComponent, ProcessingDestination, ProcessingSourceAllocation } from '../processing.ts'

const assert = {
  equal(actual: unknown, expected: unknown) { if (actual !== expected) throw new Error(`Expected ${String(expected)}, got ${String(actual)}`) },
  deepEqual(actual: unknown, expected: unknown) { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`) },
  throws(fn: () => unknown, predicate: (error: unknown) => boolean) { try { fn() } catch (error) { if (predicate(error)) return; throw error } throw new Error('Expected function to throw') },
}
const destination = (id: string, netWeightG: number): ProcessingDestination => ({ id, kind: 'finished', commercialQuantity: 1, netWeightG, sourceAllocations: [], approvalStatus: 'not_required' })
const throwsWith = (fn: () => unknown, text: string) => assert.throws(fn, (e: unknown) => e instanceof ProcessingValidationError && e.message.includes(text))

assert.deepEqual(reconcileProcessingMass(10_000, [destination('sachets',9_000),destination('courtesy',700),destination('discard',300)]), { inputWeightG: 10_000, outputWeightG: 10_000, differenceG: 0 })
throwsWith(() => reconcileProcessingMass(10_000,[destination('sachets',9_001),destination('courtesy',700),destination('discard',300)]),'1 g')
throwsWith(() => reconcileProcessingMass(10_000,[destination('sachets',9_000)]),'sin destino')
assert.equal(reconcileProcessingMass(10_000,[destination('nominal-250-but-measured-9000',9_000),destination('courtesy',1_000)]).differenceG,0)

const packages = createPackageWeightLedger(3,1_001,'documented_average')
const first = consumePackageWeight(packages,1)
const second = consumePackageWeight(first.remaining,1)
const last = consumePackageWeight(second.remaining,1)
assert.deepEqual([first.consumedWeightG,second.consumedWeightG,last.consumedWeightG],[334,334,333])
assert.equal(first.consumedWeightG+second.consumedWeightG+last.consumedWeightG,1_001)
assert.equal(last.remaining.consumedWeightG,1_001)
throwsWith(()=>consumePackageWeight(packages,4),'suficientes')

assert.deepEqual(allocateKnownCost(1_001,[3,3,3]),[334,334,333])
assert.deepEqual(allocateKnownCost(null,[3,4]),[null,null])
assert.deepEqual(calculateSourceCost([{historicalCostCents:120,quantityMilli:1,measuredNetWeightG:1} as ProcessingSourceAllocation]),{known:true,totalCents:120})
assert.deepEqual(calculateSourceCost([{historicalCostCents:null,quantityMilli:1,measuredNetWeightG:1} as ProcessingSourceAllocation]),{known:false,totalCents:null})

const source = (overrides: Partial<ProcessingSourceAllocation> = {}): ProcessingSourceAllocation => ({ lotId:'lot-a',lotCode:'A',expiresOn:'2027-01-01',quantity:1,quantityMilli:1,measuredNetWeightG:1,sourceProductId:'sku',sourceUnitType:'kg',productionCost:2,historicalCostCents:200,originStatus:'confirmed',...overrides })
validateProcessingSources([source(),source({lotId:'lot-b',lotCode:'B'})],'sku','2026-10-28')
throwsWith(()=>validateProcessingSources([source({sourceProductId:'other'})],'sku','2026-10-28'),'SKU diferentes')
throwsWith(()=>validateProcessingSources([source({originStatus:'pending'})],'sku','2026-10-28'),'origen físico pendiente')
throwsWith(()=>validateProcessingSources([source({originStatus:'synthetic'})],'sku','2026-10-28'),'sintético')
throwsWith(()=>validateProcessingSources([source({expiresOn:'2026-10-27'})],'sku','2026-10-28'),'vencido')
assert.equal(conservativeExpiry([{expiresOn:'2027-02-01'},{expiresOn:'2027-01-01'}] as never[]),'2027-01-01')
assert.equal(conservativeExpiry([{expiresOn:''}] as never[]),null)

assert.deepEqual(calculateProcessingAvailability({physicalG:20_000,courtesyReservedG:2_000}),{physicalG:20_000,unavailableG:2_000,availableG:18_000,byReason:{expiredG:0,quarantinedG:0,pendingOriginG:0,repackPendingG:0,reviewHoldG:0,courtesyReservedG:2_000,otherUnavailableG:0}})
throwsWith(()=>calculateProcessingAvailability({physicalG:1_000,courtesyReservedG:700,reviewHoldG:400}),'superan')
assert.equal(calculateProcessingAvailability({physicalG:19_500,courtesyReservedG:1_500}).availableG,18_000)

const alreadySpent: ProcessingCostComponent = {id:'expense-1',kind:'packaging',amountCents:500,expenseId:'e1',alreadyRecognizedAsOperatingExpense:true,capitalizable:true,sourceReference:'allocation-1'}
throwsWith(()=>validateCostComponents([alreadySpent]),'nuevamente')
validateCostComponents([{...alreadySpent,capitalizable:false}])
assert.equal(canTransitionProcessingStatus('draft','confirmed',false),true)
assert.equal(canTransitionProcessingStatus('confirmed','reversed',true),false)
assert.equal(canReverseProcessingBatch({status:'confirmed',reversal:{status:'clear',dependencyIds:[]}}).allowed,true)
assert.equal(canReverseProcessingBatch({status:'confirmed',reversal:{status:'clear',dependencyIds:['sale-1']}}).allowed,false)

console.log('processingDomain: conservación física, gramos, paquetes, costos, reservas, trazabilidad y reversión PASS')
