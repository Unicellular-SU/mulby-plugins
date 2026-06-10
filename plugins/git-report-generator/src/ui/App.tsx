import { useEffect, useState, useCallback, useRef } from 'react'
import {
  FolderOpen,
  RefreshCw,
  Copy,
  FileText,
  Save,
  Settings,
  Trash2,
  Check,
  AlertCircle,
  Loader2,
  GitBranch,
  Users,
  Calendar,
  ArrowRight,
  Clock,
  BookTemplate,
  Plus,
  X,
  ChevronDown,
  Download,
  Layers,
} from 'lucide-react'
import { useMulby } from './hooks/useMulby'

// ─── 类型 ─────────────────────────────────────────
interface RepoInfo {
  name: string
  path: string
  remoteUrl: string
  branch: string
  isRepo: boolean
  error?: string
}

interface ReportTemplate {
  id: string
  name: string
  description: string
  content: string
  isBuiltin: boolean
  createdAt: number
  updatedAt: number
}

type ReportType = 'daily' | 'weekly' | 'custom'

// ─── 简单 Markdown 渲染 ───────────────────────────
function SimpleMarkdown({ text }: { text: string }) {
  if (!text) return null

  const lines = text.split('\n')
  const elements: JSX.Element[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // 代码块
    if (line.startsWith('```')) {
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++ // skip closing ```
      elements.push(
        <pre key={elements.length} className="md-code-block">
          <code>{codeLines.join('\n')}</code>
        </pre>
      )
      continue
    }

    // 标题
    const hMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (hMatch) {
      const level = hMatch[1].length
      const Tag = `h${level}` as keyof JSX.IntrinsicElements
      elements.push(
        <Tag key={elements.length} className={`md-h md-h${level}`}>
          {renderInline(hMatch[2])}
        </Tag>
      )
      i++
      continue
    }

    // 分隔线
    if (/^[-*_]{3,}\s*$/.test(line)) {
      elements.push(<hr key={elements.length} className="md-hr" />)
      i++
      continue
    }

    // 引用
    if (line.startsWith('>')) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].startsWith('>')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      elements.push(
        <blockquote key={elements.length} className="md-quote">
          {quoteLines.map((ql, qi) => (
            <p key={qi}>{renderInline(ql)}</p>
          ))}
        </blockquote>
      )
      continue
    }

    // 无序列表
    if (/^[-*+]\s/.test(line)) {
      const listItems: string[] = []
      while (i < lines.length && /^[-*+]\s/.test(lines[i])) {
        listItems.push(lines[i].replace(/^[-*+]\s/, ''))
        i++
      }
      elements.push(
        <ul key={elements.length} className="md-ul">
          {listItems.map((li, liIdx) => (
            <li key={liIdx}>{renderInline(li)}</li>
          ))}
        </ul>
      )
      continue
    }

    // 有序列表
    if (/^\d+\.\s/.test(line)) {
      const listItems: string[] = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        listItems.push(lines[i].replace(/^\d+\.\s/, ''))
        i++
      }
      elements.push(
        <ol key={elements.length} className="md-ol">
          {listItems.map((li, liIdx) => (
            <li key={liIdx}>{renderInline(li)}</li>
          ))}
        </ol>
      )
      continue
    }

    // 表格
    if (line.startsWith('|') && i + 1 < lines.length && lines[i + 1].match(/^\|[\s\-:|]+\|$/)) {
      const headerLine = line
      const alignLine = lines[i + 1]
      const headers = headerLine
        .split('|')
        .filter(Boolean)
        .map((h) => h.trim())
      const aligns = alignLine
        .split('|')
        .filter(Boolean)
        .map((a) => {
          if (a.trim().startsWith(':') && a.trim().endsWith(':')) return 'center'
          if (a.trim().endsWith(':')) return 'right'
          return 'left'
        })

      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].startsWith('|')) {
        rows.push(
          lines[i]
            .split('|')
            .filter(Boolean)
            .map((c) => c.trim())
        )
        i++
      }

      elements.push(
        <div key={elements.length} className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                {headers.map((h, hi) => (
                  <th key={hi} style={{ textAlign: aligns[hi] || 'left' }}>
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} style={{ textAlign: aligns[ci] || 'left' }}>
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      continue
    }

    // blank line
    if (line.trim() === '') {
      elements.push(<div key={elements.length} className="md-spacer" />)
      i++
      continue
    }

    // ordinary paragraph
    elements.push(
      <p key={elements.length} className="md-p">
        {renderInline(line)}
      </p>
    )
    i++
  }

  return <div className="markdown-body">{elements}</div>
}

