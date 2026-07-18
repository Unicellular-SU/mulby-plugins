// @mulby-plugins/manga-kit：manga 系插件公共层（方案 7.1/7.3）。
// 包边界：AI 桥接纯函数 / 中止纪元 scope / 附件缓存 / 并发池进 kit；
// prompt 文案、计价表、strings、persistence schema 与 UI 组件留在各插件。

export { createAbortScope, safeAbort } from './abort-scope';
export type { AbortScope, AbortableAiLike } from './abort-scope';

export { asyncPool, withRetryOnce } from './async-pool';

export { resolveByName } from './name-match';
export type { NamedSheetItem } from './name-match';

export { sniffImageMime, mimeToExt, extOfDataUrl } from './image-mime';

export { stageTextOf } from './progress-text';
export type { ImageProgressLike, ProgressStageLabels } from './progress-text';

export { NO_TOOLS, dataUrlToBuffer, aspectRatioToSize, extractJson, toDataUrl } from './ai-bridge';

export { createAttachmentCache } from './attachment-cache';
export type { AttachmentCache, AttachmentAiLike } from './attachment-cache';
