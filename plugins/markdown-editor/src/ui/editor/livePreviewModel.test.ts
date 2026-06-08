import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { ensureSyntaxTree } from '@codemirror/language'
import { createMarkdownLanguage } from './markdownLanguage'
import {
  activeLineNumbers,
  computeLivePreview,
  extractImageAlt,
  findAutolinks,
  findBlockMathMatches,
  findEmojiShortcodes,
  findFootnoteDefinition,
  findFootnoteRefs,
  findHighlightMatches,
  findHtmlComments,
  findHtmlDefinitionLists,
  findHtmlDetails,
  findHtmlImages,
  findHtmlInlineTags,
  findHtmlStyledSpans,
  findInlineMathMatches,
  findReferenceDefinition,
  headingSlug,
  leadingIndentColumns,
  parseDefinitionList,
  parseDetails,
  quoteDepth,
  stripQuotePrefix,
  sanitizeInlineStyle,
  slugify,
  type HideRange,
  type MarkRange,
  type WidgetRange
} from './livePreviewModel'

function stateFor(doc: string, caret: number): EditorState {
  const state = EditorState.create({
    doc,
    selection: { anchor: caret },
    extensions: [createMarkdownLanguage()]
  })
  // Force a complete parse so syntaxTree() is exhaustive in the headless test.
  ensureSyntaxTree(state, state.doc.length, 10000)
  return state
}

const hasHide = (hides: HideRange[], from: number, to: number) =>
  hides.some((h) => h.from === from && h.to === to)
const hasMark = (marks: MarkRange[], cls: string) => marks.some((m) => m.cls === cls)
const findWidget = (widgets: WidgetRange[], kind: WidgetRange['kind']) =>
  widgets.find((w) => w.kind === kind)

// extractImageAlt pulls the alt text out of an image's raw source.
assert.equal(extractImageAlt('![a cat](x.png)'), 'a cat')
assert.equal(extractImageAlt('![](x.png)'), '')

// Heading anchor slugs (GitHub-style) drive in-document [text](#anchor) jumps.
assert.equal(slugify('My Section'), 'my-section')
assert.equal(slugify('Foo, Bar!'), 'foo-bar')
assert.equal(headingSlug('# Hello World'), 'hello-world')
assert.equal(headingSlug('### **Bold** Title ###'), 'bold-title')
assert.equal(headingSlug('## 中文 标题'), '中文-标题')
assert.equal(headingSlug('not a heading'), null)

// activeLineNumbers covers every line a selection touches.
{
  const state = EditorState.create({ doc: 'a\nb\nc', selection: { anchor: 0, head: 3 } })
  const lines = activeLineNumbers(state)
  assert.ok(lines.has(1) && lines.has(2))
  assert.ok(!lines.has(3))
}

// Heading off the active line: line is classed and the "# " marker is hidden.
{
  const doc = '# Title\n\nbody'
  const state = stateFor(doc, doc.indexOf('body'))
  const deco = computeLivePreview(state)
  assert.ok(deco.lineClasses.some((l) => l.cls === 'cm-md-h1'), 'h1 line class')
  assert.ok(hasHide(deco.hides, 0, 2), 'hides "# "')
}

// Bold off the active line: marks hidden, content styled.
{
  const doc = '**bold**\n\ntail'
  const state = stateFor(doc, doc.indexOf('tail'))
  const deco = computeLivePreview(state)
  assert.ok(hasHide(deco.hides, 0, 2), 'hides opening **')
  assert.ok(hasHide(deco.hides, 6, 8), 'hides closing **')
  assert.ok(hasMark(deco.marks, 'cm-md-strong'), 'strong mark')
}

// On the active line, the bold markers are revealed (not hidden).
{
  const doc = '**bold**\n\ntail'
  const state = stateFor(doc, 3) // caret inside the bold on line 1
  const deco = computeLivePreview(state)
  assert.ok(!hasHide(deco.hides, 0, 2), 'opening ** revealed on active line')
}

// Per-token (Obsidian-style) reveal: with the caret in plain text elsewhere on
// the SAME line, an inline construct stays rendered (its markers stay hidden);
// only the token the caret is inside reveals its source.
{
  const doc = '**bold** and `code` here\n\ntail'
  // Caret in the word "here" — neither the bold nor the inline code is touched.
  const inText = computeLivePreview(stateFor(doc, doc.indexOf('here')))
  assert.ok(hasHide(inText.hides, 0, 2), 'bold ** stays hidden when caret is elsewhere on the line')
  const codeOpen = doc.indexOf('`')
  assert.ok(hasHide(inText.hides, codeOpen, codeOpen + 1), 'inline code ` stays hidden too')

  // Caret inside the bold word reveals only the bold markers, code stays hidden.
  const inBold = computeLivePreview(stateFor(doc, 3))
  assert.ok(!hasHide(inBold.hides, 0, 2), 'bold ** revealed when caret is inside the bold word')
  assert.ok(hasHide(inBold.hides, codeOpen, codeOpen + 1), 'inline code stays rendered while editing bold')
}

