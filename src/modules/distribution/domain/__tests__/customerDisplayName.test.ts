import { computeCreditPortfolioByRoute, currentCustomerDisplayName, matchesCustomerCreditSearch } from '../creditRoutes.ts'
import type { DistCustomer, DistReceivable, DistRoute } from '../../types.ts'

const customer = { id: 'customer-irene', name: 'Irene Castro Apaza - PASAJE 22', customerCode: '3620681', identityNumber: '3620681', routeId: 'south', active: true } as DistCustomer
const other = { ...customer, id: 'different-irene', name: 'Irene Castro Apaza', customerCode: '1111111', identityNumber: '1111111' } as DistCustomer
const debt = (id: string, customerId: string): DistReceivable => ({
  id, customerId, customerName: 'Irene castro apaza', customerCode: '3620681', routeId: 'south', distributorUid: 'seller', distributorName: 'Vendedor',
  originalAmount: 3067, paidAmount: 0, balance: 3067, status: 'OPEN', createdAt: '2026-10-01T12:00:00-04:00', pendingConfirmation: false,
} as DistReceivable)
const routes = [{ id: 'south', name: 'Zona Sud', kind: 'route', active: true, restaurantId: 'sanjose', createdAt: '' }] as DistRoute[]

const portfolio = computeCreditPortfolioByRoute({ receivables: [debt('debt-1', customer.id), debt('debt-2', customer.id)], selectedRouteId: 'all', routes, customers: [customer] })
const creditEntry = portfolio.customerCredits[0]
if (!creditEntry) throw new Error('La cartera de prueba debería contener al menos un cliente.')
if (creditEntry.customerName !== customer.name) throw new Error('La cartera debe priorizar el nombre vigente del cliente maestro.')
if (creditEntry.totalBalance !== 6134) throw new Error('Cambiar el nombre no debe alterar el saldo agregado.')
if (!matchesCustomerCreditSearch(creditEntry, 'PASAJE 22')) throw new Error('La búsqueda de Créditos debe encontrar el nombre actualizado.')
if (!matchesCustomerCreditSearch(creditEntry, 'Irene castro apaza')) throw new Error('La búsqueda debe conservar los nombres de snapshots históricos de las deudas vinculadas.')
if (!matchesCustomerCreditSearch(creditEntry, '3620681')) throw new Error('La búsqueda debe seguir encontrando por CI.')
if (matchesCustomerCreditSearch(creditEntry, '1111111')) throw new Error('La búsqueda histórica no debe cruzar identidad por nombres ni por CI de otra persona.')
if (currentCustomerDisplayName(other.id, 'Irene castro apaza', new Map([[customer.id, customer], [other.id, other]])) !== other.name) throw new Error('La resolución debe usar customerId y permitir nombres parecidos sin cruzar identidades.')
if (currentCustomerDisplayName('missing', 'Nombre guardado en deuda', new Map()) !== 'Nombre guardado en deuda') throw new Error('Si falta el maestro, debe conservarse el nombre histórico como fallback.')
console.log('PASS customerDisplayName: cartera usa nombre actual por customerId, conserva saldos y usa fallback histórico seguro')
