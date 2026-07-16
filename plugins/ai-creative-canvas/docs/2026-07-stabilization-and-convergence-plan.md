# AI 创意画布 · 下一阶段方案：稳定化与收敛（2026-07）

> 状态：进行中（M1 已完成，M2 部分完成）
> 前置：截至 `d360b02`（2026-07-04）的全部提交。
> 背景：插件自 2026-06-20 首次提交以来累计 107 次提交，功能扩张极快——尤其 06-30 晚间的
> 剪辑工作台冲刺（一晚 ~18 个 feat）与随后的 3 次 UI 范式切换（5 区 NLE → PS 风 → CapCut/剪映）。
> 本阶段**不再新增大功能面**，目标是把已有能力夯实、收尾、收敛。

---

## 0. 总览

四个工作流（Workstream），按优先级排序：

| # | 工作流 | 性质 | 预估规模 | 优先级 |
|---|---|---|---|---|
| WS1 | 剪辑工作台稳定化 | 测试 + fix 批次 | 大 | P0 |
| WS2 | `@` 引用体验收尾（pill 化） | 小功能 + 修文档 | 小 | P1 |
| WS3 | 360 专用模型路线验证与清理 | 验证 + 清理 | 中 | P1 |
| WS4 | 两套时间线收敛（画布时间线 ⇆ 工作台） | 架构决策 + 打通 | 中 | P2 |

建议执行顺序：WS1 → WS2 → WS3 → WS4。WS2/WS3 相互独立，可与 WS1 的修复批次穿插进行。

---

## WS1 · 剪辑工作台稳定化（P0）

### 1.1 背景与风险面

工作台的架构是三层：

- **数据层**：`src/ui/services/videoEdit/types.ts` —— 纯 JSON 编辑栈（`EditStack`），
  op 大类编译顺序由 `OP_KIND_ORDER` 钉死（trim → speed → transform → color → overlay → audio → export）。
- **导出层**：`videoEdit/compile.ts`（22KB 滤镜图编译器）+ `videoEdit/run.ts`（执行器），
  把编辑栈编译成 ffmpeg 命令；配方存 `card.meta.editRecipe` 支持二次编辑。
- **预览层**：`videoEdit/preview.ts` —— CSS filter/transform/clip + DOM 叠加的**近似**预览，
  映射不了的置 `exact=false`。

06-30 一晚平均每 4 分钟一个 feat 提交，随后 UI 又推倒重来两次（`VideoStudioModal.tsx`
现已膨胀到 75KB）。**没有任何一个功能经历过完整的组合测试**。主要风险面：

1. **预览 ↔ 导出不一致**：坐标系（overlay `rect` 归一坐标在预览 DOM 与 ffmpeg overlay 里的换算）、
   时间基（`OverlayRange.start/end` 是源时间基，编译器按累计 rate 折算——trim+speed+overlay 组合下最容易错）。
2. **op 组合爆炸**：trim 多段 + reverse + boomerang + freezeEnd + Ken-Burns + PiP + 字幕的
   任意组合，编译器滤镜图拼接是否都合法（ffmpeg 直接报错还是产出错误画面）。
3. **退化路径**：`motionTrail`（tmix）、`smoothSlowmo`（minterpolate）、`glitch`（rgbashift）
   等标注了「含退化」的滤镜在旧 ffmpeg / 特殊源上的行为。
4. **源适配**：`needsNormalize`（VFR / 透明 webm / source 卡）预检是否覆盖全部入口；
   竖屏 rotation 元数据（`baseRotation` → transpose）在每类 op 下是否正确。
5. **会话态**：`studioStore.ts` 的 undo/redo（live 拖拽不入栈 + commitLive）、
   导出中 close 被禁止但取消路径（AbortController）是否干净、PiP 引用的卡被删后导出的行为。
6. **三次 UI 重构残留**：旧范式的死代码 / 死样式 / 不再触发的快捷键分支。

### 1.2 任务分解

#### T1 —— 建立「配方回归测试床」（先做，后面全靠它）

手工点 UI 无法覆盖组合爆炸，需要一个脚本化测试床：

