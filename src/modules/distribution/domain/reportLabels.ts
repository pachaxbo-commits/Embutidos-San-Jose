import type { ClosureStatus, PaymentKind, ReceivableStatus, UnitType } from '../types'

const UNIT_LABELS: Record<UnitType, string> = {
  kg: 'kg',
  unit: 'unidad',
  package: 'paquete',
}

const PAYMENT_LABELS: Record<PaymentKind | 'cash' | 'qr', string> = {
  cash: 'Efectivo',
  qr: 'QR',
  credit: 'Crédito',
  mixed: 'Pago combinado',
}

const CLOSURE_LABELS: Record<ClosureStatus, string> = {
  draft: 'Devolución declarada',
  warehouse_done: 'Devolución confirmada por Almacén',
  closed: 'Cierre completado',
  reopened: 'Cierre reabierto',
}

const CREDIT_LABELS: Record<ReceivableStatus, string> = {
  OPEN: 'Pendiente',
  PARTIAL: 'Pago parcial',
  PAID: 'Pagado',
}

const MOVEMENT_LABELS: Record<string, string> = {
  intake: 'Ingreso de productos',
  transfer: 'Transferencia entre almacenes',
  dispatch: 'Despacho a ruta',
  dispatch_addition: 'Aumento de despacho',
  sale: 'Venta',
  return: 'Retorno de ruta',
  adjustment: 'Ajuste de inventario',
  shortage: 'Faltante',
  overage: 'Sobrante',
  exchange: 'Cambio de producto',
  customer_return: 'Devolución del cliente',
}

export function reportUnitLabel(unit: UnitType): string {
  return UNIT_LABELS[unit] || 'unidad'
}

export function reportQuantity(quantity: number, unit: UnitType): string {
  if (unit === 'kg') return `${quantity} kg`
  const singular = quantity === 1
  return `${quantity} ${unit === 'package' ? (singular ? 'paquete' : 'paquetes') : (singular ? 'unidad' : 'unidades')}`
}

export function reportPaymentLabel(method: PaymentKind | 'cash' | 'qr'): string {
  return PAYMENT_LABELS[method] || 'Medio registrado'
}

export function reportClosureLabel(status?: ClosureStatus): string {
  return status ? CLOSURE_LABELS[status] || 'Estado registrado' : 'Devolución declarada'
}

export function reportCreditLabel(status: ReceivableStatus): string {
  return CREDIT_LABELS[status] || 'Estado registrado'
}

export function reportMovementLabel(type: string): string {
  return MOVEMENT_LABELS[type] || 'Movimiento de inventario'
}

export function reportDate(value?: string): string {
  if (!value) return 'Fecha no disponible'
  const day = value.slice(0, 10)
  const parts = day.split('-')
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : value
}

export function reportDateTime(value?: string): string {
  if (!value) return 'Fecha no disponible'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return reportDate(value)
  return parsed.toLocaleString('es-BO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function isReportInternalIdentifier(value?: string | null): boolean {
  const text = value?.trim() || ''
  if (!text) return false
  return (
    /^[A-Za-z0-9_-]{18,}$/.test(text) ||
    /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(text) ||
    /^(?:route|warehouse|legacy)__/.test(text)
  )
}

export function reportPersonName(value?: string | null): string {
  return !value || isReportInternalIdentifier(value) ? 'Usuario de registro anterior' : value
}

export function reportRecordName(value: string | undefined, fallback: string): string {
  return !value || isReportInternalIdentifier(value) ? fallback : value
}

export function reportReceiptNumber(value?: string | null): string {
  if (value && (/^legacy[-_]/i.test(value) || /(?:^|[-_])anterior$/i.test(value))) return 'Venta anterior'
  const clean = (value || '').replace(/[^A-Za-z0-9]/g, '')
  if (!clean) return 'Sin número'
  return `N.º ${clean.slice(-6).toUpperCase()}`
}
