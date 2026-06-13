export interface FileItem {
  name: string
  path: string
  isDirectory: boolean
  size?: number
  ext: string
  icon?: string
}

export type CategoryId =
  | 'all'
  | 'image'
  | 'document'
  | 'spreadsheet'
  | 'video-audio'
  | 'archive'
  | 'text'
  | 'other'

export interface Category {
  id: CategoryId
  label: string
  icon: string
  extensions: string[]
}

export const CATEGORIES: Category[] = [
  { id: 'all', label: '全部', icon: 'layers', extensions: [] },
  {
    id: 'image',
    label: '图片',
    icon: 'image',
    extensions: [
      '.png', '.jpg', '.jpeg', '.bmp', '.gif', '.svg', '.ico', '.webp', '.psd', '.ai', '.tiff', '.tif',
    ],
  },
  {
    id: 'spreadsheet',
    label: '表格',
    icon: 'table',
    extensions: ['.xls', '.xlsx', '.csv'],
  },
  {
    id: 'document',
    label: '文档',
    icon: 'file-text',
    extensions: ['.docx', '.doc', '.pdf', '.ppt', '.pptx', '.pages', '.key', '.numbers'],
  },
  {
    id: 'video-audio',
    label: '音视频',
    icon: 'play-circle',
    extensions: [
      '.flac', '.mp4', '.m4a', '.mp3', '.ogv', '.ogm', '.ogg', '.oga', '.opus',
      '.webm', '.wav', '.avi', '.mkv', '.mov', '.aac', '.wma',
    ],
  },
  {
    id: 'archive',
    label: '压缩',
    icon: 'archive',
    extensions: ['.zip', '.gz', '.7z', '.rar', '.tar', '.bz2', '.xz'],
  },
  {
    id: 'text',
    label: '文本',
    icon: 'file-code',
    extensions: [
      '.txt', '.md', '.json', '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg',
      '.conf', '.log', '.sh', '.bash', '.zsh', '.bat', '.cmd', '.ps1',
      '.js', '.ts', '.jsx', '.tsx', '.py', '.rb', '.go', '.rs', '.java',
      '.c', '.cpp', '.h', '.hpp', '.cs', '.swift', '.kt', '.lua',
      '.html', '.htm', '.css', '.scss', '.less', '.sql', '.graphql',
    ],
  },
  { id: 'other', label: '其他', icon: 'file', extensions: [] },
]

export function getExtension(name: string): string {
  const lastDot = name.lastIndexOf('.')
  if (lastDot <= 0) return ''
  return name.slice(lastDot).toLowerCase()
}

export function getCategoryForFile(ext: string): CategoryId {
  if (!ext) return 'other'
  for (const cat of CATEGORIES) {
    if (cat.id === 'all' || cat.id === 'other') continue
    if (cat.extensions.includes(ext)) return cat.id
  }
  return 'other'
}

export function filterByCategory(files: FileItem[], category: CategoryId): FileItem[] {
  if (category === 'all') return files
  return files.filter((f) => getCategoryForFile(f.ext) === category)
}

