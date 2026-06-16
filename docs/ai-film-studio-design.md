# AI 影视工作流插件 — 详细设计方案

> 无限画布 · 故事到影片 · 多模态 AI 工作流

| 项 | 内容 |
|---|---|
| 文档版本 | v0.7（M0+M1+M2+M3+M4+M5 已落地） |
| 日期 | 2026-06-16 |
| 作者 | 资深全栈架构师 |
| 状态 | **M0 画布 + M1 文本 + M2 图像 + M3 视频 + M4 供应商增强 + M5 合成导出已完成**（故事→剧本→分镜→图→视频片段→配音/字幕→ffmpeg 合成成片→导出全链路打通），M6 打磨待开发 |
| 目标插件目录 | `mulby-plugins/plugins/ai-film-studio/` |

---

## 1. 背景与目标

### 1.1 问题陈述
用户希望在 Mulby 中拥有一个**无限画布**插件，把"一段话 / 一个故事"通过可视化的**节点工作流**逐步加工，最终产出**短片**：

```
故事 → 剧本 → 拍摄脚本（分镜） → 角色图（三视图）/场景图 → 关键帧 → 视频片段 → 配音/字幕/配乐 → 合成成片
```

其中文本、图像可复用 Mulby 内置 AI；**视频生成 Mulby 不提供，必须由插件自行接入**。用户可自定义大模型供应商与 API Key，甚至所有模型都由插件自管、不依赖 Mulby AI。

### 1.2 目标用户与场景
- 短视频 / 自媒体创作者：把脚本快速转成分镜与视频草样。
- 独立动画 / 漫画作者：角色设定（三视图）+ 场景图 + 关键帧 + 图生视频。
- 编剧 / 策划：故事 → 剧本 → 分镜的结构化创作。
- AI 创作爱好者：像 ComfyUI 一样自由编排多模态工作流。

### 1.3 设计原则
1. **零配置可用**：文本/图像默认复用 Mulby 已配置的 Provider/模型/Key，开箱即用。
2. **可自管可扩展**：任何模型都能换成用户自定义供应商（OpenAI 兼容端点 / fal / Replicate / 直连厂商）。
3. **节点即能力**：每个能力是一个画布节点，连线即数据流；非线性、可分支、可重跑、可锁定。
4. **复用现有资产**：画布直接沿用本仓库 `ai-flowchart` 的 React Flow 架构与 AI 流式封装。
5. **创作一致性**：把"画风 / 角色"做成全局节点注入下游，保证跨镜一致。
6. **渐进交付**：先打通主链路（文本→图像→视频），后期再做合成与后期。

### 1.4 调研结论摘要（关键约束）
| 维度 | 结论 | 依据 |
|---|---|---|
| 文本 AI | `window.mulby.ai.call(option, onChunk)` 流式，支持多模型/工具/视觉附件 | `apis/ai.md` |
| 图像 AI | `mulby.ai.images.generate / generateStream / edit`，返回 base64；用 `ai.allModels({endpointType:'image-generation'})` 过滤图像模型 | `apis/ai.md`、`mulby-ai-image` |
| 视频 AI | **Mulby 无视频 API**，需插件自管（HTTP 调第三方） | `apis/ai.md` 全文无 video |
| 画布 | `ai-flowchart` 已用 `@xyflow/react`(React Flow v12)+`@dagrejs/dagre`+`zustand` 实现节点画布 | `ai-flowchart/package.json` |
| 存储 | `storage`(KV/工程) + `storage.encrypted`(Keychain，存 Key) + `storage.attachment`(≤50MB 二进制) + `filesystem`(大文件) | `apis/storage.md` |
| AI 调用位置 | `ai-flowchart` 注释明确"AI 调用移至前端避免 IPC 超时" | `ai-flowchart/src/main.ts` |
| 视频 API 形态 | 业界统一**异步三段式**：submit→poll(≈2s)→fetch；图片以 base64 dataURL 传 `image_url`；fal.ai 一个 Key 聚合 Kling 3.0 / Veo 3.1 / Sora 2 / Seedance 2.0 等 | 联网调研（fal.ai 文档、社区实现） |

---

## 2. 产品概述

### 2.1 一句话定位
**"在无限画布上把故事一步步生成成片"** —— 面向"故事 → 影片"的节点式多模态 AI 创作工作站。

### 2.2 核心创作流水线（DAG）

```mermaid
flowchart LR
  A[故事/灵感<br/>StoryInput] --> B[故事梳理<br/>世界观·主题·节奏]
  B --> C[剧本生成<br/>场次·对白·动作]
  C --> D[分镜脚本<br/>镜头·景别·运镜·时长]
  D --> E1[角色设定<br/>三视图/参考图]
  D --> E2[场景设定<br/>场景概念图]
  E1 --> F[关键帧<br/>每镜首/尾帧]
  E2 --> F
  D --> F
  F --> G[视频片段<br/>图生视频/文生视频]
  G --> H[配音TTS·字幕·配乐]
  H --> I[时间线合成<br/>Timeline]
  I --> J[成片导出<br/>逐片段 / ffmpeg 拼接]
  GLB[全局设定<br/>画风·画幅·角色库] -.注入.-> C & D & E1 & E2 & F & G
```

每个方框 = 一个/一组画布节点；箭头 = 端口数据流（文本 / JSON / 图片 / 视频 / 音频）。全局设定节点把画风与角色一致性注入下游所有生成节点。

### 2.3 关键差异化
- 不是"对话框生成器"，而是**可视化、可回溯、可分支**的工作流。
- 深度整合 Mulby 宿主 AI（文本/图像零配置），又能完全自管（视频/自定义供应商）。
- 把"角色一致性 / 风格统一"做成一等公民（全局节点 + 参考图 + seed 注入）。

---

## 3. 总体架构

### 3.1 分层架构

```mermaid
flowchart TB
  subgraph UI[UI 层（renderer / 前端）]
    Canvas[无限画布 FlowCanvas（React Flow）]
    NodesUI[节点组件 nodes/*]
    Panels[属性面板 / 节点库 / 设置 / 资产库 / 时间线]
    Store[(zustand store: graph + ui + run)]
  end
  subgraph Engine[工作流执行引擎（前端）]
    Scheduler[DAG 调度 / 拓扑执行]
    Runner[节点执行器 + 状态机]
    Queue[并发/限流队列]
    Cache[缓存/幂等]
  end
  subgraph AIL[AI 接入抽象层]
    TextE[TextEngine]
    ImageE[ImageEngine]
    VideoE[VideoEngine]
    TTSE[TTSEngine]
    Registry[供应商注册表 ProviderRegistry]
  end
  subgraph Host[Mulby 宿主能力]
    MAi[mulby.ai.call / images]
    MStore[storage / encrypted / attachment]
    MHttp[mulby.http]
    MFs[filesystem]
    MTts[tts]
  end
  subgraph Back[插件后端 main.ts（host-worker）]
    RPC[rpc: 工程存储 / 文件落盘 / 视频长任务轮询]
    Sched2[scheduler 定时轮询 + notification]
  end

  Canvas --> Store
  Panels --> Store
  Store --> Scheduler
  Scheduler --> Runner --> Queue
  Runner --> AIL
  TextE --> MAi
  ImageE --> MAi
  VideoE --> MHttp
  TTSE --> MTts
  Registry --> TextE & ImageE & VideoE & TTSE
  Runner --> MStore
  VideoE -. 长任务 .-> RPC
  RPC --> MHttp & MFs
  Sched2 --> RPC
```

