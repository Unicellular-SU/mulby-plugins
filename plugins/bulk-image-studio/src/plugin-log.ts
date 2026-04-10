/**
 * 插件调试日志：在 Mulby 开发者工具或宿主控制台搜索 `[bulk-image-studio]` 即可过滤。
 * 不记录文件二进制内容，仅路径类型与摘要。
 */
export const PLUGIN_LOG = '[bulk-image-studio]'

function safeJson(obj: unknown, space = 0): string {
  try {
    return JSON.stringify(obj, (_k, v) => (typeof v === 'bigint' ? String(v) : v), space)
  } catch {
    return String(obj)
  }
}

/** host 入口：方法名 + 结构化摘要 */
export function hostLog(method: string, detail: Record<string, unknown>): void {
  console.log(PLUGIN_LOG, '[host]', method, safeJson(detail))
}

/** 每一次即将触发的磁盘读：便于定位 path 为 undefined */
export function fsLog(op: string, filePath: unknown, extra?: Record<string, unknown>): void {
  const valid = typeof filePath === 'string' && filePath.length > 0
  const line = {
    op,
    path: filePath,
    pathType: filePath === null ? 'null' : filePath === undefined ? 'undefined' : typeof filePath,
    valid,
    ...extra,
  }
  if (valid) {
    console.log(PLUGIN_LOG, '[fs]', safeJson(line))
  } else {
    console.warn(PLUGIN_LOG, '[fs] INVALID_PATH', safeJson(line))
  }
}

/** 批量 steps 中可能含 path 的步骤摘要 */
export function summarizeSteps(steps: unknown): unknown {
  if (!Array.isArray(steps)) return { error: 'steps_not_array', raw: typeof steps }
  return steps.map((s: { kind?: string; path?: string }, i: number) => ({
    i,
    kind: s?.kind,
    path: s?.path,
    pathType: s?.path === undefined ? 'undefined' : typeof s?.path,
  }))
}

/** files 数组逐项检查 */
export function summarizeFiles(files: unknown): unknown {
  if (!Array.isArray(files)) return { error: 'files_not_array', type: typeof files }
  return {
    length: files.length,
    items: files.map((p, i) => ({
      i,
      type: typeof p,
      path: p,
      ok: typeof p === 'string' && p.length > 0,
    })),
  }
}
