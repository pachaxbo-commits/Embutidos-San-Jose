import type {
  IndependentDrawerKickInput,
  KitchenStation,
  PrinterAdapter,
  PrinterProfile,
  PrintJob,
  PrintJobPayload,
  PrintJobResolution,
  PrintJobStorage,
  PrintJobTarget,
  RequestReprintInput,
  SubmitPrintRequestInput,
} from '../../types/printing'
import { getFirebaseRestaurantId } from '../../lib/firebase'
import { DiagnosticPrinterAdapter } from './diagnosticPrinterAdapter'
import { PrintQueueManager } from './printQueueManager'

export class PrintEngineService {
  private static instance: PrintEngineService | null = null
  public queueManager: PrintQueueManager
  private printers = new Map<string, PrinterProfile>()
  private stations = new Map<string, KitchenStation>()

  private constructor(storage?: PrintJobStorage) {
    this.queueManager = new PrintQueueManager(storage)
    // Register default diagnostic mock adapter
    this.queueManager.registerAdapter(new DiagnosticPrinterAdapter('success_transmitted'))
  }

  public static getInstance(storage?: PrintJobStorage): PrintEngineService {
    if (!PrintEngineService.instance) {
      PrintEngineService.instance = new PrintEngineService(storage)
    }
    return PrintEngineService.instance
  }

  registerPrinterProfile(printer: PrinterProfile): void {
    this.printers.set(printer.id, printer)
  }

  registerKitchenStation(station: KitchenStation): void {
    this.stations.set(station.id, station)
  }

  registerAdapter(adapter: PrinterAdapter): void {
    this.queueManager.registerAdapter(adapter)
  }

  getPrinterProfile(id: string): PrinterProfile | undefined {
    return this.printers.get(id)
  }

  listPrinterProfiles(): PrinterProfile[] {
    return Array.from(this.printers.values()).filter(p => p.restaurantId === getFirebaseRestaurantId())
  }

  /** Resolves destination printer for target or station */
  resolveDestinationPrinters(targetType: PrintJobTarget, stationId?: string): { primary: PrinterProfile; backup?: PrinterProfile } {
    if (stationId && this.stations.has(stationId)) {
      const station = this.stations.get(stationId)!
      const primary = this.printers.get(station.primaryPrinterId)
      const backup = station.backupPrinterId ? this.printers.get(station.backupPrinterId) : undefined
      if (primary) return { primary, backup }
    }

    // Default lookup by role
    const activePrinters = this.listPrinterProfiles().filter((p) => p.isActive)
    const roleMatch = activePrinters.find((p) => p.role === (targetType === 'kitchen_ticket' ? 'kitchen' : 'receipt'))
    const fallback = roleMatch || activePrinters[0] || this.createDefaultFallbackProfile()

    return { primary: fallback }
  }

  private createDefaultFallbackProfile(): PrinterProfile {
    return {
      id: 'default-diagnostic',
      restaurantId: 'principal',
      branchId: 'main',
      name: 'Impresora Diagnostico Virtual',
      role: 'general',
      connectionType: 'virtual_pdf',
      paperWidth: '80mm',
      copies: 1,
      autoPrintOnOrderCreated: true,
      autoPrintOnOrderPaid: true,
      kickDrawerOnPrint: true,
      isActive: true,
      createdAt: new Date().toISOString(),
      capabilities: {
        supportsCashDrawerKick: true,
        supportsPaperCut: true,
        supportsBeep: true,
        supportsBarcode: true,
        supportsQrCode: true,
        supportsImages: true,
        supportsRealtimeStatus: false,
        columnsPerLine: 48,
        codePage: 'CP850',
        encoding: 'utf-8',
        chunkSize: 1024,
        chunkDelayMs: 50,
        connectionTimeoutMs: 5000,
        writeTimeoutMs: 5000,
        feedLinesEnd: 3,
      },
    }
  }

  /** Main entry point for submitting any print request */
  async submitPrintRequest(input: SubmitPrintRequestInput): Promise<PrintJob> {
    const selected = input.printerProfileId ? this.printers.get(input.printerProfileId) : undefined
    const { primary, backup } = selected ? { primary: selected, backup: undefined } : this.resolveDestinationPrinters(input.targetType, input.stationId)
    if (primary.id === 'default-diagnostic') throw new Error('Configura una impresora real antes de imprimir.')
    const adapter = this.queueManager.getAdapter(primary.connectionType)
    if (!adapter) throw new Error('No hay un adaptador disponible para esta impresora.')
    const job = await this.queueManager.submitJob(input, primary, backup)

    // Attempt processing immediately if lease acquired
    const acquired = await this.queueManager.acquireLease(job.id)
    if (acquired) {
      return await this.queueManager.processJob(job.id, adapter, primary, backup)
    }

    return job
  }

  /** Trigger independent cash drawer kick action */
  async kickCashDrawer(input: IndependentDrawerKickInput): Promise<PrintJob> {
    const payload: PrintJobPayload = {
      payloadSchemaVersion: 1,
      templateVersion: 'v1.0',
      restaurantName: 'PACHAX Flow',
      branchName: 'Sucursal Central',
      items: [],
      subtotal: 0,
      discountTotal: 0,
      taxTotal: 0,
      deliveryFee: 0,
      grandTotal: 0,
      isCopy: false,
      customMessage: `Apertura de gaveta por usuario: ${input.userUid} | Motivo: ${input.reason}`,
      copies: 1,
      createdIso: new Date().toISOString(),
    }

    return await this.submitPrintRequest({
      targetType: 'drawer_kick',
      payload,
      idempotencyKey: `drawer:${input.terminalId}:${Date.now()}`,
    })
  }

  /** Request authorized reprint creating a copy ticket */
  async requestReprint(input: RequestReprintInput, originalJob: PrintJob): Promise<PrintJob> {
    const printer = this.printers.get(originalJob.printerProfileId) || this.createDefaultFallbackProfile()
    return await this.queueManager.requestReprint(input, originalJob, printer)
  }

  /** Resolve manual status on an unknown job */
  async resolveUnknownJob(jobId: string, resolution: PrintJobResolution): Promise<PrintJob> {
    return await this.queueManager.resolveUnknownJob(jobId, resolution)
  }

  /** Bootstrap queue recovery on app startup */
  async bootstrap(): Promise<PrintJob[]> {
    return await this.queueManager.bootstrapRecovery()
  }
}
