import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { computeProductProfitReport } from '../src/modules/distribution/domain/productProfit.ts'

const req = createRequire(import.meta.url)
const { jsPDF } = req('jspdf')
const { default: autoTable } = req('jspdf-autotable')
const ExcelJS = req('exceljs')

const OUTPUT_DIR = path.resolve('output/review-1412')
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
}

console.log('Generando muestras oficiales 1.4.12 en:', OUTPUT_DIR)

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const formatBs = (n) =>
  `Bs ${round2(n).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// -------------------------------------------------------------
// DATOS REALISTAS DE PRODUCCIÓN PARA LA MUESTRA
// -------------------------------------------------------------
const mockSales = [
  // Día 1: 05/10/2026
  {
    id: 'sale-101',
    operationId: 'VTA-00101',
    restaurantId: 'sanjose',
    routeId: 'route-norte',
    routeName: 'Ruta Norte',
    sellerUid: 'seller-juan',
    sellerName: 'Juan Pérez',
    customerName: 'Supermercado Doña Julia',
    dayKey: '2026-10-05',
    total: 1250.0,
    paymentKind: 'CASH',
    cashAmount: 1250.0,
    qrAmount: 0,
    creditAmount: 0,
    createdAt: '2026-10-05T08:30:00Z',
    createdBy: 'seller-juan',
    lines: [
      {
        productId: 'prod-chorizo',
        productNameSnapshot: 'Chorizo Parrillero Crudo',
        presentationSnapshot: 'Paquete al vacío de 500 g',
        unitType: 'package',
        quantity: 25,
        actualUnitPrice: 30,
        subtotal: 750.0,
        costTotal: 475.0, // 19 Bs/u
      },
      {
        productId: 'prod-viena',
        productNameSnapshot: 'Salchicha tipo Viena',
        presentationSnapshot: 'Granel',
        unitType: 'kg',
        quantity: 20,
        actualUnitPrice: 25,
        subtotal: 500.0,
        costTotal: 320.0, // 16 Bs/kg
      },
    ],
  },
  {
    id: 'sale-102',
    operationId: 'VTA-00102',
    restaurantId: 'sanjose',
    routeId: 'route-sud',
    routeName: 'Ruta Sud',
    sellerUid: 'seller-carlos',
    sellerName: 'Carlos Gómez',
    customerName: 'Frialsur Los Andes',
    dayKey: '2026-10-05',
    total: 880.0,
    paymentKind: 'CREDIT',
    cashAmount: 0,
    qrAmount: 0,
    creditAmount: 880.0,
    createdAt: '2026-10-05T10:15:00Z',
    createdBy: 'seller-carlos',
    lines: [
      {
        productId: 'prod-mortadela',
        productNameSnapshot: 'Mortadela Familiar',
        presentationSnapshot: 'Pieza 1 kg',
        unitType: 'kg',
        quantity: 22,
        actualUnitPrice: 40,
        subtotal: 880.0,
        costTotal: 550.0, // 25 Bs/kg
      },
    ],
  },

  // Día 2: 06/10/2026
  {
    id: 'sale-103',
    operationId: 'VTA-00103',
    restaurantId: 'sanjose',
    routeId: 'route-norte',
    routeName: 'Ruta Norte',
    sellerUid: 'seller-juan',
    sellerName: 'Juan Pérez',
    customerName: 'Almacén Don Pedro',
    dayKey: '2026-10-06',
    total: 1120.0,
    paymentKind: 'CASH',
    cashAmount: 1120.0,
    qrAmount: 0,
    creditAmount: 0,
    createdAt: '2026-10-06T09:00:00Z',
    createdBy: 'seller-juan',
    lines: [
      {
        productId: 'prod-salame',
        productNameSnapshot: 'Salame Milano Seleccionado',
        presentationSnapshot: 'Pieza 500 g',
        unitType: 'package',
        quantity: 16,
        actualUnitPrice: 45,
        subtotal: 720.0,
        costTotal: 432.0, // 27 Bs/u
      },
      {
        productId: 'prod-chorizo',
        productNameSnapshot: 'Chorizo Parrillero Crudo',
        presentationSnapshot: 'Paquete al vacío de 500 g',
        unitType: 'package',
        quantity: 10,
        actualUnitPrice: 30,
        subtotal: 300.0,
        costTotal: 190.0,
      },
      {
        productId: 'prod-tocino',
        productNameSnapshot: 'Tocino Ahumado Especial',
        presentationSnapshot: 'Empaque al vacío 250 g',
        unitType: 'package',
        quantity: 2,
        actualUnitPrice: 50,
        subtotal: 100.0,
        costTotal: 62.0,
      },
    ],
  },
  // Venta corregida con reducción auditada (ej: 15 a 12 kg de mortadela)
  {
    id: 'sale-104',
    operationId: 'VTA-00104',
    restaurantId: 'sanjose',
    routeId: 'route-sud',
    routeName: 'Ruta Sud',
    sellerUid: 'seller-carlos',
    sellerName: 'Carlos Gómez',
    customerName: 'Micromercado San Antonio',
    dayKey: '2026-10-06',
    total: 480.0,
    paymentKind: 'CASH',
    cashAmount: 480.0,
    qrAmount: 0,
    creditAmount: 0,
    createdAt: '2026-10-06T11:30:00Z',
    createdBy: 'seller-carlos',
    latestCorrectionId: 'corr-104',
    editedAt: '2026-10-06T13:00:00Z',
    editedBy: 'Administración',
    editReason: 'Ajuste de peso recibido por cliente',
    lines: [
      {
        productId: 'prod-mortadela',
        productNameSnapshot: 'Mortadela Familiar',
        presentationSnapshot: 'Pieza 1 kg',
        unitType: 'kg',
        quantity: 12, // Corregido de 15 a 12
        actualUnitPrice: 40,
        subtotal: 480.0,
        costTotal: 300.0,
      },
    ],
  },

  // Día 3: 07/10/2026
  {
    id: 'sale-105',
    operationId: 'VTA-00105',
    restaurantId: 'sanjose',
    routeId: 'route-norte',
    routeName: 'Ruta Norte',
    sellerUid: 'seller-juan',
    sellerName: 'Juan Pérez',
    customerName: 'Supermercado Doña Julia',
    dayKey: '2026-10-07',
    total: 1650.0,
    paymentKind: 'CASH',
    cashAmount: 1650.0,
    qrAmount: 0,
    creditAmount: 0,
    createdAt: '2026-10-07T08:45:00Z',
    createdBy: 'seller-juan',
    lines: [
      {
        productId: 'prod-chorizo',
        productNameSnapshot: 'Chorizo Parrillero Crudo',
        presentationSnapshot: 'Paquete al vacío de 500 g',
        unitType: 'package',
        quantity: 35,
        actualUnitPrice: 30,
        subtotal: 1050.0,
        costTotal: 665.0,
      },
      {
        productId: 'prod-viena',
        productNameSnapshot: 'Salchicha tipo Viena',
        presentationSnapshot: 'Granel',
        unitType: 'kg',
        quantity: 24,
        actualUnitPrice: 25,
        subtotal: 600.0,
        costTotal: 384.0,
      },
    ],
  },
]

// Reclamos (devolución y cambio)
const mockClaims = [
  // Devolución de 2 paquetes de chorizo por empaque
  {
    id: 'claim-201',
    kind: 'return',
    saleId: 'sale-105',
    customerId: 'cust-julia',
    customerName: 'Supermercado Doña Julia',
    productId: 'prod-chorizo',
    productName: 'Chorizo Parrillero Crudo',
    quantity: 2,
    unitType: 'package',
    reason: 'Empaque rasgado en traslado',
    routeId: 'route-norte',
    createdAt: '2026-10-07T11:00:00Z',
    dayKey: '2026-10-07',
    revenueDelta: -60.0, // 2 * 30
    additionalCost: -38.0, // Reingreso al almacén
    debtReduction: 0,
    cashIn: 0,
    cashOut: 60.0,
    qrIn: 0,
    qrOut: 0,
    replacement: null,
  },
  // Cambio de 2 kg de mortadela (80 Bs) por 2 paquetes de salame (90 Bs) cobrando +10 Bs
  {
    id: 'claim-202',
    kind: 'exchange',
    saleId: 'sale-104',
    customerId: 'cust-antonio',
    customerName: 'Micromercado San Antonio',
    productId: 'prod-mortadela',
    productName: 'Mortadela Familiar',
    quantity: 2,
    unitType: 'kg',
    reason: 'Cliente solicitó cambiar por Salame',
    routeId: 'route-sud',
    createdAt: '2026-10-06T15:30:00Z',
    dayKey: '2026-10-06',
    revenueDelta: 10.0,
    additionalCost: 54.0, // Costo de 2 salames
    debtReduction: 0,
    cashIn: 10.0,
    cashOut: 0,
    qrIn: 0,
    qrOut: 0,
    replacement: {
      productId: 'prod-salame',
      productName: 'Salame Milano Seleccionado',
      quantity: 2,
      unitType: 'package',
      total: 90.0,
    },
  },
]

const mockExpenses = [
  {
    id: 'exp-301',
    amount: 120.0,
    concept: 'Combustible Ruta Norte',
    category: 'Combustible',
    routeId: 'route-norte',
    dayKey: '2026-10-05',
    createdAt: '2026-10-05T07:30:00Z',
    registeredByUid: 'seller-juan',
    restaurantId: 'sanjose',
  },
  {
    id: 'exp-302',
    amount: 90.0,
    concept: 'Combustible Ruta Sud',
    category: 'Combustible',
    routeId: 'route-sud',
    dayKey: '2026-10-06',
    createdAt: '2026-10-06T07:45:00Z',
    registeredByUid: 'seller-carlos',
    restaurantId: 'sanjose',
  },
]

const mockMovements = [
  {
    id: 'mov-shortage-1',
    type: 'shortage',
    productId: 'prod-viena',
    productName: 'Salchicha tipo Viena',
    unitType: 'kg',
    quantity: 2,
    lossCost: 32.0, // Merma de 32 Bs
    dayKey: '2026-10-07',
    createdAt: '2026-10-07T17:00:00Z',
    routeId: 'route-norte',
    restaurantId: 'sanjose',
  },
]

// -------------------------------------------------------------
// COMPUTAR REPORTE CANÓNICO
// -------------------------------------------------------------
const dayKeys = ['2026-10-05', '2026-10-06', '2026-10-07']
const report = computeProductProfitReport(
  mockSales,
  mockClaims,
  mockExpenses,
  mockMovements,
  dayKeys,
)

// -------------------------------------------------------------
// GENERAR PDF DE GANANCIAS POR PRODUCTO
// -------------------------------------------------------------
async function generatePdf() {
  const pdf = new jsPDF({ orientation: 'portrait', format: 'letter' })
  const pageWidth = pdf.internal.pageSize.getWidth()

  // Cabecera institucional
  pdf.setFillColor(200, 16, 46) // Rojo San José
  pdf.rect(0, 0, pageWidth, 24, 'F')

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(13)
  pdf.setTextColor(255, 255, 255)
  pdf.text('EMBUTIDOS SAN JOSÉ  ·  GANANCIAS POR PRODUCTO', 14, 15)

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8.5)
  pdf.setTextColor(254, 226, 226)
  pdf.text('Periodo: 05/10/2026 al 07/10/2026 · Ganancia Bruta y Reconciliación Operativa', 14, 21)

  // Cuadro KPI Destacado
  pdf.setFillColor(248, 250, 252)
  pdf.setDrawColor(226, 232, 240)
  pdf.roundedRect(14, 28, pageWidth - 28, 19, 3, 3, 'FD')

  const kpiCols = [
    { label: 'VENTAS TOTALES', val: formatBs(report.totals.salesBs) },
    {
      label: 'COSTO TOTAL',
      val: report.totals.costBs !== null ? formatBs(report.totals.costBs) : 'Incompleto',
    },
    {
      label: 'GANANCIA BRUTA',
      val: report.totals.profitBs !== null ? formatBs(report.totals.profitBs) : 'No disponible',
    },
    {
      label: 'MARGEN BRUTO',
      val: report.totals.marginPct !== null ? `${report.totals.marginPct.toFixed(1)} %` : '—',
    },
  ]

  const colWidth = (pageWidth - 28) / 4
  kpiCols.forEach((kpi, idx) => {
    const x = 14 + idx * colWidth + 5
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(6.5)
    pdf.setTextColor(100, 116, 139)
    pdf.text(kpi.label, x, 34)

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(10.5)
    pdf.setTextColor(idx === 2 ? 16 : 30, idx === 2 ? 185 : 41, idx === 2 ? 129 : 59)
    pdf.text(kpi.val, x, 42)
  })

  let startY = 52

  // Grupos por día
  for (const day of report.dayGroups) {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(9.5)
    pdf.setTextColor(15, 23, 42)
    pdf.text(day.dateLabel || day.dayKey, 14, startY)

    const tableRows = day.items.map((it) => [
      it.productName,
      it.presentation || '—',
      `${it.quantity} ${it.unitType === 'kg' ? 'kg' : 'paq'}`,
      formatBs(it.salesBs),
      it.costBs !== null ? formatBs(it.costBs) : 'Incompleto',
      it.profitBs !== null ? formatBs(it.profitBs) : '—',
      it.marginPct !== null ? `${it.marginPct.toFixed(1)} %` : '—',
    ])

    // Fila subtotal del día
    tableRows.push([
      `SUBTOTAL ${day.dayKey}`,
      '',
      '',
      formatBs(day.daySalesBs),
      day.dayCostBs !== null ? formatBs(day.dayCostBs) : 'Incompleto',
      day.dayProfitBs !== null ? formatBs(day.dayProfitBs) : '—',
      day.dayMarginPct !== null ? `${day.dayMarginPct.toFixed(1)} %` : '—',
    ])

    autoTable(pdf, {
      startY: startY + 2,
      head: [['Producto', 'Presentación', 'Cant.', 'Venta (Bs)', 'Costo (Bs)', 'Ganancia (Bs)', 'Margen']],
      body: tableRows,
      theme: 'grid',
      styles: { fontSize: 7.5, cellPadding: 2, textColor: [30, 41, 59] },
      headStyles: { fillColor: [51, 65, 85], textColor: [255, 255, 255], fontStyle: 'bold' },
      didParseCell: (data) => {
        if (data.row.index === tableRows.length - 1) {
          data.cell.styles.fontStyle = 'bold'
          data.cell.styles.fillColor = [241, 245, 249]
        }
      },
      margin: { left: 14, right: 14 },
    })

    startY = pdf.lastAutoTable.finalY + 8
  }

  // Cuadro Total del Periodo
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(10)
  pdf.setTextColor(15, 23, 42)
  pdf.text('RESUMEN CONSOLIDADO DEL PERIODO', 14, startY)

  const summaryRows = report.items.map((it) => [
    it.productName,
    it.presentation || '—',
    `${it.quantity} ${it.unitType === 'kg' ? 'kg' : 'paq'}`,
    formatBs(it.salesBs),
    it.costBs !== null ? formatBs(it.costBs) : 'Incompleto',
    it.profitBs !== null ? formatBs(it.profitBs) : '—',
    it.marginPct !== null ? `${it.marginPct.toFixed(1)} %` : '—',
  ])

  summaryRows.push([
    'TOTAL PERIODO',
    '',
    `${report.totals.quantityTotal}`,
    formatBs(report.totals.salesBs),
    report.totals.costBs !== null ? formatBs(report.totals.costBs) : 'Incompleto',
    report.totals.profitBs !== null ? formatBs(report.totals.profitBs) : '—',
    report.totals.marginPct !== null ? `${report.totals.marginPct.toFixed(1)} %` : '—',
  ])

  autoTable(pdf, {
    startY: startY + 2,
    head: [['Producto', 'Presentación', 'Cant.', 'Venta (Bs)', 'Costo (Bs)', 'Ganancia (Bs)', 'Margen']],
    body: summaryRows,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2.2, textColor: [30, 41, 59] },
    headStyles: { fillColor: [200, 16, 46], textColor: [255, 255, 255], fontStyle: 'bold' },
    didParseCell: (data) => {
      if (data.row.index === summaryRows.length - 1) {
        data.cell.styles.fontStyle = 'bold'
        data.cell.styles.fillColor = [254, 242, 242]
        data.cell.styles.textColor = [153, 27, 27]
      }
    },
    margin: { left: 14, right: 14 },
  })

  startY = pdf.lastAutoTable.finalY + 8

  // Bloque Operativo Secundario
  if (report.operationalTotals.isAvailable && startY < 230) {
    pdf.setFillColor(248, 250, 252)
    pdf.setDrawColor(203, 213, 225)
    pdf.roundedRect(14, startY, pageWidth - 28, 22, 2, 2, 'FD')

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8)
    pdf.setTextColor(71, 85, 105)
    pdf.text('DEDUCCIONES OPERATIVAS Y RESULTADO ESTIMADO (RECONCILIACIÓN RESUMEN):', 18, startY + 6)

    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.setTextColor(30, 41, 59)
    pdf.text(
      `(-) Gastos de ruta: ${formatBs(report.operationalTotals.spent)}   ·   (-) Mermas de inventario: ${formatBs(report.operationalTotals.lossCost)}`,
      18,
      startY + 12,
    )

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(9)
    pdf.setTextColor(15, 23, 42)
    pdf.text(
      `(=) Ganancia Operativa Estimada: ${formatBs(report.operationalTotals.operatingProfit ?? 0)}`,
      18,
      startY + 18,
    )
  }

  // Pie de página
  const totalPages = pdf.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    pdf.setPage(p)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7.5)
    pdf.setTextColor(148, 163, 184)
    pdf.text(`Generado el: ${new Date().toLocaleString('es-BO')} · Embutidos San José`, 14, 272)
    pdf.text(`Página ${p} de ${totalPages}`, pageWidth - 32, 272)
  }

  const pdfPath = path.join(OUTPUT_DIR, 'ganancia-productos.pdf')
  fs.writeFileSync(pdfPath, Buffer.from(pdf.output('arraybuffer')))
  console.log('PDF generado exitosamente:', pdfPath)
}

// -------------------------------------------------------------
// GENERAR EXCEL DUAL (RESUMEN + DETALLE)
// -------------------------------------------------------------
async function generateExcel() {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Embutidos San José'
  wb.created = new Date()

  // HOJA 1: RESUMEN
  const ws1 = wb.addWorksheet('Ganancia - Resumen', {
    views: [{ state: 'frozen', ySplit: 5 }],
  })

  ws1.mergeCells(1, 1, 1, 8)
  ws1.getCell(1, 1).value = 'EMBUTIDOS SAN JOSÉ  ·  GANANCIAS POR PRODUCTO (RESUMEN)'
  ws1.getCell(1, 1).font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
  ws1.getCell(1, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC8102E' } }
  ws1.getCell(1, 1).alignment = { vertical: 'middle', horizontal: 'center' }

  ws1.mergeCells(2, 1, 2, 8)
  ws1.getCell(2, 1).value = 'Periodo: 05/10/2026 al 07/10/2026  ·  Costos históricos congelados'
  ws1.getCell(2, 1).font = { name: 'Segoe UI', size: 9, italic: true, color: { argb: 'FF475569' } }

  const kpiRow = ws1.getRow(3)
  kpiRow.values = [
    'VENTAS TOTALES',
    report.totals.salesBs,
    'COSTO TOTAL',
    report.totals.costBs,
    'GANANCIA BRUTA',
    report.totals.profitBs,
    'MARGEN BRUTO',
    report.totals.marginPct !== null ? report.totals.marginPct / 100 : 0,
  ]
  kpiRow.font = { name: 'Segoe UI', size: 8.5, bold: true }
  ws1.getCell(3, 2).numFmt = '#,##0.00'
  ws1.getCell(3, 4).numFmt = '#,##0.00'
  ws1.getCell(3, 6).numFmt = '#,##0.00'
  ws1.getCell(3, 8).numFmt = '0.0%'

  const h1 = [
    'Producto',
    'Presentación',
    'Unidad',
    'Cantidad vendida',
    'Ventas (Bs)',
    'Costo total (Bs)',
    'Ganancia bruta (Bs)',
    'Margen (%)',
  ]
  ws1.getRow(5).values = h1
  ws1.getRow(5).eachCell((c) => {
    c.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } }
  })

  report.items.forEach((it) => {
    ws1.addRow([
      it.productName,
      it.presentation,
      it.unitType === 'kg' ? 'Kg' : 'Paquete',
      it.quantity,
      it.salesBs,
      it.costBs !== null ? it.costBs : 'Incompleto',
      it.profitBs !== null ? it.profitBs : 'No disponible',
      it.marginPct !== null ? it.marginPct / 100 : '—',
    ])
  })

  // Fila Total
  const totalRow = ws1.addRow([
    'TOTAL GENERAL',
    '',
    '',
    report.totals.quantityTotal,
    report.totals.salesBs,
    report.totals.costBs,
    report.totals.profitBs,
    report.totals.marginPct !== null ? report.totals.marginPct / 100 : 0,
  ])
  totalRow.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FF991B1B' } }
  totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } }

  // Formatos números
  for (let r = 6; r <= ws1.rowCount; r++) {
    const row = ws1.getRow(r)
    ;[4, 5, 6, 7].forEach((colIdx) => {
      const cell = row.getCell(colIdx)
      if (typeof cell.value === 'number') cell.numFmt = '#,##0.00'
    })
    const marginCell = row.getCell(8)
    if (typeof marginCell.value === 'number') marginCell.numFmt = '0.0%'
  }

  // Deducciones operativas al pie
  if (report.operationalTotals.isAvailable) {
    ws1.addRow([])
    const opTitle = ws1.addRow(['DEDUCCIONES OPERATIVAS Y RESULTADO ESTIMADO (CONSOLIDADO)', '', '', '', '', '', '', ''])
    opTitle.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF334155' } }

    const rExp = ws1.addRow(['(-) Gastos operativos de ruta', '', '', '', '', '', report.operationalTotals.spent, ''])
    rExp.getCell(7).numFmt = '#,##0.00'
    const rLoss = ws1.addRow(['(-) Mermas de inventario', '', '', '', '', '', report.operationalTotals.lossCost, ''])
    rLoss.getCell(7).numFmt = '#,##0.00'
    const rNet = ws1.addRow(['(=) Ganancia Operativa Estimada', '', '', '', '', '', report.operationalTotals.operatingProfit, ''])
    rNet.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FF065F46' } }
    rNet.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } }
    rNet.getCell(7).numFmt = '#,##0.00'
  }

  // HOJA 2: DETALLE
  const ws2 = wb.addWorksheet('Ganancia - Detalle', {
    views: [{ state: 'frozen', ySplit: 4 }],
  })

  ws2.mergeCells(1, 1, 1, 13)
  ws2.getCell(1, 1).value = 'EMBUTIDOS SAN JOSÉ  ·  DETALLE CRONOLÓGICO DE LÍNEAS Y GANANCIAS'
  ws2.getCell(1, 1).font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
  ws2.getCell(1, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC8102E' } }
  ws2.getCell(1, 1).alignment = { vertical: 'middle', horizontal: 'center' }

  ws2.mergeCells(2, 1, 2, 13)
  ws2.getCell(2, 1).value = 'Periodo: 05/10/2026 al 07/10/2026  ·  Trazabilidad de comprobantes y reclamos'
  ws2.getCell(2, 1).font = { name: 'Segoe UI', size: 8.5, color: { argb: 'FF64748B' } }

  const h2 = [
    'Fecha / Día',
    'Comprobante',
    'Cliente',
    'Ruta / Vendedor',
    'Producto',
    'Presentación',
    'Cantidad',
    'Unidad',
    'Precio unit. (Bs)',
    'Venta (Bs)',
    'Costo (Bs)',
    'Ganancia (Bs)',
    'Estado / Tipo',
  ]
  ws2.getRow(4).values = h2
  ws2.getRow(4).eachCell((c) => {
    c.font = { name: 'Segoe UI', size: 8.5, bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } }
  })

  report.allLineDetails.forEach((ld) => {
    let estado = 'REGULAR'
    if (ld.isCorrected) estado = 'CORREGIDA'
    if (ld.isClaimRelated) estado = ld.claimKind === 'return' ? 'DEVOLUCIÓN' : 'CAMBIO'

    ws2.addRow([
      ld.dayKey,
      ld.voucherCode,
      ld.customerName,
      `${ld.routeName} (${ld.sellerName})`,
      ld.productName,
      ld.presentation,
      ld.quantity,
      ld.unitType === 'kg' ? 'Kg' : 'Paquete',
      ld.actualUnitPrice,
      ld.saleBs,
      ld.costBs !== null ? ld.costBs : '—',
      ld.profitBs !== null ? ld.profitBs : '—',
      estado,
    ])
  })

  // Ajustar anchos en ambas hojas
  ;[ws1, ws2].forEach((ws) => {
    for (let c = 1; c <= ws.columnCount; c++) {
      let max = 10
      for (let r = 4; r <= ws.rowCount; r++) {
        const val = ws.getCell(r, c).value
        if (val) max = Math.max(max, String(val).length)
      }
      ws.getColumn(c).width = Math.min(max + 3, 35)
    }
  })

  const excelPath = path.join(OUTPUT_DIR, 'ganancia-productos.xlsx')
  await wb.xlsx.writeFile(excelPath)
  console.log('Excel generado exitosamente:', excelPath)
}

async function main() {
  await generatePdf()
  await generateExcel()
  console.log('Muestras generadas en output/review-1412:')
  console.log(' - output/review-1412/ganancia-productos.pdf')
  console.log(' - output/review-1412/ganancia-productos.xlsx')
}

void main()
