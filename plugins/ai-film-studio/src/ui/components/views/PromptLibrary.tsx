import { useMemo, useRef, useState } from 'react'
import { Plus, Brush, Trash2, Download, Upload } from 'lucide-react'
import Select from '../ui/Select'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import SearchField from '../ui/SearchField'
import { Field, Input, Textarea } from '../ui/Field'
import { useConfirm } from '../ui/ConfirmDialog'
import {
  usePromptStore,
  detectVars,
  resolveSnippet,
  SNIPPET_GROUPS,
  type PromptSnippet,
  type SnippetGroup,
} from '../../store/promptStore'

/** 提示词库：可复用的提示词片段（跨工程全局共享）。节点模板已移入「设置 · 高级」，项目风格回到项目上下文。 */
export default function PromptLibrary() {
  return (
    <div className="afs-surface">
      <div className="afs-surface__head">
        <h2 className="afs-surface__title">提示词库</h2>
      </div>
      <SnippetLibrary />
    </div>
  )
}

type Draft = Partial<PromptSnippet> & { name: string; group: SnippetGroup; text: string }

function SnippetLibrary() {
  const snippets = usePromptStore((s) => s.snippets)
  const saveSnippet = usePromptStore((s) => s.saveSnippet)
  const removeSnippet = usePromptStore((s) => s.removeSnippet)
  const exportPack = usePromptStore((s) => s.exportPack)
  const importPack = usePromptStore((s) => s.importPack)
  const fileRef = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState<Draft | null>(null)
  const [query, setQuery] = useState('')
  const confirm = useConfirm()
  const q = query.trim().toLowerCase()
  const match = (s: PromptSnippet) => !q || s.name.toLowerCase().includes(q) || s.text.toLowerCase().includes(q)

  const onDeleteSnippet = async (s: PromptSnippet) => {
    if (await confirm({ title: '删除片段', message: `删除片段「${s.name}」？`, danger: true, confirmLabel: '删除' })) removeSnippet(s.id)
  }

  const grouped = useMemo(() => {
    const m: Record<string, PromptSnippet[]> = {}
    for (const g of SNIPPET_GROUPS) m[g.id] = []
    for (const s of snippets) (m[s.group] ||= []).push(s)
    return m
  }, [snippets])

  const startNew = () => setEditing({ name: '', group: 'style', text: '', vars: [] })

  const onTextChange = (text: string) => {
    if (!editing) return
    // 自动探测 {变量} 并保留已填默认值
    const prevDefaults: Record<string, string> = {}
    for (const v of editing.vars || []) if (v.default) prevDefaults[v.name] = v.default
    const vars = detectVars(text).map((name) => ({ name, default: prevDefaults[name] || '' }))
    setEditing({ ...editing, text, vars })
  }

  const onSave = () => {
    if (!editing || !editing.name.trim() || !editing.text.trim()) {
      window.mulby?.notification?.show('请填写名称与片段内容', 'warning')
      return
    }
    saveSnippet({ ...editing, name: editing.name.trim() })
    setEditing(null)
  }

  const onExport = () => {
    const pack = exportPack()
    const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'ai-film-prompts.json'
    a.click()
    URL.revokeObjectURL(url)
  }
  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const obj = JSON.parse(await file.text())
      const n = importPack(obj)
      window.mulby?.notification?.show(`已导入 ${n} 个片段` + (obj.globalTemplates ? ' + 全局模板覆盖' : ''), 'success')
    } catch {
      window.mulby?.notification?.show('导入失败：文件格式不正确', 'error')
    }
  }

  return (
    <>
      <div className="afs-lib__bar">
        <div className="afs-lib__hint">
          可复用的画风 / 运镜 / 打光 / 负面 / 自定义提示词块，支持 <code>{'{变量}'}</code> 占位符。在画布节点的属性面板「插入片段」即可填入。
        </div>
        <SearchField value={query} onChange={setQuery} placeholder="搜索片段…" ariaLabel="搜索片段" size="sm" />
        <div className="afs-lib__actions">
          <Button leadingIcon={Upload} onClick={() => fileRef.current?.click()} title="导入提示词包（片段 + 全局模板）">
            导入
          </Button>
          <Button leadingIcon={Download} onClick={onExport} title="导出提示词包（片段 + 全局模板覆盖）">
            导出
          </Button>
          <Button variant="primary" leadingIcon={Plus} onClick={startNew}>
            新建片段
          </Button>
        </div>
      </div>
      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onImportFile} />

      <div className="afs-lib__scroll">
        {snippets.length === 0 ? (
          <div className="afs-lib__empty">暂无片段。新建一个画风 / 运镜 / 打光 / 负面 提示词块，跨工程复用。</div>
        ) : snippets.filter(match).length === 0 ? (
          <div className="afs-lib__empty">无匹配片段</div>
        ) : (
          SNIPPET_GROUPS.map((g) => {
            const items = grouped[g.id].filter(match)
            return items.length === 0 ? null : (
              <div key={g.id} className="afs-snipgroup">
                <div className="afs-modal__section">{g.label}</div>
                <div className="afs-lib__grid">
                  {items.map((s) => (
                    <div key={s.id} className="afs-snip">
                      <div className="afs-snip__name" title={s.name}>
                        {s.name}
                        {s.vars && s.vars.length > 0 && <span className="afs-tag">{s.vars.length} 变量</span>}
                      </div>
                      <div className="afs-snip__text">{s.text}</div>
                      <div className="afs-snip__actions">
                        <button onClick={() => setEditing({ ...s })} title="编辑">
                          <Brush size={13} /> 编辑
                        </button>
                        <button
                          className="afs-snip__del"
                          onClick={() => onDeleteSnippet(s)}
                          title="删除"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })
        )}
      </div>

      {editing && (
        <Modal
          open
          onOpenChange={(o) => {
            if (!o) setEditing(null)
          }}
          title={editing.id ? '编辑片段' : '新建片段'}
          footer={
            <>
              <Button onClick={() => setEditing(null)}>取消</Button>
              <Button variant="primary" leadingIcon={Plus} onClick={onSave}>
                保存
              </Button>
            </>
          }
        >
          <Field label="名称">
            <Input
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="如：吉卜力水彩 / 低角度推镜 / 伦勃朗光"
            />
          </Field>
          <Field label="分组">
            <Select
              block
              value={editing.group}
              onChange={(v) => setEditing({ ...editing, group: v as SnippetGroup })}
              options={SNIPPET_GROUPS.map((g) => ({ value: g.id, label: g.label }))}
              ariaLabel="分组"
            />
          </Field>
          <Field label="片段内容（可用 {变量} 占位符）">
            <Textarea
              className="afs-field__input--code"
              rows={4}
              value={editing.text}
              onChange={(e) => onTextChange(e.target.value)}
              placeholder="如：cinematic, {style} mood, soft {light} lighting, highly detailed"
            />
          </Field>
          {editing.vars && editing.vars.length > 0 && (
            <Field label="变量默认值">
              {editing.vars.map((v, i) => (
                <div key={v.name} className="afs-varrow">
                  <span className="afs-varrow__name">{`{${v.name}}`}</span>
                  <Input
                    value={v.default || ''}
                    placeholder="默认值（可留空）"
                    onChange={(e) => {
                      const vars = (editing.vars || []).slice()
                      vars[i] = { ...vars[i], default: e.target.value }
                      setEditing({ ...editing, vars })
                    }}
                  />
                </div>
              ))}
              <div className="afs-field__desc">
                预览：<span className="afs-varpreview">{resolveSnippet({ ...(editing as PromptSnippet), vars: editing.vars })}</span>
              </div>
            </Field>
          )}
        </Modal>
      )}
    </>
  )
}
