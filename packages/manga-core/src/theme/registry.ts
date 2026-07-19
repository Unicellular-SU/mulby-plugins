// ================= 主题模块级单例（manga-core 融合设计 §4） =================
// 插件 index.tsx 启动时 setTheme(theme) 一次；services 与组件经 getTheme() 读取。
// 主题在单个插件生命周期内不可变，无需 React Context 的订阅机制——保持简单。

import type { MangaTheme } from './types';

let currentTheme: MangaTheme | null = null;

/** 注入当前插件的题材主题；必须在渲染 <MangaApp/> 或调用任何 service 之前调用一次 */
export const setTheme = (theme: MangaTheme): void => {
  currentTheme = theme;
};

/** 读取当前主题；未初始化即抛错（说明插件入口漏了 setTheme） */
export const getTheme = (): MangaTheme => {
  if (!currentTheme) {
    throw new Error(
      '[manga-core] 主题未初始化：请在插件入口先调用 setTheme(theme)，再渲染 <MangaApp/> 或调用任何 service。'
    );
  }
  return currentTheme;
};
