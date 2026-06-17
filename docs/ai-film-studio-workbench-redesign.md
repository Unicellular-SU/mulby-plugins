# AI 影视工坊 · 工作台重构方案
### 工程（项目）/ 素材 / 提示词 三大管理面 + 整体布局重构

> 状态：**待评审（设计稿）** · 日期：2026-06-17 · 适用插件：`plugins/ai-film-studio`
> 配套文档：能力总设计见 `docs/ai-film-studio-design.md`；本文件聚焦"工程/素材/提示词三块管理 + 布局"的重构，独立维护、不并入总设计。

## 0. 本次已锁定的决策

| # | 决策 | 影响 |
|---|---|---|
| ① | **整体重构**：新增左侧 ~56px 图标导航栏(rail)，把「工程主页 / 画布编辑器 / 素材库 / 提示词库 / 设置」做成一级界面；画布内左侧 Dock 改为「节点｜素材｜提示词」三标签，库内容可拖入画布 | 全局布局与导航 |
| ② | **素材库与角色/场景库 = 全局共享、跨工程复用**（对标 LTX Elements） | 数据模型走全局注册表 |
| ③ | **Phase 1 即执行工程存储拆分**：单键 `projects(ProjectData[])` → `projects:index`(仅 `ProjectMeta`) + `project:<id>`(重型 graph)，懒加载 + 一次性迁移 | 修复冷启动慢/并发覆盖 |
| ④ | **角色/场景 Elements 全局库提权**：从最后阶段提前到 **Phase 2**，与素材库一起做（定义一次、跨工程复用、插入画布、从现有人物/场景节点保存到库） | 一致性底座前移 |
| ⑤ | 本文档为**独立新文档**，不并入庞大的 `ai-film-studio-design.md` | 文档治理 |

## 目录

- 1. 现状与差距（基于代码）
- 2. 调研对标（优秀开源/商业项目）
- 3. 信息架构与布局（整体重构）
- 4. 数据模型 / 存储 / 迁移
- 5. 工程管理（Projects）需求
- 6. 素材库 + 全局角色/场景库（Assets + Elements）需求
- 7. 提示词库（Prompts）需求
- 8. 分期实施计划与任务拆解
- 9. 迁移与兼容（一次性）
- 10. 风险与对策 + 验收清单

---

## 1. 现状与差距（基于代码）

本章逐块（**工程 / 素材 / 提示词**）对照真实代码点名现状，并定位三个必须在重构中根除的硬伤。所有结论均可在 `graphStore.ts`、`assets.ts`、`promptStore.ts` 中按行号复核。

### 1.1 三块现状速览

| 维度 | 现状（代码事实） | 关键文件 / 锚点 | 差距（对照已锁定决策） |
|---|---|---|---|
| **工程·数据模型** | `ProjectMeta` 仅 `{ id, name, createdAt, updatedAt }`，无封面、无标签、无收藏、无归档、无缩略 | `graphStore.ts` `ProjectMeta`(64-69) | 决策①的「工程主页」需卡片网格（封面+元信息+排序+筛选），现有元数据撑不起视觉化首页 |
| **工程·存储** | 单键 `projects` 存 **全部 `ProjectData[]`**（含重型 `nodes/edges`）；`init` 一次性反序列化所有工程；每次 `saveProject` 读回整个数组、改一项、整体写回 | `KEY_PROJECTS='projects'`(24)；`init`(1129)；`saveProject`(1588-1613) | 决策③要求拆为 `projects:index` + `project:<id>` 懒加载（硬伤 a，见 §1.2） |
| **工程·画布** | `viewport` 字段在 `ProjectData` 上声明但 **从不写入/恢复**（`saveProject` 不含 `viewport`） | `ProjectData.viewport`(89)；`saveProject`(1595-1604) | 平移/缩放不持久化，切工程后画布复位 |
| **工程·导入导出** | `importProject` **覆盖当前工程**而非新建行（忽略 `data.id/createdAt`）；`exportProject` **内联完整 base64**（不走 `stripValue`），与持久化的 assetId-only 表示不对称 | `importProject`(1694-1709)；`exportProject`(1711-1716)；对比 `stripValue`(978)/`serializeNodes`(988) | 导入会孤立被覆盖工程的全部附件；导出 JSON 体积失控 |
| **素材** | 无资产注册表、无索引、无 Board/标签/收藏；附件只有 `a_<nanoid>` 裸 id 散落在节点 `outputs[].assetId` 里 | `saveAsset`→`a_+nanoid(10)`(`assets.ts`:40-41)；`PortValue.assetId`(`graphStore.ts`:36) | 决策②要求**全局共享、跨工程复用**的素材库；当前素材是「节点产物的私有副产品」，无法被检索/复用/插入 |
| **素材·GC** | `deleteAsset` 已定义但 **零调用**；删节点/删工程/重跑覆盖/切工程均不回收附件 | `deleteAsset`(`assets.ts`:72)，全仓 grep 仅命中定义 | 附件 write-only 永久泄漏（硬伤 b，见 §1.3） |
| **提示词** | 节点模板埋在 `PromptSettings.tsx` 弹窗；全局设定被拆到另一个 `GlobalSettings.tsx` 弹窗；模板为整段字符串覆盖，无可复用片段、无变量、无版本 | `PromptSettings.tsx`/`GlobalSettings.tsx`；`promptStore.get`(`promptStore.ts`:53-56) | 决策①要求「提示词库」一级界面 + Dock 标签；当前是两个分裂弹窗（硬伤 c，见 §1.4） |
| **提示词·存储** | 全局层落 **默认 namespace** 的 `afs:promptOverrides`，而 graphStore/providerStore 用 `'ai-film-studio'` namespace；命名空间不一致 | `STORAGE_KEY`(`promptStore.ts`:11,34)；`window.mulby.storage.set(...)` **无 namespace** 实参 | 提示词数据与其余插件数据隔离方式不统一，迁移/导出时易遗漏 |

### 1.2 硬伤 a — 工程存储单键全量读写（必须 Phase 1 拆分）

`ProjectMeta` 只有四个字段，且**重型图数据与轻量元数据被压在同一个键**里：

- `init`（`graphStore.ts`:1129-1159）一次 `sget<ProjectData[]>('projects')` 把**所有工程的全部 nodes/edges** 反序列化进内存，仅为渲染一个工程；工程数和图规模一大，冷启动即线性变慢。
- `saveProject`（1588-1613）是对整个数组的**读—改—写**：`const all = await sget(...)` → 改 `all[idx]` → `await sset('projects', all)`。
- 该模式叠加 800ms 防抖 `scheduleSave`（216-222）与运行链路里大量显式 `void get().saveProject()`（如 1195、1206、1267、1458），并发保存会在「整数组读改写」上**互相覆盖**；现有 `saving` 标志（1591/1611）只是状态位，**不串行化写入**。

> 修复方向（决策③，Phase 1 即执行）：单键 `projects(ProjectData[])` → `projects:index`（仅 `ProjectMeta[]`，主页/切换器读它）+ `project:<id>`（重型 graph，懒加载）。`init` 只读 `projects:index`；`switchProject` 才按需读 `project:<id>`；`saveProject` 只写当前工程的 `project:<id>` 单键，根除全数组竞争。配套一次性迁移：探测旧 `projects` 键存在则拆分落地、并标记迁移完成。

### 1.3 硬伤 b — 素材无注册表、`deleteAsset` 从未调用 → 附件存储泄漏

`assets.ts` 三件套俱全（`saveAsset`:40 / `loadAsset`:51 / `deleteAsset`:72），但全仓检索 `deleteAsset` **只命中其自身定义、零调用点**。因此附件是**只写不删**的：

```
saveAsset 被频繁铸造新 assetId（每次都新建，从不复用）：
  execNode 图像扇出 501、人物/场景 275、image-edit/upscale 348、
  editNodeImageItem 1245、setNodeImage 1186、setNodeAudio 1200、reimportAssets(reimportValue 内)
对应无任何删除：
  removeNode 1522 / deleteSelected 1532 → 只删节点与边，不碰 attachment
  deleteProject 1636 → 丢掉工程行，附件二进制原封不动残留
  重跑/编辑/重绘 → 每次 saveAsset 铸新 id，旧 id 直接成孤儿（editNodeImageItem 1245 即典型）
```

宿主已提供回收所需的全部能力——`storage.attachment.remove(id)` 与 `storage.attachment.list(prefix?)`（`mulby.d.ts`:673-674）——但 `remove` 仅在未被调用的 `deleteAsset` 里、`list` **全程未用**，连「孤儿扫描」兜底都没有。附件在 `userData/plugin-attachments` 下**无界增长**。

> 修复方向（决策②+④，Phase 2）：素材库即「资产注册表」——以 `assetId` 为主键登记 `AssetRecord { origin, role, mime, refs[], tags, starred, createdAt, usedBy[] }`（借鉴 InvokeAI 的 origin/role 双轴与 starred），落存储键 `assets:registry`。删除/覆盖时按 `usedBy` 引用计数决定是否 `deleteAsset`；并用 `storage.attachment.list` 做一次孤儿 GC 清扫历史泄漏。素材库与角色/场景 Elements **全局共享、跨工程复用**——角色/场景以 `ElementRef` 登记、落存储键 `elements:library`（LTX 式：定义一次、插入画布、由现有 `character`/`scene` 节点「保存到库」）。

### 1.4 硬伤 c — 提示词埋在弹窗，无片段 / 无变量 / 无版本；全局设定被拆到另一弹窗

提示词当前是「整段字符串两层覆盖 + 默认」：`promptStore.get`（`promptStore.ts`:53-56）按 **工程覆盖 > 全局覆盖 > 内置默认** 解析，覆盖单位是节点模板 id 的**整段文本**（如 `text.storyboard`、`image.keyframe`）。其结构性短板：

- **无可复用片段**：style/camera/lighting/negative 这类跨多个节点模板复用的内容只能在每个模板里**复制粘贴**，改一处需手改 N 处（违反 DRY）。
- **无变量 / 无版本**：模板是死字符串，无占位符注入、无版本历史、无 diff、无「相对默认改了什么」的可视化。
- **入口分裂且埋在弹窗**：节点模板编辑在 `PromptSettings.tsx`，而画幅/风格等**全局设定却在另一个 `GlobalSettings.tsx`** 弹窗（`ProjectGlobals`，`graphStore.ts`:72-75）；二者本属「生成约束」却被切成两个模态，且都不是一级界面。
- **存储命名空间不一致**：全局覆盖落默认 namespace 的 `afs:promptOverrides`（11/34，调用 `storage.set` 时**未传 namespace**），而工程级覆盖随 `ProjectData.promptOverrides`（92）走 `'ai-film-studio'` namespace，经 `setProjectLayer`（`promptStore.ts`:72）仅以内存快照推送、**自身不持久化**。

> 修复方向（决策①，提示词库一级界面）：把「提示词」升为 rail 一级界面、并作为画布 Dock 三标签之一；引入**可复用片段（`PromptSnippet`，落存储键 `prompts:snippets`）+ 变量占位符 + 版本**（借鉴 PromptLayer/Portkey 的 include 引用与「移动指针式」三层解析）；将分裂的全局设定收编进同一提示词/设定界面；统一存储命名空间。

### 1.5 与重构决策的对齐小结

- **决策①（rail + Dock 三标签）**：现有 shell 为固定三栏 `aside.left=NodeLibrary / main=FlowCanvas / aside.right=Inspector`，所有库/设定均为顶栏触发的模态弹窗——无一级界面切换、无 Dock 标签化，需新增 `Rail.tsx`（新增）等承载「工程主页/画布/素材库/提示词库/设置」。
- **决策②④（全局素材库 + 角色/场景 Elements 提前到 Phase 2）**：当前素材寄生于节点 outputs、Elements 概念尚不存在，二者均需新建注册表——素材以 `AssetRecord` 落 `assets:registry`、角色/场景以 `ElementRef` 落 `elements:library`——落地全局复用。
- **决策③（Phase 1 工程存储拆分）**：§1.2 的单键全量读写是性能与并发安全的根因，列为 Phase 1 首发项，拆为 `projects:index` + `project:<id>` 并自带一次性迁移。
- 全程仅复用已确认存在的宿主 API（`storage.*`、`storage.attachment.*`），不改动 `PortValue/executor` 语义，库为增量叠加。

## 2. 调研对标（优秀开源/商业项目）

> 本章以 research 数据为依据，对五类标杆产品做"它怎么做 → 我们采用什么"的逐项映射。所有"我们采用"均与已锁定决策（rail 一级界面、Dock 三标签、全局共享素材/Elements 库、Phase 1 工程存储拆分、Phase 2 Elements 提权）保持一致，且只调用 ground-truth 确认存在的宿主 API（`storage.attachment.*`、`storage.get/set`、`ai.images.*` 等），不引入 Mulby 不存在的能力。内部命名沿用本文档数据模型：`ProjectMeta`（轻量索引行）、`AssetRecord`（素材索引行）、`ElementRef`（节点对 Element 的引用）、`PromptSnippet`（可复用片段），存储键 `projects:index` / `project:<id>` / `assets:registry` / `elements:library` / `prompts:snippets`。

### 2.0 标杆全景与决策映射

| 标杆 | 核心可借鉴点 | 对应我们的决策/落点 |
|---|---|---|
| InvokeAI | Boards + Generated/Assets 双轴 + 统一资产表 + 虚拟板 + 单查询计数 + 星标/归档/孤儿 GC | 全局素材库（`assets:registry`）的数据模型与 GC（修复确认的 `deleteAsset` 永不调用的存储泄漏） |
| ComfyUI 生态 | 多工程秒切 + 收藏置顶 + 面板内文件夹 + 拖入画布 + 每工程输出画廊 + 服务端筛选 | rail「工程主页」与 Dock 三标签的交互机制；工程存储拆分后的懒加载秒切 |
| LTX Elements | 四类 typed Element + 双入口创建 + @绑定 + 引用式传播 + 跨工程 Brand Kit | 角色/场景全局库（`elements:library`，Phase 2 提权），与现有 `character`/`scene` 节点对接 |
| PromptLayer/Humanloop/Portkey | 片段 partial + 移动指针 label + 内容哈希版本 + 层级 diff + `.prompt` 目录覆盖 | 提示词库（`prompts:snippets`）的「工程 > 全局 > 默认」三层覆盖与片段复用 |
| 桌面创作应用 IA | 双层左导（rail + panel）+ 整面切换 + 封面卡片仪表盘 + 可折叠 dock + auto-fit 栅格 | 整体重构的 ~56px rail、一级界面、工程主页卡片、1100–1400px 响应式 |

---

### 2.1 InvokeAI — Boards / Assets / 孤儿 GC（→ 全局素材库数据模型）

| 它怎么做 | 我们采用什么 |
|---|---|
| **统一资产表**：上传的参考图、控制图、生成帧同在一张 `images` 表，"Assets 标签页"只是按 `ImageCategory` 过滤，不存在并行的"references 子系统"。 | **单一资产存储 = `storage.attachment.*`**（沿用现有 `assetId='a_'+nanoid(10)`）。素材库不新建独立二进制存储，只新增一张元数据索引 `assets:registry`（行类型 `AssetRecord`）；生成帧可零拷贝立即被下游节点当参考图引用。 |
| **双正交轴**：`origin`(INTERNAL/EXTERNAL) 与 `category`(GENERAL/MASK/CONTROL/USER) 分列，标签页由 category 驱动而非 origin。 | `AssetRecord` 含 `origin: 'generated'\|'imported'\|'external-url'` 与 `role: 'shot'\|'reference'\|'mask'\|'audio'\|'video'\|'other'` 两个字段。`role` 直接对应现有 `PortType`（image/video/audio），「生成 \| 素材」分栏按 `role` 切，避免类型爆炸。 |
| **虚拟板**：By Date 等只读分组，是 metadata 上的实时查询而非建表；不可拖入/重命名。 | 智能分组（按日期/模型/角色/场景标签）实现为对 `assets:registry` 的**保存筛选**，零建表。UI 明确标注只读、非拖放目标（见 pitfall）。 |
| **自描述 metadata**：生成参数（prompt/seed/model）写进资产，搜索用 `LIKE '%term%'`。 | `AssetRecord` 内联生成溯源：`{prompt, model, nodeKind, parentAssetIds}`（来源即现有 `PortValue.meta`）。MVP 用子串匹配，但**预留结构化 tag 列**（research 明确警告 LIKE 在大库不可扩展）。 |
| **单查询板列表**：`image_count/asset_count/cover` 在一条 SQL 内算出（PR #6931），避免 N+1。 | 工程/分组侧栏的计数与封面缩略图一次性从 `projects:index`（`ProjectMeta` 行）+ `assets:registry` 算出，配合 Phase 1 存储拆分，让大库侧栏保持秒级。 |
| **星标排序 + 归档 + 软删**：`ORDER BY starred DESC, created_at DESC`；`archived`/`deleted_at`；删板有内容警告。 | `AssetRecord` 与 `ProjectMeta` 加 `pinned` 与 `archivedAt`/`deletedAt`，排序内置置顶。**Archive 与 Delete 分离**，软删时间戳，修正现状 `deleteProject` 清空后强制重建默认工程、单工程无法真正删除的缺陷。 |
| **批量 zip 导出 + 上下文动作**：右键板导出全部帧；图片菜单含 Use Prompt/Seed、Remix、Load Workflow。 | 拖资产到工程缩略图 = 移动；多选右键批量 Move/Star/Delete；上下文动作做成节点图语义：「作为参考插入新节点」「重跑同 seed」（对接现有 `regenNodeImageItem`）。 |

**直接修复确认的存储泄漏（research + ground-truth 双证）**：`deleteAsset`(assets.ts:72) 全插件无调用点，`storage.attachment.list/remove` 从未使用，附件只增不删。借鉴 InvokeAI 的内容引用与软删，落点：

```
新增 src/ui/services/assetGc.ts (新增)
  sweepOrphans(): 用 storage.attachment.list(prefix?) 拉全部 assetId，
                  与「projects:index 下所有 project:<id> 的 outputs.assetId
                   ∪ assets:registry 中 AssetRecord 引用」做差集，
                  对孤儿调 storage.attachment.remove(id)（即终于调用 deleteAsset 链路）
  触发点：removeNode/deleteSelected、deleteProject、importProject、以及手动「整理存储」
```

> **采纳的关键 pitfall**：InvokeAI 的"一图一板（UNIQUE 约束）"对影视工具是**错误默认**——一张角色参考图要跨多场景/工程复用。我们采用**多对多归属**（主板 + 复用链接），保留其 UPSERT/移动手感，但不照搬 UNIQUE。同时跳过 `BoardVisibility`(Private/Shared/Public) 多用户分层——本地单用户无收益。

---

### 2.2 ComfyUI 生态 — workspace/收藏/folders/输出浏览器（→ 工程主页 + Dock 机制）

