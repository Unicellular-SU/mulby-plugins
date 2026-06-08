import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import 'katex/dist/katex.min.css'
import { Compartment, EditorSelection, EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { codeFolding, foldKeymap, HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { createMarkdownLanguage } from './markdownLanguage'
import { listFoldService } from './listFold'
import { imageUrlResolver, livePreviewExtension } from './livePreview'
import { clearInlineCompletion, inlineCompletion } from './inlineCompletion'
import { runMarkdownCommand, type CommandPayload } from './markdownCommands'

export interface EditorSelectionInfo {
  text: string
  from: number
  to: number
  hasFocus: boolean
}

export interface SelectionRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

/** Imperative API exposed to App — mirrors what the previous editor offered. */
export interface LiveMarkdownEditorHandle {
  getValue: () => string
  setValue: (value: string, options?: { resetHistory?: boolean }) => void
  focus: () => void
  getSelectedText: () => string
  getSelection: () => { from: number; to: number }
  setSelection: (from: number, to: number) => void
  replaceSelection: (text: string, range?: { from: number; to: number } | null) => void
  insertText: (text: string) => void
  runCommand: (name: string, payload?: CommandPayload) => void
  getSelectionRect: () => SelectionRect | null
  scrollToPos: (pos: number) => void
  posForLine: (line: number) => number
  lineForPos: (pos: number) => number
  getView: () => EditorView | null
  /** Snapshot of the current state (per-tab history/selection live here). */
  getState: () => EditorState | null
  /** Build a fresh state for `value`, wired with the same extensions/compartments. */
  createState: (value: string) => EditorState
  /** Load a previously snapshotted state, re-asserting the current theme/resolver. */
  swapState: (state: EditorState) => void
}

interface LiveMarkdownEditorProps {
  initialValue: string
  theme: 'light' | 'dark'
  placeholder?: string
  onChange: (value: string) => void
  onSelectionChange?: (info: EditorSelectionInfo) => void
  resolveImageUrl?: (href: string) => string
  /** Whether inline AI completion (ghost text) is enabled. */
  completionEnabled?: boolean
  /** Fetches an inline completion for the caret context; resolve '' for none. */
  requestCompletion?: (
    prefix: string,
    suffix: string,
    signal: AbortSignal,
    onPartial?: (text: string) => void
  ) => Promise<string>
}

const markdownHighlight = HighlightStyle.define([
  // Markdown structure (mostly applies to the revealed source on the active line).
  { tag: tags.heading1, fontWeight: '700' },
  { tag: tags.heading2, fontWeight: '700' },
  { tag: tags.heading3, fontWeight: '700' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'var(--accent)' },
  { tag: tags.url, color: 'var(--text-muted)' },
  { tag: tags.meta, color: 'var(--text-muted)' },
  // Code token colors — theme-aware via CSS vars defined in styles.css so they
  // adapt to light/dark. Drives fenced-code highlighting (codeLanguages).
  { tag: tags.keyword, color: 'var(--cm-keyword)' },
  { tag: tags.tagName, color: 'var(--cm-keyword)' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--cm-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--cm-number)' },
  { tag: tags.comment, color: 'var(--cm-comment)', fontStyle: 'italic' },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: 'var(--cm-function)'
  },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--cm-type)' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--cm-property)' },
  { tag: [tags.operator, tags.punctuation, tags.separator, tags.derefOperator], color: 'var(--cm-punct)' },
  { tag: tags.variableName, color: 'var(--cm-variable)' }
])

const baseTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '15px', color: 'var(--text-primary)' },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: '1.75',
    overflow: 'auto',
    padding: '12px 0'
  },
  '.cm-content': { maxWidth: '820px', margin: '0 auto', padding: '0 16px', caretColor: 'var(--accent)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-line': { padding: '0' }
})

function themeExtension(mode: 'light' | 'dark') {
  return EditorView.theme({ '&': {} }, { dark: mode === 'dark' })
}

