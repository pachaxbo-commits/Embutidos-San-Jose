import { Capacitor } from '@capacitor/core'
import { AndroidBluetoothPermissionsService, type BluetoothDiagnosticState } from '../../services/printing/androidBluetoothPermissionsService'
import PachaxBluetoothPrinter from '../../plugins/pachaxBluetoothPrinter'
import type {
  ErrorClassification,
  PrinterAdapter,
  PrinterConnectionType,
  PrinterProfile,
  PrintResult,
  PrintTransportPayload,
} from '../../types/printing'

export interface BluetoothPairedDevice {
  id: string
  name: string
  address: string
  class?: number
}

/** Convert Uint8Array to clean standalone ArrayBuffer for native BluetoothSerial.write() */
export function toCleanArrayBuffer(chunk: Uint8Array): ArrayBuffer {
  return chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer
}

export class AndroidBluetoothSppAdapter implements PrinterAdapter {
  connectionType: PrinterConnectionType = 'bluetooth_spp'
  private connectedDeviceAddress: string | null = null
  private isConnectedFlag = false

  getConnectedAddress(): string | null {
    return this.connectedDeviceAddress
  }

  isNativeAndroid(): boolean {
    return Capacitor.getPlatform() === 'android'
  }

  /** Checks whether bluetoothSerial native plugin object is available in window */
  isPluginAvailable(): boolean {
    return Capacitor.isPluginAvailable('PachaxBluetoothPrinter') || Boolean((window as any).bluetoothSerial)
  }

  async isAvailable(): Promise<boolean> {
    if (!this.isNativeAndroid()) return false
    return this.isPluginAvailable()
  }

  /** Complete Bluetooth Status Diagnostic */
  async checkDiagnosticState(): Promise<BluetoothDiagnosticState> {
    return await AndroidBluetoothPermissionsService.checkDiagnosticState()
  }

  /** Open system App Settings screen */
  async openSettings(): Promise<void> {
    await AndroidBluetoothPermissionsService.openAppSettings()
  }

  /** Enable Bluetooth via system prompt */
  async enableBluetooth(): Promise<boolean> {
    return await AndroidBluetoothPermissionsService.enableBluetooth()
  }

  /** List paired Bluetooth devices from Android OS Settings via window.bluetoothSerial.list() */
  async listPairedDevices(): Promise<BluetoothPairedDevice[]> {
    if (!this.isNativeAndroid()) return []

    if (Capacitor.isPluginAvailable('PachaxBluetoothPrinter')) {
      const result = await PachaxBluetoothPrinter.listPairedDevices()
      return result.devices
    }

    const btSerial = (window as any).bluetoothSerial
    if (!btSerial) {
      return [
        { id: '00:11:22:33:44:55', name: 'POS-58 (Emparejado Dev)', address: '00:11:22:33:44:55' },
        { id: 'AA:BB:CC:DD:EE:FF', name: 'POS-80 (Emparejado Dev)', address: 'AA:BB:CC:DD:EE:FF' },
      ]
    }

    return new Promise((resolve, reject) => {
      btSerial.list(
        (devices: any[]) => {
          const list: BluetoothPairedDevice[] = (devices || []).map((d) => ({
            id: d.address || d.id,
            name: d.name || 'Impresora Bluetooth',
            address: d.address || d.id,
            class: d.class,
          }))
          resolve(list)
        },
        (err: any) => reject(new Error(err?.message || 'Error al listar dispositivos emparejados'))
      )
    })
  }

