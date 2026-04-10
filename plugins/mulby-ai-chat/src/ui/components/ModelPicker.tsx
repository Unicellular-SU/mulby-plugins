import React, { useRef, useEffect } from 'react';
import { AiModel } from '../types';

interface ModelPickerProps {
  models: AiModel[];
  currentModel: string;
  onModelChange: (id: string) => void;
  show: boolean;
  onToggle: () => void;
  onClose: () => void;
}

// ── 模型选择器弹窗 ────────────────────────────────────────
export function ModelPicker({ models, currentModel, onModelChange, show, onToggle, onClose }: ModelPickerProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  // 点击面板外部自动关闭
  useEffect(() => {
    if (!show) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [show, onClose]);

  // 按供应商分组的模型列表
  const groupedModels = (() => {
    const map = new Map<string, AiModel[]>();
    for (const m of models) {
      const provider = m.providerLabel || 'Other';
      if (!map.has(provider)) map.set(provider, []);
      map.get(provider)!.push(m);
    }
    return map;
  })();

  const currentModelLabel = models.find(m => m.id === currentModel)?.label || currentModel || '选择模型';

  return (
    <div className="model-picker-wrapper" ref={wrapperRef}>
      <button
        className="model-picker-btn"
        onClick={onToggle}
        title="切换模型"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
        </svg>
        <span className="model-picker-label">{currentModelLabel}</span>
        <svg className="model-picker-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {show && (
        <div className="model-picker-panel">
          <div className="model-picker-header">
            <span>选择模型</span>
            <button className="model-picker-close" onClick={onClose}>×</button>
          </div>
          <div className="model-picker-body">
            {models.length === 0 ? (
              <div className="model-picker-empty">模型加载中…</div>
            ) : (
              [...groupedModels.entries()].map(([provider, list]) => (
                <div key={provider} className="model-group">
                  <div className="model-group-label">{provider}</div>
                  {list.map(m => (
                    <button
                      key={m.id}
                      className={`model-item ${m.id === currentModel ? 'selected' : ''}`}
                      onClick={() => {
                        onModelChange(m.id);
                        onClose();
                      }}
                    >
                      <span className="model-item-name">{m.label}</span>
                      {m.id === currentModel && (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
