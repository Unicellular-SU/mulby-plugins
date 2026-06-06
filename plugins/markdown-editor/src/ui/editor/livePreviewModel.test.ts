import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { ensureSyntaxTree } from '@codemirror/language'
import { createMarkdownLanguage } from './markdownLanguage'
import {
  activeLineNumbers,
  computeLivePreview,
  extractImageAlt,
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
}

console.log('markdown-editor livePreviewModel unit tests passed')
