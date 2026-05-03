import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useMulby } from '../hooks/useMulby';

interface FileItem {
  path: string;
  name: string;
  ext: string;
}

interface Props {
  code: string;
}

const EXT_ICON_MAP: Record<string, string> = {
  '.ts': 'ts.svg',
  '.tsx': 'ts.svg',
  '.js': 'js.svg',
  '.jsx': 'js.svg',
  '.json': 'json.svg',
  '.md': 'md.svg',
  '.html': 'html.svg',
  '.css': 'css.svg',
  '.py': 'py.svg',
  '.go': 'go.svg',
  '.java': 'java.svg',
  '.c': 'c.svg',
  '.cpp': 'cpp.svg',
  '.cs': 'cs.svg',
  '.php': 'php.svg',
  '.sh': 'sh.svg',
  '.xml': 'xml.svg',
  '.yaml': 'yaml.svg',
  '.yml': 'yaml.svg',
  '.vue': 'vue.svg',
  '.code-workspace': 'vscode.svg',
  '.remote': 'remote.svg',
};

function getIcon(ext: string): string {
  if (EXT_ICON_MAP[ext]) return `icon/${EXT_ICON_MAP[ext]}`;
  if (!ext) return 'icon/folder.svg';
  return 'icon/file.svg';
}

export default function Search({ code }: Props) {
  const { call, notification } = useMulby();
  const [files, setFiles] = useState<FileItem[]>([]);
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [removeMode, setRemoveMode] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadFiles = useCallback(
    async (kw?: string) => {
      try {
        setLoading(true);
        setError('');
        const result = await call('search', code, kw || undefined);
        if (result?.error) {
          setError(result.error);
          setFiles([]);
        } else {
          setFiles(result?.files || []);
        }
      } catch (err: any) {
        setError(err.message || '搜索失败');
      } finally {
        setLoading(false);
      }
    },
    [code, call]
  );

  useEffect(() => {
    loadFiles();
    inputRef.current?.focus();
  }, [loadFiles]);

  useEffect(() => {
    const timer = setTimeout(() => loadFiles(keyword), 150);
    return () => clearTimeout(timer);
  }, [keyword, loadFiles]);

  const handleOpen = async (item: FileItem) => {
    if (removeMode) {
      if (!confirm(`确定要删除历史记录吗？\n\n${decodeURIComponent(item.path)}`)) return;
      try {
        const result = await call('deleteFromHistory', code, item.path);
        if (result?.error) {
          notification.show(result.error, 'error');
          return;
        }
        notification.show(`已删除`);
        await loadFiles(keyword);
      } catch {
        notification.show('删除失败', 'error');
      }
      return;
    }

    try {
      setLoadingMore(true);
      const result = await call('open', code, item.path);
      if (result?.error) {
        notification.show(result.error, 'error');
        return;
      }
      try {
        await call('hideWindow');
      } catch {
        // ignore
      }
    } catch {
      notification.show('打开失败', 'error');
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleRemoveMode = () => {
    setRemoveMode((prev) => !prev);
  };

  if (!code) {
    return <div className="empty-state">未指定 IDE</div>;
  }

  return (
    <div className="search-page">
      <div className="search-header">
        <input
          ref={inputRef}
          className="search-input"
          type="text"
          placeholder={removeMode ? '删除模式：搜索要删除的项目...' : `搜索 ${code} 历史项目...`}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <button
          className={`remove-toggle ${removeMode ? 'active' : ''}`}
          onClick={toggleRemoveMode}
        >
          {removeMode ? '退出删除' : '-rm'}
        </button>
      </div>

      {loading && <div className="loading">搜索中...</div>}
      {loadingMore && <div className="loading-overlay">处理中...</div>}
      {error && <div className="error-msg">{error}</div>}

      {!loading && !error && files.length === 0 && (
        <div className="empty-state">
          {keyword ? '没有匹配的历史项目' : '没有历史项目'}
        </div>
      )}

      <div className="file-list">
        {files.map((item) => (
          <div
            key={item.path}
            className={`file-item ${removeMode ? 'remove-mode' : ''}`}
            onClick={() => handleOpen(item)}
          >
            <img
              className="file-icon"
              src={getIcon(item.ext)}
              alt=""
              onError={(e) => {
                (e.target as HTMLImageElement).src = 'icon/file.svg';
              }}
            />
            <span className="file-name">
              {removeMode ? 'rm: ' : 'open: '}
              {item.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
