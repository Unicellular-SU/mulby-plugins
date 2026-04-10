import React, { useState, useRef, useEffect } from 'react';
import { ToolCallEvent } from '../types';
import { ToolCallBlock } from './ToolCallBlock';

interface ReasoningBlockProps {
  content: string;
  isStreaming?: boolean;
  /** 推理阶段发生的工具调用（inReasoning: true），传入后在推理文本中交叉渲染 */
  toolCalls?: ToolCallEvent[];
}

// ── 推理内容块（可折叠）──────────────────────────
export function ReasoningBlock({ content, isStreaming, toolCalls }: ReasoningBlockProps) {
  const [collapsed, setCollapsed] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // 流式输出时自动滚动到底部，让用户实时看到新增内容
  useEffect(() => {
    if (!collapsed && isStreaming && contentRef.current) {
      const el = contentRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [content, collapsed, isStreaming]);

  // 过滤出推理阶段的工具调用，并按 reasoningBefore 长度排序
  const reasoningToolCalls = (toolCalls ?? [])
    .filter(tc => tc.inReasoning)
    .sort((a, b) => (a.reasoningBefore?.length ?? 0) - (b.reasoningBefore?.length ?? 0));

  // 交叉渲染：把工具调用按 reasoningBefore 位置插入推理文本
  function renderContent() {
    if (reasoningToolCalls.length === 0) {
      return (
        <>
          <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{content}</span>
          {isStreaming && <span className="typing-cursor" />}
        </>
      );
    }

    const nodes: React.ReactNode[] = [];
    let lastPos = 0;

    reasoningToolCalls.forEach((tc, i) => {
      const pos = tc.reasoningBefore?.length ?? 0;
      const slice = content.slice(lastPos, pos);
      if (slice) {
        nodes.push(
          <span key={`r-${i}`} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{slice}</span>
        );
      }
      nodes.push(<ToolCallBlock key={`tc-${tc.id}`} toolCalls={[tc]} />);
      lastPos = pos;
    });

    const tail = content.slice(lastPos);
    if (tail) {
      nodes.push(
        <span key="r-tail" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{tail}</span>
      );
    }
    if (isStreaming) nodes.push(<span key="cursor" className="typing-cursor" />);

    return <>{nodes}</>;
  }

  return (
    <div className={`reasoning-block ${collapsed ? 'collapsed' : ''}`}>
      <button
        className="reasoning-toggle"
        onClick={() => setCollapsed(c => !c)}
        title={collapsed ? '展开思考过程' : '折叠思考过程'}
      >
        <svg className={`chevron ${collapsed ? '' : 'open'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
        <span>思考过程</span>
        {isStreaming && <span className="reasoning-live"></span>}
      </button>
      {!collapsed && (
        <div className="reasoning-content" ref={contentRef}>
          {renderContent()}
        </div>
      )}
    </div>
  );
}
