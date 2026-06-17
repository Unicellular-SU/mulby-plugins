import { X, RotateCcw } from 'lucide-react'
import { usePromptStore } from '../store/promptStore'
import { PROMPT_TEMPLATES, DEFAULT_PROMPTS, JSON_CONTRACT, type PromptTemplateDef } from '../services/promptTemplates'

interface Props {
  open: boolean
  onClose: () => void
}

const GROUP_LABEL: Record<PromptTemplateDef['group'], string> = {
  text: '文本节点 · System Prompt',
  image: '图像节点 · 提示词模板',
}

/** 提示词模板（外置 / 可编辑）：编辑保存为全局覆盖，跨工程生效（Toonflow 式可编辑「技能文件」） */
export default function PromptSettings({ open, onClose }: Props) {
  const overrides = usePromptStore((s) => s.overrides)
  const setOverride = usePromptStore((s) => s.setOverride)
  const reset = usePromptStore((s) => s.reset)
  const resetAll = usePromptStore((s) => s.resetAll)
  if (!open) return null

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
          <div className="afs-modal__hint">
            编辑各节点的提示词（创作风格 / 语言 / 篇幅 / JSON 字段 / 画质后缀），保存即全局生效、跨工程复用。
            文本 JSON 节点的「只输出合法 JSON」硬约束由引擎自动追加，改模板不会破坏解析。
            <button className="afs-link-btn" onClick={resetAll}>
              全部恢复默认
            </button>
          </div>

          {groups.map((g) => (
            <div key={g}>
              <div className="afs-modal__section">{GROUP_LABEL[g]}</div>
              {PROMPT_TEMPLATES.filter((t) => t.group === g).map((t) => {
                const overridden = typeof overrides[t.id] === 'string'
                const value = overridden ? overrides[t.id] : DEFAULT_PROMPTS[t.id]
                return (
                  <div className="afs-field" key={t.id}>
                    <label className="afs-field__label">
                      {t.label}
                      {overridden && <span className="afs-tag afs-tag--edited">已自定义</span>}
                      {overridden && (
                        <button className="afs-link-btn" onClick={() => reset(t.id)} title="恢复此模板默认值">
                          <RotateCcw size={11} /> 恢复默认
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
                      rows={t.group === 'text' && t.id.startsWith('text.') && !t.id.startsWith('text.fx') ? 12 : 3}
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
