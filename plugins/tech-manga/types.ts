
export enum ComicStyle {
  MANGA_BW = 'Japanese Manga (Black & White, High Contrast)',
  AMERICAN_COMIC = 'American Comic Book (Full Color, Bold Lines)',
  PIXEL_ART = 'Pixel Art (Retro Game Style)',
  WATERCOLOR = 'Watercolor (Soft, Artistic)',
  CYBERPUNK = 'Cyberpunk (Neon, High Tech, Dark)',
  MARVEL = 'Marvel Comic',
  PAPER_CUT = 'Chinese Paper-cut Animation',
  DISNEY = '3D Disney Animation style',
  // New Styles
  GHIBLI = 'Studio Ghibli (Lush Backgrounds, Detailed Animation)',
  NOIR = 'Film Noir (High Contrast B&W, Moody, Detective)',
  BLUEPRINT = 'Technical Blueprint (Schematic, Blue/White, Engineering)',
  LIGNE_CLAIRE = 'Ligne Claire (Tintin Style, Flat Colors, Clear Outlines)',
  UKIYOE = 'Ukiyo-e (Japanese Woodblock Print, Traditional)',
  VAPORWAVE = 'Vaporwave (Retro 80s, Pink/Cyan, Glitch aesthetic)',
  CLAYMATION = 'Claymation (Aardman/Laika style, Textured)',
  LOW_POLY = 'Low Poly 3D (Angular, Minimalist, Video Game)',
  SKETCH = 'Pencil Sketch (Rough, Graphite, Hand-drawn)',
  GRAFFITI = 'Street Art Graffiti (Bold, Spray Paint, Urban)',
  STEAMPUNK = 'Steampunk (Brass, Gears, Victorian Tech)',
  ART_DECO = 'Art Deco (Elegant, Geometric, Golden Age)',
  JUNJI_ITO = 'Junji Ito Style (Horror, Detailed Lines, Uncanny)',
  CHIBI = 'Chibi / SD (Cute, Big Head, Expressive)',
  OIL_PAINTING = 'Classic Oil Painting (Textured, Rich Colors)',
  CUSTOM = 'Custom'
}

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
    injuries: string[]; // Adapted to "Visual Effects" or "Status Conditions" for Tech
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

// New Interface for the full AI response
export interface ComicResponse {
  title: string; // Comic Title
  global_art_style: string; // Just the art style (colors, lines), NO characters.
  character_sheet: CharacterSheetItem[]; // Array of character descriptions
  prop_sheet: PropSheetItem[]; // Array of prop descriptions
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
  imageData?: string; // Base64 image of the whole page
  isGenerating: boolean;
  error?: string;
  progress?: ImageProgress; // 生成期间的实时进度（方案 5.3；不落盘）
}

export interface AppConfig {
  sourceText: string;
  style: string; // Enum value or custom string
  character: CharacterProfile;
  storyMode: StoryMode;
  customStoryPrompt?: string; // For StoryMode.CUSTOM
  panelCount: number; // 0 for auto
  aspectRatio: string;
  totalPages: string; // "Short", "Medium", "Long"

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
