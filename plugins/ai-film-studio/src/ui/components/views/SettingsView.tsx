import { useEffect, useState } from 'react'
import { Sun, Moon, Sparkles } from 'lucide-react'
import ProviderSettings from '../ProviderSettings'
import PromptSettings from '../PromptSettings'
import { useUiStore, type Theme } from '../../store/uiStore'
import { useAssetStore } from '../../store/assetStore'
import { useGraphStore } from '../../store/graphStore'

type SettingsTab = 'providers' | 'appearance' | 'storage' | 'advanced'

const TABS: { id: SettingsTab; label: string; desc: string }[] = [
  { id: 'providers', label: '模型供应商', desc: '视频 / 配乐 / 语音 自管供应商与 API Key' },
  { id: 'appearance', label: '外观', desc: '亮色 / 暗色主题' },
  { id: 'storage', label: '存储', desc: '素材附件占用与清理' },
  { id: 'advanced', label: '高级', desc: '节点提示词（引擎 system prompt）· 专家' },
]

function fmtBytes(n?: number): string {
  if (!n) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** 设置一级界面：模型供应商 / 外观 / 存储。内容居中。 */
export default function SettingsView() {
  const [tab, setTab] = useState<SettingsTab>('providers')
  return (
    <div className="afs-surface">
      <div className="afs-surface__head">
        <h2 className="afs-surface__title">设置</h2>
      </div>
      <div className="afs-settings">
        <aside className="afs-settings__nav">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`afs-settings__navitem${tab === t.id ? ' is-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <span className="afs-settings__navlabel">{t.label}</span>
              <span className="afs-settings__navdesc">{t.desc}</span>
            </button>
          ))}
        </aside>
        <section className="afs-settings__content">
          <div className="afs-settings__inner">
            {tab === 'providers' && <ProviderSettings />}
            {tab === 'appearance' && <AppearanceSettings />}
            {tab === 'storage' && <StorageSettings />}
            {tab === 'advanced' && <AdvancedSettings />}
          </div>
        </section>
      </div>
    </div>
  )
}

function AppearanceSettings() {
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)
  const options: { id: Theme; label: string }[] = [
    { id: 'light', label: '亮色' },
    { id: 'dark', label: '暗色' },
  ]
  return (
    <div className="afs-setsec">
      <div className="afs-setsec__title">外观</div>
      <div className="afs-setsec__desc">选择界面主题。默认跟随 Mulby 宿主；手动切换后以你的选择为准。</div>
      <div className="afs-themepick">
        {options.map((o) => (
          <button key={o.id} className={`afs-themecard${theme === o.id ? ' is-active' : ''}`} onClick={() => setTheme(o.id)}>
            <span className={`afs-themecard__sw afs-themecard__sw--${o.id}`}>
              {o.id === 'light' ? <Sun size={16} /> : <Moon size={16} />}
            </span>
            <span>{o.label}</span>
          </button>
        ))}
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

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const onGc = async () => {
    if (!window.confirm('清理「未被任何工程 / 角色场景库 / 上传素材 / 快照」引用的附件？此操作不可撤销。')) return
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
