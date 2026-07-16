# AI 创意画布（ai-creative-canvas）— 完整设计方案 · v2（自研画布）

> 文档类型：架构与实现设计（开发前的「一套完整方案」）
> 创建：2026-06-20 · v1
> 修订：2026-06-20 · **v2 —— 按用户要求去除第三方画布引擎（tldraw），画布完全自研，参考 AI-CanvasPro 的实现路线**
> 参考对象：AI-CanvasPro（`D:\Node.js\mulby-all\_external\AI-CanvasPro`，源自 https://github.com/ashuoAI/AI-CanvasPro）
> 区分对象：同仓库已有插件 `ai-film-studio`（`mulby-plugins/plugins/ai-film-studio`）
> 目标产物：可在 Mulby 中安装并使用的「无限画布 · AI 影像创作 + 媒体编辑」插件

---

## ⚑ v2 变更摘要（相对 v1）

| 项 | v1（旧） | v2（本版，已采纳你的反馈） |
|---|---|---|
| 画布引擎 | 第三方 **tldraw** | **完全自研**：DOM 卡片 + 单一 CSS transform 世界层 + SVG 连线 + 自写 store/交互（**参考 AI-CanvasPro 实现路线，不照搬其代码**） |
| 许可风险 | tldraw 需 license key / 水印 / 商用 $6k/年 | **彻底消除**（无第三方画布授权问题） |
| 离线资源 | tldraw 资源需自托管（file:// 坑） | **彻底消除**（自研画布无外部资源） |
| 工作量 | 集成为主 | **画布引擎需自建**（平移缩放/框选/拖拽/连线/虚拟化/撤销重做）——这是本版主要新增工作量，已在里程碑与风险中体现 |
| 名称 | 待确认 | **已确认**：`ai-creative-canvas` /「AI 创意画布」 |
| v1 验收口径 | 待确认 | **已确认**（见 §18） |
| 仍待你一句话确认 | — | **「不用第三方」= 不用第三方画布引擎（保留 React+少量 MIT 工具）**，还是**纯原生 JS 零依赖**？详见 §5.1 / §18 |

---

## 0. TL;DR（一页看懂）

- **做什么**：一个**自研无限自由画布**，在画布上以「卡片」为单位**逐张**做 AI 影像创作（文生图 / 图生图 / 多图参考一致性 / 文本与分镜 / 可插拔的文生视频·图生视频·配音），并内置一套**逐卡片媒体编辑工具箱**（裁剪 / 扩图 / 抠像 / 放大 / 宫格分镜 / 视频裁剪 / 转 GIF / 抽帧 / 场景检测 / 音视频分离 / 倒放 / 拼接）。
- **像谁**：复刻 **AI-CanvasPro** 的「自由创作画布 + 富媒体工具箱 + @ 引用」气质与体验，**连画布的实现路线也参考它**（DOM+SVG+CSS transform，自写 store）。
- **不像谁**：与 `ai-film-studio` 彻底错开 —— 后者是「故事→分镜→成片」的**自动流水线（拓扑 Run All）**、用 React Flow；本插件是**手动、探索式、编辑为重**的创作白板、**自研画布**。两者定位互补、不重叠。
- **怎么实现**：UI 自研画布（React 承载 DOM 卡片层 + SVG 连线层 + 交互控制器 + 自写图状态 store）；AI 文本/图像直接用 **Mulby `ai.call` / `ai.images.*`**；媒体编辑直接用 **Mulby `ffmpeg` / `sharp`**；视频/音频生成走**可插拔外部 provider**（`mulby.http` + 后端 RPC + 加密存密钥）。AI-CanvasPro 当年自带的 Python+ffmpeg+OpenCV+原生助手，在 Mulby 里**塌缩为宿主 API 调用**。
- **代价（你已认可）**：自研画布意味着平移缩放/框选/拖拽/连线/虚拟化/撤销重做都要自己写；好处是**零授权、零外部资源、外观完全可控、与 AI-CanvasPro 手感最贴**。

---

## 1. 参考分析：AI-CanvasPro（精炼 + 画布技术要点）

> 完整逆向分析见前序分析；此处提炼对复刻有决定意义的点。AI-CanvasPro 前端为**混淆后的原生 JS**（无框架）+ 自研 DOM+SVG 画布 + 类 Redux store；后端是本地 **Python http.server（127.0.0.1:8777）** 充当静态服务 + AI 代理；外壳 **Electron**，自带 ffmpeg、PySceneDetect、OpenCV、原生 C++ 截图助手、three.js 3D 台、即梦 CLI。

### 1.1 我们要复刻的「画布实现路线」（核心参考）
- **节点是 HTML DOM 元素**：每个卡片是一个绝对定位的 `div`，作为「世界容器」的子节点。
- **整个世界用一个 CSS transform 平移缩放**：`transform: translate(x,y) scale(z)` 施加在世界容器上 —— 平移缩放时**卡片不重排**，只改一个 transform（GPU 友好、丝滑）。
- **连线/交互手柄用 SVG**：`createElementNS(...svg)` + 贝塞尔 `M..C..` 路径；连线可显隐。
- **配套层**：虚拟化（只渲染视口内卡片）、空间索引、LOD/快速预览（平移缩放期间降级渲染）、延迟媒体加载、overlay（框选预览、平移预览）。
- **交互**：滚轮缩放（朝光标）、空格/中键拖拽平移、框选、多选、拖动、拖锚点连线 / 点选连线（pick-connect）、右键菜单、双击空白快速加节点、拖拽文件/JSON 落画布自动建卡。
- **store**：类 Redux（graph/ui/workspace 三域）、选择器订阅、不可变快照、撤销重做（50 步 `{nodes,edges}` 快照）。

