import assert from 'node:assert/strict'
import {
  appendHistoryItem,
  DRAFT_DOC_KEY,
  docKeyForPath,
  getHistoryForDoc,
  IMAGE_HISTORY_LIMIT,
  makeHistoryId,
  normalizeHistoryMap,
  type ImageHistoryItem
} from './imageHistory'

const item = (id: string, overrides: Partial<ImageHistoryItem> = {}): ImageHistoryItem => ({
  id,
  prompt: `prompt-${id}`,
  size: '1024x1024',
  path: `/tmp/${id}.png`,
  createdAt: 1,
  ...overrides
})

// docKeyForPath: file path passes through; empty/blank/nullish becomes the draft key.
assert.equal(docKeyForPath('/docs/a.md'), '/docs/a.md')
assert.equal(docKeyForPath('  /docs/b.md  '), '/docs/b.md')
assert.equal(docKeyForPath(''), DRAFT_DOC_KEY)
assert.equal(docKeyForPath('   '), DRAFT_DOC_KEY)
assert.equal(docKeyForPath(null), DRAFT_DOC_KEY)
assert.equal(docKeyForPath(undefined), DRAFT_DOC_KEY)

// normalizeHistoryMap: drops malformed entries, keeps valid ones, caps length.
{
  const raw = {
    '/a.md': [item('1'), { id: 2, path: '/x.png' }, item('3'), null, 'nope'],
    '/b.md': 'not-an-array',
    '/c.md': []
  }
  const map = normalizeHistoryMap(raw)
  assert.deepEqual(Object.keys(map), ['/a.md'])
  assert.deepEqual(map['/a.md'].map((entry) => entry.id), ['1', '3'])
}
assert.deepEqual(normalizeHistoryMap(null), {})
assert.deepEqual(normalizeHistoryMap('x'), {})
{
  const many = Array.from({ length: IMAGE_HISTORY_LIMIT + 5 }, (_unused, index) => item(`k${index}`))
  const map = normalizeHistoryMap({ '/d.md': many })
  assert.equal(map['/d.md'].length, IMAGE_HISTORY_LIMIT)
}

// appendHistoryItem: prepends, de-dupes by id, caps, and never mutates input.
{
  const base = { '/a.md': [item('1'), item('2')] }
  const next = appendHistoryItem(base, '/a.md', item('3'))
  assert.deepEqual(next['/a.md'].map((entry) => entry.id), ['3', '1', '2'])
  // original untouched
  assert.deepEqual(base['/a.md'].map((entry) => entry.id), ['1', '2'])
  // de-dupe: re-adding id '1' moves it to the front
  const deduped = appendHistoryItem(next, '/a.md', item('1'))
  assert.deepEqual(deduped['/a.md'].map((entry) => entry.id), ['1', '3', '2'])
}
{
  const capped = appendHistoryItem({ '/a.md': [item('1'), item('2')] }, '/a.md', item('3'), 2)
  assert.deepEqual(capped['/a.md'].map((entry) => entry.id), ['3', '1'])
}
// appendHistoryItem creates a new bucket when the doc has no history yet.
{
  const fresh = appendHistoryItem({}, '/new.md', item('x'))
  assert.deepEqual(fresh['/new.md'].map((entry) => entry.id), ['x'])
}

// getHistoryForDoc returns the bucket or an empty array.
assert.deepEqual(getHistoryForDoc({ '/a.md': [item('1')] }, '/a.md').map((entry) => entry.id), ['1'])
assert.deepEqual(getHistoryForDoc({}, '/missing.md'), [])

// makeHistoryId produces unique, prefixed ids.
{
  const a = makeHistoryId()
  const b = makeHistoryId()
  assert.match(a, /^img-/)
  assert.notEqual(a, b)
}

console.log('markdown-editor imageHistory unit tests passed')
