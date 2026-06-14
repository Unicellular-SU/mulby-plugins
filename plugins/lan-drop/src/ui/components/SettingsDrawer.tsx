import { useState } from 'react'
import { FolderOpen, RefreshCw, X } from 'lucide-react'
import type { SelfInfo, Settings } from '../../core/types'
import { formatFingerprint } from '../format'

interface Props {
  settings: Settings
  self: SelfInfo | null
  onPatch: (patch: Partial<Settings>) => void
  onChooseDir: () => void
  onOpenDir: () => void
  onRestart: () => void
  onClose: () => void
}

export function SettingsDrawer({
  settings,
  self,
  onPatch,
  onChooseDir,
  onOpenDir,
  onRestart,
  onClose,
}: Props) {
  const [name, setName] = useState(settings.deviceName)

  const commitName = () => {
    const trimmed = name.trim()
    if (trimmed && trimmed !== settings.deviceName) onPatch({ deviceName: trimmed })
    else setName(settings.deviceName)
  }

  return (
    <div className="drawer-mask" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h2>设置</h2>
          <button className="icon-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="drawer-body">
          <label className="field">
            <span className="field-label">设备名称</span>
            <input
              className="text-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              placeholder="本机在局域网中显示的名称"
            />
          </label>

          <label className="field">
            <span className="field-label">文件保存目录</span>
            <div className="dir-row">
              <span className="dir-path" title={settings.downloadDir}>
                {settings.downloadDir}
              </span>
            </div>
            <div className="field-actions">
              <button className="btn-secondary" onClick={onChooseDir}>
                选择目录
              </button>
              <button className="btn-secondary" onClick={onOpenDir}>
                <FolderOpen size={14} /> 打开
              </button>
            </div>
          </label>

          <div className="field">
            <span className="field-label">接收策略</span>
            <div className="seg">
              <button
                className={settings.receiveMode === 'ask' ? 'seg-on' : ''}
                onClick={() => onPatch({ receiveMode: 'ask' })}
              >
                询问确认
              </button>
              <button
                className={settings.receiveMode === 'accept-all' ? 'seg-on' : ''}
                onClick={() => onPatch({ receiveMode: 'accept-all' })}
              >
                自动接收
              </button>
            </div>
            <span className="field-hint">
              {settings.receiveMode === 'ask'
                ? '非信任设备发来文件时弹窗确认；仅「身份已验证」的信任设备自动接收。'
                : '自动接收所有设备发来的文件（请在可信网络使用）。'}
            </span>
          </div>

          <label className="switch-row">
            <span>
              <span className="field-label">启用设备发现</span>
              <span className="field-hint">关闭后将不再广播本机，也不主动搜索设备。</span>
            </span>
            <input
              type="checkbox"
              checked={settings.discoveryEnabled}
              onChange={(e) => onPatch({ discoveryEnabled: e.target.checked })}
            />
          </label>

          <label className="switch-row">
            <span>
              <span className="field-label">完整性校验 (SHA-256)</span>
              <span className="field-hint">为传输文件计算哈希校验，确保未损坏（大文件会略过）。</span>
            </span>
            <input
              type="checkbox"
              checked={settings.verifyIntegrity}
              onChange={(e) => onPatch({ verifyIntegrity: e.target.checked })}
            />
          </label>

          <label className="switch-row">
            <span>
              <span className="field-label">端到端加密 (AES-256-GCM)</span>
              <span className="field-hint">对身份可验证的对端加密传输，密钥由 ECDH 协商、不经过网络。</span>
            </span>
            <input
              type="checkbox"
              checked={settings.encrypt}
              onChange={(e) => onPatch({ encrypt: e.target.checked })}
            />
          </label>

          <label className="switch-row">
            <span>
              <span className="field-label">手机互传（扫码网关）</span>
              <span className="field-hint">允许手机浏览器扫码与本机收发文件；关闭后手机网页与接口全部拒绝。</span>
            </span>
            <input
              type="checkbox"
              checked={settings.mobileGatewayEnabled}
              onChange={(e) => onPatch({ mobileGatewayEnabled: e.target.checked })}
            />
          </label>

          <label className="switch-row">
            <span>
              <span className="field-label">手机上传免确认</span>
              <span className="field-hint">已扫码授权的手机上传文件时不再弹窗确认（扫码即视为授权）。</span>
            </span>
            <input
              type="checkbox"
              checked={settings.mobileAutoAccept}
              onChange={(e) => onPatch({ mobileAutoAccept: e.target.checked })}
            />
          </label>

          <div className="status-box">
            <div className="status-line">
              <span>接收服务</span>
              <span className={self?.receiveOnline ? 'ok' : 'err'}>
                {self?.receiveOnline ? `在线 · 端口 ${self.port}` : '离线'}
              </span>
            </div>
            <div className="status-line">
              <span>设备发现</span>
              <span className={self?.discoveryOnline ? 'ok' : 'err'}>
                {self?.discoveryOnline ? '在线' : '离线'}
              </span>
            </div>
            {self?.deviceId && (
              <div className="status-line">
                <span>本机身份指纹</span>
                <span className="fp-mono" title={self.deviceId}>
                  {formatFingerprint(self.deviceId)}
                </span>
              </div>
            )}
            {self?.serverError && <div className="status-error">{self.serverError}</div>}
            <button className="btn-secondary full" onClick={onRestart}>
              <RefreshCw size={14} /> 重启网络服务
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
