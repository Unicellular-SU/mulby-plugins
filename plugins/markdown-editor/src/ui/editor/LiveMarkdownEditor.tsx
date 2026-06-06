import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { Compartment, EditorSelection, EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { createMarkdownLanguage } from './markdownLanguage'
import { imageUrlResolver, livePreviewExtension } from './livePreview'
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
}

interface LiveMarkdownEditorProps {
  initialValue: string
  theme: 'light' | 'dark'
  placeholder?: string
  onChange: (value: string) => void
  onSelectionChange?: (info: EditorSelectionInfo) => void
  resolveImageUrl?: (href: string) => string
}

const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontWeight: '700' },
  { tag: tags.heading2, fontWeight: '700' },
  { tag: tags.heading3, fontWeight: '700' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'var(--accent)' },
  { tag: tags.url, color: 'var(--text-muted)' },
  { tag: tags.monospace, fontFamily: 'var(--font-mono, ui-monospace, monospace)' },
  { tag: tags.meta, color: 'var(--text-muted)' }
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
    { initialValue, theme, placeholder, onChange, onSelectionChange, resolveImageUrl },
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

    const buildExtensions = useMemo(
      () => () =>
        [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          createMarkdownLanguage(),
          syntaxHighlighting(markdownHighlight),
          livePreviewExtension(),
          resolverCompartment.of(imageUrlResolver.of(resolveImageUrl ?? ((href: string) => href))),
          themeCompartment.of([baseTheme, themeExtension(theme)]),
          cmPlaceholder(placeholder ?? ''),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString())
            }
            if (update.selectionSet || update.docChanged || update.focusChanged) {
              const main = update.state.selection.main
              onSelectionChangeRef.current?.({
                text: update.state.sliceDoc(main.from, main.to),
                from: main.from,
                to: main.to,
                hasFocus: update.view.hasFocus
              })
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
      return () => {
        view.destroy()
        viewRef.current = null
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Reconfigure theme when the prop changes.
    useEffect(() => {
      viewRef.current?.dispatch({
        effects: themeCompartment.reconfigure([baseTheme, themeExtension(theme)])
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
        getView: () => viewRef.current
      }),
      [buildExtensions, themeCompartment, resolverCompartment, resolveImageUrl]
    )

    return <div ref={hostRef} className="cm-editor-host" />
  }
)
