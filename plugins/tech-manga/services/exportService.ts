import JSZip from 'jszip';
import { ComicPageData } from '../types';
import { sniffImageMime, mimeToExt } from '../utils/imageMime';

// ================= 导出与原生保存流（方案 5.5 / 5.6） =================
// 保存统一走 dialog.showSaveDialog + filesystem.writeFile（可拿到落盘路径，
// 支持完成通知与「在文件夹中显示」）；老宿主特性探测降级回 <a download>。
// 导出格式：ZIP 散图 / PDF（jspdf 动态 import，不进主包）/ 竖向长图（canvas 拼接）。

export type SaveResult =
  | { status: 'saved'; path: string }   // 原生保存成功，拿到落盘路径
  | { status: 'cancelled' }             // 用户取消：静默
  | { status: 'legacy' };               // 老宿主降级 <a download>：无路径可用

const dataUrlToArrayBuffer = (dataUrl: string): ArrayBuffer => {
  const base64 = dataUrl.split(',')[1] || dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
};

/** 老宿主降级：<a download>（Electron 默认弹系统保存框，但插件拿不到路径） */
const legacyAnchorDownload = (name: string, data: ArrayBuffer | Blob): void => {
  const blob = data instanceof Blob ? data : new Blob([data]);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
};

/** 原生保存统一封装（方案 5.5）：取消返回 cancelled；写失败原样抛出由调用方提示 */
export const saveBinary = async (
  defaultName: string,
  data: ArrayBuffer,
  filters: { name: string; extensions: string[] }[]
): Promise<SaveResult> => {
  const m = (window as Window).mulby;
  if (!m?.dialog?.showSaveDialog || !m?.filesystem?.writeFile) {
    legacyAnchorDownload(defaultName, data);
    return { status: 'legacy' };
  }
  const path = await m.dialog.showSaveDialog({ title: '保存', defaultPath: defaultName, filters });
  if (!path) return { status: 'cancelled' };
  await m.filesystem.writeFile(path, data);
  return { status: 'saved', path };
};

/** 单页图像保存：扩展名按真实字节魔数（方案 5.6），走原生保存流 */
export const saveImageDataUrl = async (baseName: string, dataUrl: string): Promise<SaveResult> => {
  const b64 = dataUrl.split(',')[1] || dataUrl;
  const ext = mimeToExt(sniffImageMime(b64));
  return saveBinary(`${baseName}.${ext}`, dataUrlToArrayBuffer(dataUrl), [
    { name: '图像', extensions: [ext] },
  ]);
};

/** 在文件夹中显示（特性探测；不可用时静默） */
export const revealInFolder = (path: string): void => {
  try { void (window as Window).mulby?.shell?.showItemInFolder?.(path); } catch { /* ignore */ }
};

// ---- ZIP 散图 ----

export const buildZipArchive = async (
  pagesWithImages: ComicPageData[],
  safeTitle: string
): Promise<ArrayBuffer> => {
  const zip = new JSZip();
  pagesWithImages.forEach((page) => {
    const dataUri = page.imageData!;
    const base64Data = dataUri.split(',')[1];
    const extension = mimeToExt(sniffImageMime(base64Data)); // 后缀与真实字节格式一致
    const fileName = page.page_number === 0
      ? `00_Cover_${safeTitle}.${extension}`
      : `${page.page_number.toString().padStart(2, '0')}_Page_${page.page_number}.${extension}`;
    zip.file(fileName, base64Data, { base64: true });
  });
  return zip.generateAsync({ type: 'arraybuffer' });
};

// ---- PDF（jspdf 动态 import，仅点击导出时才加载该 chunk） ----

const loadImage = (dataUrl: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图像解码失败'));
    img.src = dataUrl;
  });

/** jspdf 不支持 webp：webp/gif 经 canvas 转码为 jpeg（顺带压体积） */
const toPdfImage = async (
  dataUrl: string
): Promise<{ data: string; format: 'PNG' | 'JPEG'; w: number; h: number }> => {
  const img = await loadImage(dataUrl);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const mime = sniffImageMime(dataUrl.split(',')[1] || '');
  if (mime === 'image/png') return { data: dataUrl, format: 'PNG', w, h };
  if (mime === 'image/jpeg') return { data: dataUrl, format: 'JPEG', w, h };
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 canvas 上下文');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0);
  return { data: canvas.toDataURL('image/jpeg', 0.92), format: 'JPEG', w, h };
};

/** 每页按各自图像像素尺寸建页（unit: px + px_scaling hotfix） */
export const buildPdfDocument = async (pagesWithImages: ComicPageData[]): Promise<ArrayBuffer> => {
  const { jsPDF } = await import('jspdf');
  const images: Array<{ data: string; format: 'PNG' | 'JPEG'; w: number; h: number }> = [];
  for (const page of pagesWithImages) {
    images.push(await toPdfImage(page.imageData!));
  }
  const first = images[0];
  const doc = new jsPDF({
    unit: 'px',
    format: [first.w, first.h],
    orientation: first.w > first.h ? 'landscape' : 'portrait',
    hotfixes: ['px_scaling'],
  });
  images.forEach((im, i) => {
    if (i > 0) doc.addPage([im.w, im.h], im.w > im.h ? 'landscape' : 'portrait');
    doc.addImage(im.data, im.format, 0, 0, im.w, im.h);
  });
  return doc.output('arraybuffer');
};

// ---- 竖向长图（canvas 拼接） ----

const LONG_IMAGE_WIDTH = 1024;      // 统一宽度，按比例缩放各页
const MAX_CANVAS_HEIGHT = 30000;    // 低于常见 32767 上限并留余量；超限自动分段

/**
 * 纵向拼接为一张或多张长图（jpeg）。Long（16 页）约 2.4 万 px 高，正常单段；
 * 超守卫自动分段，调用方按段依次保存。
 */
export const buildLongImages = async (pagesWithImages: ComicPageData[]): Promise<ArrayBuffer[]> => {
  const imgs = await Promise.all(pagesWithImages.map((p) => loadImage(p.imageData!)));
  const scaled = imgs.map((img) => ({
    img,
    h: Math.max(1, Math.round((LONG_IMAGE_WIDTH * img.naturalHeight) / Math.max(1, img.naturalWidth))),
  }));

  const segments: Array<typeof scaled> = [];
  let current: typeof scaled = [];
  let currentH = 0;
  for (const s of scaled) {
    if (current.length > 0 && currentH + s.h > MAX_CANVAS_HEIGHT) {
      segments.push(current);
      current = [];
      currentH = 0;
    }
    current.push(s);
    currentH += s.h;
  }
  if (current.length > 0) segments.push(current);

  const out: ArrayBuffer[] = [];
  for (const seg of segments) {
    const totalH = seg.reduce((acc, s) => acc + s.h, 0);
    const canvas = document.createElement('canvas');
    canvas.width = LONG_IMAGE_WIDTH;
    canvas.height = totalH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建 canvas 上下文');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, LONG_IMAGE_WIDTH, totalH);
    let y = 0;
    for (const s of seg) {
      ctx.drawImage(s.img, 0, y, LONG_IMAGE_WIDTH, s.h);
      y += s.h;
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) throw new Error('长图编码失败');
    out.push(await blob.arrayBuffer());
  }
  return out;
};
