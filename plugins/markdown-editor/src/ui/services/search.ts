export interface SearchOptions {
  caseSensitive?: boolean
  wholeWord?: boolean
}

export interface SearchMatch {
  /** Absolute character index (0-based) of the match start in the source string. */
  start: number
  /** Absolute character index (exclusive) of the match end. */
  end: number
  /** 1-based line number of the match start. */
  line: number
  /** 1-based column of the match start within its line. */
  column: number
  /** 1-based line number of the match end. */
  endLine: number
  /** 1-based column of the match end within its line. */
  endColumn: number
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function buildSearchRegExp(query: string, options: SearchOptions = {}): RegExp | null {
  if (!query) {
    return null
  }
  let pattern = escapeRegExp(query)
  if (options.wholeWord) {
    pattern = `\\b${pattern}\\b`
  }
  const flags = options.caseSensitive ? 'g' : 'gi'
  try {
    return new RegExp(pattern, flags)
  } catch {
    return null
  }
}

/**
 * Builds a lookup of cumulative character offsets at the start of each line so
 * an absolute index can be converted to a (line, column) pair.
 */
function buildLineStarts(source: string): number[] {
  const starts = [0]
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') {
      starts.push(index + 1)
    }
  }
  return starts
}

function locate(lineStarts: number[], index: number): { line: number; column: number } {
  // Binary search for the greatest line start <= index.
  let low = 0
  let high = lineStarts.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (lineStarts[mid] <= index) {
      low = mid
    } else {
      high = mid - 1
    }
  }
  return { line: low + 1, column: index - lineStarts[low] + 1 }
}

export function findMatches(source: string, query: string, options: SearchOptions = {}): SearchMatch[] {
  const regex = buildSearchRegExp(query, options)
  if (!regex || !source) {
    return []
  }

  const lineStarts = buildLineStarts(source)
  const matches: SearchMatch[] = []
  let result: RegExpExecArray | null

  while ((result = regex.exec(source)) !== null) {
    const start = result.index
    const end = start + result[0].length
    const startPos = locate(lineStarts, start)
    const endPos = locate(lineStarts, end)
    matches.push({
      start,
      end,
      line: startPos.line,
      column: startPos.column,
      endLine: endPos.line,
      endColumn: endPos.column
    })

    // Guard against zero-length matches causing an infinite loop.
    if (result[0].length === 0) {
      regex.lastIndex += 1
    }
  }

  return matches
}

export function countMatches(source: string, query: string, options: SearchOptions = {}): number {
  return findMatches(source, query, options).length
}

export function replaceAll(source: string, query: string, replacement: string, options: SearchOptions = {}): string {
  const regex = buildSearchRegExp(query, options)
  if (!regex) {
    return source
  }
  // Escape `$` in the replacement so it is treated literally (no $1/$& expansion).
  const safeReplacement = replacement.replace(/\$/g, '$$$$')
  return source.replace(regex, safeReplacement)
}

/** Replace a single match (identified by absolute range) with the replacement text. */
export function replaceRange(source: string, start: number, end: number, replacement: string): string {
  return source.slice(0, start) + replacement + source.slice(end)
}
