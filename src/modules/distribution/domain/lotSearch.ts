import type { DistLot, DistProduct } from '../types.ts'

export interface LotSearchResult {
  lot: DistLot
  productName: string
  currentStock: number
}

/** Resolve each result by productId, without per-result catalogue reads. */
export function resolveLotSearchResults(lots: readonly DistLot[], products: readonly DistProduct[]): LotSearchResult[] {
  const productsById = new Map(products.map((product) => [product.id, product]))
  return lots.map((lot) => ({
    lot,
    productName: productsById.get(lot.productId)?.name || 'Producto histórico / no disponible en catálogo',
    currentStock: Object.values(lot.quantities || {}).reduce((sum, quantity) => sum + Number(quantity || 0), 0),
  }))
}
