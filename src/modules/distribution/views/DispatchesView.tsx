import { useMemo, useState } from 'react'
import { AlertTriangle, Check, Copy, Download, FileText, Mail, MessageCircle, PackagePlus, Pencil, Printer, RotateCcw, Search, Send, Trash2, Truck } from 'lucide-react'
import { Modal } from '../../../components/ui/Modal'
import { Field, NumberInput, SelectInput, TextArea, TextInput } from '../../../components/ui/Form'
import { ChoiceButton, ChoiceModal } from '../../../components/ui/ChoiceModal'
import { EmptyBlock, Screen } from '../../../components/ui/Screen'
import { computeLoadedByProduct, round2, validateStockAvailability } from '../domain/engine'
import { addDispatchLoad, confirmDispatch, correctDispatch, newOperationId, warehouseBalanceId } from '../data/distributionRepository'
import { useTenantMembers } from '../state/useTenantMembers'
import { PrimaryButton, SecondaryButton, SectionCard, formatQty } from './shared'
import type { DistributionViewProps } from './DistributionApp'
import type { DistDispatch, DistDispatchLine } from '../types'
import {
  printDispatchTicket,
  printDispatchSheet,
  downloadDispatchPdf,
  shareDispatch,
  formatDispatchTextSummary,
  formatDispatchEmailBody,
  getDispatchEmailSubject,
  getGmailComposeUrl,
  getOutlookComposeUrl,
  getMailtoUrl,
} from '../data/distributionDocumentPrintService'
import { Capacitor } from '@capacitor/core'

interface DraftLine {
  id: string
  productId: string
  quantity: string
  lotId: string
}

/**
 * Despachos a ruta. Confirmar descuenta el almacen central y carga la ruta una
 * sola vez; los aumentos posteriores se registran aparte y conservan historial.
 */