// Inline code off the active line hides the backticks.
{
  const doc = '`code`\n\ntail'
  const state = stateFor(doc, doc.indexOf('tail'))
  const deco = computeLivePreview(state)
  assert.ok(hasMark(deco.marks, 'cm-md-code'), 'code mark')
  assert.ok(hasHide(deco.hides, 0, 1), 'hides opening backtick')
}

// Inline link off the active line: brackets/URL hidden, label styled.
{
  const doc = '[label](http://x)\n\ntail'
  const state = stateFor(doc, doc.indexOf('tail'))
  const deco = computeLivePreview(state)
  assert.ok(hasMark(deco.marks, 'cm-md-link'), 'link mark')
  assert.ok(hasHide(deco.hides, 0, 1), 'hides opening [')
  const rbracket = doc.indexOf(']')
  assert.ok(hasHide(deco.hides, rbracket, doc.indexOf('\n')), 'hides ](url) tail')
}

// Image off the active line becomes an image widget carrying url + alt.
{
  const doc = '![a cat](cat.png)\n\ntail'
  const state = stateFor(doc, doc.indexOf('tail'))
  const deco = computeLivePreview(state)
  const widget = findWidget(deco.widgets, 'image')
  assert.ok(widget, 'image widget present')
  assert.equal(widget?.data.url, 'cat.png')
  assert.equal(widget?.data.alt, 'a cat')
}

// A standalone image line is a block widget: idle it replaces the source (no
// reveal); with the caret on it the source stays and the image is shown below
// (reveal), so editing never hides the image or jumps the layout.
{
  const doc = '![a cat](cat.png)\n\ntail'
  const idle = findWidget(computeLivePreview(stateFor(doc, doc.indexOf('tail'))).widgets, 'image')
  assert.equal(idle?.block, true, 'standalone image is a block widget')
  assert.ok(!idle?.reveal, 'idle standalone image replaces the source (no reveal)')

  const editing = findWidget(computeLivePreview(stateFor(doc, 3)).widgets, 'image')
  assert.ok(editing, 'image still rendered while its line is edited')
  assert.equal(editing?.reveal, true, 'editing reveals source above and keeps image below')
}

// An image embedded inline in text keeps the inline replace (not a block).
// Per-token reveal: the source shows only when the caret is inside the image
// construct; with the caret elsewhere on the line the image stays rendered.
{
  const doc = 'see ![x](y.png) here\n\ntail'
  const idle = findWidget(computeLivePreview(stateFor(doc, doc.indexOf('tail'))).widgets, 'image')
  assert.ok(idle, 'inline image widget present')
  assert.ok(!idle?.block, 'inline image is not a block widget')

  const editing = computeLivePreview(stateFor(doc, doc.indexOf('y.png')))
  assert.ok(!findWidget(editing.widgets, 'image'), 'inline image source revealed when caret is inside it')

  const elsewhere = computeLivePreview(stateFor(doc, doc.indexOf('see')))
  assert.ok(findWidget(elsewhere.widgets, 'image'), 'inline image stays rendered when caret is elsewhere on the line')
}

// A linked image [![alt](img)](href) renders as ONE image unit: the image shows,
// the wrapping link is not separately styled, and editing reveals it as a unit
// (so clicking it edits instead of leaving the image showing).
{
  const doc = '[![cat](cat.png)](https://x.com)\n\ntail'
  const idle = computeLivePreview(stateFor(doc, doc.indexOf('tail')))
  const img = findWidget(idle.widgets, 'image')
  assert.ok(img, 'linked image renders as an image widget')
  assert.equal(img?.data.url, 'cat.png', 'uses the inner image src')
  assert.equal(img?.block, true, 'standalone linked image is a block widget')
  assert.ok(!hasMark(idle.marks, 'cm-md-link'), 'no half-hidden link mark for a linked image')

  const editing = findWidget(computeLivePreview(stateFor(doc, 5)).widgets, 'image')
  assert.equal(editing?.reveal, true, 'linked image reveals source as a unit while editing')
}

