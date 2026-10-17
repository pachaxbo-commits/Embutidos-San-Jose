import { projectBalances } from '../offlineProjections.ts'
import { stockAvailability } from '../stockAvailability.ts'
import type { DistBalance, DistLot, DistSale } from '../../types.ts'

const assertEqual = (actual: unknown, expected: unknown) => {
  if (actual !== expected) throw new Error(`Se esperaba ${String(expected)} y se obtuvo ${String(actual)}`)
}
const assertObject = (actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Se esperaba ${JSON.stringify(expected)} y se obtuvo ${JSON.stringify(actual)}`)
}

const productId = 'viena-2'
const today = '2026-10-17'
const balance = (quantity: number): DistBalance => ({
  id: `central__${productId}`, restaurantId: 'sanjose', locationKind: 'central',
  productId, productName: 'Salchicha tipo Viena Granel 2 economico',
  unitType: 'kg', quantity, updatedAt: today,
})
const lot = (id: string, quantity: number, extra: Partial<DistLot> = {}): DistLot => ({
  id, restaurantId: 'sanjose', productId, productName: 'Viena', unitType: 'kg',
  lotCode: id, manufacturedOn: '', expiresOn: '2026-10-26', productionCost: null,
  quantities: { central: quantity }, createdAt: today, createdBy: 'test', ...extra,
})
const projected = (raw: DistBalance, lots: DistLot[], pending: DistSale[] = []) =>
  projectBalances([raw], pending, lots, today)[0]

const expiredLots = [lot('sellable', 2.94), lot('expired', 0.02, { expiresOn: '2026-10-16' })]
assertObject(stockAvailability(projected(balance(2.96), expiredLots), expiredLots, 'central', today), {
  physical: 2.96, available: 2.94, unavailable: 0.02, quarantine: 0, expired: 0.02, other: 0,
})

const quarantineLots = [lot('sellable', 2.94), lot('surplus', 0.02, { quarantined: true })]
assertObject(stockAvailability(projected(balance(2.96), quarantineLots), quarantineLots, 'central', today), {
  physical: 2.96, available: 2.94, unavailable: 0.02, quarantine: 0.02, expired: 0, other: 0,
})
assertObject(stockAvailability(projected(balance(0.02), [quarantineLots[1]]), [quarantineLots[1]], 'central', today), {
  physical: 0.02, available: 0, unavailable: 0.02, quarantine: 0.02, expired: 0, other: 0,
})

const allSellable = [lot('sellable', 2.96)]
assertEqual(stockAvailability(projected(balance(2.96), allSellable), allSellable, 'central', today).available, 2.96)

const pending = [{ sourceLocation: 'central', lines: [{ productId, quantity: 0.1 }] }] as unknown as DistSale[]
const pendingStock = stockAvailability(projected(balance(3), [lot('sellable', 3)], pending), [lot('sellable', 3)], 'central', today)
assertEqual(pendingStock.physical, 2.9)
assertEqual(pendingStock.available, 2.9)
assertEqual(pendingStock.unavailable, 0)

const preciseLots = [lot('sellable', 2.935), lot('surplus', 0.02, { quarantined: true })]
assertObject(stockAvailability(projected(balance(2.955), preciseLots), preciseLots, 'central', today), {
  physical: 2.955, available: 2.935, unavailable: 0.02, quarantine: 0.02, expired: 0, other: 0,
})

console.log('PASS existencia física, vendible, vencido, cuarentena, venta pendiente y precisión kg')
