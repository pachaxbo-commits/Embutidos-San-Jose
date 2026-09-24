import { PrintEngineService } from '../../../services/printing/printEngineService'
import { AndroidBluetoothPermissionsService } from '../../../services/printing/androidBluetoothPermissionsService'
import { getActiveReceiptPrinter } from '../../../services/printing/printerBootstrap'
import { round2 } from '../domain/engine'
import type { PrintJobPayload } from '../../../types/printing'
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
  receiptHeader?: string
  receiptFooter?: string
  taxId?: string
  address?: string
  phone?: string
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
  const paymentDetails = [
    sale.cashAmount > 0 ? `EFECTIVO: ${round2(sale.cashAmount).toFixed(2)} Bs` : '',
    sale.qrAmount > 0 ? `QR: ${round2(sale.qrAmount).toFixed(2)} Bs` : '',
    sale.creditAmount > 0 ? `CREDITO: ${round2(sale.creditAmount).toFixed(2)} Bs` : '',
  ].filter(Boolean)

  return {
    payloadSchemaVersion: 1,
    templateVersion: 'v1.0-receipt',
    restaurantName: (context.receiptHeader || context.companyName).toUpperCase(),
    branchName: '',
    headerDetails: [context.taxId ? `NIT: ${context.taxId}` : '', context.address || '', context.phone ? `TEL: ${context.phone}` : ''].filter(Boolean),
    orderId: sale.id,
    displayNumber: sale.id.slice(-6).toUpperCase(),
    customerName: sale.customerName || 'Cliente ocasional',
    customerPhone: sale.customerCode ? `CI: ${sale.customerCode}` : undefined,
    items: sale.lines.map((line) => ({
      name: line.productNameSnapshot,
      basePrice: line.actualUnitPrice,
      quantity: line.quantity,
      unitLabel: line.unitType === 'kg' ? 'kg' : line.unitType === 'package' ? 'paq' : 'u',
      lineTotal: line.subtotal,
      modifiersText: line.isPromotional ? [`PRECIO PROMOCIONAL - OFICIAL ${round2(line.referenceUnitPrice || line.actualUnitPrice).toFixed(2)} Bs`] : undefined,
    })),
    subtotal: sale.total,
    discountTotal: 0,
    taxTotal: 0,
    deliveryFee: 0,
    grandTotal: sale.total,
    paymentMethod: paymentLabel,
    paymentDetails,
    cashReceived: sale.cashReceived,
    changeAmount: sale.changeAmount,
    customMessage:
      sale.creditAmount > 0
        ? `SALDO GENERADO: Bs ${round2(context.creditBalance ?? sale.creditAmount).toFixed(2)}`
        : undefined,
    footerMessage: context.receiptFooter,
    isCopy: false,
    copies: 1,
    createdIso: sale.createdAt,
  }
}

export interface PrintAttemptResult {
  uncertain?: boolean
  ok: boolean
  message: string
}

/**
 * Imprime el recibo en la impresora configurada.
 *
 * Un fallo de impresion NUNCA afecta a la venta: la venta ya quedo guardada y
 * sincronizada por su cuenta. Aqui solo se informa para poder reintentar.
 */
export async function printSaleReceipt(sale: DistSale, context: ReceiptContext, copy = false): Promise<PrintAttemptResult> {
  const printer = getActiveReceiptPrinter()

  if (!printer) {
    return {
      ok: false,
      message: 'No hay impresora configurada. Entra a Impresoras y agrega tu impresora Bluetooth.',
    }
  }

  if (printer.connectionType === 'bluetooth_spp') {
    try {
      let state = await AndroidBluetoothPermissionsService.checkDiagnosticState()
      if (state.isNativeAndroid && state.bluetoothConnectPermission !== 'granted') {
        state = await AndroidBluetoothPermissionsService.requestConnectPermission()
        if (state.bluetoothConnectPermission !== 'granted') {
          return { ok: false, message: state.message }
        }
      }
      if (state.isNativeAndroid && !state.isBluetoothEnabled) {
        return { ok: false, message: state.message }
      }
    } catch (error) {
      console.error('[distribution] no se pudo verificar el estado del Bluetooth', error)
    }
  }

  try {
    const job = await PrintEngineService.getInstance().submitPrintRequest({
      targetType: 'receipt',
      orderId: sale.id,
      printerProfileId: printer.id,
      idempotencyKey: copy ? `dist-receipt-copy:${sale.operationId}:${Date.now()}` : `dist-receipt:${sale.operationId}`,
      payload: { ...buildSaleReceiptPayload(sale, context), isCopy: copy },
    })

    if (job.status === 'unknown') return { ok: false, uncertain: true, message: 'El envio quedo incierto. Revisa si salio papel antes de solicitar una copia.' }
    if (!['transmitted', 'confirmed'].includes(job.status)) {
      return { ok: false, message: job.lastError || 'La impresora no confirmo el ticket. Puedes reintentar.' }
    }
    return { ok: true, message: 'Ticket enviado a la impresora.' }
  } catch (error) {
    return {
      ok: false,
      message: (error as Error).message || 'No se pudo enviar el ticket. Puedes reintentar.',
    }
  }
}

