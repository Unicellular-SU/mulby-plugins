import { useState } from 'react';
import { AiModel } from '../types';
import { ModelPicker } from './ModelPicker';

interface MsgActionsProps {
  isUser: boolean;
  isStreaming?: boolean;
  models: AiModel[];
  currentModel: string;
  onCopy: () => void;
  onDelete: () => void;
  onRegenerate: () => void;
  // 用户侧专属
  onEdit?: () => void;
  // AI 侧专属
  onRegenerateWithModel?: (modelId: string) => void;
  onTranslate?: () => void;
}

// 图标定义（轻量内联 svg）
const ActionIcons = {
  copy: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="4" rx="1"/>
      <path d="M9 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h-3"/>
    </svg>
  ),
  check: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  regenerate: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10"/>
      <path d="M3.51 15a9 9 0 1 0 .49-4.36"/>
    </svg>
  ),
  edit: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  ),
  delete: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3,6 5,6 21,6"/>
      <path d="M19 6l-1 14H6L5 6"/>
      <path d="M10 11v6M14 11v6"/>
      <path d="M9 6V4h6v2"/>
    </svg>
  ),
  switchModel: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
    </svg>
  ),
  translate: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 8l6 6"/>
      <path d="M4 14l6-6 2-3"/>
      <path d="M2 5h12"/>
      <path d="M7 2h1"/>
      <path d="M22 22l-5-10-5 10"/>
      <path d="M14 18h6"/>
    </svg>
  ),
};

// ── 操作按钮栏 ──────────────────────────────────────────
export function MsgActions({
  isUser,
  isStreaming,
  models,
  currentModel,
  onCopy,
  onDelete,
  onRegenerate,
  onEdit,
  onRegenerateWithModel,
  onTranslate,
}: MsgActionsProps) {
  const [copied, setCopied] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const disabled = !!isStreaming;

  const handleCopy = () => {
    onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="msg-actions">
      {/* 复制 */}
      <button
        className={`msg-action-btn ${copied ? 'active' : ''}`}
        onClick={handleCopy}
        title={copied ? '已复制' : '复制'}
        disabled={disabled}
      >
        {copied ? <ActionIcons.check /> : <ActionIcons.copy />}
      </button>

      {/* 重新生成 */}
      <button
        className="msg-action-btn"
        onClick={onRegenerate}
        title="重新生成"
        disabled={disabled}
      >
        <ActionIcons.regenerate />
      </button>

      {/* 用户侧：编辑 */}
      {isUser && onEdit && (
        <button
          className="msg-action-btn"
          onClick={onEdit}
          title="编辑"
          disabled={disabled}
        >
          <ActionIcons.edit />
        </button>
      )}

      {/* AI 侧：切换模型重新生成 */}
      {!isUser && onRegenerateWithModel && (
        <div className="msg-action-model-wrapper">
          <button
            className={`msg-action-btn ${showModelPicker ? 'active' : ''}`}
            onClick={() => setShowModelPicker(v => !v)}
            title="切换模型重新生成"
            disabled={disabled}
          >
            <ActionIcons.switchModel />
          </button>
          {showModelPicker && (
            <div className="msg-action-model-picker">
              <ModelPicker
                models={models}
                currentModel={currentModel}
                onModelChange={(id) => {
                  onRegenerateWithModel(id);
                  setShowModelPicker(false);
                }}
                show={true}
                onToggle={() => setShowModelPicker(v => !v)}
                onClose={() => setShowModelPicker(false)}
              />
            </div>
          )}
        </div>
      )}

      {/* AI 侧：翻译 */}
      {!isUser && onTranslate && (
        <button
          className="msg-action-btn"
          onClick={onTranslate}
          title="翻译"
          disabled={disabled}
        >
          <ActionIcons.translate />
        </button>
      )}

      {/* 删除 */}
      <button
        className="msg-action-btn msg-action-btn--danger"
        onClick={onDelete}
        title="删除"
      >
        <ActionIcons.delete />
      </button>
    </div>
  );
}
