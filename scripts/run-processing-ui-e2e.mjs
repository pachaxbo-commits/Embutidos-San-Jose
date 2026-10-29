import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const args = [
  '--config', 'firebase.json',
  'emulators:exec',
  '--project', 'demo-pachax-audit',
  '--only', 'auth,firestore,functions',
  'node firebase/tests/processingUiE2e.test.mjs',
]
const globalFirebaseCli = process.platform === 'win32' && process.env.APPDATA
  ? join(process.env.APPDATA, 'npm', 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js')
  : null
const command = globalFirebaseCli && existsSync(globalFirebaseCli) ? process.execPath : 'firebase'
const commandArgs = globalFirebaseCli && existsSync(globalFirebaseCli) ? [globalFirebaseCli, ...args] : args
const child = spawn(command, commandArgs, {
  stdio: 'inherit',
  env: { ...process.env, SANJOSE_PROCESSING_REPACK_EMULATOR_TEST: 'true' },
})

child.on('error', error => {
  console.error('No se pudo iniciar Firebase CLI. Instala o habilita la CLI oficial: ' + error.message)
  process.exitCode = 1
})
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0)
})