// Horizontal rule off the active line becomes an hr widget.
{
  const doc = 'before\n\n---\n\nafter'
  const state = stateFor(doc, doc.indexOf('after'))
  const deco = computeLivePreview(state)
  assert.ok(findWidget(deco.widgets, 'hr'), 'hr widget present')
}

// Fenced code block: every line of the block gets the code-block class.
{
  const doc = '```js\nconst a = 1\nconst b = 2\n```\n\ntail'
  const state = stateFor(doc, doc.indexOf('tail'))
  const deco = computeLivePreview(state)
  const codeLineCount = deco.lineClasses.filter((l) => l.cls === 'cm-md-codeblock').length
  assert.ok(codeLineCount >= 3, `expected >=3 code-block lines, got ${codeLineCount}`)
  assert.ok(deco.lineClasses.some((l) => l.cls === 'cm-md-codeblock-open'), 'open fence class')
  assert.ok(deco.lineClasses.some((l) => l.cls === 'cm-md-codeblock-close'), 'close fence class')
}

// Bullet list markers off the active line become bullet widgets.
{
  const doc = '- first\n- second\n\ntail'
  const state = stateFor(doc, doc.indexOf('tail'))
  const deco = computeLivePreview(state)
  const bullets = deco.widgets.filter((w) => w.kind === 'bullet')
  assert.equal(bullets.length, 2, 'two bullet widgets')
}

// Ordered list markers are left as-is (no bullet widget).
{
  const doc = '1. first\n2. second\n\ntail'
  const state = stateFor(doc, doc.indexOf('tail'))
  const deco = computeLivePreview(state)
  assert.equal(deco.widgets.filter((w) => w.kind === 'bullet').length, 0, 'no bullets for ordered list')
}

// GFM table off the active line becomes a block table widget carrying its source.
{
  const doc = 'intro\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\ntail'
  const state = stateFor(doc, doc.indexOf('tail'))
  const deco = computeLivePreview(state)
  const table = findWidget(deco.widgets, 'table')
  assert.ok(table, 'table widget present')
  assert.equal(table?.block, true)
  assert.ok((table?.data.source ?? '').includes('| a | b |'), 'carries table source')
}

// Obsidian-style in-place editing: a non-quoted table stays rendered even when
// the caret is inside it (the cell is edited in place rather than switching the
// whole block to raw source).
{
  const doc = 'intro\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\ntail'
  const state = stateFor(doc, doc.indexOf('| a |') + 2)
  const deco = computeLivePreview(state)
  assert.ok(findWidget(deco.widgets, 'table'), 'table stays rendered with caret inside (edited in place)')
}

// A malformed table (no delimiter row -> not parseable) emits no widget so its
// raw source stays visible to fix by hand.
{
  const doc = 'intro\n\n| a | b |\n| 1 | 2 |\n\ntail'
  const state = stateFor(doc, doc.indexOf('tail'))
  const deco = computeLivePreview(state)
  assert.ok(!findWidget(deco.widgets, 'table'), 'malformed table is not rendered as a widget')
}

// A selection that merely spans across a table (not contained in it) keeps the
// table rendered, so a drag-select doesn't shift the layout out from under the
// mouse mid-drag.
{
  const doc = 'intro\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\ntail'
  const state = EditorState.create({
    doc,
    selection: { anchor: doc.indexOf('intro'), head: doc.indexOf('tail') + 2 },
    extensions: [createMarkdownLanguage()]
  })
  ensureSyntaxTree(state, state.doc.length, 10000)
  const deco = computeLivePreview(state)
  assert.ok(findWidget(deco.widgets, 'table'), 'table stays rendered when only spanned by a selection')
}

// --- TeX math scanners (pure) ---------------------------------------------
{
  // Inline math: padded by non-space, no newline.
  assert.equal(findInlineMathMatches('a $x^2$ b').length, 1, 'one inline math')
  assert.equal(findInlineMathMatches('$x^2$')[0].inner, 'x^2', 'inner tex')
  // Currency is not math.
  assert.equal(findInlineMathMatches('it costs $5 and $10 total').length, 0, 'no currency math')
  // Padding rule: leading/trailing space rejects.
  assert.equal(findInlineMathMatches('$ x $').length, 0, 'space-padded rejected')
  // Block math (display), possibly multi-line.
  const block = findBlockMathMatches('$$\n\\int_0^1 x\\,dx\n$$')
  assert.equal(block.length, 1, 'one block math')
  assert.equal(block[0].inner, '\\int_0^1 x\\,dx', 'trimmed block tex')
}

