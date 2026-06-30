// 编辑栈执行器：compileStack → 顺序跑 passes（可中止、进度均分、清中间产物）
// 设计依据：docs/ai-creative-canvas-video-editor.md §3.2「多 pass 状态机」/ §8.6 取消模型

import { runFf } from '../mediaVideo'
import { prepareOverlays } from '../mediaOverlay'
import { compileStack, type CompileCtx, type CompileOpts } from './compile'
import type { EditStack } from './types'

function fs(): any {
  return (window as any).mulby?.filesystem
}
async function unlinkQuiet(path: string): Promise<void> {
  try {
    await fs()?.unlink?.(path)
  } catch {
    /* best-effort */
  }
}

function isAbort(e: any): boolean {
  return e?.name === 'AbortError'
}

interface RunResult {
  finalOut: string
  outDuration: number
}

// 编译并顺序执行一个变体（指定 hasAudio + 退化集）；中途出错/中止时清掉本次半成品
async function runVariant(
  stack: EditStack,
  ctx: CompileCtx,
  opts: CompileOpts,
  signal: AbortSignal | undefined,
  onProgress: ((p: number) => void) | undefined
): Promise<RunResult> {
  const compiled = await compileStack(stack, ctx, opts)
  const produced: string[] = []
  const totalWeight = compiled.passes.reduce((a, p) => a + p.weight, 0) || 1
  let done = 0
  try {
    for (const pass of compiled.passes) {
      if (signal?.aborted) throw new DOMException('已取消', 'AbortError')
      await runFf(pass.args, (p) => onProgress?.((done + p * pass.weight) / totalWeight), signal)
      produced.push(pass.outPath)
      done += pass.weight
    }
  } catch (e) {
    // 失败/中止：清掉本变体已产出的所有文件（含半写的末个）
    for (const c of compiled.passes) await unlinkQuiet(c.outPath)
    throw e
  }
  // 成功：仅清中间产物（保留 finalOut）
  for (const c of compiled.cleanup) await unlinkQuiet(c)
  void produced
  return { finalOut: compiled.finalOut, outDuration: compiled.outDuration }
}

// 高层导出：先按有音轨编译；失败（常因无音轨 / 某滤镜不可用）→ 退化重编
// 退化梯度：① 有音轨 ② 无音轨 ③ 无音轨 + 常见可选滤镜退化集
export async function exportStudio(
  stack: EditStack,
  ctxBase: { inPath: string; projectId: string; overlayResolved?: CompileCtx['overlayResolved'] },
  o: { signal?: AbortSignal; onProgress?: (p: number) => void }
): Promise<RunResult> {
  // 备好叠加 PNG（canvas→PNG）；与调用方传入的已解析项（如 PiP 视频路径）合并
  const { overlayResolved: ovPng, cleanup: ovCleanup } = await prepareOverlays(stack, ctxBase.projectId)
  const overlayResolved = { ...ovPng, ...(ctxBase.overlayResolved || {}) }
  const broadFallback = new Set(['denoise', 'colortemperature', 'lut3d', 'sidechain', 'rgbashift', 'tmix', 'minterpolate'])
  const variants: { hasAudio: boolean; fallbacks?: Set<string> }[] = [
    { hasAudio: true },
    { hasAudio: false },
    { hasAudio: false, fallbacks: broadFallback }
  ]
  let lastErr: any
  try {
    for (const v of variants) {
      if (o.signal?.aborted) throw new DOMException('已取消', 'AbortError')
      try {
        const ctx: CompileCtx = { inPath: ctxBase.inPath, projectId: ctxBase.projectId, hasAudio: v.hasAudio, overlayResolved }
        return await runVariant(stack, ctx, { fallbacks: v.fallbacks }, o.signal, o.onProgress)
      } catch (e: any) {
        if (isAbort(e)) throw e // 用户取消不再退化重试
        lastErr = e
      }
    }
    throw lastErr || new Error('导出失败')
  } finally {
    // 叠加 PNG 是临时输入，无论成败都清（已烧进成片）
    for (const c of ovCleanup) await unlinkQuiet(c)
  }
}
