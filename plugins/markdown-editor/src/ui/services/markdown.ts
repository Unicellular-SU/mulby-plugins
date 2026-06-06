// Minimal, dependency-free Markdown -> HTML renderer for small read-only
// previews — currently the AI "问一问" explanation shown inside the floating
// bubble. Full-fidelity rendering in the document relies on the Toast UI editor;
// this only covers a safe, common subset (headings, emphasis, inline code,
// fenced code, lists, blockquotes, links, rules) so an explanation reads nicely
// instead of showing raw Markdown source.
//
// Security: every piece of source text is HTML-escaped BEFORE any tag is added,
// inline formatting only ever injects a fixed set of known-safe tags, and link
// targets are restricted to safe schemes. Model output therefore cannot inject
// markup or scripts, which matters because the result is rendered via
// dangerouslySetInnerHTML.

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch] ?? ch)
}

/** Returns a safe href, or '' when the scheme is not allow-listed. */
export function sanitizeUrl(url: string): string {
  const trimmed = url.trim()
  if (/^(https?:\/\/|mailto:|tel:|#|\/|\.{0,2}\/)/i.test(trimmed)) {
    return trimmed
  }
  return ''
}

const PLACEHOLDER = '\u0000'

// Inline formatting. `text` is already HTML-escaped, so the markers we look for
// (`* _ ~ [ ] ( ) \``) survive escaping and only known tags are emitted.
function renderInline(text: string): string {
  let out = text

  // Protect inline code spans first so their contents are not re-formatted.
  const codeSpans: string[] = []
  out = out.replace(/`([^`]+)`/g, (_match, code: string) => {
    codeSpans.push(`<code>${code}</code>`)
    return `${PLACEHOLDER}${codeSpans.length - 1}${PLACEHOLDER}`
  })

  // Links: [label](url). Drop the link (keep label) when the URL is unsafe.
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, url: string) => {
    const safe = sanitizeUrl(url)
    if (!safe) {
      return label
    }
    return `<a href="${safe}" target="_blank" rel="noreferrer noopener">${label}</a>`
  })

  // Bold, then italic. Underscore variants require non-word boundaries so
  // snake_case identifiers are left untouched.
  out = out.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
  out = out.replace(/\*(?=\S)([^*\n]*?\S)\*/g, '<em>$1</em>')
  out = out.replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1<em>$2</em>')
  out = out.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')

  // Restore protected code spans.
  out = out.replace(new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, 'g'), (_match, index: string) => {
    return codeSpans[Number(index)] ?? ''
  })

  return out
}

// Markdown constructs that render as something other than their literal source.
// Used to decide whether text inserted into the WYSIWYG editor needs to go
// through a Markdown round-trip (so it renders) instead of being dropped in as
// plain characters (which would show the raw syntax). Kept conservative so plain
// prose — the common AI polish/translate result — is not flagged.
const RENDERABLE_MARKDOWN_PATTERNS: RegExp[] = [
  /(^|\n)[ \t]{0,3}#{1,6}[ \t]+\S/, // ATX heading
  /(^|\n)[ \t]{0,3}>[ \t]?\S/, // blockquote
  /(^|\n)[ \t]{0,3}[-*+][ \t]+\S/, // bullet list
  /(^|\n)[ \t]{0,3}\d+[.)][ \t]+\S/, // ordered list
  /(^|\n)[ \t]{0,3}(```|~~~)/, // fenced code block
  /(^|\n)[ \t]{0,3}([-*_])(?:[ \t]*\2){2,}[ \t]*(\n|$)/, // thematic break
  /(^|\n)[ \t]{0,3}\|.*\|/, // table row
  /!\[[^\]]*\]\([^)]+\)/, // image
  /\[[^\]]+\]\([^)\s]+\)/, // link
  /\*\*(?=\S)[\s\S]*?\S\*\*/, // bold
  /(^|[^\w])__(?=\S)[\s\S]*?\S__(?!\w)/, // bold (underscores)
  /\*(?=\S)[^*\n]*?\S\*/, // italic
  /(^|[^\w])_(?=\S)[^_\n]*?\S_(?!\w)/, // italic (underscores)
  /`[^`\n]+`/, // inline code
  /~~(?=\S)[\s\S]*?\S~~/ // strikethrough
]

/**
 * Reports whether the text contains Markdown syntax that would look wrong if
 * inserted verbatim into the WYSIWYG editor (e.g. `## heading`, `**bold**`,
 * `![img](url)`). Plain prose returns false.
 */