// --- ==highlight== scanner (pure) -----------------------------------------
{
  assert.equal(findHighlightMatches('==hi==').length, 1, 'one highlight')
  assert.equal(findHighlightMatches('==hi there==')[0].inner, 'hi there', 'multi-word highlight')
  // Comparisons with spaces around "==" are not highlights.
  assert.equal(findHighlightMatches('if a == b == c then').length, 0, 'comparison not highlight')
  // Leading/trailing space inside rejects.
  assert.equal(findHighlightMatches('== padded ==').length, 0, 'padded rejected')
}

// Inline math off the active line becomes an inline math widget.
{
  const doc = 'energy $E=mc^2$ here\n\ntail'
  const state = stateFor(doc, doc.indexOf('tail'))
  const deco = computeLivePreview(state)
  const math = deco.widgets.find((w) => w.kind === 'math' && w.data.display !== '1')
  assert.ok(math, 'inline math widget present')
  assert.equal(math?.data.tex, 'E=mc^2', 'carries tex')
}

// Block math off the active line becomes a block math widget.
{
  const doc = 'intro\n\n$$\na^2+b^2=c^2\n$$\n\ntail'
  const state = stateFor(doc, doc.indexOf('tail'))
  const deco = computeLivePreview(state)
  const math = deco.widgets.find((w) => w.kind === 'math' && w.data.display === '1')
  assert.ok(math, 'block math widget present')
  assert.equal(math?.block, true, 'block flag set')
}

// Math is NOT detected inside a fenced code block.
{
  const doc = '```\n$x^2$ ==hi==\n```\n\ntail'
  const state = stateFor(doc, doc.indexOf('tail'))
  const deco = computeLivePreview(state)
  assert.equal(deco.widgets.filter((w) => w.kind === 'math').length, 0, 'no math inside code')
  assert.ok(!hasMark(deco.marks, 'cm-md-highlight'), 'no highlight inside code')
}

// ==highlight== off the active line: span marked, "==" fences hidden.
{
  const doc = 'see ==important== now\n\ntail'
  const state = stateFor(doc, doc.indexOf('tail'))
  const deco = computeLivePreview(state)
  assert.ok(hasMark(deco.marks, 'cm-md-highlight'), 'highlight mark')
  const open = doc.indexOf('==')
  assert.ok(hasHide(deco.hides, open, open + 2), 'hides opening ==')
}

// On the active line, the "==" fences are revealed (still marked).
{
  const doc = 'see ==important== now\n\ntail'
  const state = stateFor(doc, doc.indexOf('important'))
  const deco = computeLivePreview(state)
  const open = doc.indexOf('==')
  assert.ok(!hasHide(deco.hides, open, open + 2), 'opening == revealed on active line')
  assert.ok(hasMark(deco.marks, 'cm-md-highlight'), 'still marked while editing')
}

// --- HTML subset scanners (pure) ------------------------------------------
{
  // <sup>/<sub>/<mark>/<u>/<kbd> inline tags.
  const tags = findHtmlInlineTags('x<sup>2</sup> H<sub>2</sub>O <mark>hi</mark> <u>under</u> <kbd>Ctrl</kbd>')
  assert.equal(tags.length, 5, 'five inline html tags')
  assert.equal(tags[0].tag, 'sup', 'first is sup')
  assert.equal(tags[1].tag, 'sub', 'second is sub')
  assert.equal(tags[2].tag, 'mark', 'third is mark')
  assert.equal(tags[3].tag, 'u', 'fourth is u')
  assert.equal(tags[4].tag, 'kbd', 'fifth is kbd')
  // <ul> must not be mistaken for a <u> tag.
  assert.equal(findHtmlInlineTags('<ul><li>x</li></ul>').length, 0, 'no <u> match in <ul>')
  // Inner range excludes the tags.
  const src = 'a<sup>2</sup>'
  const t = findHtmlInlineTags(src)[0]
  assert.equal(src.slice(t.innerStart, t.innerEnd), '2', 'inner is the tag content')

  // Comments.
  assert.equal(findHtmlComments('a <!-- note --> b').length, 1, 'one comment')

  // HTML images parse src/alt/width/height (quoted and unquoted).
  const imgs = findHtmlImages('<img src="a.png" alt="cat" width="120" height=80>')
  assert.equal(imgs.length, 1, 'one html image')
  assert.equal(imgs[0].src, 'a.png', 'src')
  assert.equal(imgs[0].alt, 'cat', 'alt')
  assert.equal(imgs[0].width, '120', 'width')
  assert.equal(imgs[0].height, '80', 'height (unquoted)')
  // An <img> without src is ignored.
  assert.equal(findHtmlImages('<img alt="x">').length, 0, 'no src -> skipped')

  // Definition list parsing (text only).
  const dls = findHtmlDefinitionLists('<dl><dt>Term</dt><dd>Def</dd></dl>')
  assert.equal(dls.length, 1, 'one dl block')
  const items = parseDefinitionList(dls[0].inner)
  assert.equal(items.length, 2, 'two dl items')
  assert.equal(items[0].term, true, 'first is a term')
  assert.equal(items[0].text, 'Term', 'term text')
  assert.equal(items[1].term, false, 'second is a description')
  assert.equal(items[1].text, 'Def', 'description text')
  // Embedded tags inside dd are stripped (XSS-safe text).
  assert.equal(parseDefinitionList('<dl><dd><b>x</b></dd></dl>')[0].text, 'x', 'tags stripped')
}

