import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Mulby 插件以 file:// 方式加载 ui/index.html，必须使用相对资源路径并输出到根 ui/ 目录
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'ui',
    emptyOutDir: true
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.')
    }
  }
});
