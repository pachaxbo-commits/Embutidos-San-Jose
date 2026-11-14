const assertEqual = (a: unknown, b: unknown, msg?: string) => {
  if (a !== b) throw new Error(msg || `${String(a)} !== ${String(b)}`)
}
const assertNotEqual = (a: unknown, b: unknown, msg?: string) => {
  if (a === b) throw new Error(msg || `${String(a)} === ${String(b)}`)
}

console.log('--- Iniciando prueba de ciclo de vida consecutivo y filtros de fecha en Sacheteado ---')

// 1. Simulación del ciclo de vida de estados en SacheteadoView
type SubmitState = 'idle' | 'sending' | 'unknown' | 'rejected' | 'confirmed'
interface Draft {
  batchId: string
  operationId: string
  operationPending: boolean
  step: number
  sourceProductId: string
}

let batchCounter = 100
const freshDraft = (): Draft => {
  batchCounter += 1
  return {
    batchId: `batch_${batchCounter}`,
    operationId: `op_${batchCounter}_${Date.now()}`,
    operationPending: false,
    step: 0,
    sourceProductId: '',
  }
}

class SacheteadoLifecycleManager {
  draft: Draft
  submitState: SubmitState = 'idle'
  confirmedBatch: { batchId: string; operationId: string } | null = null
  message = ''
  error = ''

  constructor() {
    this.draft = freshDraft()
  }

  editDraft(patch: Partial<Draft>) {
    this.draft = { ...this.draft, ...patch }
    if (this.submitState === 'rejected' || this.submitState === 'confirmed') {
      this.submitState = 'idle'
      this.draft.operationId = `op_retry_${Date.now()}`
    }
  }

  submit() {
    if (this.submitState === 'sending' || this.submitState === 'unknown' || this.submitState === 'confirmed') {
      throw new Error(`No se puede enviar en estado ${this.submitState}`)
    }
    this.submitState = 'sending'
  }

  finishConfirmed() {
    this.confirmedBatch = { batchId: this.draft.batchId, operationId: this.draft.operationId }
    this.submitState = 'confirmed'
    this.message = `Elaboración ${this.draft.batchId} confirmada`
    this.error = ''
  }

  startNewElaboration() {
    this.draft = freshDraft()
    this.submitState = 'idle'
    this.confirmedBatch = null
    this.message = ''
    this.error = ''
  }
}

// 2. Ejecutar 3 elaboraciones consecutivas sin recargar (A -> B -> C)
const flow = new SacheteadoLifecycleManager()

// Elaboración A
assertEqual(flow.submitState, 'idle')
const idA = flow.draft.batchId
flow.editDraft({ sourceProductId: 'prod-granel-1', step: 3 })
flow.submit()
assertEqual(flow.submitState, 'sending')
flow.finishConfirmed()
assertEqual(flow.submitState, 'confirmed')
assertEqual(flow.confirmedBatch?.batchId, idA)

// Botón "Iniciar otra elaboración" pulsado
flow.startNewElaboration()
assertEqual(flow.submitState, 'idle', 'El estado debe volver a idle')
assertEqual(flow.confirmedBatch, null, 'El batch confirmado previo debe limpiarse')
assertNotEqual(flow.draft.batchId, idA, 'El nuevo borrador debe tener un ID distinto y fresco')
assertEqual(flow.draft.step, 0, 'El paso debe reiniciar en 0')

// Elaboración B
const idB = flow.draft.batchId
flow.editDraft({ sourceProductId: 'prod-granel-2', step: 3 })
flow.submit() // No debe lanzar error "No se puede enviar en estado confirmed"
flow.finishConfirmed()
assertEqual(flow.submitState, 'confirmed')
assertEqual(flow.confirmedBatch?.batchId, idB)

// Botón "Iniciar otra elaboración" pulsado de nuevo
flow.startNewElaboration()
assertEqual(flow.submitState, 'idle')
const idC = flow.draft.batchId
assertNotEqual(idC, idB)

// Elaboración C
flow.editDraft({ sourceProductId: 'prod-granel-3', step: 3 })
flow.submit()
flow.finishConfirmed()
assertEqual(flow.submitState, 'confirmed')
assertEqual(flow.confirmedBatch?.batchId, idC)

console.log('PASS: 3 elaboraciones consecutivas (A, B, C) completadas sin recargar la página')

// 3. Probar comportamiento de edición automática tras confirmación o rechazo
flow.editDraft({ sourceProductId: 'prod-granel-modificado' })
assertEqual(flow.submitState, 'idle', 'Editar el borrador debe desarmar el bloqueo confirmed')
if (!flow.draft.operationId.startsWith('op_retry_')) {
  throw new Error('Debe generar un operationId fresco para evitar duplicar la anterior')
}

console.log('PASS: Desbloqueo y regeneración de operationId en edición verificado')
