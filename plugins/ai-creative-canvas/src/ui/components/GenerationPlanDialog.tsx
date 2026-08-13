import { AlertTriangle, Ban, Calculator, CheckCircle2, Coins, Info, Layers3 } from 'lucide-react'
import { useGenerationPlan } from '../store/generationPlanStore'
import { generationPlanBlocked } from '../services/generationPlan'
import { KIND_LABEL } from '../types'
import { Modal } from './Modal'

export function GenerationPlanDialog() {
  const plan = useGenerationPlan((state) => state.plan)
  const decide = useGenerationPlan((state) => state.decide)
  if (!plan) return null
  const blocked = generationPlanBlocked(plan)
  const cost = plan.estimatedCost != null && plan.currency
    ? `${plan.currency} ${plan.estimatedCost.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`
    : plan.costStatus === 'partial' ? '部分可估算' : '未知'
  return (
    <Modal
      title={<span className="flex items-center gap-2"><Calculator size={16} className="text-indigo-500" />{plan.title}</span>}
      width={720}
      onClose={() => decide(false)}
      footer={<>
        <button type="button" onClick={() => decide(false)} className="px-3 py-1.5 rounded-md bg-black/5 dark:bg-white/10 text-xs">取消</button>
        <button type="button" disabled={blocked} onClick={() => decide(true)} className="px-4 py-1.5 rounded-md bg-indigo-500 text-white text-xs disabled:opacity-40">{blocked ? '请先修复冲突' : '确认并开始'}</button>
      </>}
    >
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border p-3" style={{ borderColor: 'var(--ace-border)' }}><div className="flex items-center gap-1.5 text-[11px] opacity-55"><Layers3 size={13} />预计任务</div><div className="mt-1 text-lg font-semibold">{plan.taskCount}</div></div>
          <div className="rounded-lg border p-3" style={{ borderColor: 'var(--ace-border)' }}><div className="flex items-center gap-1.5 text-[11px] opacity-55"><Coins size={13} />预计费用</div><div className="mt-1 text-lg font-semibold">{cost}</div></div>
          <div className="rounded-lg border p-3" style={{ borderColor: 'var(--ace-border)' }}><div className="flex items-center gap-1.5 text-[11px] opacity-55"><Calculator size={13} />Token 估算</div><div className="mt-1 text-lg font-semibold">{plan.estimatedTokens?.toLocaleString() || '未知'}</div></div>
        </div>
        {plan.costStatus !== 'known' && <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-300 p-3 text-xs"><AlertTriangle size={15} className="mt-0.5 shrink-0" /><span>费用并非完整报价。未声明单价的 Provider 或宿主模型会显示未知，请以服务商实际账单为准。</span></div>}
        <div>
          <div className="text-xs font-semibold mb-2">执行明细</div>
          <div className="rounded-lg border divide-y max-h-56 overflow-auto ace-scroll" style={{ borderColor: 'var(--ace-border)' }}>
            {plan.items.map((item) => (
              <div key={item.id} className="grid grid-cols-[1fr_auto] gap-3 px-3 py-2 text-xs">
                <div className="min-w-0"><div className="font-medium truncate">{item.title}</div><div className="text-[10px] opacity-50 mt-0.5">{KIND_LABEL[item.kind]} · {item.modelId || item.providerId || '默认服务'}{item.duration ? ` · ${item.duration}s` : ''}{item.aspect ? ` · ${item.aspect}` : ''}{item.resolution ? ` · ${item.resolution}` : ''}</div></div>
                <div className="text-right"><div>x{item.quantity}</div><div className="text-[10px] opacity-50">{item.estimatedCost != null && item.currency ? `${item.currency} ${item.estimatedCost.toFixed(4)}` : '费用未知'}</div></div>
              </div>
            ))}
          </div>
        </div>
        {!!plan.issues.length && <div>
          <div className="text-xs font-semibold mb-2">预检结果</div>
          <div className="space-y-1.5">
            {plan.issues.map((issue, index) => {
              const Icon = issue.level === 'error' ? Ban : issue.level === 'warning' ? AlertTriangle : issue.level === 'info' ? Info : CheckCircle2
              return <div key={`${issue.message}-${index}`} className={`flex items-start gap-2 rounded-md px-2.5 py-2 text-[11px] ${issue.level === 'error' ? 'bg-red-500/10 text-red-600 dark:text-red-300' : issue.level === 'warning' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-indigo-500/[0.07] text-indigo-600 dark:text-indigo-300'}`}><Icon size={13} className="mt-0.5 shrink-0" />{issue.message}</div>
            })}
          </div>
        </div>}
      </div>
    </Modal>
  )
}
