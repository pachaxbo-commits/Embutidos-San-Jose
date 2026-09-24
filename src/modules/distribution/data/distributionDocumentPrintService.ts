import { PrintEngineService } from '../../../services/printing/printEngineService'
import { getActiveReceiptPrinter } from '../../../services/printing/printerBootstrap'
import type { PrintJobPayload } from '../../../types/printing'
import type { DistClosure, DistDispatch } from '../types'
import { computeLoadedByProduct, round2 } from '../domain/engine'

async function printTicket(payload: PrintJobPayload, key: string): Promise<string> {
  const printer = getActiveReceiptPrinter()
  if (!printer) throw new Error('Configura una impresora antes de imprimir.')
  const job = await PrintEngineService.getInstance().submitPrintRequest({ targetType: 'receipt', printerProfileId: printer.id, idempotencyKey: `${key}:${Date.now()}`, payload })
  if (!['transmitted', 'confirmed'].includes(job.status)) throw new Error(job.lastError || 'La impresora no confirmó el documento.')
  return 'Documento enviado a la impresora.'
}

function basePayload(title: string, subtitle: string, items: PrintJobPayload['items'], message?: string): PrintJobPayload {
  return { payloadSchemaVersion: 1, templateVersion: 'v1.1-operativo', restaurantName: 'EMBUTIDOS SAN JOSÉ', branchName: title, headerDetails: [subtitle], items, subtotal: 0, discountTotal: 0, taxTotal: 0, deliveryFee: 0, grandTotal: 0, customMessage: message, isCopy: false, copies: 1, createdIso: new Date().toISOString() }
}

export function printDispatchTicket(dispatch: DistDispatch): Promise<string> {
  const rows = [...computeLoadedByProduct(dispatch).values()]
  return printTicket(basePayload('DESPACHO ENTREGADO', `${dispatch.routeName} - ${dispatch.distributorName}`, rows.map(row => ({ name: row.productName, basePrice: 0, quantity: row.totalLoaded, unitLabel: row.unitType === 'kg' ? 'kg' : row.unitType === 'package' ? 'paq' : 'u', lineTotal: 0 })), 'Firma de quien recibe: __________________'), `dispatch:${dispatch.id}`)
}

export function printClosureTicket(closure: DistClosure): Promise<string> {
  return printTicket(basePayload('CIERRE DE RUTA', `${closure.routeName} - ${closure.distributorName}`, closure.products.map(row => ({ name: row.productName, basePrice: 0, quantity: row.sold, unitLabel: row.unitType === 'kg' ? 'kg vendidos' : 'vendidos', lineTotal: 0, modifiersText: [`Entregado ${row.totalLoaded}`, `Devuelto ${row.actualReturn}`, `Diferencia ${row.variance}`] })), closure.status === 'closed' ? `EFECTIVO ESPERADO: Bs ${round2(closure.expectedCash).toFixed(2)} | DECLARADO: Bs ${round2(closure.physicalCashDeclared).toFixed(2)}` : 'Cierre pendiente de completar'), `closure:${closure.id}`)
}

export function printOperationalSheet(title: string, subtitle: string, rows: { name: string; detail: string }[], totals: { label: string; value: string }[] = []): void {
  const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] || char)
  const popup = window.open('', '_blank')
  if (!popup) throw new Error('El navegador bloqueó la ventana de impresión.')
  popup.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escape(title)}</title><style>@page{size:A4;margin:0}*{box-sizing:border-box}body{font-family:Arial;color:#172033;margin:0;padding:18mm}.head{display:flex;gap:20px;align-items:center;border-bottom:4px solid #c8102e}.head img{width:100px}.head h1{margin:0;color:#c8102e}table{width:100%;border-collapse:collapse;margin-top:24px}th{background:#c8102e;color:white;text-align:left;padding:10px}td{padding:11px;border-bottom:1px solid #ddd}.totals{margin-top:22px;margin-left:auto;width:330px}.totals p{display:flex;justify-content:space-between;font-weight:bold}.sign{margin-top:70px;display:flex;justify-content:space-around}.sign span{border-top:1px solid #333;padding:8px 35px}</style></head><body><header class="head"><img src="/brand/san-jose-logo.png"><div><h1>${escape(title)}</h1><p>${escape(subtitle)}</p></div></header><table><thead><tr><th>Producto / concepto</th><th>Detalle</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escape(row.name)}</td><td>${escape(row.detail)}</td></tr>`).join('')}</tbody></table><div class="totals">${totals.map(total => `<p><span>${escape(total.label)}</span><span>${escape(total.value)}</span></p>`).join('')}</div><div class="sign"><span>Entrega</span><span>Recibe</span></div><script>window.onafterprint=()=>window.close();window.onload=()=>window.print()</script></body></html>`)
  popup.document.close()
}