function renderInline(text: string): (string | JSX.Element)[] {
  if (!text) return ['']
  const result: (string | JSX.Element)[] = []

  // code spans
  let remaining = text
  let keyCounter = 0

  // bold + italic
  const parts = remaining.split(/(\*\*\*.+?\*\*\*|\*\*.+?\*\*|\*.+?\*|`[^`]+`|~~.+?~~)/g)

  for (const part of parts) {
    if (!part) continue

    // bold+italic
    if (part.startsWith('***') && part.endsWith('***')) {
      result.push(
        <strong key={keyCounter++}><em>{part.slice(3, -3)}</em></strong>
      )
    }
    // bold
    else if (part.startsWith('**') && part.endsWith('**')) {
      result.push(<strong key={keyCounter++}>{part.slice(2, -2)}</strong>)
    }
    // italic
    else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      result.push(<em key={keyCounter++}>{part.slice(1, -1)}</em>)
    }
    // inline code
    else if (part.startsWith('`') && part.endsWith('`')) {
      result.push(
        <code key={keyCounter++} className="md-code-inline">
          {part.slice(1, -1)}
        </code>
      )
    }
    // strikethrough
    else if (part.startsWith('~~') && part.endsWith('~~')) {
      result.push(<del key={keyCounter++}>{part.slice(2, -2)}</del>)
    }
    // link
    else if (part.match(/\[.+\]\(.+\)/)) {
      const m = part.match(/\[(.+)\]\((.+)\)/)
      if (m) {
        result.push(
          <a key={keyCounter++} href={m[2]} target="_blank" rel="noopener" className="md-link">
            {m[1]}
          </a>
        )
      } else {
        result.push(part)
      }
    } else {
      result.push(part)
    }
  }

  return result
}

// ─── 主应用 ───────────────────────────────────────
export default function App() {
  const { host, clipboard, notification, filesystem, storage } =
    useMulby('git-report-generator')

  // 状态
  const [projectPaths, setProjectPaths] = useState<string[]>([''])
  const [repoInfos, setRepoInfos] = useState<Record<string, RepoInfo | null>>({})
  const [checkingRepo, setCheckingRepo] = useState(false)

  const [branches, setBranches] = useState<{ name: string; current: boolean }[]>([])
  const [selectedBranch, setSelectedBranch] = useState('__current__')
  const [loadingBranches, setLoadingBranches] = useState(false)

  const [reportType, setReportType] = useState<ReportType>('daily')
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')
  const [includeMerges, setIncludeMerges] = useState(true)

  const [templates, setTemplates] = useState<ReportTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('daily-default')
  const [extraPrompt, setExtraPrompt] = useState('')

  const [generating, setGenerating] = useState(false)
  const [report, setReport] = useState('')
  const [error, setError] = useState('')

  const [showTemplateEditor, setShowTemplateEditor] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<Partial<ReportTemplate>>({})
  const [templateEditorError, setTemplateEditorError] = useState('')

  const reportRef = useRef<HTMLDivElement>(null)

  // 初始化
  useEffect(() => {
    // 主题
    const params = new URLSearchParams(window.location.search)
    const initialTheme = (params.get('theme') as 'light' | 'dark') || 'light'
    document.documentElement.classList.toggle('dark', initialTheme === 'dark')

    window.mulby?.onThemeChange?.((newTheme: 'light' | 'dark') => {
      document.documentElement.classList.toggle('dark', newTheme === 'dark')
    })

    // 接收插件初始化数据
    window.mulby?.onPluginInit?.((data: any) => {
      if (data.input) {
        const trimmed = data.input.trim()
        if (trimmed) setProjectPaths([trimmed])
      }
      // 处理拖入的文件夹
      if (data.attachments && data.attachments.length > 0) {
        const dirs = data.attachments.filter((a: any) => a.kind === 'file' && a.path)
        if (dirs.length > 0) {
          setProjectPaths(dirs.map((d: any) => d.path))
        }
      }
    })

    // 加载模板列表
    loadTemplates()

    // 设置默认日期
    const today = new Date()
    setUntil(today.toISOString().split('T')[0])
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    setSince(yesterday.toISOString().split('T')[0])
  }, [])

  const loadTemplates = async () => {
    try {
      const result = await host.call('listTemplates')
      if (result.success && result.data) {
        setTemplates(result.data as ReportTemplate[])
      }
    } catch {
      // use defaults
    }
  }

  // 检查仓库（支持多路径）
  const checkRepo = useCallback(async () => {
    const validPaths = projectPaths.filter((p) => p.trim())
    if (validPaths.length === 0) {
      setError('请输入至少一个 Git 项目路径')
      return
    }
    setCheckingRepo(true)
    setError('')
    setRepoInfos({})

    const newInfos: Record<string, RepoInfo | null> = {}
    let hasValidRepo = false

    for (const p of validPaths) {
      try {
        const result = await host.call('getRepoInfo', p.trim())
        if (result.success) {
          const info = result.data as RepoInfo
          newInfos[p.trim()] = info
          if (info.isRepo) hasValidRepo = true
          else if (validPaths.length === 1) {
            setError(info.error || '无效的 Git 仓库')
          }
        }
      } catch {
        newInfos[p.trim()] = null
      }
    }

    setRepoInfos(newInfos)

    // 获取第一个有效仓库的分支列表
    if (hasValidRepo) {
      const firstValidPath = validPaths.find((p) => newInfos[p.trim()]?.isRepo)
      if (firstValidPath) {
        setLoadingBranches(true)
        try {
          const brResult = await host.call('getBranches', firstValidPath.trim())
          if (brResult.success && brResult.data) {
            setBranches(brResult.data as { name: string; current: boolean }[])
          }
        } catch {
          setBranches([])
        }
        setLoadingBranches(false)

        // 自动调整默认模板
        const firstInfo = newInfos[firstValidPath.trim()]
        if (firstInfo?.isRepo) {
          if (reportType === 'weekly' && selectedTemplateId === 'daily-default') {
            setSelectedTemplateId('weekly-default')
          }
        }
      }
    }

    setCheckingRepo(false)
  }, [projectPaths, reportType, selectedTemplateId])

  // 当 reportType 变化时调整日期范围和模板
  useEffect(() => {
    const now = new Date()
    const today = now.toISOString().split('T')[0]

    if (reportType === 'daily') {
      const y = new Date(now)
      y.setDate(y.getDate() - 1)
      setSince(y.toISOString().split('T')[0])
      setUntil(today)
      if (
        selectedTemplateId !== 'daily-default' &&
        selectedTemplateId !== 'github-style' &&
        !templates.find((t) => t.id === selectedTemplateId)?.isBuiltin
      ) {
        // keep custom
      } else if (selectedTemplateId === 'weekly-default') {
        setSelectedTemplateId('daily-default')
      }
    } else if (reportType === 'weekly') {
      const w = new Date(now)
      w.setDate(w.getDate() - 7)
      setSince(w.toISOString().split('T')[0])
      setUntil(today)
      if (selectedTemplateId === 'daily-default') {
        setSelectedTemplateId('weekly-default')
      }
    }
  }, [reportType])

  // 路径变化时自动检测
  useEffect(() => {
    const validPaths = projectPaths.filter((p) => p.trim() && p.includes('/'))
    if (validPaths.length > 0) {
      const timer = setTimeout(() => checkRepo(), 600)
      return () => clearTimeout(timer)
    }
  }, [projectPaths])

  // 生成报告
  const handleGenerate = async () => {
    setError('')
    setReport('')

    const validPaths = projectPaths.filter((p) => p.trim())
    if (validPaths.length === 0) {
      setError('请输入至少一个 Git 项目路径')
      return
    }

    const selectedTemplate = templates.find((t) => t.id === selectedTemplateId)
    if (!selectedTemplate) {
      setError('请选择报告模板')
      return
    }

    // 检查至少有一个有效仓库
    const hasValidRepo = validPaths.some((p) => repoInfos[p.trim()]?.isRepo)
    if (!hasValidRepo) {
      setError('请先检查仓库（点击右侧箭头按钮）')
      return
    }

    setGenerating(true)
    try {
      const result = await host.call('generateReport', {
        projectPaths: validPaths.map((p) => p.trim()),
        reportType,
        since,
        until,
        template: selectedTemplate.content,
        extraPrompt,
        includeMerges,
        branch: selectedBranch,
      })

      if (result.success && (result.data as any)?.success) {
        const data = result.data as { success: boolean; report?: string; error?: string }
        if (data.success && data.report) {
          setReport(data.report)
          // 滚动到报告区域
          setTimeout(() => {
            reportRef.current?.scrollIntoView({ behavior: 'smooth' })
          }, 100)
        } else {
          setError(data.error || '生成报告失败')
        }
      } else {
        setError((result.data as any)?.error || '生成报告时发生错误')
      }
    } catch (e: any) {
      setError(e?.message || '生成报告失败，请检查后端连接')
    } finally {
      setGenerating(false)
    }
  }

  // 复制报告
  const handleCopyReport = async () => {
    if (!report) return
    try {
      await clipboard.writeText(report)
      notification.show('报告已复制到剪贴板', 'success')
    } catch {
      notification.show('复制失败', 'error')
    }
  }

  // 保存报告到文件
  const handleSaveReport = async () => {
    if (!report) return
    try {
      const firstValid = projectPaths.find((p) => repoInfos[p.trim()]?.isRepo)
      const repoName = repoInfos[firstValid?.trim() || '']?.name || 'git-report'
      const typeLabel = reportType === 'daily' ? 'daily' : reportType === 'weekly' ? 'weekly' : 'custom'
      const dateLabel = since || 'report'
      const filename = `${repoName}-${typeLabel}-${dateLabel}.md`
      const defaultPath = `${firstValid || ''}/${filename}`

      // 使用 dialog 选择保存位置
      const savePath = await window.mulby.dialog.showSaveDialog({
        title: '保存报告',
        defaultPath,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      })

      if (savePath) {
        await filesystem.writeFile(savePath, report)
        notification.show('报告已保存', 'success')
      }
    } catch (e: any) {
      notification.show(`保存失败: ${e?.message || '未知错误'}`, 'error')
    }
  }

  // 选择文件夹（添加到列表）
  const handleBrowseFolder = async (index?: number) => {
    try {
      const result = await window.mulby.dialog.showOpenDialog({
        title: '选择 Git 项目目录',
        properties: ['openDirectory'],
      })
      if (result && result.length > 0) {
        if (index !== undefined && index < projectPaths.length) {
          setProjectPaths((prev) => {
            const next = [...prev]
            next[index] = result[0]
            return next
          })
        } else {
          setProjectPaths((prev) => {
            const filtered = prev.filter((p) => p.trim())
            return [...filtered, result[0]]
          })
        }
      }
    } catch {
      // user cancelled
    }
  }

  const addProjectPath = () => {
    setProjectPaths((prev) => [...prev, ''])
  }

  const removeProjectPath = (index: number) => {
    setProjectPaths((prev) => {
      if (prev.length <= 1) return prev
      return prev.filter((_, i) => i !== index)
    })
    // 清理对应的 repo info
    const path = projectPaths[index]
    if (path) {
      setRepoInfos((prev) => {
        const next = { ...prev }
        delete next[path.trim()]
        return next
      })
    }
  }

  const updateProjectPath = (index: number, value: string) => {
    setProjectPaths((prev) => {
      const next = [...prev]
      next[index] = value
      return next
    })
  }

  // 计算是否至少有一个有效仓库
  const hasValidRepo = projectPaths.some((p) => repoInfos[p.trim()]?.isRepo)
  const primaryRepoInfo = projectPaths.find((p) => repoInfos[p.trim()]?.isRepo)
    ? repoInfos[projectPaths.find((p) => repoInfos[p.trim()]?.isRepo)!.trim()]
    : null

  // 模板编辑器
  const openTemplateEditor = (template?: ReportTemplate) => {
    setTemplateEditorError('')
    if (template) {
      setEditingTemplate({ ...template })
    } else {
      setEditingTemplate({ name: '', description: '', content: '' })
    }
    setShowTemplateEditor(true)
  }

  const handleSaveTemplate = async () => {
    if (!editingTemplate.name?.trim()) {
      setTemplateEditorError('请输入模板名称')
      return
    }
    if (!editingTemplate.content?.trim()) {
      setTemplateEditorError('请输入模板内容')
      return
    }

    try {
      const result = await host.call('saveTemplate', {
        id: editingTemplate.id,
        name: editingTemplate.name.trim(),
        description: editingTemplate.description?.trim() || '',
        content: editingTemplate.content.trim(),
      })

      if (result.success && (result.data as any)?.success) {
        setShowTemplateEditor(false)
        setEditingTemplate({})
        await loadTemplates()
        const saved = (result.data as any)?.template
        if (saved) setSelectedTemplateId(saved.id)
        notification.show('模板已保存', 'success')
      } else {
        setTemplateEditorError((result.data as any)?.error || '保存失败')
      }
    } catch (e: any) {
      setTemplateEditorError(e?.message || '保存失败')
    }
  }

  const handleDeleteTemplate = async (templateId: string) => {
    try {
      const result = await host.call('deleteTemplate', templateId)
      if (result.success && (result.data as any)?.success) {
        await loadTemplates()
        if (selectedTemplateId === templateId) {
          setSelectedTemplateId('daily-default')
        }
        notification.show('模板已删除', 'success')
      }
    } catch {
      notification.show('删除失败', 'error')
    }
  }

  const currentTemplate = templates.find((t) => t.id === selectedTemplateId)

  // ─── 渲染 ───────────────────────────────────────
  return (
    <div className="plugin-root">
      {/* 头部 */}
      <header className="header">
        <GitBranch size={18} className="header-icon" />
        <h1 className="header-title">Git 报告生成器</h1>
        {primaryRepoInfo?.isRepo && (
          <span className="badge">
            {projectPaths.length > 1
              ? `${projectPaths.length} 个项目`
              : `${primaryRepoInfo.name} · ${selectedBranch === '__all__' ? '所有分支' : selectedBranch === '__current__' ? primaryRepoInfo.branch : selectedBranch}`}
          </span>
        )}
      </header>

      {/* 主内容 */}
      <main className="main">
        <div className="content-flow">
          {/* 项目路径（多项目支持） */}
          <section className="section">
            <div className="section-head">
              <label className="input-label">
                <FolderOpen size={14} />
                项目路径 {projectPaths.length > 1 && `(${projectPaths.length})`}
              </label>
              <button className="btn-ghost" onClick={addProjectPath} title="添加更多项目">
                <Plus size={13} />
                添加项目
              </button>
            </div>

            {projectPaths.map((pp, idx) => (
              <div key={idx} className="input-row" style={{ marginBottom: idx < projectPaths.length - 1 ? 6 : 0 }}>
                <input
                  type="text"
                  className="text-input"
                  placeholder={`项目 ${idx + 1}: 输入或拖入 Git 项目路径...`}
                  value={pp}
                  onChange={(e) => updateProjectPath(idx, e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && checkRepo()}
                />
                <button
                  className="btn-icon"
                  onClick={() => handleBrowseFolder(idx)}
                  title="浏览文件夹"
                >
                  <FolderOpen size={15} />
                </button>
                {projectPaths.length > 1 && (
                  <button
                    className="btn-icon btn-danger-ghost"
                    onClick={() => removeProjectPath(idx)}
                    title="移除此项目"
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
            ))}

            <div className="input-row">
              <button
                className="btn-icon btn-accent"
                onClick={checkRepo}
                disabled={checkingRepo || projectPaths.every((p) => !p.trim())}
                title="检查仓库"
                style={{ marginLeft: 'auto' }}
              >
                {checkingRepo ? <Loader2 size={15} className="spin" /> : <ArrowRight size={15} />}
                检查仓库
              </button>
            </div>

            {/* 仓库信息汇总 */}
            {Object.entries(repoInfos).length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {Object.entries(repoInfos).map(([path, info]) =>
                  info?.isRepo ? (
                    <div key={path} className="repo-info-bar">
                      <span>
                        <GitBranch size={12} /> {info.name} · {info.branch}
                      </span>
                      {info.remoteUrl && (
                        <span className="repo-remote" title={info.remoteUrl}>
                          {info.remoteUrl.replace(/^https?:\/\//, '').replace(/\.git$/, '')}
                        </span>
                      )}
                      <span className="repo-status-ok">
                        <Check size={12} /> 就绪
                      </span>
                    </div>
                  ) : info ? (
                    <div key={path} className="repo-info-bar" style={{ background: 'rgba(239,68,68,0.05)', border: '1.5px solid rgba(239,68,68,0.2)', borderRadius: '10px' }}>
                      <AlertCircle size={12} color="var(--danger)" />
                      <span style={{ color: 'var(--danger)' }}>{info.name}: {info.error || '无效仓库'}</span>
                    </div>
                  ) : null
                )}
              </div>
            )}
          </section>

          {/* 分支选择 */}
          {hasValidRepo && (
            <section className="section">
              <label className="input-label">
                <GitBranch size={14} />
                分支选择
              </label>
              <div className="template-select-row">
                <div className="select-wrapper">
                  <select
                    className="select-input"
                    value={selectedBranch}
                    onChange={(e) => setSelectedBranch(e.target.value)}
                    disabled={loadingBranches}
                  >
                    <option value="__current__">📌 当前分支</option>
                    <option value="__all__">🌐 所有分支</option>
                    {branches.map((b) => (
                      <option key={b.name} value={b.name}>
                        {b.current ? '★ ' : '  '}{b.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="select-chevron" />
                </div>
                {loadingBranches && <Loader2 size={14} className="spin" />}
              </div>
            </section>
          )}

          {/* 报告设置 */}
          <section className="section">
            <div className="settings-grid">
              {/* 报告类型 */}
              <div className="setting-item">
                <label className="input-label">
                  <Calendar size={14} />
                  报告类型
                </label>
                <div className="btn-group">
                  {([
                    ['daily', '日报'],
                    ['weekly', '周报'],
                    ['custom', '自定义'],
                  ] as const).map(([val, label]) => (
                    <button
                      key={val}
                      className={`btn-group-item ${reportType === val ? 'active' : ''}`}
                      onClick={() => setReportType(val)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 日期范围 */}
              <div className="setting-item">
                <label className="input-label">
                  <Clock size={14} />
                  时间范围
                </label>
                <div className="date-row">
                  <input
                    type="date"
                    className="date-input"
                    value={since}
                    onChange={(e) => setSince(e.target.value)}
                  />
                  <span className="date-sep">~</span>
                  <input
                    type="date"
                    className="date-input"
                    value={until}
                    onChange={(e) => setUntil(e.target.value)}
                  />
                </div>
              </div>

              {/* 包含合并提交 */}
              <div className="setting-item">
                <label className="input-label">
                  <Layers size={14} />
                  选项
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={includeMerges}
                    onChange={(e) => setIncludeMerges(e.target.checked)}
                  />
                  包含合并提交
                </label>
              </div>
            </div>
          </section>

          {/* 模板选择 */}
          <section className="section">
            <div className="section-head">
              <label className="input-label">
                <BookTemplate size={14} />
                报告模板
              </label>
              <button className="btn-ghost" onClick={() => openTemplateEditor()}>
                <Plus size={13} />
                新建模板
              </button>
            </div>

            <div className="template-select-row">
              <div className="select-wrapper">
                <select
                  className="select-input"
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                >
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.isBuiltin ? '📋 ' : '✏️ '}
                      {t.name}
                      {t.isBuiltin ? ' (内置)' : ''}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} className="select-chevron" />
              </div>

              {currentTemplate && !currentTemplate.isBuiltin && (
                <div className="template-actions">
                  <button
                    className="btn-ghost"
                    onClick={() => openTemplateEditor(currentTemplate)}
                    title="编辑模板"
                  >
                    <Settings size={13} />
                  </button>
                  <button
                    className="btn-ghost btn-danger"
                    onClick={() => handleDeleteTemplate(currentTemplate.id)}
                    title="删除模板"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </div>
            {currentTemplate && (
              <p className="template-desc">{currentTemplate.description}</p>
            )}
          </section>

          {/* 额外提示 */}
          <section className="section">
            <label className="input-label">
              <FileText size={14} />
              额外提示（可选）
            </label>
            <textarea
              className="textarea-input"
              placeholder="为 AI 添加额外的生成提示，例如：'重点突出性能优化部分'、'用英文撰写'..."
              rows={2}
              value={extraPrompt}
              onChange={(e) => setExtraPrompt(e.target.value)}
            />
          </section>

          {/* 生成按钮 */}
          <button
            className="btn-generate"
            onClick={handleGenerate}
            disabled={generating || !hasValidRepo}
          >
            {generating ? (
              <>
                <Loader2 size={16} className="spin" />
                AI 正在分析提交记录...
              </>
            ) : (
              <>
                <RefreshCw size={16} />
                生成报告
              </>
            )}
          </button>

          {/* 错误提示 */}
          {error && (
            <div className="error-banner">
              <AlertCircle size={14} />
              <span>{error}</span>
              <button className="btn-ghost" onClick={() => setError('')}>
                <X size={13} />
              </button>
            </div>
          )}

          {/* 报告结果 */}
          {report && (
            <section className="section report-section" ref={reportRef}>
              <div className="section-head">
                <h2>📄 生成的报告</h2>
                <div className="report-actions">
                  <button className="btn-ghost" onClick={handleCopyReport}>
                    <Copy size={13} />
                    复制
                  </button>
                  <button className="btn-ghost" onClick={handleSaveReport}>
                    <Download size={13} />
                    保存
                  </button>
                  <button
                    className="btn-ghost"
                    onClick={handleGenerate}
                    disabled={generating}
                  >
                    <RefreshCw size={13} />
                    重新生成
                  </button>
                </div>
              </div>
              <div className="report-preview">
                <SimpleMarkdown text={report} />
              </div>
            </section>
          )}
        </div>
      </main>

      {/* 底部 */}
      <footer className="footer">
        <span className="footer-hint">
          {hasValidRepo
            ? `准备就绪，${projectPaths.length > 1 ? `${projectPaths.length} 个项目` : ''}点击"生成报告"开始`
            : '请输入 Git 项目路径后点击"检查仓库"'}
        </span>
      </footer>

      {/* 模板编辑器弹窗 */}
      {showTemplateEditor && (
        <div className="modal-overlay" onClick={() => setShowTemplateEditor(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingTemplate.id ? '编辑模板' : '新建模板'}</h3>
              <button className="btn-ghost" onClick={() => setShowTemplateEditor(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>模板名称</label>
                <input
                  type="text"
                  className="text-input"
                  placeholder="例如：我的日报模板"
                  value={editingTemplate.name || ''}
                  onChange={(e) =>
                    setEditingTemplate((p) => ({ ...p, name: e.target.value }))
                  }
                />
              </div>
              <div className="form-group">
                <label>描述</label>
                <input
                  type="text"
                  className="text-input"
                  placeholder="模板简短描述"
                  value={editingTemplate.description || ''}
                  onChange={(e) =>
                    setEditingTemplate((p) => ({ ...p, description: e.target.value }))
                  }
                />
              </div>
              <div className="form-group">
                <label>
                  模板内容
                  <span className="label-hint">可用变量：{`{{repo_name}} {{repo_list}} {{branch}} {{date_range}} {{commit_count}} {{contributors}} {{commits}} {{summary}} {{ai_insights}} {{image}} {{generated_at}}`}</span>
                </label>
                <textarea
                  className="textarea-input mono"
                  rows={12}
                  placeholder="编写 Markdown 模板..."
                  value={editingTemplate.content || ''}
                  onChange={(e) =>
                    setEditingTemplate((p) => ({ ...p, content: e.target.value }))
                  }
                />
              </div>
              {templateEditorError && (
                <div className="error-banner small">
                  <AlertCircle size={12} />
                  <span>{templateEditorError}</span>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowTemplateEditor(false)}>
                取消
              </button>
              <button className="btn-primary" onClick={handleSaveTemplate}>
                <Save size={14} />
                保存模板
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