export const LiveMarkdownEditor = forwardRef<LiveMarkdownEditorHandle, LiveMarkdownEditorProps>(
  function LiveMarkdownEditor(
    {
      initialValue,
      theme,
      placeholder,
      onChange,
      onSelectionChange,
      resolveImageUrl,
      completionEnabled,
      requestCompletion
    },
    ref
  ) {
    const hostRef = useRef<HTMLDivElement>(null)
    const viewRef = useRef<EditorView | null>(null)
    const themeCompartment = useMemo(() => new Compartment(), [])
    const resolverCompartment = useMemo(() => new Compartment(), [])
    // Keep latest callbacks without re-creating the editor.
    const onChangeRef = useRef(onChange)
    const onSelectionChangeRef = useRef(onSelectionChange)
    onChangeRef.current = onChange
    onSelectionChangeRef.current = onSelectionChange
    // Inline-completion config read live by the CM extension (no rebuild needed).
    const completionEnabledRef = useRef(completionEnabled)
    const requestCompletionRef = useRef(requestCompletion)
    completionEnabledRef.current = completionEnabled
    requestCompletionRef.current = requestCompletion
    // Mirror theme/resolver so freshly built states (new tabs) start with the
    // current config instead of whatever was captured at first render.
    const themeRef = useRef(theme)
    const resolverRef = useRef(resolveImageUrl)
    themeRef.current = theme
    resolverRef.current = resolveImageUrl
    // True while a tab-swap (view.setState) is in flight, so the change/selection
    // listeners don't fire onChange or pop the AI bubble for the restored state.
    const swappingRef = useRef(false)
    // True while the mouse button is held inside the editor (dragging out a
    // selection). Selection reports are deferred until release so the floating
    // AI bubble appears only after the selection is finished, not mid-drag.
    const pointerDownRef = useRef(false)

    const emitSelection = useCallback((view: EditorView) => {
      const main = view.state.selection.main
      onSelectionChangeRef.current?.({
        text: view.state.sliceDoc(main.from, main.to),
        from: main.from,
        to: main.to,
        hasFocus: view.hasFocus
      })
    }, [])

    const buildExtensions = useMemo(
      () => () =>
        [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap]),
          EditorView.lineWrapping,
          createMarkdownLanguage(),
          syntaxHighlighting(markdownHighlight),
          codeFolding(),
          listFoldService,
          livePreviewExtension(),
          inlineCompletion({
            getEnabled: () => completionEnabledRef.current === true,
            fetch: (prefix, suffix, signal, onPartial) =>
              requestCompletionRef.current
                ? requestCompletionRef.current(prefix, suffix, signal, onPartial)
                : Promise.resolve('')
          }),
          resolverCompartment.of(imageUrlResolver.of(resolverRef.current ?? ((href: string) => href))),
          themeCompartment.of([baseTheme, themeExtension(themeRef.current)]),
          cmPlaceholder(placeholder ?? ''),
          EditorView.updateListener.of((update) => {
            // Loading a tab snapshot must not look like a user edit or selection.
            if (swappingRef.current) {
              return
            }
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString())
            }
            if (update.selectionSet || update.docChanged || update.focusChanged) {
              // Suppress selection reporting while a mouse drag is in progress;
              // the window 'mouseup' handler emits the final selection once.
              if (pointerDownRef.current) {
                return
              }
              emitSelection(update.view)
            }
          })
        ],
      // eslint-disable-next-line react-hooks/exhaustive-deps
      []
    )

    useEffect(() => {
      const host = hostRef.current
      if (!host) {
        return
      }
      const view = new EditorView({
        parent: host,
        state: EditorState.create({ doc: initialValue, extensions: buildExtensions() })
      })
      viewRef.current = view

      // Track the drag so selection is only reported on release. mousedown is
      // scoped to the editor (only editor drags count); mouseup listens on the
      // window so a drag that ends outside the editor still resolves.
      const onPointerDown = () => {
        pointerDownRef.current = true
      }
      const onPointerUp = () => {
        if (!pointerDownRef.current) {
          return
        }
        pointerDownRef.current = false
        // Defer one frame so CodeMirror has finalized the selection from this
        // mouseup before we read and report it.
        requestAnimationFrame(() => {
          if (viewRef.current) {
            emitSelection(viewRef.current)
          }
        })
      }
      view.dom.addEventListener('mousedown', onPointerDown)
      window.addEventListener('mouseup', onPointerUp)

      return () => {
        view.dom.removeEventListener('mousedown', onPointerDown)
        window.removeEventListener('mouseup', onPointerUp)
        view.destroy()
        viewRef.current = null
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Reconfigure theme when the prop changes. Re-assert the current selection in
    // the same transaction so the live-preview block decorations rebuild and
    // theme-aware widgets (e.g. mermaid diagrams) re-render for the new theme.
    useEffect(() => {
      const view = viewRef.current
      if (!view) {
        return
      }
      view.dispatch({
        effects: themeCompartment.reconfigure([baseTheme, themeExtension(theme)]),
        selection: view.state.selection
      })
    }, [theme, themeCompartment])

    // Reconfigure the image resolver when it changes.
    useEffect(() => {
      viewRef.current?.dispatch({
        effects: resolverCompartment.reconfigure(
          imageUrlResolver.of(resolveImageUrl ?? ((href: string) => href))
        )
      })
    }, [resolveImageUrl, resolverCompartment])

    // Clear any showing ghost text when inline completion is turned off.
    useEffect(() => {
      const view = viewRef.current
      if (view && !completionEnabled) {
        clearInlineCompletion(view)
      }
    }, [completionEnabled])

    useImperativeHandle(
      ref,
      (): LiveMarkdownEditorHandle => ({
        getValue: () => viewRef.current?.state.doc.toString() ?? '',
        setValue: (value, options) => {
          const view = viewRef.current
          if (!view) {
            return
          }
          if (options?.resetHistory) {
            view.setState(EditorState.create({ doc: value, extensions: buildExtensions() }))
            return
          }
          const current = view.state.doc.toString()
          if (current === value) {
            return
          }
          // Never push an external value into the view while an IME composition
          // is active — replacing the surrounding text corrupts composition and
          // jumps the caret (CodeMirror dispatches a transaction per compose
          // keystroke). It reconciles naturally once composition commits.
          if (view.composing) {
            return
          }
          // Replace only the differing middle so the caret/selection is
          // preserved instead of being reset to the document start.
          let start = 0
          const minLen = Math.min(current.length, value.length)
          while (start < minLen && current.charCodeAt(start) === value.charCodeAt(start)) {
            start += 1
          }
          let endCur = current.length
          let endVal = value.length
          while (
            endCur > start &&
            endVal > start &&
            current.charCodeAt(endCur - 1) === value.charCodeAt(endVal - 1)
          ) {
            endCur -= 1
            endVal -= 1
          }
          view.dispatch({ changes: { from: start, to: endCur, insert: value.slice(start, endVal) } })
        },
        focus: () => viewRef.current?.focus(),
        getSelectedText: () => {
          const view = viewRef.current
          if (!view) {
            return ''
          }
          const main = view.state.selection.main
          return view.state.sliceDoc(main.from, main.to)
        },
        getSelection: () => {
          const main = viewRef.current?.state.selection.main
          return { from: main?.from ?? 0, to: main?.to ?? 0 }
        },
        setSelection: (from, to) => {
          const view = viewRef.current
          if (!view) {
            return
          }
          const max = view.state.doc.length
          view.dispatch({ selection: EditorSelection.range(Math.min(from, max), Math.min(to, max)) })
        },
        replaceSelection: (text, range) => {
          const view = viewRef.current
          if (!view) {
            return
          }
          const target = range ?? view.state.selection.main
          view.dispatch({
            changes: { from: target.from, to: target.to, insert: text },
            selection: EditorSelection.cursor(target.from + text.length)
          })
          view.focus()
        },
        insertText: (text) => {
          const view = viewRef.current
          if (!view) {
            return
          }
          const range = view.state.selection.main
          view.dispatch({
            changes: { from: range.from, to: range.to, insert: text },
            selection: EditorSelection.cursor(range.from + text.length)
          })
          view.focus()
        },
        runCommand: (name, payload) => {
          const view = viewRef.current
          if (view) {
            runMarkdownCommand(view, name, payload)
          }
        },
        getSelectionRect: () => {
          const view = viewRef.current
          if (!view) {
            return null
          }
          const main = view.state.selection.main
          const start = view.coordsAtPos(main.from)
          const end = view.coordsAtPos(main.to)
          if (!start || !end) {
            return null
          }
          const left = Math.min(start.left, end.left)
          const right = Math.max(start.right, end.right)
          const top = Math.min(start.top, end.top)
          const bottom = Math.max(start.bottom, end.bottom)
          return { left, top, right, bottom, width: right - left, height: bottom - top }
        },
        scrollToPos: (pos) => {
          const view = viewRef.current
          if (!view) {
            return
          }
          const max = view.state.doc.length
          const target = Math.min(Math.max(pos, 0), max)
          view.dispatch({ effects: EditorView.scrollIntoView(target, { y: 'start', yMargin: 24 }) })
        },
        posForLine: (line) => {
          const view = viewRef.current
          if (!view) {
            return 0
          }
          const clamped = Math.min(Math.max(line, 1), view.state.doc.lines)
          return view.state.doc.line(clamped).from
        },
        lineForPos: (pos) => viewRef.current?.state.doc.lineAt(Math.max(0, pos)).number ?? 1,
        getView: () => viewRef.current,
        getState: () => viewRef.current?.state ?? null,
        createState: (value) =>
          EditorState.create({ doc: value, extensions: buildExtensions() }),
        swapState: (state) => {
          const view = viewRef.current
          if (!view) {
            return
          }
          // Suppress change/selection reporting for the whole swap (setState +
          // reconfigure + focus) so the restored state doesn't masquerade as an
          // edit or summon the AI bubble.
          swappingRef.current = true
          view.setState(state)
          // The snapshot may carry stale theme/resolver compartment config if the
          // theme or bound document changed while this tab was inactive.
          view.dispatch({
            effects: [
              themeCompartment.reconfigure([baseTheme, themeExtension(themeRef.current)]),
              resolverCompartment.reconfigure(
                imageUrlResolver.of(resolverRef.current ?? ((href: string) => href))
              )
            ]
          })
          view.focus()
          requestAnimationFrame(() => {
            swappingRef.current = false
          })
        }
      }),
      [buildExtensions, themeCompartment, resolverCompartment, resolveImageUrl]
    )

    return <div ref={hostRef} className="cm-editor-host" />
  }
)
