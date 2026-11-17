import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const mockRepository = `
const stop=()=>()=>{}
export const searchLotsByCode=async()=>window.__qaLots
export const loadFullLotTraceability=async(params)=>{window.__qaTraceability=params;return {lot:params.existingLot,events:[]}}
export const subscribeExpenseSuppliers=cb=>{cb(window.__qaSuppliers);return stop()}
export const subscribeExpensePayables=cb=>{cb(window.__qaPayables);return stop()}
export const subscribeSupplierPayments=cb=>{cb(window.__qaPayments);return stop()}
export const subscribeClosedDispatchesForRoute=(_route,cb)=>{cb([]);return stop()}
export const subscribeDispatchSettlementSales=(_route,_dispatch,cb)=>{cb([]);return stop()}
export const subscribeCollections=(_days,_route,cb)=>{cb([]);return stop()}
export const subscribeExpenses=(_days,_route,cb)=>{cb([]);return stop()}
export const declareRouteReturn=async()=>{}
export const newOperationId=()=> 'qa-operation'
export const reopenClosure=async()=>{}
export const saveClosure=async()=>{}
export const setClosureVarianceReviewed=async()=>{}
export const registerSupplierPurchase=async()=>{}
export const paySupplierPayable=async()=>{}
export const voidSupplierPayment=async()=>{}
export const voidSupplierPurchase=async()=>{}
export const saveExpenseSupplier=async()=>{}
`

const vite = await createServer({
  server: { host: '127.0.0.1', port: 4179, strictPort: true },
  plugins: [{
    name: 'sanjose-visual-qa-fixture',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === '../data/distributionRepository' && /(?:LotTraceabilityModal|SupplierPayablesView|ClosureView)\.tsx$/.test(importer || '')) return '\0sanjose-visual-repository'
    },
    load(id) { if (id === '\0sanjose-visual-repository') return mockRepository },
  }],
})
let browser
try {
  await mkdir('output/visual-qa', { recursive: true })
  await vite.listen()
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('http://127.0.0.1:4179/scripts/visual-qa-sanjose/index.html', { waitUntil: 'networkidle' })
  await page.getByPlaceholder(/^Código de lote/i).fill('101126')
  await page.getByRole('button', { name: /Rastrear lote/i }).click()
  await page.getByText('Sachet Mortadela PRIMAVERA').waitFor()
  await page.getByText('Jamón de cerdo PORCIONADO').waitFor()
  assert.ok(await page.getByText(/0 existencias.*Lote agotado/i).count())
  await page.screenshot({ path: 'output/visual-qa/lots-101126.png', fullPage: true })
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar' }).last().click()

  await page.getByRole('button', { name: 'Cuentas por pagar' }).click()
  const filters = page.locator('select')
  await filters.nth(0).selectOption('pending')
  await filters.nth(1).selectOption('supplier-A')
  await page.getByText('Pendiente A').waitFor()
  assert.equal(await page.getByText('Pendiente B').count(), 0)
  await page.screenshot({ path: 'output/visual-qa/payables-status-supplier.png', fullPage: true })

  await page.getByRole('button', { name: 'Cierre' }).click()
  await page.getByRole('button', { name: 'Historial de cierres' }).click()
  await page.getByRole('button', { name: 'Ver detalle' }).click()
  await page.getByText('RECTIFICADO', { exact: true }).waitFor()
  await page.getByText('CUADRADO').first().waitFor()
  await page.getByText('Bs 520.00', { exact: true }).first().waitFor()
  await page.getByText('Bs 2936.00', { exact: true }).first().waitFor()
  await page.screenshot({ path: 'output/visual-qa/closure-rectified.png', fullPage: true })
  await page.getByRole('button', { name: /Ver cierre original/i }).click()
  await page.getByText(/Mostrando: cierre original preservado/i).waitFor()
  await page.getByText('Bs 694.00', { exact: true }).first().waitFor()
  await page.getByText(/FALTANTE Bs 174\.00/).waitFor()
  await page.screenshot({ path: 'output/visual-qa/closure-original.png', fullPage: true })

  const widths = [320, 390, 768, 1280, 1440]
  const measurements = []
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 })
    for (const view of ['lots', 'payables', 'closure']) {
      await page.getByRole('button', { name: view === 'lots' ? 'Lotes' : view === 'payables' ? 'Cuentas por pagar' : 'Cierre' }).click()
      if (view === 'lots') {
        await page.getByPlaceholder(/^Código de lote/i).fill('101126')
        await page.getByRole('button', { name: /Rastrear lote/i }).click()
        await page.getByText('Sachet Mortadela PRIMAVERA').waitFor()
      } else if (view === 'payables') {
        await page.locator('select').nth(0).selectOption('pending')
        await page.locator('select').nth(1).selectOption('supplier-A')
        await page.getByText('Pendiente A').waitFor()
      } else {
        await page.getByRole('button', { name: 'Historial de cierres' }).click()
        await page.getByRole('button', { name: 'Ver detalle' }).click()
        await page.getByText('RECTIFICADO', { exact: true }).waitFor()
      }
      const metrics = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      }))
      measurements.push({ width, view, ...metrics })
      assert.equal(metrics.horizontalOverflow, false, `Horizontal overflow at ${width}px in ${view}`)
      await page.screenshot({ path: `output/visual-qa/${view}-${width}.png`, fullPage: true })
      if (view === 'lots') await page.getByRole('dialog').getByRole('button', { name: 'Cerrar' }).last().click()
    }
  }
  assert.deepEqual(errors, [], `Browser errors: ${errors.join('; ')}`)
  console.log(JSON.stringify({ pass: true, viewports: measurements, screenshots: [
    'output/visual-qa/lots-101126.png', 'output/visual-qa/payables-status-supplier.png',
    'output/visual-qa/closure-rectified.png', 'output/visual-qa/closure-original.png',
  ] }, null, 2))
} finally {
  await browser?.close()
  await vite.close()
}
