import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Copy, Download, FileText, Pencil, Plus, Printer, Search, Share2, Trash2, X } from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { Modal } from '../../../components/ui/Modal'
import { Field, NumberInput, TextArea, TextInput } from '../../../components/ui/Form'
import { EmptyBlock, Screen } from '../../../components/ui/Screen'
import { deleteQuote, createQuote, newOperationId, subscribeQuotes, updateQuote } from '../data/distributionRepository'
import { round2, toDayKey } from '../domain/engine'
import { printQuoteTicket } from '../data/distributionDocumentPrintService'
import { filterQuotes } from '../domain/quoteHistory'
import { getQuoteDocumentText } from '../domain/quoteDocumentText'
import { buildQuoteSharePayload } from '../domain/quoteSharePayload'
import type { DistQuote, DistQuoteLine } from '../types'
import type { DistributionViewProps } from './DistributionApp'
import { RangePicker } from './RangePicker'
import { PrimaryButton, SecondaryButton, SectionCard, formatBs, formatQty } from './shared'

const dayAfter = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return toDayKey(d) }
const esc = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const fileToBase64 = (file: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result || '').split(',', 2)[1] || '')
  reader.onerror = () => reject(reader.error || new Error('No se pudo preparar la imagen de la cotización.'))
  reader.readAsDataURL(file)
})
type DraftLine = DistQuoteLine & { key: string }
type Step = 'products' | 'client' | 'review' | 'success'