### 3.2 进程划分（前端 vs 后端）
| 职责 | 位置 | 理由 |
|---|---|---|
| 画布 / 节点 / 交互 / 状态 | 前端 renderer | UI 密集 |
| AI 文本、图像调用 | **前端** | 沿用 `ai-flowchart`：放前端避免 IPC 超时；可流式更新 UI |
| 视频"提交+轮询" | **后端优先**（前端可兜底） | 视频任务长（数十秒~数分钟），后端轮询 + scheduler，避免窗口关闭丢任务 |
| 工程结构 / Key / 媒体落盘 | 后端 + 前端混合 | 结构小走前端 storage；大文件（视频）走后端 filesystem |
| 通知 / 任务恢复 | 后端 | 长任务完成通知、重启恢复 |

### 3.3 数据流
1. 用户在画布编排节点与连线 → 写入 `store.graph`。
2. 点击"运行/运行选中" → 引擎对子图做拓扑排序。
3. 逐节点执行：读取上游端口产物 → 调对应 Engine → 写回本节点 outputs → 通知 UI。
4. 文本：流式 onChunk 实时渲染；图像：generateStream 出预览；视频：提交后转后端轮询，进度回推 UI。
5. 产物落盘：结构→storage，图→attachment，视频→filesystem(userData)。

---

## 4. 技术选型

### 4.1 依赖清单
| 库 | 版本（参考 ai-flowchart） | 用途 |
|---|---|---|
| react / react-dom | ^18.3 | UI |
| @xyflow/react | ^12.x | 无限画布 / 节点 / 连线 / 缩放平移 |
| @dagrejs/dagre | ^2.x | 可选自动布局（一键整理分镜流） |
| zustand | ^5.x | 全局状态（graph / run / ui） |
| nanoid | ^5.x | 节点/边/资产 ID |
| lucide-react | ^0.5x | 图标 |
| html-to-image | ^1.x | 画布/节点快照导出 |
| tailwindcss + postcss + autoprefixer | 与现有一致 | 样式 |
| esbuild + vite + typescript | 与现有一致 | 后端打包 + 前端构建 |

> 视频/图像第三方调用走 `mulby.http` 或浏览器 `fetch`，**不引入** provider SDK（保持轻量、避免打包原生依赖问题）。ffmpeg 合成走 `mulby.ffmpeg`（宿主能力），不打包二进制。

### 4.2 与现有插件一致性
脚手架、构建脚本、目录结构、`useMulby` hook、AI 流式封装均对齐 `ai-flowchart` / `mulby-ai-image`，降低维护成本与评审成本。

---

## 5. 画布与节点体系

### 5.1 节点通用模型
```ts
// 端口类型系统
type PortType = 'text' | 'json' | 'image' | 'video' | 'audio' | 'any';

interface Port {
  id: string;
  name: string;          // 显示名
  type: PortType;
  multiple?: boolean;    // 是否允许多连入（如合并节点）
}

// 节点产物（运行后写回）
interface PortValue {
  type: PortType;
  // 文本/json
  text?: string;
  json?: unknown;
  // 媒体：用资产引用，避免在 graph 里塞大 base64
  assetId?: string;      // 指向 storage.attachment / filesystem 的资产
  url?: string;          // 临时可访问 URL（blob: / file:）
  meta?: Record<string, unknown>; // 宽高、时长、seed、模型、耗时、token、费用估算
}

type NodeRunStatus = 'idle' | 'queued' | 'running' | 'done' | 'error' | 'cancelled';

interface FilmNode {
  id: string;
  type: NodeKind;                 // 见 5.3
  position: { x: number; y: number };
  data: {
    title?: string;
    params: Record<string, unknown>;     // 节点参数（模型/尺寸/数量/温度/时长…）
    providerOverride?: ProviderSelector;  // 覆盖默认供应商/模型（见 §6）
    inputsSpec: Port[];
    outputsSpec: Port[];
    outputs?: Record<string, PortValue>;  // 运行产物（按 port.id）
    status: NodeRunStatus;
    progress?: number;            // 0-100
    error?: string;
    locked?: boolean;             // 锁定：不参与重算
    inputHash?: string;           // 幂等缓存键
  };
}

interface FilmEdge {
  id: string;
  source: string; sourceHandle: string;  // 源节点 + 源端口
  target: string; targetHandle: string;  // 目标节点 + 目标端口
}
```

连线校验规则：`sourcePort.type` 与 `targetPort.type` 相同，或任一端为 `any`。

### 5.2 节点分类总览
| 分类 | 作用 | 调用能力 |
|---|---|---|
| 输入节点 | 提供原始素材 | 无 / 文件读取 |
| 文本 AI 节点 | 文字加工与结构化 | `ai.call`（默认 Mulby） |
| 图像 AI 节点 | 生成/编辑图片 | `ai.images`（默认 Mulby） |
| 视频 AI 节点 | 生成视频 | 自管 VideoProvider（HTTP） |
| 音频/后期节点 | 配音/字幕/配乐 | `tts` / 自管 |
| 控制节点 | 批量/合并/变量/条件 | 引擎内置 |
| 输出节点 | 预览/时间线/导出 | `ffmpeg` / `filesystem` |

### 5.3 节点目录（详表）

**输入类**
| 节点 | 输入 | 输出 | 关键参数 |
|---|---|---|---|
| 故事输入 StoryInput | — | text | 多行文本 |
| 文本片段 TextNode | — | text | 文本 |
| 参考图 ImageInput | — | image | 上传/拖拽（buffer→attachment） |
| 全局设定 GlobalStyle | — | json | 画风、画幅(16:9/9:16/1:1)、色调、风格 Token、角色库引用 |

**文本 AI 类**（统一：`ai.call` 流式 + 角色化 System Prompt + 结构化 JSON 输出，复用 `ai-flowchart` 的"自然语言 + \`\`\`json\`\`\`"解析法）
| 节点 | 输入 | 输出 | 说明 |
|---|---|---|---|
| 故事梳理 StoryDev | text(+globals) | json{logline,theme,tone,beats} | 世界观/主题/节奏梳理 |
| 剧本生成 ScriptGen | json/text | json{scenes:[{slug,desc,dialogues,actions}]} | 分场剧本 |
| 分镜脚本 Storyboard | json(script) | json{shots:[{id,scene,desc,shotSize,camera,duration,chars,location}]} | 镜头表（核心） |
| 角色设定 CharSheet | json/text | json{characters:[{name,desc,appearance,refPromptTriple}]} | 生成角色描述 + 三视图提示词 |
| 提示词扩写/翻译 PromptFx | text | text | 扩写/中英互译/风格化 |

**图像 AI 类**（`ai.images`；模型来自 `allModels({endpointType:'image-generation'})`）
| 节点 | 输入 | 输出 | 说明 |
|---|---|---|---|
| 角色三视图 CharImage | json(char)+globals | image×3 | 前/侧/背三视图，统一画风+seed |
| 场景概念图 SceneImage | json/text+globals | image | 场景设定图 |
| 分镜关键帧 Keyframe | json(shot)+refs(角色图/场景图) | image | 单镜首帧（可再出尾帧） |
| 图生图/重绘 ImageEdit | image+text | image | `images.edit` 局部重绘/风格迁移 |

**视频 AI 类**（自管 VideoProvider）
| 节点 | 输入 | 输出 | 说明 |
|---|---|---|---|
| 图生视频 I2V | image(首帧)[+image尾帧]+text | video | 主力：关键帧→动起来 |
| 文生视频 T2V | text(+globals) | video | 纯文本生成片段 |
| 视频续写 VideoExtend | video+text | video | 片段延长（供应商支持时） |

**音频 / 后期类**（分期）
| 节点 | 输入 | 输出 | 说明 |
|---|---|---|---|
| 配音 TTS | text | audio | `mulby.tts`；按对白/旁白 |
| 字幕 Subtitle | text/json | json(srt) | 由剧本/对白生成时间轴字幕 |
| 配乐 BGM | text | audio | 自管音乐生成 API（可选） |

