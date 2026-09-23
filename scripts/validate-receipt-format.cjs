const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict')

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage()
    await page.goto('http://127.0.0.1:5180')
    const result = await page.evaluate(async () => {
      const service = await import('/src/modules/distribution/data/distributionReceiptService.ts')
      const template = await import('/src/services/printing/templates/receiptTemplate.ts')
      const sale = { id: 'sale-ticket-123456', operationId: 'sale-ticket-123456', restaurantId: 'sanjose', branchId: 'main', createdAt: new Date().toISOString(), createdBy: 'qa', dayKey: '2026-09-23', schemaVersion: 1, sourceLocation: 'centralWarehouse', routeId: 'administracion', routeName: 'Administración', sellerUid: 'admin', sellerName: 'Administración San José', lines: [{ productId: 'p1', productNameSnapshot: 'Chorizo parrillero precocido ahumado con picante', quantity: 1.25, unitType: 'kg', actualUnitPrice: 40, referenceUnitPrice: 53, isPromotional: true, subtotal: 50 }], total: 50, paymentKind: 'cash', cashAmount: 50, qrAmount: 0, creditAmount: 0, cashReceived: 100, changeAmount: 50 }
      const payload = service.buildSaleReceiptPayload(sale, { companyName: 'Embutidos San José', routeName: 'Zona Norte', distributorName: 'Persona privada', receiptFooter: 'Gracias' })
      const bytes = template.buildReceiptBytes(payload, '58mm', false)
      return { branchName: payload.branchName, branchAddress: payload.branchAddress || '', cashReceived: payload.cashReceived, changeAmount: payload.changeAmount, length: bytes.length }
    })
    assert.equal(result.branchName, '', 'El ticket no debe imprimir ruta')
    assert.equal(result.branchAddress, '', 'El ticket no debe imprimir distribuidor')
    assert.equal(result.cashReceived, 100)
    assert.equal(result.changeAmount, 50)
    assert(result.length > 100, 'El ticket de 58 mm debe generar bytes')
    console.log('PASS ticket 58 mm: sin ruta/distribuidor, con cambio y contenido imprimible')
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
