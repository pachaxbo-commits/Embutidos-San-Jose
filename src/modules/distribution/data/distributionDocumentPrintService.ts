import { PrintEngineService } from '../../../services/printing/printEngineService'
import { getActiveReceiptPrinter } from '../../../services/printing/printerBootstrap'
import type { PrintJobPayload } from '../../../types/printing'
import type { DistClosure, DistDispatch, DistProduct } from '../types'
import { computeLoadedByProduct, round2 } from '../domain/engine'
import { printHtmlDocument } from '../../../services/printing/documentPrintService'
import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { getProductPresentation } from '../domain/productPresentation'
import { saveReport } from './reportFiles'

async function printTicket(payload: PrintJobPayload, key: string): Promise<string> {
  const printer = getActiveReceiptPrinter()
  if (!printer) throw new Error('Configura una impresora antes de imprimir.')
  const job = await PrintEngineService.getInstance().submitPrintRequest({
    targetType: 'receipt',
    printerProfileId: printer.id,
    idempotencyKey: `${key}:${Date.now()}`,
    payload,
  })
  if (!['transmitted', 'confirmed'].includes(job.status)) throw new Error(job.lastError || 'La impresora no confirmó el documento.')
  return 'Documento enviado a la impresora.'
}

function basePayload(title: string, subtitle: string, items: PrintJobPayload['items'], message?: string): PrintJobPayload {
  const now = new Date().toLocaleString('es-BO')
  return {
    payloadSchemaVersion: 1,
    templateVersion: 'v1.1-operativo',
    restaurantName: 'EMBUTIDOS SAN JOSÉ',
    branchName: title,
    headerDetails: [subtitle, `EMISIÓN: ${now}`],
    items,
    subtotal: 0,
    discountTotal: 0,
    taxTotal: 0,
    deliveryFee: 0,
    grandTotal: 0,
    customMessage: message,
    footerMessage: `Generado el: ${now}`,
    isCopy: false,
    copies: 1,
    createdIso: new Date().toISOString(),
  }
}

export function printDispatchTicket(dispatch: DistDispatch): Promise<string> {
  const rows = [...computeLoadedByProduct(dispatch).values()]
  return printTicket(
    basePayload(
      'DESPACHO ENTREGADO',
      `${dispatch.routeName} - ${dispatch.distributorName}`,
      rows.map((row) => ({
        name: row.productName,
        basePrice: 0,
        quantity: row.totalLoaded,
        unitLabel: row.unitType === 'kg' ? 'kg' : row.unitType === 'package' ? 'paq' : 'u',
        lineTotal: 0,
      })),
      'Firma de quien recibe: __________________',
    ),
    `dispatch:${dispatch.id}`,
  )
}

export function formatDispatchTextSummary(dispatch: DistDispatch): string {
  const loaded = computeLoadedByProduct(dispatch)
  const header = `*EMBUTIDOS SAN JOSÉ*\n*HOJA DE DESPACHO EN RUTA*\nDespacho: ${dispatch.id.slice(-6).toUpperCase()}\nRuta: ${dispatch.routeName}\nDistribuidor: ${dispatch.distributorName}\nFecha: ${new Date(dispatch.createdAt).toLocaleString('es-BO')}`

  const initialLines = dispatch.lines.map(
    (l) => `• ${l.productName}: ${l.quantity} ${l.unitType === 'kg' ? 'kg' : 'paq'}`,
  ).join('\n')

  let additionsText = ''
  const activeAdditions = (dispatch.additions || []).filter((a) => !a.voided)
  if (activeAdditions.length > 0) {
    additionsText = '\n\n*AUMENTOS REGISTRADOS:*\n' + activeAdditions.map((a, i) => {
      const time = new Date(a.createdAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })
      const resp = a.warehouseResponsibleName || a.createdByName || 'Almacén'
      const lines = a.quantityByProduct.map(
        (q) => `  + ${q.productName}: ${q.quantity} ${q.unitType === 'kg' ? 'kg' : 'paq'}`,
      ).join('\n')
      return `Aumento #${i + 1} (${time} · ${resp}):\n${lines}`
    }).join('\n')
  }

  const consolidated = '\n\n*TOTAL A RENDICIÓN:*\n' + [...loaded.values()].map(
    (row) => `• ${row.productName}: ${row.totalLoaded} ${row.unitType === 'kg' ? 'kg' : 'paq'}`,
  ).join('\n')

  return `${header}\n\n*CARGA INICIAL:*\n${initialLines}${additionsText}${consolidated}\n\n_Generado el ${new Date().toLocaleString('es-BO')}_`
}

