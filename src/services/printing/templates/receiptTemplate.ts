import type { PrintJobPayload } from '../../../types/printing'
import { EscPosBuilder, padLine } from '../escPosFormatter'
import { SAN_JOSE_THERMAL_LOGO } from '../sanJoseThermalLogo'

function formatTicketQuantity(value: number): string {
  return Number(value.toFixed(3)).toString()
}

export function buildReceiptBytes(
  payload: PrintJobPayload,
  paperWidth: '58mm' | '80mm' = '80mm',
  supportsPaperCut = paperWidth === '80mm',
): Uint8Array {
  const cols = paperWidth === '58mm' ? 32 : 48
  const builder = new EscPosBuilder()

  builder.init().alignCenter()

  if (/san\s+jos[eé]/i.test(payload.restaurantName)) {
    builder.rasterImage(
      SAN_JOSE_THERMAL_LOGO.width,
      SAN_JOSE_THERMAL_LOGO.height,
      SAN_JOSE_THERMAL_LOGO.data,
    )
    builder.line()
  }

  // Copy header if reprint
  if (payload.isCopy) {
    builder.bold(true).doubleSize(true)
    builder.line('*** REIMPRESION - COPIA ***')
    if (payload.reprintReason) {
      builder.doubleSize(false).line(`MOTIVO: ${payload.reprintReason}`)
    }
    builder.separator(cols, '=')
  }

  // Restaurant & Branch Header
  builder.bold(true).doubleSize(true).line(payload.restaurantName)
  builder.doubleSize(false).bold(false)
  builder.line(payload.branchName)
  if (payload.branchAddress) builder.line(payload.branchAddress)
  if (payload.branchPhone) builder.line(`Tel: ${payload.branchPhone}`)
  payload.headerDetails?.forEach((detail) => builder.line(detail))

  builder.separator(cols)

  // Order meta
  builder.alignLeft()
  if (payload.displayNumber) {
    builder.bold(true).line(`TICKET: ${payload.displayNumber}`).bold(false)
  }
  builder.line(`FECHA: ${new Date(payload.createdIso).toLocaleString('es-BO')}`)
  if (payload.fulfillmentType) {
    builder.line(`TIPO: ${payload.fulfillmentType.toUpperCase()}`)
  }
  if (payload.tableInfo) {
    builder.bold(true).line(`MESA: ${payload.tableInfo}`).bold(false)
  }
  if (payload.customerName) {
    builder.line(`CLIENTE: ${payload.customerName}`)
  }
  if (payload.customerPhone) {
    builder.line(payload.customerPhone)
  }

  builder.separator(cols)

  // Column header
  builder.bold(true)
  builder.line(padLine('PRODUCTO', 'SUBTOTAL', cols))
  builder.bold(false).separator(cols)

  // Items
  payload.items.forEach((item) => {
    const lineTotalStr = `${item.lineTotal.toFixed(2)} Bs`
    const unit = item.unitLabel ? ` ${item.unitLabel}` : ''
    builder.bold(true).line(item.name).bold(false)
    builder.line(
      padLine(
        `${formatTicketQuantity(item.quantity)}${unit} x ${item.basePrice.toFixed(2)} Bs`,
        lineTotalStr,
        cols,
      ),
    )

    if (item.modifiersText && item.modifiersText.length > 0) {
      item.modifiersText.forEach((mod) => {
        builder.line(`   * ${mod}`)
      })
    }
    if (item.note) {
      builder.line(`   Nota: ${item.note}`)
    }
  })

  builder.separator(cols)

  // Totals
  builder.alignRight()
  builder.line(padLine('SUBTOTAL:', `${payload.subtotal.toFixed(2)} Bs`, cols))
  if (payload.discountTotal > 0) {
    builder.line(padLine('DESCUENTO:', `-${payload.discountTotal.toFixed(2)} Bs`, cols))
  }
  if (payload.deliveryFee > 0) {
    builder.line(padLine('DELIVERY:', `${payload.deliveryFee.toFixed(2)} Bs`, cols))
  }

  builder.bold(true).doubleSize(true)
  builder.line(padLine('TOTAL:', `${payload.grandTotal.toFixed(2)} Bs`, Math.floor(cols / 2)))
  builder.doubleSize(false).bold(false)

  if (payload.paymentMethod) {
    builder.separator(cols)
    builder.line(`PAGO: ${payload.paymentMethod.toUpperCase()}`)
    if (payload.cashReceived) builder.line(`RECIBIDO: ${payload.cashReceived.toFixed(2)} Bs`)
    if (payload.changeAmount) builder.line(`CAMBIO: ${payload.changeAmount.toFixed(2)} Bs`)
    payload.paymentDetails?.forEach((detail) => builder.line(detail))
  }

  if (payload.customMessage) {
    builder.separator(cols)
    builder.alignCenter().bold(true).line(payload.customMessage).bold(false)
  }

  if (payload.footerMessage) {
    builder.separator(cols)
    builder.alignCenter().line(payload.footerMessage)
  }

  builder.feed(3)
  if (supportsPaperCut) builder.cut(false)

  return builder.build()
}
