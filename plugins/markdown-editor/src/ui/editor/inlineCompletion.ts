// Copilot-style inline AI completion (ghost text) for CodeMirror 6.
//
// A StateField holds the current suggestion; it renders as a dimmed widget at
// the caret. Tab accepts it, Escape dismisses it. A ViewPlugin debounces typing
// and requests a completion through an injected fetcher (so this stays decoupled
// from the AI service and unit-testable). IME composition is respected — nothing
// triggers or rebuilds while composing, and "type-through" reconciles against
// the resolved characters at composition end (not the intermediate pinyin).

import { Prec, StateEffect, StateField, type Extension, type Transaction } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  type ViewUpdate
} from '@codemirror/view'
import { advanceCompletionByCommit, nextRevealLength } from '../services/completion'

export interface InlineCompletionConfig {
  /** Whether completion is currently enabled (read live on each trigger). */
  getEnabled: () => boolean
  /**
   * Fetches a completion for the caret context; resolve '' for none. `onPartial`
   * (optional) is called with the growing suggestion so it can stream in.
   */
  fetch: (
    prefix: string,
    suffix: string,
    signal: AbortSignal,
    onPartial?: (text: string) => void
  ) => Promise<string>
  /** Idle delay before requesting (ms). */
  delayMs?: number
}

interface Suggestion {
  /** The full suggestion text (Tab / type-through always operate on this). */
  text: string
  pos: number
  /**
   * How many characters of `text` to actually render — the typewriter reveal.
   * Undefined means "show all". Keeping the full text in state while revealing a
   * prefix lets accept/type-through work on the complete suggestion even while it
   * is still animating in.
   */
  reveal?: number
}

/**
 * Snapshot taken when an IME composition starts: the full ghost text at that
 * moment and the document offset the composition began at. While composing, the
 * per-keystroke insertions are latin pinyin (which never match a CJK ghost), so
 * we hide the ghost and reconcile against the resolved text — `doc[startPos..caret]`
 * — on each composition change, including the final commit.
 */
interface ComposeBaseline {
  baseText: string
  startPos: number
}

interface InlineState {
  suggestion: Suggestion | null
  compose: ComposeBaseline | null
}

const EMPTY_STATE: InlineState = { suggestion: null, compose: null }

const setSuggestion = StateEffect.define<Suggestion | null>()
// Position of the "AI is generating" loading hint, or null to hide it. Shown
// after the debounce while waiting for the first token, so the wait is visible.
const setLoading = StateEffect.define<number | null>()

class GhostWidget extends WidgetType {
  constructor(readonly text: string) {
    super()
  }
  eq(other: GhostWidget) {
    return other.text === this.text
  }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-ghost-text'
    // textContent (never innerHTML) — the suggestion is plain text; pointer
    // events are disabled in CSS so clicks fall through to the editor.
    span.textContent = this.text
    return span
  }
}

// A small animated "···" shown at the caret while a completion is being fetched.
class LoadingWidget extends WidgetType {
  eq() {
    // All loading widgets are interchangeable — keeps the animation from
    // restarting as unrelated state updates flow through.
    return true
  }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-ghost-loading'
    span.setAttribute('aria-label', 'AI 补全生成中')
    for (let i = 0; i < 3; i += 1) {
      span.appendChild(document.createElement('i'))
    }
    return span
  }
  ignoreEvent() {
    return true
  }
}

/**
 * Type-through: when the user types exactly the next character(s) of the showing
 * suggestion at its position, advance it (consume those chars) instead of
 * dropping it — so the ghost stays sticky as you type along. Returns the advanced
 * suggestion, or null when the edit doesn't match (caller then clears).
 */
function advanceOnType(suggestion: Suggestion, tr: Transaction): Suggestion | null {
  const changes: Array<{ from: number; insert: string; replaced: boolean }> = []
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    changes.push({ from: fromA, insert: inserted.toString(), replaced: toA !== fromA })
  })
  // Only a single plain insertion at the suggestion position can advance it.
  if (changes.length !== 1) {
    return null
  }
  const change = changes[0]
  if (change.replaced || change.from !== suggestion.pos || !change.insert) {
    return null
  }
  if (!suggestion.text.startsWith(change.insert)) {
    return null
  }
  const rest = suggestion.text.slice(change.insert.length)
  return rest ? { text: rest, pos: suggestion.pos + change.insert.length } : null
}

/**
 * Handle a composition (IME) transaction. We compare the text resolved so far —
 * `newDoc[startPos..caret]` — against the ghost captured when composition began.
 * During pinyin entry that resolved text is latin and won't match a CJK ghost,
 * so the ghost stays hidden; once the user commits the character(s) it resolves
 * to the real text and the ghost advances (consuming what was typed). This keeps
 * type-through working under IME instead of clearing + re-requesting. Uses only
 * the safe `tr.newDoc` / `tr.newSelection` getters (never `tr.state`).
 */
