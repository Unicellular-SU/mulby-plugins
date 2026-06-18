# AI 影视工作流 · 一致性与规划重构方案 **v2**

> v2 是对 v1 经一次 6 视角对抗式代码评审（53 个 agent，46 条发现，39 条通过对抗验证）后的修订版。v1 的**根因诊断是可信的**（每条代码引用逐行核实命中），但实现方案被高估、含两处事实错误、且过度设计。v2 纠错并重排。
>
> 目标不变：参考 [Toonflow-app](https://github.com/HBAI-Ltd/Toonflow-app) 的「风格技能包 + 资产派生」范式，在**不推翻现有节点图引擎**的前提下根治三类顽疾：① 跨镜不一致（"图片漏洞百出"）② **同一人物不同时期被合到一张图、下游匹配不上**（核心 bug）③ 分镜爆炸 + 时长失控。

---

## 0. v2 相对 v1 改了什么（修订说明）

| 类别 | v1 的问题 | v2 的修正 |
|---|---|---|
| **事实错误 A** | §1.1/§4/§5 称 `selectRefs/pickRef/RefImage` 在 `prompts.ts` | 它们在 **`graphStore.ts:1678–1828`**；`prompts.ts` 只构造 job 描述符（`ImageJob`），`stateAt`（prompts.ts:470）只改提示词文本、**不选参考图**。所有取图改造路由到 graphStore.ts |
| **事实错误 B** | 称"复用已存在的 `ElementRef.variants`" | 现有 `variants` 是**扁平 `{id,label,assetId,tags}[]`**，与富结构 `ElementVariant[]` **不兼容**。改用**新字段名 + schemaVersion 读时迁移**，不是"接线" |
| **被高估的工作量** | 把变体修复说成"修 `saveElement` 丢字段 + 接线" | 实为**四处全新运行时载体 + 阻塞校验 + appliesTo 规范化器**（见 §3），`saveElement` 只是其一 |
| **只在理想路径成立** | 校验只查 `characters` 非空、appliesTo 精确大小写相等、base.identity 无约束 | 三者都会让真实 LLM 输出**静默退化回原 bug**；v2 把校验改阻塞式、appliesTo 加规范化解析器、base.identity 加净化（§3.2–3.4） |
| **过度设计 / 排序** | 7 里程碑、风格包 M21 排在 bug 前、独立 director 节点、event-graph | 砍 event-graph；director 改为 storyboard 内置 option-B；把治爆炸的两行修复拎成零依赖 **M-quick** 先发；变体走**最小 M22a**（复用 view 同款 meta 载体），底模派生降级为可选 M22b |

诊断结论（评审背书）：v1 §1 的根因链——"一个身份 = 一份外观 + 一组三视图 → 多期挤一张图 → 下游按 charId 取唯一参考"——**准确**。下面只修方案，不动诊断。

---

## 1. 现状与根因（已逐行核实，含 v1 措辞纠偏）

- **生成层**：`text.charsheet`（promptTemplates.ts:138）每角色产 1 个 `appearance` + 1 组 `triple` + `arc[]`（仅 `{stage,state,emotion}`，**无逐期外观**）。`buildCharViewSets`（prompts.ts:336）据此对每角色产 1 组三视图，`charId` 缺省回退 `name`。
- **取图层**（**纠正 v1：在 graphStore.ts，不在 prompts.ts**）：
  - `RefImage`（graphStore.ts:1678）携带 `name/kind/locationKey/isMasterPlate/charId/view`——**注意 `view` 已被携带，但 `pickRef` 根本不拿它做匹配**。
  - `pickRef`（graphStore.ts:1733）是 **4 级匹配**：charId 精确 > name 精确 > 唯一子串 > 唯一角色兜底。比 v1 说的"charId/name 唯一匹配"更精细，但**没有任何 variant/stage 维度**，且 9 张同 charId 的图会命中**第一张**（按生成序多半是 youth）= 正是"匹配错时期"。
  - `selectRefs`（graphStore.ts:1786）/`pickRefs`（1764）签名均无 variant 维度。
  - `stateAt`（prompts.ts:470）是 `buildImagePrompts` 内的闭包，**只改提示词文本**，用 `String(s.stage)===stageKey` 精确大小写相等。
- **资产层**：`ElementRef`（assetStore.ts:29）的 `charId/views/voiceId/lora` 消费端**已接线**（`insertElementNode` graphStore.ts:2423 会读 `el.views/charId/voiceId` 写进 node 输出 meta）；**断点只在生产端**——`saveElement` 新建分支（assetStore.ts:163）丢弃这些字段。**纠正 v1"定义了没接线"：是 producer 丢、consumer 已通。**

**根因落点（v2 精确版）**：要让"finale 镜头拿到 elder 三视图"，必须新增一个**贯穿运行时的形态判别维度**（命名 `variantId`），其载体可**完全复用现有 `view` 字段的同款管道**（携带 + 匹配两步，而现状 `view` 只携带不匹配）。这是修复的脊柱，也是 v1 最被低估的部分。

---

## 2. 核心不变量与目标架构

**不变量：身份(charId) 与 形态(variantId) 解耦。** 一个 charId 永远是同一个人；"时期/年龄/换装/状态"是它的 `variantId`，各有独立外观与独立参考图；镜头用 `(charId, variantId)` 精确点名。`variantId` 作为**单一载体字段贯穿始终**：M22a 的来源是 `arc[]` 的时期/年龄；M22b 扩展来源到换装/状态并加底模派生。**一个字段、来源递增，避免里程碑间改名。**

```
剧本(json) ─► storyboard ─► shots[]：每镜带 associateAssetIds[{charId,variantId}] + duration(钳4–15) + shouldGenerateImage
   │                                         （maxShots 截断；可选段落 option-B）
   ▼
char-sheet ─► characters[]{ identity + variants[]{stageKey,appearance,triple,appliesTo} }
   │
   ▼
char-image ─► per (charId×variantId) 一组三视图，meta={charId,variantId,view} ─┐
   │                                                                          ▼
scene/prop 变体图（locationKey/propName × variantId）────────────────────► keyframe
                                                                pickRef 按 (charId,variantId) 精确取图
                                                                注入风格包锚定/负向词（M21，后置）
```

---

## 3. 变体修复 = 四处全新载体 + 阻塞校验 + appliesTo 规范化（核心，落 M22a）

### 3.1 `variantId` 端到端载体清单（4 处真实 file:line，全部 graphStore.ts/prompts.ts）

仿照现有 `view` 字段逐处加 `variantId`：

1. **生产 · char-image meta**：`metaOf`（graphStore.ts:844）现为 `(view)=>({name,kind:'character',charId,view})` → 加 `variantId`。
2. **载体 · RefImage**：`RefImage`（graphStore.ts:1678）加 `variantId?: string`；`refsFromValues`（graphStore.ts:1695-1713）加 `variantId: typeof it.meta?.variantId==='string'?...:undefined`（与现有 `view` 读法同款）。
3. **匹配 · 选择器**：`pickRef`（graphStore.ts:1733）加形参 `variantId?`，在「charId 精确」一级之上插入 **`charId && variantId` 精确**一级；未命中变体时**回退到 charId-only**（保证旧工程 `variantId===undefined` 的 base 图仍命中）。`pickRefs`（1764）/`selectRefs`（1786）同步加 `variantIds?` 形参并同序透传。
4. **job 描述符 · ImageJob**：`ImageJob`（prompts.ts:207，已有 `refNames/refCharIds/refPropNames`）加 `refVariantIds?: string[]`（与 `refCharIds` 同序）；`buildImagePrompts` keyframe 分支（prompts.ts:464 附近）从 `shot.associateAssetIds[].variantId` 解析、缺失时按 §3.3 推断，填入 `refVariantIds`。

**第二调用点**：`selectRefs` 在 graphStore 有两处调用（主图扇出 exec + 单格重生成 regenerate）——签名一改两处都要改，建议抽 `buildRefSelectionArgs(job)` 防漂移。

**写回（net-new，非 saveElement 副作用）**：char-image 产物→`ElementRef.variants[].views` 的回写链**当前不存在**（graph 执行从不写 ElementRef，`saveElement` 仅 UI 调用）。M22a **可先不做自动写回**：keyframe 直接消费 char-image 的 PortValue meta（`(charId,variantId)` 已够）；写回 ElementRef 留作 M27 的显式动作。

### 3.2 char-sheet 校验改阻塞式（否则静默退化回原 bug）

现状 `validateNodeJson('char-sheet')`（prompts.ts:149）**仅** `nonEmptyArray(j.characters)`，LLM 漏 variants/错 appliesTo 全部放行、repair-retry（`buildRepairPrompt` 已存在）永不触发。改为：
- 每个 character 必须有非空 `identity`；
- `appearance/identity` 含时期标记（正则 `少年|青年|盛年|中年|暮年|老年|多年后|\d+岁`）却 `variants.length<2` → **返回非空错误串**（喂 repair-retry，不是 UI warning）；
- 每个 variant 有 `id/stageKey/appliesTo/triple`，variant id 唯一；
- 经 `ctx` 传入上游 `beatIds`（现 `ctx` 已传 `sceneIds`，prompts.ts:125 签名扩展），校验 `appliesTo` 引用真实 beat。

### 3.3 `appliesTo → beat` 规范化解析器（防 dead-code）

救猫咪节拍 id 是 `b1..b15`、`type` 才是 `'finale'`；若沿用 `stateAt` 的精确相等，`appliesTo:['finale']` 永等不上 `shot.beatId='b14'` → 整条 appliesTo 跳变成死代码、掉到 base。必须：
- 把 beat 的 **id 与 type 都带到 shot 上**（storyboard 生成时 shot 继承 `beatId`+`beatType`，或从上游 outline 查 type）；
- 解析器 lowercase/trim 两侧，对 `{beatId, beatType, actId, mood}` 做集合匹配；
- 文档化「`appliesTo` 填的是 beat **type**」。

### 3.4 base/identity 净化（防残留多期合并）

`identity` 是自由文本，LLM 仍可能写「少年清瘦、暮年白发」→ 该文本喂底/兜底三视图、图自己就糊成多期。对策：§3.2 校验拒绝 `identity` 含年龄/时期标记并 repair-retry；`buildCharViewSets` 生成兜底像时强制注入「age-neutral, single canonical adult」锚点，绝不把变体期文本拼进兜底 prompt。

> **M22a 不引入 baseAppearance/baseViews/底模派生**：每个 variant 自带 `appearance+triple`，各自独立成图、各自打 `variantId`——这已根治"多期挤一张图 + 取错期"（用户的 bug）。跨龄"还是同一张脸"的一致性属于增强，降级到可选 **M22b**（见 §5）。

---

## 4. 数据模型变更（含破坏性纠正）

- **`ElementRef.variants` 是破坏性变更，不是接线**：现有 `variants?: {id,label,assetId,tags}[]` 与新结构不兼容。方案：**新增独立字段** `appearanceVariants?: ElementVariant[]`（保留旧 `variants` 不动），并在 `assetStore.load()` 加 `schemaVersion` + 读时迁移（检测旧 `variant.assetId` → 映射为 `{views:{front:assetId}}`）。

```ts
export interface ElementVariant {
  id: string
  label: string                 // "少年期" / "盛年·将军" / "暮年"
  stageKey?: string             // 对齐 arc[].stage / beat type，用于自动选变体
  appliesTo?: string[]          // beat type/id/act/mood 关键字（经 §3.3 规范化匹配）
  appearance?: string           // 该变体独立外观
  prompt?: string
  triple?: { front?: string; side?: string; back?: string }
  views?: { front?: string; side?: string; back?: string }  // 生成后回填的 assetId（M27）
  refAssetIds?: string[]
  voiceId?: string              // 可选：per-variant 音色（童声/老年），默认继承角色级
}
export interface ElementRef {
  // ... 现有字段全部保留
  identity?: string             // L0 身份不变量（脸/体型/标志特征），age-neutral
  aliases?: string[]            // 别名，防错配（接线见 §6）
  appearanceVariants?: ElementVariant[]   // 新字段，非复用旧 variants
  schemaVersion?: number
}
```

- `saveElement` 新建分支（assetStore.ts:163）补齐 `charId/views/voiceId/lora/identity/aliases/appearanceVariants`（现状全丢）。
- `ProjectGlobals` 增 `stylePackId?`（M21 用，后置）。

---

## 5. 重排里程碑（v2）

> 排序原则：零依赖、治急痛、落点正确的先发；重型/增强后置；投机砍掉。

| 里程碑 | 内容 | 治 | 依赖 | 主要文件 |
|---|---|---|---|---|
| **M-quick** | i2v `frameDuration`（graphStore.ts:1171）+ t2v 时长读取处 `Math.min(Math.max(d,4),15)`；storyboard 解析后 `shots.slice(0,maxShots)`（param + 告警） | 分镜爆炸/时长 | 无 | graphStore.ts、nodeDefs.ts |
| **M22a（核心）** | §3 全部：`variantId` 四处载体 + 阻塞校验 + appliesTo 规范化 + identity 净化；char-sheet 模板加 `variants[]`；`buildCharViewSets` 按变体展开；selectRefs 两处调用点改造 | **核心 bug（取错期/多期合并）** | 无 | prompts.ts、promptTemplates.ts、graphStore.ts |
| **M22b（可选）** | 底模 + 派生（identity 三视图先出 → 各 variant 以底模 front 为 editImage 参考"换龄不换脸"）；需 char-image 加 base→variant 的**两段式调度**（现 mapPool 无 inter-set barrier，需新增）；`gen.total` 计 base+variants×3 | 跨龄同脸一致性 | M22a | graphStore.ts char-image 分支 |
| **M-compat** | image-edit/upscale 输出 meta 透传 `charId/variantId/view/locationKey`（现重建 meta 只留 name+kind，断链）；merge `by-key` keyOf（graphStore.ts:503）按 `charId+variantId` 分桶 | 变体链跨节点不丢 | M22a | graphStore.ts |
| **M-scene/prop** | scene-image 按 `(locationKey,variantId)` 出多板、selectRefs 场景道具车道按变体选；prop 变体生成 exec | 场景时段/物品状态变体 | M22a | graphStore.ts、prompts.ts |
| **M21（后置）** | 结构化风格包 `StylePack`（色盘/光影/锚定/分模式负向词）+ 单一 `resolveStyle` seam + `stylePackId` 入 `nodeCacheSalt` | 风格漂移 | 无（独立） | 新 stylePacks.ts、prompts.ts |
| **M24-lite** | 段落规划走 storyboard **内置 option-B**（不加独立 director 节点，避免双规划器）：storyboard 内多一步产 `segments{mood,activeVariants,shotBudget}` 再产 shots；保留 storyboard 单一规划权 | 一致性/规划 | M22a | graphStore.ts storyboard 分支 |
| **M27** | 变体编辑 UI（AssetsView 子列表 + character 节点 base/variants 映射）；char-image 产物写回 ElementRef.variants[].views；fieldOptimize 加 identity/variant 字段优化器；templates.ts 加变体一致性预设 | 体验/手工授权 | M22a–M24 | AssetsView.tsx、Inspector.tsx、graphStore.ts、fieldOptimize.ts、templates.ts |
| ~~M26 event-graph~~ | **砍掉** | — | — | storyboard 已有 sceneId 覆盖校验+repair（prompts.ts:125 storyboard 分支）兜底"丢后半段"；若复发先强化该校验 + 分批，事件图谱另立 RFC |

**成本硬上限（M22a 内）**：`maxVariants`（默认 ~3，char-sheet 解析后截断）；`ElementVariant.views` 支持 `front-only`（非主变体只出正面），char-image 据此算 `totalViews`，杜绝 N×3×N 失控。

---

## 6. 完整性补漏（评审点名、v1 漏列）

- **别名接线**：`aliases` 仅有数据无匹配逻辑。在 keyframe 取图前用 char-sheet/ElementRef 建 `alias→charId` 映射，把 shot 角色名先归一到 charId（charId 已是 pickRef 最高优先级）。
- **per-variant 音色**：`tts` 的 voiceMap 现为每角色一个 voiceId。要么 `ElementVariant.voiceId` 参与（童声/老年），要么在 §9 显式声明不做并给理由。
- **canvas character 节点映射**：节点单 `appearance/refPrompt/voiceId` → base+variants 的映射、手工授权 vs LLM 生成的优先级，需在 M27 定义；`resolveOutput` 发 base/variants。
- **templates.ts**：5 个预设接的正是 char-sheet→char-image→keyframe 链，加变体后需更新/新增预设并确认旧预设带新可选字段仍 typecheck。
- **fieldOptimize.ts**：新增 `identity`（保身份指令）、`variant.appearance`（派生指令）优化器条目。
- **段落 param 迁移**：M24-lite 的 `shotBudget/maxShots` 与现有 `shotMode('总量自适应')/shotsPerScene/targetLength/sceneCount` 重叠，需定义 old→new 优先级（segment 开启时覆盖 shotsPerScene）。

---

## 7. 向后兼容与迁移（逐条核对）

- 旧 char-sheet 输出（无 variants）：`appearance` 当兜底像，零变体 → 等价现状；但**新阻塞校验对旧无 beat 上游要降级为软告警**（无 `ctx.beatIds` 时不硬错），否则旧模板会被卡。
- `ElementRef` 旧记录：见 §4 schemaVersion 读时迁移，旧 `variants` 字段保留不动。
- **取图回退兼容**：base 图 `variantId===undefined` 必须满足"无变体专属图时的 (charId, any) 命中"，即 `pickRef` 在 `(charId,variantId)` 未命中后**逐字复用现有 `pickRef(charId)` 路径**——保证从未启用变体的旧工程取图结果不漂移。需回归样例锁定。
- `stylePackId` 缺省 → 回退旧 `style` 字符串路径（M21 后置，先不动）。

---

## 8. 验收

- 每里程碑 `npx tsc --noEmit` + `npm run build:ui` 通过。
- **核心回归样例（必须写）**：角色「沈砚」youth/prime/elder 三变体；beat=finale 的镜头 → 断言 keyframe 取到 **elder** 三视图（非 youth、非空）。覆盖：variantId 缺失时经 appliesTo 推断、appliesTo 大小写/类型对齐、base 兜底回退仍命中旧 charId 图。
- ffmpeg/供应商相关项（时长、原生音频）在 Mulby 内人测。

## 9. 风险与取舍

- M22a 仍依赖 LLM 正确产出 variants——阻塞校验+repair 把"静默退化"变"可自愈"，但仍可能多轮失败；UI 手工增删变体（M27）兜底。
- 砍 M22b（不派生）则跨龄可能不够"同一张脸"——先上 M22a，**实测出现跨龄脸漂移再开 M22b**。
- M24-lite option-B 在 storyboard exec 里多一次 LLM 调用+校验，是真实 exec 改动非模板微调。

---

## 附：与 v1 / 既有路线图关系

v1 文档已被本 v2 取代（同文件）。本方案续接 `mulby-plugins/docs/ai-film-studio-completion-plan.md`（M14–M20 已落地）。落地起点：**先 M-quick + M22a**（用户两处急痛、零/低依赖、落点已核实正确）。

---

## 10. 实施 Changelog（2026-06-18 全部落地）

> 全部里程碑均逐项 `npx tsc --noEmit` + `npm run build:ui` 通过 + 纯逻辑断言验证（无头环境跑不了真实模型/`window.mulby`，实际出图与 UI 视觉仍需 Mulby 内人测）。

### v2 八里程碑 + 可选 M22b（全部完成）

- **M-quick** — i2v/t2v `frameDuration` 钳制 `[4,15]s`（共享点）；storyboard 加 `maxShots` 参数（默认 0=不限）+ `capStoryboardShots` 截断两条出镜路径。
- **M22a（核心 bug）** — 身份/形态解耦：`CharViewSet.variantId`；`buildCharViewSets` 按变体展开；`variantKey`/`resolveVariantForShot`/`spansMultiplePeriods`；keyframe 算 `refVariantIds`（显式 `associateAssetIds` > appliesTo 归一化 > 叙事比例兜底）；`RefImage`+`refsFromValues`+`metaOf`+`pickRef`/`pickRefs`/`selectRefs` 全程加 variantId（精确级回退 charId-only，旧工程零漂移）；char-sheet 模板加 identity+variants[]+硬性拆期；`validateNodeJson` char-sheet 改阻塞式（多期未拆/identity 混期/id 重复→repair 重试）。
- **M-compat** — image-edit/upscale 输出 meta 透传 charId/variantId/view/locationKey/isMasterPlate；merge `by-key` keyOf 加 `@variantId` 分桶。
- **M-scene/prop** — scene/prop 节点加 `variant` 参数 + `buildAssetImageJob` 注入提示与 meta；`ImageJob.refPropVariantIds/sceneVariantId`；`pickRef` 加 name+variantId 级、`selectRefs` 场景按时段变体优先/道具按状态匹配。
- **M21（风格包）** — 新增 `services/stylePacks.ts`：`StylePack` 类型 + **11 内置包**（国风二次元/写实电影/扁平插画/90s日漫/3D动画/黏土定格/3D国风/国潮赛博/都市言情/真人古装/水墨——均原创撰写，门类范围参考 Toonflow 但**未拷贝其 skill 文件**，规避 IP）+ `applyStylePack`/`videoStyleTag`；`resolveStyle` 改单一 seam（role 参数，优先级 连入 json.style > 风格包 > 自由 style）；`globalsLine` 注入包锚定；i2v/t2v 注入 `videoTag`；`stylePackId` 入 `nodeCacheSalt`；GlobalSettings 加风格包下拉。
- **M24-lite** — storyboard 模板加可选 `segments[]`（mood/lighting/activeVariants/shotBudget）+ shot `segmentId`（**单次 LLM 调用、不加 director 节点**，避免双规划器）；keyframe 变体优先级补 `segment.activeVariants`（权威源，补 bug-7）；段落 mood/光影注入镜头 prompt。
- **M27** — 模板「角色跨时期一致性」；character 节点加 `identity`+`variantsJson` 参数 + resolveOutput 安全解析；**变体编辑 UI**（`ElementVariant` 类型 + `ElementRef.identity/appearanceVariants` 新字段 + **修复 saveElement 丢字段** + AssetsView 变体增删列表）；**写回** `promoteCharViews`（画布三视图→已存在库角色 appearanceVariants，幂等、不自动新建）；**回环** insertElementNode 把库变体回填节点 + 下沉为带 variantId 的图像项；fieldOptimize 加 `character.identity`。
- **M22b（底模派生 换龄不换脸）** — buildCharViewSets 先出 age-neutral 底模(isBase)+逐变体派生组(derives, baseGroup)；char-image exec 改**两段式**（底模组先并发→捕获 front→变体组并发派生 front=editImage(底模 front) 锁脸）。**经 17-agent 对抗评审（14 findings）修复 4 真 bug**：ORD-1（同名/无名角色 baseFronts 串脸→改唯一 `baseGroup` 配对）、M22b-1/2（无 img2img/底模失败时变体变随机脸→身份文本重注入变体提示词）、M22b-4（canEdit 增 attachments.upload typeof 双探）、INT-4（变体数 slice(0,8) 上限）。

### 运行期 5 问修复（用户实测反馈）

1–2. **少帧/少视频静默丢失** — `mapPool` 加 `retries`（图像/视频扇出各 `retries:2` 线性退避）扛限流；失败提示改可操作（提示重跑补齐、已成功命中缓存）。
3. **无台词/台词说英文** — 根因 storyboard 模板缺 `dialogues` 字段（剧本有但分镜丢）→ 补 schema；`buildAudioPrompt` 加语言指令（spoken in X, don't translate）；新增 `ProjectGlobals.dialogueLang`（默认中文）+ GlobalSettings 下拉，注入 script-gen/storyboard 提示词与 i2v 原生音频；demo 模板 i2v 默认 audioMode『模型自带声』。
4. **分镜∥角色未并行** — `runOrder` 从顺序 for-await **重写为依赖驱动并发调度**（deps 全 done 即就绪，cap=并发设置，cap=1 退化顺序），保留 lock/skip/cache/cancel 语义；分镜∥角色设定、角色图∥场景图现并发。
5. **镜头割裂/尾接首** — i2v 加 `continuity`『连贯镜头尾接首』参数：连贯镜头用下一镜首帧作本镜尾帧（首尾帧补间），由 storyboard 新增的 `continuousFromPrev` 标注控制（硬切不接），缺省同 `sceneId` 回退；显式尾帧输入优先；keyframe meta 加 `sceneId/continuousFromPrev`。**注**：割裂感本质一半在剧本/分镜质量，顺接只解决"技术上能衔接"，连贯性仍需分镜把连续动作合理切镜。

### 仍待 Mulby 内人测（代码无法替代）
变体/底模派生实际出图一致性、风格包视觉、对白是否真按设定语言、镜头顺接是否无缝（及是否误接硬切处）、并发下的供应商限流表现。

### 主动延后（有据）
M22b-3（editImage 未注册 abortImage，pre-existing）、INT-1（进度计数 cosmetic）、变体列表编辑器的缩略图/精细交互（纯视觉，需 Mulby 目视迭代）。
