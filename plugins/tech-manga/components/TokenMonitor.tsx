
import React, { useState } from 'react';
import { TokenUsage, ModelUsageBreakdown } from '../types';
import { S } from '../strings';

// ================= 费用监控（方案 5.2 重写） =================
// 不再硬编码 Gemini 三行：按 breakdown 的实际 modelId 动态渲染；
// 未计价模型只显 token/张数；所有金额带「估算」角标；总额注明未计价调用数。

interface TokenMonitorProps {
  usage: TokenUsage;
}

const TokenMonitor: React.FC<TokenMonitorProps> = ({ usage }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const breakdownEntries = Object.entries(usage.breakdown) as Array<[string, ModelUsageBreakdown]>;

  return (
    <div
        className={`fixed top-20 right-4 z-40 bg-slate-900/95 backdrop-blur-md border border-slate-700 rounded-lg shadow-2xl transition-all duration-300 ease-in-out overflow-hidden ${isExpanded ? 'w-96' : 'w-48'} hover:border-slate-500`}
        onMouseEnter={() => setIsExpanded(true)}
        onMouseLeave={() => setIsExpanded(false)}
    >
      <div className="p-3">
        <div className="flex items-center justify-between border-b border-slate-700 pb-2 mb-2">
            <div className="flex items-center text-indigo-400 font-bold text-xs tracking-wider">
                <svg className="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>
                {S.taskCost}
            </div>
            <div className="text-green-400 font-bold text-sm">
                ${usage.estimatedCost.toFixed(4)}
                <span className="text-[9px] text-slate-500 font-normal ml-1">{S.estimatedBadge}</span>
            </div>
        </div>

        <div className="space-y-1.5 text-xs font-mono text-slate-300">
             <div className="flex justify-between items-center">
                <span className="text-slate-500">{S.totalTokens}</span>
                <span className="text-white bg-slate-800 px-1.5 rounded">{(usage.totalInputTokens + usage.totalOutputTokens).toLocaleString()}</span>
             </div>
             <div className="flex justify-between items-center">
                <span className="text-slate-500">{S.imagesGenerated}</span>
                <span className="text-yellow-400 font-bold">{usage.totalImages}</span>
             </div>
             {usage.unpricedCalls > 0 && (
             <div className="text-[10px] text-amber-400/90">
                {S.unpricedCalls(usage.unpricedCalls)}
             </div>
             )}
        </div>

        {isExpanded && (
            <div className="mt-3 pt-2 border-t border-slate-700 animate-fade-in space-y-4">

                {/* 按实际模型 id 分组（方案 5.2：无任何硬编码模型名） */}
                <div>
                  <p className="text-[10px] text-slate-500 mb-1 uppercase tracking-wider font-bold">{S.costBreakdown}</p>
                  {breakdownEntries.length === 0 ? (
                      <p className="text-[10px] text-slate-600 italic">{S.noActivity}</p>
                  ) : (
                  <div className="space-y-1 text-[10px] text-slate-400">
                    {breakdownEntries.map(([modelId, b]) => (
                      <div key={modelId} className="flex justify-between items-baseline gap-2">
                        <span className="truncate min-w-0" title={modelId}>{modelId}</span>
                        <span className="text-slate-200 shrink-0">
                          {b.cost != null
                            ? <>
                                ${b.cost.toFixed(4)}
                                <span className="text-[8px] text-slate-500 ml-0.5">{S.estimatedBadge}</span>
                              </>
                            : (b.images > 0
                                ? `${b.images} 张 · ${S.unpricedRow}`
                                : `${(b.inputTokens + b.outputTokens).toLocaleString()} tok · ${S.unpricedRow}`)}
                        </span>
                      </div>
                    ))}
                  </div>
                  )}
                </div>

                {/* Detailed Logs */}
                <div>
                    <p className="text-[10px] text-slate-500 mb-2 uppercase tracking-wider font-bold">{S.recentActivity}</p>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700 pr-1">
                        {usage.history.length === 0 ? (
                            <p className="text-[10px] text-slate-600 italic">{S.noActivity}</p>
                        ) : (
                            usage.history.slice().reverse().map((h, i) => (
                                <div key={i} className="flex flex-col border-b border-slate-800/50 pb-1 last:border-0">
                                    <div className="flex justify-between items-baseline">
                                        <span className="text-[10px] font-bold text-slate-300 truncate w-32">{h.action}</span>
                                        <span className="text-[10px] text-green-400 font-mono">
                                            {h.cost != null
                                              ? `+$${h.cost.toFixed(4)}${h.stat.estimated ? '*' : ''}`
                                              : (h.stat.kind === 'image'
                                                  ? `${h.stat.imagesGenerated} 张`
                                                  : `${(h.stat.inputTokens + h.stat.outputTokens).toLocaleString()} tok`)}
                                        </span>
                                    </div>
                                    <div className="flex justify-between text-[9px] text-slate-500 mt-0.5">
                                        <span className="truncate max-w-[200px]" title={h.stat.modelId}>
                                            {h.stat.modelId}
                                        </span>
                                        <span className="text-[9px] shrink-0">
                                            {new Date(h.timestamp).toLocaleTimeString([], { hour12: false, hour:'2-digit', minute:'2-digit', second:'2-digit' })}
                                        </span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                    <p className="text-[9px] text-slate-600 mt-1.5">* = token 数来自兜底估算；金额均为估算值</p>
                </div>
            </div>
        )}
      </div>
    </div>
  );
};

export default TokenMonitor;
