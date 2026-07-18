// ================= 参考图附件缓存（方案 4.1，遵守 D3；7.1 收编进 manga-kit） =================
// 同一张参考图整轮会话只上传一次：key = dataUrl 前 256 字符 + 长度，
// value 为 Promise 化 attachmentId（并发页同时 miss 时也只上传一次）。
// 宿主 AttachmentStore 无 TTL、消费后不删除，跨页复用安全；命中后仍以
// attachments.get 校验失效（宿主重启等），失效即重传。
// 不在上传后 finally 删除——统一在新剧本生成成功 / Start Over 时经 clear 批量清理（D3）。

import { dataUrlToBuffer } from './ai-bridge';

/** 附件缓存所需的最小 AI 表面（与 window.mulby.ai 结构兼容） */
export interface AttachmentAiLike {
  attachments: {
    upload(input: { buffer: ArrayBuffer; mimeType: string; purpose: 'vision' }): Promise<{ attachmentId: string }>;
    get(attachmentId: string): Promise<unknown | null>;
    delete(attachmentId: string): unknown;
  };
}

export interface AttachmentCache {
  /** dataURL → attachmentId（缓存命中即复用；命中失效则重传） */
  upload(ai: AttachmentAiLike, dataUrl: string): Promise<string>;
  /** 删除全部已缓存附件并清空缓存（宿主对附件无 TTL / 会话清理任务，批量 delete 属必要清理） */
  clear(): void;
}

export const createAttachmentCache = (
  getAiApi: () => AttachmentAiLike | undefined
): AttachmentCache => {
  const cache = new Map<string, Promise<string>>();
  const cacheKeyOf = (dataUrl: string) => `${dataUrl.slice(0, 256)}:${dataUrl.length}`;

  const upload = (ai: AttachmentAiLike, dataUrl: string): Promise<string> => {
    const key = cacheKeyOf(dataUrl);
    const hit = cache.get(key);
    if (hit) {
      // 命中失效校验：attachments.get 为 null 则重传（D3）
      return hit.then(async (id) => {
        const meta = await ai.attachments.get(id).catch(() => null);
        if (meta) return id;
        cache.delete(key);
        return upload(ai, dataUrl);
      });
    }
    const p = (async () => {
      const { mimeType, buffer } = dataUrlToBuffer(dataUrl);
      const att = await ai.attachments.upload({ buffer, mimeType, purpose: 'vision' });
      return att.attachmentId;
    })();
    p.catch(() => cache.delete(key)); // 上传失败不留脏缓存
    cache.set(key, p);
    return p;
  };

  return {
    upload,
    clear() {
      const ai = getAiApi();
      cache.forEach((p) =>
        p.then((id) => ai?.attachments.delete(id)).catch(() => { /* ignore */ })
      );
      cache.clear();
    }
  };
};
