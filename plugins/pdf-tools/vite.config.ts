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
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: {
          'pdf-core': ['pdfjs-dist', 'pdf-lib'],
          'office-utils': ['docx', 'pptxgenjs', 'xlsx'],
          'vendor': ['react', 'react-dom', 'lucide-react'],
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  }
})
