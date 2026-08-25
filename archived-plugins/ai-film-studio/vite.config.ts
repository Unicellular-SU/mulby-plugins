import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  root: 'src/ui',
  base: './',
  build: {
    outDir: '../../ui',
    emptyOutDir: true,
    chunkSizeWarningLimit: 550,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          const normalized = id.replace(/\\/g, '/')
          if (!normalized.includes('/node_modules/')) return undefined
          if (normalized.includes('/@xyflow/') || normalized.includes('/@dagrejs/')) return 'flow'
          if (normalized.includes('/@radix-ui/') || normalized.includes('/lucide-react/')) return 'ui-vendor'
          return 'react-vendor'
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  }
})
