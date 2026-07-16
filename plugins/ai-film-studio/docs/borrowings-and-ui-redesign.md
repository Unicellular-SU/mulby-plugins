# AI 影视工作流 · 借鉴升级 + 节点UI/结果预览重构方案（M28–M33）

> 本方案两部分：
> **A. 从同类开源项目借鉴的架构升级**——[Jellyfish](https://github.com/Forget-C/Jellyfish)(Apache-2.0, 3.9k⭐) 与 [alibaba/lumenx](https://github.com/alibaba/lumenx)(MIT, TS 同栈) 深扒后提炼。
> **B. 节点 UI 样式 + 结果预览重构**——当前画布节点的展示与结果查看不合适，重新设计。
>
> 续接 `consistency-and-planning-redesign.md`（M21–M27 已落地）。里程碑编号续为 M28+。
> **IP 原则**：只借鉴设计思路、自行实现，绝不拷贝两个仓库的代码/文本（两者虽 MIT/Apache 宽松，仍按对待 Toonflow 同样的原则处理）。

---

## 0. 现状与痛点（已逐文件核对）

### 0.1 节点 UI（`components/nodes/FilmNode.tsx` + `styles.css`）
- **结果瓦片在节点上不可点**（FilmNode tiles 无 onClick）；视频瓦片 `muted loop` 无控件/无声——**在画布上看不清、点不开、放不了**。
- **瓦片无身份标注**：不显示这张图属于哪个镜头/哪个变体/哪个视角(front/side/back)——25/32 出图时**根本看不出哪 7 张失败**（正对应之前"少帧静默丢失"）。
- **无逐项状态**：瓦片只有"已生成/占位旋转"两态，没有 **失败(红) + 重试**；要补只能整节点重跑。
- **数据卡片**（剧本/分镜/角色，`dataCard`）：文本截断、固定 300px、不可滚动看全、不显示台词、无逐行操作。
- **状态是一个小圆点**：无进度条、无"N/总 · X 失败"计数。
- 节点尺寸/留白随内容硬撑，缺少折叠/展开与一致的视觉层级。

### 0.2 结果预览
- **Inspector** 里其实已有较好的预览（`inspectorViews.tsx`：视频带 controls、图片点开 `Lightbox`、逐图"重新生成/对话改图"、JSON/文本视图、打开本地文件夹）——**但它只在右侧 Inspector，画布优先的操作流里用着别扭**。
- Lightbox 状态是 Inspector 局部 state，**节点无法直接打开**。
- 缺少**统一结果查看器**：长剧本/21 镜分镜在节点上读不全、在 Inspector 里也只是竖列；视频没有"按顺序连看"来验证镜头顺接(#5)。

### 0.3 架构层（借鉴动机）
- **模型/供应商处理散落**：`services/providers/presets.ts` + graphStore 各分支 + bodyTemplate，加模型要改多处。
- **无中文配音落地**：上一波加了 `dialogueLang` 设置，但没有真正的中文 TTS 供应商。
- **生成失败只有节点级重试 + 缓存**：做不到"失败的那几帧单独补、成功的不重烧"。

---

## A. 借鉴升级

## M28 · 声明式模型目录（借 LumenX，最高架构价值）
**痛点**：模型能力/默认值/参数/UI 可见性/参考图上限散落在代码里，加供应商成本高、易漏。
**设计**：引入单一事实源的模型目录（我们用 TS 常量 + 类型，不必像 LumenX 用 YAML 编译——插件无构建步更轻）。
```ts
// services/modelCatalog.ts
export interface ModelEntry {
  id: string                      // 逻辑模型 id
  family: string                  // wan/kling/vidu/seedance/gpt-image/qwen…
  label: string
  capabilities: ('t2i'|'i2i'|'t2v'|'i2v'|'r2v'|'v2v'|'tts'|'music'|'lipsync')[]
  modes?: { id: string; refImages?: { max: number }; durations?: number[]; params?: ParamSpec[] }[]
  providerId: string              // 对应 providerStore 的供应商
  ui?: { group: string; visibleIn: ('topbar'|'node'|'settings')[]; recommended?: boolean; order?: number; badges?: string[] }
  status?: 'active'|'planned'|'hidden'
}
export const MODEL_CATALOG: ModelEntry[]
export function modelsFor(cap: MediaCapability): ModelEntry[]
export function modelEntry(id: string): ModelEntry | null
```
- 顶栏模型选择、节点级覆盖、参数控件、参考图上限**全部从目录读**；加模型=往目录加一条。
- 与现有 `providerStore`/`presets` 衔接：目录条目引用 providerId；`presets.ts` 仍负责"怎么发请求"，目录负责"有哪些模型、什么能力、怎么在 UI 露出"。
- **不照搬** LumenX 的 YAML→JSON 编译链（对无独立构建的插件过重），改用 TS 常量即可。

## M29 · 中文配音（借 LumenX，直接补完 dialogueLang）
**设计**：
- **TTS 供应商预设**：CosyVoice / Qwen3-TTS（走 DashScope/百炼，OpenAI 兼容或专用 body），加入 `presets.ts` + 目录。
- **音色注册表**：每音色带 `family`(cosyvoice/qwen3) / `gender` / `dialect`(北京/粤语/四川/闽南…) / `langPrimary` / `supportsInstruction`。
- **逐角色/逐变体音色**：`ElementVariant.voiceId` 已有；角色卡 `voiceId` 已有；TTS voiceMap 按角色取，缺省 narrator。
- **情绪→指令**：把对白的 `emotion`/`delivery` 转成 TTS 的自然语言 instructions（cosyvoice/qwen3 都支持）。
- **防重配**：对白行算 `hash(text|voiceId|instructions)`，未变则跳过重配（借 LumenX `dialogue_text_hash`）。
- （进阶，后置）Demucs 分离原生 BGM、把对白叠到去人声轨——依赖宿主 ffmpeg/demucs，先标注。

## M30 · 逐项可恢复生成（借 Jellyfish，轻量版；根治少帧/少视频）
**Jellyfish 那套 MySQL+Redis+Celery 对浏览器内插件过重，不照搬**。取其思想，用轻量形态：
- **节点 `gen` 升级为逐项状态数组**：`gen: { total, items: { idx, key, status:'pending'|'running'|'done'|'failed', assetId?, error? }[] }`（key=镜头/变体标识）。
- 扇出执行时每项独立写状态；失败项标 `failed` 持久化到节点（不只 toast）。
- **逐项重试**：节点/瓦片上"重试失败项"——只跑 `failed` 的，成功的命中已有产物不重烧（比现在的节点级 inputHash 更细）。
- 与 M32 节点 UI 联动：瓦片直接显示每项 done/pending/failed + 单项重试按钮。
- **不存"生成中"于产物本身**（借 Jellyfish 教训）：运行态在 `gen.items`，产物只存成功项，避免崩溃后永久转圈。

## M31 · 生成前确认闸门（借 Jellyfish，省 token，较大 UX，后置/可选）
- 抽取(角色/场景/道具/台词)先落"候选"，用户**确认/去重/关联已有资产**后再烧图/视频 token。
- 多因子"就绪"判定才放行生成。
- 重抽取保留用户已确认的关联。
- 规模较大，列为方向；先做 M28–M30 + UI。

## 其余借鉴（小项，纳入相应里程碑）
- **(质量 × 视角) 资产图矩阵 + `is_consistent` 失效标记**（借两家）：变体三视图记录"哪些角度/质量已生成"，底模重生成时把派生视图标过期——精修 M22b，落到 M32 的资产展示。
- **media-input-mode 抽象**（借 LumenX `provider_media`）：把媒体引用分类(local/url/base64/oss)再按"输入模式"解析——我们已有 `ensurePublicUrl`+bodyTemplate，供应商更多时再系统化，并入 M28。
- **Studio/Playground 分离**（借 LumenX）：一个"独立生成"轻量入口（不走完整流水线），复用同一目录/适配器——并入 M33 的结果区或单列。

---

## B. 节点 UI + 结果预览重构（用户重点）

## M32 · 画布节点 UI 重构
目标：节点在画布上**自解释、可操作、能看清结果**。

### 32.1 节点解剖（新结构）
```
┌───────────────────────────────┐
│ ▣ 标题            ⟳  🔒  ●状态 │  头部：类别色；hover 出「运行此节点/重生成/锁定」按钮
├───────────────────────────────┤
│  端口区（输入左 / 输出右）       │
├───────────────────────────────┤
│  内容区（按 kind 自适应）：       │
│   · 媒体网格（图/视频瓦片）       │
│   · 数据卡（剧本/分镜/角色）       │
│   · 资产卡（角色变体/场景/道具）   │
├───────────────────────────────┤
│  进度条 N/总 · X失败  |  摘要     │  底部：运行时进度+失败计数；完成时产物摘要
└───────────────────────────────┘
```

### 32.2 媒体瓦片（核心改动）
- **可点开**：点瓦片→打开全局 Lightbox（见 32.5，复用并提升 `inspectorViews` 的 Lightbox 为应用级）。
- **视频**：画布上静音循环作预览 + 角标 ▶；点开在 Lightbox 里**带控件/声音/可拖动**播放。
- **逐项状态**（联动 M30）：每瓦片三态——✓完成 / ⟳生成中 / ✗失败(红框)；失败瓦片上直接给「重试」。
- **身份标注**：瓦片角标显示镜头号/变体标签/视角（front/side/back）——一眼知道哪张是哪张、哪张缺。
- **逐瓦片操作**（hover）：重生成 / 对话改图 / 存入素材库 / 设为定版（final）。
- 瓦片尺寸自适应（小图密铺、单图放大），列数随产物数与节点宽度走。

### 32.3 数据卡（剧本/分镜/角色/大纲）
- 可滚动、显示更多行；分镜行显示 **台词条数 + 首句**、景别/运镜/时长 chips、**段落(segment)归属**、`continuousFromPrev`(顺接)标记。
- 角色卡显示**变体徽章**（少年/盛年/暮年）与三视图缩略。
- 每行可点→在结果查看器(33)定位该镜/该角色；行内"重写/重生成本行"（联动 M30）。
- 顶部"展开全部"→打开结果查看器读全文。

### 32.4 状态与进度
- 底部进度条：`生成中 12/32 · 3 失败`，失败数红色可点→筛出失败项。
- 错误态：节点红边 + 可读错误 + 「重试」。

### 32.5 全局 Lightbox（从 Inspector 提升）
- 把 `inspectorViews.tsx` 的 Lightbox 状态提到一个 `useUiStore`（`lightbox:{items,index}`），在应用根渲染——**节点瓦片、Inspector、素材库都能打开同一个**。
- Lightbox 增强：左右切换、键盘导航、视频播放器、当前项的"重生成/改图/存库/设为定版"。

## M33 · 结果预览重构（统一结果查看器）
目标：长内容看得全、视频连得起来、操作集中。

### 33.1 统一结果查看器（模态/抽屉）
- 任意节点「查看结果」打开：
  - **媒体**：大网格 + 标注 + 逐项状态；点进 Lightbox。
  - **JSON（剧本/分镜/角色）**：结构化可读视图——场/镜列表、**台词成段显示**、景别/运镜/时长、segment 分组、可内联编辑后回写节点。
  - **文本**：富文本 + 编辑。
- 复用并扩展现有 Inspector 的 JSON/文本视图，不另起炉灶。

### 33.2 视频「连看」预览（验证镜头顺接 #5）
- i2v/合成结果支持**按分镜顺序连续播放**（简易时间线），把 N 段拼起来顺看——直接用来肉眼验证顺接是否无缝、该硬切处是否被误接。
- 显示每段时长、镜头号、是否顺接。

### 33.3 失败闭环
- 结果查看器顶部："X 项失败"→一键重试失败项（联动 M30），就地补齐。

### 33.4 Playground 轻量入口（借 LumenX，并入此处）
- 一个不走流水线的"独立生成"面板：选模型(从 M28 目录)+模式(t2i/i2v/r2v)+提示词/参考图→生成→进结果查看器；产物可一键存素材库。给"我就想快速试几张/几段"用。

---

## 4. 数据模型 / 文件变更总览
| 文件 | 变更 |
|---|---|
| `services/modelCatalog.ts`（新） | M28 模型目录类型 + 常量 + 查询 |
| `services/providers/presets.ts` | M29 CosyVoice/Qwen3 TTS 预设；目录衔接 |
| `services/tts.ts` + 音色注册表（新/扩展） | M29 family 分发、dialect/lang/instruction、防重配 hash |
| `store/graphStore.ts` `FilmNodeData.gen` | M30 升级为逐项状态数组 + 逐项重试入口 |
| `store/uiStore.ts`（新） | M32 全局 Lightbox / 结果查看器状态 |
| `components/nodes/FilmNode.tsx` + `styles.css` | M32 节点重构（瓦片可点/标注/逐项态/进度条/数据卡） |
| `components/inspectorViews.tsx` | M32/33 Lightbox 提升为应用级 + 结果查看器复用 |
| `components/ResultViewer.tsx`（新） | M33 统一结果查看器 + 视频连看 |
| `components/Playground.tsx`（新，可选） | M33 独立生成入口 |
| `store/assetStore.ts` | 小项：(质量×视角)矩阵 + is_consistent 失效标记 |

## 5. 落地顺序与依赖（建议）
1. **M32 + M30**（节点 UI 重构 + 逐项可恢复生成）——绑定做：瓦片显示逐项状态/重试，正好把"少帧/少视频"从静默变可见可补；这是用户最痛、最高价值。
2. **M33**（结果查看器 + 视频连看）——依赖 M32 的全局 Lightbox；验证顺接/通读长剧本。
3. **M29**（中文配音）——独立，随时可插；直接见效。
4. **M28**（模型目录）——架构重构，一劳永逸，但不阻塞体验；可与上面并行。
5. **M31**（确认闸门）/ Playground / 资产矩阵——后置增强。

## 6. 风险与取舍
- **不照搬重型后端**（Jellyfish 的 MySQL/Redis/Celery/S3、LumenX 的 Python FastAPI + Demucs/PyInstaller）：我们是 Mulby 浏览器内插件，取思想用轻量形态。Demucs 类强依赖标注"待宿主能力"。
- **全局 Lightbox 提升**需把局部 state 上移到 store，注意 React Flow 节点重渲染性能（瓦片用 memo + 仅缩略图，重内容懒加载）。
- **逐项 gen 状态**会增大节点数据体积/序列化——`serializeNodes` 需剔除运行态（仅保留成功产物 + 轻量 items 索引）。
- **M28 目录**与现有 presets 双轨期需明确边界（目录=元数据，presets=请求构造），避免重复事实源。
- UI 视觉效果**需在 Mulby 内目视迭代**（同既往：纯视觉部分代码可 build-verified，但好不好看要真跑）。

## 7. 验收
- 每里程碑 `npx tsc --noEmit` + `npm run build:ui` 通过 + 纯逻辑断言（目录查询、音色分发、逐项重试只跑失败项、连看顺序）。
- 节点 UI / 结果查看器 / Lightbox / 配音实际效果 **Mulby 内人测**。
- 核心验收样例：32 镜里 7 帧失败 → 节点瓦片红框显示这 7 项 → 点「重试失败项」→ 仅补这 7 帧、其余不重烧。
