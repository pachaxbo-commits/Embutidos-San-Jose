import { useEffect, useMemo, useState } from 'react'
import { Plus, Search, Share2, Printer, Pencil, Ban, Download, Copy } from 'lucide-react'
import { Modal } from '../../../components/ui/Modal'
import { Field, NumberInput, TextArea, TextInput } from '../../../components/ui/Form'
import { EmptyBlock, Screen } from '../../../components/ui/Screen'
import { cancelQuote, createQuote, newOperationId, subscribeQuotes, updateQuote } from '../data/distributionRepository'
import { round2 } from '../domain/engine'
import { printQuoteTicket } from '../data/distributionDocumentPrintService'
import type { DistQuote, DistQuoteLine } from '../types'
import type { DistributionViewProps } from './DistributionApp'
import { PrimaryButton, SecondaryButton, SectionCard, formatBs, formatQty } from './shared'

const dayAfter = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10) }
const esc = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
type DraftLine = DistQuoteLine & { key: string }

export function QuotesView({ session, data }: DistributionViewProps) {
  const [quotes, setQuotes] = useState<DistQuote[]>([])
  const [queryText, setQueryText] = useState('')
  const [editing, setEditing] = useState<DistQuote | null>(null)
  const [modal, setModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [prospectName, setProspectName] = useState('')
  const [prospectPhone, setProspectPhone] = useState('')
  const [validUntil, setValidUntil] = useState(dayAfter(7))
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [productId, setProductId] = useState('')
  const [qty, setQty] = useState('1')
  const [price, setPrice] = useState('0')

  useEffect(() => subscribeQuotes(session.role === 'admin', rows => setQuotes(rows.sort((a,b) => b.createdAt.localeCompare(a.createdAt))), e => setError(e.message)), [session.role])
  const visible = useMemo(() => quotes.filter(q => !queryText || `${q.quoteNumber} ${q.customerName} ${q.sellerName} ${q.lines.map(l => l.productNameSnapshot).join(' ')}`.toLowerCase().includes(queryText.toLowerCase())), [quotes, queryText])
  const selectedCustomer = data.customers.find(c => c.id === customerId)
  const total = round2(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0))

  const reset = (quote?: DistQuote) => {
    setEditing(quote || null); setCustomerId(quote?.customerId || ''); setProspectName(quote?.customerId ? '' : quote?.customerName || ''); setProspectPhone(quote?.customerPhone || '')
    setValidUntil(quote?.validUntil || dayAfter(7)); setNote(quote?.note || '')
    setLines(quote?.lines.map((line, i) => ({ ...line, key: `${line.productId}-${i}` })) || [])
    setProductId(''); setQty('1'); setPrice('0'); setError(''); setModal(true)
  }
  const duplicateQuote = (quote: DistQuote) => { reset(quote); setEditing(null) }
  const addProduct = () => {
    const product = data.products.find(p => p.id === productId)
    const quantity = Number(qty), unitPrice = Number(price)
    if (!product || !Number.isFinite(quantity) || quantity <= 0 || (product.unitType !== 'kg' && !Number.isInteger(quantity)) || !Number.isFinite(unitPrice) || unitPrice < 0) { setError('Revisa el producto, la cantidad y el precio.'); return }
    setLines(current => [...current, { key: newOperationId('line'), productId: product.id, productNameSnapshot: product.name, unitType: product.unitType, quantity, unitPrice, subtotal: round2(quantity * unitPrice) }])
    setProductId(''); setQty('1'); setPrice('0'); setError('')
  }
  const submit = async () => {
    if (!lines.length || !validUntil || (!customerId && !prospectName.trim())) { setError('Completa cliente, vigencia y al menos un producto.'); return }
    setSaving(true); setError('')
    try {
      const payload = { customerId: customerId || undefined, customerName: selectedCustomer?.name || prospectName.trim(), customerPhone: selectedCustomer?.phone || prospectPhone.trim(), validUntil, note, routeId: session.routeId || undefined, lines: lines.map(line => ({ productId: line.productId, productNameSnapshot: line.productNameSnapshot, unitType: line.unitType, quantity: line.quantity, unitPrice: line.unitPrice, subtotal: line.subtotal })) }
      if (editing) await updateQuote(editing.id, payload); else await createQuote(payload)
      setModal(false)
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar la cotización.') }
    finally { setSaving(false) }
  }
  const quoteHtml = (quote: DistQuote) => {
    const rows = quote.lines.map(l => `<tr><td>${esc(l.productNameSnapshot)}</td><td>${formatQty(l.quantity, l.unitType)}</td><td>${formatBs(l.unitPrice)}</td><td>${formatBs(l.subtotal)}</td></tr>`).join('')
    return `<!doctype html><html lang="es"><meta charset="utf-8"><title>${esc(quote.quoteNumber)}</title><style>body{font:14px Arial;color:#172033;margin:28px}.head{display:flex;align-items:center;gap:18px;border-bottom:4px solid #b51224;padding-bottom:14px}.head img{width:75px}h1{font-size:22px;margin:0}.tag{color:#b51224;font-weight:bold;font-size:20px}table{width:100%;border-collapse:collapse;margin-top:24px}th{background:#b51224;color:#fff;text-align:left}td,th{padding:10px;border-bottom:1px solid #ddd}.num{text-align:right}.total{text-align:right;font-size:22px;font-weight:bold;margin-top:20px}.note{margin-top:20px;color:#475569}.warning{padding:12px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;margin-top:20px}</style><header class="head"><img src="${location.origin}/brand/san-jose-logo.png"><div><h1>Embutidos San José</h1><div class="tag">COTIZACIÓN</div></div></header><p><b>Número:</b> ${esc(quote.quoteNumber)} · <b>Fecha:</b> ${new Date(quote.createdAt).toLocaleDateString('es-BO')}<br><b>Cliente:</b> ${esc(quote.customerName)}${quote.customerPhone ? ` · ${esc(quote.customerPhone)}` : ''}<br><b>Válida hasta:</b> ${new Date(`${quote.validUntil}T12:00:00`).toLocaleDateString('es-BO')}<br><b>Atendido por:</b> ${esc(quote.sellerName)} · ${esc(quote.routeName)}</p><table><thead><tr><th>Producto</th><th>Cantidad</th><th>Precio unitario</th><th class="num">Subtotal</th></tr></thead><tbody>${rows}</tbody></table><p class="total">TOTAL REFERENCIAL: ${formatBs(quote.total)}</p>${quote.note ? `<p class="note"><b>Observaciones:</b> ${esc(quote.note)}</p>` : ''}<p class="warning">Esta cotización no es una venta, no registra pagos y no reserva ni descuenta existencias. Precios sujetos a confirmación al momento de la compra.</p></html>`
  }
  const buildQuoteImage = async (quote: DistQuote) => {
    const productTextLines = quote.lines.reduce((sum, line) => sum + Math.max(1, Math.ceil(line.productNameSnapshot.length / 40)), 0)
    const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 620 + productTextLines * 52 + Math.ceil((quote.note || '').length / 88) * 30
    const ctx = canvas.getContext('2d'); if (!ctx) return
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#b51224'; ctx.fillRect(0, 0, 1000, 18)
    const logo = new Image(); logo.src = '/brand/san-jose-logo.png'; await new Promise<void>(resolve => { logo.onload = () => resolve(); logo.onerror = () => resolve() })
    if (logo.complete && logo.naturalWidth) ctx.drawImage(logo, 55, 38, 105, 70)
    ctx.fillStyle = '#172033'; ctx.font = 'bold 38px Arial'; ctx.fillText('EMBUTIDOS SAN JOSÉ', 185, 78)
    ctx.fillStyle = '#b51224'; ctx.font = 'bold 30px Arial'; ctx.fillText(`COTIZACIÓN ${quote.quoteNumber}`, 185, 122)
    ctx.fillStyle = '#475569'; ctx.font = '22px Arial'; ctx.fillText(`Cliente: ${quote.customerName}`, 60, 195, 880); ctx.fillText(`Válida hasta: ${quote.validUntil} · ${quote.routeName}`, 60, 232, 880); ctx.fillText(`Atendido por: ${quote.sellerName} · ${new Date(quote.createdAt).toLocaleDateString('es-BO')}`, 60, 268, 880)
    let y = 330; ctx.fillStyle = '#172033'; ctx.font = 'bold 23px Arial'; ctx.fillText('PRODUCTO',60,y); ctx.fillText('CANT.',625,y); ctx.fillText('TOTAL',820,y)
    y += 45; ctx.font = '21px Arial'
    const wrapProduct = (value: string) => { const result: string[]=[]; let current=''; for(const word of value.split(/\s+/)){const next=current?`${current} ${word}`:word;if(ctx.measureText(next).width>520&&current){result.push(current);current=word}else current=next}if(current)result.push(current);return result }
    quote.lines.forEach(line => { const nameLines=wrapProduct(line.productNameSnapshot); nameLines.forEach((text,index)=>ctx.fillText(text,60,y+index*27,520)); ctx.fillText(formatQty(line.quantity,line.unitType),625,y); ctx.textAlign = 'right'; ctx.fillText(formatBs(line.subtotal),940,y); ctx.textAlign='left'; y+=Math.max(42,nameLines.length*30) })
    ctx.strokeStyle='#cbd5e1'; ctx.beginPath(); ctx.moveTo(60,y); ctx.lineTo(940,y); ctx.stroke(); y+=55
    ctx.fillStyle='#b51224'; ctx.font='bold 34px Arial'; ctx.textAlign='right'; ctx.fillText(`TOTAL REFERENCIAL ${formatBs(quote.total)}`,940,y); ctx.textAlign='left'
    ctx.fillStyle='#475569'; ctx.font='20px Arial'; ctx.fillText('No es una venta ni reserva existencias.',60, y+65); ctx.fillText('Precios sujetos a confirmación al momento de la compra.',60,y+96)
    if (quote.note?.trim()) { ctx.font='19px Arial'; ctx.fillStyle='#334155'; const words=quote.note.trim().split(/\s+/); let line=''; let noteY=y+142; for(const word of words){const next=line?`${line} ${word}`:word;if(ctx.measureText(next).width>870&&line){ctx.fillText(`Observación: ${line}`,60,noteY,880);line=word;noteY+=28}else line=next}if(line)ctx.fillText(`Observación: ${line}`,60,noteY,880) }
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve,'image/png')); if (!blob) return
    const file = new File([blob], `${quote.quoteNumber}.png`, {type:'image/png'})
    return { blob, file }
  }
  const downloadImage = async (quote: DistQuote) => {
    const image = await buildQuoteImage(quote); if (!image) return
    const url = URL.createObjectURL(image.blob); const a=document.createElement('a'); a.href=url; a.download=image.file.name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  const shareImage = async (quote: DistQuote) => {
    const image = await buildQuoteImage(quote); if (!image) return
    if (navigator.share && navigator.canShare?.({files:[image.file]})) await navigator.share({files:[image.file], title:quote.quoteNumber})
    else await downloadImage(quote)
  }
  const printThermal = async (quote: DistQuote) => {
    try { setError(await printQuoteTicket(quote)) }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo imprimir la cotización.') }
  }

  return <Screen title="Cotizaciones" subtitle="Precios referenciales; no generan ventas ni mueven existencias.">
    <SectionCard title="Buscar cotizaciones"><div className="flex gap-2"><Search className="mt-3 text-slate-400" size={18}/><TextInput value={queryText} onChange={e=>setQueryText(e.target.value)} placeholder="Número, cliente o producto" /></div></SectionCard>
    <SectionCard title="Cotizaciones registradas" action={<PrimaryButton onClick={()=>reset()}><Plus size={16}/> Nueva</PrimaryButton>}>
      {!visible.length ? <EmptyBlock title="Aún no hay cotizaciones" description="Crea una propuesta para un cliente sin afectar ventas ni stock."/> : <div className="grid gap-3">{visible.map(q=>{const status=q.status==='cancelada'?'Cancelada':q.validUntil<new Date().toISOString().slice(0,10)?'Vencida':'Vigente';return <article key={q.id} className="rounded-2xl border-2 border-slate-200 bg-white p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-black text-slate-900">{q.quoteNumber} · {q.customerName}</p><p className="text-xs text-slate-500">{new Date(q.createdAt).toLocaleDateString('es-BO')} · válida hasta {new Date(`${q.validUntil}T12:00:00`).toLocaleDateString('es-BO')} · {q.sellerName}</p></div><strong className="text-lg text-[var(--primary)]">{formatBs(q.total)}</strong></div><div className="mt-2 flex flex-wrap gap-2"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold">{status}</span><span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-900">No reserva stock</span></div><div className="mt-2 grid gap-1 text-xs text-slate-600">{q.lines.map((line,i)=><p key={i}>{formatQty(line.quantity,line.unitType)} · {line.productNameSnapshot} × {formatBs(line.unitPrice)} = {formatBs(line.subtotal)}</p>)}</div>{q.note&&<p className="mt-2 text-xs text-slate-600">{q.note}</p>}<div className="mt-3 flex flex-wrap gap-2"><SecondaryButton onClick={()=>void downloadImage(q)}><Download size={15}/> Descargar imagen</SecondaryButton><SecondaryButton onClick={()=>void shareImage(q)}><Share2 size={15}/> Compartir cotización</SecondaryButton><SecondaryButton onClick={()=>void printThermal(q)}><Printer size={15}/> Imprimir ticket</SecondaryButton><SecondaryButton onClick={()=>{const w=window.open('', '_blank'); if(w){w.document.write(quoteHtml(q));w.document.close();w.focus();setTimeout(()=>w.print(),500)}}}><Printer size={15}/> Imprimir hoja / PDF</SecondaryButton><SecondaryButton onClick={()=>duplicateQuote(q)}><Copy size={15}/> Duplicar</SecondaryButton>{status==='Vigente'&&(session.role==='admin'||q.sellerUid===session.uid)&&<><SecondaryButton onClick={()=>reset(q)}><Pencil size={15}/> Editar</SecondaryButton><SecondaryButton onClick={()=>{const reason=window.prompt('Motivo de cancelación');if(reason)void cancelQuote(q.id,reason).catch(e=>setError(e.message))}}><Ban size={15}/> Cancelar</SecondaryButton></>}</div></article>})}</div>}
    </SectionCard>
    {error&&<p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p>}
    <Modal isOpen={modal} onClose={()=>setModal(false)} title={editing?'Editar cotización':'Nueva cotización'}><div className="grid gap-3">
      <Field label="Cliente registrado"><select className="min-h-12 rounded-xl border-2 border-slate-300 bg-white px-3" value={customerId} onChange={e=>{setCustomerId(e.target.value);setProspectName('')}}><option value="">Cliente potencial / sin registrar</option>{data.customers.filter(c=>c.active).map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></Field>
      {!customerId&&<><Field label="Nombre del cliente"><TextInput value={prospectName} onChange={e=>setProspectName(e.target.value)} placeholder="Nombre o empresa"/></Field><Field label="Teléfono (opcional)"><TextInput value={prospectPhone} onChange={e=>setProspectPhone(e.target.value)} /></Field></>}
      <Field label="Válida hasta"><TextInput type="date" value={validUntil} onChange={e=>setValidUntil(e.target.value)}/></Field>
      <div className="grid grid-cols-2 gap-2"><Field label="Producto"><select className="min-h-12 w-full rounded-xl border-2 border-slate-300 bg-white px-2" value={productId} onChange={e=>{setProductId(e.target.value);const p=data.products.find(x=>x.id===e.target.value);if(p)setPrice(String(p.referencePrice))}}><option value="">Seleccionar</option>{data.products.filter(p=>p.active).map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></Field><Field label="Cantidad"><NumberInput value={qty} onChange={e=>setQty(e.target.value)} min="0.01" step={data.products.find(p=>p.id===productId)?.unitType==='kg'?'0.01':'1'}/></Field></div>
      <div className="flex gap-2"><Field label="Precio unitario (Bs)"><NumberInput value={price} onChange={e=>setPrice(e.target.value)} min="0" step="0.01"/></Field><div className="self-end"><SecondaryButton onClick={addProduct}><Plus size={15}/> Agregar</SecondaryButton></div></div>
      {lines.map(line=><div key={line.key} className="flex items-center justify-between rounded-xl border border-slate-200 p-2 text-xs"><span>{formatQty(line.quantity,line.unitType)} · {line.productNameSnapshot} × {formatBs(line.unitPrice)}</span><button onClick={()=>setLines(xs=>xs.filter(x=>x.key!==line.key))} className="text-rose-700">Quitar</button></div>)}
      <p className="text-right text-xl font-black">Total referencial: {formatBs(total)}</p><Field label="Observaciones"><TextArea value={note} onChange={e=>setNote(e.target.value)} rows={2}/></Field><p className="rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-900">La cotización no registra pagos, no crea venta y no reserva ni descuenta stock.</p>{error&&<p className="text-sm font-bold text-rose-700">{error}</p>}<div className="flex justify-end gap-2"><SecondaryButton onClick={()=>setModal(false)}>Volver</SecondaryButton><PrimaryButton disabled={saving} onClick={()=>void submit()}>{saving?'Guardando…':'Guardar cotización'}</PrimaryButton></div>
    </div></Modal>
  </Screen>
}
