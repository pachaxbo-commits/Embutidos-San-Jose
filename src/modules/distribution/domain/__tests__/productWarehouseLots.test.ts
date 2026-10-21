import { productWarehouseLotRows, warehouseLotReconciliation } from '../productWarehouseLots.ts'
import type { DistBalance, DistLot } from '../../types.ts'

function equal(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) throw new Error(`${message}: esperado ${String(expected)}, recibido ${String(actual)}`)
}
function deepEqual(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message}: recibido ${JSON.stringify(actual)}`)
}

const lot = (id: string, quantity: number, extra: Record<string, unknown> = {}) => ({
  id, restaurantId: 'r', productId: 'p1', productName: 'Viena', unitType: 'kg', lotCode: id,
  manufacturedOn: '2026-10-01', expiresOn: '2026-11-01', productionCost: 10,
  quantities: { central: quantity, warehouse__internal: quantity * 2, route__north: 100 }, createdAt: '2026-10-01', createdBy: 'admin',
  ...extra,
}) as unknown as DistLot
const lots = [
  lot('soon', 1.125, { expiresOn: '2026-10-25' }),
  lot('later', 2.5, { expiresOn: '2026-12-01' }),
  lot('expired', 0.2, { expiresOn: '2026-10-19' }),
  lot('quarantine', 0.02, { quarantined: true }),
  lot('empty', 0),
  lot('other-product', 50, { productId: 'p2' }),
  lot('no-trace', 0.1, { lotCode: '', manufacturedOn: '', expiresOn: '' }),
]
const rows = productWarehouseLotRows('p1', 'kg', lots, 'central', '2026-10-20')
deepEqual(rows.map((row) => row.lot.id), ['expired', 'soon', 'quarantine', 'later', 'no-trace'], 'solo producto y almacén seleccionado; vencimiento próximo primero; sin cantidad cero')
equal(rows[1].physical, 1.125, 'precisión kg')
equal(rows[1].available, 1.125, 'disponible')
equal(rows[0].available, 0, 'vencido no disponible')
equal(rows[0].status, 'Vencido', 'estado vencido')
equal(rows[2].available, 0, 'cuarentena no disponible')
equal(rows[2].status, 'Cuarentena', 'estado cuarentena')
equal(rows[4].available, 0.1, 'la trazabilidad incompleta se identifica sin reinterpretar la disponibilidad vigente')
equal(rows[4].status, 'Disponible · trazabilidad incompleta', 'trazabilidad incompleta visible')

const balance = { id: 'bal', locationKind: 'central', productId: 'p1', productName: 'Viena', unitType: 'kg', quantity: 3.945, availableQuantity: 3.825, restaurantId: 'r', updatedAt: '' } as DistBalance
const totals = warehouseLotReconciliation(rows, balance, 'kg')
equal(totals.lotPhysical, 3.945, 'suma lotes')
equal(totals.lotAvailable, 3.725, 'disponible por lotes')
equal(totals.lotUnavailable, 0.22, 'no disponible por lotes')
equal(totals.balancePhysical, 3.945, 'saldo físico')
equal(totals.balanceAvailable, 3.825, 'saldo disponible')
equal(totals.isBalanced, true, 'conciliación')

const mismatch = warehouseLotReconciliation(rows.slice(0, 1), balance, 'kg')
equal(mismatch.isBalanced, false, 'la discrepancia se informa')
equal(mismatch.untracedPhysical, 3.745, 'la discrepancia se informa sin asignar stock a lotes')
const packageRows = productWarehouseLotRows('p1', 'package', [lot('pkg', 3)], 'central', '2026-10-20')
equal(packageRows[0].physical, 3, 'paquetes conservan cantidades enteras')
equal(packageRows[0].hasFractionalCountQuantity, false, 'cantidad entera válida')
const anomalousPackageRows = productWarehouseLotRows('p1', 'package', [lot('pkg-fractional', 3.6)], 'central', '2026-10-20')
equal(anomalousPackageRows[0].physical, 3.6, 'no se redondea silenciosamente la cantidad histórica observada')
equal(anomalousPackageRows[0].hasFractionalCountQuantity, true, 'cantidad fraccionaria se señala para revisión')

console.log('PASS: lotes por almacén/producto, cuarentena, vencidos, sin trazabilidad, cantidades cero, precision y discrepancias visibles.')
