/// <reference path="./types/mulby.d.ts" />
import * as fs from 'node:fs'
import * as path from 'node:path'

import { host, log, logError } from './core/runtime'
import { store } from './core/store'
import { discovery } from './core/discovery'
import { receiveServer } from './core/receive-server'
import { sender, probeDevice } from './core/sender'
import { isIPv4 } from './core/netutil'
import { RECEIVE_PORT } from './core/runtime'
import type { FileMeta, Settings } from './core/types'

// 运行时由 Mulby 宿主注入的全局 API 代理
declare const mulby: any
void mulby

let startPromise: Promise<void> | null = null

/** 幂等启动：初始化状态 + 接收服务 + 设备发现。 */
function ensureStarted(): Promise<void> {
  if (!startPromise) {
    startPromise = (async () => {
      await store.init()
      receiveServer.start()
      discovery.start()
      log('lan-drop services started')
    })().catch((err) => {
      logError('startup failed', err)
      startPromise = null
      throw err
    })
  }
  return startPromise
}

// ── 生命周期 ─────────────────────────────────────────────────
export function onLoad(): void {
  void ensureStarted()
}

export function onBackground(): void {
  void ensureStarted()
}

export function onEnable(): void {
  void ensureStarted()
}

export function onDisable(): void {
  shutdown()
}

export function onUnload(): void {
  shutdown()
}

export async function run(_context: unknown): Promise<void> {
  // 通过 keyword / files 触发：UI 会随之打开，附件经 onPluginInit 流入。
  await ensureStarted()
}

function shutdown(): void {
  try {
    discovery.stop()
  } catch {
    /* ignore */
  }
  try {
    receiveServer.stop()
  } catch {
    /* ignore */
  }
  startPromise = null
}

// ── 文件解析辅助 ─────────────────────────────────────────────
const MAX_EXPANDED_FILES = 2000

function statMeta(filePath: string): FileMeta | null {
  try {
    const st = fs.statSync(filePath)
    if (!st.isFile()) return null
    return { path: filePath, name: path.basename(filePath), size: st.size }
  } catch {
    return null
  }
}

/** 展开路径：文件直接收录，目录递归收集（扁平化，按 basename）。 */
function expandPaths(paths: string[]): FileMeta[] {
  const out: FileMeta[] = []
  const visit = (p: string) => {
    if (out.length >= MAX_EXPANDED_FILES) return
    let st: fs.Stats
    try {
      st = fs.statSync(p)
    } catch {
      return
    }
    if (st.isFile()) {
      out.push({ path: p, name: path.basename(p), size: st.size })
    } else if (st.isDirectory()) {
      let entries: string[] = []
      try {
        entries = fs.readdirSync(p)
      } catch {
        return
      }
      for (const name of entries) {
        if (name.startsWith('.')) continue
        visit(path.join(p, name))
        if (out.length >= MAX_EXPANDED_FILES) break
      }
    }
  }
  for (const p of paths) visit(p)
  return out
}

function normalizePaths(input: unknown): string[] {
  if (typeof input === 'string') return [input]
  if (Array.isArray(input)) return input.filter((x): x is string => typeof x === 'string')
  return []
}

