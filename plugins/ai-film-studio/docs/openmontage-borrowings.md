# OpenMontage 借鉴评估报告（ai-film-studio）

> 作者视角：资深工程师 / 综合负责人。目标：从 OpenMontage（Python + Remotion 的 agentic 视频制作系统）中，挑出真正值得折叠进 ai-film-studio（浏览器端 Mulby 插件）的想法，按现有缺口对齐、诚实标注落地形态与工作量。
>
> **许可证边界（必读）**：OpenMontage 为 **AGPLv3**。本报告所有条目均为**借鉴思路、自行用 TypeScript 重新实现**。**绝不拷贝其源代码、提示词文本、schema 文件或 .md 文档原文**。算法（评分公式、阈值、相位映射数学）属于思想/方法，可独立重写；具体代码与文案不可复制。下文「落地设计」给出的都是可直接自研的规则描述，不是搬运。

---

## 0. 实施进度（落地日志）

> 按"每完成一个功能更新文档 + 提交一次"推进。状态：✅ 已落地 / 🚧 进行中 / ⬜ 未开始。

| # | 借鉴点 | 状态 | 文件 | 验证 |
|---|--------|------|------|------|
| 1 | 反幻灯片评分器 | ✅ | `src/ui/services/quality/{util,types,slideshowRisk,index}.ts` | tsc 通过 + selftest（健康 0.1/strong、幻灯片 3.6/fail） |
| 2 | 结构变化 lint | ✅ | `src/ui/services/quality/variationChecker.ts` | tsc 通过 + selftest（健康 0 违规、同质 11 违规/fail、短分镜仅词法触发） |
| 5 | 5 层镜头提示词构建器 | ✅（核心；UI 接线待整合批） | `src/ui/services/shotPromptBuilder.ts` | tsc 通过 + selftest 15 断言（5 层顺序/中文归一/static 省略/词表导出） |
| 8 | interpolate/spring 运动原语 | ✅ | `src/ui/services/motion.ts` | tsc 通过 + selftest（19 断言：分段/外推/弹簧三阻尼分支/过冲夹断/烘焙） |
| 3 | 交付承诺契约 | ⬜ | `src/ui/services/quality/deliveryPromise.ts` | — |
| 4 | 渲染前阻断 + 渲染后审计 | ⬜ | `src/ui/services/quality/composeGate.ts` | — |
| 6 | consistency/negative/quality 约束 | ⬜ | 扩 `stylePacks.ts` + `imageEngine.ts` | — |
| 7 | Ken-Burns/pan/zoom | ⬜ | timeline `motion` + `ffmpeg.ts` | — |
| 9 | 词级高亮字幕 | ⬜ | 扩 `subtitles.ts` | — |

### 已落地详记

**#1 反幻灯片评分器（2026-06-29）** —— `scoreSlideshowRisk(shots: ShotLike[]): QualityResult`，纯函数、零运行时依赖、可独立单测。
- **字段适配（重要）**：报告原设计的 6 维（repetition / decorative_visuals / weak_motion / weak_shot_intent / typography_overreliance / unsupported_cinematic_claims）依赖 `shotIntent / lightingKey / informationRole / 文字卡类型` 等字段——**本插件 `Storyboard` 模型里并不存在**。故按实际字段（`shotSize` 景别 / `cameraMove` 运镜 / `videoDesc` 画面描述 / `duration` 时长 / `sceneId` 场景 / `dialogues`）重新标定为 **5 维**：
  1. `framing_repetition` 景别重复（主景别占比>0.7 +2.5 / >0.5 +1.5；未标景别>60% +1.5；景别零变化 +1.5）
  2. `camera_stasis` 运镜停滞（固定/无运镜比 ×4；运动镜头动作单一 +1）
  3. `duration_metronome` 时长节拍（等长比>0.8 +2.5 / >0.6 +1.2；变异系数<0.12 +1.5；样本<3 跳过）
  4. `description_variety` 画面雷同（空缺/极短比×3；前24字去重比<0.6 时 (0.6-比)×6）
  5. `scene_stagnation` 场景停滞（场景标注<50% 时跳过；全片单场景 3 分等）