**控制类**
| 节点 | 作用 |
|---|---|
| 批量 ForEach | 对数组（如每个分镜）逐项跑下游子图 |
| 合并 Merge | 多输入聚合为列表（如多片段→时间线） |
| 变量 Variable | 复用值（如风格 Token、角色名） |
| 条件 Switch | 简单分支（可后置） |

**输出类**
| 节点 | 作用 |
|---|---|
| 预览 Preview | 文本/图/视频/音频内联预览 |
| 时间线 Timeline | 按顺序排列片段+音轨+字幕，预览整片 |
| 导出 Export | 逐片段下载，或 `ffmpeg` 拼接 + 混音 + 烧字幕 → 成片 |

---

## 6. AI 接入抽象层（核心）

目标：**文本/图像默认零配置（走 Mulby），视频必须自管，全部都可被用户自定义供应商覆盖**。

### 6.1 两层模型：引擎（能力） + 供应商（实例）
```ts
type Capability = 'text' | 'image' | 'video' | 'tts';
type ProviderKind =
  | 'mulby'          // 复用宿主 AI（仅 text/image）
  | 'openai-compat'  // 自定义 OpenAI 兼容端点（text/image）
  | 'fal'            // fal.ai 聚合（image/video）
  | 'replicate'      // replicate（image/video）
  | 'kling' | 'runway' | 'minimax' | 'vidu'  // 直连厂商（video）
  | 'custom-http';   // 完全自定义 HTTP 模板

interface ProviderConfig {
  id: string;                 // 实例 ID（nanoid）
  kind: ProviderKind;
  label: string;              // 显示名
  baseURL?: string;
  apiKeyRef?: string;         // 指向 storage.encrypted 的键名（不在结构里存明文）
  headers?: Record<string, string>;
  capabilities: Capability[];
  models: ProviderModel[];    // 该供应商可用模型
  enabled: boolean;
}

interface ProviderModel {
  id: string;                 // 调用用的模型标识
  label: string;
  capability: Capability;
  // 视频专用元信息
  videoMeta?: { maxDuration?: number; sizes?: string[]; supportImage?: boolean; supportLastFrame?: boolean };
}

interface ProviderSelector { providerId: string; modelId: string; }
```

### 6.2 引擎接口
```ts
interface TextEngine {
  call(req: {
    messages: AiMessage[];
    model?: string;
    onChunk?: (c: AiChunk) => void;
  }, sel?: ProviderSelector): Promise<{ content: string; usage?: TokenUsage }>;
}

interface ImageEngine {
  generate(req: { prompt: string; size?: string; count?: number; refImageAssetId?: string },
           sel?: ProviderSelector): Promise<{ images: AssetRef[]; tokens?: TokenUsage }>;
  edit(req: { imageAssetId: string; prompt: string }, sel?: ProviderSelector): Promise<{ images: AssetRef[] }>;
  listModels(): Promise<ProviderModel[]>;
}

interface VideoEngine {
  generate(req: VideoGenRequest, sel: ProviderSelector,
           onProgress?: (p: { status: string; progress: number }) => void): Promise<{ video: AssetRef }>;
}

interface VideoGenRequest {
  mode: 'text-to-video' | 'image-to-video';
  prompt?: string;
  firstFrameAssetId?: string;
  lastFrameAssetId?: string;
  duration?: number;
  size?: string;       // 如 1280x720 / 9:16
  seed?: number;
}
```

### 6.3 默认实现（Mulby 引擎，零配置）
- `MulbyTextEngine` → `window.mulby.ai.call(option, onChunk)`，`model` 取自 `ai.allModels()`。
- `MulbyImageEngine` → `window.mulby.ai.images.generate / edit`，模型取自 `ai.allModels({endpointType:'image-generation'})`。
- 用户不配置任何供应商即可使用文本/图像节点（复用其在 Mulby 设置里的 Provider 与 Key）。

### 6.4 视频供应商适配器（统一异步三段式）
```ts
interface VideoProviderAdapter {
  kind: ProviderKind;
  submit(req: VideoGenRequest, cfg: ProviderConfig, apiKey: string): Promise<{ taskId: string }>;
  poll(taskId: string, cfg: ProviderConfig, apiKey: string):
    Promise<{ status: 'queued'|'running'|'completed'|'failed'; progress?: number; videoUrl?: string; error?: string }>;
  fetchResult(taskId: string, cfg: ProviderConfig, apiKey: string): Promise<{ url?: string; base64?: string }>;
}
```
执行约定：`submit` → 每 ~2s `poll`（指数退避上限，超时默认 300s 可配）→ `completed` 后 `fetchResult` → 下载落盘为资产。图片入参以 **base64 dataURL** 放入 `image_url` 字段。

**内置适配器（建议优先级）**
| kind | 覆盖模型 | 形态 | 备注 |
|---|---|---|---|
| `fal` | Kling 3.0 / Veo 3.1 / Sora 2 / Seedance 2.0 / LTX 等 | 队列 submit/status/result | **首选**：一个 Key 覆盖最广 |
| `replicate` | 多家开源/商用 | predictions 轮询 | 备选聚合 |
| `kling` | 可灵 | 直连 | 国内直连 |
| `minimax` | 海螺 | 直连 | 国内直连 |
| `runway` | Gen 系列 | 直连 | 海外 |
| `vidu` | Vidu | 直连 | 国内 |
| `custom-http` | 任意 | 用户填 submit/poll/fetch 的 URL 模板与 JSON 路径 | 兜底，保证可扩展 |

> MVP 仅实现 `fal` + `custom-http`；其余按需增量。

### 6.5 Key 管理与安全
- API Key 一律存 `storage.encrypted`（Keychain/DPAPI 加密），结构里只存 `apiKeyRef` 键名，不落明文。
- 设置面板集中管理供应商：增删、填 baseURL/Key、拉取/手填模型列表、连通性自测（发一个最小任务）。
- 节点级可 `providerOverride` 覆盖默认供应商/模型；未覆盖则用该能力的"默认供应商"。

---

## 7. 工作流执行引擎

### 7.1 图执行
- 触发：运行全部 / 运行选中节点（含其上游依赖）/ 运行单节点。
- 拓扑排序（Kahn）得到执行序；检测环并报错。
- 仅执行"脏"节点：输入哈希 `inputHash` 变化或未缓存才跑；`locked` 节点跳过。

### 7.2 节点状态机
```
idle → queued → running → done
                     ↘ error
running → cancelled（用户中止）
done/error/cancelled → queued（重跑/上游变更）
```
UI 以节点描边颜色 + 进度条 + 角标呈现状态。

### 7.3 流式 / 异步 / 轮询统一
| 能力 | 进度来源 |
|---|---|
| 文本 | `ai.call` 的 `onChunk('text'/'reasoning')` 累积 |
| 图像 | `images.generateStream` 的 `status/preview` chunk |
| 视频 | 后端轮询任务进度回推前端（IPC/事件） |

### 7.4 并发、限流、队列
- 全局与"按供应商"并发上限（默认：文本 4、图像 2、视频 1~2），可在设置调整。
- 任务进入队列，受限流令牌控制，避免触发供应商 429。

### 7.5 缓存 / 幂等 / 锁定
- `inputHash = hash(nodeType + params + provider + 上游产物指纹)`；命中则复用上次产物（省钱）。
- 节点可"锁定"：满意的镜头锁住，重跑整图不会覆盖。

### 7.6 错误处理与重试
- 分类：参数错误（不可重试，提示用户）/ 限流·网络（指数退避自动重试 N 次）/ 余额·鉴权（提示去设置）。
- 视频超时：保留 taskId，支持"恢复轮询"。

