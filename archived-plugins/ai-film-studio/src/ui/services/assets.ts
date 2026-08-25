/**
 * 资产库：把生成/上传的媒体存到 Mulby 宿主的 storage.attachment（二进制附件，
 * 单文件 ≤50MB，落 userData/plugin-attachments，仅渲染进程，自动按插件隔离）。
 * 工程 JSON 只保存 assetId 引用，避免 base64 撑爆工程数据。
 * 对齐设计文档 §8.2（图存 attachment）与 mulby-ai-image 惯例。
 *
 * 对外仍以 base64 进出（saveAsset/loadAsset），base64 ↔ 二进制转换全部封装在本文件，
 * 上层（graphStore 等）无需感知存储后端变化。
 */
import { nanoid } from 'nanoid'

export interface AssetData {
  base64: string
  mime: string
}

const CHUNK = 0x8000

/** Uint8Array → base64（分块避免大图爆栈） */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

/** base64 → Uint8Array */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function toU8(data: Uint8Array | ArrayBuffer): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data)
}

// ===== M3：附件字节缓存 + blob: URL =====
// 用 blob: URL 直接从字节构造来替代多 MB 的 data: base64（消除主线程同步编码——打开工程最大单项成本，
// 且 state/DOM 只存 ~50 字节的 blob: 串而非整段 base64）。id→字节缓存 + in-flight 去重 + 懒建 blob +
// 引用计数式集中回收 + LRU 上界。blob 字节钉在 blob store 直到 revoke，缓存跨工程切换存活 →
// 工作集 = 已开工程的并集，故必须有 LRU 上界。
interface AssetEntry {
  bytes: Uint8Array
  mime: string
  blobUrl?: string
  lastAccess: number
}
const assetCache = new Map<string, AssetEntry>()
const inflight = new Map<string, Promise<AssetEntry | null>>()
let cacheBytes = 0
let accessTick = 0
const MAX_CACHED_ASSETS = 256
const MAX_CACHE_BYTES = 256 * 1024 * 1024 // 256MB 字节预算

/** data:/blob: 都是「会话内临时 URL」——永不持久化/去重/指纹化（单一谓词防不变量漂移） */
export function isEphemeralUrl(u?: string): boolean {
  return !!u && (u.startsWith('data:') || u.startsWith('blob:'))
}

function dropEntry(id: string): void {
  const e = assetCache.get(id)
  if (!e) return
  if (e.blobUrl) {
    try {
      URL.revokeObjectURL(e.blobUrl)
    } catch {
      // 忽略
    }
  }
  cacheBytes -= e.bytes.length
  assetCache.delete(id)
}

function evictIfNeeded(): void {
  while (assetCache.size > MAX_CACHED_ASSETS || cacheBytes > MAX_CACHE_BYTES) {
    let oldestId: string | null = null
    let oldest = Infinity
    for (const [id, e] of assetCache) {
      if (e.lastAccess < oldest) {
        oldest = e.lastAccess
        oldestId = id
      }
    }
    if (oldestId === null) break
    dropEntry(oldestId) // 驱逐仅意味下次 mount 重取（廉价、无 base64）
  }
}

function cacheEntry(id: string, bytes: Uint8Array, mime: string): AssetEntry {
  const e: AssetEntry = { bytes, mime, lastAccess: ++accessTick }
  assetCache.set(id, e)
  cacheBytes += bytes.length
  evictIfNeeded()
  return e
}

/** 取字节+mime（缓存 + in-flight 去重）。缺失/瞬时错误**不缓存**，允许后续重试 */
function fetchEntry(id: string): Promise<AssetEntry | null> {
  const cached = assetCache.get(id)
  if (cached) {
    cached.lastAccess = ++accessTick
    return Promise.resolve(cached)
  }
  const pending = inflight.get(id)
  if (pending) return pending
  const p = (async (): Promise<AssetEntry | null> => {
    try {
      const att = window.mulby?.storage?.attachment
      if (att) {
        const data = await att.get(id)
        if (data) {
          const bytes = toU8(data)
          const mime = (await att.getType(id)) || 'image/png'
          return cacheEntry(id, bytes, mime)
        }
      }
      // 兼容旧版（base64 存普通 KV）：迁移前已生成/导入的资产仍可读出
      const legacy = await window.mulby?.storage?.get(id)
      if (legacy && typeof legacy === 'object' && 'base64' in (legacy as Record<string, unknown>)) {
        const ld = legacy as AssetData
        const raw = ld.base64.startsWith('data:') ? fromDataUrl(ld.base64).base64 : ld.base64
        return cacheEntry(id, base64ToBytes(raw), ld.mime || 'image/png')
      }
      return null
    } catch {
      return null
    } finally {
      inflight.delete(id)
    }
  })()
  inflight.set(id, p)
  return p
}

