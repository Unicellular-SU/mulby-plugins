// 把本地媒体文件另存到用户选定路径（dialog + filesystem.copy）。
// 共享给 MediaToolbox 下载与剪辑工作台「导出到本地」。

import { toast } from '../store/toastStore'

export async function saveToLocal(localPath: string | null | undefined, suggestedName: string): Promise<boolean> {
  const m = window.mulby
  if (!m?.dialog || !localPath) {
    toast('无可导出文件', 'error')
    return false
  }
  const ext = localPath.split('.').pop() || 'mp4'
  try {
    const dest = await m.dialog.showSaveDialog({ defaultPath: `${suggestedName}.${ext}`, filters: [{ name: '文件', extensions: [ext] }] })
    if (dest) {
      await m.filesystem.copy(localPath, dest)
      toast('已导出：' + dest, 'success')
      return true
    }
  } catch {
    toast('导出失败', 'error')
  }
  return false
}
