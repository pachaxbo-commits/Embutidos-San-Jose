import type { InstalledAndroidVersion } from './nativePlugin'
import { SanJoseUpdaterNative } from './nativePlugin'
import { hasNewerAndroidVersion, parseAndroidUpdateManifest, type AndroidUpdateManifest } from './updateManifest'

export const UPDATE_MANIFEST_URL = 'https://pachax-flow.web.app/updates/san-jose/update.json'
const KNOWN_UPDATE_KEY = 'san-jose:android-updater:known-update-v1'
const MAX_MANIFEST_BYTES = 64 * 1024

export interface UpdateCheckResult {
  installed: InstalledAndroidVersion
  manifest: AndroidUpdateManifest | null
  updateAvailable: boolean
  fromStoredManifest: boolean
  networkError?: string
}

export async function checkAndroidUpdate(manual = false): Promise<UpdateCheckResult> {
  const installed = await SanJoseUpdaterNative.getInstalledVersion()
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
    const networkError = controller.signal.aborted
      ? 'El servidor de actualizaciones tardó demasiado en responder.'
      : (error as Error).message || 'No se pudo consultar el servidor de actualizaciones.'
    if (!manual) {
      const stored = readKnownUpdate()
      if (stored && hasNewerAndroidVersion(installed.versionCode, stored)) {
        return { installed, manifest: stored, updateAvailable: true, fromStoredManifest: true, networkError }
      }
    }
    throw new Error(networkError, { cause: error })
  } finally {
    window.clearTimeout(timeout)
  }
  if (new TextEncoder().encode(manifestText).byteLength > MAX_MANIFEST_BYTES) throw new Error('El manifiesto de actualización es demasiado grande.')
  let manifestValue: unknown
  try { manifestValue = JSON.parse(manifestText) } catch { throw new Error('El servidor devolvió un manifiesto que no es JSON válido.') }
  const manifest = parseAndroidUpdateManifest(manifestValue)
  const updateAvailable = hasNewerAndroidVersion(installed.versionCode, manifest)
  if (updateAvailable) localStorage.setItem(KNOWN_UPDATE_KEY, JSON.stringify(manifest))
  else localStorage.removeItem(KNOWN_UPDATE_KEY)
  return { installed, manifest, updateAvailable, fromStoredManifest: false }
}

export function readKnownUpdate(): AndroidUpdateManifest | null {
  try {
    const raw = localStorage.getItem(KNOWN_UPDATE_KEY)
    return raw ? parseAndroidUpdateManifest(JSON.parse(raw)) : null
  } catch {
    localStorage.removeItem(KNOWN_UPDATE_KEY)
    return null
  }
}
