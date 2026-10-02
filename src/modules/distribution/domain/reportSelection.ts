export type ReportSheetId =
  | 'summary'
  | 'sales'
  | 'products'
  | 'credits'
  | 'collections'
  | 'expenses'
  | 'closures'
  | 'inventory'
  | 'movements'
  | 'transfers'
  | 'claims'

export interface ReportOption {
  id: ReportSheetId
  label: string
  sheetName: string
}

export const REPORT_OPTIONS: readonly ReportOption[] = [
  { id: 'summary', label: 'Resumen', sheetName: 'Resumen' },
  { id: 'sales', label: 'Ventas', sheetName: 'Ventas' },
  { id: 'products', label: 'Productos vendidos', sheetName: 'Productos vendidos' },
  { id: 'credits', label: 'Créditos', sheetName: 'Créditos' },
  { id: 'collections', label: 'Cobros', sheetName: 'Cobros' },
  { id: 'expenses', label: 'Gastos', sheetName: 'Gastos' },
  { id: 'closures', label: 'Arqueos', sheetName: 'Arqueos' },
  { id: 'inventory', label: 'Inventario por lote', sheetName: 'Inventario por lote' },
  { id: 'movements', label: 'Movimientos', sheetName: 'Movimientos' },
  { id: 'transfers', label: 'Transferencias', sheetName: 'Transferencias' },
  { id: 'claims', label: 'Cambios y devoluciones', sheetName: 'Cambios y devoluciones' },
] as const

export const ALL_REPORT_IDS: ReportSheetId[] = REPORT_OPTIONS.map(opt => opt.id)

export const SHEET_NAME_TO_ID: Record<string, ReportSheetId> = Object.fromEntries(
  REPORT_OPTIONS.map(opt => [opt.sheetName, opt.id])
)

export const ID_TO_SHEET_NAME: Record<ReportSheetId, string> = Object.fromEntries(
  REPORT_OPTIONS.map(opt => [opt.id, opt.sheetName])
) as Record<ReportSheetId, string>

/**
 * Mapeo de pestaña activa en ReportsView hacia el ID de reporte que se pre-selecciona al abrir el modal.
 */
export function defaultSheetIdForTab(tab: string): ReportSheetId {
  switch (tab) {
    case 'resumen':
      return 'summary'
    case 'ventas':
      return 'sales'
    case 'productos':
      return 'products'
    case 'creditos':
      return 'credits'
    case 'cobros':
      return 'collections'
    case 'gastos':
      return 'expenses'
    case 'arqueos':
      return 'closures'
    default:
      return 'summary'
  }
}

/**
 * Filtra las hojas generadas manteniendo estrictamente el orden original definido en `reportSheets`.
 * Devuelve únicamente las hojas cuyos identificadores se encuentren en `selectedIds`.
 */
export function filterReportSheets<T extends { name: string; id?: ReportSheetId }>(
  sheets: T[],
  selectedIds: Iterable<ReportSheetId>,
): T[] {
  const selectedSet = new Set(selectedIds)
  if (selectedSet.size === 0) return []
  return sheets.filter(sheet => {
    const id = sheet.id || SHEET_NAME_TO_ID[sheet.name]
    return id ? selectedSet.has(id) : false
  })
}
