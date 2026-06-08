import assert from 'node:assert/strict'
import { diffTokens, type DiffSegment } from './diff'

// Reconstruct one side of the diff to verify correctness:
// equal+delete must rebuild `before`; equal+insert must rebuild `after`.
function rebuild(segments: DiffSegment[], side: 'delete' | 'insert'): string {
  return segments
    .filter((s) => s.op === 'equal' || s.op === side)
    .map((s) => s.text)
    .join('')
}

// Identical → a single equal segment; empty → no segments.
assert.deepEqual(diffTokens('hello', 'hello'), [{ op: 'equal', text: 'hello' }])
assert.deepEqual(diffTokens('', ''), [])

// Pure insert / delete.
assert.deepEqual(diffTokens('', 'abc'), [{ op: 'insert', text: 'abc' }])
assert.deepEqual(diffTokens('abc', ''), [{ op: 'delete', text: 'abc' }])

// English word change: reconstructs both sides and keeps the shared words.
{
  const d = diffTokens('the quick brown fox', 'the slow brown fox')
  assert.equal(rebuild(d, 'delete'), 'the quick brown fox')
  assert.equal(rebuild(d, 'insert'), 'the slow brown fox')
  assert.ok(d.some((s) => s.op === 'equal' && s.text.includes('brown')))
  assert.ok(d.some((s) => s.op === 'delete' && s.text.includes('quick')))
  assert.ok(d.some((s) => s.op === 'insert' && s.text.includes('slow')))
}

// Chinese char-level change.
{
  const d = diffTokens('今天天气很好', '今天天气不错')
  assert.equal(rebuild(d, 'delete'), '今天天气很好')
  assert.equal(rebuild(d, 'insert'), '今天天气不错')
  assert.ok(d.some((s) => s.op === 'equal' && s.text.includes('今天天气')))
}

console.log('markdown-editor diff unit tests passed')
