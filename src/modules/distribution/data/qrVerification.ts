import { doc, getDocFromServer, runTransaction, type Firestore } from 'firebase/firestore'
import { saleQrPaymentState } from '../domain/qrPayment.ts'
import type { DistSale } from '../types.ts'

export type QrSourceType = 'sale' | 'collection' | 'claim'
export type QrVerificationResult = { status: 'verified' | 'already-verified'; amount: number }

/** Creates an auditable verification against the current payment revision. */
export async function recordQrVerification(
  db: Firestore,
  restaurantId: string,
  uid: string,
  sourceType: QrSourceType,
  sourceId: string,
  reference: string,
  expectedRevision?: number,
): Promise<QrVerificationResult> {
  const normalizedReference = reference.trim()
  if (!normalizedReference) throw new Error('Ingresa la referencia bancaria de la verificación.')

  try {
    return await runTransaction(db, async transaction => {
    const sourceCollection = sourceType === 'sale' ? 'distSales' : sourceType === 'claim' ? 'distClaims' : 'distCollections'
    const sourceRef = doc(db, 'restaurants', restaurantId, sourceCollection, sourceId)
    const sourceSnapshot = await transaction.get(sourceRef)
    const data = sourceSnapshot.data()
    if (!data) throw new Error('No existe el movimiento que deseas verificar.')

    const verificationId = sourceType === 'sale'
      ? saleQrPaymentState({ ...data, id: sourceId } as DistSale).verificationId
      : `${sourceType}_${sourceId}`
    const verificationRef = doc(db, 'restaurants', restaurantId, 'distQrVerifications', verificationId)
    const existing = await transaction.get(verificationRef)

    let amount: number
    let sourceRevision: number | undefined
    if (sourceType === 'sale') {
      const sale = { ...data, id: sourceId } as DistSale
      const current = saleQrPaymentState(sale)
      if (expectedRevision !== undefined && expectedRevision !== current.revision) {
        throw new Error('La venta cambió mientras verificabas el pago. Actualiza la lista y revisa el importe vigente.')
      }
      if (sale.voidedAt) throw new Error('La venta está anulada y no puede verificarse como pago QR.')
      if (sale.pendingConfirmation) throw new Error('La venta aún está pendiente de confirmación y no puede verificarse.')
      if (!(current.amount > 0)) throw new Error('No existe un pago QR pendiente para este movimiento.')
      amount = current.amount
      sourceRevision = current.revision
    } else {
      if (data.voidedAt || data.pendingConfirmation) throw new Error('El movimiento está anulado o pendiente de confirmación.')
      amount = sourceType === 'claim'
        ? Number(data.qrIn) || 0
        : Number(data.qrAmount ?? (data.method === 'qr' ? data.amount : 0)) || 0
      if (!(amount > 0)) throw new Error('No existe un pago QR pendiente para este movimiento.')
    }

    if (existing.exists()) {
      const prior = existing.data()
      if (Number(prior?.amount) === amount && (sourceType !== 'sale' || Number(prior?.sourceRevision ?? 0) === sourceRevision)) {
        return { status: 'already-verified', amount }
      }
      throw new Error('Ya existe una verificación para esta revisión con datos distintos. Requiere revisión administrativa.')
    }

    transaction.set(verificationRef, {
      id: verificationId,
      restaurantId,
      routeId: data.routeId,
      sourceType,
      sourceId,
      amount,
      ...(sourceType === 'sale' ? { sourceRevision } : {}),
      reference: normalizedReference,
      verifiedBy: uid,
      verifiedAt: new Date().toISOString(),
    })
    return { status: 'verified', amount }
    })
  } catch (error) {
    // Read after an ambiguous acknowledgement; never repeat a financial write.
    try {
      const collection = sourceType === 'sale' ? 'distSales' : sourceType === 'claim' ? 'distClaims' : 'distCollections'
      const source = (await getDocFromServer(doc(db, 'restaurants', restaurantId, collection, sourceId))).data()
      if (source && !source.voidedAt && !source.pendingConfirmation) {
        const state = sourceType === 'sale' ? saleQrPaymentState({ ...source, id: sourceId } as DistSale) : null
        const amount = state?.amount ?? Number(sourceType === 'claim' ? source.qrIn : source.qrAmount ?? (source.method === 'qr' ? source.amount : 0))
        const id = state?.verificationId ?? `${sourceType}_${sourceId}`
        const prior = (await getDocFromServer(doc(db, 'restaurants', restaurantId, 'distQrVerifications', id))).data()
        if (amount > 0 && prior && prior.sourceType === sourceType && prior.sourceId === sourceId && Number(prior.amount) === amount && (!state || Number(prior.sourceRevision ?? 0) === state.revision) && (expectedRevision === undefined || !state || state.revision === expectedRevision)) {
          return { status: 'already-verified', amount }
        }
      }
    } catch { /* Preserve the original error if reconciliation cannot be read. */ }
    throw error
  }
}
