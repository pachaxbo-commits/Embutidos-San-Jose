import { formatUpdateSize, hasNewerAndroidVersion, parseAndroidUpdateManifest } from '../updateManifest.ts'
import { canPresentAutomaticUpdate, hasPendingKnownUpdate } from '../sessionPolicy.ts'

function equal(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`Se esperaba ${String(expected)} y se obtuvo ${String(actual)}.`)
}

function throws(action: () => unknown, expected: RegExp) {
  try { action() } catch (error) {
    if (expected.test((error as Error).message)) return
    throw error
  }
  throw new Error(`Se esperaba un error que coincidiera con ${String(expected)}.`)
}

const valid = {
  versionCode: 21,
  versionName: '1.4.1',
  apkUrl: 'https://pachax-flow.web.app/updates/san-jose/apk/san-jose-1.4.1.apk',
  sha256: 'a'.repeat(64),
  sizeBytes: 8_000_000,
  publishedAt: '2026-09-24T12:00:00.000Z',
  releaseNotes: ['Mejora de actualización'],
  mandatory: false,
}

equal(parseAndroidUpdateManifest(valid).versionCode, 21)
equal(hasNewerAndroidVersion(20, parseAndroidUpdateManifest(valid)), true)
equal(hasNewerAndroidVersion(21, parseAndroidUpdateManifest(valid)), false)
equal(hasNewerAndroidVersion(22, parseAndroidUpdateManifest(valid)), false)
equal(formatUpdateSize(8_000_000), '7.6 MB')
throws(() => parseAndroidUpdateManifest({ ...valid, apkUrl: 'https://example.com/programa.apk' }), /servidor autorizado/)
throws(() => parseAndroidUpdateManifest({ ...valid, sha256: 'incorrecto' }), /SHA-256/)
throws(() => parseAndroidUpdateManifest({ ...valid, versionCode: 0 }), /código de versión/)
throws(() => parseAndroidUpdateManifest({ ...valid, minimumSupportedVersionCode: 22 }), /versión mínima/)
throws(() => parseAndroidUpdateManifest({ ...valid, releaseNotes: ['x'.repeat(301)] }), /notas/)

equal(hasPendingKnownUpdate(20, parseAndroidUpdateManifest(valid)), true)
equal(hasPendingKnownUpdate(21, parseAndroidUpdateManifest(valid)), false)
equal(canPresentAutomaticUpdate({ postponedThisSession: false, pendingOperations: false, anotherDialogOpen: false }), true)
equal(canPresentAutomaticUpdate({ postponedThisSession: true, pendingOperations: false, anotherDialogOpen: false }), false)
equal(canPresentAutomaticUpdate({ postponedThisSession: false, pendingOperations: true, anotherDialogOpen: false }), false)
equal(canPresentAutomaticUpdate({ postponedThisSession: false, pendingOperations: false, anotherDialogOpen: true }), false)

console.log('16 comprobaciones del manifiesto y sesión Android aprobadas')
