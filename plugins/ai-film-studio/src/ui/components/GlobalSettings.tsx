import { useGraphStore } from '../store/graphStore'

const ASPECTS: { value: string; label: string }[] = [
  { value: '16:9', label: '16:9（横屏）' },
  { value: '9:16', label: '9:16（竖屏）' },
  { value: '1:1', label: '1:1（方形）' },
]

/** 项目风格：画风/画幅，属于当前工程；自动注入所有生成节点，画幅决定图像/视频尺寸。由编辑器顶栏「项目风格」打开。 */
export default function GlobalSettings() {
  const globals = useGraphStore((s) => s.globals)
  const setGlobals = useGraphStore((s) => s.setGlobals)
  const projectName = useGraphStore((s) => s.projectName)

  return (
    <div className="afs-settings-pane">
      <div className="afs-modal__body">
        <div className="afs-modal__hint">
          画风与画幅会自动注入<b>当前工程（{projectName}）</b>的所有生成节点（角色 / 场景 / 关键帧 / 视频），并决定图像/视频尺寸，保证跨镜一致。无需在画布上连线。
        </div>

        <div className="afs-field">
          <label className="afs-field__label">画幅</label>
          <select
            className="afs-field__input"
            value={globals.aspectRatio}
            onChange={(e) => setGlobals({ aspectRatio: e.target.value })}
          >
            {ASPECTS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </div>

        <div className="afs-field">
          <label className="afs-field__label">全局画风</label>
          <textarea
            className="afs-field__input"
            rows={3}
            placeholder="如：电影感、赛博朋克、吉卜力水彩、写实 3D 渲染…（用于所有图像/视频生成）"
            value={globals.style}
            onChange={(e) => setGlobals({ style: e.target.value })}
          />
        </div>

        <div className="afs-field">
          <label className="afs-field__label">并发上限</label>
          <select
            className="afs-field__input"
            value={String(globals.concurrency ?? 3)}
            onChange={(e) => setGlobals({ concurrency: Number(e.target.value) })}
          >
            {[1, 2, 3, 4, 6, 8].map((n) => (
              <option key={n} value={n}>
                {n === 1 ? '1（顺序执行）' : `${n} 路并发`}
              </option>
            ))}
          </select>
          <div className="afs-modal__hint" style={{ marginTop: 4 }}>
            单节点扇出时（N 个关键帧 / 角色图 / 视频片段）同时生成的最大数量。视频/图像越多越快，但过大可能触发供应商限流，按 API 额度调整。
          </div>
        </div>
      </div>
    </div>
  )
}
