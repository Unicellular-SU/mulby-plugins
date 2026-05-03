import React, { useState, useRef, useEffect } from 'react';
import { useMulby } from '../hooks/useMulby';

export default function AddIDE() {
  const { call, notification } = useMulby();
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleAdd = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      notification.show('请输入 IDE 名称', 'error');
      return;
    }
    setAdding(true);
    try {
      const result = await call('addIDE', trimmed);
      if (result?.error) {
        notification.show(result.error, 'error');
      } else {
        notification.show(`创建成功，请在 ${trimmed}-setting 中配置`);
        // Navigate to settings for the new IDE
        window.location.hash = `settings?code=${trimmed}`;
      }
    } catch {
      notification.show('创建失败', 'error');
    } finally {
      setAdding(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAdd();
  };

  return (
    <div className="add-ide-page">
      <h3>新增 IDE</h3>
      <div className="add-ide-form">
        <div className="form-group">
          <label>IDE 名称</label>
          <div className="input-container">
            <input
              ref={inputRef}
              type="text"
              placeholder="请输入 IDE 名称，例如 cursor"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <div className="input-tips">
              请输入 terminal 中的命令名称，例如 cursor、code 等
            </div>
          </div>
        </div>
        <button
          className="save-btn"
          onClick={handleAdd}
          disabled={adding}
        >
          {adding ? '创建中...' : '回车创建'}
        </button>
      </div>
    </div>
  );
}