export function containsRenderableMarkdown(text: string): boolean {
  if (!text) {
    return false
  }
  return RENDERABLE_MARKDOWN_PATTERNS.some((pattern) => pattern.test(text))
}

/**
 * Renders a safe subset of Markdown to an HTML string. Intended for small,
 * read-only previews — not as a general-purpose Markdown engine.
 */
export function renderMarkdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const html: string[] = []
  let i = 0

  let listType: 'ul' | 'ol' | null = null
  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`)
      listType = null
    }
  }

  let paragraph: string[] = []
  const flushParagraph = () => {
    if (paragraph.length > 0) {
      html.push(`<p>${renderInline(escapeHtml(paragraph.join(' ')))}</p>`)
      paragraph = []
    }
  }

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block ```lang ... ```
    const fence = line.match(/^\s*```(.*)$/)
    if (fence) {
      flushParagraph()
      closeList()
      const lang = fence[1].trim().split(/\s+/)[0] ?? ''
      const code: string[] = []
      i += 1
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        code.push(lines[i])
        i += 1
      }
      i += 1 // skip the closing fence (if present)
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : ''
      html.push(`<pre><code${cls}>${escapeHtml(code.join('\n'))}</code></pre>`)
      continue
    }

    // Blank line: end the current block.
    if (/^\s*$/.test(line)) {
      flushParagraph()
      closeList()
      i += 1
      continue
    }

    // ATX heading # .. ######
    const heading = line.match(/^\s*(#{1,6})\s+(.*?)\s*#*\s*$/)
    if (heading) {
      flushParagraph()
      closeList()
      const level = heading[1].length
      html.push(`<h${level}>${renderInline(escapeHtml(heading[2]))}</h${level}>`)
      i += 1
      continue
    }

    // Horizontal rule --- *** ___
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      flushParagraph()
      closeList()
      html.push('<hr />')
      i += 1
      continue
    }

    // Blockquote (collapse consecutive quote lines into one block).
    const quote = line.match(/^\s*>\s?(.*)$/)
    if (quote) {
      flushParagraph()
      closeList()
      const quoteLines: string[] = [quote[1]]
      i += 1
      while (i < lines.length) {
        const next = lines[i].match(/^\s*>\s?(.*)$/)
        if (!next) {
          break
        }
        quoteLines.push(next[1])
        i += 1
      }
      html.push(`<blockquote>${renderInline(escapeHtml(quoteLines.join(' ')))}</blockquote>`)
      continue
    }

    // Unordered list item
    const ul = line.match(/^\s*[-*+]\s+(.*)$/)
    if (ul) {
      flushParagraph()
      if (listType !== 'ul') {
        closeList()
        html.push('<ul>')
        listType = 'ul'
      }
      html.push(`<li>${renderInline(escapeHtml(ul[1].trim()))}</li>`)
      i += 1
      continue
    }

    // Ordered list item
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (ol) {
      flushParagraph()
      if (listType !== 'ol') {
        closeList()
        html.push('<ol>')
        listType = 'ol'
      }
      html.push(`<li>${renderInline(escapeHtml(ol[1].trim()))}</li>`)
      i += 1
      continue
    }

    // Otherwise accumulate paragraph text.
    paragraph.push(line.trim())
    i += 1
  }

  flushParagraph()
  closeList()

  return html.join('\n')
}