function reconcileCompose(value: InlineState, tr: Transaction): InlineState {
  // The first change of each composition is tagged `…compose.start`; reset the
  // baseline then so a brand-new composition (e.g. typing the next character
  // right after committing one) doesn't reuse the previous composition's anchor.
  const prev = tr.isUserEvent('input.type.compose.start') ? null : value.compose
  const baseText = prev?.baseText ?? value.suggestion?.text ?? ''
  const startPos = prev?.startPos ?? tr.startState.selection.main.head
  const baseline: ComposeBaseline = { baseText, startPos }
  const caret = tr.newSelection.main.head
  if (!baseText || caret < startPos) {
    return { suggestion: null, compose: baseline }
  }
  const committed = tr.newDoc.sliceString(startPos, caret)
  const { matched, rest } = advanceCompletionByCommit(baseText, committed)
  if (matched) {
    return { suggestion: rest ? { text: rest, pos: caret } : null, compose: baseline }
  }
  // Mid-composition pinyin or a genuine mismatch: hide the ghost but remember
  // the baseline so a later commit in this same composition can still reconcile.
  return { suggestion: null, compose: baseline }
}

const suggestionField = StateField.define<InlineState>({
  create() {
    return EMPTY_STATE
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSuggestion)) {
        return { suggestion: effect.value, compose: null }
      }
    }
    // Composition transactions (incl. the final commit, tagged within ~50ms) are
    // reconciled against the resolved characters rather than the raw pinyin.
    if (tr.isUserEvent('input.type.compose')) {
      return reconcileCompose(value, tr)
    }
    if (tr.docChanged) {
      // Plain edit: keep (advance) the suggestion when the user types straight
      // through it; any leftover compose baseline is no longer relevant.
      const next = value.suggestion ? advanceOnType(value.suggestion, tr) : null
      return { suggestion: next, compose: null }
    }
    // A caret move (without an edit) invalidates a showing suggestion.
    if (tr.selection) {
      return value.suggestion || value.compose ? EMPTY_STATE : value
    }
    // Drop a stale compose baseline left over from a finished composition.
    return value.compose ? { suggestion: value.suggestion, compose: null } : value
  },
  provide: (field) =>
    EditorView.decorations.from(field, (state) => {
      const suggestion = state.suggestion
      if (!suggestion || !suggestion.text) {
        return Decoration.none
      }
      const shown =
        suggestion.reveal == null ? suggestion.text : suggestion.text.slice(0, suggestion.reveal)
      // Nothing revealed yet (reveal 0): keep the loading hint visible instead.
      if (!shown) {
        return Decoration.none
      }
      const pos = Math.min(suggestion.pos, 1e9)
      return Decoration.set([
        Decoration.widget({ widget: new GhostWidget(shown), side: 1 }).range(pos)
      ])
    })
})

function currentSuggestion(view: EditorView): Suggestion | null {
  return view.state.field(suggestionField, false)?.suggestion ?? null
}

// Tracks the loading-hint position. Decoupled from the suggestion so it can
// render before any token arrives and disappear the instant one does.
const loadingField = StateField.define<number | null>({
  create() {
    return null
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      // A suggestion arriving (or being cleared) supersedes the loading hint.
      if (effect.is(setSuggestion)) {
        return null
      }
      if (effect.is(setLoading)) {
        return effect.value
      }
    }
    // Any edit or caret move ends the current fetch's loading state (the
    // in-flight request is aborted by the trigger plugin in the same update).
    if (tr.docChanged || tr.selection) {
      return null
    }
    return value
  },
  provide: (field) =>
    EditorView.decorations.from(field, (pos) => {
      if (pos == null) {
        return Decoration.none
      }
      const at = Math.min(pos, 1e9)
      return Decoration.set([
        Decoration.widget({ widget: new LoadingWidget(), side: 1 }).range(at)
      ])
    })
})

/** Accept (insert) the showing suggestion. Returns false when none shows. */
export function acceptInlineCompletion(view: EditorView): boolean {
  const suggestion = currentSuggestion(view)
  if (!suggestion || !suggestion.text) {
    return false
  }
  const pos = Math.min(suggestion.pos, view.state.doc.length)
  view.dispatch({
    changes: { from: pos, insert: suggestion.text },
    selection: { anchor: pos + suggestion.text.length },
    effects: setSuggestion.of(null),
    userEvent: 'input.complete'
  })
  return true
}