| 它怎么做 | 我们采用什么 |
|---|---|
| **多工程秒切 + 顶部标签条**：workspace-manager 缓存 JSON（IndexedDB），原生前端有多工作流 tab 条，切换不重读磁盘。 | rail「工程主页」以工程为单位，列表 1-click 打开；画布顶部可选多工程 tab 条。**秒切的前提就是 Phase 1 存储拆分**：`projects:index` 只读轻量 `ProjectMeta`，`project:<id>` 懒加载重型 graph，避免现状单键 `projects` 全量读写。 |
| **收藏置顶**：每行星标→顶部 Bookmarks 组；★ 控件在工作流/节点/模型/提示词标签复用。 | 工程行与 Dock 各标签项统一一个 `pinned` 星标控件；工程主页顶部「收藏」区先于「最近」。同一控件复用到节点/素材/提示词三 Dock 标签。 |
| **面板内文件夹 = 第一大未满足需求**（原生 issue #3560 只能在磁盘建夹、不能从面板拖入）。 | Dock 与工程主页支持**面板内建夹 + 拖拽归类**，外加跨文件夹的彩色标签。这是相对原生的差异化点，直接对接拖入画布。 |
| **拖入画布机制**：N-Sidebar/Workflow-Studio 把节点/模型/提示词/工作流直接拖到画布，插入到落点前。 | Dock 三标签「节点 \| 素材 \| 提示词」全部可拖入画布。复用现有 `DND_MIME='application/afs-node'`，**新增** `application/afs-asset`、`application/afs-prompt` 两类 MIME：拖素材→落地为 `image-input`/`audio-input` 节点并填 `assetId`；拖提示词→注入到目标节点 `params`。 |
| **每工作流输出画廊**：自动归集生成图/视频，可设封面；服务端扫描 + mtime 缓存撑 6000+。 | 工程主页主面板 = 每工程输出画廊（缩略图/表格切换 + 详情抽屉露出 `PortValue.meta`），可设工程封面。大库走索引分页而非客户端全量加载。点击输出可定位回生成它的节点。 |
| **单一搜索 + 组合筛选芯片，服务端过滤**。 | Dock/主页顶部单搜索框（名称 + metadata），筛选芯片（收藏/文件夹/标签/类型）带实时计数，基于 `assets:registry` 过滤。 |
| **左 dock 机制**：可折叠/自动隐藏/可调宽/可钉/单字母 rail，状态持久化。 | rail ~56px 固定 + Dock 面板可折叠/调宽，宽度与折叠态持久化（修正现状 `viewport` 等状态从不持久化）。 |

> **采纳的关键 pitfall**：(1) workspace-manager 的"未保存"假阳性脏标记是其被弃用主因——我们的脏标记须基于**内容哈希**（见 §2.4）而非时间戳。(2) IndexedDB 纯浏览器存储导致跨机丢失——我们一律落 `storage.*`（宿主隔离 KV）+ `storage.attachment.*`，不依赖浏览器存储。(3) 原生已内置大量能力，差异化聚焦"面板内文件夹 + 跨切标签 + 每工程画廊 + 策展（评分/状态）"。

---

### 2.3 LTX Studio Elements — 全局可复用角色/场景库（→ Phase 2 提权落点）

> 这是「角色/场景全局库提权到 Phase 2」的直接蓝本。现有节点已具备 `character(out=json,image=角色图)`、`scene(out=json,image=场景图)`，`PortValue.meta` 已用于"name/kind 一致性匹配"——Elements 库（`elements:library`）是其增量沉淀，不破坏 executor 语义。

| 它怎么做 | 我们采用什么 |
|---|---|
| **四类 typed Element**（Character/Location/Object/Other），类型决定字段（仅 Character 带 voice）。 | 判别联合 `kind: 'character'\|'scene'\|'object'\|'style'\|'other'`。公共字段 `{id, kind, name(@handle), refImages: assetId[], description, tags, thumbnail}`；角色加 `voiceId`，场景加 `lighting/timeOfDay`。复用现有 `character`/`scene` 的 json 输出结构。 |
| **双创建入口**：主动「New Element」+ 机会式「Save as Element」（从生成结果提升）。 | 两个入口都做：素材/Elements 库面板的「新建 Element」；**现有 `character`/`scene` 节点输出上下文菜单加「保存到库」**，把节点 image(`assetId`)+ json + params 提升入 `elements:library`、预填 name/description。后者是库真正被填满的关键。 |
| **多参考图 + 结构化描述做一致性锚**（建议 5–12 张），绑定时同时注入图 + 文本。 | 每个 Element 存 `refImages: assetId[]`（多张）+ 规范化描述。绑定时把参考图（image conditioning）与描述文本一并注入 `ai.images.generate/edit` 请求；杜绝"仅凭描述重生成"。 |
| **@-mention 绑定**：prompt 内输入 @ 唤起搜索下拉，插入 typed token，存为结构化引用 `{elementId, version}`，执行时解析。 | Dock「素材/提示词」标签与节点 prompt 输入支持 @ 自动补全；节点 `params` 存 `ElementRef = {elementId, version}` **引用**而非内联快照。executor 解析期把 Element 的 refImages+description+voiceId 注入请求。 |
| **引用式传播**：改一次 Element，所有 @标记处自动更新（因为存引用非快照）。 | 节点只存 `ElementRef`（`elementId` 引用）；Element 编辑后失效/标脏所有引用节点，并提供「锁定到 v3」版本钉住 + 反向用量图（编辑前看影响面）。 |
| **变体资产**：复制 Element 改单字段（@Sarah_casual / @Sarah_formal），共享面部身份。 | 「复制 Element → 改一字段」生成 base+override 变体；voiceId 随角色绑定流转给下游 `tts` 节点。 |
| **跨工程库 = Brand Kit**：个人 My Assets（默认跨工程）+ 团队 Kit（发布 + 角色权限）；@补全显示来源消歧。 | **采用个人跨工程一层**：素材库（`assets:registry`）与 Elements 库（`elements:library`）存于工程之外的全局命名空间（`storage.set(key, value, 'ai-film-studio')`，与 `project:<id>` 平级、相互独立），任何工程 import-by-reference。**跳过**团队 Kit 的发布/角色/多用户分层——本地单用户无收益。@补全显示来源（库/工程）消歧。 |

**Elements 与叙事树正交**：Element 是横切引用，不嵌套在 scene/shot 下；现有 graph（节点/边）是叙事侧，`elements:library` 是扁平注册表，二者只经 `ElementRef`（`{elementId}`）连接。

> **采纳的关键 pitfall**：(1) 切勿在节点内联 Element 数据——否则丧失传播能力，必须按 `ElementRef` 引用绑定、执行期解析。(2) 单张参考图会漂移，预算多图集。(3) 全局后同名碰撞真实存在，绑定到稳定 id 而非显示名，@补全露出来源。(4) 传播具破坏性，提供版本钉住 + 影响面视图。

---

### 2.4 PromptLayer / Humanloop / Portkey — 片段/变量/版本 diff（→ 提示词库三层覆盖）

> 现状（ground-truth）：提示词为**固定 id 模板**（`text.script`/`image.charImage` 等，promptTemplates.ts），覆盖分散——全局层落默认命名空间键 `afs:promptOverrides`，工程层在 `ProjectData.promptOverrides` 内，`promptStore` 仅内存快照不持久化。本节给出统一的「工程 > 全局 > 默认」覆盖模型 + 可复用片段（`PromptSnippet`，存于 `prompts:snippets`）。

| 它怎么做 | 我们采用什么 |
|---|---|
| **片段 partial**（Portkey `{{>id}}`、PromptLayer `@@@name@@@`）：可复用命名片段独立存储、独立版本，模板内引用而非内联，发布后所有消费者自动更新。 | 把风格/镜头/光照/负面词建为 **`PromptSnippet`**（独立记录、独立版本，持久化于 `prompts:snippets`），固定节点模板内用引用 `{{> camera/low-angle }}` 而非复制文本。**compose 期解析、非 store 期内联**（否则丧失传播 + 无法干净 diff）。 |
| **移动指针 label**（prod/staging）：取模板按 label，改 label 即改生效版本，不改调用方；一 label 对一版本（强制唯一）。 | 三层覆盖 = 别名指针表。节点模板引用稳定逻辑名，各层（默认/全局/工程）各供 `别名→版本` 映射；解析顺序 **工程别名 → 全局别名 → 内置默认**。"恢复默认" = 删工程别名条目（干净回退）；强制一别名一版本以保证确定性。 |
| **内容哈希版本 id**（Humanloop）：版本 id 由内容确定性派生，相同内容同 id → 免费去重、幂等导入、可检测"是否被改动"。 | 每个 `PromptSnippet`/模板版本用规范化后内容哈希做 id。未分叉的工程与默认共享同哈希 → 直接驱动三层 UI 的「已覆盖」徽标判定，修复脏标记假阳性。哈希前先 trim/规范化避免空白噪声。 |
| **层级 diff**（绿增/红删，含参数）：选两版本展示词级 diff，连 model/param 改动都进 diff。 | diff 同时覆盖模板文本 + 结构化字段（model/params/片段引用）；关键是**在层边界 diff**——「工程层 vs 它覆盖的全局/默认」，一眼看清本工程改了什么。恢复 = 把别名指回父层（非破坏性）。 |
| **`.prompt` 文件 + 三目录覆盖**：单文件 YAML frontmatter + 消息体，可入 Git；三层 = 三目录叠放，最高层有文件者胜，删文件即回退。 | 库结构硬拆分：`prompts:snippets` 下 `{style,camera,lighting,negative}/` 片段树（`PromptSnippet`，永不作为终态节点渲染）+ `nodes/` 固定模板树。三层映射：内置默认（随插件只读）< 全局（`'ai-film-studio'` 命名空间下 `prompts:snippets`） < 工程（`project:<id>` 内 `promptOverrides`）。导入/导出 = 拷文件/JSON。 |

> **采纳的关键 pitfall**：(1) store 期 vs compose 期替换——必须 compose 期解析，否则改 `PromptSnippet` 不传播。(2) 移动 label 须一别名一版本，否则三层解析非确定。(3) 未钉住的 latest 引用会让消费者静默变动——提供 per-reference 钉版（`{{> camera/low-angle@3 }}`）。(4) 片段命名空间与节点模板命名空间不可混用。(5) 加循环检测 + 最大引用深度。(6) 选定单一占位符语法（`{{var}}` 变量 + `{{> name }}` 引用），避免分隔符漂移。

---

### 2.5 桌面创作应用 IA — rail + 多界面 + 卡片仪表盘（→ 整体重构外壳）

> 直接支撑「~56px rail + 工程主页/画布编辑器/素材库/提示词库/设置 一级界面」的决策。现状（ground-truth styles.css）：`.afs-app` 列向、`.afs-app__left` 固定 240px = NodeLibrary、`.afs-app__center` = FlowCanvas、`.afs-app__right` 286px = Inspector、`.afs-toolbar` 48px。

| 它怎么做 | 我们采用什么 |
|---|---|
| **双层左导**：固定图标 rail（Material 80dp / app-shell 64px，3–7 目的地）+ 相邻可折叠二级面板（240–260px）。rail 是唯一"我在哪个 surface"真相。 | 新增 ~56px 图标 rail（**新增** `src/ui/components/AppRail.tsx`），承载 5 个一级界面：工程主页 / 画布编辑器 / 素材库 / 提示词库 / 设置。1400px 下：rail 56 + 二级面板 ~240 留 ~1080 内容。 |
| **整面切换 = 替换中心视图并重配 chrome**（Figma 模式、Penpot Dashboard↔Editor），每 surface 自带 dock 布局，不堆模态。 | 每个一级界面是拥有自己 dock 配置的路由：工程主页（卡片、无编辑器面板）与画布编辑器（画布 + 左 Dock 三标签 + 右 Inspector）各自声明布局。把现有 `App.tsx` 外壳从"单刚性 frame"改为按 surface 切换。 |
| **封面缩略卡片仪表盘**：`auto-fit, minmax(240–280px,1fr)` 流式栅格，卡片含 16:9 封面 + 标题 + 时间 + 状态徽标 + 悬浮省略号菜单；顶部排序/筛选 + 显著「新建」。 | 工程主页 = 工程卡片网格（数据源 `projects:index` 的 `ProjectMeta`），封面取工程输出帧（对接 §2.1 cover），卡片菜单含 Open/Rename/Duplicate/Delete（复用现有 `newProject/renameProject/deleteProject`，并补 Duplicate）。1100px 最小窗优雅降到 2–3 列。 |
| **可折叠 dock 回收画布**（Figma Minimize UI、Linear `[`）：左右面板独立折叠/可调宽/记忆宽度；rail 始终可见。 | 画布编辑器内左 Dock（节点\|素材\|提示词三标签）与右 Inspector 独立折叠，宽度持久化。**rail 本身永不折叠**（唯一回程锚点）。提供 focus/zen 一键隐双 dock。 |
| **约束窗的响应式 = 重排折叠而非移动断点**（1100–1400px 全程算桌面，用 auto-fit/minmax + 弹性面板，不引入移动底导/抽屉）。 | 目标 1400×900、最小 1100×720：≤~1200px 自动折叠二级面板/右 dock 保画布可用；卡片栅格用 auto-fit 平滑重排，不用硬媒体断点。持久化最近活动 surface 与各面板宽度（修正现状状态不持久化）。 |

> **采纳的关键 pitfall**：(1) 别把"一级 surface 切换"与"界面内导航"混在一张扁平侧栏——rail 管 surface、二级面板管界面内。(2) 1100px 下 rail56 + 面板260 + 右 dock280 只剩 ~500px 画布太挤——须自动折叠二级面板/右 dock。(3) 卡片栅格用 auto-fit/minmax 而非硬断点。(4) rail 不可隐（唯一回程锚点），折叠的是二级面板与侧 dock。(5) 持久化面板宽度/折叠态与最近 surface，否则每次启动重置像坏掉。

---

### 参考

InvokeAI（Boards/Assets/虚拟板/计数优化/归档/GC）:
- https://invoke.ai/features/gallery/
- https://support.invoke.ai/support/solutions/articles/151000170653-creating-and-managing-boards
- https://support.invoke.ai/support/solutions/articles/151000201744-using-sketches-and-reference-images
- https://raw.githubusercontent.com/invoke-ai/InvokeAI/main/invokeai/app/services/image_records/image_records_common.py
- https://raw.githubusercontent.com/invoke-ai/InvokeAI/main/invokeai/app/services/board_records/board_records_common.py
- https://raw.githubusercontent.com/invoke-ai/InvokeAI/main/invokeai/app/services/board_image_records/board_image_records_sqlite.py
- https://github.com/invoke-ai/InvokeAI/pull/6931
- https://github.com/invoke-ai/InvokeAI/pull/6546
- https://github.com/invoke-ai/InvokeAI/issues/8902
- https://invoke.ai/releases/version/v6-12-0/
- https://invoke-ai.github.io/InvokeAI/features/database/

ComfyUI（workspace/收藏/folders/输出浏览器/侧栏机制）:
- https://github.com/11cafe/comfyui-workspace-manager
- https://github.com/ketle-man/ComfyUI-Workflow-Studio
- https://github.com/cillyfly/inner-comfyui-browser
- https://github.com/Nuked88/ComfyUI-N-Sidebar/blob/main/README.md
- https://github.com/Comfy-Org/ComfyUI_frontend/issues/3560
- https://github.com/Comfy-Org/ComfyUI/issues/10225
- https://forum.comfy.org/t/grouped-workflows-and-comfyui-examples-in-app/1041
- https://github.com/biagiomaf/smart-comfyui-gallery
- https://deepwiki.com/Comfy-Org/ComfyUI_frontend/4.4-workflow-tabs-and-management
- https://docs.comfy.org/interface/features/template

LTX Studio Elements（全局角色/场景库 + @绑定 + Brand Kit）:
- https://ltx.io/blog/top-ltx-studio-features
- https://ltx.io/blog/how-to-create-a-consistent-character
- https://ltx.io/studio/platform/ai-storyboard-generator
- https://ltx.io/blog/introducing-projects
- https://ltx.io/blog/introducing-brand-kit-in-ltx-studio

PromptLayer / Humanloop / Portkey（片段/label/版本哈希/diff/.prompt）:
- https://docs.promptlayer.com/features/prompt-registry/snippets
- https://docs.promptlayer.com/features/prompt-registry/overview
- https://portkey.ai/docs/product/prompt-engineering-studio/prompt-partial
- https://humanloop.com/docs/prompt-management
- https://humanloop.com/docs/v5/guides/evals/comparing-prompts
- https://humanloop.com/docs/reference/prompt-file-format
- https://snippetsai.mintlify.app/essentials/reusable-snippets

桌面创作应用 IA（rail + 多界面 + 卡片仪表盘 + 响应式）:
- https://help.figma.com/hc/en-us/articles/23954856027159-Navigating-UI3
- https://linear.app/now/how-we-redesigned-the-linear-ui
- https://help.penpot.app/user-guide/the-interface/
- https://helpx.adobe.com/nz/creative-cloud/help/creative-cloud-desktop-app-home-screen.html
- https://m3.material.io/components/navigation-rail/guidelines
- https://www.shadcnblocks.com/block/application-shell12
- https://cr0x.net/en/card-grid-auto-fit-minmax/

## 3. 信息架构与布局（整体重构）

### 3.1 现状与目标

**现状（ground-truth）**：`App.tsx` 是单一编辑器视图——`div.afs-app`（纵向 flex）= `Toolbar`(48px) + `div.afs-app__body`(横向 flex)，body 内三栏：`aside.afs-app__left`(240px, `NodeLibrary`) + `main.afs-app__center`(flex, `FlowCanvas`) + `aside.afs-app__right`(286px, `Inspector`)。没有一级界面概念——工程切换/模板/全局/提示词/供应商全部塞在 `Toolbar` 与模态框里，素材与角色/场景没有独立界面。

**目标**：把"工程主页 / 画布编辑器 / 素材库 / 提示词库 / 设置"提升为**五个一级界面（surface）**，由一条 `~56px` 的图标导航栏（rail）切换；编辑器界面内保留并改造现有的 Dock / Canvas / Inspector 三栏。这是一次整体重构，但**编辑器界面 = 现有 `afs-app__left`/`__center`/`__right` 的演进**，复用既有组件与样式，不推倒重来。

### 3.2 顶层界面状态机

界面切换在 `App.tsx` 顶层用一个 `view` 状态驱动（**不引入路由库**，保持插件零依赖）。每个一级界面**独占 body 区**并声明自己的内部布局——主页/库/设置是单面板，编辑器是三栏 Dock/Canvas/Inspector。Rail 是"我在哪个界面"的唯一真相源，始终可见、不可隐藏。

```ts
// App.tsx (新增顶层状态)
type AppView = 'home' | 'editor' | 'assets' | 'prompts' | 'settings'
const [view, setView] = useState<AppView>('home')   // 启动落在工程主页
// 持久化：裸键 lastView 存于 namespace 'ai-film-studio'，重开窗口恢复上次界面
// （沿用既有 selectedModel 同款约定：裸键 + 'ai-film-studio' namespace；
//   不复制历史遗留的 afs:promptOverrides 那种写进默认 namespace 的写法）
```

