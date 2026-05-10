import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const css = await readFile(path.resolve(import.meta.dirname, '../src/ui/styles.css'), 'utf8')
const app = await readFile(path.resolve(import.meta.dirname, '../src/ui/App.tsx'), 'utf8')

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 's'))?.[1] ?? ''
}

test('root layout constrains the app to the viewport instead of forcing page overflow', () => {
  assert.match(rule('html, body, #root'), /height:\s*100%/)
  assert.doesNotMatch(rule('body'), /min-width:\s*860px/)
  assert.match(rule('body'), /overflow:\s*hidden/)
  assert.match(rule('.app-shell'), /height:\s*100vh/)
  assert.match(rule('.app-shell'), /min-height:\s*0/)
  assert.match(rule('.app-shell'), /overflow:\s*hidden/)
})

test('sidebar, content, and cards can shrink and scroll independently', () => {
  assert.match(rule('.sidebar'), /min-height:\s*0/)
  assert.match(rule('.sidebar'), /overflow-y:\s*auto/)
  assert.match(rule('.content'), /min-height:\s*0/)
  assert.match(rule('.content'), /overflow-y:\s*auto/)
  assert.doesNotMatch(rule('.detail-grid'), /minmax\(420px/)
  assert.match(rule('.detail-grid'), /grid-template-columns:\s*minmax\(0,\s*1fr\)/)
  assert.match(rule('.example-card'), /min-width:\s*0/)
  assert.match(rule('pre'), /overflow-x:\s*auto/)
  assert.match(rule('pre'), /white-space:\s*pre-wrap/)
})

test('method chips are interactive controls with visible selected state', () => {
  assert.match(rule('.method-chip'), /cursor:\s*pointer/)
  assert.match(rule('.method-chip'), /background:\s*transparent/)
  assert.match(rule('.method-chip.active code'), /background:\s*#19324d/)
  assert.match(rule('.method-detail'), /overflow-wrap|padding:\s*12px/)
})

test('playground layout prioritizes live controls and keeps code secondary', () => {
  assert.match(rule('.playground-panel'), /min-width:\s*0/)
  assert.match(rule('.playground-grid'), /grid-template-columns:\s*minmax\(0,\s*0\.9fr\)\s+minmax\(0,\s*1\.1fr\)/)
  assert.match(rule('.playground-controls'), /display:\s*grid/)
  assert.match(rule('.playground-output'), /min-height:\s*220px/)
  assert.match(rule('.code-disclosure summary'), /cursor:\s*pointer/)
})

test('playground output is colocated with controls instead of a bottom-only result panel', () => {
  assert.match(app, /className="playground-output"/)
  assert.match(app, /selected\.playground \? null : \(/)
  assert.match(rule('.result-panel.inline'), /margin-top:\s*0/)
  assert.match(rule('.result pre'), /max-height:\s*360px/)
})

test('activity log is a global top-right toggle instead of a per-module panel', () => {
  assert.match(app, /setLogOpen/)
  assert.match(app, /className="activity-toggle"/)
  assert.match(app, /className="activity-popover"/)
  assert.doesNotMatch(app, /className="playground-observer"/)
  assert.match(rule('.activity-wrap'), /position:\s*relative/)
  assert.match(rule('.activity-popover'), /position:\s*absolute/)
  assert.match(rule('.activity-popover'), /right:\s*0/)
})

test('methods and examples stack vertically to avoid cramped side-by-side reading', () => {
  assert.match(rule('.detail-grid'), /grid-template-columns:\s*minmax\(0,\s*1fr\)/)
  assert.match(rule('.examples-panel'), /margin-top:\s*16px/)
})
