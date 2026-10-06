import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const req = createRequire(import.meta.url)
const { jsPDF } = req('jspdf')
const { default: autoTable } = req('jspdf-autotable')
const ExcelJS = req('exceljs')

const OUTPUT_DIR = path.resolve('output/review-148')
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
}

console.log('Generando muestras oficiales 1.4.8 en:', OUTPUT_DIR)

// --- UTILIDADES GLOBALES DE REDONDEO Y FORMATO ---
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const formatBs = (n) => `Bs ${round2(n).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const currentGenerationTimestamp = () => {
  const now = new Date()
  const d = now.toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const t = now.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return `${d} ${t}`
}

const DEMO_PERIOD = '01/10/2026 al 06/10/2026'

// --- DATOS DEMO CANÓNICOS ---
const DEMO_CLIENTS = [
  {
    customerName: 'Supermercado Doña Julia',
    customerCode: '4892019',
    routeId: 'Zona Norte',
    purchasesCount: 5,
    totalBs: 8917.00,
    exactKg: 161.0,
    estimatedKg: 8.4,
    totalEquivalentKg: 169.4,
    totalPackages: 42,
    kgBreakdown: '169,4 kg equivalentes (161,0 kg exactos + 8,4 estimados)',
    products: [
      { productName: 'Chorizo Parrillero Crudo', presentation: 'Paquete al vacío de 500 g', unitType: 'kg', quantity: 70.0, unitPrice: 57.00, exactKg: 70.0, estimatedKg: 0, totalEquivalentKg: 70.0, totalBs: 3990.00 },
      { productName: 'Salchicha tipo Viena', presentation: 'Granel', unitType: 'kg', quantity: 80.0, unitPrice: 48.00, exactKg: 80.0, estimatedKg: 0, totalEquivalentKg: 80.0, totalBs: 3840.00 },
      { productName: 'Jamón de Cerdo', presentation: 'Granel', unitType: 'kg', quantity: 11.0, unitPrice: 53.00, exactKg: 11.0, estimatedKg: 0, totalEquivalentKg: 11.0, totalBs: 583.00 },
      { productName: 'Mortadela Jamonada', presentation: 'Sachet de 200 g', unitType: 'package', quantity: 42, unitPrice: 12.00, exactKg: 0, estimatedKg: 8.4, totalEquivalentKg: 8.4, totalBs: 504.00 },
    ],
  },
  {
    customerName: 'Frialsur Los Andes',
    customerCode: '3019284',
    routeId: 'Sacaba',
    purchasesCount: 3,
    totalBs: 5148.00,
    exactKg: 88.5,
    estimatedKg: 5.0,
    totalEquivalentKg: 93.5,
    totalPackages: 25,
    kgBreakdown: '93,5 kg equivalentes (88,5 kg exactos + 5,0 estimados)',
    products: [
      { productName: 'Chorizo Parrillero Crudo', presentation: 'Paquete al vacío de 500 g', unitType: 'kg', quantity: 50.0, unitPrice: 57.00, exactKg: 50.0, estimatedKg: 0, totalEquivalentKg: 50.0, totalBs: 2850.00 },
      { productName: 'Jamón de Cerdo', presentation: 'Granel', unitType: 'kg', quantity: 30.0, unitPrice: 53.00, exactKg: 30.0, estimatedKg: 0, totalEquivalentKg: 30.0, totalBs: 1590.00 },
      { productName: 'Salchicha tipo Viena', presentation: 'Granel', unitType: 'kg', quantity: 8.5, unitPrice: 48.00, exactKg: 8.5, estimatedKg: 0, totalEquivalentKg: 8.5, totalBs: 408.00 },
      { productName: 'Mortadela Jamonada', presentation: 'Sachet de 200 g', unitType: 'package', quantity: 25, unitPrice: 12.00, exactKg: 0, estimatedKg: 5.0, totalEquivalentKg: 5.0, totalBs: 300.00 },
    ],
  },
  {
    customerName: 'Almacén Don Pedro',
    customerCode: '7721890',
    routeId: 'Zona Sud',
    purchasesCount: 4,
    totalBs: 4432.00,
    exactKg: 84.0,
    estimatedKg: 3.0,
    totalEquivalentKg: 87.0,
    totalPackages: 15,
    kgBreakdown: '87,0 kg equivalentes (84,0 kg exactos + 3,0 estimados)',
    products: [
      { productName: 'Salchicha tipo Viena', presentation: 'Granel', unitType: 'kg', quantity: 60.0, unitPrice: 48.00, exactKg: 60.0, estimatedKg: 0, totalEquivalentKg: 60.0, totalBs: 2880.00 },
      { productName: 'Chorizo Parrillero Crudo', presentation: 'Paquete al vacío de 500 g', unitType: 'kg', quantity: 20.0, unitPrice: 57.00, exactKg: 20.0, estimatedKg: 0, totalEquivalentKg: 20.0, totalBs: 1140.00 },
      { productName: 'Jamón de Cerdo', presentation: 'Granel', unitType: 'kg', quantity: 4.0, unitPrice: 53.00, exactKg: 4.0, estimatedKg: 0, totalEquivalentKg: 4.0, totalBs: 212.00 },
      { productName: 'Mortadela Jamonada', presentation: 'Sachet de 200 g', unitType: 'package', quantity: 15, unitPrice: 12.00, exactKg: 0, estimatedKg: 3.0, totalEquivalentKg: 3.0, totalBs: 180.00 },
    ],
  },
]

const GRAND_TOTAL_BS = round2(DEMO_CLIENTS.reduce((s, c) => s + c.totalBs, 0))
const GRAND_TOTAL_EXACT_KG = round2(DEMO_CLIENTS.reduce((s, c) => s + c.exactKg, 0))
const GRAND_TOTAL_EST_KG = round2(DEMO_CLIENTS.reduce((s, c) => s + c.estimatedKg, 0))
const GRAND_TOTAL_EQUIV_KG = round2(GRAND_TOTAL_EXACT_KG + GRAND_TOTAL_EST_KG)
const GRAND_TOTAL_PACKAGES = DEMO_CLIENTS.reduce((s, c) => s + c.totalPackages, 0)

const DEMO_FINANCIALS = {
  grossSales: 18777.00,
  returnsDelta: -280.00,
  netSales: 18497.00,
  productionCost: 10240.00,
  grossMargin: 8257.00,
  expenses: 1420.00,
  inventoryLosses: 310.00,
  operatingProfit: 6527.00,
}

// Helper para cabecera PDF
function drawHeader(pdf, title, subtitle) {
  const pageWidth = pdf.internal.pageSize.getWidth()
  pdf.setFillColor(200, 16, 46)
  pdf.rect(0, 0, pageWidth, 5.5, 'F')

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(15)
  pdf.setTextColor(200, 16, 46)
  pdf.text('EMBUTIDOS SAN JOSÉ', 14, 15)

  pdf.setFontSize(11)
  pdf.setTextColor(30, 41, 59)
  pdf.text(title, 14, 22)

  if (subtitle) {
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.setTextColor(100, 116, 139)
    pdf.text(subtitle, 14, 28, { maxWidth: pageWidth - 28 })
  }
}

// Helper para footer PDF
function drawFooter(pdf) {
  const pageCount = pdf.internal.getNumberOfPages()
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  for (let i = 1; i <= pageCount; i++) {
    pdf.setPage(i)
    pdf.setDrawColor(226, 232, 240)
    pdf.setLineWidth(0.3)
    pdf.line(14, pageHeight - 10, pageWidth - 14, pageHeight - 10)

    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7)
    pdf.setTextColor(148, 163, 184)
    pdf.text('Embutidos San José · Sistema de Distribución y Reportes v1.4.8', 14, pageHeight - 6)
    pdf.text(`Página ${i} de ${pageCount} · ${currentGenerationTimestamp()}`, pageWidth - 14, pageHeight - 6, { align: 'right' })
  }
}

// Helper para Excel estilizado
function createStyledWorkbook(title, sheetName, headers, rows, subtitle) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Embutidos San José'
  wb.created = new Date()

  const ws = wb.addWorksheet(sheetName, {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 4 }],
  })

  // Fila 1: Banner de marca
  ws.mergeCells(1, 1, 1, Math.max(headers.length, 6))
  const banner = ws.getCell(1, 1)
  banner.value = 'EMBUTIDOS SAN JOSÉ  ·  SISTEMA DE GESTIÓN Y DISTRIBUCIÓN'
  banner.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
  banner.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC8102E' } }
  banner.alignment = { vertical: 'middle', horizontal: 'center' }
  ws.getRow(1).height = 24

  // Fila 2: Título
  ws.mergeCells(2, 1, 2, Math.max(headers.length, 6))
  const titleCell = ws.getCell(2, 1)
  titleCell.value = title.toUpperCase()
  titleCell.font = { name: 'Segoe UI', size: 12, bold: true, color: { argb: 'FF1E293B' } }
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' }
  ws.getRow(2).height = 20

  // Fila 3: Subtítulo
  ws.mergeCells(3, 1, 3, Math.max(headers.length, 6))
  const subCell = ws.getCell(3, 1)
  subCell.value = `${subtitle || `Periodo: ${DEMO_PERIOD}`}  ·  Generado: ${currentGenerationTimestamp()}`
  subCell.font = { name: 'Segoe UI', size: 8.5, color: { argb: 'FF64748B' } }
  subCell.alignment = { vertical: 'middle', horizontal: 'left' }
  ws.getRow(3).height = 16

  // Fila 4: Cabeceras
  const headerRow = ws.getRow(4)
  headerRow.values = headers
  headerRow.height = 22
  for (let c = 1; c <= headers.length; c++) {
    const cell = headerRow.getCell(c)
    cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  }

  // Filas de datos
  for (const r of rows) {
    ws.addRow(r)
  }

  // Formato numérico y bordes
  for (let r = 5; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    row.height = 19
    const isTotal = String(row.getCell(1).value).toUpperCase().includes('TOTAL')
    if (isTotal) {
      row.font = { name: 'Segoe UI', size: 9.5, bold: true }
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDECEE' } }
    }
    for (let c = 1; c <= headers.length; c++) {
      const cell = row.getCell(c)
      if (typeof cell.value === 'number') {
        const h = headers[c - 1] || ''
        cell.numFmt = (h.includes('Bs') || h.includes('Precio') || h.includes('Subtotal') || h.includes('Total') || h.includes('Importe'))
          ? '#,##0.00'
          : (h.includes('Kg') || h.includes('Cantidad') || h.includes('Física') || h.includes('Disponible'))
            ? '#,##0.00'
            : '0.##'
      }
    }
  }

  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: ws.rowCount, column: headers.length } }

  for (let c = 1; c <= headers.length; c++) {
    let max = (headers[c - 1] || '').length
    for (let r = 5; r <= ws.rowCount; r++) {
      const val = ws.getCell(r, c).value
      if (val !== null && val !== undefined) {
        max = Math.max(max, String(val).length)
      }
    }
    ws.getColumn(c).width = Math.min(Math.max(max + 3, 11), 38)
  }

  return wb
}

// --------------------------------------------------------------------------
// 1. RESULTADO DEL PERIODO (PDF & XLSX)
// --------------------------------------------------------------------------
function generateResultadoPeriodo() {
  const pdf = new jsPDF({ orientation: 'portrait', format: 'letter' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  drawHeader(pdf, 'RESULTADO DEL PERIODO', `Periodo evaluado: ${DEMO_PERIOD}  ·  Moneda: Bolivianos (Bs)`)

  // KPI Box
  pdf.setFillColor(248, 250, 252)
  pdf.setDrawColor(200, 16, 46)
  pdf.setLineWidth(1)
  pdf.roundedRect(14, 33, pageWidth - 28, 29, 3, 3, 'FD')

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(8.5)
  pdf.setTextColor(148, 163, 184)
  pdf.text('RESULTADO OPERATIVO ESTIMADO / GANANCIA OPERATIVA ESTIMADA', 20, 41)

  pdf.setFontSize(18)
  pdf.setTextColor(200, 16, 46)
  pdf.text(formatBs(DEMO_FINANCIALS.operatingProfit), 20, 50)

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(7.5)
  pdf.setTextColor(71, 85, 105)
  pdf.text(
    `Ventas netas (${formatBs(DEMO_FINANCIALS.netSales)})  -  Costo de lo vendido (${formatBs(DEMO_FINANCIALS.productionCost)})  -  Gastos (${formatBs(DEMO_FINANCIALS.expenses)})  -  Pérdidas (${formatBs(DEMO_FINANCIALS.inventoryLosses)})`,
    20,
    57,
  )

  autoTable(pdf, {
    startY: 66,
    head: [['Paso', 'Concepto operativo', 'Descripción del cálculo', 'Importe (Bs)']],
    body: [
      ['1', 'Ventas brutas antes de devoluciones', 'Total de ventas iniciales entregadas en el periodo', formatBs(DEMO_FINANCIALS.grossSales)],
      ['2', '(-) Ajustes por cambios y devoluciones', 'Devoluciones y productos compensados en ruta', `- ${formatBs(Math.abs(DEMO_FINANCIALS.returnsDelta))}`],
      ['3', '(=) VENTAS NETAS', 'Ingreso comercial neto tras devoluciones', formatBs(DEMO_FINANCIALS.netSales)],
      ['4', '(-) Costo de producción de productos vendidos y reemplazos', 'Costo de producción registrado de los productos comercializados', `- ${formatBs(DEMO_FINANCIALS.productionCost)}`],
      ['5', '(=) MARGEN BRUTO', 'Diferencia directa entre ventas netas y costo de producción', formatBs(DEMO_FINANCIALS.grossMargin)],
      ['6', '(-) Gastos registrados de ruta', 'Combustible, viáticos y gastos validados', `- ${formatBs(DEMO_FINANCIALS.expenses)}`],
      ['7', '(-) Pérdidas y mermas registradas', 'Faltantes en conciliaciones y mermas de almacén', `- ${formatBs(DEMO_FINANCIALS.inventoryLosses)}`],
      ['8', '(=) RESULTADO OPERATIVO ESTIMADO / GANANCIA OPERATIVA', 'Ganancia operativa estimada del negocio en este periodo', formatBs(DEMO_FINANCIALS.operatingProfit)],
    ],
    theme: 'grid',
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    bodyStyles: { fontSize: 7.5, cellPadding: 2.4 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 12, halign: 'center' },
      1: { cellWidth: 84, fontStyle: 'bold' },
      2: { cellWidth: 60, textColor: [100, 116, 139] },
      3: { cellWidth: 32, halign: 'right', fontStyle: 'bold' },
    },
    didParseCell: (hook) => {
      if (hook.row.index === 2 || hook.row.index === 4) {
        hook.cell.styles.fillColor = [254, 243, 199]
      }
      if (hook.row.index === 7) {
        hook.cell.styles.fillColor = [254, 226, 226]
        hook.cell.styles.textColor = [185, 28, 28]
        hook.cell.styles.fontSize = 8
      }
    },
    margin: { left: 14, right: 14 },
  })

  const finalY = pdf.lastAutoTable.finalY + 6
  if (finalY < 235) {
    pdf.setFillColor(241, 245, 249)
    pdf.roundedRect(14, finalY, pageWidth - 28, 42, 3, 3, 'F')

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8)
    pdf.setTextColor(30, 41, 59)
    pdf.text('GUÍA EXPLICATIVA PARA ADMINISTRACIÓN (CÓMO ENTENDER CADA NÚMERO):', 18, finalY + 6)

    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7)
    pdf.setTextColor(51, 65, 85)
    const guideLines = [
      '• Ventas netas: Total vendido antes de ajustes menos devoluciones. Incluye ventas al contado y a crédito del periodo.',
      '• Costo de lo vendido: Costo de producción registrado (materia prima, elaboración) de las unidades efectivamente entregadas.',
      '• Margen bruto: Ganancia industrial directa antes de gastos de comercialización, distribución y logística.',
      '• Gastos de ruta: Combustible, viáticos, peajes, reparaciones y gastos menores documentados por distribución.',
      '• Pérdidas y mermas: Faltantes físicos detectados en cierre de ruta y bajas por productos dañados o vencidos.',
      '• Resultado operativo estimado: Beneficio económico generado por la operación regular del negocio en el periodo.',
    ]
    guideLines.forEach((text, idx) => {
      pdf.text(text, 18, finalY + 12 + idx * 5)
    })
  }

  drawFooter(pdf)
  fs.writeFileSync(path.join(OUTPUT_DIR, '01-resultado-del-periodo.pdf'), Buffer.from(pdf.output('arraybuffer')))

  // Excel
  const wb = createStyledWorkbook(
    'Resultado del Periodo',
    'Resumen',
    ['Paso', 'Concepto operativo', 'Descripción', 'Importe (Bs)'],
    [
      ['1', 'Ventas brutas antes de devoluciones', 'Total de ventas iniciales', DEMO_FINANCIALS.grossSales],
      ['2', '(-) Ajustes por cambios y devoluciones', 'Devoluciones y productos compensados', DEMO_FINANCIALS.returnsDelta],
      ['3', '(=) VENTAS NETAS', 'Ingreso comercial neto', DEMO_FINANCIALS.netSales],
      ['4', '(-) Costo de producción de lo vendido', 'Costo de producción de unidades entregadas', -DEMO_FINANCIALS.productionCost],
      ['5', '(=) MARGEN BRUTO', 'Diferencia directa entre ventas y costo', DEMO_FINANCIALS.grossMargin],
      ['6', '(-) Gastos registrados de ruta', 'Combustible, viáticos y gastos validados', -DEMO_FINANCIALS.expenses],
      ['7', '(-) Pérdidas y mermas registradas', 'Faltantes de cierre y mermas de almacén', -DEMO_FINANCIALS.inventoryLosses],
      ['8', '(=) RESULTADO OPERATIVO ESTIMADO', 'Ganancia operativa estimada del periodo', DEMO_FINANCIALS.operatingProfit],
    ],
  )
  wb.xlsx.writeFile(path.join(OUTPUT_DIR, '01-resultado-del-periodo.xlsx'))
}

// --------------------------------------------------------------------------
// 2. COMPRAS POR CLIENTE (PDF & XLSX MULTI-SHEET)
// --------------------------------------------------------------------------
async function generateComprasPorCliente() {
  const pdf = new jsPDF({ orientation: 'portrait', format: 'letter' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  drawHeader(pdf, 'COMPRAS POR CLIENTE Y PRODUCTO', `Periodo: ${DEMO_PERIOD}  ·  Ranking por importe total  ·  Distinción de kg exactos y estimados`)

  // Top Client Box
  const topClient = DEMO_CLIENTS[0]
  pdf.setFillColor(248, 250, 252)
  pdf.setDrawColor(200, 16, 46)
  pdf.setLineWidth(0.8)
  pdf.roundedRect(14, 33, pageWidth - 28, 16, 2, 2, 'FD')

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(8)
  pdf.setTextColor(200, 16, 46)
  pdf.text('CLIENTE N° 1 CON MAYOR VOLUMEN:', 18, 39)

  pdf.setFontSize(10)
  pdf.setTextColor(30, 41, 59)
  pdf.text(`${topClient.customerName}  ·  ${formatBs(topClient.totalBs)}  ·  ${topClient.kgBreakdown}`, 18, 45)

  let startY = 53

  DEMO_CLIENTS.forEach((client, idx) => {
    if (startY > 235) {
      pdf.addPage('letter', 'portrait')
      drawHeader(pdf, 'COMPRAS POR CLIENTE (CONTINUACIÓN)', `Periodo: ${DEMO_PERIOD}`)
      startY = 33
    }

    pdf.setFillColor(241, 245, 249)
    pdf.rect(14, startY, pageWidth - 28, 7.5, 'F')

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8.5)
    pdf.setTextColor(30, 41, 59)
    pdf.text(`#${idx + 1}  ${client.customerName.toUpperCase()}`, 18, startY + 5)

    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7)
    pdf.setTextColor(100, 116, 139)
    pdf.text(`CI: ${client.customerCode}  ·  Ruta: ${client.routeId}  ·  ${client.purchasesCount} pedidos`, 80, startY + 5)

    pdf.setFont('helvetica', 'bold')
    pdf.setTextColor(200, 16, 46)
    pdf.text(`Subtotal: ${formatBs(client.totalBs)}`, pageWidth - 42, startY + 5)

    autoTable(pdf, {
      startY: startY + 8.5,
      head: [['Producto', 'Detalle de presentación', 'Cantidad', 'Unidad', 'Kg calculados', 'Precio (Bs)', 'Subtotal (Bs)']],
      body: client.products.map((p) => [
        p.productName,
        p.presentation,
        round2(p.quantity),
        p.unitType === 'kg' ? 'Kg' : 'Paquete',
        p.unitType === 'kg' ? `${round2(p.exactKg)} kg (exacto)` : `${round2(p.estimatedKg)} kg (estimado)`,
        formatBs(p.unitPrice),
        formatBs(p.totalBs),
      ]),
      theme: 'plain',
      headStyles: { fillColor: [51, 65, 85], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7, cellPadding: 2 },
      bodyStyles: { fontSize: 7, cellPadding: 2, textColor: [30, 41, 59] },
      columnStyles: {
        0: { cellWidth: 50, fontStyle: 'bold' },
        1: { cellWidth: 42, textColor: [71, 85, 105] },
        2: { cellWidth: 16, halign: 'right' },
        3: { cellWidth: 14, halign: 'center' },
        4: { cellWidth: 28, halign: 'right' },
        5: { cellWidth: 18, halign: 'right' },
        6: { cellWidth: 20, halign: 'right', fontStyle: 'bold' },
      },
      margin: { left: 14, right: 14 },
    })

    const subY = pdf.lastAutoTable.finalY
    pdf.setFillColor(248, 250, 252)
    pdf.rect(14, subY, pageWidth - 28, 5, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(7)
    pdf.setTextColor(71, 85, 105)
    pdf.text(`Resumen cliente: ${client.kgBreakdown}  ·  ${client.totalPackages} paquetes cerrados`, 18, subY + 3.5)

    startY = subY + 7.5
  })

  // Total General
  if (startY > 250) {
    pdf.addPage('letter', 'portrait')
    drawHeader(pdf, 'COMPRAS POR CLIENTE (TOTAL GENERAL)', `Periodo: ${DEMO_PERIOD}`)
    startY = 33
  }

  pdf.setFillColor(254, 226, 226)
  pdf.roundedRect(14, startY, pageWidth - 28, 9, 2, 2, 'F')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.setTextColor(185, 28, 28)
  pdf.text('TOTAL GENERAL DEL PERIODO:', 18, startY + 6)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(7.5)
  pdf.text(
    `${round2(GRAND_TOTAL_EQUIV_KG)} kg equivalentes (${round2(GRAND_TOTAL_EXACT_KG)} kg exactos + ${round2(GRAND_TOTAL_EST_KG)} kg est.) · ${GRAND_TOTAL_PACKAGES} paquetes`,
    78,
    startY + 6,
  )
  pdf.setFontSize(8.5)
  pdf.text(formatBs(GRAND_TOTAL_BS), pageWidth - 42, startY + 6)

  drawFooter(pdf)
  fs.writeFileSync(path.join(OUTPUT_DIR, '02-compras-por-cliente.pdf'), Buffer.from(pdf.output('arraybuffer')))

  // Excel Multi-sheet
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Embutidos San José'

  // Hoja 1: Resumen
  const ws1 = wb.addWorksheet('Compras - Resumen', { views: [{ state: 'frozen', xSplit: 0, ySplit: 4 }] })
  ws1.mergeCells(1, 1, 1, 9)
  ws1.getCell(1, 1).value = 'EMBUTIDOS SAN JOSÉ  ·  RESUMEN DE COMPRAS POR CLIENTE'
  ws1.getCell(1, 1).font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
  ws1.getCell(1, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC8102E' } }
  ws1.getCell(1, 1).alignment = { vertical: 'middle', horizontal: 'center' }

  ws1.mergeCells(2, 1, 2, 9)
  ws1.getCell(2, 1).value = 'RANKING CONSOLIDADO DE COMPRAS POR CLIENTE'
  ws1.getCell(2, 1).font = { name: 'Segoe UI', size: 12, bold: true, color: { argb: 'FF1E293B' } }

  ws1.mergeCells(3, 1, 3, 9)
  ws1.getCell(3, 1).value = `Periodo: ${DEMO_PERIOD}  ·  Distinción de kg exactos y estimados`
  ws1.getCell(3, 1).font = { name: 'Segoe UI', size: 8.5, color: { argb: 'FF64748B' } }

  const h1 = ['Cliente', 'CI / Código', 'Ruta', 'Pedidos', 'Total (Bs)', 'Kg exactos', 'Kg estimados', 'Kg equivalentes', 'Paquetes']
  ws1.getRow(4).values = h1
  ws1.getRow(4).eachCell((c) => {
    c.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } }
  })

  DEMO_CLIENTS.forEach((c) => {
    ws1.addRow([c.customerName, c.customerCode, c.routeId, c.purchasesCount, c.totalBs, c.exactKg, c.estimatedKg, c.totalEquivalentKg, c.totalPackages])
  })
  ws1.addRow(['TOTAL', '', '', DEMO_CLIENTS.reduce((s, c) => s + c.purchasesCount, 0), GRAND_TOTAL_BS, GRAND_TOTAL_EXACT_KG, GRAND_TOTAL_EST_KG, GRAND_TOTAL_EQUIV_KG, GRAND_TOTAL_PACKAGES])

  // Hoja 2: Detalle
  const ws2 = wb.addWorksheet('Compras - Detalle', { views: [{ state: 'frozen', xSplit: 0, ySplit: 4 }] })
  ws2.mergeCells(1, 1, 1, 11)
  ws2.getCell(1, 1).value = 'EMBUTIDOS SAN JOSÉ  ·  DETALLE DE COMPRAS POR PRODUCTO Y CLIENTE'
  ws2.getCell(1, 1).font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
  ws2.getCell(1, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC8102E' } }
  ws2.getCell(1, 1).alignment = { vertical: 'middle', horizontal: 'center' }

  ws2.mergeCells(2, 1, 2, 11)
  ws2.getCell(2, 1).value = 'DESGLOSE DE LÍNEAS DE VENTA POR CLIENTE'
  ws2.getCell(2, 1).font = { name: 'Segoe UI', size: 12, bold: true, color: { argb: 'FF1E293B' } }

  ws2.mergeCells(3, 1, 3, 11)
  ws2.getCell(3, 1).value = `Periodo: ${DEMO_PERIOD}`
  ws2.getCell(3, 1).font = { name: 'Segoe UI', size: 8.5, color: { argb: 'FF64748B' } }

  const h2 = ['Cliente', 'CI / Código', 'Producto', 'Presentación', 'Cantidad', 'Unidad', 'Kg exactos', 'Kg estimados', 'Kg equivalentes', 'Precio unitario (Bs)', 'Subtotal (Bs)']
  ws2.getRow(4).values = h2
  ws2.getRow(4).eachCell((c) => {
    c.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } }
  })

  DEMO_CLIENTS.forEach((c) => {
    c.products.forEach((p) => {
      ws2.addRow([
        c.customerName,
        c.customerCode,
        p.productName,
        p.presentation,
        p.quantity,
        p.unitType === 'kg' ? 'Kg' : 'Paquete',
        p.exactKg > 0 ? p.exactKg : 0,
        p.estimatedKg > 0 ? p.estimatedKg : 0,
        p.totalEquivalentKg,
        p.unitPrice,
        p.totalBs,
      ])
    })
  })
  ws2.addRow(['TOTAL', '', '', '', '', '', GRAND_TOTAL_EXACT_KG, GRAND_TOTAL_EST_KG, GRAND_TOTAL_EQUIV_KG, '', GRAND_TOTAL_BS])

  // Formatear ambas hojas
  ;[ws1, ws2].forEach((ws) => {
    for (let r = 5; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      const isTotal = String(row.getCell(1).value).toUpperCase().includes('TOTAL')
      if (isTotal) {
        row.font = { name: 'Segoe UI', size: 9.5, bold: true }
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDECEE' } }
      }
      row.eachCell((cell) => {
        if (typeof cell.value === 'number') {
          cell.numFmt = '#,##0.00'
        }
      })
    }
    for (let c = 1; c <= ws.columnCount; c++) {
      let max = 10
      for (let r = 4; r <= ws.rowCount; r++) {
        const val = ws.getCell(r, c).value
        if (val) max = Math.max(max, String(val).length)
      }
      ws.getColumn(c).width = Math.min(max + 3, 35)
    }
  })

  await wb.xlsx.writeFile(path.join(OUTPUT_DIR, '02-compras-por-cliente.xlsx'))
}

