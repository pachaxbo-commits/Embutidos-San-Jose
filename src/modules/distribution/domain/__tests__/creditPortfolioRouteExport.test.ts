import { creditPortfolioExportSheets } from '../creditPortfolioReport.ts'
import { computeCreditPortfolioByRoute } from '../creditRoutes.ts'
import type { DistCustomer, DistReceivable, DistRoute, DistSale } from '../../types.ts'

const routes = [
  { id: 'ricardo', name: 'Ricardo', active: true },
  { id: 'ruth', name: 'Ruth', active: true },
  { id: 'sud', name: 'Zona Sud', active: true },
] as DistRoute[]
const customers = [
  { id: 'multi', name: 'Cliente Multirruta', identityNumber: '111', routeId: 'sud', active: true },
  { id: 'ruth-only', name: 'Cliente Ruth', identityNumber: '222', routeId: 'ruth', active: true },
  { id: 'sud-only', name: 'Cliente Zona Sud', identityNumber: '555', routeId: 'sud', active: true },
  { id: 'admin-only', name: 'Cliente Administración', identityNumber: '333', routeId: 'administracion', active: true },
  { id: 'unknown', name: 'Cliente Histórico', identityNumber: '444', active: true },
] as DistCustomer[]
const receivable = (overrides: Partial<DistReceivable>): DistReceivable => ({
  id: 'debt', customerId: 'multi', customerName: 'Nombre histórico', routeId: 'ricardo', distributorUid: 'seller',
  originalAmount: 200, paidAmount: 0, creditedAmount: 0, balance: 200, status: 'OPEN',
  createdAt: '2026-10-01T12:00:00-04:00', dayKey: '2026-10-01', pendingConfirmation: false,
  ...overrides,
} as DistReceivable)

const receivables = [
  receivable({ id: 'multi-ricardo', routeId: 'ricardo', originalAmount: 200, balance: 200 }),
  receivable({ id: 'multi-ruth', routeId: 'ruth', originalAmount: 150, paidAmount: 50, balance: 100, dayKey: '2026-10-20', createdAt: '2026-10-20T13:00:00-04:00' }),
  receivable({ id: 'ruth-only-debt', customerId: 'ruth-only', routeId: 'ruth', customerName: 'Cliente Ruth', originalAmount: 70, balance: 70 }),
  receivable({ id: 'sud-only-debt', customerId: 'sud-only', routeId: 'sud', customerName: 'Cliente Zona Sud', originalAmount: 50, balance: 50 }),
  receivable({ id: 'admin-debt', customerId: 'admin-only', routeId: 'administracion', originalAmount: 40, balance: 40 }),
  receivable({ id: 'historic-unresolved', customerId: 'unknown', routeId: undefined, saleId: undefined, originalAmount: 30, balance: 30 }),
] as DistReceivable[]
const sales = [{ id: 'sale-ruth', customerId: 'multi', routeId: 'ruth', createdAt: '2026-10-20T13:00:00-04:00' }] as DistSale[]
const salesById = new Map(sales.map((sale) => [sale.id, sale]))

function exportFor(routeId: string, period: string[] = [], searchTerm = '') {
  const portfolio = computeCreditPortfolioByRoute({ receivables, selectedRouteId: routeId, routes, customers, salesById, period })
  const matching = searchTerm
    ? portfolio.customerCredits.filter((entry) => entry.customerName.toLowerCase().includes(searchTerm.toLowerCase()) || entry.identityNumber?.includes(searchTerm))
    : portfolio.customerCredits
  const sheets = creditPortfolioExportSheets({
    entries: matching,
    routeName: routeId === 'all' ? 'Todas las rutas' : routes.find((route) => route.id === routeId)?.name || 'Ruta seleccionada',
    period,
    searchTerm,
    generatedAt: '26/10/2026 12:00',
  })
  return { portfolio, sheets, rows: sheets.find((sheet) => sheet.name === 'Créditos')!.rows }
}

const ricardo = exportFor('ricardo')
if (ricardo.portfolio.totalOutstanding !== 200) throw new Error('Ricardo debe sumar solo los Bs 200 de origen Ricardo.')
if (!ricardo.rows.some((row) => row[2] === 'multi-ricardo') || ricardo.rows.some((row) => row[2] === 'multi-ruth' || row[2] === 'ruth-only-debt')) throw new Error('El PDF/Excel de Ricardo no debe contener deudas de Ruth.')

const ruth = exportFor('ruth')
if (ruth.portfolio.totalOutstanding !== 170) throw new Error('Ruth debe sumar Bs 100 del cliente multirruta y Bs 70 del cliente propio.')
if (!ruth.rows.some((row) => row[2] === 'multi-ruth') || ruth.rows.some((row) => row[2] === 'multi-ricardo')) throw new Error('El reporte de Ruth debe conservar solo su origen de deuda.')

const all = exportFor('all')
if (all.portfolio.totalOutstanding !== 490) throw new Error('Todas las rutas debe sumar cada deuda una sola vez, incluyendo Administración e histórico sin ruta.')
if (new Set(all.rows.slice(0, -1).map((row) => row[2])).size !== 6) throw new Error('El consolidado no debe duplicar créditos de clientes multirruta.')
if (!all.rows.some((row) => row[2] === 'historic-unresolved' && row[5] === 'Sin ruta / Histórico')) throw new Error('Una ruta desconocida debe conservar la etiqueta Sin ruta / Histórico.')
const zonaSud = exportFor('sud')
if (zonaSud.portfolio.totalOutstanding !== 50 || zonaSud.rows.slice(0, -1).length !== 1) throw new Error('Zona Sud debe mostrar únicamente su deuda originada en esa ruta, no las otras deudas del cliente multirruta.')
const admin = exportFor('administracion')
if (admin.portfolio.totalOutstanding !== 40 || admin.rows.slice(0, -1).length !== 1) throw new Error('Administración debe permanecer separada de las rutas operativas.')

const october20 = exportFor('ruth', ['2026-10-20'])
if (october20.portfolio.totalOutstanding !== 100 || october20.rows.slice(0, -1).length !== 1) throw new Error('El período debe filtrar por fecha de origen sin mezclar el resto de la cartera.')
const searched = exportFor('all', [], '111')
if (searched.rows.slice(0, -1).length !== 2 || !searched.sheets[0].rows.some((row) => row[0] === 'Búsqueda aplicada' && row[1] === '111')) throw new Error('Las exportaciones deben documentar y respetar la búsqueda visible.')
if (ricardo.sheets[0].rows.find((row) => row[0] === 'Saldo pendiente actual')?.[1] !== ricardo.portfolio.totalOutstanding) throw new Error('El resumen exportado debe coincidir con el total mostrado en pantalla.')

console.log('PASS creditPortfolioRouteExport: rutas, multirruta, histórico, período, búsqueda y totales PDF/Excel coherentes')
