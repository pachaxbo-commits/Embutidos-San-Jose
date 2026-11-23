import type { DistPayable, DistSupplier } from '../types.ts'

export type SupplierFilterOption = [id: string, name: string]

export function buildSupplierFilterOptions(
  suppliers: readonly DistSupplier[],
  payables: readonly DistPayable[],
): SupplierFilterOption[] {
  const options = new Map<string, string>()
  const supplierIdsByName = new Map(suppliers.map((supplier) => [supplier.name.trim(), supplier.id]))
  for (const supplier of suppliers) {
    if (supplier.active) options.set(supplier.id, supplier.name.trim())
  }
  for (const row of payables) {
    const name = row.supplierName?.trim()
    const key = row.supplierId || (name ? supplierIdsByName.get(name) || `name:${name}` : '')
    if (key && name && !options.has(key)) options.set(key, name)
  }
  return [...options.entries()].sort((a, b) => a[1].localeCompare(b[1]))
}

/** Matches current records by supplierId and legacy records by the saved supplier name. */
export function matchesSupplierFilter(
  filterValue: string,
  rowSupplierId: string | undefined,
  rowSupplierName: string | undefined,
  options: readonly SupplierFilterOption[],
): boolean {
  if (filterValue === 'all') return true
  const rowName = rowSupplierName?.trim() || ''
  if (filterValue.startsWith('name:')) return rowName === filterValue.slice(5)
  if (rowSupplierId === filterValue) return true
  const selectedName = options.find(([id]) => id === filterValue)?.[1]
  return Boolean(selectedName && rowName === selectedName)
}

export function filterSupplierPayables(
  payables: readonly DistPayable[],
  statusFilter: DistPayable['status'] | 'all' | 'outstanding',
  supplierFilter: string,
  options: readonly SupplierFilterOption[],
): DistPayable[] {
  return payables.filter(
    (row) =>
      (statusFilter === 'outstanding' ? (row.status === 'pending' || row.status === 'partial') && Math.round(row.balance * 100) > 0 : statusFilter === 'all' || row.status === statusFilter) &&
      matchesSupplierFilter(supplierFilter, row.supplierId, row.supplierName, options),
  )
}

export function supplierPayablesTotals(rows: readonly DistPayable[]) {
  return rows.reduce(
    (totals, row) => {
      if (row.status !== 'voided') {
        totals.pending += row.balance
        totals.paid += row.paidAmount
      }
      return totals
    },
    { pending: 0, paid: 0 },
  )
}
