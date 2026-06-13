import React, { useState } from 'react'
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import { WrapText } from 'lucide-react'
import oneLight from 'react-syntax-highlighter/dist/esm/styles/prism/one-light'
import oneDark from 'react-syntax-highlighter/dist/esm/styles/prism/one-dark'
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript'
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx'
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript'
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx'
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python'
import ruby from 'react-syntax-highlighter/dist/esm/languages/prism/ruby'
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go'
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust'
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java'
import c from 'react-syntax-highlighter/dist/esm/languages/prism/c'
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp'
import csharp from 'react-syntax-highlighter/dist/esm/languages/prism/csharp'
import swift from 'react-syntax-highlighter/dist/esm/languages/prism/swift'
import kotlin from 'react-syntax-highlighter/dist/esm/languages/prism/kotlin'
import lua from 'react-syntax-highlighter/dist/esm/languages/prism/lua'
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup'
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css'
import scss from 'react-syntax-highlighter/dist/esm/languages/prism/scss'
import less from 'react-syntax-highlighter/dist/esm/languages/prism/less'
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql'
import graphql from 'react-syntax-highlighter/dist/esm/languages/prism/graphql'
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash'
import batch from 'react-syntax-highlighter/dist/esm/languages/prism/batch'
import powershell from 'react-syntax-highlighter/dist/esm/languages/prism/powershell'
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml'
import ini from 'react-syntax-highlighter/dist/esm/languages/prism/ini'
import toml from 'react-syntax-highlighter/dist/esm/languages/prism/toml'
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json'
import { FileItem, langForExt } from '../../utils'
import { useMulby } from '../../hooks/useMulby'
import { PreviewMeta, FileInfo } from './PreviewChrome'

const LANGS: Record<string, unknown> = {
  javascript, jsx, typescript, tsx, python, ruby, go, rust, java, c, cpp, csharp,
  swift, kotlin, lua, markup, css, scss, less, sql, graphql, bash, batch, powershell,
  yaml, ini, toml, json,
}

let registered = false
function ensureRegistered() {
  if (registered) return
  for (const [name, def] of Object.entries(LANGS)) {
    SyntaxHighlighter.registerLanguage(name, def as never)
  }
  registered = true
}

// 仅渲染高亮代码块本身（无工具栏/元信息），供 JsonPreview 等复用
export function HighlightBlock({
  text,
  language,
  wrap,
  dark,
}: {
  text: string
  language: string
  wrap: boolean
  dark: boolean
}) {
  ensureRegistered()
  return (
    <SyntaxHighlighter
      language={language}
      style={dark ? oneDark : oneLight}
      showLineNumbers
      wrapLongLines={wrap}
      customStyle={{
        margin: 0,
        height: '100%',
        overflow: 'auto',
        background: 'transparent',
        padding: '12px 16px 44px',
        fontSize: 13,
        lineHeight: 1.6,
      }}
      codeTagProps={{ style: { fontFamily: "'SF Mono','Fira Code','Cascadia Code',monospace" } }}
      lineNumberStyle={{ color: 'var(--text-tertiary)', minWidth: '2.5em', userSelect: 'none' }}
    >
      {text}
    </SyntaxHighlighter>
  )
}

interface Props {
  file: FileItem
  text: string
  fileInfo: FileInfo | null
  language?: string
}

export default function CodePreview({ file, text, fileInfo, language }: Props) {
  const { theme } = useMulby()
  const [wrap, setWrap] = useState(false)
  const lang = language || langForExt(file.ext)

  return (
    <div className="preview-area flex-1 relative" style={{ alignItems: 'stretch', justifyContent: 'stretch' }}>
      <div className="preview-toolbar">
        <span className="preview-toolbar-title">{lang}</span>
        <button
          className={`preview-toggle${wrap ? ' active' : ''}`}
          onClick={() => setWrap((w) => !w)}
          title="自动换行"
        >
          <WrapText size={14} /> 换行
        </button>
      </div>
      <div className="code-host">
        <HighlightBlock text={text} language={lang} wrap={wrap} dark={theme === 'dark'} />
      </div>
      <PreviewMeta file={file} fileInfo={fileInfo} />
    </div>
  )
}