async function buildSaleReceiptImage(sale: DistSale, context: ReceiptContext): Promise<File> {
  const width = 720
  const rowHeight = 74
  const height = 430 + sale.lines.length * rowHeight + (sale.changeAmount ? 56 : 0)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Este dispositivo no puede crear la imagen del recibo.')
  ctx.fillStyle = '#fffdf9'; ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#c8102e'; ctx.fillRect(0, 0, width, 14)
  const logo = new Image(); logo.src = '/brand/san-jose-logo.png'
  await new Promise<void>(resolve => { logo.onload = () => resolve(); logo.onerror = () => resolve() })
  if (logo.complete && logo.naturalWidth) ctx.drawImage(logo, width / 2 - 65, 30, 130, 70)
  ctx.textAlign = 'center'; ctx.fillStyle = '#111827'; ctx.font = '700 30px Arial'; ctx.fillText(context.companyName, width / 2, 128)
  ctx.font = '20px Arial'; ctx.fillStyle = '#475569'; ctx.fillText(new Date(sale.createdAt).toLocaleString('es-BO'), width / 2, 160)
  ctx.textAlign = 'left'; ctx.fillStyle = '#111827'; ctx.font = '700 21px Arial'; ctx.fillText(`Cliente: ${sale.customerName || 'Cliente ocasional'}`, 42, 205)
  if (sale.customerCode) { ctx.font = '18px Arial'; ctx.fillStyle = '#475569'; ctx.fillText(`CI: ${sale.customerCode}`, 42, 233) }
  let y = 275
  ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(42, y - 20); ctx.lineTo(width - 42, y - 20); ctx.stroke()
  for (const line of sale.lines) {
    ctx.fillStyle = '#111827'; ctx.font = '700 20px Arial'; ctx.fillText(line.productNameSnapshot.slice(0, 52), 42, y)
    ctx.font = '18px Arial'; ctx.fillStyle = line.isPromotional ? '#b45309' : '#475569'; ctx.fillText(`${line.quantity} ${line.unitType === 'kg' ? 'kg' : line.unitType === 'package' ? 'paq' : 'u'} x Bs ${round2(line.actualUnitPrice).toFixed(2)}${line.isPromotional ? ` · PROMO (oficial Bs ${round2(line.referenceUnitPrice || line.actualUnitPrice).toFixed(2)})` : ''}`, 42, y + 30)
    ctx.textAlign = 'right'; ctx.fillStyle = '#111827'; ctx.font = '700 20px Arial'; ctx.fillText(`Bs ${round2(line.subtotal).toFixed(2)}`, width - 42, y + 30); ctx.textAlign = 'left'; y += rowHeight
  }
  ctx.strokeStyle = '#e2e8f0'; ctx.beginPath(); ctx.moveTo(42, y - 28); ctx.lineTo(width - 42, y - 28); ctx.stroke()
  ctx.fillStyle = '#111827'; ctx.font = '800 32px Arial'; ctx.fillText('TOTAL', 42, y + 8); ctx.textAlign = 'right'; ctx.fillStyle = '#c8102e'; ctx.fillText(`Bs ${round2(sale.total).toFixed(2)}`, width - 42, y + 8)
  ctx.font = '18px Arial'; ctx.fillStyle = '#475569'; y += 48
  if (sale.cashAmount > 0) { ctx.fillText(`Efectivo: Bs ${round2(sale.cashAmount).toFixed(2)}`, width - 42, y); y += 28 }
  if (sale.qrAmount > 0) { ctx.fillText(`QR: Bs ${round2(sale.qrAmount).toFixed(2)}`, width - 42, y); y += 28 }
  if (sale.creditAmount > 0) { ctx.fillText(`Crédito: Bs ${round2(sale.creditAmount).toFixed(2)}`, width - 42, y); y += 28 }
  if (sale.changeAmount) { ctx.fillStyle = '#047857'; ctx.font = '700 21px Arial'; ctx.fillText(`Cambio devuelto: Bs ${round2(sale.changeAmount).toFixed(2)}`, width - 42, y) }
  ctx.textAlign = 'center'; ctx.fillStyle = '#64748b'; ctx.font = '18px Arial'; ctx.fillText(context.receiptFooter || 'Gracias por su preferencia', width / 2, height - 34)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('No se pudo crear el recibo.')), 'image/png'))
  return new File([blob], `recibo-san-jose-${sale.id.slice(-6)}.png`, { type: 'image/png' })
}

