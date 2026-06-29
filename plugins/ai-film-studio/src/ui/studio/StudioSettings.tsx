/**
 * Toonflow 式重构 · 阶段9（§6.3/§6.6/§8）：工作台设置抽屉内的 Agent 部署 + 记忆配置面板。
 * 与画布的 SettingsView（供应商/外观/存储）并列展示在抽屉里。
 */
import { useEffect, useState } from 'react'
import { useAgentDeployStore, AGENT_KEYS } from '../store/agentDeployStore'
import { useGraphStore } from '../store/graphStore'
import { getMemoryConfig } from './agent/memory'
import { kvSet, STUDIO_KV, DEFAULT_MEMORY_CONFIG, type AgentKey, type MemoryConfig } from '../domain/studioKv'
import Select from '../components/ui/Select'
import Checkbox from '../components/ui/Checkbox'

const AGENT_LABEL: Record<AgentKey, string> = {
  decision: '统筹/决策',
  writer: '编剧',
  artDirector: '美术',
  director: '导演',
  supervision: '监制',
  universal: '通用',
}

export default function StudioSettings() {
  return (
    <div className="afs-studio__settings">
      <AgentDeployPanel />
      <MemoryConfigPanel />
    </div>
  )
}

function AgentDeployPanel() {
  const doc = useAgentDeployStore((s) => s.doc)
  const loaded = useAgentDeployStore((s) => s.loaded)
  const load = useAgentDeployStore((s) => s.load)
  const setMode = useAgentDeployStore((s) => s.setMode)
  const setEntry = useAgentDeployStore((s) => s.setEntry)
  const setAllModel = useAgentDeployStore((s) => s.setAllModel)
  const models = useGraphStore((s) => s.models)
  const selectedModel = useGraphStore((s) => s.selectedModel)
  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])
  const advanced = doc.useMode === 'advanced'
  const rows: AgentKey[] = advanced ? AGENT_KEYS : ['decision']
  return (
    <section className="afs-studio__setsec">
      <h4>Agent 部署</h4>
      <div className="afs-studio__setrow">
        <Checkbox
          checked={advanced}
          onChange={(c) => setMode(c ? 'advanced' : 'simple')}
          label="高级（各子 Agent 独立配置）"
        />
        {selectedModel && (
          <button className="afs-btn afs-btn--sm" onClick={() => setAllModel(selectedModel)} title="把全部 Agent 设为当前文本模型">
            全部设为当前模型
          </button>
        )}
      </div>
      {!advanced && <p className="afs-studio__hint">简易模式：全部 Agent 用「决策」一行的配置（缺省回退全局文本模型）。</p>}
      {rows.map((k) => {
        const e = doc.entries[k] ?? {}
        return (
          <div key={k} className="afs-studio__deployrow">
            <span className="afs-studio__deploylbl">{AGENT_LABEL[k]}</span>
            <Select
              block
              value={e.model ?? ''}
              onChange={(val) => setEntry(k, { model: val || undefined })}
              options={[{ value: '', label: '（用全局）' }, ...models.map((m) => ({ value: m.id, label: m.label || m.id }))]}
              ariaLabel={`${AGENT_LABEL[k]} 模型`}
            />
            <input
              className="afs-field__input afs-studio__deploytemp"
              type="number"
              step={0.1}
              min={0}
              max={2}
              placeholder="温度"
              value={e.temperature ?? ''}
              onChange={(ev) => setEntry(k, { temperature: ev.target.value ? Number(ev.target.value) : undefined })}
            />
          </div>
        )
      })}
    </section>
  )
}

function MemoryConfigPanel() {
  const [mem, setMem] = useState<MemoryConfig>(DEFAULT_MEMORY_CONFIG)
  useEffect(() => {
    void getMemoryConfig().then(setMem)
  }, [])
  const save = (patch: Partial<MemoryConfig>) => {
    const next = { ...mem, ...patch }
    setMem(next)
    void kvSet(STUDIO_KV.memoryConfig, next)
  }
  const FIELDS: { key: keyof MemoryConfig; label: string }[] = [
    { key: 'shortTermLimit', label: '注入近期对话条数' },
    { key: 'messagesPerSummary', label: '累计多少条触发摘要' },
    { key: 'summaryMaxLength', label: '摘要字数上限' },
    { key: 'ragLimit', label: '关键词召回条数' },
  ]
  return (
    <section className="afs-studio__setsec">
      <h4>记忆</h4>
      {FIELDS.map((f) => (
        <div key={f.key} className="afs-studio__setrow">
          <label>{f.label}</label>
          <input
            className="afs-field__input afs-studio__deploytemp"
            type="number"
            min={1}
            value={mem[f.key]}
            onChange={(e) => save({ [f.key]: Number(e.target.value) || mem[f.key] })}
          />
        </div>
      ))}
      <p className="afs-studio__hint">长会话自动压缩成摘要常驻上下文；无可用 embedding 时用关键词召回相关历史。</p>
    </section>
  )
}
