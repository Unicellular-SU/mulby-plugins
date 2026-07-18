import { getAbortEpoch } from './mulbyAiService';

// ================= 共享并发池与重试（方案 4.2，遵守 D1/D4） =================
// 绘页阶段（App.tsx）与资产阶段（CharacterGenerator）共用；
// 中止机制沿用全局纪元 epoch，不引入 AbortController。

/**
 * 并发上限 limit 的任务池；每次取任务前比对纪元，中止即不再取新任务（D1/D4）。
 * 任务应自行吞错（如 triggerImageGeneration / handleGenerateCharacter 内部已 catch）；
 * 池对意外抛错兜底忽略，保证其余任务不被中断、调用方 void 调用不产生 unhandledrejection。
 */
export async function asyncPool(tasks: Array<() => Promise<void>>, limit = 2): Promise<void> {
  const epoch = getAbortEpoch();
  let next = 0;
  const worker = async () => {
    while (true) {
      if (getAbortEpoch() !== epoch) return; // 中止：不再取新任务
      const i = next++;
      if (i >= tasks.length) return;
      try {
        await tasks[i]();
      } catch { /* 任务需自行吞错；此处兜底防止池整体中断 */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
}

/**
 * 失败自动重试 1 次（AbortError 与鉴权错误除外），重试前退避（D4）。
 * 额外的纪元防线：中止后（epoch 已变）不重试——在途请求被 ai.abort 杀掉时
 * 跨 IPC 错误的 name 恒为 'Error'，仅靠 AbortError 判定会让重试拿新纪元重新计费。
 */
export async function withRetryOnce<T>(fn: () => Promise<T>, delayMs = 1500): Promise<T> {
  const epoch = getAbortEpoch();
  try {
    return await fn();
  } catch (e) {
    const msg = String((e as Error)?.message ?? '');
    if ((e as { name?: string })?.name === 'AbortError') throw e;
    if (getAbortEpoch() !== epoch) throw e; // 本轮已被中止/替代：重试只会白花钱
    if (/403|401|PERMISSION_DENIED|Unauthorized/i.test(msg)) throw e; // 鉴权错误重试无意义
    await new Promise((r) => setTimeout(r, delayMs));
    return fn();
  }
}
