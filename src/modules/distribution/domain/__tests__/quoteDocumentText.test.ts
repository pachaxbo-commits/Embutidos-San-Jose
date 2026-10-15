import { getQuoteDocumentText } from '../quoteDocumentText.ts'
import type { DistQuote } from '../../types'

const quote: DistQuote = { id:'q', restaurantId:'sanjose', branchId:'main', createdAt:'2026-10-15T16:00:00.000Z', createdBy:'seller', dayKey:'2026-10-15', schemaVersion:1, quoteNumber:'COT-20261015-A', status:'vigente', validUntil:'2026-10-22', sellerUid:'seller', sellerName:'No debe aparecer', routeId:'route', routeName:'No debe aparecer', customerName:'Cliente de prueba', customerPhone:'70000000', lines:[], total:0, note:'Entrega por la tarde' }
const text = getQuoteDocumentText(quote)
const assert = (ok: boolean, message: string) => { if (!ok) throw new Error(message); console.log(`PASS: ${message}`) }
const displayed = Object.values(text).join(' ')
assert(text.company === 'EMBUTIDOS SAN JOSÉ' && text.title === 'COTIZACIÓN' && text.number === quote.quoteNumber, 'imagen incluye identidad y número de cotización')
assert(text.customer === quote.customerName && text.phone === quote.customerPhone && text.validUntil === '22/10/2026', 'imagen incluye cliente, teléfono y vigencia')
assert(text.note === quote.note && text.footer.includes('Precios sujetos a confirmación'), 'imagen conserva observación y nota útil de precio')
assert(!displayed.includes(quote.sellerName) && !displayed.includes(quote.routeName) && !displayed.includes('No es una venta') && !displayed.includes('reserva existencias'), 'imagen omite vendedor, ruta y advertencias de venta/stock')
