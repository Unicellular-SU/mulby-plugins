/**
 * 剪贴板内容隐私护栏。
 *
 * 在把剪贴板文本送给 AI 之前必须经过 `inspectClipboardForAi`。
 * - 命中敏感词正则 → 永不上传，返回 reason
 * - 长度过短 → 不上传
 * - 其余情况由调用方决定（建议仍要求用户已 opt-in）
 */

const SENSITIVE_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'private-key', re: /-----BEGIN [A-Z ]+ PRIVATE KEY-----/ },
  { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'github-token', re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/ },
  { name: 'openai-key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'bearer-token', re: /\bbearer\s+[A-Za-z0-9._\-]{20,}/i },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/ },
  { name: 'credit-card', re: /\b(?:\d[ -]*?){13,19}\b/ },
  { name: 'cn-id-card', re: /\b\d{17}[\dXx]\b/ },
  { name: 'phone-cn', re: /\b1[3-9]\d{9}\b/ },
  { name: 'password-keyword', re: /\b(password|passwd|pwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\b\s*[:=]/i },
]

/** 最低字符门槛（避免 1-2 字命令被误传） */
export const CLIPBOARD_MIN_LEN = 32
/** 单次上传给 AI 的最大字符数 */
export const CLIPBOARD_MAX_LEN_TRANSLATE = 200
export const CLIPBOARD_MAX_LEN_COMMENT = 80

export interface ClipboardInspection {
  allowed: boolean
  reason?: string
  detected?: string
}

export function inspectClipboardForAi(text: string, minLen: number = CLIPBOARD_MIN_LEN): ClipboardInspection {
  if (typeof text !== 'string') return { allowed: false, reason: 'not-string' }
  const trimmed = text.trim()
  if (trimmed.length < minLen) return { allowed: false, reason: 'too-short' }
  for (const { name, re } of SENSITIVE_PATTERNS) {
    if (re.test(trimmed)) {
      return { allowed: false, reason: 'sensitive', detected: name }
    }
  }
  return { allowed: true }
}

/**
 * Wrap user text into a tagged block to mitigate basic prompt injection.
 * AI prompt should explicitly say it must not follow instructions inside the tags.
 */
export function wrapUntrustedText(text: string, tag = 'untrusted'): string {
  const sanitized = text.replace(/<\/?(untrusted|user_text|system|instruction)>/gi, '')
  return `<${tag}>${sanitized}</${tag}>`
}