export function getDispatchEmailSubject(dispatch: DistDispatch): string {
  return `Despacho ${dispatch.routeName} - ${dispatch.distributorName} (${dispatch.id.slice(-6).toUpperCase()})`
}

export function formatDispatchEmailBody(dispatch: DistDispatch): string {
  const loaded = computeLoadedByProduct(dispatch)
  const header = `EMBUTIDOS SAN JOSÉ
HOJA DE DESPACHO EN RUTA
Despacho: ${dispatch.id.slice(-6).toUpperCase()}
Ruta: ${dispatch.routeName}
Distribuidor: ${dispatch.distributorName}
Fecha y hora: ${new Date(dispatch.createdAt).toLocaleString('es-BO')}
Almacén: ${dispatch.warehouseResponsibleName || 'Almacén Central'}`

  const initialLines = dispatch.lines.map(
    (l) => `• ${l.productName}: ${l.quantity} ${l.unitType === 'kg' ? 'kg' : 'paq'}`,
  ).join('\n')

  let additionsText = ''
  const activeAdditions = (dispatch.additions || []).filter((a) => !a.voided)
  if (activeAdditions.length > 0) {
    additionsText = '\n\nAUMENTOS REGISTRADOS:\n' + activeAdditions.map((a, i) => {
      const time = new Date(a.createdAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })
      const resp = a.warehouseResponsibleName || a.createdByName || 'Almacén'
      const lines = a.quantityByProduct.map(
        (q) => `  + ${q.productName}: ${q.quantity} ${q.unitType === 'kg' ? 'kg' : 'paq'}`,
      ).join('\n')
      return `Aumento #${i + 1} (${time} · ${resp}):\n${lines}`
    }).join('\n')
  }

  const consolidated = '\n\nTOTAL A RENDICIÓN:\n' + [...loaded.values()].map(
    (row) => `• ${row.productName}: ${row.totalLoaded} ${row.unitType === 'kg' ? 'kg' : 'paq'}`,
  ).join('\n')

  return `${header}\n\nCARGA INICIAL:\n${initialLines}${additionsText}${consolidated}\n\nGenerado el ${new Date().toLocaleString('es-BO')} · Embutidos San José`
}