// --------------------------------------------------------------------------
// 3. KARDEX DE VENTAS (PDF & XLSX)
// --------------------------------------------------------------------------
async function generateKardexVentas() {
  const pdf = new jsPDF({ orientation: 'portrait', format: 'letter' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  drawHeader(pdf, 'KARDEX DETALLADO DE VENTAS POR PRODUCTO', `Periodo: ${DEMO_PERIOD}  ·  Agrupado por producto con presentación comercial`)

  const KARDEX_GROUPS = [
    {
      productName: 'Chorizo Parrillero Crudo',
      presentation: 'Paquete al vacío de 500 g',
      unit: 'Kg',
      totalQty: 140.0,
      totalBs: 7980.00,
      lines: [
        ['02/10/2026', '09:15', 'VT-0042', 'Supermercado Doña Julia', 'Zona Norte', 35.0, 57.00, 1995.00],
        ['03/10/2026', '11:30', 'VT-0048', 'Frialsur Los Andes', 'Sacaba', 50.0, 57.00, 2850.00],
        ['04/10/2026', '14:10', 'VT-0055', 'Supermercado Doña Julia', 'Zona Norte', 35.0, 57.00, 1995.00],
        ['05/10/2026', '10:20', 'VT-0062', 'Almacén Don Pedro', 'Zona Sud', 20.0, 57.00, 1140.00],
      ],
    },
    {
      productName: 'Salchicha tipo Viena',
      presentation: 'Granel',
      unit: 'Kg',
      totalQty: 148.5,
      totalBs: 7128.00,
      lines: [
        ['01/10/2026', '08:45', 'VT-0038', 'Supermercado Doña Julia', 'Zona Norte', 40.0, 48.00, 1920.00],
        ['02/10/2026', '10:00', 'VT-0043', 'Almacén Don Pedro', 'Zona Sud', 30.0, 48.00, 1440.00],
        ['04/10/2026', '09:30', 'VT-0053', 'Supermercado Doña Julia', 'Zona Norte', 40.0, 48.00, 1920.00],
        ['05/10/2026', '15:40', 'VT-0066', 'Almacén Don Pedro', 'Zona Sud', 30.0, 48.00, 1440.00],
        ['06/10/2026', '11:15', 'VT-0071', 'Frialsur Los Andes', 'Sacaba', 8.5, 48.00, 408.00],
      ],
    },
    {
      productName: 'Mortadela Jamonada',
      presentation: 'Sachet de 200 g',
      unit: 'Paquete',
      totalQty: 82,
      totalBs: 984.00,
      lines: [
        ['02/10/2026', '09:20', 'VT-0042', 'Supermercado Doña Julia', 'Zona Norte', 20, 12.00, 240.00],
        ['03/10/2026', '11:35', 'VT-0048', 'Frialsur Los Andes', 'Sacaba', 25, 12.00, 300.00],
        ['04/10/2026', '14:15', 'VT-0055', 'Supermercado Doña Julia', 'Zona Norte', 22, 12.00, 264.00],
        ['05/10/2026', '10:25', 'VT-0062', 'Almacén Don Pedro', 'Zona Sud', 15, 12.00, 180.00],
      ],
    },
  ]

  let startY = 33

  for (const group of KARDEX_GROUPS) {
    if (startY > 230) {
      pdf.addPage('letter', 'portrait')
      drawHeader(pdf, 'KARDEX DETALLADO DE VENTAS (CONTINUACIÓN)', `Periodo: ${DEMO_PERIOD}`)
      startY = 33
    }

    pdf.setFillColor(241, 245, 249)
    pdf.rect(14, startY, pageWidth - 28, 7.5, 'F')

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(9)
    pdf.setTextColor(30, 41, 59)
    pdf.text(group.productName.toUpperCase(), 18, startY + 5)

    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7.5)
    pdf.setTextColor(100, 116, 139)
    pdf.text(`(${group.presentation})`, 80, startY + 5)

    pdf.setFont('helvetica', 'bold')
    pdf.setTextColor(200, 16, 46)
    pdf.text(`Total: ${group.totalQty} ${group.unit} · ${formatBs(group.totalBs)}`, pageWidth - 65, startY + 5)

    autoTable(pdf, {
      startY: startY + 8.5,
      head: [['Fecha', 'Hora', 'N° Recibo', 'Cliente', 'Ruta', 'Cantidad', 'Precio (Bs)', 'Subtotal (Bs)']],
      body: group.lines.map((l) => [
        l[0],
        l[1],
        l[2],
        l[3],
        l[4],
        round2(l[5]),
        formatBs(l[6]),
        formatBs(l[7]),
      ]),
      theme: 'grid',
      headStyles: { fillColor: [51, 65, 85], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7, cellPadding: 2 },
      bodyStyles: { fontSize: 7, cellPadding: 2, textColor: [30, 41, 59] },
      columnStyles: {
        0: { cellWidth: 18 },
        1: { cellWidth: 14 },
        2: { cellWidth: 26, fontStyle: 'bold' },
        3: { cellWidth: 42 },
        4: { cellWidth: 20 },
        5: { cellWidth: 16, halign: 'right' },
        6: { cellWidth: 18, halign: 'right' },
        7: { cellWidth: 20, halign: 'right', fontStyle: 'bold' },
      },
      margin: { left: 14, right: 14 },
    })

    startY = pdf.lastAutoTable.finalY + 6
  }

  drawFooter(pdf)
  fs.writeFileSync(path.join(OUTPUT_DIR, '03-kardex-de-ventas.pdf'), Buffer.from(pdf.output('arraybuffer')))

  // Excel
  const allKardexRows = KARDEX_GROUPS.flatMap((g) =>
    g.lines.map((l) => [l[0] + ' ' + l[1], g.productName, g.presentation, l[3], 'Hugo Herbas', l[4], l[5], g.unit, l[6], l[7], l[2]]),
  )
  const totalKardexBs = round2(KARDEX_GROUPS.reduce((s, g) => s + g.totalBs, 0))
  allKardexRows.push(['TOTAL', '', '', '', '', '', '', '', '', totalKardexBs, ''])

  const wb = createStyledWorkbook(
    'Kardex de Ventas por Producto',
    'Kardex de ventas',
    ['Fecha y hora', 'Producto', 'Presentación', 'Cliente', 'Vendedor', 'Ruta', 'Cantidad', 'Unidad', 'Precio (Bs)', 'Importe (Bs)', 'Comprobante'],
    allKardexRows,
  )
  await wb.xlsx.writeFile(path.join(OUTPUT_DIR, '03-kardex-de-ventas.xlsx'))
}

// --------------------------------------------------------------------------
// 4. EXISTENCIAS ACTUALES (PDF & XLSX MULTI-SHEET)
// --------------------------------------------------------------------------
async function generateExistenciasActuales() {
  const pdf = new jsPDF({ orientation: 'portrait', format: 'letter' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  drawHeader(pdf, 'EXISTENCIAS ACTUALES DE INVENTARIO Y LOTES', `Emitido: ${currentGenerationTimestamp()}  ·  Almacén: Almacén Central`)

  const stockRows = [
    ['Almacén Central', 'Chorizo Parrillero Crudo', 'Paquete al vacío de 500 g', 85.0, 75.0, 10.0, 'Kg', 'Normal'],
    ['Almacén Central', 'Salchicha tipo Viena', 'Granel', 120.0, 120.0, 0.0, 'Kg', 'Normal'],
    ['Almacén Central', 'Jamón de Cerdo', 'Granel', 45.0, 40.0, 5.0, 'Kg', 'Normal'],
    ['Almacén Central', 'Mortadela Jamonada', 'Sachet de 200 g', 95, 95, 0, 'Paquete', 'Normal'],
    ['Almacén Central', 'Salchicha Frankfurt', 'Paquete de 1 kg', 8.0, 8.0, 0.0, 'Kg', 'Stock bajo'],
  ]

  const lotRows = [
    ['Almacén Central', 'Chorizo Parrillero Crudo', 'Paquete al vacío de 500 g', 'L-261001-A', '01/10/2026', '25/10/2026', '19 días', 40.0, 'Kg', 'Disponible'],
    ['Almacén Central', 'Chorizo Parrillero Crudo', 'Paquete al vacío de 500 g', 'L-261002-A', '02/10/2026', '26/10/2026', '20 días', 35.0, 'Kg', 'Disponible'],
    ['Almacén Central', 'Chorizo Parrillero Crudo', 'Paquete al vacío de 500 g', 'L-260920-X', '20/09/2026', '10/10/2026', '4 días', 10.0, 'Kg', 'Próximo a vencer'],
    ['Almacén Central', 'Salchicha tipo Viena', 'Granel', 'L-261003-B', '03/10/2026', '15/10/2026', '9 días', 120.0, 'Kg', 'Disponible'],
    ['Almacén Central', 'Jamón de Cerdo', 'Granel', 'L-260925-J', '25/09/2026', '04/10/2026', 'Vencido', 5.0, 'Kg', 'Vencido'],
    ['Almacén Central', 'Mortadela Jamonada', 'Sachet de 200 g', 'L-260928-M', '28/09/2026', '10/11/2026', '35 días', 95, 'Paquete', 'Disponible'],
  ]

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.setTextColor(30, 41, 59)
  pdf.text('1. Resumen de Existencias Físicas y Disponibles', 14, 34)

  autoTable(pdf, {
    startY: 37,
    head: [['Almacén', 'Producto', 'Presentación', 'Físico', 'Disponible', 'Reservado', 'Unidad', 'Estado']],
    body: stockRows.map((r) => [r[0], r[1], r[2], round2(r[3]), round2(r[4]), round2(r[5]), r[6], r[7]]),
    theme: 'grid',
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
    bodyStyles: { fontSize: 7, cellPadding: 2 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14 },
  })

  let lotStartY = pdf.lastAutoTable.finalY + 8
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.setTextColor(30, 41, 59)
  pdf.text('2. Desglose de Lotes Registrados y Estado de Vencimiento', 14, lotStartY)

  autoTable(pdf, {
    startY: lotStartY + 4,
    head: [['Almacén', 'Producto', 'Presentación', 'Lote', 'Elaboración', 'Vencimiento', 'Días', 'Cantidad', 'Unidad', 'Estado']],
    body: lotRows.map((r) => [r[0], r[1], r[2], r[3], r[4], r[5], r[6], round2(r[7]), r[8], r[9]]),
    theme: 'grid',
    headStyles: { fillColor: [71, 85, 105], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 34, fontStyle: 'bold' },
      2: { cellWidth: 32 },
      3: { cellWidth: 18 },
      4: { cellWidth: 16 },
      5: { cellWidth: 16 },
      6: { cellWidth: 12 },
      7: { cellWidth: 14, halign: 'right' },
      8: { cellWidth: 10, halign: 'center' },
      9: { cellWidth: 13, halign: 'center' },
    },
    didParseCell: (hook) => {
      if (hook.section === 'body' && hook.column.index === 9) {
        const val = String(hook.cell.raw)
        if (val.includes('Vencido')) {
          hook.cell.styles.textColor = [185, 28, 28]
          hook.cell.styles.fontStyle = 'bold'
        } else if (val.includes('vencer')) {
          hook.cell.styles.textColor = [180, 83, 9]
          hook.cell.styles.fontStyle = 'bold'
        } else if (val.includes('Disponible')) {
          hook.cell.styles.textColor = [21, 128, 61]
        }
      }
    },
    margin: { left: 14, right: 14 },
  })

  drawFooter(pdf)
  fs.writeFileSync(path.join(OUTPUT_DIR, '04-existencias-actuales.pdf'), Buffer.from(pdf.output('arraybuffer')))

  // Excel Multi-sheet
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Embutidos San José'

  // Hoja 1: Existencias actuales
  const ws1 = wb.addWorksheet('Existencias actuales', { views: [{ state: 'frozen', xSplit: 0, ySplit: 4 }] })
  ws1.mergeCells(1, 1, 1, 8)
  ws1.getCell(1, 1).value = 'EMBUTIDOS SAN JOSÉ  ·  EXISTENCIAS ACTUALES'
  ws1.getCell(1, 1).font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
  ws1.getCell(1, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC8102E' } }
  ws1.getCell(1, 1).alignment = { vertical: 'middle', horizontal: 'center' }

  ws1.mergeCells(2, 1, 2, 8)
  ws1.getCell(2, 1).value = 'RESUMEN DE STOCK FÍSICO Y DISPONIBLE'
  ws1.getCell(2, 1).font = { name: 'Segoe UI', size: 12, bold: true, color: { argb: 'FF1E293B' } }

  ws1.mergeCells(3, 1, 3, 8)
  ws1.getCell(3, 1).value = `Emitido: ${currentGenerationTimestamp()}  ·  Almacén: Central`
  ws1.getCell(3, 1).font = { name: 'Segoe UI', size: 8.5, color: { argb: 'FF64748B' } }

  const h1 = ['Almacén', 'Producto', 'Presentación', 'Existencia física', 'Disponible', 'No disponible', 'Unidad', 'Estado']
  ws1.getRow(4).values = h1
  ws1.getRow(4).eachCell((c) => {
    c.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } }
  })
  stockRows.forEach((r) => ws1.addRow(r))

  // Hoja 2: Lotes
  const ws2 = wb.addWorksheet('Lotes por almacén', { views: [{ state: 'frozen', xSplit: 0, ySplit: 4 }] })
  ws2.mergeCells(1, 1, 1, 10)
  ws2.getCell(1, 1).value = 'EMBUTIDOS SAN JOSÉ  ·  LOTES POR ALMACÉN'
  ws2.getCell(1, 1).font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
  ws2.getCell(1, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC8102E' } }
  ws2.getCell(1, 1).alignment = { vertical: 'middle', horizontal: 'center' }

  ws2.mergeCells(2, 1, 2, 10)
  ws2.getCell(2, 1).value = 'DESGLOSE DE LOTES Y ESTADO DE VENCIMIENTO'
  ws2.getCell(2, 1).font = { name: 'Segoe UI', size: 12, bold: true, color: { argb: 'FF1E293B' } }

  ws2.mergeCells(3, 1, 3, 10)
  ws2.getCell(3, 1).value = `Emitido: ${currentGenerationTimestamp()}`
  ws2.getCell(3, 1).font = { name: 'Segoe UI', size: 8.5, color: { argb: 'FF64748B' } }

  const h2 = ['Almacén', 'Producto', 'Presentación', 'Lote', 'Elaboración', 'Vencimiento', 'Días restantes', 'Cantidad', 'Unidad', 'Estado']
  ws2.getRow(4).values = h2
  ws2.getRow(4).eachCell((c) => {
    c.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } }
  })
  lotRows.forEach((r) => ws2.addRow(r))

  ;[ws1, ws2].forEach((ws) => {
    for (let r = 5; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      row.eachCell((cell) => {
        if (typeof cell.value === 'number') {
          cell.numFmt = '#,##0.00'
        }
      })
    }
    for (let c = 1; c <= ws.columnCount; c++) {
      let max = 10
      for (let r = 4; r <= ws.rowCount; r++) {
        const val = ws.getCell(r, c).value
        if (val) max = Math.max(max, String(val).length)
      }
      ws.getColumn(c).width = Math.min(max + 3, 35)
    }
  })

  await wb.xlsx.writeFile(path.join(OUTPUT_DIR, '04-existencias-actuales.xlsx'))
}

