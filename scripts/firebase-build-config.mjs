import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const REQUIRED = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
]

export function validateFirebaseBuildConfig(env) {
  const values = Object.fromEntries(REQUIRED.map((key) => [key, String(env[key] || '').trim()]))
  const missing = REQUIRED.filter((key) => !values[key] || /your_|placeholder|undefined|example/i.test(values[key]))
  if (missing.length) throw new Error(`Falta configuración Firebase de producción: ${missing.join(', ')}.`)
  if (values.VITE_FIREBASE_PROJECT_ID !== 'pachax-flow'
      || values.VITE_FIREBASE_AUTH_DOMAIN !== 'pachax-flow.firebaseapp.com'
      || !['pachax-flow.firebasestorage.app', 'pachax-flow.appspot.com'].includes(values.VITE_FIREBASE_STORAGE_BUCKET)) {
    throw new Error('La configuración Firebase no corresponde al proyecto pachax-flow.')
  }
  if (!/^AIza[0-9A-Za-z_-]{35}$/.test(values.VITE_FIREBASE_API_KEY)
      || !/^\d+$/.test(values.VITE_FIREBASE_MESSAGING_SENDER_ID)
      || !values.VITE_FIREBASE_APP_ID.startsWith(`1:${values.VITE_FIREBASE_MESSAGING_SENDER_ID}:web:`)) {
    throw new Error('La configuración Firebase de producción tiene un formato inválido.')
  }
  // La configuración local histórica usa "principal"; el tenant real está fijado
  // a "sanjose" en SAN_JOSE_ID y este valor heredado no controla el acceso.
  if (env.VITE_USE_FIREBASE_EMULATOR === 'true'
      || String(env.VITE_FIREBASE_EMULATOR_HOST || '').trim()
      || (env.VITE_FIREBASE_RESTAURANT_ID && !['sanjose', 'principal'].includes(env.VITE_FIREBASE_RESTAURANT_ID))) {
    throw new Error('La compilación de producción apunta a un emulador o a otra empresa.')
  }
  return values
}

export function validateFirebaseEmulatorBuildConfig(env) {
  const values = Object.fromEntries(REQUIRED.map((key) => [key, String(env[key] || '').trim()]))
  const missing = REQUIRED.filter((key) => !values[key])
  if (missing.length) throw new Error(`Falta configuración Firebase QA: ${missing.join(', ')}.`)
  if (env.VITE_USE_FIREBASE_EMULATOR !== 'true') throw new Error('El build QA debe activar Firebase Emulator explícitamente.')
  if (values.VITE_FIREBASE_PROJECT_ID !== 'demo-pachax-audit') throw new Error('El build QA debe usar el proyecto sintético demo-pachax-audit.')
  if (values.VITE_FIREBASE_AUTH_DOMAIN !== 'localhost') throw new Error('El build QA debe usar un dominio Auth local, nunca el dominio productivo.')
  const host = String(env.VITE_FIREBASE_EMULATOR_HOST || '').trim()
  if (!['localhost', '127.0.0.1', '10.0.2.2'].includes(host)) {
    throw new Error('Host Emulator QA inválido. Use localhost, 127.0.0.1 o 10.0.2.2.')
  }
  return { ...values, VITE_FIREBASE_EMULATOR_HOST: host }
}

export function validateFirebaseBundle(config, bundleText) {
  const missing = REQUIRED.filter((key) => !bundleText.includes(config[key]))
  if (missing.length) throw new Error(`El bundle final no contiene la configuración Firebase: ${missing.join(', ')}.`)
  const emulatorEndpoints = [
    '10.0.2.2:9095', '10.0.2.2:8085', '10.0.2.2:5001',
    'localhost:9095', 'localhost:8085', 'localhost:5001',
    '127.0.0.1:9095', '127.0.0.1:8085', '127.0.0.1:5001',
  ]
  const leakedEndpoints = emulatorEndpoints.filter((endpoint) => bundleText.includes(endpoint))
  if (leakedEndpoints.length) throw new Error(`El bundle de producción contiene endpoints Emulator: ${leakedEndpoints.join(', ')}.`)
  if (bundleText.includes('sanjose-emulator-qa')) throw new Error('El bundle de producción contiene el marcador QA de Firebase Emulator.')
}

export function validateFirebaseEmulatorBundle(config, bundleText) {
  const missing = REQUIRED.filter((key) => !bundleText.includes(config[key]))
  if (missing.length) throw new Error(`El bundle QA no contiene su configuración Firebase: ${missing.join(', ')}.`)
  if (!bundleText.includes(config.VITE_FIREBASE_EMULATOR_HOST)
      || !bundleText.includes(':9095') || !bundleText.includes('8085')) {
    throw new Error('El bundle QA no contiene el host o puertos de Auth/Firestore Emulator.')
  }
  if (!bundleText.includes('sanjose-emulator-qa')) throw new Error('El bundle QA no confirma que Firebase Emulator quedó habilitado.')
}

export function validateBuiltAssets(config, distDir, validator = validateFirebaseBundle) {
  const assetsDir = join(distDir, 'assets')
  const javascript = readdirSync(assetsDir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => readFileSync(join(assetsDir, name), 'utf8'))
    .join('\n')
  validator(config, javascript)
}
