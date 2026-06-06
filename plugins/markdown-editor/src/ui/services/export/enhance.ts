// Export rendering enhancements: syntax highlighting, math (KaTeX) and mermaid
// diagrams are added to the exported HTML (which also drives PDF) by injecting
// pinned CDN assets + a small init script. This keeps the plugin bundle lean and
// avoids bundling heavy libraries (notably mermaid). All transforms here are pure
// string functions so they can be unit tested without a DOM.

const HLJS_VERSION = '11.9.0'
const KATEX_VERSION = '0.16.9'
const MERMAID_VERSION = '10.9.1'

const HLJS_BASE = `https://cdn.jsdelivr.net/npm/highlight.js@${HLJS_VERSION}`
const KATEX_BASE = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist`
const MERMAID_SRC = `https://cdn.jsdelivr.net/npm/mermaid@${MERMAID_VERSION}/dist/mermaid.min.js`

export interface ExportFeatures {
  code: boolean
  math: boolean
  mermaid: boolean
}

export interface EnhancedExportBody {
  /** Body HTML after rewriting mermaid code blocks into `<pre class="mermaid">`. */
  bodyHtml: string
  /** Markup to inject into `<head>` (stylesheets), empty when nothing is needed. */
  headHtml: string
  /** Scripts to inject at the end of `<body>`, empty when nothing is needed. */
  bodyScripts: string
  /** Which enhancements were detected/applied. */
  features: ExportFeatures
}

/**
 * Rewrites Toast UI mermaid code blocks (`<pre><code class="language-mermaid">…`)
 * into the `<pre class="mermaid">…</pre>` form mermaid expects. The inner HTML is
 * preserved verbatim; the browser decodes entities via `textContent` when mermaid
 * reads the source, so escaped characters like `--&gt;` round-trip correctly.
 */
export function rewriteMermaidBlocks(bodyHtml: string): { html: string; count: number } {
  let count = 0
  const html = bodyHtml.replace(
    /<pre[^>]*>\s*<code[^>]*class="[^"]*\blanguage-mermaid\b[^"]*"[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi,
    (_match, inner: string) => {
      count += 1
      return `<pre class="mermaid">${inner}</pre>`
    }
  )
  return { html, count }
}

/** True when the body HTML still has a highlightable `<pre><code>` block. */
export function hasHighlightableCode(bodyHtml: string): boolean {
  return /<pre[^>]*>\s*<code/i.test(bodyHtml)
}

/**
 * Detects TeX math delimiters in the Markdown source: `$$…$$`, inline `$…$`,
 * `\(…\)` and `\[…\]`. Inline `$…$` requires a non-space immediately inside the
 * delimiters to avoid matching prose like "$5 and $10 left".
 */
export function hasMathDelimiters(markdown: string): boolean {
  if (/\$\$[\s\S]+?\$\$/.test(markdown)) {
    return true
  }
  if (/\\\([\s\S]+?\\\)/.test(markdown) || /\\\[[\s\S]+?\\\]/.test(markdown)) {
    return true
  }
  // Inline $…$ on a single line, no surrounding whitespace just inside delimiters.
  return /(^|[^\\$])\$(?!\s)([^\n$]*[^\s$])?\$(?!\d)/.test(markdown)
}

/** Builds the `<head>` stylesheet links for the requested features. */
function buildHeadAssets(features: ExportFeatures): string {
  const links: string[] = []
  if (features.code) {
    links.push(`<link rel="stylesheet" href="${HLJS_BASE}/styles/github.min.css" />`)
  }
  if (features.math) {
    links.push(`<link rel="stylesheet" href="${KATEX_BASE}/katex.min.css" />`)
  }
  return links.join('\n    ')
}

/** Builds the end-of-body scripts (libraries + init) for the requested features. */
function buildBodyScripts(features: ExportFeatures): string {
  if (!features.code && !features.math && !features.mermaid) {
    return ''
  }

  const tags: string[] = []
  if (features.code) {
    tags.push(`<script src="${HLJS_BASE}/highlight.min.js"></script>`)
  }
  if (features.math) {
    tags.push(`<script src="${KATEX_BASE}/katex.min.js"></script>`)
    tags.push(`<script src="${KATEX_BASE}/contrib/auto-render.min.js"></script>`)
  }
  if (features.mermaid) {
    tags.push(`<script src="${MERMAID_SRC}"></script>`)
  }

  const init = `<script>
      (function () {
        function run() {
          try {
            if (window.hljs) {
              document.querySelectorAll('pre code').forEach(function (block) {
                try { window.hljs.highlightElement(block); } catch (e) {}
              });
            }
          } catch (e) {}
          try {
            if (window.renderMathInElement) {
              window.renderMathInElement(document.body, {
                delimiters: [
                  { left: '$$', right: '$$', display: true },
                  { left: '\\\\[', right: '\\\\]', display: true },
                  { left: '\\\\(', right: '\\\\)', display: false },
                  { left: '$', right: '$', display: false }
                ],
                throwOnError: false,
                ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
              });
            }
          } catch (e) {}
          var mermaidPending = false;
          try {
            if (window.mermaid) {
              window.mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' });
              mermaidPending = true;
              window.mermaid.run().then(function () { window.__exportReady = true; })
                .catch(function () { window.__exportReady = true; });
            }
          } catch (e) {}
          if (!mermaidPending) { window.__exportReady = true; }
        }
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', run);
        } else {
          run();
        }
      })();
    </script>`

  return [...tags, init].join('\n    ')
}

/**
 * Produces the rewritten body plus the head/body markup needed to render code
 * highlighting, math and mermaid diagrams in the exported HTML. When nothing is
 * detected, head/body markup are empty strings and the body is unchanged.
 */
export function enhanceExportBody(bodyHtml: string, markdown: string): EnhancedExportBody {
  const { html, count } = rewriteMermaidBlocks(bodyHtml)
  const features: ExportFeatures = {
    code: hasHighlightableCode(html),
    math: hasMathDelimiters(markdown),
    mermaid: count > 0
  }

  return {
    bodyHtml: html,
    headHtml: buildHeadAssets(features),
    bodyScripts: buildBodyScripts(features),
    features
  }
}

/** True when the given full HTML embeds the math or mermaid runtimes, which need extra render time. */
export function exportNeedsRenderWait(fullHtml: string): boolean {
  return /class="mermaid"/.test(fullHtml) || /katex@/.test(fullHtml)
}
