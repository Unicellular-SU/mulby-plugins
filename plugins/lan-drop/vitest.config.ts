import { defineConfig } from 'vitest/config'

// 独立的测试配置：不沿用 vite.config.ts 的 root（那是前端构建用的 src/ui），
// 以便发现 src/core 下的安全核心单元测试。测试只覆盖 Node 端纯逻辑。
export default defineConfig({
  test: {
    root: '.',
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
})
