import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Check, Copy, RefreshCw, Smartphone, X } from 'lucide-react'
import type { MobileGatewayInfo } from '../../core/types'
import { api } from '../api'

interface Props {
  /** 来自 AppState 的快照（连接数等实时变化）；首屏即可展示，随后用 RPC 拉取含令牌的完整信息。 */
  snapshot?: MobileGatewayInfo
  onClose: () => void
}

export function MobileDrawer({ snapshot, onClose }: Props) {
  const [info, setInfo] = useState<MobileGatewayInfo | null>(snapshot ?? null)
  const [qr, setQr] = useState<string>('')
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  // 打开面板即拉取「含令牌的完整信息」（getState 中的快照不含令牌，避免令牌随广播状态外泄）。
  const load = useCallback(async () => {
    try {
      const r = await api.getMobileGateway()
      if (r) setInfo(r)
    } catch {
      /* 后端未就绪，下次重试 */
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // 用连接数等实时快照刷新（不覆盖 url/pin —— 那些只来自 RPC）。
  useEffect(() => {
    if (!snapshot) return
    setInfo((prev) =>
      prev ? { ...prev, enabled: snapshot.enabled, connectedCount: snapshot.connectedCount } : snapshot,
    )
  }, [snapshot])

  useEffect(() => {
    if (info?.url) {
      QRCode.toDataURL(info.url, { width: 240, margin: 1, errorCorrectionLevel: 'M' })
        .then(setQr)
        .catch(() => setQr(''))
    } else {
      setQr('')
    }
  }, [info?.url])

  const enabled = info?.enabled ?? true

  const toggle = async (next: boolean) => {
    setBusy(true)
    try {
      const r = await api.setMobileGateway(next)
      if (r?.mobile) setInfo(r.mobile)
    } finally {
      setBusy(false)
    }
  }

  const regen = async () => {
    setBusy(true)
    try {
      const r = await api.regenMobilePairing()
      if (r?.mobile) setInfo(r.mobile)
    } finally {
      setBusy(false)
    }
  }

  const copyUrl = () => {
    if (!info?.url) return
    try {
      window.mulby?.clipboard?.writeText(info.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="drawer-mask" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h2>
            <Smartphone size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />
            手机互传
          </h2>
          <button className="icon-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="drawer-body">
          <label className="switch-row">
            <span>
              <span className="field-label">启用手机互传</span>
              <span className="field-hint">
                手机用浏览器扫码即可与本机收发文件，无需安装 App。仅限同一局域网。
              </span>
            </span>
            <input
              type="checkbox"
              checked={enabled}
              disabled={busy}
              onChange={(e) => toggle(e.target.checked)}
            />
          </label>

          {enabled ? (
            <>
              <div className="qr-card">
                {qr ? (
                  <img className="qr-img" src={qr} alt="扫码连接" width={240} height={240} />
                ) : (
                  <div className="qr-placeholder">正在生成二维码…</div>
                )}
                <p className="qr-tip">用手机相机或浏览器扫一扫</p>
              </div>

              <div className="field">
                <span className="field-label">手动打开（不便扫码时）</span>
                <div className="dir-row">
                  <span className="dir-path" title={info?.baseUrl}>
                    http://{info?.baseUrl || '...'}/m
                  </span>
                  <button
                    className="icon-btn"
                    title="复制完整地址（含令牌）"
                    onClick={copyUrl}
                  >
                    {copied ? <Check size={15} /> : <Copy size={15} />}
                  </button>
                </div>
                <span className="field-hint">
                  手机浏览器打开上面地址后，输入下方 6 位配对码即可连接。
                </span>
              </div>

              <div className="pin-card">
                <span className="pin-label">配对码 PIN</span>
                <span className="pin-value">{info?.pin || '------'}</span>
              </div>

              <div className="status-box">
                <div className="status-line">
                  <span>已连接手机</span>
                  <span className={info?.connectedCount ? 'ok' : ''}>
                    {info?.connectedCount || 0} 台
                  </span>
                </div>
                <div className="status-line">
                  <span>配对码有效期</span>
                  <span className="fp-mono">{formatExpiry(info?.expiresAt)}</span>
                </div>
                <button className="btn-secondary full" onClick={regen} disabled={busy}>
                  <RefreshCw size={14} className={busy ? 'spin' : ''} /> 刷新二维码 / 配对码
                </button>
              </div>

              <div className="field-hint" style={{ lineHeight: 1.7 }}>
                · 扫码连接后，手机会出现在左侧「设备」列表，可像普通设备一样选中并发送文件给它。<br />
                · 手机发来的文件按你的接收设置落盘，文件夹会保留层级。<br />
                · 局域网内直连，文件不经过任何服务器。
              </div>
            </>
          ) : (
            <div className="field-hint" style={{ padding: '20px 0', textAlign: 'center' }}>
              手机互传已关闭。开启后显示二维码，手机扫码即可收发文件。
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function formatExpiry(expiresAt?: number): string {
  if (!expiresAt) return '—'
  const ms = expiresAt - Date.now()
  if (ms <= 0) return '已过期，请刷新'
  const min = Math.round(ms / 60000)
  if (min >= 60) return `约 ${Math.round(min / 60)} 小时`
  return `约 ${Math.max(1, min)} 分钟`
}
