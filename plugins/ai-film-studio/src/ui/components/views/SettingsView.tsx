import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Sparkles, Server, HardDrive, SlidersHorizontal, type LucideIcon } from 'lucide-react'
import ProviderSettings from '../ProviderSettings'
import PromptSettings from '../PromptSettings'
import { useAssetStore } from '../../store/assetStore'
import { useGraphStore } from '../../store/graphStore'
import { useConfirm } from '../ui/ConfirmDialog'

type SettingsTab = 'providers' | 'storage' | 'advanced'

const TABS: { id: SettingsTab; label: string; desc: string; icon: LucideIcon }[] = [
  { id: 'providers', label: '模型供应商', desc: '视频 / 配乐 / 语音 自管供应商与 API Key', icon: Server },
  { id: 'storage', label: '存储', desc: '素材附件占用与清理', icon: HardDrive },
  { id: 'advanced', label: '高级', desc: '节点提示词（引擎 system prompt）· 专家', icon: SlidersHorizontal },
]

function fmtBytes(n?: number): string {
  if (!n) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** 设置一级界面：模型供应商 / 存储 / 高级。左侧竖向 Tabs（ARIA tablist），内容居中。主题切换在侧边导航栏。 */
export default function SettingsView() {
  const [tab, setTab] = useState<SettingsTab>('providers')
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  // 竖向 Tabs 键盘：↑/↓ 循环、Home/End 跳首尾（自动激活 + 移焦）
  const onNavKey = (e: ReactKeyboardEvent, idx: number) => {
    let next = idx
    if (e.key === 'ArrowDown') next = (idx + 1) % TABS.length
    else if (e.key === 'ArrowUp') next = (idx - 1 + TABS.length) % TABS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = TABS.length - 1
    else return
    e.preventDefault()
    setTab(TABS[next].id)
    tabRefs.current[next]?.focus()
  }

  return (
    <div className="afs-surface">
      <div className="afs-surface__head">
        <h2 className="afs-surface__title">设置</h2>
      </div>
      <div className="afs-settings">
        <aside className="afs-settings__nav" role="tablist" aria-orientation="vertical" aria-label="设置分类">
          {TABS.map((t, i) => {
            const Icon = t.icon
            const active = tab === t.id
            return (
              <button
                key={t.id}
                ref={(el) => {
                  tabRefs.current[i] = el
                }}
                role="tab"
                id={`afs-settab-${t.id}`}
                aria-selected={active}
                aria-controls={active ? `afs-setpanel-${t.id}` : undefined}
                tabIndex={active ? 0 : -1}
                className={`afs-settings__navitem${active ? ' is-active' : ''}`}
                onClick={() => setTab(t.id)}
                onKeyDown={(e) => onNavKey(e, i)}
              >
                <Icon size={18} className="afs-settings__navicon" aria-hidden />
                <span className="afs-settings__navtext">
                  <span className="afs-settings__navlabel">{t.label}</span>
                  <span className="afs-settings__navdesc">{t.desc}</span>
                </span>
              </button>
            )
          })}
        </aside>
        <section
          className="afs-settings__content"
          role="tabpanel"
          id={`afs-setpanel-${tab}`}
          aria-labelledby={`afs-settab-${tab}`}
          tabIndex={0}
        >
          <div className="afs-settings__inner">
            {tab === 'providers' && <ProviderSettings />}
            {tab === 'storage' && <StorageSettings />}
            {tab === 'advanced' && <AdvancedSettings />}
          </div>
        </section>
      </div>
    </div>
  )
}

function StorageSettings() {
  const usage = useAssetStore((s) => s.usage)
  const loaded = useAssetStore((s) => s.loaded)
  const busy = useAssetStore((s) => s.busy)
  const load = useAssetStore((s) => s.load)
  const runGc = useAssetStore((s) => s.runGc)
  const saveProject = useGraphStore((s) => s.saveProject)
  const confirm = useConfirm()

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const onGc = async () => {
    if (!(await confirm({ title: '清理未引用素材', message: '清理「未被任何工程 / 角色场景库 / 上传素材 / 快照」引用的附件？此操作不可撤销。', danger: true, confirmLabel: '清理' }))) return
    await saveProject()
    const r = await runGc()
    window.mulby?.notification?.show(`已清理 ${r.removed} 个未引用素材，释放 ${fmtBytes(r.freedBytes)}`, 'success')
  }

  return (
    <div className="afs-setsec">
      <div className="afs-setsec__title">存储</div>
      <div className="afs-setsec__desc">
        生成与上传的素材以附件形式存于本机。可清理「未被任何工程 / 角色场景库 / 快照引用」的孤儿附件，回收空间。
      </div>
      <div className="afs-setrow">
        <span>附件占用</span>
        <b>
          {usage.count} 项 · {fmtBytes(usage.bytes)}
        </b>
      </div>
      <button className="afs-btn" disabled={busy} onClick={onGc}>
        <Sparkles size={15} /> 清理未引用素材
      </button>
    </div>
  )
}

function AdvancedSettings() {
  return (
    <div className="afs-setsec">
      <div className="afs-setsec__title">高级 · 节点提示词</div>
      <div className="afs-advbanner">
        这是引擎级设置：每个节点背后发给 AI 的「系统提示词」。<b>普通使用完全无需修改</b>——默认值已经调好。
        改动会直接影响生成质量；文本节点的 JSON 输出结构由引擎自动兜底，但仍请谨慎。生效优先级：本工程 &gt; 全局默认 &gt; 内置默认。
      </div>
      <PromptSettings />
    </div>
  )
}
