import { formatPetPresentationLog } from './presentation-debug'

function assertEqual<T>(actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}

function testFormatLogHasStablePrefixAndEvent() {
  const line = formatPetPresentationLog('ai.tool-call', { name: 'pet_show_expression' })

  assert(line.startsWith('[desktop-pet][presentation] ai.tool-call '), 'log should be one copyable line')
  assert(line.includes('"name":"pet_show_expression"'), 'detail should be JSON, not [object Object]')
  assert(!line.includes('[object Object]'), 'object detail should not be stringified by the host logger')
}

function testFormatLogTruncatesLongStrings() {
  const line = formatPetPresentationLog('ai.text', { preview: 'x'.repeat(220) })
  const jsonText = line.slice(line.indexOf('{'))
  const detail = JSON.parse(jsonText) as { preview: string }

  assert(detail.preview.length < 220, 'long log strings should be truncated')
  assert(detail.preview.includes('220 chars'), 'truncated string should retain original length')
}

testFormatLogHasStablePrefixAndEvent()
testFormatLogTruncatesLongStrings()
