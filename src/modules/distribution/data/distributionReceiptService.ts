import { PrintEngineService } from '../../../services/printing/printEngineService'
import { round2 } from '../domain/engine'
import type { PrintJob, PrintJobPayload } from '../../../types/printing'
import type { DistSale } from '../types'

/**
 * Recibo de venta de distribucion.
 *
 * Reutiliza el motor de impresion existente (cola, adaptadores Bluetooth/LAN y
 * plantilla ESC/POS de recibo). Aqui solo se arma el payload: no hay driver
 * nuevo ni cola paralela.
 */

export interface ReceiptContext {
  companyName: string
  routeName: string
  distributorName: string
  /** Saldo generado si la venta fue a credito */
  creditBalance?: number
}

export function buildSaleReceiptPayload(sale: DistSale, context: ReceiptContext): PrintJobPayload {
  const paymentLabel =
    sale.paymentKind === 'cash'
      ? 'EFECTIVO'
      : sale.paymentKind === 'qr'
        ? 'QR'
        : sale.paymentKind === 'credit'
          ? 'CREDITO'
          : 'MIXTO'

  return {
    payloadSchemaVersion: 1,
    templateVersion: 'v1.0-receipt',
    restaurantName: context.companyName.toUpperCase(),
    branchName: `RUTA: ${context.routeName}`,
    branchAddress: `DISTRIBUIDOR: ${context.distributorName}`,
    orderId: sale.id,
    displayNumber: sale.id.slice(-6).toUpperCase(),
    customerName: sale.customerName || 'Cliente ocasional',
    items: sale.lines.map((line) => ({
      name: `${line.productNameSnapshot} (${line.quantity} x ${round2(line.actualUnitPrice)})`,
      basePrice: line.actualUnitPrice,
      quantity: line.quantity,
      lineTotal: line.subtotal,
    })),
    subtotal: sale.total,
    discountTotal: 0,
    taxTotal: 0,
    deliveryFee: 0,
    grandTotal: sale.total,
    paymentMethod: paymentLabel,
    customMessage:
      sale.creditAmount > 0
        ? `SALDO GENERADO: Bs ${round2(context.creditBalance ?? sale.creditAmount).toFixed(2)}`
        : undefined,
    isCopy: false,
    copies: 1,
    createdIso: sale.createdAt,
  }
}

/** Encola el recibo en el motor existente. Idempotente por venta. */
export async function printSaleReceipt(sale: DistSale, context: ReceiptContext): Promise<PrintJob | null> {
  try {
    return await PrintEngineService.getInstance().submitPrintRequest({
      targetType: 'receipt',
      orderId: sale.id,
      idempotencyKey: `dist-receipt:${sale.operationId}`,
      payload: buildSaleReceiptPayload(sale, context),
    })
  } catch (error) {
    console.error('[distribution] no se pudo encolar el recibo', error)
    return null
  }
}

/** Texto plano del recibo, para compartir por WhatsApp cuando no hay impresora. */
export function buildSaleReceiptText(sale: DistSale, context: ReceiptContext): string {
  const lines: string[] = []
  lines.push(context.companyName.toUpperCase())
  lines.push(new Date(sale.createdAt).toLocaleString('es-BO'))
  lines.push(`Distribuidor: ${context.distributorName}`)
  lines.push(`Ruta: ${context.routeName}`)
  lines.push(`Cliente: ${sale.customerName || 'Cliente ocasional'}`)
  lines.push('--------------------------------')
  for (const line of sale.lines) {
    lines.push(
      `${line.quantity} x ${line.productNameSnapshot} @ Bs ${round2(line.actualUnitPrice).toFixed(2)} = Bs ${round2(line.subtotal).toFixed(2)}`,
    )
  }
  lines.push('--------------------------------')
  lines.push(`TOTAL: Bs ${round2(sale.total).toFixed(2)}`)
  if (sale.cashAmount > 0) lines.push(`Efectivo: Bs ${round2(sale.cashAmount).toFixed(2)}`)
  if (sale.qrAmount > 0) lines.push(`QR: Bs ${round2(sale.qrAmount).toFixed(2)}`)
  if (sale.creditAmount > 0) lines.push(`Credito: Bs ${round2(sale.creditAmount).toFixed(2)}`)
  if (sale.creditAmount > 0) {
    lines.push(`Saldo generado: Bs ${round2(context.creditBalance ?? sale.creditAmount).toFixed(2)}`)
  }
  return lines.join('\n')
}

/** Comparte el recibo por el canal nativo disponible (WhatsApp incluido). */
export async function shareSaleReceipt(sale: DistSale, context: ReceiptContext): Promise<boolean> {
  const text = buildSaleReceiptText(sale, context)
  const nav = navigator as Navigator & { share?: (data: { title?: string; text: string }) => Promise<void> }

  if (typeof nav.share === 'function') {
    try {
      await nav.share({ title: context.companyName, text })
      return true
    } catch {
      return false
    }
  }

  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
  return true
}