> 我们会用**同样的技术路线**，但在 **React** 里实现（见 §5、§8），**不复制 AI-CanvasPro 的代码**。

### 1.2 卡片类型（约 20）、连接模型、AI 能力、媒体管线
- 卡片：`source-text/image/video/audio`、`ai-image/text/video/audio`、`collage/storyboard/storyboard-script/panorama/scene-detection/group/comment-note/web-preview/media-clip` 等。
- 连接：**无类型端口（portless）**，看上游 `refKind`，少数固定 `refSlot`；提示词 `@` 引用 + `/` slash 预设。
- AI：文生图/图生图、文/图生视频、LLM 流式多模态、TTS/克隆/分离、360、3D 台、抠像(SAM3)、扩图、放大、标注、宫格、场景检测、分镜脚本、拼图、剪辑。Provider 多家 + 轮询 + SSE。
- 媒体管线（重）：ffmpeg、PySceneDetect+OpenCV、原生截图、即梦 CLI、SAM3、three.js、`.aicpkg` 打包。

> **复刻取舍**：画布、store、AI 层均可自研复刻；**Mulby 用 `ffmpeg`/`sharp` 宿主 API 替代 AI-CanvasPro 的原生媒体管线**，第三方生成走可插拔 provider，大幅降本。

---

## 2. 与 ai-film-studio 的区分（核心，必须守住）

| 维度 | **ai-film-studio（已有）** | **ai-creative-canvas（本方案）** |
|---|---|---|
| 一句话 | 故事→剧本→分镜→关键帧→视频→成片的**自动流水线** | 自由画布上的**探索式 AI 影像创作 + 媒体编辑工坊** |
| 交互范式 | **拓扑 DAG，一键 Run All / Run From Here** | **逐卡片按需生成**，无自动全图流水线 |
| 画布引擎 | **React Flow（@xyflow）** | **自研 DOM+SVG 画布（参考 AI-CanvasPro）** |
| 画布气质 | 节点+端点的流程图 | 自由白板：自由摆放/缩放/分组/手绘标注/便签/多画布 |
| 连接/引用 | 边 + 角色推断（portless 素材池） | **@ 引用 + 自由连线作软引用**，取数时解析被引卡片 |
| 媒体编辑 | 弱（流水线输出为主） | **强 —— 逐卡片媒体工具箱是卖点** |
| 资产一致性 | 全局设置 + 角色/场景/道具池 + 扇出 | @ 多图参考一致性（`referenceAttachmentIds`），轻量即兴 |
| 目标用户 | 编剧/导演，要「成片流水线」 | 创作者/美术，要「灵感画布 + 后期编辑」 |
| `feature.code` | `open` | `open-canvas` |
| 触发词 | 故事画布 / AI视频 / 分镜 / 影视工坊 | 创意画布 / 无限画布 / AI画布（**全不重复**） |
| 存储/落盘隔离 | `ai-film-studio` | `ai-creative-canvas`（namespace + `userData/ai-creative-canvas/`） |

> **设计红线**：不引入「一键全图流水线」（那是 ai-film-studio 的身份）；本插件身份是**自由画布 + 逐卡片生成 + 富媒体后期编辑 + @ 引用**。

---

## 3. 产品定位与设计原则

1. **画布即一切**：素材、生成结果、文本、便签、手绘标注都是画布对象，自由摆放/缩放/分组/跨画布。
2. **逐卡片、按需、可逆**：每张 AI 卡片各自有「提示词 + 模型 + 参数 + 生成 + 状态」；无隐式跑全图；可中止、重试、分叉。
3. **编辑器气质**：选中任意图像/视频卡即可调出**媒体工具箱**做后期 —— 与 ai-film-studio 最强差异点，必须做深做顺。
4. **引用而非布线**：优先 **@ 引用**，自由连线作可视化软引用；取数在「生成时」解析，连线层不分槽位（继承 portless 思想，自研实现）。
5. **Mulby 原生优先，外部可插拔**：图像生成/编辑、全部媒体编辑、LLM 一律宿主原生、零密钥；视频生成、配音文件走可插拔 provider。
6. **离线即可用 + 隐私**：画布/工程本地持久化；媒体落本地磁盘；密钥进系统加密存储。
7. **自研可控、可演进**：画布引擎、卡片类型、provider 都是扩展点，便于后续逼近 AI-CanvasPro 全功能。

---

## 4. v1 范围（已确认：核心 + 可插拔视频/音频生成）

**纳入 v1：**
- **自研画布底座**：平移/缩放/框选/多选/拖动/连线/对齐与吸附(基础)/小地图(基础)/网格/撤销重做/视口持久化/导出画布或单卡为图片。
- 多画布（同工程多张画布切换）。
- 素材卡：拖拽/粘贴/`img`·`files` 触发导入 图片/视频/音频/文本 → 卡片；媒体落盘。
- AI 文本卡：`ai.call` 流式 + 看图（vision）+ 结构化（分镜脚本 JSON / 提示词扩写）。
- AI 图片卡：`ai.images.generate / generateStream / edit`（多参考一致性）+ 流式进度 + 队列。
- **图像媒体工具箱**：裁剪、扩图、放大、抠像/去背景、宫格分镜切片。
- **视频媒体工具箱**：裁剪、转 GIF、抽帧、场景检测、音视频分离、倒放、拼接、压制。
- @ 引用系统 + 自由连线软引用。
- **可插拔视频/音频生成**：文生视频/图生视频（外部 provider）、配音音频文件（OpenAI 兼容 TTS）。
- 任务中心、通知、设置、加密密钥、provider 预设。

