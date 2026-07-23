// ================= @mulby-plugins/manga-core 公共出口 =================
// 用法：插件入口 setTheme(theme) 一次，然后渲染 <MangaApp/>。

export { default as MangaApp } from './MangaApp';
export { setTheme, getTheme } from './theme/registry';
export type {
  MangaTheme,
  MangaThemeFeatures,
  UIStrings,
  UITheme,
  ArtStyleOption,
  StoryModeOption,
  CharacterPreset,
  EndingOption,
  WatermarkThemeConfig,
  ColorModeOption,
  ScriptPromptInput,
  LabeledOption,
  CreativeDiceConfig,
  CreativeSeed,
} from './theme/types';
export * from './engine-types';
