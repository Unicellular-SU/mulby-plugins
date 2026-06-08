// Word/char-level text diff for the AI "before → after" preview. An LCS over a
// hybrid tokenization (CJK chars individually, runs of word chars, whitespace,
// and single punctuation) gives readable granularity for both English and
// Chinese. Pure + dependency-free so it can be unit tested.

export type DiffOp = 'equal' | 'insert' | 'delete'

export interface DiffSegment {
  op: DiffOp
  text: string
}

// Each CJK char is its own token; ASCII words / numbers group; whitespace runs
// group; everything else is a single-char token.
const TOKEN_RE = /[\u3400-\u9fff\uf900-\ufaff]|\s+|[A-Za-z0-9_]+|[^\s]/g

function tokenize(text: string): string[] {
  return text.match(TOKEN_RE) ?? []
}

// Cap the LCS matrix so a huge selection can't freeze the UI; beyond it we fall
// back to a coarse whole-delete + whole-insert.
const MAX_MATRIX = 1_200_000

/** Diff `before` → `after` into equal / insert / delete segments. */
export function diffTokens(before: string, after: string): DiffSegment[] {
  if (before === after) {
    return before ? [{ op: 'equal', text: before }] : []
  }
  const a = tokenize(before)
  const b = tokenize(after)
  if (a.length * b.length > MAX_MATRIX) {
    const out: DiffSegment[] = []
    if (before) {
      out.push({ op: 'delete', text: before })
    }
    if (after) {
      out.push({ op: 'insert', text: after })
    }
    return out
  }

  const n = a.length
  const m = b.length
  // dp[i][j] = LCS length of a[i:] and b[j:].
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const segments: DiffSegment[] = []
  const push = (op: DiffOp, text: string) => {
    const last = segments[segments.length - 1]
    if (last && last.op === op) {
      last.text += text
    } else {
      segments.push({ op, text })
    }
  }

  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('equal', a[i])
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push('delete', a[i])
      i += 1
    } else {
      push('insert', b[j])
      j += 1
    }
  }
  while (i < n) {
    push('delete', a[i])
    i += 1
  }
  while (j < m) {
    push('insert', b[j])
    j += 1
  }
  return segments
}