| view | 图标 | 一级界面 | body 内部布局 | 复用 / 新增组件 |
|------|------|----------|----------------|------------------|
| `home` | 🏠 | 工程主页 | 单面板：工程封面卡片网格 | `ProjectHome` (新增) |
| `editor` | 🎬 | 画布编辑器 | Dock + Canvas + Inspector 三栏 | `EditorView` (新增壳) 包 `WorkbenchDock`(新增) / `FlowCanvas`(复用) / `Inspector`(复用) |
| `assets` | 🖼 | 素材库 | 单面板：响应式素材网格 + 详情侧栏 | `AssetLibrary` (新增) |
| `prompts` | 💬 | 提示词库 | 单面板：模板/片段列表 + 编辑器 | `PromptLibrary` (新增) |
| `settings` | ⚙ | 设置 | 单面板：分组设置（供应商/全局/模型/缓存） | 复用 `ProviderSettings`/`GlobalSettings`/`PromptSettings` 内容，从模态改为内嵌面板 |

要点：

- **界面 = 整个 body 替换**，而非模态叠加。从主页打开一个工程 → `switchProject(id)` 后 `setView('editor')`；编辑器里点 rail 的 🖼 → 切到素材库且画布状态不丢（store 常驻，不卸载 `FlowCanvas` 的 graph 状态，仅切换可见 view）。
- **`Toolbar`(48px) 收窄为编辑器界面专属顶栏**：仅保留 run/stop、保存、模型/imageModel 选择、模板插入、导入导出。工程切换/新建/重命名移到主页，全局/提示词/供应商移到设置界面。其余界面顶部用各自的轻量标题条。

### 3.3 编辑器界面：Dock 三标签 + Inspector

编辑器界面把现有左栏 `NodeLibrary` 升级为**带三个标签的 Workbench Dock**，右栏沿用 `Inspector`：

| Dock 标签 | 内容 | 拖入画布行为 | 数据来源 |
|-----------|------|--------------|----------|
| **节点** | 现 `NodeLibrary` 的分类节点列表（`CATEGORY_ORDER`/`CATEGORY_META`） | 复用现有 `DND_MIME='application/afs-node'`，drop → `addNode` | `nodeDefs.ts` 静态定义 |
| **素材** | 全局素材库缩略图（懒加载） | drop → 新建对应输入节点（image→image-input / video / audio）并把 `assetId` 写入其 `outputs` 的 `PortValue` | 全局素材库 `AssetRecord`（存储键 `assets:registry`，Phase 2，跨工程共享） |
| **提示词** | 角色/场景 Elements + 提示词片段 | drop 角色/场景 → 新建 `character`/`scene` 节点并绑定 Element 引用；drop 片段 → 插入到选中节点的 prompt 参数 | 角色/场景 `ElementRef`（`elements:library`，Phase 2）+ 提示词片段 `PromptSnippet`（`prompts:snippets`，Phase 3） |

- 三标签各自有独立的 DND mime（`application/afs-asset`、`application/afs-element`、`application/afs-snippet`），`FlowCanvas` 的 `onDrop` 按 mime 分派；产物节点全部走现有 `PortValue`/executor 语义，库为增量，不改节点契约。
- Dock 顶部一行标签（节点｜素材｜提示词），下方为对应面板内容；标签状态以裸键 `dockTab` 持久化于 namespace `'ai-film-studio'`。

### 3.4 ASCII 线框图

```
┌────┬──────────────────────────────────────────────────────────────────────┐
│    │  afs-toolbar (48px)  [▶运行][■停止] [💾] [模型▾][图像模型▾] [模板▾] [⇅] │
│ R  ├──────────────┬───────────────────────────────────────┬───────────────┤
│ A  │ WorkbenchDock │              FlowCanvas               │   Inspector   │
│ I  │   (240px)     │                (flex)                 │    (286px)    │
│ L  │ ┌──┬───┬────┐ │                                       │ ┌───────────┐ │
│    │ │节│素 │提示│ │        ●───────●                      │ │ 参数 / 模型│ │
│ 🏠 │ │点│材 │ 词 │ │       (story)  (script-gen)           │ │ /provider │ │
│ 🎬 │ ├──┴───┴────┤ │              ╲                        │ │  覆盖      │ │
│ 🖼 │ │ ▦ 输入     │ │               ●───────●               │ ├───────────┤ │
│ 💬 │ │ ▦ 文本     │ │            (storyboard)(keyframe)     │ │ 运行此节点 │ │
│ ⚙ │ │ ▦ 图像     │ │  ┄┄拖入┄┄►  ○ (drop=addNode/         │ │ /从此运行 │ │
│    │ │ ▦ 视频     │ │             绑定 Element/assetId)     │ ├───────────┤ │
│ ·· │ │ ▦ 音频     │ │                                       │ │ OutputView│ │
│    │ │ ▦ 输出     │ │           [画布平移/缩放]             │ │  画廊      │ │
│    │ └───────────┘ │                                       │ └───────────┘ │
│    │  «折叠 [        │                                       │  隐藏 ]»      │
└────┴──────────────┴───────────────────────────────────────┴───────────────┘
  ↑rail ~56px        ↑Dock 可折叠到 0/图标            ↑Inspector 可隐(286→0)
  五个一级图标，🎬高亮=当前编辑器界面；rail 始终可见，永不隐藏
```

工程主页 / 素材库等单面板界面则只保留 rail + 顶部标题条 + 单一内容区（卡片/网格），不渲染 Dock 与 Inspector：

```
┌────┬──────────────────────────────────────────────────────────────────────┐
│ R  │  工程主页              [排序▾][筛选▾]               [＋ 新建工程]        │
│ A  ├──────────────────────────────────────────────────────────────────────┤
│ I  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│ L  │  │ 封面16:9 │  │ 封面16:9 │  │ 封面16:9 │  │ 封面16:9 │   响应式网格   │
│ 🏠*│  │ 工程A   ⋯│  │ 工程B   ⋯│  │ 工程C   ⋯│  │ ＋空卡   │   auto-fill   │
│ 🎬 │  └──────────┘  └──────────┘  └──────────┘  └──────────┘   minmax(240) │
│ .. │                                                                        │
└────┴──────────────────────────────────────────────────────────────────────┘
```

### 3.5 响应式与可折叠

窗口 `minWidth: 1100`（manifest.json：`width: 1400` / `height: 900` / `minWidth: 1100`；插件运行于 Electron 窗口，无移动端；整个 1100–1400px 是连续的"桌面区间"，**靠折叠/重排降级，不引入移动端导航范式**）。

| 区域 | 宽度 | 折叠/隐藏 | 持久化键（namespace 'ai-film-studio'，裸键） |
|------|------|-----------|----------|
| rail | `~56px` 固定 | **永不折叠**（锚点，唯一回到其它界面的入口） | — |
| WorkbenchDock | `240px` | 可折叠（chevron / `[` 快捷键）→ 收到图标条或 0 | `dockCollapsed` |
| FlowCanvas | flex（撑满剩余） | — | viewport 由工程存储拆分章负责（`project:<id>` 重型 graph 所有） |
| Inspector | `286px` | 可隐藏（chevron / `]`）→ 0 | `inspectorHidden` |
| 库网格（主页/素材） | 流式 | 列数随容器重排 | — |

降级策略：

```css
/* 1100px 最小窗口：rail 56 + Dock 240 + Inspector 286 ⇒ 画布仅 ~518px，偏窄 */
@media (max-width: 1200px) {
  .afs-app__left { width: 64px; }        /* Dock 自动收为图标条，腾出画布 */
}
/* 库网格用响应式网格，而非硬断点：1080px 内容宽≈3–4 列，780px≈2–3 列 */
.afs-grid { display: grid; gap: 12px;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
```

- **不用硬像素断点切换卡片列数**——在可连续缩放的 Electron 窗口里 `auto-fill/minmax` 平滑重排，避免半空末行与死区。卡片缩到 ~240px 即停止收缩、改为减列。
- **Dock 与 Inspector 宽度/折叠态持久化**（裸键 `dockCollapsed`/`inspectorHidden`，namespace `'ai-film-studio'`），重开窗口恢复，避免"每次启动 dock 复位"的破碎感。
- **`lastView`、`dockTab` 同样持久化**（裸键，namespace `'ai-film-studio'`）——重开恢复上次所在界面与 Dock 标签。

### 3.6 CSS 骨架改造（增量）

在现有 `styles.css`（shell 段 48–140 行）基础上**新增 rail 层、保留三栏类名语义**：

```css
.afs-app { display: flex; flex-direction: column; height: 100%; }
.afs-app__shell { flex: 1; display: flex; min-height: 0; }   /* 新增：rail + 界面容器 */
.afs-rail { width: 56px; flex-shrink: 0; display: flex; flex-direction: column;
  align-items: center; gap: 4px; padding: 8px 0;
  border-right: 1px solid var(--afs-border); background: var(--afs-panel); }
.afs-rail__item { /* 56x44 图标按钮，hover 显示文字 tooltip */ }
.afs-rail__item--active { /* 左侧高亮条 + accent 色 */ }
.afs-view { flex: 1; min-width: 0; display: flex; flex-direction: column; }

/* 编辑器界面：复用现有三栏语义，afs-app__left 即 WorkbenchDock 容器 */
.afs-app__body  { flex: 1; display: flex; min-height: 0; }    /* 不变 */
.afs-app__left  { width: 240px; flex-shrink: 0; … }           /* 不变；折叠时改宽 */
.afs-app__center{ flex: 1; position: relative; min-width: 0; }/* 不变 */
.afs-app__right { width: 286px; flex-shrink: 0; … }           /* 不变；隐藏时 width:0 */
```

`Toolbar`(48px)、`afs-loading`、三栏类名与现有样式保持兼容；rail 与各单面板界面为纯增量层，不破坏既有编辑器 DOM 结构。

## 4. 数据模型 / 存储 / 迁移

本章定义重构后所有持久化数据结构与存储键映射。**所有改动均为增量**：不修改 `PortValue`、不修改 executor、不修改任何节点 `kind` 的语义；现有 `FilmNode`/`FilmNodeData`/`PortValue` 原样保留，新结构以"旁路注册表"形式叠加。本章只引出存储键的变更，**具体迁移逻辑（一次性搬迁、幂等、回滚、孤儿 GC）在第 9 节细化**。

### 4.1 设计原则

| 原则 | 说明 |
| --- | --- |
| 增量不破坏 | `PortValue`（`graphStore.ts:31-47`）与 `FilmNodeData`（`graphStore.ts:49-60`）字段一字不改；新注册表通过 `assetId`/`elementId` 与节点弱关联。 |
| 二进制走旧路 | 媒体二进制写入**仍**只走 `storage.attachment.put`（读取走 `get`/`getType`、删除走 `remove`，见 `services/assets.ts`）。`loadAsset` 中的旧 KV 回退是**只读**兼容路径（`attachment.get` 取不到时回退 `storage.get(id)` 读迁移前的旧版 base64 KV）；写入端从不落 KV。注册表只存元数据，**绝不**复制 base64。 |
| 引用不内联 | Elements / Snippets 绑定一律存 `id`（+ 可选 version），执行/渲染时再解析（参考 LTX「update once, propagate everywhere」、PromptLayer compose-time 解析）。 |
| 全局共享 | 素材库、角色/场景库为跨工程注册表，不归属任何 `project:<id>`。 |
| 懒加载 | 重型 `graph`（nodes/edges）按需读 `project:<id>`，列表页只读 `projects:index`。 |
| 仅用确认 API | 只使用 ground-truth `hostApis` 中列出的 `storage.*` / `storage.attachment.*`，不发明新宿主能力。 |

### 4.2 TypeScript 接口

> 建议落位：`src/ui/types/registry.ts` **(新增)**。`ProjectMeta`/`ProjectData` 仍由 `graphStore.ts` 持有，仅扩展字段。

#### 4.2.1 扩展后的 `ProjectMeta` / `ProjectData`

```ts
// graphStore.ts —— 现有定义扩展（新增字段全部可选，旧数据零成本兼容）
export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  // —— 新增（均可选）——
  coverAssetId?: string;   // 封面缩略图，指向 AssetRecord.id（= storage.attachment id）
  description?: string;    // 工程描述，主页卡片副标题
  tags?: string[];         // 跨工程标签筛选
  favorite?: boolean;      // 收藏置顶（主页 ORDER BY favorite DESC, updatedAt DESC）
  nodeCount?: number;      // 冗余计数，主页卡片角标，无需懒加载 graph 即可显示
}

// ProjectData 维持 extends ProjectMeta，graph 字段不变
export interface ProjectData extends ProjectMeta {
  nodes: FilmNode[];
  edges: Edge[];
  viewport?: { x: number; y: number; zoom: number }; // 目标设计字段：现状 saveProject 未写、加载未恢复（§gaps），本期补齐持久化，详见 §9
  globals?: ProjectGlobals;            // { aspectRatio, style } 不变
  promptOverrides?: Record<string, string>;
}
```

> `nodeCount`/`coverAssetId` 为冗余字段，由 `saveProject` 写入时一并刷新（详见 4.4）；主页列表读 `projects:index` 即可渲染卡片，无需触碰重型 `graph`。

#### 4.2.2 `AssetRecord` —— 全局素材注册表

```ts
// registry.ts (新增)
export type AssetRole = 'generated' | 'uploaded' | 'character' | 'scene';

// 素材永远对应一份 storage.attachment 二进制，仅可能是媒体类型；
// 复用 PortType 的媒体子集，不另造枚举（text/json/any 不可能成为附件资产）
export type MediaType = Extract<PortType, 'image' | 'video' | 'audio'>;

export interface AssetRecord {
  id: string;            // = assetId，等同 storage.attachment 的 id（'a_'+nanoid(10)）
  type: MediaType;       // 'image' | 'video' | 'audio'（PortType 媒体子集，不含 text/json/any）
  mime: string;          // 'image/png' | 'video/mp4' | 'audio/mpeg' ...
  name: string;          // 显示名（默认取自 source.nodeKind + 序号，可重命名）
  tags: string[];
  width?: number;
  height?: number;
  bytes?: number;        // 二进制大小，库内排序/配额展示
  durationSec?: number;  // 视频/音频时长，镜像 PortValue.durationSec
  role: AssetRole;       // 双轴之一：来源/用途；驱动「生成 | 素材」分页（参考 InvokeAI）
  source: {
    nodeKind: string;    // 产出该资产的节点 kind（如 'i2v' / 'image-input'）
    projectId: string;   // 产出时所属工程（仅溯源，不限制复用）
  };
  createdAt: number;
}
```

要点：
- `id` **就是** `storage.attachment` 的 id，注册表与二进制天然对齐，无需第二套寻址。
- `type` 收窄为 `PortType` 的媒体子集（`image`/`video`/`audio`），与"AssetRecord 永远是一份附件二进制"的语义一致；**不另造枚举**，仍复用 `PortType`，只是排除 `text`/`json`/`any`。
- `role` 借鉴 InvokeAI「provenance × function 双轴」：`generated` 落「生成」分页，`uploaded|character|scene` 落「素材/角色/场景」分页；不与 `type`（媒体格式）混淆。
- `source.projectId` 仅作溯源，**不**约束复用——任何工程的节点都可消费任意 `AssetRecord`（全局共享）。

#### 4.2.3 `ElementRef` —— 全局角色/场景库

```ts
// registry.ts (新增)
export interface ElementRef {
  id: string;                 // 'el_'+nanoid(10)
  kind: 'character' | 'scene';// 与现有 character/scene 节点对齐；预留扩展不在本期
  name: string;               // @handle 显示名 / 唯一性见 §9 迁移与去重
  identity: string;           // 结构化描述（外貌/服装/场景/光线），随绑定注入 prompt
  refAssetIds: string[];      // 多张参考图（LTX 建议 5–12 张），元素均指向 AssetRecord.id
  prompt?: string;            // 该元素的画像/场景默认提示词
  tags: string[];
}
```

要点：
- 与现有 `character`(out=json,image=角色图) / `scene`(out=json,image=场景图) 节点**语义对齐**：从节点「保存到库」即把节点输出图的 `assetId` 收进 `refAssetIds`、`params` 文本收进 `identity`/`prompt`。
- 绑定到画布时只写 `elementId`（不内联 identity/图）；执行期解析为 `refAssetIds`(→ attachment) + `identity`/`prompt` 注入。绑定载体复用 `FilmNodeData.params` 或 `PortValue.meta`（现已用于 character/scene 一致性匹配），**不改 PortValue 结构**。
- `refAssetIds` 复用 `AssetRecord`，参考图与普通素材同一存储，生成帧可直接转为参考图（零拷贝）。

#### 4.2.4 `PromptSnippet` —— 可复用提示词片段

```ts
// registry.ts (新增)
export type SnippetGroup = 'style' | 'camera' | 'lighting' | 'negative' | 'custom';
export type SnippetScope = 'global' | 'project';

export interface PromptSnippet {
  id: string;                       // 'sn_'+nanoid(10)
  name: string;
  group: SnippetGroup;              // 决定分类/插入器分组
  text: string;                     // 片段正文，含 {{var}} 占位
  vars?: Record<string, string>;    // 占位默认值（参数化片段，避免为微调而分叉）
  scope: SnippetScope;              // global 进 prompts:snippets；project 进 project:<id>
}
```

要点：
- `PromptSnippet` 与现有 `promptStore` 的**三层模板覆盖**（project > global > 默认 `promptTemplates.ts` 固定 id）**正交**：固定节点模板仍走 `getPrompt`/`promptOverrides` 不变；Snippet 是用户可组合的「片段库」，由 Dock「提示词」标签插入到 prompt 文本。
- `scope='global'` 持久化进 `prompts:snippets`；`scope='project'` 随 `project:<id>` 走（不污染全局命名空间）。
- 占位语法统一 `{{var}}`，与未来的 include 机制（如 `{{> camera/low-angle }}`）保留区分空间；本期仅做 `vars` 文本替换，不实现跨片段 include。

### 4.3 存储键映射表

命名空间统一沿用现有 `'ai-film-studio'`（与 `graphStore`/`providerStore` 一致）。媒体二进制不占 KV，走 attachment。

| 逻辑数据 | 存储键 | 命名空间 | 读写宿主 API | 载荷类型 | 加载策略 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 工程索引（仅 Meta） | `projects:index` | `ai-film-studio` | `storage.get/set` | `ProjectMeta[]` | 启动即读（轻量） | **新增（替换 `projects`）** |
| 单工程重型图 | `project:<id>` | `ai-film-studio` | `storage.get/set/remove` | `Omit<ProjectData,keyof ProjectMeta>`（nodes/edges/viewport†/globals/promptOverrides） + project-scope snippets | **懒加载**（打开/切换时） | **新增** |
| 当前工程指针 | `currentProjectId` | `ai-film-studio` | `storage.get/set` | `string` | 启动即读 | 不变 |
| 素材注册表 | `assets:registry` | `ai-film-studio` | `storage.get/set` | `AssetRecord[]` | 进素材库/Dock 时读 | **新增** |
| 角色/场景库 | `elements:library` | `ai-film-studio` | `storage.get/set` | `ElementRef[]` | 进库/Dock 时读 | **新增** |
| 全局提示词片段 | `prompts:snippets` | `ai-film-studio` | `storage.get/set` | `PromptSnippet[]`（`scope:'global'`） | 进库/Dock 时读 | **新增** |
| 全局模板覆盖层 | `afs:promptOverrides` | **default**（现状） | `storage.get/set` | `Record<string,string>` | `loadPrompts`（App 包装，内部 `promptStore.loadGlobal`） | 不变（§9 标注命名空间不一致） |
| 媒体供应商 | `videoProviders` | `ai-film-studio` | `storage.get/set` | provider[]（旧键名，承载全部媒体供应商） | `loadProviders` | 不变 |
| 能力默认供应商 | `mediaDefaults` | `ai-film-studio` | `storage.get/set` | map | `loadProviders` | 不变 |
| 模型选择 | `selectedModel` / `selectedImageModel` | `ai-film-studio` | `storage.get/set` | `string` | 启动即读 | 不变 |
| API Key | `k_<providerId>` | （宿主隔离） | `storage.encrypted.*` | `string` | 按需 | 不变 |
| **媒体二进制** | `<assetId>` | （attachment 域） | `storage.attachment.put/get/getType/remove`/`list` | bytes + mime | 按 assetId 即时 | 不变 |

