import type { AppState, FileMeta, MobileGatewayInfo, RemoteDevice, Settings } from '../core/types'

const PLUGIN_ID = 'lan-drop'

/** 调用后端 rpc 方法并解包 host.call 的 { data } 包装。 */
async function call<T>(method: string, ...args: unknown[]): Promise<T> {
  const host = window.mulby?.host
  if (!host) throw new Error('宿主 Host API 不可用')
  const res = (await host.call(PLUGIN_ID, method, ...args)) as { data?: T }
  return res?.data as T
}

export interface SendResult {
  ok: boolean
  error?: string
  count?: number
  ids?: string[]
}

export interface ManualResult {
  ok: boolean
  error?: string
  device?: RemoteDevice
}

export const api = {
  getState: () => call<AppState>('getState'),
  waitState: (sinceRev: number) =>
    call<{ rev: number; state: AppState }>('waitState', { sinceRev }),
  resolveFiles: (paths: string[]) => call<{ files: FileMeta[] }>('resolveFiles', { paths }),
  pickFiles: () => call<{ files: FileMeta[] }>('pickFiles'),
  sendFiles: (targetId: string, items: Array<{ path: string; relPath?: string }>) =>
    call<SendResult>('sendFiles', { targetId, items }),
  sendText: (targetId: string, text: string) =>
    call<{ ok: boolean; error?: string }>('sendText', { targetId, text }),
  clearMessages: () => call<{ ok: boolean }>('clearMessages'),
  addManualDevice: (ip: string, port?: number) =>
    call<ManualResult>('addManualDevice', { ip, port }),
  setSettings: (patch: Partial<Settings>) =>
    call<{ ok: boolean; settings: Settings }>('setSettings', patch),
  setTrusted: (deviceId: string, trusted: boolean) =>
    call<{ ok: boolean; settings: Settings }>('setTrusted', { deviceId, trusted }),
  cancelTransfer: (id: string) => call<{ ok: boolean }>('cancelTransfer', { id }),
  clearHistory: () => call<{ ok: boolean }>('clearHistory'),
  chooseDownloadDir: () => call<{ ok: boolean; settings?: Settings }>('chooseDownloadDir'),
  openDownloadDir: () => call<{ ok: boolean }>('openDownloadDir'),
  openPath: (p: string) => call<{ ok: boolean }>('openPath', { path: p }),
  restartServers: () => call<{ ok: boolean }>('restartServers'),
  rescan: () => call<{ ok: boolean }>('rescan'),
  getMobileGateway: () => call<MobileGatewayInfo>('getMobileGateway'),
  setMobileGateway: (enabled: boolean) =>
    call<{ ok: boolean; mobile: MobileGatewayInfo }>('setMobileGateway', { enabled }),
  regenMobilePairing: () =>
    call<{ ok: boolean; mobile: MobileGatewayInfo }>('regenMobilePairing'),
}
