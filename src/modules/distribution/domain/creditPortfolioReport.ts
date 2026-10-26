import { round2 } from './engine.ts'
import type { CustomerCreditRouteView } from './creditRoutes.ts'

type CreditReportCell = string | number | null
export interface CreditPortfolioReportSheet {
  name: string
  headers: string[]
  rows: CreditReportCell[][]
}

const dateOnly = (value: string) => {
  const dayKey = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ''
  if (dayKey) return dayKey.split('-').reverse().join('/')
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Fecha no disponible' : new Intl.DateTimeFormat('es-BO', { timeZone: 'America/La_Paz', day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)
}

const dateAndTime = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Fecha no disponible' : new Intl.DateTimeFormat('es-BO', { timeZone: 'America/La_Paz', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

/** Builds export sheets directly from the filtered customer cards used by CreditsView. */
export function creditPortfolioExportSheets(input: {
  entries: CustomerCreditRouteView[]
  routeName: string
  period: string[]
  searchTerm?: string
  generatedAt: string
}): CreditPortfolioReportSheet[] {
  const debts = input.entries.flatMap((entry) => entry.filteredReceivables.map((receivable) => {
    const route = entry.routes.find((candidate) => candidate.receivables.some((item) => item.id === receivable.id))
    const voided = receivable.voided === true || receivable.status === 'VOID'
    const balance = voided ? 0 : Number(receivable.balance) || 0
    const original = Number(receivable.originalAmount) || 0
    const paid = Number(receivable.paidAmount) || 0
    const credited = Number(receivable.creditedAmount) || 0
    return {
      createdAt: receivable.createdAt,
      original,
      paid,
      credited,
      balance,
      row: [
        dateOnly(receivable.dayKey || receivable.sourceDate || receivable.createdAt),
        dateAndTime(receivable.createdAt),
        receivable.id,
        entry.customerName,
        entry.customerCode || entry.identityNumber || receivable.customerCode || '',
        route?.routeName || 'Sin ruta / Histórico',
        receivable.sourceType === 'opening_balance' ? 'Deuda anterior' : receivable.sourceType === 'sale' ? 'Venta a crédito' : receivable.sourceType || 'Crédito histórico',
        original,
        paid,
        credited,
        balance,
        voided ? 'Anulada' : balance <= 0 ? 'Pagado' : paid > 0 ? 'Parcial' : 'Pendiente',
        receivable.note || '',
      ] as CreditReportCell[],
    }
  })).sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  const totals = debts.reduce((sum, debt) => ({
    original: round2(sum.original + debt.original),
    paid: round2(sum.paid + debt.paid),
    credited: round2(sum.credited + debt.credited),
    balance: round2(sum.balance + debt.balance),
  }), { original: 0, paid: 0, credited: 0, balance: 0 })
  const searchTerm = input.searchTerm?.trim()
  const periodLabel = input.period.length ? `${dateOnly(input.period[0])} al ${dateOnly(input.period.at(-1)!)}` : 'Todo el historial de créditos'
  const explanation = input.period.length
    ? 'Saldo pendiente actual de créditos originados en el período seleccionado; no es el saldo histórico al cierre de esas fechas.'
    : 'Cartera pendiente actual; incluye créditos de todos los períodos.'

  return [
    {
      name: 'Resumen',
      headers: ['Indicador', 'Valor', 'Detalle'],
      rows: [
        ['Empresa', 'Embutidos San José', ''],
        ['Ruta', input.routeName, 'Atribución por origen de la cuenta por cobrar'],
        ['Período', periodLabel, explanation],
        ['Búsqueda aplicada', searchTerm || 'No', searchTerm ? 'Solo clientes visibles que coinciden con la búsqueda.' : ''],
        ['Generado', input.generatedAt, 'Hora de Bolivia'],
        ['Clientes incluidos', input.entries.filter((entry) => entry.filteredReceivables.length > 0).length, 'Clientes visibles según ruta, período y búsqueda'],
        ['Cuentas por cobrar', debts.length, 'Incluye créditos pendientes y saldados visibles'],
        ['Importe original registrado', totals.original, 'Bs · incluye anuladas para trazabilidad'],
        ['Abonado registrado', totals.paid, 'Bs · no se suma nuevamente como venta'],
        ['Compensado', totals.credited, 'Bs'],
        ['Saldo pendiente actual', totals.balance, 'Bs'],
      ],
    },
    {
      name: 'Créditos',
      headers: ['Fecha de origen', 'Registrado', 'Referencia', 'Cliente', 'CI / Código', 'Ruta de origen', 'Origen', 'Importe original (Bs)', 'Abonado (Bs)', 'Compensado (Bs)', 'Saldo pendiente (Bs)', 'Estado', 'Nota'],
      rows: [
        ...debts.map((debt) => debt.row),
        ['TOTAL', '', '', '', '', '', '', totals.original, totals.paid, totals.credited, totals.balance, '', ''],
      ],
    },
  ]
}
