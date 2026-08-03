/**
 * Mulby manga 系插件 tailwind preset（方案 7.1 步骤 2，从 tech-manga/tailwind.config.js 平移）。
 * content globs 相对 vite build 的 CWD（插件根目录）解析，两 manga 插件目录结构一致。
 * manga-core 融合后：UI 组件源码在 packages/manga-core/src（源码分发），默认 content 必须覆盖，
 * 否则核心包组件的工具类不会生成。
 * @type {(overrides?: Partial<import('tailwindcss').Config>) => import('tailwindcss').Config}
 */
export const createMulbyTailwindConfig = (overrides = {}) => ({
  content: ['./index.html', './index.tsx', '../../packages/manga-core/src/**/*.{ts,tsx}'],
  theme: {
    extend: {}
  },
  plugins: [],
  ...overrides
});
