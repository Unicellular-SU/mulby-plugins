import { enhanceExportBody } from './enhance'
import type { ExportSource } from './types'

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function sanitizeBodyHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
}

export function replaceExtension(fileName: string, nextExtension: string) {
  const safeExtension = nextExtension.startsWith('.') ? nextExtension : `.${nextExtension}`
  const normalized = fileName.trim() || '未命名.md'
  const parts = normalized.split(/[/\\]/)
  const base = parts.pop() ?? normalized
  const nextBase = base.includes('.')
    ? base.replace(/\.[^.]+$/, safeExtension)
    : `${base}${safeExtension}`

  if (parts.length === 0) {
    return nextBase
  }

  return `${parts.join('/')}/${nextBase}`
}

export function buildExportHtml({ markdown, html, documentName }: ExportSource) {
  const sanitized = sanitizeBodyHtml(html).trim() || `<pre>${escapeHtml(markdown)}</pre>`
  const { bodyHtml, headHtml, bodyScripts } = enhanceExportBody(sanitized, markdown)
  const title = escapeHtml(documentName.replace(/\.[^.]+$/, '') || 'Markdown 文档')

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root {
        color-scheme: light;
        --text: #202124;
        --muted: #5f6368;
        --border: #d9dde3;
        --bg: #ffffff;
        --code-bg: #f6f8fa;
        --quote-bg: #f8fafc;
        --accent: #3b82f6;
      }

      * { box-sizing: border-box; }

      html, body {
        margin: 0;
        padding: 0;
        background: var(--bg);
        color: var(--text);
        font-family: "PingFang SC", "Helvetica Neue", Helvetica, Arial, sans-serif;
      }

      body {
        padding: 40px 48px 56px;
        line-height: 1.75;
        font-size: 15px;
      }

      article {
        max-width: 860px;
        margin: 0 auto;
      }

      h1, h2, h3, h4, h5, h6 {
        color: var(--text);
        line-height: 1.35;
        margin: 1.2em 0 0.55em;
      }

      h1 {
        font-size: 2.1rem;
        border-bottom: 1px solid var(--border);
        padding-bottom: 0.18em;
      }

      h2 {
        font-size: 1.7rem;
        border-bottom: 1px solid var(--border);
        padding-bottom: 0.16em;
      }

      h3 { font-size: 1.38rem; }
      h4 { font-size: 1.16rem; }
      h5 { font-size: 1rem; }
      h6 { font-size: 0.92rem; color: var(--muted); }

      p, ul, ol, blockquote, pre, table {
        margin: 0 0 1em;
      }

      ul, ol {
        padding-left: 1.55em;
      }

      li + li {
        margin-top: 0.2em;
      }

      a {
        color: var(--accent);
        text-decoration: none;
      }

      blockquote {
        margin-left: 0;
        padding: 0.8em 1em;
        background: var(--quote-bg);
        border-left: 4px solid var(--border);
        color: var(--muted);
      }

      code, pre {
        font-family: "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      }

      code {
        padding: 0.12em 0.35em;
        border-radius: 6px;
        background: var(--code-bg);
        font-size: 0.92em;
      }

      pre {
        padding: 14px 16px;
        overflow-x: auto;
        border: 1px solid var(--border);
        border-radius: 10px;
        background: var(--code-bg);
      }

      pre code {
        padding: 0;
        background: transparent;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th, td {
        border: 1px solid var(--border);
        padding: 8px 10px;
        text-align: left;
        vertical-align: top;
      }

      th {
        background: #f8fafc;
      }

      img {
        max-width: 100%;
        height: auto;
      }

      hr {
        border: 0;
        border-top: 1px solid var(--border);
        margin: 1.6em 0;
      }

      pre.mermaid {
        background: transparent;
        border: 0;
        padding: 0;
        overflow: visible;
        text-align: center;
      }

      pre.mermaid svg {
        max-width: 100%;
        height: auto;
      }

      @page {
        margin: 18mm 16mm 18mm;
      }
    </style>
    ${headHtml}
  </head>
  <body>
    <article>
      ${bodyHtml}
    </article>
    ${bodyScripts}
  </body>
</html>`
}
