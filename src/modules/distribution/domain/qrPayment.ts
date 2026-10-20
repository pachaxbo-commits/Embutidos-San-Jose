import type { DistSale, DistQrVerification } from '../types.ts'

export type SaleQrPaymentState = {
  amount: number
  revision: number
  verificationId: string
}

/**
 * Returns the QR amount shown to staff and used for verification. A corrected
 * snapshot is authoritative only when it contains a finite, non-negative QR
 * amount; older or malformed snapshots safely fall back to the original sale.
 */
export function saleQrPaymentState(sale: Pick<DistSale, 'id' | 'qrAmount' | 'revision' | 'effectiveSnapshot' | 'voidedAt' | 'pendingConfirmation'>): SaleQrPaymentState {
  const snapshotAmount = sale.effectiveSnapshot?.qrAmount
  const hasValidSnapshotAmount = typeof snapshotAmount === 'number' && Number.isFinite(snapshotAmount) && snapshotAmount >= 0
  const rawAmount = sale.qrAmount
  const amount = sale.voidedAt || sale.pendingConfirmation
    ? 0
    : hasValidSnapshotAmount
      ? snapshotAmount
      : typeof rawAmount === 'number' && Number.isFinite(rawAmount) && rawAmount >= 0
        ? rawAmount
        : 0
  const revision = Number.isSafeInteger(sale.revision) && (sale.revision ?? 0) >= 0 ? sale.revision ?? 0 : 0

  return {
    amount,
    revision,
    verificationId: saleQrVerificationId(sale.id, revision),
  }
}

export function saleQrVerificationId(saleId: string, revision: number): string {
  return revision > 0 ? `sale_${saleId}_r${revision}` : `sale_${saleId}`
}

export function hasCurrentSaleQrVerification(
  sale: Pick<DistSale, 'id' | 'qrAmount' | 'revision' | 'effectiveSnapshot' | 'voidedAt' | 'pendingConfirmation'>,
  verification: DistQrVerification,
): boolean {
  const current = saleQrPaymentState(sale)
  const verificationRevision = Number.isSafeInteger(verification.sourceRevision) ? verification.sourceRevision ?? 0 : 0
  return current.amount > 0 && verification.id === current.verificationId &&
    verificationRevision === current.revision && Math.abs(verification.amount - current.amount) < 0.01
}
