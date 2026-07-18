// ================= 共享并发池与重试（方案 4.2，遵守 D1/D4） =================
// 实现收编进 manga-kit（方案 7.1）；此处绑定本插件的全局纪元 getAbortEpoch，
// 保持既有导入路径与签名不变（App 与 CharacterGenerator 零改动）。

import { asyncPool as kitAsyncPool, withRetryOnce as kitWithRetryOnce } from '@mulby-plugins/manga-kit';
import { getAbortEpoch } from './mulbyAiService';

/** 并发上限 limit 的任务池；每次取任务前比对纪元，中止即不再取新任务（D1/D4） */
export const asyncPool = (tasks: Array<() => Promise<void>>, limit = 2): Promise<void> =>
  kitAsyncPool(tasks, limit, getAbortEpoch);

/** 失败自动重试 1 次（AbortError / 鉴权错误 / 纪元已变除外），重试前退避（D4） */
export const withRetryOnce = <T>(fn: () => Promise<T>, delayMs = 1500): Promise<T> =>
  kitWithRetryOnce(fn, getAbortEpoch, delayMs);
