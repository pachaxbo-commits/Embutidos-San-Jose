import { Capacitor } from '@capacitor/core'
import PachaxTcpSocket, { type TestConnectionResult } from '../../plugins/pachaxTcpSocket'
import type {
  ErrorClassification,
  PrinterAdapter,
  PrinterConnectionType,
  PrinterProfile,
  PrintResult,
  PrintTransportPayload,
} from '../../types/printing'

/** Helper for IPv4 or Hostname validation */
export function isValidIpOrHost(host?: string): boolean {
  if (!host || typeof host !== 'string') return false
  const trimmed = host.trim()
  if (trimmed.length === 0) return false

  // IPv4 regex check
  if (/^[\d.]+$/.test(trimmed)) {
    const octets = trimmed.split('.')
    return octets.length === 4 && octets.every(o => /^\d{1,3}$/.test(o) && Number(o) <= 255)
  }

  // Hostname regex check
  const hostRegex = /^([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])(\.([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9]))*$/
  return trimmed.includes('.') && hostRegex.test(trimmed)
}

/** Helper for Port range validation */
export function isValidPort(port?: number): boolean {
  if (typeof port !== 'number' || Number.isNaN(port)) return false
  return Number.isInteger(port) && port >= 1 && port <= 65535
}

/** Convert Uint8Array to Base64 string safely */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

export class AndroidNetworkTcpPrinterAdapter implements PrinterAdapter {
  connectionType: PrinterConnectionType = 'network_tcp'
  private activeConnectionId: string | null = null

  isNativeAndroid(): boolean {
    return Capacitor.getPlatform() === 'android'
  }

  getActiveConnectionId(): string | null {
    return this.activeConnectionId
  }

  async isAvailable(): Promise<boolean> {
    return true
  }

  /** Standalone test connection without printing paper */
  async testConnection(host: string, port = 9100, timeoutMs = 3000): Promise<TestConnectionResult> {
    if (!isValidIpOrHost(host)) {
      return { connected: false, errorType: 'invalid_address', message: `Dirección IP o Host inválido: ${host}` }
    }
    if (!isValidPort(port)) {
      return { connected: false, errorType: 'invalid_address', message: `Puerto de red inválido: ${port}` }
    }

    try {
      return await PachaxTcpSocket.testConnection({ host: host.trim(), port, timeoutMs })
    } catch (err: any) {
      return { connected: false, errorType: 'unknown', message: `Error al probar conexión TCP: ${err.message}` }
    }
  }

  /** Connect raw TCP socket to printer IP and Port */
  async connect(printer: PrinterProfile): Promise<void> {
    const host = printer.ipAddress
    const port = printer.port || 9100

    if (!isValidIpOrHost(host)) {
      const err: any = new Error(`[AndroidNetworkTcpPrinterAdapter] Dirección IP o Host inválido: ${host || 'Faltante'}`)
      err.classification = 'safeToRetry' as ErrorClassification
      throw err
    }

    if (!isValidPort(port)) {
      const err: any = new Error(`[AndroidNetworkTcpPrinterAdapter] Puerto de impresora TCP inválido: ${port}`)
      err.classification = 'safeToRetry' as ErrorClassification
      throw err
    }

    try {
      const res = await PachaxTcpSocket.connect({
        host: host!.trim(),
        port,
        timeoutMs: printer.capabilities.connectionTimeoutMs || 5000,
      })
      this.activeConnectionId = res.connectionId
    } catch (err: any) {
      const error: any = new Error(`[AndroidNetworkTcpPrinterAdapter] No se pudo conectar con la impresora LAN (${host}:${port}): ${err.message || err}`)
      error.classification = 'safeToRetry' as ErrorClassification
      throw error
    }
  }

  /** Disconnect active TCP socket */
  async disconnect(): Promise<void> {
    if (this.activeConnectionId) {
      try {
        await PachaxTcpSocket.disconnect({ connectionId: this.activeConnectionId })
      } catch (e) {
        // Ignore disconnect errors
      }
      this.activeConnectionId = null
    }
  }

  /** Transmits raw ESC/POS bytes over TCP LAN socket in chunks */
  async sendBytes(payload: PrintTransportPayload): Promise<PrintResult> {
    const { bytes, printer } = payload
    if (!this.activeConnectionId) {
      return {
        success: false,
        bytesWritten: 0,
        errorClassification: 'safeToRetry',
        errorMessage: '[AndroidNetworkTcpPrinterAdapter] Socket TCP no conectado antes de transmitir',
      }
    }

    const chunkSize = printer.capabilities.chunkSize || 1024
    const chunkDelayMs = printer.capabilities.chunkDelayMs || 10
    const totalBytes = bytes.length
    let sentBytes = 0
    let chunksSent = 0

    // Split array into chunks
    const chunks: Uint8Array[] = []
    for (let i = 0; i < totalBytes; i += chunkSize) {
      chunks.push(bytes.slice(i, i + chunkSize))
    }

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      const bytesBase64 = uint8ArrayToBase64(chunk)

      try {
        await PachaxTcpSocket.write({
          connectionId: this.activeConnectionId,
          bytesBase64,
        })

        sentBytes += chunk.length
        chunksSent++

        if (chunkDelayMs > 0 && i < chunks.length - 1) {
          await new Promise((r) => setTimeout(r, chunkDelayMs))
        }
      } catch (err: any) {
        // IF error occurs BEFORE sending chunk 1 (chunksSent === 0) -> safeToRetry
        // IF error occurs DURING or AFTER chunk 1 (chunksSent > 0) -> unsafeToRetry -> UNKNOWN
        const classification: ErrorClassification = chunksSent === 0 ? 'safeToRetry' : 'unsafeToRetry'
        this.activeConnectionId = null // Invalidated

        return {
          success: false,
          bytesWritten: sentBytes,
          errorClassification: classification,
          errorMessage: `[AndroidNetworkTcpPrinterAdapter] Error escribiendo bloque TCP ${chunksSent + 1}/${chunks.length} (${sentBytes}/${totalBytes} bytes enviados): ${err.message}`,
        }
      }
    }

    return {
      success: true,
      bytesWritten: sentBytes,
      hardwareConfirmed: false,
    }
  }
}
