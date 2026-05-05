/// <reference path="./types/mulby.d.ts" />

declare const mulby: any;

type PluginContext = BackendPluginContext

const PLUGIN_TAG = '[word-counter]'

function logLifecycle(event: string) {
  console.log(`${PLUGIN_TAG} ${event}`)
}

// ── 内嵌文本统计（仅用于 MainPush 快捷推送）──

function analyzeForPush(input: string) {
  const normalized = input.replace(/\r\n?/g, '\n')
  const chars = Array.from(normalized)

  const rawCharacters = chars.length
  const charactersNoSpaces = chars.filter((c) => !/\s/u.test(c)).length
  const chineseCharacters = chars.filter((c) => /\p{Script=Han}/u.test(c)).length
  const englishWords = normalized.match(/[A-Za-z]+(?:[''-][A-Za-z]+)*/g)?.length ?? 0
  const trimmed = normalized.trim()
  const lines = trimmed ? normalized.split('\n').length : 0
  const sentences = trimmed ? normalized.split(/[.!?。！？]+/u).filter((p) => p.trim()).length : 0

  const mixedMin = chineseCharacters / 320 + englishWords / 220
  const fallbackMin = charactersNoSpaces / 500
  const readingMinutes = trimmed ? Math.max(mixedMin, fallbackMin) : 0

  return { rawCharacters, charactersNoSpaces, chineseCharacters, englishWords, lines, sentences, readingMinutes }
}

function formatReadingTime(minutes: number): string {
  if (minutes < 1) return '不到 1 分钟'
  if (minutes < 60) return `约 ${Math.ceil(minutes)} 分钟`
  const hours = Math.floor(minutes / 60)
  const remaining = Math.ceil(minutes % 60)
  return remaining > 0 ? `约 ${hours} 小时 ${remaining} 分钟` : `约 ${hours} 小时`
}

// ── MainPush 注册 ──

let mainPushRegistered = false

function registerMainPush(api: any) {
  if (mainPushRegistered) return
  mainPushRegistered = true

  api.features.onMainPush((action: { code: string; type: string; payload: string }) => {
    const text = action.payload
    if (!text.trim()) return []

    const stats = analyzeForPush(text)
    const parts: string[] = []
    if (stats.chineseCharacters > 0) parts.push(`${stats.chineseCharacters} 汉字`)
    if (stats.englishWords > 0) parts.push(`${stats.englishWords} 英文词`)
    parts.push(`${stats.rawCharacters} 字符`)
    if (stats.lines > 1) parts.push(`${stats.lines} 行`)
    if (stats.sentences > 1) parts.push(`${stats.sentences} 句`)

    return [{
      title: parts.join(' · '),
      text: `阅读时间 ${formatReadingTime(stats.readingMinutes)}`,
      _stats: stats
    }]
  })

  api.features.onMainPushSelect(async (action: { code: string; type: string; payload: string; option: { title: string; text: string } }) => {
    await api.clipboard.writeText(action.option.title)
    api.notification.show(`已复制: ${action.option.title}`)
    return false
  })

  logLifecycle('MainPush 处理程序已注册')
}

// ── 生命周期 ──

export function onLoad() {
  logLifecycle('插件已加载')
}

export function onUnload() {
  logLifecycle('插件已卸载')
}

export function onEnable() {
  logLifecycle('插件已启用')
}

export function onDisable() {
  logLifecycle('插件已禁用')
}

export function onBackground({ api }: { api: any }) {
  logLifecycle('后台模式启动')
  registerMainPush(api)
}

export async function run(context: PluginContext) {
  const featureCode = context.featureCode ?? 'open-counter'
  const input = context.input?.trim() ?? ''
  const api = context.api as any

  registerMainPush(api)

  if (featureCode === 'count-selection' && input.length === 0) {
    mulby.notification.show('未检测到选中文本，请先选中内容后再试一次。', 'warning')
    return
  }

  console.log(`${PLUGIN_TAG} 触发功能: ${featureCode}, 输入长度: ${input.length}`)
}

const plugin = { onLoad, onUnload, onEnable, onDisable, onBackground, run }
export default plugin