export function QuotesView({ session, data }: DistributionViewProps) {
  const [quotes, setQuotes] = useState<DistQuote[]>([])
  const [queryText, setQueryText] = useState('')
  const [dateRange, setDateRange] = useState<string[]>([])
  const [rangePickerKey, setRangePickerKey] = useState(0)
  const [filterCustomer, setFilterCustomer] = useState('')
  const [filterSeller, setFilterSeller] = useState('')
  const [step, setStep] = useState<Step | null>(null)
  const [editing, setEditing] = useState<DistQuote | null>(null)
  const [createdQuote, setCreatedQuote] = useState<DistQuote | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [customerMode, setCustomerMode] = useState<'registered' | 'quick'>('registered')
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [prospectName, setProspectName] = useState('')
  const [prospectPhone, setProspectPhone] = useState('')
  const [validUntil, setValidUntil] = useState(dayAfter(7))
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [productQuery, setProductQuery] = useState('')
  const [selectedProductId, setSelectedProductId] = useState('')
  const [qty, setQty] = useState('1')
  const [price, setPrice] = useState('0')
  const [deleteTarget, setDeleteTarget] = useState<DistQuote | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => subscribeQuotes(session.role === 'admin', rows => setQuotes(rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))), e => setError(e.message)), [session.role])
  const selectedCustomer = data.customers.find(c => c.id === customerId)
  const total = round2(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0))
  const sortedCustomers = useMemo(() => data.customers.filter(c => c.active).sort((a, b) => a.name.localeCompare(b.name)), [data.customers])
  const customerMatches = useMemo(() => {
    const q = customerSearch.trim().toLocaleLowerCase()
    return sortedCustomers.filter(c => !q || `${c.name} ${c.identityNumber || ''} ${c.customerCode || ''} ${c.phone || ''}`.toLocaleLowerCase().includes(q)).slice(0, 30)
  }, [sortedCustomers, customerSearch])
  const visible = useMemo(() => {
    const from = dateRange[0]
    const through = dateRange.at(-1)
    return filterQuotes(quotes, { query: queryText, from, through, customerId: filterCustomer, sellerUid: filterSeller, ownSellerUid: session.role === 'admin' ? undefined : session.uid })
  }, [quotes, queryText, dateRange, filterCustomer, filterSeller, session.role, session.uid])
  const customersWithQuotes = useMemo(() => sortedCustomers.filter(c => quotes.some(q => q.deleted !== true && q.customerId === c.id)), [sortedCustomers, quotes])
  const creators = useMemo(() => [...new Map(quotes.filter(q => q.deleted !== true).map(q => [q.sellerUid, q.sellerName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [quotes])
  const products = useMemo(() => data.products.filter(p => p.active && (!productQuery || p.name.toLocaleLowerCase().includes(productQuery.toLocaleLowerCase()))).sort((a, b) => a.name.localeCompare(b.name)), [data.products, productQuery])

  const reset = (quote?: DistQuote, duplicate = false) => {
    setEditing(duplicate ? null : quote || null)
    setCreatedQuote(null)
    setCustomerId(quote?.customerId || '')
    setCustomerMode(quote?.customerId ? 'registered' : 'quick')
    setCustomerSearch(''); setProspectName(quote?.customerId ? '' : quote?.customerName || ''); setProspectPhone(quote?.customerPhone || '')
    setValidUntil(duplicate ? dayAfter(7) : quote?.validUntil || dayAfter(7)); setNote(quote?.note || '')
    setLines(quote?.lines.map((line, i) => ({ ...line, key: `${line.productId}-${i}-${newOperationId('line')}` })) || [])
    setProductQuery(''); setSelectedProductId(''); setQty('1'); setPrice('0'); setError(''); setNotice(''); setStep('products')
  }
  const duplicateQuote = (quote: DistQuote) => reset(quote, true)
  const addProduct = () => {
    const product = data.products.find(p => p.id === selectedProductId)
    const quantity = Number(qty), unitPrice = Number(price)
    if (!product || !Number.isFinite(quantity) || quantity <= 0 || (product.unitType !== 'kg' && !Number.isInteger(quantity)) || !Number.isFinite(unitPrice) || unitPrice < 0) { setError('Revisa el producto, la cantidad y el precio.'); return }
    setLines(current => [...current, { key: newOperationId('line'), productId: product.id, productNameSnapshot: product.name, unitType: product.unitType, quantity, unitPrice, subtotal: round2(quantity * unitPrice) }])
    setSelectedProductId(''); setQty('1'); setPrice('0'); setError('')
  }
  const changeLine = (key: string, field: 'quantity' | 'unitPrice', value: string) => {
    const n = Number(value)
    setLines(current => current.map(line => line.key !== key ? line : ({ ...line, [field]: Number.isFinite(n) ? n : 0, subtotal: round2((field === 'quantity' ? n : line.quantity) * (field === 'unitPrice' ? n : line.unitPrice)) })))
  }
  const goClient = () => { if (!lines.length) { setError('Agrega por lo menos un producto.'); return }; setError(''); setStep('client') }
  const goReview = () => {
    if (customerMode === 'registered' && !selectedCustomer) { setError('Selecciona un cliente registrado o elige Cliente rápido.'); return }
    if (customerMode === 'quick' && !prospectName.trim()) { setError('Escribe el nombre del cliente.'); return }
    setError(''); setStep('review')
  }
  const submit = async () => {
    if (!lines.length || !validUntil || (customerMode === 'registered' ? !selectedCustomer : !prospectName.trim())) { setError('Completa los datos obligatorios antes de guardar.'); return }
    setSaving(true); setError('')
    try {
      const payload = { customerId: customerMode === 'registered' ? customerId : undefined, customerName: customerMode === 'registered' ? selectedCustomer!.name : prospectName.trim(), customerPhone: customerMode === 'registered' ? selectedCustomer?.phone || '' : prospectPhone.trim(), validUntil, note, routeId: session.routeId || undefined, lines: lines.map(line => ({ productId: line.productId, productNameSnapshot: line.productNameSnapshot, unitType: line.unitType, quantity: line.quantity, unitPrice: line.unitPrice, subtotal: round2(line.quantity * line.unitPrice) })) }
      const result = editing ? await updateQuote(editing.id, payload) : await createQuote(payload)
      setCreatedQuote(result); setStep('success')
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar la cotización.') }
    finally { setSaving(false) }
  }
  const quoteHtml = (quote: DistQuote) => {
    const documentText = getQuoteDocumentText(quote)
    const rows = quote.lines.map(l => `<tr><td>${esc(l.productNameSnapshot)}</td><td>${formatQty(l.quantity, l.unitType)}</td><td>${formatBs(l.unitPrice)}</td><td>${formatBs(l.subtotal)}</td></tr>`).join('')
    return `<!doctype html><html lang="es"><meta charset="utf-8"><title>${esc(documentText.number)}</title><style>body{font:14px Arial;color:#172033;margin:28px}.head{display:flex;align-items:center;gap:18px;border-bottom:4px solid #b51224;padding-bottom:14px}.head img{width:75px}h1{font-size:22px;margin:0}.tag{color:#b51224;font-weight:bold;font-size:20px}table{width:100%;border-collapse:collapse;margin-top:24px}th{background:#b51224;color:#fff;text-align:left}td,th{padding:10px;border-bottom:1px solid #ddd}.num{text-align:right}.total{text-align:right;font-size:22px;font-weight:bold;margin-top:20px}.note{margin-top:20px;color:#475569}</style><header class="head"><img src="${location.origin}/brand/san-jose-logo.png"><div><h1>${documentText.company}</h1><div class="tag">${documentText.title}</div></div></header><p><b>Número:</b> ${esc(documentText.number)} · <b>Fecha:</b> ${esc(documentText.date)}<br><b>Cliente:</b> ${esc(documentText.customer)}${documentText.phone ? ` · ${esc(documentText.phone)}` : ''}<br><b>Válida hasta:</b> ${esc(documentText.validUntil)}</p><table><thead><tr><th>Producto</th><th>Cantidad</th><th>Precio unitario</th><th class="num">Subtotal</th></tr></thead><tbody>${rows}</tbody></table><p class="total">TOTAL REFERENCIAL: ${formatBs(quote.total)}</p>${documentText.note ? `<p class="note"><b>Observaciones:</b> ${esc(documentText.note)}</p>` : ''}<p>${documentText.footer}</p></html>`
  }
  const buildQuoteImage = async (quote: DistQuote) => {
    const documentText = getQuoteDocumentText(quote)
    const productTextLines = quote.lines.reduce((sum, line) => sum + Math.max(1, Math.ceil(line.productNameSnapshot.length / 40)), 0)
    const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 640 + productTextLines * 52 + Math.ceil((quote.note || '').length / 88) * 30
    const ctx = canvas.getContext('2d'); if (!ctx) return
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#b51224'; ctx.fillRect(0, 0, 1000, 18)
    const logo = new Image(); logo.src = '/brand/san-jose-logo.png'; await new Promise<void>(resolve => { logo.onload = () => resolve(); logo.onerror = () => resolve() })
    if (logo.complete && logo.naturalWidth) ctx.drawImage(logo, 55, 38, 105, 70)
    ctx.fillStyle = '#172033'; ctx.font = 'bold 38px Arial'; ctx.fillText(documentText.company, 185, 78)
    ctx.fillStyle = '#b51224'; ctx.font = 'bold 30px Arial'; ctx.fillText(`${documentText.title} ${documentText.number}`, 185, 122)
    ctx.fillStyle = '#475569'; ctx.font = '22px Arial'; let y = 190
    ctx.fillText(`Fecha: ${documentText.date}`, 60, y); y += 36
    ctx.fillText(`Cliente: ${documentText.customer}`, 60, y, 880); y += 36
    if (documentText.phone) { ctx.fillText(`Teléfono: ${documentText.phone}`, 60, y); y += 36 }
    ctx.fillText(`Válida hasta: ${documentText.validUntil}`, 60, y); y += 55
    ctx.fillStyle = '#172033'; ctx.font = 'bold 23px Arial'; ctx.fillText('PRODUCTO',60,y); ctx.fillText('CANT.',625,y); ctx.fillText('PRECIO',760,y); ctx.fillText('TOTAL',940,y); y += 45; ctx.font = '21px Arial'
    const wrapProduct = (value: string) => { const result: string[]=[]; let current=''; for(const word of value.split(/\s+/)){const next=current?`${current} ${word}`:word;if(ctx.measureText(next).width>480&&current){result.push(current);current=word}else current=next}if(current)result.push(current);return result }
    quote.lines.forEach(line => { const nameLines=wrapProduct(line.productNameSnapshot); nameLines.forEach((text,index)=>ctx.fillText(text,60,y+index*27,480)); ctx.fillText(formatQty(line.quantity,line.unitType),625,y); ctx.fillText(formatBs(line.unitPrice),760,y); ctx.textAlign = 'right'; ctx.fillText(formatBs(line.subtotal),940,y); ctx.textAlign='left'; y+=Math.max(42,nameLines.length*30) })
    ctx.strokeStyle='#cbd5e1'; ctx.beginPath(); ctx.moveTo(60,y); ctx.lineTo(940,y); ctx.stroke(); y+=55
    ctx.fillStyle='#b51224'; ctx.font='bold 34px Arial'; ctx.textAlign='right'; ctx.fillText(`TOTAL REFERENCIAL ${formatBs(quote.total)}`,940,y); ctx.textAlign='left'; y += 60
    ctx.fillStyle='#475569'; ctx.font='20px Arial'; ctx.fillText(documentText.footer,60,y); y += 34
    if (documentText.note) { ctx.font='19px Arial'; ctx.fillStyle='#334155'; const words=documentText.note.split(/\s+/); let line=''; for(const word of words){const next=line?`${line} ${word}`:word;if(ctx.measureText(next).width>870&&line){ctx.fillText(`Observación: ${line}`,60,y,880);line=word;y+=28}else line=next}if(line)ctx.fillText(`Observación: ${line}`,60,y,880) }
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve,'image/png')); if (!blob) return
    const file = new File([blob], `${quote.quoteNumber}.png`, {type:'image/png'})
    return { blob, file }
  }
  const downloadImage = async (quote: DistQuote) => {
    setError(''); setNotice('')
    try {
      const image = await buildQuoteImage(quote); if (!image) throw new Error('No se pudo generar la imagen.')
      if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
        await Filesystem.writeFile({ path: `cotizaciones/${image.file.name}`, data: await fileToBase64(image.blob), directory: Directory.Documents, recursive: true })
        setNotice('Imagen guardada en Documentos de la aplicación.')
        return
      }
      const url = URL.createObjectURL(image.blob); const a=document.createElement('a'); a.href=url; a.download=image.file.name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000)
      setNotice('Imagen descargada.')
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar la imagen.') }
  }
  const shareImage = async (quote: DistQuote) => {
    setError(''); setNotice('')
    try {
      const image = await buildQuoteImage(quote); if (!image) throw new Error('No se pudo generar la imagen.')
      if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
        const path = `shared/cotizacion-${quote.id}-${Date.now()}.png`
        await Filesystem.writeFile({ path, data: await fileToBase64(image.blob), directory: Directory.Cache, recursive: true })
        try {
          await Share.share(buildQuoteSharePayload(quote, (await Filesystem.getUri({ path, directory: Directory.Cache })).uri))
          setNotice('Elige WhatsApp u otra aplicación para enviar la cotización.')
        } finally {
          window.setTimeout(() => { void Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => undefined) }, 120_000)
        }
        return
      }
      const nav = navigator as Navigator & { share?: (data: { title?: string; files?: File[] }) => Promise<void>; canShare?: (data: { files: File[] }) => boolean }
      if (nav.share && (!nav.canShare || nav.canShare({ files: [image.file] }))) await nav.share({ files: [image.file], title: quote.quoteNumber })
      else await downloadImage(quote)
    } catch (e) {
      if (/cancel|dismiss/i.test(e instanceof Error ? e.message : '')) return
      setError(e instanceof Error ? e.message : 'No se pudo abrir las opciones para compartir.')
    }
  }
  const printThermal = async (quote: DistQuote) => { try { setError(await printQuoteTicket(quote)) } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo imprimir la cotización.') } }
  const confirmDelete = async () => { if (!deleteTarget) return; setDeleting(true); setError(''); try { await deleteQuote(deleteTarget.id); setDeleteTarget(null) } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo eliminar la cotización.') } finally { setDeleting(false) } }
  const clearFilters = () => { setQueryText(''); setDateRange([]); setRangePickerKey(key => key + 1); setFilterCustomer(''); setFilterSeller('') }
  const stepTitle = step === 'products' ? '1. Productos' : step === 'client' ? '2. Cliente' : step === 'review' ? '3. Revisar y crear' : 'Cotización creada'

  if (step) return <Screen title={stepTitle} subtitle={step === 'success' ? 'La cotización está lista para compartir.' : 'Productos → Cliente → Finalizar'}>
    {step !== 'success' && <div className="mb-3 flex flex-wrap gap-2"><span className={`rounded-full px-3 py-2 text-sm font-bold ${step === 'products' ? 'bg-[var(--primary)] text-white' : 'bg-slate-100'}`}>Productos</span><span className={`rounded-full px-3 py-2 text-sm font-bold ${step === 'client' ? 'bg-[var(--primary)] text-white' : 'bg-slate-100'}`}>Cliente</span><span className={`rounded-full px-3 py-2 text-sm font-bold ${step === 'review' ? 'bg-[var(--primary)] text-white' : 'bg-slate-100'}`}>Finalizar</span></div>}
    {error && <p role="alert" className="mb-3 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p>}
    {notice && <p role="status" className="mb-3 rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{notice}</p>}
    {step === 'products' && <div className="grid gap-3 lg:grid-cols-[1.2fr_.8fr]">
      <SectionCard title="Elegir productos"><div className="mb-3 flex gap-2"><Search className="mt-3 text-slate-400" size={18}/><TextInput value={productQuery} onChange={e=>setProductQuery(e.target.value)} placeholder="Buscar producto" /></div><div className="grid max-h-[42vh] gap-2 overflow-y-auto sm:grid-cols-2">{products.map(p=><button key={p.id} onClick={()=>{setSelectedProductId(p.id);setPrice(String(p.referencePrice))}} className={`rounded-xl border-2 p-3 text-left ${selectedProductId===p.id?'border-emerald-500 bg-emerald-50':'border-slate-200 bg-white'}`}><span className="block font-bold">{p.name}</span><span className="text-sm text-slate-500">{formatBs(p.referencePrice)} / {p.unitType==='kg'?'kg':'unidad'}</span></button>)}</div><div className="mt-3 grid gap-2 sm:grid-cols-[1fr_.6fr_.8fr_auto]"><Field label="Producto seleccionado"><TextInput readOnly value={data.products.find(p=>p.id===selectedProductId)?.name || ''} placeholder="Elige un producto" /></Field><Field label="Cantidad"><NumberInput value={qty} onChange={e=>setQty(e.target.value)} min="0.01" step={data.products.find(p=>p.id===selectedProductId)?.unitType==='kg'?'0.01':'1'}/></Field><Field label="Precio unitario (Bs)"><NumberInput value={price} onChange={e=>setPrice(e.target.value)} min="0" step="0.01"/></Field><div className="self-end"><PrimaryButton disabled={!selectedProductId} onClick={addProduct}><Plus size={16}/> Agregar</PrimaryButton></div></div></SectionCard>
      <SectionCard title={`Carrito de cotización (${lines.length})`}>{!lines.length?<p className="text-sm text-slate-500">Selecciona productos para preparar la cotización.</p>:<div className="grid gap-2">{lines.map(line=><div key={line.key} className="rounded-xl border-2 border-slate-200 p-3"><div className="flex items-start justify-between gap-2"><b>{line.productNameSnapshot}</b><button aria-label="Quitar producto" className="text-rose-700" onClick={()=>setLines(xs=>xs.filter(x=>x.key!==line.key))}><Trash2 size={18}/></button></div><div className="mt-2 grid grid-cols-2 gap-2"><Field label="Cantidad"><NumberInput min="0.01" step={line.unitType==='kg'?'0.01':'1'} value={String(line.quantity)} onChange={e=>changeLine(line.key,'quantity',e.target.value)}/></Field><Field label="Precio unitario"><NumberInput min="0" step="0.01" value={String(line.unitPrice)} onChange={e=>changeLine(line.key,'unitPrice',e.target.value)}/></Field></div><p className="mt-2 text-right font-bold">Subtotal: {formatBs(round2(line.quantity*line.unitPrice))}</p></div>)}</div>}<p className="mt-3 text-right text-xl font-black">Total cotizado: {formatBs(total)}</p><div className="mt-3 flex justify-end"><PrimaryButton disabled={!lines.length} onClick={goClient}>Continuar <ArrowRight size={16}/></PrimaryButton></div></SectionCard>
    </div>}
    {step === 'client' && <SectionCard title="Seleccionar cliente"><div className="mb-3 grid grid-cols-2 gap-2"><button onClick={()=>{setCustomerMode('registered');setError('')}} className={`rounded-xl border-2 p-3 font-bold ${customerMode==='registered'?'border-[var(--primary)] bg-rose-50 text-[var(--primary)]':'border-slate-200'}`}>Cliente registrado</button><button onClick={()=>{setCustomerMode('quick');setCustomerId('');setError('')}} className={`rounded-xl border-2 p-3 font-bold ${customerMode==='quick'?'border-amber-400 bg-amber-50 text-amber-900':'border-slate-200'}`}>Cliente rápido</button></div>{customerMode==='registered'?<><TextInput value={customerSearch} onChange={e=>setCustomerSearch(e.target.value)} placeholder="Buscar por nombre, CI, código o teléfono"/><div className="mt-3 grid max-h-[48vh] gap-2 overflow-y-auto sm:grid-cols-2">{customerMatches.map(c=><button key={c.id} onClick={()=>setCustomerId(c.id)} className={`rounded-xl border-2 p-3 text-left ${customerId===c.id?'border-emerald-500 bg-emerald-50':'border-slate-200 bg-white'}`}><b>{c.name}</b><span className="block text-sm text-slate-500">{[c.identityNumber||c.customerCode,c.phone].filter(Boolean).join(' · ')}</span></button>)}</div>{customerId&&<p className="mt-2 font-semibold text-emerald-700">Seleccionado: {selectedCustomer?.name}</p>}</>:<div className="grid gap-3 sm:grid-cols-2"><Field label="Nombre del cliente *"><TextInput value={prospectName} onChange={e=>setProspectName(e.target.value)} placeholder="Nombre o empresa"/></Field><Field label="Teléfono (opcional)"><TextInput value={prospectPhone} onChange={e=>setProspectPhone(e.target.value)}/></Field><p className="text-sm text-slate-500 sm:col-span-2">Este dato solo aparecerá en la cotización; no crea un cliente registrado.</p></div>}<div className="mt-4 flex justify-between"><SecondaryButton onClick={()=>setStep('products')}><ArrowLeft size={16}/> Productos</SecondaryButton><PrimaryButton onClick={goReview}>Continuar <ArrowRight size={16}/></PrimaryButton></div></SectionCard>}
    {step === 'review' && <div className="grid gap-3 lg:grid-cols-[1fr_.8fr]"><SectionCard title="Datos finales"><Field label="Válida hasta"><TextInput type="date" value={validUntil} min={toDayKey(new Date())} onChange={e=>setValidUntil(e.target.value)}/></Field><Field label="Observación (opcional)"><TextArea value={note} onChange={e=>setNote(e.target.value)} rows={3}/></Field></SectionCard><SectionCard title="Revisar cotización"><p><b>Cliente:</b> {customerMode==='registered'?selectedCustomer?.name:prospectName} {((customerMode==='registered'?selectedCustomer?.phone:prospectPhone)||'')&&<span className="text-slate-500">· {customerMode==='registered'?selectedCustomer?.phone:prospectPhone}</span>}</p><p className="mt-1"><b>Válida hasta:</b> {validUntil}</p><div className="my-3 grid gap-1 border-y border-slate-200 py-3">{lines.map(line=><div key={line.key} className="flex justify-between gap-2 text-sm"><span>{formatQty(line.quantity,line.unitType)} · {line.productNameSnapshot} × {formatBs(line.unitPrice)}</span><b>{formatBs(round2(line.quantity*line.unitPrice))}</b></div>)}</div><p className="text-right text-xl font-black">Total: {formatBs(total)}</p><div className="mt-4 flex flex-wrap justify-between gap-2"><SecondaryButton onClick={()=>setStep('client')}><ArrowLeft size={16}/> Volver</SecondaryButton><PrimaryButton disabled={saving} onClick={()=>void submit()}>{saving?'Guardando…':editing?'Guardar cambios':'Crear cotización'} <Check size={16}/></PrimaryButton></div></SectionCard></div>}
    {step === 'success' && createdQuote && <SectionCard title={editing?'Cotización actualizada':'Cotización creada'}><div className="mx-auto max-w-xl text-center"><div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-emerald-700"><Check size={30}/></div><p className="text-xl font-black">{createdQuote.quoteNumber}</p><p className="mt-1">{createdQuote.customerName}</p><p className="text-2xl font-black text-[var(--primary)]">{formatBs(createdQuote.total)}</p><p className="text-sm text-slate-500">Válida hasta {createdQuote.validUntil}</p><div className="mt-5 grid gap-2 sm:grid-cols-3"><PrimaryButton onClick={()=>void shareImage(createdQuote)}><Share2 size={17}/> Enviar imagen</PrimaryButton><SecondaryButton onClick={()=>void downloadImage(createdQuote)}><Download size={17}/> Descargar imagen</SecondaryButton><SecondaryButton onClick={()=>void printThermal(createdQuote)}><Printer size={17}/> Imprimir ticket</SecondaryButton></div><div className="mt-3 flex flex-wrap justify-center gap-2"><SecondaryButton onClick={()=>reset()}><Plus size={16}/> Nueva cotización</SecondaryButton><SecondaryButton onClick={()=>{setStep(null);setCreatedQuote(null)}}>Volver al historial</SecondaryButton><SecondaryButton onClick={()=>{const w=window.open('', '_blank'); if(w){w.document.write(quoteHtml(createdQuote));w.document.close();w.focus();setTimeout(()=>w.print(),500)}}}><FileText size={16}/> Imprimir hoja / PDF</SecondaryButton></div></div></SectionCard>}
    {step !== 'success' && <div className="mt-3"><SecondaryButton onClick={()=>{setStep(null);setEditing(null);setError('')}}>Salir al historial</SecondaryButton></div>}
  </Screen>

  return <Screen title="Cotizaciones" subtitle="Prepara y comparte propuestas para tus clientes.">
    <SectionCard title="Buscar cotizaciones" action={<PrimaryButton onClick={()=>reset()}><Plus size={16}/> Nueva cotización</PrimaryButton>}><div className="grid gap-3"><div className="flex gap-2"><Search className="mt-3 text-slate-400" size={18}/><TextInput value={queryText} onChange={e=>setQueryText(e.target.value)} placeholder="Número, cliente o producto"/></div><div className="grid gap-3 lg:grid-cols-3"><div className="lg:col-span-3"><RangePicker key={rangePickerKey} dayKeys={dateRange} onChange={setDateRange}/></div><Field label="Cliente registrado"><select className="min-h-12 w-full rounded-xl border-2 border-slate-300 bg-white px-3" value={filterCustomer} onChange={e=>setFilterCustomer(e.target.value)}><option value="">Todos los clientes</option>{customersWithQuotes.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>{session.role==='admin'&&<Field label="Creado por"><select className="min-h-12 w-full rounded-xl border-2 border-slate-300 bg-white px-3" value={filterSeller} onChange={e=>setFilterSeller(e.target.value)}><option value="">Todos los usuarios</option>{creators.map(([uid,name])=><option key={uid} value={uid}>{name}</option>)}</select></Field>}<div className="self-end"><SecondaryButton onClick={clearFilters}><X size={16}/> Limpiar filtros</SecondaryButton></div></div></div></SectionCard>
    {error&&<p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p>}
    {notice&&<p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{notice}</p>}
    <SectionCard title={`Cotizaciones registradas (${visible.length})`}>{!visible.length?<EmptyBlock title="No hay cotizaciones para mostrar" description="Prueba otros filtros o crea una propuesta nueva."/>:<div className="grid gap-3">{visible.map(q=>{const status=q.status==='cancelada'?'Cancelada':q.validUntil<toDayKey(new Date())?'Vencida':'Vigente'; const canManage=session.role==='admin'||q.sellerUid===session.uid;return <article key={q.id} className="rounded-2xl border-2 border-slate-200 bg-white p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-black text-slate-900">{q.quoteNumber} · {q.customerName}</p><p className="text-xs text-slate-500">{new Date(q.createdAt).toLocaleDateString('es-BO')} · válida hasta {new Date(`${q.validUntil}T12:00:00`).toLocaleDateString('es-BO')}{session.role==='admin'?` · ${q.sellerName}`:''}</p></div><strong className="text-lg text-[var(--primary)]">{formatBs(q.total)}</strong></div><div className="mt-2"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold">{status}</span></div><div className="mt-2 grid gap-1 text-xs text-slate-600">{q.lines.map((line,i)=><p key={i}>{formatQty(line.quantity,line.unitType)} · {line.productNameSnapshot} × {formatBs(line.unitPrice)} = {formatBs(line.subtotal)}</p>)}</div>{q.note&&<p className="mt-2 text-xs text-slate-600">Observación: {q.note}</p>}<div className="mt-3 flex flex-wrap gap-2"><SecondaryButton onClick={()=>void downloadImage(q)}><Download size={15}/> Descargar imagen</SecondaryButton><SecondaryButton onClick={()=>void shareImage(q)}><Share2 size={15}/> Compartir</SecondaryButton><SecondaryButton onClick={()=>void printThermal(q)}><Printer size={15}/> Imprimir ticket</SecondaryButton><SecondaryButton onClick={()=>{const w=window.open('', '_blank'); if(w){w.document.write(quoteHtml(q));w.document.close();w.focus();setTimeout(()=>w.print(),500)}}}><Printer size={15}/> Imprimir hoja / PDF</SecondaryButton><SecondaryButton onClick={()=>duplicateQuote(q)}><Copy size={15}/> Duplicar</SecondaryButton>{canManage&&status==='Vigente'&&<SecondaryButton onClick={()=>reset(q)}><Pencil size={15}/> Editar</SecondaryButton>}{canManage&&<SecondaryButton onClick={()=>setDeleteTarget(q)}><Trash2 size={15}/> Eliminar</SecondaryButton>}</div></article>})}</div>}</SectionCard>
    <Modal isOpen={!!deleteTarget} onClose={()=>!deleting&&setDeleteTarget(null)} title="Eliminar cotización">{deleteTarget&&<div className="grid gap-3"><div className="rounded-xl border-2 border-slate-200 bg-slate-50 p-3"><b>{deleteTarget.quoteNumber}</b><p>{deleteTarget.customerName}</p><p className="font-bold">{formatBs(deleteTarget.total)}</p></div><p>¿Deseas eliminar esta cotización? Dejará de aparecer en el historial.</p><div className="flex justify-end gap-2"><SecondaryButton disabled={deleting} onClick={()=>setDeleteTarget(null)}>Volver</SecondaryButton><PrimaryButton disabled={deleting} onClick={()=>void confirmDelete()}><Trash2 size={16}/>{deleting?'Eliminando…':'Eliminar'}</PrimaryButton></div></div>}</Modal>
  </Screen>
}
