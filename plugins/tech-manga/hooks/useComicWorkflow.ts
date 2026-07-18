// ================= 工作流状态机 hook（方案 7.4 步骤 1，从 App.tsx 机械搬移） =================
// 收敛 workflowStep / isProcessing / globalError 三元组、handleCancelAll 统一中止入口
// （D2 的两个入口——Start Over 与重新生成——均经它清场）与鉴权错误归一。
// 偏差记录：方案原文设计为 useReducer 显式化合法转移；按「机械搬移、不重写逻辑」纪律，
// 本次保持 useState + 既有转移语义原样收敛，reducer 化记 TODO 留待后续行为批次（见方案 1.5）。

import { useState, useCallback } from 'react';
import { abortAllAiTasks } from '../services/mulbyAiService';
import { ComicPageData, WorkflowStep } from '../types';
import { S } from '../strings';

interface UseComicWorkflowDeps {
  setPages: (updater: (prev: ComicPageData[]) => ComicPageData[]) => void;
  /** 方案 5.1 的批次通知一次性标志（App 持有）：中止场景不弹批次通知 */
  batchRef: { current: { active: boolean; epoch: number } };
}

export const useComicWorkflow = ({ setPages, batchRef }: UseComicWorkflowDeps) => {
  const [workflowStep, setWorkflowStep] = useState<WorkflowStep>(WorkflowStep.CONFIG);
  const [isProcessing, setIsProcessing] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // 一键中止：杀掉文本流请求、作废在途图像结果；排队任务由 asyncPool 的纪元检查自然停止（方案 4.2）
  const handleCancelAll = useCallback(() => {
    abortAllAiTasks();
    batchRef.current.active = false;   // 方案 5.1：中止场景不弹批次通知
    setIsProcessing(false);
    setPages(prev => prev.map(p =>
      p.isGenerating ? { ...p, isGenerating: false, progress: undefined, error: S.pageAborted } : p
    ));
    // 中止剧本生成的"回到配置页"语义统一收敛在此（方案 2.1 步骤 4）
    setWorkflowStep(prev => prev === WorkflowStep.SCRIPT_GENERATION ? WorkflowStep.CONFIG : prev);
  }, []);

  const handlePermissionError = (error: any) => {
    const msg = error.message || JSON.stringify(error);
    if (msg.includes("403") || msg.includes("PERMISSION_DENIED") || msg.includes("permission") || msg.includes("Unauthorized") || msg.includes("401")) {
       setGlobalError("模型调用被拒绝（鉴权失败）。请到 Mulby 设置 → AI 中检查所选模型的 Provider 与 API Key 配置。");
       return true;
    }
    return false;
  };

  return {
    workflowStep, setWorkflowStep,
    isProcessing, setIsProcessing,
    globalError, setGlobalError,
    handleCancelAll,
    handlePermissionError,
  };
};