- **applicable 机制**：数据不足的维度标 `applicable:false`，**不计入均分**（避免补 0 稀释），均分阈值 `<1.2 strong / <2.2 acceptable / <3.2 revise / ≥3.2 fail`。
- 景别/运镜中英混输经 `storyboardToShotLike` 归一化（词表镜像 `prompts.ts`，本模块自带一份以保持零依赖）。
- 单测走 esbuild 打包到 node（无需引入 vitest）：`npx esbuild src/ui/services/quality/slideshowRisk.selftest.ts --bundle --platform=node --format=esm --outfile=dist/_selftest.mjs && node dist/_selftest.mjs`。

**#2 结构变化 lint（2026-06-29）** —— `checkVariation(shots: ShotLike[]): VariationResult`，与 #1 互补：#1 看**全局比例**，#2 抓**相邻性 + 词法**。
- **8 条规则**（结构类需 ≥4 镜；词法/相邻重复任意镜数都跑）：① 单一景别占比>50%（>0.7 high）② 连续 ≥3 镜同景别 ③ 固定/无运镜>60% ④ 连续 ≥4 镜等长 ⑤ >50% 镜头景别+运镜双缺（镜头语法缺失）⑥ 连续 ≥4 镜同场景（场景标注足够时）⑦ ≥30% 画面描述含**笼统套话**（自研 GENERIC_PHRASES 中英黑名单：一个人/美丽的/科技感/futuristic/stunning…）⑧ 相邻镜头画面描述高度重复。
- **字段适配**：报告原规则里 lightingKey/hero_moment/texture_keywords/shotIntent 本插件无 → 换为 missing_grammar（景别+运镜双缺）、scene_run（连续同场景）等等价检查。
- **输出**：每条 violation 带 `severity`(low/med/high)、`shotIndices`（定位镜号，供 storyboard 行内 lint 标记）、`message`、`suggestion`（quick-fix chip 文案）。score = Σ严重度权重(0.6/1.0/1.5) 截顶 5，阈值复用 `verdictFromAvg`。
- ShotLike 增 `index?` 字段承载展示镜号（`storyboardToShotLike` 写入 `sb.index`）。

**#8 运动原语（2026-06-29）** —— `src/ui/services/motion.ts`（纯函数、零依赖），#7 Ken-Burns 与 #9 字幕的共用时序内核。
- `interpolate(input, inputRange, outputRange, {extrapolate})`：分段线性重映射；外推 clamp（默认）/extend/identity；支持多段（如 `[0,1,2]→[0,10,0]`）与左右独立外推；长度非法抛错。
- `spring({frame, fps, config:{damping,mass,stiffness,overshootClamping}, from, to, velocity})`：阻尼谐振子**解析解**（非数值积分，与帧率无关），按阻尼比 ζ 自动选 欠/临界/过 阻尼分支；默认 m1/k100/c10（ζ=0.5 欠阻尼，会过冲）；`overshootClamping` 夹断过冲。
- `sampleFrames(n, fn)`：把逐帧运动烘成定长数组——给 ffmpeg 导出生成 zoompan/sendcmd 数据用（预览/导出共用同一数学）。`lerp` 为二点特例小工具。
- 算法为标准教科书内容，API 对齐 Remotion 习惯以便复用，自研实现、未拷贝第三方源代码。

**#5 5 层镜头提示词构建器（2026-06-29）** —— `src/ui/services/shotPromptBuilder.ts`（纯函数、零依赖）。
- `buildShotPrompt(input)` 按固定 5 层编译英文提示词：Camera(焦段+景深) → Movement(景别+运镜，static 省略运镜短语) → Subject(描述+材质+连贯+角色/道具/场景) → Lighting(布光+色温+情绪) → Style(**短 hint**)。空层自动省略。
- **关键纪律**：Style 层只放短 hint，**绝不整段风格前缀粘贴**（重型风格注入仍由 `stylePacks.applyStylePack` 在生成处负责）——这正是替代「每镜同一前缀致全片同质」的要点。
- 新增可复用电影摄影词表：`LENS/DOF/LIGHTING/COLOR_TEMP_PHRASE`（英文短语）+ `*_OPTIONS`（value+中文 label），**同时充当 storyboard/keyframe 节点的下拉枚举**。
- 景别/运镜中英归一内置（镜像 prompts.ts，保持零依赖）。**对照样本**：full 输入 → `85mm portrait lens, shallow depth of field…, close-up, slow dolly in, 少年站在悬崖边眺望远方; …; mood — hopeful, cinematic anime`。
- **待整合批**：把 `prompts.ts` keyframe 路径（L696–725 的散落拼接）改为调用 `buildShotPrompt`，并把 `*_OPTIONS` 接进 `nodeDefs.ts` 分镜/关键帧节点下拉、`Storyboard` 加 lens/dof/lighting/colorTemp 字段。

