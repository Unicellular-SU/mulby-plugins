// 平台导出预设（纯数据）：常见短视频/长视频平台的比例·分辨率·帧率·画质·画幅适配建议
// 设计依据：docs/ai-creative-canvas-video-editor.md §4.7「平台预设」

import type { FitMode } from './types'

export interface PlatformPreset {
  id: string
  label: string
  w: number
  h: number
  fps: number
  crf: number
  fit: FitMode // 原视频比例不符时如何适配目标画幅
  ratio: string
}

export const PLATFORM_PRESETS: PlatformPreset[] = [
  { id: 'douyin', label: '抖音 / 快手 竖屏', w: 1080, h: 1920, fps: 30, crf: 23, fit: 'blur-pad', ratio: '9:16' },
  { id: 'shipinhao', label: '微信视频号 竖屏', w: 1080, h: 1920, fps: 30, crf: 23, fit: 'blur-pad', ratio: '9:16' },
  { id: 'xhs', label: '小红书 竖屏', w: 1080, h: 1440, fps: 30, crf: 23, fit: 'blur-pad', ratio: '3:4' },
  { id: 'bilibili', label: 'B站 横屏 1080p', w: 1920, h: 1080, fps: 30, crf: 21, fit: 'contain', ratio: '16:9' },
  { id: 'youtube', label: 'YouTube 1080p', w: 1920, h: 1080, fps: 30, crf: 20, fit: 'contain', ratio: '16:9' },
  { id: 'wechat-sq', label: '方屏 1:1', w: 1080, h: 1080, fps: 30, crf: 23, fit: 'cover', ratio: '1:1' }
]