### 7.7 一致性策略（创作质量关键）
- **全局设定节点**输出风格 Token / 画幅 / 调色，注入所有生成节点的 prompt 前缀。
- **角色库**：每个角色绑定参考图(assetId) + 描述 + 固定 seed；下游关键帧/视频通过参考图 + 描述保持同一角色形象。
- 视频 I2V 用"首帧/尾帧"控制镜头起止，跨镜衔接更稳。

---

## 8. 数据模型与持久化

### 8.1 工程模型
```ts
interface FilmProject {
  id: string;
  name: string;
  graph: { nodes: FilmNode[]; edges: FilmEdge[] };
  viewport: { x: number; y: number; zoom: number };
  globals: {
    aspectRatio: '16:9' | '9:16' | '1:1' | string;
    style?: string;            // 全局画风
    characters: CharacterRef[]; // 角色库
    defaults: Partial<Record<Capability, ProviderSelector>>; // 各能力默认供应商
  };
  createdAt: number;
  updatedAt: number;
}

interface CharacterRef { id: string; name: string; desc: string; refAssetId?: string; seed?: number; }
interface AssetRef { id: string; kind: 'image'|'video'|'audio'; mime: string; size?: number; storage: 'attachment'|'file'; path?: string; }
```

### 8.2 存储映射
| 数据 | 介质 | API |
|---|---|---|
| 工程结构（graph/globals） | KV | `storage.set('projects', {...})` |
| 供应商配置（无明文 Key） | KV | `storage.set('providers', [...])` |
| API Key | 加密 KV | `storage.encrypted.set(ref, key)` |
| 生成图片（≤50MB） | 附件 | `storage.attachment.put(id, buf, mime)` |
| 生成视频（大文件） | 文件系统 | 后端 `filesystem.writeFile(userData/ai-film-studio/<proj>/<asset>.mp4)` |

### 8.3 自动保存 / 快照 / 导入导出
- 防抖自动保存（节点/边/参数变更后 1s）。
- 手动快照（命名版本）。
- 工程 JSON 导入导出（媒体可选打包）。

---

## 9. Prompt 工程

### 9.1 文本节点
每个文本节点一套角色化 System Prompt + 严格 JSON 输出契约（沿用 `ai-flowchart`：自然语言说明 + \`\`\`json\`\`\` 代码块，前端正则解析）。
- **分镜脚本**关键字段：`shotSize`(远/全/中/近/特)、`camera`(推/拉/摇/移/固定)、`duration`(秒)、`chars`(出场角色)、`location`(场景)、`mood`、`prompt`(给图像/视频用的英文提示词)。
- 强约束：每镜必须可独立生成图像与视频（自带完整画面描述）。

### 9.2 图像 prompt 组装
`最终 prompt = 全局风格 + 角色描述/参考 + 镜头画面描述 + 画幅/质量后缀`；角色一致性靠参考图（`images.edit` 或带 ref 的 generate）+ 固定 seed。

### 9.3 视频 prompt
`运镜描述 + 画面变化 + 时长 + 首/尾帧`；I2V 以关键帧为首帧，prompt 只描述"如何运动/变化"。

---

## 10. 插件契约（manifest 与结构）

### 10.1 manifest.json（草案）
```json
{
  "id": "ai-film-studio",
  "name": "ai-film-studio",
  "displayName": "AI 影视工坊",
  "version": "0.1.0",
  "author": "mulby",
  "type": "ai",
  "description": "无限画布 AI 影视工作流：故事→剧本→分镜→角色/场景图→关键帧→视频→成片",
  "main": "dist/main.js",
  "ui": "ui/index.html",
  "icon": "icon.png",
  "permissions": { "clipboard": true, "notification": true },
  "pluginSetting": { "single": true },
  "window": { "type": "default", "width": 1400, "height": 900, "minWidth": 1100, "minHeight": 720 },
  "features": [
    { "code": "open", "explain": "打开 AI 影视工作流画布",
      "mode": "detached",
      "cmds": [ {"type":"keyword","value":"故事画布"}, {"type":"keyword","value":"AI视频"}, {"type":"keyword","value":"分镜"} ] }
  ]
}
```

### 10.2 后端 main.ts 职责（rpc）
| 方法 | 作用 |
|---|---|
| `saveProject / listProjects / deleteProject` | 工程结构存取（沿用 ai-flowchart） |
| `saveProviders / listProviders` | 供应商配置存取（Key 用 encrypted） |
| `videoSubmit / videoPoll / videoCancel` | 视频任务后端代理（HTTP + 轮询，规避窗口关闭与 CORS） |
| `saveVideoAsset` | 下载视频流落盘到 userData |
| `exportFile` / `ffmpegConcat` | 导出 / 片段拼接合成 |

> AI 文本/图像调用放前端（避免 IPC 超时、便于流式）。视频因长任务 + 可能的跨域，走后端。

### 10.3 前端文件树
```
src/
  main.ts                     # 后端：存储/视频代理/落盘/导出
  types/mulby.d.ts
  ui/
    index.html  main.tsx  App.tsx  styles.css
    store/         # zustand: graphStore / runStore / providerStore
    components/
      FlowCanvas.tsx
      nodes/       # 各类节点组件
      panels/      # NodeLibrary / Inspector / Settings / AssetLibrary / Timeline
      edges/
    services/
      engines/     # textEngine / imageEngine / videoEngine
      providers/   # falAdapter / customHttpAdapter / registry
      prompts/     # 各文本节点 system prompt
      executor/    # dag scheduler / runner / queue / cache
    hooks/         # useMulby / useModels / useRunner
