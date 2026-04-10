/// <reference path="./types/mulby.d.ts" />

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'

type PluginContext = BackendPluginContext

const PLUGIN_TAG = '[batch-file-md5]'
const STREAM_HIGH_WATER_MARK = 1024 * 1024
const DEFAULT_CONCURRENCY = 6

let pendingPaths: string[] = []

function log(msg: string) {
  console.log(`${PLUGIN_TAG} ${msg}`)
}

export function onLoad() {
  log('loaded')
}

export function onUnload() {
  log('unloaded')
}

export function onEnable() {
  log('enabled')
}

export function onDisable() {
  log('disabled')
}

export async function run(context: PluginContext) {
  const raw = context.attachments ?? []
  pendingPaths = raw
    .map((a) => a.path)
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
  log(`run feature=${context.featureCode ?? ''} attachments=${pendingPaths.length}`)
}

function md5FileStream(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('md5')
    const rs = createReadStream(filePath, { highWaterMark: STREAM_HIGH_WATER_MARK })
    rs.on('data', (chunk: Buffer) => hash.update(chunk))
    rs.on('error', reject)
    rs.on('end', () => resolve(hash.digest('hex')))
  })
}

async function runPool<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return []
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (true) {
      const i = next++
      if (i >= items.length) break
      results[i] = await fn(items[i], i)
    }
  }
  const n = Math.min(Math.max(1, concurrency), items.length)
  await Promise.all(Array.from({ length: n }, () => worker()))
  return results
}

export type HashFileRow = {
  path: string
  name: string
  size: number
  md5: string
  error?: string
}

export const host = {
  async getPendingInit(_context: PluginContext): Promise<{ paths: string[] }> {
    const paths = [...pendingPaths]
    pendingPaths = []
    return { paths }
  },

  async hashFiles(
    _context: PluginContext,
    filePaths: string[],
    concurrency?: number
  ): Promise<{ results: HashFileRow[]; elapsedMs: number }> {
    const unique = [...new Set((filePaths ?? []).filter((p) => typeof p === 'string' && p.length > 0))]
    const t0 = Date.now()
    const c = typeof concurrency === 'number' && concurrency > 0 ? Math.min(concurrency, 32) : DEFAULT_CONCURRENCY

    const results = await runPool(unique, c, async (fp) => {
      try {
        const st = await stat(fp)
        if (st.isDirectory()) {
          return {
            path: fp,
            name: path.basename(fp),
            size: 0,
            md5: '',
            error: '是文件夹，已跳过'
          }
        }
        const md5 = await md5FileStream(fp)
        return { path: fp, name: path.basename(fp), size: st.size, md5 }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        return { path: fp, name: path.basename(fp), size: 0, md5: '', error: message }
      }
    })

    return { results, elapsedMs: Date.now() - t0 }
  }
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run, host }
export default plugin
