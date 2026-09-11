import { Capacitor } from '@capacitor/core'
import PachaxBluetoothPermissions, { type BluetoothPermissionValue } from '../../plugins/pachaxBluetoothPermissions'
import PachaxBluetoothPrinter from '../../plugins/pachaxBluetoothPrinter'

export interface BluetoothDiagnosticState {
  isNativeAndroid: boolean
  apiLevel: number
  isPluginAvailable: boolean
  isBluetoothEnabled: boolean
  bluetoothConnectPermission: BluetoothPermissionValue
  bluetoothScanPermission: BluetoothPermissionValue
  message: string
}

export class AndroidBluetoothPermissionsService {
  /** Check complete native diagnostic status including Android API level & BLUETOOTH_CONNECT */
  static async checkDiagnosticState(): Promise<BluetoothDiagnosticState> {
    const isNativeAndroid = Capacitor.getPlatform() === 'android'
    const btSerial = (window as any).bluetoothSerial
    const isPluginAvailable = Capacitor.isPluginAvailable('PachaxBluetoothPrinter') || Boolean(btSerial)

    let apiLevel = 0
    let bluetoothConnectPermission: BluetoothPermissionValue = 'notRequired'
    let bluetoothScanPermission: BluetoothPermissionValue = 'notRequired'

    if (isNativeAndroid) {
      try {
        const permStatus = await PachaxBluetoothPermissions.checkPermissions()
        apiLevel = permStatus.apiLevel
        bluetoothConnectPermission = permStatus.bluetoothConnect
        bluetoothScanPermission = permStatus.bluetoothScan
      } catch (e) {
        // Fallback
      }
    }

    let isBluetoothEnabled = false
    if (isNativeAndroid && Capacitor.isPluginAvailable('PachaxBluetoothPrinter')) {
      try {
        isBluetoothEnabled = (await PachaxBluetoothPrinter.getState()).enabled
      } catch {
        isBluetoothEnabled = false
      }
    } else if (btSerial && typeof btSerial.isEnabled === 'function') {
      isBluetoothEnabled = await new Promise<boolean>((resolve) => {
        btSerial.isEnabled(
          () => resolve(true),
          () => resolve(false)
        )
      })
    }

    let message = 'Bluetooth listo.'
    if (!isNativeAndroid) {
      message = 'Ejecutando en entorno Web / Dev (Bridge simulado activo).'
    } else if (!isPluginAvailable) {
      message = 'Objeto window.bluetoothSerial no inyectado en el WebLayer.'
    } else if (apiLevel >= 31 && bluetoothConnectPermission === 'denied') {
      message = 'Se requiere el permiso Dispositivos Cercanos (BLUETOOTH_CONNECT). Presiona "Solicitar Permiso".'
    } else if (apiLevel >= 31 && bluetoothConnectPermission === 'permanentlyDenied') {
      message = 'El permiso fue denegado permanentemente. Presiona "Abrir Configuración" para otorgarlo.'
    } else if (!isBluetoothEnabled) {
      message = 'El Bluetooth está apagado en tu teléfono. Presiona "Encender Bluetooth".'
    } else {
      message = 'Bluetooth nativo encendido y permisos concedidos.'
    }

    return {
      isNativeAndroid,
      apiLevel,
      isPluginAvailable,
      isBluetoothEnabled,
      bluetoothConnectPermission,
      bluetoothScanPermission,
      message,
    }
  }

  /** Trigger native Android runtime permission dialog for BLUETOOTH_CONNECT */
  static async requestConnectPermission(): Promise<BluetoothDiagnosticState> {
    if (Capacitor.getPlatform() === 'android') {
      try {
        await PachaxBluetoothPermissions.requestConnectPermission()
      } catch (e) {
        // Fallback
      }
    }
    return await this.checkDiagnosticState()
  }

  /** Open system App Settings screen for PACHAX Flow */
  static async openAppSettings(): Promise<void> {
    if (Capacitor.getPlatform() === 'android') {
      try {
        await PachaxBluetoothPermissions.openAppSettings()
        return
      } catch (e) {
        // Fallback
      }
    }
    const btSerial = (window as any).bluetoothSerial
    if (btSerial && typeof btSerial.showBluetoothSettings === 'function') {
      btSerial.showBluetoothSettings()
    }
  }

  /** Trigger native Bluetooth enable dialog */
  static async enableBluetooth(): Promise<boolean> {
    const btSerial = (window as any).bluetoothSerial
    if (!btSerial || typeof btSerial.enable !== 'function') return false

    return new Promise((resolve) => {
      btSerial.enable(
        () => resolve(true),
        () => resolve(false)
      )
    })
  }
}