```

---

## 11. UI / UX 设计要点
- 布局：顶栏（运行/保存/导出/缩放/项目切换）+ 左侧节点库（拖拽添加）+ 中央画布 + 右侧属性面板（选中节点参数/供应商覆盖）+ 底部时间线/资产抽屉。
- 交互：拖拽连线带类型校验高亮；节点上"运行/重跑/锁定/预览"快捷键；批量运行带整体进度。
- 预览：图片缩略图 + 灯箱；视频内联播放器；文本/JSON 折叠展示。
- 主题：暗色优先（创作向），对齐 Mulby 主题变量。

---

## 12. MVP 分期与任务拆解

| 里程碑 | 交付物 | 关键任务 | 验收 |
|---|---|---|---|
| **M0 脚手架** ✅ | 可加载的空画布插件 | CLI create(react) + manifest + React Flow 画布 + 节点拖拽/连线/保存/缩放 | 在 Mulby 打开，能加增删节点并保存工程 |
| **M1 文本链路** ✅ | 故事→剧本→分镜 | StoryInput/ScriptGen/Storyboard 节点 + textEngine(ai.call 流式) + JSON 解析 | 输入一句话产出结构化分镜表 |
| **M2 图像链路** ✅ | 角色/场景/关键帧 | CharImage/SceneImage/Keyframe + imageEngine(ai.images) + 资产库(storage 命名空间) | 由分镜批量出关键帧图 |
| **M3 视频链路** ✅ | 关键帧→视频 | I2V/T2V 节点 + videoEngine + falAdapter/customHttp + 前端 submit/poll + 远程 URL 预览 | 选一镜关键帧生成视频片段并预览 |
| **M4 供应商管理** ✅ | 多供应商可配 | 设置面板增强 + 节点级 override + 连通性自测 + 视频落盘 filesystem + 图像 img2img(ai.images.edit) | 用户自定义供应商并跑通；节点覆盖/自测/落盘/img2img 可用 |
| **M5 合成导出** | 成片 | Timeline + ffmpegConcat + 字幕/配音(TTS) + 一致性增强(角色库/seed) | 多片段拼成一条带字幕的成片 |
| **M6 打磨** | 可发布 | 工作流模板、批量 ForEach、错误体验、图标(assets/icon.svg→icon.png)、README、`mulby pack` | 通过 skill handoff checklist，产出 .inplugin |

> 主链路 = M0→M3（故事→剧本→分镜→图→图生视频），建议优先打通。

---

## 13. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 视频 API 碎片化、字段不统一 | 适配成本高 | 统一 submit/poll/fetch 适配器 + `custom-http` 模板；先用 fal.ai 聚合覆盖主流 |
| 长任务 / 窗口关闭丢任务 | 体验差、产物丢失 | 后端轮询 + scheduler + 通知 + taskId 持久化可恢复 |
| 附件 50MB 上限放不下视频 | 存储失败 | 视频走 filesystem 落 userData，仅图走 attachment |
| 费用 / 限流 | 烧钱、429 | 并发上限 + 缓存幂等 + 费用估算 + 用户自带 Key |
| 角色跨镜不一致 | 成片质量 | 角色库参考图 + 固定 seed + 全局风格注入 + I2V 首尾帧 |
| 跨域(CORS)调用第三方 | 前端调用失败 | 视频/自定义 HTTP 走后端 `mulby.http` 代理 |
| esbuild 打包原生依赖 | 构建失败 | 不引入 provider SDK；必要时 `--external:pkg` |
| 文生视频 JSON/响应解析脆弱 | 运行报错 | 适配器内做容错 + 路径可配（custom-http 的 JSON path 映射） |

---

## 14. 验收清单（对齐插件开发规范）
- [ ] `manifest.json` 必填字段齐全，`features[].code` 均有处理逻辑。
- [ ] `main` / `ui` 路径指向真实文件；前端构建产出 `dist/main.js` 与 `ui/index.html`，`file://` 下资源可用（`base: './'`）。
- [ ] 文本/图像默认走 Mulby AI，可零配置使用。
- [ ] 至少一个视频供应商（fal）跑通 submit→poll→fetch→落盘→预览。
- [ ] API Key 走 `storage.encrypted`，结构无明文。
- [ ] 工程可保存/读取/导入导出；图存 attachment、视频存 filesystem。
- [ ] `npm run build` 成功；需要时 `npm run pack` 产出 `.inplugin`。
- [ ] `assets/icon.svg` → 512×512 `icon.png`（功能与主题稳定后再定稿）。
- [ ] `README.md` 含功能、用法、供应商配置说明。
- [ ] 提供 Mulby 内手动验收清单。

---

## 15. 附录

### 15.1 视频供应商对照（2026，调研）
| 供应商 | 接入方式 | 覆盖模型 | 模式 | 推荐场景 |
|---|---|---|---|---|
| fal.ai | 聚合 / 队列 API | Kling 3.0、Veo 3.1、Sora 2、Seedance 2.0、LTX… | T2V / I2V / V2V | 首选，一个 Key 覆盖最广 |
| Replicate | 聚合 / predictions | 多家开源+商用 | T2V / I2V | 备选聚合 |
| 可灵 Kling | 直连 | 可灵 | T2V / I2V | 国内、效果好 |
| MiniMax 海螺 | 直连 | Hailuo | T2V / I2V | 国内 |
| Runway | 直连 | Gen 系列 | T2V / I2V | 海外、运镜强 |
| Vidu | 直连 | Vidu | T2V / I2V / 参考生视频 | 国内、角色一致 |
| OpenAI Sora | 直连/经 fal | Sora 2 / Pro | T2V / I2V | 高质量、带音频 |

### 15.2 关键调用样例
```ts
// 文本（前端，流式）
const req = window.mulby.ai.call(
  { model, messages: [{role:'system',content: STORYBOARD_PROMPT},{role:'user',content: script}] },
  (chunk) => { if (chunk.chunkType==='text') append(chunk.content); }
);
const final = await req;

// 图像（前端）
const { images } = await window.mulby.ai.images.generate({ model, prompt, size:'1024x1024', count:1 });

// 视频（后端 main.ts，fal 适配器三段式）
const { taskId } = await falSubmit(req, cfg, key);   // POST baseURL/model
let r; do { await sleep(2000); r = await falPoll(taskId, cfg, key); } while (r.status!=='completed' && r.status!=='failed');
const out = await falFetch(taskId, cfg, key);        // { url }
await filesystem.writeFile(localPath, await download(out.url), 'base64');
```

### 15.3 参考
- 本仓库：`plugins/ai-flowchart`（画布/AI 流式封装）、`plugins/mulby-ai-image`（图像生成）、`plugins/mulby-ai-chat`（流式对话）。
- Mulby API：`apis/ai.md`、`apis/storage.md`、`apis/http.md`、`apis/manifest.md`。
- 视频：fal.ai Model APIs（队列 submit/poll/fetch）、社区 FalVideoProvider 实现（三段式 + base64 image_url）。

---

## 16. 实现进度日志（Changelog）

### M0 — 脚手架 + 可用画布 ✅（2026-06-16）

**目标**：交付一个可在 Mulby 加载的插件，画布能拖拽/连线/缩放/平移，能增删节点、编辑参数、保存/切换工程。

#### 16.1 已交付内容
| 模块 | 文件 | 说明 |
|---|---|---|
| 插件配置 | `manifest.json` / `package.json` / `vite.config.ts` / `tsconfig.json` / `tailwind.config.js` / `postcss.config.js` | type=ai、detached 1400×900、single；构建脚本对齐 `ai-flowchart` |
| 后端入口 | `src/main.ts` | 生命周期 + 启动通知；预留 `rpc.exportToFile`（M5 用） |
| 类型 | `src/types/mulby.d.ts` | 与宿主一致的完整 Mulby API 类型 |
| 节点定义 | `src/ui/nodes/nodeDefs.ts` | 端口类型系统 + 5 大类 15 个节点定义（输入/文本/图像/视频/输出），含图标/端口/参数表单元数据 |
| 状态管理 | `src/ui/store/graphStore.ts` | zustand：nodes/edges + React Flow 回调 + **连线类型校验** + 工程 CRUD + **防抖自动保存**（storage 命名空间持久化） |
| 画布 | `src/ui/components/FlowCanvas.tsx` | React Flow 封装：拖拽落点 `screenToFlowPosition`、连线校验、选中、Background/Controls/MiniMap |
| 节点组件 | `src/ui/components/nodes/FilmNode.tsx` | 按分类着色的头部 + 多端口 Handle/标签 + 状态点 + 内容摘要 |
| 节点库 | `src/ui/components/NodeLibrary.tsx` | 左栏分类列表，拖拽或点击添加 |
| 属性面板 | `src/ui/components/Inspector.tsx` | 右栏：编辑标题/参数（text/textarea/number/select）、查看端口、删除节点 |
| 工具栏 | `src/ui/components/Toolbar.tsx` | 工程切换/重命名/新建/保存/导入导出 JSON/适应画布/删除工程；运行按钮占位（M1 起开放） |
| 布局 | `src/ui/App.tsx` / `styles.css` | 三栏布局 + 主题跟随宿主（CSS 变量，暗/亮）+ Cmd/Ctrl+S、Delete 快捷键 |

实际文件树（与 §10.3 设计基本一致，节点组件置于 `components/nodes/`）：
```
src/
  main.ts
  types/mulby.d.ts
  ui/
    index.html  main.tsx  App.tsx  styles.css
    store/graphStore.ts
    nodes/nodeDefs.ts
    hooks/useMulby.ts
    components/
      FlowCanvas.tsx  Toolbar.tsx  NodeLibrary.tsx  Inspector.tsx
      nodes/FilmNode.tsx
```