**不纳入 v1（路线图后续）：** 3D 导演台、360 全景、补帧（minterpolate 重）、数字人口型、多轨时间线剪辑、全局截图助手、`.aicpkg` 互导、空间索引/LOD 等深度性能优化（先简单虚拟化）。

---

## 5. 技术选型与依赖

### 5.1 ⚑ 依赖策略（**需你一句话确认**）

去掉 tldraw 后，画布完全自研。关于「还用不用其它第三方库」，给两条路线：

- **(推荐) 方案 A：Lean React + 自研画布**
  - **不使用任何第三方画布引擎**（无 tldraw / 无 React Flow）；画布的平移缩放、卡片层、连线层、交互、虚拟化、撤销重做**全部自研**。
  - UI 仍用 **React 18**（与本仓库 ai-film-studio / ai-flowchart 一致，组件化高效），状态用 **zustand**，外加极少量 **MIT** 小工具（`nanoid` 生成 id、`lucide-react` 图标）。这些都是 MIT、无授权风险、可随时替换为手写。
  - 媒体处理 = Mulby `ffmpeg`/`sharp` 宿主 API（**不打包 npm 包**）。
  - 优点：与仓库一致、开发最快、维护最省；满足「自研画布、无第三方画布引擎」。

- **方案 B：纯原生 JS（AI-CanvasPro 同款，零依赖）**
  - 连 React 都不用，vanilla TS + 自写迷你 store + 自写渲染。最贴 AI-CanvasPro 原貌、依赖为 0。
  - 代价：与本仓库其它插件（React）技术栈不一致、组件/表单/面板要全手写、开发周期更长、后续维护成本更高。

> **本文档按方案 A 展开。** 若你要的是方案 B（纯 vanilla 零依赖），回复一句，我把 §5.2/§7/§8/§14 改为 vanilla 版（架构与画布技术路线不变，仅去 React/zustand、改为手写）。

### 5.2 依赖清单（方案 A）

| 库 | 用途 | 许可 | 备注 |
|---|---|---|---|
| `react` / `react-dom` 18 | UI 框架 | MIT | 与仓库一致 |
| `zustand` 5 | 图状态 + App 状态 | MIT | 仓库已用；亦可换自写 store |
| `nanoid` | 卡片/工程/边 id | MIT | 仓库已用；亦可 `crypto.randomUUID` |
| `lucide-react` | 图标 | ISC/MIT | 仓库已用；亦可内联 SVG |
| `tailwindcss`(+postcss/autoprefixer) | 面板样式 | MIT | 仓库已用；画布本体用自写 CSS |
| ~~tldraw / @tldraw/assets~~ | — | — | **已移除** |
| ~~@xyflow/react / @dagrejs/dagre~~ | — | — | 不用（那是 ai-film-studio 的） |
| `react-easy-crop`（可选） | 裁剪交互 | MIT | workspace 已存在；**默认自写裁剪框**（我们已有交互层），此库仅备选 |
| `p-limit`（可选） | 并发限流 | MIT | workspace 已存在；亦可 10 行自写 |

- 安装用 **pnpm**（本仓库是 pnpm workspace，npm 装的会被 prune）。方案 A 的新增依赖极少（多数仓库已具备）。
- **媒体不装 npm 包**：`ffmpeg`/`sharp` 是 Mulby 宿主 API，禁止在插件内打包原生 `sharp`/`ffmpeg`。

### 5.3 Mulby 宿主 API（已核对 references/apis）

| 能力 | API | 端 |
|---|---|---|
| LLM 文本/看图/结构化/流式 | `ai.call(opt,onChunk)`、`ai.abort(reqId)`、`ai.allModels({endpointType})`、`ai.attachments.upload({buffer})` | UI/后端 |
| 文生图/图生图/多参考 | `ai.images.generate / generateStream / edit({imageAttachmentId,referenceAttachmentIds})` | UI/后端 |
| 图像处理 | `sharp(input).resize/extract/extend/composite/...→toBuffer/toFile`；后端 `sharp.execute({input,operations})` | UI/后端 |
| 音视频处理 | `ffmpeg.isAvailable/download/run(args,onProgress)` | UI |
| HTTP（规避 CORS、密钥不进浏览器） | `http.request/get/post` | UI/后端 |
| 持久化 KV/加密/附件 | `storage.get/set`、`storage.encrypted.*`、`storage.attachment.*` | UI(+后端 KV) |
| 文件系统（大媒体落盘） | `filesystem.exists/mkdir/writeFile`、`system.getPath('userData')` | 后端 |
| 通知 | `notification.show(msg)` | UI/后端 |
| 即时朗读（预览，非文件） | `tts.speak/stop` | UI |
| 主题 | `onThemeChange(cb)` | UI |
| 插件↔后端 RPC | `window.mulby.host.call(pluginId,method,args)` ↔ 后端 `export const rpc={...}` | 两端 |

> **关键事实（决定架构）**：Mulby **无内置视频生成**；`tts` 仅即时播放、**不产音频文件**。故文/图生视频、配音**文件**走外部 provider（与 ai-film-studio 一致）；其余均 Mulby 原生、零密钥。

