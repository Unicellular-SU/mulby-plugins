// ================= MangaTheme：题材即数据（manga-core 融合设计 §4） =================
// 核心包只定义形状；全部题材数据（prompt 角色/文风、画风与叙事模式、预设角色、
// 界面文案、视觉 token）由各插件的 theme.ts 提供，经 setTheme() 注入模块级单例。

import type { CharacterProfile, StoryMode, WatermarkSettings, WatermarkType, WorkflowStep } from '../engine-types';

/** 画风下拉项（label 为界面文案，value 为发给图像模型的英文风格描述） */
export interface ArtStyleOption {
  label: string;
  value: string;
}

/** 叙事模式下拉项；prompt 为该模式的叙事指令模板（可含 ${character.name} 等占位符）。
 *  value 为字符串（各题材的模式集合不同，核心包不枚举） */
export interface StoryModeOption {
  label: string;
  value: string;
  prompt: string;
  default?: boolean; // 配置面板初始选中的模式（缺省取数组首项）
}

/** 预设角色（与原 CharacterProfile 同形：name 展示名 / description 视觉描述） */
export type CharacterPreset = CharacterProfile;

/**
 * 结局类型选项（features.endings 开启时由 ConfigPanel 展示、剧本 prompt 注入）。
 * value 即注入 prompt 的结局名（如 'Shock Twist (The Truth Revealed)'）。
 */
export interface EndingOption {
  label: string;
  value: string;
  prompt?: string;   // 预留：逐结局定制注入文案；缺省用核心包通用模板
  default?: boolean; // 配置面板初始选中的结局（缺省取数组首项）
}

/** 水印主题配置（features.watermark 开启时必填；源自 horror-manga 的水印能力通用化） */
export interface WatermarkThemeConfig {
  defaults: WatermarkSettings; // 初始全局水印设置（含默认文字/类型/不透明度）
  fallbackText: string;        // settings.text 为空时绘制水印的兜底文字
  typeOptions: { label: string; value: WatermarkType }[]; // 类型下拉文案
}

/** 色彩模式下拉项；promptHint 追加到风格字符串后参与全部图像 prompt（如黑白墨线关键词） */
export interface ColorModeOption {
  label: string;
  value: string;
  promptHint: string;
  default?: boolean;
}

/** 剧本 prompt 构造的输入（buildScriptPrompt 钩子用） */
export interface ScriptPromptInput {
  sourceText: string;
  style: string;
  character: CharacterProfile;
  storyMode: StoryMode;
  secondaryStoryMode?: StoryMode;
  endingType?: string;
  customStoryPrompt?: string;
  panelCount: number;
  totalPages: string;
  colorMode?: string;
}

/** 简单下拉项（页面比例 / 总页数等题材可覆写的选项列表） */
export interface LabeledOption {
  label: string;
  value: string;
}

/** 全部界面文案（原 tech-manga strings.ts 的 S 表 + 品牌相关键）；函数键用于带参文案 */
export interface UIStrings {
  // ---- 通用 ----
  appTitleSetup: string;
  startOver: string;
  cancelAll: string;
  cancelAllTitle: string;

  // ---- 品牌（页眉 logo / 导出默认文件名 / refine prompt 署名） ----
  brandMark: string;          // 页眉与加载页 logo 字母，如 'TM'
  brandTitleLead: string;     // 页眉标题前半（主色），如 'Tech'
  brandTitleAccent: string;   // 页眉标题后半（强调色），如 'Manga'
  defaultComicFileName: string; // 导出漫画无标题时的默认文件名
  pageFilePrefix: string;     // 单页保存的文件名前缀（如 'techmanga' → techmanga-page-1.png）
  configIcon: string;         // 配置面板标题前的 emoji

  // ---- 配置面板 ----
  configTitle: string;
  sourceLabel: string;
  uploadSource: string;
  sourcePlaceholder: string;
  sourcePlaceholderHistory: string;
  styleLabel: string;
  customStyleOption: string;
  storyModeLabel: string;
  customStoryLabel: string;
  customStoryPlaceholder: string;
  mainCharacterLabel: string;
  autoDetectOption: string;
  selectCharacterOption: string;
  customCharacterOption: string;
  autoCastBadge: string;
  autoCastHint: string;
  charNameLabel: string;
  charDescLabel: string;
  pageLengthLabel: string;
  panelsLabel: string;
  panelsAuto: string;
  panelsN: (n: number) => string;
  ratioLabel: string;
  generating: string;
  generateBtn: string;
  estimatedInputTokens: (n: string) => string;
  readFileFailed: string;

