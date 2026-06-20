// 共享舞台 DOM 引用：供卡片端口连线时换算屏幕→世界坐标
export const stageEl: { current: HTMLDivElement | null } = { current: null }