---

## 6. 能力 → 实现映射总表（干货）

> 卡片产物统一为 `Asset { kind, url(file://或blob), localPath?, attachmentId?, mime, width?, height?, durationSec?, meta }`。

### 6.1 生成类
| 功能 | 实现 | 关键点 |
|---|---|---|
| 文本/分镜脚本/提示词扩写 | `ai.call`（`params.responseFormat:'json_object'/'json_schema'` 产结构化分镜） | 流式 onChunk 回填；中止 `ai.abort(reqId)` |
| 看图理解 | `ai.attachments.upload({buffer})`→`ai.call(content:[{type:'image',attachmentId}])` | 选 `capability:'vision'` 模型 |
| 文生图 | `ai.images.generate({model,prompt,size,count})` | `allModels({endpointType:'image-generation'})` |
| 图生图/编辑 | `ai.images.edit({model,imageAttachmentId,prompt})` | 主图来自被引图片卡 |
| 多图参考一致性 | `ai.images.edit({imageAttachmentId,referenceAttachmentIds:[...]})` | Gemini 系多图最佳 |
| 流式进度/预览 | `ai.images.generateStream(input,onChunk)` | `status`/`preview` 驱动占位与进度 |

### 6.2 图像媒体工具箱（Mulby `sharp`，零外部依赖）
| 工具 | 实现 |
|---|---|
| 裁剪 | 自写选区框（复用交互层）或 `react-easy-crop` → `sharp(input).extract({left,top,width,height})` |
| 扩图(outpaint) | `sharp().extend({...,background:透明})` 出带空白边底图 → `ai.images.edit` 填充扩展区 |
| 放大/高清 | 首选 `ai.images.edit`(模型重绘「upscale」)；简单场景 `sharp().resize(2x)` |
| 抠像/去背景 | 首选 `ai.images.edit`「remove background→透明 PNG」；备选 `sharp` 阈值/luma；进阶接外部分割 |
| 宫格切片→多卡 | `sharp().extract()` 按 N×M 切 → 批量建图片卡 |
| 缩略图/元信息/合成 | `sharp().resize/metadata/composite` |

### 6.3 视频媒体工具箱（Mulby `ffmpeg`）—— **差异化中枢**
> 先 `ffmpeg.isAvailable()`，否则 `ffmpeg.download(onProgress)`。命令用 `ffmpeg.run(args,onProgress)`。

| 工具 | ffmpeg 参数（示意） |
|---|---|
| 裁剪 | `-ss {a} -to {b} -i in.mp4 -c copy out.mp4` |
| 转 GIF | `-i in -vf "fps=15,scale=320:-1:flags=lanczos,split[s0][s1];[s0]palettegen=[p];[s1][p]paletteuse" -loop 0 out.gif` |
| 抽帧/首帧 | `-i in -vf fps=1 f_%04d.png` / `-vf "select=eq(n\,0)" -frames:v 1` |
| 场景检测 | `-i in -filter:v "select='gt(scene,0.4)',showinfo" -f null -` → 解析 stderr `pts_time` 切点 → 逐段裁剪成片段卡 |
| 音视频分离 | 视频 `-an`；音频 `-vn -map a out.mp3` |
| 倒放 | `-vf reverse -af areverse` |
| 拼接 | `-f concat -safe 0 -i list.txt -c copy out.mp4` |
| 压制/转码 | `-c:v libx264 -crf 23 -preset fast -movflags +faststart -c:a aac` |
| 补帧（进阶） | `-vf "minterpolate=fps=60"`（CPU 重，路线图） |

### 6.4 可插拔视频/音频生成（外部 provider）
| 功能 | 实现 |
|---|---|
| 文生/图生视频 | UI `mulby.http` 提交任务(无 CORS、密钥不进浏览器)→轮询(带进度)→视频 URL→后端 `rpc.downloadMedia` 落盘→回填视频卡 |
| 需公网图 URL 的 provider | 后端 `rpc.uploadImageToHost`(multipart 传图床) |
| 配音音频文件 | 后端 `rpc.synthSpeech`(OpenAI 兼容 `/audio/speech`→base64 落盘)→音频卡 |
| 即时朗读预览 | `mulby.tts.speak` |
| BGM/SFX(可选) | 同 provider 抽象走 http |

> Provider 配置存 `storage`，**密钥存 `storage.encrypted`**；内置 fal.ai / OpenAI 兼容 / 自定义 HTTP 预设。

---

## 7. 总体架构

