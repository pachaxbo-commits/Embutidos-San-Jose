import type { DistQuote } from '../types'

export function getQuoteDocumentText(quote: DistQuote) {
  return {
    company: 'EMBUTIDOS SAN JOSÉ',
    title: 'COTIZACIÓN',
    number: quote.quoteNumber,
    date: new Date(quote.createdAt).toLocaleDateString('es-BO'),
    customer: quote.customerName,
    phone: quote.customerPhone?.trim() || '',
    validUntil: new Date(`${quote.validUntil}T12:00:00`).toLocaleDateString('es-BO'),
    footer: 'Precios sujetos a confirmación al momento de la compra.',
    note: quote.note?.trim() || '',
  }
}
