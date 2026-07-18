// ================= 集中价目表（方案 5.2，保守原则） =================
// 宿主不暴露模型价目（AiModel 无 pricing 字段），美元金额只能插件自维护。
// 前缀匹配（modelId 小写化后 startsWith）；匹配不到 → 返回 null：
// 该调用只显 token / 张数，不显美元——宁可不显，不显虚构金额。
// 价目快照：2026-07-18（沿用优化方案 5.2 的示意值；更新时同步修改本注释日期）。

/** 图像模型：按张计价（宿主图像 token 恒为 0/16 的占位值，不可用于计价） */
const IMAGE_PRICE_PER_IMAGE: Array<[prefix: string, usd: number]> = [
  ['gemini-3-pro-image', 0.24],
  ['gpt-image-1', 0.17],
  ['gemini-2.5-flash-image', 0.04],
];

/** 文本模型：按百万 token 计价 [prefix, 输入单价, 输出单价] */
const TEXT_PRICE_PER_MTOK: Array<[prefix: string, inUsd: number, outUsd: number]> = [
  ['gemini-3-pro', 2.0, 12.0],
  ['deepseek', 0.28, 0.42],
];

const matchPrefix = <T extends [string, ...unknown[]]>(rows: T[], modelId: string): T | undefined => {
  const id = modelId.toLowerCase().trim();
  return rows.find(([prefix]) => id.startsWith(prefix));
};

/** 文本调用计价；未收录模型返回 null（只显 token 数） */
export const priceTextCall = (
  modelId: string,
  inputTokens: number,
  outputTokens: number
): number | null => {
  const row = matchPrefix(TEXT_PRICE_PER_MTOK, modelId);
  if (!row) return null;
  const [, inUsd, outUsd] = row;
  return (inputTokens / 1_000_000) * inUsd + (outputTokens / 1_000_000) * outUsd;
};

/** 图像调用按张计价；未收录模型返回 null（只显张数） */
export const priceImageCall = (modelId: string, images: number): number | null => {
  const row = matchPrefix(IMAGE_PRICE_PER_IMAGE, modelId);
  if (!row) return null;
  return images * row[1];
};
