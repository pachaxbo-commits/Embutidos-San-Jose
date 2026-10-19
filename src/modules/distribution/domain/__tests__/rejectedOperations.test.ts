import { getRejectedOperationMetadata, getRejectedOperationModule, lotUpdateReasonError, rejectedOperationStatusMessage, SUPPORTED_REJECTED_OPERATION_TYPES } from '../rejectedOperations.ts'
import { getRejectedOperationActionLabel } from '../rejectedOperations.ts'

function check(condition: boolean, label: string) {
  if (!condition) throw new Error(label)
  console.log(`PASS ${label}`)
}

const allSubmitTypes = [
  'transfer', 'editSale', 'voidSale', 'changeProductUnit', 'warehouseShift', 'intake',
  'adjustment', 'adjustmentRequest', 'reviewAdjustmentRequest', 'dispatch', 'addition',
  'correctDispatch', 'creditOverride', 'resolveQuarantine', 'deleteExpense', 'deleteProduct',
  'closure', 'reopen', 'reviewVariance', 'sale', 'openingBalance', 'editReceivable',
  'voidReceivable', 'collection', 'expense', 'claim', 'saveExpenseCategory',
  'classifyExpense', 'quoteCreate', 'quoteUpdate', 'quoteDelete', 'updateLot', 'creditStatus',
]

check(allSubmitTypes.every(type => SUPPORTED_REJECTED_OPERATION_TYPES.includes(type)), 'tipos de operación financiera y administrativa tienen metadata')
check(getRejectedOperationMetadata('updateLot').label === 'Actualización de lote', 'updateLot tiene etiqueta específica')
check(getRejectedOperationMetadata('updateLot').actionLabel === 'Revisar en Inventario', 'updateLot dirige a Inventario')
check(getRejectedOperationMetadata('editReceivable').actionLabel === 'Revisar en Créditos', 'deuda dirige a Créditos')
check(getRejectedOperationMetadata('expense').actionLabel === 'Revisar en Egresos', 'egreso dirige a Egresos')
check(getRejectedOperationModule('collection', 'admin') === 'dist.collections', 'cobro de Administración dirige a Cobros')
check(getRejectedOperationModule('collection', 'distributor') === 'dist.credits', 'cobro de distribuidor dirige a Créditos')
check(getRejectedOperationActionLabel('collection', 'distributor') === 'Revisar en Créditos', 'texto del destino de cobro coincide con el módulo del distribuidor')
check(getRejectedOperationMetadata('futureUnknown').module === null && getRejectedOperationMetadata('futureUnknown').actionLabel === 'Volver al inicio', 'tipo desconocido no se envía a Créditos')
check(!rejectedOperationStatusMessage().toLowerCase().includes('sin conexión') && !rejectedOperationStatusMessage().toLowerCase().includes('offline'), 'aviso no atribuye rechazo a modo offline sin evidencia')
check(lotUpdateReasonError('  ') === 'Indica por qué estás modificando este lote.', 'motivo vacío se bloquea antes de enviar')
check(lotUpdateReasonError('Corrección de fecha') === null, 'motivo informado permite continuar')

console.log('PASS metadata y prevención de operaciones rechazadas')
