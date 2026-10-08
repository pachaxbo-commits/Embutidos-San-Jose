import {
  ALL_REPORT_IDS,
  ID_TO_SHEET_NAME,
  REPORT_OPTIONS,
  SHEET_NAME_TO_ID,
  defaultSheetIdForTab,
  filterReportSheets,
  type ReportSheetId,
} from '../reportSelection.ts'

export async function runReportSelectionTestSuite() {
  const results: string[] = []
  let passed = 0
  let failed = 0

  function assert(condition: boolean, message: string) {
    if (condition) {
      passed += 1
      results.push(`  ✓ ${message}`)
    } else {
      failed += 1
      results.push(`  ✗ ${message}`)
    }
  }

  // Hojas mock que simulan las generadas por reportSheets(...)
  const mockAllSheets = REPORT_OPTIONS.map((opt) => ({
    id: opt.id,
    name: opt.sheetName,
    headers: ['Columna 1', 'Columna 2'],
    rows: [['Dato A', 'Dato B']],
  }))

  // 1. Seleccionar solo Ventas -> devuelve únicamente Ventas
  const onlySales = filterReportSheets(mockAllSheets, ['sales'])
  assert(onlySales.length === 1, 'seleccionar solo Ventas devuelve 1 hoja')
  assert(onlySales[0].id === 'sales' && onlySales[0].name === 'Ventas', 'la única hoja devuelta es Ventas')

  // 2. Seleccionar Ventas + Cobros + Gastos -> devuelve exactamente tres hojas
  const threeSheets = filterReportSheets(mockAllSheets, ['sales', 'collections', 'expenses'])
  assert(threeSheets.length === 3, 'seleccionar Ventas, Cobros y Gastos devuelve exactamente 3 hojas')
  assert(
    threeSheets.map((s) => s.id).join(',') === 'sales,collections,expenses',
    'las 3 hojas devueltas coinciden con la selección',
  )

  // 3. Seleccionar todos -> devuelve todas las hojas
  const allSelected = filterReportSheets(mockAllSheets, ALL_REPORT_IDS)
  assert(allSelected.length === REPORT_OPTIONS.length, 'seleccionar todos devuelve todas las hojas de reportes')
  assert(
    allSelected.map((s) => s.id).join(',') === ALL_REPORT_IDS.join(','),
    'todas las hojas coinciden con la totalidad del catálogo',
  )

  // 4. Selección vacía -> no devuelve hojas (bloqueo de exportación)
  const emptySelection = filterReportSheets(mockAllSheets, [])
  assert(emptySelection.length === 0, 'selección vacía devuelve array vacío (no permite exportar)')

  const emptySetSelection = filterReportSheets(mockAllSheets, new Set<ReportSheetId>())
  assert(emptySetSelection.length === 0, 'selección con Set vacío devuelve array vacío')

  // 5. Conserva el orden original canónico de reportes independientemente del orden de selección
  const unorderedSelection: ReportSheetId[] = ['expenses', 'summary', 'closures', 'sales']
  const orderedResult = filterReportSheets(mockAllSheets, unorderedSelection)
  assert(orderedResult.length === 4, 'selección desordenada devuelve la cantidad esperada de hojas')
  assert(
    orderedResult.map((s) => s.id).join(',') === 'summary,sales,expenses,closures',
    'conserva el orden original canónico (Resumen, Ventas, Gastos, Arqueos)',
  )

  // 6. Selección por pestaña activa (defaultSheetIdForTab)
  assert(defaultSheetIdForTab('resumen') === 'summary', 'pestaña resumen preselecciona Resumen')
  assert(defaultSheetIdForTab('ventas') === 'sales', 'pestaña ventas preselecciona Ventas')
  assert(defaultSheetIdForTab('productos') === 'products', 'pestaña productos preselecciona Productos vendidos')
  assert(defaultSheetIdForTab('ganancias') === 'productProfit', 'pestaña ganancias preselecciona Ganancias por producto')
  assert(defaultSheetIdForTab('creditos') === 'credits', 'pestaña creditos preselecciona Créditos')
  assert(defaultSheetIdForTab('cobros') === 'collections', 'pestaña cobros preselecciona Cobros')
  assert(defaultSheetIdForTab('gastos') === 'expenses', 'pestaña gastos preselecciona Gastos')
  assert(defaultSheetIdForTab('arqueos') === 'closures', 'pestaña arqueos preselecciona Arqueos')
  assert(defaultSheetIdForTab('desconocido') === 'summary', 'pestaña desconocida cae por defecto en Resumen')

  // 7. Consistencia biyectiva de mapeo de nombres y llaves
  let mappingConsistent = true
  for (const opt of REPORT_OPTIONS) {
    if (SHEET_NAME_TO_ID[opt.sheetName] !== opt.id || ID_TO_SHEET_NAME[opt.id] !== opt.sheetName) {
      mappingConsistent = false
    }
  }
  assert(mappingConsistent, 'los diccionarios SHEET_NAME_TO_ID e ID_TO_SHEET_NAME son mutuamente consistentes')

  // 8. Resiliencia: si la hoja carece de .id explícito, se identifica por su .name
  const legacySheetsWithoutId = [
    { name: 'Ventas', headers: ['H1'], rows: [] },
    { name: 'Cobros', headers: ['H1'], rows: [] },
    { name: 'Existencias actuales', headers: ['H1'], rows: [] },
  ]
  const legacyFiltered = filterReportSheets(legacySheetsWithoutId, ['sales', 'inventory'])
  assert(legacyFiltered.length === 2, 'filterReportSheets resuelve por .name si .id no está presente')
  assert(legacyFiltered[0].name === 'Ventas' && legacyFiltered[1].name === 'Existencias actuales', 'hojas resueltas por nombre corresponden exactamente')

  // 9. Misma fuente para Excel y PDF: ambos reciben el resultado de filterReportSheets
  const excelTargetSheets = filterReportSheets(mockAllSheets, ['sales', 'claims'])
  const pdfTargetSheets = filterReportSheets(mockAllSheets, ['sales', 'claims'])
  assert(
    excelTargetSheets.length === pdfTargetSheets.length &&
      excelTargetSheets[0].name === pdfTargetSheets[0].name &&
      excelTargetSheets[1].name === pdfTargetSheets[1].name,
    'Excel y PDF utilizan la misma fuente y lógica de selección de hojas',
  )

  return { passed, failed, results }
}

// Ejecución directa por consola
const nodeProcess = (globalThis as { process?: { argv?: string[]; exitCode?: number } }).process
const entryPoint = nodeProcess?.argv?.[1] ?? ''

if (entryPoint.replace(/\\/g, '/').includes('reportSelection.test')) {
  void runReportSelectionTestSuite().then((report) => {
    report.results.forEach((line) => console.log(line))
    console.log(`\n${report.passed} passed / ${report.failed} failed`)
    if (report.failed > 0 && nodeProcess) nodeProcess.exitCode = 1
  })
}
