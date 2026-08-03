import { ImageProgress } from '../engine-types';
import { getTheme } from '../theme/registry';
import { stageTextOf } from '@mulby-plugins/manga-kit';

// stage 判定收编进 manga-kit（方案 7.1）；文案属题材 strings（包边界），此处绑定 getTheme().strings。

/** 方案 5.3：进度 chunk → 阶段文案（progress.message 优先；未知 stage 返回 null 用调用方默认文案） */
export const stageText = (p?: ImageProgress): string | null => {
  const S = getTheme().strings;
  return stageTextOf(p, {
    queued: S.stageQueued,
    drawing: S.stageDrawing,
    drawingN: S.stageDrawingN,
    finalizing: S.stageFinalizing,
    fallback: S.stageFallback,
  });
};