> **阶段小结**：报告「纯函数批 1」（#1 反幻灯片 / #2 变化 lint / #8 运动原语 / #5 镜头提示词）已全部落地，零 runtime 依赖、各带 selftest。下一步进入**整合批**：#4 合成闸门 → #3 交付承诺 → #7 Ken-Burns(接 ffmpeg) → #9 词级字幕 → #6 风格机器约束。

---

## 1. 一句话结论

**值得借鉴，但要精挑。** OpenMontage 最大的价值不在它的 Remotion/Python 渲染管线（那部分与本插件「浏览器端、ffmpeg concat、无重后端」的定位冲突），而在它**两套纯函数、零 API 的质量护栏**和**几何运动数学**——这些恰好命中本插件 `gaps` 里最痛的三处空洞。

三个最大赢点：

1. **反幻灯片质量门（slideshow_risk + variation_checker + delivery_promise）** —— 纯数据 over 数组、零 LLM、可直接移植成 TS。这是本插件目前**完全没有的「生成媒体质量门」**，且能在花钱生成前跑，单点 ROI 最高。
2. **Ken-Burns / pan / zoom + 词级字幕 + interpolate/spring 运动内核** —— 直接补齐 `gaps` 里「相机运动只是提示词」「只有 clip 级 SRT、无卡拉OK字幕」「无 Ken-Burns 合成」三条硬缺口，数学核心仅几十行、可同时驱动 CSS 预览与 ffmpeg 表达式。
3. **5 层镜头提示词构建器（shot_prompt_builder）+ consistency_anchors / negative / quality_rules 作为机器可用约束** —— 把「每个镜头粘贴同一段 style 前缀导致全片同质」这一陷阱，换成结构化字段编译提示词，且天然喂养上面的质量门。

执行评级层（Executive-Producer 编排、stage-gate、checkpoint、budget governance）**理念优秀但需谨慎**：本插件已有确定性 3 段 pipeline 和 Toonflow 工作台，这些更多是「在现有 runtime 上加约束/回路」，而非新增子系统，按中优先级渐进引入。

---

## 2. 最值得借鉴（高优先级）

| # | 借鉴点 | OpenMontage 出处 | 为什么值得 | 落地形态 | 映射到插件哪里 | 工作量 |
|---|--------|------------------|-----------|----------|----------------|--------|
| 1 | 反幻灯片 6 维评分器 | `lib/slideshow_risk.py` | 唯一一个「在生成前就能判断成片会不会像无聊幻灯片」的确定性检测器；纯数组运算 | 轻量改造 | 新建 `src/ui/services/quality/slideshowRisk.ts`，在 `projectStore`/`graphStore` 派生选择器中跑 | M |
| 2 | 结构变化 lint（8 规则 + 通用词黑名单） | `lib/variation_checker.py` | 补足 #1 没覆盖的相邻性/词法检查（连续同景别、英雄镜头与邻居雷同、generic-phrase 黑名单）；带可复制的修复建议 | 轻量改造 | `src/ui/services/quality/variationChecker.ts`，与 #1 同一派生 pass | M |
| 3 | 交付承诺契约 + 运动比强制 | `lib/delivery_promise.py` | 防最致命的静默失败：承诺电影级运动、实际交付「动画文字卡片」。关键洞见：**动画图文卡不算运动** | 轻量改造 | `src/ui/services/quality/deliveryPromise.ts` + output/timeline 节点 | M |
| 4 | 渲染前硬阻断门 + 渲染后审计 | `tools/video/video_compose.py` `_pre_compose_validation` | 验证器若不阻断就是摆设；两段式（前置 block / 后置 audit silent-downgrade）模式可直接照搬 | 轻量改造 | 新建 `src/ui/services/quality/composeGate.ts`，由 `studio/services/compose.ts` 与 compose/export 节点先调用 | M |
| 5 | 5 层电影摄影提示词构建器 | `lib/shot_prompt_builder.py` | 直击视觉同质化：结构化字段编译出多样提示词，取代统一前缀；短语字典即下拉枚举词表 | **direct** | 新建 `src/ui/services/shotPromptBuilder.ts`，接入 storyboard/keyframe 字段与 `stylePacks.ts` | S |
| 6 | consistency_anchors + negative + quality_rules 作为机器可用约束 | `styles/*.yaml` `asset_generation` | 跨镜头一致性契约：anchors/negative 自动追加到每次生成；quality_rules 变成生成前 lint | **direct** | 扩展 `src/ui/services/stylePacks.ts` 的 `StylePack` 类型，接入 `imageEngine.ts` | S |
| 7 | Ken-Burns / pan / zoom 运动表（9 预设） | `remotion-composer/src/components/AnimeScene.tsx` `useCameraMotion` | 补「相机运动只是提示词、静图干坐着」的硬缺口；数学核心 ~40 行，可同时出 CSS 预览与 ffmpeg `zoompan` | 轻量改造 | `motion` 字段进 timeline/clip；`src/ui/services/ffmpeg.ts` 加 zoompan 路径 | M |
| 8 | interpolate + spring 运动原语 | Remotion `interpolate`/`spring`（全composer共用） | 所有运动效果（Ken-Burns/字幕/标题卡）共享的内核；移植后预览与导出共用一套时序模型 | 轻量改造 | 新建 `src/ui/services/motion.ts` | S |
| 9 | 词级高亮（卡拉OK）字幕 | `remotion-composer/.../CaptionOverlay.tsx` + `tools/subtitle/subtitle_gen.py` | 短视频/社交成片的标配，本插件**完全没有**（只有 clip 级 SRT）；纯 stdlib 逻辑、零重依赖 | **direct**（字幕生成）/ 轻量改造（预览） | 扩展 `src/ui/services/subtitles.ts` + 新 captions 轨 | M |

