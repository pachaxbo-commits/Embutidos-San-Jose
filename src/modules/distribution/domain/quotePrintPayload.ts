import type { PrintJobPayload } from '../../../types/printing'
import type { DistQuote } from '../types'

export function buildQuotePrintPayload(quote: DistQuote): PrintJobPayload {
  const unitLabel = (unitType: DistQuote['lines'][number]['unitType']) => unitType === 'kg' ? 'kg' : unitType === 'package' ? 'paq' : 'u'
  return {
    payloadSchemaVersion: 1,
    templateVersion: 'v1.1-operativo',
    restaurantName: 'EMBUTIDOS SAN JOSÉ',
    branchName: 'COTIZACIÓN',
    headerDetails: [
      quote.quoteNumber,
      `FECHA: ${new Date(quote.createdAt).toLocaleString('es-BO')}`,
      `VÁLIDA HASTA: ${quote.validUntil}`,
      ...(quote.note ? [`OBSERVACIÓN: ${quote.note}`] : []),
    ],
    documentTitle: 'COTIZACIÓN',
    itemsHeaderLabel: 'PRODUCTO',
    amountHeaderLabel: 'SUBTOTAL',
    totalLabel: 'TOTAL REFERENCIAL',
    hideSubtotal: true,
    customerName: quote.customerName,
    customerPhone: quote.customerPhone,
    items: quote.lines.map(line => ({
      productId: line.productId,
      name: line.productNameSnapshot,
      basePrice: line.unitPrice,
      quantity: line.quantity,
      unitLabel: unitLabel(line.unitType),
      lineTotal: line.subtotal,
    })),
    subtotal: quote.total,
    discountTotal: 0,
    taxTotal: 0,
    deliveryFee: 0,
    grandTotal: quote.total,
    footerMessage: 'Precios sujetos a confirmación al momento de la compra.',
    orderId: quote.id,
    isCopy: false,
    copies: 1,
    createdIso: quote.createdAt,
  }
}
