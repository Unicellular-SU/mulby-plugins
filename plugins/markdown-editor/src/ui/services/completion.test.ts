import assert from 'node:assert/strict'
import type { AiClient } from './ai'
import {
  advanceCompletionByCommit,
  buildCompletionPrompt,
  nextRevealLength,
  requestCompletion
} from './completion'

// With no suffix (caret at line/doc end): prefix is continued directly.
{
  const p = buildCompletionPrompt('今天天气很', '')
  assert.ok(p.system.length > 0)
  assert.ok(p.user.includes('今天天气很'))
  assert.ok(!p.user.includes('【光标】'))
}

// With a suffix: caret position is marked so the completion fits between.
{
  const p = buildCompletionPrompt('开头', '结尾')
  assert.ok(p.user.includes('【光标】'))
  assert.ok(p.user.includes('开头'))
  assert.ok(p.user.includes('结尾'))
}

// System prompt forbids repeating the prefix / adding explanations.
{
  const p = buildCompletionPrompt('x', '')
  assert.ok(p.system.includes('不要') || p.system.includes('绝不'))
}

// IME type-through: committing the resolved CJK characters advances the ghost.
{
  const r = advanceCompletionByCommit('今天天气很好', '今')
  assert.equal(r.matched, true)
  assert.equal(r.rest, '天天气很好')
}

// Multi-character commit consumes the matching prefix.
{
  const r = advanceCompletionByCommit('今天天气很好', '今天天气')
  assert.equal(r.matched, true)
  assert.equal(r.rest, '很好')
}

// Typing the whole suggestion leaves nothing (fully consumed).
{
  const r = advanceCompletionByCommit('今天', '今天')
  assert.equal(r.matched, true)
  assert.equal(r.rest, '')
}

// Mismatch (e.g. user picked a different word) → no advance, drop the ghost.
{
  const r = advanceCompletionByCommit('今天', '明天')
  assert.equal(r.matched, false)
  assert.equal(r.rest, '')
}

// Intermediate pinyin (latin) never matches a CJK suggestion → kept hidden.
{
  const r = advanceCompletionByCommit('今天', 'jin')
  assert.equal(r.matched, false)
}

// Empty committed text (composition not yet resolved / cancelled) → no advance.
{
  const r = advanceCompletionByCommit('今天', '')
  assert.equal(r.matched, false)
}

// Works for latin suggestions too (parity with non-IME type-through).
{
  const r = advanceCompletionByCommit('hello world', 'hello')
  assert.equal(r.matched, true)
  assert.equal(r.rest, ' world')
}

// Typewriter reveal: advances toward the target, eased, and never overshoots.
{
  // Short suggestion still reveals at least one char at a time.
  assert.equal(nextRevealLength(0, 3), 1)
  assert.equal(nextRevealLength(1, 3), 2)
  assert.equal(nextRevealLength(2, 3), 3)
  // Already complete → stays put (loop can stop).
  assert.equal(nextRevealLength(5, 5), 5)
  assert.equal(nextRevealLength(8, 5), 5)
  // Far behind a long target → reveals a bigger eased chunk.
  assert.equal(nextRevealLength(0, 60), 10)
  // Monotonic and bounded across a full run.
  let shown = 0
  let guard = 0
  while (shown < 25 && guard < 1000) {
    const next = nextRevealLength(shown, 25)
    assert.ok(next > shown)
    assert.ok(next <= 25)
    shown = next
    guard += 1
  }
  assert.equal(shown, 25)
}

// requestCompletion: an already-aborted signal returns '' without calling the model.
{
  let called = false
  const ai: AiClient = {
    call: () => {
      called = true
      const p = Promise.resolve({ content: 'x' }) as Promise<unknown> & { abort?: () => void }
      p.abort = () => undefined
      return p
    }
  }
  const controller = new AbortController()
  controller.abort()
  const out = await requestCompletion(ai, undefined, 'prefix', '', controller.signal)
  assert.equal(out, '')
  assert.equal(called, false)
}

// requestCompletion: aborting an in-flight request stops it and resolves to ''
// (this is what supersedes the previous completion when a new one is triggered).
{
  let hostAborted = false
  let resolveCall: (value: unknown) => void = () => undefined
  const ai: AiClient = {
    call: () => {
      const p = new Promise<unknown>((resolve) => {
        resolveCall = resolve
      }) as Promise<unknown> & { abort?: () => void }
      // A host that supports cancellation resolves once aborted.
      p.abort = () => {
        hostAborted = true
        resolveCall({ content: '' })
      }
      return p
    }
  }
  const controller = new AbortController()
  const pending = requestCompletion(ai, undefined, 'prefix', '', controller.signal)
  controller.abort()
  const out = await pending
  assert.equal(hostAborted, true)
  assert.equal(out, '')
}

console.log('markdown-editor completion unit tests passed')
