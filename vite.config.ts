import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const vercelEnvironment = process.env.VERCEL_ENV || 'development'

export default defineConfig({
  cacheDir: 'node_modules/.vite-current',
  plugins: [react()],
  define: { 'import.meta.env.VITE_VERCEL_ENV': JSON.stringify(vercelEnvironment) },
  optimizeDeps: { entries: ['index.html'] },
  server: {
    port: 5180,
    strictPort: false,
  },
})
