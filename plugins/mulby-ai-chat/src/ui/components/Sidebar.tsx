import React from 'react';
import { Session } from '../types';
import { Icons } from '../Icons';

interface SidebarProps {
  sessions: Session[];
  activeId: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string, e: React.MouseEvent) => void;
}

// ── 会话侧边栏 ────────────────────────────────────────────
export function Sidebar({ sessions, activeId, onSelectSession, onNewSession, onDeleteSession }: SidebarProps) {
  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <button
          className="new-chat-btn"
          onClick={onNewSession}
          title="新建对话"
        >
          <Icons.plus />
          新建对话
        </button>
      </div>
      <div className="sidebar-sessions">
        {sessions.map(s => (
          <div
            key={s.id}
            className={`session-item ${s.id === activeId ? 'active' : ''}`}
            onClick={() => onSelectSession(s.id)}
          >
            <span className="session-icon"><Icons.chat /></span>
            <span className="session-title">{s.title}</span>
            <button
              className="session-delete"
              onClick={e => onDeleteSession(s.id, e)}
              title="删除对话"
            >
              <Icons.trash />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
