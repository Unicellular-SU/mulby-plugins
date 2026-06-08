import assert from 'node:assert/strict'
import {
  AI_ACTIONS,
  REFINE_PRESETS,
  TRANSLATE_LANGUAGES,
  buildPrompt,
  buildRefinePrompt,
  extractAiText,
  getAiAction,
  isReasoningModel,
  runAiAction,
  stripCodeFence,
  type AiChunk,
  type AiClient
} from './ai'

// isReasoningModel: trust the host's (models.dev-backed) reasoning capability flag.
{
  assert.equal(isReasoningModel({ capabilities: [{ type: 'reasoning' }] }), true)
  assert.equal(isReasoningModel({ capabilities: [{ type: 'text' }, { type: 'reasoning' }] }), true)
  assert.equal(isReasoningModel({ capabilities: [{ type: 'text' }, { type: 'function_calling' }] }), false)
  assert.equal(isReasoningModel({ capabilities: [] }), false)
  assert.equal(isReasoningModel({}), false)
  assert.equal(isReasoningModel(undefined), false)
}

// Action metadata is well-formed
assert.ok(AI_ACTIONS.length >= 5)
assert.equal(getAiAction('translate').id, 'translate')
assert.equal(getAiAction('translate').needsLanguage, true)
assert.equal(getAiAction('custom').needsInstruction, true)
assert.equal(getAiAction('polish').needsSelection, true)
// "问一问" (ask) explains the selection and requires a selection
assert.equal(getAiAction('ask').id, 'ask')
assert.equal(getAiAction('ask').needsSelection, true)
assert.equal(getAiAction('ask').needsLanguage, false)
assert.equal(getAiAction('ask').needsInstruction, false)
// Unknown id falls back to the first action
assert.equal(getAiAction('nope' as never).id, AI_ACTIONS[0].id)
assert.ok(TRANSLATE_LANGUAGES.some((lang) => lang.value === '英文'))

// buildPrompt: each action wraps the source and produces a non-empty system prompt
{
  const polish = buildPrompt({ action: 'polish', text: 'hello world' })
  assert.ok(polish.system.length > 0)
  assert.ok(polish.user.includes('hello world'))
  assert.ok(polish.user.includes('<<<SOURCE'))
  assert.ok(polish.user.includes('SOURCE>>>'))
}

{
  // polish/translate include surrounding context as a separate read-only block
  const withCtx = buildPrompt({ action: 'polish', text: '选中片段', context: '前后文参考' })
  assert.ok(withCtx.user.includes('<<<CONTEXT'))
  assert.ok(withCtx.user.includes('前后文参考'))
  assert.ok(withCtx.user.includes('<<<SOURCE'))
  // no context → no CONTEXT block
  const noCtx = buildPrompt({ action: 'polish', text: '选中片段' })
  assert.ok(!noCtx.user.includes('<<<CONTEXT'))
  const transCtx = buildPrompt({ action: 'translate', text: 'hi', language: '日文', context: 'surrounding' })
  assert.ok(transCtx.user.includes('<<<CONTEXT'))
  assert.ok(transCtx.user.includes('surrounding'))
}

{
  const translate = buildPrompt({ action: 'translate', text: '你好', language: '日文' })
  assert.ok(translate.user.includes('日文'))
  assert.ok(translate.user.includes('你好'))
}

{
  // translate without language defaults to 英文
  const translate = buildPrompt({ action: 'translate', text: 'x' })
  assert.ok(translate.user.includes('英文'))
}

{
  // continue prefers documentText context when provided
  const cont = buildPrompt({ action: 'continue', text: 'sel', documentText: 'full doc' })
  assert.ok(cont.user.includes('full doc'))
  assert.ok(!cont.user.includes('sel'))
}

{
  const summarize = buildPrompt({ action: 'summarize', text: 'a long article' })
  assert.ok(summarize.user.includes('a long article'))
  assert.ok(summarize.system.includes('要点'))
}

{
  // ask wraps the source and asks the model to explain it (not rewrite it)
  const ask = buildPrompt({ action: 'ask', text: '量子纠缠' })
  assert.ok(ask.user.includes('量子纠缠'))
  assert.ok(ask.user.includes('<<<SOURCE'))
  assert.ok(ask.system.includes('解释'))
}

