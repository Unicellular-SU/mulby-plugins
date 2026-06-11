// 主线程协作工具：让步 + 取消，用于大文件逐页处理时保持 UI 响应并支持中断。

export class CancelledError extends Error {
    constructor(message = '已取消') {
        super(message);
        this.name = 'CancelledError';
    }
}

/** 识别取消类异常（CancelledError 或标准 AbortError），便于调用方区分"取消"与"真失败"。 */
export function isCancelled(err: unknown): boolean {
    if (err instanceof CancelledError) return true;
    const name = (err as { name?: string } | null)?.name;
    return name === 'AbortError' || name === 'CancelledError';
}

/** 若已请求取消则抛出 CancelledError。 */
export function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw new CancelledError();
    }
}

/**
 * 让出主线程一拍，使浏览器有机会重绘（进度条/按钮）并处理用户的取消点击。
 * 在逐页处理的循环中调用，避免长任务把 UI 冻死。
 */
export function yieldToMain(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}
