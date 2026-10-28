import { useEffect, useMemo, useRef, useState } from 'react'
import { Field, NumberInput, TextArea, TextInput } from '../../../components/ui/Form'
import { EmptyBlock } from '../../../components/ui/Screen'
import { Modal } from '../../../components/ui/Modal'
import { saveExpenseSupplier, registerSupplierPurchase, paySupplierPayable, voidSupplierPayment, voidSupplierPurchase, newOperationId, subscribeExpenseSuppliers, subscribeExpensePayables, subscribeSupplierPayments } from '../data/distributionRepository'
import { PrimaryButton, SecondaryButton, formatBs } from './shared'
import { listExpenseGroups, mergeExpenseCategories } from '../domain/expenseCategories'
import type { DistPayable, DistSupplier, DistSupplierPayment } from '../types'
import type { DistributionViewProps } from './DistributionApp'

export function SupplierPayablesView({ data, readOnly }: DistributionViewProps & { readOnly: boolean }) {
  const [suppliers, setSuppliers] = useState<DistSupplier[]>([])
  const [payables, setPayables] = useState<DistPayable[]>([])
  const [payments, setPayments] = useState<DistSupplierPayment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  const [purchaseOpen, setPurchaseOpen] = useState(false)
  const [supplierOpen, setSupplierOpen] = useState(false)
  const [paymentTarget, setPaymentTarget] = useState<DistPayable | null>(null)
  const [voidTarget, setVoidTarget] = useState<{ kind: 'payment'; payment: DistSupplierPayment } | { kind: 'purchase'; payable: DistPayable } | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [newSupplierName, setNewSupplierName] = useState('')
  const [newSupplierPhone, setNewSupplierPhone] = useState('')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [initialPayment, setInitialPayment] = useState('0')
  const [paymentMethod, setPaymentMethod] = useState<'cash'|'transfer'|'other'>('cash')
  const [dayKey, setDayKey] = useState(new Date().toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' }))
  const [dueDayKey, setDueDayKey] = useState('')
  const [groupId, setGroupId] = useState('production_input')
  const [categoryId, setCategoryId] = useState('')
  const [note, setNote] = useState('')
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState<'cash'|'transfer'|'other'>('cash')
  const lock = useRef(false)
  const operationId = useRef<string | null>(null)
  useEffect(() => {
    let loaded = 0
    const mark = () => { loaded++; if (loaded >= 3) setLoading(false) }
    const fail = (reason: Error) => { setError(reason.message); setLoading(false) }
    const stops = [
      subscribeExpenseSuppliers(rows => { setSuppliers(rows); mark() }, fail),
      subscribeExpensePayables(rows => { setPayables(rows.sort((a,b)=>b.dayKey.localeCompare(a.dayKey))); mark() }, fail),
      subscribeSupplierPayments(rows => { setPayments(rows.sort((a,b)=>b.dayKey.localeCompare(a.dayKey))); mark() }, fail),
    ]
    return () => stops.forEach(stop => stop())
  }, [])
  const allGroups = useMemo(() => listExpenseGroups(data.expenseGroups), [data.expenseGroups])
  const allCategories = useMemo(() => mergeExpenseCategories(data.expenseCategories), [data.expenseCategories])
  const productionGroups = useMemo(() => allGroups.filter(group => group.active && group.economicType === 'production_input'), [allGroups])
  const categories = useMemo(() => allCategories.filter(category => category.active && category.group === groupId), [allCategories, groupId])
  const pendingTotal = payables.filter(item => item.status !== 'voided').reduce((sum,item)=>sum+item.balance,0)
  const paidTotal = payables.filter(item => item.status !== 'voided').reduce((sum,item)=>sum+item.paidAmount,0)
  const resetPurchase = () => { setSupplierId(''); setDescription(''); setAmount(''); setInitialPayment('0'); setPaymentMethod('cash'); setDayKey(new Date().toLocaleDateString('en-CA',{timeZone:'America/La_Paz'})); setDueDayKey(''); setGroupId(productionGroups[0]?.id || 'production_input'); setCategoryId(''); setNote(''); operationId.current = null }
  const createSupplier = async () => {
    if (!newSupplierName.trim()) { setError('Escribe el nombre del proveedor.'); return }
    setError('')
    try { const id = newOperationId('supplier'); await saveExpenseSupplier({ supplierId:id, name:newSupplierName.trim(), phone:newSupplierPhone.trim(), active:true }); setSupplierId(id); setNewSupplierName(''); setNewSupplierPhone(''); setSupplierOpen(false); setFeedback('Proveedor guardado.') }
    catch (failure) { setError((failure as Error).message || 'No se pudo guardar el proveedor.') }
  }
  const savePurchase = async () => {
    if (lock.current) return
    if (!supplierId || !categoryId || !description.trim() || !(Number(amount)>0) || !(Number(initialPayment)>=0) || Number(initialPayment)>Number(amount)) { setError('Completa proveedor, categoría, descripción, monto y adelanto válido.'); return }
    lock.current = true; setBusy(true); setError('')
    try { const id = operationId.current || (operationId.current = newOperationId('supplier-purchase')); await registerSupplierPurchase({ operationId:id, supplierId, groupId, categoryId, description:description.trim(), amount:Number(amount), initialPayment:Number(initialPayment), paymentMethod, dayKey, ...(dueDayKey?{dueDayKey}:{}), note:note.trim() }); setFeedback('Compra registrada. El saldo pendiente quedó en Cuentas por pagar; no se agregó stock.'); setPurchaseOpen(false); resetPurchase() }
    catch (failure) { setError((failure as Error).message || 'No se pudo registrar la compra. Reintenta sin cambiar los datos para evitar duplicaciones.') }
    finally { lock.current=false; setBusy(false) }
  }
  const savePayment = async () => {
    if (!paymentTarget || lock.current) return
    if (!(Number(payAmount)>0) || Number(payAmount)>paymentTarget.balance) { setError('El abono debe ser mayor que cero y no superar el saldo.'); return }
    lock.current=true; setBusy(true); setError('')
    try { const id=operationId.current || (operationId.current=newOperationId('supplier-payment')); await paySupplierPayable({ payableId:paymentTarget.id, amount:Number(payAmount), paymentMethod:payMethod, dayKey, note:note.trim() }, id); setFeedback('Pago registrado y saldo actualizado. El pago no se registró como una segunda compra.'); setPaymentTarget(null); setPayAmount(''); setNote(''); operationId.current=null }
    catch(failure){ setError((failure as Error).message || 'No se pudo registrar el pago. Reintenta con la misma operación.') }
    finally { lock.current=false; setBusy(false) }
  }
  const saveVoid = async () => {
    if (!voidTarget || !voidReason.trim() || lock.current) return
    lock.current = true; setBusy(true); setError('')
    try {
      if (voidTarget.kind === 'payment') await voidSupplierPayment({ paymentId: voidTarget.payment.id, reason: voidReason.trim() })
      else await voidSupplierPurchase({ payableId: voidTarget.payable.id, reason: voidReason.trim() })
      setFeedback(voidTarget.kind === 'payment' ? 'Corrección registrada. El pago original permanece en el historial.' : 'Compra anulada con auditoría; el registro original permanece consultable.')
      setVoidTarget(null); setVoidReason('')
    } catch (failure) { setError((failure as Error).message || 'No se pudo guardar la corrección auditada.') }
    finally { lock.current = false; setBusy(false) }
  }
  const statusLabel = (row: DistPayable) => row.status === 'paid' ? 'Pagada' : row.status === 'partial' ? 'Pago parcial' : row.status === 'voided' ? 'Anulada' : 'Pendiente'
  return <section className="grid min-w-0 gap-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-lg font-black">Cuentas por pagar</h2><p className="text-xs text-slate-600">Compras a proveedores y pagos posteriores. Registrar una compra no aumenta el inventario.</p></div><div className="flex gap-2"><SecondaryButton disabled={readOnly} onClick={()=>{setSupplierOpen(true);setError('')}}>Administrar proveedores</SecondaryButton><PrimaryButton disabled={readOnly} onClick={()=>{resetPurchase();setPurchaseOpen(true);setError('')}}>Nueva compra</PrimaryButton></div></div>
    <div className="grid gap-2 sm:grid-cols-3"><article className="rounded-xl bg-white p-3"><span className="text-xs text-slate-500">Deuda pendiente</span><strong className="block">{formatBs(pendingTotal)}</strong></article><article className="rounded-xl bg-white p-3"><span className="text-xs text-slate-500">Pagado en compras registradas</span><strong className="block">{formatBs(paidTotal)}</strong></article><article className="rounded-xl bg-white p-3"><span className="text-xs text-slate-500">Proveedores activos</span><strong className="block">{suppliers.filter(s=>s.active).length}</strong></article></div>
    {loading&&<p role="status" className="rounded-xl bg-slate-50 p-3 text-sm">Cargando cuentas de proveedor…</p>}{error&&<p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-800">{error}</p>}{feedback&&<p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{feedback}</p>}
    {!loading&&payables.length===0?<EmptyBlock title="Todavía no hay compras a crédito registradas"/>:<div className="grid gap-2">{payables.map(row=><details key={row.id} className="rounded-2xl border border-slate-200 bg-white"><summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 p-3"><span className="min-w-0"><strong className="block break-words">{row.supplierName} · {row.description}</strong><small className="text-slate-500">{row.dayKey} · {row.groupName} / {row.categoryName} · {statusLabel(row)}</small></span><span className="text-right"><strong>{formatBs(row.balance)}</strong><small className="block text-slate-500">saldo de {formatBs(row.totalAmount)}</small></span></summary><div className="grid gap-2 border-t border-slate-100 p-3 text-sm"><p>Pagado: {formatBs(row.paidAmount)} · Vence: {row.dueDayKey || 'No definido'} · Responsable: {row.createdBy || 'Administración'}</p>{row.note&&<p className="text-xs text-slate-600">{row.note}</p>}{row.status!=='paid'&&row.status!=='voided'&&row.balance>0&&<PrimaryButton disabled={readOnly} onClick={()=>{setPaymentTarget(row);setPayAmount(String(row.balance));setError('');setNote('');operationId.current=null}}>Registrar abono</PrimaryButton>}{row.status!=='voided'&&row.paidAmount===0&&<SecondaryButton disabled={readOnly} onClick={()=>{setVoidTarget({kind:'purchase',payable:row});setVoidReason('');setError('')}}>Anular compra con motivo</SecondaryButton>}<div className="grid gap-1">{payments.filter(payment=>payment.payableId===row.id).map(payment=><div key={payment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-2 text-xs"><span>{payment.dayKey} · {payment.responsibleName} · {payment.paymentMethod==='cash'?'Efectivo':payment.paymentMethod==='transfer'?'QR / transferencia':'Otro'}{payment.voided?` · ANULADO: ${payment.voidReason || 'sin motivo'}`:''}</span><span className="flex items-center gap-2"><strong>{formatBs(payment.amount)}</strong>{!payment.voided&&<SecondaryButton disabled={readOnly} onClick={()=>{setVoidTarget({kind:'payment',payment});setVoidReason('');setError('')}}>Corregir pago</SecondaryButton>}</span></div>)}</div>{(row.history||[]).map((event,index)=><p key={`${event.at}-${index}`} className="text-xs text-amber-800">Auditoría: {event.action==='purchase_voided'?'compra anulada':'pago corregido'} · {event.at} · {event.byName} · {event.reason}</p>)}</div></details>)}</div>}
    <Modal isOpen={purchaseOpen} onClose={()=>!busy&&setPurchaseOpen(false)} title="Registrar compra a proveedor" subtitle="La compra se registra como costo de producción; no crea existencias ni descuenta saldo de caja si queda a crédito." footer={<div className="grid grid-cols-2 gap-2"><SecondaryButton full disabled={busy} onClick={()=>setPurchaseOpen(false)}>Cancelar</SecondaryButton><PrimaryButton full disabled={readOnly||busy} onClick={()=>void savePurchase()}>{busy?'Guardando…':'Confirmar compra'}</PrimaryButton></div>}>
      <div className="grid gap-3"><Field label="Proveedor" required><div className="flex gap-2"><select value={supplierId} onChange={event=>setSupplierId(event.target.value)} className="h-11 min-w-0 flex-1 rounded-xl border-2 border-slate-200 bg-white px-3"><option value="">Seleccionar proveedor</option>{suppliers.filter(s=>s.active).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select><SecondaryButton onClick={()=>setSupplierOpen(true)}>Nuevo</SecondaryButton></div></Field><Field label="Grupo de producción" required><select value={groupId} onChange={event=>{setGroupId(event.target.value);setCategoryId('')}} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3">{productionGroups.map(group=><option key={group.id} value={group.id}>{group.label}</option>)}</select></Field><Field label="Categoría" required><select value={categoryId} onChange={event=>setCategoryId(event.target.value)} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3"><option value="">Seleccionar</option>{categories.map(category=><option key={category.id} value={category.id}>{category.name}</option>)}</select></Field><Field label="Descripción de materia prima" required><TextArea value={description} onChange={event=>setDescription(event.target.value)} placeholder="Ej.: harina, condimentos…"/></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Monto total (Bs)" required><NumberInput min={0} step={0.01} value={amount} onChange={event=>setAmount(event.target.value)}/></Field><Field label="Adelanto inicial (Bs)"><NumberInput min={0} max={Number(amount)||undefined} step={0.01} value={initialPayment} onChange={event=>setInitialPayment(event.target.value)}/></Field></div>{Number(amount)>0&&<p className="rounded-xl bg-slate-50 p-3 text-sm">Saldo por pagar: <strong>{formatBs(Math.max(0,Number(amount)-Number(initialPayment||0)))}</strong> · Salida al registrar: <strong>{paymentMethod==='cash'?formatBs(Number(initialPayment||0)):'Bs 0,00 en efectivo'}</strong></p>}<Field label="Forma de pago del adelanto"><select value={paymentMethod} onChange={event=>setPaymentMethod(event.target.value as typeof paymentMethod)} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3"><option value="cash">Efectivo</option><option value="transfer">QR / transferencia</option><option value="other">Otro</option></select></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Fecha de compra" required><TextInput type="date" value={dayKey} onChange={event=>setDayKey(event.target.value)}/></Field><Field label="Vencimiento"><TextInput type="date" min={dayKey} value={dueDayKey} onChange={event=>setDueDayKey(event.target.value)}/></Field></div><Field label="Observación"><TextArea value={note} onChange={event=>setNote(event.target.value)}/></Field>{error&&<p role="alert" className="text-xs font-bold text-rose-700">{error}</p>}</div>
    </Modal>
    <Modal isOpen={supplierOpen} onClose={()=>setSupplierOpen(false)} title="Agregar proveedor" footer={<div className="grid grid-cols-2 gap-2"><SecondaryButton full onClick={()=>setSupplierOpen(false)}>Cancelar</SecondaryButton><PrimaryButton full disabled={readOnly||!newSupplierName.trim()} onClick={()=>void createSupplier()}>Guardar proveedor</PrimaryButton></div>}><div className="grid gap-3"><Field label="Nombre" required><TextInput value={newSupplierName} onChange={event=>setNewSupplierName(event.target.value)} maxLength={100}/></Field><Field label="Teléfono"><TextInput value={newSupplierPhone} onChange={event=>setNewSupplierPhone(event.target.value)}/></Field>{error&&<p role="alert" className="text-xs text-rose-700">{error}</p>}</div></Modal>
    <Modal isOpen={Boolean(paymentTarget)} onClose={()=>!busy&&setPaymentTarget(null)} title="Abonar a proveedor" subtitle={paymentTarget?`${paymentTarget.supplierName} · saldo ${formatBs(paymentTarget.balance)}`:''} footer={<div className="grid grid-cols-2 gap-2"><SecondaryButton full disabled={busy} onClick={()=>setPaymentTarget(null)}>Cancelar</SecondaryButton><PrimaryButton full disabled={readOnly||busy} onClick={()=>void savePayment()}>{busy?'Guardando…':'Confirmar pago'}</PrimaryButton></div>}><div className="grid gap-3"><Field label="Monto del abono (Bs)" required><NumberInput min={0.01} max={paymentTarget?.balance} step={0.01} value={payAmount} onChange={event=>setPayAmount(event.target.value)}/></Field><Field label="Forma de pago" required><select value={payMethod} onChange={event=>setPayMethod(event.target.value as typeof payMethod)} className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3"><option value="cash">Efectivo</option><option value="transfer">QR / transferencia</option><option value="other">Otro</option></select></Field><Field label="Fecha"><TextInput type="date" value={dayKey} onChange={event=>setDayKey(event.target.value)}/></Field><Field label="Observación"><TextArea value={note} onChange={event=>setNote(event.target.value)}/></Field>{error&&<p role="alert" className="text-xs font-bold text-rose-700">{error}</p>}</div></Modal>
    <Modal isOpen={Boolean(voidTarget)} onClose={()=>!busy&&setVoidTarget(null)} title={voidTarget?.kind==='payment'?'Corregir pago a proveedor':'Anular compra a proveedor'} subtitle="La operación original se conserva y queda marcada con responsable, fecha y motivo." footer={<div className="grid grid-cols-2 gap-2"><SecondaryButton full disabled={busy} onClick={()=>setVoidTarget(null)}>Cancelar</SecondaryButton><PrimaryButton full disabled={readOnly||busy||!voidReason.trim()} onClick={()=>void saveVoid()}>{busy?'Guardando…':'Confirmar corrección'}</PrimaryButton></div>}><div className="grid gap-3"><p className="rounded-xl bg-amber-50 p-3 text-sm">{voidTarget?.kind==='payment'?`Se revertirá ${formatBs(voidTarget.payment.amount)} de ${voidTarget.payment.paymentMethod==='cash'?'efectivo':voidTarget.payment.paymentMethod==='transfer'?'QR / transferencia':'otros pagos'} y se restaurará el saldo por pagar.`:'La compra solo puede anularse cuando no conserva pagos vigentes.'}</p><Field label="Motivo de la corrección" required><TextArea value={voidReason} onChange={event=>setVoidReason(event.target.value)} maxLength={300}/></Field>{error&&<p role="alert" className="text-xs font-bold text-rose-700">{error}</p>}</div></Modal>
  </section>
}
