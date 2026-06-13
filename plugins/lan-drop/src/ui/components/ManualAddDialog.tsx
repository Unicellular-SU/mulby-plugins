import { useState } from 'react'
import { Loader2, X } from 'lucide-react'

interface Props {
  busy: boolean
  error?: string
  onAdd: (ip: string, port?: number) => void
  onClose: () => void
}

export function ManualAddDialog({ busy, error, onAdd, onClose }: Props) {
  const [ip, setIp] = useState('')
  const [port, setPort] = useState('')

  const submit = () => {
    if (!ip.trim()) return
    onAdd(ip.trim(), port ? Number(port) : undefined)
  }

  return (
    <div className="drawer-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h2>手动添加设备</h2>
          <button className="icon-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <p className="modal-hint">
            当广播被路由器隔离（AP 隔离）或跨网段时，可手动输入对端 IP 直连。
          </p>
          <label className="field">
            <span className="field-label">对端 IP 地址</span>
            <input
              className="text-input"
              autoFocus
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="例如 192.168.1.23"
            />
          </label>
          <label className="field">
            <span className="field-label">端口（可选，默认 52801）</span>
            <input
              className="text-input"
              value={port}
              onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="52801"
            />
          </label>
          {error && <div className="modal-error">{error}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary" onClick={submit} disabled={busy || !ip.trim()}>
            {busy ? <Loader2 size={14} className="spin" /> : null}
            {busy ? '连接中…' : '添加'}
          </button>
        </div>
      </div>
    </div>
  )
}