{
  // custom uses the instruction, falling back to a default when empty
  const custom = buildPrompt({ action: 'custom', text: 'body', instruction: '改成标题' })
  assert.ok(custom.user.includes('改成标题'))
  assert.ok(custom.user.includes('body'))
  assert.ok(custom.user.includes('<<<SOURCE'))
  const fallback = buildPrompt({ action: 'custom', text: 'body', instruction: '   ' })
  assert.ok(fallback.user.includes('请改进'))
}

{
  // custom with no source text → pure generation: instruction only, no SOURCE block
  const gen = buildPrompt({ action: 'custom', text: '', instruction: '写一首关于春天的诗' })
  assert.ok(gen.user.includes('写一首关于春天的诗'))
  assert.ok(!gen.user.includes('<<<SOURCE'))
  // whitespace-only source is treated the same as empty
  const genWs = buildPrompt({ action: 'custom', text: '   \n  ', instruction: '列出三个要点' })
  assert.ok(!genWs.user.includes('<<<SOURCE'))
}

{
  // buildRefinePrompt wraps the previous output + the follow-up instruction
  const refine = buildRefinePrompt('上一轮结果', '再短一点')
  assert.ok(refine.user.includes('再短一点'))
  assert.ok(refine.user.includes('上一轮结果'))
  assert.ok(refine.user.includes('<<<SOURCE'))
  assert.ok(refine.system.length > 0)
  // empty instruction falls back to a default
  assert.ok(buildRefinePrompt('x', '   ').user.includes('请进一步改进'))
  // refine presets are well-formed
  assert.ok(REFINE_PRESETS.length >= 3)
  assert.ok(REFINE_PRESETS.every((p) => p.id && p.label && p.instruction))
}

// extractAiText: string / array / null handling
assert.equal(extractAiText('plain'), 'plain')
assert.equal(extractAiText(null), '')
assert.equal(extractAiText(undefined), '')
assert.equal(
  extractAiText([
    { type: 'text', text: 'a' },
    { type: 'image', text: 'should-skip' },
    { type: 'text', text: 'b' }
  ]),
  'ab'
)

// stripCodeFence: removes a wrapping fence, keeps inner content
assert.equal(stripCodeFence('```\nhi\n```'), 'hi')
assert.equal(stripCodeFence('```markdown\n# Title\n```'), '# Title')
assert.equal(stripCodeFence('no fence here'), 'no fence here')
assert.equal(stripCodeFence('  spaced  '), 'spaced')

// runAiAction: streams deltas and resolves with accumulated text
{
  const deltas: string[] = []
  const ai: AiClient = {
    call: (_option, onChunk) => {
      onChunk?.({ chunkType: 'text', content: 'Hel' } as AiChunk)
      onChunk?.({ chunkType: 'text', content: 'lo' } as AiChunk)
      const promise = Promise.resolve({ content: 'Hello' } as AiChunk) as Promise<AiChunk> & { abort?: () => void }
      promise.abort = () => undefined
      return promise
    }
  }
  const handle = runAiAction({
    ai,
    prompt: { system: 's', user: 'u' },
    onDelta: (text) => deltas.push(text)
  })
  const result = await handle.result
  assert.deepEqual(deltas, ['Hel', 'lo'])
  assert.equal(result.text, 'Hello')
  assert.equal(result.aborted, false)
}

// runAiAction: keeps accumulated text when final content is shorter/empty
{
  const ai: AiClient = {
    call: (_option, onChunk) => {
      onChunk?.({ chunkType: 'text', content: 'streamed-only' } as AiChunk)
      const promise = Promise.resolve({ content: '' } as AiChunk) as Promise<AiChunk> & { abort?: () => void }
      promise.abort = () => undefined
      return promise
    }
  }
  const result = await runAiAction({ ai, prompt: { system: 's', user: 'u' } }).result
  assert.equal(result.text, 'streamed-only')
}

// runAiAction: surfaces a final error message as a thrown error
{
  const ai: AiClient = {
    call: () => {
      const promise = Promise.resolve({ error: { message: '配额不足' } } as AiChunk) as Promise<AiChunk> & {
        abort?: () => void
      }
      promise.abort = () => undefined
      return promise
    }
  }
  await assert.rejects(runAiAction({ ai, prompt: { system: 's', user: 'u' } }).result, /配额不足/)
}

// runAiAction: missing ai.call rejects gracefully
{
  const handle = runAiAction({ ai: {} as AiClient, prompt: { system: 's', user: 'u' } })
  await assert.rejects(handle.result, /Mulby AI/)
}

console.log('markdown-editor ai unit tests passed')
