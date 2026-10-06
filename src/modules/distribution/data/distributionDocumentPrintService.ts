import { PrintEngineService } from '../../../services/printing/printEngineService'
import { getActiveReceiptPrinter } from '../../../services/printing/printerBootstrap'
import type { PrintJobPayload } from '../../../types/printing'
import type { DistClosure, DistDispatch } from '../types'
import { computeLoadedByProduct, round2 } from '../domain/engine'
import { printHtmlDocument } from '../../../services/printing/documentPrintService'
import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

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

export async function shareDispatch(dispatch: DistDispatch): Promise<boolean> {
  const rows = [...computeLoadedByProduct(dispatch).values()]
  const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 390 + rows.length * 58
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('No se pudo crear el documento del despacho.')
  ctx.fillStyle = '#fffdf9'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.fillStyle='#c8102e'; ctx.fillRect(0,0,canvas.width,16)
  ctx.textAlign='center'; ctx.fillStyle='#111827'; ctx.font='800 36px Arial'; ctx.fillText('EMBUTIDOS SAN JOSÉ',450,70); ctx.font='800 28px Arial'; ctx.fillStyle='#c8102e'; ctx.fillText('DESPACHO ENTREGADO',450,112)
  ctx.font='20px Arial'; ctx.fillStyle='#475569'; ctx.fillText(`${new Date(dispatch.createdAt).toLocaleString('es-BO')} · ${dispatch.routeName}`,450,148); ctx.fillText(`Distribuidor: ${dispatch.distributorName}`,450,178); ctx.fillText(`Encargado de almacén: ${dispatch.warehouseResponsibleName || 'Registro anterior'}`,450,208)
  let y=255; ctx.textAlign='left'
  for (const row of rows) { ctx.fillStyle='#111827'; ctx.font='700 21px Arial'; ctx.fillText(row.productName,45,y); ctx.textAlign='right'; ctx.fillStyle='#c8102e'; ctx.fillText(`${row.totalLoaded} ${row.unitType === 'kg' ? 'kg' : row.unitType === 'package' ? 'paq' : 'u'}`,855,y); ctx.textAlign='left'; y+=58 }
  ctx.strokeStyle='#64748b'; ctx.beginPath(); ctx.moveTo(90,canvas.height-55); ctx.lineTo(350,canvas.height-55); ctx.moveTo(550,canvas.height-55); ctx.lineTo(810,canvas.height-55); ctx.stroke(); ctx.font='16px Arial'; ctx.fillStyle='#475569'; ctx.fillText('Entrega',195,canvas.height-28); ctx.fillText('Recibe',660,canvas.height-28)
  const blob = await new Promise<Blob>((resolve,reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('No se pudo generar el despacho.')),'image/png'))
  const file = new File([blob], `despacho-san-jose-${dispatch.id.slice(-6)}.png`, {type:'image/png'})
  if (Capacitor.isNativePlatform()) { const data = await new Promise<string>((resolve,reject) => { const reader=new FileReader(); reader.onload=()=>resolve(String(reader.result||'').split(',',2)[1]||''); reader.onerror=()=>reject(reader.error); reader.readAsDataURL(file) }); const path=`shared/${file.name}`; const written=await Filesystem.writeFile({path,data,directory:Directory.Cache,recursive:true}); await Share.share({title:'Despacho Embutidos San José',dialogTitle:'Compartir despacho',files:[written.uri]}); return true }
  const nav=navigator as Navigator & {share?:(data:{title:string;files:File[]})=>Promise<void>;canShare?:(data:{files:File[]})=>boolean}; if(nav.share&&(!nav.canShare||nav.canShare({files:[file]}))){await nav.share({title:'Despacho Embutidos San José',files:[file]});return true} const link=document.createElement('a');link.href=URL.createObjectURL(file);link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);return true
}

export function printClosureTicket(closure: DistClosure): Promise<string> {
  return printTicket(basePayload('CIERRE DE RUTA', `${closure.routeName} - ${closure.distributorName}`, closure.products.map(row => ({ name: row.productName, basePrice: 0, quantity: row.sold, unitLabel: row.unitType === 'kg' ? 'kg vendidos' : 'vendidos', lineTotal: 0, modifiersText: [`Entregado ${row.totalLoaded}`, `Devuelto ${row.actualReturn}`, `Diferencia ${row.variance}`] })), closure.status === 'closed' ? `EFECTIVO ESPERADO: Bs ${round2(closure.expectedCash).toFixed(2)} | DECLARADO: Bs ${round2(closure.physicalCashDeclared).toFixed(2)}` : 'Cierre pendiente de completar'), `closure:${closure.id}`)
}

export async function printOperationalSheet(title: string, subtitle: string, rows: { name: string; detail: string }[], totals: { label: string; value: string }[] = []): Promise<void> {
  const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] || char)
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escape(title)}</title><style>@page{size:A4;margin:0}*{box-sizing:border-box}body{font-family:Arial;color:#172033;margin:0;padding:18mm}.head{display:flex;gap:20px;align-items:center;border-bottom:4px solid #c8102e}.head img{width:100px}.head h1{margin:0;color:#c8102e}table{width:100%;border-collapse:collapse;margin-top:24px}th{background:#c8102e;color:white;text-align:left;padding:10px}td{padding:11px;border-bottom:1px solid #ddd}.totals{margin-top:22px;margin-left:auto;width:330px}.totals p{display:flex;justify-content:space-between;font-weight:bold}.sign{margin-top:70px;display:flex;justify-content:space-around}.sign span{border-top:1px solid #333;padding:8px 35px}</style></head><body><header class="head"><img src="/brand/san-jose-logo.png"><div><h1>${escape(title)}</h1><p>${escape(subtitle)}</p></div></header><table><thead><tr><th>Producto / concepto</th><th>Detalle</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escape(row.name)}</td><td>${escape(row.detail)}</td></tr>`).join('')}</tbody></table><div class="totals">${totals.map(total => `<p><span>${escape(total.label)}</span><span>${escape(total.value)}</span></p>`).join('')}</div><div class="sign"><span>Entrega</span><span>Recibe</span></div></body></html>`
  await printHtmlDocument(html, title)
}
