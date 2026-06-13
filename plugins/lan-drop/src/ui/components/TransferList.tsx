import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Ban,
  Check,
  FolderOpen,
  Loader2,
  Lock,
  Trash2,
  X,
} from 'lucide-react'
import type { Transfer, TransferStatus } from '../../core/types'
import { formatEta, formatSize, formatSpeed, formatTime } from '../format'

interface Props {
  transfers: Transfer[]
  onCancel: (id: string) => void
  onOpen: (t: Transfer) => void
  onClear: () => void
}

const STATUS_TEXT: Record<TransferStatus, string> = {
  pending: '排队中',
  active: '传输中',
  done: '已完成',
  failed: '失败',
  rejected: '已拒绝',
  canceled: '已取消',
}

function statusClass(s: TransferStatus): string {
  if (s === 'done') return 'ok'
  if (s === 'failed' || s === 'rejected') return 'err'
  if (s === 'canceled') return 'muted'
  return 'live'
}

function TransferRow({ t, onCancel, onOpen }: { t: Transfer; onCancel: Props['onCancel']; onOpen: Props['onOpen'] }) {
  const isActive = t.status === 'active' || t.status === 'pending'
  const pct = t.size > 0 ? Math.min(100, Math.round((t.transferred / t.size) * 100)) : 0
  const remaining = t.size - t.transferred

  return (
    <div className={`tx-row ${isActive ? 'active' : ''}`}>
      <span className={`tx-dir ${t.dir}`}>
        {t.dir === 'send' ? <ArrowUpFromLine size={15} /> : <ArrowDownToLine size={15} />}
      </span>

      <div className="tx-body">
        <div className="tx-line1">
          <span className="tx-name" title={t.name}>
            {t.name}
          </span>
          {t.encrypted && <Lock size={11} className="tx-enc" aria-label="已加密 (AES-256-GCM)" />}
          <span className={`tx-status ${statusClass(t.status)}`}>
            {t.status === 'active' && <Loader2 size={11} className="spin" />}
            {t.status === 'done' && <Check size={11} />}
            {(t.status === 'failed' || t.status === 'rejected') && <Ban size={11} />}
            {STATUS_TEXT[t.status]}
          </span>
        </div>

        {isActive ? (
          <div className="tx-progress">
            <div className="bar">
              <div className="fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="tx-line2">
              <span>
                {formatSize(t.transferred)} / {formatSize(t.size)} · {pct}%
              </span>
              <span>
                {formatSpeed(t.speed)}
                {t.speed > 0 && remaining > 0 ? ` · 剩 ${formatEta(remaining, t.speed)}` : ''}
              </span>
            </div>
          </div>
        ) : (
          <div className="tx-line2 sub">
            <span>
              {t.dir === 'send' ? '发往' : '来自'} {t.peerName} · {formatSize(t.size)}
            </span>
            <span>
              {t.error ? <span className="tx-err">{t.error}</span> : formatTime(t.endedAt || t.startedAt)}
            </span>
          </div>
        )}
      </div>

      <div className="tx-actions">
        {isActive && (
          <button className="icon-btn" title="取消" onClick={() => onCancel(t.id)}>
            <X size={15} />
          </button>
        )}
        {t.status === 'done' && t.savePath && (
          <button className="icon-btn" title="在文件夹中显示" onClick={() => onOpen(t)}>
            <FolderOpen size={15} />
          </button>
        )}
      </div>
    </div>
  )
}

export function TransferList({ transfers, onCancel, onOpen, onClear }: Props) {
  const active = transfers.filter((t) => t.status === 'active' || t.status === 'pending')
  const history = transfers.filter((t) => t.status !== 'active' && t.status !== 'pending')

  return (
    <section className="transfers">
      <div className="panel-head">
        <h2>
          传输{active.length > 0 ? ` · ${active.length} 进行中` : ''}
        </h2>
        {history.length > 0 && (
          <button className="text-btn" onClick={onClear}>
            <Trash2 size={13} /> 清空记录
          </button>
        )}
      </div>

      <div className="tx-scroll">
        {transfers.length === 0 ? (
          <div className="tx-empty">还没有传输记录</div>
        ) : (
          <>
            {active.map((t) => (
              <TransferRow key={t.id} t={t} onCancel={onCancel} onOpen={onOpen} />
            ))}
            {active.length > 0 && history.length > 0 && <div className="tx-divider">历史</div>}
            {history.map((t) => (
              <TransferRow key={t.id} t={t} onCancel={onCancel} onOpen={onOpen} />
            ))}
          </>
        )}
      </div>
    </section>
  )
}
