import { jsPDF, autoTable } from '../../../lib/documentLibraries.ts'
import type { DistributionData } from '../state/useDistributionStore.ts'
import type { DistStockMovement, UnitType } from '../types.ts'
import { toDayKey } from './engine.ts'
import { getProductPresentation } from './productPresentation.ts'
import { reportPersonName, reportRecordName, reportUnitLabel } from './reportLabels.ts'

export interface TodayIntakeItem {
  movementId: string
  createdAt: string
  dateFormatted: string
  time: string
  productId: string
  productName: string
  presentation: string
  quantity: number
  unitType: UnitType
  warehouseId: string
  warehouseName: string
  lotCode: string
  manufacturedOn: string
  expiresOn: string
  responsible: string
  note: string
}

export interface TodayIntakeSummary {
  productId: string
  productName: string
  presentation: string
  unitType: UnitType
  totalQuantity: number
  movementCount: number
}

export interface TodayIntakesResult {
  dayKey: string
  dateFormatted: string
  warehouseId: string
  warehouseName: string
  items: TodayIntakeItem[]
  summary: TodayIntakeSummary[]
  totalMovements: number
  totals: { kg: number; package: number; unit: number }
}

function quantityPrecision(unitType: UnitType, value: number): number {
  const factor = unitType === 'kg' ? 1000 : 100
  return Math.round((Number(value) || 0) * factor) / factor
}

