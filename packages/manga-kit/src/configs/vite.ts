import path from 'node:path';
import { defineConfig, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Mulby 插件 vite preset（方案 7.1 步骤 2，从 tech-manga/vite.config.ts 平移）：
 * Mulby 插件以 file:// 方式加载 ui/index.html，必须使用相对资源路径并输出到根 ui/ 目录。
 */
export const createMulbyPluginViteConfig = (pluginDir: string, overrides: UserConfig = {}) =>
  defineConfig({
    base: './',
    plugins: [react()],
    build: {
      outDir: 'ui',
      emptyOutDir: true
    },
    resolve: {
      alias: {
        '@': path.resolve(pluginDir, '.')
      }
    },
    ...overrides
  });