// --------------------------------------------------------------------------
// 5. MOVIMIENTOS DE INVENTARIO (PDF & XLSX)
// --------------------------------------------------------------------------
async function generateMovimientosInventario() {
  const pdf = new jsPDF({ orientation: 'portrait', format: 'letter' })
  drawHeader(pdf, 'HISTORIAL DE MOVIMIENTOS DE INVENTARIO', `Periodo: ${DEMO_PERIOD}  ·  Almacén Central`)

  const movRows = [
    ['01/10/2026 06:15', 'Despacho a ruta', 'Chorizo Parrillero Crudo', 'L-261001-A', 'Zona Norte', 'Hugo Herbas', -50.0, 'Kg'],
    ['01/10/2026 06:20', 'Despacho a ruta', 'Salchicha tipo Viena', 'L-261003-B', 'Zona Norte', 'Hugo Herbas', -60.0, 'Kg'],
    ['01/10/2026 10:15', 'Aumento de despacho', 'Chorizo Parrillero Crudo', 'L-261001-A', 'Zona Norte', 'Roberto Gómez', -25.0, 'Kg'],
    ['01/10/2026 18:30', 'Retorno de ruta', 'Salchicha tipo Viena', 'L-261003-B', 'Zona Norte', 'Roberto Gómez', 20.0, 'Kg'],
    ['02/10/2026 07:00', 'Ingreso de producción', 'Chorizo Parrillero Crudo', 'L-261002-A', 'Planta', 'Administración', 100.0, 'Kg'],
    ['03/10/2026 09:30', 'Baja o merma', 'Jamón de Cerdo', 'L-260925-J', 'Almacén Central', 'Administración', -5.0, 'Kg'],
  ]

  autoTable(pdf, {
    startY: 33,
    head: [['Fecha y hora', 'Tipo de movimiento', 'Producto', 'Lote', 'Destino / Origen', 'Responsable', 'Variación', 'Unidad']],
    body: movRows.map((r) => [r[0], r[1], r[2], r[3], r[4], r[5], round2(r[6]), r[7]]),
    theme: 'grid',
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
    bodyStyles: { fontSize: 7, cellPadding: 2 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14 },
  })

  drawFooter(pdf)
  fs.writeFileSync(path.join(OUTPUT_DIR, '05-movimientos-inventario.pdf'), Buffer.from(pdf.output('arraybuffer')))

  const wb = createStyledWorkbook(
    'Movimientos de Inventario',
    'Movimientos',
    ['Fecha y hora', 'Tipo de movimiento', 'Producto', 'Lote', 'Destino / Origen', 'Responsable', 'Variación', 'Unidad'],
    movRows,
  )
  await wb.xlsx.writeFile(path.join(OUTPUT_DIR, '05-movimientos-inventario.xlsx'))
}

