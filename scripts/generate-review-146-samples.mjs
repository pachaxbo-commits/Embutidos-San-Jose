import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const req = createRequire(import.meta.url)
const { jsPDF } = req('jspdf')
const { default: autoTable } = req('jspdf-autotable')
const ExcelJS = req('exceljs')

const OUTPUT_DIR = path.resolve('output/review-146')
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
}

console.log('Regenerando muestras corregidas en:', OUTPUT_DIR)

// --- UTILIDADES GLOBALES DE REDONDEO ---
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const formatBs = (n) => `Bs ${round2(n).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const currentGenerationTimestamp = () => {
  const now = new Date()
  const d = now.toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const t = now.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return `${d} ${t}`
}

const DEMO_PERIOD = '01/10/2026 al 06/10/2026'

// --- 1. FUNCIÓN ÚNICA DE AGREGACIÓN PARA COMPRAS POR CLIENTE ---
function aggregateCustomerPurchases(rawClients) {
  return rawClients.map((client) => {
    let totalBs = 0
    let exactKg = 0
    let estimatedKg = 0
    let totalPackages = 0

    const products = client.rawProducts.map((p) => {
      const subtotal = round2(p.qty * p.price)
      totalBs = round2(totalBs + subtotal)

      let pExactKg = 0
      let pEstKg = 0

      if (p.unitType === 'kg') {
        pExactKg = round2(p.qty)
        exactKg = round2(exactKg + pExactKg)
      } else {
        totalPackages += p.qty
        pEstKg = round2(p.qty * (p.approximateWeightKg || 0))
        estimatedKg = round2(estimatedKg + pEstKg)
      }

      const pTotalEquivalentKg = round2(pExactKg + pEstKg)

      return {
        name: p.name,
        presentation: p.presentation,
        unitType: p.unitType,
        qty: p.qty,
        price: p.price,
        subtotal,
        exactKg: pExactKg,
        estimatedKg: pEstKg,
        totalEquivalentKg: pTotalEquivalentKg,
      }
    })

    const totalEquivalentKg = round2(exactKg + estimatedKg)

    return {
      name: client.name,
      code: client.code,
      route: client.route,
      purchasesCount: client.purchasesCount,
      products,
      totalBs,
      exactKg,
      estimatedKg,
      totalEquivalentKg,
      totalPackages,
      kgBreakdown: `${totalEquivalentKg.toLocaleString('es-BO', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} kg equivalentes (${exactKg.toLocaleString('es-BO', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} kg exactos + ${estimatedKg.toLocaleString('es-BO', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} estimados)`,
    }
  }).sort((a, b) => b.totalBs - a.totalBs)
}

const RAW_CLIENTS = [
  {
    name: 'Supermercado Doña Julia',
    code: '4892019',
    route: 'Zona Norte',
    purchasesCount: 5,
    rawProducts: [
      { name: 'Chorizo Parrillero Crudo', presentation: 'Paquete al vacío de 500 g', unitType: 'kg', qty: 70.0, price: 57.00 },
      { name: 'Salchicha tipo Viena', presentation: 'Granel', unitType: 'kg', qty: 80.0, price: 48.00 },
      { name: 'Jamón de Cerdo', presentation: 'Granel', unitType: 'kg', qty: 11.0, price: 53.00 },
      { name: 'Mortadela Jamonada', presentation: 'Sachet de 200 g', unitType: 'package', approximateWeightKg: 0.20, qty: 42, price: 12.00 },
    ],
  },
  {
    name: 'Frialsur Los Andes',
    code: '3019284',
    route: 'Sacaba',
    purchasesCount: 3,
    rawProducts: [
      { name: 'Chorizo Parrillero Crudo', presentation: 'Paquete al vacío de 500 g', unitType: 'kg', qty: 50.0, price: 57.00 },
      { name: 'Jamón de Cerdo', presentation: 'Granel', unitType: 'kg', qty: 30.0, price: 53.00 },
      { name: 'Salchicha tipo Viena', presentation: 'Granel', unitType: 'kg', qty: 8.5, price: 48.00 },
      { name: 'Mortadela Jamonada', presentation: 'Sachet de 200 g', unitType: 'package', approximateWeightKg: 0.20, qty: 25, price: 12.00 },
    ],
  },
  {
    name: 'Almacén Don Pedro',
    code: '7721890',
    route: 'Zona Sud',
    purchasesCount: 4,
    rawProducts: [
      { name: 'Salchicha tipo Viena', presentation: 'Granel', unitType: 'kg', qty: 60.0, price: 48.00 },
      { name: 'Chorizo Parrillero Crudo', presentation: 'Paquete al vacío de 500 g', unitType: 'kg', qty: 20.0, price: 57.00 },
      { name: 'Jamón de Cerdo', presentation: 'Granel', unitType: 'kg', qty: 4.0, price: 53.00 },
      { name: 'Mortadela Jamonada', presentation: 'Sachet de 200 g', unitType: 'package', approximateWeightKg: 0.20, qty: 15, price: 12.00 },
    ],
  },
]

const DEMO_CLIENTS = aggregateCustomerPurchases(RAW_CLIENTS)

// Cálculos globales consistentes
const GRAND_TOTAL_BS = round2(DEMO_CLIENTS.reduce((s, c) => s + c.totalBs, 0))
const GRAND_TOTAL_EXACT_KG = round2(DEMO_CLIENTS.reduce((s, c) => s + c.exactKg, 0))
const GRAND_TOTAL_EST_KG = round2(DEMO_CLIENTS.reduce((s, c) => s + c.estimatedKg, 0))
const GRAND_TOTAL_EQUIV_KG = round2(GRAND_TOTAL_EXACT_KG + GRAND_TOTAL_EST_KG)
const GRAND_TOTAL_PACKAGES = DEMO_CLIENTS.reduce((s, c) => s + c.totalPackages, 0)
const TOP_CLIENT = DEMO_CLIENTS[0]

// --- DATOS FINANCIEROS Y OPERATIVOS ---
const DEMO_FINANCIALS = {
  grossSales: 18450.00,
  returnsDelta: -280.00,
  netSales: 18170.00,
  productionCost: 10120.00,
  grossMargin: 8050.00,
  expenses: 1420.00,
  inventoryLosses: 310.00,
  operatingProfit: 6320.00,
  collections: 3200.00,
  creditGenerated: 4150.00,
}

const DEMO_KARDEX = [
  {
    productName: 'Chorizo Parrillero Crudo',
    presentation: 'Paquete al vacío de 500 g',
    unitType: 'kg',
    sales: [
      { date: '02/10/2026 09:15', receipt: 'VT-0042', customer: 'Supermercado Doña Julia', seller: 'Hugo Herbas', route: 'Zona Norte', qty: 35.0, price: 57.0, subtotal: 1995.0 },
      { date: '03/10/2026 11:30', receipt: 'VT-0048', customer: 'Frialsur Los Andes', seller: 'Ricardo Jimenez', route: 'Sacaba', qty: 50.0, price: 57.0, subtotal: 2850.0 },
      { date: '04/10/2026 14:10', receipt: 'VT-0055', customer: 'Supermercado Doña Julia', seller: 'Hugo Herbas', route: 'Zona Norte', qty: 35.0, price: 57.0, subtotal: 1995.0 },
      { date: '05/10/2026 10:20', receipt: 'VT-0062', customer: 'Almacén Don Pedro', seller: 'Ricardo Jimenez', route: 'Zona Sud', qty: 20.0, price: 57.0, subtotal: 1140.0 },
    ],
  },
  {
    productName: 'Salchicha tipo Viena',
    presentation: 'Granel',
    unitType: 'kg',
    sales: [
      { date: '01/10/2026 08:45', receipt: 'VT-0038', customer: 'Supermercado Doña Julia', seller: 'Hugo Herbas', route: 'Zona Norte', qty: 40.0, price: 48.0, subtotal: 1920.0 },
      { date: '02/10/2026 10:00', receipt: 'VT-0043', customer: 'Almacén Don Pedro', seller: 'Ricardo Jimenez', route: 'Zona Sud', qty: 30.0, price: 48.0, subtotal: 1440.0 },
      { date: '04/10/2026 09:30', receipt: 'VT-0053', customer: 'Supermercado Doña Julia', seller: 'Hugo Herbas', route: 'Zona Norte', qty: 40.0, price: 48.0, subtotal: 1920.0 },
      { date: '05/10/2026 15:40', receipt: 'VT-0066', customer: 'Almacén Don Pedro', seller: 'Ricardo Jimenez', route: 'Zona Sud', qty: 30.0, price: 48.0, subtotal: 1440.0 },
      { date: '06/10/2026 11:15', receipt: 'VT-0071', customer: 'Frialsur Los Andes', seller: 'Ricardo Jimenez', route: 'Sacaba', qty: 8.5, price: 48.0, subtotal: 408.0 },
    ],
  },
  {
    productName: 'Mortadela Jamonada',
    presentation: 'Sachet de 200 g',
    unitType: 'package',
    sales: [
      { date: '02/10/2026 09:20', receipt: 'VT-0042', customer: 'Supermercado Doña Julia', seller: 'Hugo Herbas', route: 'Zona Norte', qty: 20, price: 12.0, subtotal: 240.0 },
      { date: '03/10/2026 11:35', receipt: 'VT-0048', customer: 'Frialsur Los Andes', seller: 'Ricardo Jimenez', route: 'Sacaba', qty: 25, price: 12.0, subtotal: 300.0 },
      { date: '04/10/2026 14:15', receipt: 'VT-0055', customer: 'Supermercado Doña Julia', seller: 'Hugo Herbas', route: 'Zona Norte', qty: 22, price: 12.0, subtotal: 264.0 },
      { date: '05/10/2026 10:25', receipt: 'VT-0062', customer: 'Almacén Don Pedro', seller: 'Ricardo Jimenez', route: 'Zona Sud', qty: 15, price: 12.0, subtotal: 180.0 },
    ],
  },
]

const DEMO_DISPATCH = {
  id: 'disp-20261006-01',
  date: '06/10/2026 06:30',
  routeName: 'Zona Norte',
  distributorName: 'Hugo Herbas',
  warehouseName: 'Almacén Central',
  warehouseResponsible: 'Roberto Gómez (Turno Mañana)',
  initialLoad: [
    { productName: 'Chorizo Parrillero Crudo', presentation: 'Paquete al vacío de 500 g', lotCode: 'L-261001-A', expiresOn: '25/10/2026', qty: 50.0, unit: 'kg' },
    { productName: 'Salchicha tipo Viena', presentation: 'Granel', lotCode: 'L-261003-B', expiresOn: '15/10/2026', qty: 60.0, unit: 'kg' },
    { productName: 'Mortadela Jamonada', presentation: 'Sachet de 200 g', lotCode: 'L-260928-M', expiresOn: '10/11/2026', qty: 35, unit: 'paq' },
  ],
  additions: [
    {
      id: 'add-01',
      time: '10:15',
      responsible: 'Roberto Gómez',
      reason: 'Recarga solicitada por distribuidor ante pedido extraordinario',
      lines: [
        { productName: 'Chorizo Parrillero Crudo', presentation: 'Paquete al vacío de 500 g', lotCode: 'L-261002-A', expiresOn: '26/10/2026', qty: 25.0, unit: 'kg' },
        { productName: 'Salchicha tipo Viena', presentation: 'Granel', lotCode: 'L-261003-B', expiresOn: '15/10/2026', qty: 20.0, unit: 'kg' },
      ],
    },
    {
      id: 'add-02',
      time: '13:40',
      responsible: 'Roberto Gómez',
      reason: 'Aumento de última hora para cierre de ruta',
      lines: [
        { productName: 'Mortadela Jamonada', presentation: 'Sachet de 200 g', lotCode: 'L-260928-M', expiresOn: '10/11/2026', qty: 15, unit: 'paq' },
      ],
    },
  ],
}

// --------------------------------------------------------------------------
// 1. PDF — MUESTRA: RESULTADO DEL PERIODO (CORREGIDO)
// --------------------------------------------------------------------------
function generatePdfResultadoPeriodo() {
  const doc = new jsPDF({ orientation: 'portrait', format: 'letter' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()

  // Header Bar
  doc.setFillColor(200, 16, 46)
  doc.rect(0, 0, pageWidth, 6, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(200, 16, 46)
  doc.text('EMBUTIDOS SAN JOSÉ', 14, 18)

  doc.setFontSize(12)
  doc.setTextColor(30, 41, 59)
  doc.text('RESULTADO DEL PERIODO', 14, 25)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(100, 116, 139)
  doc.text(`Periodo evaluado: ${DEMO_PERIOD}  ·  Rutas: Todas las rutas  ·  Moneda: Bolivianos (Bs)`, 14, 31)

  // Card: RESULTADO OPERATIVO ESTIMADO / GANANCIA OPERATIVA ESTIMADA
  doc.setFillColor(248, 250, 252)
  doc.setDrawColor(200, 16, 46)
  doc.setLineWidth(1)
  doc.roundedRect(14, 36, pageWidth - 28, 32, 3, 3, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.setTextColor(148, 163, 184)
  doc.text('RESULTADO OPERATIVO ESTIMADO / GANANCIA OPERATIVA ESTIMADA', 20, 44)

  doc.setFontSize(22)
  doc.setTextColor(200, 16, 46)
  doc.text(`Bs ${DEMO_FINANCIALS.operatingProfit.toLocaleString('es-BO', { minimumFractionDigits: 2 })}`, 20, 56)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(71, 85, 105)
  doc.text('Ventas netas (Bs 18.170,00)  -  Costo de lo vendido (Bs 10.120,00)  -  Gastos (Bs 1.420,00)  -  Pérdidas (Bs 310,00)', 20, 63)

  // Desglose Operativo Paso a Paso (sin terminología contable abstracta)
  autoTable(doc, {
    startY: 72,
    head: [['Paso', 'Concepto operativo', 'Descripción del cálculo', 'Importe (Bs)']],
    body: [
      ['1', 'Ventas brutas antes de devoluciones', 'Total de ventas iniciales entregadas en el periodo', `Bs ${DEMO_FINANCIALS.grossSales.toFixed(2)}`],
      ['2', '(-) Ajustes por cambios y devoluciones', 'Devoluciones y productos compensados en ruta', `- Bs ${Math.abs(DEMO_FINANCIALS.returnsDelta).toFixed(2)}`],
      ['3', '(=) VENTAS NETAS', 'Ingreso comercial neto tras devoluciones', `Bs ${DEMO_FINANCIALS.netSales.toFixed(2)}`],
      ['4', '(-) Costo de producción de productos vendidos y reemplazos', 'Costo de producción registrado de los productos comercializados', `- Bs ${DEMO_FINANCIALS.productionCost.toFixed(2)}`],
      ['5', '(=) MARGEN BRUTO', 'Diferencia directa entre ventas netas y costo de producción', `Bs ${DEMO_FINANCIALS.grossMargin.toFixed(2)}`],
      ['6', '(-) Gastos registrados de ruta', 'Combustible, viáticos y gastos validados', `- Bs ${DEMO_FINANCIALS.expenses.toFixed(2)}`],
      ['7', '(-) Pérdidas y mermas registradas', 'Faltantes en conciliaciones y mermas de almacén', `- Bs ${DEMO_FINANCIALS.inventoryLosses.toFixed(2)}`],
      ['8', '(=) RESULTADO OPERATIVO ESTIMADO / GANANCIA OPERATIVA', 'Ganancia operativa estimada del negocio en este periodo', `Bs ${DEMO_FINANCIALS.operatingProfit.toFixed(2)}`],
    ],
    theme: 'grid',
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5 },
    bodyStyles: { fontSize: 8, cellPadding: 2.8 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 12, halign: 'center' },
      1: { cellWidth: 84, fontStyle: 'bold' },
      2: { cellWidth: 62, textColor: [100, 116, 139] },
      3: { cellWidth: 30, halign: 'right', fontStyle: 'bold' },
    },
    didParseCell: (data) => {
      if (data.row.index === 2 || data.row.index === 4) {
        data.cell.styles.fillColor = [254, 243, 199]
      }
      if (data.row.index === 7) {
        data.cell.styles.fillColor = [254, 226, 226]
        data.cell.styles.textColor = [185, 28, 28]
        data.cell.styles.fontSize = 8.5
      }
    },
  })

  // Guía didáctica para la dueña
  const finalY = doc.lastAutoTable.finalY + 8
  doc.setFillColor(241, 245, 249)
  doc.roundedRect(14, finalY, pageWidth - 28, 48, 3, 3, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(30, 41, 59)
  doc.text('GUÍA EXPLICATIVA PARA ADMINISTRACIÓN (CÓMO ENTENDER CADA NÚMERO):', 18, finalY + 7)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(51, 65, 85)
  const explanations = [
    '• Ventas netas: Total vendido antes de ajustes menos devoluciones. Incluye ventas al contado y a crédito del periodo.',
    '• Costo de lo vendido: Costo de producción registrado de los productos efectivamente vendidos y reemplazos.',
    '• Margen bruto: Ganancia directa entre el valor vendido y el costo de producción asociado.',
    '• Cobros de cartera (Bs 3.200,00): Dinero recuperado de ventas a crédito pasadas; entra a caja pero NO es una nueva venta.',
    '• Ventas a crédito (Bs 4.150,00): Forman parte de las ventas netas de hoy; su cobro posterior NO vuelve a contarse como venta.',
    '• Resultado operativo / Ganancia operativa estimada: Margen bruto menos gastos de ruta y pérdidas registradas.',
  ]
  let textY = finalY + 13
  explanations.forEach((exp) => {
    doc.text(exp, 18, textY)
    textY += 5.5
  })

  // Pie de página con fecha y hora exacta
  doc.setFontSize(7.5)
  doc.setTextColor(148, 163, 184)
  doc.text(`Generado el: ${currentGenerationTimestamp()} · Embutidos San José`, 14, pageHeight - 8)
  doc.text(`Página 1 de 1`, pageWidth - 28, pageHeight - 8)

  const filePath = path.join(OUTPUT_DIR, 'muestra-resultado-periodo.pdf')
  fs.writeFileSync(filePath, Buffer.from(doc.output('arraybuffer')))
  console.log('✓ Creado:', filePath)
}

// --------------------------------------------------------------------------
// 2. PDF — MUESTRA: COMPRAS POR CLIENTE (CORREGIDO CON KG EXACTOS Y ESTIMADOS)
// --------------------------------------------------------------------------
function generatePdfComprasPorCliente() {
  const doc = new jsPDF({ orientation: 'portrait', format: 'letter' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()

  // Header Bar
  doc.setFillColor(200, 16, 46)
  doc.rect(0, 0, pageWidth, 6, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(200, 16, 46)
  doc.text('EMBUTIDOS SAN JOSÉ', 14, 17)

  doc.setFontSize(12)
  doc.setTextColor(30, 41, 59)
  doc.text('COMPRAS POR CLIENTE (DESGLOSE AGRUPADO)', 14, 24)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(100, 116, 139)
  doc.text(`Periodo: ${DEMO_PERIOD}  ·  Ordenado por mayor compra total  ·  Kilos exactos y estimados`, 14, 30)

  // Resumen del mayor comprador (Datos que cuadran 100% con las filas)
  doc.setFillColor(254, 242, 242)
  doc.setDrawColor(252, 165, 165)
  doc.roundedRect(14, 34, pageWidth - 28, 19, 2, 2, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(185, 28, 28)
  doc.text('CLIENTE QUE MÁS COMPRÓ EN EL PERIODO:', 18, 41)

  doc.setFontSize(10.5)
  doc.setTextColor(153, 27, 27)
  doc.text(`${TOP_CLIENT.name} (CI/NIT: ${TOP_CLIENT.code})`, 18, 48)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(185, 28, 28)
  doc.text(`Total: ${formatBs(TOP_CLIENT.totalBs)}  ·  ${TOP_CLIENT.kgBreakdown}  ·  ${TOP_CLIENT.totalPackages} paq`, 95, 48)

  let startY = 57

  DEMO_CLIENTS.forEach((client, idx) => {
    // Encabezado de grupo de cliente
    doc.setFillColor(241, 245, 249)
    doc.rect(14, startY, pageWidth - 28, 8, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(30, 41, 59)
    doc.text(`#${idx + 1}  ${client.name.toUpperCase()}`, 18, startY + 5.5)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(100, 116, 139)
    doc.text(`CI/NIT: ${client.code}  ·  Ruta: ${client.route}  ·  ${client.purchasesCount} pedidos`, 80, startY + 5.5)

    doc.setFont('helvetica', 'bold')
    doc.setTextColor(200, 16, 46)
    doc.text(`Subtotal: ${formatBs(client.totalBs)}`, pageWidth - 42, startY + 5.5)

    autoTable(doc, {
      startY: startY + 9,
      head: [['Producto', 'Detalle de presentación', 'Cantidad', 'Unidad', 'Kg calculados', 'Precio', 'Subtotal (Bs)']],
      body: client.products.map((p) => [
        p.name,
        p.presentation,
        p.qty.toFixed(p.unitType === 'kg' ? 2 : 0),
        p.unitType === 'kg' ? 'kg' : 'paq',
        p.unitType === 'kg' ? `${p.exactKg.toFixed(2)} kg (exacto)` : `${p.estimatedKg.toFixed(2)} kg (estimado)`,
        formatBs(p.price),
        formatBs(p.subtotal),
      ]),
      theme: 'plain',
      headStyles: { fillColor: [51, 65, 85], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5, cellPadding: 2 },
      bodyStyles: { fontSize: 7.5, cellPadding: 2, textColor: [30, 41, 59] },
      columnStyles: {
        0: { cellWidth: 50, fontStyle: 'bold' },
        1: { cellWidth: 42, textColor: [71, 85, 105] },
        2: { cellWidth: 16, halign: 'right' },
        3: { cellWidth: 14, halign: 'center' },
        4: { cellWidth: 26, halign: 'right' },
        5: { cellWidth: 18, halign: 'right' },
        6: { cellWidth: 22, halign: 'right', fontStyle: 'bold' },
      },
      margin: { left: 14, right: 14 },
    })

    // Subtotal de kilos del cliente
    const subY = doc.lastAutoTable.finalY
    doc.setFillColor(248, 250, 252)
    doc.rect(14, subY, pageWidth - 28, 5.5, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(71, 85, 105)
    doc.text(`Resumen cliente: ${client.kgBreakdown}  ·  ${client.totalPackages} paquetes cerrados`, 18, subY + 3.8)

    startY = subY + 8
  })

  // Total General Consolidado
  doc.setFillColor(30, 41, 59)
  doc.rect(14, startY, pageWidth - 28, 10, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(255, 255, 255)
  doc.text('TOTAL GENERAL DE TODOS LOS CLIENTES', 18, startY + 6.5)
  doc.setFontSize(8)
  doc.text(`${GRAND_TOTAL_EQUIV_KG.toFixed(1)} kg equiv. (${GRAND_TOTAL_EXACT_KG.toFixed(1)} kg exactos + ${GRAND_TOTAL_EST_KG.toFixed(1)} est.)`, 95, startY + 6.5)
  doc.setFontSize(9.5)
  doc.text(`${formatBs(GRAND_TOTAL_BS)}`, pageWidth - 42, startY + 6.5)

  // Pie de página con fecha y hora exacta
  doc.setFontSize(7.5)
  doc.setTextColor(148, 163, 184)
  doc.text(`Generado el: ${currentGenerationTimestamp()} · Embutidos San José`, 14, pageHeight - 8)
  doc.text(`Página 1 de 1`, pageWidth - 28, pageHeight - 8)

  const filePath = path.join(OUTPUT_DIR, 'muestra-compras-por-cliente.pdf')
  fs.writeFileSync(filePath, Buffer.from(doc.output('arraybuffer')))
  console.log('✓ Creado:', filePath)
}

// --------------------------------------------------------------------------
// 3. PDF — MUESTRA: KARDEX POR PRODUCTO (CORREGIDO SIN PALABRAS PARTIDAS)
// --------------------------------------------------------------------------
function generatePdfKardexPorProducto() {
  const doc = new jsPDF({ orientation: 'portrait', format: 'letter' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()

  // Header Bar
  doc.setFillColor(200, 16, 46)
  doc.rect(0, 0, pageWidth, 6, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(200, 16, 46)
  doc.text('EMBUTIDOS SAN JOSÉ', 14, 17)

  doc.setFontSize(12)
  doc.setTextColor(30, 41, 59)
  doc.text('KARDEX DETALLADO DE VENTAS POR PRODUCTO', 14, 24)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(100, 116, 139)
  doc.text(`Periodo: ${DEMO_PERIOD}  ·  Agrupado por producto con presentación comercial`, 14, 30)

  let startY = 36

  DEMO_KARDEX.forEach((prod) => {
    // Encabezado de producto
    doc.setFillColor(241, 245, 249)
    doc.rect(14, startY, pageWidth - 28, 9, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(30, 41, 59)
    doc.text(prod.productName.toUpperCase(), 18, startY + 6)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(100, 116, 139)
    doc.text(`Presentación: ${prod.presentation}`, 90, startY + 6)

    const totalProdQty = prod.sales.reduce((s, x) => s + x.qty, 0)
    const totalProdBs = prod.sales.reduce((s, x) => s + x.subtotal, 0)

    doc.setFont('helvetica', 'bold')
    doc.setTextColor(200, 16, 46)
    doc.text(`${totalProdQty.toFixed(prod.unitType === 'kg' ? 2 : 0)} ${prod.unitType === 'kg' ? 'kg' : 'paq'}  ·  ${formatBs(totalProdBs)}`, pageWidth - 60, startY + 6)

    // Tabla sin encabezados partidos (usamos 'N° Recibo' en vez de 'Comproba/nte' para evitar cortes de palabra)
    autoTable(doc, {
      startY: startY + 10,
      head: [['Fecha y hora', 'N° Recibo', 'Cliente', 'Vendedor', 'Ruta', 'Cantidad', 'Precio', 'Total (Bs)']],
      body: prod.sales.map((s) => [
        s.date,
        s.receipt,
        s.customer,
        s.seller,
        s.route,
        `${s.qty.toFixed(prod.unitType === 'kg' ? 2 : 0)} ${prod.unitType === 'kg' ? 'kg' : 'paq'}`,
        formatBs(s.price),
        formatBs(s.subtotal),
      ]),
      theme: 'plain',
      headStyles: { fillColor: [71, 85, 105], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5, cellPadding: 2.2 },
      bodyStyles: { fontSize: 7.5, cellPadding: 2 },
      columnStyles: {
        0: { cellWidth: 26 },
        1: { cellWidth: 20, fontStyle: 'bold' },
        2: { cellWidth: 44 },
        3: { cellWidth: 24 },
        4: { cellWidth: 20 },
        5: { cellWidth: 16, halign: 'right' },
        6: { cellWidth: 16, halign: 'right' },
        7: { cellWidth: 22, halign: 'right', fontStyle: 'bold' },
      },
      margin: { left: 14, right: 14 },
    })

    startY = doc.lastAutoTable.finalY + 8
  })

  // Pie de página con fecha y hora exacta
  doc.setFontSize(7.5)
  doc.setTextColor(148, 163, 184)
  doc.text(`Generado el: ${currentGenerationTimestamp()} · Embutidos San José`, 14, pageHeight - 8)
  doc.text(`Página 1 de 1`, pageWidth - 28, pageHeight - 8)

  const filePath = path.join(OUTPUT_DIR, 'muestra-kardex-por-producto.pdf')
  fs.writeFileSync(filePath, Buffer.from(doc.output('arraybuffer')))
  console.log('✓ Creado:', filePath)
}

// --------------------------------------------------------------------------
// 4. PDF/HOJA — MUESTRA: DESPACHO CON CARGA INICIAL + AUMENTOS (CORREGIDO)
// --------------------------------------------------------------------------
function generatePdfDespachoConAumentos() {
  const doc = new jsPDF({ orientation: 'portrait', format: 'letter' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()

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
  doc.text(`Despacho N°: ${DEMO_DISPATCH.id}          Fecha y hora de salida: ${DEMO_DISPATCH.date}`, 18, 34)
  doc.text(`Ruta asignada: ${DEMO_DISPATCH.routeName}          Distribuidor: ${DEMO_DISPATCH.distributorName}`, 18, 40)
  doc.text(`Almacén origen: ${DEMO_DISPATCH.warehouseName}          Encargado almacén: ${DEMO_DISPATCH.warehouseResponsible}`, 18, 46)

  // SECCIÓN 1: CARGA INICIAL
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.setTextColor(30, 41, 59)
  doc.text('1. CARGA INICIAL (SALIDA DE ALMACÉN)', 14, 56)

  autoTable(doc, {
    startY: 59,
    head: [['Producto', 'Detalle de presentación', 'Lote', 'Vencimiento', 'Cantidad inicial', 'Unidad']],
    body: DEMO_DISPATCH.initialLoad.map((l) => [
      l.productName,
      l.presentation,
      l.lotCode,
      l.expiresOn,
      l.qty.toFixed(l.unit === 'kg' ? 2 : 0),
      l.unit === 'kg' ? 'kg' : 'paquetes',
    ]),
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

  // SECCIÓN 2: AUMENTOS EN RUTA (FONDO ÁMBAR, SIN COLUMNA ESTADO REDUNDANTE)
  let y = doc.lastAutoTable.finalY + 8
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.setTextColor(180, 83, 9)
  doc.text('2. AUMENTOS DE CARGA REGISTRADOS DURANTE EL DÍA', 14, y)

  DEMO_DISPATCH.additions.forEach((add, i) => {
    y += 5
    doc.setFillColor(254, 243, 199) // amber-100
    doc.rect(14, y, pageWidth - 28, 7.5, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(146, 64, 14)
    doc.text(`AUMENTO #${i + 1}  ·  HORA: ${add.time}  ·  ENCARGADO: ${add.responsible}`, 18, y + 5)
    doc.setFont('helvetica', 'normal')
    doc.text(`Motivo: ${add.reason}`, 115, y + 5)

    autoTable(doc, {
      startY: y + 8,
      head: [['Producto', 'Detalle de presentación', 'Lote asignado', 'Vencimiento', 'Cantidad añadida', 'Unidad']],
      body: add.lines.map((l) => [
        l.productName,
        l.presentation,
        l.lotCode,
        l.expiresOn,
        `+${l.qty.toFixed(l.unit === 'kg' ? 2 : 0)}`,
        l.unit === 'kg' ? 'kg' : 'paquetes',
      ]),
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
    y = doc.lastAutoTable.finalY
  })

  // SECCIÓN 3: CONSOLIDADO A RENDICIÓN
  y += 8
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.setTextColor(30, 41, 59)
  doc.text('3. CONSOLIDADO TOTAL ENTREGADO A LA RUTA (CARGA INICIAL + AUMENTOS)', 14, y)

  autoTable(doc, {
    startY: y + 3,
    head: [['Producto', 'Detalle de presentación', 'Carga inicial', 'Aumentos', 'TOTAL A RENDICIÓN', 'Unidad']],
    body: [
      ['Chorizo Parrillero Crudo', 'Paquete al vacío de 500 g', '50.00', '+25.00', '75.00', 'kg'],
      ['Salchicha tipo Viena', 'Granel', '60.00', '+20.00', '80.00', 'kg'],
      ['Mortadela Jamonada', 'Sachet de 200 g', '35', '+15', '50', 'paquetes'],
    ],
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
  y = doc.lastAutoTable.finalY + 22
  doc.setDrawColor(71, 85, 105)
  doc.setLineWidth(0.5)
  doc.line(30, y, 90, y)
  doc.line(125, y, 185, y)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(71, 85, 105)
  doc.text('Entrega Almacén (Roberto Gómez)', 35, y + 4)
  doc.text('Recibe Conforme Distribuidor (Hugo Herbas)', 127, y + 4)

  // Pie de página con fecha y hora exacta
  doc.setFontSize(7.5)
  doc.setTextColor(148, 163, 184)
  doc.text(`Generado el: ${currentGenerationTimestamp()} · Embutidos San José`, 14, pageHeight - 8)
  doc.text(`Página 1 de 1`, pageWidth - 28, pageHeight - 8)

  const filePath = path.join(OUTPUT_DIR, 'muestra-despacho-aumentos.pdf')
  fs.writeFileSync(filePath, Buffer.from(doc.output('arraybuffer')))
  console.log('✓ Creado:', filePath)
}

// --------------------------------------------------------------------------
// 5. EXCEL — MUESTRA: COMPRAS POR CLIENTE (CORREGIDO)
// --------------------------------------------------------------------------
async function generateExcelComprasPorCliente() {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Embutidos San José'
  wb.created = new Date()

  // Hoja 1: Resumen de Clientes
  const wsResumen = wb.addWorksheet('Resumen de clientes')
  wsResumen.columns = [
    { header: 'Cliente', key: 'name', width: 30 },
    { header: 'CI / NIT', key: 'code', width: 14 },
    { header: 'Ruta principal', key: 'route', width: 18 },
    { header: 'Total compras (Bs)', key: 'totalBs', width: 20 },
    { header: 'Kg exactos', key: 'exactKg', width: 14 },
    { header: 'Kg estimados', key: 'estKg', width: 14 },
    { header: 'Total Kg equivalentes', key: 'totalKg', width: 22 },
    { header: 'Total Paquetes', key: 'totalPaq', width: 16 },
    { header: 'Pedidos', key: 'count', width: 12 },
    { header: 'Ticket prom. (Bs)', key: 'avg', width: 18 },
  ]

  wsResumen.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  wsResumen.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC8102E' } }

  DEMO_CLIENTS.forEach((c) => {
    wsResumen.addRow({
      name: c.name,
      code: c.code,
      route: c.route,
      totalBs: c.totalBs,
      exactKg: c.exactKg,
      estKg: c.estimatedKg,
      totalKg: c.totalEquivalentKg,
      totalPaq: c.totalPackages,
      count: c.purchasesCount,
      avg: round2(c.totalBs / c.purchasesCount),
    })
  })

  // Fila Total General
  const totalRow = wsResumen.addRow({
    name: 'TOTAL GENERAL',
    totalBs: { formula: 'SUM(D2:D4)' },
    exactKg: { formula: 'SUM(E2:E4)' },
    estKg: { formula: 'SUM(F2:F4)' },
    totalKg: { formula: 'SUM(G2:G4)' },
    totalPaq: { formula: 'SUM(H2:H4)' },
    count: { formula: 'SUM(I2:I4)' },
  })
  totalRow.font = { bold: true }
  totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDECEE' } }

  wsResumen.getColumn('totalBs').numFmt = '#,##0.00'
  wsResumen.getColumn('exactKg').numFmt = '#,##0.00'
  wsResumen.getColumn('estKg').numFmt = '#,##0.00'
  wsResumen.getColumn('totalKg').numFmt = '#,##0.00'
  wsResumen.getColumn('avg').numFmt = '#,##0.00'

  // Hoja 2: Detalle tabular completo
  const wsDetalle = wb.addWorksheet('Detalle de compras')
  wsDetalle.columns = [
    { header: 'Cliente', key: 'client', width: 28 },
    { header: 'CI / NIT', key: 'code', width: 14 },
    { header: 'Ruta', key: 'route', width: 16 },
    { header: 'Producto', key: 'product', width: 28 },
    { header: 'Detalle de presentación', key: 'presentation', width: 26 },
    { header: 'Unidad', key: 'unit', width: 10 },
    { header: 'Cantidad', key: 'qty', width: 12 },
    { header: 'Kg exactos', key: 'exactKg', width: 14 },
    { header: 'Kg estimados', key: 'estKg', width: 14 },
    { header: 'Precio unitario (Bs)', key: 'price', width: 18 },
    { header: 'Subtotal (Bs)', key: 'subtotal', width: 16 },
  ]

  wsDetalle.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  wsDetalle.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }

  DEMO_CLIENTS.forEach((c) => {
    c.products.forEach((p) => {
      wsDetalle.addRow({
        client: c.name,
        code: c.code,
        route: c.route,
        product: p.name,
        presentation: p.presentation,
        unit: p.unitType === 'kg' ? 'kg' : 'paq',
        qty: p.qty,
        exactKg: p.exactKg,
        estKg: p.estimatedKg,
        price: p.price,
        subtotal: p.subtotal,
      })
    })
  })

  wsDetalle.getColumn('qty').numFmt = '#,##0.00'
  wsDetalle.getColumn('exactKg').numFmt = '#,##0.00'
  wsDetalle.getColumn('estKg').numFmt = '#,##0.00'
  wsDetalle.getColumn('price').numFmt = '#,##0.00'
  wsDetalle.getColumn('subtotal').numFmt = '#,##0.00'

  const filePath = path.join(OUTPUT_DIR, 'muestra-compras-por-cliente.xlsx')
  await wb.xlsx.writeFile(filePath)
  console.log('✓ Creado:', filePath)
}

// --------------------------------------------------------------------------
// 6. EXCEL — MUESTRA: ESTRUCTURA DE REPORTES GENERALES (CORREGIDO)
// --------------------------------------------------------------------------
async function generateExcelReportesGenerales() {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Embutidos San José'
  wb.created = new Date()

  // Hoja 1: Resultado del Periodo
  const wsRes = wb.addWorksheet('Resultado del periodo')
  wsRes.columns = [
    { header: 'Paso', key: 'step', width: 8 },
    { header: 'Concepto operativo', key: 'concept', width: 45 },
    { header: 'Descripción del cálculo', key: 'detail', width: 50 },
    { header: 'Importe (Bs)', key: 'amount', width: 20 },
  ]
  wsRes.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  wsRes.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC8102E' } }

  wsRes.addRow({ step: '1', concept: 'Ventas brutas antes de devoluciones', detail: 'Total ventas iniciales del periodo', amount: DEMO_FINANCIALS.grossSales })
  wsRes.addRow({ step: '2', concept: '(-) Ajustes por cambios y devoluciones', detail: 'Devoluciones y productos compensados', amount: DEMO_FINANCIALS.returnsDelta })
  const rNet = wsRes.addRow({ step: '3', concept: '(=) VENTAS NETAS', detail: 'Ingreso comercial real tras devoluciones', amount: { formula: 'D2+D3' } })
  rNet.font = { bold: true }
  rNet.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } }

  wsRes.addRow({ step: '4', concept: '(-) Costo de producción de productos vendidos y reemplazos', detail: 'Costo histórico registrado de lo vendido', amount: -DEMO_FINANCIALS.productionCost })
  const rMargin = wsRes.addRow({ step: '5', concept: '(=) MARGEN BRUTO', detail: 'Diferencia directa entre ventas y costo de producción', amount: { formula: 'D4+D5' } })
  rMargin.font = { bold: true }
  rMargin.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } }

  wsRes.addRow({ step: '6', concept: '(-) Gastos registrados de ruta', detail: 'Combustible, viáticos y gastos validados', amount: -DEMO_FINANCIALS.expenses })
  wsRes.addRow({ step: '7', concept: '(-) Pérdidas y mermas registradas', detail: 'Faltantes en conciliaciones y mermas de almacén', amount: -DEMO_FINANCIALS.inventoryLosses })

  const rOp = wsRes.addRow({ step: '8', concept: '(=) RESULTADO OPERATIVO ESTIMADO / GANANCIA OPERATIVA', detail: 'Ganancia operativa estimada del periodo', amount: { formula: 'D6+D7+D8' } })
  rOp.font = { bold: true, size: 11, color: { argb: 'FF991B1B' } }
  rOp.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } }

  wsRes.getColumn('amount').numFmt = '#,##0.00;[Red]-#,##0.00'

  // Hoja 2: Ventas
  const wsVentas = wb.addWorksheet('Ventas')
  wsVentas.columns = [
    { header: 'Fecha y hora', key: 'date', width: 18 },
    { header: 'N° Recibo', key: 'receipt', width: 14 },
    { header: 'Vendedor', key: 'seller', width: 20 },
    { header: 'Ruta', key: 'route', width: 18 },
    { header: 'Cliente', key: 'customer', width: 28 },
    { header: 'CI / NIT', key: 'ci', width: 12 },
    { header: 'Efectivo (Bs)', key: 'cash', width: 16 },
    { header: 'QR (Bs)', key: 'qr', width: 16 },
    { header: 'Crédito (Bs)', key: 'credit', width: 16 },
    { header: 'Total (Bs)', key: 'total', width: 18 },
  ]
  wsVentas.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  wsVentas.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }

  const demoSales = [
    { date: '01/10/2026 08:45', receipt: 'VT-0038', seller: 'Hugo Herbas', route: 'Zona Norte', customer: 'Supermercado Doña Julia', ci: '4892019', cash: 1920, qr: 0, credit: 0, total: 1920 },
    { date: '02/10/2026 09:15', receipt: 'VT-0042', seller: 'Hugo Herbas', route: 'Zona Norte', customer: 'Supermercado Doña Julia', ci: '4892019', cash: 0, qr: 1000, credit: 1235, total: 2235 },
    { date: '02/10/2026 10:00', receipt: 'VT-0043', seller: 'Ricardo Jimenez', route: 'Zona Sud', customer: 'Almacén Don Pedro', ci: '7721890', cash: 1440, qr: 0, credit: 0, total: 1440 },
    { date: '03/10/2026 11:30', receipt: 'VT-0048', seller: 'Ricardo Jimenez', route: 'Sacaba', customer: 'Frialsur Los Andes', ci: '3019284', cash: 1500, qr: 1650, credit: 0, total: 3150 },
    { date: '04/10/2026 14:10', receipt: 'VT-0055', seller: 'Hugo Herbas', route: 'Zona Norte', customer: 'Supermercado Doña Julia', ci: '4892019', cash: 1000, qr: 0, credit: 1259, total: 2259 },
    { date: '05/10/2026 10:20', receipt: 'VT-0062', seller: 'Ricardo Jimenez', route: 'Zona Sud', customer: 'Almacén Don Pedro', ci: '7721890', cash: 0, qr: 500, credit: 820, total: 1320 },
  ]

  demoSales.forEach((s) => wsVentas.addRow(s))
  const vTotal = wsVentas.addRow({
    date: 'TOTAL',
    cash: { formula: 'SUM(G2:G7)' },
    qr: { formula: 'SUM(H2:H7)' },
    credit: { formula: 'SUM(I2:I7)' },
    total: { formula: 'SUM(J2:J7)' },
  })
  vTotal.font = { bold: true }
  vTotal.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDECEE' } }
  ;['cash', 'qr', 'credit', 'total'].forEach((col) => (wsVentas.getColumn(col).numFmt = '#,##0.00'))

  const filePath = path.join(OUTPUT_DIR, 'muestra-reportes-generales.xlsx')
  await wb.xlsx.writeFile(filePath)
  console.log('✓ Creado:', filePath)
}

// --------------------------------------------------------------------------
// 7. HTML MOCKUPS INTERACTIVOS (SIN EMOJIS, 5 CATEGORÍAS PRINCIPALES)
// --------------------------------------------------------------------------

function generateHtmlMockupResultadoPeriodo() {
  const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Mockup: Rediseño de Reportes - Embutidos San José</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/lucide@latest"></script>
  <style>
    :root { --primary: #c8102e; }
  </style>
</head>
<body class="bg-slate-100 font-sans text-slate-800 p-4 md:p-8">
  <div class="max-w-4xl mx-auto space-y-6">

    <!-- Header con 5 Categorías Principales Únicas -->
    <header class="bg-white rounded-3xl p-6 shadow-sm border border-slate-200">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-5">
        <div>
          <span class="text-xs font-black tracking-widest text-[#c8102e] uppercase">Embutidos San José</span>
          <h1 class="text-2xl font-black text-slate-900">Reportes</h1>
          <p class="text-xs text-slate-500 font-medium">Periodo actual: 01/10/2026 al 06/10/2026 · Todas las rutas</p>
        </div>
        <div class="flex gap-2">
          <button class="bg-[#c8102e] text-white px-4 py-2.5 rounded-2xl text-xs font-bold hover:bg-red-700 transition shadow-sm flex items-center gap-2">
            <i data-lucide="file-spreadsheet" class="w-4 h-4"></i>
            Descargar Excel
          </button>
          <button class="bg-white border-2 border-slate-200 text-slate-700 px-4 py-2.5 rounded-2xl text-xs font-bold hover:bg-slate-50 transition flex items-center gap-2">
            <i data-lucide="printer" class="w-4 h-4"></i>
            PDF para imprimir
          </button>
        </div>
      </div>

      <!-- CINCO CATEGORÍAS PRINCIPALES ÚNICAS -->
      <div class="mt-4">
        <p class="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-2">Categorías principales</p>
        <div class="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
          <button class="px-3 py-2.5 rounded-2xl font-bold bg-[#c8102e] text-white text-center shadow-sm flex items-center justify-center gap-1.5">
            <i data-lucide="pie-chart" class="w-3.5 h-3.5"></i> Resumen
          </button>
          <button class="px-3 py-2.5 rounded-2xl font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 text-center transition flex items-center justify-center gap-1.5">
            <i data-lucide="wallet" class="w-3.5 h-3.5"></i> Dinero
          </button>
          <button class="px-3 py-2.5 rounded-2xl font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 text-center transition flex items-center justify-center gap-1.5">
            <i data-lucide="shopping-cart" class="w-3.5 h-3.5"></i> Ventas
          </button>
          <button class="px-3 py-2.5 rounded-2xl font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 text-center transition flex items-center justify-center gap-1.5">
            <i data-lucide="credit-card" class="w-3.5 h-3.5"></i> Créditos
          </button>
          <button class="px-3 py-2.5 rounded-2xl font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 text-center transition flex items-center justify-center gap-1.5">
            <i data-lucide="boxes" class="w-3.5 h-3.5"></i> Inventario
          </button>
        </div>
      </div>
    </header>

    <!-- BLOQUE DESTACADO: RESULTADO DEL PERIODO -->
    <section class="bg-white rounded-3xl p-6 shadow-sm border border-slate-200 space-y-6">
      <div class="flex items-center justify-between">
        <div>
          <span class="text-[10px] font-black uppercase tracking-wider text-slate-400">Rendimiento Operativo</span>
          <h2 class="text-xl font-black text-slate-900">Resultado del Periodo</h2>
        </div>
        <span class="bg-emerald-50 text-emerald-700 text-xs font-black px-3 py-1 rounded-full border border-emerald-200 flex items-center gap-1">
          <i data-lucide="check-circle" class="w-3.5 h-3.5"></i> COSTOS COMPLETOS
        </span>
      </div>

      <!-- Tarjeta Gigante: Resultado Operativo Estimado / Ganancia Operativa Estimada -->
      <div class="bg-gradient-to-br from-red-50 to-rose-50 border-2 border-red-200 rounded-3xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <span class="text-xs font-black uppercase tracking-wider text-red-700 flex items-center gap-1.5">
            <i data-lucide="trending-up" class="w-4 h-4"></i>
            Resultado Operativo Estimado / Ganancia Operativa Estimada
          </span>
          <div class="text-4xl md:text-5xl font-black text-[#c8102e] tracking-tight mt-1">
            Bs 6.320,00
          </div>
          <p class="text-xs font-semibold text-slate-600 mt-2">
            Rendimiento operativo tras cubrir costo de producción (Bs 10.120), gastos de ruta (Bs 1.420) y mermas (Bs 310).
          </p>
        </div>
        <div class="bg-white/90 backdrop-blur rounded-2xl p-4 border border-red-200 text-xs space-y-1.5 shrink-0 w-full md:w-auto">
          <div class="flex justify-between gap-4 font-semibold text-slate-600"><span>Cobros de cartera recibidos:</span><strong class="text-emerald-700">Bs 3.200,00</strong></div>
          <div class="flex justify-between gap-4 font-semibold text-slate-600"><span>Créditos nuevos generados:</span><strong class="text-amber-700">Bs 4.150,00</strong></div>
          <p class="text-[10px] text-slate-400 pt-1 border-t border-slate-100">* Los cobros recuperan deudas pasadas; no son ventas nuevas.</p>
        </div>
      </div>

      <!-- Desglose Operativo con Símbolos Matemáticos -->
      <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div class="bg-slate-50 border border-slate-200 rounded-2xl p-3.5">
          <span class="text-[10px] font-bold text-slate-400 uppercase">1. Ventas netas</span>
          <div class="text-lg font-black text-slate-900 mt-1">Bs 18.170,00</div>
          <span class="text-[10px] text-slate-500 font-medium">Tras devoluciones</span>
        </div>
        <div class="bg-slate-50 border border-slate-200 rounded-2xl p-3.5">
          <span class="text-[10px] font-bold text-slate-400 uppercase">2. Costo producción</span>
          <div class="text-lg font-black text-rose-700 mt-1">- Bs 10.120,00</div>
          <span class="text-[10px] text-slate-500 font-medium">De lo vendido/reemplazos</span>
        </div>
        <div class="bg-amber-50 border border-amber-200 rounded-2xl p-3.5">
          <span class="text-[10px] font-bold text-amber-800 uppercase">= Margen bruto</span>
          <div class="text-lg font-black text-amber-900 mt-1">Bs 8.050,00</div>
          <span class="text-[10px] text-amber-700 font-medium">Ventas netas − costo</span>
        </div>
        <div class="bg-slate-50 border border-slate-200 rounded-2xl p-3.5">
          <span class="text-[10px] font-bold text-slate-400 uppercase">3. Gastos de ruta</span>
          <div class="text-lg font-black text-rose-700 mt-1">- Bs 1.420,00</div>
          <span class="text-[10px] text-slate-500 font-medium">Combustible/viáticos</span>
        </div>
        <div class="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 col-span-2 md:col-span-1">
          <span class="text-[10px] font-bold text-slate-400 uppercase">4. Pérdidas/Mermas</span>
          <div class="text-lg font-black text-rose-700 mt-1">- Bs 310,00</div>
          <span class="text-[10px] text-slate-500 font-medium">Faltantes auditados</span>
        </div>
      </div>

      <!-- Guía Explicativa para Administración (Sin lenguaje de estado contable formal) -->
      <div class="border border-slate-200 rounded-2xl p-4 bg-slate-50/60">
        <h4 class="text-xs font-black text-slate-900 uppercase tracking-wide flex items-center gap-2">
          <i data-lucide="help-circle" class="w-4 h-4 text-slate-500"></i>
          Guía de consulta para Administración (Cómo entender este reporte)
        </h4>
        <dl class="grid md:grid-cols-2 gap-3 mt-3 text-xs">
          <div class="bg-white p-3 rounded-xl border border-slate-200">
            <dt class="font-bold text-slate-900">Ventas antes de devoluciones</dt>
            <dd class="text-slate-600 mt-0.5">Total vendido inicialmente. Cualquier devolución o cambio en ruta se resta para reflejar las ventas netas reales.</dd>
          </div>
          <div class="bg-white p-3 rounded-xl border border-slate-200">
            <dt class="font-bold text-slate-900">Costo de lo vendido y reemplazos</dt>
            <dd class="text-slate-600 mt-0.5">Costo de producción registrado de los productos comercializados y entregados como reemplazo.</dd>
          </div>
          <div class="bg-white p-3 rounded-xl border border-slate-200">
            <dt class="font-bold text-slate-900">Margen bruto</dt>
            <dd class="text-slate-600 mt-0.5">Diferencia entre las ventas netas y el costo de producción de los artículos entregados.</dd>
          </div>
          <div class="bg-white p-3 rounded-xl border border-slate-200">
            <dt class="font-bold text-slate-900">Cobros de cartera vs Ventas</dt>
            <dd class="text-slate-600 mt-0.5">Cobrar créditos anteriores recupera efectivo, pero NO vuelve a contarse como venta. Las ventas a crédito se registraron en su fecha original.</dd>
          </div>
        </dl>
      </div>
    </section>

  </div>
  <script>lucide.createIcons();</script>
</body>
</html>`
  const filePath = path.join(OUTPUT_DIR, 'mockup-resultado-periodo.html')
  fs.writeFileSync(filePath, html, 'utf8')
  console.log('✓ Creado:', filePath)
}

function generateHtmlMockupComprasCliente() {
  const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Mockup: Compras por Cliente - Embutidos San José</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/lucide@latest"></script>
  <style>
    :root { --primary: #c8102e; }
  </style>
</head>
<body class="bg-slate-100 font-sans text-slate-800 p-4 md:p-8">
  <div class="max-w-4xl mx-auto space-y-6">

    <header class="bg-white rounded-3xl p-6 shadow-sm border border-slate-200">
      <span class="text-xs font-black tracking-widest text-[#c8102e] uppercase">Reportes · Ventas</span>
      <h1 class="text-2xl font-black text-slate-900">Compras por Cliente</h1>
      <p class="text-xs text-slate-500 font-medium">Periodo: 01/10/2026 al 06/10/2026 · Ranking y desglose exacto de kg</p>
    </header>

    <!-- RESUMEN DESTACADO: CLIENTE QUE MÁS COMPRÓ (DATOS CONSISTENTES) -->
    <section class="bg-gradient-to-r from-red-600 to-rose-700 text-white rounded-3xl p-6 shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
      <div>
        <span class="inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-widest bg-white/20 px-3 py-1 rounded-full">
          <i data-lucide="award" class="w-3.5 h-3.5"></i> Cliente que más compró en el periodo
        </span>
        <h2 class="text-2xl md:text-3xl font-black tracking-tight mt-2">${TOP_CLIENT.name}</h2>
        <p class="text-xs text-red-100 font-semibold mt-1">CI/NIT: ${TOP_CLIENT.code} · Ruta: ${TOP_CLIENT.route} · ${TOP_CLIENT.purchasesCount} pedidos realizados</p>
      </div>
      <div class="bg-white text-slate-900 rounded-2xl p-4 shadow-sm shrink-0 grid grid-cols-3 gap-4 text-center">
        <div>
          <span class="text-[10px] font-bold text-slate-400 uppercase block">Total Bs</span>
          <strong class="text-base font-black text-[#c8102e]">${formatBs(TOP_CLIENT.totalBs)}</strong>
        </div>
        <div>
          <span class="text-[10px] font-bold text-slate-400 uppercase block">Kg exactos</span>
          <strong class="text-base font-black text-slate-900">${TOP_CLIENT.exactKg.toFixed(1)} kg</strong>
        </div>
        <div>
          <span class="text-[10px] font-bold text-slate-400 uppercase block">Kg estimados</span>
          <strong class="text-base font-black text-slate-700">${TOP_CLIENT.estimatedKg.toFixed(1)} kg</strong>
        </div>
      </div>
    </section>

    <!-- LISTADO / RANKING DE CLIENTES CON DESGLOSE CONSISTENTE -->
    <section class="bg-white rounded-3xl p-6 shadow-sm border border-slate-200 space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="text-base font-black text-slate-900">Ranking de Clientes del Periodo</h3>
        <span class="text-xs text-slate-500 font-semibold">Toca un cliente para revisar sus productos</span>
      </div>

      <!-- Item 1: Supermercado Doña Julia (Expandido con desglose) -->
      <article class="border border-red-200 bg-red-50/20 rounded-2xl overflow-hidden">
        <div class="p-4 flex flex-wrap items-center justify-between gap-3 bg-red-50/60 border-b border-red-100">
          <div>
            <span class="text-xs font-black text-red-700">#1</span>
            <strong class="text-sm font-extrabold text-slate-900 ml-1">${DEMO_CLIENTS[0].name}</strong>
            <span class="text-xs text-slate-500 ml-2">CI ${DEMO_CLIENTS[0].code} · ${DEMO_CLIENTS[0].route}</span>
          </div>
          <div class="flex items-center gap-4 text-xs font-bold">
            <span class="text-slate-600">${DEMO_CLIENTS[0].kgBreakdown}</span>
            <strong class="text-base font-black text-[#c8102e]">${formatBs(DEMO_CLIENTS[0].totalBs)}</strong>
          </div>
        </div>
        <div class="p-4 overflow-x-auto">
          <table class="w-full text-xs text-left">
            <thead>
              <tr class="text-[10px] font-bold text-slate-400 uppercase border-b border-slate-200">
                <th class="pb-2">Producto</th>
                <th class="pb-2">Detalle de presentación</th>
                <th class="pb-2 text-right">Cantidad</th>
                <th class="pb-2 text-right">Kg calculados</th>
                <th class="pb-2 text-right">Precio unitario</th>
                <th class="pb-2 text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 font-medium text-slate-700">
              ${DEMO_CLIENTS[0].products.map(p => `
              <tr>
                <td class="py-2.5 font-bold text-slate-900">${p.name}</td>
                <td class="py-2.5 text-slate-500">${p.presentation}</td>
                <td class="py-2.5 text-right font-semibold">${p.qty.toFixed(p.unitType === 'kg' ? 2 : 0)} ${p.unitType === 'kg' ? 'kg' : 'paq'}</td>
                <td class="py-2.5 text-right font-semibold">${p.unitType === 'kg' ? `${p.exactKg.toFixed(2)} kg (exacto)` : `${p.estimatedKg.toFixed(2)} kg (estimado)`}</td>
                <td class="py-2.5 text-right">${formatBs(p.price)}</td>
                <td class="py-2.5 text-right font-extrabold text-slate-900">${formatBs(p.subtotal)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </article>

      <!-- Item 2: Frialsur Los Andes -->
      <article class="border border-slate-200 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3 hover:bg-slate-50 transition cursor-pointer">
        <div>
          <span class="text-xs font-black text-slate-400">#2</span>
          <strong class="text-sm font-extrabold text-slate-900 ml-1">${DEMO_CLIENTS[1].name}</strong>
          <span class="text-xs text-slate-500 ml-2">CI ${DEMO_CLIENTS[1].code} · ${DEMO_CLIENTS[1].route}</span>
        </div>
        <div class="flex items-center gap-4 text-xs font-bold text-slate-700">
          <span>${DEMO_CLIENTS[1].kgBreakdown}</span>
          <strong class="text-base font-black text-slate-900">${formatBs(DEMO_CLIENTS[1].totalBs)}</strong>
        </div>
      </article>

      <!-- Item 3: Almacén Don Pedro -->
      <article class="border border-slate-200 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3 hover:bg-slate-50 transition cursor-pointer">
        <div>
          <span class="text-xs font-black text-slate-400">#3</span>
          <strong class="text-sm font-extrabold text-slate-900 ml-1">${DEMO_CLIENTS[2].name}</strong>
          <span class="text-xs text-slate-500 ml-2">CI ${DEMO_CLIENTS[2].code} · ${DEMO_CLIENTS[2].route}</span>
        </div>
        <div class="flex items-center gap-4 text-xs font-bold text-slate-700">
          <span>${DEMO_CLIENTS[2].kgBreakdown}</span>
          <strong class="text-base font-black text-slate-900">${formatBs(DEMO_CLIENTS[2].totalBs)}</strong>
        </div>
      </article>
    </section>

  </div>
  <script>lucide.createIcons();</script>
</body>
</html>`
  const filePath = path.join(OUTPUT_DIR, 'mockup-compras-cliente.html')
  fs.writeFileSync(filePath, html, 'utf8')
  console.log('✓ Creado:', filePath)
}

function generateHtmlMockupCierreResponsive() {
  const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Mockup: Cierre de Ruta Responsive - Embutidos San José</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/lucide@latest"></script>
  <style>
    :root { --primary: #c8102e; }
  </style>
</head>
<body class="bg-slate-100 font-sans text-slate-800 p-4 md:p-8">
  <div class="max-w-4xl mx-auto space-y-6">

    <!-- Simulador de Resolución Táctil Móvil -->
    <div class="bg-slate-900 text-white rounded-3xl p-5 shadow-lg flex flex-wrap items-center justify-between gap-4">
      <div>
        <h2 class="text-sm font-black uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
          <i data-lucide="smartphone" class="w-4 h-4"></i> Simulador Responsive de Cierre de Ruta
        </h2>
        <p class="text-xs text-slate-300">Prueba cómo se adaptan las tarjetas sin partir palabras letra por letra:</p>
      </div>
      <div class="flex gap-2 text-xs">
        <button onclick="setSimWidth('340px')" class="bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-xl font-bold border border-slate-700">Móvil estrecho (340px: 1 col)</button>
        <button onclick="setSimWidth('440px')" class="bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-xl font-bold border border-slate-700">Móvil estándar (440px: 2 col)</button>
        <button onclick="setSimWidth('100%')" class="bg-[#c8102e] px-3 py-1.5 rounded-xl font-bold">Pantalla completa (3+ col)</button>
      </div>
    </div>

    <!-- CONTENEDOR SIMULADO -->
    <div id="sim-container" class="mx-auto transition-all duration-300 space-y-4" style="max-width: 100%;">

      <header class="bg-white rounded-3xl p-5 shadow-sm border border-slate-200">
        <div class="flex items-center justify-between">
          <div>
            <span class="text-[10px] font-black uppercase tracking-wider text-[#c8102e]">Cierre de Ruta</span>
            <h1 class="text-lg font-black text-slate-900">Zona Norte · Hugo Herbas</h1>
          </div>
          <span class="text-xs bg-amber-50 text-amber-800 border border-amber-200 font-black px-3 py-1 rounded-full flex items-center gap-1">
            <i data-lucide="clock" class="w-3.5 h-3.5"></i> DESPACHO ABIERTO
          </span>
        </div>
      </header>

      <!-- SECCIÓN: PRODUCTOS DEVUELTOS CON RESPONSIVE REAL -->
      <section class="bg-white rounded-3xl p-5 shadow-sm border border-slate-200 space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-black text-slate-900">Productos devueltos</h2>
          <span class="text-[11px] text-slate-500 font-semibold">Almacén confirmará conteo físico</span>
        </div>

        <!-- Buscador funcional -->
        <div class="relative">
          <i data-lucide="search" class="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2"></i>
          <input type="text" placeholder="Buscar producto sin perder cantidades..." class="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-10 pr-4 py-2.5 text-xs font-medium focus:outline-none focus:border-[#c8102e]" />
        </div>

        <!-- REGLA RESPONSIVE DEFINITIVA:
             En móvil muy estrecho: 1 columna completa (grid-cols-1)
             En móvil ancho / tablet: 2 columnas (sm:grid-cols-2)
             En tablet grande / PC: 3 columnas (lg:grid-cols-3)
             Ancho mínimo garantizado de tarjeta: min-w-[260px]
             NUNCA permite que las palabras se partan letra por letra -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">

          <!-- TARJETA 1 -->
          <div class="w-full min-w-0 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm hover:border-slate-300 transition">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0 flex-1">
                <p class="text-xs font-black text-slate-900 leading-snug line-clamp-2">
                  Chorizo parrillero crudo
                </p>
                <p class="text-[10px] font-semibold text-slate-500">Paquete al vacío de 500 g</p>
              </div>
              <span class="inline-flex shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-black text-slate-500 whitespace-nowrap">
                SIN DECLARAR
              </span>
            </div>

            <!-- Grilla de 4 métricas perfectamente legibles -->
            <dl class="mt-3 grid grid-cols-4 gap-1.5 bg-slate-50 p-2.5 rounded-xl text-center">
              <div>
                <dt class="text-[9px] font-bold uppercase text-slate-400">Enviado</dt>
                <dd class="text-xs font-black tabular-nums text-slate-800">50 kg</dd>
              </div>
              <div>
                <dt class="text-[9px] font-bold uppercase text-amber-700">Aumentos</dt>
                <dd class="text-xs font-black tabular-nums text-amber-800">+25 kg</dd>
              </div>
              <div>
                <dt class="text-[9px] font-bold uppercase text-slate-400">Vendido</dt>
                <dd class="text-xs font-black tabular-nums text-slate-800">70 kg</dd>
              </div>
              <div>
                <dt class="text-[9px] font-bold uppercase text-[#c8102e]">Debe volver</dt>
                <dd class="text-xs font-black tabular-nums text-[#c8102e]">5 kg</dd>
              </div>
            </dl>

            <div class="mt-3">
              <label class="block text-[10px] font-extrabold uppercase text-slate-500 mb-1">
                Retornado (kg)
              </label>
              <input type="number" placeholder="0" class="w-full bg-white border-2 border-slate-200 focus:border-[#c8102e] rounded-xl px-3 py-2 text-sm font-black text-center focus:outline-none" />
            </div>
          </div>

          <!-- TARJETA 2 -->
          <div class="w-full min-w-0 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm hover:border-slate-300 transition">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0 flex-1">
                <p class="text-xs font-black text-slate-900 leading-snug line-clamp-2">
                  Salchicha tipo Viena
                </p>
                <p class="text-[10px] font-semibold text-slate-500">Granel</p>
              </div>
              <span class="inline-flex shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700 whitespace-nowrap">
                CUADRADO
              </span>
            </div>

            <dl class="mt-3 grid grid-cols-4 gap-1.5 bg-slate-50 p-2.5 rounded-xl text-center">
              <div>
                <dt class="text-[9px] font-bold uppercase text-slate-400">Enviado</dt>
                <dd class="text-xs font-black tabular-nums text-slate-800">60 kg</dd>
              </div>
              <div>
                <dt class="text-[9px] font-bold uppercase text-amber-700">Aumentos</dt>
                <dd class="text-xs font-black tabular-nums text-amber-800">+20 kg</dd>
              </div>
              <div>
                <dt class="text-[9px] font-bold uppercase text-slate-400">Vendido</dt>
                <dd class="text-xs font-black tabular-nums text-slate-800">80 kg</dd>
              </div>
              <div>
                <dt class="text-[9px] font-bold uppercase text-[#c8102e]">Debe volver</dt>
                <dd class="text-xs font-black tabular-nums text-[#c8102e]">0 kg</dd>
              </div>
            </dl>

            <div class="mt-3">
              <label class="block text-[10px] font-extrabold uppercase text-slate-500 mb-1">
                Retornado (kg)
              </label>
              <input type="number" value="0" class="w-full bg-white border-2 border-slate-200 focus:border-[#c8102e] rounded-xl px-3 py-2 text-sm font-black text-center focus:outline-none" />
            </div>
          </div>

          <!-- TARJETA 3 -->
          <div class="w-full min-w-0 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm hover:border-slate-300 transition">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0 flex-1">
                <p class="text-xs font-black text-slate-900 leading-snug line-clamp-2">
                  Mortadela jamonada
                </p>
                <p class="text-[10px] font-semibold text-slate-500">Sachet de 200 g</p>
              </div>
              <span class="inline-flex shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-black text-slate-500 whitespace-nowrap">
                SIN DECLARAR
              </span>
            </div>

            <dl class="mt-3 grid grid-cols-4 gap-1.5 bg-slate-50 p-2.5 rounded-xl text-center">
              <div>
                <dt class="text-[9px] font-bold uppercase text-slate-400">Enviado</dt>
                <dd class="text-xs font-black tabular-nums text-slate-800">35 paq</dd>
              </div>
              <div>
                <dt class="text-[9px] font-bold uppercase text-amber-700">Aumentos</dt>
                <dd class="text-xs font-black tabular-nums text-amber-800">+15 paq</dd>
              </div>
              <div>
                <dt class="text-[9px] font-bold uppercase text-slate-400">Vendido</dt>
                <dd class="text-xs font-black tabular-nums text-slate-800">42 paq</dd>
              </div>
              <div>
                <dt class="text-[9px] font-bold uppercase text-[#c8102e]">Debe volver</dt>
                <dd class="text-xs font-black tabular-nums text-[#c8102e]">8 paq</dd>
              </div>
            </dl>

            <div class="mt-3">
              <label class="block text-[10px] font-extrabold uppercase text-slate-500 mb-1">
                Retornado (paquetes)
              </label>
              <input type="number" placeholder="0" class="w-full bg-white border-2 border-slate-200 focus:border-[#c8102e] rounded-xl px-3 py-2 text-sm font-black text-center focus:outline-none" />
            </div>
          </div>

        </div>
      </section>

      <!-- Botón de Acción -->
      <button class="w-full bg-[#c8102e] text-white py-3.5 rounded-2xl font-black text-sm shadow-md hover:bg-red-700 transition flex items-center justify-center gap-2">
        <i data-lucide="check" class="w-4 h-4"></i>
        Declarar devolución física
      </button>

    </div>

  </div>

  <script>
    lucide.createIcons();
    function setSimWidth(w) {
      document.getElementById('sim-container').style.maxWidth = w;
    }
  </script>
</body>
</html>`
  const filePath = path.join(OUTPUT_DIR, 'mockup-cierre-responsive.html')
  fs.writeFileSync(filePath, html, 'utf8')
  console.log('✓ Creado:', filePath)
}

async function run() {
  generatePdfResultadoPeriodo()
  generatePdfComprasPorCliente()
  generatePdfKardexPorProducto()
  generatePdfDespachoConAumentos()
  await generateExcelComprasPorCliente()
  await generateExcelReportesGenerales()
  generateHtmlMockupResultadoPeriodo()
  generateHtmlMockupComprasCliente()
  generateHtmlMockupCierreResponsive()
  console.log('Todas las muestras corregidas se han generado con éxito.')
}

run().catch((err) => {
  console.error('Error generando muestras corregidas:', err)
  process.exit(1)
})
