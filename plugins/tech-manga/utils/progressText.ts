import { ImageProgress } from '../types';
import { S } from '../strings';

/** 方案 5.3：进度 chunk → 阶段文案（progress.message 优先；未知 stage 返回 null 用调用方默认文案） */
export const stageText = (p?: ImageProgress): string | null => {
  if (!p) return null;
  if (p.message) return p.message;
  switch (p.stage) {
    case 'start': return S.stageQueued;
    case 'partial': return (p.received != null && p.total != null)
      ? S.stageDrawingN(p.received, p.total) : S.stageDrawing;
    case 'finalizing': return S.stageFinalizing;
    case 'fallback': return S.stageFallback;
    default: return null;
  }
};
