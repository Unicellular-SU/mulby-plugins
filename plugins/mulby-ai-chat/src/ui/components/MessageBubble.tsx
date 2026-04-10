import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, Theme, AiModel, ToolCallEvent } from '../types';
import { Icons } from '../Icons';
import { ReasoningBlock } from './ReasoningBlock';
import { MdRenderer } from './MdRenderer';
import { MsgActions } from './MsgActions';
import { ToolCallBlock } from './ToolCallBlock';

// 交叉渲染：将工具调用块按 textBefore 位置插入正文
function InterleavedBody({
  content, toolCalls, theme, isStreaming, isReasoning,
}: {
  content: string;
  toolCalls?: ToolCallEvent[];
  theme: Theme;
  isStreaming?: boolean;
  isReasoning?: boolean;
}) {
  // 只渲染正文阶段的工具调用（推理阶段的由 ReasoningBlock 处理）
  const mainToolCalls = toolCalls?.filter(tc => !tc.inReasoning);
  const hasPositioned = mainToolCalls?.some(tc => tc.textBefore !== undefined);

  // 旧数据兼容：没有 textBefore 则全部放顶部
  if (!mainToolCalls?.length || !hasPositioned) {
    return (
      <>
        {mainToolCalls?.length ? <ToolCallBlock toolCalls={mainToolCalls} /> : null}
        <MdRenderer content={content} theme={theme} />
        {isStreaming && !isReasoning && content === '' && <span className="typing-cursor" />}
        {isStreaming && content && <span className="typing-cursor" />}
      </>
    );
  }

  // 按 textBefore 长度排序（只处理正文阶段的）
  const sorted = [...mainToolCalls].sort(
    (a, b) => (a.textBefore?.length ?? 0) - (b.textBefore?.length ?? 0)
  );

  const nodes: React.ReactNode[] = [];
  let lastPos = 0;

  sorted.forEach((tc, i) => {
    const pos = tc.textBefore?.length ?? 0;
    const slice = content.slice(lastPos, pos);
    if (slice) nodes.push(<MdRenderer key={`txt-${i}`} content={slice} theme={theme} />);
    nodes.push(<ToolCallBlock key={`tc-${tc.id}`} toolCalls={[tc]} />);
    lastPos = pos;
  });

  const tail = content.slice(lastPos);
  if (tail) nodes.push(<MdRenderer key="txt-tail" content={tail} theme={theme} />);
  if (isStreaming && !isReasoning && content === '' && lastPos === 0)
    nodes.push(<span key="cursor-empty" className="typing-cursor" />);
  if (isStreaming && (tail || content))
    nodes.push(<span key="cursor" className="typing-cursor" />);

  return <>{nodes}</>;
}

// Token 数字格式化：>= 1M 用 M 后缀，>= 1K 用 K 后缀，否则原始数字
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

interface MessageBubbleProps {
  msg: ChatMessage;
  theme: Theme;
  models: AiModel[];
  currentModel: string;
  isGlobalStreaming: boolean; // App 级别是否正在流式输出
  onCopy: (msgId: string) => void;
  onDelete: (msgId: string) => void;
  onEdit: (msgId: string, newContent: string) => void;
  onRegenerate: (msgId: string) => void;
  onRegenerateWithModel: (msgId: string, modelId: string) => void;
  onTranslate: (msgId: string) => void;
}

