import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  cacheDir: 'node_modules/.vite-current',
  plugins: [react()],
  optimizeDeps: { entries: ['index.html', 'preview.html'] },
  server: {
    port: 5180,
    strictPort: false,
  },
})
