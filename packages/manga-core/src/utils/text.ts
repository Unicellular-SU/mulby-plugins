/** 错误摘要截断（方案 5.4）：防错误层溢出 PanelCard 浮层（App 与 useImageQueue 共用） */
export const trimErr = (msg: unknown): string => {
  const s = String(msg ?? '').trim() || '未知错误';
  return s.length > 140 ? `${s.slice(0, 140)}…` : s;
};