> 注：表中工作量按「自研 TS 实现 + 接入现有节点/store」估，不含 Remotion runtime（不引入）。

### 落地设计

**#1 反幻灯片 6 维评分器** —— 在 `src/ui/services/quality/slideshowRisk.ts` 实现一个纯函数 `scoreSlideshowRisk(shots: ShotLike[]): { avg: number; verdict: 'strong'|'acceptable'|'revise'|'fail'; dims: {name,score,reason}[] }`。规则（TS 可实现，自行重写、勿抄）：

- 前置：场景数 < 3 时跳过（数据不足，返回 strong）。
- **dim1 repetition**：`+2.0` 若最常见 `shot.type` 占比 > 70%；`+1.5` 若「描述前 50 字小写后去重比」< 0.6；`+1.5` 若最常见 `shotSize` 占比 > 60%；该维 cap 在 5。
- **dim2 decorative_visuals**：统计「既无 informationRole、又无 narrativeRole、又无 shotIntent」的场景，`score = ratio * 5`。
- **dim3 weak_motion**：在 `cameraMovement` 非 static/unspecified 的运动镜头里，统计缺 `shotIntent` 的占比，`score = (purposeless/moving) * 4`；若运动镜头数为 0，固定 `1.5`。
- **dim4 weak_shot_intent**：`score = (1 - 带 shotIntent 的比例) * 5`。
- **dim5 typography_overreliance**：text_card/stat_card/kpi_grid 类型占比 `>0.6→4.0`，`>0.4→2.5`，`>0.2→1.0`，否则 0。
- **dim6 unsupported_cinematic_claims**：仅当风格族含 'cinematic' 时触发；每条 `+1.8`：全片无 hero_moment / 带相机运动场景 < 30% / 带 lightingKey 场景 < 30%。
- `avg = mean(dims)`；`avg<2→strong, <3→acceptable, <4→revise, ≥4→fail`。

在 `projectStore`（studio）与 `graphStore`（canvas）中以**派生选择器**形式运行，分镜数据变更即重算，结果渲染到一个 `QualityPanel`（新增组件，挂在 StudioDock 或分镜 tab）。`fail` verdict 联动**禁用/警告** compose/export 节点的「生成」动作（见 #4）。每维返回人读 reason 字符串，直接显示。

**#2 结构变化 lint** —— `src/ui/services/quality/variationChecker.ts` 实现 `checkVariation(shots): { score, verdict, violations[], suggestions[] }`，`score = min(5, violations.length * 0.6)`，verdict 阈值同 #1。8 条规则（多数需 ≥4 场景）：(1) 最常见 shotSize > 50%；(2) ≥3 个**连续**相同景别（排除 unspecified）；(3) >60% 静态/未指定运动；(4) 全片 lightingKey 唯一值 ≤1；(5) 完全无 hero_moment，或 hero 与相邻镜头共享 shotSize（英雄镜头必须视觉区分）；(6) ≥30% 场景命中 `GENERIC_PHRASES` 集合（自建一个 TS `Set`：'a person'、'modern'、'futuristic'、'cutting-edge'、'sleek design'、'stunning' 等，**词表自行整理勿抄原文**）并给具体改写建议；(7) <30% 场景带 texture_keywords；(8) <50% 场景带 shotIntent。连续/英雄-邻居检查依赖节点顺序——canvas 与 studio 都已有顺序。violations 以**行内 lint 标记**贴到 storyboard 节点，suggestions 作为 quick-fix chips。与 #1 同一 derived pass 跑。