```
┌──────────────── 渲染进程 (React, Vite→ui/) ────────────────┐
│  App                                                        │
│   ├─ TopBar      工程名 / 多画布Tab / 全局模型 / 保存/导出   │
│   ├─ LeftDock    添加卡片(文本/图片/视频/音频/素材) + 工具    │
│   │              (选择/平移/连线/便签/手绘标注)               │
│   ├─ 【自研画布引擎】 CanvasStage                            │
│   │     ├─ GridLayer      网格背景(随 zoom)                  │
│   │     ├─ WorldLayer     div: transform: translate·scale   │
│   │     │     ├─ EdgeLayer(SVG)  贝塞尔连线 + 临时连线       │
│   │     │     └─ CardView × N     绝对定位卡片(世界坐标)      │
│   │     ├─ SelectionBox   框选橡皮筋                          │
│   │     ├─ Minimap        缩略导航 + 视口框                  │
│   │     ├─ CanvasControls 缩放%/适配/网格/小地图切换         │
│   │     └─ InteractionController  指针状态机(平移/框选/拖动/  │
│   │            连线/缩放) + viewport 数学 + history 撤销重做  │
│   ├─ Inspector   选中卡片：提示词/@引用/模型/参数+生成+工具箱 │
│   ├─ TaskCenter  生成/媒体任务队列、进度、取消、重试         │
│   └─ Services    aiText/aiImage→mulby.ai · mediaImage→sharp │
│                  mediaVideo→ffmpeg · providers→http(+rpc)    │
│                  references(@+连线) · persistence · assets   │
│   Stores(zustand): graphStore(cards/edges/viewport/selection)│
│        projectStore providerStore taskStore settingsStore ui │
└──────────────────────────────────────────────────────────────┘
            │ window.mulby.host.call('ai-creative-canvas', method, args)
            ▼
┌──────────────── 后端 host-worker (src/main.ts, 全局 mulby, export const rpc) ───────────┐
│ 生命周期 onLoad/onUnload/onEnable/onDisable/run(读 context.attachments 建素材卡 + 通知) │
│ rpc.downloadMedia / uploadImageToHost / synthSpeech / exportFile                         │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

> 生成请求/轮询放 **UI**（`mulby.http` 不受浏览器 CORS 限制、密钥不暴露）；后端只做**大二进制落盘 / multipart 上传 / TTS 二进制合成**（渲染进程不便、易截断），分工与 ai-film-studio 一致并已在其 `main.ts` 验证。

---

## 8. 自研画布引擎（核心设计，参考 AI-CanvasPro）

### 8.1 渲染技术（与 AI-CanvasPro 同路线）
- **世界层（WorldLayer）**：一个 `div`，`transform: translate(${vx}px,${vy}px) scale(${zoom}); transform-origin:0 0; will-change:transform`。**平移缩放只改这一处 transform，卡片不重排**。
- **卡片（CardView）**：世界层的绝对定位子元素，`left/top/width/height` 用**世界坐标**；卡片内容是 React 组件（标题栏 + 媒体预览 + 状态/进度 + 浮动工具条）。
- **连线（EdgeLayer）**：世界层内一张 SVG，贝塞尔 `M..C..` 连两卡锚点（世界坐标，随世界一起 transform）；`vector-effect="non-scaling-stroke"` 让线宽不随缩放变粗；含一条「正在连线」的临时路径。
- **网格（GridLayer）**：CSS 点阵背景，间距随 `zoom` 调整；可开关。
- **覆盖层**：框选橡皮筋、对齐参考线、连线落点高亮等画在屏幕坐标的 overlay 上。

### 8.2 视口数学（`canvas/viewport.ts`）
```ts
// 视口状态
type Viewport = { x: number; y: number; zoom: number }   // 世界→屏幕：screen = world*zoom + (x,y)
const screenToWorld = (sx:number, sy:number, v:Viewport) => ({ x:(sx-v.x)/v.zoom, y:(sy-v.y)/v.zoom })
const worldToScreen = (wx:number, wy:number, v:Viewport) => ({ x:wx*v.zoom+v.x, y:wy*v.zoom+v.y })
// 朝光标缩放：保持光标处世界点不动
function zoomAt(v:Viewport, sx:number, sy:number, factor:number, min=0.1, max=4): Viewport {
  const z = Math.min(max, Math.max(min, v.zoom*factor))
  const w = screenToWorld(sx, sy, v)
  return { zoom: z, x: sx - w.x*z, y: sy - w.y*z }
}
// 适配内容：根据所有卡片 bbox 计算居中缩放（fit-to-view）
```

### 8.3 交互状态机（`canvas/InteractionController`）
| 触发 | 行为 |
|---|---|
| 滚轮（默认） | `zoomAt`（朝光标缩放）；按 Shift 横向平移 |
| 空格拖拽 / 中键拖拽 / 空白拖拽 | 平移（改 viewport.x/y） |
| 卡片上拖拽 | 移动卡片（改 card.x/y；多选则整体移动）；拖动结束入 history |
| 空白处拖拽 | 框选橡皮筋 → 选中相交卡片 |
| 卡片连线手柄拖拽 / pick-connect | 临时连线 → 落到目标卡 → 建 edge（引用） |
| 点击卡片 / Shift 点击 | 选择 / 多选 |
| 双击空白 | 在该世界点弹「快速加卡片」菜单 |
| 拖拽文件/图片到画布 | 建对应素材卡（落盘） |
| Del / Ctrl+Z / Ctrl+Shift+Z / Ctrl+C·V / F(适配) / L(网格) / M(小地图) | 删除/撤销/重做/复制粘贴/快捷键 |

- 控制器是纯逻辑（class 或 hook），只读写 store；渲染层是 store 的纯函数映射。

### 8.4 数据模型（`graphStore`，zustand）
```ts
type CardKind = 'image'|'video'|'text'|'audio'|'source'
type CardStatus = 'idle'|'queued'|'running'|'done'|'error'
interface Card {
  id:string; kind:CardKind; x:number; y:number; w:number; h:number
  title:string; prompt:string
  modelId:string|null; providerId:string|null; params:Record<string,unknown>
  status:CardStatus; progress:number; error:string|null
  assetUrl:string|null; assetLocalPath:string|null; attachmentId:string|null   // 产物=引用，不存二进制
  text:string|null; refIds:string[]; meta:Record<string,unknown>
}
interface Edge { id:string; source:string; target:string; kind:'ref'|'flow'; refSlot?:string }
interface Board { id:string; name:string; cards:Record<string,Card>; edges:Record<string,Edge>; viewport:Viewport }
interface ProjectDoc { id:string; name:string; boards:Board[]; activeBoardId:string; globalModelId:string|null; createdAt:number; updatedAt:number }
```

### 8.5 引用机制（@ 引用 + 连线软引用）
1. **@ 引用（主）**：Inspector 提示词框 `@` 唤出卡片选择 → pill，写入 `refIds`。生成时：被引图片卡产物 → `ai.attachments.upload({buffer})` → `referenceAttachmentIds`；被引文本卡文本 → 拼进 messages。
2. **连线软引用（辅）**：从 A 卡拉连线到 B；生成 B 时把指向 B 的连线起点卡并入引用候选（Inspector 可取舍）。
3. **取数即解析（不分槽位）**：连线层不区分首帧/参考/mask，由卡片 kind+参数在生成时决定如何用被引产物。
4. **无自动级联**：被引卡更新不自动重跑下游（守住与 ai-film-studio 的区分），用「重生成此卡」按钮。

### 8.6 多画布、虚拟化、撤销重做、持久化
- **多画布**：`ProjectDoc.boards[]`，顶栏 Tab 切 `activeBoardId`；每画布各自 cards/edges/viewport。
- **虚拟化（性能）**：渲染时只渲染 bbox 与可视世界矩形相交的卡片（v1 简单裁剪；卡片多时再加空间索引/LOD —— 参考 AI-CanvasPro，列入路线图）。
- **撤销重做（`canvas/history.ts`）**：对当前 board 的 `{cards,edges}` 做不可变快照环（~100 步），mutation 时入栈（拖动用防抖合并）。
- **持久化（`services/persistence.ts`）**：监听 store 变更（防抖）→ 整个 `ProjectDoc`（不含二进制）写 `mulby.storage`；大媒体落 `filesystem`，卡片仅存 `file://`/attachmentId。

