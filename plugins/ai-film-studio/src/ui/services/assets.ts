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

export async function saveAsset(base64: string, mime = 'image/png'): Promise<string> {
  const id = `a_${nanoid(10)}`
  try {
    const att = window.mulby?.storage?.attachment
    if (att) await att.put(id, base64ToBytes(base64), mime)
  } catch {
    // 存储失败时仍返回 id（内存中的 url 仍可用，仅刷新后丢失）
  }
  return id
}

export async function loadAsset(id: string): Promise<AssetData | null> {
  try {
    const att = window.mulby?.storage?.attachment
    if (att) {
      const data = await att.get(id)
      if (data) {
        const mime = (await att.getType(id)) || 'image/png'
        return { base64: bytesToBase64(toU8(data)), mime }
      }
    }
    // 兼容旧版（base64 存普通 KV）：迁移前已生成/导入的资产仍可读出
    const legacy = await window.mulby?.storage?.get(id)
    if (legacy && typeof legacy === 'object' && 'base64' in (legacy as Record<string, unknown>)) {
      return legacy as AssetData
    }
    return null
  } catch {
    return null
  }
}

export async function deleteAsset(id: string): Promise<void> {
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
