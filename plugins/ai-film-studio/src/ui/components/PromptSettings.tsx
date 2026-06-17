import { useState } from 'react'
import { RotateCcw, History, Search } from 'lucide-react'
import { usePromptStore } from '../store/promptStore'
import { useGraphStore } from '../store/graphStore'
import { PROMPT_TEMPLATES, DEFAULT_PROMPTS, JSON_CONTRACT, type PromptTemplateDef } from '../services/promptTemplates'

const GROUP_LABEL: Record<PromptTemplateDef['group'], string> = {
  text: '文本节点 · System Prompt',
  image: '图像节点 · 提示词模板',
}

const nonEmpty = (m: Record<string, string>, id: string) => (typeof m[id] === 'string' && m[id].trim() ? m[id] : null)

function relTime(ts: number): string {
  const d = Date.now() - ts
  const m = Math.floor(d / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  return new Date(ts).toLocaleString()
}

/**
 * 节点模板编辑（提示词库的一部分）。两个作用域：本工程 / 全局默认。
 * 生效优先级：本工程 > 全局默认 > 内置默认。带搜索、按节点分组、恢复默认、已改标记、版本历史。
 */
export default function PromptSettings() {
  const [scope, setScope] = useState<'project' | 'global'>('project')
  const [query, setQuery] = useState('')
  const [openHistory, setOpenHistory] = useState<string | null>(null)
  const globalOverrides = usePromptStore((s) => s.globalOverrides)
  const setGlobal = usePromptStore((s) => s.setGlobal)
  const resetGlobal = usePromptStore((s) => s.resetGlobal)
  const resetAllGlobal = usePromptStore((s) => s.resetAllGlobal)
  const history = usePromptStore((s) => s.history)
  const snapshot = usePromptStore((s) => s.snapshot)
  const projectOverrides = useGraphStore((s) => s.promptOverrides)
  const setProjectOverride = useGraphStore((s) => s.setPromptOverride)
  const resetProjectOverride = useGraphStore((s) => s.resetPromptOverride)
  const resetAllProject = useGraphStore((s) => s.resetAllPromptOverrides)
  const projectName = useGraphStore((s) => s.projectName)

  const isProject = scope === 'project'
  const layer = isProject ? projectOverrides : globalOverrides
  const setOverride = isProject ? setProjectOverride : setGlobal
  const resetOne = isProject ? resetProjectOverride : resetGlobal
  const resetAll = isProject ? resetAllProject : resetAllGlobal
  // 本工程作用域里，未覆盖时的基线 = 全局覆盖 ?? 内置默认；全局作用域里基线 = 内置默认
  const baseline = (id: string) => (isProject ? nonEmpty(globalOverrides, id) ?? DEFAULT_PROMPTS[id] : DEFAULT_PROMPTS[id])
  const groups: PromptTemplateDef['group'][] = ['text', 'image']

  const kw = query.trim().toLowerCase()
  const match = (t: PromptTemplateDef) => !kw || `${t.label} ${t.desc} ${t.id}`.toLowerCase().includes(kw)

  return (
    <div className="afs-settings-pane">
      <div className="afs-modal__body">
        <div className="afs-scope">
          <button className={`afs-scope__tab${isProject ? ' is-active' : ''}`} onClick={() => setScope('project')}>
            本工程{projectName ? `（${projectName}）` : ''}
          </button>
          <button className={`afs-scope__tab${!isProject ? ' is-active' : ''}`} onClick={() => setScope('global')}>
            全局默认
          </button>
        </div>

        <div className="afs-modal__hint">
          {isProject
            ? '本工程专属覆盖，存于该工程内、跟随导入导出；优先级最高。未覆盖的模板回退到「全局默认 / 内置默认」。'
            : '跨工程的默认基线（所有工程共享）。具体工程可在「本工程」里再单独覆盖。'}
          　生效优先级：<b>本工程 &gt; 全局默认 &gt; 内置默认</b>。文本 JSON 节点的硬输出契约由引擎自动追加，改模板不破坏解析。
          <button className="afs-link-btn" onClick={resetAll}>
            {isProject ? '清空本工程覆盖' : '全部恢复默认'}
          </button>
        </div>

        <div className="afs-prompts__search">
          <Search size={14} />
          <input placeholder="搜索模板（名称 / 说明 / id）…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>

        {groups.map((g) => {
          const items = PROMPT_TEMPLATES.filter((t) => t.group === g && match(t))
          if (items.length === 0) return null
          return (
            <div key={g}>
              <div className="afs-modal__section">{GROUP_LABEL[g]}</div>
              {items.map((t) => {
                const overridden = typeof layer[t.id] === 'string'
                const value = overridden ? layer[t.id] : baseline(t.id)
                const hist = history[t.id] || []
                const showHist = openHistory === t.id
                return (
                  <div className="afs-field" key={t.id}>
                    <label className="afs-field__label">
                      {t.label}
                      {overridden && <span className="afs-tag afs-tag--edited">{isProject ? '本工程已改' : '全局已改'}</span>}
                      {overridden && (
                        <button className="afs-link-btn" onClick={() => resetOne(t.id)} title="移除此作用域的覆盖">
                          <RotateCcw size={11} /> 恢复默认
                        </button>
                      )}
                      <button
                        className="afs-link-btn"
                        onClick={() => setOpenHistory(showHist ? null : t.id)}
                        title="版本历史（编辑失焦时自动记录快照）"
                      >
                        <History size={11} /> 历史{hist.length ? `(${hist.length})` : ''}
                      </button>
                    </label>
                    <div className="afs-field__desc">
                      {t.desc}
                      {t.placeholders?.length ? `　占位符：${t.placeholders.join(' ')}` : ''}
                      {t.jsonContract ? '　（引擎自动追加 JSON 输出契约）' : ''}
                    </div>
                    <textarea
                      className="afs-field__input afs-field__input--code"
                      rows={g === 'text' && !t.id.startsWith('text.fx') ? 12 : 3}
                      value={value}
                      onChange={(e) => setOverride(t.id, e.target.value)}
                      onBlur={(e) => snapshot(t.id, e.target.value)}
                    />
                    {showHist && (
                      <div className="afs-history">
                        {hist.length === 0 ? (
                          <div className="afs-history__empty">暂无历史快照（编辑后失焦会自动记录）</div>
                        ) : (
                          hist.map((h, i) => (
                            <div className="afs-history__item" key={i}>
                              <span className="afs-history__time">{relTime(h.ts)}</span>
                              <span className="afs-history__text" title={h.text}>
                                {h.text.replace(/\s+/g, ' ').slice(0, 60)}
                              </span>
                              <button
                                className="afs-link-btn"
                                onClick={() => {
                                  snapshot(t.id, value) // 回滚前先把当前文本入栈，便于再切回
                                  setOverride(t.id, h.text)
                                }}
                              >
                                恢复此版本
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}

        <details className="afs-modal__details">
          <summary>查看固定 JSON 输出契约（不可编辑）</summary>
          <pre className="afs-modal__pre">{JSON_CONTRACT}</pre>
        </details>
      </div>
    </div>
  )
}
