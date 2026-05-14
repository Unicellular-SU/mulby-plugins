import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BadgeInfo,
  Inbox,
  Megaphone,
  MessageSquareReply,
  RefreshCw,
  Send,
  Trash2,
} from 'lucide-react'
import {
  MESSAGING_TESTER_PLUGIN_ID,
  SHOWCASE_PLUGIN_ID,
  type DirectionFilter,
  type MessageRecord,
} from '../messagingCore'

type LoadingAction = 'send' | 'broadcast' | 'refresh' | 'clear' | null
type OperationStatus = 'success' | 'error' | 'info' | 'warning'

interface HostCallResponse<T> {
  success?: boolean
  data?: T
  error?: string
}

interface OperationLogItem {
  action: string
  status: OperationStatus
  message: string
  timestamp: number
}

const DEFAULT_PAYLOAD = `{
  "text": "hello from Messaging Tester",
  "source": "@mulby/messaging-tester"
}`

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function parsePayload(payloadText: string) {
  const trimmed = payloadText.trim()
  return trimmed ? JSON.parse(trimmed) as unknown : {}
}

async function hostCall<T>(method: string, ...args: unknown[]) {
  if (!window.mulby?.host?.call) {
    throw new Error('Mulby host.call API 不可用')
  }
  const result = await window.mulby?.host?.call(MESSAGING_TESTER_PLUGIN_ID, method, ...args) as HostCallResponse<T> | T
  if (result && typeof result === 'object' && 'success' in result && result.success === false) {
    throw new Error((result as HostCallResponse<T>).error || `RPC 调用失败: ${method}`)
  }
  if (result && typeof result === 'object' && 'data' in result) {
    return (result as HostCallResponse<T>).data as T
  }
  return result as T
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString()
}

function directionText(direction: MessageRecord['direction']) {
  if (direction === 'received') return '收到'
  if (direction === 'broadcast') return '广播'
  return '发送'
}

function directionClass(direction: MessageRecord['direction']) {
  if (direction === 'received') return 'success'
  if (direction === 'broadcast') return 'warning'
  return 'info'
}

function previewPayload(payload: unknown) {
  try {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)
    return text.length > 280 ? `${text.slice(0, 280)}...` : text
  } catch {
    return String(payload)
  }
}

