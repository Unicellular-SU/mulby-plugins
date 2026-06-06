// Shared markdown language configuration (CommonMark + GFM: tables, task lists,
// strikethrough, autolinks). Used both by the live editor and by unit tests so
// the parsed syntax tree — which the live-preview model walks — is identical in
// both contexts.

import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import type { Extension } from '@codemirror/state'

export function createMarkdownLanguage(): Extension {
  return markdown({ base: markdownLanguage, extensions: GFM })
}
