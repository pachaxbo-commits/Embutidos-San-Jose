import { spawn, spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const viteBin = resolve(require.resolve('vite/package.json'), '../bin/vite.js')

function runSync(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`)
}

async function waitForVite(url, child) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Vite exited early with code ${child.exitCode}`)
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      await delay(400)
    }
  }
  throw new Error(`Vite did not become ready at ${url}`)
}

runSync(process.execPath, [resolve('firebase/tests/seedDemoTenant.mjs')])
runSync(process.execPath, [resolve('firebase/tests/seedDispatchPickerUi.mjs')])

const env = {
  ...process.env,
  VITE_USE_FIREBASE_EMULATOR: 'true',
  VITE_FIREBASE_PROJECT_ID: 'demo-pachax-audit',
}
const vite = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', '5180', '--strictPort'], {
  stdio: 'inherit',
  env,
  windowsHide: true,
})

try {
  await waitForVite('http://127.0.0.1:5180', vite)
  runSync(process.execPath, [resolve('scripts/test-dispatch-picker-ui.cjs')], { env })
} finally {
  vite.kill()
  await Promise.race([
    new Promise(resolveExit => vite.once('exit', resolveExit)),
    delay(5000),
  ])
}