// <sup> off the active line: tags hidden, inner styled.
{
  const doc = 'E = mc<sup>2</sup> end\n\ntail'
  const state = stateFor(doc, doc.indexOf('tail'))
  const deco = computeLivePreview(state)
  assert.ok(hasMark(deco.marks, 'cm-md-sup'), 'sup mark')
  const open = doc.indexOf('<sup>')
  assert.ok(hasHide(deco.hides, open, open + 5), 'hides <sup>')
}

// --- <span style> sanitization + scanning (pure) --------------------------
{
  // Whitelisted props are kept; unknown props and dangerous values are dropped.
  assert.equal(sanitizeInlineStyle('color: red;'), 'color: red', 'keeps color')
  assert.equal(
    sanitizeInlineStyle('color: red; font-weight: 700'),
    'color: red; font-weight: 700',
    'keeps multiple safe props'
  )
  assert.equal(sanitizeInlineStyle('position: fixed; top: 0'), '', 'drops non-whitelisted props')
  assert.equal(sanitizeInlineStyle('background: url(x.png)'), '', 'drops url()')
  assert.equal(sanitizeInlineStyle('color: expression(alert(1))'), '', 'drops expression()')
  assert.equal(sanitizeInlineStyle('color: red; behavior: url(#x)'), 'color: red', 'keeps safe, drops unsafe')

  // The span scanner extracts the inner range and the sanitized style.
  const spanSrc = 'a <span style="color: red;">hi</span> b'
  const spans = findHtmlStyledSpans(spanSrc)
  assert.equal(spans.length, 1, 'one styled span')
  assert.equal(spans[0].style, 'color: red', 'sanitized style carried')
  assert.equal(spanSrc.slice(spans[0].innerStart, spans[0].innerEnd), 'hi', 'inner range is the content')
}

// <span style> off the active line: tags hidden, inner gets a styled mark with
// the sanitized inline style as attributes.
{
  const doc = 'see <span style="color: red;">red</span> here\n\ntail'
  const state = stateFor(doc, doc.indexOf('tail'))
  const deco = computeLivePreview(state)
  const styled = deco.marks.find((m) => m.cls === 'cm-md-styled')
  assert.ok(styled, 'styled span mark present')
  assert.equal(styled?.attrs?.style, 'color: red', 'carries sanitized style attribute')
  const open = doc.indexOf('<span')
  const tagEnd = doc.indexOf('>') + 1
  assert.ok(hasHide(deco.hides, open, tagEnd), 'hides the <span …> open tag')
}

// HTML image off the active line becomes an image widget carrying its size.
{
  const doc = 'pic <img src="a.png" width="120"> here\n\ntail'
  const state = stateFor(doc, doc.indexOf('tail'))
  const deco = computeLivePreview(state)
  const img = findWidget(deco.widgets, 'image')
  assert.ok(img, 'html image widget present')
  assert.equal(img?.data.url, 'a.png', 'carries src')
  assert.equal(img?.data.width, '120', 'carries width')
}

// <dl> off the active line becomes a block definition-list widget.
{
  const doc = 'intro\n\n<dl>\n<dt>Term</dt>\n<dd>Def</dd>\n</dl>\n\ntail'
  const state = stateFor(doc, doc.indexOf('tail'))
  const deco = computeLivePreview(state)
  const dl = findWidget(deco.widgets, 'dl')
  assert.ok(dl, 'dl widget present')
  assert.equal(dl?.block, true, 'dl is block')
}

