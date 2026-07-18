import { ImageProgress } from '../types';
import { S } from '../strings';
import { stageTextOf } from '@mulby-plugins/manga-kit';

// stage 判定收编进 manga-kit（方案 7.1）；文案属插件 strings（包边界），此处绑定 S。

/** 方案 5.3：进度 chunk → 阶段文案（progress.message 优先；未知 stage 返回 null 用调用方默认文案） */
export const stageText = (p?: ImageProgress): string | null =>
  stageTextOf(p, {
    queued: S.stageQueued,
    drawing: S.stageDrawing,
    drawingN: S.stageDrawingN,
    finalizing: S.stageFinalizing,
    fallback: S.stageFallback,
  });
