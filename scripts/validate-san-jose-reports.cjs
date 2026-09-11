const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const fs = require('node:fs')
const path = require('node:path')

const OUTPUT = path.resolve('docs/qa-san-jose')
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
      window.qaData = data
      window.qaSheets = module.reportSheets(data, [...dates])

      const problems = []
      const raw = new Set(rawEnums.map(value => value.toLowerCase()))
      for (const sheet of window.qaSheets) {
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
      return { sheets: window.qaSheets.length, dates: [...dates], problems }
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

    const pendingStatement = page.waitForEvent('download')
    await page.evaluate(async () => {
      const module = await import('/src/modules/distribution/data/reportExports.ts')
      await module.exportCustomerStatement(window.qaData, window.qaData.customers[0])
    })
    await (await pendingStatement).saveAs(path.join(OUTPUT, 'estado-cuenta.pdf'))

    console.log(`PASS ${audit.sheets} hojas, ${audit.dates.length} fechas, Excel, PDF y estado de cuenta sin valores internos`)
  } finally {
    await browser.close()
  }
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