export function DispatchesView({ session, data }: DistributionViewProps) {
  const { members } = useTenantMembers()
  const [warehouseId, setWarehouseId] = useState(session.warehouseId || 'central')

  const [isNewOpen, setIsNewOpen] = useState(false)
  const [additionTarget, setAdditionTarget] = useState<DistDispatch | null>(null)
  const effectiveWarehouse = additionTarget?.warehouseId || warehouseId
  const central = new Map(data.products.map(p => [p.id, data.balances.find(b => b.id === warehouseBalanceId(effectiveWarehouse, p.id))?.availableQuantity || 0]))
  const [routeId, setRouteId] = useState('')
  const [distributorUid, setDistributorUid] = useState('')
  const [observation, setObservation] = useState('')
  const [warehouseResponsibleName, setWarehouseResponsibleName] = useState(() => localStorage.getItem('sanjose_warehouse_responsible') || session.userName)
  const [draftLines, setDraftLines] = useState<DraftLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [search, setSearch] = useState('')
  const [isProductPickerOpen, setIsProductPickerOpen] = useState(false)
  const [isDistributorPickerOpen, setIsDistributorPickerOpen] = useState(false)
  const [isWarehousePickerOpen, setIsWarehousePickerOpen] = useState(false)
  const [sharingDispatch, setSharingDispatch] = useState<DistDispatch | null>(null)
  const [isEmailView, setIsEmailView] = useState(false)
  const [copiedText, setCopiedText] = useState(false)

  interface PendingCorrection {
    targetType: 'initial' | 'addition'
    additionId?: string
    additionIndex?: number
    productId?: string
    productName: string
    lotCode?: string
    unitType: 'kg' | 'package' | 'unit'
    currentQuantity: number
    newQuantity: number
    voidAddition?: boolean
  }

  const [correctionTarget, setCorrectionTarget] = useState<DistDispatch | null>(null)
  const [selectedCorrection, setSelectedCorrection] = useState<PendingCorrection | null>(null)
  const [correctionReason, setCorrectionReason] = useState('')
  const [correctionError, setCorrectionError] = useState<string | null>(null)
  const [isSubmittingCorrection, setIsSubmittingCorrection] = useState(false)
  const [isConfirmingCorrection, setIsConfirmingCorrection] = useState(false)

  const canCorrect = (session.role === 'admin' || session.role === 'warehouse') && session.can('dist.dispatch.create')

  const getProductSalesInDispatch = (dispatchId: string, productId: string) => {
    const dispatchSales = data.sales.filter((sale) => sale.dispatchId === dispatchId && !sale.pendingConfirmation)
    return round2(
      dispatchSales.reduce((sum, sale) => {
        const snap = sale.effectiveSnapshot ? { ...sale, ...sale.effectiveSnapshot } : sale
        const lineQty = (snap.lines || [])
          .filter((l) => l.productId === productId)
          .reduce((n, l) => n + l.quantity, 0)
        return sum + lineQty
      }, 0),
    )
  }

  const openCorrectionModal = (dispatch: DistDispatch) => {
    setCorrectionTarget(dispatch)
    setSelectedCorrection(null)
    setCorrectionReason('')
    setCorrectionError(null)
    setIsConfirmingCorrection(false)
  }

  const handleStartInitialLineCorrection = (line: DistDispatchLine) => {
    const lotCode = line.allocations?.map((a) => a.lotCode).filter(Boolean).join(', ') || line.lotCode || 'Lote original'
    setSelectedCorrection({
      targetType: 'initial',
      productId: line.productId,
      productName: line.productName,
      lotCode,
      unitType: line.unitType,
      currentQuantity: line.quantity,
      newQuantity: line.quantity,
    })
    setCorrectionReason('')
    setCorrectionError(null)
    setIsConfirmingCorrection(true)
  }

  const handleStartAdditionLineCorrection = (
    addition: DistDispatch['additions'][0],
    additionIndex: number,
    line: DistDispatch['additions'][0]['quantityByProduct'][0],
  ) => {
    const lotCode = line.allocations?.map((a) => a.lotCode).filter(Boolean).join(', ') || line.lotCode || 'Lote original'
    setSelectedCorrection({
      targetType: 'addition',
      additionId: addition.id,
      additionIndex,
      productId: line.productId,
      productName: line.productName,
      lotCode,
      unitType: line.unitType,
      currentQuantity: line.quantity,
      newQuantity: line.quantity,
    })
    setCorrectionReason('')
    setCorrectionError(null)
    setIsConfirmingCorrection(true)
  }

  const handleStartVoidAddition = (
    addition: DistDispatch['additions'][0],
    additionIndex: number,
  ) => {
    setSelectedCorrection({
      targetType: 'addition',
      additionId: addition.id,
      additionIndex,
      productName: `Aumento #${additionIndex} completo (${addition.quantityByProduct.map((p) => p.productName).join(', ')})`,
      lotCode: 'Todos los lotes del aumento',
      unitType: 'unit',
      currentQuantity: round2(addition.quantityByProduct.reduce((acc, p) => acc + p.quantity, 0)),
      newQuantity: 0,
      voidAddition: true,
    })
    setCorrectionReason('')
    setCorrectionError(null)
    setIsConfirmingCorrection(true)
  }

  const handleSubmitCorrection = async () => {
    if (isSubmittingCorrection || !correctionTarget || !selectedCorrection) return
    if (!correctionReason.trim()) {
      setCorrectionError('El motivo de la corrección es obligatorio.')
      return
    }
    if (!selectedCorrection.voidAddition && selectedCorrection.newQuantity >= selectedCorrection.currentQuantity) {
      setCorrectionError('Solo se permite mantener o disminuir la cantidad cargada.')
      return
    }

    const loadedMap = computeLoadedByProduct(correctionTarget)
    if (selectedCorrection.voidAddition && selectedCorrection.additionId) {
      const add = (correctionTarget.additions || []).find((a) => a.id === selectedCorrection.additionId)
      if (add) {
        for (const line of add.quantityByProduct) {
          const curLoaded = loadedMap.get(line.productId)?.totalLoaded || 0
          const totalSold = getProductSalesInDispatch(correctionTarget.id, line.productId)
          const newLoaded = round2(curLoaded - line.quantity)
          if (newLoaded < totalSold) {
            setCorrectionError(
              `No puedes anular este aumento: para ${line.productName} la carga quedaría en ${newLoaded} pero ya se registraron ${totalSold} vendidos.`
            )
            return
          }
        }
      }
    } else if (selectedCorrection.productId) {
      const curLoaded = loadedMap.get(selectedCorrection.productId)?.totalLoaded || 0
      const returnQty = round2(selectedCorrection.currentQuantity - selectedCorrection.newQuantity)
      const newLoaded = round2(curLoaded - returnQty)
      const totalSold = getProductSalesInDispatch(correctionTarget.id, selectedCorrection.productId)
      if (newLoaded < totalSold) {
        setCorrectionError(
          `No puedes reducir la carga a ${newLoaded} porque ya se registraron ${totalSold} vendidos.`
        )
        return
      }
    }

    setIsSubmittingCorrection(true)
    setCorrectionError(null)
    try {
      await correctDispatch({
        dispatchId: correctionTarget.id,
        targetType: selectedCorrection.targetType,
        additionId: selectedCorrection.additionId,
        productId: selectedCorrection.productId,
        newQuantity: selectedCorrection.voidAddition ? 0 : round2(selectedCorrection.newQuantity),
        voidAddition: selectedCorrection.voidAddition,
        reason: correctionReason.trim(),
      })
      setCorrectionTarget(null)
      setSelectedCorrection(null)
      setCorrectionReason('')
      setCorrectionError(null)
      setIsConfirmingCorrection(false)
    } catch (err) {
      setCorrectionError((err as Error).message || 'No se pudo registrar la corrección.')
    } finally {
      setIsSubmittingCorrection(false)
    }
  }

  const copyToClipboard = async (text: string) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        const textArea = document.createElement('textarea')
        textArea.value = text
        textArea.style.position = 'fixed'
        textArea.style.opacity = '0'
        document.body.appendChild(textArea)
        textArea.focus()
        textArea.select()
        document.execCommand('copy')
        document.body.removeChild(textArea)
      }
      setCopiedText(true)
      setTimeout(() => setCopiedText(false), 2500)
    } catch {
      // ignore
    }
  }

  const distributors = useMemo(
    () => members.filter((member) => member.role === 'distributor' && member.active !== false),
    [members],
  )

  const activeProducts = useMemo(() => data.products.filter((product) => product.active !== false), [data.products])

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase()
    return term ? activeProducts.filter((product) => product.name.toLowerCase().includes(term)) : activeProducts
  }, [activeProducts, search])

  /**
   * El distribuidor solo ve la carga de SU ruta. Si el despacho se registra en
   * otra, la mercaderia sale del almacen y no le aparece a nadie: por eso al
   * elegir a la persona se toma su ruta y se avisa si no coinciden.
   */
  const selectDistributor = (uid: string) => {
    setDistributorUid(uid)
    const member = distributors.find((item) => item.uid === uid)
    if (member?.routeId) setRouteId(member.routeId)
  }

  const selectedDistributor = distributors.find((member) => member.uid === distributorUid) ?? null
  const routeMismatch = Boolean(
    selectedDistributor?.routeId && routeId && selectedDistributor.routeId !== routeId,
  )

  const resetDraft = () => {
    setRouteId('')
    setDistributorUid('')
    setObservation('')
    setDraftLines([])
    setError(null)
    setSearch('')
  }

  const buildLines = (): DistDispatchLine[] => {
    const lines: DistDispatchLine[] = []
    for (const draft of draftLines) {
      const quantity = round2(Number(draft.quantity))
      if (!draft.productId || !(quantity > 0)) continue
      const product = activeProducts.find((item) => item.id === draft.productId)
      if (!product) continue
      lines.push({
        productId: product.id,
        productName: product.presentation ? `${product.name} - ${product.presentation}` : product.name,
        unitType: product.unitType,
        quantity,
        lotId: draft.lotId,
      })
    }
    return lines
  }

  const submitDispatch = async () => {
    if (isSubmitting) return
    setError(null)

    const lines = buildLines()
    if (!selectedDistributor?.routeId || routeMismatch) { setError('Selecciona un distribuidor y su ruta asignada.'); return }
    if (data.openDispatches.some(d => d.routeId === routeId)) { setError('La ruta ya tiene un despacho abierto. Usa Aumentar.'); return }
    if (!routeId) {
      setError('Selecciona la ruta.')
      return
    }
    if (lines.length === 0) {
      setError('Agrega al menos un producto con cantidad.')
      return
    }
    if (lines.some(line => !line.lotId)) { setError('Selecciona el lote exacto de cada producto.'); return }
    if (!warehouseResponsibleName.trim()) { setError('Indica el encargado de almacén del turno.'); return }

    const stockError = validateStockAvailability(lines, central)
    if (stockError) {
      setError(stockError)
      return
    }

    const distributor = distributors.find((member) => member.uid === distributorUid)
    const route = data.routes.find((item) => item.id === routeId)

    setIsSubmitting(true)
    try {
      await confirmDispatch({
        warehouseId,
        routeId,
        routeName: route?.name ?? 'Ruta sin nombre',
        distributorUid: distributor?.uid ?? '',
        distributorName: distributor?.displayName ?? 'Sin asignar',
        lines,
        observation,
        warehouseResponsibleName: warehouseResponsibleName.trim(),
        operationId: newOperationId('disp'),
      })
      localStorage.setItem('sanjose_warehouse_responsible', warehouseResponsibleName.trim())
      setIsNewOpen(false)
      resetDraft()
    } catch (submitError) {
      setError((submitError as Error).message || 'No se pudo confirmar el despacho.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const submitAddition = async () => {
    if (!additionTarget || isSubmitting) return
    setError(null)

    const lines = buildLines()
    if (lines.length === 0) {
      setError('Agrega al menos un producto con cantidad.')
      return
    }
    if (lines.some(line => !line.lotId)) { setError('Selecciona el lote exacto de cada producto.'); return }
    if (!warehouseResponsibleName.trim()) { setError('Indica el encargado de almacén del turno.'); return }

    const stockError = validateStockAvailability(lines, central)
    if (stockError) {
      setError(stockError)
      return
    }

    setIsSubmitting(true)
    try {
      await addDispatchLoad({
        dispatch: additionTarget,
        lines,
        registeredByName: session.userName,
        note: observation,
        warehouseResponsibleName: warehouseResponsibleName.trim(),
        operationId: newOperationId('add'),
      })
      setAdditionTarget(null)
      resetDraft()
    } catch (submitError) {
      setError((submitError as Error).message || 'No se pudo registrar el aumento.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const canDispatch = session.can('dist.dispatch.create')

  const lineEditor = (
    <div className="grid gap-3">
      <div className="grid gap-2">
        {draftLines.map((line) => {
          const product = activeProducts.find(item => item.id === line.productId)
          if (!product) return null
          const lotLocation = effectiveWarehouse === 'central' ? 'central' : `warehouse__${effectiveWarehouse}`
          const lots = data.lots.filter(lot => lot.productId === product.id && (lot.quantities[lotLocation] || 0) > 0 && !lot.quarantined && (!lot.expiresOn || lot.expiresOn >= new Date().toLocaleDateString('en-CA'))).sort((a,b) => (a.expiresOn || '9999').localeCompare(b.expiresOn || '9999'))
          return <div key={line.id} className="grid grid-cols-[minmax(0,1fr)_88px_40px] items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2.5">
            <div className="min-w-0"><p className="text-xs font-extrabold leading-snug text-slate-900">{product.name}</p><p className="mt-0.5 text-[10px] font-semibold text-slate-500">Disponible: {formatQty(central.get(product.id) ?? 0, product.unitType)}</p><SelectInput aria-label={`Lote de ${product.name}`} value={line.lotId} onChange={event => setDraftLines(current => current.map(item => item.id === line.id ? { ...item, lotId: event.target.value } : item))} className="mt-2 text-xs"><option value="">Selecciona lote</option>{lots.map(lot => <option key={lot.id} value={lot.id}>{lot.lotCode} · vence {lot.expiresOn || 'sin fecha'} · {formatQty(lot.quantities[lotLocation], product.unitType)}</option>)}</SelectInput><button type="button" className="mt-1 text-[10px] font-extrabold text-[var(--primary)]" onClick={() => setDraftLines(current => [...current,{id:newOperationId('draft'),productId:product.id,quantity:'',lotId:''}])}>+ Usar otro lote</button></div>
            <NumberInput aria-label={`Cantidad de ${product.name}`} value={line.quantity} min={0} step={product.unitType === 'kg' ? 0.01 : 1} placeholder={product.unitType === 'kg' ? 'kg' : 'Cant.'} onChange={event => setDraftLines(current => current.map(item => item.id === line.id ? { ...item, quantity: event.target.value } : item))} className="px-2 text-center" />
            <button type="button" aria-label={`Quitar ${product.name}`} onClick={() => setDraftLines(current => current.filter(item => item.id !== line.id))} className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 hover:bg-white hover:text-rose-600"><Trash2 size={16} /></button>
          </div>
        })}
        {draftLines.length === 0 && <p className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-center text-xs font-semibold text-slate-500">Todavía no seleccionaste productos.</p>}
      </div>
      <SecondaryButton full onClick={() => setIsProductPickerOpen(true)}>
        <PackagePlus size={16} /> {draftLines.length ? 'Editar productos' : 'Seleccionar productos'}
      </SecondaryButton>
      <Field label="Observacion">
        <TextArea value={observation} onChange={(event) => setObservation(event.target.value)} />
      </Field>
      <Field label="Encargado de almacén del turno" required hint="Quedará registrado en el despacho y sus impresiones."><TextInput value={warehouseResponsibleName} onChange={event => setWarehouseResponsibleName(event.target.value)} placeholder="Nombre completo" /></Field>
      {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
    </div>
  )

  return (
    <Screen
      title="Despachos"
      subtitle="Salidas a ruta y aumentos de carga"
      actions={
        canDispatch ? (
          <PrimaryButton
            onClick={() => {
              resetDraft()
              setIsNewOpen(true)
            }}
          >
            <Truck size={16} /> Nuevo
          </PrimaryButton>
        ) : undefined
      }
    >
      <div className="grid w-full min-w-0 gap-3">
        {data.openDispatches.length === 0 && (
          <EmptyBlock title="Sin despachos abiertos" description="Crea un despacho para cargar una ruta." />
        )}

        {data.openDispatches.filter(d => session.role !== 'warehouse' || (d.warehouseId || 'central') === (session.warehouseId || 'central')).map((dispatch) => {
          const loaded = computeLoadedByProduct(dispatch)
          return (
            <SectionCard
              key={dispatch.id}
              title={`${dispatch.routeName} · ${dispatch.distributorName}`}
              action={
                <div className="flex items-center gap-1.5">
                  {session.can('dist.dispatch.addLoad') && (
                    <SecondaryButton
                      onClick={() => {
                        resetDraft()
                        setAdditionTarget(dispatch)
                      }}
                    >
                      <PackagePlus size={15} /> Aumentar
                    </SecondaryButton>
                  )}
                  {canCorrect && (
                    <SecondaryButton onClick={() => openCorrectionModal(dispatch)}>
                      <Pencil size={15} /> Corregir
                    </SecondaryButton>
                  )}
                </div>
              }
            >
              <div className="grid gap-1.5">
                {[...loaded.entries()].map(([productId, totals]) => (
                  <div key={productId} className="flex min-w-0 items-center justify-between gap-2 rounded-2xl bg-slate-50 px-3 py-2">
                    <div className="min-w-0">
                      <p className="break-words text-xs font-extrabold text-slate-900">
                        {data.products.find((product) => product.id === productId)?.name || totals.productName}
                      </p>
                      <p className="text-[11px] font-semibold text-slate-500">
                        Carga inicial {formatQty(totals.initialDispatch, totals.unitType)} · Aumentos{' '}
                        {formatQty(totals.additions, totals.unitType)}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-black tabular-nums text-slate-900">
                      {formatQty(totals.totalLoaded, totals.unitType)}
                    </span>
                  </div>
                ))}
              </div>

              {dispatch.additions.length > 0 && (
                <div className="mt-2 rounded-2xl border border-dashed border-slate-200 p-2">
                  <p className="mb-1 text-[10px] font-extrabold uppercase text-slate-400">Carga inicial y aumentos separados</p>
                  {dispatch.additions.map((addition) => (
                    addition.voided ? (
                      <p key={addition.id} className="my-1 rounded-xl bg-slate-100 p-2 text-[11px] font-semibold text-slate-400 line-through">
                        AUMENTO ANULADO · {new Date(addition.voidedAt || addition.createdAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })} · {addition.voidReason || 'Aumento anulado'}
                      </p>
                    ) : (
                      <p key={addition.id} className="my-1 rounded-xl bg-amber-50 p-2 text-[11px] font-semibold text-amber-900">
                        <strong>AUMENTADO · {new Date(addition.createdAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}</strong> · {addition.warehouseResponsibleName || addition.createdByName} ·{' '}
                        {addition.quantityByProduct
                          .map((line) => `${line.productName} +${formatQty(line.quantity, line.unitType)} · lote ${line.allocations?.map((item) => item.lotCode).join(', ') || line.lotCode || 'registro anterior'}`)
                          .join(', ')}
                      </p>
                    )
                  ))}
                </div>
              )}

              {dispatch.corrections && dispatch.corrections.length > 0 && (
                <div className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 p-2.5">
                  <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wide text-slate-500">
                    <RotateCcw size={12} className="text-slate-400" />
                    <span>Historial de correcciones auditadas</span>
                  </div>
                  <div className="grid gap-2">
                    {dispatch.corrections.map((corr) => (
                      <div key={corr.id} className="rounded-xl border border-slate-200 bg-white p-2.5 text-xs shadow-xs">
                        <div className="flex items-center justify-between text-[11px] text-slate-500">
                          <span className="font-bold text-slate-700">
                            {new Date(corr.correctedAt).toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' })} {new Date(corr.correctedAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}
                            {' · '}
                            {corr.targetType === 'addition' ? 'Aumento' : 'Carga inicial'}
                          </span>
                          <span className="text-[10px] font-semibold text-slate-400">Por: {corr.correctedByName || corr.correctedBy}</span>
                        </div>
                        <p className="mt-1 font-black text-slate-900">
                          {corr.productName}: {formatQty(corr.oldQuantity, corr.unitType)} → {formatQty(corr.newQuantity, corr.unitType)}
                        </p>
                        <p className="text-[11px] font-bold text-emerald-700">
                          Reintegrado: {formatQty(corr.returnedQuantity, corr.unitType)} {corr.lotCode ? `· Lote ${corr.lotCode}` : ''}
                        </p>
                        <p className="mt-0.5 text-[11px] italic text-slate-600">
                          Motivo: {corr.reason}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-2 grid grid-cols-3 gap-2">
                <SecondaryButton onClick={() => void printDispatchTicket(dispatch).catch(printError => setError(printError.message))}>
                  <Printer size={15} /> Ticket
                </SecondaryButton>
                <SecondaryButton onClick={() => void printDispatchSheet(dispatch).catch(printError => setError(printError.message))}>
                  <FileText size={15} /> Hoja
                </SecondaryButton>
                <SecondaryButton
                  onClick={() => {
                    if (Capacitor.isNativePlatform()) {
                      void shareDispatch(dispatch).catch(shareError => setError(shareError.message))
                    } else {
                      setSharingDispatch(dispatch)
                    }
                  }}
                >
                  <Send size={15} /> Compartir
                </SecondaryButton>
              </div>
            </SectionCard>
          )
        })}
      </div>

      <Modal
        isOpen={isNewOpen}
        onClose={() => setIsNewOpen(false)}
        title="Nuevo despacho"
        subtitle="Descuenta almacen central y carga la ruta"
        size="lg"
        footer={
          <PrimaryButton full disabled={isSubmitting} onClick={() => void submitDispatch()}>
            {isSubmitting ? 'Confirmando...' : 'Confirmar despacho'}
          </PrimaryButton>
        }
      >
        <div className="grid gap-3">
          <Field label="Almacen de origen"><ChoiceButton disabled={session.role === 'warehouse'} placeholder="Selecciona almacén" label={warehouseId === 'central' ? 'Almacén central' : data.warehouses.find(w => w.id === warehouseId)?.name} onClick={() => setIsWarehousePickerOpen(true)} /></Field>
          <Field label="Distribuidor" required hint="Al elegirlo se toma su ruta asignada.">
            <ChoiceButton placeholder="Selecciona distribuidor" label={selectedDistributor?.displayName} description={selectedDistributor?.routeId ? data.routes.find(route => route.id === selectedDistributor.routeId)?.name ?? 'Ruta de registro anterior' : undefined} onClick={() => setIsDistributorPickerOpen(true)} />
          </Field>

          <Field label="Ruta" required>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm font-bold text-slate-800">{data.routes.find(route => route.id === routeId)?.name || 'Se asigna al seleccionar distribuidor'}</div>
          </Field>

          {routeMismatch && (
            <p className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-800">
              {selectedDistributor?.displayName} trabaja en{' '}
              {data.routes.find((route) => route.id === selectedDistributor?.routeId)?.name ?? 'Ruta de registro anterior'}.
              Si despachas a otra ruta no vera esta carga en su telefono. Cambia la ruta aqui, o su ruta asignada
              desde Usuarios.
            </p>
          )}

          {lineEditor}
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(additionTarget)}
        onClose={() => setAdditionTarget(null)}
        title="Aumento de carga"
        subtitle={additionTarget ? `${additionTarget.routeName} · ${additionTarget.distributorName}` : ''}
        size="lg"
        footer={
          <PrimaryButton full disabled={isSubmitting} onClick={() => void submitAddition()}>
            {isSubmitting ? 'Guardando...' : 'Registrar aumento'}
          </PrimaryButton>
        }
      >
        {lineEditor}
      </Modal>

      <ChoiceModal isOpen={isWarehousePickerOpen} onClose={() => setIsWarehousePickerOpen(false)} title="Almacén de origen" options={[{ value: 'central', label: 'Almacén central' }, ...data.warehouses.filter(w => w.active).map(w => ({ value: w.id, label: w.name }))]} selectedValue={warehouseId} onSelect={value => { setWarehouseId(value); setDraftLines([]) }} />
      <ChoiceModal isOpen={isDistributorPickerOpen} onClose={() => setIsDistributorPickerOpen(false)} title="Selecciona distribuidor" subtitle="La ruta se asignará automáticamente" searchable options={distributors.map(member => ({ value: member.uid, label: member.displayName, description: member.routeId ? data.routes.find(route => route.id === member.routeId)?.name ?? 'Ruta de registro anterior' : 'Sin ruta asignada', disabled: !member.routeId }))} selectedValue={distributorUid} onSelect={selectDistributor} />
      <Modal isOpen={isProductPickerOpen} onClose={() => { setIsProductPickerOpen(false); setSearch('') }} title="Productos del despacho" subtitle="Selecciona varios y escribe la cantidad" size="lg" footer={<PrimaryButton full onClick={() => { setIsProductPickerOpen(false); setSearch('') }}>Listo · {draftLines.length} producto{draftLines.length === 1 ? '' : 's'}</PrimaryButton>}>
        <div className="grid gap-3">
          <div className="relative"><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><TextInput value={search} onChange={event => setSearch(event.target.value)} className="pl-9" placeholder="Buscar producto..." /></div>
          <div className="grid grid-cols-2 gap-2">
            {filteredProducts.filter(product => (central.get(product.id) ?? 0) > 0 || draftLines.some(line => line.productId === product.id)).map(product => {
              const draft = draftLines.find(line => line.productId === product.id)
              return <div key={product.id} className={`min-w-0 overflow-hidden rounded-2xl border ${draft ? 'border-[var(--primary)] bg-[var(--primary-soft)]' : 'border-slate-200 bg-white'}`}>
                {product.photoDataUrl && <img src={product.photoDataUrl} alt={`Foto de ${product.name}`} onError={(event) => { event.currentTarget.style.display = 'none' }} className="aspect-[16/8] w-full object-cover" />}
                <button type="button" onClick={() => setDraftLines(current => draft ? current.filter(line => line.productId !== product.id) : [...current, { id: newOperationId('draft'), productId: product.id, quantity: '', lotId: '' }])} className="flex min-h-[88px] w-full flex-col items-start justify-between gap-2 p-3 text-left">
                  <span className="text-xs font-extrabold leading-snug text-slate-900">{product.name}</span>
                  <span className="flex w-full items-center justify-between gap-1 text-[10px] font-bold text-slate-500"><span>{formatQty(central.get(product.id) ?? 0, product.unitType)}</span>{draft && <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--primary)] text-white"><Check size={13} /></span>}</span>
                </button>
                {draft && <div className="border-t border-[var(--primary)]/15 p-2"><NumberInput value={draft.quantity} min={0} max={central.get(product.id) ?? undefined} step={product.unitType === 'kg' ? 0.01 : 1} placeholder={`Cantidad (${product.unitType === 'kg' ? 'kg' : product.unitType === 'package' ? 'paq' : 'u'})`} onChange={event => setDraftLines(current => current.map(line => line.id === draft.id ? { ...line, quantity: event.target.value } : line))} className="px-2 text-center text-xs" /></div>}
              </div>
            })}
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(sharingDispatch)}
        onClose={() => {
          setSharingDispatch(null)
          setIsEmailView(false)
          setCopiedText(false)
        }}
        title={isEmailView ? 'Enviar por correo' : 'Compartir despacho'}
        subtitle={sharingDispatch ? `${sharingDispatch.routeName} · ${sharingDispatch.distributorName}` : ''}
        size="md"
        footer={
          <SecondaryButton
            full
            onClick={() => {
              if (isEmailView) {
                setIsEmailView(false)
              } else {
                setSharingDispatch(null)
                setCopiedText(false)
              }
            }}
          >
            {isEmailView ? 'Volver a opciones' : 'Cerrar'}
          </SecondaryButton>
        }
      >
        {sharingDispatch && (
          <div className="grid gap-3">
            {isEmailView ? (
              <>
                <p className="text-xs text-slate-600">
                  Elige tu servicio de correo habitual o copia el texto formateado:
                </p>
                <div className="grid gap-2">
                  <a
                    href={getGmailComposeUrl(
                      getDispatchEmailSubject(sharingDispatch),
                      formatDispatchEmailBody(sharingDispatch),
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-800 transition hover:bg-red-100"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-600 text-white">
                      <Mail size={18} />
                    </div>
                    <div>
                      <p className="font-extrabold">Gmail Web</p>
                      <p className="text-[11px] font-normal text-red-700">Abrir en navegador con asunto y carga lista</p>
                    </div>
                  </a>

                  <a
                    href={getOutlookComposeUrl(
                      getDispatchEmailSubject(sharingDispatch),
                      formatDispatchEmailBody(sharingDispatch),
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-3 text-xs font-bold text-sky-800 transition hover:bg-sky-100"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-600 text-white">
                      <Mail size={18} />
                    </div>
                    <div>
                      <p className="font-extrabold">Outlook Web</p>
                      <p className="text-[11px] font-normal text-sky-700">Abrir en Outlook online listo para enviar</p>
                    </div>
                  </a>

                  <a
                    href={getMailtoUrl(
                      getDispatchEmailSubject(sharingDispatch),
                      formatDispatchEmailBody(sharingDispatch),
                    )}
                    className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-3 text-xs font-bold text-blue-800 transition hover:bg-blue-100"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white">
                      <Mail size={18} />
                    </div>
                    <div>
                      <p className="font-extrabold">Correo predeterminado</p>
                      <p className="text-[11px] font-normal text-blue-700">Abrir app local de Windows o navegador</p>
                    </div>
                  </a>

                  <button
                    type="button"
                    onClick={() => void copyToClipboard(formatDispatchEmailBody(sharingDispatch))}
                    className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-left text-xs font-bold text-slate-800 transition hover:bg-slate-100"
                  >
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition ${copiedText ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-white'}`}>
                      {copiedText ? <Check size={18} /> : <Copy size={18} />}
                    </div>
                    <div>
                      <p className="font-extrabold">{copiedText ? '¡Texto copiado al portapapeles!' : 'Copiar texto para correo'}</p>
                      <p className="text-[11px] font-normal text-slate-600">Pega el resumen directamente en cualquier mensaje</p>
                    </div>
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-slate-600">
                  Selecciona cómo deseas compartir o exportar este despacho:
                </p>
                <div className="grid gap-2">
                  <a
                    href={`https://web.whatsapp.com/send?text=${encodeURIComponent(formatDispatchTextSummary(sharingDispatch))}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white">
                      <MessageCircle size={18} />
                    </div>
                    <div>
                      <p className="font-extrabold">WhatsApp Web</p>
                      <p className="text-[11px] font-normal text-emerald-700">Abrir chat en navegador con el resumen de carga</p>
                    </div>
                  </a>

                  <button
                    type="button"
                    onClick={() => setIsEmailView(true)}
                    className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-3 text-left text-xs font-bold text-blue-800 transition hover:bg-blue-100"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-500 text-white">
                      <Mail size={18} />
                    </div>
                    <div>
                      <p className="font-extrabold">Correo electrónico</p>
                      <p className="text-[11px] font-normal text-blue-700">Gmail Web, Outlook Web o cliente local</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      downloadDispatchPdf(sharingDispatch)
                      setSharingDispatch(null)
                    }}
                    className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-left text-xs font-bold text-slate-800 transition hover:bg-slate-100"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-700 text-white">
                      <Download size={18} />
                    </div>
                    <div>
                      <p className="font-extrabold">Descargar PDF</p>
                      <p className="text-[11px] font-normal text-slate-600">Guardar documento oficial con aumentos y firmas</p>
                    </div>
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
      {/* Modal para corregir / editar despacho de forma auditada */}
      <Modal
        isOpen={Boolean(correctionTarget)}
        onClose={() => {
          if (!isSubmittingCorrection) {
            setCorrectionTarget(null)
            setSelectedCorrection(null)
            setCorrectionReason('')
            setCorrectionError(null)
            setIsConfirmingCorrection(false)
          }
        }}
        title={isConfirmingCorrection ? 'Confirmar corrección' : 'Corregir despacho'}
        subtitle={correctionTarget ? `${correctionTarget.routeName} · ${correctionTarget.distributorName}` : ''}
        size="lg"
        footer={
          isConfirmingCorrection && selectedCorrection ? (
            <div className="grid w-full grid-cols-2 gap-2">
              <SecondaryButton
                disabled={isSubmittingCorrection}
                onClick={() => {
                  setIsConfirmingCorrection(false)
                  setCorrectionError(null)
                }}
              >
                Volver
              </SecondaryButton>
              <PrimaryButton
                disabled={isSubmittingCorrection}
                onClick={() => void handleSubmitCorrection()}
              >
                {isSubmittingCorrection ? 'Guardando...' : 'Confirmar corrección'}
              </PrimaryButton>
            </div>
          ) : (
            <SecondaryButton full onClick={() => setCorrectionTarget(null)}>
              Cerrar
            </SecondaryButton>
          )
        }
      >
        {correctionTarget && !isConfirmingCorrection && (
          <div className="grid gap-3">
            <div className="rounded-2xl border border-blue-200 bg-blue-50/70 p-3 text-xs text-blue-900">
              <p className="font-extrabold">Operación auditada</p>
              <p className="mt-0.5 text-[11px] text-blue-800">
                Solo se permite mantener o disminuir cantidades ingresadas por error. El stock reintegrado volverá automáticamente a su lote de origen en el almacén.
              </p>
            </div>

            {/* SECCIÓN 1: CARGA INICIAL */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
              <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-700">Carga inicial</p>
              <div className="grid gap-2">
                {correctionTarget.lines.map((line) => {
                  const lotCode = line.allocations?.map((a) => a.lotCode).filter(Boolean).join(', ') || line.lotCode || 'Lote original'
                  const totalSold = getProductSalesInDispatch(correctionTarget.id, line.productId)
                  return (
                    <div key={line.productId} className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-2.5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-xs font-black text-slate-900">{line.productName}</p>
                        <p className="text-[11px] font-semibold text-slate-500">
                          Lote: {lotCode} · Cantidad actual: <strong className="text-slate-800">{formatQty(line.quantity, line.unitType)}</strong>
                        </p>
                        {totalSold > 0 && (
                          <p className="text-[10px] font-bold text-amber-700">
                            Vendido registrado: {formatQty(totalSold, line.unitType)}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0">
                        <SecondaryButton
                          disabled={line.quantity <= 0}
                          onClick={() => handleStartInitialLineCorrection(line)}
                        >
                          <Pencil size={13} /> Corregir
                        </SecondaryButton>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* SECCIÓN 2: AUMENTOS */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
              <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-700">Aumentos de carga</p>
              {(() => {
                const activeAdditions = (correctionTarget.additions || []).filter((a) => !a.voided)
                if (activeAdditions.length === 0) {
                  return <p className="text-center text-xs font-medium text-slate-400 py-3">No hay aumentos activos en este despacho.</p>
                }
                return (
                  <div className="grid gap-2.5">
                    {activeAdditions.map((addition, idx) => {
                      const time = new Date(addition.createdAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })
                      const resp = addition.warehouseResponsibleName || addition.createdByName || 'Almacén'
                      return (
                        <div key={addition.id} className="rounded-xl border border-amber-200 bg-amber-50/50 p-2.5">
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-xs font-extrabold text-amber-900">
                              Aumento #{idx + 1} ({time} · {resp})
                            </span>
                            <button
                              type="button"
                              onClick={() => handleStartVoidAddition(addition, idx + 1)}
                              className="rounded-lg border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700 transition hover:bg-rose-100"
                            >
                              Quitar aumento
                            </button>
                          </div>
                          <div className="grid gap-1.5">
                            {addition.quantityByProduct.map((line) => {
                              const lotCode = line.allocations?.map((a) => a.lotCode).filter(Boolean).join(', ') || line.lotCode || 'Lote original'
                              const totalSold = getProductSalesInDispatch(correctionTarget.id, line.productId)
                              return (
                                <div key={line.productId} className="flex flex-col gap-1.5 rounded-lg border border-slate-200 bg-white p-2 sm:flex-row sm:items-center sm:justify-between">
                                  <div className="min-w-0">
                                    <p className="text-xs font-extrabold text-slate-900">{line.productName}</p>
                                    <p className="text-[11px] text-slate-500">
                                      Lote: {lotCode} · Cantidad: <strong className="text-slate-800">+{formatQty(line.quantity, line.unitType)}</strong>
                                    </p>
                                    {totalSold > 0 && (
                                      <p className="text-[10px] font-bold text-amber-700">
                                        Vendido total registrado: {formatQty(totalSold, line.unitType)}
                                      </p>
                                    )}
                                  </div>
                                  <div className="shrink-0">
                                    <SecondaryButton
                                      disabled={line.quantity <= 0}
                                      onClick={() => handleStartAdditionLineCorrection(addition, idx + 1, line)}
                                    >
                                      <Pencil size={13} /> Corregir
                                    </SecondaryButton>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
            </div>
          </div>
        )}

        {correctionTarget && isConfirmingCorrection && selectedCorrection && (
          <div className="grid gap-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
              <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
                {selectedCorrection.targetType === 'addition' ? `Aumento #${selectedCorrection.additionIndex || 1}` : 'Carga inicial'}
              </p>
              <h3 className="mt-0.5 text-sm font-black text-slate-900">{selectedCorrection.productName}</h3>
              <p className="mt-0.5 text-xs text-slate-600 font-semibold">
                Lote de origen: {selectedCorrection.lotCode || 'Lote original'}
              </p>

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl border border-slate-200 bg-white p-2">
                  <p className="text-[10px] font-bold text-slate-500 uppercase">Cantidad actual</p>
                  <p className="text-sm font-black text-slate-900">
                    {formatQty(selectedCorrection.currentQuantity, selectedCorrection.unitType)}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-2">
                  <p className="text-[10px] font-bold text-slate-500 uppercase">Nueva cantidad</p>
                  <p className="text-sm font-black text-slate-900">
                    {selectedCorrection.voidAddition ? '0' : formatQty(selectedCorrection.newQuantity, selectedCorrection.unitType)}
                  </p>
                </div>
              </div>

              <div className="mt-2 rounded-xl bg-emerald-50 border border-emerald-200 p-2 text-xs font-bold text-emerald-800">
                Se reintegrarán al almacén:{' '}
                {selectedCorrection.voidAddition
                  ? formatQty(selectedCorrection.currentQuantity, selectedCorrection.unitType)
                  : formatQty(round2(selectedCorrection.currentQuantity - selectedCorrection.newQuantity), selectedCorrection.unitType)}{' '}
                ({selectedCorrection.lotCode || 'Lote de origen'})
              </div>
            </div>

            {!selectedCorrection.voidAddition && (
              <Field label="Nueva cantidad cargada" required hint="Solo puedes mantener o disminuir la cantidad.">
                <NumberInput
                  value={selectedCorrection.newQuantity}
                  min={0}
                  max={selectedCorrection.currentQuantity}
                  step={selectedCorrection.unitType === 'kg' ? 0.01 : 1}
                  onChange={(e) => {
                    const val = Number(e.target.value)
                    setSelectedCorrection((curr) => curr ? { ...curr, newQuantity: isNaN(val) ? 0 : val } : null)
                  }}
                />
              </Field>
            )}

            <Field label="Motivo de la corrección" required hint="Obligatorio. Quedará registrado en la auditoría del despacho.">
              <TextArea
                value={correctionReason}
                onChange={(e) => setCorrectionReason(e.target.value)}
                placeholder="Ej: Error de digitación, producto cargado por error, no salió de almacén..."
                rows={3}
              />
            </Field>

            {correctionError && (
              <div className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-700">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <span>{correctionError}</span>
              </div>
            )}
          </div>
        )}
      </Modal>

    </Screen>
  )
}
