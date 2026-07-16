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
    chunkSizeWarningLimit: 900, // three（仅导演台/全景动态加载）独立成块，约 684KB 属预期
    rollupOptions: {
      output: {
        // 显式把 three 及其 examples 收进独立 chunk：稳定隔离重依赖，防止误入主包
        manualChunks(id: string) {
          if (id.includes('node_modules/three')) return 'three'
          return undefined
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
