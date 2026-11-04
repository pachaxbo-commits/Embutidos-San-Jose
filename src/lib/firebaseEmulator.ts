/** Whether this bundle was explicitly built for Firebase Emulator QA. */
export function isFirebaseEmulatorEnabled(): boolean {
  return import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true'
}

const emulatorQaMarker = import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true'
  ? 'sanjose-emulator-qa'
  : ''

/**
 * Resolve one host for every Emulator service. Production builds are guarded
 * against enabling Emulator mode or setting this host in build validation.
 */
export function getFirebaseEmulatorHost(): string {
  if (!isFirebaseEmulatorEnabled()) {
    throw new Error('El host Emulator solo está disponible en una compilación QA explícita.')
  }
  if (emulatorQaMarker && typeof document !== 'undefined') {
    document.documentElement.dataset.sanjoseFirebaseEmulator = emulatorQaMarker
  }
  const configuredHost = import.meta.env.VITE_FIREBASE_EMULATOR_HOST?.trim()
  return configuredHost || window.location.hostname || 'localhost'
}
