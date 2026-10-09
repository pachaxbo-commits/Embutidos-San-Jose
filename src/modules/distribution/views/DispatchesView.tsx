import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Check, Copy, Download, FileText, Mail, MessageCircle, Minus, PackagePlus, Pencil, Plus, Printer, RotateCcw, Search, Send, Trash2, Truck, Undo2 } from 'lucide-react'
import { Modal } from '../../../components/ui/Modal'
import { Field, NumberInput, SelectInput, TextArea, TextInput } from '../../../components/ui/Form'
import { ChoiceButton, ChoiceModal } from '../../../components/ui/ChoiceModal'
import { EmptyBlock, Screen } from '../../../components/ui/Screen'
import { computeLoadedByProduct, round2, validateStockAvailability } from '../domain/engine'
import { addDispatchLoad, confirmDispatch, correctDispatch, newOperationId, warehouseBalanceId, type DispatchCorrectionChange } from '../data/distributionRepository'
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
  allocations: Array<{ id: string; lotId: string; quantity: string }>
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

  const [correctionTarget, setCorrectionTarget] = useState<DistDispatch | null>(null)
  const [initialDrafts, setInitialDrafts] = useState<Record<string, number>>({})
  const [additionDrafts, setAdditionDrafts] = useState<Record<string, Record<string, number>>>({})
  const [voidedAdditions, setVoidedAdditions] = useState<Set<string>>(new Set())
  const [isReviewingCorrection, setIsReviewingCorrection] = useState(false)
  const [correctionReason, setCorrectionReason] = useState('')
  const [correctionError, setCorrectionError] = useState<string | null>(null)
  const [isSubmittingCorrection, setIsSubmittingCorrection] = useState(false)

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
    setCorrectionReason('')
    setCorrectionError(null)
    setIsReviewingCorrection(false)
    const init: Record<string, number> = {}
    for (const line of dispatch.lines || []) {
      init[line.productId] = line.quantity
    }
    setInitialDrafts(init)
    const adds: Record<string, Record<string, number>> = {}
    for (const add of dispatch.additions || []) {
      if (add.voided) continue
      adds[add.id] = {}
      for (const line of add.quantityByProduct || []) {
        adds[add.id][line.productId] = line.quantity
      }
    }
    setAdditionDrafts(adds)
    setVoidedAdditions(new Set())
  }

  const updateInitialDraft = (productId: string, val: number) => {
    setInitialDrafts((prev) => ({
      ...prev,
      [productId]: Math.max(0, round2(val)),
    }))
  }

  const updateAdditionDraft = (additionId: string, productId: string, val: number) => {
    setAdditionDrafts((prev) => ({
      ...prev,
      [additionId]: {
        ...(prev[additionId] || {}),
        [productId]: Math.max(0, round2(val)),
      },
    }))
  }

  const toggleVoidAddition = (additionId: string) => {
    setVoidedAdditions((prev) => {
      const next = new Set(prev)
      if (next.has(additionId)) {
        next.delete(additionId)
      } else {
        next.add(additionId)
      }
      return next
    })
  }

  const getPendingChanges = () => {
    if (!correctionTarget) {
      return { initialDiffs: [], additionDiffs: [], voidedAdditionsList: [], totalCount: 0 }
    }

    const initialDiffs: Array<{
      targetType: 'initial' | 'addition'
      additionId?: string
      additionIndex?: number
      productId: string
      productName: string
      presentation?: string
      unitType: 'kg' | 'package' | 'unit'
      oldQuantity: number
      newQuantity: number
      delta: number
      lotCode?: string
    }> = []

    for (const line of correctionTarget.lines || []) {
      const newQty = initialDrafts[line.productId] ?? line.quantity
      if (round2(newQty) !== round2(line.quantity)) {
        const prod = data.products.find((p) => p.id === line.productId)
        initialDiffs.push({
          targetType: 'initial',
          productId: line.productId,
          productName: line.productName,
          presentation: prod?.presentation,
          unitType: line.unitType,
          oldQuantity: line.quantity,
          newQuantity: newQty,
          delta: round2(newQty - line.quantity),
          lotCode: line.allocations?.map((a) => a.lotCode).filter(Boolean).join(', ') || line.lotCode,
        })
      }
    }

    const voidedAdditionsList: Array<{
      additionId: string
      additionIndex: number
      time: string
      responsible: string
      lines: Array<{
        productId: string
        productName: string
        presentation?: string
        unitType: 'kg' | 'package' | 'unit'
        quantity: number
      }>
    }> = []

    const additionDiffs: Array<{
      targetType: 'initial' | 'addition'
      additionId: string
      additionIndex: number
      productId: string
      productName: string
      presentation?: string
      unitType: 'kg' | 'package' | 'unit'
      oldQuantity: number
      newQuantity: number
      delta: number
      lotCode?: string
    }> = []

    let addIdx = 0
    for (const add of correctionTarget.additions || []) {
      if (add.voided) continue
      addIdx++
      if (voidedAdditions.has(add.id)) {
        voidedAdditionsList.push({
          additionId: add.id,
          additionIndex: addIdx,
          time: new Date(add.createdAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' }),
          responsible: add.warehouseResponsibleName || add.createdByName || 'Almacén',
          lines: add.quantityByProduct.map((l) => {
            const prod = data.products.find((p) => p.id === l.productId)
            return {
              productId: l.productId,
              productName: l.productName,
              presentation: prod?.presentation,
              unitType: l.unitType,
              quantity: l.quantity,
            }
          }),
        })
      } else {
        for (const line of add.quantityByProduct || []) {
          const newQty = additionDrafts[add.id]?.[line.productId] ?? line.quantity
          if (round2(newQty) !== round2(line.quantity)) {
            const prod = data.products.find((p) => p.id === line.productId)
            additionDiffs.push({
              targetType: 'addition',
              additionId: add.id,
              additionIndex: addIdx,
              productId: line.productId,
              productName: line.productName,
              presentation: prod?.presentation,
              unitType: line.unitType,
              oldQuantity: line.quantity,
              newQuantity: newQty,
              delta: round2(newQty - line.quantity),
              lotCode: line.allocations?.map((a) => a.lotCode).filter(Boolean).join(', ') || line.lotCode,
            })
          }
        }
      }
    }

    const totalCount = initialDiffs.length + additionDiffs.length + voidedAdditionsList.length
    return { initialDiffs, additionDiffs, voidedAdditionsList, totalCount }
  }

  const handleProceedToReview = () => {
    setCorrectionError(null)
    const { initialDiffs, additionDiffs, voidedAdditionsList, totalCount } = getPendingChanges()
    if (totalCount === 0) {
      setCorrectionError('No has realizado ningún cambio en las cantidades del despacho.')
      return
    }

    // Pre-validar contra ventas y stock disponible en almacén
    const loadedMap = computeLoadedByProduct(correctionTarget!)
    const netDeltaByProduct = new Map<string, number>()

    for (const d of initialDiffs) {
      netDeltaByProduct.set(d.productId, round2((netDeltaByProduct.get(d.productId) || 0) + d.delta))
    }
    for (const d of additionDiffs) {
      netDeltaByProduct.set(d.productId, round2((netDeltaByProduct.get(d.productId) || 0) + d.delta))
    }
    for (const va of voidedAdditionsList) {
      for (const l of va.lines) {
        netDeltaByProduct.set(l.productId, round2((netDeltaByProduct.get(l.productId) || 0) - l.quantity))
      }
    }

    for (const [pid, delta] of netDeltaByProduct.entries()) {
      const curLoaded = loadedMap.get(pid)?.totalLoaded || 0
      const newLoaded = round2(curLoaded + delta)
      const totalSold = getProductSalesInDispatch(correctionTarget!.id, pid)
      const prod = data.products.find((p) => p.id === pid)
      const name = prod?.name || 'este producto'

      if (delta < 0 && newLoaded < totalSold) {
        setCorrectionError(
          `No puedes reducir la carga de ${name} a ${formatQty(newLoaded, prod?.unitType || 'kg')} porque ya se registraron ${formatQty(totalSold, prod?.unitType || 'kg')} vendidos.`
        )
        return
      }

      if (delta > 0) {
        const availableInWh = central.get(pid) || 0
        if (availableInWh < delta) {
          setCorrectionError(
            `Stock insuficiente en almacén para aumentar ${name}. Disponible: ${formatQty(availableInWh, prod?.unitType || 'kg')}, adicional requerido: ${formatQty(delta, prod?.unitType || 'kg')}.`
          )
          return
        }
      }
    }

    setIsReviewingCorrection(true)
  }

  const handleSubmitCorrection = async () => {
    if (isSubmittingCorrection || !correctionTarget) return
    if (!correctionReason.trim()) {
      setCorrectionError('El motivo de la corrección es obligatorio.')
      return
    }

    const { initialDiffs, additionDiffs, voidedAdditionsList, totalCount } = getPendingChanges()
    if (totalCount === 0) {
      setCorrectionError('No hay cambios pendientes para guardar.')
      return
    }

    const changes: DispatchCorrectionChange[] = []
    for (const d of initialDiffs) {
      changes.push({
        targetType: 'initial',
        productId: d.productId,
        newQuantity: round2(d.newQuantity),
      })
    }
    for (const d of additionDiffs) {
      changes.push({
        targetType: 'addition',
        additionId: d.additionId,
        productId: d.productId,
        newQuantity: round2(d.newQuantity),
      })
    }
    for (const va of voidedAdditionsList) {
      changes.push({
        targetType: 'addition',
        additionId: va.additionId,
        voidAddition: true,
      })
    }

    setIsSubmittingCorrection(true)
    setCorrectionError(null)
    try {
      await correctDispatch({
        dispatchId: correctionTarget.id,
        reason: correctionReason.trim(),
        changes,
      })
      setCorrectionTarget(null)
      setIsReviewingCorrection(false)
      setCorrectionReason('')
      setCorrectionError(null)
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

  const lotLocation = effectiveWarehouse === 'central' ? 'central' : `warehouse__${effectiveWarehouse}`
  const eligibleLots = (productId: string) => data.lots
    .filter(lot => lot.productId === productId && (lot.quantities[lotLocation] || 0) > 0 && !lot.quarantined && (!lot.expiresOn || lot.expiresOn >= new Date().toLocaleDateString('en-CA')))
    .sort((a, b) => (a.expiresOn || '9999').localeCompare(b.expiresOn || '9999') || a.id.localeCompare(b.id))

  const distributeFefo = (draft: DraftLine) => {
    let remaining = round2(Number(draft.quantity))
    if (!(remaining > 0)) { setError('Primero indica la cantidad total del producto.'); return }
    const allocations: DraftLine['allocations'] = []
    for (const lot of eligibleLots(draft.productId)) {
      if (remaining <= 0) break
      const quantity = round2(Math.min(remaining, lot.quantities[lotLocation] || 0))
      if (quantity > 0) allocations.push({ id: newOperationId('lot'), lotId: lot.id, quantity: String(quantity) })
      remaining = round2(remaining - quantity)
    }
    if (remaining > 0) { setError(`Faltan ${remaining} para completar la cantidad con lotes aptos.`); return }
    setError(null)
    setDraftLines(current => current.map(line => line.id === draft.id ? { ...line, allocations } : line))
  }

  const validateLotAssignments = (): string | null => {
    for (const draft of draftLines) {
      const product = activeProducts.find(item => item.id === draft.productId)
      const total = round2(Number(draft.quantity))
      if (!product || !(total > 0)) continue
      if (!draft.allocations.length) return `Distribuye ${product.name} entre uno o más lotes.`
      const ids = draft.allocations.map(part => part.lotId)
      if (ids.some(id => !id)) return `Selecciona todos los lotes de ${product.name}.`
      if (new Set(ids).size !== ids.length) return `No repitas el mismo lote en ${product.name}.`
      let assigned = 0
      for (const part of draft.allocations) {
        const quantity = round2(Number(part.quantity))
        const lot = eligibleLots(product.id).find(item => item.id === part.lotId)
        if (!lot || !(quantity > 0)) return `Revisa las asignaciones de ${product.name}.`
        if (quantity > round2(lot.quantities[lotLocation] || 0)) return `El lote ${lot.lotCode} no tiene cantidad suficiente.`
        assigned = round2(assigned + quantity)
      }
      if (Math.abs(assigned - total) >= 0.01) {
        const difference = round2(Math.abs(total - assigned))
        return assigned < total
          ? `Faltan distribuir ${difference} de ${product.name}. Asignado: ${assigned} / ${total}.`
          : `Sobran ${difference} asignados en ${product.name}. Asignado: ${assigned} / ${total}.`
      }
    }
    return null
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
        allocationsRequested: draft.allocations.map(part => ({ lotId: part.lotId, quantity: round2(Number(part.quantity)) })),
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
    const lotError = validateLotAssignments(); if (lotError) { setError(lotError); return }
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
    const lotError = validateLotAssignments(); if (lotError) { setError(lotError); return }
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
          const lots = eligibleLots(product.id)
          const assigned = round2(line.allocations.reduce((sum, part) => sum + (Number(part.quantity) || 0), 0))
          const total = round2(Number(line.quantity) || 0)
          const complete = total > 0 && Math.abs(assigned - total) < 0.01
          return <div key={line.id} className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-extrabold leading-snug text-slate-900">{product.name}</p><p className="mt-0.5 text-[11px] font-semibold text-slate-500">Disponible: {formatQty(central.get(product.id) ?? 0, product.unitType)}</p></div><button type="button" aria-label={`Quitar ${product.name}`} onClick={() => setDraftLines(current => current.filter(item => item.id !== line.id))} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-white hover:text-rose-600"><Trash2 size={16} /></button></div>
            <Field label="Cantidad total a despachar" required><NumberInput aria-label={`Cantidad total de ${product.name}`} value={line.quantity} min={0} step={product.unitType === 'kg' ? 0.01 : 1} placeholder={product.unitType === 'kg' ? 'kg' : 'Cantidad'} onChange={event => setDraftLines(current => current.map(item => item.id === line.id ? { ...item, quantity: event.target.value } : item))} /></Field>
            <div className="rounded-2xl border border-slate-200 bg-white p-3"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-black text-slate-800">Lotes utilizados</p><button type="button" className="rounded-xl bg-slate-100 px-3 py-2 text-[11px] font-extrabold text-slate-700" onClick={() => distributeFefo(line)}>Distribuir por FEFO</button></div>
              <div className="grid gap-2">{line.allocations.map(part => <div key={part.id} className="grid gap-2 rounded-xl border border-slate-200 p-2 sm:grid-cols-[minmax(0,1fr)_110px_40px] sm:items-center"><SelectInput aria-label={`Lote de ${product.name}`} value={part.lotId} onChange={event => setDraftLines(current => current.map(item => item.id === line.id ? { ...item, allocations: item.allocations.map(entry => entry.id === part.id ? { ...entry, lotId: event.target.value } : entry) } : item))}><option value="">Selecciona lote</option>{lots.map(lot => <option key={lot.id} value={lot.id}>{lot.lotCode} · {formatQty(lot.quantities[lotLocation], product.unitType)} · vence {lot.expiresOn || 'sin fecha'}</option>)}</SelectInput><NumberInput aria-label={`Cantidad del lote para ${product.name}`} value={part.quantity} min={0} step={product.unitType === 'kg' ? 0.01 : 1} placeholder="Cantidad" onChange={event => setDraftLines(current => current.map(item => item.id === line.id ? { ...item, allocations: item.allocations.map(entry => entry.id === part.id ? { ...entry, quantity: event.target.value } : entry) } : item))} /><button type="button" aria-label="Quitar lote" onClick={() => setDraftLines(current => current.map(item => item.id === line.id ? { ...item, allocations: item.allocations.filter(entry => entry.id !== part.id) } : item))} className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={15} /></button></div>)}</div>
              <button type="button" className="mt-2 w-full rounded-xl border border-dashed border-[var(--primary)] px-3 py-2 text-xs font-extrabold text-[var(--primary)]" onClick={() => setDraftLines(current => current.map(item => item.id === line.id ? { ...item, allocations: [...item.allocations, { id: newOperationId('lot'), lotId: '', quantity: '' }] } : item))}>+ Agregar otro lote</button>
              <p className={`mt-2 text-xs font-extrabold ${complete ? 'text-emerald-700' : 'text-amber-700'}`}>Asignado: {assigned} / {total} {complete ? '✓' : total <= 0 ? '' : total > assigned ? `· Faltan ${round2(total - assigned)}` : `· Sobran ${round2(assigned - total)}`}</p>
            </div>
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
                        {corr.newQuantity === 0 ? (
                          <p className="mt-1 font-black text-rose-700">
                            {corr.productName}: {formatQty(corr.oldQuantity, corr.unitType)} → ELIMINADO ({formatQty(corr.returnedQuantity || corr.oldQuantity, corr.unitType)} devueltos a almacén)
                          </p>
                        ) : (corr.addedQuantity || 0) > 0 ? (
                          <p className="mt-1 font-black text-blue-700">
                            {corr.productName}: {formatQty(corr.oldQuantity, corr.unitType)} → {formatQty(corr.newQuantity, corr.unitType)} (+{formatQty(corr.addedQuantity || 0, corr.unitType)} tomados de almacén)
                          </p>
                        ) : (
                          <p className="mt-1 font-black text-slate-900">
                            {corr.productName}: {formatQty(corr.oldQuantity, corr.unitType)} → {formatQty(corr.newQuantity, corr.unitType)} (-{formatQty(corr.returnedQuantity || 0, corr.unitType)} devueltos a almacén)
                          </p>
                        )}
                        {corr.lotCode && (
                          <p className="text-[11px] font-semibold text-slate-500">
                            Lote: {corr.lotCode}
                          </p>
                        )}
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
                <button type="button" onClick={() => setDraftLines(current => draft ? current.filter(line => line.productId !== product.id) : [...current, { id: newOperationId('draft'), productId: product.id, quantity: '', allocations: [] }])} className="flex min-h-[88px] w-full flex-col items-start justify-between gap-2 p-3 text-left">
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
            setIsReviewingCorrection(false)
            setCorrectionReason('')
            setCorrectionError(null)
          }
        }}
        title={isReviewingCorrection ? 'Revisar corrección' : 'Corregir despacho'}
        subtitle={correctionTarget ? `${correctionTarget.routeName} · ${correctionTarget.distributorName}` : ''}
        size="lg"
        footer={
          isReviewingCorrection ? (
            <div className="grid w-full grid-cols-2 gap-2">
              <SecondaryButton
                disabled={isSubmittingCorrection}
                onClick={() => {
                  setIsReviewingCorrection(false)
                  setCorrectionError(null)
                }}
              >
                Volver a editar
              </SecondaryButton>
              <PrimaryButton
                disabled={isSubmittingCorrection}
                onClick={() => void handleSubmitCorrection()}
              >
                {isSubmittingCorrection ? 'Guardando...' : 'Confirmar corrección'}
              </PrimaryButton>
            </div>
          ) : (
            (() => {
              const { totalCount } = getPendingChanges()
              return (
                <div className="grid w-full grid-cols-2 gap-2">
                  <SecondaryButton onClick={() => setCorrectionTarget(null)}>
                    Cerrar
                  </SecondaryButton>
                  <PrimaryButton
                    disabled={totalCount === 0}
                    onClick={handleProceedToReview}
                  >
                    Revisar ({totalCount} {totalCount === 1 ? 'cambio' : 'cambios'})
                  </PrimaryButton>
                </div>
              )
            })()
          )
        }
      >
        {correctionTarget && !isReviewingCorrection && (
          <div className="grid gap-3.5">
            <div className="rounded-2xl border border-blue-200 bg-blue-50/80 p-3 text-xs text-blue-900">
              <p className="font-extrabold">Corrección auditada de despacho</p>
              <p className="mt-0.5 text-[11px] text-blue-800">
                Usa los botones <strong>[-]</strong> <strong>[+]</strong> o edita el campo directamente. Las cantidades reducidas o eliminadas vuelven automáticamente a su lote en el almacén; los aumentos toman stock disponible.
              </p>
            </div>

            {/* BLOQUE 1: CARGA INICIAL */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4">
              <div className="mb-2.5 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-black uppercase tracking-wide text-slate-800">Carga inicial</h4>
                  <p className="text-[11px] font-semibold text-slate-500">Productos despachados al inicio de la ruta</p>
                </div>
                <span className="rounded-lg bg-slate-200/80 px-2 py-0.5 text-[10px] font-extrabold text-slate-700">
                  {correctionTarget.lines.length} producto{correctionTarget.lines.length === 1 ? '' : 's'}
                </span>
              </div>

              <div className="grid gap-2.5">
                {correctionTarget.lines.map((line) => {
                  const prod = data.products.find((p) => p.id === line.productId)
                  const lotCode = line.allocations?.map((a) => a.lotCode).filter(Boolean).join(', ') || line.lotCode || 'Lote original'
                  const totalSold = getProductSalesInDispatch(correctionTarget.id, line.productId)
                  const curVal = initialDrafts[line.productId] ?? line.quantity
                  const diff = round2(curVal - line.quantity)
                  const step = line.unitType === 'kg' ? 0.01 : 1

                  return (
                    <div key={line.productId} className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-xs font-black text-slate-900">{line.productName}</p>
                          {prod?.presentation && (
                            <p className="text-[11px] font-medium text-slate-500">{prod.presentation}</p>
                          )}
                          <p className="text-[10px] font-semibold text-slate-400">
                            Lote: {lotCode} · Carga original: <span className="font-extrabold text-slate-700">{formatQty(line.quantity, line.unitType)}</span>
                          </p>
                          {totalSold > 0 && (
                            <p className="text-[10px] font-bold text-amber-700">
                              Vendido registrado: {formatQty(totalSold, line.unitType)}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => updateInitialDraft(line.productId, 0)}
                          className="self-start rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700 transition hover:bg-rose-100 sm:self-auto"
                        >
                          Eliminar producto del despacho
                        </button>
                      </div>

                      {/* Controles interactivos: [-] [ Input ] [+] */}
                      <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        <div className="flex items-center rounded-xl border border-slate-300 bg-slate-50 p-1">
                          <button
                            type="button"
                            disabled={curVal <= 0}
                            onClick={() => updateInitialDraft(line.productId, curVal - step)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-slate-700 shadow-xs transition hover:bg-slate-100 disabled:opacity-40"
                            aria-label={`Disminuir ${line.productName}`}
                          >
                            <Minus size={14} />
                          </button>
                          <input
                            type="number"
                            min={0}
                            step={step}
                            value={curVal}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value)
                              updateInitialDraft(line.productId, isNaN(val) ? 0 : val)
                            }}
                            className="w-20 bg-transparent px-2 text-center text-xs font-black text-slate-900 focus:outline-none"
                            aria-label={`Cantidad corregida de ${line.productName}`}
                          />
                          <button
                            type="button"
                            onClick={() => updateInitialDraft(line.productId, curVal + step)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-slate-700 shadow-xs transition hover:bg-slate-100"
                            aria-label={`Aumentar ${line.productName}`}
                          >
                            <Plus size={14} />
                          </button>
                        </div>

                        {/* Indicador textual dinámico */}
                        <div className="min-w-0 text-xs">
                          {curVal === 0 && line.quantity > 0 ? (
                            <span className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2 py-1 text-[11px] font-black text-rose-700">
                              <Trash2 size={12} /> SE ELIMINARÁ (devuelve {formatQty(line.quantity, line.unitType)} al almacén)
                            </span>
                          ) : diff < 0 ? (
                            <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-black text-emerald-700">
                              <ArrowDownRight size={12} /> DEVUELVE {formatQty(Math.abs(diff), line.unitType)} al almacén
                            </span>
                          ) : diff > 0 ? (
                            <span className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1 text-[11px] font-black text-blue-700">
                              <ArrowUpRight size={12} /> AGREGA +{formatQty(diff, line.unitType)} del almacén
                            </span>
                          ) : (
                            <span className="text-[11px] font-semibold text-slate-400">Sin cambios</span>
                          )}
                        </div>
                      </div>

                      {totalSold > 0 && curVal < totalSold && (
                        <p className="mt-1.5 flex items-center gap-1 text-[10px] font-extrabold text-rose-600">
                          <AlertTriangle size={12} /> No se puede reducir por debajo de lo vendido ({formatQty(totalSold, line.unitType)})
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* BLOQUE 2: AUMENTOS DE CARGA */}
            {(() => {
              const activeAdditions = (correctionTarget.additions || []).filter((a) => !a.voided)
              if (activeAdditions.length === 0) return null

              return (
                <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-3 sm:p-4">
                  <div className="mb-2.5 flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-black uppercase tracking-wide text-amber-900">Aumentos de carga</h4>
                      <p className="text-[11px] font-semibold text-amber-800">Cargas adicionales registradas durante la jornada</p>
                    </div>
                    <span className="rounded-lg bg-amber-200/80 px-2 py-0.5 text-[10px] font-extrabold text-amber-900">
                      {activeAdditions.length} aumento{activeAdditions.length === 1 ? '' : 's'}
                    </span>
                  </div>

                  <div className="grid gap-3">
                    {activeAdditions.map((addition, idx) => {
                      const isVoided = voidedAdditions.has(addition.id)
                      const time = new Date(addition.createdAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })
                      const resp = addition.warehouseResponsibleName || addition.createdByName || 'Almacén'

                      return (
                        <div key={addition.id} className={`rounded-xl border p-3 shadow-xs transition ${isVoided ? 'border-rose-300 bg-rose-50/60' : 'border-amber-200 bg-white'}`}>
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                            <div>
                              <span className="text-xs font-extrabold text-amber-900">
                                Aumento #{idx + 1} ({time} · {resp})
                              </span>
                              {addition.note && (
                                <p className="text-[10px] italic text-slate-500">Nota: {addition.note}</p>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => toggleVoidAddition(addition.id)}
                              className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${isVoided ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100' : 'border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100'}`}
                            >
                              {isVoided ? (
                                <>
                                  <Undo2 size={12} /> Deshacer anulación
                                </>
                              ) : (
                                <>
                                  <Trash2 size={12} /> Eliminar aumento completo
                                </>
                              )}
                            </button>
                          </div>

                          {isVoided ? (
                            <div className="mt-2.5 rounded-lg border border-rose-200 bg-rose-100/70 p-2.5 text-xs text-rose-800">
                              <p className="font-extrabold">Este aumento se anulará completamente</p>
                              <p className="mt-0.5 text-[11px]">
                                Todos los productos volverán al almacén ({addition.quantityByProduct.map((p) => `${p.productName} ${formatQty(p.quantity, p.unitType)}`).join(', ')}).
                              </p>
                            </div>
                          ) : (
                            <div className="mt-2.5 grid gap-2">
                              {addition.quantityByProduct.map((line) => {
                                const prod = data.products.find((p) => p.id === line.productId)
                                const lotCode = line.allocations?.map((a) => a.lotCode).filter(Boolean).join(', ') || line.lotCode || 'Lote original'
                                const totalSold = getProductSalesInDispatch(correctionTarget.id, line.productId)
                                const curVal = additionDrafts[addition.id]?.[line.productId] ?? line.quantity
                                const diff = round2(curVal - line.quantity)
                                const step = line.unitType === 'kg' ? 0.01 : 1

                                return (
                                  <div key={line.productId} className="rounded-lg border border-slate-100 bg-slate-50/70 p-2.5">
                                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                                      <div className="min-w-0">
                                        <p className="text-xs font-black text-slate-900">{line.productName}</p>
                                        {prod?.presentation && (
                                          <p className="text-[11px] font-medium text-slate-500">{prod.presentation}</p>
                                        )}
                                        <p className="text-[10px] font-semibold text-slate-400">
                                          Lote: {lotCode} · Aumentado original: <span className="font-extrabold text-slate-700">+{formatQty(line.quantity, line.unitType)}</span>
                                        </p>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => updateAdditionDraft(addition.id, line.productId, 0)}
                                        className="self-start rounded-lg border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 transition hover:bg-rose-100 sm:self-auto"
                                      >
                                        Eliminar de este aumento
                                      </button>
                                    </div>

                                    {/* Stepper por producto dentro del aumento */}
                                    <div className="mt-2 flex flex-wrap items-center gap-2">
                                      <div className="flex items-center rounded-xl border border-slate-300 bg-white p-0.5">
                                        <button
                                          type="button"
                                          disabled={curVal <= 0}
                                          onClick={() => updateAdditionDraft(addition.id, line.productId, curVal - step)}
                                          className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-700 transition hover:bg-slate-100 disabled:opacity-40"
                                        >
                                          <Minus size={13} />
                                        </button>
                                        <input
                                          type="number"
                                          min={0}
                                          step={step}
                                          value={curVal}
                                          onChange={(e) => {
                                            const val = parseFloat(e.target.value)
                                            updateAdditionDraft(addition.id, line.productId, isNaN(val) ? 0 : val)
                                          }}
                                          className="w-16 bg-transparent px-1 text-center text-xs font-black text-slate-900 focus:outline-none"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => updateAdditionDraft(addition.id, line.productId, curVal + step)}
                                          className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-700 transition hover:bg-slate-100"
                                        >
                                          <Plus size={13} />
                                        </button>
                                      </div>

                                      {/* Indicador */}
                                      <div className="min-w-0 text-xs">
                                        {curVal === 0 && line.quantity > 0 ? (
                                          <span className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2 py-0.5 text-[11px] font-black text-rose-700">
                                            <Trash2 size={11} /> SE ELIMINARÁ (devuelve +{formatQty(line.quantity, line.unitType)})
                                          </span>
                                        ) : diff < 0 ? (
                                          <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-0.5 text-[11px] font-black text-emerald-700">
                                            <ArrowDownRight size={11} /> DEVUELVE {formatQty(Math.abs(diff), line.unitType)}
                                          </span>
                                        ) : diff > 0 ? (
                                          <span className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-0.5 text-[11px] font-black text-blue-700">
                                            <ArrowUpRight size={11} /> AGREGA +{formatQty(diff, line.unitType)}
                                          </span>
                                        ) : (
                                          <span className="text-[11px] font-semibold text-slate-400">Sin cambios</span>
                                        )}
                                      </div>
                                    </div>
                                    {totalSold > 0 && curVal < totalSold && (
                                      <p className="mt-1 text-[10px] font-bold text-amber-700">
                                        Total vendido registrado en la ruta: {formatQty(totalSold, line.unitType)}
                                      </p>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}

            {correctionError && (
              <div className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-700">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <span>{correctionError}</span>
              </div>
            )}
          </div>
        )}

        {/* PANTALLA DE REVISIÓN PREVIA */}
        {correctionTarget && isReviewingCorrection && (
          (() => {
            const { initialDiffs, additionDiffs, voidedAdditionsList } = getPendingChanges()
            const reductions = [...initialDiffs, ...additionDiffs].filter((d) => d.delta < 0)
            const increases = [...initialDiffs, ...additionDiffs].filter((d) => d.delta > 0)

            return (
              <div className="grid gap-3.5">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                  <p className="font-extrabold text-slate-900">Resumen de cambios a aplicar</p>
                  <p className="mt-0.5 text-[11px] text-slate-600">
                    Revisa las modificaciones antes de confirmar. Esta operación es auditada y quedará registrada en el historial del despacho.
                  </p>
                </div>

                {/* 1. Reducciones y eliminaciones */}
                {reductions.length > 0 && (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-3">
                    <p className="mb-2 text-xs font-black uppercase text-emerald-900">
                      Mercadería devuelta al almacén ({reductions.length} {reductions.length === 1 ? 'producto' : 'productos'})
                    </p>
                    <div className="grid gap-1.5">
                      {reductions.map((r, i) => (
                        <div key={i} className="flex items-center justify-between rounded-xl border border-emerald-200/80 bg-white p-2 text-xs">
                          <div className="min-w-0">
                            <p className="font-extrabold text-slate-900">
                              {r.productName} {r.presentation ? `(${r.presentation})` : ''}
                            </p>
                            <p className="text-[11px] text-slate-500">
                              {r.targetType === 'addition' ? `Aumento #${r.additionIndex}` : 'Carga inicial'} · {formatQty(r.oldQuantity, r.unitType)} → {formatQty(r.newQuantity, r.unitType)}
                            </p>
                          </div>
                          <span className="shrink-0 text-right text-xs font-black text-emerald-700">
                            Devuelve: {formatQty(Math.abs(r.delta), r.unitType)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 2. Aumentos */}
                {increases.length > 0 && (
                  <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-3">
                    <p className="mb-2 text-xs font-black uppercase text-blue-900">
                      Carga adicional tomada de almacén ({increases.length} {increases.length === 1 ? 'producto' : 'productos'})
                    </p>
                    <div className="grid gap-1.5">
                      {increases.map((inc, i) => {
                        const whStock = central.get(inc.productId) ?? 0
                        return (
                          <div key={i} className="flex items-center justify-between rounded-xl border border-blue-200/80 bg-white p-2 text-xs">
                            <div className="min-w-0">
                              <p className="font-extrabold text-slate-900">
                                {inc.productName} {inc.presentation ? `(${inc.presentation})` : ''}
                              </p>
                              <p className="text-[11px] text-slate-500">
                                {inc.targetType === 'addition' ? `Aumento #${inc.additionIndex}` : 'Carga inicial'} · {formatQty(inc.oldQuantity, inc.unitType)} → {formatQty(inc.newQuantity, inc.unitType)}
                              </p>
                              <p className="text-[10px] font-semibold text-blue-600">
                                Stock disponible en almacén: {formatQty(whStock, inc.unitType)}
                              </p>
                            </div>
                            <span className="shrink-0 text-right text-xs font-black text-blue-700">
                              Agrega: +{formatQty(inc.delta, inc.unitType)}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* 3. Aumentos anulados completamente */}
                {voidedAdditionsList.length > 0 && (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50/50 p-3">
                    <p className="mb-2 text-xs font-black uppercase text-rose-900">
                      Aumentos anulados completamente ({voidedAdditionsList.length})
                    </p>
                    <div className="grid gap-1.5">
                      {voidedAdditionsList.map((va, i) => (
                        <div key={i} className="rounded-xl border border-rose-200/80 bg-white p-2.5 text-xs">
                          <p className="font-black text-rose-900">
                            Aumento #{va.additionIndex} ({va.time} · {va.responsible})
                          </p>
                          <p className="mt-0.5 text-[11px] text-slate-600">
                            Se anulará por completo y retornará todo el stock al almacén:
                          </p>
                          <p className="mt-1 text-[11px] font-bold text-slate-800">
                            {va.lines.map((l) => `${l.productName} (${formatQty(l.quantity, l.unitType)})`).join(', ')}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Motivo obligatorio */}
                <Field label="Motivo de la corrección" required hint="Obligatorio. Quedará registrado en la auditoría permanente.">
                  <TextArea
                    value={correctionReason}
                    onChange={(e) => setCorrectionReason(e.target.value)}
                    placeholder="Ej: Error de conteo físico, corrección de digitación, producto no subió al camión..."
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
            )
          })()
        )}
      </Modal>

    </Screen>
  )
}