---

## 9. 关键流程时序

### 9.1 文生图 / 图生图（核心创作环）
```
新建「AI 图片」卡 → 填提示词、@引用、选模型(allModels image-generation)
 → 生成 → taskStore 入队(并发限流) → status=running
 → 解析 refIds：被引图片卡→fetch本地→ArrayBuffer→ai.attachments.upload({buffer})
 → 有主图? ai.images.edit({model,imageAttachmentId,referenceAttachmentIds,prompt})
    无主图? ai.images.generate({model,prompt,size,count})  (generateStream 拿进度/预览)
 → onChunk: status/preview 更新进度与占位
 → 完成: base64→filesystem(+缩略图 attachment)→更新卡(assetUrl,status=done)→通知
 → 该卡可被后续卡 @ 引用
```
### 9.2 图生视频（外部 provider）
```
「AI 视频」卡 @引用 一张图片卡，选 provider+model+时长
 → 需公网图URL? rpc.uploadImageToHost(base64)→URL
 → mulby.http.post(submit)→taskId → 轮询(get status, 回填进度)→videoUrl
 → rpc.downloadMedia(url)→本地mp4 → 更新视频卡(file://, done)→通知
```
### 9.3 媒体工具（「场景检测分镜」示例）
```
选视频卡→工具箱「场景检测」
 → ffmpeg.run(['-i',in,'-filter:v',"select='gt(scene,0.4)',showinfo",'-f','null','-'],onProg)
 → 解析 stderr pts_time 切点 → 逐段 ffmpeg.run(['-ss',a,'-to',b,'-i',in,'-c','copy',seg])
 → 批量在原卡下方建 video 卡（自动排布）→ 形成「分镜片段」卡组
```

---

## 10. 后端 RPC（src/main.ts）

> 沿用 ai-film-studio 已验证模式：后端用**全局 `mulby`**，导出 `export const rpc={...}`，前端 `window.mulby.host.call('ai-creative-canvas','method',args)`；返回 `{ok,...}|{ok:false,error}`。

```ts
export const rpc = {
  async downloadMedia(i:{ url:string; name?:string; subdir?:string }): Promise<...>,        // 远程媒体落盘(规避CORS, base64防截断)
  async uploadImageToHost(i:{ uploadUrl:string; apiKey?:string; base64:string; mime?:string; field?:string; urlPath?:string }): Promise<...>, // 本地帧→图床URL
  async synthSpeech(i:{ baseURL:string; apiKey:string; model:string; voice:string; input:string; speed?:number; format?:string }): Promise<...>, // OpenAI兼容TTS→文件
  async exportFile(i:{ filePath:string; data:string; encoding?:'utf-8'|'base64' }): Promise<...>,   // 导出
}
```
- 落盘根：`{userData}/ai-creative-canvas/`（与 ai-film-studio 隔离）；子目录 `media/<projectId>/`、`audio/`、`export/`；`ensureDir` = `filesystem.exists→mkdir`。

---

## 11. 数据模型与存储布局
**storage（KV，namespace 自动 `plugin:ai-creative-canvas`）**
- `projects:index` → `[{id,name,cover?,updatedAt}]`
- `project:<id>` → `ProjectDoc`（含 boards/cards/edges/viewport，**不含二进制**）
- `settings` → `{defaultImageModel,defaultTextModel,concurrency,autosaveMs,theme,grid,minimap}`
- `providers` → `[{id,label,kind,baseURL,submitPath,statusPath,fieldMap,...}]`（不含密钥）

