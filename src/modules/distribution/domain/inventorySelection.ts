import type { DistProduct } from '../types'

const spanishSort = new Intl.Collator('es', { sensitivity: 'base', numeric: true })

function compareInventoryProducts(a: DistProduct, b: DistProduct) {
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
    spanishSort.compare(a.category || '', b.category || '') ||
    spanishSort.compare(a.name, b.name) ||
    a.id.localeCompare(b.id)
}

/** Default is sortOrder / category / name; a saved sequence takes precedence across categories. */
export function sortInventoryProducts<T extends DistProduct>(products: readonly T[], savedOrder?: readonly string[] | null): T[] {
  if (savedOrder?.length) {
    const positions = new Map<string, number>()
    savedOrder.forEach((id, index) => { if (!positions.has(id)) positions.set(id, index) })
    return [...products].sort((a, b) => {
      const aPosition = positions.get(a.id)
      const bPosition = positions.get(b.id)
      if (aPosition !== undefined && bPosition !== undefined) return aPosition - bPosition
      if (aPosition !== undefined) return -1
      if (bPosition !== undefined) return 1
      return compareInventoryProducts(a, b)
    })
  }
  return [...products].sort(compareInventoryProducts)
}

/** Move one product to another position while preserving every other product. */
export function moveInventoryProduct<T extends { id: string }>(products: readonly T[], fromId: string, toId: string): T[] {
  const from = products.findIndex(product => product.id === fromId)
  const to = products.findIndex(product => product.id === toId)
  if (from < 0 || to < 0 || from === to) return [...products]
  const next = [...products]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/**
 * If a catalog change adds active products after an order was saved, keep all
 * configured products in their exact sequence and append new ones by default.
 */
export function getInventoryProductIds(products: readonly DistProduct[], savedOrder?: readonly string[] | null): string[] {
  return sortInventoryProducts(products, savedOrder).map(product => product.id)
}
