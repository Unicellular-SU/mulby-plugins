/// <reference path="./types/mulby.d.ts" />

import {
  PET_PERFORM_ACTION_TOOL_NAME,
  PET_PRESENTATION_TOOL_NAME,
  PET_MOVE_TOOL_NAME,
  PET_SHOW_EXPRESSION_TOOL_NAME,
  PET_UPDATE_MOOD_TOOL_NAME,
  normalizePresentationToolCall,
} from './ui/engine/presentation'
import { logPetPresentation } from './ui/engine/presentation-debug'

declare const mulby: any

type PluginContext = BackendPluginContext

const TAG = '[desktop-pet]'

interface CachedActiveWindow extends ActiveWindowInfo {
  changedAt: number
}

/** 用于在无订阅回调时仍能输出稳定的 changedAt（仅当 app/title/pid 组合变化时更新） */
let lastWindowSignature = ''
let lastWindowChangedAt = 0

function acknowledgePresentationTool(name: string, args: unknown) {
  const intent = normalizePresentationToolCall(name, args)
  logPetPresentation('tool-ack', { name, args, intent })
  if (!intent) {
    return {
      success: false,
      error: 'Invalid pet presentation tool arguments',
    }
  }

  return {
    success: true,
    applied: true,
    intent,
  }
}

function bumpChangedAt(row: CachedActiveWindow): CachedActiveWindow {
  const sig = `${row.app}\0${row.title}\0${row.pid ?? ''}\0${row.bundleId ?? ''}`
  const now = Date.now()
  if (sig !== lastWindowSignature) {
    lastWindowSignature = sig
    lastWindowChangedAt = now
  }
  return { ...row, changedAt: lastWindowChangedAt }
}

export function onLoad() {
  console.log(`${TAG} loaded`)
}

export function onUnload() {
  console.log(`${TAG} unloaded`)
}

export function onEnable() {
  console.log(`${TAG} enabled`)
}

export function onDisable() {
  console.log(`${TAG} disabled`)
}

export async function run(context: PluginContext) {
  console.log(`${TAG} feature=${context.featureCode ?? 'pet'}`)
}

export const rpc = {
  [PET_PRESENTATION_TOOL_NAME]: (args: unknown) => acknowledgePresentationTool(PET_PRESENTATION_TOOL_NAME, args),
  [PET_SHOW_EXPRESSION_TOOL_NAME]: (args: unknown) => acknowledgePresentationTool(PET_SHOW_EXPRESSION_TOOL_NAME, args),
  [PET_PERFORM_ACTION_TOOL_NAME]: (args: unknown) => acknowledgePresentationTool(PET_PERFORM_ACTION_TOOL_NAME, args),
  [PET_MOVE_TOOL_NAME]: (args: unknown) => acknowledgePresentationTool(PET_MOVE_TOOL_NAME, args),
  [PET_UPDATE_MOOD_TOOL_NAME]: (args: unknown) => acknowledgePresentationTool(PET_UPDATE_MOOD_TOOL_NAME, args),
  /**
   * 从主进程读取已缓存的前台窗口（可序列化）。
   * 不能用 onActiveWindowChange：Worker 经 IPC 调用时返回值含函数，会导致 postMessage 序列化失败。
   */
  getActiveWindow: async () => {
    try {
      if (typeof mulby?.system?.getCachedActiveWindow !== 'function') {
        logPetPresentation('main.active-window.unsupported', {})
        return null
      }
      const info = await mulby.system.getCachedActiveWindow()
      if (!info || typeof info !== 'object') return null
      const row: CachedActiveWindow = {
        app: typeof info.app === 'string' ? info.app : '',
        title: typeof info.title === 'string' ? info.title : '',
        pid: typeof info.pid === 'number' ? info.pid : undefined,
        bundleId: typeof info.bundleId === 'string' ? info.bundleId : undefined,
        changedAt: Date.now(),
      }
      return bumpChangedAt(row)
    } catch (err) {
      logPetPresentation('main.active-window.error', {
        message: (err as Error)?.message ?? String(err),
      })
      return null
    }
  },
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run }
export default plugin
