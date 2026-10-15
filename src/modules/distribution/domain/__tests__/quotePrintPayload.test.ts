import { buildQuotePrintPayload } from '../quotePrintPayload.ts'
import type { DistQuote } from '../../types'

const quote: DistQuote = {
  id: 'quote-test-1', restaurantId: 'sanjose', branchId: 'main', createdAt: '2026-10-15T16:00:00.000Z', createdBy: 'seller-1', dayKey: '2026-10-15', schemaVersion: 1,
  quoteNumber: 'COT-20261015-AB123', status: 'vigente', validUntil: '2026-10-22', sellerUid: 'seller-1', sellerName: 'Vendedor',
  routeId: 'route-1', routeName: 'Zona Norte', customerName: 'Cliente de prueba', customerPhone: '70000000',
  lines: [{ productId: 'viena', productNameSnapshot: 'Salchicha tipo Viena', unitType: 'kg', quantity: 2.5, unitPrice: 40, subtotal: 100 }],
  total: 100, note: 'Precio referencial',
}

const payload = buildQuotePrintPayload(quote)
const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); console.log(`PASS: ${message}`) }
assert(payload.documentTitle === 'COTIZACIÓN' && payload.totalLabel === 'TOTAL REFERENCIAL', 'el documento y total se identifican como cotización referencial')
assert(payload.grandTotal === 100 && payload.items[0].quantity === 2.5 && payload.items[0].lineTotal === 100, 'incluye cantidad, precio y subtotal sin alterar el cálculo')
assert(payload.createdIso === quote.createdAt && payload.customerName === quote.customerName, 'conserva fecha y datos de cliente del documento')
assert(payload.paymentMethod === undefined && payload.paymentDetails === undefined, 'no presenta forma de pago en la cotización')
assert(payload.customMessage?.includes('NO ES UNA VENTA') === true && payload.customMessage?.includes('NO RESERVA EXISTENCIAS') === true, 'aclara que la cotización no vende ni reserva stock')
assert(payload.items[0].unitLabel === 'kg' && payload.items[0].basePrice === 40, 'mantiene unidad y precio unitario para el motor de impresión configurado')
