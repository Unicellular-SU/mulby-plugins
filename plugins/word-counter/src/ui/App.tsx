import { useDeferredValue, useEffect, useRef, useState, startTransition } from 'react'
import {
  ClipboardPaste,
  Clock3,
  Copy,
  Eraser,
  FileText,
  Hash,
  Languages,
  Pilcrow,
  Type
} from 'lucide-react'
import { analyzeText } from '../text-stats'
import { useMulby } from './hooks/useMulby'

type SourceMeta = {
  label: string
  note: string
}

const PLUGIN_ID = 'word-counter'
const STORAGE_KEY = 'draft:text'
const SAMPLE_TEXT = [
  'Mulby 让桌面工作流更顺手。',
  '这段示例文本同时包含中文、English words、12345 数字，以及两段结构。',
  '',
  '第二段可以帮助你确认句子、段落和阅读时长的计算结果。',
  '把它替换成会议纪要、产品文案或灵感草稿，统计结果会实时刷新。'
].join('\n')

const defaultSource: SourceMeta = {
  label: '手动模式',
  note: '支持直接输入、从剪贴板粘贴，或通过划词把文本带进来。'
}

const numberFormatter = new Intl.NumberFormat('zh-CN')

function formatNumber(value: number) {
  return numberFormatter.format(value)
}

function getSourceMeta(featureCode?: string, input?: string): SourceMeta {
  if (featureCode === 'count-selection') {
    return {
      label: '来自划词',
      note: input?.trim()
        ? '已接收外部选中的文本，你可以直接查看统计结果。'
        : '本次划词没有带入文本，请重新选择内容后触发。'
    }
  }

  if (input?.trim()) {
    return {
      label: '带参启动',
      note: '插件打开时已经带入文本，你可以继续编辑或追加内容。'
    }
  }

  return defaultSource
}

function formatReadingTime(minutes: number) {
  if (minutes <= 0) {
    return '0 分钟'
  }

  if (minutes < 1) {
    return '< 1 分钟'
  }

  if (minutes < 10) {
    return `${minutes.toFixed(1)} 分钟`
  }

  const roundedMinutes = Math.round(minutes)
  if (roundedMinutes < 60) {
    return `${roundedMinutes} 分钟`
  }

  const hours = Math.floor(roundedMinutes / 60)
  const remainMinutes = roundedMinutes % 60
  return remainMinutes === 0 ? `${hours} 小时` : `${hours} 小时 ${remainMinutes} 分钟`
}

function formatTimestamp(value: number | null) {
  if (!value) {
    return '尚未更新'
  }

  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(value)
}

