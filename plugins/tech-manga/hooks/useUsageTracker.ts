// ================= 计价器 hook（方案 7.4 步骤 4，从 App.tsx 机械搬移） =================
// 计价表本身留在 services/pricing.ts（7.1 包边界）；本 hook 收敛 tokenUsage 状态、
// trackUsage 查表累计与持久化快照的 usage 校验降级。

import { useState, useCallback } from 'react';
import { priceTextCall, priceImageCall } from '../services/pricing';
import { TokenUsage, UsageStat, ModelUsageBreakdown } from '../types';

export const INITIAL_USAGE: TokenUsage = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalImages: 0,
    estimatedCost: 0,
    unpricedCalls: 0,
    breakdown: {},
    history: []
};

/**
 * 持久化会话里的 tokenUsage 是否符合 5.2 新 schema（breakdown 为 Record<modelId, 对象>、
 * history 条目带 stat.modelId）。5.2 改了 TokenUsage 形状而 session SCHEMA_VERSION 未 bump
 * （避免整个会话被丢弃），旧快照的 usage 部分单独降级重置。
 */
export const sanitizePersistedUsage = (u: unknown): TokenUsage => {
  if (!u || typeof u !== 'object') return INITIAL_USAGE;
  const usage = u as Partial<TokenUsage> & { breakdown?: unknown; history?: unknown };
  const breakdownOk = !!usage.breakdown && typeof usage.breakdown === 'object'
    && Object.values(usage.breakdown as Record<string, unknown>).every(
      (v) => !!v && typeof v === 'object' && typeof (v as ModelUsageBreakdown).inputTokens === 'number'
    );
  const historyOk = Array.isArray(usage.history)
    && usage.history.every((h) => h && typeof h === 'object' && typeof (h as { stat?: { modelId?: unknown } }).stat?.modelId === 'string');
  if (!breakdownOk || !historyOk || typeof usage.unpricedCalls !== 'number') return INITIAL_USAGE;
  return {
    ...INITIAL_USAGE,
    ...usage,
    breakdown: usage.breakdown as Record<string, ModelUsageBreakdown>,
    history: usage.history as TokenUsage['history'],
  };
};

export const useUsageTracker = () => {
  const [tokenUsage, setTokenUsage] = useState<TokenUsage>(INITIAL_USAGE);

  // 方案 5.2：按实际模型 id 查价表计价（图像按张、文本按 MTok）；
  // 未收录模型 cost = null——该次调用只显 token/张数，计入 unpricedCalls，不虚构美元
  const trackUsage = useCallback((action: string, stat: UsageStat) => {
     const cost = stat.kind === 'image'
        ? priceImageCall(stat.modelId, stat.imagesGenerated)
        : priceTextCall(stat.modelId, stat.inputTokens, stat.outputTokens);

     setTokenUsage(prev => {
        const key = stat.modelId || '(未知模型)';
        const prevB = prev.breakdown[key] || { cost: null, inputTokens: 0, outputTokens: 0, images: 0 };
        return {
            totalInputTokens: prev.totalInputTokens + stat.inputTokens,
            totalOutputTokens: prev.totalOutputTokens + stat.outputTokens,
            totalImages: prev.totalImages + stat.imagesGenerated,
            estimatedCost: prev.estimatedCost + (cost ?? 0),
            unpricedCalls: prev.unpricedCalls + (cost == null ? 1 : 0),
            breakdown: {
                ...prev.breakdown,
                [key]: {
                    cost: cost == null ? prevB.cost : (prevB.cost ?? 0) + cost,
                    inputTokens: prevB.inputTokens + stat.inputTokens,
                    outputTokens: prevB.outputTokens + stat.outputTokens,
                    images: prevB.images + stat.imagesGenerated,
                },
            },
            history: [...prev.history, {
                action,
                stat,
                cost,
                timestamp: Date.now()
            }]
        };
     });
  }, []);

  return { tokenUsage, setTokenUsage, trackUsage };
};
