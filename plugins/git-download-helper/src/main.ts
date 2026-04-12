type PluginContext = BackendPluginContext

const PLUGIN_TAG = '[git-download-helper]'
const DEFAULT_ACCELERATOR_PREFIX = 'https://gh-proxy.com/'
const STORAGE_KEYS = {
  acceleratorPrefix: 'acceleratorPrefix',
  downloaderCommand: 'downloaderCommand',
  downloaderArgsTemplate: 'downloaderArgsTemplate'
} as const

function log(message: string) {
  console.log(`${PLUGIN_TAG} ${message}`)
}

function ensurePrefix(prefix: string): string {
  const trimmed = prefix.trim()
  if (trimmed.length === 0) return DEFAULT_ACCELERATOR_PREFIX
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`
}

function readStorageString(context: PluginContext, key: string): string | undefined {
  const raw = context.api.storage.get(key)
  return typeof raw === 'string' ? raw : undefined
}

function writeStorageString(context: PluginContext, key: string, value: string) {
  context.api.storage.set(key, value)
}

function extractPayload(raw: string, commandPrefixes: string[]): string | null {
  const normalized = raw.trim()
  const lower = normalized.toLowerCase()
  for (const prefix of commandPrefixes) {
    if (lower.startsWith(prefix.toLowerCase())) {
      return normalized.slice(prefix.length).trim()
    }
  }
  return null
}

function isGithubUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim())
    return u.hostname === 'github.com' || u.hostname === 'raw.githubusercontent.com'
  } catch {
    return false
  }
}

function normalizeGithubUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim()
  const url = new URL(trimmed)
  const host = url.hostname

  if (host !== 'github.com') {
    return url.toString()
  }

  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length >= 5 && parts[2] === 'blob') {
    const owner = parts[0]
    const repo = parts[1]
    const branch = parts[3]
    const filePath = parts.slice(4).join('/')
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`
  }

  if (parts.length >= 5 && parts[2] === 'raw') {
    const owner = parts[0]
    const repo = parts[1]
    const branch = parts[3]
    const filePath = parts.slice(4).join('/')
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`
  }

  return url.toString()
}

function buildAcceleratedUrl(prefix: string, rawUrl: string): string {
  if (!isGithubUrl(rawUrl)) {
    throw new Error('仅支持 github.com 或 raw.githubusercontent.com 链接')
  }
  const normalizedPrefix = ensurePrefix(prefix)
  const normalizedGithubUrl = normalizeGithubUrl(rawUrl)
  if (normalizedPrefix.includes('{url}')) {
    return normalizedPrefix.replace('{url}', normalizedGithubUrl)
  }
  return `${normalizedPrefix}${normalizedGithubUrl}`
}

function parseArgsTemplate(template: string): string[] {
  const result: string[] = []
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match: RegExpExecArray | null = null
  while ((match = regex.exec(template)) !== null) {
    result.push(match[1] ?? match[2] ?? match[3] ?? '')
  }
  return result
}

async function tryRunDownloader(context: PluginContext, downloadUrl: string): Promise<boolean> {
  const command = readStorageString(context, STORAGE_KEYS.downloaderCommand)?.trim()
  if (!command) return false

  const template = readStorageString(context, STORAGE_KEYS.downloaderArgsTemplate) ?? '{url}'
  const parsed = parseArgsTemplate(template)
  const hasPlaceholder = parsed.some((part) => part.includes('{url}'))
  const args = parsed.map((part) => part.replaceAll('{url}', downloadUrl))
  if (!hasPlaceholder) {
    args.push(downloadUrl)
  }

  await context.api.shell.runCommand({
    command,
    args,
    timeoutMs: 15000
  })
  return true
}

function notify(context: PluginContext, message: string, type: 'success' | 'warning' | 'error' = 'success') {
  context.api.notification.show(message, type)
}

async function handleDownload(context: PluginContext, maybeUrl: string) {
  const candidate = maybeUrl.trim()
  if (!candidate) {
    notify(context, '未检测到链接，请输入或复制 GitHub 文件地址。', 'warning')
    return
  }

  if (!isGithubUrl(candidate)) {
    notify(context, '仅支持 github.com 或 raw.githubusercontent.com 链接。', 'warning')
    return
  }

  const prefix = readStorageString(context, STORAGE_KEYS.acceleratorPrefix) ?? DEFAULT_ACCELERATOR_PREFIX
  const accelerated = buildAcceleratedUrl(prefix, candidate)

  try {
    const usedDownloader = await tryRunDownloader(context, accelerated)
    if (usedDownloader) {
      await context.api.clipboard.writeText(accelerated)
      notify(context, '已调用下载器并复制加速链接到剪贴板。')
      return
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log(`调用下载器失败: ${message}`)
    notify(context, '下载器调用失败，已自动回退浏览器下载。', 'warning')
  }

  await context.api.shell.openExternal(accelerated)
  await context.api.clipboard.writeText(accelerated)
  notify(context, '已使用浏览器打开加速链接，并复制到剪贴板。')
}

export function onLoad() {
  log('插件已加载')
}

export function onUnload() {
  log('插件已卸载')
}

export function onEnable() {
  log('插件已启用')
}

export function onDisable() {
  log('插件已禁用')
}

export async function run(context: PluginContext) {
  const featureCode = context.featureCode ?? 'download-from-clipboard'
  const input = context.input?.trim() ?? ''

  if (featureCode === 'download-github-url') {
    await handleDownload(context, input)
    return
  }

  if (featureCode === 'download-from-clipboard') {
    const clipText = context.api.clipboard.readText().trim()
    await handleDownload(context, clipText)
    return
  }

  if (featureCode === 'set-accelerator-prefix') {
    const payload = extractPayload(input, ['gdh prefix ', 'git下载 prefix '])
    if (!payload || !/^https?:\/\/\S+$/i.test(payload)) {
      notify(context, '格式错误。示例：gdh prefix https://gh-proxy.com/', 'warning')
      return
    }
    writeStorageString(context, STORAGE_KEYS.acceleratorPrefix, payload)
    notify(context, `加速前缀已更新为：${ensurePrefix(payload)}`)
    return
  }

  if (featureCode === 'set-downloader-command') {
    const payload = extractPayload(input, ['gdh cmd ', 'git下载 cmd '])
    if (!payload) {
      notify(context, '格式错误。示例：gdh cmd IDMan.exe', 'warning')
      return
    }
    writeStorageString(context, STORAGE_KEYS.downloaderCommand, payload)
    notify(context, `下载器命令已更新：${payload}`)
    return
  }

  if (featureCode === 'set-downloader-args') {
    const payload = extractPayload(input, ['gdh args ', 'git下载 args '])
    if (!payload) {
      notify(context, '格式错误。示例：gdh args /d "{url}" /n /a', 'warning')
      return
    }
    writeStorageString(context, STORAGE_KEYS.downloaderArgsTemplate, payload)
    notify(context, `下载器参数模板已更新：${payload}`)
    return
  }

  if (featureCode === 'clear-downloader-config') {
    context.api.storage.remove(STORAGE_KEYS.downloaderCommand)
    context.api.storage.remove(STORAGE_KEYS.downloaderArgsTemplate)
    notify(context, '下载器配置已清除，后续将回退到浏览器下载。')
    return
  }

  if (featureCode === 'show-config') {
    const prefix = readStorageString(context, STORAGE_KEYS.acceleratorPrefix) ?? DEFAULT_ACCELERATOR_PREFIX
    const cmd = readStorageString(context, STORAGE_KEYS.downloaderCommand) ?? '(未配置)'
    const args = readStorageString(context, STORAGE_KEYS.downloaderArgsTemplate) ?? '(未配置，默认 {url})'
    notify(context, `前缀: ${ensurePrefix(prefix)} | 命令: ${cmd} | 参数: ${args}`)
    return
  }

  notify(context, '未识别的功能触发，请检查 manifest 配置。', 'warning')
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run }
export default plugin
