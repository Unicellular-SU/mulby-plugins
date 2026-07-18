import React, { useEffect } from 'react';
import { ComicPageData } from '../types';

// ================= 全屏阅读模式（方案 5.6） =================
// 点击成品图进入；左右方向键 / 点击两侧翻页，Esc 或右上角关闭。
// 仅在有 imageData 的页序列中导航（由父级过滤后传入）。

interface ReaderOverlayProps {
  pages: ComicPageData[];        // 仅含成品图的页，按阅读顺序
  index: number;                 // 当前页下标
  onNavigate: (index: number) => void;
  onClose: () => void;
}

const ReaderOverlay: React.FC<ReaderOverlayProps> = ({ pages, index, onNavigate, onClose }) => {
  const page = pages[index];
  const hasPrev = index > 0;
  const hasNext = index < pages.length - 1;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && index > 0) onNavigate(index - 1);
      else if (e.key === 'ArrowRight' && index < pages.length - 1) onNavigate(index + 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [index, pages.length, onNavigate, onClose]);

  if (!page) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center select-none animate-fade-in">
      {/* 主图 */}
      <img
        src={page.imageData}
        alt={page.layout_description}
        className="max-w-full max-h-full object-contain"
        draggable={false}
      />

      {/* 左右点击翻页区 */}
      {hasPrev && (
        <button
          onClick={() => onNavigate(index - 1)}
          className="absolute left-0 top-0 h-full w-1/4 flex items-center justify-start pl-4 text-white/0 hover:text-white/80 transition-colors"
          title="上一页（←）"
        >
          <span className="text-4xl bg-black/40 rounded-full w-12 h-12 flex items-center justify-center">‹</span>
        </button>
      )}
      {hasNext && (
        <button
          onClick={() => onNavigate(index + 1)}
          className="absolute right-0 top-0 h-full w-1/4 flex items-center justify-end pr-4 text-white/0 hover:text-white/80 transition-colors"
          title="下一页（→）"
        >
          <span className="text-4xl bg-black/40 rounded-full w-12 h-12 flex items-center justify-center">›</span>
        </button>
      )}

      {/* 顶部信息条 */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/70 to-transparent">
        <span className="text-white/90 text-sm font-bold">
          {page.page_number === 0 ? '封面' : `第 ${page.page_number} 页`}
          <span className="text-white/50 font-normal ml-2">{index + 1} / {pages.length}</span>
        </span>
        <button
          onClick={onClose}
          className="text-white/70 hover:text-white text-sm bg-black/40 px-3 py-1.5 rounded-full"
          title="退出阅读模式（Esc）"
        >
          ✕ 退出阅读
        </button>
      </div>
    </div>
  );
};

export default ReaderOverlay;
