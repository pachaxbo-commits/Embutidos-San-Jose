import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Plus, RefreshCw, Save, ShieldCheck, Trash2 } from 'lucide-react'
import { Field, NumberInput, SelectInput, TextArea, TextInput } from '../../../components/ui/Form'
import { EmptyBlock, LoadingState, Screen } from '../../../components/ui/Screen'
import { reconcileProcessingMass } from '../domain/processingDomain'
import { decimalInputToScaledInteger, formatKgFromGrams, gramsInput, isEligibleProcessingLot, kgInputToGrams, lotAvailableQuantity } from '../domain/processingUi'
import { newOperationId, warehouseBalanceId, loadProcessingBatchPage, loadProcessingReservationPage, getProcessingOperationState, confirmProcessingBatch, type ProcessingBatchPage } from '../data/distributionRepository'
import { stockAvailability } from '../domain/stockAvailability'
import type { ProcessingBatch, ProcessingReservation, ProcessingDestinationKind, ProcessingWeightBasis, ConfirmProcessingBatchInput, ProcessingPackagingMaterial, ProcessingCostComponent } from '../domain/processing'
import type { DistLot, DistProduct } from '../types'
import type { DistributionViewProps } from './DistributionApp'
import { PrimaryButton, SecondaryButton, SectionCard } from './shared'

