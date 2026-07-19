import React, { useEffect, useState } from 'react';
import { ProjectIndexEntry, getImageAttachment } from '../services/persistenceService';
import { getTheme } from '../theme/registry';

// ================= 工程画廊（多工程管理；全屏覆盖模式参考 ReaderOverlay） =================
// 卡片：封面缩略图（coverAttId 惰性加载）/ 标题 / 更新时间 / 阶段徽标 / 页进度；
// 操作：打开 / 重命名（行内编辑）/ 删除（二次确认）/ 导出 ZIP。
// 视觉沿用核心包 slate 体系 + var(--manga-*) 品牌变量，文案全部来自 theme.strings。

interface ProjectGalleryProps {
  projects: ProjectIndexEntry[];
  busy?: boolean;      // 正在打开工程
  exporting?: boolean; // 正在导出
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
  onClose: () => void;
}

const ProjectCard: React.FC<{
  entry: ProjectIndexEntry;
  busy?: boolean;
  exporting?: boolean;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
}> = ({ entry, busy, exporting, onOpen, onRename, onDelete, onExport }) => {
  const S = getTheme().strings;
  const [cover, setCover] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(entry.title);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // 封面惰性加载（无封面则占位）
  useEffect(() => {
    let cancelled = false;
    if (entry.coverAttId) {
      void getImageAttachment(entry.coverAttId).then(img => {
        if (!cancelled && img) setCover(img);
      });
    }
    return () => { cancelled = true; };
  }, [entry.coverAttId]);

  const submitRename = () => {
    if (draft.trim() && draft.trim() !== entry.title) onRename(entry.id, draft);
    setRenaming(false);
  };

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden flex flex-col shadow-lg hover:border-indigo-500/50 transition-colors">
      {/* 封面 */}
      <div className="relative aspect-[2/3] bg-black/40 flex items-center justify-center">
        {cover ? (
          <img src={cover} alt={entry.title} className="w-full h-full object-cover" />
        ) : (
          <span className="text-4xl opacity-30">📖</span>
        )}
        <span className="absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded bg-black/60 text-indigo-300 border border-indigo-500/30">
          {S.projectStageLabel(entry.workflowStep)}
        </span>
      </div>

      {/* 信息 */}
      <div className="p-3 space-y-1.5 flex-grow">
        {renaming ? (
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              className="flex-grow min-w-0 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:border-indigo-500 focus:outline-none"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') setRenaming(false); }}
            />
            <button onClick={submitRename} className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-1 rounded shrink-0">
              {S.galleryRenameSave}
            </button>
          </div>
        ) : (
          <h3 className="text-sm font-bold text-white truncate" title={entry.title}>{entry.title}</h3>
        )}
        <p className="text-[11px] text-slate-500">
          {S.galleryUpdatedAt(new Date(entry.updatedAt).toLocaleString())}
        </p>
        <p className="text-[11px] text-emerald-400/90 font-mono">
          {S.projectPages(entry.donePages, entry.pageCount)}
        </p>
      </div>

      {/* 操作：纯图标按钮（文字版四键横排空间不足），title 提供完整说明 */}
      <div className="px-3 pb-3 flex items-center justify-end gap-1.5">
        <button
          onClick={() => onOpen(entry.id)}
          disabled={busy}
          title={S.galleryOpen}
          className="p-2 rounded bg-gradient-to-r from-[var(--manga-cta-from)] to-[var(--manga-cta-to)] hover:from-[var(--manga-cta-hover-from)] hover:to-[var(--manga-cta-hover-to)] disabled:from-slate-700 disabled:to-slate-700 text-white transition-all"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7a2 2 0 012-2h4l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
        </button>
        <button
          onClick={() => { setDraft(entry.title); setRenaming(true); }}
          title={S.galleryRename}
          className="p-2 rounded bg-slate-700/70 hover:bg-slate-600 text-slate-200 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
        </button>
        <button
          onClick={() => onExport(entry.id)}
          disabled={exporting}
          title={S.galleryExport}
          className="p-2 rounded bg-slate-700/70 hover:bg-slate-600 disabled:opacity-50 text-slate-200 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0 0l-4-4m4 4l4-4"/></svg>
        </button>
        {confirmingDelete ? (
          <button
            onClick={() => onDelete(entry.id)}
            title={S.galleryDeleteConfirm}
            className="text-xs bg-red-700 hover:bg-red-600 text-white px-2.5 py-1.5 rounded font-bold animate-pulse"
          >
            {S.galleryDeleteConfirm}
          </button>
        ) : (
          <button
            onClick={() => setConfirmingDelete(true)}
            title={S.galleryDelete}
            className="p-2 rounded bg-slate-700/70 hover:bg-red-900/70 text-slate-300 hover:text-red-200 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3M4 7h16"/></svg>
          </button>
        )}
      </div>
    </div>
  );
};

const ProjectGallery: React.FC<ProjectGalleryProps> = ({ projects, busy, exporting, onOpen, onRename, onDelete, onExport, onClose }) => {
  const S = getTheme().strings;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center p-6 animate-fade-in select-none">
      <div className="w-full max-w-5xl max-h-full bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between shrink-0">
          <h2 className="text-xl font-bold text-white font-[var(--manga-heading-font)]">{S.myProjects}</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-sm bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-full transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-grow overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-slate-700">
          {projects.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-3 py-16">
              <span className="text-5xl opacity-40">📚</span>
              <p className="text-sm">{S.galleryEmpty}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
              {[...projects]
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .map(entry => (
                  <ProjectCard
                    key={entry.id}
                    entry={entry}
                    busy={busy}
                    exporting={exporting}
                    onOpen={onOpen}
                    onRename={onRename}
                    onDelete={onDelete}
                    onExport={onExport}
                  />
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProjectGallery;
