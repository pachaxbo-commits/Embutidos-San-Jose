import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

const vite = await createServer({
  server: { host: '127.0.0.1', port: 4182, strictPort: true },
  plugins: [{
    name: 'rectification-qa',
    enforce: 'pre',
    resolveId(id, importer) {
      if (id === './ProcessingOperationsView' && importer?.includes('SacheteadoView.tsx')) return '\0qa-unused-panel'
      if (/ProcessingMassRectification|LotReconciliation/.test(importer || '') && id === '../data/operationQueue') return '\0qa-operations'
      if (/SacheteadoView|ProcessingReportsView|ProcessingCommercialRelease|ProcessingMassRectification|LotReconciliation/.test(importer || '') && id === '../data/distributionRepository') return '\0qa-repository'
    },
    load(id) {
      if (id === '\0qa-unused-panel') return 'export const ProcessingOperationsView = () => null'
      if (id === '\0qa-repository') return 'export const loadMyProcessingQualityAuthorization = async () => null; export const releaseProcessingLot = async () => {}; export const warehouseBalanceId = () => "central"; export const loadProcessingBatch = async () => null; export const loadProcessingBatchPage = async () => ({ rows: [], cursor: null, hasMore: false }); export const loadProcessingReportPage = loadProcessingBatchPage; export const loadProcessingReviewPage = loadProcessingBatchPage; export const loadProcessingRepackPage = loadProcessingBatchPage; export const getProcessingOperationState = async () => ({ status: "missing" }); export const confirmProcessingBatch = async payload => { globalThis.qaSubmittedProcessing = payload }; export const newOperationId = () => crypto.randomUUID(); export const loadLotFromServer = async () => null; export const loadLotOriginHistory = async () => []; export const loadLotOriginReconciliations = async () => []'
      if (id === '\0qa-operations') return `
        export async function submitOperation(_, payload) {
          if (payload.netWeightG === 16000) throw Error('Hay paquetes fuera del almacén fuente. Registra su retorno o cierra las rutas pendientes antes de rectificar. Las ventas realizadas no impiden la rectificación.')
          return { revision: 'qa', quantity: 92, remaining: 75, departed: 17,
            before: { input: 17200, net: 16120, discard: 1080, cost: 94914, totalCost: 101274 },
            after: { input: 13960, net: 12880, discard: 1080, cost: 75837, totalCost: 82196 },
            sources: [{ id: 'source', code: '141126', deltaG: 3240, stockBeforeG: 0, stockAfterG: 3240 }] };
        }`
    },
  }],
})
let browser
try {
  await mkdir('output/visual-qa', { recursive: true })
  await vite.listen()
  browser = await chromium.launch()
  const page = await browser.newPage()
  for (const width of [320, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 860 })
    await page.goto('http://127.0.0.1:4182/scripts/visual-qa-processing/index.html')
    await page.getByText('Rectificar elaboración', { exact: true }).click()
    await page.getByLabel('Peso terminado verificado (g)').fill('16000')
    await page.getByLabel('Descarte verificado (g)').fill('1080')
    await page.getByLabel(/consumo verificado/).fill('13960')
    await page.getByRole('button', { name: 'Calcular impacto' }).click()
    await page.getByRole('status').getByText(/paquetes fuera del almacén/).waitFor()
    await page.screenshot({ path: `output/visual-qa/sacheteado-ruta-${width}.png`, fullPage: true })
    await page.getByLabel('Peso terminado verificado (g)').fill('12880')
    await page.getByRole('button', { name: 'Calcular impacto' }).click()
    await page.getByText('Corrección', { exact: true }).waitFor()
    await page.getByText(/ajuste 3.24 kg/).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Confirmar rectificación' }).isEnabled(), false)
    await page.getByRole('button', { name: 'Rectificar datos del lote' }).click()
    await page.getByText(/Verifiqué físicamente|Confirmo que/i).last().waitFor()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `overflow a ${width}px`)
    await page.screenshot({ path: `output/visual-qa/sacheteado-rectificacion-${width}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  for (const mode of ['weight', 'materials']) {
    await page.goto('http://127.0.0.1:4182/scripts/visual-qa-processing/index.html?mode=' + mode)
    await page.getByRole('button', { name: 'Continuar', exact: true }).click()
    if (mode === 'weight') await page.getByText(/cada sachet pesaría aproximadamente/).first().waitFor()
    await page.getByRole('button', { name: 'Continuar', exact: true }).click()
    await page.getByText('Materiales adicionales (opcional)', { exact: true }).click()
    await page.getByText(/No se agregaron materiales/).waitFor()
    await page.getByRole('button', { name: 'Continuar', exact: true }).click()
    const confirm = page.getByRole('button', { name: 'Confirmar elaboración' })
    if (mode === 'weight') {
      assert.equal(await confirm.isEnabled(), false)
      await page.getByLabel(/Excepción administrativa de peso/).fill('Peso real comprobado en planilla de QA')
    }
    assert.equal(await confirm.isEnabled(), true)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await page.screenshot({ path: 'output/visual-qa/sacheteado-' + mode + '-390.png', fullPage: true })
    await confirm.click()
    try { await page.waitForFunction(() => Boolean(globalThis.qaSubmittedProcessing), null, { timeout: 6000 }) }
    catch (error) { throw new Error(mode + ': ' + (await page.getByRole('alert').allTextContents()).join(' | '), { cause: error }) }
    assert.deepEqual(await page.evaluate(() => globalThis.qaSubmittedProcessing.packagingMaterials), [])
  }

  await page.goto('http://127.0.0.1:4182/scripts/visual-qa-processing/index.html?mode=materials')
  const next = page.getByRole('button', { name: 'Continuar', exact: true })
  await next.click()
  await next.click()
  await page.getByText('Materiales adicionales (opcional)', { exact: true }).click()
  await page.getByRole('button', { name: 'Añadir material' }).click()
  await page.getByPlaceholder('Bolsa, etiqueta…').fill('Bolsa QA')
  await next.click()
  const confirmMaterial = page.getByRole('button', { name: 'Confirmar elaboración' })
  await confirmMaterial.click()
  await page.getByText(/Material adicional: completa descripción y cantidad válida/).waitFor()
  await page.getByRole('heading', { name: /Paso 3/ }).waitFor()
  const materials = page.locator('details').filter({ has: page.locator('[data-processing-anchor=materials]') })
  if (!(await materials.evaluate(element => element.open))) await materials.locator('summary').click()
  await page.getByLabel('Usado').fill('15')
  await page.getByLabel('Dañado').fill('16')
  await next.click()
  await confirmMaterial.click()
  await page.getByText(/no puede superar la cantidad usada/).waitFor()
  if (!(await materials.evaluate(element => element.open))) await materials.locator('summary').click()
  await page.getByLabel('Dañado').fill('')
  await next.click()
  await confirmMaterial.click()
  await page.waitForFunction(() => Boolean(globalThis.qaSubmittedProcessing))
  const packaging = await page.evaluate(() => globalThis.qaSubmittedProcessing.packagingMaterials)
  assert.equal(packaging.length, 1)
  assert.equal(packaging[0].quantityMilli, 15000)
  assert.equal(packaging[0].damagedQuantityMilli, 0)
  await page.goto('http://127.0.0.1:4182/scripts/visual-qa-processing/index.html?mode=continuation')
  await next.click()
  const confirmContinuation = page.getByRole('checkbox', { name: /continúa el mismo lote físico/ })
  await confirmContinuation.check()
  await page.screenshot({ path: 'output/visual-qa/sacheteado-continuacion-390.png', fullPage: true })
  await next.click()
  await next.click()
  await page.getByRole('button', { name: 'Confirmar elaboración' }).click()
  await page.waitForFunction(() => Boolean(globalThis.qaSubmittedProcessing))
  const destination = await page.evaluate(() => globalThis.qaSubmittedProcessing.destinations[0])
  assert.equal(destination.lotCode, '171126')
  assert.equal(destination.continuePhysicalLot, true)
  console.log('PASS continuación explícita del mismo lote en móvil')
  console.log('PASS advertencia del 20%, excepción administrativa y validación móvil de materiales')
  console.log('PASS rectificación, ruta y lote derivado en 320/390/768/1280/1440')
} finally {
  await browser?.close()
  await vite.close()
}
