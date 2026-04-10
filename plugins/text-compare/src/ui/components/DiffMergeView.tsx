import { useEffect, useRef } from 'react'
import { MergeView } from '@codemirror/merge'
import type { Extension } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  highlightActiveLineGutter,
  highlightActiveLine,
  keymap,
  lineNumbers
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { bracketMatching, foldGutter, indentOnInput, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { oneDark } from '@codemirror/theme-one-dark'
import type { LangId } from '../lang'
import { langExtension } from '../lang'

function baseExtensions(
  theme: 'light' | 'dark',
  language: LangId,
  onDocChange: (value: string) => void
): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    history(),
    foldGutter(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    ...langExtension(language),
    theme === 'dark' ? oneDark : [],
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onDocChange(update.state.doc.toString())
      }
    }),
    EditorView.theme({
      '&': {
        height: '100%',
        fontSize: '13px'
      },
      '.cm-scroller': {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        lineHeight: '1.55'
      },
      '.cm-gutters': {
        backgroundColor: theme === 'dark' ? '#2d2d2d' : '#f0f0f0',
        borderRight: `1px solid ${theme === 'dark' ? '#404040' : '#ddd'}`
      }
    })
  ]
}

export interface DiffMergeViewProps {
  left: string
  right: string
  onLeftChange: (value: string) => void
  onRightChange: (value: string) => void
  theme: 'light' | 'dark'
  language: LangId
}

export function DiffMergeView({
  left,
  right,
  onLeftChange,
  onRightChange,
  theme,
  language
}: DiffMergeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mergeRef = useRef<MergeView | null>(null)

  const onLeftRef = useRef(onLeftChange)
  const onRightRef = useRef(onRightChange)
  onLeftRef.current = onLeftChange
  onRightRef.current = onRightChange

  const leftRef = useRef(left)
  const rightRef = useRef(right)
  leftRef.current = left
  rightRef.current = right

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const docA = leftRef.current
    const docB = rightRef.current

    const mv = new MergeView({
      parent: el,
      a: {
        doc: docA,
        extensions: baseExtensions(theme, language, (v) => onLeftRef.current(v))
      },
      b: {
        doc: docB,
        extensions: baseExtensions(theme, language, (v) => onRightRef.current(v))
      },
      highlightChanges: true,
      gutter: true,
      collapseUnchanged: { margin: 3, minSize: 4 }
    })
    mergeRef.current = mv

    return () => {
      mv.destroy()
      mergeRef.current = null
    }
  }, [theme, language])

  useEffect(() => {
    const mv = mergeRef.current
    if (!mv) return
    const a = mv.a.state.doc.toString()
    const b = mv.b.state.doc.toString()
    if (a !== left) {
      mv.a.dispatch({
        changes: { from: 0, to: mv.a.state.doc.length, insert: left }
      })
    }
    if (b !== right) {
      mv.b.dispatch({
        changes: { from: 0, to: mv.b.state.doc.length, insert: right }
      })
    }
  }, [left, right])

  return <div ref={containerRef} className="diff-merge-root" />
}
