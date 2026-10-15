import type { DistQuote } from '../types'

export function buildQuoteSharePayload(quote: DistQuote, fileUri: string) {
  return {
    title: `Cotización ${quote.quoteNumber}`,
    dialogTitle: 'Enviar cotización por WhatsApp u otra aplicación',
    files: [fileUri],
  }
}