**#3 交付承诺契约** —— `src/ui/services/quality/deliveryPromise.ts`。在 studio 项目/output 节点上设一个 `DeliveryPromise` 类型（motion_led / source_led / data_explainer / teacher_explainer / hybrid 等）。每类规则表：`stillFallbackAllowed`、`requiresVideoGeneration`、`minMotionRatio`（motion_led=0.7、avatar=0.3、source=0.3、其余 0–0.2）。`validateCuts(cuts, promise)`：每个 cut 分类为 real-motion（扩展名 ∈ mp4/mov/webm/... 或 type ∈ {video,animation,avatar}）/ slide-grammar（type ∈ {text_card,stat_card,*_chart,kpi_grid,comparison,...}）/ still——**slide-grammar 不计为 motion**。`motionRatio = motionCuts/total`。违规：要求运动但 ratio < min；或不允许 still-fallback 而 (slides+stills) > 50% 且无批准的 still_led 降级。`classifyFromBrief(pipelineType, userIntent)` 由 studio agent 在规划阶段播种承诺。

**#4 渲染前硬阻断门 + 渲染后审计** —— 这是把 #1/#2/#3 真正接上 runtime 的choke point。新建 `src/ui/services/quality/composeGate.ts`，由 `src/ui/studio/services/compose.ts` 的 composeFilm 入口与 canvas compose/export 节点的 onExecute **先调用**：聚合 blocks = `validateCuts` 违规 + `slideshowRisk` verdict==='fail' + 缺渲染族信息；非空则中止渲染，把消息路由到节点 error 态（verdict==='revise' 只警告不阻断）。渲染后计算轻量 `promisePreservation`：用实际落到时间线的内容重算 motionRatio，若 motion_led 承诺渲出 <50% 运动则标 `silentDowngradeDetected=true`，存到 output 节点显示。两段式（前置 block / 后置 audit）直接照搬。

**#5 5 层镜头提示词构建器** —— `src/ui/services/shotPromptBuilder.ts` 导出 `buildShotPrompt(shot, stylePack): string`，按固定顺序拼 5 层：(1) Camera = lens_mm + 景深短语；(2) Movement = 景别短语 + 相机运动短语（static 则省略）；(3) Subject = description + texture_keywords；(4) Lighting = lightingKey 短语 + 色温短语；(5) Style = 从 `stylePacks.ts` 的 active pack 取 mood/visual_language 作**短 hint**，**绝不**整段前缀粘贴（这正是 OpenMontage 替换旧方案的原因）。自行编写 4 个短语字典（景别 / 18 种相机运动 / 11 种布光 / DOF / 色温 的 enum→自然语言）。这些 enum key 同时充当 storyboard/keyframe 节点的下拉选项集；生成节点改为调用 `buildShotPrompt` 而非散落字符串。副作用：更多镜头带上真实 shotSize/movement/lighting，反过来喂养 #1/#2 的检查。与现有 `resolveStyle` seam 协同——Style 层从 resolveStyle 的结果取 hint。

**#6 一致性锚 / 负向 / 质量规则约束** —— 扩展 `stylePacks.ts` 的 `StylePack`：新增 `consistencyAnchors: string[]`、复用现有 `negative`、新增 `qualityRules: string[]`。`imageEngine.ts` 在每次图像生成时把 anchors 作为后缀锚 + negative 注入（现有 negative 机制已在、复用）。再加一个轻量「style lint」：扫描计划中的镜头是否违反 qualityRules（如「禁止把精确文字烧进生成图——用 overlay」），生成前在 QualityPanel 警告。本条与 #5 同属「让风格成为机器可用约束」，落地形态 direct，工作量 S。