export function getGmailComposeUrl(subject: string, body: string): string {
  return `https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

export function getOutlookComposeUrl(subject: string, body: string): string {
  return `https://outlook.live.com/mail/0/deeplink/compose?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

export function getMailtoUrl(subject: string, body: string): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

export async function generateDispatchPdf(dispatch: DistDispatch, products: DistProduct[] = []) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])

  const doc = new jsPDF({ orientation: 'portrait', format: 'letter' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const productsMap = new Map<string, DistProduct>(products.map((p) => [p.id, p]))

  // Header Bar
  doc.setFillColor(200, 16, 46)
  doc.rect(0, 0, pageWidth, 6, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(200, 16, 46)
  doc.text('EMBUTIDOS SAN JOSÉ', 14, 17)

  doc.setFontSize(12)
  doc.setTextColor(30, 41, 59)
  doc.text('HOJA DE DESPACHO Y CONTROL DE CARGA EN RUTA', 14, 24)

  // Metadatos
  doc.setFillColor(248, 250, 252)
  doc.rect(14, 28, pageWidth - 28, 22, 'F')

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(51, 65, 85)
  doc.text(`Despacho N°: ${dispatch.id.slice(-6).toUpperCase()}          Fecha y hora de salida: ${new Date(dispatch.createdAt).toLocaleString('es-BO')}`, 18, 34)
  doc.text(`Ruta asignada: ${dispatch.routeName}          Distribuidor: ${dispatch.distributorName}`, 18, 40)
  doc.text(`Almacén origen: Almacén central          Encargado almacén: ${dispatch.warehouseResponsibleName || 'Registro de almacén'}`, 18, 46)

  // SECCIÓN 1: CARGA INICIAL
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.setTextColor(30, 41, 59)
  doc.text('1. CARGA INICIAL (SALIDA DE ALMACÉN)', 14, 56)

  autoTable(doc, {
    startY: 59,
    head: [['Producto', 'Detalle de presentación', 'Lote', 'Vencimiento', 'Cantidad inicial', 'Unidad']],
    body: dispatch.lines.map((l) => {
      const prod = productsMap.get(l.productId)
      const pres = getProductPresentation(prod)
      const lot = l.allocations?.[0]?.lotCode || l.lotCode || 'Stock central'
      const exp = l.allocations?.[0]?.expiresOn || l.expiresOn || '—'
      return [
        l.productName,
        pres || '—',
        lot,
        exp,
        l.unitType === 'kg' ? l.quantity.toFixed(2) : String(l.quantity),
        l.unitType === 'kg' ? 'kg' : 'paquetes',
      ]
    }),
    theme: 'grid',
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    bodyStyles: { fontSize: 8, cellPadding: 2.5 },
    columnStyles: {
      0: { cellWidth: 55, fontStyle: 'bold' },
      1: { cellWidth: 45, textColor: [71, 85, 105] },
      2: { cellWidth: 26 },
      3: { cellWidth: 24 },
      4: { cellWidth: 22, halign: 'right', fontStyle: 'bold' },
      5: { cellWidth: 16, halign: 'center' },
    },
    margin: { left: 14, right: 14 },
  })

  // SECCIÓN 2: AUMENTOS EN RUTA
  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8

  const activeAdditions = (dispatch.additions || []).filter((a) => !a.voided)
  if (activeAdditions.length > 0) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(180, 83, 9)
    doc.text('2. AUMENTOS DE CARGA REGISTRADOS DURANTE EL DÍA', 14, y)

    activeAdditions.forEach((add, i) => {
      y += 5
      doc.setFillColor(254, 243, 199)
      doc.rect(14, y, pageWidth - 28, 7.5, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8)
      doc.setTextColor(146, 64, 14)
      const time = new Date(add.createdAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })
      const resp = add.warehouseResponsibleName || add.createdByName || 'Almacén'
      doc.text(`AUMENTO #${i + 1}  ·  HORA: ${time}  ·  ENCARGADO: ${resp}`, 18, y + 5)

      autoTable(doc, {
        startY: y + 8,
        head: [['Producto', 'Detalle de presentación', 'Lote asignado', 'Vencimiento', 'Cantidad añadida', 'Unidad']],
        body: add.quantityByProduct.map((l) => {
          const prod = productsMap.get(l.productId)
          const pres = getProductPresentation(prod)
          const lot = l.allocations?.[0]?.lotCode || l.lotCode || 'Stock almacén'
          const exp = l.allocations?.[0]?.expiresOn || l.expiresOn || '—'
          return [
            l.productName,
            pres || '—',
            lot,
            exp,
            `+${l.unitType === 'kg' ? l.quantity.toFixed(2) : String(l.quantity)}`,
            l.unitType === 'kg' ? 'kg' : 'paquetes',
          ]
        }),
        theme: 'grid',
        headStyles: { fillColor: [217, 119, 6], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
        bodyStyles: { fontSize: 7.5, cellPadding: 2, fillColor: [255, 251, 235] },
        columnStyles: {
          0: { cellWidth: 55, fontStyle: 'bold' },
          1: { cellWidth: 45 },
          2: { cellWidth: 26 },
          3: { cellWidth: 24 },
          4: { cellWidth: 22, halign: 'right', fontStyle: 'bold', textColor: [180, 83, 9] },
          5: { cellWidth: 16, halign: 'center', textColor: [180, 83, 9] },
        },
        margin: { left: 14, right: 14 },
      })
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
    })
    y += 8
  }

  // SECCIÓN 3: CONSOLIDADO A RENDICIÓN
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.setTextColor(30, 41, 59)
  doc.text('3. CONSOLIDADO TOTAL ENTREGADO A LA RUTA (CARGA INICIAL + AUMENTOS)', 14, y)

  const loadedMap = computeLoadedByProduct(dispatch)
  autoTable(doc, {
    startY: y + 3,
    head: [['Producto', 'Detalle de presentación', 'Carga inicial', 'Aumentos', 'TOTAL A RENDICIÓN', 'Unidad']],
    body: [...loadedMap.entries()].map(([productId, row]) => {
      const prod = productsMap.get(productId)
      const pres = getProductPresentation(prod)
      return [
        row.productName,
        pres || '—',
        row.unitType === 'kg' ? row.initialDispatch.toFixed(2) : String(row.initialDispatch),
        row.additions > 0 ? `+${row.unitType === 'kg' ? row.additions.toFixed(2) : String(row.additions)}` : '0',
        row.unitType === 'kg' ? row.totalLoaded.toFixed(2) : String(row.totalLoaded),
        row.unitType === 'kg' ? 'kg' : 'paquetes',
      ]
    }),
    theme: 'grid',
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    bodyStyles: { fontSize: 8, cellPadding: 2.5 },
    columnStyles: {
      0: { cellWidth: 55, fontStyle: 'bold' },
      1: { cellWidth: 45 },
      2: { cellWidth: 24, halign: 'right' },
      3: { cellWidth: 22, halign: 'right', textColor: [180, 83, 9] },
      4: { cellWidth: 26, halign: 'right', fontStyle: 'bold', textColor: [200, 16, 46] },
      5: { cellWidth: 16, halign: 'center' },
    },
    margin: { left: 14, right: 14 },
  })

  // Firmas
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 22
  doc.setDrawColor(71, 85, 105)
  doc.setLineWidth(0.5)
  doc.line(30, y, 90, y)
  doc.line(125, y, 185, y)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(71, 85, 105)
  doc.text(`Entrega Almacén (${dispatch.warehouseResponsibleName || 'Almacén'})`, 32, y + 4)
  doc.text(`Recibe Conforme Distribuidor (${dispatch.distributorName})`, 127, y + 4)

  // Pie de página con fecha y hora exacta
  doc.setFontSize(7.5)
  doc.setTextColor(148, 163, 184)
  doc.text(`Generado el: ${new Date().toLocaleString('es-BO')} · Embutidos San José`, 14, pageHeight - 8)
  doc.text(`Página 1 de 1`, pageWidth - 28, pageHeight - 8)

  return doc
}

export async function downloadDispatchPdf(dispatch: DistDispatch, products: DistProduct[] = []): Promise<void> {
  const doc = await generateDispatchPdf(dispatch, products)
  const filename = `Despacho-SanJose-${dispatch.id.slice(-6).toUpperCase()}.pdf`
  await saveReport(
    new Uint8Array(doc.output('arraybuffer')),
    filename,
    'application/pdf',
  )
}

export async function printDispatchSheet(dispatch: DistDispatch, products: DistProduct[] = []): Promise<void> {
  const doc = await generateDispatchPdf(dispatch, products)
  const blob = new Blob([doc.output('arraybuffer')], { type: 'application/pdf' })
  const blobUrl = URL.createObjectURL(blob)
  const iframe = document.createElement('iframe')
  iframe.style.display = 'none'
  iframe.src = blobUrl
  document.body.appendChild(iframe)
  iframe.onload = () => {
    iframe.contentWindow?.print()
    setTimeout(() => {
      document.body.removeChild(iframe)
      URL.revokeObjectURL(blobUrl)
    }, 60_000)
  }
}

export async function shareDispatch(dispatch: DistDispatch, products: DistProduct[] = []): Promise<boolean> {
  const doc = await generateDispatchPdf(dispatch, products)
  const filename = `despacho-san-jose-${dispatch.id.slice(-6)}.pdf`
  const bytes = new Uint8Array(doc.output('arraybuffer'))

  if (Capacitor.isNativePlatform()) {
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    const base64 = btoa(binary)
    const path = `shared/${filename}`
    const written = await Filesystem.writeFile({ path, data: base64, directory: Directory.Cache, recursive: true })
    await Share.share({ title: 'Despacho Embutidos San José', dialogTitle: 'Compartir despacho', files: [written.uri] })
    return true
  }

  const nav = navigator as Navigator & { share?: (data: { title: string; files: File[] }) => Promise<void>; canShare?: (data: { files: File[] }) => boolean }
  const file = new File([bytes], filename, { type: 'application/pdf' })
  if (nav.share && (!nav.canShare || nav.canShare({ files: [file] }))) {
    await nav.share({ title: 'Despacho Embutidos San José', files: [file] })
    return true
  }

  await downloadDispatchPdf(dispatch, products)
  return true
}

export function printClosureTicket(closure: DistClosure): Promise<string> {
  return printTicket(
    basePayload(
      'CIERRE DE RUTA',
      `${closure.routeName} - ${closure.distributorName}`,
      closure.products.map((row) => ({
        name: row.productName,
        basePrice: 0,
        quantity: row.sold,
        unitLabel: row.unitType === 'kg' ? 'kg vendidos' : 'vendidos',
        lineTotal: 0,
        modifiersText: [`Entregado ${row.totalLoaded}`, `Devuelto ${row.actualReturn}`, `Diferencia ${row.variance}`],
      })),
      closure.status === 'closed'
        ? `EFECTIVO ESPERADO: Bs ${round2(closure.expectedCash).toFixed(2)} | DECLARADO: Bs ${round2(closure.physicalCashDeclared).toFixed(2)}`
        : 'Cierre pendiente de completar',
    ),
    `closure:${closure.id}`,
  )
}

export async function printOperationalSheet(title: string, subtitle: string, rows: { name: string; detail: string }[], totals: { label: string; value: string }[] = []): Promise<void> {
  const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] || char)
  const now = new Date().toLocaleString('es-BO')
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escape(title)}</title><style>@page{size:A4;margin:0}*{box-sizing:border-box}body{font-family:Arial;color:#172033;margin:0;padding:18mm}.head{display:flex;gap:20px;align-items:center;border-bottom:4px solid #c8102e}.head img{width:100px}.head h1{margin:0;color:#c8102e}table{width:100%;border-collapse:collapse;margin-top:24px}th{background:#c8102e;color:white;text-align:left;padding:10px}td{padding:11px;border-bottom:1px solid #ddd}.totals{margin-top:22px;margin-left:auto;width:330px}.totals p{display:flex;justify-content:space-between;font-weight:bold}.sign{margin-top:70px;display:flex;justify-content:space-around}.sign span{border-top:1px solid #333;padding:8px 35px}.foot{text-align:center;color:#64748b;margin-top:40px;font-size:11px}</style></head><body><header class="head"><img src="/brand/san-jose-logo.png"><div><h1>${escape(title)}</h1><p>${escape(subtitle)}</p></div></header><table><thead><tr><th>Producto / concepto</th><th>Detalle</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escape(row.name)}</td><td>${escape(row.detail)}</td></tr>`).join('')}</tbody></table><div class="totals">${totals.map((total) => `<p><span>${escape(total.label)}</span><span>${escape(total.value)}</span></p>`).join('')}</div><div class="sign"><span>Entrega</span><span>Recibe</span></div><p class="foot">Generado el: ${escape(now)} · Embutidos San José</p></body></html>`
  await printHtmlDocument(html, title)
}
