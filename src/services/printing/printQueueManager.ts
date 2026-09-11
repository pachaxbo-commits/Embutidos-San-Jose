import type {
  ErrorClassification,
  PrinterAdapter,
  PrinterProfile,
  PrintJob,
  PrintJobPayload,
  PrintJobResolution,
  PrintJobStorage,
  RequestReprintInput,
  SubmitPrintRequestInput,
} from '../../types/printing'
import { IndexedDbPrintJobStorage } from './printJobStorage'
import { buildReceiptBytes } from './templates/receiptTemplate'
import { buildKitchenTicketBytes } from './templates/kitchenTicketTemplate'
import { EscPosBuilder } from './escPosFormatter'

const LEASE_DURATION_MS = 15000 // 15s lease duration

export class PrintQueueManager {
  private storage: PrintJobStorage
  private adapters = new Map<string, PrinterAdapter>()
  public readonly terminalId: string
  public readonly instanceId: string

  constructor(storage?: PrintJobStorage, terminalId?: string) {
    this.storage = storage || new IndexedDbPrintJobStorage()
    this.terminalId = terminalId || `term-${Math.random().toString(36).substring(2, 9)}`
    this.instanceId = `inst-${Math.random().toString(36).substring(2, 9)}`
  }

  registerAdapter(adapter: PrinterAdapter): void {
    this.adapters.set(adapter.connectionType, adapter)
  }

  getAdapter(connectionType: string): PrinterAdapter | undefined {
    return this.adapters.get(connectionType)
  }

  /** Submits a new print job enforcing idempotency and tenant boundaries */
  async submitJob(
    input: SubmitPrintRequestInput,
    primaryPrinter: PrinterProfile,
    backupPrinter?: PrinterProfile
  ): Promise<PrintJob> {
    const idempotencyKey = input.idempotencyKey || `${input.targetType}:${input.payload.orderId || 'noorder'}:${Date.now()}`

    // Deduplication check
    const existing = await this.storage.get(idempotencyKey)
    if (existing) {
      if (['transmitted', 'confirmed', 'processing', 'transmitting', 'unknown', 'resolved'].includes(existing.status)) {
        return existing
      }
    }

    const nowIso = new Date().toISOString()
    const job: PrintJob = {
      id: idempotencyKey,
      jobId: `job-${Math.random().toString(36).substring(2, 9)}`,
      idempotencyKey,
      restaurantId: primaryPrinter.restaurantId || 'principal',
      branchId: primaryPrinter.branchId || 'main',
      terminalId: this.terminalId,
      targetType: input.targetType,
      printerProfileId: primaryPrinter.id,
      backupPrinterProfileId: backupPrinter?.id,
      connectionType: primaryPrinter.connectionType,
      status: 'queued',
      payloadSchemaVersion: 1,
      templateVersion: 'v1.0',
      payload: input.payload,
      sanitizedPayload: { ...input.payload, customerPhone: undefined, deliveryAddress: undefined },
      attempts: 0,
      maxAttempts: primaryPrinter.copies || 3,
      queuedAtIso: nowIso,
    }

    await this.storage.save(job)
    return job
  }

  /** Tries to acquire processor instance lease on a job */
  async acquireLease(jobId: string): Promise<boolean> {
    const job = await this.storage.get(jobId)
    if (!job) return false

    const now = Date.now()
    const isLeaseExpired = job.leaseExpiresAtIso ? new Date(job.leaseExpiresAtIso).getTime() < now : true

    if (job.lockedByInstanceId && job.lockedByInstanceId !== this.instanceId && !isLeaseExpired) {
      return false // Another instance currently holds valid lease
    }

    // Do NOT auto-take an unknown state job
    if (['unknown', 'transmitted', 'confirmed', 'resolved'].includes(job.status)) {
      return false
    }

    const leaseExpires = new Date(now + LEASE_DURATION_MS).toISOString()
    await this.storage.update(jobId, {
      status: 'processing',
      lockedByInstanceId: this.instanceId,
      processorInstanceId: this.instanceId,
      lockedAtIso: new Date(now).toISOString(),
      leaseExpiresAtIso: leaseExpires,
    })
    return true
  }

  /** Heartbeat lease renewal */
  async renewLease(jobId: string): Promise<void> {
    const job = await this.storage.get(jobId)
    if (job && job.lockedByInstanceId === this.instanceId) {
      const leaseExpires = new Date(Date.now() + LEASE_DURATION_MS).toISOString()
      await this.storage.update(jobId, { leaseExpiresAtIso: leaseExpires })
    }
  }

