type NotificationLike = {
    show: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
};

/**
 * 统一的输出成功提示：展示输出文件名。
 *
 * 注意：不自动调用 shell.showItemInFolder —— 在 Mulby 中打开文件管理器会使主窗口
 * 失焦并自动隐藏（参见 MergePDF 的历史规避）。如需"打开所在文件夹"，应作为
 * 用户主动点击的显式动作，而非处理完成后自动触发。
 */
export function notifyOutput(
    notification: NotificationLike,
    outputPath: string,
    prefix = '已保存',
): void {
    const name = outputPath.split(/[/\\]/).pop() || outputPath;
    notification.show(`${prefix}：${name}`, 'success');
}
