import type { Extension } from '@codemirror/state'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { xml } from '@codemirror/lang-xml'

export type LangId = 'plain' | 'javascript' | 'json' | 'html' | 'css' | 'markdown' | 'python' | 'xml'

export const LANG_OPTIONS: { id: LangId; label: string }[] = [
  { id: 'plain', label: '纯文本' },
  { id: 'javascript', label: 'JavaScript / TypeScript' },
  { id: 'json', label: 'JSON' },
  { id: 'html', label: 'HTML' },
  { id: 'css', label: 'CSS' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'python', label: 'Python' },
  { id: 'xml', label: 'XML' }
]

export function langExtension(id: LangId): Extension[] {
  switch (id) {
    case 'plain':
      return []
    case 'javascript':
      return [javascript({ jsx: true, typescript: true })]
    case 'json':
      return [json()]
    case 'html':
      return [html()]
    case 'css':
      return [css()]
    case 'markdown':
      return [markdown()]
    case 'python':
      return [python()]
    case 'xml':
      return [xml()]
    default:
      return []
  }
}
