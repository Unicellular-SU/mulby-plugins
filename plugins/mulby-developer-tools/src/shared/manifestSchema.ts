/**
 * 基于官方 manifest-schema.json 的 manifest 校验（P0：让 AI 生成的插件真正符合标准）。
 *
 * 这是全链路里唯一「按 schema 校验」的关卡：后端 check_conformance 在停止/交付前调用它，
 * 把 enum 写错、多余字段、缺必填、tools.inputSchema/icon/cmds 形态错等一整类
 * 「装得上但不合规」问题变成 error 级问题，驱动 AI 自修复并在交付页展示。
 *
 * 设计：AJV 一次编译缓存；运行时若不可用（极端宿主禁用 new Function 等）优雅降级返回空，
 * 由原有启发式检查兜底，绝不让校验本身把流程拖垮。
 */
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv'
import schema from './manifest-schema.json'

export interface SchemaIssue {
  level: 'error'
  code: string
  message: string
  hint?: string
}

let validator: ValidateFunction | null = null
let initFailed = false

function getValidator(): ValidateFunction | null {
  if (validator) return validator
  if (initFailed) return null
  try {
    // strict:false —— schema 以 draft-07 声明却用了 $defs（pointer 仍可解析）；关掉严格模式避免对注解类关键字报错。
    const ajv = new Ajv({ allErrors: true, strict: false })
    validator = ajv.compile(schema as unknown as object)
    return validator
  } catch {
    initFailed = true
    return null
  }
}

/** instancePath（如 /features/0/code）转可读标签 */
function pathLabel(instancePath: string): string {
  if (!instancePath) return '根'
  return instancePath.replace(/^\//, '').replace(/\//g, '.')
}

/** 把单条 AJV 错误翻译成对开发者友好的中文问题 */
function describe(err: ErrorObject): { code: string; message: string; hint?: string } {
  const at = pathLabel(err.instancePath)
  const p = (err.params || {}) as Record<string, unknown>
  switch (err.keyword) {
    case 'required':
      return { code: 'schema-required', message: `${at === '根' ? '' : at + ' '}缺少必填字段「${String(p.missingProperty)}」` }
    case 'additionalProperties':
      return { code: 'schema-extra', message: `${at} 含 schema 未定义的字段「${String(p.additionalProperty)}」`, hint: '删除该字段或检查是否拼写错误' }
    case 'enum':
      return { code: 'schema-enum', message: `${at} 取值非法，必须是其一：${(p.allowedValues as unknown[] || []).join(' / ')}` }
    case 'type':
      return { code: 'schema-type', message: `${at} 类型应为 ${String(p.type)}` }
    case 'minLength':
      return { code: 'schema-empty', message: `${at} 不能为空（至少 ${String(p.limit)} 个字符）` }
    case 'minItems':
      return { code: 'schema-min-items', message: `${at} 至少需要 ${String(p.limit)} 项` }
    case 'pattern':
      return { code: 'schema-pattern', message: `${at} 格式不符（需匹配 ${String(p.pattern)}）` }
    case 'const':
      return { code: 'schema-const', message: `${at} 必须为 ${JSON.stringify(p.allowedValue)}` }
    case 'oneOf':
      return { code: 'schema-oneof', message: `${at} 不符合任一允许的形态`, hint: '检查该项结构（如触发指令 cmds、图标 icon、平台 platform 的写法）' }
    default:
      return { code: `schema-${err.keyword}`, message: `${at} ${err.message || '不符合 schema'}` }
  }
}

/**
 * 按 manifest-schema 校验一个 manifest 对象，返回 error 级问题列表（空 = 通过）。
 * AJV 不可用时返回空（优雅降级）。
 */
export function validateManifestSchema(manifest: unknown): SchemaIssue[] {
  const validate = getValidator()
  if (!validate) return []
  let ok = false
  try {
    ok = validate(manifest) as boolean
  } catch {
    return []
  }
  if (ok || !validate.errors) return []

  const errors = validate.errors
  // oneOf 失败时 AJV 会连带报出每个子分支的细节错误（且互斥、易误导）；只保留 oneOf 聚合错误，
  // 过滤该路径上（同路径或更深）的非 oneOf 分支噪音，让畸形的 cmds/icon/platform 只呈现一条清晰提示。
  const oneOfBases = errors.filter((e) => e.keyword === 'oneOf').map((e) => e.instancePath)
  const isBranchNoise = (e: ErrorObject) =>
    e.keyword !== 'oneOf' && oneOfBases.some((base) => e.instancePath === base || e.instancePath.startsWith(base + '/'))

  const seen = new Set<string>()
  const issues: SchemaIssue[] = []
  for (const err of errors) {
    if (isBranchNoise(err)) continue
    const d = describe(err)
    const key = `${err.instancePath}|${d.code}|${d.message}`
    if (seen.has(key)) continue
    seen.add(key)
    issues.push({ level: 'error', code: d.code, message: d.message, hint: d.hint })
    if (issues.length >= 14) break
  }
  return issues
}
