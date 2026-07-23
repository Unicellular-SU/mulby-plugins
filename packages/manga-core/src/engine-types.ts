
export enum AspectRatio {
  SQUARE = '1:1',
  PORTRAIT = '3:4',
  LANDSCAPE = '4:3',
  WIDE = '16:9',
  TALL = '9:16',
  MANGA_PAGE = '2:3'
}

export enum StoryMode {
  CONFLICT = 'conflict',
  EDUCATIONAL = 'educational',
  MYSTERY = 'mystery',
  COMEDY = 'comedy',
  ISEKAI = 'isekai',
  OFFICE_DRAMA = 'office_drama',
  HORROR = 'horror',
  SCI_COMM = 'sci_comm', 
  HISTORY_SERIOUS = 'history_serious', // New: Documentary style, auto-cast
  HISTORY_PARODY = 'history_parody',   // New: Character plays historical figure
  CUSTOM = 'custom'
}

export enum WorkflowStep {
  CONFIG = 'config',
  SCRIPT_GENERATION = 'script_generation',
  STORYBOARDING = 'storyboarding',
  COMIC_GENERATION = 'comic_generation'
}

export interface CharacterProfile {
  name: string;
  description: string; // Visual description for the AI
}

export interface CharacterState {
  name: string;
  state: {
    position: string;
    pose: string;
    appearance_changes: string[]; // e.g., "holding a sword", "glowing eyes"
    injuries: string[]; // Adapted to "Visual Effects" or "Status Conditions" for non-combat genres
  };
}

export interface EnvironmentState {
  lighting: string;
  notable_changes: string[];
}

export interface PersistentState {
  characters: CharacterState[];
  environment: EnvironmentState;
}

export interface ComicPageScript {
  page_number: number;
  layout_description: string; // Description of the grid layout
  image_prompt: string; // Prompt for the entire page image
  characters_in_scene: string[]; // List of character names present in this page
  props_in_scene: string[]; // List of important props present in this page
  scenes_in_scene?: string[]; // List of scene/location names (from scene_sheet) this page takes place in
  /** 结构化对白（气泡）：speaker 必须用 character_sheet 精确原名；text 简体中文；
   *  position 为气泡方位（top-left/top-right/bottom-left/bottom-right/center 类）。
   *  旁白框不进此数组（仍在 image_prompt 叙述中，受旁白克制规则约束）。 */
  dialogue?: Array<{ speaker: string; text: string; position?: string }>;
  persistent_states: PersistentState; // Tracking visual continuity
  state_changes_this_page: string[]; // High-level changes for debugging/analysis
}

export interface CharacterSheetItem {
  name: string;
  description: string;
  referenceImage?: string; // Base64 encoded string of the generated character reference
}

export interface PropSheetItem {
  name: string;
  description: string;
  referenceImage?: string;
}

export interface SceneSheetItem {
  name: string;
  description: string; // 固定陈设/布局与光线基调（不含角色）
  referenceImage?: string;
}

// New Interface for the full AI response
export interface ComicResponse {
  title: string; // Comic Title
  global_art_style: string; // Just the art style (colors, lines), NO characters.
  character_sheet: CharacterSheetItem[]; // Array of character descriptions
  prop_sheet: PropSheetItem[]; // Array of prop descriptions
  scene_sheet: SceneSheetItem[]; // Array of scene/location descriptions
  cover_image_prompt: string; // Specific prompt for the cover
  analysis: string;
  pages: ComicPageScript[];
}

/** 图像生成实时进度（方案 5.3）：由 images.generateStream 的 chunk 映射而来 */
export interface ImageProgress {
  stage?: string;      // start / partial / finalizing / completed / fallback
  message?: string;    // 宿主或插件给出的阶段文案（优先展示）
  preview?: string;    // 渐进预览图 dataURL（是否出现取决于 provider）
  received?: number;
  total?: number;
}