// #1: <details>/<summary> parsing (open flag, summary text, markdown body).
{
  const found = findHtmlDetails('a\n<details open><summary>More</summary>\nbody **x**\n</details>\nb')
  assert.equal(found.length, 1, 'one details block')
  const parts = parseDetails(found[0].inner)
  assert.equal(parts.open, true, 'open flag parsed')
  assert.equal(parts.summary, 'More', 'summary text parsed')
  assert.ok(parts.body.includes('body **x**'), 'body markdown preserved')
  // Missing summary falls back to a default label; tags are stripped for safety.
  assert.equal(parseDetails('<details><summary><b>S</b></summary>x</details>').summary, 'S', 'summary tags stripped')
  assert.equal(parseDetails('<details>no summary</details>').summary, '详情', 'default summary label')
}

// #1: a <details> block off the active line becomes a block details widget.
// (Caret sentinel avoids the substring "tail" inside "details".)
{
  const doc = 'intro\n\n<details>\n<summary>More</summary>\nhidden body\n</details>\n\nOUTSIDE'
  const state = stateFor(doc, doc.indexOf('OUTSIDE'))
  const deco = computeLivePreview(state)
  const details = findWidget(deco.widgets, 'details')
  assert.ok(details, 'details widget present')
  assert.equal(details?.block, true, 'details is block')

  // With the caret inside the block, the source is revealed (no widget).
  const editing = computeLivePreview(stateFor(doc, doc.indexOf('hidden')))
  assert.ok(!findWidget(editing.widgets, 'details'), 'details source revealed when caret is inside')
}

// Single-line HTML comment off the active line is hidden.
{
  const doc = 'before <!-- secret --> after\n\ntail'
  const state = stateFor(doc, doc.indexOf('tail'))
  const deco = computeLivePreview(state)
  const start = doc.indexOf('<!--')
  const end = doc.indexOf('-->') + 3
  assert.ok(hasHide(deco.hides, start, end), 'single-line comment hidden')
}

// HTML inside a fenced code block is left untouched (raw).
{
  const doc = '```\n<sup>2</sup> <mark>x</mark>\n```\n\ntail'
  const state = stateFor(doc, doc.indexOf('tail'))
  const deco = computeLivePreview(state)
  assert.ok(!hasMark(deco.marks, 'cm-md-sup'), 'no sup mark inside code')
}

// --- Links / footnotes / emoji scanners (pure) ----------------------------
{
  // Autolinks: URL and email.
  const al = findAutolinks('see <https://a.com/x> or <bob@a.com> end')
  assert.equal(al.length, 2, 'two autolinks')
  assert.equal(al[0].href, 'https://a.com/x', 'url href')
  assert.equal(al[0].email, false, 'url not email')
  assert.equal(al[1].href, 'mailto:bob@a.com', 'email gets mailto')
  assert.equal(al[1].email, true, 'email flagged')

  // Reference-style link definition lines.
  assert.equal(findReferenceDefinition('[ref1]: https://x.com "Title"').ok, true, 'ref def line')
  assert.equal(findReferenceDefinition('just text').ok, false, 'non-def line')

  // Footnote definitions vs references.
  assert.equal(findFootnoteDefinition('[^1]: the note').ok, true, 'footnote def')
  assert.equal(findFootnoteDefinition('plain').ok, false, 'not a footnote def')
  const refs = findFootnoteRefs('text[^1] more[^note] end')
  assert.equal(refs.length, 2, 'two footnote refs')
  // A definition marker at line start is not counted as a reference.
  assert.equal(findFootnoteRefs('[^1]: def').length, 0, 'def marker is not a ref')

  // Emoji shortcodes (known ones only).
  const em = findEmojiShortcodes('hi :smile: and :+1: but :notanemoji:')
  assert.equal(em.length, 2, 'two known emoji')
  assert.equal(em[0].emoji, '😄', 'smile emoji')
  assert.equal(em[1].emoji, '👍', '+1 emoji')
}

// Autolink off the active line: angle brackets hidden, inner styled as link.
{
  const doc = 'go <https://a.com> now\n\ntail'
  const state = stateFor(doc, doc.indexOf('tail'))
  const deco = computeLivePreview(state)
  assert.ok(hasMark(deco.marks, 'cm-md-link'), 'autolink styled as link')
  const open = doc.indexOf('<https')
  assert.ok(hasHide(deco.hides, open, open + 1), 'hides opening <')
}

// Footnote reference off the active line becomes a superscript marker.
{
  const doc = 'claim[^1] here\n\ntail'
  const state = stateFor(doc, doc.indexOf('tail'))
  const deco = computeLivePreview(state)
  assert.ok(hasMark(deco.marks, 'cm-md-footnote-ref'), 'footnote ref marked')
}