> † `viewport` 为目标设计字段：现状 `saveProject` 不写、加载/切换不恢复（见 §gaps），本期随存储拆分一并补齐持久化（画布平移/缩放恢复），细化见 §9。

> 关键变更只有一处：**单键 `projects`（`ProjectData[]`，`KEY_PROJECTS='projects'`，namespace `ai-film-studio`）拆为 `projects:index`（`ProjectMeta[]`）+ N×`project:<id>`（重型图）**。其余键全部维持现状。

### 4.4 拆分后的读写契约（约束，不含迁移实现）

明确各 store 方法在新键结构下的读写边界，迁移代码见 §9：

- **`init` / 主页列表**：仅 `storage.get('projects:index')` → 渲染卡片（`name`/`coverAssetId`/`nodeCount`/`favorite`/`updatedAt`）。**不**读任何 `project:<id>`。
- **`switchProject(id)` / 打开工程**：读 `project:<id>` 注水 graph；写回 `currentProjectId`。
- **`saveProject`**：写 `project:<id>`（重型图），并**同步刷新** `projects:index` 中该条 Meta 的 `updatedAt`/`nodeCount`/`coverAssetId`。
  > 缓解现状 race（§gaps：`saveProject` 全量读改写 `projects`）：拆分后写操作收敛到**单个** `project:<id>`，仅 Meta 的轻量更新触碰 `projects:index`，竞争面大幅缩小（彻底串行化方案见 §9）。
- **`newProject`**：向 `projects:index` 追加一条 Meta + 写空 `project:<id>`。
- **`deleteProject`**：从 `projects:index` 移除 Meta + `storage.remove('project:<id>')`；该工程**独占**的 attachment 资产清理走 §9 的孤儿 GC（`storage.attachment.list` + `remove`，现状从未调用，见 §gaps 存储泄漏）。
- **`importProject`**：改为**新建** `project:<id>` + 追加 Meta（修正现状「覆盖当前工程」缺陷，详见 §9），不再原地覆写。
- **素材/角色/Snippet 写入**：`assets:registry` / `elements:library` / `prompts:snippets` 各自独立读改写，与工程存储解耦，互不阻塞。

### 4.5 对现有语义的影响声明

| 关注点 | 影响 | 说明 |
| --- | --- | --- |
| `PortValue` | 无 | 字段不增不改；Elements 绑定复用 `params`/`meta`。 |
| executor / `runNode`/`runFrom`/`runAll` | 无 | 仍消费 `PortValue.assetId` → attachment；注册表旁路，不进执行路径。 |
| 节点 `kind` 语义 | 无 | character/scene/i2v/... 全部不变；「保存到库」是读取节点输出的新动作，不改节点定义。 |
| `services/assets.ts` | 仅新增调用 | `saveAsset` 后**额外**写一条 `AssetRecord` 进 `assets:registry`；`deleteAsset`（`assets.ts:72`，现状从未调用）在 §9 GC 中被启用。`saveAsset`/`loadAsset`/`deleteAsset` 本身签名不变。 |
| 旧 `projects` 单键 | 一次性迁移后废弃 | 迁移成 `projects:index` + `project:<id>`，迁移与回滚见 §9。 |


## 5. 工程管理（Projects）需求

> 本章定义"工程"作为一级界面（rail 入口）的完整需求。工程主页（Project Home）是与画布编辑器并列的独立 surface，承担"打开/管理/新建"职责；画布编辑器只负责"编辑一个已打开工程"。所有需求按 P0/P1/P2 分级，P0 为本次重构必须交付。
>
> 本章贯穿**决策 3（Phase 1 即执行工程存储拆分）**：单键 `projects(ProjectData[])` 拆为 `projects:index(ProjectMeta[])` + `project:<id>(重型 graph)`，懒加载并一次性迁移。其余决策（rail、全局库、Elements）在第 1/2/4/8 章定义，本章仅引用其对工程的接口约束。

### 5.1 现状与差距（ground-truth）

| 能力 | 现状 | 差距 |
|---|---|---|
| 工程切换 | `Toolbar.tsx` 用 `<select onChange=switchProject>` + 内联 rename `<input>` | 无主页、无封面、无搜索/排序、无卡片操作 |
| 存储 | 单键 `projects`（`KEY_PROJECTS`, ns `ai-film-studio`），`saveProject` 读-改-写整数组（`graphStore.ts:1588`） | 全量读写，大工程拖慢每次保存；并发 race（见自动保存章） |
| 删除 | `deleteProject` + `window.confirm`（`Toolbar.tsx:70`）；列表空时自动重建默认工程（`graphStore.ts:1639`） | 用浏览器原生弹窗；唯一工程无法真正删除；**删除泄漏该工程全部 attachment**（`deleteAsset` 定义于 `assets.ts:72` 但全插件从未被调用，见资产 GC 章） |
| 导入 | `importProject` **覆盖当前工程**（`graphStore.ts:1694`），忽略 `data.id/createdAt`；Toolbar 调用未 `await`（`Toolbar.tsx:61`） | 不是"新建一行"，且覆盖会孤儿化旧资产 |
| 导出 | `exportProject` 内联完整 base64 data URL（无 `stripValue`，`graphStore.ts:1711`） | 体积巨大，与持久化表示不对称（`saveProject` 走 `serializeNodes`/`stripValue`，仅存 assetId） |
| 模板 | `templates.ts` 已有 `TEMPLATES` + `instantiateTemplate`；`loadTemplate` **已是"新建独立工程"**（`makeDefaultProject(tpl.name)` + push + 新 currentId，`graphStore.ts:1355`），入口埋在顶栏 `<select>`（`Toolbar.tsx:143`） | 入口不在主页、无可发现的"从模板新建"卡片；行为本身无需修复 |
| viewport | `ProjectData.viewport` 字段存在（`graphStore.ts:89`）但 `saveProject` 从不写入 | 平移/缩放不持久 |

### 5.2 数据模型（存储拆分，Phase 1）

复用现有 `ProjectMeta { id, name, createdAt, updatedAt }` 与 `ProjectData extends ProjectMeta { nodes, edges, viewport?, globals?, promptOverrides? }`，仅扩展 `ProjectMeta`（新增 P0/P1/P2 字段，现有代码尚无这些字段）。

```ts
// 扩展后的索引项（projects:index 中存储），P0 仅前 6 字段；其余为 P1/P2
interface ProjectMeta {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  nodeCount: number        // P0（新增）：冗余存于 index，主页卡片直接读，免懒加载 graph
  coverAssetId?: string    // P0（新增）：自动封面引用（storage.attachment），见 5.4
  starred?: boolean        // P1（新增）
  description?: string     // P1（新增）
  tags?: string[]          // P1（新增）
  coverPinned?: boolean    // P1（新增）：true=用户手动指定封面，自动封面逻辑不再覆盖
  deletedAt?: number       // P2（新增）：软删除时间戳（回收站）
}
```

**存储键（namespace 统一 `ai-film-studio`）：**

| 键 | 内容 | 读写时机 |
|---|---|---|
| `projects:index` | `ProjectMeta[]`（轻量，含 nodeCount/coverAssetId） | 主页加载只读此键；任何工程元信息变更增量更新此键 |
| `project:<id>` | `Omit<ProjectData,keyof ProjectMeta> & { nodes, edges, viewport, globals, promptOverrides }`（重型 graph） | **懒加载**：仅在 `switchProject`/打开工程时读取 |
| `currentProjectId` | 当前打开工程 id（`KEY_CURRENT`，沿用） | 启动恢复上次工程 |

> 约束：主页**绝不**读取任何 `project:<id>`。封面与节点数都来自 `index`，保证 N 个工程的主页是 O(1) KV 读取（对齐桌面工程列表调研结论：单查询列表 + 冗余 count/cover，避免 N+1）。

### 5.3 一次性迁移（Phase 1，幂等）

新增 `migrateProjectsStorage()`（新增函数，建议落在 `graphStore.ts` 或新增 `src/ui/store/projectsMigration.ts`），在 `init()` 早期、`switchProject` 之前调用一次：

```
1. 读 projects:index —— 存在 → 视为已迁移，return（幂等）
2. 读旧键 projects(ProjectData[])：
   for each p:
     - 写 project:<p.id> = { nodes, edges, viewport, globals, promptOverrides }
     - 推 ProjectMeta 进 index：
         nodeCount = p.nodes.length
         coverAssetId = 首个 image/video 输出的 assetId（5.4 规则）
3. 写 projects:index
4. 保留旧键 projects 一个版本周期（只读回退/排障），不立即删除
5. currentProjectId 不变；若指向不存在 id → 取 index 第一项
```

迁移必须在**无 attachment 写入**前提下完成（只搬 KV，不复制二进制；assetId 引用不变）。

### 5.4 自动封面规则

封面 = `coverAssetId`，按以下优先级在保存工程时计算并写回 `index`（除非 `coverPinned`）：

```
1. 若 coverPinned → 保持用户手动封面（P1）
2. 否则取该工程节点中"最近更新的、有 image 输出"的 assetId
   - 优先 output 端口 type==='image' 的 PortValue.assetId（含 items[0]）
   - 次选 video 节点（其产物多为远程/本地 url，无 assetId 时用占位封面）
3. 无任何可视输出 → coverAssetId 留空，卡片渲染占位封面（首字母 + 主题色块）
```

封面图加载走现有 `assets.loadAsset(coverAssetId)` → `toDataUrl`，懒加载 + 失败静默占位（不报错、不写回，与 `hydrateAssets` 一致语义）。

---

### 5.5 P0 —— 必须交付

#### 5.5.1 工程主页（卡片网格）

一级 surface，由 rail "工程"图标进入。布局遵循桌面 IA 调研（≥1100px 窗口，rail 56px + 内容区）：

- **卡片网格**：CSS `repeat(auto-fill, minmax(240px, 1fr))`，随容器宽度回流（1100–1400px 连续区间，不用硬断点）。
- **卡片内容**：
  - 自动封面（16:9，取 `coverAssetId`，无则占位块）
  - 工程名称（单行省略）
  - 更新相对时间（"3 分钟前 / 昨天 / 6 月 10 日"，由 `updatedAt` 计算）
  - 节点数（直接读 `meta.nodeCount`，不加载 graph）
- **顶部操作区**：`新建`、`从模板新建`、按名搜索框、排序下拉。
- **当前打开工程**在卡片上以高亮边框标识。

#### 5.5.2 卡片操作

每张卡片 hover 显示 `⋯` 菜单（以及双击=打开）：

| 操作 | 行为 | 实现约束 |
|---|---|---|
| 打开 | `switchProject(id)` 并切到画布编辑器 surface | 懒加载 `project:<id>` |
| 重命名 | 行内编辑或对话框；写 `meta.name` + `updatedAt`，增量更新 `index` | 复用 `renameProject`，但只改 index 项，不重写整数组 |
| 复制 | 深拷贝 `project:<id>` → 新 `id`/`createdAt`/`updatedAt`，名称加"副本"后缀；推新 `index` 项 | **资产引用保持共享**（assetId 不复制二进制），避免 attachment 膨胀；明确标注"复制共享底层图像引用" |
| 导出 | 导出为单文件 JSON；**修复现状不对称**：导出走 `stripValue`（assetId-only）或显式 inline 模式二选一，默认 assetId-only + 可选"内联媒体"勾选 | 复用 `exportProject`，需新增 strip 逻辑（现状直接 inline base64） |
| 删除 | **真对话框替换 `window.confirm`**（5.5.4） | P0 仅硬删除元数据；attachment GC 由资产章统一处理；删除后从 `index` 移除 + `project:<id>` 删除 |

> **删除语义修正（P0）**：取消"列表空时自动重建默认工程"（现状 `graphStore.ts:1639`）。允许工程数为 0，主页显示空状态 + `新建`。这样唯一工程可被真正删除。

#### 5.5.3 新建 / 从模板新建

| 入口 | 行为 |
|---|---|
| 新建（空白） | 复用 `newProject`，但产出独立 `project:<id>` 行 + `index` 项，**不覆盖当前工程**；创建后切到编辑器 |
| 从模板新建 | 列出 `TEMPLATES`（`templates.ts`，含 `text-to-storyboard / full-pipeline / assets-to-keyframe / clips-to-film`）；选中后 `instantiateTemplate(tpl)` 生成 nodes/edges 并写入**新建**的 `project:<id>`。**注**：现有 `loadTemplate` 已是"新建独立工程"语义（非覆盖当前），本需求只是把入口从顶栏 `<select>` 上移到主页卡片，并对接 `project:<id>` 拆分键 |
| 导入为新工程 | **修复现状**：现状 `importProject` 覆盖当前工程并忽略 `data.id/createdAt`（`graphStore.ts:1694`）；目标改为创建新 `project:<id>`（沿用导入数据的 name/globals/promptOverrides，分配新 id/createdAt），并复用 `reimportAssets` 把内嵌 base64 落地 attachment（与导出对称） |

#### 5.5.4 真对话框（替换 window.confirm）

新增受控确认组件 `<ConfirmDialog>`（新增，`src/ui/components/ConfirmDialog.tsx`），替换 `Toolbar.tsx:70` 的 `window.confirm`。

- 标题/正文/确认按钮文案可配置；危险操作（删除）用红色确认按钮 + 二次说明（"将移除该工程；其生成的图像/视频资产暂保留，由清理任务回收"）。
- 可选：宿主已暴露 `dialog.showMessageBox`（`mulby.d.ts:493-517`）作为备选实现；**默认用应用内 React 对话框**以保证主题一致与可测试，`dialog.showMessageBox` 仅在需系统级模态时使用。

#### 5.5.5 搜索与排序

- **搜索**：仅按工程名子串匹配（`meta.name` `includes`，大小写不敏感）。P0 不做元数据全文检索。
- **排序**：`更新时间↓（默认）` / `创建时间↓` / `名称 A→Z`。排序在 `index` 内存数组上完成，O(n)。
- 搜索 + 排序均不触碰 `project:<id>`。

#### 5.5.6 编辑器顶栏

画布编辑器 surface 顶栏（现 `Toolbar.tsx`）需：

- 显示**当前工程名称**（来自打开的 `meta.name`，可点击进入行内重命名）。
- 提供**返回主页**入口（rail "工程"图标即可达，顶栏额外给一个"← 工程"按钮便于发现）。
- 移除顶栏内的工程切换 `<select>`（`Toolbar.tsx:84-95`，切换收敛到主页）；保留模型/供应商/run 等编辑态控件。

---

### 5.6 P1 —— 增强

| 需求 | 说明 | 数据 |
|---|---|---|
| 收藏星标 + 筛选 | 卡片右上角 ★ 切换 `meta.starred`；主页顶部"全部 / ★ 收藏"筛选 chip；排序时 `starred DESC` 置顶（对齐常见星标置顶模式） | `ProjectMeta.starred` |
| 描述 / 标签 | 工程属性面板编辑 `description` / `tags[]`；标签可作筛选 chip | `description`, `tags[]` |
| 手动改封面 | 从工程内任一 image 输出选为封面，置 `coverPinned=true`，禁用自动封面覆盖 | `coverAssetId`, `coverPinned` |

筛选/标签仍在 `index` 内存层完成，保持主页零 graph 加载。

---

### 5.7 P2 —— 进阶

| 需求 | 说明 | 数据/键 |
|---|---|---|
| 命名快照 / 版本 + 恢复 | 对 `project:<id>` 在保存点创建命名快照；可列出并恢复到某快照 | 新增键 `project:<id>:snapshots`（`{ id, name, createdAt, graphRef }[]`）；快照体取 graph 拷贝，**共享 assetId**（不复制二进制） |
| 回收站 | 删除改为软删除：置 `meta.deletedAt`，从默认列表隐藏；回收站可恢复（清 `deletedAt`）或彻底删除（移除 `project:<id>` + 触发该工程孤儿资产 GC） | `ProjectMeta.deletedAt`（软删除模式） |

> 回收站的"彻底删除"是唯一应触发 attachment 真正回收的工程级路径，需对接资产 GC 章（`storage.attachment.list` + `storage.attachment.remove`，二者均已在宿主暴露但当前全插件未调用）。P0/P1 删除均不删二进制，避免误删被复制工程共享的资产。

---

### 5.8 验收清单（DoD）

- [ ] `projects:index` / `project:<id>` 拆分落地，旧 `projects` 一次性迁移且幂等；主页加载零 `project:<id>` 读取。
- [ ] 主页卡片显示自动封面 / 名称 / 相对时间 / 节点数（节点数读 `meta.nodeCount`）。
- [ ] 卡片五项操作（打开/重命名/复制/导出/删除）可用；删除用 `<ConfirmDialog>`，`window.confirm` 已从 `Toolbar.tsx` 移除。
- [ ] 新建 / 从模板新建 / 导入均创建**新工程行**，不覆盖当前工程；导入与导出表示对称（默认 assetId-only）。
- [ ] 按名搜索 + 三种排序工作正常；唯一工程可被删除（不自动重建默认工程）。
- [ ] 编辑器顶栏显示当前工程名并可返回主页；顶栏工程 `<select>` 已移除。
- [ ] 复制工程不复制 attachment 二进制（assetId 共享），不引入资产膨胀。

---

**本章绑定的源文件（worktree 内）：**

- `src/ui/store/graphStore.ts` —— `newProject`/`saveProject`/`switchProject`/`deleteProject`/`renameProject`/`importProject`/`exportProject`/`loadTemplate`，`ProjectMeta`/`ProjectData`，`serializeNodes`/`stripValue`/`hydrateAssets`/`reimportAssets`。
- `src/ui/components/Toolbar.tsx` —— `window.confirm`（`:70`）、工程切换 `<select>`（`:84`）、模板 `<select>`（`:143`）。
- `src/ui/templates.ts` —— `TEMPLATES`、`instantiateTemplate`。
- `src/ui/services/assets.ts` —— `loadAsset`/`toDataUrl`，`deleteAsset`（`:72`，全插件未调用）。

## 6. 素材库 + 全局角色/场景库（Assets + Elements）需求

本章定义工作台重构中【全局共享、跨工程复用】的两个库（决策2、决策4）：**素材库（Assets）** 与 **角色/场景库（Elements）**。两者均不属于任何单一工程，是 rail 一级界面「素材库」（决策1）与画布内 Dock「素材」标签的数据底座，并通过拖拽 / @-token 落入画布、绑定 `assetId` / `elementId` 后由现有 executor 消费。本章先给数据模型与存储，再分 P0/P1/P2 列需求与验收。

### 6.1 设计原则（贯穿全章）

