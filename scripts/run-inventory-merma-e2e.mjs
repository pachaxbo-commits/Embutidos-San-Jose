import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const args = ['--config', 'firebase.json', 'emulators:exec', '--project', 'demo-pachax-audit', '--only', 'auth,firestore', 'node firebase/tests/inventoryMermaE2e.test.mjs']
const firebaseJs = process.platform === 'win32' && process.env.APPDATA
  ? join(process.env.APPDATA, 'npm', 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js')
  : null
const child = spawn(firebaseJs && existsSync(firebaseJs) ? process.execPath : 'firebase', firebaseJs && existsSync(firebaseJs) ? [firebaseJs, ...args] : args, { stdio: 'inherit' })
child.on('error', error => { console.error('No se pudo iniciar Firebase Emulator: ' + error.message); process.exitCode = 1 })
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0) })
