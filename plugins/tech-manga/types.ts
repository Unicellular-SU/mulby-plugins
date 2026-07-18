
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

export interface ComicPageData extends ComicPageScript {
  title?: string; // Optional title for the cover page
  imageData?: string; // Base64 image of the whole page
  isGenerating: boolean;
  error?: string;
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

export type ModelType = 'GEMINI_3_PRO' | 'GEMINI_3_PRO_IMAGE' | 'GEMINI_2_5_FLASH_IMAGE';

export interface UsageStat {
  inputTokens: number;
  outputTokens: number;
  imagesGenerated: number;
  modelType: ModelType; 
}

export interface TokenUsage {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalImages: number;
  estimatedCost: number;
  breakdown: {
    gemini3ProCost: number;
    gemini3ProImageCost: number;
    gemini25FlashImageCost: number;
  };
  history: {
    action: string;
    stat: UsageStat;
    cost: number;
    timestamp: number;
  }[];
}
