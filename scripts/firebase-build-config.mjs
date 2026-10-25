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
      || (env.VITE_FIREBASE_RESTAURANT_ID && !['sanjose', 'principal'].includes(env.VITE_FIREBASE_RESTAURANT_ID))) {
    throw new Error('La compilación de producción apunta a un emulador o a otra empresa.')
  }
  return values
}

export function validateFirebaseBundle(config, bundleText) {
  const missing = REQUIRED.filter((key) => !bundleText.includes(config[key]))
  if (missing.length) throw new Error(`El bundle final no contiene la configuración Firebase: ${missing.join(', ')}.`)
}

export function validateBuiltAssets(config, distDir) {
  const assetsDir = join(distDir, 'assets')
  const javascript = readdirSync(assetsDir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => readFileSync(join(assetsDir, name), 'utf8'))
    .join('\n')
  validateFirebaseBundle(config, javascript)
}
