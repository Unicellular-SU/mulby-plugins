import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Theme } from '../types';
import { CodeBlock } from './CodeBlock';

interface MdRendererProps {
  content: string;
  theme: Theme;
}

// ── Markdown 渲染器（React.memo 防止无用重渲染）──
export const MdRenderer = React.memo(function MdRenderer({ content, theme }: MdRendererProps) {
  return (
    <div className="md-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ node, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || '');
            const isBlock = !!(node?.position && node.position.start.line !== node.position.end.line);
            const code = String(children).replace(/\n$/, '');
            return isBlock || match ? (
              <CodeBlock language={match ? match[1] : 'text'} code={code} theme={theme} />
            ) : (
              <code className={className} {...props}>{children}</code>
            );
          },
          a({ href, children, ...props }: any) {
            return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
