import type { DistClaim, DistClosure, DistDispatch, DistSale, DistSaleLine, UnitType } from '../types.ts'
import { round2 } from './engine.ts'

export interface SaleCorrectionAvailability {
  canCorrect: boolean
  reason: string
}

export interface SaleLineAuditChange {
  productId: string
  productName: string
  presentation?: string
  unitType: UnitType
  qtyBefore: number
  qtyAfter: number
  priceBefore: number
  priceAfter: number
  subtotalBefore: number
  subtotalAfter: number
  status: 'eliminated' | 'modified' | 'added' | 'unchanged'
  returnedStockToRoute: number
}

export interface SaleAuditSummary {
  isCorrected: boolean
  revisionNumber: number
  correctedAt?: string
  correctedBy?: string
  reason?: string
  totalBefore: number
  totalAfter: number
  moneyDelta: number
  lineChanges: SaleLineAuditChange[]
  eliminatedLinesCount: number
  modifiedLinesCount: number
}

export function recalculateCorrectedPayment(
  sale: Pick<DistSale, 'paymentKind' | 'cashAmount' | 'qrAmount' | 'creditAmount' | 'total'>,
  newTotal: number,
) {
  const total = round2(newTotal)
  if (sale.paymentKind === 'cash') return { cashAmount: total, qrAmount: 0, creditAmount: 0 }
  if (sale.paymentKind === 'qr') return { cashAmount: 0, qrAmount: total, creditAmount: 0 }
  if (sale.paymentKind === 'credit') return { cashAmount: 0, qrAmount: 0, creditAmount: total }
  const previousTotal = sale.total > 0 ? sale.total : 1
  const cashAmount = round2((total * sale.cashAmount) / previousTotal)
  let qrAmount = round2((total * sale.qrAmount) / previousTotal)
  if (cashAmount + qrAmount > total) qrAmount = round2(Math.max(0, total - cashAmount))
  const creditAmount = round2(Math.max(0, total - cashAmount - qrAmount))
  return { cashAmount, qrAmount, creditAmount }
}

/**
 * Evalúa rigurosamente si una venta puede ser corregida o por qué razón exacta está bloqueada.
 */
export function checkSaleCorrectionAvailability(
  sale: DistSale,
  session: { role: string; uid: string },
  data: {
    openDispatches: DistDispatch[]
    closures: DistClosure[]
    claims?: DistClaim[]
  },
): SaleCorrectionAvailability {
  if (sale.voidedAt) {
    return {
      canCorrect: false,
      reason: 'La venta ya fue anulada.',
    }
  }
  // 1. Venta pendiente de sincronización
  if (sale.pendingConfirmation) {
    return {
      canCorrect: false,
      reason: 'Venta pendiente de sincronización con el servidor.',
    }
  }

  // 2. Permisos: Admin o el mismo vendedor
  if (session.role !== 'admin' && sale.sellerUid !== session.uid) {
    return {
      canCorrect: false,
      reason: 'Solo el vendedor original o administración pueden corregir esta venta.',
    }
  }

  // 3. Reclamos, cambios o devoluciones asociados
  if (data.claims && data.claims.some((claim) => claim.saleId === sale.id)) {
    return {
      canCorrect: false,
      reason: 'La venta tiene cambios o devoluciones asociadas (requiere revisión especializada).',
    }
  }

  // 4. Ventas históricas sin trazabilidad auditable de lotes (allocations)
  const linesToCheck = sale.originalSnapshot?.lines || sale.effectiveSnapshot?.lines || sale.lines
  if (linesToCheck && linesToCheck.length > 0 && !linesToCheck.every((l) => Array.isArray(l.allocations) && l.allocations.length > 0)) {
    return {
      canCorrect: false,
      reason: 'Venta histórica incompatible (no cuenta con lotes auditables registrados).',
    }
  }

  // 5. Cierre o estado de ruta
  if (sale.dispatchId) {
    const isClosedClosure = data.closures.some(
      (c) => c.dispatchId === sale.dispatchId && (c.status === 'closed' || Boolean(c.warehouseClosedBy)),
    )
    if (isClosedClosure) {
      return {
        canCorrect: false,
        reason: 'Venta perteneciente a un cierre de ruta confirmado.',
      }
    }

    const isOpenDispatch = data.openDispatches.some((d) => d.id === sale.dispatchId && d.status === 'open')
    if (!isOpenDispatch) {
      return {
        canCorrect: false,
        reason: 'Ruta ya cerrada (despacho finalizado).',
      }
    }
  } else if (session.role === 'distributor') {
    return {
      canCorrect: false,
      reason: 'Venta sin despacho asignado en ruta.',
    }
  }

  return {
    canCorrect: true,
    reason: '',
  }
}

/**
 * Reconstruye el historial de auditoría comparando la versión original y la versión efectiva.
 */
