import {
  MESSAGING_TESTER_PLUGIN_ID,
  SHOWCASE_PLUGIN_ID,
  createMessageLog,
  getReplyForMessage,
  normalizeMessageType,
  type MessageQuery,
  type PluginMessage,
} from './messagingCore'

interface BackendMessagingApi {
  send(targetPluginId: string, type: string, payload: unknown): Promise<void>
  broadcast(type: string, payload: unknown): Promise<void>
  on(handler: (message: PluginMessage) => void | Promise<void>): void
  off(handler?: (message: PluginMessage) => void | Promise<void>): void
}

interface PluginContext {
  api: {
    messaging: BackendMessagingApi
    notification?: {
      show(message: string, type?: 'info' | 'success' | 'warning' | 'error'): Promise<void> | void
    }
  }
  featureCode?: string
}

interface SendToShowcaseInput {
  type?: string
  payload?: unknown
}

interface BroadcastTesterInput {
  type?: string
  payload?: unknown
}

declare const mulby: {
  messaging: BackendMessagingApi
  notification?: {
    show(message: string, type?: 'info' | 'success' | 'warning' | 'error'): Promise<void> | void
  }
}

const messageLog = createMessageLog({ limit: 50, pluginId: MESSAGING_TESTER_PLUGIN_ID })
let messagingHandler: ((message: PluginMessage) => void | Promise<void>) | null = null

function getMessagingApi(context?: PluginContext) {
  return context?.api.messaging ?? mulby.messaging
}

function getNotificationApi(context?: PluginContext) {
  return context?.api.notification ?? mulby.notification
}

function defaultPingPayload() {
  return {
    text: 'ping from Messaging Tester',
    source: MESSAGING_TESTER_PLUGIN_ID,
    sentAt: new Date().toISOString(),
  }
}

function registerMessaging(context: PluginContext) {
  if (messagingHandler) {
    context.api.messaging.off(messagingHandler)
  }

  messagingHandler = async (message: PluginMessage) => {
    messageLog.record(message, 'received', message.to ? '点对点消息' : '广播消息')

    const reply = getReplyForMessage(message)
    if (reply) {
      await context.api.messaging.send(reply.targetPluginId, reply.type, reply.payload)
      messageLog.recordLocal('sent', reply.type, reply.payload, reply.targetPluginId, '自动回复 tester-ping')
    }
  }

  context.api.messaging.on(messagingHandler)
}

export function onLoad(context?: PluginContext) {
  if (context) {
    registerMessaging(context)
  }
}

export function onUnload(context?: PluginContext) {
  if (messagingHandler && context?.api.messaging) {
    context.api.messaging.off(messagingHandler)
    messagingHandler = null
  }
}

export function onEnable() {
}

export function onDisable() {
}

export function onBackground(context?: PluginContext) {
  if (context) {
    registerMessaging(context)
  }
}

export function onForeground() {
}

export async function run(context: PluginContext) {
  if (context.featureCode === 'main') {
    await getNotificationApi(context)?.show('插件通信测试器已就绪')
  }
}

export const rpc = {
  async sendToShowcase(input?: SendToShowcaseInput) {
    const type = normalizeMessageType(input?.type, 'showcase-ping')
    const payload = input?.payload ?? defaultPingPayload()

    await getMessagingApi().send(SHOWCASE_PLUGIN_ID, type, payload)

    return messageLog.recordLocal(
      'sent',
      type,
      payload,
      SHOWCASE_PLUGIN_ID,
      type === 'showcase-ping'
        ? 'Showcase 收到后应回复 showcase-pong'
        : '已发送到 Showcase'
    )
  },

  async broadcastTesterMessage(input?: BroadcastTesterInput) {
    const type = normalizeMessageType(input?.type, 'tester-broadcast')
    const payload = input?.payload ?? {
      text: 'broadcast from Messaging Tester',
      source: MESSAGING_TESTER_PLUGIN_ID,
      sentAt: new Date().toISOString(),
    }

    await getMessagingApi().broadcast(type, payload)

    return messageLog.recordLocal(
      'broadcast',
      type,
      payload,
      undefined,
      '广播只发送给其他已订阅插件，不会回到发送者自己。'
    )
  },

  getRecentMessages(query?: MessageQuery) {
    return messageLog.getRecent(query)
  },

  clearMessages() {
    return messageLog.clear()
  },
}

export default { onLoad, onUnload, onEnable, onDisable, onBackground, onForeground, run, rpc }
