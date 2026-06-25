/// <reference path="./types/mulby.d.ts" />

import path from 'node:path'
import { randomBytes } from 'node:crypto'
import os from 'node:os'
import {
  runCompressPipeline,
  commitCompressStaging,
  discardCompressStaging,
} from './pipeline/compress'
import type {
  CompressPayload,
  BatchCompressResult,
  CommitPayload,
  CommitResult,
  CompressSettings,
} from './pipeline/types'

declare const mulby: any
type PluginContext = BackendPluginContext

const PLUGIN_ID = 'batch-image-compress'
const SETTINGS_KEY = 'compress-settings'

let pendingPaths: string[] = []

export function onLoad() {
  console.log(`[${PLUGIN_ID}] loaded`)
}
export function onUnload() {
  console.log(`[${PLUGIN_ID}] unloaded`)
}
export function onEnable() {
  console.log(`[${PLUGIN_ID}] enabled`)
}
export function onDisable() {
  console.log(`[${PLUGIN_ID}] disabled`)
}

export async function run(context: PluginContext) {
  const rawAtt = context.attachments ?? []
  pendingPaths = rawAtt
    .map((a: any) => a.path)
    .filter((p: unknown): p is string => typeof p === 'string' && p.length > 0)
  console.log(`[${PLUGIN_ID}] run feature=${context.featureCode} attachments=${pendingPaths.length}`)
}

export const rpc = {
  async getPendingInit(): Promise<{ paths: string[] }> {
    const paths = [...pendingPaths]
    pendingPaths = []
    return { paths }
  },

  async previewFile(filePath: string): Promise<{ data: string; mimeType: string } | { error: string }> {
    try {
      const buf = await mulby.filesystem.readFile(filePath) as Buffer | ArrayBuffer
      const ext = path.extname(filePath).toLowerCase()
      const mimeMap: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.avif': 'image/avif',
        '.tiff': 'image/tiff',
        '.bmp': 'image/bmp',
        '.svg': 'image/svg+xml',
      }
      const mimeType = mimeMap[ext] ?? 'image/png'
      const base64 = Buffer.from(buf as ArrayBuffer).toString('base64')
      return { data: base64, mimeType }
    } catch (e: any) {
      return { error: e?.message ?? String(e) }
    }
  },

  async compress(payload: CompressPayload): Promise<BatchCompressResult> {
    const fs = mulby.filesystem
    const tempRoot = path.join(
      os.tmpdir(),
      'mulby-batch-image-compress',
      randomBytes(8).toString('hex')
    )
    await fs.mkdir(tempRoot)
    return runCompressPipeline(fs, payload, tempRoot)
  },

  async commit(payload: CommitPayload): Promise<CommitResult> {
    const fs = mulby.filesystem
    return commitCompressStaging(fs, payload)
  },

  async discard(payload: { items: { tempPath: string }[] }): Promise<void> {
    const fs = mulby.filesystem
    return discardCompressStaging(fs, payload as any)
  },

  async loadSettings(): Promise<CompressSettings> {
    try {
      const raw = await mulby.storage.get(SETTINGS_KEY)
      if (raw && typeof raw === 'object') {
        const s = raw as any
        return {
          format: s.format ?? 'original',
          quality: typeof s.quality === 'number' ? s.quality : 80,
          maxWidth: typeof s.maxWidth === 'number' ? s.maxWidth : undefined,
          maxHeight: typeof s.maxHeight === 'number' ? s.maxHeight : undefined,
          suffix: typeof s.suffix === 'string' ? s.suffix : '_compressed',
          outputMode: s.outputMode ?? 'sameDir',
          outputDir: typeof s.outputDir === 'string' ? s.outputDir : undefined,
        }
      }
    } catch {}
    return {
      format: 'original',
      quality: 80,
      suffix: '_compressed',
      outputMode: 'sameDir',
    }
  },

  async saveSettings(settings: CompressSettings): Promise<void> {
    try {
      await mulby.storage.set(SETTINGS_KEY, settings)
    } catch {}
  },
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run, rpc }
export default plugin
