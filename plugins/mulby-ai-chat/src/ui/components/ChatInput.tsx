import React, { useEffect, useRef } from 'react';
import { AiModel, AiSkillRecord, WebSearchProvider } from '../types';
import { Icons } from '../Icons';
import { ModelPicker } from './ModelPicker';

interface PendingAttachmentItem {
  file: File;
  preview?: string;
  ref?: any;
}

interface ChatInputProps {
  input: string;
  isStreaming: boolean;
  canSend: boolean;
  pendingAttachments: PendingAttachmentItem[];
  skills: AiSkillRecord[];
  selectedSkillIds: string[];
  showSkills: boolean;
  showWebSearch: boolean;
  webSearchEnabled: boolean;
  webSearchProviders: WebSearchProvider[];
  activeWebSearchProvider: string;
  models: AiModel[];
  currentModel: string;
  showModelPicker: boolean;
  onInputChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onStop: () => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveAttachment: (idx: number) => void;
  onToggleSkills: () => void;
  onSkillToggle: (id: string, checked: boolean) => void;
  onModelChange: (id: string) => void;
  onModelPickerToggle: () => void;
  onModelPickerClose: () => void;
  onToggleWebSearch: () => void;
  onToggleWebSearchEnabled: (enabled: boolean) => void;
  onSetWebSearchProvider: (providerId: string) => void;
  onClosePopovers: () => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
}

// ── 输入区（含附件预览、Skills面板、模型选择、发送按钮）──
export function ChatInput({
  input,
  isStreaming,
  canSend,
  pendingAttachments,
  skills,
  selectedSkillIds,
  showSkills,
  showWebSearch,
  webSearchEnabled,
  webSearchProviders,
  activeWebSearchProvider,
  models,
  currentModel,
  showModelPicker,
  onInputChange,
  onKeyDown,
  onPaste,
  onSend,
  onStop,
  onFileSelect,
  onRemoveAttachment,
  onToggleSkills,
  onSkillToggle,
  onModelChange,
  onModelPickerToggle,
  onModelPickerClose,
  onToggleWebSearch,
  onToggleWebSearchEnabled,
  onSetWebSearchProvider,
  onClosePopovers,
  textareaRef,
}: ChatInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showSkills && !showWebSearch) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        onClosePopovers();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSkills, showWebSearch, onClosePopovers]);

  return (
    <div className="input-area" ref={wrapperRef}>
      <div className="input-wrapper">
        {/* 待上传附件预览 */}
        {pendingAttachments.length > 0 && (
          <div className="pending-attachments">
            {pendingAttachments.map((p, i) => (
              <div key={i} className="pending-item">
                {p.preview ? (
                  <img src={p.preview} alt="附件预览" />
                ) : (
                  <Icons.file />
                )}
                <span style={{ maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.file.name}
                </span>
                <button
                  className="pa-remove"
                  onClick={() => onRemoveAttachment(i)}
                  title="移除"
                >×</button>
              </div>
            ))}
          </div>
        )}

        {/* Skills 面板 */}
        {showSkills && (
          <div className="skills-panel">
            <h4>AI Skills</h4>
            {skills.length === 0 ? (
              <div className="no-skills">暂无可用 Skills</div>
            ) : (
              skills.map(sk => (
                <label key={sk.id} className="skill-item">
                  <input
                    className="skill-check-input"
                    type="checkbox"
                    checked={selectedSkillIds.includes(sk.id)}
                    onChange={e => onSkillToggle(sk.id, e.target.checked)}
                  />
                  <span className="skill-check" aria-hidden="true">
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="4.5 10.5 8.3 14.1 15.5 6.9" />
                    </svg>
                  </span>
                  <div className="skill-info">
                    <div className="skill-name">{sk.descriptor.name}</div>
                    {sk.descriptor.description && (
                      <div className="skill-desc">{sk.descriptor.description}</div>
                    )}
                  </div>
                </label>
              ))
            )}
          </div>
        )}

        {/* WebSearch Provider 面板 */}
        {showWebSearch && (
          <div className="websearch-panel">
            <h4>联网搜索源</h4>
            <div className="websearch-toggle-row">
              <span>启用联网搜索</span>
              <button
                type="button"
                role="switch"
                aria-checked={webSearchEnabled}
                className={`websearch-switch ${webSearchEnabled ? 'on' : ''}`}
                onClick={() => onToggleWebSearchEnabled(!webSearchEnabled)}
                title={webSearchEnabled ? '已开启' : '已关闭'}
              >
                <span className="websearch-switch-track">
                  <span className="websearch-switch-thumb" />
                </span>
                <span className="websearch-switch-label">{webSearchEnabled ? '已开启' : '已关闭'}</span>
              </button>
            </div>
            {webSearchProviders.length === 0 ? (
              <div className="no-skills">暂无可用搜索源</div>
            ) : (
              webSearchProviders.map((provider) => (
                <button
                  key={provider.id}
                  className={`websearch-provider-item ${provider.id === activeWebSearchProvider ? 'active' : ''}`}
                  onClick={() => onSetWebSearchProvider(provider.id)}
                  title={provider.id}
                >
                  <div className="websearch-provider-main">
                    <span className="websearch-provider-name">{provider.name}</span>
                    <span className="websearch-provider-type">{provider.type}</span>
                  </div>
                  {provider.id === activeWebSearchProvider && <span className="websearch-provider-check">当前</span>}
                </button>
              ))
            )}
          </div>
        )}

        <div className="input-row">
          <textarea
            ref={textareaRef}
            className="chat-textarea"
            placeholder="输入消息… (Enter 发送，Shift+Enter 换行)"
            value={input}
            onChange={e => onInputChange(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            disabled={isStreaming}
            rows={1}
          />

          <div className="input-actions">
            {/* 模型切换 */}
            <ModelPicker
              models={models}
              currentModel={currentModel}
              onModelChange={onModelChange}
              show={showModelPicker}
              onToggle={onModelPickerToggle}
              onClose={onModelPickerClose}
            />

            {/* 附件上传 */}
            <button
              className="icon-btn"
              title="上传文件或图片"
              onClick={() => fileInputRef.current?.click()}
              disabled={isStreaming}
            >
              <Icons.paperclip />
            </button>

            {/* Skills 选择 */}
            <button
              className="icon-btn"
              title="AI Skills"
              onClick={onToggleSkills}
              style={{ color: selectedSkillIds.length > 0 ? 'var(--text-accent)' : undefined }}
            >
              <Icons.skill />
            </button>

            {/* WebSearch provider 选择 */}
            <button
              className="icon-btn"
              title="联网搜索源"
              onClick={onToggleWebSearch}
              style={{ color: showWebSearch ? 'var(--text-accent)' : undefined }}
            >
              <Icons.globe />
            </button>

            {/* 发送 / 停止 */}
            {isStreaming ? (
              <button className="stop-btn" onClick={onStop} title="停止生成">
                <Icons.stop />
              </button>
            ) : (
              <button
                className="send-btn"
                onClick={onSend}
                disabled={!canSend}
                title="发送 (Enter)"
              >
                <Icons.send />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 隐藏 file input */}
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        multiple
        accept="image/*,.pdf,.txt,.md,.csv,.json,.xml,.docx,.xlsx"
        onChange={onFileSelect}
      />
    </div>
  );
}