- 新建 `plugins/ai-creative-canvas/test/videoEdit/`：
  - `fixtures/`：3~4 个小测试源（横屏 CFR mp4、竖屏带 rotation 元数据 mp4、VFR 片段、透明 webm，各 ≤3 秒，用 ffmpeg 现场合成 testsrc 即可，不入库大文件）。
  - `recipes/*.json`：一批代表性 `EditRecipe`（见 T2 用例矩阵），直接以 JSON 存档。
  - `run-compile.test.ts`：不跑 ffmpeg，仅断言 `compile.ts` 对每个 recipe 产出的
    filtergraph/命令行字符串符合快照（snapshot test）——这是纯函数，最容易测。
  - `run-export.mjs`：可选的集成脚本，本机有 ffmpeg 时真实跑一遍全部 recipe，
    断言 exit code=0 且 `ffprobe` 输出时长/分辨率/流数符合期望。
- 快照测试进 `npm test`；集成脚本手动跑（CI 不强制）。

#### T2 —— 组合用例矩阵（测试床的输入）

按风险排列的最小组合集（每行一个 recipe JSON）：

| 类别 | 用例 |
|---|---|
| 时间基折算 | trim 两段保留 + speed 2x + overlay(text, range) —— 断言 overlay 时间窗折算 |
| 时间基折算 | trim 删中段 + subtitle cues —— cue 是输出时间基，删段后对齐 |
| 变速特例 | reverse + freezeEnd；boomerang + 音频（应去音轨）；rate<1 + smoothSlowmo |
| 几何链 | baseRotation=90 源 + crop + outW/outH(blur-pad)；kenBurns + mirror |
| 叠加链 | pip + mosaic + progress + timecode 全开；pip 源卡缺失（应给出可读错误而非 ffmpeg 崩溃） |
| 音频链 | bgm(duck) + muteRanges + fadeIn/fadeOut + loudnorm；无原声源 + bgm(mix) |
| 导出面 | gif / webp / webm / mp4 各一遍带 overlay；bitrate 两遍 ABR 分支 |
| 空栈/旁路 | `stackIsNoop` 为真时导出=原样；全部 op enabled=false |
| 归一化 | needsNormalize 源走每类 op 一遍 |

#### T3 —— 预览一致性审计

- 逐项核对 `preview.ts` 与 `compile.ts` 对同一参数的语义：重点是
  brightness（CSS `brightness()` 是乘法、eq 是加法——已知不同类映射，确认误差可接受或改映射公式）、
  crop 的 clip-path 与 ffmpeg crop 视觉一致性、trim keeps 跳段播放的边界（段首 seek 精度）。
- `exact=false` 角标的触发条件与 UI 提示核对一遍，漏标的补上（例：`OverlayParams.anim`
  的 fade/slide/typewriter 预览是否实现，未实现应置 exact=false）。

#### T4 —— 会话态与生命周期加固

- undo/redo：拖拽滑块（updateOpLive → commitLive）连续操作后 undo 一步应回到拖拽前，
  不应逐帧回放；补一个 store 级单元测试（zustand store 可脱离 React 测）。
- 导出取消：cancel 后临时产物（`exportStudio` 的中间文件）应清理；再次导出不受残留影响。
- PiP 源卡在工作台打开期间被删（画布快捷键已屏蔽，但 Inspector/其他入口呢）——
  导出前统一校验并给出可操作的错误提示。
- `card.meta.editRecipe` 二次编辑：对已导出的「·剪辑」卡再开工作台，配方应完整还原
  （含 pip 引用、lutPath 文件仍存在性检查）。

#### T5 —— UI 残留清理 + fix 批次

- `VideoStudioModal.tsx`（75KB）内三次范式迭代的死代码清理；确有必要时按功能面板拆分子组件
  （目标：主文件 <40KB，纯机械拆分、不改行为）。
- T1–T4 发现的 bug 集中修复，按「一类问题一个 commit」提交。

### 1.3 验收标准

