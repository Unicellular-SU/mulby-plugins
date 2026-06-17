import { useState } from 'react'
import { X, RotateCcw } from 'lucide-react'
import { usePromptStore } from '../store/promptStore'
import { useGraphStore } from '../store/graphStore'
import { PROMPT_TEMPLATES, DEFAULT_PROMPTS, JSON_CONTRACT, type PromptTemplateDef } from '../services/promptTemplates'

interface Props {
  open: boolean
  onClose: () => void
}

const GROUP_LABEL: Record<PromptTemplateDef['group'], string> = {
  text: '文本节点 · System Prompt',
  image: '图像节点 · 提示词模板',
}

const nonEmpty = (m: Record<string, string>, id: string) => (typeof m[id] === 'string' && m[id].trim() ? m[id] : null)

/**
 * 提示词模板（外置 / 可编辑）。两个作用域：
 * - 本工程：每个工程一套，存工程 JSON；优先级最高。
 * - 全局默认：跨工程基线（明文 KV）。
 * 生效优先级：本工程 > 全局默认 > 内置默认。
 */
export default function PromptSettings({ open, onClose }: Props) {
  const [scope, setScope] = useState<'project' | 'global'>('project')
  const globalOverrides = usePromptStore((s) => s.globalOverrides)
  const setGlobal = usePromptStore((s) => s.setGlobal)
  const resetGlobal = usePromptStore((s) => s.resetGlobal)
  const resetAllGlobal = usePromptStore((s) => s.resetAllGlobal)
  const projectOverrides = useGraphStore((s) => s.promptOverrides)
  const setProjectOverride = useGraphStore((s) => s.setPromptOverride)
  const resetProjectOverride = useGraphStore((s) => s.resetPromptOverride)
  const resetAllProject = useGraphStore((s) => s.resetAllPromptOverrides)
  const projectName = useGraphStore((s) => s.projectName)
  if (!open) return null

  const isProject = scope === 'project'
  const layer = isProject ? projectOverrides : globalOverrides
  const setOverride = isProject ? setProjectOverride : setGlobal
  const resetOne = isProject ? resetProjectOverride : resetGlobal
  const resetAll = isProject ? resetAllProject : resetAllGlobal
  // 本工程作用域里，未覆盖时的基线 = 全局覆盖 ?? 内置默认；全局作用域里基线 = 内置默认
  const baseline = (id: string) => (isProject ? nonEmpty(globalOverrides, id) ?? DEFAULT_PROMPTS[id] : DEFAULT_PROMPTS[id])
  const groups: PromptTemplateDef['group'][] = ['text', 'image']

  return (
    <div className="afs-modal" onClick={onClose}>
      <div className="afs-modal__panel afs-modal__panel--wide" onClick={(e) => e.stopPropagation()}>
        <div className="afs-modal__head">
          <span className="afs-modal__title">提示词模板</span>
          <button className="afs-modal__close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

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

          {groups.map((g) => (
            <div key={g}>
              <div className="afs-modal__section">{GROUP_LABEL[g]}</div>
              {PROMPT_TEMPLATES.filter((t) => t.group === g).map((t) => {
                const overridden = typeof layer[t.id] === 'string'
                const value = overridden ? layer[t.id] : baseline(t.id)
                return (
                  <div className="afs-field" key={t.id}>
                    <label className="afs-field__label">
                      {t.label}
                      {overridden && <span className="afs-tag afs-tag--edited">{isProject ? '本工程已改' : '全局已改'}</span>}
                      {overridden && (
                        <button className="afs-link-btn" onClick={() => resetOne(t.id)} title="移除此作用域的覆盖">
                          <RotateCcw size={11} /> 恢复
                        </button>
                      )}
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
                    />
                  </div>
                )
              })}
            </div>
          ))}

          <details className="afs-modal__details">
            <summary>查看固定 JSON 输出契约（不可编辑）</summary>
            <pre className="afs-modal__pre">{JSON_CONTRACT}</pre>
          </details>
        </div>
      </div>
    </div>
  )
}