  /** Connect to Bluetooth thermal printer via MAC address */
  async connect(printer: PrinterProfile): Promise<void> {
    const targetAddress = printer.macAddress || printer.ipAddress
    if (!targetAddress) {
      const err: any = new Error('[AndroidBluetoothSppAdapter] Falta la dirección MAC de la impresora')
      err.classification = 'safeToRetry' as ErrorClassification
      throw err
    }

    if (this.isNativeAndroid() && Capacitor.isPluginAvailable('PachaxBluetoothPrinter')) {
      try {
        await PachaxBluetoothPrinter.connect({ address: targetAddress })
        this.connectedDeviceAddress = targetAddress
        this.isConnectedFlag = true
        return
      } catch (nativeError: any) {
        const error: any = new Error(nativeError?.message || `No se pudo conectar a ${printer.name}`)
        error.classification = 'safeToRetry' as ErrorClassification
        throw error
      }
    }

    const btSerial = (window as any).bluetoothSerial
    if (!btSerial) {
      // Mock mode bridge when testing in web / dev environment
      this.connectedDeviceAddress = targetAddress
      this.isConnectedFlag = true
      return
    }

    return new Promise((resolve, reject) => {
      const timeoutTimer = setTimeout(() => {
        const err: any = new Error(`[AndroidBluetoothSppAdapter] Timeout (6s) conectando a ${targetAddress}`)
        err.classification = 'safeToRetry' as ErrorClassification
        reject(err)
      }, printer.capabilities.connectionTimeoutMs || 6000)

      btSerial.connect(
        targetAddress,
        () => {
          clearTimeout(timeoutTimer)
          this.connectedDeviceAddress = targetAddress
          this.isConnectedFlag = true
          resolve()
        },
        (err: any) => {
          clearTimeout(timeoutTimer)
          const error: any = new Error(`[AndroidBluetoothSppAdapter] No se pudo conectar a ${printer.name}: ${err?.message || err}`)
          error.classification = 'safeToRetry' as ErrorClassification
          reject(error)
        }
      )
    })
  }

  /** Disconnect from printer */
  async disconnect(): Promise<void> {
    if (this.isNativeAndroid() && Capacitor.isPluginAvailable('PachaxBluetoothPrinter')) {
      await PachaxBluetoothPrinter.disconnect().catch(() => undefined)
      this.connectedDeviceAddress = null
      this.isConnectedFlag = false
      return
    }
    const btSerial = (window as any).bluetoothSerial
    if (btSerial && this.isConnectedFlag) {
      await new Promise<void>((resolve) => {
        btSerial.disconnect(
          () => resolve(),
          () => resolve()
        )
      })
    }
    this.connectedDeviceAddress = null
    this.isConnectedFlag = false
  }

  /** Check active connection status */
  async isConnected(): Promise<boolean> {
    if (this.isNativeAndroid() && Capacitor.isPluginAvailable('PachaxBluetoothPrinter')) {
      return (await PachaxBluetoothPrinter.getState()).connected
    }
    const btSerial = (window as any).bluetoothSerial
    if (!btSerial) return this.isConnectedFlag

    return new Promise<boolean>((resolve) => {
      btSerial.isConnected(
        () => resolve(true),
        () => resolve(false)
      )
    })
  }

  /**
   * Transmits raw ESC/POS bytes in chunked ArrayBuffers to prevent buffer overflows on Bluetooth printers.
   */
  async sendBytes(payload: PrintTransportPayload): Promise<PrintResult> {
    const { bytes, printer } = payload
    const chunkSize = printer.capabilities.chunkSize || 256
    const chunkDelayMs = printer.capabilities.chunkDelayMs || 50
    const btSerial = (window as any).bluetoothSerial

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
      const arrayBufferToWrite = toCleanArrayBuffer(chunk)

      try {
        if (this.isNativeAndroid() && Capacitor.isPluginAvailable('PachaxBluetoothPrinter')) {
          let binary = ''
          for (const byte of chunk) binary += String.fromCharCode(byte)
          await PachaxBluetoothPrinter.write({ dataBase64: btoa(binary) })
        } else if (btSerial) {
          await new Promise<void>((resolve, reject) => {
            const timeoutTimer = setTimeout(() => {
              reject(new Error(`Timeout escribiendo bloque ${i + 1}/${chunks.length}`))
            }, printer.capabilities.writeTimeoutMs || 5000)

            btSerial.write(
              arrayBufferToWrite,
              () => {
                clearTimeout(timeoutTimer)
                resolve()
              },
              (err: any) => {
                clearTimeout(timeoutTimer)
                reject(new Error(err?.message || `Fallo al escribir bloque ${i + 1}`))
              }
            )
          })
        } else {
          // Dev mock delay
          await new Promise((r) => setTimeout(r, 10))
        }

        sentBytes += chunk.length
        chunksSent++

        if (chunkDelayMs > 0 && i < chunks.length - 1) {
          await new Promise((r) => setTimeout(r, chunkDelayMs))
        }
      } catch (err: any) {
        const classification: ErrorClassification = chunksSent === 0 ? 'safeToRetry' : 'unsafeToRetry'

        return {
          success: false,
          bytesWritten: sentBytes,
          errorClassification: classification,
          errorMessage: `[AndroidBluetoothSppAdapter] Error escribiendo bloque ${chunksSent + 1}/${chunks.length} (${sentBytes}/${totalBytes} bytes enviados): ${err.message}`,
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