// One "word" of a suggestion: leading whitespace + either a single CJK char or a
// run of non-space, non-CJK characters. Lets Cmd/Ctrl+→ accept English words
// whole and Chinese a character at a time.
const WORD_RE = /^(\s*(?:[\u3400-\u9fff\uf900-\ufaff]|[^\s\u3400-\u9fff\uf900-\ufaff]+))/

/** Accept just the next word of the suggestion; keep the rest as ghost text. */
export function acceptInlineCompletionWord(view: EditorView): boolean {
  const suggestion = currentSuggestion(view)
  if (!suggestion || !suggestion.text) {
    return false
  }
  const match = WORD_RE.exec(suggestion.text)
  const chunk = match ? match[1] : suggestion.text
  if (!chunk) {
    return false
  }
  const pos = Math.min(suggestion.pos, view.state.doc.length)
  const rest = suggestion.text.slice(chunk.length)
  view.dispatch({
    changes: { from: pos, insert: chunk },
    selection: { anchor: pos + chunk.length },
    effects: setSuggestion.of(rest ? { text: rest, pos: pos + chunk.length } : null),
    userEvent: 'input.complete'
  })
  return true
}

/** Dismiss the showing suggestion. Returns false when none shows. */
function dismissInlineCompletion(view: EditorView): boolean {
  if (!currentSuggestion(view)) {
    return false
  }
  view.dispatch({ effects: setSuggestion.of(null) })
  return true
}

/** Imperatively clear any showing suggestion or loading hint (e.g. when the feature is toggled off). */
export function clearInlineCompletion(view: EditorView): void {
  const hasSuggestion = currentSuggestion(view) != null
  const hasLoading = view.state.field(loadingField, false) != null
  if (hasSuggestion || hasLoading) {
    // Clearing the suggestion also clears the loading hint (loadingField rule).
    view.dispatch({ effects: setSuggestion.of(null) })
  }
}

const PREFIX_CHARS = 2000
const SUFFIX_CHARS = 400
const MIN_PREFIX = 1
// Cadence of the typewriter ghost-text reveal (ms between steps).
const REVEAL_INTERVAL_MS = 28

