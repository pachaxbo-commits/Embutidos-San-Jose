import { hasCurrentSaleQrVerification, saleQrPaymentState } from '../qrPayment.ts'

const equal = (actual: unknown, expected: unknown, message = '') => {
  if (actual !== expected) throw new Error(`${message || 'Valores distintos'}: esperado ${String(expected)}, recibido ${String(actual)}`)
}

const base = { id: 'sale-a', qrAmount: 0, revision: 1, pendingConfirmation: false }
const corrected = {
  ...base,
  paymentKind: 'cash' as const,
  effectiveSnapshot: { total: 270, paymentKind: 'qr' as const, cashAmount: 0, qrAmount: 270, creditAmount: 0, lines: [] },
}
const current = saleQrPaymentState(corrected)
equal(current.amount, 270, 'efectivo corregido a QR usa el importe económico vigente')
equal(current.revision, 1)
equal(current.verificationId, 'sale_sale-a_r1')
equal(saleQrPaymentState({ ...corrected, effectiveSnapshot: { ...corrected.effectiveSnapshot, qrAmount: Number.NaN } }).amount, 0, 'snapshot inválido recurre al valor original')
equal(saleQrPaymentState({ ...corrected, effectiveSnapshot: undefined, qrAmount: 270, revision: 0 }).verificationId, 'sale_sale-a', 'compatibilidad con ventas QR antiguas')
equal(saleQrPaymentState({ ...corrected, effectiveSnapshot: { ...corrected.effectiveSnapshot, paymentKind: 'cash', cashAmount: 270, qrAmount: 0 }, voidedAt: '2026-10-20T15:00:00.000Z' }).amount, 0, 'venta anulada nunca es verificable')
const verification = { id: current.verificationId, amount: 270, sourceRevision: 1 } as never
equal(hasCurrentSaleQrVerification(corrected, verification), true)
equal(hasCurrentSaleQrVerification({ ...corrected, revision: 2 }, verification), false, 'verificación anterior no representa una nueva revisión')
equal(hasCurrentSaleQrVerification({ ...corrected, effectiveSnapshot: { ...corrected.effectiveSnapshot, qrAmount: 200 } }, verification), false, 'un importe QR cambiado requiere nueva verificación')
console.log('PASS 7 comprobaciones de importe y revisión QR vigente')
