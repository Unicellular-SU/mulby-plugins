// 编辑栈执行器：compileStack → 顺序跑 passes（可中止、进度均分、清中间产物）
// 设计依据：docs/ai-creative-canvas-video-editor.md §3.2「多 pass 状态机」/ §8.6 取消模型

import { runFf } from '../mediaVideo'
import { mediaPath } from '../media'
import { prepareOverlays } from '../mediaOverlay'
import { compileStack, stackOutDuration, type CompileCtx, type CompileOpts } from './compile'
import { stackIsNoop, type EditStack, type ExportParams } from './types'
import { toast } from '../../store/toastStore'

function fs() {
  return window.mulby?.filesystem
}

// 无编辑 op、且导出也不做任何变换（无缩放/帧率/淡入淡出）、且导出格式与源容器一致 →
// 可直接复制源文件而非整片重编码（避免无谓的画质劣化与耗时）。任何不确定都返回 false 走正常编码。
function extOf(p: string): string {
  return (p.split('.').pop() || '').toLowerCase()
}
function canPassthrough(stack: EditStack, exp: ExportParams | undefined, inPath: string): boolean {
  if (!stackIsNoop(stack)) return false
  if (exp && (exp.outW || exp.outH || exp.fps || exp.fadeIn || exp.fadeOut)) return false
  const fmt = exp?.format || 'mp4'
  const ext = extOf(inPath)
  return (
    (fmt === 'mp4' && (ext === 'mp4' || ext === 'mov' || ext === 'm4v')) ||
    (fmt === 'webm' && ext === 'webm') ||
    (fmt === 'gif' && ext === 'gif') ||
    (fmt === 'webp' && ext === 'webp')
  )
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
  const totalWeight = compiled.passes.reduce((a, p) => a + p.weight, 0) || 1
  let done = 0
  try {
    for (const pass of compiled.passes) {
      if (signal?.aborted) throw new DOMException('已取消', 'AbortError')
      await runFf(pass.args, (p) => onProgress?.((done + p * pass.weight) / totalWeight), signal)
      done += pass.weight
    }
  } catch (e) {
    // 失败/中止：清掉本变体已产出的所有文件（含半写的末个）
    for (const c of compiled.passes) await unlinkQuiet(c.outPath)
    throw e
  }
  // 成功：仅清中间产物（保留 finalOut）
  for (const c of compiled.cleanup) await unlinkQuiet(c)
  return { finalOut: compiled.finalOut, outDuration: compiled.outDuration }
}

// 高层导出：先按最高保真编译；失败则按退化梯度重试。
// 梯度顺序刻意「先保音轨、后丢音轨」——旧 FFmpeg 缺某滤镜(如 colortemperature 4.4+)时应先退化滤镜而非误丢音轨：
//   ① 有音轨 ② 有音轨 + 滤镜退化 ③ 无音轨 ④ 无音轨 + 滤镜退化
// 非首选变体成功 → toast 告知具体降级了什么（此前静默，用户拿到被静音/降级的成片却毫不知情）。
export async function exportStudio(
  stack: EditStack,
  ctxBase: { inPath: string; projectId: string; overlayResolved?: CompileCtx['overlayResolved'] },
  o: { signal?: AbortSignal; onProgress?: (p: number) => void }
): Promise<RunResult> {
  // 空栈直通：无编辑 op + 导出无变换 + 格式匹配 → 复制源，跳过整片重编码（保画质、省时）
  const exp = stack.ops.find((op) => op.kind === 'export' && op.enabled)?.params as ExportParams | undefined
  if (canPassthrough(stack, exp, ctxBase.inPath)) {
    try {
      const out = await mediaPath(ctxBase.projectId, 'studio', extOf(ctxBase.inPath))
      await fs()?.copy?.(ctxBase.inPath, out)
      o.onProgress?.(1)
      return { finalOut: out, outDuration: stackOutDuration(stack) }
    } catch {
      /* 复制失败 → 回落正常编码路径 */
    }
  }
  // 备好叠加 PNG（canvas→PNG）；与调用方传入的已解析项（如 PiP 视频路径）合并
  const { overlayResolved: ovPng, cleanup: ovCleanup } = await prepareOverlays(stack, ctxBase.projectId, stackOutDuration(stack))
  const overlayResolved = { ...ovPng, ...(ctxBase.overlayResolved || {}) }
  const broadFallback = new Set(['denoise', 'colortemperature', 'lut3d', 'sidechain', 'rgbashift', 'tmix', 'minterpolate'])
  const variants: { hasAudio: boolean; fallbacks?: Set<string>; note?: string }[] = [
    { hasAudio: true },
    { hasAudio: true, fallbacks: broadFallback, note: '部分特效在当前 FFmpeg 版本上不可用，已用近似滤镜导出（音轨已保留）' },
    { hasAudio: false, note: '音轨无法处理，已导出为无声视频' },
    { hasAudio: false, fallbacks: broadFallback, note: '音轨无法处理、且部分特效不可用，已用近似滤镜导出无声视频' }
  ]
  let lastErr: any
  try {
    for (const v of variants) {
      if (o.signal?.aborted) throw new DOMException('已取消', 'AbortError')
      try {
        const ctx: CompileCtx = { inPath: ctxBase.inPath, projectId: ctxBase.projectId, hasAudio: v.hasAudio, overlayResolved }
        const res = await runVariant(stack, ctx, { fallbacks: v.fallbacks }, o.signal, o.onProgress)
        if (v.note) toast(v.note, 'warning') // 退化成功：如实告知用户，而非静默出片
        return res
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
