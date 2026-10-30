import type { ModuleId } from '../../../config/appConfig'
import type { UserRole } from '../../../types'

export interface RejectedOperationMetadata {
  label: string
  module: ModuleId | null
  actionLabel: string
}

const metadata: Record<string, RejectedOperationMetadata> = {
  sale: { label: 'Venta', module: 'dist.sales', actionLabel: 'Revisar en Ventas' },
  collection: { label: 'Cobro de cartera', module: 'dist.collections', actionLabel: 'Revisar en Cobros' },
  expense: { label: 'Egreso', module: 'dist.expenses', actionLabel: 'Revisar en Egresos' },
  creditStatus: { label: 'Verificación de crédito', module: 'dist.credits', actionLabel: 'Revisar en Créditos' },
  openingBalance: { label: 'Saldo inicial', module: 'dist.credits', actionLabel: 'Revisar en Créditos' },
  editReceivable: { label: 'Edición de deuda', module: 'dist.credits', actionLabel: 'Revisar en Créditos' },
  voidReceivable: { label: 'Anulación de deuda', module: 'dist.credits', actionLabel: 'Revisar en Créditos' },
  creditOverride: { label: 'Excepción de crédito', module: 'dist.credits', actionLabel: 'Revisar en Créditos' },
  updateLot: { label: 'Actualización de lote', module: 'dist.inventory', actionLabel: 'Revisar en Inventario' },
  resolveQuarantine: { label: 'Revisión de cuarentena', module: 'dist.inventory', actionLabel: 'Revisar en Inventario' },
  intake: { label: 'Ingreso de inventario', module: 'dist.inventory', actionLabel: 'Revisar en Inventario' },
  transfer: { label: 'Transferencia de inventario', module: 'dist.inventory', actionLabel: 'Revisar en Inventario' },
  adjustment: { label: 'Ajuste de inventario', module: 'dist.inventory', actionLabel: 'Revisar en Inventario' },
  adjustmentRequest: { label: 'Solicitud de ajuste', module: 'dist.inventory', actionLabel: 'Revisar en Inventario' },
  reviewAdjustmentRequest: { label: 'Revisión de ajuste', module: 'dist.inventory', actionLabel: 'Revisar en Inventario' },
  dispatch: { label: 'Despacho', module: 'dist.dispatches', actionLabel: 'Revisar en Despachos' },
  addition: { label: 'Aumento de despacho', module: 'dist.dispatches', actionLabel: 'Revisar en Despachos' },
  correctDispatch: { label: 'Corrección de despacho', module: 'dist.dispatches', actionLabel: 'Revisar en Despachos' },
  dispatchCorrection: { label: 'Corrección de despacho', module: 'dist.dispatches', actionLabel: 'Revisar en Despachos' },
  closure: { label: 'Cierre de ruta', module: 'dist.closure', actionLabel: 'Revisar en Cierre' },
  reopen: { label: 'Reapertura de cierre', module: 'dist.closure', actionLabel: 'Revisar en Cierre' },
  reviewVariance: { label: 'Revisión de diferencia', module: 'dist.closure', actionLabel: 'Revisar en Cierre' },
  claim: { label: 'Cambio o devolución', module: 'dist.claims', actionLabel: 'Revisar en Cambios y devoluciones' },
  editSale: { label: 'Corrección de venta', module: 'dist.sales', actionLabel: 'Revisar en Ventas' },
  voidSale: { label: 'Anulación de venta', module: 'dist.sales', actionLabel: 'Revisar en Ventas' },
  changeProductUnit: { label: 'Cambio de unidad de producto', module: 'dist.products', actionLabel: 'Revisar en Productos' },
  deleteProduct: { label: 'Eliminación de producto', module: 'dist.products', actionLabel: 'Revisar en Productos' },
  warehouseShift: { label: 'Cambio de responsable de almacén', module: 'dist.warehouses', actionLabel: 'Revisar en Almacenes' },
  classifyExpense: { label: 'Clasificación de egreso', module: 'dist.expenses', actionLabel: 'Revisar en Egresos' },
  deleteExpense: { label: 'Anulación de egreso', module: 'dist.expenses', actionLabel: 'Revisar en Egresos' },
  saveExpenseCategory: { label: 'Categoría de egreso', module: 'dist.expenses', actionLabel: 'Revisar en Egresos' },
  quoteCreate: { label: 'Creación de cotización', module: 'dist.quotes', actionLabel: 'Revisar en Cotizaciones' },
  quoteUpdate: { label: 'Edición de cotización', module: 'dist.quotes', actionLabel: 'Revisar en Cotizaciones' },
  quoteCancel: { label: 'Cancelación de cotización', module: 'dist.quotes', actionLabel: 'Revisar en Cotizaciones' },
  quoteDelete: { label: 'Anulación de cotización', module: 'dist.quotes', actionLabel: 'Revisar en Cotizaciones' },
}

export function getRejectedOperationMetadata(type: string): RejectedOperationMetadata {
  return metadata[type] ?? { label: 'Operación', module: null, actionLabel: 'Volver al inicio' }
}

export function getRejectedOperationModule(type: string, role: UserRole): ModuleId | null {
  if (type === 'collection' && role !== 'admin') return 'dist.credits'
  return getRejectedOperationMetadata(type).module
}

export function getRejectedOperationActionLabel(type: string, role: UserRole): string {
  if (type === 'collection' && role !== 'admin') return 'Revisar en Créditos'
  return getRejectedOperationMetadata(type).actionLabel
}

export function rejectedOperationStatusMessage(): string {
  return 'El servidor rechazó esta operación; no quedó registrada. Corrige el motivo antes de volver a intentarlo.'
}

export function lotUpdateReasonError(reason: string): string | null {
  return reason.trim() ? null : 'Indica por qué estás modificando este lote.'
}

export const SUPPORTED_REJECTED_OPERATION_TYPES = Object.keys(metadata)