**storage.encrypted**：`providerKey:<id>` → API Key
**storage.attachment（≤50MB）**：`thumb:<cardId>` → 缩略图
**filesystem（大媒体）**：`{userData}/ai-creative-canvas/media/<projectId>/<cardId>.{png|mp4|mp3...}`

---

## 12. Provider 抽象（可插拔视频/音频）
```ts
interface MediaProvider {
  id:string; label:string; kind:'video'|'audio'
  submit(req:GenRequest, http:MulbyHttp, keys:KeyStore): Promise<{ taskId?:string; result?:Asset }>
  poll?(taskId:string, http:MulbyHttp, keys:KeyStore): Promise<{ status:'running'|'done'|'error'; progress?:number; result?:Asset; error?:string }>
}
```
- 内置预设：`fal-video`(submit+poll)、`openai-tts`(走后端 synthSpeech)、`custom-http`(用户配 URL/字段映射)。
- 设置页管理：增删/测连/字段映射/密钥(写 encrypted)。加新 provider = 加一个实现，不动画布逻辑。

---

## 13. manifest.json 契约（完整草案）
```json
{
  "id": "ai-creative-canvas",
  "name": "ai-creative-canvas",
  "displayName": "AI 创意画布",
  "version": "0.1.0",
  "author": "mulby",
  "type": "ai",
  "description": "无限画布 AI 影像创作 + 媒体编辑工坊：自由画布上逐卡片生成图像/视频/文本/配音，内置裁剪·扩图·抠像·放大·宫格分镜·视频裁剪·抽帧·场景检测·倒放等媒体工具箱",
  "main": "dist/main.js",
  "ui": "ui/index.html",
  "icon": "icon.png",
  "permissions": { "clipboard": true, "notification": true },
  "pluginSetting": { "single": true },
  "window": { "type": "default", "width": 1440, "height": 960, "minWidth": 1120, "minHeight": 720 },
  "features": [
    {
      "code": "open-canvas",
      "explain": "打开 AI 创意画布（无限画布影像创作 + 媒体编辑）",
      "mode": "detached",
      "cmds": [
        { "type": "keyword", "value": "创意画布" },
        { "type": "keyword", "value": "无限画布" },
        { "type": "keyword", "value": "AI画布" },
        { "type": "img",   "label": "在创意画布中打开图片", "exts": [".png",".jpg",".jpeg",".webp"] },
        { "type": "files", "label": "在创意画布中打开媒体", "exts": [".png",".jpg",".jpeg",".webp",".mp4",".mov",".webm",".mp3",".wav"], "fileType": "file" }
      ]
    }
  ]
}
```
- **冲突核对**：`id/name/displayName/feature.code/触发词` 均与 ai-film-studio 不同；存储与落盘隔离。
- `img`/`files` 触发：拖媒体到 Mulby → `run(context)` 读 `context.attachments` 自动建素材卡（差异化便捷入口）。
- v1 不声明 `manifest.tools`（路线图可加 `create_image_card` 等对外工具）；不需要 `preload.cjs`（后端 RPC 足够）；不需要 `commandExecution/screen/camera`（ffmpeg/sharp 是宿主 API）。

---

## 14. 目录结构
```
mulby-plugins/plugins/ai-creative-canvas/
├─ manifest.json  package.json  tsconfig.json  vite.config.ts  postcss.config.js  tailwind.config.js
├─ icon.png  assets/icon.svg  README.md
├─ src/
│  ├─ main.ts                 # 后端：生命周期 + rpc
│  ├─ types/mulby.d.ts
│  └─ ui/
│     ├─ index.html  main.tsx  App.tsx  styles.css
│     ├─ canvas/               # ★ 自研画布引擎
│     │  ├─ CanvasStage.tsx        # 根：指针/滚轮/键盘 + 装配各层
│     │  ├─ WorldLayer.tsx         # transform 世界层
│     │  ├─ CardView.tsx           # 卡片渲染(按 kind 分流)
│     │  ├─ EdgeLayer.tsx          # SVG 连线 + 临时连线
│     │  ├─ GridLayer.tsx  SelectionBox.tsx  Minimap.tsx  CanvasControls.tsx
│     │  ├─ InteractionController.ts  # 指针状态机
│     │  ├─ viewport.ts            # 坐标变换/缩放/适配
│     │  └─ history.ts             # 撤销重做
│     ├─ components/  TopBar / LeftDock / Inspector / TaskCenter / MediaToolbox / ProviderSettings / ModelPicker / MentionField
│     ├─ services/   aiText.ts aiImage.ts mediaImage.ts mediaVideo.ts references.ts persistence.ts assets.ts providers/*
│     ├─ store/      graphStore.ts projectStore.ts providerStore.ts taskStore.ts settingsStore.ts uiStore.ts
│     └─ hooks/      useMulby.ts   # 沿用注入 pluginId 命名空间
```
- `package.json` scripts 同 ai-film-studio：`build`=`build:backend`(esbuild)+`build:ui`(vite)，`pack`=build+`mulby pack`。
- `vite.config.ts`：`root:'src/ui'`、`base:'./'`、`build.outDir:'../../ui'`（与仓库一致，保证 file:// 相对路径）。

---

## 15. 里程碑路线图（自研画布版）

