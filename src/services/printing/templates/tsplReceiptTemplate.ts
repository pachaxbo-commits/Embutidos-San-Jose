import type { PrintJobPayload } from '../../../types/printing'
import { padLine, transliterateText } from '../escPosFormatter'
import { SAN_JOSE_THERMAL_LOGO } from '../sanJoseThermalLogo'

type TextLine = { text: string; align?: 'left' | 'center' | 'right'; scale?: 1 | 2 }

function quantity(value: number): string {
  return Number(value.toFixed(3)).toString()
}

function wrap(text: string, columns: number): string[] {
  const clean = transliterateText(text).replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!clean) return ['']
  const lines: string[] = []
  let current = ''
  for (const word of clean.split(' ')) {
    if (word.length > columns) {
      if (current) lines.push(current)
      for (let index = 0; index < word.length; index += columns) lines.push(word.slice(index, index + columns))
      current = ''
    } else if (!current) current = word
    else if (`${current} ${word}`.length <= columns) current += ` ${word}`
    else { lines.push(current); current = word }
  }
  if (current) lines.push(current)
  return lines
}

function addWrapped(lines: TextLine[], text: string, columns: number, options: Omit<TextLine, 'text'> = {}) {
  wrap(text, columns).forEach(part => lines.push({ text: part, ...options }))
}

/** Ticket para impresoras de etiquetas QIRUI/BEEPRT que usan TSPL. */
export function buildTsplReceiptBytes(payload: PrintJobPayload, paperWidth: '58mm' | '80mm' = '80mm'): Uint8Array {
  const columns = paperWidth === '58mm' ? 30 : 46
  const separator = '-'.repeat(columns)
  const lines: TextLine[] = []

  if (payload.isCopy) addWrapped(lines, '*** REIMPRESION - COPIA ***', Math.floor(columns / 2), { align: 'center', scale: 2 })
  addWrapped(lines, payload.restaurantName, Math.floor(columns / 2), { align: 'center', scale: 2 })
  addWrapped(lines, payload.branchName, columns, { align: 'center' })
  if (payload.branchAddress) addWrapped(lines, payload.branchAddress, columns, { align: 'center' })
  if (payload.branchPhone) addWrapped(lines, `Tel: ${payload.branchPhone}`, columns, { align: 'center' })
  payload.headerDetails?.forEach(detail => addWrapped(lines, detail, columns, { align: 'center' }))
  lines.push({ text: separator })
  if (payload.displayNumber) addWrapped(lines, `TICKET: ${payload.displayNumber}`, columns)
  addWrapped(lines, `FECHA: ${new Date(payload.createdIso).toLocaleString('es-BO')}`, columns)
  if (payload.fulfillmentType) addWrapped(lines, `TIPO: ${payload.fulfillmentType.toUpperCase()}`, columns)
  if (payload.tableInfo) addWrapped(lines, `MESA: ${payload.tableInfo}`, columns)
  if (payload.customerName) addWrapped(lines, `CLIENTE: ${payload.customerName}`, columns)
  if (payload.customerPhone) addWrapped(lines, payload.customerPhone, columns)
  lines.push({ text: separator }, { text: padLine('PRODUCTO', 'SUBTOTAL', columns) }, { text: separator })

  payload.items.forEach(item => {
    addWrapped(lines, item.name, columns)
    const unit = item.unitLabel ? ` ${item.unitLabel}` : ''
    lines.push({ text: padLine(`${quantity(item.quantity)}${unit} x ${item.basePrice.toFixed(2)}`, `${item.lineTotal.toFixed(2)} Bs`, columns) })
    item.modifiersText?.forEach(modifier => addWrapped(lines, `  * ${modifier}`, columns))
    if (item.note) addWrapped(lines, `  Nota: ${item.note}`, columns)
  })

  lines.push({ text: separator })
  lines.push({ text: padLine('SUBTOTAL:', `${payload.subtotal.toFixed(2)} Bs`, columns) })
  if (payload.discountTotal > 0) lines.push({ text: padLine('DESCUENTO:', `-${payload.discountTotal.toFixed(2)} Bs`, columns) })
  if (payload.deliveryFee > 0) lines.push({ text: padLine('DELIVERY:', `${payload.deliveryFee.toFixed(2)} Bs`, columns) })
  lines.push({ text: padLine('TOTAL:', `${payload.grandTotal.toFixed(2)} Bs`, Math.floor(columns / 2)), align: 'right', scale: 2 })
  if (payload.paymentMethod) {
    lines.push({ text: separator })
    addWrapped(lines, `PAGO: ${payload.paymentMethod.toUpperCase()}`, columns)
    if (payload.cashReceived) addWrapped(lines, `RECIBIDO: ${payload.cashReceived.toFixed(2)} Bs`, columns)
    if (payload.changeAmount) addWrapped(lines, `CAMBIO: ${payload.changeAmount.toFixed(2)} Bs`, columns)
    payload.paymentDetails?.forEach(detail => addWrapped(lines, detail, columns))
  }
  if (payload.customMessage) { lines.push({ text: separator }); addWrapped(lines, payload.customMessage, columns, { align: 'center' }) }
  if (payload.footerMessage) { lines.push({ text: separator }); addWrapped(lines, payload.footerMessage, columns, { align: 'center' }) }

  const dotsWide = paperWidth === '58mm' ? 464 : 640
  const margin = 20
  const includeLogo = /san\s+jos[eé]/i.test(payload.restaurantName)
  let y = includeLogo ? SAN_JOSE_THERMAL_LOGO.height + 38 : 20
  const commands: string[] = []
  const rendered = lines.map(line => {
    const scale = line.scale || 1
    const lineHeight = scale === 2 ? 48 : 27
    const estimatedWidth = line.text.length * 12 * scale
    const x = line.align === 'center' ? Math.max(margin, Math.floor((dotsWide - estimatedWidth) / 2)) : line.align === 'right' ? Math.max(margin, dotsWide - margin - estimatedWidth) : margin
    const command = `TEXT ${x},${y},"0",0,${scale},${scale},"${line.text}"`
    y += lineHeight
    return command
  })
  const heightMm = Math.max(60, Math.min(400, Math.ceil((y + 32) / 8)))
  commands.push(`SIZE ${paperWidth === '58mm' ? 58 : 80} mm,${heightMm} mm`, 'GAP 0 mm,0 mm', 'DENSITY 8', 'DIRECTION 1', 'REFERENCE 0,0', 'CLS')
  const encoder = new TextEncoder()
  const textBytes = encoder.encode(`${commands.join('\r\n')}\r\n`)
  const endingBytes = encoder.encode(`${rendered.join('\r\n')}\r\nPRINT 1,1\r\n`)
  if (!includeLogo) {
    const result = new Uint8Array(textBytes.length + endingBytes.length)
    result.set(textBytes)
    result.set(endingBytes, textBytes.length)
    return result
  }

  const logo = SAN_JOSE_THERMAL_LOGO
  const x = Math.max(0, Math.floor((dotsWide - logo.width) / 2))
  const bitmapHeader = encoder.encode(`BITMAP ${x},12,${Math.ceil(logo.width / 8)},${logo.height},0,`)
  const lineEnd = encoder.encode('\r\n')
  const result = new Uint8Array(textBytes.length + bitmapHeader.length + logo.data.length + lineEnd.length + endingBytes.length)
  let offset = 0
  for (const part of [textBytes, bitmapHeader, logo.data, lineEnd, endingBytes]) { result.set(part, offset); offset += part.length }
  return result
}