// --------------------------------------------------------------------------
// 6. FLUJO DE CAJA (PDF & XLSX)
// --------------------------------------------------------------------------
async function generateFlujoDeCaja() {
  const pdf = new jsPDF({ orientation: 'portrait', format: 'letter' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  drawHeader(pdf, 'MOVIMIENTO DE EFECTIVO Y FLUJO DE CAJA', `Periodo: ${DEMO_PERIOD}`)

  const netFlow = 15420.00

  // Net Cash Flow KPI Box
  pdf.setFillColor(248, 250, 252)
  pdf.setDrawColor(30, 41, 59)
  pdf.setLineWidth(1)
  pdf.roundedRect(14, 33, pageWidth - 28, 22, 2, 2, 'FD')

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(8.5)
  pdf.setTextColor(100, 116, 139)
  pdf.text('FLUJO NETO DE CAJA DEL PERIODO', 20, 41)

  pdf.setFontSize(16)
  pdf.setTextColor(21, 128, 61)
  pdf.text(formatBs(netFlow), 20, 50)

  const cashRows = [
    ['Ventas al contado', 12340.00, 2000.00, 14340.00],
    ['Cobranzas de créditos', 2500.00, 700.00, 3200.00],
    ['(-) Gastos de ruta validados', -1420.00, 0.00, -1420.00],
    ['(=) TOTAL FLUJO NETO', 13420.00, 2700.00, 16120.00],
  ]

  autoTable(pdf, {
    startY: 59,
    head: [['Concepto de caja', 'Efectivo físico (Bs)', 'Transferencias QR (Bs)', 'Total recaudado (Bs)']],
    body: cashRows.map((r) => [r[0], formatBs(r[1]), formatBs(r[2]), formatBs(r[3])]),
    theme: 'grid',
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    bodyStyles: { fontSize: 8, cellPadding: 2.8 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { fontStyle: 'bold' },
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right', fontStyle: 'bold' },
    },
    didParseCell: (hook) => {
      if (hook.row.index === 3) {
        hook.cell.styles.fillColor = [254, 243, 199]
        hook.cell.styles.fontStyle = 'bold'
      }
    },
    margin: { left: 14, right: 14 },
  })

  drawFooter(pdf)
  fs.writeFileSync(path.join(OUTPUT_DIR, '06-flujo-de-caja.pdf'), Buffer.from(pdf.output('arraybuffer')))

  const wb = createStyledWorkbook(
    'Flujo de Caja y Movimiento de Efectivo',
    'Flujo de caja',
    ['Concepto', 'Efectivo físico (Bs)', 'Transferencias QR (Bs)', 'Total recaudado (Bs)'],
    cashRows,
  )
  await wb.xlsx.writeFile(path.join(OUTPUT_DIR, '06-flujo-de-caja.xlsx'))
}

// --------------------------------------------------------------------------
// 7. CARTERA DE CRÉDITOS (PDF & XLSX)
// --------------------------------------------------------------------------
async function generateCarteraCreditos() {
  const pdf = new jsPDF({ orientation: 'portrait', format: 'letter' })
  drawHeader(pdf, 'CARTERA DE CRÉDITOS Y COBRANZAS', `Periodo: ${DEMO_PERIOD}`)

  const creditRows = [
    ['Supermercado Doña Julia', '4892019', 'Zona Norte', 1200.00, 3990.00, 2500.00, 0.00, 2690.00],
    ['Frialsur Los Andes', '3019284', 'Sacaba', 800.00, 2850.00, 1500.00, 120.00, 2030.00],
    ['Almacén Don Pedro', '7721890', 'Zona Sud', 0.00, 1140.00, 600.00, 0.00, 540.00],
    ['TOTAL', '', '', 2000.00, 7980.00, 4600.00, 120.00, 5260.00],
  ]

  autoTable(pdf, {
    startY: 33,
    head: [['Cliente', 'CI', 'Ruta', 'Saldo inicial', 'Nuevos créditos', 'Cobros', 'Ajustes', 'Saldo actual']],
    body: creditRows.map((r, i) => [
      r[0],
      r[1],
      r[2],
      formatBs(r[3]),
      formatBs(r[4]),
      formatBs(r[5]),
      formatBs(r[6]),
      formatBs(r[7]),
    ]),
    theme: 'grid',
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
    bodyStyles: { fontSize: 7, cellPadding: 2 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    didParseCell: (hook) => {
      if (hook.row.index === creditRows.length - 1) {
        hook.cell.styles.fontStyle = 'bold'
        hook.cell.styles.fillColor = [253, 236, 238]
      }
    },
    margin: { left: 14, right: 14 },
  })

  drawFooter(pdf)
  fs.writeFileSync(path.join(OUTPUT_DIR, '07-cartera-de-creditos.pdf'), Buffer.from(pdf.output('arraybuffer')))

  const wb = createStyledWorkbook(
    'Cartera de Créditos',
    'Créditos',
    ['Cliente', 'CI', 'Ruta', 'Saldo inicial (Bs)', 'Nuevos créditos (Bs)', 'Cobros (Bs)', 'Ajustes (Bs)', 'Saldo actual (Bs)'],
    creditRows,
  )
  await wb.xlsx.writeFile(path.join(OUTPUT_DIR, '07-cartera-de-creditos.xlsx'))
}

// --------------------------------------------------------------------------
// 8. MOCKUPS HTML RESPONSIVOS INTERACTIVOS
// --------------------------------------------------------------------------
function generateHtmlMockups() {
  // Mockup Cierre Compacto
  const closureHtml = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mockup Cierre de Ruta Compacto - v1.4.8</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-100 p-4 font-sans text-slate-800">
  <div class="max-w-md mx-auto">
    <header class="mb-4">
      <div class="inline-block px-2.5 py-0.5 rounded-full text-xs font-black bg-rose-100 text-rose-800 uppercase tracking-wider mb-1">
        Diseño validado v1.4.8
      </div>
      <h1 class="text-xl font-black text-slate-900">Tarjetas Compactas de Cierre</h1>
      <p class="text-xs text-slate-500 mt-0.5">Demostración responsive en móvil: 3 productos visibles en un viewport estándar de 667-844px.</p>
    </header>

    <div class="space-y-2.5">
      <!-- Producto 1 -->
      <div class="rounded-xl border border-slate-200 bg-white p-2.5 shadow-xs">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-baseline gap-x-1.5">
              <span class="line-clamp-2 text-xs font-black leading-snug text-slate-900">Chorizo Parrillero Crudo</span>
              <span class="line-clamp-1 text-[10px] font-semibold text-slate-500">(Paquete al vacío de 500 g)</span>
            </div>
          </div>
          <span class="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[9px] font-black text-emerald-700">
            CUADRADO
          </span>
        </div>
        <div class="mt-1.5 flex items-center justify-between rounded-lg bg-slate-50 px-2 py-1 text-[10px] text-slate-600 border border-slate-100">
          <div><span class="text-[9px] text-slate-400">Env: </span><span class="font-bold text-slate-700">50 kg</span></div>
          <span class="text-slate-300">·</span>
          <div><span class="text-[9px] text-slate-400">Aum: </span><span class="font-bold text-slate-700">25 kg</span></div>
          <span class="text-slate-300">·</span>
          <div><span class="text-[9px] text-slate-400">Ven: </span><span class="font-bold text-slate-700">60 kg</span></div>
          <span class="text-slate-300">·</span>
          <div><span class="text-[9px] text-slate-400 font-semibold">Debe volver: </span><span class="font-black text-indigo-700">15 kg</span></div>
        </div>
        <div class="mt-2 flex items-center justify-between gap-1.5 pt-1.5 border-t border-slate-100">
          <div class="flex items-center gap-1 shrink-0">
            <span class="text-[10px] font-bold uppercase tracking-wider text-slate-500 mr-0.5">Retorno:</span>
            <button class="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-100">0</button>
            <button class="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-100">Todo (15)</button>
          </div>
          <div class="w-24 shrink-0">
            <input type="number" value="15" class="w-full rounded-xl border-2 border-slate-300 px-2.5 py-1 text-right text-xs font-black text-slate-900 focus:border-red-600 focus:outline-none" />
          </div>
        </div>
      </div>

      <!-- Producto 2 -->
      <div class="rounded-xl border border-slate-200 bg-white p-2.5 shadow-xs">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-baseline gap-x-1.5">
              <span class="line-clamp-2 text-xs font-black leading-snug text-slate-900">Salchicha tipo Viena</span>
              <span class="line-clamp-1 text-[10px] font-semibold text-slate-500">(Granel)</span>
            </div>
          </div>
          <span class="shrink-0 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[9px] font-black text-rose-700">
            FALTANTE 2 kg
          </span>
        </div>
        <div class="mt-1.5 flex items-center justify-between rounded-lg bg-slate-50 px-2 py-1 text-[10px] text-slate-600 border border-slate-100">
          <div><span class="text-[9px] text-slate-400">Env: </span><span class="font-bold text-slate-700">60 kg</span></div>
          <span class="text-slate-300">·</span>
          <div><span class="text-[9px] text-slate-400">Aum: </span><span class="font-bold text-slate-700">0 kg</span></div>
          <span class="text-slate-300">·</span>
          <div><span class="text-[9px] text-slate-400">Ven: </span><span class="font-bold text-slate-700">40 kg</span></div>
          <span class="text-slate-300">·</span>
          <div><span class="text-[9px] text-slate-400 font-semibold">Debe volver: </span><span class="font-black text-indigo-700">20 kg</span></div>
        </div>
        <div class="mt-2 flex items-center justify-between gap-1.5 pt-1.5 border-t border-slate-100">
          <div class="flex items-center gap-1 shrink-0">
            <span class="text-[10px] font-bold uppercase tracking-wider text-slate-500 mr-0.5">Retorno:</span>
            <button class="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-100">0</button>
            <button class="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-100">Todo (20)</button>
          </div>
          <div class="w-24 shrink-0">
            <input type="number" value="18" class="w-full rounded-xl border-2 border-slate-300 px-2.5 py-1 text-right text-xs font-black text-slate-900 focus:border-red-600 focus:outline-none" />
          </div>
        </div>
      </div>

      <!-- Producto 3 -->
      <div class="rounded-xl border border-slate-200 bg-white p-2.5 shadow-xs">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-baseline gap-x-1.5">
              <span class="line-clamp-2 text-xs font-black leading-snug text-slate-900">Mortadela Jamonada</span>
              <span class="line-clamp-1 text-[10px] font-semibold text-slate-500">(Sachet de 200 g)</span>
            </div>
          </div>
          <span class="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[9px] font-black text-slate-500">
            SIN DECLARAR
          </span>
        </div>
        <div class="mt-1.5 flex items-center justify-between rounded-lg bg-slate-50 px-2 py-1 text-[10px] text-slate-600 border border-slate-100">
          <div><span class="text-[9px] text-slate-400">Env: </span><span class="font-bold text-slate-700">35 paq</span></div>
          <span class="text-slate-300">·</span>
          <div><span class="text-[9px] text-slate-400">Aum: </span><span class="font-bold text-slate-700">15 paq</span></div>
          <span class="text-slate-300">·</span>
          <div><span class="text-[9px] text-slate-400">Ven: </span><span class="font-bold text-slate-700">30 paq</span></div>
          <span class="text-slate-300">·</span>
          <div><span class="text-[9px] text-slate-400 font-semibold">Debe volver: </span><span class="font-black text-indigo-700">20 paq</span></div>
        </div>
        <div class="mt-2 flex items-center justify-between gap-1.5 pt-1.5 border-t border-slate-100">
          <div class="flex items-center gap-1 shrink-0">
            <span class="text-[10px] font-bold uppercase tracking-wider text-slate-500 mr-0.5">Retorno:</span>
            <button class="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-100">0</button>
            <button class="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-100">Todo (20)</button>
          </div>
          <div class="w-24 shrink-0">
            <input type="number" placeholder="0" class="w-full rounded-xl border-2 border-slate-300 px-2.5 py-1 text-right text-xs font-black text-slate-900 focus:border-red-600 focus:outline-none" />
          </div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`
  fs.writeFileSync(path.join(OUTPUT_DIR, 'mockup-cierre-compacto.html'), closureHtml)

  // Mockup Alertas Inventario
  const alertsHtml = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mockup Alertas Compactas - v1.4.8</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-100 p-4 font-sans text-slate-800">
  <div class="max-w-md mx-auto space-y-4">
    <header>
      <div class="inline-block px-2.5 py-0.5 rounded-full text-xs font-black bg-rose-100 text-rose-800 uppercase tracking-wider mb-1">
        Diseño validado v1.4.8
      </div>
      <h1 class="text-xl font-black text-slate-900">Avisos de Inventario Compactos</h1>
      <p class="text-xs text-slate-500 mt-0.5">Banner horizontal con animación de pulso y modal categorizado.</p>
    </header>

    <!-- Banner compacto -->
    <button onclick="document.getElementById('modal').classList.remove('hidden')" class="w-full text-left rounded-xl border border-rose-300 bg-rose-50/90 hover:bg-rose-100/90 text-rose-950 p-3 transition shadow-xs flex items-center justify-between gap-3">
      <div class="flex items-center gap-2.5 min-w-0">
        <div class="relative flex shrink-0 items-center justify-center">
          <span class="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
            <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-600"></span>
          </span>
          <div class="p-1.5 rounded-lg bg-rose-200/80 text-rose-700">
            ⚠️
          </div>
        </div>
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-xs font-black uppercase tracking-wider">3 ALERTAS DE INVENTARIO</span>
            <span class="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-600 text-white animate-pulse">1 vencido</span>
          </div>
          <p class="text-[11px] font-semibold text-slate-600 truncate mt-0.5">
            1 vencido · 1 por vencer · 1 stock bajo
          </p>
        </div>
      </div>
      <div class="shrink-0 flex items-center gap-1 text-xs font-black text-slate-700">
        <span>Ver alertas</span>
        <span>→</span>
      </div>
    </button>

    <!-- Modal simulado -->
    <div id="modal" class="hidden fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div class="bg-white rounded-2xl max-w-sm w-full p-4 shadow-xl space-y-4">
        <div class="flex items-center justify-between border-b pb-2">
          <h2 class="text-sm font-black text-slate-900">Alertas de Inventario</h2>
          <button onclick="document.getElementById('modal').classList.add('hidden')" class="text-slate-400 hover:text-slate-600 font-black">✕</button>
        </div>

        <div class="space-y-3 max-h-[60vh] overflow-y-auto">
          <!-- Vencidos -->
          <div class="space-y-1.5">
            <span class="px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 text-[11px] font-black uppercase">Vencidos (1)</span>
            <div class="rounded-xl border border-rose-200 bg-rose-50/60 p-2 text-xs">
              <div class="flex justify-between font-black text-rose-950">
                <span>Jamón de Cerdo</span>
                <span class="text-rose-700">5 kg</span>
              </div>
              <div class="mt-1 text-[11px] text-rose-800">Lote: <strong>L-260925-J</strong> · Venció el: <strong>04/10/2026</strong></div>
            </div>
          </div>

          <!-- Próximos a vencer -->
          <div class="space-y-1.5">
            <span class="px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 text-[11px] font-black uppercase">Próximos a vencer (1)</span>
            <div class="rounded-xl border border-amber-200 bg-amber-50/60 p-2 text-xs">
              <div class="flex justify-between font-black text-amber-950">
                <span>Chorizo Parrillero Crudo</span>
                <span class="text-amber-800">10 kg</span>
              </div>
              <div class="mt-1 text-[11px] text-amber-800">Lote: <strong>L-260920-X</strong> · <strong>Vence en 4 días (10/10/2026)</strong></div>
            </div>
          </div>

          <!-- Stock bajo -->
          <div class="space-y-1.5">
            <span class="px-2 py-0.5 rounded-md bg-yellow-100 text-yellow-900 text-[11px] font-black uppercase">Stock bajo (1)</span>
            <div class="rounded-xl border border-yellow-200 bg-yellow-50/60 p-2 text-xs">
              <div class="flex justify-between font-black text-yellow-950">
                <span>Salchicha Frankfurt</span>
                <span class="text-amber-900">8 kg disp.</span>
              </div>
              <div class="mt-1 text-[11px] text-yellow-900">Central · Mínimo configurado: <strong>20 kg</strong></div>
            </div>
          </div>
        </div>

        <button onclick="document.getElementById('modal').classList.add('hidden')" class="w-full bg-slate-900 text-white rounded-xl py-2 text-xs font-black">Cerrar</button>
      </div>
    </div>
  </div>
</body>
</html>`
  fs.writeFileSync(path.join(OUTPUT_DIR, 'mockup-alertas-inventario.html'), alertsHtml)
}

async function run() {
  generateResultadoPeriodo()
  await generateComprasPorCliente()
  await generateKardexVentas()
  await generateExistenciasActuales()
  await generateMovimientosInventario()
  await generateFlujoDeCaja()
  await generateCarteraCreditos()
  generateHtmlMockups()
  console.log('Todas las muestras 1.4.8 generadas con éxito.')
}

run().catch((e) => {
  console.error('Error:', e)
  process.exit(1)
})
