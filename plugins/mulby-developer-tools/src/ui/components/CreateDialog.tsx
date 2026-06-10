import { useEffect, useState } from 'react'
import { FolderSearch, Layout, Terminal, Loader2, Plus } from 'lucide-react'
import { Modal } from './Modal'

export interface CreatePayload {
  targetDir: string
  name: string
  template: 'react' | 'basic'
}

interface Props {
  open: boolean
  busy: boolean
  defaultName?: string
  onClose: () => void
  onPickDir: () => Promise<string | null>
  onSubmit: (payload: CreatePayload) => void
}

export function CreateDialog({ open, busy, defaultName, onClose, onPickDir, onSubmit }: Props) {
  const [name, setName] = useState(defaultName || '')
  const [targetDir, setTargetDir] = useState('')
  const [template, setTemplate] = useState<'react' | 'basic'>('react')

  // 每次打开重置插件名（目标目录保留——通常多个插件放同一目录），避免上次创建的名字残留误导
  useEffect(() => {
    if (open) setName(defaultName || '')
  }, [open, defaultName])

  const valid = /^[a-z0-9][a-z0-9-]*$/.test(name) && targetDir.trim().length > 0

  return (
    <Modal open={open} title="创建新插件" onClose={onClose} width="max-w-lg">
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">插件名称（kebab-case）</label>
          <input
            className="input-base mono"
            placeholder="my-awesome-plugin"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {name && !/^[a-z0-9][a-z0-9-]*$/.test(name) && (
            <p className="text-[11px] text-rose-500 mt-1">仅允许小写字母、数字与连字符，且需以字母/数字开头。</p>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">目标目录</label>
          <div className="flex gap-2">
            <input
              className="input-base mono flex-1"
              placeholder="/Users/you/plugins"
              value={targetDir}
              onChange={(e) => setTargetDir(e.target.value)}
            />
            <button
              className="btn-secondary shrink-0"
              disabled={busy}
              onClick={async () => {
                const dir = await onPickDir()
                if (dir) setTargetDir(dir)
              }}
            >
              <FolderSearch size={15} /> 选择
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">模板</label>
          <div className="grid grid-cols-2 gap-2.5">
            <TemplateCard
              active={template === 'react'} onClick={() => setTemplate('react')}
              icon={<Layout size={18} />} title="React" desc="可视化 UI / detached 窗口 / 复杂交互"
            />
            <TemplateCard
              active={template === 'basic'} onClick={() => setTemplate('basic')}
              icon={<Terminal size={18} />} title="Basic" desc="命令型 / silent / 后台优先，无前端"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>取消</button>
          <button
            className="btn-primary"
            disabled={!valid || busy}
            onClick={() => onSubmit({ targetDir: targetDir.trim(), name: name.trim(), template })}
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            创建并加入列表
          </button>
        </div>
      </div>
    </Modal>
  )
}

function TemplateCard({
  active, onClick, icon, title, desc
}: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <button
      onClick={onClick}
      className={`text-left p-3 rounded-xl border transition-all ${
        active
          ? 'border-emerald-500/50 bg-emerald-500/10 shadow-[0_0_12px_rgba(16,185,129,0.1)]'
          : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
      }`}
    >
      <div className={`flex items-center gap-2 ${active ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-300'}`}>
        {icon}<span className="font-medium text-sm">{title}</span>
      </div>
      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 leading-snug">{desc}</p>
    </button>
  )
}
