/**
 * Mulby manga 系插件 postcss preset（方案 7.1 步骤 2，从 tech-manga/postcss.config.mjs 平移）。
 * 字符串键插件（tailwindcss/autoprefixer）由 postcss-load-config 从插件目录解析。
 */
export const createMulbyPostcssConfig = () => ({
  plugins: {
    tailwindcss: {},
    autoprefixer: {}
  }
});
