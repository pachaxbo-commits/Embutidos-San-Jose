export interface AndroidUpdateManifest {
  versionCode: number
  versionName: string
  apkUrl: string
  sha256: string
  sizeBytes: number
  publishedAt: string
  releaseNotes: string[]
  mandatory: boolean
  minimumSupportedVersionCode?: number
}

const TRUSTED_HOSTS = new Set(['pachax-flow.web.app', 'pachax-flow.firebaseapp.com'])
const APK_PATH_PREFIX = '/updates/san-jose/apk/'

export function parseAndroidUpdateManifest(value: unknown): AndroidUpdateManifest {
  if (!value || typeof value !== 'object') throw new Error('El servidor devolvió una respuesta inválida.')
  const input = value as Record<string, unknown>
  const versionCode = Number(input.versionCode)
  const sizeBytes = Number(input.sizeBytes)
  const versionName = typeof input.versionName === 'string' ? input.versionName.trim() : ''
  const apkUrl = typeof input.apkUrl === 'string' ? input.apkUrl.trim() : ''
  const sha256 = typeof input.sha256 === 'string' ? input.sha256.trim().toLowerCase() : ''
  const publishedAt = typeof input.publishedAt === 'string' ? input.publishedAt.trim() : ''
  const releaseNotes = Array.isArray(input.releaseNotes) && input.releaseNotes.every(note => typeof note === 'string')
    ? input.releaseNotes.map(note => note.trim()).filter(Boolean)
    : []
  let parsedUrl: URL
  try { parsedUrl = new URL(apkUrl) } catch { throw new Error('La dirección de descarga de la actualización no es válida.') }

  if (!Number.isInteger(versionCode) || versionCode <= 0) throw new Error('El código de versión publicado no es válido.')
  if (!versionName || versionName.length > 64) throw new Error('Falta el nombre de la versión publicada o es demasiado largo.')
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) throw new Error('El tamaño publicado no es válido.')
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('La firma SHA-256 publicada no es válida.')
  if (!publishedAt || Number.isNaN(Date.parse(publishedAt))) throw new Error('La fecha de publicación no es válida.')
  if (parsedUrl.protocol !== 'https:' || !TRUSTED_HOSTS.has(parsedUrl.hostname) || !parsedUrl.pathname.startsWith(APK_PATH_PREFIX) || !parsedUrl.pathname.endsWith('.apk')) {
    throw new Error('La actualización no proviene del servidor autorizado de San José.')
  }
  if (typeof input.mandatory !== 'boolean') throw new Error('Falta indicar si la actualización es obligatoria.')
  if (releaseNotes.length > 20 || releaseNotes.some(note => note.length > 300)) {
    throw new Error('Las notas de la actualización exceden el tamaño permitido.')
  }
  const minimum = input.minimumSupportedVersionCode === undefined ? undefined : Number(input.minimumSupportedVersionCode)
  if (minimum !== undefined && (!Number.isInteger(minimum) || minimum <= 0 || minimum > versionCode)) {
    throw new Error('La versión mínima compatible no es válida.')
  }

  return { versionCode, versionName, apkUrl, sha256, sizeBytes, publishedAt, releaseNotes, mandatory: input.mandatory, minimumSupportedVersionCode: minimum }
}

export function hasNewerAndroidVersion(installedVersionCode: number, manifest: AndroidUpdateManifest): boolean {
  return Number.isInteger(installedVersionCode) && manifest.versionCode > installedVersionCode
}

export function formatUpdateSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`
}
