import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useMulby } from './hooks/useMulby'
import './App.css'

// ===== 类型 =====
interface MatchResult {
  match: string
  index: number
  length: number
  groups: { name?: string; value: string }[]
}

// ===== 常用正则预设 =====
const PRESETS = [
  { name: '邮箱地址', icon: '✉️', pattern: '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}', flags: 'gi' },
  { name: 'URL', icon: '🔗', pattern: 'https?://[^\\s<>"{}|\\\\^`\\[\\]]+', flags: 'gi' },
  { name: '手机号码', icon: '📱', pattern: '1[3-9]\\d{9}', flags: 'g' },
  { name: '身份证号', icon: '🆔', pattern: '\\d{17}[\\dXx]|\\d{15}', flags: 'g' },
  { name: 'IPv4', icon: '🌐', pattern: '\\b(?:(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.){3}(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\b', flags: 'g' },
  { name: 'HTML标签', icon: '🏷️', pattern: '<[^>]+>', flags: 'g' },
  { name: '中文字符', icon: '字', pattern: '[\\u4e00-\\u9fff]+', flags: 'g' },
  { name: '日期', icon: '📅', pattern: '\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}', flags: 'g' },
  { name: '十六进制色值', icon: '🎨', pattern: '#[0-9A-Fa-f]{3,8}\\b', flags: 'gi' },
  { name: '数字', icon: '🔢', pattern: '-?\\d+\\.?\\d*', flags: 'g' },
]

// ===== 正则速查表 =====
const CHEATSHEET = [
  { title: '字符类', items: [
    { token: '.', desc: '任意字符（除换行）' },
    { token: '\\d', desc: '数字 [0-9]' },
    { token: '\\w', desc: '字母数字下划线' },
    { token: '\\s', desc: '空白字符' },
    { token: '[abc]', desc: '字符集' },
    { token: '[^abc]', desc: '排除字符集' },
  ]},
  { title: '量词', items: [
    { token: '*', desc: '0 或多个' },
    { token: '+', desc: '1 或多个' },
    { token: '?', desc: '0 或 1 个' },
    { token: '{n}', desc: '恰好 n 个' },
    { token: '{n,m}', desc: 'n 到 m 个' },
  ]},
  { title: '锚点', items: [
    { token: '^', desc: '行首' },
    { token: '$', desc: '行尾' },
    { token: '\\b', desc: '单词边界' },
  ]},
  { title: '分组', items: [
    { token: '(abc)', desc: '捕获组' },
    { token: '(?:abc)', desc: '非捕获组' },
    { token: '(?<n>)', desc: '命名捕获组' },
    { token: 'a|b', desc: '或' },
  ]},
]

// ===== 标志定义 =====
const FLAGS = [
  { key: 'g', tip: '全局匹配' },
  { key: 'i', tip: '忽略大小写' },
  { key: 'm', tip: '多行模式' },
  { key: 's', tip: '点号匹配换行' },
  { key: 'u', tip: 'Unicode' },
]

// ===== 匹配色索引（循环使用 4 种颜色）=====
const COLOR_COUNT = 4