// Emoji shortcode off the active line becomes an emoji widget.
{
  const doc = 'nice :smile: day\n\ntail'
  const state = stateFor(doc, doc.indexOf('tail'))
  const deco = computeLivePreview(state)
  const e = findWidget(deco.widgets, 'emoji')
  assert.ok(e, 'emoji widget present')
  assert.equal(e?.data.emoji, '😄', 'carries emoji')
}

// --- Code / quote / list (Batch C) ----------------------------------------
// #11/#4: off the active block, the ``` markers are hidden but the language
// token stays visible as a top-right label; the close fence collapses to a cap.
{
  const doc = '```js\nconst a = 1\n```\n\ntail'
  const state = stateFor(doc, doc.indexOf('tail'))
  const deco = computeLivePreview(state)
  assert.ok(hasHide(deco.hides, 0, 3), 'hides opening ``` ')
  assert.ok(!hasHide(deco.hides, 3, 5), 'keeps the language token visible as a label')
  assert.ok(deco.lineClasses.some((l) => l.cls === 'cm-md-codeblock-lang'), 'open fence shows a language label')
  assert.ok(deco.lineClasses.some((l) => l.cls === 'cm-md-codefence'), 'close fence collapses to a thin cap')
}

// #4: a fenced block with no language collapses both fence lines to thin caps.
{
  const doc = '```\nplain code\n```\n\ntail'
  const state = stateFor(doc, doc.indexOf('tail'))
  const deco = computeLivePreview(state)
  assert.ok(!deco.lineClasses.some((l) => l.cls === 'cm-md-codeblock-lang'), 'no language label without a language')
  assert.equal(
    deco.lineClasses.filter((l) => l.cls === 'cm-md-codefence').length,
    2,
    'both fence lines collapse when there is no language'
  )
}

// #11: while the caret is inside the block, the fences are revealed for editing.
{
  const doc = '```js\nconst a = 1\n```\n\ntail'
  const state = stateFor(doc, doc.indexOf('const'))
  const deco = computeLivePreview(state)
  assert.ok(!hasHide(deco.hides, 0, 3), 'opening ``` revealed when editing')
  assert.ok(!deco.lineClasses.some((l) => l.cls === 'cm-md-codefence'), 'no thin cap while editing')
}

// #8: a fenced code block inside a blockquote still renders as a code block.
{
  const doc = '> ```js\n> const a = 1\n> ```\n\ntail'
  const state = stateFor(doc, doc.indexOf('tail'))
  const deco = computeLivePreview(state)
  assert.ok(deco.lineClasses.some((l) => l.cls === 'cm-md-codeblock'), 'code block inside quote')
  assert.ok(deco.lineClasses.some((l) => l.cls === 'cm-md-quote'), 'quote class still present')
}

// #3: quoteDepth counts leading '>' markers for nesting levels.
{
  assert.equal(quoteDepth('> a'), 1, 'single level')
  assert.equal(quoteDepth('> > b'), 2, 'two levels')
  assert.equal(quoteDepth('>>> c'), 3, 'three levels, no spaces')
  assert.equal(quoteDepth('plain'), 0, 'no quote prefix')
}

// #3: nested blockquote lines carry per-level depth classes.
{
  const doc = '> a\n> > b\n> > > c\n\ntail'
  const state = stateFor(doc, doc.indexOf('tail'))
  const deco = computeLivePreview(state)
  assert.ok(deco.lineClasses.some((l) => l.cls === 'cm-md-quote-1'), 'depth-1 class')
  assert.ok(deco.lineClasses.some((l) => l.cls === 'cm-md-quote-2'), 'depth-2 class')
  assert.ok(deco.lineClasses.some((l) => l.cls === 'cm-md-quote-3'), 'depth-3 class')
}

// #9: nested bullet list renders a bullet for each marker at every depth.
{
  const doc = '- a\n  - b\n    - c\n\ntail'
  const state = stateFor(doc, doc.indexOf('tail'))
  const deco = computeLivePreview(state)
  assert.equal(deco.widgets.filter((w) => w.kind === 'bullet').length, 3, 'three nested bullets')
}

// --- Mermaid (Batch D) -----------------------------------------------------
// A ```mermaid block off the active block becomes a mermaid widget carrying code.
{
  const doc = 'intro\n\n```mermaid\ngraph TD\nA-->B\n```\n\ntail'
  const state = stateFor(doc, doc.indexOf('tail'))
  const deco = computeLivePreview(state)
  const mmd = findWidget(deco.widgets, 'mermaid')
  assert.ok(mmd, 'mermaid widget present')
  assert.equal(mmd?.block, true, 'mermaid is block')
  assert.ok((mmd?.data.code ?? '').includes('graph TD'), 'carries diagram code')
  // It must NOT also be treated as a normal code block.
  assert.ok(!deco.lineClasses.some((l) => l.cls === 'cm-md-codeblock'), 'no code-block class for mermaid')
}