export function formatFileSize(bytes?: number): string {
  if (bytes == null || bytes < 0) return ''
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const val = bytes / Math.pow(1024, i)
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[i]}`
}

export function getParentDir(path: string): string {
  const sep = path.includes('\\') ? '\\' : '/'
  const parts = path.split(sep)
  parts.pop()
  return parts.join(sep)
}

// ============ 预览类型系统 ============
// renderer 决定用哪个子组件渲染；source 决定调度器（FilePreview）如何加载文件内容。
export type PreviewRenderer =
  | 'image'        // 浏览器可解码（png/jpg/svg/webp/avif/heic…）
  | 'image-native' // 浏览器无法解码，需后端 sharp 解码为 PNG（tiff/psd）
  | 'text'         // 纯文本 + 行号 + 换行开关
  | 'code'         // 语法高亮
  | 'markdown'
  | 'json'
  | 'audio'
  | 'video'
  | 'pdf'
  | 'spreadsheet'  // csv/xls/xlsx
  | 'docx'
  | 'archive'      // zip 文件树
  | 'none'

export type PreviewSource = 'text' | 'base64' | 'filepath' | 'backend'

export interface PreviewSpec {
  renderer: PreviewRenderer
  source: PreviewSource
}

// 浏览器原生可解码的位图
const IMAGE_BROWSER_EXTS = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.ico', '.webp'])
// 较新 Chromium 多半可解码；解码失败时再回退到后端 sharp
const IMAGE_MAYBE_EXTS = new Set(['.avif', '.heic', '.heif'])
// 浏览器无法解码，必须走后端 sharp
const IMAGE_NATIVE_EXTS = new Set(['.tiff', '.tif', '.psd'])
const MARKDOWN_EXTS = new Set(['.md', '.markdown'])
const JSON_EXTS = new Set(['.json', '.json5'])
const CODE_EXTS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx', '.py', '.rb', '.go', '.rs', '.java',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.swift', '.kt', '.lua',
  '.html', '.htm', '.css', '.scss', '.less', '.sql', '.graphql',
  '.sh', '.bash', '.zsh', '.bat', '.cmd', '.ps1',
  '.xml', '.yaml', '.yml', '.ini', '.cfg', '.conf', '.toml',
])
const PLAIN_TEXT_EXTS = new Set(['.txt', '.log'])
const SPREADSHEET_EXTS = new Set(['.csv', '.xls', '.xlsx'])
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.flac', '.m4a', '.oga', '.opus', '.aac', '.ogg', '.wma'])
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.ogv', '.ogm', '.mkv', '.avi', '.mov'])

export function getPreviewSpec(ext: string): PreviewSpec {
  if (ext === '.svg') return { renderer: 'image', source: 'text' }
  if (IMAGE_BROWSER_EXTS.has(ext)) return { renderer: 'image', source: 'base64' }
  if (IMAGE_MAYBE_EXTS.has(ext)) return { renderer: 'image', source: 'filepath' }
  if (IMAGE_NATIVE_EXTS.has(ext)) return { renderer: 'image-native', source: 'backend' }
  if (ext === '.pdf') return { renderer: 'pdf', source: 'base64' }
  if (JSON_EXTS.has(ext)) return { renderer: 'json', source: 'text' }
  if (MARKDOWN_EXTS.has(ext)) return { renderer: 'markdown', source: 'text' }
  if (CODE_EXTS.has(ext)) return { renderer: 'code', source: 'text' }
  if (SPREADSHEET_EXTS.has(ext)) return { renderer: 'spreadsheet', source: 'base64' }
  if (ext === '.docx') return { renderer: 'docx', source: 'base64' }
  if (ext === '.zip') return { renderer: 'archive', source: 'base64' }
  if (AUDIO_EXTS.has(ext)) return { renderer: 'audio', source: 'filepath' }
  if (VIDEO_EXTS.has(ext)) return { renderer: 'video', source: 'filepath' }
  if (PLAIN_TEXT_EXTS.has(ext)) return { renderer: 'text', source: 'text' }
  return { renderer: 'none', source: 'filepath' }
}

// 兼容旧调用点（历史上仅 FilePreview 使用过）
export type PreviewType = PreviewRenderer
export function getPreviewType(ext: string): PreviewType {
  return getPreviewSpec(ext).renderer
}

// 图片 MIME（用于 base64 data URI）
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.bmp': 'image/bmp', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.avif': 'image/avif',
  '.heic': 'image/heic', '.heif': 'image/heif',
}
export function imageMimeForExt(ext: string): string {
  return IMAGE_MIME[ext] || 'image/png'
}

// 含透明通道的格式：预览时在其后绘制棋盘格
const TRANSPARENT_EXTS = new Set([
  '.png', '.gif', '.webp', '.svg', '.ico', '.avif', '.tiff', '.tif', '.psd', '.heic', '.heif',
])
export function hasTransparency(ext: string): boolean {
  return TRANSPARENT_EXTS.has(ext)
}

// 扩展名 → Prism 语言名
export const EXT_TO_LANG: Record<string, string> = {
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.jsx': 'jsx', '.ts': 'typescript', '.tsx': 'tsx',
  '.py': 'python', '.rb': 'ruby', '.go': 'go', '.rs': 'rust', '.java': 'java',
  '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.hpp': 'cpp', '.cs': 'csharp',
  '.swift': 'swift', '.kt': 'kotlin', '.lua': 'lua',
  '.html': 'markup', '.htm': 'markup', '.xml': 'markup',
  '.css': 'css', '.scss': 'scss', '.less': 'less',
  '.sql': 'sql', '.graphql': 'graphql',
  '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash',
  '.bat': 'batch', '.cmd': 'batch', '.ps1': 'powershell',
  '.yaml': 'yaml', '.yml': 'yaml', '.ini': 'ini', '.cfg': 'ini', '.conf': 'ini',
  '.toml': 'toml', '.json': 'json', '.json5': 'json',
}
export function langForExt(ext: string): string {
  return EXT_TO_LANG[ext] || 'text'
}

// 各 renderer 的体积上限（字节）。超过则只显示提示，不读取内容。
const TEXT_MAX = 512 * 1024
const SIZE_LIMITS: Partial<Record<PreviewRenderer, number>> = {
  text: TEXT_MAX,
  code: TEXT_MAX,
  markdown: TEXT_MAX,
  json: TEXT_MAX,
  pdf: 50 * 1024 * 1024,
  spreadsheet: 15 * 1024 * 1024,
  docx: 15 * 1024 * 1024,
  archive: 25 * 1024 * 1024,
  image: 40 * 1024 * 1024,
  'image-native': 60 * 1024 * 1024,
}
export function sizeLimitForRenderer(renderer: PreviewRenderer): number | undefined {
  return SIZE_LIMITS[renderer]
}

// 检测「按文本读取的内容」其实是二进制（如 zstd/gzip 压缩包、可执行文件等被当成
// UTF-8 解码后会出现大量替换字符）。采样前 8KB，统计 NUL 与 U+FFFD（无效 UTF-8
// 解码产物）的占比，超过阈值即判定为二进制，避免渲染乱码并拖垮 UI。
export function looksBinary(text: string): boolean {
  if (!text) return false
  const sample = text.length > 8192 ? text.slice(0, 8192) : text
  let suspicious = 0
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i)
    if (c === 0 || c === 0xfffd) suspicious++
  }
  return suspicious / sample.length > 0.02
}

export function getCategoryCounts(files: FileItem[]): Record<CategoryId, number> {
  const counts: Record<CategoryId, number> = {
    all: files.length,
    image: 0,
    document: 0,
    spreadsheet: 0,
    'video-audio': 0,
    archive: 0,
    text: 0,
    other: 0,
  }
  for (const f of files) {
    const cat = getCategoryForFile(f.ext)
    counts[cat]++
  }
  return counts
}