| 原则 | 说明 | 决策/调研依据 |
|---|---|---|
| 全局优先，工程仅引用 | 库实体存于全局命名空间；工程内的节点只持有 `assetId` / `elementId` 引用，从不内联拷贝二进制或描述 | 决策2/4；LTX「bind by reference，不 inline」 |
| 增量兼容，不改 PortValue 语义 | 库产物注入画布时复用现有 `PortValue.assetId`（图/音）与 `meta`（人物/场景一致性）；executor 无需感知「库」存在 | ground-truth nodeModel |
| 两正交轴：来源 × 角色 | 素材按 `origin`（generated / uploaded）与 `role`（shot / reference / mask / audio…）双轴标注，标签页按 `role` 切分而非来源 | InvokeAI「origin 与 category 分离」 |
| 引用计数即生命周期 | 删除以引用计数 + GC 为准，正式接入从未被调用的 `deleteAsset`，修复 ground-truth 确认的存储泄漏 | ground-truth gap「CONFIRMED STORAGE LEAK」 |
| compose-time 解析 | `elementId` 在节点执行时才解析为 refImages + 描述 + voice，编辑 Element 即时影响所有引用 | LTX「update-once-propagate-everywhere」 |

### 6.2 存储与数据模型（全局命名空间）

复用 ground-truth 已确认的宿主 API：`storage.get/set/remove`（KV）、`storage.attachment.put/get/getType/remove/list`（二进制）。二进制继续走 attachment（与 `assets.ts` 现状一致），索引走 KV。**新增全局 KV 键，均位于 namespace `'ai-film-studio'`**（与 graphStore/providerStore 一致，与 Phase 1 的 `projects:index` / `project:<id>` 拆分并列）：

```text
assets:registry  -> AssetRecord[]   // 素材库索引（不含二进制，二进制在 attachment）
elements:library -> ElementRef[]    // 角色/场景库索引（含 refImage assetId 列表）
```

`AssetRecord`（新增类型，建议 `src/ui/types/library.ts` (新增)）：

```ts
type AssetRole   = 'shot' | 'reference' | 'mask' | 'audio' | 'video' | 'other';
type AssetOrigin = 'generated' | 'uploaded';

interface AssetRecord {
  id: string;            // 复用 assets.ts 的 'a_'+nanoid(10)（即 attachment id 本身）
  name: string;          // 可编辑显示名，默认取生成时间/来源节点 kind
  mime: string;          // image/* | audio/* | video/*
  origin: AssetOrigin;   // 双轴之一：谁产生
  role: AssetRole;       // 双轴之一：充当什么（驱动标签页切分）
  tags: string[];        // 自由标签，搜索用
  sizeBytes?: number;    // 来自 attachment.list() 每项的 size，用于存储占用读数
  durationSec?: number;  // 音/视频
  createdAt: number;
  refCount: number;      // 被画布节点引用次数；GC 依据
  meta?: {               // 自描述 provenance（InvokeAI「metadata embedded」的轻量版）
    sourceNodeKind?: string;   // 由哪个节点 kind 产出
    sourceProjectId?: string;  // 产出工程（仅记录来源，不构成归属）
    prompt?: string;           // 生成提示词
    model?: string;
  };
}
```

`ElementRef`（新增类型）— 角色/场景一致性底座，与素材库同阶段交付（决策4）：

```ts
type ElementKind = 'character' | 'scene';   // P0 仅这两类；object/style 留待后续

interface ElementRef {
  id: string;              // 'e_'+nanoid(10)
  kind: ElementKind;       // 决定插入画布时落 character 还是 scene 节点
  name: string;            // @handle / 显示名（库内唯一性校验，避免同名歧义）
  refImageIds: string[];   // 多张参考图 → 复用 AssetRecord.id（Element 不另存二进制）
  description: string;     // 结构化描述文本（注入 prompt）
  tags: string[];
  createdAt: number;
  updatedAt: number;
  meta?: Record<string, unknown>;  // 注入节点 PortValue.meta（name/kind 一致性匹配，复用现有语义）
}
```

> 设计要点：`ElementRef.refImageIds` 指向 `AssetRecord.id`，即 Element 复用素材库二进制、不重复存储；参考图的 `refCount` 同时计入 Element 引用，保证 GC 不会误删被 Element 占用的图。识别一致性沿用 ground-truth 中 `PortValue.meta`（`name`/`kind`），executor 无需改动。

### 6.3 引用计数与生命周期（修复确认的存储泄漏）

ground-truth 确认：`deleteAsset`（`assets.ts:72`）从未被调用，`storage.attachment.list/remove` 亦未使用，附件写入后永不回收（节点删除、工程删除、输出覆盖、工程切换均泄漏）。本库以**引用计数 + 手动 GC** 终结该问题：

| 事件 | 对引用计数/库的动作 |
|---|---|
| 拖素材入画布 → 生成绑定 `assetId` 的节点 | 该 `AssetRecord.refCount += 1` |
| 删除节点 / `deleteSelected` / 删除工程 | 解析被删节点的 `assetId`，对应 `refCount -= 1`（**不**立即删二进制） |
| 输出覆盖（re-run / edit / regen 铸新 `assetId`） | 旧 id `refCount -= 1`，新产物按需入库（见 6.4 P0 第①条「自动入库」开关） |
| 「清理未引用素材」(GC) | 见下方流程，正式调用 `deleteAsset` |

**GC 流程（手动触发，P0 必交付）：**

```text
1. 读 assets:registry + elements:library，构造“被引用 id 集合”
   = ⋃(所有 project:<id> 节点 outputs/params 中的 assetId)
   ∪ ⋃(elements:library 各 ElementRef.refImageIds)
2. storage.attachment.list() 取磁盘上全部 attachment {id,size}
3. orphan = 磁盘集 − 被引用集 − （可选）registry 中 refCount>0 的保留集
4. 弹确认框（dialog.showMessageBox）列出 orphan 数量与可释放字节
5. 逐个 deleteAsset(id)（attachment.remove + storage.remove），并从 assets:registry 删行
```

> 说明：引用计数为「快路径」UI 读数，`attachment.list` 全盘扫描为「慢路径」真值校正，二者结合既能即时显示又能兜底历史泄漏的孤儿。`refCount` 可能因历史数据不准，故 GC 以 step 1 的全工程实扫为准，不单信 `refCount`。

### 6.4 素材库需求（Assets）

#### P0（必须交付）

| # | 需求 | 关键实现点（仅用已确认 API/文件） |
|---|---|---|
| ① | **网格视图** + 筛选 + 搜索 | `repeat(auto-fill, minmax(180px,1fr))` 缩略图网格；筛选：`role` 标签页（生成/上传由 `origin` 二级 chip）+ mime 类型；搜索：对 `name` + `tags` 做 `includes` 子串匹配（MVP，调研 InvokeAI「LIKE」轻量版） |
| ② | **灯箱 + 元数据面板** | 点击放大预览；侧栏展示 `AssetRecord.meta`（prompt/model/sourceNodeKind）+ 尺寸/时长/创建时间/`refCount` |
| ③ | **上传入库** | `dialog.showOpenDialog` 选文件 → `filesystem.readFile` → `assets.ts:saveAsset(base64,mime)` 得 id → 追加 `AssetRecord{origin:'uploaded'}` 到 `assets:registry` |
| ④ | **拖素材到画布生成绑定节点** | Dock「素材」标签拖出，落点按 mime 新建节点：image→`image-input`、audio→`audio-input`、video→（复用 video 输入语义）；节点 `outputs` 写入 `PortValue{type,assetId,mime}`（**不内联 url**，加载时 hydrate），`refCount += 1` |
| ⑤ | **删除 + 「清理未引用素材」(GC) + 存储占用读数** | 单条删除走引用检查（`refCount>0` 二次确认）；GC 按 6.3 流程；占用读数 = `storage.attachment.list()` 每项 `size` 求和，分「总占用 / 可释放(orphan)」两个数字展示 |

> ④ 的落节点复用现有 `image-input` / `audio-input` 节点 kind 与 `PortValue` 形状，executor 零改动；与 NodeLibrary 现有 `DND_MIME='application/afs-node'` 并存，素材拖拽用独立 mime（如 `application/afs-asset`）以便落点逻辑区分。

#### P1

- **Boards / 合集分组**：在 `AssetRecord` 增 `boardId?`，采用**多对多以外的轻量 home-board**（单归属 + 始终存在的「未分组」虚拟桶）；显式规避 InvokeAI 单 board 强约束对「一张参考图跨多场景复用」的伤害——跨用引用仍由 `refCount` 表达，board 仅作组织视图。
- **去重**：入库时对二进制做 hash（如 sha-256 of bytes），命中已存在 id 则复用、不新建 attachment（idempotent，兼顾 import 重复）。

#### P2

- 批量多选 → 批量删除 / 批量打标签。
- 导出选中 → `dialog.showSaveDialog` + 打包（沿用 export 的 Blob/文件能力）。

### 6.5 角色/场景库需求（Elements，提权至与素材库同阶段 — 决策4）

#### P0（与素材库同期交付，是跨镜一致性的底座）

| # | 需求 | 关键实现点 |
|---|---|---|
| ① | **定义一次、跨工程复用** | `elements:library` 全局存储；列表按 `kind`（角色/场景）分组，卡片显示首张 `refImageIds` 缩略图 + name + 描述摘要 |
| ② | **「插入到画布」落绑定节点** | 角色 → 新建 `character` 节点、场景 → 新建 `scene` 节点；写入 `params`（描述）、`outputs` 的 image port 绑定首张 `refImageId` 的 `assetId`，并把 `name`/`kind` 注入 `PortValue.meta`（复用现有一致性匹配语义） |
| ③ | **从现有节点「保存到库」** | 在 `character` / `scene` 节点的 Inspector 加「保存到库」动作：取该节点输出图的 `assetId`（已是库素材）放入 `refImageIds`、取 `params` 描述与标题，`elements:library` 追加一条 `ElementRef`（opportunistic 路径，对应 LTX「Save as Element」） |

**绑定语义（compose-time 解析，禁止 inline）：**

```text
插入 Element → 节点持有 { elementId }（结构化引用，非拷贝）
节点执行时 → 解析 elementId ⇒ refImages(assetId[]) + description + meta
           ⇒ 注入现有 character/scene executor 的图像条件 + 提示词
编辑 Element（改描述/换参考图）⇒ 引用该 elementId 的节点下次执行即生效
```

> 与 ground-truth 兼容：`character`/`scene` 节点本就 `out=json,image=角色/场景图`，`PortValue.meta` 已用于一致性匹配（`name`/`kind`）。Element 绑定只是把「手填描述 + 手传图」升级为「引用全局库」，不新增 executor 概念。

#### P1

- Boards/合集分组（角色合集、场景合集）；与素材库共用同一组织 UI 组件。
- 同名去重 / 合并：库内 `name` 唯一性校验 + 重复时提示合并 `refImageIds`。

#### P2

- 批量操作（批量打标签、批量删除）。
- 导出选中 Element（连同其 `refImageIds` 二进制）为可移植 bundle，便于跨机迁移。

### 6.6 验收标准（P0 Definition of Done）

```text
[素材库]
□ 网格按 role 标签页与 origin chip 正确分流；name/tags 子串搜索命中
□ 灯箱与元数据面板展示 prompt/model/尺寸/时长/refCount
□ 上传文件经 saveAsset 入库，立即出现在网格
□ 拖素材入画布生成 image-input/audio-input 节点，PortValue.assetId 正确绑定且加载后能 hydrate 出预览
□ 删除单条触发引用检查；「清理未引用素材」实际调用 deleteAsset，attachment.list 占用读数随之下降
□ deleteAsset 至此有真实调用点（grep 不再只命中定义）——存储泄漏闭环

[角色/场景库]
□ 在 A 工程定义 Element，切到 B 工程仍可见并插入
□ 「插入到画布」生成 character/scene 节点，meta.name/kind 注入正确，一致性匹配可用
□ 从现有 character/scene 节点「保存到库」生成 ElementRef，refImageIds 指向已入库素材
□ 编辑 Element 描述后，引用节点下次执行采用新描述（compose-time 生效，无 inline 拷贝）
```

> 跨章依赖：本库的工程实扫 GC 依赖 Phase 1 的 `project:<id>` 拆分（决策3）才能逐工程枚举 `assetId`；rail「素材库」一级入口与 Dock「素材/提示词」标签的容器由第 1 章布局提供，本章只定义库的数据与行为。

## 7. 提示词库（Prompts）需求

> 本章定义重构后左侧 rail 一级界面「提示词库」的需求，以及画布内 Dock「提示词」标签的对应能力。提示词库是 PromptSettings 弹窗 + GlobalSettings（全局画风/画幅）的承接者与升级版，并新增**可复用片段/预设**。所有能力都是对现有 `promptStore` / `promptTemplates.ts` / `fillTemplate` 的**增量包装**，不改动 executor 解析语义与 `JSON_CONTRACT` 不可编辑契约。

### 7.0 现状与差距（ground-truth）

| 现状 | 位置 | 问题 |
| --- | --- | --- |
| 11 个固定 id 模板 + 三层优先级 | `promptTemplates.ts` `PROMPT_TEMPLATES`；`promptStore.get` = `projectOverrides ?? globalOverrides ?? DEFAULT_PROMPTS[id]` | 仅藏在 `PromptSettings` 弹窗里，无搜索、无分组、无「已改」标记 |
| 全局覆盖持久化 | `promptStore` `STORAGE_KEY='afs:promptOverrides'`，**默认 namespace** | 与 `graphStore`/`providerStore` 的 `'ai-film-studio'` namespace 不一致（见第 3 章存储规范） |
| 工程覆盖 | `ProjectData.promptOverrides`（graphStore 持有，经 `setPromptOverride`/`resetPromptOverride` 落工程 JSON）；graphStore 内部经 `syncProjectPromptLayer` 调 promptStore `setProjectLayer` 只推**内存快照**，promptStore 不持久化 | 正确，但工程切换时需主动 re-push 内存快照 |
| 全局画风/画幅 | `ProjectGlobals{aspectRatio,style}`，`graphStore.setGlobals`，独立 `GlobalSettings` 弹窗 | 与提示词割裂；style 实际是「追加到图像模板的风格片段」，本质就是一种可复用片段 |
| 片段/预设（画风/运镜/打光/负面） | **不存在** | 用户只能把这些文字反复手敲进节点 param |
| `{key}` 占位符 | `fillTemplate(tpl, vars)`，正则 `\{(\w+)\}` | 已有，可直接复用做命名变量预览 |

**设计基线：** 库为**引用式**（见 LTX/PromptLayer 调研结论）——片段以 id 引用进模板/节点，不在保存时内联展开；模板渲染在**执行时**解析，编辑片段即对所有消费者生效。三层覆盖保持 `工程 > 全局 > 默认` 语义不变。

---

### 7.1 P0 — 提示词库界面：两块

提示词库一级界面采用左 rail + 内部二级 tab 结构，分两块：**(a) 节点模板** 与 **(b) 片段/预设**。两块共享同一组件套件（搜索框、分组折叠、`已改`/`默认` 徽标、`恢复默认`、详情面板）。

#### 7.1(a) 节点模板面板 — 把 PromptSettings 搬出弹窗

把 `PromptSettings` 弹窗整体迁移为常驻面板，并补齐管理能力。**数据源不变**：直接消费 `PROMPT_TEMPLATES`（meta）+ `promptStore`（三层值）。

需求清单：

- **按节点分组**：用 `PromptTemplateDef.group`（`'text'|'image'`）做主分组；二级用 `label` 中已蕴含的节点语义（剧本/分镜/角色设定/提示词处理/角色三视图/场景/关键帧/资产人物/资产场景）。分组标题可折叠。
- **搜索**：单一搜索框，对 `id` + `label` + `desc` + 模板正文做子串匹配（参考 InvokeAI `LIKE '%term%'` 的 MVP 取舍；11 个模板规模下无需索引）。
- **已改标记（三层徽标）**：每行显示生效来源徽标——
  | 徽标 | 判定（基于 `promptStore`） |
  | --- | --- |
  | `工程改` | `projectOverrides[id]` 非空 |
  | `全局改` | `globalOverrides[id]` 非空且无工程改 |
  | `默认` | 落到 `DEFAULT_PROMPTS[id]` |
  判定即「当前值 ≠ 上一层值」，等价于现有 `pick()` 的命中层。
- **编辑 + 写入哪一层**：编辑器顶部一个层切换（`本工程 ↔ 全局`），决定调用——
  - **本工程层** → `graphStore.setPromptOverride(id, value)`（写入 `ProjectData.promptOverrides`、落工程 JSON；graphStore 内部经 `syncProjectPromptLayer` 调 `promptStore.setProjectLayer` 同步内存快照供执行解析）；
  - **全局层** → `promptStore.setGlobal(id, value)`（落 KV `afs:promptOverrides`）。
  保留**当前两层 store 方法**，不新增层。注意 `setProjectLayer` 只是 promptStore 的内存快照入口，不直接持久化，不在 UI 直接调用。
- **恢复默认（分层语义）**：
  - 行级 `恢复本工程默认` → `graphStore.resetPromptOverride(id)`（删工程层 → 落回全局/默认）；
  - 行级 `恢复全局默认` → `promptStore.resetGlobal(id)`；
  - 面板级 `全部恢复` → `graphStore.resetAllPromptOverrides()` + `promptStore.resetAllGlobal()`。
  > 删除即「向上层穿透」——这就是分层 revert 的正确语义（PromptLayer/config-overlay 结论），**非**销毁历史。
- **不可编辑契约可见化**：对 `jsonContract:true` 的模板，编辑器下方只读展示 `JSON_CONTRACT` 文本并标注「引擎自动追加，不参与编辑」，防止用户以为漏了输出约束。
- **占位符提示**：用 `PromptTemplateDef.placeholders` 在编辑器旁列出该模板可用 `{占位符}`（如 `{desc}`/`{chars}`/`{ref}`），点击插入。

布局（节点模板）：

```
[搜索........] [层: 本工程▼] [全部恢复]
▾ 文本
   剧本生成              [工程改]  ⟲
   分镜脚本              [默认]
   提示词处理 · 中译英    [全局改]  ⟲
▾ 图像
   角色三视图            [默认]   占位:{hint}{ref}
   ...
─────────────────────────────────────
[编辑器]  当前层: 本工程
{ 模板正文 textarea }
只读: JSON 输出契约（引擎追加）        // 仅 jsonContract 模板
```

#### 7.1(b) 片段 / 预设面板 — 可复用片段（新增）

新增**与节点模板正交**的片段库：分类 `画风 / 运镜 / 打光 / 负面 / 自定义`。片段是「一段可命名、可复用的提示词文本」，在 Inspector 一键插入选中节点的 prompt 类 param。

数据模型（**新增** `src/ui/services/promptSnippets.ts`）：

```ts
type SnippetKind = 'style' | 'camera' | 'lighting' | 'negative' | 'custom'
interface PromptSnippet {
  id: string            // 's_' + nanoid(10)
  kind: SnippetKind
  name: string          // 显示名 / @handle，用于搜索与插入
  body: string          // 片段正文（可含 {var} 占位符，复用 fillTemplate 语法）
  lang?: 'zh' | 'en'    // 便于「负面 / 英文画风」筛选
  builtin?: boolean     // 内置只读预设（可复制为自定义，不可改/删）
  createdAt: number; updatedAt: number
}
```

