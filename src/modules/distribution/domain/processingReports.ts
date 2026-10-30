import type { ProcessingBatch, ProcessingRepackRecord, ProcessingReviewRecord } from './processing'
import type { DistLot, DistProduct } from '../types'

export interface ProcessingReportFilters {
  from?: string
  to?: string
  productId?: string
  sourceLot?: string
  outputLot?: string
  location?: string
  responsible?: string
  processType?: string
  status?: string
}

const dateKey = (value?: string) => {
  if (!value) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}
const money = (cents?: number | null) => cents == null ? 'No disponible' : `Bs ${(cents / 100).toFixed(2)}`
const kg = (grams: number) => `${(grams / 1000).toFixed(3)} kg`
const processName: Record<ProcessingBatch['processType'], string> = { bagging: 'Sacheteado y embolsado', portioning: 'Porcionado', repackaging: 'Reenvasado' }
const batchStatusName: Record<ProcessingBatch['status'], string> = { draft: 'Borrador', confirmed: 'Confirmado', corrected: 'Corregido', reversed: 'Revertido' }
const reviewStatusName: Record<ProcessingReviewRecord['status'], string> = { pending_review: 'Pendiente de revisión', in_review: 'En revisión', authorized_for_repack: 'Autorizado para reenvasado', not_recoverable: 'No recuperable', pending_information: 'Falta información', pending_economic_disposition: 'Pendiente de decisión económica', resolved_specialized: 'Resuelto con procedimiento especializado' }
const productName = (id: string | undefined, products: DistProduct[]) => products.find(product => product.id === id)?.name || id || 'Sin producto registrado'
const sourceLotName = (id: string, lots: DistLot[]) => lots.find(lot => lot.id === id)?.lotCode || id

/** Older repack batches store stock allocations, rather than batch-input allocations. */
export function normalizeProcessingReportBatch(batch: ProcessingBatch): ProcessingBatch {
  if (batch.processType !== 'repackaging') return batch
  const first = batch.sourceAllocations[0]
  const result = (batch as ProcessingBatch & { result?: { sourceLotId?: string; openedQuantity?: number } }).result
  const quantity = result?.openedQuantity ?? first?.quantity
  const lotId = result?.sourceLotId || first?.lotId
  if (!lotId || typeof quantity !== 'number' || !Number.isFinite(quantity) || !Number.isSafeInteger(batch.inputWeightG)) throw new Error('El reenvasado histórico no conserva datos suficientes para el informe completo.')
  return { ...batch, processingDate: batch.processingDate || batch.dayKey,
    sourceAllocations: [{ ...first, lotId, lotCode: first?.lotCode || lotId, expiresOn: first?.expiresOn || '', productionCost: first?.productionCost ?? null,
      quantity, quantityMilli: Math.round(quantity * 1000), measuredNetWeightG: batch.inputWeightG, historicalCostCents: batch.sourceCostCents ?? null,
      sourceProductId: batch.sourceProductId, sourceUnitType: batch.sourceUnitType || 'package', originStatus: 'confirmed' }],
    destinations: batch.destinations.map(destination => ({ ...destination, kind: destination.kind || 'finished' })),
  }
}

function matchesBatch(batch: ProcessingBatch, filters: ProcessingReportFilters) {
  const date = dateKey(batch.processingDate || batch.dayKey || batch.createdAt)
  if (filters.from && date < filters.from || filters.to && date > filters.to) return false
  if (filters.location && batch.sourceLocation !== filters.location) return false
  if (filters.responsible && !batch.responsibleName.toLocaleLowerCase().includes(filters.responsible.toLocaleLowerCase())) return false
  if (filters.processType && batch.processType !== filters.processType) return false
  if (filters.status && batch.status !== filters.status) return false
  if (filters.productId && batch.sourceProductId !== filters.productId && !batch.destinations.some(destination => destination.productId === filters.productId)) return false
  if (filters.sourceLot && !batch.sourceAllocations.some(source => `${source.lotCode || ''} ${source.lotId}`.toLocaleLowerCase().includes(filters.sourceLot!.toLocaleLowerCase()))) return false
  if (filters.outputLot && !batch.destinations.some(destination => `${destination.lotCode || ''} ${destination.lotId || ''}`.toLocaleLowerCase().includes(filters.outputLot!.toLocaleLowerCase()))) return false
  return true
}

