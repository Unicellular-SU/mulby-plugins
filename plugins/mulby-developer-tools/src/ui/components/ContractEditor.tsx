import { Plus, Trash2, ChevronDown, Wrench, Boxes, SlidersHorizontal, AppWindow, Globe, Check } from 'lucide-react'
import { useState } from 'react'
import {
  type VibeContract, type VibeFeature, type FeatureMode, type VibeTrigger, type TriggerType,
  type PluginCategory, type PlatformKey, type VibeWindow, type VibeBehavior, type ExecProfile,
  PERMISSION_OPTIONS, TRIGGER_TYPES, CATEGORY_OPTIONS, PLATFORM_OPTIONS, EXEC_PROFILES, toKebab, validateContract
} from '../lib/vibeContract'

interface Props {
  contract: VibeContract
  onChange: (c: VibeContract) => void
  editable: boolean
}

const MODES: Array<{ value: FeatureMode; label: string }> = [
  { value: 'detached', label: '独立窗口' },
  { value: 'ui', label: '附着 UI' },
  { value: 'silent', label: '静默/无界面' }
]

export function ContractEditor({ contract, onChange, editable }: Props) {
  const [showTools, setShowTools] = useState(contract.tools.length > 0)
  const [showSensitive, setShowSensitive] = useState(
    () => PERMISSION_OPTIONS.some((o) => o.sensitive && contract.permissions[o.key])
  )
  const [showAdv, setShowAdv] = useState(false)

  const patch = (p: Partial<VibeContract>) => onChange({ ...contract, ...p })
  const patchWindow = (p: Partial<VibeWindow>) => patch({ window: { ...(contract.window || {}), ...p } })
  const patchBehavior = (p: Partial<VibeBehavior>) => patch({ behavior: { ...(contract.behavior || {}), ...p } })
  const patchCmdExec = (scope: 'direct' | 'ai', p: Partial<NonNullable<VibeContract['commandExecution']>['direct']>) => {
    const ce = contract.commandExecution || {}
    patch({ commandExecution: { ...ce, [scope]: { ...(ce[scope] || {}), ...p } } })
  }
  const errors = validateContract(contract)
  const togglePlatform = (k: PlatformKey) => {
    const cur = contract.platform || []
    patch({ platform: cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k] })
  }
  const numField = (v: number | undefined) => (typeof v === 'number' ? String(v) : '')
  const parseNum = (s: string): number | undefined => {
    const n = parseInt(s, 10)
    return isFinite(n) && n > 0 ? n : undefined
  }
  const showWindow = contract.template === 'react' || contract.features.some((f) => f.mode === 'detached')

  const setFeature = (idx: number, f: Partial<VibeFeature>) => {
    const features = contract.features.map((cur, i) => (i === idx ? { ...cur, ...f } : cur))
    patch({ features })
  }
  const addFeature = () => patch({
    features: [...contract.features, { code: `feature_${contract.features.length + 1}`, explain: '', mode: contract.template === 'react' ? 'detached' : 'silent', triggers: [{ type: 'keyword', value: '' }] }]
  })
  const removeFeature = (idx: number) => patch({ features: contract.features.filter((_, i) => i !== idx) })

  const setTrigger = (fi: number, ti: number, t: VibeTrigger) =>
    setFeature(fi, { triggers: contract.features[fi].triggers.map((cur, i) => (i === ti ? t : cur)) })
  const addTrigger = (fi: number) =>
    setFeature(fi, { triggers: [...contract.features[fi].triggers, { type: 'keyword', value: '' }] })
  const removeTrigger = (fi: number, ti: number) =>
    setFeature(fi, { triggers: contract.features[fi].triggers.filter((_, i) => i !== ti) })

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-200 dark:divide-slate-800">
      {errors.length > 0 && (
        <div className="p-3 bg-rose-50 dark:bg-rose-900/20">
          <div className="text-[11px] font-medium text-rose-600 dark:text-rose-400 mb-1">契约还有 {errors.length} 处需修正后才能生成：</div>
          <ul className="text-[11px] text-rose-500 dark:text-rose-400 list-disc pl-4 space-y-0.5">
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}
      {/* 基础信息 */}
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <L label={contract.isEdit ? '插件名（不可改）' : '插件名 (id)'}>
            <input className="input-base mono" value={contract.name} disabled={!editable || contract.isEdit}
              onChange={(e) => patch({ name: toKebab(e.target.value) })} />
          </L>
          <L label="展示名">
            <input className="input-base" value={contract.displayName} disabled={!editable}
              onChange={(e) => patch({ displayName: e.target.value })} />
          </L>
        </div>
        <L label="一句话描述">
          <input className="input-base" value={contract.description} disabled={!editable}
            onChange={(e) => patch({ description: e.target.value })} />
        </L>
        <div className="grid grid-cols-3 gap-3">
          <L label="分类">
            <select className="input-base" value={contract.type || 'utility'} disabled={!editable}
              onChange={(e) => patch({ type: e.target.value as PluginCategory })}>
              {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </L>
          <L label="版本号">
            <input className="input-base mono" value={contract.version} disabled={!editable} placeholder="1.0.0"
              onChange={(e) => patch({ version: e.target.value })} />
          </L>
          <L label="作者（可选）">
            <input className="input-base" value={contract.author || ''} disabled={!editable} placeholder="留空即可"
              onChange={(e) => patch({ author: e.target.value })} />
          </L>
        </div>
        {!contract.isEdit && (
          <L label="模板">
            <div className="flex gap-2">
              {(['react', 'basic'] as const).map((t) => (
                <button key={t} disabled={!editable}
                  onClick={() => patch({ template: t })}
                  className={`flex-1 px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                    contract.template === t
                      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300'
                  }`}>
                  {t === 'react' ? 'React（有界面）' : 'Basic（纯命令/无界面）'}
                </button>
              ))}
            </div>
          </L>
        )}
      </div>

      {/* 功能 features */}
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">功能与触发（features）</span>
          {editable && (
            <button className="btn-ghost !px-2 !py-1 text-xs" onClick={addFeature}><Plus size={13} /> 加功能</button>
          )}
        </div>
        <div className="space-y-2.5">
          {contract.features.map((f, idx) => (
            <div key={idx} className="rounded-lg border border-slate-200 dark:border-slate-700 p-2.5 space-y-2">
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
                <L label="功能码 code" mini>
                  <input className="input-base mono !py-1 text-xs" value={f.code} disabled={!editable}
                    onChange={(e) => setFeature(idx, { code: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '_') })} />
                </L>
                <L label="运行模式" mini>
                  <select className="input-base !py-1 text-xs" value={f.mode} disabled={!editable}
                    onChange={(e) => setFeature(idx, { mode: e.target.value as FeatureMode })}>
                    {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </L>
                {editable && contract.features.length > 1 && (
                  <button className="btn-ghost !px-2 !py-1.5 text-rose-500" onClick={() => removeFeature(idx)} title="删除功能">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              <L label="说明 explain" mini>
                <input className="input-base !py-1 text-xs" value={f.explain} disabled={!editable}
                  onChange={(e) => setFeature(idx, { explain: e.target.value })} />
              </L>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[10px] font-medium text-slate-500 dark:text-slate-400">触发方式（triggers）</label>
                  {editable && (
                    <button className="btn-ghost !px-1.5 !py-0.5 text-[10px]" onClick={() => addTrigger(idx)}><Plus size={11} /> 加触发</button>
                  )}
                </div>
                <div className="space-y-1.5">
                  {f.triggers.map((t, ti) => (
                    <TriggerRow key={ti} t={t} editable={editable}
                      onChange={(nt) => setTrigger(idx, ti, nt)}
                      onRemove={() => removeTrigger(idx, ti)} />
                  ))}
                  {f.triggers.length === 0 && (
                    <div className="text-[11px] text-slate-400 dark:text-slate-500 italic">暂无触发方式（仅能通过快捷键/直接运行）</div>
                  )}
                </div>
              </div>
              <FeatureExtras f={f} editable={editable} isReact={contract.template === 'react'} onChange={(p) => setFeature(idx, p)} />
            </div>
          ))}
          {contract.features.length === 0 && (
            <div className="text-[12px] text-slate-400 dark:text-slate-500 italic">至少需要一个功能入口</div>
          )}
        </div>
      </div>

      {/* 权限 */}
      <div className="p-4 space-y-2">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">权限（仅勾选确实需要的）</span>
        <div className="flex flex-wrap gap-2">
          {PERMISSION_OPTIONS.filter((o) => !o.sensitive).map((opt) => (
            <PermPill key={opt.key} label={opt.label} on={!!contract.permissions[opt.key]} editable={editable}
              onToggle={() => patch({ permissions: { ...contract.permissions, [opt.key]: !contract.permissions[opt.key] } })} />
          ))}
        </div>
        <button className="flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
          onClick={() => setShowSensitive((v) => !v)}>
          敏感权限（麦克风/摄像头/屏幕/定位/执行命令…）
          <ChevronDown size={12} className={`transition-transform ${showSensitive ? 'rotate-180' : ''}`} />
        </button>
        {showSensitive && (
          <div className="flex flex-wrap gap-2 pt-1">
            {PERMISSION_OPTIONS.filter((o) => o.sensitive).map((opt) => (
              <PermPill key={opt.key} label={opt.label} on={!!contract.permissions[opt.key]} editable={editable} sensitive
                onToggle={() => patch({ permissions: { ...contract.permissions, [opt.key]: !contract.permissions[opt.key] } })} />
            ))}
          </div>
        )}
        {/* 命令执行（结构化，schema 推荐，优先于 legacy「执行命令」runCommand） */}
        <div className="pt-1.5 mt-1 space-y-1.5 border-t border-dashed border-slate-200 dark:border-slate-700">
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">命令执行（需跑系统命令才开；推荐用它而非旧版「执行命令」）</span>
          {(['direct', 'ai'] as const).map((scope) => {
            const sc = contract.commandExecution?.[scope]
            const lbl = scope === 'direct' ? '插件代码直接执行' : 'AI 生成命令执行'
            return (
              <div key={scope} className="flex flex-wrap items-center gap-2">
                <MiniChk label={lbl} on={!!sc?.enabled} editable={editable} onToggle={() => patchCmdExec(scope, { enabled: !sc?.enabled })} />
                {sc?.enabled && (['defaultProfile', 'maxProfile'] as const).map((pk) => (
                  <label key={pk} className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
                    {pk === 'defaultProfile' ? '默认' : '上限'}
                    <select className="input-base !py-0.5 text-[10px] !w-auto" value={sc[pk] || (pk === 'defaultProfile' ? 'sandbox' : 'workspace')} disabled={!editable}
                      onChange={(e) => patchCmdExec(scope, { [pk]: e.target.value as ExecProfile })}>
                      {EXEC_PROFILES.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            )
          })}
        </div>
      </div>

      {/* 高级设置：窗口 / 行为 / 平台 */}
      <div className="p-4 space-y-3">
        <button className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          onClick={() => setShowAdv((v) => !v)}>
          <SlidersHorizontal size={13} /> 高级设置（窗口尺寸 / 行为 / 平台）
          <ChevronDown size={13} className={`transition-transform ${showAdv ? 'rotate-180' : ''}`} />
        </button>
        {showAdv && (
          <div className="space-y-3.5">
            {showWindow && (
              <div className="space-y-1.5">
                <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400"><AppWindow size={12} /> 窗口</span>
                <div className="grid grid-cols-3 gap-1.5">
                  {([['width', '宽'], ['height', '高'], ['minWidth', '最小宽'], ['minHeight', '最小高'], ['maxWidth', '最大宽'], ['maxHeight', '最大高']] as const).map(([key, lbl]) => (
                    <L key={key} label={lbl} mini>
                      <input className="input-base mono !py-1 text-xs" type="number" min={1} value={numField(contract.window?.[key])} disabled={!editable}
                        onChange={(e) => patchWindow({ [key]: parseNum(e.target.value) } as Partial<VibeWindow>)} />
                    </L>
                  ))}
                </div>
                <L label="窗口类型" mini>
                  <select className="input-base !py-1 text-xs" value={contract.window?.type || 'default'} disabled={!editable}
                    onChange={(e) => patchWindow({ type: e.target.value as VibeWindow['type'] })}>
                    <option value="default">默认（带标题栏）</option>
                    <option value="borderless">无边框</option>
                    <option value="fullscreen">全屏</option>
                  </select>
                </L>
                <div className="flex flex-wrap gap-2 pt-0.5">
                  <MiniChk label="标题栏" on={contract.window?.titleBar !== false} editable={editable} onToggle={() => patchWindow({ titleBar: contract.window?.titleBar === false ? true : false })} />
                  <MiniChk label="可缩放" on={contract.window?.resizable !== false} editable={editable} onToggle={() => patchWindow({ resizable: contract.window?.resizable === false ? true : false })} />
                  <MiniChk label="置顶" on={!!contract.window?.alwaysOnTop} editable={editable} onToggle={() => patchWindow({ alwaysOnTop: !contract.window?.alwaysOnTop })} />
                  <MiniChk label="透明" on={!!contract.window?.transparent} editable={editable} onToggle={() => patchWindow({ transparent: !contract.window?.transparent })} />
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">行为</span>
              <div className="flex flex-wrap gap-2">
                <MiniChk label="单例运行" on={contract.behavior?.single !== false} editable={editable} onToggle={() => patchBehavior({ single: contract.behavior?.single === false ? true : false })} />
                <MiniChk label="默认独立窗口" on={!!contract.behavior?.defaultDetached} editable={editable} onToggle={() => patchBehavior({ defaultDetached: !contract.behavior?.defaultDetached })} />
                <MiniChk label="允许后台常驻" on={!!contract.behavior?.background} editable={editable} onToggle={() => patchBehavior({ background: !contract.behavior?.background })} />
                {contract.behavior?.background && (
                  <MiniChk label="重启恢复后台" on={!!contract.behavior?.persistent} editable={editable} onToggle={() => patchBehavior({ persistent: !contract.behavior?.persistent })} />
                )}
              </div>
              {showWindow && (
                <label className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                  Super Panel 高度（可选）
                  <input className="input-base mono !py-1 text-xs !w-24" type="number" min={1} value={numField(contract.behavior?.height)} disabled={!editable}
                    onChange={(e) => patchBehavior({ height: parseNum(e.target.value) })} />
                </label>
              )}
            </div>
            <div className="space-y-1.5">
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400"><Globe size={12} /> 平台限制（不选 = 全平台）</span>
              <div className="flex flex-wrap gap-2">
                {PLATFORM_OPTIONS.map((p) => (
                  <PermPill key={p.value} label={p.label} on={(contract.platform || []).includes(p.value)} editable={editable}
                    onToggle={() => togglePlatform(p.value)} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 高级：AI 工具 */}
      <div className="p-4 space-y-2">
        <button className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          onClick={() => setShowTools((v) => !v)}>
          <Wrench size={13} /> AI 工具（可选，把插件能力暴露给 AI Agent）
          <ChevronDown size={13} className={`transition-transform ${showTools ? 'rotate-180' : ''}`} />
        </button>
        {showTools && (
          <div className="space-y-2">
            {contract.tools.map((t, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_2fr_auto] gap-2 items-center">
                <input className="input-base mono !py-1 text-xs" placeholder="tool_name" value={t.name} disabled={!editable}
                  onChange={(e) => patch({ tools: contract.tools.map((cur, i) => i === idx ? { ...cur, name: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '_') } : cur) })} />
                <input className="input-base !py-1 text-xs" placeholder="工具说明" value={t.description} disabled={!editable}
                  onChange={(e) => patch({ tools: contract.tools.map((cur, i) => i === idx ? { ...cur, description: e.target.value } : cur) })} />
                {editable && (
                  <button className="btn-ghost !px-2 !py-1 text-rose-500" onClick={() => patch({ tools: contract.tools.filter((_, i) => i !== idx) })}>
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            ))}
            {editable && (
              <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => patch({ tools: [...contract.tools, { name: '', description: '' }] })}>
                <Plus size={12} /> 加工具
              </button>
            )}
            {contract.tools.length === 0 && !editable && (
              <div className="text-[12px] text-slate-400 dark:text-slate-500">未声明 AI 工具</div>
            )}
          </div>
        )}
      </div>

      {/* 图标开关 */}
      {!contract.isEdit && (
        <div className="p-4 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            <Boxes size={13} /> AI 生成图标（SVG → 512 PNG）
          </span>
          <button disabled={!editable} onClick={() => patch({ needIcon: !contract.needIcon })}
            className={`relative w-10 h-5 rounded-full transition-colors ${contract.needIcon ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${contract.needIcon ? 'translate-x-5' : ''}`} />
          </button>
        </div>
      )}
    </div>
  )
}

function L({ label, mini, children }: { label: string; mini?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className={`block font-medium text-slate-500 dark:text-slate-400 ${mini ? 'text-[10px] mb-1' : 'text-xs mb-1.5'}`}>{label}</label>
      {children}
    </div>
  )
}

function PermPill({ label, on, editable, sensitive, onToggle }: { label: string; on: boolean; editable: boolean; sensitive?: boolean; onToggle: () => void }) {
  const activeCls = sensitive
    ? 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400'
    : 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
  return (
    <button disabled={!editable} onClick={onToggle}
      className={`px-2.5 py-1 rounded-full text-[12px] border transition-colors ${
        on ? activeCls : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300'
      }`}>
      {label}
    </button>
  )
}

function MiniChk({ label, on, editable, onToggle }: { label: string; on: boolean; editable: boolean; onToggle: () => void }) {
  return (
    <button disabled={!editable} onClick={onToggle}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] border transition-colors ${
        on ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300'
      }`}>
      <span className={`w-3 h-3 rounded-[4px] border flex items-center justify-center ${on ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300 dark:border-slate-600'}`}>
        {on && <Check size={9} className="text-white" />}
      </span>
      {label}
    </button>
  )
}

/** feature 级高级开关：搜索框推送 / 隐藏主窗口 / 启动前截图 / UI 路由 */
function FeatureExtras({ f, editable, isReact, onChange }: {
  f: VibeFeature
  editable: boolean
  isReact: boolean
  onChange: (p: Partial<VibeFeature>) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 pt-0.5">
      <MiniChk label="推送到搜索框" on={!!f.mainPush} editable={editable} onToggle={() => onChange({ mainPush: !f.mainPush })} />
      <MiniChk label="触发后隐藏主窗口" on={!!f.mainHide} editable={editable} onToggle={() => onChange({ mainHide: !f.mainHide })} />
      <label className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
        启动前截图
        <select className="input-base !py-0.5 text-[10px] !w-auto" value={f.preCapture || ''} disabled={!editable}
          onChange={(e) => onChange({ preCapture: (e.target.value || undefined) as VibeFeature['preCapture'] })}>
          <option value="">无</option>
          <option value="region">区域</option>
          <option value="fullscreen">全屏</option>
        </select>
      </label>
      {isReact && (
        <input className="input-base mono !py-0.5 text-[10px] flex-1 min-w-[90px]" placeholder="UI 路由(可选) 如 /detail" value={f.route || ''} disabled={!editable}
          onChange={(e) => onChange({ route: e.target.value })} />
      )}
    </div>
  )
}

/** 切换触发类型时只保留通用的 label，其余字段清空 */
function changeTriggerType(t: VibeTrigger, type: TriggerType): VibeTrigger {
  return { type, label: t.label }
}

const TI = 'input-base !py-1 text-xs'

function TriggerRow({ t, editable, onChange, onRemove }: {
  t: VibeTrigger
  editable: boolean
  onChange: (t: VibeTrigger) => void
  onRemove: () => void
}) {
  const set = (p: Partial<VibeTrigger>) => onChange({ ...t, ...p })
  const hint = TRIGGER_TYPES.find((x) => x.value === t.type)?.hint
  return (
    <div className="rounded-md border border-slate-200 dark:border-slate-700 p-2 space-y-1.5 bg-slate-50/60 dark:bg-slate-800/30">
      <div className="flex items-center gap-1.5">
        <select className={`${TI} mono !w-auto shrink-0`} value={t.type} disabled={!editable}
          onChange={(e) => onChange(changeTriggerType(t, e.target.value as TriggerType))}>
          {TRIGGER_TYPES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
        </select>
        <span className="text-[10px] text-slate-400 dark:text-slate-500 flex-1 truncate" title={hint}>{hint}</span>
        {editable && (
          <button className="btn-ghost !px-1.5 !py-1 text-rose-500 shrink-0" onClick={onRemove} title="删除触发"><Trash2 size={12} /></button>
        )}
      </div>

      {t.type === 'keyword' && (
        <input className={`${TI} mono`} placeholder="关键词，如 json" value={t.value || ''} disabled={!editable}
          onChange={(e) => set({ value: e.target.value })} />
      )}

      {t.type === 'regex' && (
        <div className="space-y-1.5">
          <input className={`${TI} mono`} placeholder="正则，如 ^[0-9]+(\.[0-9]{1,2})?$" value={t.match || ''} disabled={!editable}
            onChange={(e) => set({ match: e.target.value })} />
          <div className="grid grid-cols-2 gap-1.5">
            <input className={TI} placeholder="指令名 label" value={t.label || ''} disabled={!editable}
              onChange={(e) => set({ label: e.target.value })} />
            <input className={`${TI} mono`} placeholder="示例输入（试用）" value={t.sample || ''} disabled={!editable}
              onChange={(e) => set({ sample: e.target.value })} />
          </div>
        </div>
      )}

      {t.type === 'over' && (
        <div className="grid grid-cols-2 gap-1.5">
          <input className={TI} placeholder="指令名 label" value={t.label || ''} disabled={!editable}
            onChange={(e) => set({ label: e.target.value })} />
          <input className={`${TI} mono`} placeholder="排除正则（可选）" value={t.exclude || ''} disabled={!editable}
            onChange={(e) => set({ exclude: e.target.value })} />
        </div>
      )}

      {(t.type === 'files' || t.type === 'img') && (
        <div className="grid grid-cols-2 gap-1.5">
          <input className={`${TI} mono`} placeholder="扩展名，如 png,jpg（可选）" value={(t.exts || []).join(',')} disabled={!editable}
            onChange={(e) => set({ exts: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
          <input className={TI} placeholder="指令名 label" value={t.label || ''} disabled={!editable}
            onChange={(e) => set({ label: e.target.value })} />
        </div>
      )}

      {t.type === 'window' && (
        <div className="grid grid-cols-3 gap-1.5">
          <input className={TI} placeholder="app（/正则/ 或精确）" value={t.app || ''} disabled={!editable}
            onChange={(e) => set({ app: e.target.value })} />
          <input className={TI} placeholder="title" value={t.title || ''} disabled={!editable}
            onChange={(e) => set({ title: e.target.value })} />
          <input className={`${TI} mono`} placeholder="bundleId" value={t.bundleId || ''} disabled={!editable}
            onChange={(e) => set({ bundleId: e.target.value })} />
        </div>
      )}
    </div>
  )
}
