// ================= 图像进度阶段文案（方案 5.3；7.1 收编进 manga-kit） =================
// 文案属插件 strings（7.1 包边界：kit 不含任何用户可见文案），以 labels 注入；
// stage 判定结构共享，插件侧各自用 S 绑定（见 tech-manga/utils/progressText.ts）。

/** 进度 chunk 的最小结构（与各插件 ImageProgress 兼容） */
export interface ImageProgressLike {
  stage?: string;
  message?: string;
  received?: number;
  total?: number;
}

export interface ProgressStageLabels {
  queued: string;
  drawing: string;
  drawingN: (received: number, total: number) => string;
  finalizing: string;
  fallback: string;
}

/** 进度 chunk → 阶段文案（progress.message 优先；未知 stage 返回 null 用调用方默认文案） */
export const stageTextOf = (
  p: ImageProgressLike | undefined,
  labels: ProgressStageLabels
): string | null => {
  if (!p) return null;
  if (p.message) return p.message;
  switch (p.stage) {
    case 'start': return labels.queued;
    case 'partial': return (p.received != null && p.total != null)
      ? labels.drawingN(p.received, p.total) : labels.drawing;
    case 'finalizing': return labels.finalizing;
    case 'fallback': return labels.fallback;
    default: return null;
  }
};