export function filterProcessingBatches(rows: ProcessingBatch[], filters: ProcessingReportFilters) {
  return rows.map(normalizeProcessingReportBatch).filter(row => matchesBatch(row, filters))
}

function matchesQualityRecord(dateValue: string, productId: string, lotLabel: string, location: string, responsibleName: string, rowStatus: string, filters: ProcessingReportFilters) {
  const date = dateKey(dateValue)
  if (filters.from && date < filters.from || filters.to && date > filters.to) return false
  if (filters.productId && productId !== filters.productId) return false
  if (filters.sourceLot && !lotLabel.toLocaleLowerCase().includes(filters.sourceLot.toLocaleLowerCase())) return false
  if (filters.location && location !== filters.location) return false
  if (filters.responsible && !responsibleName.toLocaleLowerCase().includes(filters.responsible.toLocaleLowerCase())) return false
  if (filters.status && rowStatus !== filters.status) return false
  return true
}

export function filterProcessingReviews(rows: ProcessingReviewRecord[], filters: ProcessingReportFilters) {
  return rows.filter(row => matchesQualityRecord(row.reviewedAt, row.productId, `${row.lotCode} ${row.lotId}`, row.location, row.reviewedByName, row.status, filters))
}

export function filterProcessingRepackings(rows: ProcessingRepackRecord[], filters: ProcessingReportFilters, lots: DistLot[] = []) {
  return rows.filter(row => {
    const productMatches = !filters.productId || row.sourceProductId === filters.productId || row.outputLots.some(output => output.productId === filters.productId)
    const lot = lots.find(candidate => candidate.id === row.sourceLotId)
    return productMatches && matchesQualityRecord(row.confirmedAt, row.sourceProductId, `${lot?.lotCode || ''} ${row.sourceLotId}`, row.location, row.responsibleName, row.status, { ...filters, productId: undefined })
  })
}

export function buildProcessingBatchReport(rows: ProcessingBatch[], products: DistProduct[] = []) {
  return {
    name: 'Elaboraciones de sacheteado',
    headers: ['Fecha', 'Tipo', 'Producto de origen', 'Lotes de origen y aporte contable', 'Entrada neta', 'Destinos y presentaciones medidas', 'Salida neta documentada', 'Diferencia', 'Costo histórico de origen', 'Materiales (informativos)', 'Responsable', 'Almacén', 'Estado'],
    rows: rows.map(normalizeProcessingReportBatch).map(batch => {
      const outputWeight = batch.destinations.reduce((sum, row) => sum + (Number.isSafeInteger(row.netWeightG) ? row.netWeightG : 0), 0)
      const source = batch.sourceAllocations.map(row => `${row.lotCode || row.lotId}: ${kg(row.measuredNetWeightG)} · ${money(row.historicalCostCents)}`).join(' | ')
      const destinations = batch.destinations.map(row => `${productName(row.productId, products)} (${row.kind}) · lote ${row.lotCode || 'sin código'} · ${row.commercialQuantity} ${row.commercialUnit || ''} · ${kg(row.netWeightG)} netos · costo histórico ${money(row.costCents)}`).join(' | ')
      const materials = batch.packagingMaterials.map(row => `${row.description || 'Material'}: ${(row.quantityMilli / 1000).toFixed(3)} usados; ${(row.damagedQuantityMilli / 1000).toFixed(3)} dañados; ${money(row.costCents)} informativo`).join(' | ')
      return [dateKey(batch.processingDate || batch.dayKey || batch.createdAt), processName[batch.processType], batch.sourceProductName || productName(batch.sourceProductId, products), source, kg(batch.inputWeightG), destinations, kg(outputWeight), `${batch.inputWeightG - outputWeight} g`, money(batch.sourceCostCents), materials || 'Sin materiales', batch.responsibleName, batch.sourceLocation, batchStatusName[batch.status]]
    }),
  }
}

