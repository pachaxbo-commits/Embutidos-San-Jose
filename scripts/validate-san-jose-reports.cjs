const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const fs = require('node:fs')
const path = require('node:path')

const OUTPUT = path.resolve('../PACHAX_QA_RESULTS/Embutidos-San-Jose')
const RAW_ENUMS = new Set([
  'cash', 'credit', 'mixed', 'unit', 'package', 'open', 'partial', 'paid',
  'draft', 'closed', 'reopened', 'warehouse_done', 'intake', 'dispatch',
  'dispatch_addition', 'sale', 'return', 'adjustment', 'shortage', 'overage',
  'exchange', 'customer_return',
])

;(async () => {
  fs.mkdirSync(OUTPUT, { recursive: true })
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage({ acceptDownloads: true })
    await page.goto('http://127.0.0.1:5180')
    await page.locator('input[type=email]').fill('admin@sanjose.bo')
    await page.locator('input[type=password]').fill('demo1234')
    await page.getByRole('button', { name: 'Iniciar Sesión', exact: true }).click()
    await page.locator('.distribution-header').waitFor()

    const audit = await page.evaluate(async rawEnums => {
      const { getFirebaseContext } = await import('/src/lib/firebase.ts')
      const source = await (await fetch('/src/lib/firebase.ts')).text()
      const firestoreModule = source.match(/from "([^"\n]*firebase_firestore[^"\n]*)"/)[1]
      const sdk = await import(firestoreModule)
      const ctx = await getFirebaseContext()
      const data = {}
      const collections = {
        sales: 'distSales', receivables: 'distReceivables', collections: 'distCollections',
        expenses: 'distExpenses', claims: 'distClaims', movements: 'distStockMovements',
        closures: 'distClosures', lots: 'distLots', transfers: 'distTransfers',
        warehouses: 'distWarehouses', routes: 'distRoutes', customers: 'distCustomers',
        products: 'distProducts', balances: 'distBalances',
      }
      for (const [key, collectionName] of Object.entries(collections)) {
        const snapshot = await sdk.getDocs(sdk.collection(ctx.db, 'restaurants', 'sanjose', collectionName))
        data[key] = snapshot.docs.map(document => ({ ...document.data(), id: document.id }))
      }

      const dates = new Set()
      for (const records of Object.values(data)) {
        for (const record of records) {
          const day = record.dayKey || record.createdAt?.slice(0, 10)
          if (day) dates.add(day)
        }
      }
      const module = await import('/src/modules/distribution/data/reportExports.ts')
      const fixture = Object.fromEntries(Object.keys(collections).map(key => [key, []]))
      fixture.claims = [{ id: 'devolucion-prueba', saleId: 'venta-otro-mes', sellerUid: 'vendedor-prueba', dayKey: '2026-09-17', createdAt: '2026-09-17T12:00:00.000Z', routeId: 'ruta-prueba', revenueDelta: -10, additionalCost: 0, cashIn: 0, cashOut: 10, qrIn: 0, qrOut: 0, debtReduction: 0 }]
      fixture.expenses = [{ id: 'gasto-anulado', dayKey: '2026-09-17', createdAt: '2026-09-17T12:00:00.000Z', routeId: 'ruta-prueba', registeredByUid: 'vendedor-prueba', amount: 20, voided: true }]
      const sellerSummary = module.reportSheets(fixture, ['2026-09-17'], 'ruta-prueba', 'vendedor-prueba')[0]
      if (sellerSummary.rows[0][1] !== -10 || sellerSummary.rows[2][1] !== -10 || sellerSummary.rows[3][1] !== 0) throw new Error('Devolución de otro mes o gasto anulado alteró el resumen del vendedor')
      const claimSheet = module.reportSheets(fixture, ['2026-09-17'], 'ruta-prueba', 'vendedor-prueba').find(sheet => sheet.name === 'Cambios y devoluciones')
      if (claimSheet.rows.length !== 2 || claimSheet.rows.some(row => row.length !== claimSheet.headers.length) || claimSheet.rows.at(-1)[0] !== 'TOTAL') throw new Error('La devolución o su total no coincide con el PDF y Excel')
      fixture.claims[0].sellerUid = undefined
      if (!module.reportAttributionError(fixture, ['2026-09-17'], 'ruta-prueba', 'vendedor-prueba')) throw new Error('Una devolución sin vendedor permitiría cifras parciales')
      window.qaData = data
      window.qaSheets = module.reportSheets(data, [...dates])
      window.qaWarehouseSheets = module.warehouseReportSheets(data, [...dates])
      window.qaInventorySheets = [module.inventoryHistorySheet(data, [...dates], 'central')]

      const problems = []
      const raw = new Set(rawEnums.map(value => value.toLowerCase()))
      for (const sheet of [...window.qaSheets, ...window.qaWarehouseSheets, ...window.qaInventorySheets]) {
        for (const row of sheet.rows) {
          if (row.length !== sheet.headers.length) problems.push(`${sheet.name}: columnas desalineadas`)
          for (const value of row) {
            if (typeof value !== 'string') continue
            const trimmed = value.trim()
            if (raw.has(trimmed.toLowerCase())) problems.push(`${sheet.name}: valor interno ${trimmed}`)
            if (/^[A-Za-z0-9_-]{18,}$/.test(trimmed)) problems.push(`${sheet.name}: identificador interno ${trimmed}`)
          }
        }
      }
      return {
        sheets: window.qaSheets.length,
        warehouseSheets: window.qaWarehouseSheets.length,
        inventorySheets: window.qaInventorySheets.length,
        dates: [...dates],
        problems,
      }
    }, [...RAW_ENUMS])

    if (audit.problems.length) throw new Error(audit.problems.join('\n'))

    for (const [fn, filename] of [['exportExcel', 'reportes.xlsx'], ['exportPdf', 'reportes.pdf']]) {
      const pendingDownload = page.waitForEvent('download')
      await page.evaluate(async ({ fn, dates }) => {
        const module = await import('/src/modules/distribution/data/reportExports.ts')
        await module[fn](window.qaSheets, `Prueba integral · ${dates.length} fechas · San José`)
      }, { fn, dates: audit.dates })
      await (await pendingDownload).saveAs(path.join(OUTPUT, filename))
    }

    for (const [sheetsKey, filenameBase] of [['qaWarehouseSheets', 'almacenes'], ['qaInventorySheets', 'historial-inventario']]) {
      for (const [fn, extension] of [['exportExcel', 'xlsx'], ['exportPdf', 'pdf']]) {
        const pendingDownload = page.waitForEvent('download')
        await page.evaluate(async ({ fn, sheetsKey, filenameBase, extension, dates }) => {
          const module = await import('/src/modules/distribution/data/reportExports.ts')
          await module[fn](window[sheetsKey], `Verificación San José · ${dates.length} fechas`, `SanJose-${filenameBase}.${extension}`)
        }, { fn, sheetsKey, filenameBase, extension, dates: audit.dates })
        await (await pendingDownload).saveAs(path.join(OUTPUT, `${filenameBase}.${extension}`))
      }
    }

    const pendingStatement = page.waitForEvent('download')
    await page.evaluate(async () => {
      const module = await import('/src/modules/distribution/data/reportExports.ts')
      await module.exportCustomerStatement(window.qaData, window.qaData.customers[0])
    })
    await (await pendingStatement).saveAs(path.join(OUTPUT, 'estado-cuenta.pdf'))

    console.log(`PASS ${audit.sheets + audit.warehouseSheets + audit.inventorySheets} hojas, ${audit.dates.length} fechas, archivos generales, almacenes, historial y estado de cuenta sin valores internos`)
  } finally {
    await browser.close()
  }
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
