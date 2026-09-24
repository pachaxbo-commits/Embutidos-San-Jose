import type { InstalledAndroidVersion } from './nativePlugin'
import { SanJoseUpdaterNative } from './nativePlugin'
import { hasNewerAndroidVersion, parseAndroidUpdateManifest, type AndroidUpdateManifest } from './updateManifest'

export const UPDATE_MANIFEST_URL = 'https://pachax-flow.web.app/updates/san-jose/update.json'
const LAST_CHECK_KEY = 'san-jose:android-updater:last-check-v1'
const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const MAX_MANIFEST_BYTES = 64 * 1024

export interface UpdateCheckResult {
  installed: InstalledAndroidVersion
  manifest: AndroidUpdateManifest | null
  updateAvailable: boolean
  skippedByCache: boolean
}

export async function checkAndroidUpdate(manual = false): Promise<UpdateCheckResult> {
  const installed = await SanJoseUpdaterNative.getInstalledVersion()
  if (!manual) {
    const previous = Number(localStorage.getItem(LAST_CHECK_KEY) || 0)
    if (Number.isFinite(previous) && Date.now() - previous < AUTO_CHECK_INTERVAL_MS) {
      return { installed, manifest: null, updateAvailable: false, skippedByCache: true }
    }
  }

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 15_000)
  let manifestText: string
  try {
    const response = await fetch(`${UPDATE_MANIFEST_URL}?consulta=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`No se pudo consultar el servidor de actualizaciones (${response.status}).`)
    manifestText = await response.text()
  } catch (error) {
    if (controller.signal.aborted) throw new Error('El servidor de actualizaciones tardó demasiado en responder.', { cause: error })
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
  if (new TextEncoder().encode(manifestText).byteLength > MAX_MANIFEST_BYTES) throw new Error('El manifiesto de actualización es demasiado grande.')
  let manifestValue: unknown
  try { manifestValue = JSON.parse(manifestText) } catch { throw new Error('El servidor devolvió un manifiesto que no es JSON válido.') }
  const manifest = parseAndroidUpdateManifest(manifestValue)
  localStorage.setItem(LAST_CHECK_KEY, String(Date.now()))
  return { installed, manifest, updateAvailable: hasNewerAndroidVersion(installed.versionCode, manifest), skippedByCache: false }
}