/** 取（懒建）该资产的 blob: URL，供 <img>/<video> 直接用；缓存拥有其生命周期，调用方不可 revoke */
export async function loadAssetUrl(id: string): Promise<string> {
  const e = await fetchEntry(id)
  if (!e) return ''
  if (!e.blobUrl) e.blobUrl = URL.createObjectURL(new Blob([e.bytes as BlobPart], { type: e.mime }))
  e.lastAccess = ++accessTick
  return e.blobUrl
}

/** 释放单个资产（revoke blob + 从缓存丢弃）：deleteAsset / GC 孤儿用。UI 挂载期间绝不整体 clear */
export function releaseAsset(id: string): void {
  dropEntry(id)
}

/** 清空整个资产缓存（仅页面卸载/beforeunload 用，绝不在 UI 挂载期调用，否则会 blank 在屏媒体） */
export function clearAssetCache(): void {
  for (const id of [...assetCache.keys()]) dropEntry(id)
  cacheBytes = 0
}

/** 把已知字节灌入缓存（生成后调用）：随后 useMediaUrl(assetId) 即时出 blob:，无需再读附件 */
export function primeAsset(id: string, base64: string, mime: string): void {
  if (!base64 || assetCache.has(id)) return
  try {
    const raw = base64.startsWith('data:') ? fromDataUrl(base64).base64 : base64
    cacheEntry(id, base64ToBytes(raw), mime)
  } catch {
    // 忽略
  }
}

export async function saveAsset(base64: string, mime = 'image/png'): Promise<string> {
  const id = `a_${nanoid(10)}`
  let ok = true
  try {
    const att = window.mulby?.storage?.attachment
    if (att) {
      const raw = base64.startsWith('data:') ? fromDataUrl(base64).base64 : base64
      // 宿主类型声明为 boolean，运行时实为 {ok,error}；两种都判
      const res = (await att.put(id, base64ToBytes(raw), mime)) as unknown as boolean | { ok?: boolean }
      ok = res !== false && !(typeof res === 'object' && res?.ok === false)
    }
  } catch {
    ok = false
  }
  // 无论成败都灌缓存：生成后即时显示（失败则本会话可见、刷新后丢失，并告警）
  primeAsset(id, base64, mime)
  if (!ok) window.mulby?.storage && window.mulby?.notification?.show('素材保存失败：本次会话可见，刷新后可能丢失', 'warning')
  return id
}

/** 仍以 base64 进出（兼容既有调用者，如 downloadVideoToDisk）；底层走统一字节缓存 */
export async function loadAsset(id: string): Promise<AssetData | null> {
  const e = await fetchEntry(id)
  if (!e) return null
  return { base64: bytesToBase64(e.bytes), mime: e.mime }
}

export async function deleteAsset(id: string): Promise<void> {
  releaseAsset(id) // 先释放缓存/blob，避免悬挂引用
  try {
    await window.mulby?.storage?.attachment?.remove(id)
    await window.mulby?.storage?.remove(id) // 一并清掉可能存在的旧版 KV 残留
  } catch {
    // 忽略
  }
}

/** base64（无前缀）→ data URL */
export function toDataUrl(base64: string, mime = 'image/png'): string {
  if (!base64) return ''
  return base64.startsWith('data:') ? base64 : `data:${mime};base64,${base64}`
}

/** data URL / 纯 base64 → 纯 base64 + mime */
export function fromDataUrl(dataUrl: string): AssetData {
  const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/)
  if (m) return { mime: m[1], base64: m[2] }
  return { mime: 'image/png', base64: dataUrl }
}