  // ---- 资产工作室 ----
  assetStudioTitle: string;
  assetStudioSubtitle: string;
  studioTabAssets: string;   // 工作流标签页：资产工作室
  studioTabScript: string;   // 工作流标签页：剧本与分镜
  charactersTab: (n: number) => string;
  propsTab: (n: number) => string;
  noReference: string;
  generatingLabel: string;
  generateRef: string;
  regenerateRef: string;
  generateProp: string;
  regenerateProp: string;
  uploadCustomImage: string;
  noPropsFound: string;
  noPropsHint: string;
  goToScriptEditor: string;
  charDescPlaceholder: string;
  propDescPlaceholder: string;

  // ---- 剧本编辑器 ----
  storyboardTitle: string;
  storyboardSubtitle: string;
  startProduction: string;
  sidebarGlobal: string;
  sidebarOverview: string;
  sidebarPages: string;
  sidebarCover: string;
  sidebarPage: (n: string) => string;
  comicTitleLabel: string;
  analysisLabel: string;
  coverDesignTitle: string;
  coverPromptLabel: string;
  pageTitle: (n: number) => string;
  layoutLabel: string;
  fullPromptLabel: string;
  fullPromptHint: string;
  charsInScene: string;
  propsInScene: string;
  noCharsInScene: string;
  noPropsInScene: string;
  refinePlaceholder: string;
  refineBtn: string;
  refining: string;
  refineFailed: string;

  // ---- 漫画页 ----
  comicPagesTitle: string;
  pagesBadge: (ratio: string, n: number) => string;
  progressBadge: (done: number, total: number) => string;
  resumeAll: (n: number) => string;
  resumeAllTitle: string;
  exportBtn: string;
  exportZip: string;
  exportPdf: string;
  exportLong: string;
  exporting: string;
  exportedTo: (p: string) => string;
  revealInFolder: string;
  exportFailed: (m: string) => string;
  coverBadge: string;
  pageBadge: (n: number) => string;
  designingCover: string;
  drawingPage: (n: number) => string;
  retryPage: string;
  downloadPage: string;
  openReader: string;
  editPrompt: string;
  closePrompt: string;
  includeChars: string;
  includeProps: string;
  fullImagePrompt: string;
  aiRefinePrompt: string;
  refineInputPlaceholder: string;
  cancelBtn: string;
  redrawBtn: string;
  viewPromptLink: string;
  pageLayoutLabel: string;
  writtenBy: string;
  untitled: string;
  pageSaveFailed: (m: string) => string;

  // ---- 生成进度 ----
  stageQueued: string;
  stageDrawing: string;
  stageDrawingN: (r: number, t: number) => string;
  stageFinalizing: string;
  stageFallback: string;

  // ---- 通知 ----
  notifyBatchDone: (title: string, done: number) => string;
  notifyBatchFailed: (title: string, done: number, failed: number) => string;
  notifyScriptDone: (title: string) => string;

  // ---- 错误文案 ----
  pageDrawFailed: (m: string) => string;
  pageAborted: string;

  // ---- 终端日志面板 ----
  terminalTitle: (model: string) => string;
  defaultModelLabel: string;
  terminalReady: string;
  terminalWaiting: string;
  terminalStreaming: string;
  terminalIdle: string;

  // ---- Token 监控 ----
  taskCost: string;
  totalTokens: string;
  imagesGenerated: string;
  costBreakdown: string;
  recentActivity: string;
  noActivity: string;
  estimatedBadge: string;
  unpricedCalls: (n: number) => string;
  unpricedRow: string;

  // ---- Phase 2：副故事模式 / 结局 / 水印 ----
  secondaryStoryModeLabel: string;
  secondaryStoryModeNone: string;
  endingLabel: string;
  colorModeLabel: string;
  watermarkTitle: string;
  watermarkEnable: string;
  watermarkTypeLabel: string;
  watermarkTextLabel: string;
  watermarkTextPlaceholder: string;
  watermarkImageLabel: string;
  watermarkUploadImage: string;
  watermarkChangeImage: string;
  watermarkOpacityLabel: string;
  watermarkPageTitle: (n: number) => string;
  watermarkModeLabel: string;
  watermarkModeGlobal: string;
  watermarkModeCustom: string;

