/// <reference path="./types/mulby.d.ts" />

import path from 'node:path'
import { commitBatchStaging, discardBatchStaging, runBatchProcess } from './pipeline/batch-process'
import { applyManualCrop, mergeToGif, mergeToPdf, mergeToStrip } from './pipeline/merge-ops'
import type {
  BatchCommitPayload,
  BatchCommitResult,
  BatchDiscardPayload,
  BatchProcessPayload,
  BatchProcessResult,
  ManualCropPayload,
  MergeGifPayload,
  MergePdfPayload,
  MergeStripPayload,
} from './pipeline/types'
import { hostLog, PLUGIN_LOG, summarizeFiles, summarizeSteps } from './plugin-log'

type PluginContext = BackendPluginContext

const PLUGIN_TAG = PLUGIN_LOG

let pendingRoute: string | undefined
let pendingPaths: string[] = []

function featureToRoute(featureCode: string | undefined): string {
  const fc = featureCode ?? 'batch-hub'
  const map: Record<string, string> = {
    'batch-hub': 'batch',
    'merge-hub': 'merge',
    'manual-crop': 'crop',
    'open-with-files': 'batch',
    'edit-images': 'batch',
  }
  return map[fc] ?? 'batch'
}

export function onLoad() {
  console.log(`${PLUGIN_TAG} loaded`)
}

export function onUnload() {
  console.log(`${PLUGIN_TAG} unloaded`)
}

export function onEnable() {
  console.log(`${PLUGIN_TAG} enabled`)
}

export function onDisable() {
  console.log(`${PLUGIN_TAG} disabled`)
}

export async function run(context: PluginContext) {
  pendingRoute = featureToRoute(context.featureCode)
  const rawAtt = context.attachments ?? []
  const rawPaths = rawAtt.map((a) => ({
    path: a.path,
    pathType: a.path === undefined ? 'undefined' : typeof a.path,
    name: a.name,
    kind: a.kind,
  }))
  pendingPaths = rawAtt.map((a) => a.path).filter((p): p is string => typeof p === 'string' && p.length > 0)
  console.log(`${PLUGIN_TAG} run feature=${context.featureCode} route=${pendingRoute} attachments=${pendingPaths.length}`)
  hostLog('run', {
    featureCode: context.featureCode,
    pendingRoute,
    attachmentCount: rawAtt.length,
    rawAttachmentPaths: rawPaths,
    pendingPathsAfterFilter: pendingPaths,
  })
}

export const host = {
  async getPendingInit(_context: PluginContext): Promise<{ route: string; paths: string[] }> {
    const data = { route: pendingRoute ?? 'batch', paths: [...pendingPaths] }
    hostLog('getPendingInit', {
      route: data.route,
      pathCount: data.paths.length,
      paths: data.paths,
      fileSummary: summarizeFiles(data.paths),
    })
    pendingRoute = undefined
    pendingPaths = []
    return data
  },

  async batchProcess(context: PluginContext, payload: BatchProcessPayload): Promise<BatchProcessResult> {
    hostLog('batchProcess:incoming', {
      payloadDefined: payload != null,
      nameSuffix: payload?.nameSuffix,
      fileSummary: summarizeFiles(payload?.files),
      stepsSummary: summarizeSteps(payload?.steps),
    })
    const fs = context.api.filesystem
    return runBatchProcess(fs, payload)
  },

  async batchCommit(context: PluginContext, payload: BatchCommitPayload): Promise<BatchCommitResult> {
    hostLog('batchCommit:incoming', {
      mode: payload?.mode,
      otherDir: payload?.otherDir,
      nameSuffix: payload?.nameSuffix,
      itemCount: payload?.items?.length,
    })
    const fs = context.api.filesystem
    return commitBatchStaging(fs, payload)
  },

  async batchDiscardStaging(context: PluginContext, payload: BatchDiscardPayload): Promise<void> {
    hostLog('batchDiscardStaging', { itemCount: payload?.items?.length })
    const fs = context.api.filesystem
    return discardBatchStaging(fs, payload)
  },

  async mergePdf(context: PluginContext, payload: MergePdfPayload): Promise<void> {
    hostLog('mergePdf:incoming', {
      outPath: payload?.outPath,
      fileSummary: summarizeFiles(payload?.files),
    })
    const fs = context.api.filesystem
    const dir = path.dirname(payload.outPath)
    await Promise.resolve(fs.mkdir(dir))
    await mergeToPdf(fs, payload)
  },

  async mergeStrip(context: PluginContext, payload: MergeStripPayload): Promise<void> {
    hostLog('mergeStrip:incoming', {
      outPath: payload?.outPath,
      direction: payload?.direction,
      fileSummary: summarizeFiles(payload?.files),
    })
    const fs = context.api.filesystem
    const dir = path.dirname(payload.outPath)
    await Promise.resolve(fs.mkdir(dir))
    await mergeToStrip(fs, payload)
  },

  async mergeGif(context: PluginContext, payload: MergeGifPayload): Promise<void> {
    hostLog('mergeGif:incoming', {
      outPath: payload?.outPath,
      frameDelayMs: payload?.frameDelayMs,
      loop: payload?.loop,
      fileSummary: summarizeFiles(payload?.files),
    })
    const fs = context.api.filesystem
    const dir = path.dirname(payload.outPath)
    await Promise.resolve(fs.mkdir(dir))
    await mergeToGif(fs, payload)
  },

  async manualCropApply(context: PluginContext, payload: ManualCropPayload): Promise<void> {
    hostLog('manualCropApply:incoming', {
      filePath: payload?.filePath,
      filePathType: payload?.filePath === undefined ? 'undefined' : typeof payload?.filePath,
      outPath: payload?.outPath,
      rect: payload?.rect,
    })
    const fs = context.api.filesystem
    const dir = path.dirname(payload.outPath)
    await Promise.resolve(fs.mkdir(dir))
    await applyManualCrop(fs, payload)
  },
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run, host }
export default plugin
