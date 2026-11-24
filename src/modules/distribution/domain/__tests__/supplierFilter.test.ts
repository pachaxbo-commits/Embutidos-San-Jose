import {
  buildSupplierFilterOptions,
  filterSupplierPayables,
  matchesSupplierFilter,
  supplierPayablesTotals,
} from '../supplierFilter.ts'
import type { DistPayable, DistSupplier } from '../../types.ts'

const assert = {
  equal(actual: unknown, expected: unknown) {
    if (actual !== expected) throw new Error(`Expected ${String(expected)}, got ${String(actual)}`)
  },
  deepEqual(actual: unknown, expected: unknown) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    }
  },
  ok(value: unknown) {
    if (!value) throw new Error('Expected value to be truthy')
  },
}

const supplierA = { id: 'supplier-A', name: 'LA CABAÑITA', active: true } as DistSupplier
const supplierInactive = { id: 'supplier-old', name: 'Proveedor Antiguo', active: false } as DistSupplier
const payable = (id: string, supplierId: string | undefined, supplierName: string, status: DistPayable['status'], totalAmount: number, paidAmount: number, balance: number) => ({
  id,
  supplierId,
  supplierName,
  status,
  totalAmount,
  paidAmount,
  balance,
} as DistPayable)

const rows = [
  payable('A-pending', 'supplier-A', supplierA.name, 'pending', 100, 0, 100),
  payable('A-partial', 'supplier-A', supplierA.name, 'partial', 100, 40, 60),
  payable('A-paid', 'supplier-A', supplierA.name, 'paid', 50, 50, 0),
  payable('A-voided', 'supplier-A', supplierA.name, 'voided', 75, 0, 75),
  payable('B-pending', 'supplier-B', 'OTRO PROVEEDOR', 'pending', 200, 0, 200),
  payable('legacy', undefined, 'Proveedor Histórico', 'pending', 25, 0, 25),
  payable('inactive-history', supplierInactive.id, supplierInactive.name, 'pending', 30, 0, 30),
]
const options = buildSupplierFilterOptions([supplierA, supplierInactive], rows)

assert.ok(options.some(([id]) => id === 'supplier-A'))
assert.ok(options.some(([id, name]) => id === 'supplier-old' && name === 'Proveedor Antiguo'))
assert.ok(options.some(([id, name]) => id === 'name:Proveedor Histórico' && name === 'Proveedor Histórico'))
assert.deepEqual(filterSupplierPayables(rows, 'pending', 'all', options).map((row) => row.id), [
  'A-pending', 'B-pending', 'legacy', 'inactive-history',
])
assert.deepEqual(filterSupplierPayables(rows, 'pending', 'supplier-A', options).map((row) => row.id), ['A-pending'])
assert.deepEqual(filterSupplierPayables(rows, 'paid', 'supplier-A', options).map((row) => row.id), ['A-paid'])
assert.deepEqual(filterSupplierPayables(rows, 'partial', 'supplier-A', options).map((row) => row.id), ['A-partial'])
assert.deepEqual(filterSupplierPayables(rows, 'outstanding', 'supplier-A', options).map((row) => row.id), ['A-pending', 'A-partial'])
assert.deepEqual(filterSupplierPayables(rows, 'all', 'supplier-A', options).map((row) => row.id), ['A-pending', 'A-partial', 'A-paid', 'A-voided'])
assert.deepEqual(filterSupplierPayables(rows, 'paid', 'supplier-B', options), [])
assert.deepEqual(filterSupplierPayables(rows, 'pending', 'name:Proveedor Histórico', options).map((row) => row.id), ['legacy'])
assert.deepEqual(filterSupplierPayables(rows, 'pending', 'supplier-old', options).map((row) => row.id), ['inactive-history'])
assert.equal(matchesSupplierFilter('supplier-A', undefined, 'LA CABAÑITA', options), true)

assert.deepEqual(supplierPayablesTotals(filterSupplierPayables(rows, 'pending', 'all', options)), { pending: 355, paid: 0 })
assert.deepEqual(supplierPayablesTotals(filterSupplierPayables(rows, 'outstanding', 'supplier-A', options)), { pending: 160, paid: 40 })
assert.deepEqual(supplierPayablesTotals(filterSupplierPayables(rows, 'paid', 'supplier-A', options)), { pending: 0, paid: 50 })
assert.deepEqual(supplierPayablesTotals(filterSupplierPayables(rows, 'all', 'supplier-A', options)), { pending: 160, paid: 90 })

console.log('✓ Filtro de proveedor combina estado, respeta proveedores inactivos e históricos y calcula totales visibles.')
