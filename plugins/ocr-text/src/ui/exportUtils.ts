export interface ParsedMarkdownTable {
  headers: string[]
  rows: string[][]
}

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function normalizeLatex(latex: string): string {
  return latex
    .trim()
    .replace(/^\$\$\s*/, '')
    .replace(/\s*\$\$$/, '')
    .replace(/^\$\s*/, '')
    .replace(/\s*\$$/, '')
    .trim()
}

export function parseMarkdownTable(markdown: string): ParsedMarkdownTable | null {
  const rows = markdown
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.includes('|'))
    .map(line => line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim()))

  if (rows.length < 2) return null

  const separatorIndex = rows.findIndex(row => row.every(cell => /^:?-{3,}:?$/.test(cell)))
  if (separatorIndex <= 0) return null

  const headers = rows[separatorIndex - 1]
  const bodyRows = rows.slice(separatorIndex + 1).filter(row => row.some(Boolean))

  return {
    headers,
    rows: bodyRows.map(row => headers.map((_, index) => row[index] ?? '')),
  }
}

export function markdownTableToTsv(markdown: string): string {
  const table = parseMarkdownTable(markdown)
  if (!table) return markdown.trim()

  return [table.headers, ...table.rows]
    .map(row => row.map(cell => cell.replace(/\t/g, ' ').replace(/\r?\n/g, ' ')).join('\t'))
    .join('\n')
}

export function markdownTableToExcelHtml(markdown: string): string {
  const table = parseMarkdownTable(markdown)
  const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => HTML_ESCAPE_MAP[char] ?? char)

  if (!table) {
    return `<html><body><pre>${escapeHtml(markdown.trim())}</pre></body></html>`
  }

  const headerHtml = table.headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')
  const rowsHtml = table.rows
    .map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('')

  return [
    '<html><head><meta charset="UTF-8"></head><body>',
    '<table border="1">',
    `<thead><tr>${headerHtml}</tr></thead>`,
    `<tbody>${rowsHtml}</tbody>`,
    '</table>',
    '</body></html>',
  ].join('')
}

export function latexToSvg(latex: string): string {
  const normalized = normalizeLatex(latex)
  const escapeXml = (value: string) => value.replace(/[&<>"']/g, char => HTML_ESCAPE_MAP[char] ?? char)
  const width = Math.max(360, Math.min(1200, normalized.length * 10 + 64))
  const height = 120

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<rect width="100%" height="100%" rx="16" fill="#ffffff"/>',
    '<rect x="1" y="1" width="calc(100% - 2px)" height="calc(100% - 2px)" rx="16" fill="none" stroke="#e4e4e7"/>',
    `<text x="32" y="68" font-family="Times New Roman, serif" font-size="28" fill="#18181b">${escapeXml(normalized)}</text>`,
    '</svg>',
  ].join('')
}
