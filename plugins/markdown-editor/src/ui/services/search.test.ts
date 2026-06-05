import assert from 'node:assert/strict'
import { countMatches, findMatches, replaceAll, replaceRange } from './search'

const source = 'Hello world\nhello WORLD\nHELLO there'

// Case-insensitive (default) finds all variants of "hello".
const ci = findMatches(source, 'hello')
assert.equal(ci.length, 3)
assert.deepEqual(ci[0], { start: 0, end: 5, line: 1, column: 1, endLine: 1, endColumn: 6 })
assert.equal(ci[1].line, 2)
assert.equal(ci[2].line, 3)

// Case-sensitive only matches exact case.
assert.equal(countMatches(source, 'hello', { caseSensitive: true }), 1)
assert.equal(countMatches(source, 'WORLD', { caseSensitive: true }), 1)

// Whole word avoids partial matches.
assert.equal(countMatches('software soft soften', 'soft'), 3)
assert.equal(countMatches('software soft soften', 'soft', { wholeWord: true }), 1)

// Special regex characters are treated literally.
assert.equal(countMatches('a.b a*b axb', 'a.b'), 1)
assert.equal(countMatches('cost is $5 and $5', '$5'), 2)

// replaceAll respects options and treats $ literally in replacement.
assert.equal(replaceAll(source, 'hello', 'hi'), 'hi world\nhi WORLD\nhi there')
assert.equal(replaceAll(source, 'hello', 'hi', { caseSensitive: true }), 'Hello world\nhi WORLD\nHELLO there')
assert.equal(replaceAll('price', 'price', '$100'), '$100')

// replaceRange replaces a single match span.
const first = findMatches(source, 'hello')[0]
assert.equal(replaceRange(source, first.start, first.end, 'Hi'), 'Hi world\nhello WORLD\nHELLO there')

// Empty query yields no matches and no-op replace.
assert.equal(countMatches(source, ''), 0)
assert.equal(replaceAll(source, '', 'x'), source)

console.log('markdown-editor search unit tests passed')