- 快照测试 ≥ 25 个 recipe 全绿并入 `npm test`。
- 集成脚本在本机全量跑通（exit 0 + ffprobe 断言通过）。
- 已知的预览/导出不一致项要么修复、要么在 UI 上有 `exact=false` 明示。
- `VideoStudioModal.tsx` 无三次重构遗留死代码。

---

## WS2 · `@` 引用体验收尾（P1）

### 2.1 现状（比 README 声称的更完整）

- `NodeEditor.tsx` **已有** `@` 素材菜单与 `/` 预设菜单（浮层、点击插入 `@label`）。
- `services/references.ts` 的 `resolveGenInputs` 已按 `@真实名称` 正则匹配、命中则只取被 @ 的素材。
- README「已知限制」仍写着「提示词内 @ 自动补全 pill 为后续增强项」——**文档滞后于实现**。

### 2.2 剩余缺口与任务

| 任务 | 说明 |
|---|---|
| T1 引用失效检测 | 素材改名/删除后，提示词里的 `@旧名` 静默失配（回落到「全部素材」）。生成前扫描提示词中 `@xxx` token，与 `buildMaterials` 标签集比对，失配的在 UI 标红 + 生成时 toast 警告 |
| T2 改名联动 | 卡片改名时，扫描所有引用它的下游卡提示词，把 `@旧名` 同步替换为 `@新名`（一次 confirm 或静默+toast） |
| T3 pill 化渲染（可选） | textarea 换 contenteditable 高亮 `@label` 为胶囊样式。**成本高**（撤销栈/IME/光标管理），建议先做低成本方案：textarea 下方渲染「本次将引用：\[图片1\]\[分镜脚本\]」chips 预览行，实时反映 `resolveGenInputs` 的实际解析结果 |
| T4 文档更新 | README「已知限制」§3 改为已实现 + 剩余项；快捷键表补 `@` / `/` 说明 |

建议顺序：T4（5 分钟）→ T1 → T2 → T3（chips 方案）。真 pill（contenteditable）不在本阶段承诺。

### 2.3 验收标准

- 改名/删卡后提示词失配可见、可修。
- chips 预览行与实际生成输入 100% 一致（同一函数取数）。
- README 与实现一致。

---

## WS3 · 360 专用模型路线验证与清理（P1）

### 3.1 现状

- 提交 `a69d343` 删除了渐进式合成 360（效果差），`c4b3b38` 接入「专用 360 模型」路由
  （`card.params.pano` → `generate.ts` 打 `meta.pano` 标记 → `PanoViewer.tsx` 查看）。
- 切换后只有一条接入提交，**没有后续验证/修复提交**——大概率有未暴露的问题。
- 遗留文件：`services/panoOutpaint.ts`（14KB，渐进式 outpaint 核心）与
  `services/mediaPano.ts`（接缝修复，仍在用）需要确认死活。

### 3.2 任务

| 任务 | 说明 |
|---|---|
| T1 死代码审计 | 全局引用检查 `panoOutpaint.ts` 的每个导出：无引用则整文件删除；部分引用（eq↔persp 投影工具函数可能被接缝修复或查看器复用）则拆出保留的工具函数，删除主循环 |
| T2 实测专用模型路线 | 用真实 Provider 跑：文生 360、图生 360、复杂室内场景（原渐进式的失败场景）；核对出图为合法等距柱状（2:1、左右可环接） |
| T3 接缝修复适配 | `mediaPano.ts` 的 `repairEquirectSeam` 是为旧路线设计的；对专用模型的出图验证是否还需要/是否兼容（透明带 inpaint 依赖 `ai.images.edit` 支持透明 PNG） |
| T4 查看器边界 | `PanoViewer.tsx`：非 2:1 图的容错、超大图（≥4K）的贴图内存、`meta.pano` 标记缺失时的入口引导 |
| T5 文档 | 在本 docs 目录补一页 `360-current-route.md`：当前路线一段话说明 + 已删除方案的墓碑（为什么删、别再走回头路），替代散落在 commit message 里的决策记录 |

### 3.3 验收标准

