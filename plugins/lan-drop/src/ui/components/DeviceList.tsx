import { Monitor, Plus, RefreshCw, Star, Wifi, Cable, ShieldCheck, Smartphone } from 'lucide-react'
import type { RemoteDevice, SelfInfo } from '../../core/types'
import { formatFingerprint, osLabel } from '../format'

interface Props {
  self: SelfInfo | null
  devices: RemoteDevice[]
  selectedId: string | null
  onSelect: (id: string) => void
  onToggleTrust: (device: RemoteDevice) => void
  onManualAdd: () => void
  onRefresh: () => void
}

export function DeviceList({
  self,
  devices,
  selectedId,
  onSelect,
  onToggleTrust,
  onManualAdd,
  onRefresh,
}: Props) {
  return (
    <aside className="devices">
      <div className="panel-head">
        <h2>
          <Wifi size={14} /> 设备
          <span className="count">{devices.length}</span>
        </h2>
        <div className="panel-actions">
          <button className="icon-btn" title="刷新" onClick={onRefresh}>
            <RefreshCw size={15} />
          </button>
          <button className="icon-btn" title="手动添加 IP" onClick={onManualAdd}>
            <Plus size={16} />
          </button>
        </div>
      </div>

      {self && (
        <div className="self-card">
          <div className="self-avatar">
            <Monitor size={18} />
          </div>
          <div className="self-meta">
            <div className="self-name">{self.deviceName}</div>
            <div className="self-sub">
              本机 · {osLabel(self.os)} · {self.ips[0] || '无网络'}
            </div>
            {self.deviceId && (
              <div className="self-fp" title="本机身份指纹（可与对端带外核对，确认非中间人）">
                指纹 {formatFingerprint(self.deviceId, 4)}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="device-scroll">
        {devices.length === 0 && (
          <div className="device-empty">
            <p>暂未发现设备</p>
            <span>请确保对端也开启了闪传并处于同一局域网</span>
          </div>
        )}

        {devices.map((d) => {
          const online = Date.now() - d.lastSeen < 15000 || d.manual
          return (
            <button
              key={d.id}
              className={`device-card ${selectedId === d.id ? 'selected' : ''}`}
              onClick={() => onSelect(d.id)}
            >
              <span className={`dot ${online ? 'on' : 'off'}`} />
              <div className="device-info">
                <div className="device-name">
                  {d.name}
                  {d.web && (
                    <Smartphone size={12} className="manual-flag" aria-label="扫码接入的手机" />
                  )}
                  {d.verified && (
                    <ShieldCheck size={12} className="verified-flag" aria-label="身份已验证" />
                  )}
                  {d.manual && !d.web && <Cable size={12} className="manual-flag" />}
                </div>
                <div className="device-sub">
                  {d.web ? '手机 · 扫码接入' : `${osLabel(d.os)} · ${d.ip}`}
                </div>
              </div>
              {d.web ? (
                <span className="web-flag" title="扫码接入的手机">
                  <Smartphone size={15} />
                </span>
              ) : (
                <span
                  className={`star ${d.trusted ? 'active' : ''}`}
                  title={d.trusted ? '已信任（身份验证通过后自动接收）' : '设为信任设备'}
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleTrust(d)
                  }}
                >
                  <Star size={15} fill={d.trusted ? 'currentColor' : 'none'} />
                </span>
              )}
            </button>
          )
        })}
      </div>
    </aside>
  )
}
