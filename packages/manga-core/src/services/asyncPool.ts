// ================= 共享并发池（遵守 D1） =================
// 实现收编进 manga-kit；此处绑定本插件的全局纪元 getAbortEpoch，
// 保持既有导入路径与签名不变。

import { asyncPool as kitAsyncPool } from '@mulby-plugins/manga-kit';
import { getAbortEpoch } from './mulbyAiService';

/** 并发上限 limit 的任务池；每次取任务前比对纪元，中止即不再取新任务（D1/D4） */
export const asyncPool = (tasks: Array<() => Promise<void>>, limit = 2): Promise<void> =>
  kitAsyncPool(tasks, limit, getAbortEpoch);