| 里程碑 | 内容 | 验收 |
|---|---|---|
| **M0 画布引擎底座** | 脚手架(react)；WorldLayer transform 平移缩放(朝光标)、CardView 绝对定位、viewport 数学、graphStore；空白拖拽平移 + 滚轮缩放 + 适配(F) + 网格 | 能丝滑平移缩放，放几个测试卡片不重排、缩放线宽正常 |
| **M1 画布交互全集** | 框选/多选/拖动/删除/复制粘贴；连线(拖锚点+pick-connect)+EdgeLayer；撤销重做；多画布 Tab；持久化(storage)；小地图(基础) | 选/拖/连/撤销/多画布/刷新还原全可用 |
| **M2 素材卡 + 导入** | 拖拽/粘贴/`img`·`files` 触发导入 图/视频/音频/文本 → 卡片；媒体落盘；快速加卡片菜单 | 拖图进来成卡、重开仍在 |
| **M3 文本卡 + 引用系统** | `ai.call` 流式+vision+结构化；@ 引用 + 连线软引用；MentionField | 文本卡流式出分镜 JSON；@ 引用生效 |
| **M4 图片卡（核心环）** | `generate/generateStream/edit`+多参考；进度；并发队列；中止 | 文生图/图生图/多图一致性/进度/取消 work |
| **M5 图像工具箱** | 裁剪/扩图/放大/抠像/宫格切片(sharp+ai.images.edit) | 选图卡能裁剪生成新卡；宫格切多卡 |
| **M6 视频工具箱（差异中枢）** | ffmpeg 首装引导；裁剪/GIF/抽帧/场景检测/分离/倒放/拼接/压制 | 场景检测切出片段卡组；各工具产物正确 |
| **M7 视频/音频生成** | provider 抽象+预设(fal/openai-tts/custom)；加密密钥；submit/poll；后端 downloadMedia/synthSpeech/uploadImageToHost | 配好 key 图生视频落盘成卡；TTS 配音成音频卡 |
| **M8 收尾** | 任务中心/通知/设置/导出(画布或单卡为图片)/图标(svg→512png)/README/`mulby verify` 通过 | verify=ok；README 完整；品牌图标 |

> 相对 v1：画布从「集成 tldraw」变为「自建引擎」，故 M0/M1 拆成两段、工作量上移；但整体去掉了 tldraw 许可/资源两类风险。

---

## 16. 风险与缓解
| 风险 | 影响 | 缓解 |
|---|---|---|
| **自研画布工程量与手感** | M0/M1 是最大单块；平移缩放/框选/连线/撤销若不顺，体验差 | 复用 AI-CanvasPro 成熟路线(单 transform 世界层)；viewport/interaction/history 模块化、先做最小顺滑闭环再加料；指针事件统一用 Pointer Events；拖动用 rAF 节流 |
| 性能(卡片多/大媒体) | 卡顿 | 视口裁剪虚拟化；平移缩放期间媒体降级为缩略图(LOD)；大文件走 filesystem 非 KV |
| 无内置视频生成 / TTS 不产文件 | 视频/配音须外部服务 | provider 抽象 + 加密密钥；**核心功能不依赖它**(Mulby 原生即可创作+编辑) |
| 抠像/放大依赖图像模型可用性 | 未配图像模型则降级 | `allModels({endpointType:'image-generation'})` 探测；sharp 兜底；明确提示 |
| ffmpeg 首次需下载 | 首用视频工具卡顿 | `isAvailable→download(onProgress)` 引导式下载、进度可见 |
| 大媒体占用/截断 | 存储膨胀/损坏 | 大文件 filesystem；attachment 仅缩略图(≤50MB)；删工程清目录；base64 落盘防截断 |
| esbuild 后端打包 | — | 后端仅用全局 mulby+node 内置+fetch，无原生 npm 依赖 → 标准 `--bundle --platform=node`；**不**用 `--packages=external` |
| ~~tldraw 许可 / 离线资源~~ | — | **本版已移除（不再适用）** |

---

## 17. 验证与打包计划
1. `pnpm install`（如选方案 A 且需补依赖：`pnpm add react react-dom zustand nanoid lucide-react` 视本插件 package.json 而定；**不再安装 tldraw**）。
2. `npm run build`（esbuild 后端 + vite UI）。
3. `mulby verify` 亲自跑：加载、触发词命中、**画布平移缩放/框选/连线**、一次文生图 happy path、刷新持久化；逐项修到 `ok`。
4. 主题定稿后 `assets/icon.svg` → `scripts/finalize_plugin_icon.mjs` → 512×512 `icon.png`。
5. `npm run pack` 产出 `ai-creative-canvas-0.1.0.inplugin`。
6. 若 `mulby verify` 无法定位/启动 Mulby，则给手动验收清单并说明自动验证未运行。

---

## 18. 开工前状态
- ✅ **名称**：`ai-creative-canvas` /「AI 创意画布」（已确认）
- ✅ **v1 验收口径**：能在画布上 文生图/图生图 + 跑通 ≥3 个媒体工具(如裁剪/场景检测/转 GIF) + 配好 provider 后图生视频落盘（已确认）
- ✅ **画布**：完全自研，去 tldraw（已确认）
- ❓ **唯一待你拍板**：依赖策略 —— **方案 A（推荐：Lean React + 自研画布，保留少量 MIT 工具）** 还是 **方案 B（纯原生 JS 零依赖，AI-CanvasPro 同款）**？（见 §5.1）

> 你回复确认 A 或 B 后，即进入 **M0：画布引擎底座**（脚手架→世界层平移缩放→卡片渲染→viewport→`mulby verify` 跑通最小画布）。本版到此，**等你回复**。
```