#### 16.2 关键实现决策
- **单一自定义节点类型** `film`：所有节点共用 `FilmNode` 组件，按 `data.kind` 查 `nodeDefs` 渲染端口/参数，新增节点只改数据表，零组件成本（为 M1+ 扩展铺路）。
- **连线类型校验**：`isValidConnection` 比对源/目标端口 `PortType`，相同或任一为 `any` 才允许，实时高亮非法连线。
- **持久化**：工程结构存 `storage`（命名空间 `ai-film-studio`），key `projects`（全量）+ `currentProjectId`；结构性变更（增删/拖动结束/连线/参数）防抖 800ms 自动落盘，叠加手动保存。
- **进程划分**：M0 仅前端；后端只保留生命周期与导出预留，符合"AI 调用放前端"的既定方针。

#### 16.3 修复记录
- 移除 `nodeDefs.ts` 中未使用的 `FileText` 导入（前任遗留的 `export { FileText }` 兜底 hack）。
- 修正 `FilmNode` 端口 Handle 垂直定位：Handle 与标签同属 `position:relative` 的 `__body`，统一以 body 为基准定位，去掉多余的 `HEADER_H` 偏移。

#### 16.4 验收（已通过）
- `npx tsc --noEmit` 类型检查通过；`pnpm run build` 成功，产出 `dist/main.js` + `ui/index.html`（`base:'./'` 相对路径，`file://` 可用）。
- 待人工在 Mulby 内验证：拖拽/点击增节点 → 连线（类型校验）→ 拖动/缩放/平移 → 编辑参数 → 自动/手动保存 → 切换/新建/导入导出工程 → 重开恢复。

> 备注：`manifest.json` 仍引用 `icon.png`（占位，M6 定稿图标）；Mulby 内将显示默认图标，不影响 M0 加载与功能验证。

#### 16.5 下一步（M1 文本链路）
StoryInput/ScriptGen/Storyboard 节点 + `textEngine`（`mulby.ai.call` 流式）+ 结构化 JSON 解析 + 模型选择，跑通"一句话 → 剧本 → 分镜表"。

---

### M1 — 文本链路（故事→剧本→分镜）✅（2026-06-16）

**目标**：让画布"跑起来"——文本 AI 节点接入 `mulby.ai.call`（流式），按拓扑顺序执行工作流，把一句话变成结构化剧本与分镜表。

