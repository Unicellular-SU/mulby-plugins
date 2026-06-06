import assert from 'node:assert/strict'
import {
  enhanceExportBody,
  exportNeedsRenderWait,
  hasHighlightableCode,
  hasMathDelimiters,
  rewriteMermaidBlocks
} from './enhance'

// rewriteMermaidBlocks: converts Toast UI mermaid code blocks into <pre class="mermaid">
{
  const input = '<pre><code class="language-mermaid">graph TD; A--&gt;B</code></pre>'
  const { html, count } = rewriteMermaidBlocks(input)
  assert.equal(count, 1)
  assert.equal(html, '<pre class="mermaid">graph TD; A--&gt;B</pre>')
}

// rewriteMermaidBlocks: tolerates extra attributes / class ordering and counts multiple
{
  const input =
    '<pre class="x"><code class="language-mermaid foo" data-x="1">a</code></pre>' +
    '<p>mid</p>' +
    '<pre><code class="lang-js language-mermaid">b</code></pre>'
  const { html, count } = rewriteMermaidBlocks(input)
  assert.equal(count, 2)
  assert.equal(html.includes('<pre class="mermaid">a</pre>'), true)
  assert.equal(html.includes('<pre class="mermaid">b</pre>'), true)
}

// rewriteMermaidBlocks: leaves non-mermaid code untouched
{
  const input = '<pre><code class="language-js">const x = 1</code></pre>'
  const { html, count } = rewriteMermaidBlocks(input)
  assert.equal(count, 0)
  assert.equal(html, input)
}

// hasHighlightableCode
assert.equal(hasHighlightableCode('<pre><code class="language-ts">x</code></pre>'), true)
assert.equal(hasHighlightableCode('<pre>plain</pre>'), false)
assert.equal(hasHighlightableCode('<p>no code</p>'), false)

// hasMathDelimiters: display $$, \[ \], inline \( \), inline $…$
assert.equal(hasMathDelimiters('energy is $$E = mc^2$$ done'), true)
assert.equal(hasMathDelimiters('inline \\(a+b\\) here'), true)
assert.equal(hasMathDelimiters('block \\[\\int_0^1 x\\,dx\\]'), true)
assert.equal(hasMathDelimiters('the value $x^2$ matters'), true)
// prose with currency should not be treated as math
assert.equal(hasMathDelimiters('it costs $5 and $10 total'), false)
assert.equal(hasMathDelimiters('plain text, no math'), false)

// enhanceExportBody: detects all three and emits head + body assets
{
  const body =
    '<h1>Doc</h1>' +
    '<pre><code class="language-js">const a = 1</code></pre>' +
    '<pre><code class="language-mermaid">graph TD; A--&gt;B</code></pre>'
  const markdown = 'see $x^2$ and code'
  const result = enhanceExportBody(body, markdown)

  assert.deepEqual(result.features, { code: true, math: true, mermaid: true })
  // mermaid block rewritten in the body
  assert.equal(result.bodyHtml.includes('<pre class="mermaid">graph TD; A--&gt;B</pre>'), true)
  // head has highlight + katex stylesheets
  assert.equal(result.headHtml.includes('highlight.js'), true)
  assert.equal(result.headHtml.includes('katex'), true)
  // body scripts include all three runtimes and an init block
  assert.equal(result.bodyScripts.includes('highlight.min.js'), true)
  assert.equal(result.bodyScripts.includes('katex.min.js'), true)
  assert.equal(result.bodyScripts.includes('mermaid.min.js'), true)
  assert.equal(result.bodyScripts.includes('renderMathInElement'), true)
  assert.equal(result.bodyScripts.includes('mermaid.run()'), true)
}

// enhanceExportBody: plain document needs no assets
{
  const result = enhanceExportBody('<h1>Hello</h1><p>world</p>', 'Hello world')
  assert.deepEqual(result.features, { code: false, math: false, mermaid: false })
  assert.equal(result.headHtml, '')
  assert.equal(result.bodyScripts, '')
  assert.equal(result.bodyHtml, '<h1>Hello</h1><p>world</p>')
}

// enhanceExportBody: code-only document loads only highlight assets
{
  const result = enhanceExportBody('<pre><code class="language-py">print(1)</code></pre>', 'print(1)')
  assert.deepEqual(result.features, { code: true, math: false, mermaid: false })
  assert.equal(result.headHtml.includes('highlight.js'), true)
  assert.equal(result.headHtml.includes('katex'), false)
  // the init script always mentions window.mermaid, so assert on the CDN URL
  assert.equal(result.bodyScripts.includes('mermaid.min.js'), false)
  assert.equal(result.bodyScripts.includes('katex.min.js'), false)
}

// exportNeedsRenderWait: true only when async runtimes are embedded
assert.equal(exportNeedsRenderWait('<html><pre class="mermaid">x</pre></html>'), true)
assert.equal(exportNeedsRenderWait('<link href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">'), true)
assert.equal(exportNeedsRenderWait('<html><pre><code>plain</code></pre></html>'), false)

console.log('markdown-editor export enhance unit tests passed')
