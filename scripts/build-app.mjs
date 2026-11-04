import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { loadEnv } from 'vite'
import {
  validateBuiltAssets,
  validateFirebaseBuildConfig,
  validateFirebaseEmulatorBuildConfig,
  validateFirebaseEmulatorBundle,
} from './firebase-build-config.mjs'

const target = process.argv[2]
if (!['web', 'android', 'android-qa'].includes(target)) throw new Error('Uso: node scripts/build-app.mjs web|android|android-qa')

const qaBuild = target === 'android-qa'
const mode = target === 'web' ? 'production' : 'android'
const fileEnvironment = loadEnv(mode, process.cwd(), 'VITE_')
const processEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('VITE_')))
const qaEnvironment = qaBuild ? {
  VITE_FIREBASE_API_KEY: `AIza${'a'.repeat(35)}`,
  VITE_FIREBASE_AUTH_DOMAIN: 'localhost',
  VITE_FIREBASE_PROJECT_ID: 'demo-pachax-audit',
  VITE_FIREBASE_STORAGE_BUCKET: 'demo-pachax-audit.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '123456789000',
  VITE_FIREBASE_APP_ID: '1:123456789000:web:sanjoseqa',
  VITE_FIREBASE_RESTAURANT_ID: 'sanjose',
  VITE_USE_FIREBASE_EMULATOR: 'true',
  VITE_FIREBASE_EMULATOR_HOST: process.env.VITE_FIREBASE_EMULATOR_HOST || '10.0.2.2',
} : {}
const effectiveEnvironment = { ...fileEnvironment, ...processEnvironment, ...qaEnvironment }
const config = qaBuild
  ? validateFirebaseEmulatorBuildConfig(effectiveEnvironment)
  : validateFirebaseBuildConfig(effectiveEnvironment)
const require = createRequire(import.meta.url)

function run(script, args, env = process.env) {
  const result = spawnSync(process.execPath, [resolve(script), ...args], { stdio: 'inherit', env })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}

run(join(dirname(require.resolve('typescript/package.json')), 'bin', 'tsc'), ['-b'])
const buildEnvironment = qaBuild ? { ...process.env, ...effectiveEnvironment, ...config } : process.env
run(join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js'), ['build', '--mode', mode], buildEnvironment)
validateBuiltAssets(config, resolve('dist'), qaBuild ? validateFirebaseEmulatorBundle : undefined)
console.log(qaBuild
  ? `PASS: bundle Android QA aislado en ${config.VITE_FIREBASE_EMULATOR_HOST} y proyecto sintético ${config.VITE_FIREBASE_PROJECT_ID}.`
  : `PASS: bundle ${target} conectado a pachax-flow; configuración Firebase completa, sin endpoints Emulator.`)
