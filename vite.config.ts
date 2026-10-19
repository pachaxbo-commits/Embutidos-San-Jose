import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const vercelEnvironment = process.env.VERCEL_ENV || 'development'
const androidBuildFile = readFileSync(new URL('./android/app/build.gradle', import.meta.url), 'utf8')
const appVersion = androidBuildFile.match(/versionName\s+"([^"]+)"/)?.[1] || 'no-disponible'
let appBuild = 'no-disponible'
try {
  appBuild = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).trim()
} catch {
  // El build también puede ejecutarse desde un source archive sin metadatos Git.
}

export default defineConfig({
  cacheDir: 'node_modules/.vite-current',
  plugins: [react()],
  define: {
    'import.meta.env.VITE_VERCEL_ENV': JSON.stringify(vercelEnvironment),
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
    'import.meta.env.VITE_APP_BUILD': JSON.stringify(appBuild),
  },
  optimizeDeps: { entries: ['index.html'] },
  server: {
    port: 5180,
    strictPort: false,
  },
})