export function buildProcessingLotTraceReport(rows: ProcessingBatch[], filters: Pick<ProcessingReportFilters, 'productId' | 'outputLot'> = {}, products: DistProduct[] = [], lots: DistLot[] = []) {
  const lotsById = new Map(lots.map(lot => [lot.id, lot]))
  return {
    name: 'Trazabilidad por lote de sacheteado',
    headers: ['Lote resultante', 'Producto terminado', 'Elaboración', 'Fecha elaboración', 'Fecha embolsado', 'Vencimiento', 'Peso neto producido', 'Cantidad comercial', 'Lotes de origen y aportes contables', 'Costo histórico transferido', 'Responsable', 'Almacén', 'Estado comercial documentado'],
    rows: rows.map(normalizeProcessingReportBatch).flatMap(batch => batch.destinations.filter(destination => {
      if (filters.productId && batch.sourceProductId !== filters.productId && destination.productId !== filters.productId) return false
      if (filters.outputLot && !`${destination.lotCode || ''} ${destination.lotId || ''}`.toLocaleLowerCase().includes(filters.outputLot.toLocaleLowerCase())) return false
      return true
    }).map(destination => [
      destination.lotCode || destination.lotId || 'Sin lote resultante', productName(destination.productId, products), batch.id,
      destination.manufacturedOn || lotsById.get(destination.lotId || '')?.manufacturedOn || 'No registrado', destination.packagedOn || lotsById.get(destination.lotId || '')?.packagedOn || 'No registrado', destination.expiresOn || lotsById.get(destination.lotId || '')?.expiresOn || 'No registrado',
      kg(destination.netWeightG), `${destination.commercialQuantity} ${destination.commercialUnit || ''}`,
      (destination.sourceAllocations || []).map(source => `${source.sourceLotCode || source.sourceLotId}: ${kg(source.weightG)} · ${money(source.costCents)} · asignación contable, no identificación física`).join(' | ') || batch.sourceAllocations.map(source => `${source.lotCode || source.lotId}: ${kg(source.measuredNetWeightG)}`).join(' | '),
      money(destination.costCents), batch.responsibleName, batch.sourceLocation,
      destination.kind === 'finished' ? 'Consultar Inventario; este reporte no libera el lote' : destination.kind,
    ])),
  }
}

export function buildProcessingQualityReport(reviews: ProcessingReviewRecord[], repackings: ProcessingRepackRecord[], products: DistProduct[] = [], lots: DistLot[] = []) {
  const reviewRows = reviews.map(row => [
    'Revisión', row.productName || productName(row.productId, products), row.lotCode, `${row.commercialQuantity} ${row.commercialUnit}`,
    row.physicalWeightG == null ? 'No medido' : `${row.physicalWeightG} g`,
    row.dispositionAssessment?.recoverableWeightG == null ? 'No evaluado' : `${row.dispositionAssessment.recoverableWeightG} g propuestos`,
    'No aplica', reviewStatusName[row.status], row.evidenceRefs.length ? row.evidenceRefs.join(', ') : 'Sin evidencia',
    row.qualityAuthorizationRef || 'Sin autorización de calidad', money(row.costCents), row.economicDispositionStatus || row.reason || 'Sin disposición económica pendiente',
    row.reviewedByName, dateKey(row.reviewedAt), row.location,
  ])
  const repackRows = repackings.map(row => {
    const recoveredWeightG = row.outputLots.reduce((sum, output) => sum + output.netWeightG, 0)
    return [
    'Reenvasado', row.sourceProductName || productName(row.sourceProductId, products), sourceLotName(row.sourceLotId, lots), `${row.openedCommercialQuantity} ${row.sourceUnitType}`,
    `${row.openedPhysicalWeightG} g`, `${recoveredWeightG} g de salidas medidas · ${recoveredWeightG === row.openedPhysicalWeightG ? 'conciliado' : 'diferencia por revisar'}`,
    (row.packagingMaterials || []).map(material => `${material.description || 'Material'}: ${(material.quantityMilli / 1000).toFixed(3)} usados / ${(material.damagedQuantityMilli / 1000).toFixed(3)} dañados`).join(' | ') || 'Sin material dañado registrado', 'Reenvasado confirmado; requiere verificación comercial aparte', row.evidenceRefs.length ? row.evidenceRefs.join(', ') : 'Sin evidencia',
    row.authorizationId || 'Sin autorización registrada', money(row.sourceCostCents), 'Costo histórico transferido una sola vez; ajuste o descarte económico no aplicado',
    row.responsibleName, dateKey(row.confirmedAt), row.location,
    ]
  })
  return {
    name: 'Revisión y reenvasado de sacheteado',
    headers: ['Registro', 'Producto', 'Lote', 'Cantidad comercial abierta/reservada', 'Peso medido de entrada', 'Recuperación medida/propuesta', 'Material dañado', 'Estado de Calidad', 'Evidencia vinculada', 'Autorización', 'Costo histórico', 'Disposición económica', 'Responsable', 'Fecha', 'Almacén'],
    rows: [...reviewRows, ...repackRows],
  }
}
