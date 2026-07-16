import { useEffect } from 'react'
import { Sparkles } from 'lucide-react'
import ProviderSettings from '../ProviderSettings'
import PromptSettings from '../PromptSettings'
import { useAssetStore } from '../../store/assetStore'
import { useAssetHubStore } from '../../store/assetHubStore'
import { useGraphStore } from '../../store/graphStore'
import { useConfirm } from '../ui/ConfirmDialog'

export type SettingsSection = 'models' | 'storage' | 'advanced'
const TITLE: Record<SettingsSection, string> = { models: '模型供应商', storage: '存储', advanced: '高级' }

function fmtBytes(n?: number): string {
  if (!n) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** 设置子页：由侧边导航栏的「模型 / 存储 / 高级」分别进入（不再有内部 Tabs）。内容居中。主题切换在导航栏底部。 */
export default function SettingsView({ section }: { section: SettingsSection }) {
  return (
    <div className="afs-surface">
      <div className="afs-surface__head">
        <h2 className="afs-surface__title">{TITLE[section]}</h2>
      </div>
      <section className="afs-settings__content">
        <div className="afs-settings__inner">
          {section === 'models' && <ProviderSettings />}
          {section === 'storage' && <StorageSettings />}
          {section === 'advanced' && <AdvancedSettings />}
        </div>
      </section>
    </div>
  )
}

function StorageSettings() {
  const busy = useAssetStore((s) => s.busy)
  const runGc = useAssetStore((s) => s.runGc)
  const usage = useAssetHubStore((s) => s.storageUsage)
  const hubLoaded = useAssetHubStore((s) => s.loaded)
  const refreshAssetHub = useAssetHubStore((s) => s.refresh)
  const saveProject = useGraphStore((s) => s.saveProject)
  const confirm = useConfirm()

  useEffect(() => {
    if (!hubLoaded) void refreshAssetHub()
  }, [hubLoaded, refreshAssetHub])

  const onGc = async () => {
    if (!(await confirm({ title: '清理未引用素材', message: '清理「未被任何工程 / 角色场景库 / 上传素材 / 快照」引用的附件？此操作不可撤销。', danger: true, confirmLabel: '清理' }))) return
    await saveProject()
    const r = await runGc()
    await refreshAssetHub()
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
