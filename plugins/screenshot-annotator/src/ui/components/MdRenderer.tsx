import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// 基于 react-markdown + remark-gfm 的 Markdown 渲染器。
// 不启用原始 HTML（react-markdown 默认不解析 HTML），天然免 XSS；链接强制新窗口打开。
export const MdRenderer = memo(function MdRenderer({ content }: { content: string }) {
  return (
    <div className="md-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children, ...props }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                {children}
              </a>
            )
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})

export default MdRenderer