type SourceRow = { lotId: string; quantityKg: string }
type DestinationDraft = {
  id: string; kind: ProcessingDestinationKind; productId: string; commercialQuantity: string; netWeightG: string; nominalWeightG: string;
  lotCode: string; manufacturedOn: string; packagedOn: string; expiresOn: string; weightBasis: ProcessingWeightBasis; reason: string;
  qualityConfirmed: boolean; qualityReason: string
}
type MaterialDraft = { id: string; description: string; quantity: string; damaged: string; costBs: string; expenseId: string }
type CostDraft = { id: string; kind: ProcessingCostComponent['kind']; amountBs: string; expenseId: string; sourceReference: string }
type Draft = {
  batchId: string; operationId: string; processType: ConfirmProcessingBatchInput['processType']; location: string; sourceProductId: string;
  processingDate: string; sources: SourceRow[]; destinations: DestinationDraft[]; materials: MaterialDraft[]; costs: CostDraft[]; notes: string; operationPending?: boolean
}
type SubmitState = 'idle' | 'sending' | 'unknown' | 'rejected' | 'confirmed'
type Tab = 'new' | 'history'
type HistoryMode = 'batches' | 'reservations'
const DRAFT_PREFIX = 'sanjose_processing_draft_v1'
const randomId = (prefix: string) => newOperationId(prefix).replace(/[^A-Za-z0-9_-]/g, '_')
const todayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const freshDestination = (today: string): DestinationDraft => ({ id: randomId('destination'), kind: 'finished', productId: '', commercialQuantity: '', netWeightG: '', nominalWeightG: '', lotCode: '', manufacturedOn: today, packagedOn: today, expiresOn: '', weightBasis: 'measured_total', reason: '', qualityConfirmed: false, qualityReason: '' })
const freshDraft = (location: string, today: string): Draft => ({ batchId: randomId('processing_batch'), operationId: randomId('processing_operation'), processType: 'bagging', location, sourceProductId: '', processingDate: today, sources: [], destinations: [freshDestination(today)], materials: [], costs: [], notes: '' })
const draftKey = (uid: string) => `${DRAFT_PREFIX}:${uid}`
function readDraft(uid: string, location: string, today: string, preserveSavedLocation = false): Draft {
  try {
    const raw = localStorage.getItem(draftKey(uid))
    if (!raw) return freshDraft(location, today)
    const parsed = JSON.parse(raw) as Draft
    if (!parsed.batchId || !parsed.operationId || !Array.isArray(parsed.sources) || !Array.isArray(parsed.destinations)) return freshDraft(location, today)
    return { ...freshDraft(location, today), ...parsed, location: preserveSavedLocation && typeof parsed.location === 'string' ? parsed.location : location }
  } catch { return freshDraft(location, today) }
}
function persistDraft(uid: string, draft: Draft): boolean {
  try { localStorage.setItem(draftKey(uid), JSON.stringify(draft)); return true }
  catch { return false }
}
const labelKind: Record<ProcessingDestinationKind, string> = { finished: 'Producto terminado', courtesy: 'Reservado para cortesía', repack_pending: 'Pendiente de reenvasado', review_hold: 'Inmovilizado para revisión', discard: 'Descarte físico real', other: 'Otro destino (no disponible)' }
const formatDateTime = (value?: string) => value ? new Intl.DateTimeFormat('es-BO', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/La_Paz' }).format(new Date(value)) : '—'

export function SacheteadoView({ session, data }: DistributionViewProps) {
  const today = todayKey()
  const fixedLocation = session.role === 'warehouse' ? (session.warehouseId || 'central') : 'central'
  const [draft, setDraft] = useState<Draft>(() => readDraft(session.uid, fixedLocation, today, session.role === 'admin'))
  const [tab, setTab] = useState<Tab>('new')
  const [historyMode, setHistoryMode] = useState<HistoryMode>('batches')
  const [step, setStep] = useState(0)
  const [submitState, setSubmitState] = useState<SubmitState>(() => draft.operationPending ? 'unknown' : 'idle')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [history, setHistory] = useState<ProcessingBatch[]>([])
  const [selectedBatch, setSelectedBatch] = useState<ProcessingBatch | null>(null)
  const [historyWarehouse, setHistoryWarehouse] = useState('all')
  const [historyCursor, setHistoryCursor] = useState<ProcessingBatchPage['cursor']>(null)
  const [historyHasMore, setHistoryHasMore] = useState(false)
  const [reservations, setReservations] = useState<ProcessingReservation[]>([])
  const [reservationCursor, setReservationCursor] = useState<ProcessingBatchPage['cursor']>(null)
  const [reservationsHasMore, setReservationsHasMore] = useState(false)
  const submitLock = useRef(false)
  const location = session.role === 'admin' ? draft.location : fixedLocation
  const locationKey = location === 'central' ? 'central' : `warehouse__${location}`
  const canAdmin = session.role === 'admin'
  const selectedProduct = data.products.find(product => product.id === draft.sourceProductId)
  const eligibleLots = useMemo(() => selectedProduct ? data.lots
    .filter(lot => isEligibleProcessingLot(lot, selectedProduct.id, locationKey, today))
    .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn) || a.lotCode.localeCompare(b.lotCode)) : [], [data.lots, selectedProduct, locationKey, today])
  const sourceRows = draft.sources.map(source => ({ ...source, grams: kgInputToGrams(source.quantityKg) }))
  const inputWeightG = sourceRows.reduce((sum, row) => sum + (row.grams || 0), 0)
  const outputWeightG = draft.destinations.reduce((sum, destination) => sum + (gramsInput(destination.netWeightG) || 0), 0)
  const massDifferenceG = inputWeightG - outputWeightG
  const massError = useMemo(() => {
    if (!inputWeightG || !draft.destinations.length) return 'Ingresa el peso medido de origen y asigna todos los destinos.'
    try { reconcileProcessingMass(inputWeightG, draft.destinations.map(destination => ({ id: destination.id, netWeightG: gramsInput(destination.netWeightG) || 0 }))); return '' }
    catch (reason) { return (reason as Error).message }
  }, [inputWeightG, draft.destinations])
  const selectedLotIds = new Set(draft.sources.map(source => source.lotId))
  const currentBalance = data.balances.find(balance => balance.id === warehouseBalanceId(location, draft.sourceProductId))
  const stock = selectedProduct ? stockAvailability(currentBalance, data.lots, locationKey, today) : null
  const hasAdminOnlyDestinations = draft.destinations.some(destination => ['courtesy', 'discard'].includes(destination.kind))
  const warehouseNeedsAdmin = session.role === 'warehouse' && hasAdminOnlyDestinations

  useEffect(() => {
    persistDraft(session.uid, draft)
  }, [draft, session.uid])
  useEffect(() => {
    if (tab !== 'history' || historyMode !== 'batches') return
    let active = true
    queueMicrotask(() => { if (active) { setLoadingHistory(true); setHistoryError(''); setHistory([]); setHistoryCursor(null); setHistoryHasMore(false) } })
    const sourceLocation = session.role === 'warehouse' ? locationKey : historyWarehouse === 'all' ? undefined : historyWarehouse === 'central' ? 'central' : `warehouse__${historyWarehouse}`
    void loadProcessingBatchPage(sourceLocation).then(page => {
      if (!active) return
      setHistory(page.rows); setHistoryCursor(page.cursor); setHistoryHasMore(page.hasMore)
    }).catch(reason => { if (active) setHistoryError((reason as Error).message || 'No se pudo consultar el historial.') })
      .finally(() => { if (active) setLoadingHistory(false) })
    return () => { active = false }
  }, [tab, historyMode, session.role, locationKey, historyWarehouse])

  useEffect(() => {
    if (tab !== 'history' || historyMode !== 'reservations') return
    let active = true
    queueMicrotask(() => { if (active) { setLoadingHistory(true); setHistoryError(''); setReservations([]); setReservationCursor(null); setReservationsHasMore(false) } })
    const location = session.role === 'warehouse' ? locationKey : historyWarehouse === 'all' ? undefined : historyWarehouse === 'central' ? 'central' : `warehouse__${historyWarehouse}`
    void loadProcessingReservationPage(location).then(page => {
      if (!active) return
      setReservations(page.rows); setReservationCursor(page.cursor); setReservationsHasMore(page.hasMore)
    }).catch(reason => { if (active) setHistoryError((reason as Error).message || 'No se pudieron consultar las reservas.') })
      .finally(() => { if (active) setLoadingHistory(false) })
    return () => { active = false }
  }, [tab, historyMode, session.role, locationKey, historyWarehouse])

  const editDraft = (update: (current: Draft) => Draft) => {
    if (submitState === 'unknown' || submitState === 'sending') return
    setError(''); setMessage('')
    setDraft(current => {
      const next = update(current)
      return submitState === 'rejected' ? { ...next, operationId: randomId('processing_operation') } : next
    })
    if (submitState === 'rejected') setSubmitState('idle')
  }
  const setSourceProduct = (productId: string) => editDraft(current => ({ ...current, sourceProductId: productId, sources: [] }))
  const addSource = (lot: DistLot) => editDraft(current => current.sources.some(source => source.lotId === lot.id) ? current : ({ ...current, sources: [...current.sources, { lotId: lot.id, quantityKg: '' }] }))
  const removeSource = (lotId: string) => editDraft(current => ({ ...current, sources: current.sources.filter(source => source.lotId !== lotId) }))
  const updateDestination = (destinationId: string, patch: Partial<DestinationDraft>) => editDraft(current => ({ ...current, destinations: current.destinations.map(item => item.id === destinationId ? { ...item, ...patch } : item) }))

  const validateAndBuildPayload = (): ConfirmProcessingBatchInput => {
    if (!draft.sourceProductId || !selectedProduct) throw new Error('Selecciona el producto a granel de origen.')
    if (selectedProduct.unitType !== 'kg') throw new Error('El origen debe medirse en kg. Los productos por paquete o unidad todavía no se pueden procesar como origen.')
    if (!draft.processingDate || draft.processingDate > today) throw new Error('La fecha de elaboración no puede estar vacía ni ser futura.')
    if (!draft.sources.length || draft.sources.length > 30 || draft.sources.some(row => !kgInputToGrams(row.quantityKg))) throw new Error('Selecciona entre 1 y 30 lotes y registra sus kilos reales utilizados con hasta tres decimales.')
    const sourceLotRows = draft.sources.map(row => eligibleLots.find(lot => lot.id === row.lotId))
    if (sourceLotRows.some(lot => !lot)) throw new Error('Un lote ya no cumple las condiciones; actualiza la pantalla y revisa el origen.')
    const allocationTotalG = draft.sources.reduce((sum, row) => sum + (kgInputToGrams(row.quantityKg) || 0), 0)
    if (stock && allocationTotalG > Math.round(stock.available * 1000)) throw new Error(`El stock disponible del servidor puede ser menor. Disponible ahora: ${stock.available.toFixed(3)} kg.`)
    for (const row of draft.sources) {
      const lot = eligibleLots.find(item => item.id === row.lotId)!
      if ((kgInputToGrams(row.quantityKg) || 0) > Math.round(lotAvailableQuantity(lot, locationKey) * 1000)) throw new Error(`El lote ${lot.lotCode} no tiene suficientes kg disponibles.`)
    }
    if (!draft.destinations.length || draft.destinations.length > 30) throw new Error('Agrega de 1 a 30 destinos físicos.')
    for (const destination of draft.destinations) {
      if (!gramsInput(destination.netWeightG)) throw new Error(`Registra el peso neto medido en gramos para «${labelKind[destination.kind]}».`)
      if (destination.kind === 'discard') {
        if (!canAdmin) throw new Error('El descarte real requiere que Administración confirme la elaboración.')
        if (destination.reason.trim().length < 3) throw new Error('El descarte requiere un motivo específico.')
        continue
      }
      const target = data.products.find(product => product.id === destination.productId && product.active && !product.deleted)
      if (!target) throw new Error('Selecciona un SKU de destino existente y activo; no se crean productos automáticamente.')
      if (target.id === selectedProduct.id) throw new Error('El SKU de destino debe ser distinto al producto a granel de origen.')
      const quantity = Number(destination.commercialQuantity.replace(',', '.'))
      if (!Number.isFinite(quantity) || quantity <= 0 || (target.unitType !== 'kg' && !Number.isSafeInteger(quantity))) throw new Error(`La cantidad comercial de ${target.name} no es válida para su presentación.`)
      if (target.unitType === 'kg' && Math.abs(quantity * 1000 - Number(destination.netWeightG)) > 0.000001) throw new Error(`Para ${target.name}, los kg comerciales deben coincidir con el peso neto medido.`)
      if (destination.nominalWeightG.trim() && !gramsInput(destination.nominalWeightG)) throw new Error(`El peso nominal informativo de ${target.name} debe ser un entero positivo en gramos.`)
      if (!destination.lotCode.trim() || !destination.manufacturedOn || !destination.packagedOn || !destination.expiresOn) throw new Error(`Completa código de lote, elaboración, embolsado y vencimiento de ${target.name}.`)
      if (destination.manufacturedOn > today || destination.packagedOn > today || destination.manufacturedOn > destination.packagedOn || destination.expiresOn < destination.packagedOn) throw new Error(`Revisa las fechas del lote derivado de ${target.name}.`)
      const conservativeSourceExpiry = sourceLotRows.map(lot => lot!.expiresOn).sort()[0]
      if (destination.expiresOn > conservativeSourceExpiry) throw new Error(`El vencimiento de ${target.name} supera el lote de origen más conservador (${conservativeSourceExpiry}).`)
      if (destination.kind === 'courtesy' && (!canAdmin || !destination.qualityConfirmed || destination.qualityReason.trim().length < 3)) throw new Error('La cortesía exige confirmación de aptitud y motivo de Administración; Almacén puede conservar el borrador.')
      if ((destination.kind === 'repack_pending' || destination.kind === 'review_hold') && destination.reason.trim().length < 3) throw new Error(`Indica por qué ${target.name} queda inmovilizado.`)
    }
    if (draft.materials.length > 100 || draft.costs.length > 50) throw new Error('Reduce la cantidad de materiales o componentes de costo del proceso.')
    for (const material of draft.materials) {
      const quantityMilli = decimalInputToScaledInteger(material.quantity, 1000)
      const damagedMilli = material.damaged.trim() ? decimalInputToScaledInteger(material.damaged, 1000) : 0
      const costCents = material.costBs.trim() ? decimalInputToScaledInteger(material.costBs, 100) : null
      if (!material.description.trim() || !quantityMilli || damagedMilli === null || damagedMilli < 0 || damagedMilli > quantityMilli) throw new Error('Revisa descripción, cantidad y envases dañados del material. No se contabiliza el alimento como envase roto.')
      if (costCents === null && material.costBs.trim()) throw new Error('El costo del material debe tener máximo dos decimales; si es desconocido deja el campo vacío.')
    }
    for (const cost of draft.costs) {
      if (cost.amountBs.trim() && decimalInputToScaledInteger(cost.amountBs, 100) === null) throw new Error('Los costos informativos deben tener máximo dos decimales.')
      if (cost.expenseId.trim() && !cost.sourceReference.trim()) throw new Error('Una referencia a Egresos requiere anotar su propósito para evitar doble contabilización.')
    }
    reconcileProcessingMass(allocationTotalG, draft.destinations.map(destination => ({ id: destination.id, netWeightG: gramsInput(destination.netWeightG) || 0 })))
    const payload: ConfirmProcessingBatchInput = {
      batchId: draft.batchId,
      processType: draft.processType,
      sourceProductId: selectedProduct.id,
      location: locationKey,
      inputWeightG: allocationTotalG,
      processingDate: draft.processingDate,
      note: draft.notes.trim().slice(0, 500),
      sourceAllocations: draft.sources.map(row => {
        const grams = kgInputToGrams(row.quantityKg)!
        return { lotId: row.lotId, quantity: grams / 1000, measuredNetWeightG: grams }
      }),
      destinations: draft.destinations.map(destination => {
        const netWeightG = gramsInput(destination.netWeightG)!
        if (destination.kind === 'discard') return { id: destination.id, kind: 'discard', commercialQuantity: 0, netWeightG, reason: destination.reason.trim() }
        const target = data.products.find(product => product.id === destination.productId)!
        return {
          id: destination.id, kind: destination.kind, productId: target.id, commercialUnit: target.unitType,
          commercialQuantity: Number(destination.commercialQuantity.replace(',', '.')), netWeightG,
          ...(destination.nominalWeightG && gramsInput(destination.nominalWeightG) ? { nominalWeightG: gramsInput(destination.nominalWeightG)! } : {}),
          lotCode: destination.lotCode.trim(), manufacturedOn: destination.manufacturedOn, packagedOn: destination.packagedOn, expiresOn: destination.expiresOn,
          weightBasis: target.unitType === 'kg' ? 'measured_total' : destination.weightBasis,
          ...(destination.reason.trim() ? { reason: destination.reason.trim() } : {}),
          ...(destination.kind === 'courtesy' ? { qualityConfirmed: destination.qualityConfirmed, qualityReason: destination.qualityReason.trim() } : {}),
        }
      }),
      packagingMaterials: draft.materials.map(material => ({
        id: material.id, description: material.description.trim(), quantityMilli: decimalInputToScaledInteger(material.quantity, 1000)!,
        damagedQuantityMilli: material.damaged.trim() ? decimalInputToScaledInteger(material.damaged, 1000)! : 0,
        costCents: material.costBs.trim() ? decimalInputToScaledInteger(material.costBs, 100)! : null,
        ...(material.expenseId.trim() ? { expenseId: material.expenseId.trim() } : {}),
      })) as ProcessingPackagingMaterial[],
      costComponents: draft.costs.map(cost => ({
        id: cost.id, kind: cost.kind, amountCents: cost.amountBs.trim() ? decimalInputToScaledInteger(cost.amountBs, 100)! : null,
        ...(cost.expenseId.trim() ? { expenseId: cost.expenseId.trim() } : {}), alreadyRecognizedAsOperatingExpense: Boolean(cost.expenseId.trim()),
        capitalizable: false, sourceReference: cost.sourceReference.trim(),
      })) as ProcessingCostComponent[],
    }
    return payload
  }

  const finishConfirmed = () => {
    localStorage.removeItem(draftKey(session.uid)); setSubmitState('confirmed'); setMessage(`Elaboración ${draft.batchId} confirmada por el servidor. El producto terminado continúa bloqueado para venta y despacho.`)
    setError(''); setDraft(freshDraft(fixedLocation, today)); setStep(0)
    void loadProcessingBatchPage(session.role === 'warehouse' ? locationKey : undefined).then(page => setHistory(page.rows)).catch(() => undefined)
  }
  const checkOperation = async () => {
    setError(''); setMessage('Consultando el estado definitivo en el servidor…')
    try {
      const state = await getProcessingOperationState(draft.operationId)
      if (state.status === 'confirmed') { finishConfirmed(); return }
      if (state.status === 'rejected') { setSubmitState('rejected'); setDraft(current => ({ ...current, operationPending: false })); setError(state.error); setMessage('El servidor rechazó esta elaboración. Corrige el borrador y vuelve a validarlo; se conservarán sus datos.') ; return }
      if (state.status === 'queued') { setSubmitState('unknown'); setMessage('La operación sigue en cola. No generes otra operación ni cambies el borrador; vuelve a comprobar más tarde.') ; return }
      setSubmitState('idle'); setDraft(current => ({ ...current, operationPending: false })); setMessage('El servidor no encuentra la operación. Puedes reenviar el mismo borrador con el mismo identificador.')
    } catch (reason) { setSubmitState('unknown'); setError(`No se pudo consultar el estado: ${(reason as Error).message}`); setMessage('Respuesta desconocida. Se conserva el mismo identificador para comprobar de nuevo.') }
  }
  const submit = async () => {
    if (submitLock.current || submitState === 'sending' || submitState === 'unknown') return
    setError(''); setMessage('')
    let payload: ConfirmProcessingBatchInput
    try { payload = validateAndBuildPayload() } catch (reason) { setError((reason as Error).message); return }
    if (warehouseNeedsAdmin) { setError('Este borrador incluye cortesía o descarte, que requieren confirmación de Administración. Se guardó solo en este dispositivo; no se envió al servidor ni reservó stock.'); return }
    const pendingDraft = { ...draft, operationPending: true }
    if (!persistDraft(session.uid, pendingDraft)) { setError('No se pudo guardar el identificador seguro en este dispositivo. No se envió la elaboración; libera espacio o habilita almacenamiento e inténtalo nuevamente.'); return }
    setDraft(pendingDraft)
    submitLock.current = true; setSubmitState('sending'); setMessage('Enviando para validación transaccional del servidor…')
    try {
      await confirmProcessingBatch(payload, draft.operationId)
      finishConfirmed()
    } catch (reason) {
      const errorMessage = (reason as Error).message || 'No se pudo confirmar la elaboración.'
      try {
        const status = await getProcessingOperationState(draft.operationId)
        if (status.status === 'confirmed') { finishConfirmed(); return }
        if (status.status === 'queued') { setSubmitState('unknown'); setMessage('Pendiente de comprobación. No vuelvas a registrarla; consulta el estado con el mismo identificador.'); setError(errorMessage); return }
        if (status.status === 'rejected') { setSubmitState('rejected'); setDraft(current => ({ ...current, operationPending: false })); setError(status.error); setMessage('El servidor rechazó la operación sin confirmarla. Puedes corregir el borrador.') ; return }
        setSubmitState('rejected'); setDraft(current => ({ ...current, operationPending: false })); setError(errorMessage); setMessage('No hay una operación guardada. El borrador y su identificador se conservan.')
      } catch {
        setSubmitState('unknown'); setError(errorMessage); setMessage('No se conoce el resultado. Conservamos el identificador; primero comprueba el estado antes de reintentar.')
      }
    } finally { submitLock.current = false }
  }
  const refreshHistory = async (more = false) => {
    setLoadingHistory(true); setHistoryError('')
    try {
      const sourceLocation = session.role === 'warehouse' ? locationKey : historyWarehouse === 'all' ? undefined : historyWarehouse === 'central' ? 'central' : `warehouse__${historyWarehouse}`
      const page = await loadProcessingBatchPage(sourceLocation, more ? historyCursor : null)
      setHistory(rows => more ? [...rows, ...page.rows] : page.rows); setHistoryCursor(page.cursor); setHistoryHasMore(page.hasMore)
    } catch (reason) { setHistoryError((reason as Error).message || 'No se pudo consultar el historial.') }
    finally { setLoadingHistory(false) }
  }
  const refreshReservations = async (more = false) => {
    setLoadingHistory(true); setHistoryError('')
    try {
      const location = session.role === 'warehouse' ? locationKey : historyWarehouse === 'all' ? undefined : historyWarehouse === 'central' ? 'central' : `warehouse__${historyWarehouse}`
      const page = await loadProcessingReservationPage(location, more ? reservationCursor : null)
      setReservations(rows => more ? [...rows, ...page.rows] : page.rows); setReservationCursor(page.cursor); setReservationsHasMore(page.hasMore)
    } catch (reason) { setHistoryError((reason as Error).message || 'No se pudieron consultar las reservas.') }
    finally { setLoadingHistory(false) }
  }

  const locationOptions = [{ id: 'central', name: 'Almacén central', active: true }, ...data.warehouses.filter(warehouse => warehouse.active)]
  const sourceProducts = data.products.filter(product => product.active && !product.deleted && product.unitType === 'kg' && data.lots.some(lot => isEligibleProcessingLot(lot, product.id, locationKey, today)))
  const destinationsProducts = data.products.filter(product => product.active && !product.deleted)

  return <Screen title="Sacheteado y Embolsado" subtitle="Registra el consumo real, los destinos físicos y el lote derivado. La confirmación y los cambios de stock ocurren únicamente en el servidor.">
    <div className="mb-3 grid grid-cols-2 gap-2">
      <button type="button" onClick={() => { setTab('new'); setSelectedBatch(null) }} className={`min-h-11 rounded-xl px-3 text-sm font-extrabold ${tab === 'new' ? 'bg-[var(--primary)] text-white' : 'border border-slate-200 bg-white text-slate-700'}`}>Nueva elaboración</button>
      <button type="button" onClick={() => { setTab('history'); setSelectedBatch(null) }} className={`min-h-11 rounded-xl px-3 text-sm font-extrabold ${tab === 'history' ? 'bg-[var(--primary)] text-white' : 'border border-slate-200 bg-white text-slate-700'}`}>Historial</button>
    </div>

    {tab === 'history' ? <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => { setHistoryMode('batches'); setSelectedBatch(null) }} className={`min-h-10 rounded-xl px-2 text-xs font-extrabold ${historyMode === 'batches' ? 'bg-slate-800 text-white' : 'border border-slate-200 bg-white'}`}>Elaboraciones</button><button type="button" onClick={() => { setHistoryMode('reservations'); setSelectedBatch(null) }} className={`min-h-10 rounded-xl px-2 text-xs font-extrabold ${historyMode === 'reservations' ? 'bg-slate-800 text-white' : 'border border-slate-200 bg-white'}`}>Reservados y pendientes</button></div>
      {session.role === 'admin' && <Field label="Filtrar por almacén"><SelectInput value={historyWarehouse} onChange={event => setHistoryWarehouse(event.target.value)}><option value="all">Todos los almacenes</option>{locationOptions.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</SelectInput></Field>}
      {historyMode === 'reservations' ? <>
        {loadingHistory && reservations.length === 0 ? <LoadingState label="Consultando reservas activas e históricas…" /> : historyError ? <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{historyError}<button type="button" className="ml-2 font-bold underline" onClick={() => void refreshReservations()}>Reintentar</button></div> : reservations.length === 0 ? <EmptyBlock title="Sin reservas ni pendientes registrados" description="Una reserva conserva producto físico, pero lo mantiene fuera de venta hasta un flujo autorizado." /> : <div className="space-y-2">{reservations.map(reservation => <article key={reservation.id} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h3 className="break-words text-sm font-extrabold">{reservation.productName}</h3><p className="mt-1 text-xs text-slate-600">Lote {reservation.lotCode} · {reservation.location === 'central' ? 'Almacén central' : reservation.location}</p></div><span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-900">{reservation.status === 'partially_consumed' ? 'PARCIALMENTE CONSUMIDO' : reservation.status === 'active' ? 'ACTIVA' : reservation.status.toUpperCase()}</span></div><p className="mt-2 text-xs">Motivo: <b>{reservation.purpose === 'courtesy' ? 'Reservado para cortesía' : reservation.purpose === 'repack_pending' ? 'Pendiente de reenvasado' : 'Inmovilizado para revisión'}</b></p><p className="mt-1 text-xs">Restante: <b>{reservation.remainingQuantity} {reservation.unitType}</b>{reservation.remainingWeightG == null ? ' · peso físico no registrado' : ` · ${reservation.remainingWeightG} g`}{reservation.remainingCostCents == null ? ' · costo no disponible' : ` · costo Bs ${(reservation.remainingCostCents / 100).toFixed(2)}`}</p><p className="mt-1 text-[10px] text-slate-500">Creada {formatDateTime(reservation.createdAt)} · {reservation.createdByName} · {reservation.source}</p><p className="mt-2 rounded-lg bg-slate-50 p-2 text-[11px] font-semibold text-slate-600">Esta pantalla es de consulta. No liberes ni marques como vendible una reserva de reenvasado o revisión sin el procedimiento autorizado.</p></article>)}{reservationsHasMore && <SecondaryButton full disabled={loadingHistory} onClick={() => void refreshReservations(true)}>Cargar más reservas</SecondaryButton>}<SecondaryButton full disabled={loadingHistory} onClick={() => void refreshReservations()}><RefreshCw size={15} />Actualizar reservas</SecondaryButton></div>}
      </> : selectedBatch ? <SectionCard title="Detalle de elaboración" action={<SecondaryButton onClick={() => setSelectedBatch(null)}>Volver al historial</SecondaryButton>}>
        <BatchDetail batch={selectedBatch} products={data.products} locations={locationOptions} />
      </SectionCard> : <>
        {loadingHistory && history.length === 0 ? <LoadingState label="Consultando últimas elaboraciones…" /> : historyError ? <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{historyError}<button type="button" className="ml-2 font-bold underline" onClick={() => void refreshHistory()}>Reintentar</button></div> : history.length === 0 ? <EmptyBlock title="Todavía no hay elaboraciones" description="Las elaboraciones confirmadas aparecerán aquí. Los borradores locales no se mezclan con el historial del servidor." /> : <div className="space-y-2">
          {history.map(batch => <button key={batch.id} type="button" onClick={() => setSelectedBatch(batch)} className="w-full min-w-0 rounded-2xl border border-slate-200 bg-white p-3 text-left hover:border-slate-300">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-extrabold text-slate-900">{batch.sourceProductName || data.products.find(product => product.id === batch.sourceProductId)?.name || batch.sourceProductId}</span><span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-800">CONFIRMADA · venta bloqueada</span></div>
            <p className="mt-1 text-xs text-slate-600">{formatDateTime(batch.confirmedAt || batch.createdAt)} · {formatKgFromGrams(batch.inputWeightG)} · {batch.responsibleName}</p>
            <p className="mt-1 break-all text-[10px] text-slate-400">Elaboración {batch.id}</p>
          </button>)}
          {historyHasMore && <SecondaryButton full disabled={loadingHistory} onClick={() => void refreshHistory(true)}>{loadingHistory ? 'Cargando…' : 'Cargar más'}</SecondaryButton>}
          <SecondaryButton full disabled={loadingHistory} onClick={() => void refreshHistory()}><RefreshCw size={15} />Actualizar</SecondaryButton>
        </div>}
      </>}
    </div> : <div className="space-y-3">
      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1 sm:grid-cols-4">
        {['Origen', 'Producción', 'Materiales', 'Confirmación'].map((label, index) => <button key={label} type="button" onClick={() => setStep(index)} aria-current={step === index ? 'step' : undefined} className={`min-h-10 rounded-xl px-1 text-[11px] font-extrabold ${step === index ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{index + 1}. {label}</button>)}
      </div>

      {message && <div role="status" className={`rounded-2xl border p-3 text-sm ${submitState === 'confirmed' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-sky-200 bg-sky-50 text-sky-900'}`}>{message}{submitState === 'confirmed' && <button type="button" className="mt-2 block min-h-10 font-extrabold underline" onClick={() => { setDraft(freshDraft(fixedLocation, today)); setSubmitState('idle'); setMessage(''); setError(''); setStep(0) }}>Iniciar otra elaboración</button>}</div>}
      {error && <div role="alert" className="flex gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-900"><AlertTriangle className="mt-0.5 shrink-0" size={17} /><span>{error}</span></div>}
      {submitState === 'unknown' && <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><b>Resultado pendiente de comprobación.</b> El borrador no se puede editar ni enviar con un ID distinto.<div className="mt-2"><PrimaryButton onClick={() => void checkOperation()}><RefreshCw size={16} />Comprobar estado</PrimaryButton></div></div>}

      {step === 0 && <SectionCard title="Paso 1 · Producto de origen y lotes">
        <div className="space-y-3">
          {canAdmin ? <Field label="Almacén de origen" required><SelectInput value={draft.location} onChange={event => editDraft(current => ({ ...current, location: event.target.value, sourceProductId: '', sources: [] }))}>{locationOptions.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</SelectInput></Field> : <div className="rounded-xl bg-slate-50 p-3 text-sm"><b>Almacén asignado:</b> {data.warehouses.find(item => item.id === fixedLocation)?.name || (fixedLocation === 'central' ? 'Almacén central' : fixedLocation)}</div>}
          <Field label="Tipo de proceso"><SelectInput value={draft.processType} onChange={event => editDraft(current => ({ ...current, processType: event.target.value as Draft['processType'] }))}><option value="bagging">Sacheteado y embolsado</option><option value="portioning">Porcionado</option><option value="repackaging">Reenvasado dentro de elaboración</option></SelectInput></Field>
          <Field label="Producto a granel · unidad kg" required hint="Solo aparecen SKU con lotes elegibles. El servidor vuelve a comprobar stock, lote y vencimiento al confirmar."><SelectInput value={draft.sourceProductId} onChange={event => setSourceProduct(event.target.value)}><option value="">Selecciona producto</option>{sourceProducts.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</SelectInput></Field>
          {selectedProduct && <div className="grid grid-cols-2 gap-2"><div className="rounded-xl border border-slate-200 p-3"><p className="text-[10px] font-black uppercase text-slate-500">Existencia física</p><p className="mt-1 font-black tabular-nums">{(stock?.physical || 0).toFixed(3)} kg</p></div><div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"><p className="text-[10px] font-black uppercase text-emerald-800">Disponible para procesar</p><p className="mt-1 font-black tabular-nums text-emerald-900">{(stock?.available || 0).toFixed(3)} kg</p></div></div>}
          {selectedProduct && <div className="space-y-2"><p className="text-[11px] font-extrabold text-slate-600">Lotes elegibles (vence primero)</p>{eligibleLots.length === 0 ? <EmptyBlock title="Sin lotes elegibles" description="Se excluyen lotes vencidos, sintéticos, en cuarentena, bloqueados o con origen físico pendiente." /> : eligibleLots.map(lot => {
            const selected = selectedLotIds.has(lot.id); const row = draft.sources.find(source => source.lotId === lot.id)
            return <div key={lot.id} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-[auto_minmax(0,1fr)_minmax(150px,190px)]">
              <input type="checkbox" aria-label={`Seleccionar lote ${lot.lotCode}`} checked={selected} onChange={event => event.target.checked ? addSource(lot) : removeSource(lot.id)} className="mt-1 h-5 w-5 accent-[var(--primary)]" />
              <div className="min-w-0"><p className="break-words text-sm font-extrabold">{lot.lotCode}</p><p className="text-[11px] text-slate-500">Elab. {lot.manufacturedOn} · Vence {lot.expiresOn} · {lot.productionCost == null ? 'Costo no disponible' : `Costo histórico Bs ${lot.productionCost.toFixed(2)}`}</p><p className="mt-1 text-xs font-bold">Físico {lotAvailableQuantity(lot, locationKey).toFixed(3)} kg disponible</p></div>
              {selected && <Field label="Kg reales utilizados" required hint="Máximo 3 decimales"><NumberInput min="0.001" max={lotAvailableQuantity(lot, locationKey)} step="0.001" inputMode="decimal" value={row?.quantityKg || ''} onChange={event => editDraft(current => ({ ...current, sources: current.sources.map(source => source.lotId === lot.id ? { ...source, quantityKg: event.target.value } : source) }))} placeholder="0,000" /></Field>}
            </div>
          })}</div>}
          <Field label="Fecha del proceso" required><TextInput type="date" max={today} value={draft.processingDate} onChange={event => editDraft(current => ({ ...current, processingDate: event.target.value }))} /></Field>
          <p className="rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-900">No se permite usar paquetes o unidades como materia prima en esta fase. La suma de las asignaciones de lote debe coincidir con los gramos medidos de entrada.</p>
        </div>
      </SectionCard>}

      {step === 1 && <SectionCard title="Paso 2 · Producción y destinos físicos" action={<SecondaryButton onClick={() => editDraft(current => ({ ...current, destinations: [...current.destinations, freshDestination(today)] }))}><Plus size={15} />Añadir salida</SecondaryButton>}>
        <div className="mb-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-950"><b>El peso nominal es informativo.</b> Registra el peso neto total realmente medido; no se calcula desde el catálogo ni desde el nominal.</div>
        <div className="space-y-3">{draft.destinations.map((destination, index) => {
          const target = destinationsProducts.find(product => product.id === destination.productId)
          return <article key={destination.id} className="min-w-0 rounded-2xl border border-slate-200 p-3">
            <div className="mb-2 flex items-center justify-between gap-2"><h3 className="text-sm font-extrabold">Destino {index + 1}</h3>{draft.destinations.length > 1 && <button type="button" aria-label="Quitar destino" onClick={() => editDraft(current => ({ ...current, destinations: current.destinations.filter(row => row.id !== destination.id) }))} className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-rose-700"><Trash2 size={16} /></button>}</div>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <Field label="Destino físico" required><SelectInput value={destination.kind} onChange={event => updateDestination(destination.id, { kind: event.target.value as ProcessingDestinationKind, productId: event.target.value === 'discard' ? '' : destination.productId })}>{Object.entries(labelKind).filter(([key]) => key !== 'other').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</SelectInput></Field>
              {destination.kind !== 'discard' && <Field label="SKU terminado existente" required><SelectInput value={destination.productId} onChange={event => updateDestination(destination.id, { productId: event.target.value, commercialQuantity: '' })}><option value="">Selecciona SKU</option>{destinationsProducts.map(product => <option key={product.id} value={product.id}>{product.name} · {product.unitType}</option>)}</SelectInput></Field>}
              {destination.kind !== 'discard' && <Field label={`Cantidad comercial ${target ? `(${target.unitType})` : ''}`} required hint={target?.unitType === 'kg' ? 'Debe coincidir exactamente con los gramos netos.' : 'Paquetes/unidades enteros; no se infiere su peso.'}><NumberInput min="0" step={target?.unitType === 'kg' ? '0.001' : '1'} value={destination.commercialQuantity} onChange={event => updateDestination(destination.id, { commercialQuantity: event.target.value })} placeholder={target?.unitType === 'kg' ? '0,000' : '0'} /></Field>}
              <Field label="Peso neto real medido (g)" required><NumberInput min="1" step="1" value={destination.netWeightG} onChange={event => updateDestination(destination.id, { netWeightG: event.target.value })} placeholder="Ej. 9000" /></Field>
              {destination.kind !== 'discard' && <Field label="Peso nominal (g, informativo)"><NumberInput min="1" step="1" value={destination.nominalWeightG} onChange={event => updateDestination(destination.id, { nominalWeightG: event.target.value })} placeholder="Ej. 250" /></Field>}
              {destination.kind !== 'discard' && <Field label="Lote nuevo" required><TextInput maxLength={80} value={destination.lotCode} onChange={event => updateDestination(destination.id, { lotCode: event.target.value })} placeholder="Código de lote" /></Field>}
              {destination.kind !== 'discard' && <Field label="Fecha de elaboración" required><TextInput type="date" max={today} value={destination.manufacturedOn} onChange={event => updateDestination(destination.id, { manufacturedOn: event.target.value })} /></Field>}
              {destination.kind !== 'discard' && <Field label="Fecha de embolsado" required><TextInput type="date" max={today} value={destination.packagedOn} onChange={event => updateDestination(destination.id, { packagedOn: event.target.value })} /></Field>}
              {destination.kind !== 'discard' && <Field label="Vencimiento" required hint="El servidor no permitirá superar el lote de origen más conservador."><TextInput type="date" value={destination.expiresOn} onChange={event => updateDestination(destination.id, { expiresOn: event.target.value })} /></Field>}
              {target && target.unitType !== 'kg' && <Field label="Base del peso real" required><SelectInput value={destination.weightBasis} onChange={event => updateDestination(destination.id, { weightBasis: event.target.value as ProcessingWeightBasis })}><option value="measured_total">Peso total medido</option><option value="documented_average">Promedio documentado</option></SelectInput></Field>}
              {['courtesy', 'repack_pending', 'review_hold', 'discard'].includes(destination.kind) && <Field label="Motivo / condición" required><TextArea value={destination.reason} onChange={event => updateDestination(destination.id, { reason: event.target.value })} placeholder={destination.kind === 'discard' ? 'Motivo del descarte real' : 'Por qué se separa este producto'} /></Field>}
              {destination.kind === 'courtesy' && <div className="sm:col-span-2 rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-bold text-amber-950">Reservado para cortesía; no se puede vender ni liberar desde esta pantalla.</p>{canAdmin ? <><label className="mt-2 flex min-h-11 items-center gap-2 text-xs font-bold"><input type="checkbox" checked={destination.qualityConfirmed} onChange={event => updateDestination(destination.id, { qualityConfirmed: event.target.checked })} />Confirmo aptitud para cortesía</label><Field label="Motivo de aptitud" required><TextArea value={destination.qualityReason} onChange={event => updateDestination(destination.id, { qualityReason: event.target.value })} /></Field></> : <p className="mt-2 text-xs">Solo Administración puede confirmar la aptitud. Guarda el borrador para que lo revise; todavía no se envía.</p>}</div>}
              {destination.kind === 'discard' && !canAdmin && <div className="sm:col-span-2 rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-900">El descarte requiere confirmación directa de Administración. Este formulario queda como borrador local sin cambios de stock.</div>}
            </div>
          </article>
        })}</div>
      </SectionCard>}

      {step === 2 && <div className="space-y-3">
        <SectionCard title="Paso 3 · Bolsas y materiales">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-600">Envases dañados se registran aparte; no significan pérdida de alimento.</p><SecondaryButton onClick={() => editDraft(current => ({ ...current, materials: [...current.materials, { id: randomId('material'), description: '', quantity: '', damaged: '0', costBs: '', expenseId: '' }] }))}><Plus size={15} />Añadir material</SecondaryButton></div>
          {draft.materials.length === 0 ? <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">No se agregaron materiales. Las bolsas rotas no generan merma alimentaria automáticamente.</p> : <div className="space-y-3">{draft.materials.map(material => <article key={material.id} className="grid min-w-0 gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-2">
            <Field label="Material"><TextInput value={material.description} onChange={event => editDraft(current => ({ ...current, materials: current.materials.map(row => row.id === material.id ? { ...row, description: event.target.value } : row) }))} placeholder="Bolsa, etiqueta…" /></Field>
            <div className="grid grid-cols-2 gap-2"><Field label="Usado"><NumberInput step="0.001" min="0.001" value={material.quantity} onChange={event => editDraft(current => ({ ...current, materials: current.materials.map(row => row.id === material.id ? { ...row, quantity: event.target.value } : row) }))} /></Field><Field label="Dañado"><NumberInput step="0.001" min="0" value={material.damaged} onChange={event => editDraft(current => ({ ...current, materials: current.materials.map(row => row.id === material.id ? { ...row, damaged: event.target.value } : row) }))} /></Field></div>
            <Field label="Costo conocido (Bs, opcional)"><NumberInput step="0.01" min="0" value={material.costBs} onChange={event => editDraft(current => ({ ...current, materials: current.materials.map(row => row.id === material.id ? { ...row, costBs: event.target.value } : row) }))} placeholder="Costo no disponible" /></Field>
            <Field label="Referencia a egreso existente (opcional)"><TextInput value={material.expenseId} onChange={event => editDraft(current => ({ ...current, materials: current.materials.map(row => row.id === material.id ? { ...row, expenseId: event.target.value } : row) }))} placeholder="ID del egreso" /></Field>
            <button type="button" onClick={() => editDraft(current => ({ ...current, materials: current.materials.filter(row => row.id !== material.id) }))} className="min-h-10 justify-self-start text-xs font-bold text-rose-700">Quitar material</button>
          </article>)}</div>}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-600">Costos de elaboración no se capitalizan ni alteran Resultado en esta fase.</p><SecondaryButton onClick={() => editDraft(current => ({ ...current, costs: [...current.costs, { id: randomId('cost'), kind: 'labor', amountBs: '', expenseId: '', sourceReference: '' }] }))}><Plus size={15} />Añadir costo informativo</SecondaryButton></div>
          {draft.costs.map(cost => <div key={cost.id} className="mt-2 grid min-w-0 gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-2">
            <Field label="Tipo"><SelectInput value={cost.kind} onChange={event => editDraft(current => ({ ...current, costs: current.costs.map(row => row.id === cost.id ? { ...row, kind: event.target.value as CostDraft['kind'] } : row) }))}><option value="labor">Mano de obra</option><option value="packaging">Empaque</option><option value="other">Otro</option><option value="source_inventory">Inventario de origen (informativo)</option></SelectInput></Field>
            <Field label="Costo Bs (opcional)"><NumberInput min="0" step="0.01" value={cost.amountBs} onChange={event => editDraft(current => ({ ...current, costs: current.costs.map(row => row.id === cost.id ? { ...row, amountBs: event.target.value } : row) }))} placeholder="No disponible" /></Field>
            <Field label="ID de egreso existente (opcional)"><TextInput value={cost.expenseId} onChange={event => editDraft(current => ({ ...current, costs: current.costs.map(row => row.id === cost.id ? { ...row, expenseId: event.target.value } : row) }))} /></Field>
            <Field label="Referencia"><TextInput value={cost.sourceReference} onChange={event => editDraft(current => ({ ...current, costs: current.costs.map(row => row.id === cost.id ? { ...row, sourceReference: event.target.value } : row) }))} /></Field>
            <button type="button" onClick={() => editDraft(current => ({ ...current, costs: current.costs.filter(row => row.id !== cost.id) }))} className="min-h-10 justify-self-start text-xs font-bold text-rose-700">Quitar costo</button>
          </div>)}
        </SectionCard>
        <SectionCard title="Observaciones"><TextArea maxLength={500} value={draft.notes} onChange={event => editDraft(current => ({ ...current, notes: event.target.value }))} placeholder="Observaciones del proceso (no sustituyen pesajes ni aprobaciones)" /></SectionCard>
      </div>}

      {step === 3 && <div className="space-y-3">
        <SectionCard title="Paso 4 · Revisar y confirmar">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Metric label="Entrada real" value={formatKgFromGrams(inputWeightG)} /><Metric label="Destinos físicos" value={formatKgFromGrams(outputWeightG)} /><Metric label="Diferencia" value={`${massDifferenceG > 0 ? '+' : ''}${massDifferenceG} g`} tone={massDifferenceG === 0 ? 'ok' : 'bad'} /><Metric label="Almacén" value={locationOptions.find(item => item.id === location)?.name || location} /></div>
          <div className="mt-3 space-y-2">{draft.sources.map(source => { const lot = data.lots.find(item => item.id === source.lotId); return <div key={source.lotId} className="flex min-w-0 justify-between gap-2 rounded-xl bg-slate-50 p-3 text-xs"><span className="min-w-0 break-words"><b>{lot?.productName || selectedProduct?.name}</b> · lote <b>{lot?.lotCode || source.lotId}</b><br /><span className="text-slate-500">Asignación contable del proceso; no es identificación física individual verificada.</span></span><b className="shrink-0 tabular-nums">{source.quantityKg || '0'} kg</b></div>})}</div>
          <div className="mt-3 space-y-2">{draft.destinations.map(destination => { const product = data.products.find(item => item.id === destination.productId); return <div key={destination.id} className="flex min-w-0 justify-between gap-2 rounded-xl border border-slate-200 p-3 text-xs"><span className="min-w-0 break-words"><b>{product?.name || labelKind[destination.kind]}</b> · {labelKind[destination.kind]}<br />{destination.kind !== 'discard' ? `Lote ${destination.lotCode || 'sin completar'} · ${destination.commercialQuantity || '0'} ${product?.unitType || ''}` : `Motivo: ${destination.reason || 'pendiente'}`}</span><b className="shrink-0 tabular-nums">{destination.netWeightG || '0'} g</b></div>})}</div>
          {massError ? <p role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-900">{massError}{Math.abs(massDifferenceG) === 1 ? ' La diferencia de 1 g bloquea la confirmación; no se redondea.' : ''}</p> : <p className="mt-3 flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-900"><CheckCircle2 size={17} />Masa conciliada exactamente: 0 g de diferencia.</p>}
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-950">Los lotes derivados permanecerán bloqueados para venta y despacho hasta una integración comercial posterior. Materiales y costos auxiliares son informativos; no se capitalizan ni alteran Egresos o Resultado.</p>
          <Field label="Notas del proceso"><TextArea value={draft.notes} onChange={event => editDraft(current => ({ ...current, notes: event.target.value }))} /></Field>
        </SectionCard>
        <SectionCard title="Identificadores y borrador local">
          <p className="break-all text-[11px] text-slate-500">Elaboración: {draft.batchId}<br />Operación: {draft.operationId}</p>
          <div className="mt-2 flex flex-wrap gap-2"><SecondaryButton onClick={() => { if (persistDraft(session.uid, draft)) setMessage('Borrador guardado solo en este dispositivo. No reservó ni consumió stock.'); else setError('No se pudo guardar el borrador en este dispositivo.') }}><Save size={15} />Guardar borrador</SecondaryButton><span className="self-center text-[11px] font-semibold text-slate-500">El borrador no cambia inventario. Se vuelve a validar contra los lotes actuales al confirmar.</span></div>
        </SectionCard>
        {warehouseNeedsAdmin && <div role="status" className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">Esta elaboración contiene una cortesía o descarte que debe confirmar Administración. El borrador permanece local; no hay solicitud de aprobación enviada.</div>}
        <div className="grid gap-2 sm:grid-cols-2"><SecondaryButton full onClick={() => setStep(2)}><ChevronLeft size={16} />Volver</SecondaryButton><PrimaryButton full disabled={Boolean(massError) || warehouseNeedsAdmin || submitState === 'sending' || submitState === 'unknown' || submitState === 'confirmed'} onClick={() => void submit()}>{submitState === 'sending' ? 'Esperando servidor…' : submitState === 'confirmed' ? 'Confirmada' : <><ShieldCheck size={16} />Confirmar elaboración</>}</PrimaryButton></div>
      </div>}

      {step < 3 && <div className="grid grid-cols-2 gap-2"><SecondaryButton full disabled={step === 0} onClick={() => setStep(value => Math.max(0, value - 1))}><ChevronLeft size={16} />Anterior</SecondaryButton><PrimaryButton full onClick={() => setStep(value => Math.min(3, value + 1))}>Continuar<ChevronRight size={16} /></PrimaryButton></div>}
      <p className="text-center text-[10px] font-semibold text-slate-400">Borrador local · ID estable {draft.batchId}</p>
    </div>}
  </Screen>
}

function Metric({ label, value, tone = 'normal' }: { label: string; value: string; tone?: 'normal' | 'ok' | 'bad' }) {
  return <div className={`min-w-0 rounded-xl border p-3 ${tone === 'ok' ? 'border-emerald-200 bg-emerald-50' : tone === 'bad' ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-white'}`}><p className="text-[10px] font-black uppercase text-slate-500">{label}</p><p className="mt-1 break-words text-sm font-black tabular-nums">{value}</p></div>
}

function BatchDetail({ batch, products, locations }: { batch: ProcessingBatch; products: DistProduct[]; locations: Array<{ id: string; name: string }> }) {
  const sourceProduct = products.find(product => product.id === batch.sourceProductId)
  const locationName = locations.find(location => (location.id === 'central' ? 'central' : `warehouse__${location.id}`) === batch.sourceLocation)?.name || batch.sourceLocation
  return <div className="space-y-3">
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Metric label="Estado" value="Confirmada" tone="ok" /><Metric label="Fecha" value={formatDateTime(batch.confirmedAt || batch.createdAt)} /><Metric label="Origen" value={`${batch.inputWeightG} g`} /><Metric label="Costo origen" value={batch.sourceCostCents == null ? 'Costo no disponible' : `Bs ${(batch.sourceCostCents / 100).toFixed(2)}`} /></div>
    <p className="text-xs text-slate-600"><b>{sourceProduct?.name || batch.sourceProductName}</b> · {locationName} · responsable {batch.responsibleName} · tipo {batch.processType}</p>
    <SectionCard title="Lotes de origen">{batch.sourceAllocations.map((allocation, index) => <div key={`${allocation.lotId}-${index}`} className="border-b border-slate-100 py-2 text-xs"><b>{allocation.lotCode || allocation.lotId}</b> · {formatKgFromGrams(allocation.measuredNetWeightG)} · {allocation.historicalCostCents == null ? 'Costo no disponible' : `Costo Bs ${(allocation.historicalCostCents / 100).toFixed(2)}`}<p className="mt-1 text-[10px] text-slate-500">La distribución de lotes es una referencia contable de la elaboración; no identifica físicamente cada paquete producido.</p></div>)}</SectionCard>
    <SectionCard title="Destinos">{batch.destinations.map(destination => <div key={destination.id} className="border-b border-slate-100 py-2 text-xs"><b>{products.find(product => product.id === destination.productId)?.name || labelKind[destination.kind]}</b> · {labelKind[destination.kind]}<br />Lote {destination.lotCode || '—'} · {destination.commercialQuantity || 0} {destination.commercialUnit || ''} · {destination.netWeightG} g · costo {destination.costCents == null ? 'no disponible' : `Bs ${(destination.costCents / 100).toFixed(2)}`}{destination.kind === 'courtesy' ? <p>Reservado para cortesía; aptitud: {destination.qualityReason || 'confirmada por Administración'}</p> : null}{destination.kind === 'discard' ? <p>Descarte real: {destination.reason} · efecto económico según costo histórico disponible.</p> : null}</div>)}</SectionCard>
    <SectionCard title="Materiales y notas">{batch.packagingMaterials.length ? batch.packagingMaterials.map(material => <p key={material.id} className="py-1 text-xs">{material.description || 'Material'} · {(material.quantityMilli / 1000).toFixed(3)} usados · {(material.damagedQuantityMilli / 1000).toFixed(3)} dañados · {material.costCents == null ? 'Costo no disponible' : `Bs ${(material.costCents / 100).toFixed(2)} informativo`}</p>) : <p className="text-xs text-slate-500">Sin materiales registrados.</p>}<p className="mt-2 text-xs"><b>Observación:</b> {batch.note || 'Sin observaciones.'}</p><p className="mt-2 break-all text-[10px] text-slate-500">ID de elaboración: {batch.id} · operación: {batch.operationId}</p></SectionCard>
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-950">Las existencias derivadas continúan bloqueadas comercialmente. No uses este historial como un movimiento adicional al Kardex.</div>
  </div>
}