- `panoOutpaint.ts` 处置完毕（删除或裁剪），构建无死导出。
- 专用模型路线 3 类场景实测通过或问题列表明确。
- 360 路线有一页当前态文档。

---

## WS4 · 两套时间线收敛（P2）

### 4.1 现状与问题

现在存在两套「时间线」：

| | 画布时间线（`TimelineModal.tsx`，19KB） | 工作台（`VideoStudioModal.tsx` + videoEdit/*） |
|---|---|---|
| 对象 | **多卡片**串片（拖拽裁剪、缩略图条、多音轨混音、逐段转场） | **单卡片**非破坏编辑栈 |
| 产物 | 一次性 ffmpeg concat 导出 | 编辑配方（可二次编辑）+ 导出新卡 |
| 定位 | 「把素材串成片」 | 「把一段素材修到位」 |

功能开始重叠（都有裁剪、都有音轨、都有导出），用户难以判断该用哪个；且画布时间线是
一次性导出、无配方，能力上落后于工作台。

### 4.2 决策（本方案的推荐）

**不合并 UI，明确分工 + 单向打通**：

- 画布时间线 = **编排层**（多片段顺序、转场、混音）——保持轻。
- 工作台 = **单片段精修层**——所有逐段效果只在工作台做。
- 打通点 A：画布时间线的每个片段上加「送工作台精修」按钮 → 打开工作台编辑该卡 →
  导出的「·剪辑」卡**自动替换**时间线中的原片段（利用现有 `meta.recipeSource` 溯源）。
- 打通点 B：时间线导出也写入一份编排配方（`project.meta.timelineRecipe` 之类），
  实现「重新打开继续排」——对齐工作台的非破坏理念，数据结构参考 `EditRecipe` 的做法。
- 明确不做：时间线内嵌逐段调色/特效面板（那是工作台的职责，避免第二次功能爆炸）。

### 4.3 任务

1. T1：时间线片段 →「送工作台」入口 + 回填替换（打通点 A）。
2. T2：时间线编排配方持久化 + 重开还原（打通点 B）。
3. T3：两处 UI 各加一句定位说明（空状态文案），README 补「时间线 vs 工作台」小节。
4. T4：重叠功能梳理——时间线里已有而工作台更强的（如逐段转场时长保留在时间线；
   区间静音这类单卡能力从时间线移除或改为跳转工作台）。

### 4.4 验收标准

- 「时间线片段 → 工作台精修 → 回填」全链路可用。
- 时间线关掉重开可继续编排。
- 两个入口的职责在 UI 与 README 里都有一句话说清。

---

## 5. 里程碑与节奏

| 里程碑 | 内容 | 出口条件 |
|---|---|---|
| M1 | WS1-T1/T2 测试床 + 用例矩阵 | 快照测试入 `npm test` 并全绿 |
| M2 | WS1-T3/T4/T5 审计与 fix 批次 | WS1 验收标准全达成 |
| M3 | WS2 全部 + WS3 全部 | 两个工作流验收达成（可并行推进） |
| M4 | WS4 收敛 | 打通链路可用，文档就位 |

每个 fix 批次保持现有提交风格（`fix(ai-creative-canvas): <主题>——<要点>`），
一类问题一个 commit，便于回溯。

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| ffmpeg 滤镜行为随版本漂移，快照测试跨环境不稳 | 快照只锁 compile.ts 输出的命令字符串（纯函数），不锁 ffmpeg 输出；集成脚本单独跑 |
| VideoStudioModal 拆分引入回归 | 拆分放在测试床就位**之后**，纯机械移动 + 快照守护 |
| 360 专用模型依赖外部 Provider，可用性不受控 | 验证结论按「模型能力问题 / 插件接入问题」分开记录，只修后者 |
| WS4 改动画布时间线导出链路 | 打通点 B 先做纯增量（写配方不改导出），回填替换加 confirm |

## 7. 明确不做（本阶段）

- 工作台新增任何滤镜/特效/面板。
- `@` 引用的 contenteditable 真 pill 编辑器。
- 时间线与工作台的 UI 合并。
- 多人协作、云同步等新方向。
