import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const mainSource = await readFile(path.resolve(import.meta.dirname, '../src/main.ts'), 'utf8')

test('rpc methods do not reuse legacy host methods that expect injected context', () => {
  assert.doesNotMatch(mainSource, /export const rpc\s*=\s*\{[\s\S]*runBackendExample:\s*host\.runBackendExample/)
  assert.doesNotMatch(mainSource, /export const rpc\s*=\s*\{[\s\S]*echo:\s*host\.echo/)
})

test('backend examples can use the UtilityProcess global mulby API from rpc calls', () => {
  assert.match(mainSource, /function\s+backendApi\(\)/)
  assert.match(mainSource, /globalThis\s+as\s+typeof globalThis\s+&\s+\{\s+mulby\?: any\s+\}/)
  assert.match(mainSource, /throw new Error\('Mulby backend API is not available/)
})

test('filesystem backend example only uses Mulby unlink for files', () => {
  const match = mainSource.match(/async function filesystemRoundtrip[\s\S]*?\n}\n\nasync function windowDragFile/)
  assert.ok(match, 'filesystemRoundtrip function not found')
  assert.doesNotMatch(match[0], /api\.filesystem\.unlink\(dirPath\)/)
  assert.match(match[0], /rmSync\(dirPath,\s*\{\s*recursive:\s*true,\s*force:\s*true\s*\}\)/)
})

test('clipboard history demos run through backend api instead of missing renderer preload api', () => {
  assert.match(mainSource, /async function clipboardHistoryStats\(api: any\)/)
  assert.match(mainSource, /api\.clipboardHistory\.stats\(\)/)
  assert.match(mainSource, /async function clipboardHistoryQuery\(api: any\)/)
  assert.match(mainSource, /api\.clipboardHistory\.query\(\{\s*limit: 5\s*\}\)/)
  assert.match(mainSource, /clipboardHistoryDeleteGuard/)
})