存储（**新增** store `src/ui/store/snippetStore.ts`，对齐第 3 章 namespace 规范）：

| key | namespace | 内容 |
| --- | --- | --- |
| `prompts:snippets` | `'ai-film-studio'` | `PromptSnippet[]`（全局共享，跨工程复用，与素材库同口径） |

需求清单：

- **内置预设**：随插件附带一批 `builtin:true` 片段（如 画风：`电影感写实 / 吉卜力 / 赛博朋克`；运镜：`低角度推进 / 环绕 / 手持`；打光：`黄金时刻 / 伦勃朗 / 霓虹`；负面：`低质量/多手指/水印`）。内置只读，可「复制为自定义」后编辑。
- **Inspector 一键插入**：Inspector 在选中节点为 prompt 类节点（含 `prompt`/`text`/`refPrompt` 类 param，或图像/视频节点）时显示「插入片段」，按 `kind` 分组的弹出选择器，点击把 `body` 追加到当前编辑的 prompt param。当前节点定义（`nodeDefs.ts`）中并无 `negative` param，故负面类同样追加到当前 prompt 文本（待将来某节点新增负面 param，再定向追加到该 param）。插入为**纯文本追加**（P0 不做引用 token，避免触碰 executor）。
- **搜索/分组/复用**：复用与节点模板相同的搜索框 + 按 `kind` 折叠分组 + `内置`/`自定义` 徽标。
- **画布 Dock 联动**：画布内 Dock「提示词」标签镜像本面板，可把片段**拖入**节点的 prompt 文本框（DnD，复用现有 `DND_MIME='application/afs-node'` 模式另起新常量 `application/afs-snippet`）。

#### 7.1(c) 把「全局设定（画风/画幅）」并入此面，作「项目风格预设」

`GlobalSettings` 弹窗废弃，`ProjectGlobals{aspectRatio,style}` 语义保留并升级为「项目风格预设」，置于提示词库 (b) 面顶部：

| 字段 | 来源 | 重构后 |
| --- | --- | --- |
| `style` | `ProjectGlobals.style`，追加到图像模板 | 改为「从画风片段库选 1..N 个」或自由文本；落 `setGlobals({style})`，渲染语义不变（仍由图像节点经 `prompts.ts` 的 `resolveStyle` 追加，见 `promptTemplates.ts` 注释「画风由项目全局设定追加」） |
| `aspectRatio` | `ProjectGlobals.aspectRatio` | 画幅选择器并入此面，落 `setGlobals({aspectRatio})` |

> 即：项目风格预设 = 「当前工程默认勾选的画风片段 + 画幅」，是片段库的一个工程级消费视图。**不新增** graphStore 方法，仍走 `setGlobals`。

---

### 7.2 P1

- **命名变量 + 实时预览**：编辑器侧栏列出模板/片段中的 `{var}`（正则与 `fillTemplate` 一致 `\{(\w+)\}`），提供变量值输入框；预览区调用 `fillTemplate(tpl, vars)` 实时渲染「解析后提示词」。`jsonContract` 模板预览时附加只读 `JSON_CONTRACT` 尾巴，所见即执行所发。
- **节点模板版本 diff / 回滚**：在工程/全局层维护**有上限的版本环**（如每模板保留近 N 版，存 `ProjectData.promptOverrides` 旁路或 KV `afs:promptHistory`，**新增** key）。提供 `当前层 vs 上一层（全局/默认）` 的词级 diff（绿增红删，参考 Humanloop），回滚 = 把某历史值重新经 `promptStore.setGlobal` / `graphStore.setPromptOverride` 写回（非破坏，写回即可）。
- **提示词包 JSON 导入导出**：导出 `{ templatesOverrides: {global, project}, snippets: PromptSnippet[] }` 为单一 JSON；导入做**幂等合并**（按 `id`/内容去重，仅落与默认有差异的项，参考导出小型化结论）。复用宿主 `dialog.showSaveDialog`/`dialog.showOpenDialog`。与第 3/6 章「工程导入/导出」分离：提示词包只含库，不含 graph。

### 7.3 P2

- **节点级预设**：把「某节点的整套 param + 引用片段」存为命名预设，可在新建同类节点时套用（落 KV `afs:nodePresets`，**新增** key；不改节点定义）。
- **文件夹**：片段库支持文件夹/标签分组（参考 ComfyUI 调研「面板内建文件夹 + 跨切面标签」），仅组织层，不影响引用解析。

### 7.4 约束与不做项

- **不改 executor 解析**：P0 片段插入为纯文本追加；引用 token（`{> camera/x }}` 式 compose-time 解析）列为 **P2 探索**，需配套执行期 resolver，本期不做。
- **`JSON_CONTRACT` 全程不可编辑**：UI 只读展示，不进入任何覆盖层。
- **namespace 一并修正**：随本期把 `promptStore` 的 `afs:promptOverrides` 从默认 namespace 迁到 `'ai-film-studio'`（一次性迁移，详见第 3 章存储拆分章节）；片段/预设等新键（`prompts:snippets`、`afs:promptHistory`、`afs:nodePresets`）直接落 `'ai-film-studio'` namespace。
- **复用现有 store 方法**：节点模板三层操作全部走既有 `graphStore.{setPromptOverride,resetPromptOverride,resetAllPromptOverrides,setGlobals}` + `promptStore.{setGlobal,resetGlobal,resetAllGlobal,setProjectLayer}`（`setProjectLayer` 仅作 graphStore 推内存快照之用，不在 UI 直接调用），不新增覆盖层级。

---

新增文件（标注 (新增)）：`src/ui/services/promptSnippets.ts` (新增，内置预设 + 类型)、`src/ui/store/snippetStore.ts` (新增，片段 CRUD + 持久化到 `prompts:snippets`)、`src/ui/components/PromptsLibrary.tsx` (新增，rail 一级面板，承接 `PromptSettings`/`GlobalSettings`)、`src/ui/components/SnippetInserter.tsx` (新增，Inspector 插入器)。复用：`promptTemplates.ts`、`promptStore.ts`、`graphStore`（`promptOverrides`/`globals` 相关方法）、`fillTemplate`、`dialog.*`。

## 8. 分期实施计划与任务拆解

本章把重构拆为 4 个独立可交付、可验收的阶段。每个阶段给出**目标**、**文件级新增/改动**（标注「新增」/「改动」）与**验收清单**。所有改动遵守增量原则：**Phase 1 只动外壳与存储，不触碰执行引擎（executor/runNode/runFrom/runAll）**；库系统对 `PortValue`/节点语义为纯增量扩展。

> 贯穿全程的不变量
> - 所有持久化沿用现有命名空间 `ai-film-studio`（KV）与 `storage.attachment.*`（二进制），不引入新宿主 API。
> - 库（素材/Elements/片段）为**全局共享、跨工程复用**，存于 plugin 作用域 KV，不写进任何 `project:<id>`。
> - 库的持久化键沿用已锁定契约：`projects:index` / `project:<id>` / `assets:registry` / `elements:library` / `prompts:snippets`。
> - 节点绑定库一律**按引用**（`assetId` / `elementId` / 片段 `name@version`），不内联拷贝。

---

### Phase 1 — 应用骨架 + 工程主页（只动外壳，不动执行引擎）

**目标**：引入 rail + 顶层 view 路由，把工程主页/画布编辑器/素材库/提示词库/设置做成一级界面；Toolbar 瘦身为「编辑器顶栏」；落地工程存储拆分（`projects:index` + `project:<id>` 懒加载 + 一次性迁移，旧键回退）。执行链路（`runNode/runFrom/runAll/cancelRun`）零改动。

**文件级新增/改动**

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/ui/components/shell/AppRail.tsx` | 新增 | ~56px 图标导航栏；顶部 logo、5 个一级 view（Projects/Editor/Assets/Prompts/Settings）、底部留位；hover 显示标签；当前 view 高亮。rail 本身**不可折叠**（唯一返回锚点）。 |
| `src/ui/store/shellStore.ts` | 新增 | 顶层 UI 状态：`activeView`、各 view 内的 panel 折叠/宽度、`lastActiveView`。持久化到 KV（`afs:shell`，命名空间 `ai-film-studio`），重开恢复上次 view。 |
| `src/ui/components/views/ProjectsView.tsx` | 新增 | 工程主页：封面卡片网格（`grid auto-fill minmax(240px,1fr)`）、排序（名称/修改时间）、新建/打开/重命名/复制/删除/导入。卡片显示封面缩略图 + 标题 + `updatedAt`。 |
| `src/ui/store/projectStore.ts` | 新增 | 从 `graphStore` 抽出工程级元数据与生命周期：`index:ProjectMeta[]`、`currentProjectId`、`listProjects/openProject/createProject/renameProject/duplicateProject/deleteProject`。内部委托 graph 加载给 graphStore（见迁移）。 |
| `src/ui/services/projectRepo.ts` | 新增 | 存储拆分仓库层：`loadIndex()/saveIndex()`、`loadProject(id)/saveProject(data)/removeProject(id)`、`migrateLegacy()`。封装 `projects:index` 与 `project:<id>` 读写，序列化复用现有 `stripValue`（剥离 data URL，仅留 `assetId`）。 |
| `src/ui/store/graphStore.ts` | 改动 | `newProject/saveProject/switchProject/deleteProject/renameProject/importProject/exportProject` 改为调用 `projectRepo`（懒加载单个 `project:<id>`，不再整表读写 `projects`）。`saveProject` 写入串行化（解决既有 read-modify-write 竞态：拆分后只写单工程 key）。**run* / executor 不改。** 顺带写入 `viewport`（补既有缺口）。 |
| `src/ui/App.tsx` | 改动 | 顶层渲染 `AppRail` + 按 `activeView` 切换主区：Editor 沿用现 `Toolbar/NodeLibrary/FlowCanvas/Inspector` 三栏；其余 view 各自布局。`init()` 保持，新增首启 `projectRepo.migrateLegacy()`。 |
| `src/ui/components/Toolbar.tsx` | 改动 | 瘦身为**编辑器顶栏**：保留 model/imageModel/template 选择、run/stop、save/import/export/globals/prompts/providers。**移除** project switch select / rename input（迁至 ProjectsView）。 |
| `src/ui/styles.css` | 改动 | 新增 `.afs-rail`(56px)、`.afs-shell`(rail + 主区)、`.afs-view`、`.afs-projects-grid`、卡片样式；现有 `.afs-app__*` 编辑器三栏样式收敛到 Editor view 下。 |

**存储拆分与迁移（一次性，旧键回退）**

```text
旧: projects = ProjectData[]            (单键, 重)         namespace ai-film-studio
新: projects:index = ProjectMeta[]      (仅 id/name/createdAt/updatedAt/coverAssetId?)
    project:<id>   = ProjectData        (nodes/edges/viewport/globals/promptOverrides)

migrateLegacy():
  if storage.get('projects:index') 存在 → 已迁移, return
  legacy = storage.get('projects')
  if legacy 为空 → 写空 index, return
  for p of legacy:
     storage.set('project:'+p.id, stripValue(p))
  storage.set('projects:index', legacy.map(toMeta))
  storage.set('projects:__legacy_bak', legacy)   // 保留旧键作回退, 不删
  (currentProjectId 沿用旧键 KEY_CURRENT)

读取回退: openProject(id) 时若 project:<id> 缺失但 __legacy_bak 命中 → 即时回填并补写
```

**验收清单**
- [ ] rail 常驻可见，点击 5 个图标切换一级 view；重开窗口恢复 `lastActiveView`。
- [ ] ProjectsView 卡片网格在 1100–1400px 连续缩放下平滑 reflow（2→4 列），无媒体查询死区。
- [ ] 新建/打开/重命名/复制/删除/导入工程全部经 `projectStore`，落到 `project:<id>`，`projects:index` 同步更新。
- [ ] 首启自动迁移：旧 `projects` 单键拆为 `projects:index` + N×`project:<id>`，旧键保留为 `__legacy_bak`；二次启动幂等不重复迁移。
- [ ] `project:<id>` 缺失时能从 `__legacy_bak` 回退并补写。
- [ ] 打开工程仅懒加载该工程的 `project:<id>`，不整表读取。
- [ ] `viewport` 在保存/切换后被写入并恢复（pan/zoom 不丢）。
- [ ] **回归**：节点增删改、连线、`runNode/runFrom/runAll/cancelRun`、save(Cmd+S)/delete 行为与重构前一致；executor 文件无 diff。

---

### Phase 2 — 素材库 + 注册表 + 全局角色/场景 Elements 库（已提权）

**目标**：建立**全局共享**素材库（生成/上传统一存储）与资产注册表（解决既有 deleteAsset 从不调用、attachment 只写不删的泄漏），并把角色/场景 Elements 全局库与素材库一同交付：定义一次、跨工程复用、插入画布、从现有 character/scene 节点保存到库。Dock 左栏改为「节点｜素材｜提示词」三标签，可拖库内容落节点。

**文件级新增/改动**

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/ui/services/assetRegistry.ts` | 新增 | 资产注册表（核心）。`AssetRecord{ id; origin:'generated'\|'imported'\|'external'; role:'shot'\|'reference'\|'mask'\|'control'\|'audio'\|'video'\|'other'; mime; w?; h?; durationSec?; createdAt; starred?; tags?:string[]; meta?(prompt/seed/model/nodeKind/parentIds); refCount }`。方法：`register/get/list(filter)/update/star/setTags`；`incRef/decRef`（引用计数）；`gcOrphans()`（用 `storage.attachment.list()` ∖ 注册表/index 中被引用的 assetId → `storage.attachment.remove` + `deleteAsset`）；`probeSize(bytes,mime)`（尺寸/时长探测）；`backfill()`（扫描所有 `project:<id>` 的 PortValue.assetId 回填注册表，含尺寸补测）。索引持久化 `assets:registry`（namespace `ai-film-studio`）。 |
| `src/ui/services/assets.ts` | 改动 | `saveAsset` 成功后调用 `assetRegistry.register(...)`；新增 `replaceAsset(oldId,...)`（覆盖输出时 `decRef(oldId)` 而非直接孤儿化）。**`deleteAsset` 接入调用方**（节点删除/工程删除/输出覆盖经注册表 `decRef`，归零交 GC）。其余 helper 不变。 |
| `src/ui/store/assetStore.ts` | 新增 | 素材库 UI 状态：`items`、`filter{role,origin,tag,starred,q}`、`selection`、排序（pinned DESC, createdAt DESC）。读 `assetRegistry`，提供 `saveFromNode(node)`（把节点输出 PortValue 提权为素材）。 |
| `src/ui/services/elementRegistry.ts` | 新增 | 全局 Elements 库。`ElementRef{ id; kind:'character'\|'scene'\|'object'\|'style'\|'other'; name(@handle); refAssetIds:string[]; description; tags?; voiceId?; version; createdAt }`，按引用持有 `assetId`（复用 assetRegistry，不另存二进制）。方法：`create/get/list/update/duplicate(变体)/insertToCanvas/saveFromNode`。`saveFromNode`：从 character(out json,角色图)/scene(out json,场景图) 节点抽 `assetId+meta` 入库。持久化 `elements:library`。 |
| `src/ui/components/views/AssetsView.tsx` | 新增 | 素材库主界面：缩略图/表格切换、Generated\|Assets 双标签（按 `role` 而非 `origin`，借鉴 InvokeAII 双轴）、搜索 + 过滤 chip、多选 + 批量 star/删除/导出、详情侧栏（显示 meta/尺寸/被引用计数）。删除走 `decRef`+GC。 |
| `src/ui/components/dock/AssetPanel.tsx` | 新增 | 画布 Dock「素材」标签内容：库缩略图网格 + 搜索；拖拽 thumbnail → 落到画布生成 image-input/audio-input 节点并绑定 `assetId`（复用现有 DnD，新增 MIME `application/afs-asset`）。 |
| `src/ui/components/dock/ElementPanel.tsx` | 新增 | Dock 内 Elements 子区（或并入 AssetPanel 标签）：列出 character/scene Elements；拖入画布生成对应 character/scene 节点并写入 `refAssetIds`+description+(voiceId)。 |
| `src/ui/components/NodeLibrary.tsx` | 改动 | 重构为 Dock 三标签宿主「节点｜素材｜提示词」（提示词标签 Phase 3 接管），节点标签沿用现有 `DND_MIME`/category 逻辑不变。 |
| `src/ui/components/Inspector.tsx` | 改动 | character/scene 节点新增「保存为 Element」动作（→ `elementRegistry.saveFromNode`）；任意输出新增「保存为素材」（→ `assetStore.saveFromNode`）。 |
| `src/ui/store/graphStore.ts` | 改动 | `removeNode/deleteSelected/deleteProject` 调 `assetRegistry.decRef`（不再静默孤儿化）；`editNodeImageItem/regenNodeImageItem/setNodeImage/setNodeAudio` 覆盖输出时走 `replaceAsset`。`importProject`/`reimportAssets` 注册新资产。**执行算法/端口语义不变。** |
| `src/ui/styles.css` | 改动 | 新增 `.afs-assets-*`、`.afs-dock-tabs`、缩略图网格、详情侧栏、Element 卡片样式。 |

**资产注册表 / GC 关键规则**

```text
引用计数 = 注册表 refCount，来源:
  · PortValue.assetId (节点输出/输入)
  · ElementRef.refAssetIds
  · projects:index[].coverAssetId

decRef(id): refCount-- ; 归零 → 标记 orphan(不立即删, 防误删)
gcOrphans():
  live  = ∪ 所有 project:<id> 的 assetId ∪ 所有 ElementRef.refAssetIds ∪ 封面
  disk  = storage.attachment.list()
  orphan= disk \ live
  for id of orphan: storage.attachment.remove(id); 注册表删除
触发点: 工程删除后、输出覆盖后(延迟)、手动「清理孤儿资产」按钮
backfill(): 首次进入 AssetsView 若 assets:registry 缺失 → 扫描全工程回填 + probeSize
```

**验收清单**
- [ ] 生成/上传的图像/视频/音频在 AssetsView 出现，按 `role`（Generated/Assets）分栏，按 (pinned, createdAt) 排序。
- [ ] 素材库为**全局**：A 工程生成的素材可在 B 工程的 Dock 素材标签拖入画布并正确绑定 `assetId`。
- [ ] 删除节点 / 删除工程 / 覆盖输出 → 旧 `assetId` 经 `decRef` 归零，`gcOrphans()` 后 `storage.attachment.list()` 中对应二进制被移除（**泄漏闭合**，与 ground-truth 缺口对应）。
- [ ] `backfill()` 能为既有工程回填注册表并补测尺寸；缺失 attachment 在 UI 标记失效，不报脏数据。
- [ ] character/scene 节点「保存为 Element」→ Elements 库出现条目（含 refAssetIds + description）；从 Dock 拖该 Element 入画布生成对应节点并按引用绑定。
- [ ] 同一 Element 在多工程复用，编辑库定义不破坏已有节点（按引用解析；变体走 `duplicate`）。
- [ ] Dock 三标签「节点｜素材｜提示词」可见；素材拖拽落节点不影响节点库原有拖拽。
- [ ] **回归**：executor 与端口语义无 diff；未保存为素材的输出行为不变。

---