export default function App() {
  const [pattern, setPattern] = useState('')
  const [flags, setFlags] = useState('g')
  const [testText, setTestText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [showReplace, setShowReplace] = useState(false)
  const [sideTab, setSideTab] = useState<'presets' | 'cheatsheet'>('presets')
  const [showSide, setShowSide] = useState(true)
  const [toast, setToast] = useState('')
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const { clipboard, notification } = useMulby('reg_helper')

  // 初始化主题
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const initialTheme = (params.get('theme') as 'light' | 'dark') || 'dark'
    setTheme(initialTheme)
    document.documentElement.classList.toggle('dark', initialTheme === 'dark')

    window.mulby?.onThemeChange?.((newTheme: 'light' | 'dark') => {
      setTheme(newTheme)
      document.documentElement.classList.toggle('dark', newTheme === 'dark')
    })

    // 接收输入数据
    window.mulby?.onPluginInit?.((data: any) => {
      if (data.input) setTestText(data.input)
    })
  }, [])

  // 执行匹配
  const { matches, error, isValid } = useMemo(() => {
    if (!pattern.trim()) {
      return { matches: [] as MatchResult[], error: '', isValid: true }
    }
    try {
      const regex = new RegExp(pattern, flags)
      const results: MatchResult[] = []
      let m: RegExpExecArray | null
      regex.lastIndex = 0

      // 安全上限，防止零宽匹配无限循环
      let safety = 0
      while ((m = regex.exec(testText)) !== null && safety < 5000) {
        safety++
        const groups: { name?: string; value: string }[] = []
        // 处理命名捕获组
        if (m.groups) {
          for (const [name, value] of Object.entries(m.groups)) {
            groups.push({ name, value: value ?? '' })
          }
        }
        // 处理编号捕获组
        for (let i = 1; i < m.length; i++) {
          // 跳过已在命名组中出现的
          const alreadyNamed = groups.some(g => g.value === m![i] && g.name)
          if (!alreadyNamed || !m.groups) {
            groups.push({ value: m[i] ?? '' })
          }
        }

        results.push({
          match: m[0],
          index: m.index,
          length: m[0].length,
          groups: groups.length > 0 ? groups : [],
        })

        // 防止零宽匹配死循环
        if (m[0].length === 0) regex.lastIndex++
        if (!flags.includes('g')) break
      }
      return { matches: results, error: '', isValid: true }
    } catch (err: any) {
      return { matches: [] as MatchResult[], error: err.message, isValid: false }
    }
  }, [pattern, flags, testText])

  // 替换结果
  const replacedText = useMemo(() => {
    if (!pattern.trim() || !isValid || !showReplace) return ''
    try {
      const regex = new RegExp(pattern, flags)
      return testText.replace(regex, replaceText)
    } catch {
      return ''
    }
  }, [pattern, flags, testText, replaceText, isValid, showReplace])

  // 同步滚动
  const handleScroll = useCallback(() => {
    if (textareaRef.current && backdropRef.current) {
      backdropRef.current.scrollTop = textareaRef.current.scrollTop
      backdropRef.current.scrollLeft = textareaRef.current.scrollLeft
    }
  }, [])

  // 生成高亮 HTML
  const highlightedHtml = useMemo(() => {
    if (!pattern.trim() || !isValid || matches.length === 0 || !testText) {
      return null
    }

    let lastIndex = 0
    const parts: string[] = []

    matches.forEach((m, i) => {
      // 匹配前的文本
      if (m.index > lastIndex) {
        parts.push(escapeHtml(testText.substring(lastIndex, m.index)))
      }
      // 匹配的文本（带高亮标记）
      const colorIdx = i % COLOR_COUNT
      parts.push(`<mark class="hl-mark hl-mark-${colorIdx}">${escapeHtml(m.match)}</mark>`)
      lastIndex = m.index + m.length
    })

    // 剩余文本
    if (lastIndex < testText.length) {
      parts.push(escapeHtml(testText.substring(lastIndex)))
    }

    return parts.join('')
  }, [pattern, isValid, matches, testText])

  // 切换标志
  const toggleFlag = (f: string) => {
    setFlags(prev => prev.includes(f) ? prev.replace(f, '') : prev + f)
  }

  // 显示 toast
  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 1800)
  }

  // 复制正则表达式
  const copyRegex = async () => {
    const text = `/${pattern}/${flags}`
    try {
      await clipboard.writeText(text)
      showToast('已复制正则表达式')
      notification.show('正则表达式已复制', 'success')
    } catch {
      showToast('复制失败')
    }
  }

  // 复制匹配结果
  const copyMatches = async () => {
    if (matches.length === 0) return
    const text = matches.map(m => m.match).join('\n')
    try {
      await clipboard.writeText(text)
      showToast(`已复制 ${matches.length} 个匹配`)
      notification.show(`已复制 ${matches.length} 个匹配`, 'success')
    } catch {
      showToast('复制失败')
    }
  }

  // 复制替换结果
  const copyReplaced = async () => {
    if (!replacedText) return
    try {
      await clipboard.writeText(replacedText)
      showToast('已复制替换结果')
      notification.show('替换结果已复制', 'success')
    } catch {
      showToast('复制失败')
    }
  }

  // 应用预设
  const applyPreset = (p: typeof PRESETS[0]) => {
    setPattern(p.pattern)
    setFlags(p.flags)
    showToast(`已应用: ${p.name}`)
  }

  // 插入速查表片段
  const insertToken = (token: string) => {
    setPattern(prev => prev + token)
    // 聚焦正则输入框
    const input = document.querySelector('.regex-input') as HTMLInputElement
    input?.focus()
  }

  return (
    <div className="app">
      {/* 顶部工具栏 */}
      <div className="toolbar">
        <div className="toolbar-logo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
            <path d="M8 8l2 2m2-4v2" />
          </svg>
          <span>RegEx</span>
        </div>

        <div className="toolbar-divider" />

        {/* 标志切换 */}
        <div className="flag-group">
          {FLAGS.map(f => (
            <button
              key={f.key}
              className={`flag-btn ${flags.includes(f.key) ? 'active' : ''}`}
              onClick={() => toggleFlag(f.key)}
            >
              {f.key}
              <span className="flag-tooltip">{f.tip}</span>
            </button>
          ))}
        </div>

        <div className="toolbar-divider" />

        {/* 工具栏操作按钮 */}
        <div className="toolbar-actions">
          <button className="toolbar-btn" onClick={() => setShowReplace(!showReplace)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z" />
            </svg>
            替换
          </button>
          <button className="toolbar-btn" onClick={copyRegex} title="复制正则">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            复制
          </button>
          <button className="toolbar-btn" onClick={() => setShowSide(!showSide)} title="切换侧面板">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M15 3v18" />
            </svg>
          </button>
        </div>
      </div>

      {/* 正则输入栏 */}
      <div className="regex-bar">
        <div className="regex-bar-inner">
          <span className="regex-slash">/</span>
          <input
            type="text"
            className="regex-input"
            value={pattern}
            onChange={e => setPattern(e.target.value)}
            placeholder="输入正则表达式..."
            spellCheck={false}
            autoFocus
          />
          <span className="regex-slash">/</span>
          <input
            type="text"
            className="flags-input"
            value={flags}
            onChange={e => setFlags(e.target.value)}
            maxLength={6}
            spellCheck={false}
          />
        </div>
        <div className="regex-status">
          <div className={`status-dot ${!pattern ? 'empty' : error ? 'error' : ''}`} />
          {!pattern ? (
            <span>等待输入</span>
          ) : error ? (
            <span className="match-count error">语法错误</span>
          ) : (
            <span><span className="match-count">{matches.length}</span> 个匹配</span>
          )}
        </div>
      </div>

      {/* 替换栏 */}
      {showReplace && (
        <div className="replace-bar">
          <span className="replace-label">替换为</span>
          <input
            type="text"
            className="replace-input"
            value={replaceText}
            onChange={e => setReplaceText(e.target.value)}
            placeholder="替换文本..."
            spellCheck={false}
          />
          <div className="replace-actions">
            <button className="replace-btn" onClick={copyReplaced} disabled={!replacedText}>
              复制结果
            </button>
          </div>
        </div>
      )}

      {/* 错误提示 */}
      {error && <div className="error-banner">⚠ {error}</div>}

      {/* 主体区域 */}
      <div className="main-body">
        <div className="editor-area">
          {/* 测试文本区 */}
          <div className="test-section">
            <div className="section-header">
              <span className="section-title">测试文本</span>
              <span className="section-badge">
                {testText.length} 字符 · {testText.split('\n').length} 行
              </span>
            </div>
            <div className="highlight-container">
              {/* 高亮背景层 */}
              <div
                ref={backdropRef}
                className="highlight-backdrop"
                dangerouslySetInnerHTML={{ __html: highlightedHtml || escapeHtml(testText) || '' }}
              />
              {/* 文本输入层 */}
              <textarea
                ref={textareaRef}
                className={`test-textarea ${highlightedHtml ? 'has-matches' : ''}`}
                value={testText}
                onChange={e => setTestText(e.target.value)}
                onScroll={handleScroll}
                placeholder="在此输入或粘贴测试文本..."
                spellCheck={false}
                style={{ color: highlightedHtml ? 'transparent' : undefined }}
              />
            </div>
          </div>

          {/* 匹配结果 / 替换预览 */}
          <div className="results-section">
            <div className="section-header">
              <span className="section-title">
                {showReplace ? '替换预览' : '匹配详情'}
              </span>
              {!showReplace && matches.length > 0 && (
                <button
                  className="toolbar-btn"
                  onClick={copyMatches}
                  style={{ height: '24px', fontSize: '11px' }}
                >
                  复制全部
                </button>
              )}
            </div>

            {showReplace ? (
              // 替换预览
              <div className="replaced-preview">
                {replacedText ? (
                  <ReplacedPreview original={testText} replaced={replacedText} />
                ) : (
                  <div className="result-empty">
                    <span className="result-empty-icon">↻</span>
                    <span>输入正则和替换文本查看结果</span>
                  </div>
                )}
              </div>
            ) : (
              // 匹配列表
              <div className="results-list">
                {matches.length === 0 ? (
                  <div className="result-empty">
                    <span className="result-empty-icon">
                      {!pattern ? '🔍' : '∅'}
                    </span>
                    <span>{!pattern ? '输入正则表达式开始匹配' : '没有找到匹配'}</span>
                  </div>
                ) : (
                  matches.map((m, i) => (
                    <div key={i} className="match-item">
                      <div className={`match-badge match-badge-${i % COLOR_COUNT}`}>
                        {i + 1}
                      </div>
                      <div className="match-body">
                        <div className="match-text">{m.match || '(空匹配)'}</div>
                        <div className="match-meta">
                          <span>索引 {m.index}</span>
                          <span>长度 {m.length}</span>
                        </div>
                        {m.groups.length > 0 && (
                          <div className="match-groups">
                            {m.groups.map((g, gi) => (
                              <span key={gi} className="group-tag">
                                <span className="group-tag-label">
                                  {g.name ? g.name : `$${gi + 1}`}
                                </span>
                                <span className="group-tag-value">{g.value || '(空)'}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* 侧面板 */}
        <div className={`side-panel ${showSide ? '' : 'hidden'}`}>
          <div className="panel-tabs">
            <button
              className={`panel-tab ${sideTab === 'presets' ? 'active' : ''}`}
              onClick={() => setSideTab('presets')}
            >
              预设模式
            </button>
            <button
              className={`panel-tab ${sideTab === 'cheatsheet' ? 'active' : ''}`}
              onClick={() => setSideTab('cheatsheet')}
            >
              速查表
            </button>
          </div>
          <div className="panel-content">
            {sideTab === 'presets' ? (
              PRESETS.map((p, i) => (
                <div key={i} className="preset-item" onClick={() => applyPreset(p)}>
                  <span className="preset-icon">{p.icon}</span>
                  <div className="preset-info">
                    <div className="preset-name">{p.name}</div>
                    <div className="preset-pattern">/{p.pattern}/</div>
                  </div>
                </div>
              ))
            ) : (
              CHEATSHEET.map((section, si) => (
                <div key={si} className="cheatsheet-section">
                  <div className="cheatsheet-title">{section.title}</div>
                  {section.items.map((item, ii) => (
                    <div
                      key={ii}
                      className="cheatsheet-item"
                      onClick={() => insertToken(item.token)}
                    >
                      <span className="cheatsheet-token">{item.token}</span>
                      <span className="cheatsheet-desc">{item.desc}</span>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 底部状态栏 */}
      <div className="status-bar">
        <span className="status-bar-item">
          {isValid ? '✓ 有效' : '✗ 无效'}
        </span>
        {pattern && (
          <span className="status-bar-item" style={{ fontFamily: 'var(--font-mono)' }}>
            /{pattern}/{flags}
          </span>
        )}
        <span className="status-bar-spacer" />
        <button className="status-bar-btn" onClick={() => {
          setPattern('')
          setFlags('g')
          setTestText('')
          setReplaceText('')
          showToast('已重置')
        }}>
          重置
        </button>
      </div>

      {/* Toast 通知 */}
      <div className={`toast ${toast ? 'visible' : ''}`}>{toast}</div>
    </div>
  )
}

// ===== 替换预览组件 =====
function ReplacedPreview({ original, replaced }: { original: string; replaced: string }) {
  // 简单显示替换后文本，替换部分高亮
  // 用 diff 的方式：对比原始和替换后文本，找出变化的部分
  if (original === replaced) {
    return <span style={{ color: 'var(--text-muted)' }}>无变化</span>
  }
  return <>{replaced}</>
}

// ===== HTML 转义 =====
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '\n') // 保留换行
}