import { useGraphStore } from '../store/graphStore'
import { STYLE_PACKS, getStylePack } from '../services/stylePacks'

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
          <label className="afs-field__label">成片体量</label>
          <select
            className="afs-field__input"
            value={globals.filmScale ?? '短片'}
            onChange={(e) => setGlobals({ filmScale: e.target.value })}
          >
            {['微短片', '短片', '单集', '长片'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <div className="afs-modal__hint" style={{ marginTop: 4 }}>
            一处设定，协调大纲节拍数 + 剧本场数 + 分镜镜头数。想快速测试一小段（≈4 镜、不到 1 分钟）选「微短片」：大纲约 3 拍、剧本 1-2 场、分镜约 3-5 镜。剧本节点的「成片体量」默认跟随此处，可单独覆盖。
          </div>
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
          <label className="afs-field__label">对白语言</label>
          <select
            className="afs-field__input"
            value={globals.dialogueLang ?? '中文'}
            onChange={(e) => setGlobals({ dialogueLang: e.target.value })}
          >
            {['中文', 'English', '日本語', '한국어', 'Español', 'Français'].map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <div className="afs-modal__hint" style={{ marginTop: 4 }}>
            剧本/分镜台词与原生音频/配音都按此语言生成。不设置时模型常默认讲英文——选好这里，台词才说中文。
          </div>
        </div>

        <div className="afs-field">
          <label className="afs-field__label">风格包</label>
          <select
            className="afs-field__input"
            value={globals.stylePackId ?? ''}
            onChange={(e) => setGlobals({ stylePackId: e.target.value || undefined })}
          >
            <option value="">（不使用 · 仅用下方自由画风）</option>
            {STYLE_PACKS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          {getStylePack(globals.stylePackId) && (
            <div className="afs-modal__hint" style={{ marginTop: 4 }}>
              {getStylePack(globals.stylePackId)!.hint} 风格包会向所有图像/视频生成注入统一的色盘 / 光影 / 锚定 / 负向词，根治跨镜画风漂移。下方「自由画风」会叠加其后作为补充。
            </div>
          )}
        </div>

        <div className="afs-field">
          <label className="afs-field__label">{globals.stylePackId ? '自由画风（补充，叠加在风格包之后）' : '全局画风'}</label>
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