export interface ComicPageData extends ComicPageScript {
  title?: string; // Optional title for the cover page
  imageData?: string; // Base64 image of the whole page（features.watermark 开启时为已加水印版本）
  rawImageData?: string; // 未加水印的原始图（仅 features.watermark 开启时写入）
  isGenerating: boolean;
  error?: string;
  progress?: ImageProgress; // 生成期间的实时进度（方案 5.3；不落盘）
  watermarkOverrides?: WatermarkSettings; // 本页水印覆盖设置；缺省跟随全局 config.watermark
}

// ================= 水印（Phase 2 通用化，源自 horror-manga） =================

export enum WatermarkType {
  TEXT_TILED = 'TEXT_TILED',
  TEXT_CORNER = 'TEXT_CORNER',
  IMAGE_CENTER = 'IMAGE_CENTER',
  IMAGE_CORNER = 'IMAGE_CORNER'
}

export interface WatermarkSettings {
  enabled: boolean;
  type: WatermarkType;
  text: string;
  image: string | null; // Data URL
  opacity: number;
}

// ================= 流式日志面板（LogPanel） =================
// 剧本生成/审校/意见迭代统一经该回调把过程推给右侧终端面板：
// - INPUT：完整 prompt（一次性写入）
// - OUTPUT：模型回答（累积文本，通常是流式 JSON）
// - REASONING：推理模型思考流（chunkType==='reasoning'；非推理模型自然恒空不显示）
// - PHASE：相位切换徽标（如「生成剧本」→「自动审校」），消费方据此重置思考/输出并显示当前相位
export type LogStreamType = 'INPUT' | 'OUTPUT' | 'REASONING' | 'PHASE';
export type LogUpdateFn = (logType: LogStreamType, text: string) => void;

export interface AppConfig {
  sourceText: string;
  style: string; // Enum value or custom string
  character: CharacterProfile;
  storyMode: StoryMode;
  secondaryStoryMode?: StoryMode; // 副故事模式（features.secondaryStoryMode 开启时由 ConfigPanel 写入）
  endingType?: string;            // 结局类型（features.endings 开启时写入，取 theme.endings 的 value）
  customStoryPrompt?: string; // For StoryMode.CUSTOM
  panelCount: number; // 0 for auto
  aspectRatio: string;
  totalPages: string; // "Short", "Medium", "Long"
  autoReview: boolean; // 剧本生成后自动审校一遍（总编辑 pass；false 时行为与旧版一致）
  colorMode?: string;           // 色彩模式（theme.colorModes 提供时由 ConfigPanel 写入）
  watermark?: WatermarkSettings;  // 全局水印设置（features.watermark 开启时存在）

  // Mulby AI 模型选择（模型与密钥由 Mulby 宿主统一管理）
  textModel?: string;  // 文本/脚本模型 ID，留空使用 Mulby 默认模型
  imageModel?: string; // 图像生成模型 ID，留空使用第一个可用的图像生成模型
}

// ================= 费用统计（方案 5.2） =================
// 不再假设模型恒为 Gemini：按实际 modelId 分组统计；宿主未暴露价目，
// 美元金额由插件 services/pricing.ts 前缀匹配自维护——匹配不到只显 token/张数。

/** 文本调用未指定模型时的展示占位（宿主路由的实际模型 id 插件不可知） */
export const DEFAULT_TEXT_MODEL_LABEL = '(Mulby 默认)';

export interface UsageStat {
  kind: 'text' | 'image';
  modelId: string;            // 实际所用模型 id；文本留空时记 DEFAULT_TEXT_MODEL_LABEL
  inputTokens: number;
  outputTokens: number;
  imagesGenerated: number;
  estimated: boolean;         // usage 来自兜底估算时为 true
}

export interface ModelUsageBreakdown {
  cost: number | null;        // null = 未收录价目（一次都没计上价）
  inputTokens: number;
  outputTokens: number;
  images: number;
}

export interface TokenUsage {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalImages: number;
  estimatedCost: number;      // 已计价部分的估算总额（USD）
  unpricedCalls: number;      // 未计价调用次数（模型不在价表内）
  breakdown: Record<string, ModelUsageBreakdown>; // key = modelId
  history: {
    action: string;
    stat: UsageStat;
    cost: number | null;      // null = 该次调用未计价
    timestamp: number;
  }[];
}