export function formatDayKeyToDate(dayKey: string): string {
  const parts = dayKey.split('-')
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`
  }
  return dayKey
}

export function formatTimeFromIso(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '--:--'
  return date.toLocaleTimeString('es-BO', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/**
 * Obtiene de forma determinista y auditable los ingresos de stock del día actual,
 * respetando el alcance del almacén y manteniendo intacta la trazabilidad de cada movimiento.
 */
export function getTodayStockIntakes(
  data: Pick<DistributionData, 'movements' | 'products' | 'lots' | 'warehouses'>,
  warehouseId = 'central',
  targetDayKey?: string | string[],
): TodayIntakesResult {
  const dayKeys = Array.isArray(targetDayKey) ? targetDayKey : targetDayKey ? [targetDayKey] : [toDayKey(new Date())]
  const dayKey = dayKeys[0] || toDayKey(new Date())
  const dateFormatted = dayKeys.length === 1
    ? formatDayKeyToDate(dayKey)
    : `${formatDayKeyToDate(dayKeys[0])} a ${formatDayKeyToDate(dayKeys[dayKeys.length - 1])}`

  const warehouseName =
    warehouseId === 'central'
      ? 'Almacén central'
      : data.warehouses.find((w) => w.id === warehouseId)?.name || 'Almacén interno'

  const targetLocation =
    warehouseId === 'central'
      ? 'central'
      : warehouseId.startsWith('warehouse__')
        ? warehouseId
        : `warehouse__${warehouseId}`

  // Filtro estricto: solo movimientos 'intake', de la fecha local indicada, para el almacén solicitado
  const matchedMovements = data.movements
    .filter((m: DistStockMovement) => {
      if (m.type !== 'intake') return false
      if (m.pendingConfirmation || m.reversedAt) return false

      const movementDay = m.dayKey || toDayKey(m.createdAt)
      if (!dayKeys.includes(movementDay)) return false

      if (warehouseId === 'central') {
        return !m.toLocation || m.toLocation === 'central' || m.centralDelta > 0
      }
      return m.toLocation === targetLocation
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  const items: TodayIntakeItem[] = matchedMovements.map((m) => {
    const product = data.products.find((p) => p.id === m.productId)
    const presentation = getProductPresentation(product)

    // Búsqueda del lote registrado asociado
    const lotId = (m as { lotId?: string }).lotId
    const lot =
      (lotId ? data.lots.find((l) => l.id === lotId) : undefined) ||
      (m.lotCode
        ? data.lots.find((l) => l.productId === m.productId && l.lotCode === m.lotCode)
        : undefined)

    const manufacturedOn = lot?.manufacturedOn || (m as { manufacturedOn?: string }).manufacturedOn || ''
    const expiresOn = lot?.expiresOn || (m as { expiresOn?: string }).expiresOn || ''
    const lotCode = m.lotCode || lot?.lotCode || 'Sin lote'

    const visibleName = reportPersonName(m.responsibleName || m.createdBy)
    const role =
      m.responsibleRole === 'admin'
        ? 'Administración'
        : m.responsibleRole === 'warehouse'
          ? 'Almacén'
          : 'Usuario'
    const responsible =
      visibleName === 'Usuario de registro anterior'
        ? visibleName
        : m.responsibleRole
          ? `${role} · ${visibleName}`
          : visibleName

    return {
      movementId: m.id,
      createdAt: m.createdAt,
      dateFormatted: formatDayKeyToDate(m.dayKey || toDayKey(m.createdAt)),
      time: formatTimeFromIso(m.createdAt),
      productId: m.productId,
      productName: reportRecordName(m.productName, product?.name || 'Producto'),
      presentation,
      quantity: quantityPrecision(m.unitType, m.quantity),
      unitType: m.unitType,
      warehouseId,
      warehouseName,
      lotCode,
      manufacturedOn,
      expiresOn,
      responsible,
      note: m.note || '',
    }
  })

  // Resumen agrupado por producto y unidad sin mezclar unidades incompatibles
  const summaryMap = new Map<string, TodayIntakeSummary>()
  for (const item of items) {
    const key = `${item.productId}__${item.unitType}`
    const existing = summaryMap.get(key)
    if (existing) {
      existing.totalQuantity = quantityPrecision(existing.unitType, existing.totalQuantity + item.quantity)
      existing.movementCount += 1
    } else {
      summaryMap.set(key, {
        productId: item.productId,
        productName: item.productName,
        presentation: item.presentation,
        unitType: item.unitType,
        totalQuantity: item.quantity,
        movementCount: 1,
      })
    }
  }

  const summary = [...summaryMap.values()].sort((a, b) =>
    a.productName.localeCompare(b.productName),
  )
  const totals = { kg: 0, package: 0, unit: 0 }
  for (const item of items) totals[item.unitType] = quantityPrecision(item.unitType, totals[item.unitType] + item.quantity)

  return {
    dayKey,
    dateFormatted,
    warehouseId,
    warehouseName,
    items,
    summary,
    totalMovements: items.length,
    totals,
  }
}

interface AutoTableJsPDF {
  lastAutoTable: {
    finalY: number
  }
}

function drawBrandedPdfHeader(pdf: jsPDF, title: string, subtitle?: string) {
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

/**
 * Genera el documento PDF con membrete institucional conteniendo exclusivamente
 * los ingresos de inventario realizados durante el día actual.
 */
export async function generateTodayIntakesPdfBytes(
  data: Pick<DistributionData, 'movements' | 'products' | 'lots' | 'warehouses'>,
  warehouseId = 'central',
  targetDayKey?: string | string[],
): Promise<Uint8Array> {
  const intakes = getTodayStockIntakes(data, warehouseId, targetDayKey)
  if (intakes.items.length === 0) {
    throw new Error('No hay ingresos de inventario confirmados para el periodo seleccionado.')
  }


  const pdf = new jsPDF({ orientation: 'landscape', format: 'letter' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()

  const subtitle = `Fecha: ${intakes.dateFormatted}  ·  Almacén: ${intakes.warehouseName}  ·  Total movimientos: ${intakes.totalMovements}`
  drawBrandedPdfHeader(pdf, 'INGRESOS DE INVENTARIO', subtitle)

  // 1. Resumen ingresado hoy (agrupado por producto y unidad)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(8.5)
  pdf.setTextColor(30, 41, 59)
  pdf.text('1. Resumen de ingresos (agrupado por producto y unidad)', 14, 34)

  autoTable(pdf, {
    startY: 37,
    head: [['Producto', 'Detalle de presentación', 'Total ingresado', 'Unidad', 'Movimientos']],
    body: intakes.summary.map((s) => [
      s.productName,
      s.presentation || 'Estándar',
      s.totalQuantity,
      reportUnitLabel(s.unitType),
      String(s.movementCount),
    ]),
    theme: 'grid',
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
    bodyStyles: { fontSize: 7.5, cellPadding: 2 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 53, fontStyle: 'bold' },
      1: { cellWidth: 42, textColor: [71, 85, 105] },
      2: { cellWidth: 30, halign: 'right', fontStyle: 'bold' },
      3: { cellWidth: 25 },
      4: { cellWidth: 28, halign: 'center' },
    },
    tableWidth: 178,
    margin: { left: 14, right: 14 },
  })

  // 2. Detalle de ingresos individuales
  let detailStartY = (pdf as unknown as AutoTableJsPDF).lastAutoTable.finalY + 8
  if (detailStartY > 220) {
    pdf.addPage('letter', 'landscape')
    drawBrandedPdfHeader(pdf, 'DETALLE DE INGRESOS (CONTINUACIÓN)', subtitle)
    detailStartY = 33
  }

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(8.5)
  pdf.setTextColor(30, 41, 59)
  pdf.text('2. Detalle de ingresos (movimientos individuales)', 14, detailStartY)

  autoTable(pdf, {
    startY: detailStartY + 4,
    head: [['Fecha/hora', 'Producto', 'Presentación', 'Cantidad', 'Unidad', 'Almacén', 'Lote', 'F. Elab.', 'F. Venc.', 'Responsable', 'Observación']],
    body: intakes.items.map((item) => [
      `${item.dateFormatted} ${item.time}`,
      item.productName,
      item.presentation || '—',
      item.quantity,
      reportUnitLabel(item.unitType),
      item.warehouseName,
      item.lotCode || '—',
      item.manufacturedOn ? (item.manufacturedOn.includes('-') ? item.manufacturedOn.split('-').reverse().join('/') : item.manufacturedOn) : '—',
      item.expiresOn ? (item.expiresOn.includes('-') ? item.expiresOn.split('-').reverse().join('/') : item.expiresOn) : '—',
      item.responsible,
      item.note || '—',
    ]),
    theme: 'grid',
    headStyles: { fillColor: [71, 85, 105], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7, cellPadding: 2 },
    bodyStyles: { fontSize: 7, cellPadding: 1.8, overflow: 'linebreak' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 20, halign: 'center' },
      1: { cellWidth: 30, fontStyle: 'bold' },
      2: { cellWidth: 18, textColor: [71, 85, 105] },
      3: { cellWidth: 14, halign: 'right', fontStyle: 'bold' },
      4: { cellWidth: 10 },
      5: { cellWidth: 16 },
      6: { cellWidth: 15, fontStyle: 'bold' },
      7: { cellWidth: 16 },
      8: { cellWidth: 16 },
      9: { cellWidth: 22 },
      10: { cellWidth: 30 },
    },
    tableWidth: 207,
    margin: { left: 14, right: 14 },
  })

  // Pie de página institucional en todas las páginas
  const totalPages = pdf.getNumberOfPages()
  const nowStr = new Date().toLocaleString('es-BO')
  for (let p = 1; p <= totalPages; p++) {
    pdf.setPage(p)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7.5)
    pdf.setTextColor(148, 163, 184)
    pdf.text(`Generado el: ${nowStr} · Embutidos San José`, 14, pageHeight - 7)
    pdf.text(`Página ${p} de ${totalPages}`, pageWidth - 28, pageHeight - 7)
  }

  return new Uint8Array(pdf.output('arraybuffer'))
}

