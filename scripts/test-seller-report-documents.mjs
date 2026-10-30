import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { JSDOM } from 'jsdom'
import ExcelJS from 'exceljs'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://sanjose.test' })
globalThis.window = dom.window
globalThis.document = dom.window.document
dom.window.HTMLAnchorElement.prototype.click = function () {}
const originalSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (...args) => { const timer = originalSetTimeout(...args); timer.unref?.(); return timer }
const originalCreateObjectURL = URL.createObjectURL
const saved = new Map()
URL.createObjectURL = (blob) => { const key = `blob:report-${saved.size}`; saved.set(key, blob); return key }

const vite = await createServer({ configFile: 'vite.config.ts', mode: 'emulator', appType: 'custom', server: { middlewareMode: true } })
try {
  const { reportSheets, exportPdf, exportExcel } = await vite.ssrLoadModule('/src/modules/distribution/data/reportExports.ts')
  const sales = [{ id: 'report-sale', sellerUid: 'hugo', sellerName: 'Hugo QA', routeId: 'route-hugo', routeName: 'Ruta Hugo', createdAt: '2026-10-30T12:00:00.000Z', dayKey: '2026-10-30', saleKind: 'sale', total: 50, cashAmount: 50, qrAmount: 0, creditAmount: 0, lines: [{ productId: 'beef', productNameSnapshot: 'Carne molida', unitType: 'kg', quantity: 2.5, actualUnitPrice: 20, subtotal: 50 }] }]
  const data = { closures: [], customers: [], sales, receivables: [], collections: [], receivableAdjustments: [], expenses: [], claims: [], products: [], movements: [], warehouses: [], transfers: [], routes: [], lots: [], balances: [], supportSettings: {}, operations: [] }
  const sheet = reportSheets(data, ['2026-10-30'], 'route-hugo', 'hugo').find(row => row.id === 'sellerSummary')
  assert.ok(sheet)
  await exportPdf([sheet], '30/10/2026 · Ruta Hugo · Hugo QA', 'SanJose-kg-chofer.pdf')
  const pdf = saved.get('blob:report-0')
  assert.ok(pdf)
  const pdfBytes = new Uint8Array(await pdf.arrayBuffer())
  assert.equal(new TextDecoder().decode(pdfBytes.subarray(0, 5)), '%PDF-')
  const pdfText = new TextDecoder().decode(pdfBytes)
  assert.match(pdfText, /MediaBox \[0 0 792\.(?:00)? 612\.(?:00)?\]/, 'seller summary PDF should use landscape page size for its columns')
  console.log('PASS PDF real de Kg por vendedor: firma válida y orientación horizontal')

  await exportExcel([sheet], '30/10/2026 · Ruta Hugo · Hugo QA', 'SanJose-kg-chofer.xlsx')
  const excelBlob = saved.get('blob:report-1')
  assert.ok(excelBlob)
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(await excelBlob.arrayBuffer())
  const worksheet = book.getWorksheet('Kg por vendedor')
  assert.ok(worksheet)
  assert.equal(worksheet.getCell(5, 1).value, '30/10/2026')
  assert.equal(worksheet.getCell(5, 2).value, 'Hugo QA')
  assert.equal(worksheet.getCell(5, 3).value, 'Ruta Hugo')
  assert.equal(worksheet.getCell(5, 4).value, 2.5)
  assert.equal(worksheet.getCell(6, 1).value, 'TOTAL GENERAL')
  console.log('PASS Excel real de Kg por vendedor: fecha, chofer, ruta, gramos y total general preservados')
} finally {
  await vite.close()
  dom.window.close()
  URL.createObjectURL = originalCreateObjectURL
  globalThis.setTimeout = originalSetTimeout
}