// ── 消息行 ──────────────────────────────────────────────
export const MessageBubble = React.memo(function MessageBubble({
  msg,
  theme,
  models,
  currentModel,
  isGlobalStreaming,
  onCopy,
  onDelete,
  onEdit,
  onRegenerate,
  onRegenerateWithModel,
  onTranslate,
}: MessageBubbleProps) {
  const isUser = msg.role === 'user';
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(msg.content);
  const editRef = useRef<HTMLTextAreaElement>(null);

  // 进入编辑模式时聚焦并调整高度
  useEffect(() => {
    if (editing && editRef.current) {
      const el = editRef.current;
      el.focus();
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [editing]);

  const handleEditSave = () => {
    const trimmed = editValue.trim();
    if (trimmed) {
      onEdit(msg.id, trimmed);
    }
    setEditing(false);
  };

  const handleEditCancel = () => {
    setEditValue(msg.content);
    setEditing(false);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleEditSave();
    }
    if (e.key === 'Escape') {
      handleEditCancel();
    }
  };

  return (
    <div className={`msg-row ${isUser ? 'msg-row--user' : 'msg-row--assistant'}`}>
      {/* 左侧头像 */}
      <div className={`msg-avatar ${isUser ? 'user' : 'assistant'}`}>
        {isUser ? 'U' : <Icons.ai />}
      </div>

      {/* 右侧：角色名 + 内容 + 操作栏 */}
      <div className="msg-body">
        <div className="msg-role">{isUser ? '你' : 'AI'}</div>

        {/* 附件 */}
        {msg.attachments && msg.attachments.length > 0 && (
          <div className="msg-attachments">
            {msg.attachments.map((att, i) =>
              att.mimeType.startsWith('image/') && msg.attachmentPreviews?.[i] ? (
                <img key={att.attachmentId} src={msg.attachmentPreviews[i]} className="attach-thumb" alt={att.filename} />
              ) : (
                <div key={att.attachmentId} className="attach-file">
                  <Icons.file />
                  <span>{att.filename || 'file'}</span>
                </div>
              )
            )}
          </div>
        )}

        {/* 推理内容（可折叠），传入推理阶段的工具调用 */}
        {!isUser && msg.reasoning_content && (
          <ReasoningBlock
            content={msg.reasoning_content}
            isStreaming={msg.isReasoning}
            toolCalls={msg.toolCalls}
          />
        )}

        {/* 正文 / 编辑模式 */}
        {editing ? (
          <div className="msg-edit-area">
            <textarea
              ref={editRef}
              className="msg-edit-textarea"
              value={editValue}
              onChange={e => {
                setEditValue(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
              onKeyDown={handleEditKeyDown}
            />
            <div className="msg-edit-actions">
              <button className="msg-edit-save" onClick={handleEditSave}>保存并重发</button>
              <button className="msg-edit-cancel" onClick={handleEditCancel}>取消</button>
            </div>
          </div>
        ) : msg.error ? (
          <>
            {msg.content && <MdRenderer content={msg.content} theme={theme} />}
            <div className="msg-error" style={{ marginTop: msg.content ? 8 : 0 }}>
              <Icons.alert />
              <span>{msg.error}</span>
            </div>
          </>
        ) : isUser ? (
          <p className="msg-user-text">{msg.content}</p>
        ) : (
          // AI 消息：工具调用与正文交叉渲染
          <InterleavedBody
            content={msg.content}
            toolCalls={msg.toolCalls}
            theme={theme}
            isStreaming={msg.isStreaming}
            isReasoning={msg.isReasoning}
          />
        )}

        {/* 翻译结果 */}
        {!isUser && (msg.translation || msg.translating) && (
          <div className="msg-translation">
            <div className="msg-translation-label">翻译</div>
            {msg.translating ? (
              <span className="msg-translation-loading">翻译中<span className="typing-cursor" /></span>
            ) : (
              <div className="msg-translation-content">
                <MdRenderer content={msg.translation!} theme={theme} />
              </div>
            )}
          </div>
        )}

        {/* Token 用量（AI 响应完成后显示） */}
        {!isUser && !msg.isStreaming && msg.usage && (
          <div className="msg-token-usage">
            {(msg.usage.inputTokens != null || msg.usage.outputTokens != null) && (() => {
              const total = (msg.usage.inputTokens ?? 0) + (msg.usage.outputTokens ?? 0);
              return (
                <span className="token-stat token-stat--total" title={`${total.toLocaleString()} tokens`}>
                  共 {fmtTokens(total)} tokens
                </span>
              );
            })()}
            {msg.usage.inputTokens != null && (
              <span className="token-stat token-stat--prompt" title={`输入 ${msg.usage.inputTokens.toLocaleString()}`}>
                输入 {fmtTokens(msg.usage.inputTokens)}
              </span>
            )}
            {msg.usage.outputTokens != null && (
              <span className="token-stat token-stat--completion" title={`输出 ${msg.usage.outputTokens.toLocaleString()}`}>
                输出 {fmtTokens(msg.usage.outputTokens)}
              </span>
            )}
          </div>
        )}

        {/* 操作按钮栏（非编辑模式时显示，流式时按钮禁用） */}
        {!editing && (
          <MsgActions
            isUser={isUser}
            isStreaming={isGlobalStreaming}
            models={models}
            currentModel={currentModel}
            onCopy={() => onCopy(msg.id)}
            onDelete={() => onDelete(msg.id)}
            onRegenerate={() => onRegenerate(msg.id)}
            onEdit={isUser ? () => setEditing(true) : undefined}
            onRegenerateWithModel={!isUser ? (modelId) => onRegenerateWithModel(msg.id, modelId) : undefined}
            onTranslate={!isUser ? () => onTranslate(msg.id) : undefined}
          />
        )}
      </div>
    </div>
  );
});