function triggerPlugin(config: InlineCompletionConfig) {
  const delay = config.delayMs ?? 500
  return ViewPlugin.fromClass(
    class {
      timer = 0
      controller: AbortController | null = null
      // Typewriter reveal state for the current request.
      revealTimer = 0
      revealPos: number | null = null
      revealTarget = ''
      revealShown = 0
      revealFinal = false
      constructor(readonly view: EditorView) {}
      update(update: ViewUpdate) {
        if (!update.docChanged && !update.selectionSet) {
          return
        }
        // Edit / caret move → cancel any pending request (the field already
        // cleared a showing suggestion); reschedule when enabled & not composing.
        this.cancel()
        if (!config.getEnabled() || update.view.composing) {
          return
        }
        // A suggestion still showing means the user typed straight through it or
        // accepted a word — keep it instead of firing a fresh request.
        if (update.state.field(suggestionField, false)?.suggestion) {
          return
        }
        this.schedule()
      }
      schedule() {
        window.clearTimeout(this.timer)
        this.timer = window.setTimeout(() => void this.request(), delay)
      }
      cancel() {
        window.clearTimeout(this.timer)
        this.controller?.abort()
        this.controller = null
        this.stopReveal()
      }
      clearLoading() {
        if (this.view.state.field(loadingField, false) != null) {
          this.view.dispatch({ effects: setLoading.of(null) })
        }
      }
      // --- Typewriter reveal -------------------------------------------------
      // Reveals the ghost text progressively (a steady "types out" feel) whether
      // the host streams tokens over time or returns the whole completion at once.
      // The full text always lives in state; only the rendered prefix grows.
      startReveal(pos: number) {
        this.stopReveal()
        this.revealPos = pos
      }
      pushTarget(text: string) {
        if (this.revealPos == null || text.length <= this.revealTarget.length) {
          return
        }
        this.revealTarget = text
        this.ensureRevealRunning()
      }
      finishReveal(text: string) {
        if (this.revealPos == null) {
          return
        }
        // The final text is authoritative (it may be shorter than streamed
        // partials, e.g. after stripping a code fence the model added).
        this.revealTarget = text
        this.revealFinal = true
        if (this.revealShown >= text.length) {
          // Already fully revealed (or the host returned everything at once and
          // nothing more remains) → settle on the full final text now.
          this.commitReveal(text, this.revealPos, undefined)
          this.stopReveal()
          return
        }
        this.ensureRevealRunning()
      }
      ensureRevealRunning() {
        if (this.revealTimer || this.revealPos == null) {
          return
        }
        if (this.revealShown >= this.revealTarget.length) {
          return
        }
        this.revealTimer = window.setTimeout(() => this.tickReveal(), REVEAL_INTERVAL_MS)
      }
      tickReveal() {
        this.revealTimer = 0
        if (this.revealPos == null) {
          return
        }
        const targetLen = this.revealTarget.length
        const next = nextRevealLength(this.revealShown, targetLen)
        if (next !== this.revealShown) {
          // Bail if the caret moved off the anchor while animating.
          const live = this.view.state.selection.main
          if (!live.empty || live.head !== this.revealPos) {
            this.stopReveal()
            return
          }
          this.revealShown = next
          const full = this.revealFinal && next >= targetLen
          this.commitReveal(this.revealTarget, this.revealPos, full ? undefined : next)
        }
        if (this.revealShown >= this.revealTarget.length) {
          // Caught up. Stop if we have the final text; otherwise wait for the
          // next streamed chunk to resume via pushTarget → ensureRevealRunning.
          if (this.revealFinal) {
            this.stopReveal()
          }
          return
        }
        this.revealTimer = window.setTimeout(() => this.tickReveal(), REVEAL_INTERVAL_MS)
      }
      commitReveal(text: string, pos: number, reveal: number | undefined) {
        this.view.dispatch({ effects: setSuggestion.of({ text, pos, reveal }) })
      }
      stopReveal() {
        if (this.revealTimer) {
          window.clearTimeout(this.revealTimer)
          this.revealTimer = 0
        }
        this.revealPos = null
        this.revealTarget = ''
        this.revealShown = 0
        this.revealFinal = false
      }
      async request() {
        const view = this.view
        if (!config.getEnabled() || view.composing || !view.hasFocus) {
          return
        }
        const sel = view.state.selection.main
        if (!sel.empty) {
          return
        }
        const pos = sel.head
        const doc = view.state.doc
        const line = doc.lineAt(pos)
        // Only at a word / line boundary — never mid-word.
        const nextChar = pos < line.to ? doc.sliceString(pos, pos + 1) : ''
        if (nextChar && !/\s/.test(nextChar)) {
          return
        }
        const prefix = doc.sliceString(Math.max(0, pos - PREFIX_CHARS), pos)
        if (prefix.trim().length < MIN_PREFIX) {
          return
        }
        const suffix = doc.sliceString(pos, Math.min(doc.length, pos + SUFFIX_CHARS))
        const controller = new AbortController()
        this.controller = controller
        // Show the loading hint at the caret while we wait for the first token.
        // It's cleared automatically once the ghost starts revealing, or by any
        // edit / caret move (which also aborts this request), or on the paths below.
        view.dispatch({ effects: setLoading.of(pos) })
        this.startReveal(pos)
        // Feed streamed partials into the typewriter reveal (only while the caret
        // stays put). The reveal types the text out smoothly regardless of how the
        // host chunks it — even a single all-at-once response still streams in.
        const onPartial = (partial: string) => {
          if (controller.signal.aborted) {
            return
          }
          const live = view.state.selection.main
          if (!live.empty || live.head !== pos) {
            return
          }
          this.pushTarget(partial.replace(/\s+$/, ''))
        }
        let text = ''
        try {
          text = await config.fetch(prefix, suffix, controller.signal, onPartial)
        } catch {
          this.stopReveal()
          this.clearLoading()
          return
        }
        if (controller.signal.aborted) {
          // A new trigger superseded this one; its edit/caret move already
          // cleared the loading hint and reveal, so nothing to do here.
          return
        }
        // Discard if the caret moved while waiting.
        const now = view.state.selection.main
        if (!now.empty || now.head !== pos) {
          this.stopReveal()
          this.clearLoading()
          return
        }
        const cleaned = text.replace(/\s+$/, '')
        if (!cleaned) {
          this.stopReveal()
          this.clearLoading()
          return
        }
        // Hand the final text to the reveal: it types out any remainder, then settles.
        this.finishReveal(cleaned)
      }
      destroy() {
        this.cancel()
      }
    }
  )
}

const completionKeymap = Prec.highest(
  keymap.of([
    { key: 'Tab', run: acceptInlineCompletion },
    // Copilot-style accept-one-word; falls through to caret navigation when no
    // suggestion is showing.
    { key: 'Mod-ArrowRight', run: acceptInlineCompletionWord },
    { key: 'Escape', run: dismissInlineCompletion }
  ])
)

/** The inline AI completion (ghost text) extension. */
export function inlineCompletion(config: InlineCompletionConfig): Extension {
  return [suggestionField, loadingField, triggerPlugin(config), completionKeymap]
}
