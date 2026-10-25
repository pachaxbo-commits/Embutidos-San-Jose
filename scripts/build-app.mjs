import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { loadEnv } from 'vite'
import { validateBuiltAssets, validateFirebaseBuildConfig } from './firebase-build-config.mjs'

const target = process.argv[2]
if (!['web', 'android'].includes(target)) throw new Error('Uso: node scripts/build-app.mjs web|android')

const mode = target === 'android' ? 'android' : 'production'
const config = validateFirebaseBuildConfig(loadEnv(mode, process.cwd(), 'VITE_'))
const require = createRequire(import.meta.url)

function run(script, args) {
  const result = spawnSync(process.execPath, [resolve(script), ...args], { stdio: 'inherit', env: process.env })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}

run(join(dirname(require.resolve('typescript/package.json')), 'bin', 'tsc'), ['-b'])
run(join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js'), ['build', '--mode', mode])
validateBuiltAssets(config, resolve('dist'))
console.log(`PASS: bundle ${target} conectado a pachax-flow; configuración Firebase completa.`)