// ── UI 可调用的后端方法（rpc：参数 1:1 映射） ─────────────────
export const rpc = {
  async getState() {
    await ensureStarted()
    return store.getState()
  },

  /** 长轮询订阅状态变更（事件驱动 UI，替代忙轮询）。rev 已前进则立即返回。 */
  async waitState(input: { sinceRev?: number }) {
    await ensureStarted()
    return store.waitForChange(input?.sinceRev ?? -1, 15000)
  },

  /** 解析拖入/选择的路径为文件元数据（用于发送前预览）。 */
  async resolveFiles(input: { paths: string[] } | string[]) {
    await ensureStarted()
    const paths = Array.isArray(input) ? normalizePaths(input) : normalizePaths(input?.paths)
    return { files: expandPaths(paths) }
  },

  /** 通过系统文件选择器挑选文件。 */
  async pickFiles() {
    await ensureStarted()
    try {
      const selected = (await host()?.dialog?.showOpenDialog({
        title: '选择要发送的文件',
        properties: ['openFile', 'multiSelections'],
      })) as string[] | undefined
      const paths = normalizePaths(selected)
      return { files: paths.map(statMeta).filter(Boolean) as FileMeta[] }
    } catch (err) {
      logError('pickFiles failed', err)
      return { files: [] as FileMeta[] }
    }
  },

  /** 发送文件到指定设备。 */
  async sendFiles(input: { targetId: string; paths: string[] }) {
    await ensureStarted()
    const targetId = input?.targetId
    if (!targetId || !store.getDevice(targetId)) {
      return { ok: false, error: '目标设备不存在', ids: [] as string[] }
    }
    const files = expandPaths(normalizePaths(input?.paths))
    if (files.length === 0) return { ok: false, error: '没有可发送的文件', ids: [] as string[] }
    const ids = sender.enqueue(targetId, files)
    return { ok: true, count: files.length, ids }
  },

  /** 手动输入 IP 直连添加设备（AP 隔离 / 跨网段兜底）。 */
  async addManualDevice(input: { ip: string; port?: number }) {
    await ensureStarted()
    const ip = (input?.ip || '').trim()
    if (!isIPv4(ip)) return { ok: false, error: 'IP 地址格式不正确' }
    const port = input?.port && input.port > 0 ? input.port : RECEIVE_PORT
    const info = await probeDevice(ip, port)
    if (!info) return { ok: false, error: '未发现闪传设备（请确认对端已开启并在同一网络）' }
    store.upsertDevice({
      id: info.deviceId,
      name: info.deviceName,
      os: info.os,
      ip,
      port: info.port,
      manual: true,
      pubKey: info.publicKey,
    })
    return { ok: true, device: store.getDevice(info.deviceId) }
  },

  async setSettings(patch: Partial<Settings>) {
    await ensureStarted()
    const next = await store.setSettings(patch || {})
    if (patch && 'discoveryEnabled' in patch) discovery.refresh()
    if (patch && 'deviceName' in patch) discovery.refresh()
    return { ok: true, settings: next }
  },

  async setTrusted(input: { deviceId: string; trusted: boolean }) {
    await ensureStarted()
    if (!input?.deviceId) return { ok: false }
    const settings = await store.setTrusted(input.deviceId, !!input.trusted)
    return { ok: true, settings }
  },

  async cancelTransfer(input: { id: string }) {
    await ensureStarted()
    if (input?.id) sender.cancel(input.id)
    return { ok: true }
  },

  async clearHistory() {
    await ensureStarted()
    store.clearHistory()
    return { ok: true }
  },

  async chooseDownloadDir() {
    await ensureStarted()
    try {
      const selected = (await host()?.dialog?.showOpenDialog({
        title: '选择文件保存目录',
        properties: ['openDirectory', 'createDirectory'],
      })) as string[] | undefined
      const dir = normalizePaths(selected)[0]
      if (!dir) return { ok: false }
      const settings = await store.setSettings({ downloadDir: dir })
      return { ok: true, settings }
    } catch (err) {
      logError('chooseDownloadDir failed', err)
      return { ok: false }
    }
  },

  async openDownloadDir() {
    await ensureStarted()
    try {
      await host()?.shell?.openPath(store.settings.downloadDir)
      return { ok: true }
    } catch {
      return { ok: false }
    }
  },

  async openPath(input: { path: string }) {
    await ensureStarted()
    try {
      if (input?.path) await host()?.shell?.showItemInFolder(input.path)
      return { ok: true }
    } catch {
      return { ok: false }
    }
  },

  async restartServers() {
    await ensureStarted()
    discovery.stop()
    receiveServer.stop()
    store.serverError = undefined
    receiveServer.start()
    discovery.start()
    return { ok: true }
  },
}

export default { onLoad, onBackground, onEnable, onDisable, onUnload, run, rpc }
