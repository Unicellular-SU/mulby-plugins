import { Copy, Lock, MessageSquareText, ShieldCheck, Smartphone, Trash2 } from 'lucide-react'
import type { Message } from '../../core/types'

interface Props {
  messages: Message[]
  onCopy: (text: string) => void
  onClear: () => void
}

/** 文本消息列表（收发通用）：内存态，支持一键复制。 */
export function MessageList({ messages, onCopy, onClear }: Props) {
  return (
    <section className="messages">
      <div className="messages-head">
        <span className="messages-title">
          <MessageSquareText size={14} /> 文本消息{messages.length > 0 ? ` · ${messages.length}` : ''}
        </span>
        {messages.length > 0 && (
          <button className="text-btn" onClick={onClear}>
            <Trash2 size={13} /> 清空
          </button>
        )}
      </div>

      {messages.length === 0 ? (
        <div className="messages-empty">暂无文本消息 · 选中设备后可在上方发送文字</div>
      ) : (
        <div className="messages-list">
          {messages.map((m) => (
            <div className={`msg-item ${m.dir}`} key={m.id}>
              <div className="msg-top">
                <span className="msg-peer">
                  {m.dir === 'send' ? `→ ${m.peerName}` : m.peerName}
                </span>
                <span className="msg-badges">
                  {m.via === 'web' && <Smartphone size={12} aria-label="手机" />}
                  {m.encrypted && <Lock size={12} aria-label="已加密" />}
                  {m.verified && <ShieldCheck size={12} aria-label="身份已验证" />}
                </span>
              </div>
              <div className="msg-body">{m.text}</div>
              <div className="msg-foot">
                <span className="msg-time">
                  {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <button className="text-btn" onClick={() => onCopy(m.text)}>
                  <Copy size={12} /> 复制
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
