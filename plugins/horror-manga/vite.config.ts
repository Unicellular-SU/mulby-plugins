import { createMulbyPluginViteConfig } from '@mulby-plugins/manga-kit/configs/vite';

// Mulby 插件构建配置统一走 manga-kit preset（与 tech-manga 对齐）
export default createMulbyPluginViteConfig(__dirname);
