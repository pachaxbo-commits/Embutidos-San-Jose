import assert from 'node:assert/strict'
import {
  validateFirebaseBuildConfig,
  validateFirebaseBundle,
  validateFirebaseEmulatorBuildConfig,
  validateFirebaseEmulatorBundle,
} from './firebase-build-config.mjs'

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
assert.throws(() => validateFirebaseBuildConfig({ ...fixture, VITE_FIREBASE_EMULATOR_HOST: '10.0.2.2' }), /emulador/)
validateFirebaseBundle(config, Object.values(config).join(' '))
assert.throws(() => validateFirebaseBundle(config, ''), /bundle final/)
for (const endpoint of ['10.0.2.2:9095', '10.0.2.2:8085', 'localhost:9095', 'localhost:8085']) {
  assert.throws(() => validateFirebaseBundle(config, `${Object.values(config).join(' ')} ${endpoint}`), /endpoints Emulator/)
}
assert.throws(() => validateFirebaseBundle(config, `${Object.values(config).join(' ')} sanjose-emulator-qa`), /marcador QA/)

const qaFixture = {
  VITE_FIREBASE_API_KEY: `AIza${'a'.repeat(35)}`,
  VITE_FIREBASE_AUTH_DOMAIN: 'localhost',
  VITE_FIREBASE_PROJECT_ID: 'demo-pachax-audit',
  VITE_FIREBASE_STORAGE_BUCKET: 'demo-pachax-audit.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '123456789000',
  VITE_FIREBASE_APP_ID: '1:123456789000:web:sanjoseqa',
  VITE_USE_FIREBASE_EMULATOR: 'true',
  VITE_FIREBASE_EMULATOR_HOST: '10.0.2.2',
}
const qaConfig = validateFirebaseEmulatorBuildConfig(qaFixture)
validateFirebaseEmulatorBuildConfig({ ...qaFixture, VITE_FIREBASE_EMULATOR_HOST: 'localhost' })
assert.throws(() => validateFirebaseEmulatorBuildConfig({ ...qaFixture, VITE_USE_FIREBASE_EMULATOR: 'false' }), /explícitamente/)
assert.throws(() => validateFirebaseEmulatorBuildConfig({ ...qaFixture, VITE_FIREBASE_EMULATOR_HOST: 'https://10.0.2.2' }), /Host Emulator/)
assert.throws(() => validateFirebaseEmulatorBuildConfig({ ...qaFixture, VITE_FIREBASE_PROJECT_ID: 'pachax-flow' }), /sintético/)
validateFirebaseEmulatorBundle(qaConfig, `${Object.values(qaConfig).join(' ')} :9095 :8085 sanjose-emulator-qa`)
assert.throws(() => validateFirebaseEmulatorBundle(qaConfig, `${Object.values(qaConfig).filter(value => value !== qaConfig.VITE_FIREBASE_AUTH_DOMAIN).join(' ')} :9095 :8085`), /configuración Firebase/)
console.log('PASS: build Production bloquea Emulator y bundle QA requiere host explícito con proyecto sintético')
