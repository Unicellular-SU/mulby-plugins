# 资产参考图多视图化设计（角色三视图 + 道具多角度）

> 分支：`refactor/manga-core`　状态：**待用户确认，未实施**
> 目标读者：落地实现的 agent。本文含全部改点与边界，照做即可，不要自由发挥。

## 1. 目标与定案

| 资产 | 现状 | 目标 |
|---|---|---|
| 角色定妆照 | 2:3 竖版全身正面单图（1024x1536） | **单张横版多视图设定图**：全身三视图（正/侧/背）+ 面部特写（正/侧），一次生成 |
| 道具设定图 | 1:1 产品单图（1024x1024） | **单张横版多角度设定图**：正面 + 侧面 + 斜后/背面一排，一次生成 |
| 场景设定图 | 1:1 单图 | 不动 |

定案约束（用户拍板）：

- **只用一张图**。不拆"三视图 + 面部表"两张——两张同角色可能样貌互不一致，且多耗 token。单图内多视图天然自洽（同一次采样）。
- **角色参考图表情中立**：设定图是"护照照片"，表情留到漫画页生成时按页 prompt 演绎（见 §4 双防线）。
- 数据模型**零变更**：仍是每资产一张 `referenceImage`，无 schema/持久化/兼容性问题。

## 2. 关键事实：宿主尺寸档位没有真 16:9 / 4:3

`packages/manga-kit/src/ai-bridge.ts` 的 `aspectRatioToSize` 只映射三档画布：

```
1:1 → 1024x1024   横版 → 1536x1024 (3:2)   竖版 → 1024x1536 (2:3)
```

'16:9' 与 '4:3' 都落到 1536x1024（3:2）画布。方案 4.7 的教训：generate 路径的 prompt hint 必须与画布数学一致，否则模型自行留白/加边框凑比例。

**因此本方案的取舍**：角色与道具设定图统一用 `1536x1024`（3:2 横版画布，最接近 16:9 意图），prompt hint 写 `landscape 3:2`，**不写 16:9 / 4:3**。用户要的"更宽画幅容纳多视图"的意图由 3:2 横版兑现。若未来宿主支持真 16:9 画布，只改 size 一处。

## 3. 改动点（文件级）

### 3.1 `packages/manga-core/src/services/mulbyAiService.ts`

**`generateCharacterReference`（现 :1236）**——prompt 重写 + size 改 `1536x1024`：

- 保留：franchise 身份锁定段（OFFICIAL/CANONICAL 设计、历史人物按画像）、COSTUME 段、Target Art Style 插值——这些是 tech 主题语义，逐字不动
- Visual Instructions 改为单图多视图布局（英文，题材中性）：
  - `A single character turnaround sheet on one canvas, white background`
  - 布局：`Left to right: (1) full-body front view, (2) full-body side view, (3) full-body back view, (4) face close-up front, (5) face close-up side/profile`
  - 一致性：`All five views depict the SAME character with identical face, hairstyle, body type and costume`
  - **表情中立**：`Neutral, relaxed expression in ALL views — calm face, relaxed brows, closed mouth, no strong emotion (this is a reference sheet, not a scene)`
  - 姿态：`standing neutral pose for the three full-body views`
  - `NO TEXT, no labels, no annotations`
  - hint 行改为 `Output image aspect ratio: landscape 3:2`，与 size 一致（不再犯 4.7 的谎报问题）
- size：`'1024x1536'` → `'1536x1024'`

**`generatePropReference`（现 :1299）**——prompt 调整 + size 改 `1536x1024`：

- 保留 universe instruction 逻辑与 NO TEXT
- COMPOSITION 改为：`Multi-angle product reference sheet on one canvas: front view, side view, and three-quarter back view of the SAME item arranged in a row, white background, neutral lighting, consistent details across views`
- hint 行 `square 1:1` → `landscape 3:2`；size `'1024x1024'` → `'1536x1024'`

**`generatePanelImage` 参考图指令（现 :1444-1464）**——补表情条款（第二道防线）：

- 在 `ACTION (DYNAMIC)` / `DO NOT COPY THE POSE` 同族位置追加：
  `- **EXPRESSION (DYNAMIC)**: Reference faces show a NEUTRAL expression by design. Do NOT copy it — the character's emotion/expression MUST follow the TEXT PROMPT (e.g., terrified, furious, smiling).`

### 3.2 `packages/manga-core/src/components/CharacterGenerator.tsx`

- 角色卡与道具卡的图片显示比例：角色卡由 2:3 竖版容器改为横版（`aspect-[3/2]`），道具卡 1:1 → 同 `aspect-[3/2]`；占位图标/空态不变
- 交互不变：仍是一次生成出一张图、重生成、上传替换——**没有第二张图，没有新交互**
- 场景卡不动

### 3.3 不需要动的（明确列出，防过度实现）

- 类型/schema：`referenceImage` 仍是单 dataURL，`CharacterSheetItem`/`PropSheetItem` 不变
- 持久化：附件 id（`char-<name>`/`prop-<name>`）、快照、恢复链路全不变
- `promptBuilder` refs 解析：每资产仍贡献 1 张 ref，refs 数量不变，无需截断策略
- ConfigPanel：不加开关（单图方案无额外成本，无需 multiViewReference 选项）
- horror 主题：无题材专属改动（两个生成函数在核心包，双插件自动生效）

## 4. 表情中立的双防线（设计意图，实现时别漏）

1. **生成端**（§3.1）：设定图 prompt 强制全视图 neutral expression。
2. **使用端**（§3.1 generatePanelImage）：告诉图像模型"参考图面无表情是刻意的，不要照抄，表情按 TEXT PROMPT 演"。tech 的页 prompt 已有 `[ACTION STATE OVERRIDE]`、horror 有 `[VISUAL STATE]`/否定强调，情绪由这些页级指令承载，与本条款不冲突。

## 5. 兼容与边界

- **旧工程**：已生成的 2:3 竖版单视图定妆照完全有效，继续作为参考图使用；用户在资产工坊点"重生成"即得新版横版三视图。无需迁移。
- **回退行为**：若模型在多视图布局上发挥不稳（视图缺失/人物不一致），用户可重生成或上传自制设定图，链路与现状相同。
- **成本**：每资产生成张数不变，token 成本与现状持平（画布从竖版换横版，单张 token 同档）。
- 风险接受：单图 5 视图会压缩每个视图的像素预算——1536 宽排 3 个全身 + 2 个面部特写，面部细节可能不如原 2:3 单图锐利。这是"自洽优先于单视图精度"的既定取舍；如实测面部一致性反而下降，回退方案是面部特写减为 1 个（正面），给三视图让出像素。

## 6. 验收标准（实现 agent 执行）

1. 双插件 `pnpm run build` 全绿。
2. 核心包 grep 无题材字样；两个生成函数中 franchise/costume/universe 等既有语义段逐字保留（diff 自查）。
3. hint 与 size 一致性检查：`landscape 3:2` ↔ `1536x1024` 三处（角色、道具、页生成不受影响）。
4. 实机冒烟（由用户做）：生成一个角色 → 定妆照为横版三视图+面部特写、面无表情；逐页绘制时角色跨页一致性主观对比旧版。
