import assert from 'node:assert/strict'
import { validateFirebaseBuildConfig, validateFirebaseBundle } from './firebase-build-config.mjs'

const fixture = {
  VITE_FIREBASE_API_KEY: `AIza${'a'.repeat(35)}`,
  VITE_FIREBASE_AUTH_DOMAIN: 'pachax-flow.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'pachax-flow',
  VITE_FIREBASE_STORAGE_BUCKET: 'pachax-flow.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '987654321012',
  VITE_FIREBASE_APP_ID: '1:987654321012:web:abcdef1234567890',
  VITE_FIREBASE_RESTAURANT_ID: 'sanjose',
  VITE_USE_FIREBASE_EMULATOR: 'false',
}
const config = validateFirebaseBuildConfig(fixture)
for (const key of Object.keys(config)) {
  assert.throws(() => validateFirebaseBuildConfig({ ...fixture, [key]: '' }), /Firebase/)
}
assert.throws(() => validateFirebaseBuildConfig({ ...fixture, VITE_FIREBASE_PROJECT_ID: 'otro-proyecto' }), /pachax-flow/)
assert.throws(() => validateFirebaseBuildConfig({ ...fixture, VITE_USE_FIREBASE_EMULATOR: 'true' }), /emulador/)
assert.throws(() => validateFirebaseBuildConfig({ ...fixture, VITE_FIREBASE_RESTAURANT_ID: 'otro' }), /otra empresa/)
validateFirebaseBuildConfig({ ...fixture, VITE_FIREBASE_RESTAURANT_ID: 'principal' })
assert.throws(() => validateFirebaseBuildConfig({ ...fixture, VITE_FIREBASE_API_KEY: 'your_api_key' }), /Firebase/)
validateFirebaseBundle(config, Object.values(config).join(' '))
assert.throws(() => validateFirebaseBundle(config, ''), /bundle final/)
console.log('PASS: configuración completa, tenant correcto, sin emulador y presente en el bundle final')
