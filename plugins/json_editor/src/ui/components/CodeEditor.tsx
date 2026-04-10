import { useEffect, useRef } from 'react'
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { foldGutter, indentOnInput, syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldKeymap } from '@codemirror/language'
import { lintKeymap } from '@codemirror/lint'
import { json } from '@codemirror/lang-json'
import { oneDark } from '@codemirror/theme-one-dark'

interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  theme: 'light' | 'dark'
  readOnly?: boolean
}

export function CodeEditor({ value, onChange, theme, readOnly = false }: CodeEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    if (!editorRef.current) return

    const startState = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
          ...lintKeymap
        ]),
        json(),
        theme === 'dark' ? oneDark : [],
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !readOnly) {
            onChange(update.state.doc.toString())
          }
        }),
        EditorState.readOnly.of(readOnly),
        EditorView.theme({
          '&': {
            height: '100%',
            fontSize: '13px'
          },
          '.cm-scroller': {
            fontFamily: 'Monaco, Menlo, Consolas, monospace',
            lineHeight: '1.6'
          },
          '.cm-gutters': {
            backgroundColor: theme === 'dark' ? '#2d2d2d' : '#f5f5f5',
            borderRight: `1px solid ${theme === 'dark' ? '#3d3d3d' : '#e0e0e0'}`
          }
        })
      ]
    })

    const view = new EditorView({
      state: startState,
      parent: editorRef.current
    })

    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [theme, readOnly])

  // 更新编辑器内容
  useEffect(() => {
    if (viewRef.current && value !== viewRef.current.state.doc.toString()) {
      viewRef.current.dispatch({
        changes: {
          from: 0,
          to: viewRef.current.state.doc.length,
          insert: value
        }
      })
    }
  }, [value])

  return <div ref={editorRef} style={{ height: '100%', overflow: 'auto' }} />
}