**#7 Ken-Burns / pan / zoom 运动表** —— 在 timeline/clip 上加 `motion` enum（store：`TimelineClip.motion`），9 预设：zoom-in(scale 1→1.15)、zoom-out(1.15→1)、pan-left/right(translateX ±35px @ scale 1.12)、ken-burns(scale 1→1.18 + 对角漂移 -22/-14px)、drift-up/down、parallax、static(scale 1.02 遮边)。纯函数 `cameraMotion(progress01): {scale,translateX,translateY}`。两条渲染路径：(1) **ffmpeg 导出**——`src/ui/services/ffmpeg.ts` 加 `zoompan` filter（`zoompan=z='min(zoom+0.0008,1.18)':d=...`）做 zoom，crop/overlay-translate 做 pan，per-frame z 用同一 progress 数学；(2) **预览**——React `<KenBurnsImage>` 读 rAF 时钟而非 useCurrentFrame。把 9 预设映射到 `StudioEditor.tsx` 一个 select。数学约 40 行，自研。

**#8 interpolate + spring 原语** —— 新建 `src/ui/services/motion.ts` 导出 `interpolate(value, inRange, outRange, {extrapolate:'clamp'})`（裁剪线性重映射，自己写几行）和 `spring({frame,fps,config:{damping,stiffness,mass}})`（标准质量-弹簧积分，~30 行，自研）。#7/#9 及未来标题卡都调它。为 ffmpeg 导出再写一个 helper：跨帧采样 interpolate/spring 生成 per-frame expr / `sendcmd` 时间线，使预览与最终渲染时序一致。

**#9 词级高亮字幕** —— 在 doc 加 captions 轨：`{ words:[{word,startMs,endMs}], style }`。生成侧（**direct**）：移植 `subtitle_gen` 思路写 `subtitles.ts` 里 `buildCues`（按 maxWords/maxChars 分组）、`renderSRT/VTT`、`applyCorrections`（不区分大小写纠错字典，如 ASR 错词修正，保留尾标点）、时间戳格式化（HH:MM:SS,mmm）。三种高亮：none / word_by_word（每词一 cue）/ karaoke（整行高亮活动词）。预览侧（轻量改造）：渲染 `<CaptionOverlay>`，用 rAF 替 useCurrentFrame——每页算 `currentMs`，活动词上 highlightColor+glow、past 全色、future 60% alpha。ffmpeg 烧录：生成 ASS `\k` 卡拉OK 时序，或 `drawtext + enable='between(t,a,b)'`，active/past/future 状态机直接映射到 ASS override tag。word 时序来自 TTS/转写节点（本插件 tts 已在 `tts.ts`，时间戳需 provider 支持或对齐步骤）。

---

## 3. 可选增强（中优先级）

- **Stage-gate 评审回路（review_focus + success_criteria → pass/revise/send-back）**（`skills/meta/reviewer.md`）：给每个生成节点挂可选 `reviewFocus[]/successCriteria[]` + 一次 `runReview()` studio-agent 调用，弱输出自动标记并把 findings 注入提示词重跑（**回合上限 2**，防完美主义）。接入 `studio/agent/runtime.ts`。与现有 JSON 校验/repair 回路同源思想，但作用于**生成媒体**而非 JSON。M。
- **EP / director / reviewer 三角色拆分 + RunState**（`skills/pipelines/*/executive-producer.md`）：把 studio agent 跑成 store 持有的 `RunState {budgetSpent, revisionCounts, issuesLog}`，每节点一个短 director 提示模板、一个共享 reviewer。让行为靠改提示文本而非改代码调。L。
- **预算治理 estimate→reserve→reconcile + OBSERVE/WARN/CAP**（`tools/cost_tracker.py`）：加 `CostMeter` store slice，每个 AI 节点执行前 reserve、成功后 reconcile、失败 refund；持久预算 HUD；CAP 模式阻断超预算节点；首次用付费 backend / 单次超阈值弹审批。S–M。
- **Sample-first 子检查点**（`pipeline_defs/*.yaml` proposal sub_stages）：在规划/风格节点加「预览此分支」动作——跑 1 个代表镜头走完下游链，显示「样本成本 vs 预计全量成本」，full 执行前 gate。与 M31 confirm gate 互补（M31 管「确认要生成哪些」，此管「先验证方向再花全部」）。S。
- **场景节拍 / 旁白对齐帧追踪器**（`lib/verify_scene_pacing.py`）：若有 VO/脚本轨，确定性时序 linter——每条旁白 cue ±tolerance 内必须有视觉落点，且总时长不溢出/不欠填（防最后一帧冻结的死气）。frame-math 常量需按本插件渲染时序调。M。
- **可解释多维 provider 评分（含 continuity 项）**（`lib/scoring.py`）：每节点选模型时给可解释评分（task_fit .30 / quality .20 / control .15 / reliability .15 / cost .10 / latency .05 / continuity .05），continuity 奖励「沿用已锁定 provider」直接对抗「每个镜头长得不一样」。与 M28 modelCatalog 协同（catalog 提供 supports/best_for 元数据）。L。
- **平台媒体 profile 注册表**（`lib/media_profiles.py`）：导出/output 节点提供 TikTok / YouTube Shorts / Cinematic 21:9 预设（width/height/fps/codec/crf/max_duration），选 profile 即设画幅并校验时长超限。纯常量表，**direct**，S。与 M28 catalog/全局画幅设置协同。
- **自报依赖可用性 → 节点状态徽章**（`tools/base_tool.py` check_dependencies）：每 backend 加 `requiresKeys[]` + `status()` 读插件设置 store；不可用节点显示「添加 FAL key 解锁视频生成」式 1 步修复，而非静默失败。S。与 M28 catalog 同处落地。
- **决策日志（防静默换模型）**（`schemas/artifacts/decision_log.schema.json`）：RunState 加 `DecisionLog[]`，每次为节点选 provider/model/fallback 记 `{category,optionsConsidered,selected,reason,confidence,userApproved}`，audit 面板显示，reviewer 比对规划期所选 vs 实际所用模型，标记未批准的 swap。S。

