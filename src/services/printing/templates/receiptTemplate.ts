import type { PrintJobPayload } from '../../../types/printing'
import { EscPosBuilder, padLine } from '../escPosFormatter'
import { SAN_JOSE_THERMAL_LOGO } from '../sanJoseThermalLogo'

function formatTicketQuantity(value: number): string {
  return Number(value.toFixed(3)).toString()
}

function wrapWords(value: string, width: number): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (!current) { current = word; continue }
    if (`${current} ${word}`.length <= width) current += ` ${word}`
    else { lines.push(current); current = word }
  }
  if (current) lines.push(current)
  return lines.flatMap(line => line.length <= width ? [line] : Array.from({ length: Math.ceil(line.length / width) }, (_, index) => line.slice(index * width, (index + 1) * width)))
}

function scaleMonochromeLogo(targetWidth: number): { width: number; height: number; data: Uint8Array } {
  const source = SAN_JOSE_THERMAL_LOGO
  const targetHeight = Math.max(1, Math.round(source.height * targetWidth / source.width))
  const targetBytes = Math.ceil(targetWidth / 8)
  const sourceBytes = Math.ceil(source.width / 8)
  const data = new Uint8Array(targetBytes * targetHeight)
  for (let y = 0; y < targetHeight; y += 1) for (let x = 0; x < targetWidth; x += 1) {
    const sourceX = Math.min(source.width - 1, Math.floor(x * source.width / targetWidth))
    const sourceY = Math.min(source.height - 1, Math.floor(y * source.height / targetHeight))
    if (source.data[sourceY * sourceBytes + Math.floor(sourceX / 8)] & (0x80 >> (sourceX % 8))) data[y * targetBytes + Math.floor(x / 8)] |= 0x80 >> (x % 8)
  }
  return { width: targetWidth, height: targetHeight, data }
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
    const logo = paperWidth === '58mm' ? scaleMonochromeLogo(176) : SAN_JOSE_THERMAL_LOGO
    builder.rasterImage(
      logo.width,
      logo.height,
      logo.data,
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

  // En 58 mm el nombre va en tamaño normal y negrita para evitar cortes feos.
  builder.bold(true).doubleSize(paperWidth === '80mm')
  wrapWords(payload.restaurantName, paperWidth === '58mm' ? cols : Math.floor(cols / 2)).forEach(line => builder.line(line))
  builder.doubleSize(false).bold(false)
  if (payload.branchName) builder.line(payload.branchName)
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
    builder.bold(true)
    wrapWords(item.name, cols).forEach(line => builder.line(line))
    builder.bold(false)
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

  // Totales monetarios solo en comprobantes de venta.
  builder.alignRight()
  const showMoneyTotals = payload.grandTotal !== 0 || payload.subtotal !== 0 || payload.discountTotal !== 0 || payload.deliveryFee !== 0
  if (showMoneyTotals) builder.line(padLine('SUBTOTAL:', `${payload.subtotal.toFixed(2)} Bs`, cols))
  if (payload.discountTotal > 0) {
    builder.line(padLine('DESCUENTO:', `-${payload.discountTotal.toFixed(2)} Bs`, cols))
  }
  if (payload.deliveryFee > 0) {
    builder.line(padLine('DELIVERY:', `${payload.deliveryFee.toFixed(2)} Bs`, cols))
  }

  if (showMoneyTotals) {
    builder.bold(true)
    if (paperWidth === '80mm') builder.doubleSize(true).line(padLine('TOTAL:', `${payload.grandTotal.toFixed(2)} Bs`, Math.floor(cols / 2))).doubleSize(false)
    else builder.line(padLine('TOTAL:', `${payload.grandTotal.toFixed(2)} Bs`, cols))
    builder.bold(false)
  }

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
