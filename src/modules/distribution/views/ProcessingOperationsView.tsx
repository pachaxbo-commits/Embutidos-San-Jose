import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, RefreshCw, ShieldCheck } from 'lucide-react'
import { Field, NumberInput, SelectInput, TextArea, TextInput } from '../../../components/ui/Form'
import { EmptyBlock, LoadingState } from '../../../components/ui/Screen'
import type { ProcessingEvidenceRecord, ProcessingQualityAuthorization, ProcessingRepackRecord, ProcessingReservation, ProcessingReviewRecord, RepackOperationInput, RecordProcessingReviewInput } from '../domain/processing'
import { validateRepackOperationContract } from '../domain/processing'
import { confirmProcessingRepack, getProcessingOperationState, loadMyProcessingQualityAuthorization, loadProcessingEvidenceForReservation, loadProcessingQualityAuthorizationFor, loadProcessingRepackPage, loadProcessingReservationPage, loadProcessingReview, loadProcessingReviewPage, newOperationId, recordProcessingReview, uploadProcessingEvidence, type ProcessingBatchPage } from '../data/distributionRepository'
import type { DistLot, DistProduct } from '../types'
import type { DistributionSession } from './DistributionApp'
import { PrimaryButton, SecondaryButton, SectionCard } from './shared'
import { ProcessingGuide } from './ProcessingGuide'
import { recordErrorDiagnostic } from '../../../lib/errorDiagnostics'

type Mode = 'reservations' | 'review' | 'repack' | 'history-reviews' | 'history-repackings'
type Cursor = ProcessingBatchPage['cursor']
type Props = { mode: Mode; session: DistributionSession; products: DistProduct[]; lots: DistLot[]; locationOptions: Array<{ id: string; name: string }> }
type ReviewAction = RecordProcessingReviewInput['action']
type ReviewDraft = { action: ReviewAction; packageCondition: RecordProcessingReviewInput['packageCondition']; productObservation: RecordProcessingReviewInput['productObservation']; physicalWeightG: string; recoverableWeightG: string; discardWeightG: string; dispositionOutcome: NonNullable<RecordProcessingReviewInput['dispositionOutcome']>; observations: string; reason: string; evidenceRefs: string[]; operationId: string; expectedRevision: number; operationPending?: boolean }
type OutputDraft = { id: string; productId: string; commercialQuantity: string; measuredNetWeightG: string; lotCode: string; manufacturedOn: string; packagedOn: string; expiresOn: string }
type MaterialDraft = { materialId: string; quantity: string; damaged: string; costBs: string }
type RepackDraft = { repackId: string; operationId: string; sourceReservationId: string; openedCommercialQuantity: string; openedPhysicalWeightG: string; outputs: OutputDraft[]; materials: MaterialDraft[]; reason: string; operationPending?: boolean }
type SubmitState = 'idle' | 'sending' | 'unknown' | 'rejected' | 'confirmed'

const todayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const localKey = (uid: string) => `sanjose_processing_repack_draft_v1:${uid}`
const freshOutput = (today: string): OutputDraft => ({ id: newOperationId('repack_output'), productId: '', commercialQuantity: '', measuredNetWeightG: '', lotCode: '', manufacturedOn: today, packagedOn: today, expiresOn: '' })
const reviewKey = (uid: string, reservationId: string) => `sanjose_processing_review_draft_v1:${uid}:${reservationId}`
const blankReview = (expectedRevision = 0): ReviewDraft => ({ action: 'record_observation', packageCondition: 'unknown', productObservation: 'not_assessed', physicalWeightG: '', recoverableWeightG: '', discardWeightG: '', dispositionOutcome: 'undetermined', observations: '', reason: '', evidenceRefs: [], operationId: newOperationId('processing_review'), expectedRevision })
const readReviewDraft = (uid: string, reservationId: string): ReviewDraft | null => {
  try {
    const raw = localStorage.getItem(reviewKey(uid, reservationId))
    const parsed = raw ? JSON.parse(raw) as ReviewDraft : null
    return parsed?.operationId && Number.isSafeInteger(parsed.expectedRevision) && Array.isArray(parsed.evidenceRefs) ? parsed : null
  } catch { return null }
}
const statusLabel: Record<string, string> = { pending_review: 'Pendiente de revisión', in_review: 'Revisión iniciada', authorized_for_repack: 'Autorizado para procedimiento', not_recoverable: 'No recuperable', pending_information: 'Información pendiente', pending_economic_disposition: 'Disposición económica pendiente', resolved_specialized: 'Procesado' }
const dispositionLabel: Record<string, string> = { recoverable: 'recuperable propuesto', partially_recoverable: 'parcialmente recuperable propuesto', discard_pending: 'descarte pendiente propuesto', undetermined: 'destino indeterminado' }
const purposeLabel: Record<string, string> = { repack_pending: 'Pendiente de reenvasado', review_hold: 'Inmovilizado para revisión', courtesy: 'Reservado para cortesía' }
const dateTime = (value?: string) => value ? new Intl.DateTimeFormat('es-BO', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/La_Paz' }).format(new Date(value)) : '—'
const formatQty = (value: number, unit: string) => `${new Intl.NumberFormat('es-BO', { maximumFractionDigits: unit === 'kg' ? 3 : 0 }).format(value)} ${unit}`
const money = (cents: number | null | undefined) => cents == null ? 'Costo no disponible' : `Bs ${(cents / 100).toFixed(2)}`
const initialRepackDraft = (uid: string): RepackDraft => {
  try {
    const raw = localStorage.getItem(localKey(uid))
    const parsed = raw ? JSON.parse(raw) as RepackDraft : null
    if (parsed?.repackId && parsed.operationId && parsed.sourceReservationId && Array.isArray(parsed.outputs) && Array.isArray(parsed.materials)) return parsed
  } catch { /* Continue with a new local draft. */ }
  return { repackId: newOperationId('processing_repack'), operationId: newOperationId('processing_repack_operation'), sourceReservationId: '', openedCommercialQuantity: '', openedPhysicalWeightG: '', outputs: [freshOutput(todayKey())], materials: [], reason: '' }
}

export function ProcessingOperationsView({ mode, session, products, lots, locationOptions }: Props) {
  const [reservations, setReservations] = useState<ProcessingReservation[]>([])
  const [reservationCursor, setReservationCursor] = useState<Cursor>(null)
  const [reservationHasMore, setReservationHasMore] = useState(false)
  const [reviewRows, setReviewRows] = useState<ProcessingReviewRecord[]>([])
  const [reviewCursor, setReviewCursor] = useState<Cursor>(null)
  const [reviewHasMore, setReviewHasMore] = useState(false)
  const [repackRows, setRepackRows] = useState<ProcessingRepackRecord[]>([])
  const [repackCursor, setRepackCursor] = useState<Cursor>(null)
  const [repackHasMore, setRepackHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedReservationId, setSelectedReservationId] = useState('')
  const [selectedReview, setSelectedReview] = useState<ProcessingReviewRecord | null>(null)
  const [evidence, setEvidence] = useState<ProcessingEvidenceRecord[]>([])
  const [authorization, setAuthorization] = useState<ProcessingQualityAuthorization | null>(null)
  const [reviewerAuthorization, setReviewerAuthorization] = useState<ProcessingQualityAuthorization | null>(null)
  const [reviewDraft, setReviewDraft] = useState<ReviewDraft>(() => blankReview())
  const [reviewState, setReviewState] = useState<SubmitState>('idle')
  const [reviewMessage, setReviewMessage] = useState('')
  const [reviewBusy, setReviewBusy] = useState(false)
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null)
  const [evidenceType, setEvidenceType] = useState<'photo' | 'measurement_record' | 'signed_quality_record'>('photo')
  const [evidenceBusy, setEvidenceBusy] = useState(false)
  const [evidenceMessage, setEvidenceMessage] = useState('')
  const [evidenceRetry, setEvidenceRetry] = useState(false)
  const evidenceRequest = useRef<{ file: File; evidenceId: string; operationId: string } | null>(null)
  const [repackDraft, setRepackDraft] = useState<RepackDraft>(() => initialRepackDraft(session.uid))
  const [repackStep, setRepackStep] = useState(0)
  const [repackState, setRepackState] = useState<SubmitState>(() => repackDraft.operationPending ? 'unknown' : 'idle')
  const [repackMessage, setRepackMessage] = useState('')
  const [repackError, setRepackError] = useState('')
  const submitLock = useRef(false)
  const reviewSelectionRevision = useRef(0)
  const selectedReservationIdRef = useRef('')
  const canAdmin = session.role === 'admin'
  const warehouseLocation = session.warehouseId && session.warehouseId !== 'central' ? `warehouse__${session.warehouseId}` : 'central'
  const locationFilter = session.role === 'warehouse' ? warehouseLocation : undefined
  const selectedReservation = reservations.find(row => row.id === selectedReservationId) || null
  const selectedLot = selectedReservation ? lots.find(row => row.id === selectedReservation.lotId) || null : null
  const currentReviewRevision = Number(selectedReview?.revision ?? selectedLot?.processingReview?.revision ?? 0)
  const selectedRepackReservation = reservations.find(row => row.id === repackDraft.sourceReservationId) || null
  const repackLot = selectedRepackReservation ? lots.find(row => row.id === selectedRepackReservation.lotId) || null : null
  const repackReservationLotId = selectedRepackReservation?.lotId
  const repackReview = repackLot?.processingReview
  const emulatorQa = import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true'
  const activeAuthorization = Boolean(canAdmin && authorization?.status === 'active')
  const repackAuthorizationActive = Boolean(reviewerAuthorization?.status === 'active' && reviewerAuthorization.authorizationId === selectedReview?.qualityAuthorizationRef)
  const repackAuthorizationReady = canAdmin ? repackAuthorizationActive : Boolean(selectedReview?.qualityAuthorizationRef)
  const reviewEvidence = useMemo(() => evidence.filter(row => row.lotId === selectedReservation?.lotId && row.reviewRevision === currentReviewRevision), [evidence, selectedReservation, currentReviewRevision])
  const repackEvidenceRefs = selectedReview && repackReview?.latestReviewId === selectedReview.id ? selectedReview.evidenceRefs : []
  const outputWeightG = repackDraft.outputs.reduce((sum, row) => sum + (Number(row.measuredNetWeightG) || 0), 0)
  const openedWeightG = Number(repackDraft.openedPhysicalWeightG) || 0

  const loadFirstPage = useCallback(async () => {
    setLoading(true); setError('')
    try {
      if (mode === 'reservations' || mode === 'review' || mode === 'repack') {
        const page = await loadProcessingReservationPage(locationFilter)
        setReservations(page.rows); setReservationCursor(page.cursor); setReservationHasMore(page.hasMore)
      } else if (mode === 'history-reviews') {
        const page = await loadProcessingReviewPage(locationFilter)
        setReviewRows(page.rows); setReviewCursor(page.cursor); setReviewHasMore(page.hasMore)
      } else {
        const page = await loadProcessingRepackPage(locationFilter)
        setRepackRows(page.rows); setRepackCursor(page.cursor); setRepackHasMore(page.hasMore)
      }
      if (canAdmin) {
        try { setAuthorization(await loadMyProcessingQualityAuthorization()) } catch { setAuthorization(null) }
      }
    } catch (reason) { setError((reason as Error).message || 'No se pudo consultar la información del servidor.') }
    finally { setLoading(false) }
  }, [mode, locationFilter, canAdmin])

  useEffect(() => {
    let active = true
    queueMicrotask(() => { if (active) void loadFirstPage() })
    return () => { active = false }
  }, [loadFirstPage])
  useEffect(() => {
    try { localStorage.setItem(localKey(session.uid), JSON.stringify(repackDraft)) } catch { /* Keep the in-memory draft; no stock was changed. */ }
  }, [repackDraft, session.uid])
  useEffect(() => {
    if (!selectedReservationId) return
    try { localStorage.setItem(reviewKey(session.uid, selectedReservationId), JSON.stringify(reviewDraft)) } catch { /* Keep the review draft in memory; no operation was sent. */ }
  }, [reviewDraft, selectedReservationId, session.uid])
  useEffect(() => {
    if (mode !== 'repack' || !repackReservationLotId || !repackReview?.latestReviewId) return
    let active = true
    void loadProcessingReview(repackReview.latestReviewId).then(async row => {
      if (!active) return
      setSelectedReview(row)
      if (canAdmin && row?.reviewedBy) {
        try { setReviewerAuthorization(await loadProcessingQualityAuthorizationFor(row.reviewedBy)) } catch { setReviewerAuthorization(null) }
      } else setReviewerAuthorization(null)
    }).catch(reason => { if (active) setRepackError((reason as Error).message) })
    return () => { active = false }
  }, [mode, repackReservationLotId, repackReview?.latestReviewId, canAdmin])

  const loadMore = async () => {
    setLoading(true); setError('')
    try {
      if (mode === 'reservations' || mode === 'review' || mode === 'repack') {
        const page = await loadProcessingReservationPage(locationFilter, reservationCursor)
        setReservations(rows => [...rows, ...page.rows]); setReservationCursor(page.cursor); setReservationHasMore(page.hasMore)
      } else if (mode === 'history-reviews') {
        const page = await loadProcessingReviewPage(locationFilter, reviewCursor)
        setReviewRows(rows => [...rows, ...page.rows]); setReviewCursor(page.cursor); setReviewHasMore(page.hasMore)
      } else {
        const page = await loadProcessingRepackPage(locationFilter, repackCursor)
        setRepackRows(rows => [...rows, ...page.rows]); setRepackCursor(page.cursor); setRepackHasMore(page.hasMore)
      }
    } catch (reason) { setError((reason as Error).message || 'No se pudo cargar la siguiente página.') }
    finally { setLoading(false) }
  }

  const selectReviewReservation = async (reservation: ProcessingReservation) => {
    const selectionRevision = ++reviewSelectionRevision.current
    selectedReservationIdRef.current = reservation.id
    const lot = lots.find(row => row.id === reservation.lotId)
    const expectedRevision = Number(lot?.processingReview?.revision || 0)
    const savedDraft = readReviewDraft(session.uid, reservation.id)
    setSelectedReservationId(reservation.id); setSelectedReview(null); setEvidence([]); setReviewerAuthorization(null)
    setEvidenceFile(null); setEvidenceMessage(''); setEvidenceRetry(false); evidenceRequest.current = null
    setReviewDraft(savedDraft || blankReview(expectedRevision)); setReviewState(savedDraft?.operationPending ? 'unknown' : 'idle'); setReviewMessage(''); setError('')
    if (savedDraft && savedDraft.expectedRevision !== expectedRevision) setError('Esta reserva cambió en otra sesión. Conservamos tus observaciones y el identificador; no envíes hasta comprobar el estado y revisar la versión actual.')
    if (lot?.processingReview?.latestReviewId) {
      try {
        const latest = await loadProcessingReview(lot.processingReview.latestReviewId)
        if (selectionRevision === reviewSelectionRevision.current) setSelectedReview(latest)
      } catch (reason) { if (selectionRevision === reviewSelectionRevision.current) setError((reason as Error).message) }
    }
    try {
      const rows = await loadProcessingEvidenceForReservation(reservation.location, reservation.id)
      if (selectionRevision === reviewSelectionRevision.current) setEvidence(rows)
    } catch { if (selectionRevision === reviewSelectionRevision.current) setEvidence([]) }
  }

  const editReviewDraft = (patch: Partial<ReviewDraft>) => {
    if (['sending','unknown','confirmed'].includes(reviewState)) return
    setReviewDraft(current => ({ ...current, ...patch,
      ...(reviewState === 'rejected' ? { operationId: newOperationId('processing_review'), operationPending: false } : {}),
    }))
    if (reviewState === 'rejected') setReviewState('idle')
    setError('')
  }

  const finishReview = async (result: { reviewId?: string }, reservationId: string, expectedRevision: number) => {
    try { localStorage.removeItem(reviewKey(session.uid, reservationId)) } catch { /* The server record remains authoritative. */ }
    const stillSelected = selectedReservationIdRef.current === reservationId
    if (stillSelected) {
      // The submitted revision is confirmed; the fresh draft targets the next
      // server revision, so it must permit the next auditable review step.
      setReviewState('idle')
      setReviewMessage('Revisión registrada. La reserva, el inventario, los costos y el Kardex no se modificaron.')
      setReviewDraft(blankReview(expectedRevision + 1))
    }
    const savedReview = result.reviewId ? await loadProcessingReview(result.reviewId).catch(() => null) : null
    if (stillSelected && savedReview) setSelectedReview(savedReview)
    await loadFirstPage()
  }

  const checkReview = async () => {
    if (!reviewDraft.operationId || !selectedReservation) return
    const reservationId = selectedReservation.id
    const expectedRevision = reviewDraft.expectedRevision
    setError(''); setReviewMessage('Consultando el estado definitivo en el servidor…')
    try {
      const state = await getProcessingOperationState(reviewDraft.operationId, 'recordProcessingReview')
      if (state.status === 'confirmed') {
        const result = state.result as { reviewId?: string }
        await finishReview(result || {}, reservationId, expectedRevision)
        return
      }
      if (state.status === 'queued') {
        setReviewState('unknown'); setReviewMessage('La revisión sigue pendiente. No vuelvas a enviarla; consulta de nuevo con el mismo identificador.')
        return
      }
      if (state.status === 'rejected') {
        setReviewState('rejected'); setReviewDraft(current => ({ ...current, operationPending: false })); setReviewMessage('El servidor rechazó esta revisión. Corrige los datos para crear un intento nuevo.'); setError(state.error)
        return
      }
      setReviewState('idle'); setReviewDraft(current => ({ ...current, operationPending: false })); setReviewMessage('El servidor no encuentra esta operación. Puedes reenviar el mismo borrador con el mismo identificador.')
    } catch (reason) {
      setReviewState('unknown'); setError((reason as Error).message || 'No se pudo comprobar el estado de la revisión.')
      setReviewMessage('El resultado sigue siendo desconocido. Conservamos datos e identificador; consulta el estado antes de reintentar.')
    }
  }

  const submitReview = async () => {
    if (!selectedReservation || !selectedLot || reviewBusy || submitLock.current || ['sending','unknown','confirmed','rejected'].includes(reviewState)) return
    const observation = reviewDraft.observations.trim(), reasonText = reviewDraft.reason.trim()
    if (observation.length < 3 || reasonText.length < 3) { setError('Escribe observaciones y motivo (mínimo 3 caracteres).'); return }
    const physicalWeightG = reviewDraft.physicalWeightG.trim() === '' ? null : Number(reviewDraft.physicalWeightG)
    if (physicalWeightG !== null && (!Number.isSafeInteger(physicalWeightG) || physicalWeightG < 0)) { setError('El peso medido debe ser un número entero de gramos. Si no se pesó, déjalo vacío.'); return }
    const needsEvidence = ['authorize_repack', 'declare_unrecoverable', 'record_disposition_assessment'].includes(reviewDraft.action)
    if (reviewDraft.productObservation === 'confirmed_unfit' && !['declare_unrecoverable', 'record_disposition_assessment'].includes(reviewDraft.action)) { setError('Para declarar no apto se requiere una evaluación autorizada de calidad; una observación sola no cambia ese estado.'); return }
    if (needsEvidence && reviewDraft.evidenceRefs.length === 0) { setError('Esta decisión requiere evidencia persistida y verificada para este lote y revisión.'); return }
    if (reviewDraft.action === 'record_disposition_assessment') {
      const recoverable = reviewDraft.recoverableWeightG === '' ? null : Number(reviewDraft.recoverableWeightG)
      const discard = reviewDraft.discardWeightG === '' ? null : Number(reviewDraft.discardWeightG)
      if (!activeAuthorization) { setError('La evaluación requiere autorización de Calidad vigente.'); return }
      if (reviewDraft.dispositionOutcome === 'undetermined') {
        if (recoverable !== null || discard !== null) { setError('Una evaluación indeterminada no asigna gramos a recuperación ni descarte.'); return }
      } else if (physicalWeightG === null || recoverable === null || discard === null || !Number.isSafeInteger(recoverable) || !Number.isSafeInteger(discard) || recoverable < 0 || discard < 0 || recoverable + discard !== physicalWeightG) {
        setError('Registra un peso medido y distribuye exactamente esos gramos entre recuperación propuesta y descarte pendiente. No se modificará inventario.'); return
      }
    }
    if (reviewDraft.action === 'authorize_repack' && (!activeAuthorization || reviewDraft.productObservation !== 'apparently_apt' || physicalWeightG === null)) { setError('Para autorizar reenvasado se requiere autorización de calidad vigente, evidencia, condición observada y peso medido.'); return }
    if (reviewDraft.expectedRevision !== currentReviewRevision) { setError('La revisión cambió en otra sesión. Tus observaciones se conservaron; actualiza la reserva antes de enviar.'); return }
    const operationId = reviewDraft.operationId
    const reservationId = selectedReservation.id
    const expectedRevision = reviewDraft.expectedRevision
    const payload: RecordProcessingReviewInput = { lotId: selectedLot.id, reservationId: selectedReservation.id, location: selectedReservation.location,
      expectedRevision: reviewDraft.expectedRevision, action: reviewDraft.action, physicalWeightG, packageCondition: reviewDraft.packageCondition,
      productObservation: reviewDraft.productObservation, observations: observation, reason: reasonText,
      evidenceRefs: reviewDraft.evidenceRefs, ...(needsEvidence ? { qualityAuthorizationRef: authorization?.authorizationId || '' } : {}),
      ...(reviewDraft.action === 'record_disposition_assessment' ? { dispositionOutcome: reviewDraft.dispositionOutcome,
        recoverableWeightG: reviewDraft.recoverableWeightG === '' ? null : Number(reviewDraft.recoverableWeightG),
        discardWeightG: reviewDraft.discardWeightG === '' ? null : Number(reviewDraft.discardWeightG) } : {}) }
    try { localStorage.setItem(reviewKey(session.uid, selectedReservation.id), JSON.stringify({ ...reviewDraft, operationPending: true })) }
    catch { setError('No se pudo guardar el identificador seguro de esta revisión. No se envió nada.'); return }
    submitLock.current = true; setReviewBusy(true); setReviewState('sending'); setReviewDraft(current => ({ ...current, operationPending: true })); setError(''); setReviewMessage('Enviando revisión al servidor; no cambia existencias.')
    try {
      const result = await recordProcessingReview(payload, operationId) as { reviewId?: string }
      await finishReview(result || {}, reservationId, expectedRevision)
    } catch (reason) {
      const message = (reason as Error).message || 'No se pudo registrar la revisión.'
      try {
        const state = await getProcessingOperationState(operationId, 'recordProcessingReview')
        if (state.status === 'confirmed') { await finishReview((state.result || {}) as { reviewId?: string }, reservationId, expectedRevision); return }
        if (state.status === 'queued') { setReviewState('unknown'); setReviewMessage('La operación sigue pendiente. No la vuelvas a enviar; consulta el estado con el mismo identificador.'); setError(message); return }
        if (state.status === 'rejected') { setReviewState('rejected'); setReviewDraft(current => ({ ...current, operationPending: false })); setReviewMessage('El servidor rechazó esta revisión. Corrige los datos para crear un intento nuevo.'); setError(state.error); return }
        setReviewState('idle'); setReviewDraft(current => ({ ...current, operationPending: false })); setReviewMessage('El servidor no encuentra esta operación. Puedes reenviar el mismo borrador con el mismo identificador.'); setError(message)
      } catch {
        setReviewState('unknown'); setReviewMessage('El resultado es desconocido. Conservamos identificador y observaciones; comprueba el estado antes de volver a enviar.'); setError(message)
      }
    } finally { submitLock.current = false; setReviewBusy(false) }
  }

  const submitEvidence = async () => {
    const reservation = selectedReservation, lot = selectedLot
    const caseId = selectedReview?.caseId || lot?.processingReview?.caseId
    if (!reservation || !lot || !evidenceFile || !caseId || evidenceBusy) return
    const request = evidenceRequest.current || { file: evidenceFile, evidenceId: newOperationId('processing_evidence'), operationId: newOperationId('processing_evidence_register') }
    evidenceRequest.current = request
    setEvidenceBusy(true); setEvidenceMessage('Subiendo y verificando el archivo en el servidor…'); setError('')
    try {
      await uploadProcessingEvidence({ lotId: lot.id, reservationId: reservation.id, location: reservation.location,
        reviewCaseId: caseId, reviewRevision: currentReviewRevision, evidenceType, file: request.file,
        evidenceId: request.evidenceId, operationId: request.operationId })
      const rows = await loadProcessingEvidenceForReservation(reservation.location, reservation.id)
      if (selectedReservationIdRef.current === reservation.id) {
        setEvidence(rows); setReviewDraft(current => ({ ...current, evidenceRefs: [...new Set([...current.evidenceRefs, request.evidenceId])] }))
        setEvidenceMessage('Evidencia verificada y vinculada a esta revisión.'); setEvidenceFile(null); setEvidenceRetry(false); evidenceRequest.current = null
      }
    } catch (reason) {
      recordErrorDiagnostic({ error: reason instanceof Error ? reason : new Error(String(reason)), source: 'handled_operation_failure', view: 'dist.processing.evidence' })
      setError('No se pudo verificar la evidencia. Comprueba el archivo y la conexión; puedes reintentar con el mismo archivo.')
      setEvidenceRetry(true); setEvidenceMessage('La operación conserva su identificador. Comprueba el estado o reintenta con el mismo archivo antes de iniciar otra carga.')
    } finally { setEvidenceBusy(false) }
  }

  const updateRepack = (patch: Partial<RepackDraft>) => {
    if (repackState === 'unknown' || repackState === 'sending' || repackState === 'confirmed') return
    setRepackError(''); setRepackMessage('')
    setRepackDraft(current => ({ ...current, ...patch, operationId: repackState === 'rejected' ? newOperationId('processing_repack_operation') : current.operationId }))
    if (repackState === 'rejected') setRepackState('idle')
  }

  const selectRepackSource = (reservationId: string) => {
    const reservation = reservations.find(row => row.id === reservationId)
    const source = reservation ? lots.find(row => row.id === reservation.lotId) : null
    updateRepack({ sourceReservationId: reservationId, ...(reservation ? { openedCommercialQuantity: String(reservation.remainingQuantity) } : {}), ...(source?.manufacturedOn ? { outputs: repackDraft.outputs.map(row => ({ ...row, manufacturedOn: source.manufacturedOn! })) } : {}) })
  }

  const buildRepackPayload = (): RepackOperationInput => {
    if (!selectedRepackReservation || !repackLot || !selectedReview || !selectedReview.qualityAuthorizationRef) throw new Error('Falta una reserva o una revisión autorizada con referencia de calidad.')
    if (selectedReview.id !== repackReview?.latestReviewId || selectedReview.status !== 'authorized_for_repack') throw new Error('La revisión ya no es la última aprobada. Actualiza la pantalla antes de continuar.')
    if (!repackEvidenceRefs.length) throw new Error('La revisión aprobada no tiene evidencia verificada vinculada.')
    const openedCommercialQuantity = Number(repackDraft.openedCommercialQuantity.replace(',', '.'))
    if (!Number.isFinite(openedCommercialQuantity) || openedCommercialQuantity <= 0 || openedCommercialQuantity > selectedRepackReservation.remainingQuantity) throw new Error('La cantidad comercial abierta debe estar dentro de la reserva restante.')
    if (!Number.isSafeInteger(openedWeightG) || openedWeightG <= 0 || outputWeightG !== openedWeightG) throw new Error('La suma de gramos netos de salida debe igualar exactamente el peso realmente medido al abrir.')
    if (repackDraft.outputs.length === 0 || repackDraft.outputs.some(row => !row.productId || !row.lotCode.trim() || !row.manufacturedOn || !row.packagedOn || !row.expiresOn)) throw new Error('Completa SKU, lote y fechas para cada presentación de salida.')
    if (repackDraft.outputs.some(row => row.manufacturedOn !== repackLot.manufacturedOn || row.expiresOn > repackLot.expiresOn)) throw new Error('Conserva la fecha de elaboración original y no extiendas el vencimiento del lote de origen.')
    if (repackDraft.materials.some(row => !row.materialId.trim() || !Number.isFinite(Number(row.quantity)) || Number(row.quantity) <= 0 || (row.damaged.trim() && Number(row.damaged) > Number(row.quantity)))) throw new Error('Revisa el material y la cantidad de bolsas usadas/dañadas.')
    const product = products.find(row => row.id === selectedRepackReservation.productId)
    if (!product) throw new Error('No se encontró el SKU de origen.')
    const draftSegments = (selectedRepackReservation as ProcessingReservation & { processingSegments?: Array<{ batchId: string; segmentId: string }> }).processingSegments || []
    const input: RepackOperationInput = {
      operationId: repackDraft.operationId, repackId: repackDraft.repackId, reviewId: selectedReview.id, sourceLotId: selectedRepackReservation.lotId,
      reservationId: selectedRepackReservation.id, location: selectedRepackReservation.location,
      expectedReviewRevision: selectedReview.revision, expectedReservationQuantity: selectedRepackReservation.remainingQuantity,
      sourceKind: repackLot.processingCommercialBlocked ? 'derived_lot' : 'traditional_lot', sourceUnitType: product.unitType,
      openedCommercialQuantity, sourceSegments: draftSegments.map(({ batchId, segmentId }) => ({ batchId, segmentId })), openedPhysicalWeightG: openedWeightG,
      outputs: repackDraft.outputs.map(row => {
        const target = products.find(productRow => productRow.id === row.productId && productRow.active && !productRow.deleted)
        if (!target) throw new Error('Cada salida debe usar un SKU de destino existente y activo.')
        return { id: row.id, productId: target.id, commercialUnit: target.unitType, commercialQuantity: Number(row.commercialQuantity.replace(',', '.')), measuredNetWeightG: Number(row.measuredNetWeightG), lotCode: row.lotCode.trim(), manufacturedOn: row.manufacturedOn, packagedOn: row.packagedOn, expiresOn: row.expiresOn }
      }),
      packagingMaterials: repackDraft.materials.map(row => ({ materialId: row.materialId.trim(), quantityMilli: Math.round(Number(row.quantity) * 1000), damagedQuantityMilli: Math.round((Number(row.damaged) || 0) * 1000), costCents: row.costBs.trim() ? Math.round(Number(row.costBs) * 100) : null })),
      additionalCostComponents: [], authorizationReference: selectedReview.qualityAuthorizationRef, evidenceRefs: repackEvidenceRefs, reason: repackDraft.reason.trim(),
    }
    validateRepackOperationContract(input)
    return input
  }

  const finishRepack = () => {
    try { localStorage.removeItem(localKey(session.uid)) } catch { /* The confirmed server record remains authoritative. */ }
    setRepackState('confirmed'); setRepackMessage('Reenvasado confirmado por el servidor de QA. Las nuevas presentaciones siguen bloqueadas para venta.'); setRepackError('')
  }
  const checkRepack = async () => {
    setRepackMessage('Consultando el estado definitivo en el servidor…'); setRepackError('')
    try {
      const state = await getProcessingOperationState(repackDraft.operationId, 'confirmProcessingRepack')
      if (state.status === 'confirmed') { finishRepack(); return }
      if (state.status === 'rejected') { setRepackState('rejected'); setRepackDraft(current => ({ ...current, operationPending: false })); setRepackError(state.error); setRepackMessage('El servidor rechazó la operación; el borrador se conserva.') ; return }
      if (state.status === 'queued') { setRepackState('unknown'); setRepackMessage('Sigue pendiente. No inicies otra operación; vuelve a consultar con el mismo identificador.'); return }
      setRepackState('idle'); setRepackDraft(current => ({ ...current, operationPending: false })); setRepackMessage('El servidor no encuentra la operación. Puedes reenviarla con los mismos identificadores.')
    } catch (reason) { setRepackState('unknown'); setRepackError((reason as Error).message); setRepackMessage('Respuesta desconocida. Se conservan los identificadores para volver a consultar.') }
  }
  const submitRepack = async () => {
    if (submitLock.current || repackState === 'sending' || repackState === 'unknown' || repackState === 'confirmed') return
    let input: RepackOperationInput
    try { input = buildRepackPayload() } catch (reason) { setRepackError((reason as Error).message); return }
    try { localStorage.setItem(localKey(session.uid), JSON.stringify({ ...repackDraft, operationPending: true })) }
    catch { setRepackError('No se pudo conservar el identificador seguro del reenvasado en este dispositivo. No se envió nada.'); return }
    submitLock.current = true; setRepackState('sending'); setRepackMessage('Enviando al servidor de QA para validación transaccional…'); setRepackError('')
    try { await confirmProcessingRepack(input); finishRepack() }
    catch (reason) {
      const message = (reason as Error).message || 'No se pudo confirmar.'
      try {
        const state = await getProcessingOperationState(input.operationId, 'confirmProcessingRepack')
        if (state.status === 'confirmed') { finishRepack(); return }
        if (state.status === 'queued') { setRepackState('unknown'); setRepackMessage('Operación pendiente; conserva el mismo ID y consulta su estado antes de volver a enviar.'); setRepackError(message); return }
        if (state.status === 'rejected') { setRepackState('rejected'); setRepackDraft(current => ({ ...current, operationPending: false })); setRepackMessage('Rechazada sin confirmación. Revisa el mensaje antes de corregir.'); setRepackError(state.error); return }
        setRepackState('rejected'); setRepackDraft(current => ({ ...current, operationPending: false })); setRepackMessage('No hay operación registrada; el borrador y repackId se conservan.'); setRepackError(message)
      } catch { setRepackState('unknown'); setRepackMessage('No se conoce el resultado. No cambies los IDs ni vuelvas a enviar todavía.'); setRepackError(message) }
    } finally { submitLock.current = false }
  }

  const scopedReservations = reservations.filter(row => row.status === 'active' || row.status === 'partially_consumed')
  const repackableReservations = scopedReservations.filter(row => row.purpose === 'repack_pending' && row.remainingQuantity > 0 && lots.some(lot => lot.id === row.lotId && lot.processingReview?.status === 'authorized_for_repack'))
  const reviewReservations = scopedReservations.filter(row => row.purpose !== 'courtesy')
  const currentLocationName = (location: string) => locationOptions.find(row => (row.id === 'central' ? 'central' : `warehouse__${row.id}`) === location)?.name || (location === 'central' ? 'Almacén central' : location.replace('warehouse__', ''))

  if (!['admin','warehouse'].includes(session.role)) return <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-900">Esta sección solo está disponible para Almacén y Administración.</div>

  return <div className="min-w-0 space-y-3">
    {mode === 'reservations' && <ProcessingGuide topic="reservations" />}
    {mode === 'review' && <><ProcessingGuide topic="review" /><ProcessingGuide topic="evidence" /></>}
    {mode === 'repack' && <ProcessingGuide topic="repack" />}
    {(mode === 'history-reviews' || mode === 'history-repackings') && <ProcessingGuide topic="history" />}
    {mode === 'reservations' && <>
      <SectionCard title="Mercadería reservada" action={<SecondaryButton disabled={loading} onClick={() => void loadFirstPage()}><RefreshCw size={15} />Actualizar</SecondaryButton>}>
        <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-950">Las cantidades reservadas están inmovilizadas. No son stock disponible para venta ni despacho.</p>
        {loading && reservations.length === 0 ? <LoadingState label="Consultando reservas del servidor…" /> : error ? <ErrorBox message={error} onRetry={() => void loadFirstPage()} /> : scopedReservations.length === 0 ? <EmptyBlock title="No hay reservas activas" description="Las reservas consumidas y liberadas pueden consultarse en las páginas históricas." /> : <div className="space-y-2">{scopedReservations.map(row => <ReservationCard key={row.id} row={row} lot={lots.find(lot => lot.id === row.lotId)} locationName={currentLocationName(row.location)} />)}</div>}
        {reservationHasMore && <SecondaryButton full disabled={loading} onClick={() => void loadMore()}>Cargar más reservas</SecondaryButton>}
      </SectionCard>
    </>}

    {mode === 'review' && <SectionCard title="Revisión física"><p className="mb-3 text-xs text-slate-600">Registrar una observación no cambia inventario, reservas, costos ni Kardex.</p>
      {loading && reservations.length === 0 ? <LoadingState label="Buscando producto inmovilizado…" /> : error && !selectedReservation ? <ErrorBox message={error} onRetry={() => void loadFirstPage()} /> : <>
        <Field label="Reserva para revisar" required><SelectInput disabled={reviewBusy} value={selectedReservationId} onChange={event => { const row = reservations.find(item => item.id === event.target.value); if (row) void selectReviewReservation(row) }}><option value="">Selecciona producto y lote</option>{reviewReservations.map(row => <option key={row.id} value={row.id}>{row.productName} · {row.lotCode} · {formatQty(row.remainingQuantity, row.unitType)} · {purposeLabel[row.purpose]}</option>)}</SelectInput></Field>
        {reservationHasMore && <SecondaryButton full disabled={loading} onClick={() => void loadMore()}>Buscar más reservas</SecondaryButton>}
        {selectedReservation && <div className="mt-3 space-y-3">
          <ReservationCard row={selectedReservation} lot={selectedLot} locationName={currentLocationName(selectedReservation.location)} />
          {selectedReview && <ReviewSummary review={selectedReview} />}
          <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-950"><b>Autorización de calidad:</b> {canAdmin ? activeAuthorization ? `Activa para esta cuenta hasta ${dateTime(authorization?.expiresAt)}.` : 'Esta cuenta no tiene autorización vigente. Puede revisar, pero no aprobar.' : 'Almacén puede registrar observaciones; no puede aprobar aptitud ni reenvasado.'} No hay controles de concesión de permisos en esta pantalla.</div>
          <SectionCard title="Registrar observación o cambio de estado">
            {reviewState === 'unknown' && <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><b>Resultado pendiente de comprobación.</b> Conservamos observaciones e identificador. No edites ni envíes una segunda revisión hasta consultar el servidor.<div className="mt-2"><PrimaryButton full disabled={reviewBusy} onClick={() => void checkReview()}><RefreshCw size={15} />Comprobar estado de la revisión</PrimaryButton></div></div>}
            {reviewState === 'rejected' && <p role="status" className="mb-3 rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-950">La operación fue rechazada. Corrige un dato para iniciar un intento nuevo; las observaciones permanecen guardadas.</p>}
            {reviewState === 'confirmed' && <p role="status" className="mb-3 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">Revisión confirmada por el servidor.</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Acción"><SelectInput disabled={reviewState === 'unknown' || reviewState === 'sending' || reviewState === 'confirmed'} value={reviewDraft.action} onChange={event => editReviewDraft({ action: event.target.value as ReviewAction, evidenceRefs: [] })}><option value="record_observation">Registrar observación</option><option value="start_review">Iniciar revisión</option><option value="request_information">Solicitar información</option>{canAdmin && <option value="mark_pending_economic_disposition">Marcar disposición económica pendiente</option>}{canAdmin && activeAuthorization && <><option value="record_disposition_assessment">Registrar evaluación de destino (sin liberar ni descartar)</option><option value="authorize_repack">Autorizar procedimiento de reenvasado</option><option value="declare_unrecoverable">Declarar no recuperable</option></>}</SelectInput></Field>
              <Field label="Condición del envase"><SelectInput disabled={reviewState === 'unknown' || reviewState === 'sending' || reviewState === 'confirmed'} value={reviewDraft.packageCondition} onChange={event => editReviewDraft({ packageCondition: event.target.value as ReviewDraft['packageCondition'] })}><option value="unknown">No determinada</option><option value="sealed_intact">Sellado e íntegro</option><option value="package_damaged_content_intact">Envase dañado, contenido aparentemente íntegro</option><option value="package_damaged_partial">Envase dañado, contenido parcial</option><option value="no_package">Sin envase</option></SelectInput></Field>
              <Field label="Estado observado del alimento"><SelectInput disabled={reviewState === 'unknown' || reviewState === 'sending' || reviewState === 'confirmed'} value={reviewDraft.productObservation} onChange={event => editReviewDraft({ productObservation: event.target.value as ReviewDraft['productObservation'] })}><option value="not_assessed">No evaluado</option><option value="apparently_apt">Aparentemente apto</option><option value="uncertain">Aptitud incierta</option><option value="confirmed_unfit">No apto (requiere autorización)</option></SelectInput></Field>
              <Field label="Peso físico medido (g)" hint="Déjalo vacío si no se pesó. No se reemplaza por peso nominal."><NumberInput disabled={reviewState === 'unknown' || reviewState === 'sending' || reviewState === 'confirmed'} min="0" step="1" value={reviewDraft.physicalWeightG} onChange={event => editReviewDraft({ physicalWeightG: event.target.value })} placeholder="Sin medición" /></Field>
              {reviewDraft.action === 'record_disposition_assessment' && <>
                <Field label="Evaluación de Calidad" hint="Es una propuesta documentada; no mueve stock ni decide el tratamiento contable."><SelectInput disabled={reviewState === 'unknown' || reviewState === 'sending' || reviewState === 'confirmed'} value={reviewDraft.dispositionOutcome} onChange={event => editReviewDraft({ dispositionOutcome: event.target.value as ReviewDraft['dispositionOutcome'] })}><option value="undetermined">Destino aún indeterminado</option><option value="recoverable">Peso medido propuesto como recuperable</option><option value="partially_recoverable">Recuperación parcial propuesta</option><option value="discard_pending">Descarte propuesto, pendiente de aprobación</option></SelectInput></Field>
                {reviewDraft.dispositionOutcome !== 'undetermined' && <><Field label="Gramos recuperables propuestos" required><NumberInput disabled={reviewState === 'unknown' || reviewState === 'sending' || reviewState === 'confirmed'} min="0" step="1" value={reviewDraft.recoverableWeightG} onChange={event => editReviewDraft({ recoverableWeightG: event.target.value })} /></Field><Field label="Gramos de descarte pendientes" required><NumberInput disabled={reviewState === 'unknown' || reviewState === 'sending' || reviewState === 'confirmed'} min="0" step="1" value={reviewDraft.discardWeightG} onChange={event => editReviewDraft({ discardWeightG: event.target.value })} /></Field></>}
                <p className="sm:col-span-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs font-semibold text-amber-950">La evaluación exige autorización vigente de Calidad y evidencia verificada. Queda pendiente de política/aprobación de la propietaria; no cambia existencias, costo ni Resultado.</p>
              </>}
              <Field label="Observaciones" required><TextArea disabled={reviewState === 'unknown' || reviewState === 'sending' || reviewState === 'confirmed'} maxLength={2000} value={reviewDraft.observations} onChange={event => editReviewDraft({ observations: event.target.value })} placeholder="Describe lo observado; separa peso asignado y medido." /></Field>
              <Field label="Motivo" required><TextArea disabled={reviewState === 'unknown' || reviewState === 'sending' || reviewState === 'confirmed'} maxLength={500} value={reviewDraft.reason} onChange={event => editReviewDraft({ reason: event.target.value })} placeholder="Motivo de la revisión o solicitud" /></Field>
            </div>
            {selectedReservation && selectedReview && <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
              <b>Evidencia de Calidad</b><p className="mt-1 text-xs">El servidor comprueba archivo, SHA-256, versión de revisión, reserva y ubicación. Máximo 15 MB; JPG, PNG o PDF.</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className="grid min-h-11 content-center gap-1 rounded-lg border border-sky-200 bg-white p-2 text-xs font-bold">Tomar fotografía
                  <input aria-label="Tomar fotografía de evidencia" type="file" accept="image/jpeg,image/png" capture="environment" disabled={evidenceBusy || ['unknown','sending'].includes(reviewState)} onChange={event => { const file = event.target.files?.[0] || null; if (evidenceRequest.current?.file !== file) evidenceRequest.current = null; setEvidenceFile(file); setEvidenceMessage(''); setEvidenceRetry(false) }} />
                </label>
                <label className="grid min-h-11 content-center gap-1 rounded-lg border border-sky-200 bg-white p-2 text-xs font-bold">Elegir fotografía o PDF
                  <input aria-label="Elegir archivo de evidencia" type="file" accept="image/jpeg,image/png,application/pdf" disabled={evidenceBusy || ['unknown','sending'].includes(reviewState)} onChange={event => { const file = event.target.files?.[0] || null; if (evidenceRequest.current?.file !== file) evidenceRequest.current = null; setEvidenceFile(file); setEvidenceMessage(''); setEvidenceRetry(false) }} />
                </label>
                <button type="button" className="min-h-11 rounded-xl bg-sky-800 px-4 text-sm font-bold text-white disabled:opacity-50" disabled={!evidenceFile || evidenceBusy || ['unknown','sending'].includes(reviewState)} onClick={() => void submitEvidence()}>{evidenceBusy ? 'Verificando…' : evidenceRetry ? 'Reintentar carga' : 'Subir evidencia'}</button>
              </div>
              {evidenceFile && <p className="mt-2 break-all text-xs">Archivo seleccionado: <b>{evidenceFile.name}</b> · {(evidenceFile.size / 1024 / 1024).toFixed(2)} MB</p>}
              <label className="mt-2 block text-xs font-semibold">Tipo de evidencia<select className="mt-1 min-h-10 w-full rounded-lg border p-2" value={evidenceType} disabled={evidenceBusy} onChange={event => setEvidenceType(event.target.value as typeof evidenceType)}><option value="photo">Fotografía</option><option value="measurement_record">Registro de medición</option><option value="signed_quality_record">Acta firmada de Calidad</option></select></label>
              {evidenceMessage && <p role="status" className="mt-2 text-xs font-bold">{evidenceMessage}</p>}
              {reviewEvidence.length > 0 && <div className="mt-2 space-y-2">{reviewEvidence.map(row => <label key={row.id} className="flex min-h-11 items-center gap-2 rounded-lg bg-white p-2 text-xs"><input disabled={reviewState === 'unknown' || reviewState === 'sending' || reviewState === 'confirmed'} type="checkbox" checked={reviewDraft.evidenceRefs.includes(row.id)} onChange={event => editReviewDraft({ evidenceRefs: event.target.checked ? [...reviewDraft.evidenceRefs, row.id] : reviewDraft.evidenceRefs.filter(id => id !== row.id) })} /><span className="break-all">{row.evidenceType} · {dateTime(row.recordedAt)} · {row.id}</span></label>)}</div>}
              {['authorize_repack','declare_unrecoverable','record_disposition_assessment'].includes(reviewDraft.action) && reviewEvidence.length === 0 && <p className="mt-2 font-bold">No hay evidencia compatible; la decisión de calidad permanecerá bloqueada.</p>}
            </div>}
            {reviewMessage && <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">{reviewMessage}</p>}
            {error && selectedReservation && <ErrorBox message={error} />}
      <div className="mt-3"><PrimaryButton full disabled={reviewBusy || ['unknown','sending','confirmed','rejected'].includes(reviewState) || (['authorize_repack','declare_unrecoverable','record_disposition_assessment'].includes(reviewDraft.action) && reviewDraft.evidenceRefs.length === 0) || (['authorize_repack','declare_unrecoverable','record_disposition_assessment'].includes(reviewDraft.action) && !activeAuthorization)} onClick={() => void submitReview()}>{reviewBusy || reviewState === 'sending' ? 'Guardando revisión…' : reviewState === 'confirmed' ? 'Revisión confirmada' : reviewState === 'rejected' ? 'Corrige para crear otro intento' : 'Registrar revisión'}</PrimaryButton></div>
          </SectionCard>
        </div>}
      </>}
    </SectionCard>}

    {mode === 'repack' && <SectionCard title="Reenvasado guiado"><p className="mb-3 text-xs text-slate-600">Cinco pasos; una confirmación transaccional del servidor. No se crean movimientos desde el navegador.</p>
      {!emulatorQa && <div className="mb-3 rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-sm font-bold text-amber-950">La confirmación depende de la configuración segura del servidor y del bucket oficial. El cliente no puede habilitarla; si falta alguna condición, el servidor rechazará sin modificar inventario.</div>}
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 sm:grid-cols-5">{['Origen','Apertura','Presentaciones','Materiales','Confirmar'].map((name, index) => <button key={name} type="button" onClick={() => setRepackStep(index)} aria-current={repackStep === index ? 'step' : undefined} className={`min-h-10 rounded-lg px-1 text-[11px] font-extrabold ${repackStep === index ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{index + 1}. {name}</button>)}</div>
      {repackMessage && <p role="status" className="mt-3 rounded-xl bg-sky-50 p-3 text-sm font-semibold text-sky-900">{repackMessage}</p>}
      {repackError && <ErrorBox message={repackError} />}
      {repackState === 'unknown' && <div className="mt-3"><PrimaryButton full onClick={() => void checkRepack()}><RefreshCw size={15} />Consultar estado con el mismo ID</PrimaryButton><p className="mt-1 text-center text-xs font-bold text-amber-800">No reenvíes ni cambies identificadores hasta conocer el estado.</p></div>}
      {repackStep === 0 && <div className="mt-3 space-y-3"><Field label="Origen autorizado" required><SelectInput value={repackDraft.sourceReservationId} onChange={event => selectRepackSource(event.target.value)}><option value="">Selecciona reserva repack_pending</option>{repackableReservations.map(row => { const lot = lots.find(item => item.id === row.lotId); return <option key={row.id} value={row.id}>{row.productName} · {row.lotCode} · {formatQty(row.remainingQuantity, row.unitType)} · vence {lot?.expiresOn || '—'}</option>})}</SelectInput></Field>{reservationHasMore && <SecondaryButton full onClick={() => void loadMore()}>Buscar más reservas</SecondaryButton>}{repackableReservations.length === 0 && <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">No hay reservas activas con revisión autorizada para reenvasado. Las devoluciones con disposición económica pendiente no son elegibles.</p>}{selectedRepackReservation && <ReservationCard row={selectedRepackReservation} lot={repackLot} locationName={currentLocationName(selectedRepackReservation.location)} />}{selectedReview && <ReviewSummary review={selectedReview} />}<p className="rounded-lg bg-slate-50 p-3 text-xs">Autorización de calidad: {selectedReview?.qualityAuthorizationRef || 'Sin referencia'} · {canAdmin && reviewerAuthorization ? `Vigente hasta ${dateTime(reviewerAuthorization.expiresAt)}; concedida por ${reviewerAuthorization.grantedBy}.` : 'La vigencia y revocación se vuelven a comprobar en el servidor antes de consumir la reserva.'}</p><p className="rounded-lg bg-slate-50 p-3 text-xs">Evidencia vinculada a la revisión: {repackEvidenceRefs.length ? repackEvidenceRefs.join(', ') : 'No disponible'}</p></div>}
      {repackStep === 1 && <div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label={`Cantidad comercial abierta (${selectedRepackReservation?.unitType || 'unidad'})`} required><NumberInput min="0.001" step={selectedRepackReservation?.unitType === 'kg' ? '0.001' : '1'} value={repackDraft.openedCommercialQuantity} onChange={event => updateRepack({ openedCommercialQuantity: event.target.value })} /></Field><Field label="Peso neto medido al abrir (g)" required hint="Peso de alimento, sin envase. Medición real en gramos enteros."><NumberInput min="1" step="1" value={repackDraft.openedPhysicalWeightG} onChange={event => updateRepack({ openedPhysicalWeightG: event.target.value })} /></Field><p className="sm:col-span-2 rounded-lg bg-slate-50 p-3 text-xs">Peso históricamente asignado: {selectedRepackReservation?.remainingWeightG == null ? 'desconocido' : `${selectedRepackReservation.remainingWeightG} g`} · costo: {money(selectedRepackReservation?.remainingCostCents)}. No se inferirá el peso desde el catálogo.</p></div>}
      {repackStep === 2 && <div className="mt-3 space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-600">Solo SKUs existentes y activos; el peso neto se mide, no se calcula desde el nominal.</p><SecondaryButton disabled={repackDraft.outputs.length >= 30} onClick={() => updateRepack({ outputs: [...repackDraft.outputs, freshOutput(repackLot?.manufacturedOn || todayKey())] })}>Añadir presentación</SecondaryButton></div>{repackDraft.outputs.map(row => <OutputEditor key={row.id} row={row} products={products} sourceManufacturedOn={repackLot?.manufacturedOn} update={patch => updateRepack({ outputs: repackDraft.outputs.map(item => item.id === row.id ? { ...item, ...patch } : item) })} remove={() => updateRepack({ outputs: repackDraft.outputs.filter(item => item.id !== row.id) })} canRemove={repackDraft.outputs.length > 1} />)}<p className={`rounded-lg p-3 text-sm font-bold ${outputWeightG === openedWeightG ? 'bg-emerald-50 text-emerald-900' : 'bg-rose-50 text-rose-900'}`}>Entrada medida: {openedWeightG} g · Salidas medidas: {outputWeightG} g · Diferencia: {openedWeightG - outputWeightG} g</p></div>}
      {repackStep === 3 && <div className="mt-3 space-y-3"><p className="rounded-lg bg-slate-50 p-3 text-xs">Los materiales son informativos. No crean otro egreso ni cambian Resultado.</p><SecondaryButton onClick={() => updateRepack({ materials: [...repackDraft.materials, { materialId: '', quantity: '', damaged: '0', costBs: '' }] })}>Añadir material</SecondaryButton>{repackDraft.materials.map((row, index) => <div key={`${row.materialId}-${index}`} className="grid gap-2 rounded-xl border p-3 sm:grid-cols-2"><Field label="Material"><TextInput value={row.materialId} onChange={event => updateRepack({ materials: repackDraft.materials.map((item, i) => i === index ? { ...item, materialId: event.target.value } : item) })} placeholder="Bolsa, etiqueta…" /></Field><Field label="Cantidad usada"><NumberInput min="0.001" step="0.001" value={row.quantity} onChange={event => updateRepack({ materials: repackDraft.materials.map((item, i) => i === index ? { ...item, quantity: event.target.value } : item) })} /></Field><Field label="Cantidad dañada"><NumberInput min="0" step="0.001" value={row.damaged} onChange={event => updateRepack({ materials: repackDraft.materials.map((item, i) => i === index ? { ...item, damaged: event.target.value } : item) })} /></Field><Field label="Costo conocido Bs (opcional)"><NumberInput min="0" step="0.01" value={row.costBs} onChange={event => updateRepack({ materials: repackDraft.materials.map((item, i) => i === index ? { ...item, costBs: event.target.value } : item) })} placeholder="No disponible" /></Field><button type="button" className="min-h-11 text-left text-xs font-bold text-rose-700" onClick={() => updateRepack({ materials: repackDraft.materials.filter((_, i) => i !== index) })}>Quitar material</button></div>)}<Field label="Motivo del reenvasado" required><TextArea maxLength={500} value={repackDraft.reason} onChange={event => updateRepack({ reason: event.target.value })} /></Field></div>}
      {repackStep === 4 && <div className="mt-3 space-y-3"><SectionCard title="Resumen antes de confirmar"><div className="grid grid-cols-2 gap-2"><Metric label="Reserva" value={selectedRepackReservation ? formatQty(selectedRepackReservation.remainingQuantity, selectedRepackReservation.unitType) : 'Sin seleccionar'} /><Metric label="Peso medido" value={`${openedWeightG} g`} /><Metric label="Peso de salida" value={`${outputWeightG} g`} /><Metric label="Costo origen" value={money(selectedRepackReservation?.remainingCostCents)} /></div><div className="mt-3 space-y-2">{repackDraft.outputs.map(row => <p key={row.id} className="break-words rounded-lg bg-slate-50 p-2 text-xs">{products.find(product => product.id === row.productId)?.name || 'SKU sin seleccionar'} · lote {row.lotCode || '—'} · {row.commercialQuantity || '0'} · {row.measuredNetWeightG || '0'} g</p>)}</div><p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-950">No se admite descarte en esta fase. El servidor requiere conservación completa de masa. Las salidas permanecen bloqueadas para venta y despacho.</p><p className="break-all text-[10px] text-slate-500">repackId: {repackDraft.repackId}<br />operationId: {repackDraft.operationId}</p></SectionCard><Field label="Motivo y observación de confirmación" required><TextArea maxLength={500} value={repackDraft.reason} onChange={event => updateRepack({ reason: event.target.value })} /></Field><PrimaryButton full disabled={repackState === 'sending' || repackState === 'unknown' || repackState === 'confirmed' || outputWeightG !== openedWeightG || !repackAuthorizationReady || repackEvidenceRefs.length === 0} onClick={() => void submitRepack()}><ShieldCheck size={16} />{repackState === 'sending' ? 'Esperando servidor…' : repackState === 'confirmed' ? 'Confirmado' : emulatorQa ? 'Confirmar reenvasado en QA' : 'Solicitar confirmación al servidor'}</PrimaryButton>{!repackAuthorizationReady && <p className="text-xs font-bold text-amber-800">La autorización de calidad de quien aprobó la revisión debe seguir vigente; el servidor lo volverá a comprobar.</p>}{!repackEvidenceRefs.length && <p className="text-xs font-bold text-amber-800">Falta evidencia verificada asociada a la revisión aprobada.</p>}</div>}
      <div className="mt-4 grid grid-cols-2 gap-2"><SecondaryButton full disabled={repackStep === 0 || repackState === 'unknown' || repackState === 'sending'} onClick={() => setRepackStep(value => Math.max(0, value - 1))}><ChevronLeft size={15} />Anterior</SecondaryButton><PrimaryButton full disabled={repackStep === 4 || repackState === 'unknown' || repackState === 'sending'} onClick={() => setRepackStep(value => Math.min(4, value + 1))}>Siguiente<ChevronRight size={15} /></PrimaryButton></div>
      <SecondaryButton full disabled={loading} onClick={() => void loadFirstPage()}><RefreshCw size={15} />Actualizar autorizaciones y reservas</SecondaryButton>
    </SectionCard>}

    {mode === 'history-reviews' && <SectionCard title="Historial de revisiones">{loading && reviewRows.length === 0 ? <LoadingState label="Consultando revisiones…" /> : error ? <ErrorBox message={error} onRetry={() => void loadFirstPage()} /> : reviewRows.length === 0 ? <EmptyBlock title="Sin revisiones registradas" description="Las observaciones y decisiones aparecerán aquí, separadas de los reenvasados confirmados." /> : <div className="space-y-2">{reviewRows.map(row => <ReviewSummary key={row.id} review={row} />)}</div>}{reviewHasMore && <SecondaryButton full disabled={loading} onClick={() => void loadMore()}>Cargar más revisiones</SecondaryButton>}</SectionCard>}
    {mode === 'history-repackings' && <SectionCard title="Historial de reenvasados">{loading && repackRows.length === 0 ? <LoadingState label="Consultando reenvasados confirmados…" /> : error ? <ErrorBox message={error} onRetry={() => void loadFirstPage()} /> : repackRows.length === 0 ? <EmptyBlock title="Sin reenvasados confirmados" description="Una revisión autorizada no aparece como reenvasado hasta que el servidor confirma su transacción." /> : <div className="space-y-2">{repackRows.map(row => <RepackSummary key={row.id} row={row} />)}</div>}{repackHasMore && <SecondaryButton full disabled={loading} onClick={() => void loadMore()}>Cargar más reenvasados</SecondaryButton>}</SectionCard>}
  </div>
}

function ReservationCard({ row, lot, locationName }: { row: ProcessingReservation; lot: DistLot | null | undefined; locationName: string }) {
  const unavailable = lot?.processingUnavailable?.[row.location]
  const [review, setReview] = useState<ProcessingReviewRecord | null>(null)
  const [reviewError, setReviewError] = useState('')
  const [reviewLoading, setReviewLoading] = useState(false)
  const [showReview, setShowReview] = useState(false)
  const reviewId = lot?.processingReview?.latestReviewId
  const currentReview = review?.id === reviewId ? review : null
  const loadLatestReview = async () => {
    if (!reviewId || reviewLoading) return
    setShowReview(true)
    if (review?.id === reviewId) return
    setReviewLoading(true); setReviewError('')
    try {
      const result = await loadProcessingReview(reviewId)
      if (!result) throw new Error('No se encontró la revisión registrada para este lote.')
      setReview(result)
    } catch (reason) { setReviewError((reason as Error).message || 'No se pudo consultar la última revisión.') }
    finally { setReviewLoading(false) }
  }
  return <article className="min-w-0 rounded-xl border border-slate-200 bg-white p-3">
    <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h3 className="break-words font-extrabold">{row.productName}</h3><p className="text-xs text-slate-600">Lote {row.lotCode} · {locationName}</p></div><span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black text-amber-950">{statusLabel[lot?.processingReview?.status || ''] || (row.status === 'partially_consumed' ? 'Parcialmente consumida' : purposeLabel[row.purpose])}</span></div>
    <div className="mt-2 grid grid-cols-2 gap-2 text-xs"><p>Finalidad<br /><b>{purposeLabel[row.purpose]}</b></p><p>Estado reserva<br /><b>{row.status === 'partially_consumed' ? 'Parcialmente consumida' : row.status === 'active' ? 'Activa' : row.status}</b></p><p>Cantidad original<br /><b>{formatQty(row.originalQuantity, row.unitType)}</b></p><p>Cantidad restante<br /><b>{formatQty(row.remainingQuantity, row.unitType)}</b></p><p>Peso histórico<br /><b>{row.physicalWeightG == null ? 'No disponible' : `${row.physicalWeightG} g`}</b></p><p>Peso medido<br /><b>{currentReview?.physicalWeightG == null ? reviewId ? 'Consultar última revisión' : 'Sin medición' : `${currentReview.physicalWeightG} g`}</b></p><p>Costo histórico<br /><b>{money(row.remainingCostCents)}</b></p><p>Vencimiento<br /><b>{lot?.expiresOn || 'No registrado'}</b></p></div>
    <p className="mt-2 text-[11px] text-slate-500">Responsable: {row.createdByName} · {dateTime(row.createdAt)} · {row.source}</p>
    {reviewId && <div className="mt-2"><SecondaryButton full disabled={reviewLoading} onClick={() => { if (showReview) setShowReview(false); else void loadLatestReview() }}>{showReview ? 'Ocultar última revisión' : 'Consultar última revisión'}</SecondaryButton>{showReview && (reviewLoading ? <p role="status" className="mt-2 text-xs text-slate-600">Consultando revisión del servidor…</p> : reviewError ? <ErrorBox message={reviewError} onRetry={() => void loadLatestReview()} /> : currentReview && <div className="mt-2 rounded-lg border border-sky-200 bg-sky-50 p-2 text-xs"><p><b>{dateTime(currentReview.reviewedAt)} · {currentReview.reviewedByName}</b></p><p className="mt-1">Peso históricamente asignado: {currentReview.historicalAssignedWeightG == null ? 'desconocido' : `${currentReview.historicalAssignedWeightG} g`} · Peso físico medido: {currentReview.physicalWeightG == null ? 'no se pesó' : `${currentReview.physicalWeightG} g`}</p><p className="mt-1">Diferencia observada: {currentReview.weightDifferenceG == null ? 'no calculable' : `${currentReview.weightDifferenceG} g · pendiente de clasificación`} · costo: {money(currentReview.costCents)}</p><p className="mt-1">Envase/alimento: {currentReview.packageCondition} / {currentReview.productObservation}</p><p className="mt-1 break-words">Motivo: {currentReview.reason}</p></div>)}</div>}
    {unavailable && <p className="mt-2 rounded-lg bg-slate-50 p-2 text-[10px] text-slate-600">Agregado inmovilizado en esta ubicación: reenvasado {formatQty(Number(unavailable.repackPending || 0), row.unitType)} · revisión {formatQty(Number(unavailable.reviewHold || 0), row.unitType)} · cortesía {formatQty(Number(unavailable.courtesy || 0), row.unitType)}</p>}
    <details className="mt-2 rounded-lg bg-slate-50 p-2"><summary className="cursor-pointer text-xs font-bold">Detalle e historial de reserva</summary><div className="mt-2 space-y-1 text-[11px] text-slate-600">{row.history.map(event => <p key={event.id}>{dateTime(event.at)} · {event.action} · {formatQty(event.quantity, row.unitType)} · {event.byName} · {event.reason || 'Sin motivo'}</p>)}</div></details>
  </article>
}

function ReviewSummary({ review }: { review: ProcessingReviewRecord }) {
  const assessment = review.dispositionAssessment
  return <article className="min-w-0 rounded-xl border border-sky-200 bg-white p-3"><div className="flex flex-wrap justify-between gap-2"><b className="break-words">{review.productName} · lote {review.lotCode}</b><span className="rounded-full bg-sky-100 px-2 py-1 text-[10px] font-black">{statusLabel[review.status] || review.status}</span></div><p className="mt-1 text-xs text-slate-600">{dateTime(review.reviewedAt)} · {review.reviewedByName} · {review.location === 'central' ? 'Almacén central' : review.location}</p><div className="mt-2 grid grid-cols-2 gap-2 text-xs"><p>Cantidad reservada<br /><b>{formatQty(review.commercialQuantity, review.commercialUnit)}</b></p><p>Peso asignado<br /><b>{review.historicalAssignedWeightG == null ? 'Desconocido' : `${review.historicalAssignedWeightG} g`}</b></p><p>Peso medido<br /><b>{review.physicalWeightG == null ? 'No se pesó' : `${review.physicalWeightG} g`}</b></p><p>Diferencia observada<br /><b>{review.weightDifferenceG == null ? 'No calculable' : `${review.weightDifferenceG} g · pendiente de clasificación`}</b></p><p>Costo histórico<br /><b>{money(review.costCents)}</b></p><p>Envase / alimento<br /><b>{review.packageCondition} / {review.productObservation}</b></p></div>{assessment && <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs font-bold text-amber-950">Evaluación de Calidad: {dispositionLabel[assessment.outcome] || assessment.outcome} · {assessment.measuredWeightG == null ? 'peso no medido' : `${assessment.recoverableWeightG ?? '—'} g recuperables propuestos / ${assessment.discardWeightG ?? '—'} g de descarte pendiente`} · {assessment.recordedByName} · {dateTime(assessment.recordedAt)}. Pendiente de aprobación económica; no movió inventario.</p>}<p className="mt-2 text-xs"><b>Observación:</b> {review.observations}</p><p className="mt-1 text-xs"><b>Motivo:</b> {review.reason}</p><p className="mt-1 break-all text-[10px] text-slate-500">Caso {review.caseId} · revisión {review.revision} · reserva {review.reservationId} · evidencias {review.evidenceRefs.length}</p>{review.economicDispositionStatus && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs font-bold text-amber-900">Disposición económica pendiente; sin ajuste automático de costo.</p>}</article>
}

function RepackSummary({ row }: { row: ProcessingRepackRecord }) {
  return <article className="min-w-0 rounded-xl border border-emerald-200 bg-white p-3"><div className="flex flex-wrap justify-between gap-2"><b className="break-words">Reenvasado de {row.sourceProductName}</b><span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-black">Confirmado · venta bloqueada</span></div><p className="mt-1 text-xs text-slate-600">{dateTime(row.confirmedAt)} · {row.responsibleName} · {row.location === 'central' ? 'Almacén central' : row.location}</p><p className="mt-2 text-xs">Lote origen {row.sourceLotId} · reserva {row.reservationId} · {formatQty(row.openedCommercialQuantity, row.sourceUnitType)} · {row.openedPhysicalWeightG} g · costo {money(row.sourceCostCents)}</p><div className="mt-2 space-y-2">{row.outputLots.map(output => <p key={output.lotId} className="break-words rounded-lg bg-slate-50 p-2 text-xs">{output.productName} · lote {output.lotCode} · {formatQty(output.commercialQuantity, output.commercialUnit)} · {output.netWeightG} g · costo {money(output.costCents)}</p>)}</div><p className="mt-2 break-all text-[10px] text-slate-500">Repack {row.id} · revisión {row.reviewId} · autorización {row.authorizationId} · movimientos {row.movementIds.join(', ')}</p><p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs font-bold text-amber-900">No es una revisión: el servidor confirma transacción, lotes y movimientos. La venta sigue bloqueada.</p></article>
}

function OutputEditor({ row, products, sourceManufacturedOn, update, remove, canRemove }: { row: OutputDraft; products: DistProduct[]; sourceManufacturedOn?: string; update: (patch: Partial<OutputDraft>) => void; remove: () => void; canRemove: boolean }) {
  const product = products.find(item => item.id === row.productId)
  return <article className="grid min-w-0 gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-2"><Field label="SKU de salida" required><SelectInput value={row.productId} onChange={event => update({ productId: event.target.value })}><option value="">Selecciona producto existente</option>{products.filter(item => item.active && !item.deleted).map(item => <option key={item.id} value={item.id}>{item.name} · {item.unitType}</option>)}</SelectInput></Field><Field label={`Cantidad comercial (${product?.unitType || 'unidad'})`} required><NumberInput min="0.001" step={product?.unitType === 'kg' ? '0.001' : '1'} value={row.commercialQuantity} onChange={event => update({ commercialQuantity: event.target.value })} /></Field><Field label="Peso neto real (g)" required><NumberInput min="0" step="1" value={row.measuredNetWeightG} onChange={event => update({ measuredNetWeightG: event.target.value })} /></Field><Field label="Código de lote" required><TextInput value={row.lotCode} onChange={event => update({ lotCode: event.target.value })} /></Field><Field label="Elaboración original" required hint="Se conserva la fecha del lote fuente."><TextInput type="date" value={sourceManufacturedOn || row.manufacturedOn} readOnly disabled /></Field><Field label="Fecha de reenvasado" required><TextInput type="date" value={row.packagedOn} onChange={event => update({ packagedOn: event.target.value })} /></Field><Field label="Vencimiento" required hint="No puede superar el vencimiento del origen."><TextInput type="date" value={row.expiresOn} onChange={event => update({ expiresOn: event.target.value })} /></Field>{canRemove && <button type="button" className="min-h-11 text-left text-xs font-bold text-rose-700" onClick={remove}>Quitar presentación</button>}</article>
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="min-w-0 rounded-lg border border-slate-200 p-2"><span className="block text-[10px] font-bold uppercase text-slate-500">{label}</span><b className="break-words text-sm">{value}</b></div> }
function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) { return <div role="alert" className="mt-2 flex min-w-0 gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900"><AlertTriangle size={17} className="mt-0.5 shrink-0" /><span className="min-w-0 break-words">{message}{onRetry && <button type="button" className="ml-2 font-bold underline" onClick={onRetry}>Reintentar</button>}</span></div> }
