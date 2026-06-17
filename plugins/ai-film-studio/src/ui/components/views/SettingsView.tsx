import ProviderSettings from '../ProviderSettings'

/**
 * 设置一级界面。画风/画幅与提示词模板已迁入「提示词库」；此处聚焦自管模型供应商。
 */
export default function SettingsView() {
  return (
    <div className="afs-surface">
      <div className="afs-surface__head">
        <h2 className="afs-surface__title">设置</h2>
      </div>
      <div className="afs-settings">
        <aside className="afs-settings__nav">
          <button className="afs-settings__navitem is-active">
            <span className="afs-settings__navlabel">模型供应商</span>
            <span className="afs-settings__navdesc">视频 / 配乐 / 语音 自管供应商与 API Key</span>
          </button>
        </aside>
        <section className="afs-settings__content">
          <ProviderSettings />
        </section>
      </div>
    </div>
  )
}