---

## 4. 不建议借鉴 / 不适用

> 通用红线：**OpenMontage 是 AGPLv3。以下即便不引入，凡借鉴均须自研重写，不得拷贝其 Python/Schema/.md 原文。**

- **Remotion 程序化渲染 runtime 本体** —— 本插件定位是 ffmpeg concat + 浏览器端，**不引入 Remotion**。只借其运动**数学**（#7/#8/#9），不引其 React video 框架与渲染器。
- **CLIP 嵌入语料库检索 / corpus.py / clip_embedder.py**（`lib/corpus.py` 等）：依赖 CLIP/torch，非浏览器可移植。**heavy-skip**。若未来要真实 B-roll 库，仅 StockSource adapter 协议、fused-score 公式、MMR diversify（纯向量数学 ~30 行）可在已有嵌入后客户端用——列为 v2「资产库」节点，当前不做。
- **reference-video 本地零 key 分析管线**（yt-dlp / PySceneDetect / whisper / ffmpeg 关键帧 → VideoAnalysisBrief）：CV/ASR 部分非浏览器原生。**思路（「从你喜欢的视频开始」入口 + brief schema + keep/change 框架）有价值但落地重**——只能经 host `runCommand` 调外部 helper 或外部 API。Brief schema 与成本预估（reference cost estimator，纯算术）可自研，但整条入口属 L 工作量、非首批。
- **source_media_review.py 的 ffprobe/PIL 探测**：重、非浏览器原生。**heavy-skip**。仅扩展名→媒体类型映射、quality_risk 阈值、planning_implications 逻辑可用浏览器原生探测（HTMLVideoElement/Image 取尺寸时长、WebAudio 取声道）重写——低优先。
- **typed artifact JSON-schema 传输契约全套**（11 类 artifact schema）：理念好，但本插件**已有 typed ports + name-matching**（见 inventory）。仅「端口 payload 在流转前按 schema 校验、必填输入未满足则 block 节点」这一**增量**值得（中优先级，可用 zod），不必照搬 11 类 artifact 体系。
- **per-genre pipeline 完整 manifest 体系 + extension 权限门 + compatible_playbooks 绑定**：对一个尚未在 Mulby 跑通的工作台来说过重。其「genre 配方模板 → 展开成预连节点子图」的轻量版（New from template）可中优先级做，但完整 manifest/权限治理体系暂不引入。
- **重复现有计划者，勿重复推荐**：词级字幕的**clip 级 SRT 部分**、CosyVoice/Qwen3 中文 TTS、per-item 可恢复生成、confirm gate、节点 UI 重建、ResultViewer——这些 **M28–M33 已规划或已落地**；本报告的字幕条目只新增**词级/卡拉OK**增量，TTS/voice 不重复。运动比/质量门里的「dialogue audio 注入最终成片」属 Toonflow parity §5.5 已知缺口，不重复列。

---

## 5. 与现有计划的关系（Jellyfish/LumenX M28–M33 + Toonflow parity）

**互补（净新增能力，现有计划没覆盖）：**

