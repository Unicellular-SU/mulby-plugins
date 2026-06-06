import assert from 'node:assert/strict'
import { containsRenderableMarkdown, escapeHtml, renderMarkdownToHtml, sanitizeUrl } from './markdown'

// HTML in source text is always escaped (XSS-safe).
assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;')
assert.equal(
  renderMarkdownToHtml('<img src=x onerror=alert(1)>'),
  '<p>&lt;img src=x onerror=alert(1)&gt;</p>'
)

// Headings.
assert.equal(renderMarkdownToHtml('# 标题'), '<h1>标题</h1>')
assert.equal(renderMarkdownToHtml('### 三级'), '<h3>三级</h3>')

// Emphasis + inline code.
assert.equal(renderMarkdownToHtml('这是 **粗体** 文本'), '<p>这是 <strong>粗体</strong> 文本</p>')
assert.equal(renderMarkdownToHtml('这是 *斜体* 文本'), '<p>这是 <em>斜体</em> 文本</p>')
assert.equal(renderMarkdownToHtml('调用 `foo()` 方法'), '<p>调用 <code>foo()</code> 方法</p>')

// snake_case is NOT turned into emphasis.
assert.equal(renderMarkdownToHtml('变量 user_name_value 不变'), '<p>变量 user_name_value 不变</p>')

// Markers inside inline code are not re-formatted.
assert.equal(renderMarkdownToHtml('`a * b * c`'), '<p><code>a * b * c</code></p>')

// Unordered list.
assert.equal(renderMarkdownToHtml('- a\n- b'), '<ul>\n<li>a</li>\n<li>b</li>\n</ul>')

// Ordered list.
assert.equal(renderMarkdownToHtml('1. a\n2. b'), '<ol>\n<li>a</li>\n<li>b</li>\n</ol>')

// Fenced code block escapes content and keeps the language class.
assert.equal(
  renderMarkdownToHtml('```js\nconst a = 1 < 2\n```'),
  '<pre><code class="language-js">const a = 1 &lt; 2</code></pre>'
)

// Blockquote collapses consecutive lines.
assert.equal(renderMarkdownToHtml('> 引用一\n> 引用二'), '<blockquote>引用一 引用二</blockquote>')

// Horizontal rule.
assert.equal(renderMarkdownToHtml('---'), '<hr />')

// Safe links pass through; javascript: is stripped to plain text.
assert.equal(
  renderMarkdownToHtml('[百度](https://baidu.com)'),
  '<p><a href="https://baidu.com" target="_blank" rel="noreferrer noopener">百度</a></p>'
)
assert.equal(renderMarkdownToHtml('[x](javascript:alert)'), '<p>x</p>')

// sanitizeUrl allow-list.
assert.equal(sanitizeUrl('https://a.com'), 'https://a.com')
assert.equal(sanitizeUrl('mailto:a@b.com'), 'mailto:a@b.com')
assert.equal(sanitizeUrl('/relative/path'), '/relative/path')
assert.equal(sanitizeUrl('javascript:alert(1)'), '')
assert.equal(sanitizeUrl('data:text/html,abc'), '')

// Mixed document: heading + paragraph + list, blank line separates blocks.
assert.equal(
  renderMarkdownToHtml('# 说明\n\n这是一段话。\n\n- 项一\n- 项二'),
  '<h1>说明</h1>\n<p>这是一段话。</p>\n<ul>\n<li>项一</li>\n<li>项二</li>\n</ul>'
)

// containsRenderableMarkdown: plain prose is NOT flagged.
assert.equal(containsRenderableMarkdown('这是一段普通的说明文字，没有任何标记。'), false)
assert.equal(containsRenderableMarkdown('Just a plain sentence with a price of 3*4.'), false)
assert.equal(containsRenderableMarkdown('snake_case_name 不会被当作斜体'), false)
assert.equal(containsRenderableMarkdown(''), false)
// containsRenderableMarkdown: structural / inline markdown IS flagged.
assert.equal(containsRenderableMarkdown('## 小标题'), true)
assert.equal(containsRenderableMarkdown('正文\n\n- 列表项'), true)
assert.equal(containsRenderableMarkdown('1. 第一步'), true)
assert.equal(containsRenderableMarkdown('> 引用'), true)
assert.equal(containsRenderableMarkdown('```js\ncode\n```'), true)
assert.equal(containsRenderableMarkdown('包含 **粗体** 的句子'), true)
assert.equal(containsRenderableMarkdown('包含 `code` 的句子'), true)
assert.equal(containsRenderableMarkdown('一个 [链接](https://a.com)'), true)
assert.equal(containsRenderableMarkdown('一张 ![图](assets/x.png)'), true)
assert.equal(containsRenderableMarkdown('| a | b |\n| - | - |'), true)

console.log('markdown-editor markdown unit tests passed')
