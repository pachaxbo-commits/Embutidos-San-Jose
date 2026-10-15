import { filterQuotes } from '../quoteHistory.ts'
import type { DistQuote } from '../../types'

const q = (patch: Partial<DistQuote>): DistQuote => ({
  id: 'q1', restaurantId: 'sanjose', branchId: 'main', createdAt: '2026-10-12T15:00:00.000Z', createdBy: 'a', dayKey: '2026-10-12', schemaVersion: 1,
  quoteNumber: 'COT-1', status: 'vigente', validUntil: '2026-10-20', sellerUid: 'seller-a', sellerName: 'Ana', routeId: 'route-a', routeName: 'Ruta A', customerId: 'customer-a', customerName: 'Juan Pérez', customerPhone: '70000000',
  lines: [{ productId: 'p1', productNameSnapshot: 'Chorizo parrillero', unitType: 'kg', quantity: 2, unitPrice: 30, subtotal: 60 }], total: 60, ...patch,
})
const quotes = [q({}), q({ id: 'q2', quoteNumber: 'COT-2', dayKey: '2026-10-15', sellerUid: 'seller-b', sellerName: 'Beto', customerId: 'customer-b', customerName: 'María' }), q({ id: 'q3', deleted: true })]
const assert = (ok: boolean, message: string) => { if (!ok) throw new Error(message); console.log(`PASS: ${message}`) }
assert(filterQuotes(quotes, { from: '2026-10-12', through: '2026-10-12' }).length === 1, 'filtra por día de creación inclusivo')
assert(filterQuotes(quotes, { customerId: 'customer-b' })[0]?.id === 'q2', 'filtra por cliente formal')
assert(filterQuotes(quotes, { sellerUid: 'seller-b' })[0]?.id === 'q2', 'filtra por usuario creador')
assert(filterQuotes(quotes, { from: '2026-10-12', through: '2026-10-15', customerId: 'customer-b', sellerUid: 'seller-b' }).length === 1, 'combina fecha, cliente y creador')
assert(filterQuotes(quotes, { query: 'parrillero', ownSellerUid: 'seller-a' })[0]?.id === 'q1' && filterQuotes(quotes, { query: 'María', ownSellerUid: 'seller-a' }).length === 0, 'búsqueda de productos y visibilidad propia del distribuidor')
assert(filterQuotes(quotes, {}).length === 2, 'oculta cotizaciones eliminadas del historial normal')
