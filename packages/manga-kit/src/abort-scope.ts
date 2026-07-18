// ================= 中止纪元 scope（方案 7.3，遵守 D1） =================
// 全局纪元 epoch 机制的工厂化收编（从 tech-manga services/mulbyAiService.ts 的模块级五件套平移）：
// - 每次 abortAll() 递增纪元；任务在开始时捕获当前纪元，跨 await 后发现纪元已变即视为过期；
// - 流式调用经 trackIfCurrent 登记 requestId，abortAll 时通过 ai.abort(requestId) 真正杀掉请求；
// - 中止后新发起的任务捕获的是新纪元，无需任何重置即可正常运行。
// 插件侧以模块级默认实例使用（即"每窗口一份"的现语义）；未来若迁入插件后端
// （同插件多窗口共享 utilityProcess），改为按窗口/会话实例化并经参数下发即可。

/** 中止所需的最小 AI 表面：兼容插件 UI 的 window.mulby.ai（abort 返回 Promise<void>）
 *  与未来插件后端 context.api（abort 返回 void）。 */
export interface AbortableAiLike {
  abort(id: string): unknown;
}

/** ai.abort 是 IPC Promise，需同时防同步抛与 Promise 拒绝（老宿主返回 void 时 ?.catch?. 安全跳过） */
export const safeAbort = (ai: AbortableAiLike, id: string) => {
  try { (ai.abort(id) as Promise<void> | undefined)?.catch?.(() => { /* ignore */ }); } catch { /* ignore */ }
};

export interface AbortScope {
  /** 当前中止纪元；队列型调用方（如资产连续生成循环）可在循环中比对以停止推进 */
  epoch(): number;
  /** 捕获时纪元是否仍为当前纪元（false = 用户中止过 / 新一轮已开始） */
  isCurrent(epochAtStart: number): boolean;
  /** 纪元已变则抛 AbortError（DOMException） */
  throwIfAborted(epochAtStart: number): void;
  /** 登记流式 requestId；若捕获时纪元已变则返回 false（不登记），调用方应立即 safeAbort(ai, id) */
  trackIfCurrent(epochAtStart: number, requestId: string): boolean;
  /** 注销 requestId（请求结束时调用） */
  untrack(requestId: string): void;
  /** 一键中止：递增纪元、对全部已登记 requestId 调用 ai.abort 并清空登记集合 */
  abortAll(): void;
}

export const createAbortScope = (getAiApi: () => AbortableAiLike | undefined): AbortScope => {
  let epoch = 0;
  const active = new Set<string>();
  return {
    epoch: () => epoch,
    isCurrent: (e) => e === epoch,
    throwIfAborted(e) {
      if (e !== epoch) throw new DOMException('Aborted', 'AbortError');
    },
    trackIfCurrent(e, id) {
      if (e !== epoch) return false;
      active.add(id);
      return true;
    },
    untrack(id) {
      active.delete(id);
    },
    abortAll() {
      epoch += 1;
      const ai = getAiApi();
      if (ai) {
        active.forEach((id) => safeAbort(ai, id));
      }
      active.clear();
    }
  };
};
