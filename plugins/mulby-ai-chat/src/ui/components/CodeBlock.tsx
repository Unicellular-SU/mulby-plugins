import React, { useState, useRef } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Theme } from '../types';

interface CodeBlockProps {
  language: string;
  code: string;
  theme: Theme;
}

// ── 代码块（图标按钮右上角、内联HTML预览、固定高度可滚动）──
export function CodeBlock({ language, code, theme }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const isHtml = language === 'html';

  // iframe 加载完后自动根据内容高度撑开（上限 600px）
  const handleIframeLoad = () => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    try {
      const h = iframe.contentDocument?.documentElement?.scrollHeight ?? 0;
      iframe.style.height = `${Math.max(120, Math.min(h + 2, 600))}px`;
    } catch {
      // 跨域失败时保留默认高度
    }
  };

  // 切换预览时重置 iframe 高度
  const togglePreview = () => {
    setShowPreview(v => !v);
    if (iframeRef.current) iframeRef.current.style.height = '240px';
  };

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(code); }
    catch {
      const el = document.createElement('textarea');
      el.value = code; document.body.appendChild(el); el.select();
      document.execCommand('copy'); document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="code-block-wrapper">
      {/* 语言标签 + 右上角图标按钮 */}
      <div className="code-block-header">
        <span className="code-lang">{language || 'text'}</span>

        {/* 切换预览/代码（HTML专属） */}
        {isHtml && (
          <button
            className={`code-icon-btn ${showPreview ? 'active' : ''}`}
            onClick={togglePreview}
            title={showPreview ? '查看代码' : 'HTML 预览'}
          >
            {showPreview ? (
              /* code icon */
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
              </svg>
            ) : (
              /* eye icon */
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
              </svg>
            )}
          </button>
        )}

        {/* 复制图标 */}
        <button
          className={`code-icon-btn ${copied ? 'copied' : ''}`}
          onClick={handleCopy}
          title={copied ? '已复制！' : '复制代码'}
        >
          {copied ? (
            /* check icon */
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          ) : (
            /* clipboard icon */
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="2" width="6" height="4" rx="1"/><path d="M9 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h-3"/>
            </svg>
          )}
        </button>
      </div>

      {/* 内容区：代码 or 预览 */}
      <div className="code-block-body">
        {showPreview ? (
          <iframe
            ref={iframeRef}
            sandbox="allow-scripts allow-same-origin"
            srcDoc={code}
            className="code-preview-iframe"
            title="HTML 预览"
            onLoad={handleIframeLoad}
          />
        ) : (
          <SyntaxHighlighter
            style={theme === 'dark' ? oneDark : oneLight}
            language={language || 'text'}
            PreTag="div"
            customStyle={{ margin: 0, maxHeight: '360px', overflowY: 'auto', borderRadius: 0 }}
          >
            {code}
          </SyntaxHighlighter>
        )}
      </div>
    </div>
  );
}