  // ---- 工程画廊（多工程管理） ----
  myProjects: string;
  continueLastProject: string;
  projectUntitled: (date: string) => string;
  galleryEmpty: string;
  galleryOpen: string;
  galleryRename: string;
  galleryRenameSave: string;
  galleryDelete: string;
  galleryDeleteConfirm: string;
  galleryExport: string;
  galleryExportNoPages: string;
  galleryUpdatedAt: (d: string) => string;
  projectPages: (done: number, total: number) => string;
  projectStageLabel: (step: WorkflowStep) => string;
  projectOpenFailed: string;
  projectOpenRetry: string;

  // ---- 返回上一步 ----
  backButton: string;
  backAbortMessage: string;              // COMIC_GENERATION 有在途页时回退确认的主文案
  backAbortDetail: (done: number) => string; // 确认框 detail：已完成页保留说明
  backAbortConfirm: string;              // 确认框确定按钮（中止并返回）
}

/** 视觉 token：MangaApp 根节点展开为 CSS 变量（--manga-*），组件经 var() 消费 */
export interface UITheme {
  fontFamily: string;        // 根节点字体栈，如 "'Space Grotesk', sans-serif"
  headingFontFamily?: string; // 标题字体（品牌/各屏标题），缺省 = fontFamily
  accent: string;            // 主强调色（品牌渐变起点），如 '#6366f1'
  accentSecondary: string;   // 次强调色（品牌渐变终点），如 '#9333ea'
  ctaFrom?: string;          // 主按钮渐变起点（缺省 = accent）
  ctaTo?: string;            // 主按钮渐变终点（缺省 = accentSecondary）
  ctaHoverFrom?: string;     // 主按钮 hover 渐变起点（缺省 = ctaFrom）
  ctaHoverTo?: string;       // 主按钮 hover 渐变终点（缺省 = ctaTo）
  colorScheme: 'dark' | 'light';
  background: string;        // 根背景色，如 '#0f172a'
  text: string;              // 根文本色，如 '#f1f5f9'
}

/** 能力开关（Phase 2 起逐项实现；Phase 1 仅 props 已由引擎全程消费） */
export interface MangaThemeFeatures {
  watermark: boolean;          // 水印配置与导出前加水印
  endings: boolean;            // 结局类型维度
  secondaryStoryMode: boolean; // 主/副故事模式混合
  props: boolean;              // 道具参考图
}

export interface MangaTheme {
  id: string;

  // —— Prompt 层 ——
  systemRole: string;            // 剧本 system prompt 的 Role 行，如 'Professional Tech Manga Director and Storyteller.'
  sourceAnalysis: string;        // system prompt PHASE 1 的素材类型分析段落
  languageRules: string;         // 逐页图 prompt（带参考图路径）的语言规则段
  refineToneHint: string;        // refineText 的语气要求（UNIVERSE FIDELITY 规则正文）
  artStyles: ArtStyleOption[];
  storyModes: StoryModeOption[]; // 含各自叙事 prompt 模板（原 STORY_MODES + STORY_MODE_PROMPTS）
  characterPresets: CharacterPreset[];
  endings?: EndingOption[];      // features.endings 开启时必填
  /** 主/副模式混合 prompt 的题材示例句（CROSS-OVER INSTRUCTION 的 "For example, ..." 部分）；
   *  features.secondaryStoryMode 开启时建议提供，缺省则不带示例 */
  secondaryModeBlendExample?: string;
  watermark?: WatermarkThemeConfig; // features.watermark 开启时必填
  colorModes?: ColorModeOption[];   // 提供时 ConfigPanel 显示色彩模式下拉，promptHint 参与图像 prompt
  aspectRatioOptions?: LabeledOption[]; // 覆写核心包默认的页面比例选项（含文案）
  pageLengthOptions?: LabeledOption[];  // 覆写核心包默认的总页数选项（含文案）

  /**
   * 完全自定义剧本 prompt 构造（与核心包默认结构差异过大的主题使用）。
   * 提供时替代核心包默认的 getStaticSystemPrompt() + buildScriptUserPrompt()；
   * 中止纪元 / JSON 修复重试 / API 级 schema 约束 / 用量上报等引擎机制不受影响。
   */
  buildScriptPrompt?: (input: ScriptPromptInput) => { system: string; user: string };
  /** API 级 JSON schema 约束覆写（配合 buildScriptPrompt 使用；缺省用核心包通用 schema） */
  jsonSchema?: Record<string, unknown>;

  // —— 文案层 ——
  strings: UIStrings;

  // —— 视觉层 ——
  ui: UITheme;

  // —— 能力开关 ——
  features: MangaThemeFeatures;
}
