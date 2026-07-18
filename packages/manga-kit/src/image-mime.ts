// ================= 图像真实格式探测（方案 5.6；7.1 收编进 manga-kit） =================
// 宿主把图像归一为纯 base64，插件曾恒标 image/png——字节可能是 jpeg/webp，
// 导出后缀会与真实格式不符。按魔数探测真实 mime，探测不出回退 png。

/** 纯 base64（不含 data: 前缀）→ 真实 mime；16 个 base64 字符 → 12 字节，覆盖 WEBP 第 8-11 字节 */
export const sniffImageMime = (b64: string): string => {
  try {
    const head = atob(b64.slice(0, 16));
    if (head.startsWith('\x89PNG')) return 'image/png';
    if (head.startsWith('\xff\xd8')) return 'image/jpeg';
    if (head.slice(0, 4) === 'RIFF' && head.slice(8, 12) === 'WEBP') return 'image/webp';
    if (head.startsWith('GIF8')) return 'image/gif';
  } catch { /* 非法 base64：按 png 兜底 */ }
  return 'image/png';
};

/** mime → 文件扩展名 */
export const mimeToExt = (mime: string): string => {
  switch (mime) {
    case 'image/jpeg': return 'jpg';
    case 'image/webp': return 'webp';
    case 'image/gif': return 'gif';
    case 'image/png':
    default: return 'png';
  }
};

/** dataURL → 扩展名（按真实字节魔数，而非标称 mime） */
export const extOfDataUrl = (dataUrl: string): string => {
  const b64 = dataUrl.split(',')[1] || dataUrl;
  return mimeToExt(sniffImageMime(b64));
};
