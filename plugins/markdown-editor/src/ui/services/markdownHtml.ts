// Markdown -> HTML for export (replaces Toast UI's editor.getHTML()). Uses
// markdown-it (CommonMark + GFM-ish: tables, strikethrough, autolinks) and emits
// `<pre><code class="language-xxx">` fences so the export enhancer's highlight.js
// / KaTeX / mermaid CDN pass can light them up just like before.

import MarkdownIt from 'markdown-it'

let cached: MarkdownIt | null = null

function getRenderer(): MarkdownIt {
  if (!cached) {
    cached = new MarkdownIt({
      html: true, // allow embedded HTML, matching the previous editor's output
      linkify: true,
      breaks: false,
      langPrefix: 'language-'
    })
  }
  return cached
}

/** Renders a full Markdown document to an HTML body string for export. */
export function renderMarkdownDocument(markdown: string): string {
  return getRenderer().render(markdown ?? '')
}
