import { createMulbyTailwindConfig } from '@mulby-plugins/manga-kit/configs/tailwind';

// 组件源码已迁入 packages/manga-core（源码分发，无构建步骤）——
// content 必须覆盖核心包 src，否则核心包组件的工具类不会生成。
/** @type {import('tailwindcss').Config} */
export default createMulbyTailwindConfig({
  content: ['./index.html', './index.tsx', '../../packages/manga-core/src/**/*.{ts,tsx}'],
});
