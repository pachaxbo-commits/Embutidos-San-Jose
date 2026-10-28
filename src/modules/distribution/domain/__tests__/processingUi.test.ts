import { decimalInputToScaledInteger, gramsInput, isEligibleProcessingLot, kgInputToGrams, lotAvailableQuantity } from '../processingUi.ts'
import type { DistLot } from '../../types.ts'
import { getVisibleModules } from '../../../../config/appConfig.ts'

const equal = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) throw new Error(`${label}: esperado ${expected}, recibido ${actual}`)
}
const baseLot: DistLot = {
  id: 'lot-a', restaurantId: 'sanjose', productId: 'bulk-a', productName: 'Carne a granel', unitType: 'kg',
  lotCode: 'LOT-A', manufacturedOn: '2026-10-01', expiresOn: '2026-12-01', productionCost: 12,
  quantities: { central: 10 }, quarantined: false, legacy: false, createdAt: '2026-10-01T12:00:00Z', createdBy: 'qa',
}
equal(kgInputToGrams('10'), 10000, 'kg entero a gramos')
equal(kgInputToGrams('1,250'), 1250, 'coma decimal a gramos')
equal(kgInputToGrams('1.25'), 1250, 'punto decimal a gramos')
equal(kgInputToGrams('1.2505'), null, 'rechaza más de tres decimales en kg')
equal(kgInputToGrams('0'), null, 'rechaza cero kg')
equal(gramsInput('9000'), 9000, 'gramos enteros medidos')
equal(gramsInput('9.000'), null, 'rechaza fracciones de gramo')
equal(decimalInputToScaledInteger('2,345', 1000), 2345, 'cantidad de material en milésimas')
equal(decimalInputToScaledInteger('12,50', 100), 1250, 'costo expresado en centavos')
equal(decimalInputToScaledInteger('12,501', 100), null, 'costo no redondea decimales ocultos')
equal(lotAvailableQuantity({ ...baseLot, processingUnavailable: { central: { courtesy: 1, repackPending: 1, reviewHold: 1 } } }, 'central'), 7, 'descuenta reservas de elegibilidad de lote')
equal(isEligibleProcessingLot(baseLot, 'bulk-a', 'central', '2026-10-28'), true, 'lote normal vigente elegible')
equal(isEligibleProcessingLot({ ...baseLot, quarantined: true }, 'bulk-a', 'central', '2026-10-28'), false, 'lote en cuarentena excluido')
equal(isEligibleProcessingLot({ ...baseLot, expiresOn: '2026-10-27' }, 'bulk-a', 'central', '2026-10-28'), false, 'lote vencido excluido')
equal(isEligibleProcessingLot({ ...baseLot, legacy: true }, 'bulk-a', 'central', '2026-10-28'), false, 'lote sintético/legacy excluido')
equal(isEligibleProcessingLot({ ...baseLot, quantities: { central: 0.5 }, pendingOrigins: { central: [{ quantity: 0.1, exceptionId: 'pending', accountingLotId: 'lot-a', sourceMovementId: 'move-a', physicalOriginConfirmed: false, basis: 'original_accounting_debit_only' }] } }, 'bulk-a', 'central', '2026-10-28'), false, 'lote con procedencia pendiente excluido')
const visibleFor = (role: 'admin' | 'warehouse' | 'distributor') => getVisibleModules(() => true, role).some(module => module.id === 'dist.processing')
equal(visibleFor('admin'), true, 'módulo visible para Administración')
equal(visibleFor('warehouse'), true, 'módulo visible para Almacén')
equal(visibleFor('distributor'), false, 'módulo oculto para Distribuidor')
console.log('processingUi: precisión de entrada, materiales y elegibilidad visual de lotes PASS')