  /** Executes an acquired job through adapter pipeline */
  async processJob(jobId: string, adapter: PrinterAdapter, printer: PrinterProfile, backupPrinter?: PrinterProfile): Promise<PrintJob> {
    const job = await this.storage.get(jobId)
    if (!job) throw new Error(`Trabajo de impresion ${jobId} no encontrado`)

    await this.storage.update(jobId, { status: 'formatting', startedAtIso: new Date().toISOString() })

    // Build raw ESC/POS bytes according to targetType
    let bytes: Uint8Array
    if (job.targetType === 'kitchen_ticket') {
      bytes = buildKitchenTicketBytes(job.payload, printer.paperWidth)
    } else if (job.targetType === 'drawer_kick') {
      bytes = new EscPosBuilder().init().kickCashDrawer(printer.capabilities.drawerPin || 'pin2').build()
    } else {
      bytes = buildReceiptBytes(job.payload, printer.paperWidth, printer.capabilities.supportsPaperCut)
    }

    // Store base64 bytes for debug/transmission
    const base64Bytes = btoa(String.fromCharCode(...bytes))
    await this.storage.update(jobId, {
      rawBytesBase64: base64Bytes,
      status: 'connecting',
      attempts: job.attempts + 1,
    })

    try {
      await adapter.connect(printer)
      await this.storage.update(jobId, { status: 'transmitting' })

      const result = await adapter.sendBytes({ jobId: job.id, bytes, printer })
      await adapter.disconnect()

      if (result.success) {
        const terminalState = result.hardwareConfirmed ? 'confirmed' : 'transmitted'
        const nowIso = new Date().toISOString()

        await this.storage.update(jobId, {
          status: terminalState,
          transmittedAtIso: nowIso,
          confirmedAtIso: result.hardwareConfirmed ? nowIso : undefined,
          rawBytesBase64: undefined, // Purge raw bytes upon success for privacy & storage
          lockedByInstanceId: undefined,
          leaseExpiresAtIso: undefined,
        })
        return (await this.storage.get(jobId))!
      } else {
        return await this.handleProcessError(job, result.errorMessage || 'Error en transmision', result.errorClassification || 'unsafeToRetry', backupPrinter, adapter)
      }
    } catch (err: any) {
      try { await adapter.disconnect() } catch {}
      const classification: ErrorClassification = err.classification || 'safeToRetry'
      return await this.handleProcessError(job, err.message || 'Error de adaptador', classification, backupPrinter, adapter)
    }
  }

  /** Classifies error and evaluates safe retries & conditional backup failover */
  private async handleProcessError(
    job: PrintJob,
    errorMsg: string,
    classification: ErrorClassification,
    backupPrinter?: PrinterProfile,
    _adapter?: PrinterAdapter
  ): Promise<PrintJob> {
    const nowIso = new Date().toISOString()

    // IF error occurred during transmission (unsafeToRetry), move directly to UNKNOWN state
    if (classification === 'unsafeToRetry' || classification === 'requiresOperatorDecision' || job.status === 'transmitting') {
      await this.storage.update(job.id, {
        status: 'unknown',
        lastError: errorMsg,
        lastErrorClassification: classification,
        lockedByInstanceId: undefined,
        leaseExpiresAtIso: undefined,
      })
      return (await this.storage.get(job.id))!
    }

    // IF error is safeToRetry and backupPrinter exists, attempt failover ONLY before transmit
    if (classification === 'safeToRetry' && backupPrinter && job.printerProfileId !== backupPrinter.id) {
      await this.storage.update(job.id, {
        printerProfileId: backupPrinter.id,
        connectionType: backupPrinter.connectionType,
        lastError: `Failover a impresora de respaldo: ${errorMsg}`,
        lastErrorClassification: 'safeToRetry',
        status: 'queued',
      })
      return (await this.storage.get(job.id))!
    }

    // Retrying vs Failed
    if (job.attempts < job.maxAttempts) {
      await this.storage.update(job.id, {
        status: 'retrying',
        lastError: errorMsg,
        lastErrorClassification: classification,
        lockedByInstanceId: undefined,
      })
    } else {
      await this.storage.update(job.id, {
        status: 'failed',
        failedAtIso: nowIso,
        lastError: errorMsg,
        lastErrorClassification: classification,
        lockedByInstanceId: undefined,
      })
    }

    return (await this.storage.get(job.id))!
  }

  /** Allows operator manual resolution of an unknown state job */
  async resolveUnknownJob(jobId: string, resolution: PrintJobResolution): Promise<PrintJob> {
    const job = await this.storage.get(jobId)
    if (!job) throw new Error(`Trabajo ${jobId} no encontrado`)

    await this.storage.update(jobId, {
      status: 'resolved',
      resolution,
      resolvedAtIso: new Date().toISOString(),
      lockedByInstanceId: undefined,
    })

    return (await this.storage.get(jobId))!
  }

  /** Authorized reprint request generating a new COPY job */
  async requestReprint(input: RequestReprintInput, originalJob: PrintJob, printer: PrinterProfile): Promise<PrintJob> {
    const reprintReqId = `rep-${Date.now()}`
    const idempotencyKey = `reprint:${originalJob.id}:${reprintReqId}`

    const copyPayload: PrintJobPayload = {
      ...originalJob.payload,
      isCopy: true,
      reprintReason: input.reason,
      reprintCount: (originalJob.payload.reprintCount || 0) + 1,
    }

    return await this.submitJob(
      {
        targetType: originalJob.targetType,
        payload: copyPayload,
        idempotencyKey,
        printerProfileId: printer.id,
      },
      printer
    )
  }

  /** Scans and recovers pending jobs for this terminal on app restart */
  async bootstrapRecovery(): Promise<PrintJob[]> {
    return await this.storage.listRecoverable(this.terminalId)
  }

  /** Purges old completed/cancelled jobs */
  async purgeOldJobs(daysToKeep = 7): Promise<number> {
    const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString()
    return await this.storage.purgeCompletedOlderThan(cutoff)
  }
}