#### 16.6 已交付内容
| 模块 | 文件 | 说明 |
|---|---|---|
| 模型服务 | `services/models.ts` | `ai.allModels()` 过滤出文本模型（排除 image-generation/rerank），供顶栏选择；零配置复用宿主模型 |
| 文本引擎 | `services/textEngine.ts` | 封装 `ai.call({messages,model}, onChunk)` 流式：累积 `text`/`reasoning`、捕获 `error`、支持 `abort` 中断 |
| JSON 解析 | `services/jsonParse.ts` | 稳健提取：```json 代码块 / 裸 JSON / 前后夹带说明；带括号配平扫描 + 去围栏 |
| Prompt 工程 | `services/prompts.ts` | 4 个文本节点的角色化 System Prompt（剧本/分镜/角色设定/提示词处理）+ 输入组装（JSON 产物优先结构化传递）|
| 执行引擎 | `services/executor.ts` | 纯函数：Kahn 拓扑排序、按端口收集上游产物、输入节点参数即时派生 |
| 运行状态 | `store/graphStore.ts` | 新增 `models/selectedModel/isRunning/runningNodeId` + `loadModels/setSelectedModel/runNode/runAll/cancelRun`；产物写回 `node.data.outputs`、运行后落盘 |
| 节点展示 | `components/nodes/FilmNode.tsx` | 底部状态摘要：运行中(流式尾串)/出错(红)/完成(剧本N场·分镜N镜·角色N个) |
| 属性面板 | `components/Inspector.tsx` | "运行此节点"按钮 + 运行结果（文本/JSON）/流式预览/错误展示 |
| 顶栏 | `components/Toolbar.tsx` | 文本模型下拉选择 + 运行/停止（运行中切换为停止） |

#### 16.7 执行模型
- **运行全部**：对全图拓扑排序，依次执行——输入节点按参数派生输出；文本节点调 AI；`preview` 节点展示上游；图像/视频/导出 M1 跳过。
- **运行单节点**：解析其上游（输入节点即时派生，AI 节点取已运行产物）后执行；缺输入则提示。
- **流式**：`onText` 增量写入 `node.data.stream`，节点与属性面板实时刷新；完成后 JSON 端口解析为结构化产物，文本端口去围栏。
- **中断**：停止按钮 `abort` 当前请求并复位状态。
- **数据流**：上游 JSON 产物以结构化 JSON（而非含前言的原始文本）注入下游 Prompt，保证分镜读取干净剧本。

#### 16.8 验收（已通过）
- `npx tsc --noEmit` 通过；`pnpm run build` 成功。
- 待人工在 Mulby 内验证主链路：故事输入 → 剧本生成 → 分镜脚本 连线后点"运行"，得到结构化剧本与分镜表（可在属性面板查看 JSON），并可切换文本模型 / 中途停止。

> 说明：文本/图像默认复用 Mulby 宿主模型；若宿主未配置任何文本模型，下拉显示"默认模型"，运行时由宿主决定或提示不可用。

#### 16.9 下一步（M2 图像链路）
CharImage/SceneImage/Keyframe 节点 + `imageEngine`（`ai.images.generate`）+ 资产库（`storage` 命名空间），由分镜批量产出角色三视图 / 场景图 / 关键帧。

---

### M2 — 图像链路（角色三视图 / 场景图 / 关键帧）✅（2026-06-16）

**目标**：把文本产物变成画面——图像节点接入 `mulby.ai.images`，由角色设定/分镜/场景批量生成图像，并落入资产库持久化。

#### 16.10 已交付内容
| 模块 | 文件 | 说明 |
|---|---|---|
| 图像引擎 | `services/imageEngine.ts` | 封装 `ai.images.generateStream`（可中断 + 生成预览），回退 `generate`；返回 base64 |
| 资产库 | `services/assets.ts` | 媒体走 `storage.attachment`（二进制附件，宿主按插件隔离），工程只存 `assetId`；对外仍以 base64 进出（内部 base64↔Uint8Array 转换），`toDataUrl`/`fromDataUrl` 互转；保留旧版 KV 读兼容 |
| 图像 Prompt | `services/prompts.ts` | 新增 `buildImagePrompt`：角色三视图 turnaround / 场景概念图 / 镜头电影感关键帧，注入全局画风 |
| 模型服务 | `services/models.ts` | 新增 `listImageModels`（`endpointType==='image-generation'`） |
| 运行/持久化 | `store/graphStore.ts` | execNode 新增 image 分支；`runAll` 纳入图像节点；`selectedImageModel` + `setNodeImage`（上传参考图）；保存时 `serializeNodes` 剥离 url、加载时 `hydrateAssets` 补水、导入时 `reimportAssets` 回灌 |
| 节点展示 | `components/nodes/FilmNode.tsx` | 图像产物缩略图 + 生成中预览角标 |
| 属性面板 | `components/Inspector.tsx` | 图像结果大图预览；参考图节点「上传参考图」；图像节点「运行此节点」 |
| 顶栏 | `components/Toolbar.tsx` | 新增图像模型下拉（文本/图像双选择器） |

#### 16.11 执行与数据
- **生成**：图像节点收集上游（角色 json / 分镜 json / 场景文本）→ `buildImagePrompt` 产出英文提示词 + 尺寸 → `ai.images` 生成 → 存资产库 → 写回 `outputs.out = { type:'image', assetId, url }`。
- **预览/中断**：流式 `preview` 回调写 `node.data.previewUrl` 实时显示；停止按钮 `abortImage()`。
- **参考图**：`image-input` 节点本地选图（FileReader→dataURL）→ 资产库 → 作为下游输入。
- **持久化策略**：工程 JSON 只存 `assetId`（剥离 base64/url），避免数据膨胀；加载后按 `assetId` 异步补水 url；导出内嵌 url 便于跨设备移植，导入时重新落库。

#### 16.12 验收（已通过）
- `npx tsc --noEmit` 通过；`pnpm run build` 成功。
- 待人工在 Mulby 内验证：分镜/角色设定 → 角色三视图 / 场景概念图 / 关键帧，选择图像模型后「运行」，节点显示缩略图、属性面板显示大图；刷新后图像仍在（资产库补水）。

> 限制：M2 关键帧暂为「文生图」，参考图（img2img 一致性）将在 M4 通过 `ai.images.edit` 接入；视频生成为 M3。

#### 16.13 下一步（M3 视频链路）
I2V/T2V 节点 + `videoEngine`（自定义供应商，submit→poll→fetch）+ 视频资产入库与播放，由关键帧/提示词生成视频片段。

---

### M3 — 视频链路（关键帧/文本 → 视频片段）✅（2026-06-16）

**目标**：Mulby 不提供视频模型，由插件自管第三方供应商（经 `mulby.http`，主进程代理无 CORS），统一异步三段式 submit→poll→取地址；I2V/T2V 节点跑通并内联预览。

#### 16.14 已交付内容
| 模块 | 文件 | 说明 |
|---|---|---|
| 供应商抽象 | `services/providers/types.ts` | `VideoProviderConfig` / `VideoGenRequest` / `VideoProviderAdapter`（submit/poll）/ `VideoHandle` |
| HTTP 工具 | `services/providers/http.ts` | `httpJson`（mulby.http + 状态码校验 + JSON 解析）、`getPath`/`firstString`（JSON 路径提取） |
| fal 适配器 | `services/providers/fal.ts` | fal 队列 API：POST 模型端点 → 透传 `status_url`/`response_url` → 轮询 `COMPLETED` 取 `video.url`；`Authorization: Key` |
| custom-http 适配器 | `services/providers/customHttp.ts` | 用户填 submit/poll URL + JSON 路径，留空按常见命名自动尝试；`{taskId}` 占位替换；状态归一化 |
| 视频引擎 | `services/providers/index.ts` | `runVideo`：submit→轮询(2s→5s 退避)→取地址；默认 300s 超时；`abortVideo` 轮询间中断；`onProgress` |
| Key 安全 | `services/keys.ts` | `storage.encrypted`（系统 Keychain/DPAPI，宿主按插件隔离）存取，结构只存键名引用 `k_{providerId}`，无明文、无明文回退 |
| 供应商 Store | `store/providerStore.ts` | 供应商 CRUD、默认选择、Key 存取与存在性 |
| 设置弹窗 | `components/ProviderSettings.tsx` | 增删供应商、选默认、填 Key（密文）、fal/custom-http 表单 |
| 运行集成 | `store/graphStore.ts` | execNode 新增 video 分支（首帧 data URL 解析、提示词/运镜回退）；`runAll` 纳入视频；`serializeNodes` 仅剥离 base64 `data:` URL、保留远程视频链接；`cancelRun` 调 `abortVideo` |
| 展示 | `FilmNode.tsx` / `Inspector.tsx` / `Toolbar.tsx` / `App.tsx` | 节点内 `<video>` 缩略、属性面板 `<video controls>`、顶栏「视频供应商」入口、启动加载供应商 |

#### 16.15 执行与数据
- **I2V**：上游关键帧（image）→ 解析为 data URL 作 `image_url` 首帧 + 提示/运镜 → 生成视频。
- **T2V**：上游文本提示 → 生成视频。
- **进度**：轮询状态写 `node.data.stream`（排队中/生成中%）实时显示；停止按钮中断。
- **产物**：`outputs.out = { type:'video', url: 远程地址 }`；URL 体积小，直接随工程持久化并内联播放。

#### 16.16 验收（已通过）
- `npx tsc --noEmit` 通过；`pnpm run build` 成功。
- 待人工在 Mulby 内验证：顶栏「视频供应商」添加 fal（填 model + Key）→ 关键帧接 I2V（或文本接 T2V）→「运行」→ 节点/面板内联播放视频。

> 说明与限制：
> - 视频走**前端 `mulby.http`** 轮询（与文本/图像前端化一致，无 CORS）；窗口关闭会中断轮询，后端 scheduler 续跑 + taskId 持久化恢复留待 M4。
> - M3 保存**远程视频 URL**（可能有有效期）；下载落盘到 `filesystem`（离线 + ffmpeg 合成）为 M5。
> - 内置 `fal` + `custom-http`；fal 适配器按其公开队列 API 实现，需用户用自己的账号/模型核验，`custom-http` 为任意供应商兜底。

#### 16.17 下一步（M4 供应商管理增强）
节点级 `providerOverride` + 连通性自测 + 视频落盘 `filesystem` + 图像 `ai.images.edit`（img2img 一致性），完善多供应商体验。

---

### M4 — 供应商管理增强（节点覆盖 / 连通自测 / 视频落盘 / img2img）✅（2026-06-16）

**目标**：把"能跑"提升到"可控、可靠、可复用"——单节点可覆盖供应商/模型、一键自测连通、视频自动下载到本机防 URL 失效、图像支持参考图（img2img）保持一致性。

#### 16.18 已交付内容
| 模块 | 文件 | 说明 |
|---|---|---|
| 图像编辑引擎 | `services/imageEngine.ts` | 新增 `editImage`：参考图 → `ai.attachments.upload` → `ai.images.edit`（img2img），返回 base64 |
| 视频下载服务 | `services/download.ts` | `downloadVideoToDisk`：前端解析 userData 路径 → 调后端 RPC 下载落盘，返回本地路径；`basename` 工具 |
| 连通性自测 | `services/providers/test.ts` | `testVideoProvider`：fal 探测 `requests/connectivity-test/status`、custom-http 探测 poll/submit 端点；401/403 判 Key 无效，不产生生成费用 |
| 后端下载 RPC | `src/main.ts` | `rpc.downloadVideo`：主进程 `fetch`（规避 CORS）→ base64 写入 `{userData}/ai-film-studio/videos/`（二进制不截断）；`ensureDir` 逐级建目录 |
| 运行集成 | `store/graphStore.ts` | 文本/图像/视频三类节点读取节点级覆盖（`modelOverride`/`imageModelOverride`/`providerOverride`）；图像分支检测上游参考图自动走 img2img；视频成功后**自动落盘**写 `localPath`；新增 `downloadVideo(id)` 手动下载动作；`PortValue` 增 `localPath`（持久化） |
| 属性面板 | `components/Inspector.tsx` | 文本/图像「模型（覆盖顶栏）」、视频「供应商（覆盖默认）」下拉；视频结果区「下载到本地 / 打开文件夹」 |
| 供应商弹窗 | `components/ProviderSettings.tsx` | 每个供应商行新增「测试连接」按钮 + 结果（连通/Key 无效/无法连接） |
| 样式 | `styles.css` | 测试按钮/结果配色、视频结果操作区、mini 按钮、本地路径省略 |

#### 16.19 执行与数据
- **节点级覆盖**：覆盖值存于 `node.data.params`（随工程持久化）。留空＝跟随顶栏/默认；视频覆盖的供应商若已删除则运行时报错提示。
- **img2img 判定**：图像节点收集上游后，若存在 `image` 端口产物且宿主支持 `ai.images.edit`，则上传该参考图走 edit；否则回退 `generate`（文生图）。关键帧的 `ref`、场景图的图像输入均可触发。
- **视频落盘**：生成成功（拿到远程 URL）后立即尽力下载（失败不影响 `done`）；用户也可在属性面板手动「下载到本地」。落点 `{userData}/ai-film-studio/videos/`，节点保存 `localPath`，可一键「打开文件夹」。
- **连通自测**：用 `mulby.http`（拿到任意状态码不抛错）做一次 GET 探测，区分"可连通/Key 无效/无法连接"；fal 用 `Key xxx`、custom-http 用 `Bearer xxx` + 自定义头。

#### 16.20 验收（已通过）
- `npx tsc --noEmit` 通过；`pnpm run build` 成功（后端 `dist/main.js` 含下载 RPC，UI 正常产出）。
- 待人工在 Mulby 内验证：① 节点上切换覆盖模型/供应商并运行；② 供应商弹窗点「测试连接」看连通结果；③ 参考图→关键帧 走 img2img；④ 视频生成后自动落盘 + 「打开文件夹」。

> 说明与限制：
> - 连通自测为**轻量探测**（不提交生成任务），只校验端点可达与 Key 是否被接受；最终可用性仍以实际生成为准。
> - 自动落盘依赖后端 `fetch`（Node 18+）；若宿主后端无 `fetch` 或目录不可写，下载失败但不影响视频在线播放，可稍后手动重试。
> - img2img 需所选图像模型支持 `images.edit`；不支持时按文生图回退。

#### 16.21 下一步（M5 时间线合成 + 导出）
视频/音频时间线、`ffmpeg` 拼接多片段为成片、TTS 配音与字幕、批量对每镜循环生成，产出可导出的完整短片。

---

### 存储 API 对齐修订 ✅（2026-06-16）

**背景**：核对发现代码的存储实现与设计文档（§6.5/§8.2）不符——Key 用 `mulby.security` 原语 + 普通 KV（且加密不可用时回退明文），图像用普通 KV 存 base64。经核宿主源码（`mulby/src/main/ipc/storage.ts`），文档主张的 `storage.encrypted` 与 `storage.attachment` 均真实暴露给插件、且 `storage.attachment` 正是同类插件 `mulby-ai-image` 的惯例做法，故以设计文档为准修正代码。

| 项 | 改前 | 改后 |
|---|---|---|
| Key | `security.encryptString` + `storage.set(base64)`，有明文回退 | `storage.encrypted.set/get/has/remove`（键 `k_{providerId}`），无明文回退 |
| 图像 | `storage.set({base64,mime})` 普通 KV | `storage.attachment.put/get/getType/remove`，内部 base64↔Uint8Array 转换 |

- 改动仅限 `services/keys.ts`、`services/assets.ts` 与 `types/mulby.d.ts`（补 `storage.encrypted`/`storage.attachment` 类型）；两个 service 导出签名不变，18 个调用点零改动。
- `assets.loadAsset` 保留旧版 KV 读兼容，迁移前已生成的图不丢；`deleteAsset` 一并清旧 KV 残留。
- 附带修正：宿主对插件强制忽略自定义 namespace（`storage.ts:30-39`），原 `ai-film-studio-keys/-assets` 命名空间本就未生效；新方案各自独占 `_encrypted_:`/`_attachment_meta_:` 键空间。
- 验收：`npx tsc --noEmit` 通过；`npm run build` 通过。

---

### M5 — 时间线合成 + 导出 ✅（2026-06-16）

**目标**：把此前已写好但未接线的合成/配音/字幕/落盘服务真正接入执行引擎——配音(TTS)、多片段 ffmpeg 合成（归一化+拼接+字幕+配音）、成片导出，打通"片段 → 成片 → 落盘"。

#### 16.22 已交付内容
| 模块 | 文件 | 说明 |
|---|---|---|
| 配音节点 | `store/graphStore.ts`（execNode `audio` 分支） | 文本 → `services/tts.synthSpeech`（后端 OpenAI 兼容 `/audio/speech` 落盘）→ 音频产物；Key 走 `storage.encrypted`（键 `tts:{nodeId}`，不进工程参数） |
| 合成节点 | `store/graphStore.ts`（execNode `compose` 分支） | 多片段 → `resolveLocalVideo` 统一落本地 → `ensureFfmpeg`（按需下载）→ `composeFilm`（scale/pad/setsar/fps 归一 + concat + 可选烧录/软字幕 + 配音 apad 混音）→ 成片 |
| 导出节点 | `store/graphStore.ts`（execNode `export` 分支） | 上游视频 → `dialog.showSaveDialog` 选位置 → 读本地 base64 写入目标 |
| 字幕 | `services/subtitles.buildSrt` | 由分镜 JSON + 各片段 `durationSec` 生成 SRT 时间轴 |
| 落盘辅助 | `services/fsutil`、`services/ffmpeg`、`services/tts` | 此前孤立的 M5 服务全部接线（之前全仓零引用） |
| UI | `components/Inspector.tsx` | audio/compose/export 纳入「运行此节点」；TTS API Key 加密输入框；结果区新增 `<audio>` 播放 |
| 执行集成 | `store/graphStore.ts` | `runAll` 纳入 audio/compose（export 因弹保存框仅手动运行）；`cancelRun` 调 `abortFfmpeg`；视频产物写 `durationSec`；`serializeNodes` 剥离 audio data: URL |

#### 16.23 执行与数据
- **配音**：文本（上游或参数）+ 加密 Key → 后端合成落盘 `{userData}/ai-film-studio/audio/`，返回 base64 供会话内播放、`localPath` 供合成复用。
- **合成**：每个 `clips` 端口产物（可连多个视频节点）解析为本地文件（本地优先 / 远程下载 / data 落盘）；`subs` 端口接分镜 JSON 生成字幕；`audio` 端口接配音；`ffmpeg` 首次自动下载；进度回推节点 `stream`。
- **导出**：保存对话框选目标 → 复制成片。
- **持久化**：成片/导出产物保存 `localPath`（随工程持久化），属性面板可「打开文件夹」。

#### 16.24 审查与修复（对抗式 review 确认）
- 🔴 单片段 `concat=n=1` 非法 → `buildConcatArgs` 单片段跳过 concat、仅归一化。
- 🔴 `escapeSubPath` 误转义 Windows 盘符冒号 → 保留 `C:`，仅转义其余冒号。
- 🟡 `export` 补 `runningNodeId` + `finally`；`resolveLocalAudio` 补远程 URL 下载；字幕模式改显式映射；`fmtTime` 修毫秒进位（避免非法 SRT）。
- 误报已剔除：`apad`+`-shortest` 是补静音到视频等长的官方惯用法（正确）；`mov_text` 是 MP4 软字幕标准编码（正确）。

#### 16.25 验收（已通过）
- `npx tsc --noEmit` 通过；`npm run build` 通过（M5 服务已打包，bundle 398KB→409KB）。
- 待人工在 Mulby 内验证：多个视频片段 + 分镜(字幕) + 配音 → 合成节点「运行」得到带字幕/配音的成片并播放/打开文件夹；导出节点另存到指定位置。

> 说明与限制：
> - 合成成片内联播放用 `file://`（取决于宿主 webSecurity），无论能否内联播放，`localPath` 的「打开文件夹」始终兜底可用。
> - 字幕时长按各视频节点 `duration` 参数估算，与实际生成时长可能略有出入。
> - `audio-input`（本地导入音频）节点尚未接线，配音目前由 TTS 节点产出。

#### 16.26 下一步（M6 打磨）
工作流模板、批量 ForEach、错误体验完善、图标定稿（已出 `assets/icon.svg`→`icon.png`）、README（已交付）、`mulby pack` 产出 `.inplugin`。
