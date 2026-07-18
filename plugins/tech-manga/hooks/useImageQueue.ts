// ================= 图像生成队列 hook（方案 7.4 步骤 2，从 App.tsx 机械搬移） =================
// 收敛：单页绘制 triggerImageGeneration（D1 运行代际检查 + D4 withRetryOnce + D5 增量落盘挂点）
// 与批量调度 runBatch（asyncPool(limit=2) + 方案 5.1 批次收尾通知）。
// batchRef 由 App 持有并传入：handleCancelAll（中止时关标志、不弹通知）与本 hook（批次消费）共用。

import { useRef, useEffect } from 'react';
import { generatePanelImage, getAbortEpoch, isStale } from '../services/mulbyAiService';
import { asyncPool, withRetryOnce } from '../services/asyncPool';
import { putImageAttachment, attIdForPage } from '../services/persistenceService';
import { ComicPageData, ImageProgress, UsageStat } from '../types';
import { S, trimErr } from '../strings';

export interface ImageQueueJob {
  page: ComicPageData;
  refs?: string[];
}

interface UseImageQueueDeps {
  pages: ComicPageData[];
  setPages: (updater: (prev: ComicPageData[]) => ComicPageData[]) => void;
  /** 方案 5.1 的批次通知一次性标志（App 持有；handleCancelAll 中止时置 active=false） */
  batchRef: { current: { active: boolean; epoch: number } };
  trackUsage: (action: string, stat: UsageStat) => void;
  handlePermissionError: (error: any) => boolean;
  notify: (message: string, type?: 'error') => void;
}

export const useImageQueue = ({
  pages,
  setPages,
  batchRef,
  trackUsage,
  handlePermissionError,
  notify,
}: UseImageQueueDeps) => {
  // pagesRef 供长批次结束后读取最新页数组（闭包里的 pages 是旧值）
  const pagesRef = useRef<ComicPageData[]>([]);
  useEffect(() => { pagesRef.current = pages; }, [pages]);

  /**
   * 批次收尾通知（方案 5.1）：中止不弹（handleCancelAll 关标志 + epoch 校验）、
   * 单页重绘不弹（handleRegeneratePage 不开标志）、标志一次性消费防重复。
   * runEpoch 为本批次启动时捕获的纪元：中止后立即续绘时，旧批次迟到的 settle
   * 因纪元不匹配直接返回，不会误消费新批次的标志（运行代际检查，D1）。
   * 有失败恒弹 error（带声）；全部成功仅在用户切走时弹（静音）。
   */
  const notifyBatchSettled = (runEpoch: number, title?: string) => {
      const batch = batchRef.current;
      if (!batch.active || batch.epoch !== runEpoch || isStale(runEpoch)) return;
      batch.active = false;                       // 一次性消费
      const latest = pagesRef.current;            // 闭包里的 pages 是旧值，走 ref 取最新
      const done = latest.filter(p => !!p.imageData).length;
      const failed = latest.filter(p => !!p.error).length;
      const name = title || latest[0]?.title || S.untitled;
      if (failed > 0) notify(S.notifyBatchFailed(name, done, failed), 'error');
      else if (document.hidden) notify(S.notifyBatchDone(name, done));
  };

  const triggerImageGeneration = async (page: ComicPageData, ratio: string, references?: string[]) => {
    const runEpoch = getAbortEpoch();   // 本任务的运行代际；迟到回调不得写回新一轮的 pages

    // 方案 5.3：流式进度写入该页（150ms 节流；带预览的 chunk 不节流；epoch 变更即丢弃）
    let lastProgressAt = 0;
    const onProgress = (p: ImageProgress) => {
        if (isStale(runEpoch)) return;
        const now = Date.now();
        if (!p.preview && now - lastProgressAt < 150) return;
        lastProgressAt = now;
        setPages(prev => prev.map(pg =>
            pg.page_number === page.page_number && pg.isGenerating
            ? { ...pg, progress: { ...pg.progress, ...p, preview: p.preview ?? pg.progress?.preview } }
            : pg
        ));
    };

    try {
        // 方案 4.2（D4）：失败自动重试一次（AbortError/鉴权错误/纪元已变除外）；
        // 重试的 onUsage 会记两笔，属真实计费，正确。
        const base64Image = await withRetryOnce(() => generatePanelImage(
            page.image_prompt,
            ratio,
            references,
            (stat) => trackUsage(`Draw Page ${page.page_number}`, stat),
            onProgress
        ));
        if (isStale(runEpoch)) return;

        // 单页成功即增量落盘（方案 3.1 步骤 3）：fire-and-forget，失败不打断生成流程
        void putImageAttachment(attIdForPage(page.page_number), base64Image);

        setPages(prev => prev.map(p =>
            p.page_number === page.page_number
            ? { ...p, imageData: base64Image, isGenerating: false, error: undefined, progress: undefined }
            : p
        ));
    } catch (error: any) {
        if (isStale(runEpoch)) return;  // 中止/新一轮开始后迟到的错误：丢弃（页面状态已由 handleCancelAll 统一标记）
        if (error?.name === 'AbortError') {
           setPages(prev => prev.map(p =>
               p.page_number === page.page_number
               ? { ...p, isGenerating: false, error: S.pageAborted, progress: undefined }
               : p
           ));
           return;
        }
        if (handlePermissionError(error)) {
           setPages(prev => prev.map(p =>
               p.page_number === page.page_number
               ? { ...p, isGenerating: false, progress: undefined }
               : p
           ));
           return;
        }
        // 方案 5.4：透出真实原因摘要与行动建议，不再吞成固定英文文案
        setPages(prev => prev.map(p =>
            p.page_number === page.page_number
            ? { ...p, isGenerating: false, error: S.pageDrawFailed(trimErr(error?.message)), progress: undefined }
            : p
        ));
    }
  };

  /** 批量绘制（方案 4.2/5.1 的既有组合原样搬移）：批次标志 → asyncPool(limit=2) → 收尾通知 */
  const runBatch = async (jobs: ImageQueueJob[], ratio: string, title?: string) => {
      // 方案 5.1：批次收尾通知挂在池全部 settle 之后；一次性标志 + epoch 双保险防噪
      const batchEpoch = getAbortEpoch();
      batchRef.current = { active: true, epoch: batchEpoch };
      await asyncPool(jobs.map((j) => () =>
        triggerImageGeneration(j.page, ratio, j.refs)
      ), 2);
      notifyBatchSettled(batchEpoch, title);
  };

  return { triggerImageGeneration, runBatch };
};