// While editing the mermaid block, the source is shown (no diagram widget).
{
  const doc = 'intro\n\n```mermaid\ngraph TD\nA-->B\n```\n\ntail'
  const state = stateFor(doc, doc.indexOf('graph'))
  const deco = computeLivePreview(state)
  assert.ok(!findWidget(deco.widgets, 'mermaid'), 'mermaid source revealed while editing')
  assert.ok(deco.lineClasses.some((l) => l.cls === 'cm-md-codeblock'), 'shows as code block while editing')
}

// --- Container indent for list-nested block widgets ------------------------
// leadingIndentColumns counts leading whitespace (tab = 4 columns).
assert.equal(leadingIndentColumns('no indent'), 0, 'no leading ws')
assert.equal(leadingIndentColumns('   three'), 3, 'three spaces')
assert.equal(leadingIndentColumns('\tt'), 4, 'one tab = 4 cols')
assert.equal(leadingIndentColumns('  \tmixed'), 6, 'two spaces + tab')
assert.equal(leadingIndentColumns('> > quoted'), 0, 'quote markers are not indent ws')

// A table nested in a list carries its structural indent so it renders under the
// list item instead of jumping to the far-left margin.
{
  const doc = '- item\n\n  | A | B |\n  | - | - |\n  | 1 | 2 |\n\ntail'
  const state = stateFor(doc, doc.indexOf('tail'))
  const deco = computeLivePreview(state)
  const table = findWidget(deco.widgets, 'table')
  assert.ok(table, 'nested table widget present')
  assert.equal(table?.data.indent, '2', 'table indent = 2 columns')
}

// A top-level table has zero indent.
{
  const doc = '| A | B |\n| - | - |\n| 1 | 2 |\n\ntail'
  const state = stateFor(doc, doc.indexOf('tail'))
  const deco = computeLivePreview(state)
  const table = findWidget(deco.widgets, 'table')
  assert.equal(table?.data.indent, '0', 'top-level table indent = 0')
}

// A standalone image nested in a list carries its structural indent too.
{
  const doc = '- item\n\n  ![pic](a.png)\n\ntail'
  const state = stateFor(doc, doc.indexOf('tail'))
  const deco = computeLivePreview(state)
  const img = findWidget(deco.widgets, 'image')
  assert.ok(img, 'nested image widget present')
  assert.equal(img?.block, true, 'standalone image is block')
  assert.equal(img?.data.indent, '2', 'image indent = 2 columns')
}

// --- Quote-nested blocks: bars + prefix stripping --------------------------
// stripQuotePrefix removes up to `depth` leading `>` markers per line.
assert.equal(stripQuotePrefix('> a\n> b', 1), 'a\nb', 'strip one level')
assert.equal(stripQuotePrefix('> > a\n> > b', 2), 'a\nb', 'strip two levels')
assert.equal(stripQuotePrefix('> > a', 1), '> a', 'strip only one of two levels')
assert.equal(stripQuotePrefix('plain', 1), 'plain', 'no prefix to strip')
assert.equal(stripQuotePrefix('no change', 0), 'no change', 'depth 0 is a no-op')

// A table nested in a blockquote renders as a table widget that records the
// quote depth and whose source has the `>` prefixes stripped (so it parses).
{
  const doc = '> intro\n>\n> | A | B |\n> | - | - |\n> | 1 | 2 |\n\ntail'
  const state = stateFor(doc, doc.indexOf('tail'))
  const deco = computeLivePreview(state)
  const table = findWidget(deco.widgets, 'table')
  assert.ok(table, 'quoted table widget present')
  assert.equal(table?.data.quoteDepth, '1', 'records quote depth 1')
  assert.ok(!(table?.data.source ?? '').includes('>'), 'source has > prefixes stripped')
  assert.ok((table?.data.source ?? '').includes('| A | B |'), 'source keeps table content')
}

// A plain (non-quoted) table records quote depth 0.
{
  const doc = '| A | B |\n| - | - |\n| 1 | 2 |\n\ntail'
  const state = stateFor(doc, doc.indexOf('tail'))
  const deco = computeLivePreview(state)
  const table = findWidget(deco.widgets, 'table')
  assert.equal(table?.data.quoteDepth, '0', 'plain table quote depth 0')
}

console.log('markdown-editor livePreviewModel unit tests passed')
