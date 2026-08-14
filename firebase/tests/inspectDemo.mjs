/**
 * Inspecciona el estado del tenant de demo en el EMULADOR.
 * Se usa para verificar el escenario E2E sin pasar por la interfaz.
 *
 *   npm run inspect:demo
 */
const BASE = 'http://127.0.0.1:8085/v1/projects/pachax-flow/databases/(default)/documents'
const TENANT = 'sanjose'
const HEADERS = { Authorization: 'Bearer owner' }

function value(field) {
  if (!field) return undefined
  if (field.integerValue !== undefined) return Number(field.integerValue)
  if (field.doubleValue !== undefined) return Number(field.doubleValue)
  if (field.stringValue !== undefined) return field.stringValue
  if (field.booleanValue !== undefined) return field.booleanValue
  if (field.arrayValue !== undefined) return (field.arrayValue.values || []).map((entry) => plain(entry.mapValue?.fields ?? {}))
  if (field.mapValue !== undefined) return plain(field.mapValue.fields ?? {})
  return null
}

function plain(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, value(field)]))
}

async function list(collectionName) {
  const response = await fetch(`${BASE}/restaurants/${TENANT}/${collectionName}?pageSize=300`, { headers: HEADERS })
  if (!response.ok) throw new Error(`${collectionName}: ${response.status} ${await response.text()}`)
  const body = await response.json()
  return (body.documents || []).map((document) => ({ id: document.name.split('/').pop(), ...plain(document.fields) }))
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

export async function snapshot() {
  const [balances, movements, dispatches, sales, receivables, collections, expenses, closures] = await Promise.all([
    list('distBalances'),
    list('distStockMovements'),
    list('distDispatches'),
    list('distSales'),
    list('distReceivables'),
    list('distCollections'),
    list('distExpenses'),
    list('distClosures'),
  ])
  return { balances, movements, dispatches, sales, receivables, collections, expenses, closures }
}

const state = await snapshot()

console.log('=== SALDOS ===')
state.balances
  .slice()
  .sort((a, b) => a.id.localeCompare(b.id))
  .forEach((row) => console.log(`  ${row.id.padEnd(50)} ${round2(row.quantity)}`))

console.log(`\n=== VENTAS (${state.sales.length}) ===`)
state.sales.forEach((sale) =>
  console.log(
    `  ${sale.id} | ${sale.paymentKind} | total ${sale.total} | efectivo ${sale.cashAmount} | qr ${sale.qrAmount} | credito ${sale.creditAmount} | ruta ${sale.routeId}`,
  ),
)

console.log(`\n=== CUENTAS POR COBRAR (${state.receivables.length}) ===`)
state.receivables.forEach((row) =>
  console.log(`  ${row.id} | ${row.customerName} | original ${row.originalAmount} | pagado ${row.paidAmount} | saldo ${row.balance} | ${row.status}`),
)

console.log(`\n=== COBROS (${state.collections.length}) ===`)
state.collections.forEach((row) => console.log(`  ${row.id} | ${row.amount} | ${row.method} | ruta ${row.routeId}`))

console.log(`\n=== GASTOS (${state.expenses.length}) ===`)
state.expenses.forEach((row) => console.log(`  ${row.id} | ${row.concept} | ${row.amount} | ruta ${row.routeId}`))

console.log(`\n=== MOVIMIENTOS DE INVENTARIO (${state.movements.length}) ===`)
state.movements
  .slice()
  .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
  .forEach((row) =>
    console.log(`  ${row.id.padEnd(46)} ${String(row.type).padEnd(18)} central ${String(row.centralDelta).padStart(7)} | ruta ${String(row.routeDelta).padStart(7)} | ${row.productId}`),
  )

console.log(`\n=== DESPACHOS (${state.dispatches.length}) ===`)
state.dispatches.forEach((row) => console.log(`  ${row.id} | ${row.routeName} | ${row.status} | aumentos ${(row.additions || []).length}`))

console.log(`\n=== CIERRES (${state.closures.length}) ===`)
state.closures.forEach((row) =>
  console.log(`  ${row.id} | ${row.status} | esperado ${row.expectedCash} | declarado ${row.physicalCashDeclared} | diferencia ${row.cashDifference}`),
)

// Detector de duplicados por operacion logica
const duplicates = []
const seen = new Map()
for (const movement of state.movements) {
  const key = `${movement.type}|${movement.productId}|${movement.centralDelta}|${movement.routeDelta}|${movement.refId}`
  seen.set(key, (seen.get(key) || 0) + 1)
}
for (const [key, count] of seen) if (count > 1) duplicates.push(`${key} x${count}`)

console.log(`\n=== DUPLICADOS EN LEDGER: ${duplicates.length} ===`)
duplicates.forEach((line) => console.log(`  ${line}`))
