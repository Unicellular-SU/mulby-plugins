import React, { useState, useEffect } from 'react';
import { useMulby } from '../hooks/useMulby';

interface IDEInfo {
  code: string;
  icon: string;
  command?: string;
  database?: string;
}

export default function IDEList() {
  const { call, notification } = useMulby();
  const [ides, setIdes] = useState<IDEInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const loadIDEs = async () => {
    try {
      const result = await call('getIDEs');
      setIdes(result || []);
    } catch {
      notification.show('加载 IDE 列表失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadIDEs();
  }, []);

  const handleDelete = async (code: string) => {
    if (!confirm(`确定要删除 ${code} IDE 吗？`)) return;
    setDeleting(code);
    try {
      const result = await call('removeIDE', code);
      if (result?.error) {
        notification.show(result.error, 'error');
      } else {
        notification.show(`${code} 已删除`);
        setIdes((prev) => prev.filter((i) => i.code !== code));
      }
    } catch {
      notification.show('删除失败', 'error');
    } finally {
      setDeleting(null);
    }
  };

  const handleSearch = (code: string) => {
    window.location.hash = `search?code=${code}`;
  };

  const handleSettings = (code: string) => {
    window.location.hash = `settings?code=${code}`;
  };

  if (loading) return <div className="loading">加载中...</div>;

  return (
    <div className="ide-list-page">
      <div className="ide-list-header">
        <h3>已配置的 IDE</h3>
        <button
          className="add-btn"
          onClick={() => {
            window.location.hash = 'add-ide';
          }}
        >
          + 新增 IDE
        </button>
      </div>
      {ides.length === 0 ? (
        <div className="empty-state">暂无 IDE，请先新增</div>
      ) : (
        <div className="ide-list">
          {ides.map((ide) => (
            <div key={ide.code} className="ide-item">
              <img
                className="ide-icon"
                src={ide.icon || 'icon/icon.png'}
                alt={ide.code}
                onError={(e) => {
                  (e.target as HTMLImageElement).src = 'icon/icon.png';
                }}
              />
              <div className="ide-info">
                <div className="ide-code">{ide.code}</div>
                <div className="ide-command">{ide.command || '-'}</div>
              </div>
              <div className="ide-actions">
                <button className="action-btn" onClick={() => handleSearch(ide.code)}>
                  搜索
                </button>
                <button className="action-btn" onClick={() => handleSettings(ide.code)}>
                  设置
                </button>
                <button
                  className="action-btn danger"
                  onClick={() => handleDelete(ide.code)}
                  disabled={deleting === ide.code}
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
