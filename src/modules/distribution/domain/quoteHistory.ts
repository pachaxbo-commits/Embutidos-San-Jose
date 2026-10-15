import type { DistQuote } from '../types'
import { toDayKey } from './engine.ts'

export interface QuoteHistoryFilters {
  query?: string
  from?: string
  through?: string
  customerId?: string
  sellerUid?: string
  ownSellerUid?: string
}

export function filterQuotes(quotes: DistQuote[], filters: QuoteHistoryFilters): DistQuote[] {
  const query = filters.query?.trim().toLocaleLowerCase() || ''
  return quotes.filter(quote => {
    if (quote.deleted === true) return false
    if (filters.ownSellerUid && quote.sellerUid !== filters.ownSellerUid) return false
    if (query && !`${quote.quoteNumber} ${quote.customerName} ${quote.customerPhone || ''} ${quote.lines.map(line => line.productNameSnapshot).join(' ')}`.toLocaleLowerCase().includes(query)) return false
    const day = quote.dayKey || toDayKey(new Date(quote.createdAt))
    if (filters.from && day < filters.from) return false
    if (filters.through && day > filters.through) return false
    if (filters.customerId && quote.customerId !== filters.customerId) return false
    if (filters.sellerUid && quote.sellerUid !== filters.sellerUid) return false
    return true
  })
}
