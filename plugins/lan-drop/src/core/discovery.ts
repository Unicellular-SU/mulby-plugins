import * as dgram from 'node:dgram'

import {
  APP_TAG,
  BEACON_INTERVAL_MS,
  DEVICE_TTL_MS,
  DISCOVERY_PORT,
  PROTOCOL_VERSION,
  RECEIVE_PORT,
  log,
  logError,
} from './runtime'
import { broadcastTargets } from './netutil'
import { store } from './store'

type BeaconKind = 'announce' | 'query' | 'bye'

interface Beacon {
  t: string
  v: number
  k: BeaconKind
  id: string
  name: string
  os: string
  port: number
  ts: number
  /** x25519 身份公钥（SPKI DER, base64）；v2+ 携带，用于身份验证。 */
  pk?: string
}

/** 基于 UDP 广播的零配置局域网设备发现。 */
export class DiscoveryService {
  private socket: dgram.Socket | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private starting = false

  get online(): boolean {
    return store.discoveryOnline
  }

  start(): void {
    if (this.socket || this.starting) return
    if (!store.settings.discoveryEnabled) {
      log('discovery disabled by settings')
      return
    }
    this.starting = true

    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })

    socket.on('error', (err) => {
      logError('discovery socket error', err)
      store.discoveryOnline = false
      store.serverError = `发现服务异常: ${(err as Error).message}`
      this.cleanup()
    })

    socket.on('message', (buf, rinfo) => this.onMessage(buf, rinfo))

    socket.on('listening', () => {
      try {
        socket.setBroadcast(true)
      } catch (err) {
        logError('setBroadcast failed', err)
      }
      store.discoveryOnline = true
      this.starting = false
      log(`discovery listening on udp/${DISCOVERY_PORT}`)
      // 立即宣告 + 主动查询，加速对端出现
      this.send('announce')
      this.send('query')
    })

    try {
      socket.bind(DISCOVERY_PORT, '0.0.0.0')
    } catch (err) {
      logError('discovery bind failed', err)
      store.serverError = `发现端口绑定失败: ${(err as Error).message}`
      this.starting = false
    }

    this.socket = socket

    this.timer = setInterval(() => {
      this.send('announce')
      store.pruneDevices(DEVICE_TTL_MS)
    }, BEACON_INTERVAL_MS)
  }

  stop(): void {
    this.send('bye')
    this.cleanup()
  }

  /** 配置变更后重启（端口固定，仅处理启停 + 改名后立即广播）。 */
  refresh(): void {
    if (store.settings.discoveryEnabled) {
      if (!this.socket) this.start()
      else this.send('announce')
    } else {
      this.stop()
    }
  }

  private cleanup(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.socket) {
      try {
        this.socket.close()
      } catch {
        /* ignore */
      }
      this.socket = null
    }
    store.discoveryOnline = false
  }

  private buildBeacon(kind: BeaconKind): Beacon {
    return {
      t: APP_TAG,
      v: PROTOCOL_VERSION,
      k: kind,
      id: store.deviceId,
      name: store.settings.deviceName,
      os: process.platform,
      port: RECEIVE_PORT,
      ts: Date.now(),
      pk: store.publicKey,
    }
  }

  private send(kind: BeaconKind, target?: { address: string; port: number }): void {
    const socket = this.socket
    if (!socket) return
    const payload = Buffer.from(JSON.stringify(this.buildBeacon(kind)))
    if (target) {
      socket.send(payload, target.port, target.address, (err) => {
        if (err) logError('unicast send failed', err)
      })
      return
    }
    for (const addr of broadcastTargets()) {
      socket.send(payload, DISCOVERY_PORT, addr, (err) => {
        // 某些网卡可能无权广播，忽略单点失败
        if (err) logError('broadcast send failed', addr, err)
      })
    }
  }

  private onMessage(buf: Buffer, rinfo: dgram.RemoteInfo): void {
    let beacon: Beacon
    try {
      beacon = JSON.parse(buf.toString('utf8'))
    } catch {
      return
    }
    if (!beacon || beacon.t !== APP_TAG) return
    if (!beacon.id || beacon.id === store.deviceId) return

    if (beacon.k === 'bye') {
      // 对端离线（被动剔除也会清理，这里立即更新 lastSeen 让其尽快过期）
      const dev = store.getDevice(beacon.id)
      if (dev && !dev.manual) {
        store.upsertDevice({ ...dev, lastSeen: 0 })
      }
      return
    }

    store.upsertDevice({
      id: beacon.id,
      name: beacon.name || beacon.id.slice(0, 8),
      os: beacon.os || 'unknown',
      ip: rinfo.address,
      port: beacon.port || RECEIVE_PORT,
      pubKey: beacon.pk,
    })

    // 收到查询则单播回应一次，帮助对端尽快看到本机
    if (beacon.k === 'query') {
      this.send('announce', { address: rinfo.address, port: DISCOVERY_PORT })
    }
  }
}

export const discovery = new DiscoveryService()
