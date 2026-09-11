import { AndroidBluetoothSppAdapter } from '../../adapters/printing/androidBluetoothSppAdapter'
import { AndroidNetworkTcpPrinterAdapter } from '../../adapters/printing/androidNetworkTcpPrinterAdapter'
import { PrintEngineService } from './printEngineService'
import type { PrinterProfile } from '../../types/printing'

/**
 * Arranque del subsistema de impresion.
 *
 * Hasta ahora el motor solo tenia registrado el adaptador de diagnostico: como
 * `submitPrintRequest` cae en ese adaptador cuando no encuentra uno para el
 * tipo de conexion, cualquier impresion "funcionaba" sin llegar nunca a la
 * impresora. Aqui se registran los adaptadores reales y se recuperan los
 * perfiles guardados, que antes vivian solo en memoria y se perdian al
 * recargar la aplicacion.
 */

const PRINTER_PROFILES_KEY = 'pachax:printer-profiles'

let initialized = false

export function loadPrinterProfiles(): PrinterProfile[] {
  try {
    const raw = localStorage.getItem(PRINTER_PROFILES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as PrinterProfile[]) : []
  } catch {
    return []
  }
}

export function persistPrinterProfiles(profiles: PrinterProfile[]): void {
  try {
    localStorage.setItem(PRINTER_PROFILES_KEY, JSON.stringify(profiles))
  } catch {
    // Sin almacenamiento local la sesion sigue funcionando en memoria.
  }
}

/** Registra un perfil en el motor y lo deja persistido. */
export function savePrinterProfile(profile: PrinterProfile): void {
  const engine = PrintEngineService.getInstance()
  engine.registerPrinterProfile(profile)
  persistPrinterProfiles([...loadPrinterProfiles().filter(p => p.id !== profile.id), profile])
}

export function initializePrinting(): void {
  if (initialized) return
  initialized = true

  const engine = PrintEngineService.getInstance()

  // Adaptadores reales. El de diagnostico sigue registrado como respaldo.
  engine.registerAdapter(new AndroidBluetoothSppAdapter())
  engine.registerAdapter(new AndroidNetworkTcpPrinterAdapter())

  for (const profile of loadPrinterProfiles()) {
    engine.registerPrinterProfile(profile)
  }
}

/** Impresora de recibos activa, si hay alguna configurada. */
export function getActiveReceiptPrinter(): PrinterProfile | null {
  const profiles = PrintEngineService.getInstance().listPrinterProfiles()
  const active = profiles.filter((profile) => profile.isActive)
  return active.find((profile) => profile.role === 'receipt') ?? active[0] ?? null
}