export default function App() {
  const [input, setInput] = useState('')
  const [source, setSource] = useState<SourceMeta>(defaultSource)
  const [hydrated, setHydrated] = useState(false)
  const [isReadingClipboard, setIsReadingClipboard] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null)
  const { clipboard, notification, storage } = useMulby(PLUGIN_ID)
  const deferredInput = useDeferredValue(input)
  const stats = analyzeText(deferredInput)
  const hasText = input.trim().length > 0
  const hasInitPayloadRef = useRef(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const initialTheme = (params.get('theme') as 'light' | 'dark') || 'light'
    document.documentElement.classList.toggle('dark', initialTheme === 'dark')

    window.mulby?.onThemeChange?.((newTheme: 'light' | 'dark') => {
      document.documentElement.classList.toggle('dark', newTheme === 'dark')
    })

    window.mulby?.onPluginInit?.((data: PluginInitData) => {
      const incomingInput = data.input ?? ''
      hasInitPayloadRef.current = data.featureCode === 'count-selection' || incomingInput.trim().length > 0
      setSource(getSourceMeta(data.featureCode, incomingInput))
      setLastUpdatedAt(Date.now())
      startTransition(() => {
        setInput(incomingInput)
      })
    })

    let cancelled = false

    async function loadDraft() {
      try {
        const savedDraft = await storage.get(STORAGE_KEY)
        if (!cancelled && !hasInitPayloadRef.current && typeof savedDraft === 'string' && savedDraft.trim()) {
          setInput(savedDraft)
          setLastUpdatedAt(Date.now())
        }
      } finally {
        if (!cancelled) {
          setHydrated(true)
        }
      }
    }

    void loadDraft()

    return () => {
      cancelled = true
    }
  }, [storage])

  useEffect(() => {
    if (!hydrated) {
      return
    }

    const timer = window.setTimeout(() => {
      void (async () => {
        if (input.trim()) {
          await storage.set(STORAGE_KEY, input)
        } else {
          await storage.remove(STORAGE_KEY)
        }
      })()
    }, 200)

    return () => {
      window.clearTimeout(timer)
    }
  }, [hydrated, input, storage])

  const totalCharacters = stats.rawCharacters || 1
  const composition = [
    {
      label: '汉字',
      value: stats.chineseCharacters,
      share: (stats.chineseCharacters / totalCharacters) * 100,
      toneClass: 'tone-han'
    },
    {
      label: '拉丁字母',
      value: stats.latinLetters,
      share: (stats.latinLetters / totalCharacters) * 100,
      toneClass: 'tone-latin'
    },
    {
      label: '数字',
      value: stats.numbers,
      share: (stats.numbers / totalCharacters) * 100,
      toneClass: 'tone-number'
    },
    {
      label: '空白',
      value: stats.whitespace,
      share: (stats.whitespace / totalCharacters) * 100,
      toneClass: 'tone-space'
    },
    {
      label: '标点与符号',
      value: stats.symbols,
      share: (stats.symbols / totalCharacters) * 100,
      toneClass: 'tone-symbol'
    }
  ]

  const summaryText = [
    '字数统计摘要',
    `总字符：${formatNumber(stats.rawCharacters)}`,
    `非空白字符：${formatNumber(stats.charactersNoSpaces)}`,
    `汉字数：${formatNumber(stats.chineseCharacters)}`,
    `英文词数：${formatNumber(stats.englishWords)}`,
    `句子数：${formatNumber(stats.sentences)}`,
    `段落数：${formatNumber(stats.paragraphs)}`,
    `行数：${formatNumber(stats.lines)}`,
    `预计阅读：${formatReadingTime(stats.readingMinutes)}`
  ].join('\n')

  const statusText = hasText
    ? `上次更新于 ${formatTimestamp(lastUpdatedAt)}`
    : '等待文本输入后自动统计'

  const insightText = hasText
    ? `这段内容预计阅读 ${formatReadingTime(stats.readingMinutes)}，平均每句 ${formatNumber(
      Math.round(stats.charactersNoSpaces / Math.max(stats.sentences, 1))
    )} 个非空白字符。`
    : '粘贴文本后，这里会给出节奏感和结构上的快速判断。'

  const averageParagraphLength = stats.paragraphs > 0
    ? Math.round(stats.charactersNoSpaces / stats.paragraphs)
    : 0

  const handlePasteClipboard = async () => {
    setIsReadingClipboard(true)

    try {
      const clipboardText = (await clipboard.readText()) ?? ''
      if (!clipboardText.trim()) {
        notification.show('剪贴板里没有可统计的文本。', 'warning')
        return
      }

      setSource({
        label: '来自剪贴板',
        note: '已从系统剪贴板载入文本，你可以继续编辑再统计。'
      })
      setLastUpdatedAt(Date.now())
      startTransition(() => {
        setInput(clipboardText)
      })
      notification.show('已载入剪贴板文本。', 'success')
    } catch (error) {
      console.error(error)
      notification.show('读取剪贴板失败。', 'error')
    } finally {
      setIsReadingClipboard(false)
    }
  }

  const handleUseSample = () => {
    setSource({
      label: '示例文本',
      note: '这是一段混合中英文与数字的示例，适合用来快速检查统计逻辑。'
    })
    setLastUpdatedAt(Date.now())
    startTransition(() => {
      setInput(SAMPLE_TEXT)
    })
  }

  const handleClear = async () => {
    setSource(defaultSource)
    setLastUpdatedAt(Date.now())
    startTransition(() => {
      setInput('')
    })
    await storage.remove(STORAGE_KEY)
    notification.show('已清空当前文本。', 'success')
  }

  const handleCopySummary = async () => {
    if (!hasText) {
      notification.show('请先输入或粘贴文本。', 'warning')
      return
    }

    await clipboard.writeText(summaryText)
    notification.show('统计摘要已复制。', 'success')
  }

  return (
    <div className="shell">

      <main className="layout">
        <section className="editor card">
          <div className="section-head">
            <div>
              <h2>文本输入</h2>
              <p>支持手动编辑、外部划词传入和系统剪贴板读取。</p>
            </div>

            <div className="toolbar">
              <button className="ghost-button" onClick={handlePasteClipboard} disabled={isReadingClipboard}>
                <ClipboardPaste size={15} />
                {isReadingClipboard ? '读取中' : '剪贴板'}
              </button>
              <button className="ghost-button" onClick={handleUseSample}>
                <FileText size={15} />
                示例文本
              </button>
              <button className="ghost-button" onClick={handleCopySummary} disabled={!hasText}>
                <Copy size={15} />
                复制摘要
              </button>
              <button className="ghost-button" onClick={handleClear} disabled={!hasText}>
                <Eraser size={15} />
                清空
              </button>
            </div>
          </div>

          <textarea
            className="editor-input"
            value={input}
            onChange={(event) => {
              setLastUpdatedAt(Date.now())
              setInput(event.target.value)
            }}
            placeholder="在这里粘贴文本，或通过 Mulby 的划词触发“统计字数”来直接带入内容。"
            spellCheck={false}
          />

          <div className="editor-foot">
            <span>{statusText}</span>
            <span>{hasText ? `非空白字符 ${formatNumber(stats.charactersNoSpaces)}` : '输入后立即刷新统计'}</span>
          </div>
        </section>

        <section className="stats-grid">
          <article className="stat-card card">
            <span className="stat-label"><Hash size={14} /> 总字符</span>
            <strong>{formatNumber(stats.rawCharacters)}</strong>
            <p>包含空格、换行和标点。</p>
          </article>
          <article className="stat-card card">
            <span className="stat-label"><Type size={14} /> 非空白</span>
            <strong>{formatNumber(stats.charactersNoSpaces)}</strong>
            <p>适合判断正文实际长度。</p>
          </article>
          <article className="stat-card card">
            <span className="stat-label"><Languages size={14} /> 汉字数</span>
            <strong>{formatNumber(stats.chineseCharacters)}</strong>
            <p>中文稿件最常用的核心指标。</p>
          </article>
          <article className="stat-card card">
            <span className="stat-label"><FileText size={14} /> 英文词数</span>
            <strong>{formatNumber(stats.englishWords)}</strong>
            <p>按英文单词边界粗略统计。</p>
          </article>
          <article className="stat-card card">
            <span className="stat-label"><Pilcrow size={14} /> 句子数</span>
            <strong>{formatNumber(stats.sentences)}</strong>
            <p>依据中英文句末标点拆分。</p>
          </article>
          <article className="stat-card card">
            <span className="stat-label"><Pilcrow size={14} /> 段落数</span>
            <strong>{formatNumber(stats.paragraphs)}</strong>
            <p>以空行分隔的自然段为准。</p>
          </article>
          <article className="stat-card card">
            <span className="stat-label"><FileText size={14} /> 行数</span>
            <strong>{formatNumber(stats.lines)}</strong>
            <p>保留原始换行结构。</p>
          </article>
          <article className="stat-card card accent-card">
            <span className="stat-label"><Clock3 size={14} /> 预计阅读</span>
            <strong>{formatReadingTime(stats.readingMinutes)}</strong>
            <p>基于中英文内容混合估算。</p>
          </article>
        </section>

        <section className="detail-grid">
          <article className="card detail-card">
            <div className="section-head compact">
              <div>
                <h2>内容构成</h2>
                <p>从字符级别看当前文本的结构占比。</p>
              </div>
            </div>

            <div className="composition-list">
              {composition.map((item) => (
                <div key={item.label} className="composition-row">
                  <div className="composition-meta">
                    <span>{item.label}</span>
                    <span>
                      {formatNumber(item.value)}
                      {stats.rawCharacters > 0 ? ` · ${item.share.toFixed(1)}%` : ''}
                    </span>
                  </div>
                  <div className="composition-track">
                    <span
                      className={`composition-fill ${item.toneClass}`}
                      style={{ width: `${item.value === 0 ? 0 : Math.max(item.share, 6)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="card detail-card">
            <div className="section-head compact">
              <div>
                <h2>快速判断</h2>
                <p>{insightText}</p>
              </div>
            </div>

            <div className="insight-list">
              <div className="insight-item">
                <span>平均段落长度</span>
                <strong>{formatNumber(averageParagraphLength)} 字</strong>
              </div>
              <div className="insight-item">
                <span>标点与符号</span>
                <strong>{formatNumber(stats.symbols)}</strong>
              </div>
              <div className="insight-item">
                <span>拉丁字母</span>
                <strong>{formatNumber(stats.latinLetters)}</strong>
              </div>
            </div>

            <div className="summary-box">
              <pre>{summaryText}</pre>
            </div>
          </article>
        </section>
      </main>
    </div>
  )
}