export default function App() {
  const [messageType, setMessageType] = useState('showcase-ping')
  const [broadcastType, setBroadcastType] = useState('tester-broadcast')
  const [payloadText, setPayloadText] = useState(DEFAULT_PAYLOAD)
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('all')
  const [typeFilter, setTypeFilter] = useState('')
  const [messages, setMessages] = useState<MessageRecord[]>([])
  const [selectedMessage, setSelectedMessage] = useState<MessageRecord | null>(null)
  const [operationLog, setOperationLog] = useState<OperationLogItem[]>([])
  const [jsonError, setJsonError] = useState('')
  const [loadingAction, setLoadingAction] = useState<LoadingAction>(null)

  const pushOperation = useCallback((item: Omit<OperationLogItem, 'timestamp'>) => {
    setOperationLog((current) => [{ ...item, timestamp: Date.now() }, ...current].slice(0, 10))
  }, [])

  const refreshMessages = useCallback(async (silent = false) => {
    if (!silent) setLoadingAction('refresh')
    try {
      const nextMessages = await hostCall<MessageRecord[]>('getRecentMessages', {
        limit: 50,
        direction: directionFilter,
        type: typeFilter.trim() || undefined,
      })
      setMessages(nextMessages)
      setSelectedMessage((current) => {
        if (!current) return nextMessages[0] || null
        return nextMessages.find((message) => message.id === current.id) || nextMessages[0] || null
      })
      if (!silent) {
        pushOperation({
          action: 'getRecentMessages',
          status: 'success',
          message: `读取到 ${nextMessages.length} 条消息`,
        })
      }
    } catch (error) {
      const message = getErrorMessage(error)
      pushOperation({ action: 'getRecentMessages', status: 'error', message })
      if (!silent) void window.mulby?.notification?.show(`读取消息失败: ${message}`, 'error')
    } finally {
      if (!silent) setLoadingAction(null)
    }
  }, [directionFilter, pushOperation, typeFilter])

  useEffect(() => {
    void refreshMessages(true)
    const timer = window.setInterval(() => void refreshMessages(true), 1500)
    return () => window.clearInterval(timer)
  }, [refreshMessages])

  const buildPayload = useCallback(() => {
    try {
      const payload = parsePayload(payloadText)
      setJsonError('')
      return payload
    } catch (error) {
      const message = getErrorMessage(error)
      setJsonError(message)
      throw new Error(`JSON 解析失败: ${message}`)
    }
  }, [payloadText])

  const sendToShowcase = useCallback(async (typeOverride?: string) => {
    const nextType = typeOverride || messageType
    setLoadingAction('send')
    try {
      const record = await hostCall<MessageRecord>('sendToShowcase', {
        type: nextType,
        payload: buildPayload(),
      })
      pushOperation({
        action: 'sendToShowcase',
        status: 'success',
        message: `已发送 ${record.type} 到 @mulby/showcase`,
      })
      void window.mulby?.notification?.show('已发送到 Showcase', 'success')
      await refreshMessages(true)
    } catch (error) {
      const message = getErrorMessage(error)
      pushOperation({ action: 'sendToShowcase', status: 'error', message })
      void window.mulby?.notification?.show(message, 'error')
    } finally {
      setLoadingAction(null)
    }
  }, [buildPayload, messageType, pushOperation, refreshMessages])

  const sendShowcasePing = useCallback(() => {
    setMessageType('showcase-ping')
    return sendToShowcase('showcase-ping')
  }, [sendToShowcase])

  const broadcastTesterMessage = useCallback(async () => {
    setLoadingAction('broadcast')
    try {
      const record = await hostCall<MessageRecord>('broadcastTesterMessage', {
        type: broadcastType,
        payload: buildPayload(),
      })
      pushOperation({
        action: 'broadcastTesterMessage',
        status: 'success',
        message: `已广播 ${record.type}`,
      })
      void window.mulby?.notification?.show('广播消息已发送', 'success')
      await refreshMessages(true)
    } catch (error) {
      const message = getErrorMessage(error)
      pushOperation({ action: 'broadcastTesterMessage', status: 'error', message })
      void window.mulby?.notification?.show(message, 'error')
    } finally {
      setLoadingAction(null)
    }
  }, [broadcastType, buildPayload, pushOperation, refreshMessages])

  const clearMessages = useCallback(async () => {
    setLoadingAction('clear')
    try {
      await hostCall<{ success: boolean }>('clearMessages')
      setMessages([])
      setSelectedMessage(null)
      pushOperation({ action: 'clearMessages', status: 'success', message: '已清空本插件消息日志' })
    } catch (error) {
      const message = getErrorMessage(error)
      pushOperation({ action: 'clearMessages', status: 'error', message })
    } finally {
      setLoadingAction(null)
    }
  }, [pushOperation])

  const stats = useMemo(() => ({
    total: messages.length,
    received: messages.filter((message) => message.direction === 'received').length,
    sent: messages.filter((message) => message.direction === 'sent').length,
    broadcast: messages.filter((message) => message.direction === 'broadcast').length,
  }), [messages])

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Mulby plugin messaging</p>
          <h1>Messaging Tester</h1>
          <p className="subtitle">
            当前插件 <code>{MESSAGING_TESTER_PLUGIN_ID}</code>，默认对接 <code>{SHOWCASE_PLUGIN_ID}</code> 的插件通信模块。
          </p>
        </div>
        <div className="toolbar">
          <button type="button" className="button secondary" onClick={() => void refreshMessages()} disabled={loadingAction === 'refresh'}>
            <RefreshCw size={16} aria-hidden="true" />
            刷新
          </button>
          <button type="button" className="button secondary" onClick={() => void clearMessages()} disabled={loadingAction === 'clear'}>
            <Trash2 size={16} aria-hidden="true" />
            清空
          </button>
        </div>
      </header>

      <section className="stats-grid" aria-label="消息统计">
        <div className="stat"><strong>{stats.total}</strong><span>缓存消息</span></div>
        <div className="stat"><strong>{stats.received}</strong><span>收到</span></div>
        <div className="stat"><strong>{stats.sent}</strong><span>发送</span></div>
        <div className="stat"><strong>{stats.broadcast}</strong><span>广播摘要</span></div>
      </section>

      <section className="main-grid">
        <div className="panel">
          <div className="panel-header">
            <Send size={18} aria-hidden="true" />
            <h2>点对点测试</h2>
          </div>
          <div className="form-grid">
            <label>
              <span>目标插件</span>
              <input value={SHOWCASE_PLUGIN_ID} readOnly />
            </label>
            <label>
              <span>消息类型</span>
              <input value={messageType} onChange={(event) => setMessageType(event.target.value)} />
            </label>
          </div>
          <div className="action-row">
            <button type="button" className="button primary" onClick={() => void sendToShowcase()} disabled={loadingAction === 'send'}>
              <Send size={16} aria-hidden="true" />
              发送到 Showcase
            </button>
            <button type="button" className="button secondary" onClick={() => void sendShowcasePing()} disabled={loadingAction === 'send'}>
              <MessageSquareReply size={16} aria-hidden="true" />
              showcase-ping
            </button>
          </div>
          <p className="hint">发送 <code>showcase-ping</code> 后，Showcase 后台应回复 <code>showcase-pong</code>，本页日志会自动刷新。</p>
        </div>

        <div className="panel">
          <div className="panel-header">
            <Megaphone size={18} aria-hidden="true" />
            <h2>广播测试</h2>
          </div>
          <label>
            <span>广播类型</span>
            <input value={broadcastType} onChange={(event) => setBroadcastType(event.target.value)} />
          </label>
          <div className="action-row">
            <button type="button" className="button primary" onClick={() => void broadcastTesterMessage()} disabled={loadingAction === 'broadcast'}>
              <Megaphone size={16} aria-hidden="true" />
              广播消息
            </button>
          </div>
          <p className="hint">广播只会发给其他已订阅插件。发送者本地记录一条广播摘要用于确认动作。</p>
        </div>
      </section>

      <section className="panel payload-panel">
        <div className="panel-header">
          <BadgeInfo size={18} aria-hidden="true" />
          <h2>Payload</h2>
        </div>
        <textarea
          value={payloadText}
          onChange={(event) => {
            setPayloadText(event.target.value)
            setJsonError('')
          }}
          spellCheck={false}
        />
        {jsonError && <p className="error-text">{jsonError}</p>}
      </section>

      <section className="log-grid">
        <div className="panel">
          <div className="panel-header">
            <Inbox size={18} aria-hidden="true" />
            <h2>消息日志</h2>
          </div>
          <div className="filters">
            <label>
              <span>方向</span>
              <select value={directionFilter} onChange={(event) => setDirectionFilter(event.target.value as DirectionFilter)}>
                <option value="all">全部</option>
                <option value="received">收到</option>
                <option value="sent">发送</option>
                <option value="broadcast">广播</option>
              </select>
            </label>
            <label>
              <span>类型包含</span>
              <input value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} placeholder="showcase" />
            </label>
          </div>
          <div className="message-list">
            {messages.length > 0 ? messages.map((message) => (
              <button
                type="button"
                key={message.id}
                className={`message-row ${selectedMessage?.id === message.id ? 'selected' : ''}`}
                onClick={() => setSelectedMessage(message)}
              >
                <span className={`badge ${directionClass(message.direction)}`}>{directionText(message.direction)}</span>
                <span className="message-main">
                  <strong>{message.type}</strong>
                  <small>{message.from} {'->'} {message.to || 'broadcast'} · {formatTime(message.timestamp)}</small>
                </span>
              </button>
            )) : (
              <div className="empty-state">暂无消息。先发送 showcase-ping，或从 Showcase 通信页发 tester-ping 到本插件。</div>
            )}
          </div>
        </div>

        <div className="panel detail-panel">
          <div className="panel-header">
            <BadgeInfo size={18} aria-hidden="true" />
            <h2>选中消息</h2>
          </div>
          {selectedMessage ? (
            <div className="detail-content">
              <dl>
                <dt>ID</dt><dd>{selectedMessage.id}</dd>
                <dt>类型</dt><dd>{selectedMessage.type}</dd>
                <dt>From</dt><dd>{selectedMessage.from}</dd>
                <dt>To</dt><dd>{selectedMessage.to || 'broadcast'}</dd>
                <dt>时间</dt><dd>{new Date(selectedMessage.timestamp).toLocaleString()}</dd>
                <dt>备注</dt><dd>{selectedMessage.note || 'N/A'}</dd>
              </dl>
              <pre>{previewPayload(selectedMessage.payload)}</pre>
            </div>
          ) : (
            <div className="empty-state">请选择一条消息查看 payload。</div>
          )}
          <div className="operation-log">
            <h3>操作记录</h3>
            {operationLog.map((item) => (
              <div className="operation-row" key={`${item.timestamp}-${item.action}`}>
                <span className={`badge ${item.status}`}>{item.status}</span>
                <span>{item.action}</span>
                <small>{item.message}</small>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