- 质量门三件套（#1/#2/#3/#4）—— `gaps` 明确写「无生成媒体质量门、无幻灯片检测、无 off-style 自动重拍」，是**纯空白**，与所有现有计划正交。最高优先。
- Ken-Burns/pan/zoom（#7）、词级字幕（#9 的词级部分）、interpolate/spring 内核（#8）—— 对应 `gaps` 的「相机运动只是提示词」「无卡拉OK字幕」「无 Ken-Burns 合成」，现有计划与 parity 文档均未列。净新增。
- shotPromptBuilder（#5）—— 现有 `skillSystem`/`stylePacks` 解决「风格注入」，但**没有**「结构化镜头字段→分层提示词」这一层；互补。

**重叠 / 协同（应挂靠现有计划，避免重复造）：**

- consistency_anchors / negative / quality_rules（#6）—— 直接扩展 `stylePacks.ts` 的 `StylePack` 与 M21 风格系统，**协同**（M21 已落地 11 包 + resolveStyle seam，#6 是字段增量）。
- provider 评分、自报依赖状态徽章、媒体 profile —— 全部应挂在 **M28 modelCatalog.ts**（声明式模型目录单一真源）之上，等 M28 落地再做，**否则与 M28 重叠**。
- review 回路 / EP 三角色 / RunState —— 应在 **Toonflow parity phase6 实验性 tool-loop** 与确定性 3 段 pipeline 之上叠加，而非新建 agent 子系统；注意 `runtime.ts` tool-calling 在 Mulby **尚未跑通**（probe 未运行），review 回路先挂确定性 pipeline 路径。
- Sample-first gate —— 与 **M31 confirm gate** 互补：M31 在「生成哪些候选」前确认，Sample-first 在「方向是否值得全量」前确认；可合并到同一确认 UX。

**建议排序：**

1. 先做**纯函数质量门 + shotPromptBuilder + motion 内核**（#1/#2/#5/#8）—— 零 runtime 依赖、不依赖 Mulby agent 跑通、可独立单测（移植 golden bench 思路做 vitest）。
2. 再做**接入层**（#4 composeGate、#3 deliveryPromise、#7 Ken-Burns ffmpeg 路径、#9 字幕烧录）—— 依赖 #1/#8。
3. M28 落地后再叠 **provider 评分 / 状态徽章 / 媒体 profile / 决策日志**。
4. Toonflow agent 在 Mulby 跑通后再叠 **review 回路 / EP 角色 / budget HUD / Sample-first**。

---

## 6. 建议的下一步（3–5 个具体动作）

1. **建 `src/ui/services/quality/` 目录，先落 `slideshowRisk.ts` + `variationChecker.ts`（#1/#2）**，自研重写算法，配一套 vitest golden 场景（移植 OpenMontage bench 的 ±1 tier 容忍判定**思路**：good-cinematic / all-medium-no-intent / text-card-overload / fake-cinematic 等已知好坏 fixture，**自建数据勿抄**），CI 守阈值。零 runtime 风险，先验证算法。
2. **新建 `src/ui/services/motion.ts`（interpolate + spring，#8）和 `src/ui/services/shotPromptBuilder.ts`（#5）**，纯函数 + 单测。shotPromptBuilder 的 enum 词表同时定义为 storyboard/keyframe 节点下拉项（改 `src/ui/nodes/nodeDefs.ts`）。
3. **写 `composeGate.ts`（#4）并接到 `src/ui/studio/services/compose.ts` 与 canvas compose/export 节点的 onExecute**，把 #1/#2/#3 的 fail verdict 变成硬阻断 + 渲染后 silentDowngrade 审计；同时在 StudioDock 加 `QualityPanel` 显示 verdict + 每维 reason + quick-fix。
4. **扩展 `stylePacks.ts` 的 `StylePack`**：加 `consistencyAnchors[]` / `qualityRules[]`（#6），在 `imageEngine.ts` 生成调用处自动追加 anchors + negative，并把 qualityRules 接进 style lint。
5. **在 timeline/clip 数据模型加 `motion` enum 字段（#7）**，先实现 `<KenBurnsImage>` 预览（rAF + motion.ts），再在 `src/ui/services/ffmpeg.ts` 加 `zoompan`/crop 导出路径——预览与导出共用 #8 的 progress 数学。

> 全部以**自研 TS 实现**推进；OpenMontage 仅作思路/算法参考，AGPLv3 代码与文本一律不入库。
