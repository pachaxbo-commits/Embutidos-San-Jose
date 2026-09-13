import type {
  ErrorClassification,
  PrinterAdapter,
  PrinterConnectionType,
  PrinterProfile,
  PrintResult,
  PrintTransportPayload,
} from '../../types/printing'

export type DiagnosticMockBehavior =
  | 'success_transmitted'
  | 'success_confirmed'
  | 'error_pre_transmit' // safeToRetry
  | 'error_during_transmit' // unsafeToRetry -> unknown
  | 'timeout'
  | 'ambiguous_unknown'
  | 'printer_unavailable'

export class DiagnosticPrinterAdapter implements PrinterAdapter {
  connectionType: PrinterConnectionType = 'virtual_pdf'
  public mockBehavior: DiagnosticMockBehavior = 'success_transmitted'
  public isConnected = false
  public lastSentPayload: PrintTransportPayload | null = null

  constructor(behavior: DiagnosticMockBehavior = 'success_transmitted') {
    this.mockBehavior = behavior
  }

  async isAvailable(): Promise<boolean> {
    return this.mockBehavior !== 'printer_unavailable'
  }

  async connect(_printer: PrinterProfile): Promise<void> {
    if (this.mockBehavior === 'printer_unavailable') {
      throw new Error('[DiagnosticAdapter] Impresora no disponible')
    }
    if (this.mockBehavior === 'error_pre_transmit') {
      const err: any = new Error('[DiagnosticAdapter] Fallo de conexion inicial pre-transmision')
      err.classification = 'safeToRetry' as ErrorClassification
      throw err
    }
    this.isConnected = true
  }

  async disconnect(): Promise<void> {
    this.isConnected = false
  }

  async sendBytes(payload: PrintTransportPayload): Promise<PrintResult> {
    this.lastSentPayload = payload

    if (this.mockBehavior === 'error_pre_transmit') {
      return {
        success: false,
        errorClassification: 'safeToRetry',
        errorMessage: '[DiagnosticAdapter] Error antes de transmitir bytes (Conexion rechazada)',
      }
    }

    if (this.mockBehavior === 'error_during_transmit') {
      return {
        success: false,
        errorClassification: 'unsafeToRetry',
        errorMessage: '[DiagnosticAdapter] Error a mitad de transmision de bytes (Conexion perdida)',
      }
    }

    if (this.mockBehavior === 'timeout') {
      return {
        success: false,
        errorClassification: 'unsafeToRetry',
        errorMessage: '[DiagnosticAdapter] Timeout de respuesta durante escritura',
      }
    }

    if (this.mockBehavior === 'ambiguous_unknown') {
      return {
        success: false,
        errorClassification: 'requiresOperatorDecision',
        errorMessage: '[DiagnosticAdapter] Estado ambiguo de canal de salida',
      }
    }

    if (this.mockBehavior === 'success_confirmed') {
      return {
        success: true,
        bytesWritten: payload.bytes.length,
        hardwareConfirmed: true,
      }
    }

    // Default: success_transmitted
    return {
      success: true,
      bytesWritten: payload.bytes.length,
      hardwareConfirmed: false,
    }
  }

  async discoverDevices(): Promise<Array<{ id: string; name: string; address?: string }>> {
    return [
      { id: 'mock-01', name: 'Impresora Virtual Diagnostico (80mm)', address: '00:11:22:33:44:55' },
      { id: 'mock-02', name: 'Impresora virtual de respaldo (58 mm)', address: '192.168.1.150' },
    ]
  }
}
