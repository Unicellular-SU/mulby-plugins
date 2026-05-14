export const MESSAGING_TESTER_PLUGIN_ID = '@mulby/messaging-tester'
export const SHOWCASE_PLUGIN_ID = '@mulby/showcase'

export type MessageDirection = 'received' | 'sent' | 'broadcast'
export type DirectionFilter = MessageDirection | 'all'

export interface PluginMessage {
  id: string
  from: string
  to?: string
  type: string
  payload: unknown
  timestamp: number
}

export interface MessageRecord extends PluginMessage {
  direction: MessageDirection
  local?: boolean
  note?: string
}

export interface MessageQuery {
  limit?: number
  direction?: DirectionFilter
  type?: string
}

export interface MessageReply {
  targetPluginId: string
  type: string
  payload: {
    requestId: string
    receivedAt: string
    pluginId: string
    text: string
  }
}

interface MessageLogOptions {
  limit?: number
  pluginId?: string
}

function clamp(value: unknown, fallback: number, min: number, max: number) {
  const numberValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numberValue)) return fallback
  return Math.max(min, Math.min(max, Math.round(numberValue)))
}

export function normalizeMessageType(type: string | undefined, fallback = 'tester-ping') {
  return type?.trim() || fallback
}

export function createMessageLog(options: MessageLogOptions = {}) {
  const maxEntries = clamp(options.limit, 50, 1, 200)
  const pluginId = options.pluginId || MESSAGING_TESTER_PLUGIN_ID
  const records: MessageRecord[] = []

  return {
    record(message: PluginMessage, direction: MessageDirection, note?: string) {
      const record: MessageRecord = {
        ...message,
        direction,
        local: direction !== 'received',
        note,
      }
      records.unshift(record)
      records.splice(maxEntries)
      return record
    },

    recordLocal(direction: MessageDirection, type: string, payload: unknown, targetPluginId?: string, note?: string) {
      return this.record({
        id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        from: pluginId,
        to: targetPluginId,
        type,
        payload,
        timestamp: Date.now(),
      }, direction, note)
    },

    getRecent(query: MessageQuery = {}) {
      const limit = clamp(query.limit, maxEntries, 1, maxEntries)
      const direction = query.direction || 'all'
      const type = query.type?.trim()

      return records
        .filter((message) => direction === 'all' || message.direction === direction)
        .filter((message) => !type || message.type.includes(type))
        .slice(0, limit)
    },

    clear() {
      records.splice(0)
      return { success: true }
    },
  }
}

export function getReplyForMessage(message: PluginMessage): MessageReply | null {
  if (message.type !== 'tester-ping') {
    return null
  }

  return {
    targetPluginId: message.from,
    type: 'tester-pong',
    payload: {
      requestId: message.id,
      receivedAt: new Date().toISOString(),
      pluginId: MESSAGING_TESTER_PLUGIN_ID,
      text: 'pong from Messaging Tester',
    },
  }
}
