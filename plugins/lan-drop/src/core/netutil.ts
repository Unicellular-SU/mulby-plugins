import * as os from 'node:os'

export interface Iface {
  address: string
  netmask: string
  broadcast: string
}

/** 收集所有非内部 IPv4 网卡（含其定向广播地址）。 */
export function listIPv4Interfaces(): Iface[] {
  const result: Iface[] = []
  const ifaces = os.networkInterfaces()
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] ?? []) {
      // Node 18+ family 可能是 'IPv4' 或数字 4
      const isV4 = info.family === 'IPv4' || (info.family as unknown as number) === 4
      if (!isV4 || info.internal) continue
      const broadcast = computeBroadcast(info.address, info.netmask)
      result.push({ address: info.address, netmask: info.netmask, broadcast })
    }
  }
  return result
}

/** 本机可用的局域网 IPv4 地址列表。 */
export function localIPv4Addresses(): string[] {
  return listIPv4Interfaces().map((i) => i.address)
}

/** 由 IP + 子网掩码计算定向广播地址（如 192.168.1.255）。 */
export function computeBroadcast(ip: string, netmask: string): string {
  const ipParts = ip.split('.').map((n) => parseInt(n, 10))
  const maskParts = netmask.split('.').map((n) => parseInt(n, 10))
  if (ipParts.length !== 4 || maskParts.length !== 4) return '255.255.255.255'
  const out = ipParts.map((part, i) => {
    const mask = maskParts[i]
    if (Number.isNaN(part) || Number.isNaN(mask)) return 255
    return (part & mask) | (~mask & 0xff)
  })
  return out.join('.')
}

/** 去重后的广播目标集合（含全局广播兜底）。 */
export function broadcastTargets(): string[] {
  const set = new Set<string>()
  for (const i of listIPv4Interfaces()) {
    if (i.broadcast) set.add(i.broadcast)
  }
  set.add('255.255.255.255')
  return [...set]
}

/** 简单 IPv4 字面量校验。 */
export function isIPv4(value: string): boolean {
  const parts = value.split('.')
  if (parts.length !== 4) return false
  return parts.every((p) => {
    const n = Number(p)
    return Number.isInteger(n) && n >= 0 && n <= 255 && String(n) === p
  })
}

/**
 * 是否为局域网 / 本机可信来源地址：私有网段 + 回环 + 链路本地 + CGNAT。
 * 用于收敛接收服务暴露面（本插件设计为同一局域网直连，拒绝公网来源）。
 */
export function isLanAddress(ip: string): boolean {
  if (!ip) return false
  if (ip === '::1') return true // IPv6 回环
  const parts = ip.split('.')
  if (parts.length !== 4) return false
  const o = parts.map((p) => Number(p))
  if (o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [a, b] = o
  if (a === 10) return true // 10.0.0.0/8
  if (a === 127) return true // 127.0.0.0/8 回环
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 169 && b === 254) return true // 169.254.0.0/16 链路本地
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGNAT
  return false
}