/** Comparte el recibo por el canal nativo disponible (WhatsApp incluido). */
export async function shareSaleReceipt(sale: DistSale, context: ReceiptContext): Promise<boolean> {
  const file = await buildSaleReceiptImage(sale, context)
  const nav = navigator as Navigator & { share?: (data: { title?: string; text?: string; files?: File[] }) => Promise<void>; canShare?: (data: { files: File[] }) => boolean }

  if (typeof nav.share === 'function' && (!nav.canShare || nav.canShare({ files: [file] }))) {
    try {
      await nav.share({ title: `Recibo ${context.companyName}`, files: [file] })
      return true
    } catch {
      return false
    }
  }

  const link = document.createElement('a'); link.href = URL.createObjectURL(file); link.download = file.name; link.click(); window.setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  return true
}

/** Comprobante en hoja para impresora normal. No incluye rutas, vendedor ni observaciones. */
export function printLargeSaleReceipt(sale: DistSale, context: ReceiptContext): void {
  const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character)
  const rows = sale.lines.map(line => `<tr><td><strong>${escape(line.productNameSnapshot)}</strong>${line.isPromotional ? `<small>Precio promocional (oficial Bs ${round2(line.referenceUnitPrice || line.actualUnitPrice).toFixed(2)})</small>` : ''}</td><td>${escape(line.quantity)} ${line.unitType === 'kg' ? 'kg' : line.unitType === 'package' ? 'paq' : 'u'}</td><td>Bs ${round2(line.actualUnitPrice).toFixed(2)}</td><td>Bs ${round2(line.subtotal).toFixed(2)}</td></tr>`).join('')
  const popup = window.open('', '_blank')
  if (!popup) throw new Error('El navegador bloqueó la ventana de impresión.')
  popup.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Comprobante San José</title><style>@page{size:A4;margin:0}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#172033;margin:0;padding:18mm}.head{border-bottom:4px solid #c8102e;display:flex;align-items:center;gap:22px;padding-bottom:18px}.head img{width:105px;height:70px;object-fit:contain}.head h1{font-size:26px;margin:0}.meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:24px 0;padding:16px;background:#fff7f5;border-radius:12px}table{width:100%;border-collapse:collapse}th{background:#c8102e;color:#fff;text-align:left;padding:11px}td{padding:12px;border-bottom:1px solid #e2e8f0}td:nth-child(n+2),th:nth-child(n+2){text-align:right}small{display:block;color:#b45309;margin-top:4px}.total{margin-top:20px;text-align:right;font-size:28px;font-weight:800;color:#c8102e}.payments{text-align:right;line-height:1.6}.foot{text-align:center;color:#64748b;margin-top:42px}</style></head><body><header class="head"><img src="/brand/san-jose-logo.png"><div><h1>${escape(context.companyName)}</h1><p>Comprobante de venta</p></div></header><section class="meta"><div><strong>Comprobante:</strong> ${escape(sale.id.slice(-6).toUpperCase())}</div><div><strong>Fecha:</strong> ${escape(new Date(sale.createdAt).toLocaleString('es-BO'))}</div><div><strong>Cliente:</strong> ${escape(sale.customerName || 'Cliente ocasional')}</div><div><strong>CI:</strong> ${escape(sale.customerCode || '-')}</div></section><table><thead><tr><th>Producto</th><th>Cantidad</th><th>Precio</th><th>Subtotal</th></tr></thead><tbody>${rows}</tbody></table><div class="total">TOTAL: Bs ${round2(sale.total).toFixed(2)}</div><div class="payments">${sale.cashAmount > 0 ? `Efectivo: Bs ${round2(sale.cashAmount).toFixed(2)}<br>` : ''}${sale.qrAmount > 0 ? `QR: Bs ${round2(sale.qrAmount).toFixed(2)}<br>` : ''}${sale.creditAmount > 0 ? `Crédito: Bs ${round2(sale.creditAmount).toFixed(2)}<br>` : ''}${sale.changeAmount ? `<strong>Cambio devuelto: Bs ${round2(sale.changeAmount).toFixed(2)}</strong>` : ''}</div><p class="foot">${escape(context.receiptFooter || 'Gracias por su preferencia')}</p><script>window.onafterprint=()=>window.close();window.onload=()=>window.print()</script></body></html>`)
  popup.document.close()
}