export function getSaleAuditSummary(sale: DistSale): SaleAuditSummary {
  const isCorrected = Boolean(sale.latestCorrectionId || sale.editedAt || sale.originalSnapshot || (sale.revisions && sale.revisions.length > 0))

  if (!isCorrected) {
    return {
      isCorrected: false,
      revisionNumber: 0,
      totalBefore: sale.total,
      totalAfter: sale.total,
      moneyDelta: 0,
      lineChanges: [],
      eliminatedLinesCount: 0,
      modifiedLinesCount: 0,
    }
  }

  const originalLines: DistSaleLine[] = sale.originalSnapshot?.lines || sale.revisions?.[0]?.original?.lines || sale.lines
  const currentLines: DistSaleLine[] = sale.lines || []
  const totalBefore = sale.originalSnapshot?.total ?? sale.revisions?.[0]?.original?.total ?? sale.total
  const totalAfter = sale.total

  const lineChanges: SaleLineAuditChange[] = []
  const processedProductIds = new Set<string>()

  // Revisar productos originales
  for (const orig of originalLines) {
    processedProductIds.add(orig.productId)
    const current = currentLines.find((l) => l.productId === orig.productId)
    const qtyBefore = orig.quantity
    const qtyAfter = current ? current.quantity : 0
    const priceBefore = orig.actualUnitPrice
    const priceAfter = current?.actualUnitPrice ?? 0
    const subtotalBefore = orig.subtotal
    const subtotalAfter = current?.subtotal ?? 0

    if (!current || qtyAfter <= 0) {
      lineChanges.push({
        productId: orig.productId,
        productName: orig.productNameSnapshot,
        presentation: orig.presentationSnapshot || orig.descriptionSnapshot,
        unitType: orig.unitType,
        qtyBefore,
        qtyAfter: 0,
        priceBefore,
        priceAfter: 0,
        subtotalBefore,
        subtotalAfter: 0,
        status: 'eliminated',
        returnedStockToRoute: qtyBefore,
      })
    } else if (
      Math.abs(qtyAfter - qtyBefore) > 0.0001 ||
      Math.abs(priceAfter - priceBefore) > 0.0001 ||
      Math.abs(subtotalAfter - subtotalBefore) > 0.0001
    ) {
      lineChanges.push({
        productId: orig.productId,
        productName: orig.productNameSnapshot,
        presentation: orig.presentationSnapshot || orig.descriptionSnapshot,
        unitType: orig.unitType,
        qtyBefore,
        qtyAfter,
        priceBefore,
        priceAfter,
        subtotalBefore,
        subtotalAfter,
        status: 'modified',
        returnedStockToRoute: qtyAfter < qtyBefore ? round2(qtyBefore - qtyAfter) : 0,
      })
    } else {
      lineChanges.push({
        productId: orig.productId,
        productName: orig.productNameSnapshot,
        presentation: orig.presentationSnapshot || orig.descriptionSnapshot,
        unitType: orig.unitType,
        qtyBefore,
        qtyAfter,
        priceBefore,
        priceAfter,
        subtotalBefore,
        subtotalAfter,
        status: 'unchanged',
        returnedStockToRoute: 0,
      })
    }
  }

  // Revisar productos nuevos agregados en la corrección
  for (const curr of currentLines) {
    if (!processedProductIds.has(curr.productId)) {
      lineChanges.push({
        productId: curr.productId,
        productName: curr.productNameSnapshot,
        presentation: curr.presentationSnapshot || curr.descriptionSnapshot,
        unitType: curr.unitType,
        qtyBefore: 0,
        qtyAfter: curr.quantity,
        priceBefore: 0,
        priceAfter: curr.actualUnitPrice,
        subtotalBefore: 0,
        subtotalAfter: curr.subtotal,
        status: 'added',
        returnedStockToRoute: 0,
      })
    }
  }

  const eliminatedLinesCount = lineChanges.filter((c) => c.status === 'eliminated').length
  const modifiedLinesCount = lineChanges.filter((c) => c.status === 'modified').length

  return {
    isCorrected: true,
    revisionNumber: sale.revision || 1,
    correctedAt: sale.editedAt,
    correctedBy: sale.editedBy,
    reason: sale.editReason,
    totalBefore,
    totalAfter,
    moneyDelta: round2(totalAfter - totalBefore),
    lineChanges,
    eliminatedLinesCount,
    modifiedLinesCount,
  }
}

// ---------------------------------------------------------------------------
// Persistencia de notificaciones de correcciones vistas por el Administrador
// ---------------------------------------------------------------------------

const SEEN_KEY_PREFIX = 'sanjose_seen_sale_corrections_'

export function getSeenSaleCorrectionIds(userId: string): Set<string> {
  if (typeof window === 'undefined' || !window.localStorage) return new Set()
  try {
    const raw = window.localStorage.getItem(SEEN_KEY_PREFIX + (userId || 'admin'))
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? parsed : [])
  } catch {
    return new Set()
  }
}

export function markSaleCorrectionsSeen(userId: string, ids: string[]): void {
  if (typeof window === 'undefined' || !window.localStorage || ids.length === 0) return
  try {
    const current = getSeenSaleCorrectionIds(userId)
    ids.forEach((id) => current.add(id))
    window.localStorage.setItem(
      SEEN_KEY_PREFIX + (userId || 'admin'),
      JSON.stringify(Array.from(current).slice(-500)),
    )
  } catch {
    // Ignore storage quota errors
  }
}

export function getUnseenSaleCorrections(sales: DistSale[], userId: string): DistSale[] {
  const seenIds = getSeenSaleCorrectionIds(userId)
  return sales.filter((sale) => {
    const hasCorrection = Boolean(sale.latestCorrectionId || sale.editedAt || (sale.revisions && sale.revisions.length > 0))
    if (!hasCorrection) return false
    const idKey = sale.latestCorrectionId || `${sale.id}_rev${sale.revision || 1}`
    return !seenIds.has(idKey)
  })
}