### Phase 3 — 提示词库 + 全局设定并入

**目标**：在现有「工程 > 全局 > 默认」三层覆盖之上，新增**可复用片段库**（style/camera/lighting/negative），片段按引用注入固定节点模板（compose-time 解析，非 store-time 内联）；把 GlobalSettings 并入提示词库 view；Inspector 支持插入片段。

**文件级新增/改动**

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/ui/store/promptStore.ts` | 改动 | 在现有 `loadGlobal/get/setGlobal/.../setProjectLayer` 之上新增**片段库**：`listSnippets/getSnippet/createSnippet/updateSnippet/deleteSnippet`；片段类型 `PromptSnippet{ id; name; category:'style'\|'camera'\|'lighting'\|'negative'; body; version }`。统一持久化命名空间（修正既有 `afs:promptOverrides` 用默认 ns 的不一致 → 收敛到 `ai-film-studio`，迁移旧键）。新增片段库索引键 `prompts:snippets`。 |
| `src/ui/services/promptCompose.ts` | 新增 | 片段解析器：模板内引用 `{{> camera/low-angle }}`（默认 latest）或 `{{> camera/low-angle@3 }}`（pin 版本）→ compose-time 替换为片段 body。含**循环检测 + 最大深度**。被 `getPrompt` 调用，不改三层覆盖优先级。 |
| `src/ui/components/views/PromptsView.tsx` | 新增 | 提示词库主界面：左列固定节点模板（12 个 fixed id：`text.script/...image.assetScene`）三层覆盖编辑 + 「project vs default」红绿 diff + 「重置到默认」（删项回退）；右列片段库（按 category 分组）增删改 + 版本。**GlobalSettings 并入**为本 view 一个区块（aspectRatio/style 等）。 |
| `src/ui/components/Inspector.tsx` | 改动 | 文本类节点 prompt 字段支持插入片段：输入 `{{>` 触发片段 autocomplete（按 category），插入引用 token（非内联）。 |
| `src/ui/App.tsx` | 改动 | Prompts view 路由到 `PromptsView`；移除独立 GlobalSettings/PromptSettings modal 入口（功能迁入 view，Toolbar 按钮改为跳转 Prompts view）。 |
| `src/ui/components/Toolbar.tsx` | 改动 | `globals`/`prompts` 按钮由「开 modal」改为「切到 Prompts view」。 |
| `src/ui/styles.css` | 改动 | 新增 `.afs-prompts-*`、diff 红绿、片段卡片、片段 autocomplete 样式。 |

**片段解析（compose-time）规则**

```text
节点模板 body 内: {{> <category>/<name> }} | {{> <category>/<name>@<version> }}
getPrompt(nodeKind):
  1. 解析三层覆盖 (project > global > builtin-default)  ← 既有逻辑不变
  2. promptCompose.expand(body):
       未 pin → 取片段 latest version
       已 pin → 取指定 version
       循环/超深 → 报错并原样保留 token
变量占位仍用 {{var}}; 包含语法用 {{> name }} (两者分离, 防混淆)
```

**验收清单**
- [ ] 片段库可增删改（style/camera/lighting/negative 四类）；片段有版本。
- [ ] 固定节点模板内 `{{> ... }}` 在 compose-time 展开为片段 body；编辑片段后所有未 pin 的引用节点自动生效（无需改模板）；`@version` pin 的引用锁定不变。
- [ ] 循环引用 / 超过最大深度被检测并安全降级（不崩溃、不无限展开）。
- [ ] PromptsView 显示每个 fixed 模板的「project vs default」红绿 diff；「重置到默认」= 删除该层覆盖项回退父层。
- [ ] GlobalSettings 完整并入 PromptsView，aspectRatio/style 编辑后写入当前工程 globals。
- [ ] Inspector `{{>` 触发片段插入，插入的是引用 token 而非展开文本。
- [ ] 三层覆盖**优先级与现有一致**；prompt 持久化命名空间统一（旧 `afs:promptOverrides` 迁移，无数据丢失）。

---

### Phase 4 — 纵深（P1/P2）

**目标**：在前三阶段交付的稳定外壳 + 三大库之上，补齐高价值纵深能力。本阶段每项独立可交付，互不阻塞。

**文件级新增/改动**

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/ui/services/snapshotService.ts` | 新增 | 命名快照：对当前 `project:<id>` 存只读快照 `project:<id>:snap:<snapId>`（含 graph + 引用 assetId，资产经 `incRef` 防 GC 误删）；`create(name)/list/restore(snapId)/delete`。 |
| `src/ui/store/projectStore.ts` | 改动 | 暴露快照入口；`restore` 走 graphStore 重载，恢复前快照当前态防丢。 |
| `src/ui/components/views/ProjectsView.tsx` | 改动 | 工程卡片 + Boards 分组：`projects:index` 增 `boardId?`，按 board 折叠分组（含虚拟「未分组」桶）；多选批量移动/删除/导出。 |
| `src/ui/services/templateVersioning.ts` | 新增 | 节点模板版本 diff：对 PromptTemplate fixed id 存版本历史 + 内容哈希，跨版本红绿 diff（复用 Phase 3 diff 组件）。 |
| `src/ui/components/views/PromptsView.tsx` | 改动 | 接入模板版本历史 / diff / 回滚；片段「变量 + 实时预览」（Mintlify 式参数化片段 `{word}`，编辑即预览展开结果）。 |
| `src/ui/services/elementRegistry.ts` | 改动 | Element 版本化 + 「按版本 pin」；用量反查（列出引用某 Element 的节点，编辑前显示影响面）。 |
| `src/ui/services/assetRegistry.ts` | 改动 | 去重（内容哈希识别重复 attachment，合并引用）+ 批量操作（批量 star/tag/删除/导出 zip）。 |
| `src/ui/components/views/AssetsView.tsx` | 改动 | 批量工具栏、去重提示、虚拟 smart board（按日期/模型/角色，只读不可拖入）、导出 board 为 zip。 |
| `src/ui/styles.css` | 改动 | 快照列表、board 分组、版本 diff、实时预览面板样式。 |

**验收清单**
- [ ] 命名快照可创建/列出/恢复/删除；恢复前自动快照当前态；快照引用资产不被 GC 误删（`incRef` 生效）。
- [ ] 节点模板版本历史可见，跨版本红绿 diff，可回滚到指定版本。
- [ ] 参数化片段支持变量 + 编辑实时预览展开结果。
- [ ] ProjectsView 支持 Boards 分组（含未分组虚拟桶）与多选批量移动/删除/导出。
- [ ] 素材去重：内容哈希识别重复 attachment 并合并引用；批量 star/tag/删除/导出 zip 可用。
- [ ] 虚拟 smart board（日期/模型/角色）只读、明确不可作为拖入落点。
- [ ] Element 版本化 + 按版本 pin + 用量反查（编辑前显示影响节点列表）。
- [ ] **回归**：以上均为增量，executor / 端口语义 / 三层覆盖优先级 / 存储拆分契约全程不变。

---

**阶段交付边界小结**

| 阶段 | 触碰执行引擎 | 独立可交付物 | 关键风险闭合 |
|---|---|---|---|
| P1 | 否 | rail + 5 view 外壳 + 工程主页 + 存储拆分/迁移 | 整表 read-modify-write 竞态、viewport 不持久 |
| P2 | 否（仅引用计数挂钩生命周期） | 全局素材库 + 注册表 + Elements 库 + Dock 三标签 | **attachment 只写不删泄漏闭合**、跨工程复用 |
| P3 | 否 | 提示词片段库 + 全局设定并入 + diff | prompt 命名空间不一致、片段重复 |
| P4 | 否 | 快照/模板版本/参数化片段/Boards/去重批量 | 共享资产 GC 误删（快照 incRef） |

## 9. 迁移与兼容（一次性）

本章给出从「单键 `projects` 巨数组 + 写后即漏的 attachment」过渡到「`projects:index` + `project:<id>` 懒加载 + `assets:registry` 全局素材注册表 + 接入 GC」的一次性迁移方案。四项迁移**互相独立、各自幂等**，由统一的 `runMigrations()`（新增 `src/ui/services/migrate.ts`）在 `graphStore.init()` 最前面 `await` 执行；任一步失败不阻断其余步骤，也不破坏旧数据。

> **可实现性前置**：`graphStore.ts` 中的存储辅助与序列化辅助 `sget`(:96)/`sset`(:104)/`serializeNodes`(:988)/`stripValue`(:978)/`makeDefaultProject`(:116) 目前均为**模块私有（未 export）**。新文件 `migrate.ts` 不能直接 import 它们，因此本章所有「复用现有 `serializeNodes/stripValue` 语义」「调用 `sget/sset`」的前提是：先把这些辅助从 `graphStore` **导出**（或抽到一个共享的 storage-helpers 模块），`migrate.ts` 与 `graphStore` 共同 import，**绝不重复实现一套**，以免序列化/剥离语义漂移。

**总原则（贯穿全章）**
- **不丢数据**：迁移只「新增键 + 复制引用」，**绝不删除旧键、绝不删除 attachment 二进制**；旧键 `projects` 保留**一个版本**（下个大版本才清理），全程作为读回退源。
- **无明文 Key**：迁移**只搬运工程 graph、`assetId` 引用、素材元信息**；API Key 仍由 `services/keys.ts` 经 `storage.encrypted`（`k_<providerId>`）管理，迁移代码**不触碰、不读取、不导出**任何 Key。
- **幂等**：每步以一个完成标记（`migrations:done` 内的布尔位）+ 目标键是否存在为前置判断，重复运行是 no-op；中断后重跑可续。
- **命名空间统一**：新键全部写在 `'ai-film-studio'` 命名空间（与 `KEY_PROJECTS`/`videoProviders` 一致），复用现有 `sget/sset`（按上述前置条件导出后引用）。

```ts
// src/ui/services/migrate.ts（新增）
// 注：sget/sset/serializeNodes/stripValue 需先从 graphStore 导出后再 import 复用
import { sget, sset, serializeNodes } from '../store/graphStore'

const KEY_MIG = 'migrations:done'   // { splitProjects?: 1; assetRegistry?: 1 } ；ns='ai-film-studio'
export async function runMigrations(): Promise<void> {
  const done = (await sget<Record<string, 1>>(KEY_MIG)) || {}
  if (!done.splitProjects) { await migrateSplitProjects(); done.splitProjects = 1; await sset(KEY_MIG, done) }
  if (!done.assetRegistry) { await backfillAssetRegistry(); done.assetRegistry = 1; await sset(KEY_MIG, done) }
}
```

> 调用点：`init()` 开头，在「读 `projects:index`」之前 `await runMigrations()`。GC（§9.3）**不在启动迁移内**，按需触发。

---

### 9.1 工程拆分：`projects` → `projects:index` + `project:<id>`

**目标键**（均 ns=`'ai-film-studio'`）

| 键 | 内容 | 体量 |
|---|---|---|
| `projects:index`（新增） | `ProjectMeta[]`，仅 `{id,name,createdAt,updatedAt}` + 新增可选 `cover?:string`(assetId) | 轻 |
| `project:<id>`（新增） | 单工程重型 graph：`{nodes,edges,viewport?,globals?,promptOverrides?}` | 重，懒加载 |
| `projects`（旧，**保留一版**） | 原 `ProjectData[]` | 仅作回退 |
| `currentProjectId`（不变） | 当前工程 id | — |

**迁移步骤（`migrateSplitProjects`）**

1. 读旧键：`const legacy = await sget<ProjectData[]>('projects')`。为空/非数组 → 视作无旧数据，**直接返回**（首启空装机也走拆分写入路径，不依赖旧键）。
2. 对每个 `p`：
   - 写 `project:<p.id>` = `{ nodes: serializeNodes(p.nodes), edges: p.edges, viewport: p.viewport, globals: p.globals, promptOverrides: p.promptOverrides }`（复用现有 `serializeNodes`/`stripValue`，沿用「只存 `assetId`、剥 `data:` URL」的既定语义）。
   - 收集 `ProjectMeta` 入 `index`。
3. 一次性写 `projects:index = metas`。**此时不删 `projects`。**
4. 幂等保护：步骤 2 写 `project:<id>` 前先 `if (await sget('project:'+id)) continue`（已拆分过的工程不重复覆盖，避免回写把用户新编辑顶掉）。

**读路径回退（保留一版）**：新版 `init()` 优先 `projects:index`；**若 `projects:index` 不存在但旧 `projects` 存在**（迁移未跑或被外部清空索引），即时调用 `migrateSplitProjects()` 再读。单工程读取统一经 `loadProjectData(id)`：

```ts
async function loadProjectData(id: string): Promise<ProjectData | null> {
  const heavy = await sget<Omit<ProjectData,'id'|'name'|'createdAt'|'updatedAt'>>('project:'+id)
  if (heavy) { const m = (await projectsIndex()).find(x=>x.id===id); return m ? { ...m, ...heavy } : null }
  // 回退：旧单键里捞（仅过渡期）
  const legacy = (await sget<ProjectData[]>('projects'))?.find(p=>p.id===id)
  return legacy ?? null
}
```

**写路径改造**（影响 `saveProject/newProject/switchProject/deleteProject/loadTemplate/importProject`）

- `saveProject`：从「读整个 `projects` 数组 → 改一项 → 整体写回」改为**只写两键**：`sset('project:'+currentId, heavy)` + 更新 `projects:index` 中该条 meta。**附带修复并发隐患**：单工程写入只动 `project:<id>` 单键，不再 read-modify-write 全量数组，天然消除原 ground-truth 中「并发 save 互相覆盖」的竞态。`viewport` 顺带纳入持久化（修复原 `viewport` 从不落盘的缺口）。
- `switchProject`/`init`：用 `loadProjectData(id)` 懒加载目标工程；列表面板只需 `projects:index`，**不再把全部工程 graph 读进内存**。
- `deleteProject`：`sremove('project:'+id)`（经 `window.mulby.storage.remove(key, 'ai-film-studio')`） + 从 index 摘除（attachment 回收见 §9.3）。

**幂等性小结**：完成标记 + 「`project:<id>` 已存在则跳过」双保险；重复执行不产生重复条目、不覆盖较新数据。

---

### 9.2 素材注册表回填：扫 outputs 生成 `AssetRecord` → `assets:registry`

为支撑「全局共享素材库」（Phase 2），需要一份**与工程解耦的扁平资产注册表**。首启遍历所有工程节点 `outputs`（含扇出 `items[]`）的 `assetId`，为每个已有资产补建一条 `AssetRecord`。

**`AssetRecord` 模型**（新增，写入 `assets:registry`，ns=`'ai-film-studio'`）

```ts
interface AssetRecord {
  id: string                 // = PortValue.assetId（attachment 主键，复用，不重新落盘）
  type: 'image'|'video'|'audio'
  mime: string               // 来自 PortValue.mime，缺省按 type 兜底
  role: 'generated'|'imported'|'uploaded'  // 由来源推断（见下），origin 与 role 分列
  name?: string; kind?: string             // 来自 PortValue.meta（角色/场景名，供素材库标签与 §9.4）
  dims?: { w: number; h: number }          // 懒补：回填阶段留空，首次在素材库渲染/加载时补
  sourceProjectId?: string                 // 首次发现它的工程（仅溯源，非归属/非删除依据）
  createdAt: number
}
```

**回填步骤（`backfillAssetRegistry`）**

1. `const reg = (await sget<Record<string, AssetRecord>>('assets:registry')) || {}`（以 map 按 `id` 去重，天然幂等）。
2. 遍历 `projects:index` 的每个 id（拆分已先行，故此处读 `project:<id>`；若拆分被跳过则回退读 `projects`）。
3. 对每个节点 `outputs` 的每个 `PortValue`，递归展开 `items[]`，凡含 `assetId` 且为媒体类型者：
   - `if (reg[assetId]) continue;`（已登记跳过）。
   - `type` 取 `PortValue.type`；`mime` 取 `PortValue.mime`（已知，无需读二进制）；`name/kind` 取 `meta`。
   - **`dims` 懒补**：回填阶段**不**调用 `loadAsset` 解码图片（避免首启批量解码卡顿与内存峰值）；`dims` 留 `undefined`，待素材库首次展示该资产时按需测量后回写 registry。
   - `role` 推断：节点 `kind`∈生成类→`generated`；`image-input/audio-input` 且经 `setNodeImage/setNodeAudio`→`uploaded`；其余→`generated`（保守）。
4. 一次性 `sset('assets:registry', reg)`。

**关键约束**
- 回填**只读引用、不搬二进制**：attachment 仍由 `assetId` 指向同一份 `storage.attachment` 数据，**零拷贝、零额外存储**。
- 与 executor 语义零冲突：registry 是**旁路索引**，运行/渲染路径仍走 `loadAsset(assetId)`，不改 `PortValue`。
- 缺失资产（attachment 已被旧逻辑遗漏/外部清掉）：`loadAsset` 在展示时返回 null —— 回填阶段**仍登记该 record**（dims 留空），由素材库标记「丢失」而非静默吞掉；不在迁移期删除任何 record。

---

### 9.3 `deleteAsset` 正式接入 + 标记-清除式 GC

**现状（ground-truth 已确认）**：`deleteAsset`（`assets.ts:72`）全插件**零调用**，attachment 只增不减——删节点、删工程、重跑/编辑/重绘（每次 `saveAsset` 铸新 `assetId` 弃旧）、切工程，全部留下孤儿。

**A. 接入 `deleteAsset`（堵泄漏，但仅删「确定不再被引用」者）**

由于素材库为**全局共享、跨工程复用**，**绝不能**在删节点/删工程时直接对其 `assetId` 调 `deleteAsset` —— 同一 `assetId` 可能被素材库或其他工程引用。因此采用**引用计数 + 二次确认**，而非即时删：

| 触发点 | 处理 |
|---|---|
| `removeNode`/`deleteSelected` | 收集被删节点 outputs 的 `assetId`；**不立即删**，标记为「可能孤儿」候选，交由 GC 统一判定 |
| 重跑/`editNodeImageItem`/`regenNodeImageItem`（铸新 id 弃旧） | 旧 `assetId` 加入候选；GC 时若无任何引用且不在 registry 的「保留」集 → 回收 |
| `deleteProject` | 删 `project:<id>` 后，其独占的 `assetId`（不被其他工程/Elements 引用）进入候选 |
| 手动「彻底删除资产」（素材库内） | 经二次确认后**直接** `deleteAsset(id)` + 从 registry 摘除 |

**B. GC 用「全工程引用 ∪ Elements 引用」做标记-清除**

```
mark  = ⋃ over 所有 project:<id> 的 outputs(含 items) 的 assetId
      ∪ ⋃ over Elements 全局库(角色/场景 ElementRef, elements:library, Phase 2) 引用的 assetId
      ∪ registry 中 starred/pinned 的资产（用户显式保留）
sweep = storage.attachment.list()  →  对每个 {id} ∉ mark  的附件，列入「待回收」
```

- **枚举孤儿**用此前未被使用的 `storage.attachment.list(prefix?)`（ground-truth 标注 AVAILABLE but UNUSED），与 `mark` 求差集。
- **删前二次确认**：GC 不静默删除。先产出报告 `{count, totalBytes, sample[]}`，经 `dialog.showMessageBox`（「发现 N 个未被任何工程/素材库引用的孤儿文件，共约 X MB，是否清理？」）用户确认后，才逐个 `deleteAsset(id)` 并从 registry 摘除对应 record。
- **触发**：默认**手动**（设置页「清理孤儿素材」按钮）；不在启动链路自动跑，避免误删尚未补登记的资产。
- **安全边界**：标记集**以 registry + 所有 `project:<id>` + `elements:library` 为准**，因此 §9.1/§9.2 必须先完成（标记需要拆分后的全工程引用与 registry）；若 registry 回填未完成则 GC 直接拒绝运行（防止把「已生成但未登记」的资产误判为孤儿）。

---

### 9.4 角色/场景节点 → ElementRef：提供「保存到库」，不强制迁移

**决策：旧工程零改动照常打开，不做角色/场景的批量自动迁移。** 现有 `character`/`scene` 节点（`out:json` 身份 + `image:` 参考图，`meta:{name,kind}`）继续按原 executor 语义运行。Element 全局库（Phase 2）以**增量、用户主动**的方式填充：

- **入口**：在 `character`/`scene` 节点的 Inspector 输出区与节点右键菜单加「保存到库」（opportunistic 「Save as Element」式路径）。点击时把该节点的 `outputs.image.assetId` + `meta.name`/`kind` + 身份 JSON 提升为**一条 `ElementRef`**（写入 Phase 2 的 `elements:library` 全局库；其引用的 `assetId` **复用**现有 attachment，零拷贝，并被 GC 标记集纳入保护）。
- **不强制、不破坏**：
  - 不在迁移期扫描并自动创建 `ElementRef`（避免「自动抽取产生垃圾条目」的坑）；只在用户点击时单条保存。
  - 旧工程的 `character`/`scene` 节点**结构不变**，未保存到库者照常工作；保存到库**只新增** `ElementRef` 记录，不修改原节点 `outputs`/`params`。
- **绑定语义**（Phase 2 落地，迁移期仅预留）：插入画布时按引用绑定（`elementId`），不内联复制描述/图片，保「定义一次、跨工程复用、改一处全联动」。迁移本身不引入此绑定，故**对现有 executor 完全无侵入**。

---

### 9.5 回滚与验收

**回滚**：因旧键 `projects` 全程保留一版且迁移只新增键，回滚 = 删除新键 `projects:index`/`project:*`/`assets:registry`/`migrations:done`，插件即退回旧单键读路径。**用户数据零损失**（attachment 二进制从未被迁移删除）。

**验收清单**

- [ ] 旧装机升级后：工程数量/名称/节点/连线/产物缩略与升级前一致；`viewport` 现已恢复。
- [ ] `projects:index` 仅含 meta；`project:<id>` 含 graph；旧 `projects` 仍在。
- [ ] 重跑迁移（重启）为 no-op：不产生重复工程、不覆盖较新编辑、registry 无重复条目。
- [ ] `assets:registry` 覆盖所有工程 outputs 的 `assetId`（含扇出 `items`），`mime/type/name/kind` 正确，`dims` 允许为空。
- [ ] GC：`list() ∖ mark` 命中孤儿；删前弹确认；确认后 attachment 与 registry 同步减少；被任意工程/`ElementRef`/starred 引用的资产**不被删**。
- [ ] 全程无任何 Key 被读取/写入/导出（迁移代码不引用 `keys.ts`/`storage.encrypted`）。

**相关文件**：`/Users/zhuanz/workspace/other/mulby-all/mulby-plugins/plugins/ai-film-studio/src/ui/store/graphStore.ts`（`init`/`saveProject`/`switchProject`/`deleteProject`/`importProject`/`removeNode`/`deleteSelected` 改造，并**导出** `sget`/`sset`/`serializeNodes`/`stripValue`/`makeDefaultProject` 供 `migrate.ts` 复用）、`/Users/zhuanz/workspace/other/mulby-all/mulby-plugins/plugins/ai-film-studio/src/ui/services/assets.ts`（`deleteAsset` 正式接入）、`/Users/zhuanz/workspace/other/mulby-all/mulby-plugins/plugins/ai-film-studio/src/ui/services/migrate.ts`（新增）。

> **可选后续项（非本次一次性迁移强制）**：`promptStore` 全局层当前持久化到**默认命名空间**的 `afs:promptOverrides`（`promptStore.ts:11`），与 `graphStore`/`providerStore` 使用的 `'ai-film-studio'` 命名空间不一致。若要统一命名空间，须额外做一次 `afs:promptOverrides`(默认 ns) → `'ai-film-studio'` ns 的搬运并**保留旧键回退**——这属于带读取键变更成本的破坏性动作，与本章「只新增键、不动旧键」的总原则不同，故不并入本次一次性迁移，列为独立的可选小迁移项。

## 10. 风险与对策 + 验收清单

### 10.1 风险登记表

| # | 风险 | 触发场景 | 影响面 | 等级 | 对策（工程化） | 验证手段 |
|---|------|----------|--------|------|----------------|----------|
| R1 | **迁移破坏存量工程** | Phase 1 将单键 `projects`（`ProjectData[]`，namespace `ai-film-studio`）拆为 `projects:index`（`ProjectMeta[]`）+ `project:<id>`（重型 graph）；迁移中途崩溃、旧版本回读、或脏数据导致解析失败 | 用户既有全部工程不可见 / 丢失 | **高** | ① **旧键只读、不删**：迁移仅向新键写入，`projects` 原键保留为只读回退源，至少跨一个发布周期不清理。② **幂等迁移**：迁移入口先读 `projects:index`，若已存在 schema 版本标记则跳过；以 `schemaVersion` 字段（写入 `projects:index`）判定，重复执行无副作用。③ **新→旧回退读**：`projects:index` 缺失时回退读旧 `projects` 并即时迁移；单个 `project:<id>` 缺失但 `index` 有条目时，标记该工程为 `degraded` 并提示，不连带影响其它工程。④ 迁移在写入新键全部成功后才更新 `currentProjectId` 指向。 | 用「N 个工程 + 旧键存量」夹具跑迁移；二次启动校验不重复迁移；手工删除某 `project:<id>` 验证降级隔离 |
| R2 | **重构面过大失控** | rail 四界面 + Dock 三标签 + 全局库 + 存储拆分 + 泄漏修复同时落地，回归不可控 | 引擎/画布回归，交付延期 | **高** | ① **严格分期**：Phase 1 只做存储拆分与迁移，**不动 executor / runNode / runFrom / runAll / PortValue 语义**；Phase 2 做素材库（`assets:registry`）+ 角色/场景全局库（`elements:library`，从最后阶段提权至此）；后续阶段做 rail 与 Dock。② **库为增量**：所有库能力以新增 store / service / 组件实现，不改 `graphStore` 既有方法签名，节点执行路径零改动。③ 每阶段独立可回滚（feature flag 或路由级隔离），上一阶段未验收不进入下一阶段。 | 每阶段结束跑全节点 kind 烟囱测试（input→text→image→video→audio→output）确认引擎输出与重构前逐字一致 |
| R3 | **窄屏挤占画布** | 1100×720 最小窗口下，rail(56–64px) + 二级 Dock(240px) + Inspector(286px) 同时展开，画布可用宽 < 520px | 编辑器不可用 | **中** | ① rail 固定细窄（**56px**，仅图标，hover 出标签），**不可折叠**（保持唯一回退锚点）。② 二级 Dock 可折叠至图标条 / 按需浮层，宽度持久化。③ Inspector 可隐藏（chevron + 快捷键），未选中节点时自动收起。④ **响应式网格**：工程主页/素材库卡片用 `repeat(auto-fill, minmax(240px,1fr))`，按容器宽连续 reflow，不用硬断点。⑤ < ~1200px 时二级 Dock 自动折叠为图标条。 | 在 1100×720 / 1280×800 / 1400×900 三档窗口手测：画布最小可用宽 ≥ 520px；折叠/隐藏状态跨重启持久化 |
| R4 | **GC 误删在用资产** | 修复存储泄漏（`deleteAsset` 已定义于 `assets.ts:72` 但从未被调用）时引入孤儿清扫；全局库使资产**跨工程复用**，单工程引用计数会误判共享资产为孤儿 | 误删被多工程引用的角色/场景图，不可恢复 | **高** | ① **并集标记-清除**：扫描 `storage.attachment.list()`，标记集 = **所有** `projects:index` 工程的 `project:<id>` 中全部 `PortValue.assetId`（含 `items[].assetId`）∪ 全局素材库 `assets:registry`（`AssetRecord.assetId`）∪ 全局角色/场景 `elements:library`（`ElementRef` 解析出的 refImages assetId），取**并集**后清除补集——绝不按单工程引用计数。② **二次确认**：GC 为显式动作，先列出候选孤儿（数量 + 缩略图 + 预估释放空间），用户确认后才调用 `storage.attachment.remove(id)`。③ **软删冷却**：候选不立即删，标记后下一轮仍在标记集则视为复活、移出候选，连续两轮命中才删。④ 删工程 / 删节点 / 覆盖输出（re-run/edit/regen 产生新 assetId 孤立旧 id）均**不即时硬删**，只交由并集 GC 统一处理，避免漏标共享资产。 | 构造「同一 assetId 被 2 个工程 + 角色库（`elements:library`）共同引用」夹具：删其一工程后跑 GC，断言该 assetId **不在**候选集；断言 list 减去并集 = 候选集 |

### 10.2 重构总验收清单

> 勾选项；每一项需在明/暗主题与 1100×720 窄屏下复测一遍。

**rail 四界面（工程主页 / 画布编辑器 / 素材库 / 提示词库；+设置）**
- [ ] 左侧 56px 图标 rail 渲染，hover 出标签，rail **始终可见、不可折叠**
- [ ] rail 选中即整面切换中心视图（surface 级切换，非模态叠加），各界面拥有各自的 Dock 布局
- [ ] 最近活跃界面跨窗口重开后被恢复
- [ ] 设置入口（供应商 / 全局 / 提示词）从 rail 或固定工具栏可达，与既有 `ProviderSettings/GlobalSettings/PromptSettings` 模态打通

**工程主页（Project Home）**
- [ ] 工程卡片网格（封面缩略图 + 标题 + 更新时间），`auto-fill minmax(240px,1fr)` 连续 reflow，窄屏不破版
- [ ] 新建 / 打开 / 重命名 / 删除工程可用；删除后**不再**强制自动重建默认工程残留泄漏（与 R4/GC 联动）
- [ ] 工程列表读自 `projects:index`（`ProjectMeta` only），打开工程时**懒加载** `project:<id>` 重型 graph
- [ ] 排序 / 筛选控件位于网格上方

**画布编辑器（Canvas Editor）**
- [ ] 画布内左侧 Dock 为「节点 | 素材 | 提示词」三标签
- [ ] 三标签内容均可**拖入画布**（节点沿用 `DND_MIME='application/afs-node'`；素材落为对应 `PortValue.assetId`；提示词落入节点 prompt 字段）
- [ ] Inspector 可隐藏 / 自动收起；Dock 可折叠为图标条，宽度与折叠态持久化
- [ ] 全节点 kind 执行路径与重构前逐字一致（executor / `PortValue` 语义零改动）

**素材库（全局共享、跨工程复用）**
- [ ] 素材库为**全局**存储（`assets:registry`，`AssetRecord[]`），非工程内子集；同一资产可被多个工程引用而无需复制
- [ ] 生成结果可「保存到素材库」（登记 `AssetRecord`）；素材可从库插入任意工程画布（落为 `assetId` 引用，非内联 base64）
- [ ] 「生成 vs 导入」两正交轴（`AssetRecord` 的 origin / role）可区分展示
- [ ] 缺失 / 被驱逐的 attachment 在库中有占位与提示，不静默空白

**全局角色 / 场景库（Elements，跨工程复用，Phase 2）**
- [ ] 角色 / 场景 Element 定义一次、跨工程复用，存于全局 `elements:library`；插入画布时**按 `ElementRef` 引用绑定**（携带稳定 element id），非内联快照
- [ ] 可从现有 `character`(out=json,image=角色图) / `scene`(out=json,image=场景图) 节点「保存到库」，回填 name/refImages/description
- [ ] Element 携带类型化字段（character 可带 voice；scene 可带 lighting/timeOfDay），绑定时随 `ElementRef` 解析
- [ ] 同名跨源在 @-autocomplete / 插入选择中显示来源以消歧；绑定到稳定 element id 而非显示名

**提示词库（3 层覆盖：项目 > 全局 > 内置默认）**
- [ ] 固定节点模板（`text.script`/`text.storyboard`/`image.charImage` 等既有 ids）的三层覆盖生效，且可逐层「还原默认」（删项目层即回落全局/内置）
- [ ] 可复用 snippet（style/camera/lighting/negative）持久化于 `prompts:snippets`（`PromptSnippet[]`），按引用嵌入模板，编辑一处随处更新；关键节点可按版本钉住
- [ ] 项目层提示词覆盖随工程持久化（`ProjectData.promptOverrides`），与全局层（`afs:promptOverrides`）命名空间不再混淆

**迁移与泄漏修复**
- [ ] `projects` → `projects:index` + `project:<id>` 一次性迁移幂等；旧键只读保留，二次启动不重复迁移
- [ ] `deleteAsset` / 并集标记-清除 GC 接入；删工程、删节点、覆盖输出产生的孤儿可被回收，且共享资产不误删（R4 夹具通过）
- [ ] `importProject` 不再原地覆盖当前工程，而是新建工程行；导入资产不孤立既有资产
- [ ] `exportProject` 与持久化表示对齐（导出剥离 data URL 为 assetId 口径，或显式打包资产），不再内联巨型 base64
- [ ] `viewport` 持久化与恢复（画布平移/缩放跨切换保留）

**明暗主题 / 窄屏**
- [ ] 全部新界面（rail / 工程主页 / 素材库 / 提示词库 / Elements 库）在明、暗两套主题下样式正确，响应 `onThemeChange`
- [ ] 1100×720 最小窗口下：rail 固定、Dock 可折叠、Inspector 可隐，画布最小可用宽 ≥ 520px
- [ ] 所有面板宽度 / 折叠态 / 最近界面跨重启持久化，不复位

---

## 附录 A. 参考来源

- https://invoke.ai/features/gallery/
- https://support.invoke.ai/support/solutions/articles/151000170653-creating-and-managing-boards
- https://support.invoke.ai/support/solutions/articles/151000201744-using-sketches-and-reference-images
- https://raw.githubusercontent.com/invoke-ai/InvokeAI/main/invokeai/app/services/image_records/image_records_common.py
- https://raw.githubusercontent.com/invoke-ai/InvokeAI/main/invokeai/app/services/board_records/board_records_common.py
- https://raw.githubusercontent.com/invoke-ai/InvokeAI/main/invokeai/app/services/image_records/image_records_sqlite.py
- https://raw.githubusercontent.com/invoke-ai/InvokeAI/main/invokeai/app/services/board_image_records/board_image_records_sqlite.py
- https://github.com/invoke-ai/InvokeAI/pull/6931
- https://github.com/invoke-ai/InvokeAI/pull/6546
- https://github.com/invoke-ai/InvokeAI/issues/8902
- https://invoke.ai/releases/version/v6-12-0/
- https://invoke-ai.github.io/InvokeAI/features/database/
- https://github.com/11cafe/comfyui-workspace-manager
- https://github.com/11cafe/comfyui-workspace-manager/blob/main/README.md
- https://github.com/11cafe/comfyui-workspace-manager/issues
- https://github.com/ketle-man/ComfyUI-Workflow-Studio
- https://github.com/cillyfly/inner-comfyui-browser
- https://github.com/Nuked88/ComfyUI-N-Sidebar/blob/main/README.md
- https://github.com/Comfy-Org/ComfyUI_frontend/issues/3560
- https://github.com/Comfy-Org/ComfyUI/issues/10040
- https://github.com/Comfy-Org/ComfyUI/issues/10225
- https://forum.comfy.org/t/grouped-workflows-and-comfyui-examples-in-app/1041
- https://github.com/biagiomaf/smart-comfyui-gallery
- https://deepwiki.com/Comfy-Org/ComfyUI_frontend/4.4-workflow-tabs-and-management
- https://comfyui-wiki.com/en/interface/features/template
- https://docs.comfy.org/interface/features/template
- https://ltx.io/blog/top-ltx-studio-features
- https://ltx.io/blog/how-to-create-a-consistent-character
- https://ltx.io/studio/platform/ai-storyboard-generator
- https://ltx.io/blog/ltx-storyboard-generator-update
- https://ltx.io/blog/introducing-projects
- https://ltx.io/blog/introducing-brand-kit-in-ltx-studio
- https://ltx.io/blog/mastering-camera-motion-gen-space
- https://docs.promptlayer.com/why-promptlayer/prompt-management
- https://docs.promptlayer.com/features/prompt-registry/snippets
- https://docs.promptlayer.com/features/prompt-registry/overview
- https://www.promptlayer.com/platform/prompt-management
- https://portkey.ai/docs/product/prompt-engineering-studio/prompt-partial
- https://docs.portkey.ai/docs/product/prompt-library/prompt-partials
- https://portkey.ai/features/prompt-management
- https://humanloop.com/docs/prompt-management
- https://humanloop.com/docs/v5/guides/evals/comparing-prompts
- https://humanloop.com/docs/reference/prompt-file-format
- https://humanloop.com/docs/v5/reference/serialized-files
- https://humanloop.com/docs/v5/guides/prompts/store-prompts-in-code
- https://snippetsai.mintlify.app/essentials/reusable-snippets
- https://www.getsnippets.ai/articles/promptlayer-vs-langsmith-vs-snippetsai
- https://chromewebstore.google.com/detail/ai-prompt-snippets/nkphekhobdpkcgighepohnlejlmikkbm
- https://help.figma.com/hc/en-us/articles/23954856027159-Navigating-UI3
- https://help.figma.com/hc/en-us/articles/360039831974-View-layers-and-pages-in-the-left-sidebar
- https://linear.app/now/how-we-redesigned-the-linear-ui
- https://linear.app/changelog/unpublished-collapsible-sidebar
- https://help.penpot.app/user-guide/the-interface/
- https://help.penpot.app/user-guide/first-steps/the-interface/
- https://helpx.adobe.com/nz/creative-cloud/help/creative-cloud-desktop-app-home-screen.html
- https://m3.material.io/components/navigation-rail/guidelines
- https://m3.material.io/components/navigation-drawer/guidelines
- https://www.shadcnblocks.com/block/application-shell12
- https://www.navbar.gallery/blog/best-side-bar-navigation-menu-design-examples
- https://cr0x.net/en/card-grid-auto-fit-minmax/
- https://medium.com/@ilha.dev.br/how-to-use-auto-fit-auto-fill-and-minmax-on-grid-css-for-better-responsiveness-d727d0e4259f

## 附录 B. 编制说明

本方案由多智能体工作流产出并交叉校验：5 路标杆调研（InvokeAI / ComfyUI 生态 / LTX Elements / PromptLayer·Humanloop·Portkey / 桌面创作应用 IA）+ 1 路代码事实抽取（read-only），各章草稿经对抗式校验比对真实代码（杜绝臆造宿主 API、与已锁定决策一致）。所有文件路径/宿主 API/store 方法均以 `plugins/ai-film-studio` 现有代码为准。
