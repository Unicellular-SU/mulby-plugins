# AI 创意画布 — 对标 AI-CanvasPro 的功能补全与 UI 升级方案 · v3（定稿）

> 适用插件：`mulby-plugins/plugins/ai-creative-canvas`
> 文档目的：在**最大化复用现有代码**的前提下，系统性补齐相对 AI-CanvasPro 的功能与细节差距、重构 UI，让产品「不显简陋」。
> 红线：ai-creative-canvas = **自由画布 + 逐卡片按需生成 + 富媒体后期编辑 + @引用**；不做 ai-film-studio 的「一键全图流水线」。
>
> **定稿修订摘要（相对评审草稿）**：
> - 修正不准确的现有代码引用：`canGenerate` 是 `generate.ts` 顶层导出函数（非 `generate.canGenerate` 对象方法）；`removeBackground/upscaleImage` 是无参 arrow const，扩展须改写签名而非「加参数」；`references.ts` 的 `matKindOfCard` 是 **private 未导出**（第 5 行），复用前必须先 `export`。
> - 纠正 manifest 权限项：经核对宿主 `develop-mulby-plugin/references/apis/manifest.md` 权限表，**不存在 `filesystem`/`ai`/`network`/`http` 权限键**——filesystem/http/network/sharp/ai.images 调用**无 manifest 权限门**，当前 `clipboard+notification` 已够用；仅当承载「AI 生成命令」才需 `commandExecution.ai`（本插件不需要）。详见 5.5.5 与第 9 节。
> - `Edge.createdAt` 加字段：补齐 migrate（旧工程边回填）、模板序列化（`saveGroupAsTemplate` 的 edges map）、`insertTemplate` 重建边（`graphStore.ts` L344-353）三处遗漏。
> - 补遗漏 gap：50MB 单文件 / 单 KV 体积上限对整包写盘与分片 board 键的影响；CanvasPro 的自由绘制标注层/箭头批注、网格数值标尺刻度；虚拟化补「结构预算分批挂载（12/帧、8ms）」；视频抠像须前置探测 ffmpeg 是否含 libvpx-vp9，否则退化合成到背景色。
> - 强化集成契约：P0 锁定「保活集合含连线端卡」契约；`updateCard` 写 `meta.task` 不入历史；image/video 两套参数 schema 统一为一个 `Field` 类型 + 一个渲染器；分片/多工程/崩溃恢复三套 storage 键一次性规划。
> - UI 专章可施工性：任务面板队列序号依赖 `createLimiter` 暴露队列长度（当前不暴露，须先扩接口）；类型色提为 CSS 变量；左下/左侧浮层 tooltip 从一开始用 portal 版；浮动工具条/编辑面板夹取以舞台 rect 为基准、翻转避让、与 auto-pan 共用 rect。

---

## 0. 一页纸结论（TL;DR）

按优先级排列的最关键补全 + UI 升级要点（P0 最高）：

| # | 优先级 | 要点 | 性价比说明 |
|---|---|---|---|
| 1 | **P0** | **交互降级 body/data 体系**（`data-interacting='pan/drag/zoom'`、`data-zoom-low`）+ **平移/框选预览解耦**（拖动期只写 DOM transform，松手才 commit store） | 「看起来不简陋」最高性价比一步：静止精致、交互流畅。纯 CSS + 几行 JS，复用 `CanvasStage.tsx` 现有 `flush/schedule/panAcc/dragAcc`。 |
| 2 | **P0** | **设计令牌系统**：把 `styles.css` 的 4 个变量扩成 surface/text/accent/类型色/radius/space/shadow/blur/glass 一套 token，所有浮层统一玻璃质感 | 整体观感升级的地基，收益最大、风险最低。 |
| 3 | **P0** | **统一 Toast + 任务中心面板**：替换分散的 `mulby.notification` 与 5 处重复 `notify()`；TopBar 计数升级为可点开的任务列表（进度/状态色/取消） | 反馈可见性是成熟产品的核心信号。 |
| 4 | **P0** | **便签卡（note）+ 卡上浮动工具条（FloatingToolbar）** | 把画布从「纯生成器」变成「可批注的创作台」；工具从「编辑面板底部一排」移到卡上方居中。 |
| 5 | **P0** | **卡内嵌视频播放器**（播放/静音/可拖拽进度条/截帧）+ **视频裁剪可视化时间轴**（缩略图条 + in/out 手柄 + scrub） | 媒体后期观感提升最大的两项。 |
| 6 | **P0** | **通用任务运行时 TaskRuntime**（submit/poll/cancel/resume + taskId 持久化）+ **局部重绘范式正确化**（挖透明洞/填绿，结果落新卡） | 解决「视频任务不可中断、刷新即丢」的硬伤；让 inpaint/扩图/抠像真正可用。 |
| 7 | **P0** | **导演级分镜 system prompt + Shot schema 扩展**（拆分规则/静帧规则/视频情绪规则 + 15 字段 + 列别名归一） | 零成本最大杠杆，纯文本常量。 |
| 8 | **P1** | **连接校验 + 拖线置灰不可连目标**（`.conn-invalid`）+ **对齐/分布命令**（6 对齐 + 等距）+ **多选包围盒吸附** | 把画布从「生成器」升级为「创作工具」。 |
| 9 | **P1** | **声明式参数 schema 引擎**（统一 `Field[]` + 单一渲染器，驱动 image/video 参数面板）+ **比例策略**（自适应/质量档反算/可视化比例图标） | 让参数随模型能力动态变化，消除「发了无效值」。 |
| 10 | **P1** | **持久化分片 + 签名跳过 + schemaVersion 迁移 + 崩溃恢复快照**（三套 storage 键一次性规划，注意单 KV 体积上限） | 桌面级稳健性根基。 |
| 11 | **P1** | **首尾帧具名输入槽 + 视频结果 poster 去黑屏 + 完成提示音** | 视频域专业感。 |
| 12 | **P2** | **节点虚拟化（含帧预算分批挂载）、小地图增强、自包含工程包导出、生成历史/作品库面板、多工程管理** | 中期扩展，量级较大但价值高。 |

---

## 1. 背景与目标

**为什么现在显得简陋。** 现有 ai-creative-canvas 已是一套自洽运行的无限画布引擎：自研视口（pan/zoom/wheel-to-cursor/fit）、卡片拖拽/框选/多选、贝塞尔连线、对齐吸附+参考线、分组（嵌套/折叠/换色/模板）、撤销重做、剪贴板、键盘快捷键、节点内联编辑器、基于 `mulby.storage` 的防抖自动持久化，四种 kind 的端到端生成也都跑通。但相对 AI-CanvasPro，差距集中在三类：

1. **交互层「未做降级与预览解耦」**——平移/缩放/拖动每帧都写 store 触发 React 重渲染整棵卡片层，无虚拟化，卡片一多即卡；交互期不关阴影/不简化连线，静止与交互两种状态没有视觉区分。
2. **视觉语言缺失**——`styles.css` 只有 4 个 CSS 变量，其余全是散落的 Tailwind 硬编码颜色；无统一玻璃面/阴影/圆角 token；浮层、菜单、模态各自手写；多处用原生 `prompt()/confirm()`。
3. **功能深度不足**——便签、卡上浮动工具条、卡内视频播放器、可视化时间轴、声明式参数、连接校验、任务中心、崩溃恢复、工程包、作品库、自由绘制标注、网格标尺刻度等成熟能力缺位；图像「编辑工具」（扩图/抠像/局部重绘）多是「上传图 + 一句 prompt」的近似实现。

**本方案要达到什么。** 在不重写架构、最大化复用现有 `graphStore / viewport / references / media* / engine / 各 service` 的前提下：
- 让画布交互在数百卡片下依然流畅（降级 + 预览解耦 + 虚拟化 + 帧预算分批挂载）；
- 建立令牌化视觉语言与一致的浮层/菜单/模态/toast/任务面板规范；
- 补齐 AI-CanvasPro 的高频能力（便签、浮动工具条、卡内播放器、时间轴、声明式参数、连接校验、首尾帧、局部重绘正确范式、作品库、工程包、崩溃恢复）；
- 同时**守住红线**：仍是「自由画布 + 逐卡片按需生成」，不引入「一键全图流水线」。

---

## 2. 现状盘点（复用清单）

> 凡是「造卡/造边/改图」的新功能，**必须**经下列入口，禁止直接 `setState` 改 `boards`。
> **可访问性约定**：表中标「★需先 export」的资产当前为模块内 private，复用前须先 `export` 或在新模块重实现，已在条目末注明。

### 2.1 画布引擎 / 状态（可直接扩展）

| 现有资产 | 文件:函数 | 直接可扩展为 |
|---|---|---|
| 视口/坐标系 | `src/ui/canvas/viewport.ts`: `worldToScreen/screenToWorld/zoomAt/fitToCards/clampZoom/rectsIntersect` | 所有预览换算、虚拟化可视矩形、对齐线换算、缩放朝中心、聚焦动画 |
| 舞台交互状态机 | `src/ui/canvas/CanvasStage.tsx`: `onPointerDown/onPointerMove/endInteraction/flush/schedule/panAcc/dragAcc/rafId` | 预览解耦、降级 data 属性、auto-pan、框选命中分流、虚拟化挂载过滤 |
| 卡片渲染 | `src/ui/canvas/CardView.tsx`: `CardView/fitAspect/startConnect/startCardResize/cycleResult` | 卡内视频播放器、标题双击重命名、元信息行、resize 入历史、关联高亮、多结果设主图 |
| 内联编辑器 | `src/ui/canvas/NodeEditor.tsx`: `onPrompt/insertToken/insertPreset/onUpload/removeMaterial` | slash 级联菜单、@分组配额、素材条拖排序/大图预览、首尾帧角色标记、调试参数区 |
| 对齐吸附 | `src/ui/canvas/snapping.ts`: `computeSnap`（纯函数） | 多选包围盒吸附、共线节点贯穿线、空间索引候选筛选 |
| 连线 | `src/ui/canvas/EdgeLayer.tsx`: `bezier/anchorOf`；`graphStore`: `addEdgeBetween/connectAll/createConnectedNode` | 连接校验闸、关联边高亮、置灰不可连目标 |
| 分组 | `src/ui/canvas/GroupView.tsx`；`graphStore`: `groupSelection/setParent/wouldCycle`；`types.ts`: `isCardInsideGroup/getDescendants` | 便签编辑交互复刻、归属判定改中心点/重叠比例、模板封面 |
| 撤销重做 | `src/ui/store/graphStore.ts`: `pushHistory/undo/redo/BoardSnap`（`HISTORY_LIMIT`） | 按 boardId 分桶、resize/聚焦快照入历史 |
| 剪贴板 | `graphStore`: `copySelection/paste`（含 idMap 重映射） | 粘贴保留内部连线、Alt 拖拽复制 |
| 持久化 | `src/ui/services/persistence.ts`: `loadProject/saveProject`（唯一出入口，`SCHEMA_VERSION` 已存在） | 分片 + 签名跳过 + migrate + 多工程 + 崩溃恢复 |
| 模板插入（重建边） | `graphStore.insertTemplate`（L316-358，含 edges 重建 L344-353） | Edge 扩字段时重建边须同步带新字段（见 5.7.5） |
| 数据模型 | `src/ui/types.ts`: `Card/Edge(L33-38)/Board/ProjectDoc/CardKind/CARD_DEFAULT_SIZE/KIND_META/GroupTemplate(L124+)` | 新增 `note/mediaclip/webref/panorama` kind、Shot 扩字段、`Edge.createdAt`（当前 Edge 仅 `id/source/target/kind`） |

### 2.2 生成 / Provider / 引用（可直接扩展）

| 现有资产 | 文件:函数 | 复用要点 |
|---|---|---|
| 生成入口 | `src/ui/services/generate.ts`: `generateCard/generateSelected/stopCard/canGenerate(kind)`、`aborters` | 新 kind 接进 switch；abort 升级为读 ctx；done 分支统一调 `history.record()`/`notifyDone()`；`canGenerate` 是**顶层导出函数**，给 note 加 `kind==='note' → false` 分支 |
| 文本生成 | `src/ui/services/aiText.ts`: `generateText`（vision 拼装在第 19-37 行附近） | `<think>` 清洗、@占位符有序交错、分镜 sourceMode 复用 |
| 图像生成 | `src/ui/services/aiImage.ts`: `generateImage`、`computeSize/aspectHint/styleHint` | 比例策略重构、声明式参数读 `card.params`、调试参数导出 |
| 视频/音频引擎 | `src/ui/services/providers/engine.ts`: `runVideoJob/runViaTemplate/renderTemplate/submitWithRetry/jget/setPath` | TaskRuntime 的 submit/poll 实现；通配响应路径、`{?x=val}` 条件、命名 transform |
| Provider 持久化 | `src/ui/store/providerStore.ts`: `upsert/setActive/getKey/setKey/activeFor`（密钥走 `storage.encrypted`） | 节点级 provider、导入导出、连通测试、key 白名单 |
| 引用解析 | `src/ui/services/references.ts`: `buildMaterials/resolveGenInputs/collectRefCards`；`matKindOfCard`（**★L5 private，需先 export 或在 `inputPolicy.ts` 重实现**） | 单一事实源；加 video/audio 输入、matOrder、关联集合、连接校验推断 |
| 并发限流 | `src/ui/util.ts`: `createLimiter`（动态 getter，**当前仅返回 `run` 函数，不暴露队列长度**——任务面板序号需先扩接口，见 6.6 / 5.5.2） | 按 kind 分池；single-flight；暴露 `pending()`/`active()` |
| 参数控件 | `src/ui/components/ParamControls.tsx`: `DurationSlider/SeedControl`；`videoSpecs.ts`: `durationValues/snapDuration` | 抽通用 `RangeField`；统一 `Field` schema 渲染分发；机位/视角控件 |
| 风格包 | `src/ui/services/stylePacks.ts`: `getStylePack/applyStylePack/videoStyleTag` | 提示词风格注入联动 |

### 2.3 媒体后期（可直接扩展）

| 现有资产 | 文件:函数 | 复用要点 |
|---|---|---|
| sharp 算法 | `src/ui/services/mediaImage.ts`: `cropImage/gridSlice/outpaintImage/editWithPrompt/getImageBytes`；`removeBackground/upscaleImage`（**无参 arrow const，L105/L108**，扩展须**改写签名 + 重写 prompt**，非加可选参数） | 扩图填绿、宫格余像素、EXIF rotate、色键、拼贴、`editWithPrompt` 复用 |
| ffmpeg 算法 | `src/ui/services/mediaVideo.ts`: `runFf/ensureFfmpeg/probeDuration/clip/toGif/extractFrames/sceneFrames/splitAudio/stripAudio/reverse/compress/composeFilm/buildComposeArgs` | 时间轴缩略、poster 抽帧、chromakey、场景时间码、多轨混音、补帧；**alpha webm 须先探测 libvpx-vp9 编码器，见 5.6.3** |
| 编排层 | `src/ui/services/mediaOps.ts`: `runImageTool/runVideoTool/runGridSlice/newMediaCard/placeImagesGrid`（限流 + 任务计数 + 落卡） | 加工具枚举、按钮级任务态、opts 透传 |
| 落盘基础 | `src/ui/services/media.ts`: `saveBase64/saveBytes/mediaPath/ensureSubDir/toFileUrl/loadImageInput/readAsArrayBuffer` | 所有新产物落盘唯一入口；hash 缓存层 |
| 导入 | `src/ui/services/importMedia.ts`: `importFiles/kindForMime/guessMimeByExt` | 网页提取批量建卡、扩展可导入类型 |
| 局部重绘 | `src/ui/services/inpaint.ts`: `inpaint`；`src/ui/components/MaskInpaintModal.tsx`: `paint/buildMask` | repaint/erase 双范式、画板复用、标注层底座 |
| 模态/控件 | `CropModal.tsx`（图上拖框）、`ComposeModal.tsx`（模态骨架 + 进度条 + `collectClips`）、`MediaToolbox.tsx`（IconBtn）、`Lightbox.tsx` | 时间轴/扩展框/抠像面板/全屏缩放 |
| 后端 RPC | `src/main.ts`: `downloadMedia/uploadImageToHost/synthSpeech/exportFile`（含 `ensureDir/sanitizeName/resolveBaseDir/getJsonPath`，落盘走 `mulby.filesystem.writeFile`、目录走 `mulby.system.getPath('userData')`） | 加 `extractFrames/fetchWebMeta/exportPackage/importPackage/scanOrphans/trashOrphans` |

### 2.4 UI 外壳 / 工程（可直接扩展）

| 现有资产 | 文件:函数 | 复用要点 |
|---|---|---|
| 集中 UI 状态 | `src/ui/store/uiStore.ts`（菜单/预览/参考线/剪贴板/各 flag） | 新增 `showTaskCenter/showHistory/recovery/connInvalidIds/spawnDir...` 按现有 set/get 模式 |
| 任务计数 | `src/ui/store/taskStore.ts`: `useTask`（inc/dec） | 升级为 `Map<cardId,TaskInfo>`，`active` 派生为 size |
| 顶栏/工具坞 | `TopBar.tsx`、`LeftDock.tsx`、`CanvasControls.tsx`（已是左下浮岛） | 工程切换器、浮岛 dock、Tab 重命名/关闭、token 化 |
| 下拉 | `src/ui/components/Select.tsx`（portal 到 body，已避免裁剪） | 加搜索/分组/分段变体；tooltip portal 范式可参照 |
| 设置 | `ProjectSettings.tsx`（portal 浮层 `place()`）、`ProviderSettings.tsx`（双栏 Row） | 合并为统一 SettingsModal 的 pane |
| 模板 | `src/ui/services/templates.ts`: `saveGroupAsTemplate(L55-69 序列化 edges)/listTemplates`；`graphStore.insertTemplate`；`TemplatePanel.tsx` | 子树归一化复用为复制连线、作品库底座、自定义预设持久化范式；Edge 扩字段须同步序列化与重建（见 5.7.5） |

---

## 3. AI-CanvasPro 能力全景（分域简表）

| 域 | 关键能力 |
|---|---|
| **画布引擎** | DOM 节点 + 自研视口；交互期只改 CSS transform（`viewportPanPreview/selectionBoxPreview`）、rAF 采样最新帧、松手才 commit；body `is-*` 降级类；双阈值滞回虚拟化（mount 600/park 900）+ 空间网格索引（1024 格）+ **结构预算（每帧 12 个、8ms 上限分批挂载）**；对齐辅助线发光、贯穿共线节点；对齐/分布命令；小地图增量着色；连线置灰不可连目标 + hover 描边光环；auto-pan；Alt 拖复制；fit 平滑动画；网格数值标尺刻度；快照不含视口。 |
| **节点体系** | ~18 种节点 + 统一节点基座（类型 mask 图标 + 计时器 + 媒体元信息 + BETA pill + 缩放反补偿）；浮动工具条三 Zone + 用户自定义布局；任务态按钮原地变取消；便签（Markdown/颜色/跳转）；**自由绘制标注层 / 箭头·矩形·文字图形批注**；多结果堆叠背板可拖出；选中关联高亮。 |
| **图像** | schema 驱动参数 UI（uiSchema fields + visibleWhen/disableWhen）；比例策略（10 档 + auto 自适应 + 质量档反算）；编辑工具统一「视觉标记 + 单输入图」范式（扩图填绿/擦除填绿/重绘挖透明洞）；free-angle 3D 立方体 + 相机角度→英文术语；拼贴 24 布局；宫格 1×1~5×5；全屏滚轮缩放平移；调试 API 参数。 |
| **文本/分镜** | 统一文本 API（多厂商归一、@图片N 占位符精确映射、contact sheet）；导演级 15 字段 schema + 四套 sourceMode prompt；时长解析与聚合；参考视频 ffmpeg 抽帧反推分镜；slash 两级级联 + direct/insertPrompt；预设体系 + 自定义；镜头语言助手；分镜表双视图 + 双媒体模式 + CSV。 |
| **视频/音频** | 双清单（ModelManifest + ExecutionManifest）+ 声明式 bodyMapping + 通配响应路径；通用任务运行时（submit/poll/cancel/resume）+ single-flight + 多家族状态归一；完成音效 + 通知；首尾帧/参考具名输入槽；多变体结果；Task Center；TTS/克隆/转换/人声分离。 |
| **媒体后期** | 多轨时间线剪辑（EDL 契约 + 纯函数算子）；可视化裁剪时间轴；场景检测（时间码 + 拆条）；视频抠像（SAM2 打点/绿幕色键）；音画分离/倒放/抽帧/补帧/放大；3D 导演台；360 全景；网页预览/参考卡。 |
| **数据/持久化** | IndexedDB 分片 + 签名跳过 + 增量删；桌面文件工程原子写 + 最近列表；崩溃恢复快照（mtime 守门）；在途任务恢复；自包含 .aicpkg 导出导入（路径穿越防护）；连接模型（refKind 推断 + 动态输入策略 + FIFO 驱逐 + 可解释拒绝）；资产管理器 + 孤儿 GC + 生成历史分页 + 加密密钥。 |
| **UX 外壳** | 250+ CSS 令牌 + 双主题 + 圆形揭示切换；悬浮岛布局；全局 tooltip portal；菜单回弹/副标题揭示；模态规范；任务中心；toast；100+ 快捷键可改键；7 分区设置；完成音；自动更新；i18n；吉祥物/骨架屏。 |

---

## 4. 差距矩阵

> 状态：`missing`（无）/ `partial`（有但不全）/ `crude`（有但简陋/范式不对）。成本：S/M/L。

### 4.1 画布引擎与交互

| 功能 | 状态 | 我们现状 | AI-CanvasPro | 优先级 | 成本 | 复用什么 |
|---|---|---|---|---|---|---|
| 预览解耦（拖动只写 DOM，松手 commit） | partial | flush 每帧写 store | viewportPanPreview / rafSampleLatest | P0 | M | `CanvasStage` panAcc/dragAcc/flush；`viewport.ts` |
| 交互降级 data 体系 | missing | 无 | body.is-* 降级类 | P0 | S | `CanvasStage` 钩子 + `CardView` className |
| 节点虚拟化（含帧预算分批挂载） | missing | 全量渲染 | 双阈值滞回 + 空间索引 + 12/帧·8ms | P1/P2 | L | `viewport.rectsIntersect`；hiddenMembers 过滤位 |
| 多选包围盒吸附 + 贯穿线 | partial | 仅 primary 吸附、全屏线 | computeMultiNodeSnapGuides | P1 | M | `snapping.computeSnap`（原地升级）；`GuideLayer` 改线段 |
| 对齐/分布命令 | missing | 无 | align_nodes / distribute | P1 | S | 新 `align.ts` + `graphStore.moveNodesByOffsets`；`BatchActions` |
| 连续生成方向 + 避让 | missing | 中心/落点放卡 | nodeSpawn/findAvailablePosition | P1 | S | 新 `spawn.ts`；`viewport.rectsIntersect`；`createConnectedNode` |
| 撤销按 board 分桶 + 高频入历史 | crude | 切 board 清空、打字不入 | history.js + 命令式 | P1 | M | `graphStore.pushHistory/undo/redo` |
| 连线置灰不可连 + 校验 | partial | 任意可连、kind 恒 ref | invalidNodeIds + isValidConnection | P1 | M | `CardView.startConnect`；`addEdgeBetween` 唯一入口 |
| 卡片多方位 resize + 入历史 | crude | 单手柄、不入历史 | 多方位 + shift 等比 | P2 | S | `CardView.startCardResize` 原地扩展 |
| 框选命中规则（group 包含/卡相交 + 死区） | partial | 一律相交 | 两套命中 + 3px 死区 | P2 | S | `CanvasStage.endInteraction`；`viewport.rectsIntersect` |
| auto-pan + Alt 拖复制 | missing | 无 | checkAutoPan / Alt duplicate | P2 | M | panAcc/dragAcc；`copySelection/paste` |
| 小地图增强 | partial | 仅点击跳转 | 拖框 + 类型着色 + memo | P2 | S | `Minimap.toMini`；`KIND_META.accent` |
| zoomBy 朝中心 | crude | 朝左上角 | zoom-to-cursor/center | P2 | S | `viewport.zoomAt`；`uiStore.stageSize` |
| Fit 平滑动画 + 聚焦选中 | partial | 瞬切、无聚焦 | animateViewport + Ctrl+0 | P2 | S | `viewport.fitToCards`；`doFit` |
| 网格数值标尺刻度 | missing | 仅点阵网格 | ruler ticks + 坐标读数 | P3 | S | `GridLayer`；`viewport.worldToScreen` |
| 快捷键补全 | partial | 缺 Ctrl+0/Tab/方向键/G | shortcuts.js 可配 | P2 | M | `CanvasStage.onKeyDown` |
| 归属判定改中心/重叠 + 收敛 | partial | 全包含、三处重复 | groupMembership 收敛 | P2 | M | `graphStore.setParent`；`types.isCardInsideGroup` |
| 画布截图 | missing | 无 | canvasScreenshot | P3 | M | `media.saveBytes`；`exportFile` |
| 持久化偏好 + schemaVersion | crude | 偏好不存、不迁移 | migrate + 偏好订阅 | P3 | S | `persistence.loadProject`；`providerStore` 范式 |
| 粘贴保留内部连线 | partial | 只搬卡 | copy 保留内部边 | P3 | S | `copySelection/paste` idMap；`saveGroupAsTemplate` |

### 4.2 卡片节点体系与内联编辑

| 功能 | 状态 | 我们现状 | AI-CanvasPro | 优先级 | 成本 | 复用 |
|---|---|---|---|---|---|---|
| 便签卡（note） | missing | 仅 6 kind | CommentNoteNode | P0 | M | `types.CardKind`；`GroupView` COLORS+contenteditable；`addCard`；`canGenerate` 加 note 分支 |
| 卡上浮动工具条 | crude | 嵌编辑面板底部 | floating-toolbar 三 Zone | P0 | M | `MediaToolbox`；`NodeEditor` 定位算法；`ContextMenu` portal |
| 任务态工具按钮 | missing | 仅生成按钮 | taskToolbarPresenter | P1 | M | `NodeEditor` busy 三态；`taskStore`；`generate.stopCard` |
| 节点基座统一（双击重命名/计时器/元信息/反补偿） | partial | 只读标题 | 统一基座 | P1 | M | `CardView`；`GroupView` 双击；`board.viewport.zoom` |
| 上下文菜单升级 | crude | 扁平无图标 | 图标+分组+子菜单 | P1 | M | `ContextMenu`；`ConnectMenu` OPTIONS；lucide |
| 自由绘制标注层 / 图形批注 | missing | 无 | annotation overlay（箭头/矩形/文字） | P2 | M | `MaskInpaintModal` 画板范式；新 `AnnotationLayer.tsx`；`card.meta.annotations` |
| 卡片类型目录扩展（分镜卡等） | partial | 6 kind | ~18 节点 | P2 | L | `CARD_CATALOG` 收敛；`StoryboardModal` |
| 素材条排序 + hover 预览 | partial | 无排序/预览 | refBar drag + 预览 | P2 | M | `NodeEditor` 素材条；`references.buildMaterials`；`Lightbox` |
| 多结果设主图 + 网格 + 拖出 | partial | 仅循环切 | 点选 + 展开 + 拖出 | P2 | S | `CardView` cycleResult/拖出机制 |
| 选中关联高亮 | missing | 仅自身 ring | selection-related | P2 | S | `references.collectRefCards`；`edges`；`EdgeLayer` hover |
| 比例可视化图标 | crude | 固定 5 种下拉 | img-rp-* 纯 CSS | P3 | S | `ParamControls` 比例控件 |

### 4.3 图像生成与图像工具

| 功能 | 状态 | 我们现状 | AI-CanvasPro | 优先级 | 成本 | 复用 |
|---|---|---|---|---|---|---|
| 局部重绘正确范式（挖洞/填绿 + 落新卡） | crude | 黑白遮罩当参考、覆盖原卡 | repaint/erase 视觉标记 | P0 | M | `MaskInpaintModal`；`inpaint.ts`；`addCard` |
| 声明式参数 UI（统一 Field 渲染器） | missing | switch 硬编码 | uiSchemaRenderer | P1 | M | `ParamControls`；`Select`；新 `imageModelSpecs.ts` |
| 比例 & 尺寸策略 | partial | 5 比例 + 倍数 | 10 档 + auto + 质量预算 | P1 | S | `aiImage.computeSize`；`resolveGenInputs`；sharp metadata |
| 扩图可视化 + 参数化 | crude | 固定 0.25 透明 | 拖框 + 绿底 + 四向 | P1 | M | `mediaImage.outpaintImage`；`CropModal`；`runImageTool` |
| 图像浮动工具条两段式 | crude | 一排裸 IconBtn | 主区 + 更多 | P1 | M | `MediaToolbox`；`runImageTool/runVideoTool` |
| 多图参考排序 + 预览 | partial | 顺序不可控 | refThumbDrag + 预览 | P1 | M | `NodeEditor`；`references.buildMaterials` |
| 宫格自定义 + 网格选择器 | partial | 写死 2×2/3×3 | 1×1~5×5 | P2 | S | `mediaImage.gridSlice`；`runGridSlice` |
| 多变体展开 + 拖出 | partial | 仅循环切 | 网格选用 + 拖出 | P2 | M | `CardView` results；`generate` meta.results |
| 全屏滚轮缩放平移 | partial | 静态 contain | 缩放 + 平移 | P2 | S | `Lightbox`；`viewport.zoomAt` |
| 视角控件（相机角度→术语） | missing | 无 | CameraPromptMapper | P2 | S | `ParamControls`；`aiImage` prompt 拼接 |
| 抠像本地色键 | crude | prompt stub | chromakey + 背景色 | P2 | M | `mediaImage.removeBackground`（改写签名）；sharp |
| 拼贴节点 | missing | 仅 gridSlice | collage 24 布局 | P2 | M | 新 `mediaCollage.ts`（sharp composite）；`resolveGenInputs` |
| 高清放大 | crude | prompt stub | 倍率 + 工作流 | P3 | S | `mediaImage.upscaleImage`（改写签名）；sharp resize |
| 调试 API 参数 | missing | 无 | formatFinalApiDebugRequest | P3 | S | `aiImage` 导出 `buildImageRequestDebug` |
| 裁剪 EXIF 防护 | partial | 未处理旋转 | rotate + 比例吸附 | P3 | S | `mediaImage.cropImage`；`CropModal` |

### 4.4 文本·分镜·提示词工效

| 功能 | 状态 | 我们现状 | AI-CanvasPro | 优先级 | 成本 | 复用 |
|---|---|---|---|---|---|---|
| 导演级分镜 system prompt | crude | 一条短中文 system | 三大规则常量 | P0 | S | `storyboard.generateShots` system |
| Shot schema 扩展（15 字段 + 列别名） | partial | 7 字段 | COLUMN_LABELS + ALIASES | P0 | M | `types.Shot`；`generateShots` map |
| 时长解析与聚合 | missing | `Number()` | parseDurationSeconds | P1 | S | `videoSpecs.ts` 或 `storyboard.ts` |
| sourceMode 自动判定 | missing | 只吃文本 | 四套 prompt | P1 | M | `references.resolveGenInputs`；`aiText` attachments |
| 视频抽帧反推分镜 | missing | 无 | ffmpeg 抽帧 + 反推 | P2 | L | `mediaVideo.extractFrames/sceneFrames`；`main.ts` rpc |
| 分镜表双视图 + 双媒体 + CSV | crude | textarea 网格 | list/card + 隐藏空列 | P1 | M | `StoryboardModal`；`Select`；`exportFile` |
| 勾选多行派生 + 自动跑 | partial | 全部一次落地 | 选中行 + 自动跑 | P1 | S | `storyboard.materializeShots`；`generateSelected` |
| slash 级联 + 双触发徽章 | crude | 单层平铺 | 两级 + 键盘导航 | P1 | M | `NodeEditor` mention 状态机；`generateCard` |
| 提示词预设体系 | crude | 15 条扁平 | 分组 + 模板 + 自定义 | P1 | M | `presets.ts`；`templates.ts` storage 范式；`promptTools` |
| 扩写/风格化/反推结构化 | partial | 无固定结构 | 反推三段 + 精缩 | P2 | S | `promptTools.enhancePrompt/describeImage`；`stylePacks` |
| @占位符精确映射 | partial | 全堆末尾 | buildPromptMediaParts | P2 | M | `aiText.generateText`；`resolveGenInputs` 有序 images |
| 镜头语言助手 | missing | 仅 6 运镜 | CameraPromptMapper | P2 | S | `ParamControls`；`generate` motionHint 位 |
| @候选分组 + 配额置灰 | partial | 仅 label 过滤 | 分组 + limitReason | P3 | M | `NodeEditor` refList；`buildMaterials` |
| 整组镜头一键转视频 | partial | 单卡 | 批量派生 | P2 | S | `storyboard.shotToVideo`；`addCard/addEdgeBetween`；`groupSelection` |
| 流式 reasoning/tool | partial | 丢弃非 text 块 | think 清洗 + tool | P3 | M | `aiText.generateText` |

### 4.5 视频·音频任务运行时与 Provider

| 功能 | 状态 | 我们现状 | AI-CanvasPro | 优先级 | 成本 | 复用 |
|---|---|---|---|---|---|---|
| 通用任务运行时（submit/poll/cancel/resume） | crude | while(true) 不可中断 | generationTaskRuntime | P0 | L | `engine.runVideoJob/runViaTemplate`；`taskStore`；`generate.aborters` |
| single-flight 去重 | missing | 无 | taskSingleFlight | P1 | S | `util.ts`；包 `engine` 轮询 |
| 任务态归一 + 任务中心 | missing | 全局计数 | UI state resolver + Task Center | P1 | M | `taskStore`（扩任务表）；`graphStore` meta.task；`TopBar`；`createLimiter` 须暴露队列长度 |
| 完成提示音 + 通知 | missing | 无 | completionSound + notification | P2 | S | `mulby.notification`；`mulby.system.beep`；TaskRuntime 终态钩子 |
| 视频后处理（poster/codec/去重） | partial | 已落盘可播 | poster + dedupe | P1 | M | `mediaVideo` 抽帧；`media`；`main.downloadMedia`；`CardView` `<video poster>` |
| 声明式参数 schema 引擎 | crude | 硬编码枚举 | uiSchema 驱动 | P1 | M | `ParamControls`（统一 Field 分发）；`ProviderTemplate` 挂 paramsSchema |
| 首尾帧具名输入槽 | partial | 隐式按顺序 | inputSlots + 角色 | P1 | M | `references`；`NodeEditor` 素材条；`engine` 占位符 |
| 音频克隆/转换/分离 | partial | 仅 OpenAI TTS | indextts2/分离 | P3 | M | `engine.runVideoJob`（接异步音频）；`main.uploadImageToHost` |
| 按 kind 分池限流 | partial | 单 limiter 共用 | activeTasks 分池 | P2 | S | `util.createLimiter`（多实例）；`generate` |
| body 映射升级（when/transform/通配） | partial | 仅非空判断 | mappingEngine | P2 | S | `engine.jget/setPath/renderTemplate` |
| 视频多变体结果 | missing | 单 url | mainVideoIndex | P2 | S | `CardView` 多结果（已通用）；`generate` video 写 meta.results |
| Provider 导入导出 + 连通测试 + 多 active | partial | 硬编码、单 active | manifest 分享 | P2 | M | `providerStore`；`main.exportFile`；`Card.providerId` |

> 注：filesystem/AI/HTTP 调用**无 manifest 权限门**（见 5.5.5 与第 9 节），原草稿「filesystem 权限声明」一行已删除，不再作为差距项。

### 4.6 媒体后期编辑

| 功能 | 状态 | 我们现状 | AI-CanvasPro | 优先级 | 成本 | 复用 |
|---|---|---|---|---|---|---|
| 卡内嵌视频播放器 | crude | 裸 `<video muted>` | previewControls | P0 | M | `CardView` isVid；`media.saveBase64`；`syncPlay.collectGroupVideos` |
| 视频裁剪可视化时间轴 | crude | 两裸 number | 缩略图条 + in/out + scrub | P0 | M | `CropModal` 骨架；`mediaVideo.extractFrames/clip`；`runVideoTool` |
| 多轨时间线剪辑节点 | missing | 仅 ComposeModal | media-clip EDL | P1 | L | `mediaVideo.buildComposeArgs`（扩 trim/adelay）；`graphStore` 纯函数范式 |
| 视频抠像/绿幕色键 | missing | 无（图像 stub） | chromakey + SAM2 | P1 | M | `mediaVideo.runFf`（chromakey）；`runVideoTool`；**须前置探测 vp9 编码器** |
| 场景检测时间码 + 拆条 | partial | 仅代表帧 | 时间码 + marker + 拆条 | P2 | M | `mediaVideo.runFf/sceneFrames/clip`；`runVideoTool` |
| 抽帧/GIF/倒放/压制参数面板 | crude | 写死参数 | fps/CRF/体积预估 | P2 | S | `mediaVideo` 函数；`runVideoTool` opts；`ParamControls` |
| 成片合成可视化时间线 | partial | y/x 启发式 | 拖排 + 单段 trim | P2 | M | `mediaVideo.buildComposeArgs`；`ComposeModal` |
| 网页参考卡 | missing | 无 | WebReferenceCard | P2 | M | `main.ts` rpc（fetch + og:image）；`CardView` 分支 |
| 网页预览节点 | missing | 无 | WebPreview | P3 | L | `main.ts` rpc（提取过滤）；`importMedia`；`placeImagesGrid` |
| 360 全景查看器 | missing | 无 | panorama-360 | P3 | M | `CardView` 分支 + three.js；`media.saveBase64` |
| 视频补帧/放大 | missing | 无 | RIFE/minterpolate | P3 | S | `mediaVideo.runFf`（minterpolate）；`runVideoTool` |
| 媒体缓存/清理基础 | missing | 永久堆积 | sha1 缓存 + GC | P3 | M | `util.createLimiter`；`media`；hash |

### 4.7 工程持久化·恢复·打包·连接·安全

| 功能 | 状态 | 我们现状 | AI-CanvasPro | 优先级 | 成本 | 复用 |
|---|---|---|---|---|---|---|
| 分片 + 签名跳过 | crude | 全量重写 | 分片 + signature | P1 | M | `persistence`；`graphStore.withActiveBoard` 自增 rev；`storage.list/getMany`；**注意单 KV ≤50MB 上限** |
| schemaVersion 迁移 | missing | 不迁移 | migrate(p) | P1 | S | `persistence.loadProject`；`SCHEMA_VERSION`；含 `Edge.createdAt` 回填 |
| 崩溃恢复快照 | missing | 无 | recovery-snapshot | P1 | M | 新 `recovery.ts`；`util.debounce`；`replaceProject`；pagehide；**整包写 KV 须分 board 键避免撞上限** |
| 多工程管理 | missing | 单 project:current | multiData + 最近 | P2 | M | `persistence`（多键）；`templates` storage 范式；`TopBar` |
| 自包含工程包 .aicpkg | missing | 无 | yazl zip 导出导入 | P1 | L | `main.ts` rpc；`media.saveBase64`；引用重写；**单文件 ≤50MB → 大视频须分片或换 zip** |
| 孤儿素材 GC | missing | 永久堆积 | 差集 + 回收站 | P2 | M | `main.ts` rpc；`filesystem.trashItem`；`references` 引用收集 |
| 生成历史/作品库 | missing | 无 | 分页 + 瀑布流 | P2 | M | 新 `history.ts`；`generate` done 分支；`addCard`；`viewport` |
| 撤销分桶 + 高频入历史 | crude | 切 board 清空 | history.js | P1 | M | `graphStore.pushHistory/undo/redo` |
| 连接校验（类型/容量/可解释） | crude | 任意可连 | 输入策略 + FIFO 驱逐 | P1 | M | `addEdgeBetween` 唯一入口；`references.matKindOfCard`（**先 export**）；新 `inputPolicy.ts` |
| 在途任务恢复 | missing | 刷新即丢 | localStorage taskId | P3 | L | `engine` poll 抽出；`generate.aborters`；`storage` |
| 密钥隔离 | partial | key 加密、config 明文 | safeStorage + 白名单 | P2 | S | `providerStore`；导出排除 providers |
| 工程封面缩略 | missing | 仅文字名 | visualSnapshot | P3 | S | `viewport.fitToCards`；SVG 几何块；`types.Board` |

---

## 5. 增强方案（分模块详述）

> 每条按「**复用** → **改动点** → **新增**」三段写。**红线提醒**：所有改卡/改边必须经 `graphStore` action，所有落盘必须经 `media.ts`，所有读上游输入必须经 `references.ts`。

### 5.1 画布引擎与交互

#### 5.1.1 [P0] 交互降级 data 体系 + 预览解耦

**复用**：`CanvasStage.tsx` 现有 `inter` ref 状态机、`onPointerDown/onPointerMove/endInteraction/onWheel`、`panAcc/dragAcc/rafId/flush/schedule`；`viewport.ts` 的 `zoomAt/worldToScreen`；`stageEl.ts`；`CardView` className 结构。

**改动点**：
1. **降级属性**：在 `onPointerDown` 进入 pan/drag 时给舞台根 `setAttribute('data-interacting','pan'|'drag')`，`endInteraction` 清除；`onWheel` 时设 `data-zooming` 并用 200ms 定时器清；缩放 `< 0.45` 设 `data-zoom-low`。
2. **平移预览解耦**：pan 期间不调 `g.setViewport`，改用 ref 直接写外层 transform div 的 `style.transform`（用 `viewport` 换算的临时 vp），`endInteraction` 才 `g.setViewport` 一次提交。
3. **框选预览解耦**：marquee 用一个固定定位 div 的 ref 直接改 `left/top/width/height`，不走 `setMarquee(useState)`。
4. **wheel 合批**：用 `rafSampleLatest` 包裹 + 160ms 防抖后才持久化。

**新增**：
- `src/ui/canvas/rafSampleLatest.ts`（~20 行）：丢弃中间帧只跑最新一次的包装器。
- `styles.css` 降级规则：
```css
.ace-stage[data-interacting] .ace-card { box-shadow: none; }
.ace-stage[data-interacting] .ace-edge { /* SVG optimizeSpeed / 隐藏背板 */ }
.ace-stage[data-zoom-low] .ace-card-port,
.ace-stage[data-zoom-low] .ace-card-resize,
.ace-stage[data-zoom-low] .ace-card-badge { display: none; }
```

**集成契约（P0 锁定，跨里程碑共用）**：5.1.1 / 5.1.2 / 5.1.8 三处都改写同一套 `panAcc/dragAcc/flush/schedule` 与「写 DOM 还是写 store」的边界。**P0 即定死以下约定，避免后续锚点丢失或覆盖层错位**：
- 覆盖层（EdgeLayer/GuideLayer/Minimap）在**拖动期**依赖 store；预览解耦期间它们读临时 vp 并节流同步，松手 commit 后重算一次。
- **保活集合（keepAlive）= `selectedIds ∪ board.edges 两端卡 ∪ inter.current.ids（拖动中）∪ folded group 子`**，此集合是 5.1.2 虚拟化与覆盖层共用的唯一真相，写在 `CanvasStage` 顶层 useMemo，下发给虚拟化过滤与 EdgeLayer 锚点查询。**连线端点卡必须恒在 keepAlive 内**。

**风险**：setPointerCapture 下直接写 transform 要与现有 translate/scale 写法一致避免跳变。

#### 5.1.2 [P1/P2] 节点虚拟化（分阶段 + 帧预算分批挂载）

**复用**：`viewport.screenToWorld/rectsIntersect` 算可视世界矩形；`CanvasStage` 现有 `hiddenMembers` 过滤位叠加 `mountIds`；保活集合直接读 5.1.1 锁定的 `keepAlive`。

**改动点（阶段 1，P1，条件渲染）**：算可视世界矩形外扩 `padding = 600/zoom`，只渲染落入其中的卡 + keepAlive 集合；卡数 `< 120` 时跳过裁剪保持现状。React 下用 `display:none` 代替卸载（等价 park，保住 video 播放与状态实例）。

**新增（阶段 2，P2）**：
- **双阈值滞回**（mount/park）防边界抖动；节点数 `> 120` 才建简单网格空间索引（与 5.1.3 snapping 候选筛选共用）。
- **结构预算分批挂载**：首次进入千级卡片视口时，**不一次性挂载全部可见卡**——按「每帧最多挂载 12 个、单帧挂载耗时上限 8ms」用 rAF 分批 commit `mountIds`，剩余卡下一帧续挂。**这是 P2「千级流畅」验收的必要条件**，否则首次挂载会产生长任务卡顿。批次大小/时长上限作为常量可调。

**风险**：连线端点卡必须在 keepAlive 内，否则 EdgeLayer 锚点丢失；`fittedFor` 脏标记保证重新可见时不重复触发 onLoad。

#### 5.1.3 [P1] 多选包围盒吸附 + 共线贯穿线

**复用**：`snapping.computeSnap`（纯函数，原地升级，调用方 `CanvasStage.flush` 不动）；`GuideLayer.tsx`（仅改线段端点 + 加发光）；`viewport.worldToScreen`。

**改动点**：① `dragged.size>1` 时用所有被拖卡并集 bbox 当 primary 算吸附位移；② 命中后收集所有 `|edge-line|<eps` 的卡，算 min/max 作线段 start/end，`GuideLayer` 改画线段（`box-shadow:0 0 6px var(--accent-40)` 发光）；③ 候选用空间索引筛邻近卡去掉 O(n×9)；④ 抽共享常量 `GRID=24` 给 `snapping/GridLayer/GuideLayer`。

#### 5.1.4 [P1] 对齐/分布命令

**复用**：`graphStore.withActiveBoard+pushHistory`（参考 `moveCardsBy`）；`BatchActions.tsx`（现成多选浮动条）；lucide 图标。

**新增**：
- `src/ui/canvas/align.ts`：纯函数 `computeAlignOffsets(cards,ids,mode)`、`computeDistributeOffsets(cards,ids,axis,gap?)`，返回 `{id:{dx,dy}}`。
- `graphStore.moveNodesByOffsets(offsets)`：包 `pushHistory` + 一次 `set`（每卡不同 dx/dy）。
- `BatchActions` 在「生成选中/合成」旁加一排对齐（左中右上中下）+ 分布（横/纵等距）图标 + 间距输入，`selectedIds>=2` 显示；绑 `Tab`。

#### 5.1.5 [P1] 连续生成方向 + 避让

**复用**：`viewport.rectsIntersect`；`graphStore.createConnectedNode/addCard`（落点注入点）；`storyboard.materializeShots` 网格落卡可替换。

**新增**：`src/ui/canvas/spawn.ts`：`findAvailablePosition(cards,desired,size,dir,spacing)`（沿 right/down 推移到不相交，设最大步数防死循环）+ `getSpawnPrefs`（读 `uiStore.spawnDir/spawnSpacing/avoidOverlap`）。`uiStore` 加三个偏好 + 设置项。

#### 5.1.6 [P1] 撤销分桶 + 高频入历史

**复用**：`graphStore.pushHistory/undo/redo/BoardSnap`（`BoardSnap` 已带 boardId）；`CardView.startCardResize` up 回调；`NodeEditor` 输入 onFocus。

**改动点**：① `past/future` 改 `Map<boardId,{past,future}>`，切 board 不清空；② `startCardResize` up 时补 `pushHistory`；标题/prompt 用 onFocus 记 baseline、onBlur commit（避免逐字符入栈）；③ undo/redo 后不强制清 `selectedIds`，保留仍存在的 id；④ `removeBoard` 清该 board 栈防泄漏。viewport 不入历史（保持现状）。

**集成契约（与 5.5.1 TaskRuntime 交叉，必须遵守）**：`meta.task`（taskId/进度/phase）持久化属于 `card`，但**进度变更绝不能入历史**。`updateCard` 在写 `patch` 时若 patch 仅含 `meta.task`（或更一般地，patch 命中 `meta.task`/`status`/`progress` 等运行时字段），**显式跳过 `pushHistory`**。建议给 `updateCard` 加 `opts?:{ history?: boolean }`，运行时写入一律传 `history:false`；只有用户语义编辑（标题/prompt/params/位置/尺寸）才入历史。否则轮询会把进度灌满撤销栈。

#### 5.1.7 [P1] 连接校验 + 置灰不可连目标

**复用**：`CardView.startConnect`（window 级 pointermove/up + `elementFromPoint`）；`uiStore.connectTemp` 旁加 `connInvalidIds`；`graphStore.addEdgeBetween/connectAll/createConnectedNode`（唯一建边入口）。

**改动点**：① startConnect move 期间算 `invalidIds` 写 uiStore，`CardView` 对 invalid 加 `.conn-invalid`（`opacity:.28;filter:grayscale(.65);pointer-events:none`），hover 合法目标加 `.conn-hoverTarget` 描边光环；② 拖线结束清 invalidIds；③ 校验入口集中到三个建边 action。

**新增**：`src/ui/services/inputPolicy.ts`（与 5.7 连接模型共用）：`isValidConnection(source,target)`（初期只防自连/重复/防环最稳）。

#### 5.1.8 其余 P2/P3

- **多方位 resize + 入历史**：`CardView.startCardResize` 原地扩展（up 补 pushHistory、shift 等比、右/下/右下三向、resize 时设 `data-interacting='resize'`）。
- **框选命中分流**：`endInteraction` 对 `kind==='group'` 用完全包含、其余用 `rectsIntersect`；marquee 移动超 3px 才激活显示（未激活松手仍 `clearSelection`）。
- **auto-pan + Alt 拖复制**：drag 期检测指针距舞台边 `<60px` 启 rAF loop 持续喂 panAcc/dragAcc；`e.altKey` 命中卡时先 `copySelection+paste(0,0)` 再 drag 新卡。**auto-pan 的边界判定以舞台 `getBoundingClientRect()` 为基准（与 6.4/6.5 浮层夹取共用同一 rect），统一在 `stageEl` 取一次缓存**。
- **小地图**：视口框可拖拽（命中框=拖、框外=跳转）；矩形按 `KIND_META.accent` 着色；`useMemo` 缓存 bbox。
- **zoomBy 朝中心**：`CanvasControls.zoomBy` 改 `zoomAt(vp, stageSize.w/2, stageSize.h/2, factor)`（一行）。
- **Fit 平滑 + Ctrl+0**：`doFit` 有选中→fitToCards(选中)否则全部；`animateViewport` rAF ease 插值（~400ms，期间 `data-interacting='animating'`，新交互可打断）。
- **网格数值标尺刻度（P3）**：`GridLayer` 沿顶/左加刻度条，`viewport.worldToScreen` 算主刻度间距随 zoom 取整（如 50/100/200 世界单位），显示世界坐标读数；`data-interacting` 时隐藏减负。
- **快捷键补全**：`onKeyDown` 加 Ctrl+0 / Tab / 方向键微移（Shift+10px）/ G 切 showGrid / Shift+G 切 snapGrid / Alt 拖复制。
- **归属判定**：抽 `graphStore.reparentByContainment` 收敛 `CanvasStage.endInteraction` 与 `GroupView.startResize` 两处直改；判定改「中心点落入」或「重叠面积>50%」；保留「父被一起拖则保持归属」特例。
- **持久化偏好 + schemaVersion**：见 5.7。
- **粘贴保留内部连线**：`copySelection` 同存两端都在选区内的 edges，`paste` 用 idMap 重建（借 `saveGroupAsTemplate` 内部连线收集）。

---

### 5.2 卡片节点体系与内联编辑

#### 5.2.1 [P0] 便签卡（note）

**复用**：`types.CardKind/CARD_DEFAULT_SIZE/defaultTitle`；`GroupView` 的 COLORS 色块弹层 + contenteditable 双击编辑交互；`graphStore.addCard`；`updateCard`；`CardView` 选中 ring 与 `var(--ace-border)`；`CanvasStage` 现有 group 渲染分支位置。

**改动点**：`types.CardKind` 加 `'note'`，`CARD_DEFAULT_SIZE` 加 `{w:220,h:140}`，`defaultTitle` 加 '便签'；**`generate.ts` 顶层导出函数 `canGenerate(kind)` 加 `if (kind === 'note') return false` 分支**（注意是顶层函数，不是对象方法）；`CanvasStage` 渲染分支把 `kind==='note'` 路由到 NoteView（与 GroupView 并列）；`LeftDock/ContextMenu` 新建项加「便签」。

**新增**：`src/ui/canvas/NoteView.tsx`：
- contenteditable div，双击进编辑、blur/Enter 提交 `card.text`；
- 背景/文字色存 `card.params.{bg,fg}`，字号 `card.params.fontSize`；默认无边框，仅选中/编辑显边框；空态 placeholder '双击写下注释'；
- 文字色 5 列 + 背景色含「透明」棋盘格选项（照搬 GroupView COLORS 模式）；
- Markdown 模式开关 `card.params.md`（无渲染器则 `whitespace-pre-wrap`）；
- contenteditable 与画布拖拽冲突用 `data-interactive` + `stopPropagation`（参考 NodeEditor/GroupView）。

数据：note 走标准 Card 模型，拖拽/框选/归属天然支持。

#### 5.2.2 [P0] 卡上浮动工具条（FloatingToolbar）

**复用**：`MediaToolbox.tsx`（`IconBtn` + `runImageTool/runGridSlice/runVideoTool` 调用全保留，只改容器与定位）；`NodeEditor` 的 worldToScreen 上下翻转/左右夹取定位；`ContextMenu` 的 `createPortal`；`CropModal`；`viewport.worldToScreen`；`stageEl`。

**改动点**：把 MediaToolbox 升级为可定位浮动条：① 定位到 card 上方居中；② 按钮分两段——主区（裁剪/扩图/抠像/裁片段/全屏/下载）+「更多 …」弹层（宫格/GIF/抽帧/镜检/倒放/压制/局部重绘/标注），弹层用 portal 防裁剪；③ 视频起止秒移出工具条，改点「裁片段」后弹时间轴（见 5.6.2）；④ `data-interactive` 防穿透。

**避让契约（与 6.4/6.5 一致）**：工具条放卡上方、编辑面板放卡下方。**夹取边界以舞台 `getBoundingClientRect()` 为基准（与 auto-pan 共用同一 rect）**；当卡片贴近视口顶部、上方工具条会撞 TopBar 时**翻转到卡下方**（编辑面板相应翻到上方），保证两者不重叠也不被 TopBar 裁切。

#### 5.2.3 [P1] 任务态工具按钮

**复用**：`NodeEditor` busy 三态按钮渲染范式（直接复制到工具条）；`taskStore.useTask`；`generate.stopCard/aborters`；`mediaOps.ts`；`CardView` 的 Loader2 转圈 + 进度条样式。

**改动点**：`mediaOps.runImageTool/runVideoTool` 接受 `cardId`，运行时图标换 Loader2 转圈 + 底色变红 + 禁用；本地 ffmpeg/sharp 不可中断时做「禁用 + 转圈」，AI 类 `editWithPrompt` 可接 `stopCard`。FloatingToolbar 自身 `useState` 记录哪个 action 在跑。

#### 5.2.4 [P1] 节点基座统一化

**复用**：`CardView.tsx`（原地增强）；`GroupView` 双击重命名 contenteditable；`CardView.fitAspect` 已拿到媒体真实宽高；`board.viewport.zoom` 做反补偿；`KIND_META.accent`；`CardView` 状态层做计时器位。

**改动点**：① 标题区可双击进 contenteditable 重命名；② `node-meta` 行用 `tabular-nums` 显示视频时长 + 分辨率 / 图片 naturalWidth×naturalHeight（顺手在 fitAspect 存进 meta）；③ `status==='running'` 时 `node-timer` 显示已耗时（存 `card.meta.startedAt`，写入走 `updateCard(..., {history:false})`）；④ 标题/角标 `transform:scale(1/zoom)` clamp 反补偿（只在 selected 或 zoom 跨阈值时补偿避免每帧重渲）；⑤ `card.meta.beta` 时显示小红 BETA pill。

#### 5.2.5 [P1] 上下文菜单升级

**复用**：`ContextMenu.tsx`（items 数组结构保留）；`ConnectMenu.OPTIONS`（icon+accent+label 作子菜单数据源）；`LeftDock` icon+accent 模式；`NodeEditor` 放大编辑弹窗骨架（改模板命名输入）；createPortal。

**改动点**：① `Item` 加 `icon` 字段，前置 lucide 图标方块；②「连到新节点」三项收成带 ▸ 的子菜单（hover 展开）；③ 分隔线 + 小标题分组（生成/排列/编辑）；④ 弹出 `scale(.96→1)` 回弹；⑤ `prompt('模板名称')` 换内联输入小弹层；⑥ 菜单超长加 `max-height` + 滚动（相应调 estH 定位）。

#### 5.2.6 其余 P2/P3

- **自由绘制标注层 / 图形批注（P2）**：CanvasPro 有、原草稿缺。新 `src/ui/canvas/AnnotationLayer.tsx`：复用 `MaskInpaintModal` 画板的指针采点范式，支持自由笔刷/箭头/矩形/文字四种图元，存 `card.meta.annotations`（世界坐标数组，随卡变换），渲染层叠在媒体卡上、`data-interactive` 防穿透；可与 5.3.1 局部重绘共用画板组件。先做箭头+矩形+文字（最实用），自由笔刷次之。
- **卡片类型目录扩展**：把 `LeftDock.ITEMS/ConnectMenu.OPTIONS/ContextMenu NEW_LABEL/CardView KIND_META` 硬编码收敛成单一 `CARD_CATALOG` 常量；分镜脚本卡用常驻 `StoryboardCard`（列表略览 + 双击进 `StoryboardModal` 全屏编辑器）。
- **素材条排序 + 预览**：缩略图加拖排序（upload 类改 `card.assets` 顺序、edge/card 类用 `card.meta.matOrder` 覆盖）；hover 0.4s 弹大图预览（复用 Lightbox）；主图加「主」角标。`references.buildMaterials` 加 `matOrder` 支持，并验证 `resolveGenInputs` 按序取首图为主图。
- **多结果设主图 + 网格 + 拖出**：角标点击弹缩略图行点选 `setMainResult(i)`（同 cycleResult 但指定 index，重置 fittedFor）；展开网格用 Lightbox 多图；每变体 `draggable` 拖出 source 卡（复用 CardView 拖出 dataTransfer，换 url）。
- **选中关联高亮**：选中单卡时用 `references.collectRefCards`（上游）+ 遍历 edges（下游）算相邻集合（`useMemo`），下发 CardView 加淡色 accent 描边，相连边复用 `EdgeLayer` 的 `ace-edge-hover`。
- **比例可视化图标**：`ParamControls` 比例选项渲染成按宽高比缩放的小矩形 div（选中描边），扩到 8~10 种，写回 `card.params.aspect`。

---

### 5.3 图像生成与图像工具

#### 5.3.1 [P0] 局部重绘正确范式

**复用**：`MaskInpaintModal`（现成画板 paint/buildMask/erase/clear）；`inpaint.ts`（改 mask 合成方式，复用 `attachments.upload + images.edit + saveBase64` 链）；`graphStore.addCard`（参考 `mediaOps.runImageTool` 在源右侧建卡 + refIds）；`uiStore.maskCardId`。

**改动点**：① **repaint**：把涂抹区在原图上 `destination-out` 挖透明洞，喂 `images.edit`；② **erase**：涂抹区填 `#00FF00` 绿，prompt='移除绿色区域并无缝补全'；③ 结果落**新卡**（源右侧 + refIds 连源）而非覆盖原卡，保留撤销；④ 模式切换 tab（repaint/erase/标注）+ 环形画笔光标 + 撤销/重做 + 涂抹区半透明高亮。两种输入图合成都在浏览器 canvas 做，不依赖 inpaint API。仍标实验性（宿主 `images.edit` 无原生 mask 通道）。

#### 5.3.2 [P1] 声明式参数 UI（统一 Field 渲染器）

**复用**：`ParamControls`（原地改 image 分支 + 抽 `DurationSlider` 为通用 `RangeField`）；`Select`（segmented/select）；`models.ts`（新增 `imageModelSpecs` 同处）；`card.params`（自由透传，`aiImage` 直接读）。

**统一约定（与 5.5.3 视频 schema 对齐，避免两套来源漂移）**：image 与 video **共用同一个 `Field` 类型与同一个渲染组件**。
- 单一类型定义放 `src/ui/services/paramSchema.ts`：`type Field = { key; type:'segmented'|'select'|'slider'|'toggle'|'text'; label; default?; min?; max?; step?; options?; visibleWhen?; disableWhen? }`。
- 单一渲染器 `<SchemaParamRenderer fields={Field[]} value={card.params} onChange/>`，image 与 video 面板都用它，仅数据来源不同（image 取 `imageModelSpecs`，video 取 `ProviderTemplate.paramsSchema`）。
- 条件求值只做 `equals/in/exists` 三种（**勿重造全套表达式引擎**）。

**新增**：
- `src/ui/services/paramSchema.ts`：`Field` 类型 + `SchemaParamRenderer` + 条件求值器（唯一真相，image/video 共享）。
- `src/ui/services/imageModelSpecs.ts`：每个对接的图像模型一份 JSON manifest `{fields:Field[]}`。
- ParamControls image 分支：有 manifest 用 `SchemaParamRenderer` 渲染，否则回退现有四个硬编码控件。新字段 `negativePrompt/guidance/styleStrength/count` 写进 `card.params`。

初期只覆盖 2-3 个常用模型。

#### 5.3.3 [P1] 比例 & 尺寸策略

**复用**：`aiImage.computeSize/aspectHint`（重构，保留 aspectHint 写进 prompt 的做法）；`references.resolveGenInputs`（取输入图自适应）；`media.loadImageInput` + `mulby.sharp(bytes).metadata()`（读真实宽高，`mediaImage` 已有用法）。

**新增**：`src/ui/services/imageRatioPolicy.ts`：① 比例表扩到 8-10 个；② `calcSizeByQualityAndRatio(aspect,quality)`（质量档=像素预算 1K≈1.05M/2K≈2.1M/4K≈4.2M，sqrt 反算对齐 8、夹 [512,2048]）；③ `syncAdaptiveRatio(card,board)`（`aspect==='auto'` 时读首张输入图真实宽高回填，**只在 auto 时读避免每次解码**）。`computeSize` 改调该策略；ParamControls 比例下拉加「自适应」。

#### 5.3.4 [P1] 扩图可视化 + 参数化

**复用**：`mediaImage.outpaintImage`（改填充色 + 接收四向像素，保留 `sharp.extend + attachments.upload + images.edit`）；`CropModal`（拖框交互改 ExpandModal，naturalWidth 换算照搬）；`mediaOps.runImageTool('outpaint')`；`MediaToolbox` 扩图按钮。

**改动点**：① 填充色透明→绿 `#00FF00` + prompt 改「移除绿色区域并无缝填充」；② `outpaintImage` 接收 `{top,bottom,left,right}` 像素；③ ExpandModal 在原图外画可调扩展边界 + 8 手柄实时预览绿色外扩区。初期可先做四向数字输入 + 绿底替换，拖框第二步。

#### 5.3.5 [P1] 图像浮动工具条两段式

见 5.2.2（FloatingToolbar）。`runImageTool` 动作入口不变，新增 `ImageTool` 枚举挂局部重绘/标注/下载/全屏；运行中按钮变取消（读 `card.status`）。

#### 5.3.6 其余 P2/P3

- **多图参考排序 + 预览**：见 5.2.6（`references.buildMaterials` 顺序即首图=主图）。
- **宫格自定义 + 网格选择器**：`mediaImage.gridSlice` 算法保留（仅修最后一列/行用剩余尺寸而非 floor）；MediaToolbox 合并两按钮为「宫格」+ 5×5 悬浮网格（hover 高亮 cols×rows + 「点击创建 N×M」）。
- **多变体展开 + 拖出**：见 5.2.6。
- **全屏滚轮缩放平移**：`Lightbox` 加 onWheel 以光标为锚点缩放（复用 `viewport.zoomAt`）+ 拖拽平移 offset + grab/grabbing + 双击复位。
- **视角控件**：新 `cameraPrompt.ts`（8 方位×4 仰角×3 景别→英文术语查表）；ParamControls image 分支加方位/仰角/景别三下拉，前置拼进 prompt（同 aspectHint/styleHint 注入位）。
- **抠像本地色键**：`mediaImage.removeBackground` 当前是**无参 arrow const（L108）**，须**改写为带参签名** `removeBackground(card, opts?:{ bg?:'transparent'|'white'|'black'|'gray' })` 并相应**重写 prompt / 切换 sharp 像素阈值替换分支**（非给原 const 加参数槽）；`chromakey` 用 sharp 像素阈值替换透明（对纯色背景）；手绘抠图复用 MaskInpaintModal。UI 说明各方式适用场景。
- **拼贴节点**：新 `mediaCollage.ts`（`mulby.sharp composite`，照搬 cropImage/gridSlice 用法）；`resolveGenInputs` 收集多图；`runCollage`（仿 runGridSlice）；先做 4-5 种固定布局。
- **高清放大**：`mediaImage.upscaleImage` 同为**无参 arrow const（L105）**，须**改写为带参签名** `upscaleImage(card, opts?:{ scale?:number })` 并重写 prompt（重绘式）/ 增 sharp lanczos resize 分支（插值式纯本地兜底）。明确标注「重绘式/插值式」。
- **调试 API 参数**：`aiImage` 导出 `buildImageRequestDebug(card,board)`；NodeEditor 加折叠展示区。
- **裁剪 EXIF**：`cropImage` extract 前加 `sharp().rotate()`（metadata 在 rotate 后取）；CropModal 加比例吸附下拉。

---

### 5.4 文本·分镜·提示词工效

#### 5.4.1 [P0] 导演级分镜 system prompt

**复用**：`storyboard.generateShots` 的 system content（现成单一函数）；`types.Shot`（扩字段）；保留现有 JSON 容错解析（braced 正则 + 中英双键）。

**改动点**：把三大规则常量整段抄到 `storyboard.ts` 顶部，按 sourceMode 拼进 system：
- **导演拆分规则**：相邻镜头因果/空间/道具连续；镜头数区间建议（短广告 8-20 / 剧情 20-60 / 上限 100）。
- **静帧图片规则**：禁时间词，是该镜头完整生成总览。
- **视频提示词规则**：必须含景别 + 一个运镜；与图片提示词不能互相复制。
- **对白格式**：`声线质感+语速+情绪底色:"台词"`。

零成本最大杠杆。

#### 5.4.2 [P0] Shot schema 扩展

**复用**：`types.Shot`（扩字段处处兼容）；`generateShots` 的 map 容错块原地加别名表；`StoryboardModal/materializeShots` 自动受益。

**改动点**：`Shot` 补 `scene/character/characterDesc/action/emotion/sfx/roleImageRefs/parentDuration`（参考 15 列）；map 里加 `COLUMN_ALIASES`（`shotNumber/cameraMovement/visualDescription`… 英文键→字段）；为整表算 `detectedIntent(shotCount/totalDurationSeconds/aspectRatio/language)` 写进 `card.meta`。老工程缺字段渲染时每字段 `?? ''` 兜底。

#### 5.4.3 [P1] 时长解析与聚合

**新增**（放 `videoSpecs.ts` 或 `storyboard.ts`）：`parseDurationSeconds`（Number→时:分:秒→正则取数→区间 `[-~～至到]` 取中值）、`getRowsTotalDurationSeconds`（reduce 求和）。`generateShots` 解析 duration 时调用，`detectedIntent` 写总时长；`StoryboardModal` 底部实时显示「总时长 Xs」。

#### 5.4.4 [P1] sourceMode 自动判定

**复用**：`references.resolveGenInputs`（汇总 texts/images）；`aiText` 的 `attachments.upload + loadImageInput` 形态；`StoryboardModal` 改传 `card.id` 让服务自取 board。

**改动点**：`generateShots` 接收 `{text,images,videos}`（或 card+board）；按数量算 sourceMode（图&视→multimodal/视→video/图→image/否则 text）选 prompt；image 模式把参考图作 vision 附件；multimodal 把 @图片N/@视频N 摘要拼进 user。无抽帧时 video 模式降级为只读时长/字幕提示。

#### 5.4.5 [P1] 分镜表 UX

**复用**：`StoryboardModal`（现有模态骨架/upd/del/move/persist）；`Select`（视图/媒体模式切换）；`ComposeModal` 模态结构参照；`exportFile`。

**改动点**：① 加 `viewMode(list/card)` 与 `mediaMode(image/video)` 顶部切换；② 按 mediaMode 计算可见列 + 隐藏全空列；③ 角色图/参考列渲缩略图；④「导出 CSV」（UTF-8 BOM + CRLF + 转义防 Excel 乱码）；⑤ 补 camera 列；⑥ 每行勾选框 + 全选；⑦ 底部「已选 X/共 Y · 总时长 Xs」；⑧ 生成中显进度条 loading 覆盖层。拖拽排序可后置。

#### 5.4.6 [P1] 勾选多行派生 + 自动跑

**复用**：`storyboard.materializeShots`（加 `indices` 参数只落选中行）；`generate.generateSelected/generateCard`（现成并发队列）；`graphStore.groupSelection/setSelection`。

**改动点**：`materializeShots(indices)` 落选中行；可选「落地并开始生成」直接对新卡 id 调 `generateSelected`（复用 `project.concurrency` 限流）；落地后自动 `groupSelection`。默认仅派生，自动跑作为主按钮选项。

#### 5.4.7 [P1] slash 级联 + 预设体系

**复用**：`NodeEditor` mention 状态机/insertPreset/菜单浮层（扩级联 + 键盘）；`generate.generateCard`（direct 触发）；`presets.ts`；`templates.ts` 的 `storage(KEY,PLUGIN_ID)` 范式（自定义预设持久化）；`promptTools.enhancePrompt/describeImage`（direct 加工执行器）。

**改动点**：① slash 菜单两级级联（主项→子项 hover/方向键展开）+ 上下/左右/Enter/Esc 键盘导航；② 每项带 mode 徽章（`direct`=选中即 generateCard / `insertPrompt`=仅插入）；③ 重构 `presets.ts`：预设带 `group`（画面风格/分镜/宫格/人设/反推）、`mode`、`template` 支持 `{用户输入||默认}` 占位符与 conditional（有图/纯文切换）；内置分镜/宫格(4/9/16)/人设三视图/反推/精缩模板；自定义预设走 storage。键盘导航与 onBlur(150ms) 关菜单需协调。

#### 5.4.8 其余 P2/P3

- **扩写/风格化/反推结构化**：`promptTools.describeImage` system 换固定反推格式（画面拆解→中文→English→反向词）；新增 `longToShort/extractInfo`；`enhancePrompt` 加风格倾向参数联动 `stylePacks`。
- **@占位符精确映射**：新增 `buildPromptMediaParts`（按 @图片N index 排序切分文本、对应位置插入 image part、未引用追加末尾）；`aiText.generateText` 用它替代「全堆末尾」。需 `resolveGenInputs.images` 顺序稳定。
- **镜头语言助手**：见 5.3.6 `cameraPrompt.ts`，video 卡复用 `generate` motionHint 拼接位。
- **@候选分组 + 配额置灰**：`NodeEditor` refList 按 kind 分组小标题；`getTargetInputPolicy`（与 5.7 共用）对超限候选置灰 + reason。
- **整组转视频**：`shotsToVideos(ids[])` 循环 `shotToVideo` 派生 + 连边 + 编组（默认不自动跑）；ContextMenu 加入口。
- **流式 think 清洗**：`aiText.generateText` 加 `<think>` sanitize + 超长引导。

---

### 5.5 视频音频任务运行时与 Provider

#### 5.5.1 [P0] 通用任务运行时 TaskRuntime

**复用**：`engine.runVideoJob/runViaTemplate/runTts/submitWithRetry/jget/setPath/httpReq/transient`（作为 spec.submit/poll 实现）；`taskStore`（扩为 `Map<cardId,TaskInfo>`）；`generate.aborters/stopCard`（升级为读 ctx）；`graphStore.updateCard`（写 meta.task，**传 `{history:false}`**）；`persistence`（task 随 board 持久化）。

**新增**：`src/ui/services/taskRuntime.ts`——provider 无关的生命周期引擎：
- `runTask(spec)` 统一 submit→poll→normalize→落盘；`buildContext` 持 `AbortController`；
- 把 taskId 写进 `card.meta.task={taskId,status,phase,startedAt,provider,kind,statusField,resultPath}` 并持久化；
- 轮询每圈检查 `ctx.aborted` / 读最新 `card.status` 实现真中断；
- 启动扫描所有 `card.meta.task` 非终态者标 `recovering` 并续查（resume）；
- `engine.runViaTemplate/runVideoJob` 接受 `abortSignal` 与 `onTaskId` 回调。

先做 cancel（while 循环加 abort 检查）+ taskId 持久化，再做 resume。

**集成契约（与 5.1.6 撤销分桶交叉，必须遵守）**：`meta.task` 进度/状态变更**全程走 `updateCard(id, patch, {history:false})`**，pushHistory 只在用户语义编辑时触发。**否则轮询每圈进度写入会灌满撤销栈**。`pushHistory` 的 BoardSnap 可只取 cards/edges 的语义字段（不含 meta.task 运行时态）以双保险。

#### 5.5.2 [P1] single-flight + 任务中心 + 后处理

**single-flight**：移植 `runTaskSingleFlight(key, factory)`（key=`provider:kind:taskId`，模块级 Map），放 `util.ts`，包 `engine` 轮询入口与 resume 入口。

**createLimiter 扩接口（任务面板前置依赖）**：当前 `createLimiter`（`util.ts` L30）**仅返回 `run` 函数，不暴露队列长度**。任务面板的「队列序号/排队数」需要它——先把 `createLimiter` 的返回改为 `Object.assign(run, { pending: () => queue.length, active: () => active })`，调用方不变（仍可当函数调），新增 `.pending()/.active()` 供任务中心读取序号。

**任务中心**：
- **复用**：`taskStore`（扩任务表）；`graphStore` meta.task；`TopBar` 忙碌指示改可点入口；`uiStore` 加 `showTaskCenter`；`ProjectSettings.place()` portal 定位。
- **新增**：`resolveTaskUiState(card)` 纯函数归一 idle/submitting/queued/running/recovering/done/error + `{canCancel,busy,disabled}`；`TaskCenterPanel.tsx` 扫所有 meta.task 渲染进行中/已完成两组（标题/模型/状态药丸/进度条/队列序号读 `limiter.pending()`/取消），未完成数做红角标。

**视频后处理**：
- **复用**：`mediaVideo.ensureFfmpeg/runFf`（抽 poster）；`media`；`main.downloadMedia`（加 dedupe/maxBytes）；`CardView` `<video>` 加 `poster`。
- **改动**：落盘后 ffmpeg 抽首帧 poster 存 `meta.posterLocalPath`，`<video poster>` 消除黑屏；`downloadMedia` 加 dedupeKey（url hash 命名复用）+ maxBytes。

#### 5.5.3 [P1] 声明式参数 schema 引擎（视频）

**复用**：`paramSchema.ts` 的统一 `Field` + `SchemaParamRenderer`（**与 5.3.2 image 完全同一套类型与渲染器**）；`Select`；`videoSpecs.durationValues`（duration 合法集）；`providers/presets.ts`（每模板 make() 旁挂 paramsSchema）；`card.params`。

**改动点**：`ProviderTemplate` 加可选 `paramsSchema:Field[]`（复用统一 `Field` 类型，**不另立第二套形态**）；渲染直接用 `SchemaParamRenderer`。先覆盖 video（最受益），补 resolution/aspect 合法集/首尾帧开关/原生音频开关。**schema 要与 bodyTemplate 的 `{?noImage}` 等条件块保持一致避免双重真相**。

#### 5.5.4 [P1] 首尾帧具名输入槽

**复用**：`references.buildMaterials/resolveGenInputs`（加 video/audio 与角色字段）；`NodeEditor` 素材条；`engine` 已有 `{imageUrl}/{lastImageUrl}` 占位；`card.params` 挂 slots。

**改动点**：① 素材条每张连入图加角色标记（首帧/尾帧/参考）与 refMode 切换，存 `card.params.slots`；② `resolveGenInputs` 增产 video/audio 输入；③ `ProviderTemplate` 声明 `inputSlots`（每模型可接 kind 与上限），超限给可解释提示。先做首尾帧角色 UI（改动最小收益最大），兼容旧数据。

#### 5.5.5 [P1→P0] manifest 权限核对（结论：无需补 filesystem/ai/network）

**经核对宿主权威文档 `develop-mulby-plugin/references/apis/manifest.md` 的权限表**：合法权限键仅有 `runCommand / commandExecution / webview / screen / microphone / camera / clipboard / notification / geolocation / accessibility / contacts / calendar / inputMonitor / envKeys`。

**关键结论（纠正草稿与评审的前置假设）**：
- **不存在 `filesystem` / `ai` / `network` / `http` 权限键**。`mulby.filesystem.*`（main.ts L37/102/183/194 写盘）、`mulby.system.getPath('userData')`（L58）、`mulby.sharp.*`、`ai.images.*`、`mulby.http.request` 等**均无 manifest 权限门**——`filesystem.md`/`http.md`/`network.md`/`ai.md` 权限相关段落确认仅「命令型 AI 能力」需 `commandExecution.ai`，其余无需声明。
- 当前 manifest `permissions: { clipboard, notification }` 对本插件的 filesystem/HTTP/AI 用法**已经足够**，无需修改即可在严格宿主下运行。其它插件（如 `git-report-generator`）写的 `"filesystem": true`/`"ai": true` 属于宿主会忽略的冗余键，不应照抄。
- 因此**删除原草稿 4.5 的「filesystem 权限声明 / missing」差距项与 P1 验收里相关条目**；本节降级为「核对结论」，不产生改动工作量。
- 唯一与权限相关的真实约束：本插件**不承载「AI 生成命令」**（不让 AI 跑 shell/git），故连 `commandExecution.ai` 也不需要。若将来引入命令型 AI 能力才补 `commandExecution.ai.enabled`。

**改动点**：无（manifest 不动）。仅在第 9 节宿主约束清单据实修正措辞。

#### 5.5.6 其余 P2/P3

- **完成提示音**：新 `completion.ts`：`notifyDone(card)` 在终态调 `mulby.notification.show` + 可选 `new Audio(notify.mp3).play()`（或 `mulby.system.beep()` 兜底）；设置项存 storage；TaskRuntime 终态钩子统一调用。
- **按 kind 分池限流**：`createLimiter` 多实例（image/text 共一池、video/audio 各一池），并发数 ProjectSettings 分别配置；扩出的 `.pending()/.active()` 同样按池可读。
- **body 映射升级**：`jget` 支持 `[]` 通配数组展开（`result.data[].url` 取多变体，兼容现有单点路径）；`renderTemplate` 加 `{?x=val}` 等值；少量命名 transform（`{model|upper}`）。**不引入重型双清单 registry**。
- **视频多变体**：video 分支落盘全部存 `meta.results`（同图像结构），`CardView` 多结果角标已通用。
- **Provider 导入导出 + 连通测试 + 多 active**：`ProviderSettings` 加导出/导入 JSON（`exportFile`）+「测试连通」（最小提交看 200/taskId）；`generate` 优先 `card.providerId`（NodeEditor 加 provider 下拉）。
- **音频克隆/转换/分离**：扩 `ProviderType` 加 `'voice-clone'`，`engine` 加分支复用 submit+poll；参考音频经 `uploadImageToHost` 上传；结果加波形（Web Audio decodeAudioData）。

---

### 5.6 媒体后期编辑

#### 5.6.1 [P0] 卡内嵌视频播放器

**复用**：`CardView` isVid `<video>` 分支（原地挂控件，勿新建组件）；`media.saveBase64`（截帧落盘）；`mediaOps.newMediaCard/placeImagesGrid`；`syncPlay.collectGroupVideos`（拿 video 元素）；`Lightbox`（全屏回退）。

**改动点**：isVid 分支加控件层（仅 selected/hover 显示，平时只显首帧 poster）：播放/暂停、静音切换、`media-progress-bar`（轨道 + 填充 + 圆形 knob，pointerdown 按 getBoundingClientRect 算比例 seek）、当前/总时长（tabular-nums）、右下「截当前帧」（canvas.drawImage → saveBase64 建 source 卡）。hover 自动 play、移开 pause；静音偏好记 `card.meta`；**限制只播放选中/hover 的那张防 CPU 爆**。虚拟化用 display:none（park）保住播放进度。

#### 5.6.2 [P0] 视频裁剪可视化时间轴

**复用**：`CropModal` 模态骨架 + 拖框坐标换算（改成一维时间轴）；`ComposeModal` busy 进度条；`mediaVideo.extractFrames + probeDuration`（缩略图条）；`mediaVideo.clip`（加 `-c copy` 快剪分支）；`mediaOps.runVideoTool('clip')`。

**新增**：`VideoTrimModal`：顶部 video 预览，下方时间轴——`extractFrames`（低 fps、缩小图）铺缩略图条 + 可拖左/右 in/out 手柄 + 播放头；拖手柄 `video.currentTime` scrub 预览（debounce）；显示 `mm:ss.t` 时间标签与选区时长。确认调 `runVideoTool('clip',{start,end})`。`clip` 增「快剪」(`-c copy` 关键帧对齐，UI 标注「快剪/精剪」)。

#### 5.6.3 [P1] 视频抠像/绿幕色键

**复用**：`mediaVideo.runFf/ensureFfmpeg`（拼 chromakey filter）；`mediaOps.runVideoTool`（加 `'chromakey'`）；取色/预览 canvas 复用 `MaskInpaintModal` 画板 + `CropModal` 取点换算；面板复用 `ComposeModal` 骨架 + `ParamControls` 滑块。

**前置探测（必做）**：透明 webm 依赖 `libvpx-vp9` 编码器（`-c:v libvpx-vp9 -pix_fmt yuva420p`）。`ensureFfmpeg` 拿到的 ffmpeg **未必含 vp9 编码器**。因此：
- 新增 `probeEncoder('libvpx-vp9')`（`ffmpeg -encoders` / `-h encoder=libvpx-vp9` 解析），结果缓存；
- **若无 vp9 编码器 → 默认退化为「合成到背景色/背景图」输出 mp4**（chromakey + 背景层 overlay），不产透明 webm；
- 仅在探测到 vp9 时才提供「输出透明 webm」选项，并提示「浏览器透明播放有限，落画布展示建议合到背景」。

**改动点**：`runVideoTool('chromakey',{color,similarity,blend,output:'alpha'|'composite',bg?})`：`output==='alpha'` 且 vp9 可用→`chromakey=<hex>:similarity:blend` 输出 yuva420p webm；否则 chromakey + 背景 overlay 输出 mp4。UI：取色器（点 video 帧取背景色，canvas.getImageData）+ similarity/blend 滑块 + 实时 canvas 近似预览 + 背景色/背景图选择；给默认值；UI 说明适用绿幕场景。

#### 5.6.4 [P1] 多轨时间线剪辑节点（分阶段）

**复用**：`mediaVideo.buildComposeArgs`（已有 scale/pad/setsar/concat/xfade/amix，扩 trim 起止 + adelay 偏移）+ `composeFilm/probeDuration`；`graphStore` withActiveBoard+pushHistory+纯函数范式；`references.buildMaterials`；`mediaVideo.extractFrames`（胶片缩略）；`media.mediaPath/saveBytes`。

**新增**：`mediaclip` 卡类型——连入多素材，节点内渲染视觉轨 + 2-3 音频轨。先做纯数据契约（EDL：每 clip `mediaStart/End` 与 `timelineStart/End` + 音量/静音/禁用）；算子做成 graphStore 纯函数（`patchClipRange/moveClipOnTimeline/splitAtPlayhead/removeClip`）。导出：视频段 trim+scale+pad+concat、音频段各自 adelay 按 timelineStart 偏移再 amix。**第一阶段用列表 + 拖排序，第二阶段加标尺/胶片/波形/播放头**。某段无音轨退回静音（借 composeFilm 容错）。

#### 5.6.5 其余 P2/P3

- **场景检测时间码 + 拆条**：`mediaVideo.runFf` 用 select+showinfo 把 `pts_time` 打到 stderr，解析时间码数组；UI 灵敏度滑块 + 场景列表（起止 mm:ss + 缩略 + 单独「裁成片段」）+「一键自动拆条」循环 `runVideoTool('clip')`。stderr 不可得则退化为代表帧时间码近似。
- **抽帧/GIF/倒放/压制参数面板**：点按钮先弹小面板（fps/帧数、GIF 宽度/帧率/时段、压制 CRF/分辨率/体积预估）；参数透传 `runVideoTool` opts（已开放对象）；抽帧超 max 给提示而非静默截断。
- **成片合成可视化**：`ComposeModal` 加横向片段缩略条（缩略图 + 时长 + 拖排替代 y/x 启发式 + 单段入出点）+ 转场时长滑块 + 背景音音量滑块。`buildComposeArgs` 加 trim/音量参数。
- **网页参考卡**：`webref` 卡（`webPageUrl/webSourceTitle/webScreenshotUrl/webCapturedAt/webSelectedText`）；`main.ts` rpc `fetchWebMeta(url)`（fetch HTML 正则提 `<title>/og:title/og:image`）；CardView 渲染域名·时间 + 标题 + 缩略 + 打开来源（`mulby.shell.openExternal`）。
- **网页预览节点**：`main.ts` rpc `extractPageMedia(url)`（正则提 img/video 候选 + 过滤规则：排除 <96px/面积<12000/m3u8/去重/上限 60/12）；前端选择器勾选 → `downloadMedia` 落盘 → `placeImagesGrid` 建卡。无 BrowserView 则非交互抓取。
- **360 全景**：`panorama` 卡 + three.js 内翻球体贴纹理 + 拖拽 yaw/pitch + 滚轮 fov +「截当前视角」→ saveBase64。注意 three.js 打包（参考 MEMORY PrismLight 经验避免巨量 chunk）。3D 导演台明确不在范围。
- **视频补帧/放大**：`runVideoTool('interpolate',{targetFps})` 用 `minterpolate`；scale 2x lanczos 占位。UI 标注「本地补帧（非 AI）」+ 上限保护。
- **媒体缓存/清理**：抽帧/缩略图加内容寻址缓存（`源路径+mtime+参数` hash 命名命中复用）；临时子目录纳入「媒体清理」入口（扫 media 与工程引用差集，**移回收站不硬删**）；复用 `mediaOps` 的 `createLimiter(2)`。

---

### 5.7 工程持久化·恢复·打包工作流

> **三套 storage 键一次性规划（跨 P1/P2，共用 `createStableSignature` 与 `migrate`，必须统一命名避免冲突）**：
> - 分片（5.7.1）：`project:meta` + `project:board::<id>`。
> - 多工程（5.7.6）：`project:list` + `project:doc::<projectId>` + `project:activeId`，且**多工程下分片键改为带 projectId 前缀** `project:<projectId>:board::<id>` / `project:<projectId>:meta`，否则多工程会与单工程分片键冲突。
> - 崩溃恢复（5.7.3）：`recovery:snapshot::<projectId>`。
> 统一前缀方案：所有键以 `project:<projectId>:*` 命名空间组织（单工程时 projectId='current' 向后兼容旧 `project:current`）。`migrate` 一次性把旧键迁入新命名空间。
>
> **单 KV 体积上限（50MB）约束（贯穿 5.7.1/5.7.3/5.7.4）**：宿主 `storage.attachment` 单文件上限 50MB。
> - 分片 board 键：单 board 的 KV 体积（cards/edges/参数，**不含媒体二进制**，媒体走 filesystem 以 `file:///` 引用）正常远小于 50MB；但极端大工程仍须评估——若单 board KV 逼近上限，需对超大 board 再二级分片（按 cards 分块）。
> - 崩溃恢复快照：**不要把整包写进单个 KV**，按 board 分键写 `recovery:snapshot::<projectId>:board::<id>` + meta，与分片对齐，避免整包撞上限。
> - .aicpkg 整包 base64：大视频极易超 50MB，**第一阶段 JSON+base64 仅适合小工程**；超限须分片写多个附件或直接进第二阶段流式 zip（见 5.7.4）。

#### 5.7.1 [P1] 分片 + 签名跳过

**复用**：`persistence.loadProject/saveProject/PLUGIN_ID`（唯一出入口，原地扩展不动调用方）；`graphStore.withActiveBoard`（自增 `_persistRev`）；`storage.list/getMany`；签名函数放 `util.ts`。App.tsx debounce 自动保存链路保留。

**新增**：① `createStableSignature(obj)`（对 `{id,name,viewport,cards 数,每卡 id|x|y|w|h|status,edges 数}` 结构摘要，非深 JSON.stringify）；② 每 Board 加 `_persistRev`；③ `saveProject` 分键：`project:<pid>:meta`（`{id,name,activeBoardId,boardOrder,updatedAt}`）+ `project:<pid>:board::<id>`，逐片比对缓存签名跳过，对不在 boardOrder 的旧键删除；④ `loadProject` 读 meta 再 getMany 各 board 拼回。**兼容旧单键 `project:current`（读不到 meta 回退并迁移一次）；签名摘要勿漏 viewport/title/prompt/params 等高频字段；单 board KV 体积须监控不逼近 50MB**。

#### 5.7.2 [P1] schemaVersion 迁移

**复用**：`persistence.loadProject`（return 前插 migrate，调用方零改动）；`types.SCHEMA_VERSION/ProjectDoc`；把 `App.tsx` 的 parentId 补全逻辑迁入 migrate v1 步。

**新增**：`migrate(raw):ProjectDoc`——按 `raw.schemaVersion` 链式迁移（每步纯函数补字段/改名），最后写回 `SCHEMA_VERSION`。loadProject 先 migrate 再 replaceProject；发生迁移则立即保存固化。**migrate 必须幂等**（已是最新版直接返回）。

**迁移步骤须覆盖（与 5.7.5 Edge 扩字段联动）**：新增一步「给所有 `board.edges` 中缺 `createdAt` 的旧边回填 `createdAt`」（按边在对象中出现顺序或统一 `Date.now()-递减` 赋值，保证 FIFO 有确定序）。旧工程升级后所有边都带 `createdAt`，5.7.5 的 FIFO 驱逐才有依据。

#### 5.7.3 [P1] 崩溃恢复快照

**复用**：`persistence`（storage + PLUGIN_ID）；`util.debounce`；5.7.1 的 `createStableSignature`；`graphStore.replaceProject`；`uiStore` 加 `recovery` flag。

**新增**：`src/ui/services/recovery.ts`：① debounce(1200ms) 写 `recovery:snapshot::<pid>`（**按 board 分键，不整包写单 KV**，避免撞 50MB），记 `{savedAt,reason}` 于 meta；签名相同且距上次<5s 跳过；② 注册 `pagehide/visibilitychange(hidden)/beforeunload` 同步 flush（reason:'page-hide'）；③ 启动读 snapshot，若 `snapshot.savedAt > project.updatedAt`（mtime 守门）弹非阻断恢复条「检测到未保存的恢复数据 [还原] [忽略]」，确认则 replaceProject 并清快照。**mtime 守门务必照做避免旧快照覆盖更新工程**。

#### 5.7.4 [P1] 自包含工程包 .aicpkg

**复用**：`main.ts` rpc（新增方法，复用 `ensureDir/sanitizeName/resolveBaseDir/getJsonPath`）；`media.saveBase64/saveBytes/toFileUrl/mediaDir`；`generate` 的 `host.call` 范式；5.7.6 多工程 API。

**新增**（第一阶段轻量，不引 zip 依赖，仅限小工程）：
- `rpc.exportPackage({projectId, doc})`：遍历收集 `assetLocalPath`，存在性检查（阻断缺失），每文件读 base64 写单 JSON `.aicpkg = {schemaVersion, kind, project, assets:[{virtualPath,base64,sha256}]}` 落 downloads；
- `rpc.importPackage({filePath})`：读包 → 把 assets 写进 `ProjectImports/<name-时间戳>/`（逐文件 base64，重名递增）→ 重写 `assetLocalPath/assetUrl/assets[].localPath/url/meta.results[]` 到新落点 → 返回重写后 doc 供 `createProject+replaceProject`。
- 导出前前端列出 http(s) 远程未落盘产物并阻断/提示先下载；导入做路径穿越防护（拒 `../盘符`）。

**50MB 上限处理（必做）**：单 JSON+base64 包对**含视频的工程极易超 50MB**单文件上限。第一阶段须：① 导出前预估总 base64 体积，**超阈值（如 >40MB）直接禁用 JSON 模式并提示用第二阶段 zip**；② 或退化为「分片导出」（assets 拆多个附件文件 + 一个清单 json）。**第二阶段换真 zip**（需引依赖并验证 pnpm 工作区构建，见 MEMORY build gotchas），从根本解除体积约束。**引用重写覆盖所有键，漏一个就断链**。

#### 5.7.5 [P1] 连接模型校验

**复用**：`graphStore.addEdgeBetween/connectAll/createConnectedNode`（唯一建边入口串闸）；`references.matKindOfCard`（**★L5 当前 private，复用前必须先 `export`，或在 `inputPolicy.ts` 重新实现**，升级为 `resolveEffectiveInputKind`）；`types.Edge`（**加 `createdAt`，当前仅 `id/source/target/kind`**）；策略表放新 `inputPolicy.ts`；拒绝提示用 `mulby.notification`/toast。

**新增**：① `resolveEffectiveInputKind(sourceCard)`（多证据推断 image/video/audio/text）；② `getTargetInputPolicy(targetCard)`（内置表：text 卡只吃 text、image 卡吃 image+text、video 卡吃 image 首/尾帧+text、audio 卡吃 text，返回 `{allowedKinds,maxByKind}`）；③ addEdgeBetween 校验 `kind ∈ allowedKinds` 否则可解释拒绝；④ 同类达 `maxByKind` 时按 `createdAt` FIFO 删最旧同类边再连。**策略表要与 generate 实际消费逻辑一致；FIFO 只在同 kind 内驱逐**。

**`Edge.createdAt` 扩字段须同步四处（缺一则 FIFO/模板/旧工程失效）**：
1. **类型定义**：`types.ts` Edge 接口加 `createdAt: number`。
2. **建边入口回填**：`graphStore.addEdgeBetween/connectAll/createConnectedNode` 创建边时写 `createdAt: Date.now()`。
3. **migrate 回填旧边**：见 5.7.2，给所有缺字段的旧边补 `createdAt`。
4. **模板序列化 + 重建**：`templates.saveGroupAsTemplate`（L55-57 当前 edges map 仅取 `source/target/kind`）须**带上 `createdAt`**；对应 `graphStore.insertTemplate` 重建边处（L344-353，当前 `edges[eid]={id,source,target,kind}`）须**回填 `createdAt`**（用模板存的或新 `Date.now()`）。

#### 5.7.6 其余 P2/P3

- **撤销分桶 + 高频入历史**：见 5.1.6。
- **多工程管理**：`persistence` 扩多键（`project:list` + `project:doc::<id>` + `project:activeId`，**分片键带 projectId 前缀**见本节顶部规划）；`createProject/openProject/saveProjectAs/listProjects/deleteProject/renameProject`（借 `templates.ts` 列表读写范式）；TopBar 工程名旁加下拉。切工程先 flush 当前；删工程联动清 `media/<projectId>`。
- **孤儿素材 GC**：`main.ts` rpc `scanOrphans({projectId,referencedPaths})`（readdir 与前端收集的引用做差集，按 size 降序）+ `trashOrphans`（`filesystem.trashItem` 回收站）；前端遍历所有 board 收集 `assetLocalPath/assets[].localPath/meta.results[].localPath`。**差集必须含所有引用源（含快照与历史引用），二次复核，移回收站不硬删**。
- **生成历史/作品库**：新 `history.ts`：`generate` done 分支追加 `history:list`（`{id,kind,localPath,url,mime,thumb,prompt,modelId,createdAt}`）；`HistoryPanel` 瀑布流 + kind 过滤 + 双击/拖拽用 `addCard` 在视口中心建 source 卡。localPath 作身份键去重。
- **工作流模板库重做**：`templates.saveGroupAsTemplate` 加 `thumb/tags/note/lastUsedAt`；`TemplatePanel` 加搜索/重命名/lastUsedAt 排序/封面 SVG（节点彩色块读主题色）；保存命名改内联弹层；预置 2-3 内置示例（文生图→转视频链，不含产物路径）。
- **在途任务恢复**：见 5.5.1（TaskRuntime resume + taskId 持久化 `tasks:inflight`）。
- **密钥隔离**：保持密钥走 encrypted；导出包/`project:doc` 绝不含 providers/密钥；encrypted key 加白名单 `providerKey:[A-Za-z0-9._-]+`；导入包后提示重填密钥。
- **工程封面缩略**：`Board` 加 `thumb`；自动保存里更长节流（10s）生成几何块 SVG（节点按 kind 着色，不含真实媒体）。

---

## 6. UI/UX 升级专章

> 目标：把「散落 Tailwind 硬编码 + 原生 title/prompt + 瞬切无动效」升级为「令牌化玻璃拟态 + 统一浮层规范 + 有弹性的微交互」。
> **可施工前置依赖速查**：① 任务面板队列序号 → `createLimiter` 须先扩 `.pending()`（见 5.5.2）；② 类型色 → 提为 CSS 变量（6.2）；③ 左下/左侧浮层 tooltip → 从一开始用 portal 版（6.7）；④ 浮动工具条/编辑面板夹取 → 以舞台 rect 为基准、翻转避让、与 auto-pan 共用 rect（6.4/6.5）。

### 6.1 整体布局重构（浮岛外壳）

```
┌──────────────────────────────────────────────────────────────┐
│ TopBar(glass)  工程名▾  | 画布Tab1 ×  Tab2 ×  +  | 风格包▾  设置⚙ 任务⊙³│  ← pointer-events 穿透, 仅子元素 auto
├──────────────────────────────────────────────────────────────┤
│ ┌──┐                                                   ┌─────┐ │
│ │浮│            [卡片] ──bezier── [卡片]                │作品 │ │  ← HistoryPanel(右侧抽屉, 可拖宽)
│ │动│       ┌───────────┐  上方浮动工具条               │ /任 │ │
│ │do│       │ 媒体卡    │  [✂][⊕][抠][⤢][⛶][↓][…]      │务中 │ │
│ │ck│       │ ▶ ━●━ 0:03│  ← 卡内播放器                 │ 心  │ │
│ └──┘       └───────────┘                               └─────┘ │
│                                                                │
│ ┌─────────────────┐                              ┌──────────┐ │
│ │ ↶↷ | 25%▾ +- | ▦⌗ │ ← CanvasControls 浮岛(分组)  │ 小地图▦  │ │
│ └─────────────────┘                              └──────────┘ │
└──────────────────────────────────────────────────────────────┘
```

- **LeftDock** 从贴边实心竖条（`w-14 border-r`）改为**浮动圆角玻璃 dock**（脱离 border-r、`var(--surface-glass)+var(--shadow-menu)+var(--radius-lg)`，垂直居中浮动），图标 hover scale 微动效。
- **CanvasControls**（已是浮岛样板）仅 token 化；用细分隔线把「撤销重做 / 缩放 / 网格小地图吸附」三组视觉分隔；补可点百分比下拉（25/50/100/200%）。
- **TopBar** 换玻璃 token；画布 Tab 双击重命名（`renameBoard`）+ hover 关闭（`removeBoard`，删除抖动动画，至少保留一个画布）。

### 6.2 设计令牌（styles.css :root / .dark）

把现有 4 个变量（`--ace-border/--ace-dot/--ace-edge/--ace-bg`）扩成下列一套；**类型色也提为 CSS 变量**，让纯 CSS 层（卡片描边、小地图块、关联高亮、状态药丸）直接取色，与 `KIND_META.accent` 同源（构建期或运行时把 `KIND_META` 的 accent 写进 `:root` 一次，保证 JS 与 CSS 单一真相）：

```css
:root{
  /* surface */
  --surface-1:#fff; --surface-2:#f6f7f9; --surface-3:#eceef1;
  --surface-glass:rgba(255,255,255,.72); --blur-glass:blur(28px);
  /* text */
  --text-1:#16181d; --text-2:#5b606b; --text-3:#9aa0ac;
  /* accent + 类型色(与 KIND_META.accent 同源, 各 kind 一个变量) */
  --accent:#6366f1; --accent-40:rgba(99,102,241,.4); --accent-08:rgba(99,102,241,.08);
  --kind-image:#…; --kind-video:#…; --kind-text:#…; --kind-audio:#…; --kind-source:#…; --kind-group:#…; --kind-note:#…;
  /* radius / space */
  --radius-sm:8px; --radius-md:12px; --radius-lg:18px;
  --space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px;
  /* shadow */
  --shadow-menu:0 8px 28px rgba(0,0,0,.16); --shadow-dialog:0 24px 64px rgba(0,0,0,.28);
  --shadow-card:0 2px 8px rgba(0,0,0,.08); --shadow-fab:0 4px 16px rgba(0,0,0,.18);
}
.dark{ --surface-1:#16181d; --surface-2:#1d2027; --surface-glass:rgba(28,30,36,.72); --text-1:#f2f3f5; /* 类型色 .dark 下可调亮 … */ }
```

把 `TopBar/CanvasControls/Select/ContextMenu/ProjectSettings/各 Modal` 的 `bg-white dark:bg-neutral-900` 玻璃浮层统一换成 `var(--surface-glass)+backdrop-filter:var(--blur-glass)+var(--shadow-menu)+var(--radius-lg)`。**先建 token（含类型色变量）再逐组件迁移、保留 .dark 兼容**。凡是「按类型着色」处（6.3 关联高亮、小地图、状态药丸）一律读 `var(--kind-*)` 而非硬编码。

### 6.3 卡片视觉

- 选中态除 `ring-2` 外，加**关联高亮**（被选卡上下游连线与端卡描边同 accent 色 + 轻 glow，描边色读 `var(--kind-*)` / `var(--accent)`）。
- resize 手柄从 3.5px（几乎看不见）放大、选中态显著；resize 时显尺寸气泡（320×180），shift 等比时手柄变色。
- 媒体卡底部元信息条 `tabular-nums`（分辨率·时长/尺寸），运行中显计时器。
- 多结果堆叠背板（最多 3 张斜露 clip-path），角标点开缩略图行选主图。

### 6.4 浮动工具条

- 选中媒体卡时浮在卡上方居中、毛玻璃圆角条；主区 6 个常用 +「更多 …」弹层折叠；统一线性图标 `stroke-width:2`；hover tooltip 用 portal 版（见 6.7，避免被 `ace-stage` overflow 裁剪）。
- 运行中按钮原地转圈 + 变红「取消」+ 禁用。
- **夹取与翻转**：定位以**舞台 `getBoundingClientRect()` 为边界基准**（与 auto-pan 5.1.8 共用同一缓存 rect）；卡片贴近视口顶部、上方工具条会撞 TopBar 时**翻转到卡下方**（编辑面板相应翻上方），保证不重叠不被裁。

### 6.5 内联编辑面板

- 编辑面板放卡下方、工具条放卡上方协调避让；浮层定位复用 `worldToScreen` 上下翻转/左右夹取，**夹取基准为舞台 rect（同 6.4）**，贴顶时整体翻转。
- slash 菜单两级级联 + 键盘导航 + direct/insertPrompt 徽章；@ 候选按 kind 分组 + 配额置灰 tooltip。
- 素材条缩略图可拖排序 + hover 大图预览 + 主图角标 + 首尾帧角色标记。

### 6.6 任务/进度面板

- TopBar「N 生成中」改可点入口 + 未完成红角标（`1px` 脱壳描边）。
- 右侧浮层分「进行中/已完成」，每卡：标题/模型/状态药丸（等待蓝/处理蓝/失败红/完成绿，色读 token）/进度条（`width .16s` 过渡）/**队列序号**/取消按钮/失败红字。
- **前置依赖**：队列序号需读限流器排队信息——`createLimiter` 当前**不暴露队列长度**，须先按 5.5.2 扩出 `.pending()`（队列长度）与 `.active()`（在跑数）；任务中心按 `pending()` 计算每个排队任务的序号。

### 6.7 右键菜单 / 模态规范 / 动效 / 空状态 / 快捷键 / 设置分区

- **右键菜单**：每项 lucide 图标方块 + 分组小标题 + 子菜单 ▸ + `scale(.96→1)` 回弹 + `has-desc` hover 副标题上滑揭示 + 玻璃 token + prompt() 换内联弹层 + 超长滚动。
- **模态规范**：抽 `Modal.tsx`（overlay `backdrop-blur` + 居中卡 + 进场 `scale` 动画 + ESC/点遮罩关闭 + stopPropagation）；新增 `promptDialog/confirmDialog` 替换所有原生 `prompt()/confirm()`（`ContextMenu.tsx`、`GroupView.tsx` 调用点）；input 统一 focus indigo ring、危险按钮红。Delete 键删卡加可撤销提示。
- **全局 Tooltip（portal 版优先）**：纯 CSS `[data-tooltip]::after/::before` 会被 `ace-stage` 的 `overflow` 裁剪——因此**左下 `CanvasControls`、左侧 `LeftDock` 等贴边/画布内浮层从一开始就用 portal 版 tooltip**（一个挂到 body 的轻量 tooltip 组件，按目标 `getBoundingClientRect` 定位，参考 `Select.tsx` 的 portal 范式）；非裁剪区域的普通按钮可用纯 CSS 版。统一把高频图标按钮 `title` 改 `data-tooltip` / portal tooltip。
- **动效库**：`styles.css` 补 `@keyframes`（fadeIn/scaleIn/slideUp/menuPop 回弹 `cubic-bezier(.34,1.56,.64,1)`），菜单/模态/toast/任务卡复用，统一「有弹性」手感。
- **空状态**：空画布从纯文字升级为带图标引导卡（三个可点：建文本卡 / 打开分镜 / 打开模板 + 底部快捷键 hint）；空态按钮需 `pointer-events:auto`，不挡双击建卡。补「拖入图片/视频即可导入 · 从卡片右侧端口拖出连线」。
- **快捷键**：抽 `src/ui/services/shortcuts.ts` 集中注册表（`{id,label,keys,group,run}`），`CanvasStage.onKeyDown` 遍历匹配（保留 isTyping + Space 特例）；设置面板「快捷键」pane 渲染分组只读 kbd 列表。
- **统一设置面板** `SettingsModal.tsx`：左 nav（外观/画布/生成/Provider/快捷键）+ 右 pane（`settings-row` 网格：左标签+描述/右控件）：
  - 外观：主题（亮/暗/跟随）+ 字号 + 网格点开关；
  - 画布：网格/吸附/小地图/对齐分布间距/连续生成方向；
  - 生成：吸收 `ProjectSettings`（默认模型 + 分 kind 并发）；
  - Provider：内嵌 `ProviderSettings`；
  - 快捷键：分组列表。
  偏好存独立 storage key（不进 ProjectDoc），合并顶栏两个齿轮入口。

### 6.8 Toast

新建 `toastStore.ts`（zustand，push/dismiss，按内容长度算 duration 2.5/4.7/8.6s）+ App 根挂 `ToastHost`（portal 到 body，`column-reverse` 堆叠，按 type 着色边框 + 上滑进出动画，胶囊用 `--surface-glass/--radius-lg/--shadow-menu`）。导出统一 `toast(msg,type)` 替换 `GroupView/MaskInpaintModal/StoryboardModal/mediaVideo` 等 5 处重复 `notify()`，内部可选同时触发宿主 notification。`data-interactive` + 不抢底部 CanvasControls。

---

## 7. 里程碑路线图

### P0 — 「不简陋」地基（视觉 + 交互 + 核心范式）
**复用为主**：交互降级 data 体系、预览解耦（含 P0 锁定 keepAlive 契约）、便签卡、卡上浮动工具条、卡内视频播放器、视频裁剪时间轴。**新增**：设计令牌（含类型色变量）、Toast、TaskCenter（store 形状 + 面板）、TaskRuntime（cancel + taskId，`meta.task` 不入历史）、局部重绘正确范式、导演级分镜 prompt + Shot schema。
**验收**：① 数百卡片拖动/缩放不掉帧（降级生效）；② 任意浮层统一玻璃质感；③ 视频卡可播放/截帧、可视化裁剪；④ 视频任务可取消、刷新不丢 taskId、进度变更不污染撤销栈；⑤ 便签可双击编辑改色；⑥ 分镜生成出 15 字段、静帧/视频提示词不互相复制。

### P1 — 创作工具化（连接/参数/分镜/稳健性）
**复用**：连接校验闸（addEdgeBetween）、对齐/分布（moveNodesByOffsets）、多选包围盒吸附、撤销分桶、首尾帧角色 UI、视频 poster、分镜表双视图/勾选派生、slash 级联。**新增**：声明式参数 schema（image+video，统一 Field + 单渲染器）、比例策略、扩图参数化、持久化分片 + migrate（含 Edge.createdAt 回填）+ 崩溃恢复（分键写）、.aicpkg（含 50MB 处理）、`inputPolicy.ts`（matKindOfCard 先 export）、统一 SettingsModal/Modal/Prompt、`createLimiter` 扩 `.pending()`。
**验收**：① 拖线置灰不可连目标、可解释拒绝；② 多选对齐/分布 + 包围盒吸附；③ 参数随模型动态显示（image/video 同一渲染器）；④ 杀进程后重开提示恢复（快照不撞上限）；⑤ 导出/导入 .aicpkg 链接不断、超 50MB 有降级路径；⑥ 切 board 不丢撤销历史；⑦ 同类输入超限按 createdAt FIFO 驱逐（模板/旧工程同样生效）。

### P2 — 深度与扩展
**复用**：小地图增强、框选分流、归属收敛、多结果展开、关联高亮、视频多变体、按 kind 限流。**新增**：节点虚拟化（含帧预算 12/帧·8ms 分批挂载）、多轨时间线剪辑、视频抠像（前置探测 vp9）、场景检测时间码、拼贴、多工程（带 projectId 前缀键）、孤儿 GC、生成历史/作品库、Provider 导入导出/连通测试、模板库重做、网页参考卡、自由绘制标注层/图形批注。
**验收**：① 千级卡片虚拟化流畅（首次挂载无长任务卡顿）；② 时间线可拖排导出；③ 绿幕抠像可调可预览（无 vp9 时自动合成到背景色）；④ 作品库双击回画布；⑤ 多工程切换 + 清理孤儿、键无冲突。

### P3 — 锦上添花
视角控件、镜头语言助手、调试参数、全屏滚轮缩放、网页预览、360 全景、视频补帧、网格数值标尺刻度、媒体缓存、完成音、i18n、工程封面、在途任务 resume、@占位符精确映射、流式 think 清洗。
**验收**：逐项独立可用，不阻塞主链路。

---

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 预览解耦后参考线/小地图/连线层短暂不一致 | 拖动中节流同步，松手 commit 后重算；**P0 锁定 keepAlive 集合含连线端卡**（5.1.1 契约） |
| 虚拟化首次挂载千级卡产生长任务卡顿 | 阶段 1 先条件渲染 + <120 卡跳过；阶段 2 **帧预算 12/帧·8ms 分批挂载**（5.1.2），DOM 仍在内存保住播放/状态 |
| `meta.task` 进度写入污染撤销栈 | `updateCard` 运行时字段写入传 `{history:false}`；BoardSnap 只取语义字段（5.1.6/5.5.1） |
| 本地 ffmpeg/sharp 任务无法真中断 | 「取消」做到 UI 还原 + 禁用 + 转圈，明确预期；AI 类才真 abort |
| 宿主 `images.edit` 无原生 mask | 挖透明洞/填绿只是「更可能听话」，UI 标实验性，结果落新卡可对比 |
| ffmpeg 无 libvpx-vp9 → 透明 webm 失败 | **前置 `probeEncoder('libvpx-vp9')`**，无则默认退化合成到背景色输出 mp4（5.6.3） |
| 声明式 schema 求值器膨胀 / image·video 两套漂移 | 只做 equals/in/exists 三种；**image/video 共用同一 `Field` 类型 + 单一 `SchemaParamRenderer`**（5.3.2/5.5.3） |
| 签名摘要漏字段→改动不落盘 | 摘要务必覆盖 viewport/title/prompt/params 等高频字段；保留旧单键回退 |
| storage 单文件/单 KV 50MB 上限 | 崩溃恢复/分片**按 board 分键不整包写**；单 board KV 监控逼近上限则二级分片；.aicpkg 大工程超阈值禁 JSON 走 zip（5.7 顶部规划） |
| 三套 storage 键（分片/多工程/恢复）命名冲突 | **统一 `project:<projectId>:*` 命名空间一次性规划**，migrate 迁旧键（5.7 顶部） |
| `Edge.createdAt` 扩字段漏处 → FIFO/模板/旧工程失效 | **同步四处**：类型 + 建边入口 + migrate 回填 + 模板序列化(L55-57)与 insertTemplate 重建(L344-353)（5.7.5） |
| `matKindOfCard` private 无法直接复用 | **先 `export`（references.ts L5）或在 `inputPolicy.ts` 重实现**（2.2/5.7.5） |
| `removeBackground/upscaleImage` 无参 const | **改写为带参签名 + 重写 prompt/切分支**，非给 const 加参数槽（5.3.6） |
| `createLimiter` 不暴露队列长度 → 任务面板序号无源 | **先扩 `.pending()/.active()`**（5.5.2），调用方不变 |
| 误把 filesystem/ai/network 当权限键补进 manifest | 宿主权限表无此键；**manifest 不动**，当前 clipboard+notification 已够（5.5.5/第 9 节） |
| 孤儿 GC 误删共享素材 | 差集含所有工程/历史/快照引用 + 二次复核 + `trashItem` 回收站不硬删 |
| 引用重写漏键导致导入断链 | 覆盖 `assetUrl/assetLocalPath/assets[]/meta.results[]` 全部键，加测试 |
| tooltip 被 ace-stage overflow 裁剪 | 贴边/画布内浮层（CanvasControls/LeftDock）从一开始用 **portal 版 tooltip**（6.7） |
| 浮层贴顶撞 TopBar | 夹取以舞台 rect 为基准 + 贴顶翻转，与 auto-pan 共用 rect（6.4/6.5） |
| three.js 打包巨量 chunk | 参考 MEMORY PrismLight 经验；360 全景 P3 评估后再引 |
| 大量 Tailwind→token 迁移视觉回归 | 先建 token（含类型色变量）再逐组件迁移，保留 .dark；按组件分批验收 |
| 改归属判定阈值改变手感 | 保证拖出（中心移出）正确离组；保留「父被一起拖保持归属」特例 |
| 视频任务恢复依赖稳定 taskId/端点 | 把 statusField/resultPath 一并持久化；single-flight 防重复轮询 |
| `mulby verify` 在本环境不可用 | 用 `pnpm install`（CI=true + --no-frozen-lockfile）+ 构建验证，见 MEMORY build gotchas |

---

## 9. 设计红线与边界

**ai-creative-canvas 是什么**：自由无限画布 + **逐卡片按需生成** + 富媒体后期编辑 + @引用的创作台。用户手动建卡、连线、选中某卡点生成、对结果做后期、再用 @ 或连线把素材喂给下一张卡。

**不做什么（与 ai-film-studio 区分）**：
- **不做「一键全图流水线」**：不引入「输入故事 → 自动跑完分镜→出图→出视频→合成」的端到端 agent 编排。分镜→图卡→视频是**用户逐步触发**（即使有「落地并开始生成」也是对用户勾选的卡批量跑，不是全自动管线）。
- **不做 ai-film-studio 的工作台范式**：本插件以画布卡片为中心，不做时间线工作台主视图（多轨时间线剪辑只是**画布上的一种节点**，不是全局工作台）。

**宿主约束（务必遵守）**：
- **无内置视频生成** → 走可插拔 Provider（`engine.ts` 声明式模板 + storage 配置 + 密钥 encrypted）。
- **tts 不产文件** → 经 `main.synthSpeech` 后端落盘。
- **图像/媒体** → 走 `ai.images.*` / `mulby.sharp` / ffmpeg（`mediaVideo.runFf`）；alpha webm 须先探测 `libvpx-vp9` 编码器，否则退化合成到背景色。
- **HTTP** → 走 `mulby.http.request` + 后端 `host.call` 桥（规避 CORS）。
- **大媒体落 filesystem**（`media.ts`，`userData/<PLUGIN_ID>/media/<projectId>/`，引用以 `file:///localPath` 存不进 JSON）；`storage` 单文件/单 KV 上限 50MB，工程数据按 board 分片、媒体不进 KV。
- **密钥进 `storage.encrypted`**，绝不随工程/包导出。
- **manifest 权限**：经核对宿主权限表，**filesystem / sharp / ai.images / http 调用均无 manifest 权限门**，**不存在 `filesystem`/`ai`/`network`/`http` 权限键**。当前 `permissions:{clipboard,notification}` 已满足本插件全部用法，**无需新增**。仅当将来承载「AI 生成命令」（让 AI 跑 shell/git/patch）才需 `commandExecution.ai.enabled`——本插件不做此事，故不需要。

**判断准则**：任何新功能若让「用户不再需要逐卡片决策、系统自动产出整片」，即越界，应归 ai-film-studio。

---

## 10. 实施进度日志（implementation log）

> 每完成一个阶段提交一次代码 + 更新本节。所有改动逐步 `tsc --noEmit + vite build` 绿；本环境 `mulby verify` 不可用，运行态需在 Mulby 内人工验证。

### ✅ P0 —「不简陋」地基（2026-06-22 完成，8/8，已提交）
- **P0-1 设计令牌**：`styles.css` 扩出 surface/text/accent/`--kind-*`/radius/space/shadow 一套 token + 玻璃工具类（`.ace-glass/.ace-bar/.ace-menu/.ace-dialog`）+ 动效库（fade/scale/slide/pop，含 reduced-motion 降级）；`KIND_ACCENT/KIND_LABEL` 收敛进 `types.ts`，去重 CardView/ConnectMenu/LeftDock/NodeEditor 四处映射；常驻 chrome（TopBar/CanvasControls/LeftDock）+ Select/ContextMenu/ConnectMenu 菜单 + ComposeModal/TemplatePanel/MaskInpaint 模态玻璃化。
- **P0-3 统一 Toast**：`store/toastStore.ts` + `components/ToastHost.tsx`；`toast()` 取代全部 `notification.show`/`notify`（mediaVideo/storyboard/GroupView/各模态/ContextMenu/NodeEditor/TemplatePanel）。
- **P0-5 便签卡 + 浮动工具条**：`note` kind（CardView 便利贴分支，双击就地编辑 + 7 色换色）；`canvas/FloatingToolbar.tsx` 卡上居中浮条承载增强版 `MediaToolbox`（图片加 重生成/局部编辑/下载，视频加 下载）。
- **P0-6 卡内播放器 + 裁剪时间轴**：`VideoCardPlayer`（播放/进度拖拽/静音/截帧）；`mediaVideo.frameAt`/`timelineThumbs`、`mediaOps.captureFrame`（ffmpeg 抽帧规避 canvas taint）；`components/VideoTrimModal.tsx` 缩略图时间轴 + in/out 手柄 + scrub。
- **P0-8 局部重绘正确范式 + 分镜升级**：`inpaint` 改为挖透明洞(repaint)/填绿(remove) → 落新卡（非破坏，bytes→ImageBitmap 规避 taint）；`generateShots` 导演级 system prompt（拆分/静帧/视频情绪规则）+ 15 字段 `Shot` + 列别名归一 `pick()` + `parseDurationSeconds`/`computeStoryboardIntent`。
- **P0-4 任务中心**：`components/TaskCenter.tsx`（按卡片状态派生「进行中/失败」，进度/取消/重试/点击定位）；`createLimiter` 暴露 `.pending()/.active()`；TopBar 计数改可点开入口。
- **P0-7 任务运行时（核心）**：`AbortSignal` 贯穿 `providers/engine.ts` 轮询循环 → 视频任务真正可取消；`taskId` 持久化到 `card.meta.task`；加载工程时重置遗留在途任务避免卡死。
- **P0-2 交互降级**：`CanvasStage` 平移/拖动/框选/缩放时直接写 DOM `data-interacting`/`data-zoom-low`（不触发 React 重渲）+ CSS 交互期关阴影/过渡、禁卡片指针事件；world 层 `will-change:transform`。

**P0 延后项**（待真机实测后再做）：① 完整预览解耦（拖动/平移期只写 DOM transform、松手才 commit store）—— 只落了降级 CSS 子集；② `taskId` poll-only 断点续跑（需把 engine 轮询从提交拆出）。

### ⏳ P1 — 创作工具化（进行中）

- **P1a 连接校验 + 拖线置灰 + 多选包围盒吸附**（2026-06-22，已提交）：新增 `services/connectionPolicy.ts`（`canConnect`/`invalidTargetIds`，软引用模型——拦截自连/分组/便签/非可生成目标，带可读原因）；`graphStore.addEdgeBetween`/`connectAll` 落地校验，非法连接弹 toast；拖线时 `CardView` 计算不可连目标集合写 `uiStore.connInvalidIds`，目标卡置灰（松手清空）；`snapping.ts` 抽 `snapBox` + 新增 `computeSnapBox`，`CanvasStage.flush` 多选时按整体包围盒吸附（单选仍走 `computeSnap`）。
- **P1b 声明式参数 schema + 比例策略**（2026-06-22，已提交）：新增 `services/paramSchema.ts`（`ParamField` 联合类型 + `getParamSchema(card)`，把 image/video/audio/text 参数声明为数据）；`ParamControls` 重构为单一渲染器（select/seed/duration 三类字段分发，宽度按字段），消除四处重复 JSX；比例策略：统一 `ASPECTS` 档位扩到 8 档（加 3:2/2:3/21:9），`aiImage.computeSize` 改为可解析任意 `W:H`（已知 5 档保持原尺寸，新比例按短边 720 通用计算）。**延后**：扩图比例参数化（最小项，待浮条加比例子菜单后做）。
- **P1d 视频域专业感**（2026-06-22，已提交）：完成提示音（`generate.notifyDone` WebAudio 短 blip，仅成功终态一次）+ 窗口失焦时系统通知；开关存 `uiStore.notifyDone`（localStorage 持久化），任务中心标题栏加声音开关。视频结果 poster 去黑屏：`VideoCardPlayer` `preload=metadata` + 元数据就绪后轻微 seek 强制首帧渲染 + 容器深底。首尾帧模式：`paramSchema` 视频加 `refMode`（通用/首尾帧）下拉，启用既有 `generate` 首/尾帧逻辑。**延后**：首/尾帧在素材 chip 上的具名视觉标签（需 NodeEditor 素材渲染改造）。
- **P1e 统一 Modal + promptDialog/confirmDialog + 玻璃化**（2026-06-22，已提交）：新增 `components/Modal.tsx`（玻璃对话框外壳：遮罩模糊 + ESC/点遮罩关 + scale 进场 + 可选 title/footer）；`store/dialogStore.ts` + `components/DialogHost.tsx` 提供 `promptDialog()/confirmDialog()`，挂在 App 根；替换 `ContextMenu`/`GroupView` 的原生 `prompt()`（无 `confirm()` 调用）；`StoryboardModal` 外壳 → `ace-dialog`、`ProjectSettings` 弹层 → `ace-menu`。**延后**：ProjectSettings+ProviderSettings 合并为统一 SettingsModal 分区（较大，待后续；现有功能不受影响）。
- **P1f(1/2) 分镜表 UX**（2026-06-22，已提交）：`StoryboardModal` 加每行勾选框 + 全选；底部「共 N 镜 · 总时长 Xs · 选中 K」（`getRowsTotalDurationSeconds`）；「落地选中（K）」只派生勾选行（`materializeShots` 传子集）+ 保留「落地全部」；「CSV 导出」（UTF-8 BOM + CRLF + 引号转义，含镜号/景别/场景/角色/情绪/画面/图片/视频提示词/对白/音效/时长 全字段）；镜号用 `shot.shotNumber`。- **P1f(2/2) slash 分组预设 + mode 徽章**（2026-06-22，已提交）：`presets.ts` 重构为 `PRESET_GROUPS`（镜头/光线/画风/质感）+ `Preset.mode`（insert/direct）+ 兼容 `PROMPT_PRESETS` 扁平导出；NodeEditor slash 菜单无查询时按组渲染（组小标题），有查询时扁平过滤；`direct` 预设显「生成」徽章、插入后即 `generateCard`。**延后**：真·hover 级联子菜单 + 键盘导航；分镜表列表/卡片双视图 + 按媒体模式可见列。
- **P1c(安全子集) 崩溃恢复 + 迁移脚手架**（2026-06-22，已提交）：`persistence` 加独立 `project:recovery` 键——改动经 400ms 防抖写恢复快照、800ms 主存成功后清除；`pagehide/beforeunload` 尽力抢救；启动时若存在恢复快照（=上次异常关闭有未提交改动）用 `confirmDialog` 询问恢复；`migrateProject` schemaVersion 迁移脚手架（loadProject/恢复均过）。**延后**：完整按 board 分片 + 签名跳过（改存储布局、风险高，待真机验证基线后再做）。

> **✅ P1 阶段完成**（a 连接校验 / b 声明式参数+比例 / c 崩溃恢复安全子集 / d 视频域 / e 统一 Modal / f 分镜表+slash）。全程 tsc + vite build 绿、**未在 Mulby 实测**；各条「延后」项汇总：完整预览解耦、taskId 续跑、扩图比例参数化、首尾帧 chip 标签、SettingsModal 合并、slash 真级联+键盘导航、分镜双视图、持久化分片。

### ⏳ P2 — 深度与扩展（进行中）
建议先做低风险高可见项：生成历史/作品库面板、网页参考卡、自由绘制标注层、Provider 导入导出/连通测试、拼贴宫格合成、场景检测时间码；高风险项（千级节点虚拟化、持久化分片、多轨时间线剪辑、视频抠像绿幕、360/3D）置后，最好在真机验证基线后再做。

- **P2a 作品库面板**（2026-06-22，已提交）：新增 `components/Gallery.tsx`（复用 `Modal`），扫描全工程卡片产物成 4 列网格；单击回画布（切板 + 选中 + 居中视口）、双击预览；TopBar 加「作品库」入口（Images），`uiStore.showGallery`。
- **P2c Provider 导入导出 + 连通测试**（2026-06-22，已提交）：`providerStore.exportJson/importJson`（不含密钥——密钥单独存 encrypted，导入后需重填）；`engine.testProvider`（对 submitUrl/baseURL 的 origin 发 GET 探测可达性，不真正提交任务）；ProviderSettings 左栏加「导出/导入」、动作行加「测试连通」、模态外壳玻璃化（ace-dialog）、`notification.show`→`toast`。
- **P2d 拼贴/宫格合成**（2026-06-22，已提交）：`mediaOps.runCollage`——多张图片卡按 `ceil(sqrt(n))` 自动网格、canvas cover-fit 合成一张（bytes→ImageBitmap 规避 file:// taint），落新图片卡（连引用源）；ContextMenu 选中 ≥2 图片卡时出「拼贴合成（N）」。**延后**：场景检测时间码（需解析 ffmpeg showinfo/pts_time 日志，宿主 ffmpeg.run 日志暴露不确定，待真机确认 API 后做；现有 sceneFrames 代表帧仍可用）。
- **P2b 自由绘制标注层**（2026-06-22，已提交）：`types.Annotation`（pen/arrow/rect/text，世界坐标）+ `Board.annotations`；`graphStore.addAnnotation/removeAnnotation/clearAnnotations`（不入撤销栈）；`uiStore.annotTool/annotColor`；`canvas/AnnotationLayer.tsx`（世界层渲染已提交标注，non-scaling-stroke）+ `AnnotationDrawOverlay.tsx`（仅选中工具时挂载捕获指针、草稿屏幕预览、提交存世界坐标——**不改 CanvasStage 指针状态机**）+ `AnnotationToolbar.tsx`（底部居中浮岛：4 工具 + 7 色 + 清空）；随工程持久化。

### 🐞 用户反馈 Bug 修复（2026-06-22，已提交）
1. **风格包按画布独立**：`stylePackId/style` 从工程级移到 `Board`；`setStylePack`/TopBar/aiImage.styleHint/generate 读写活动画布；`migrateProject` 把旧工程全局值迁到各画布。
2/3. **局部编辑坐标**：模态图片改为 `flex justify-center` + shrink-to-fit 容器（画布与图精确重叠、居中）；`paint` 改分轴 `scaleX/scaleY`——修复笔迹偏上、重绘结果偏左。
4. **标注可退出**：AnnotationToolbar 加「选择/退出」按钮 + `Esc` 退出绘制模式。
5. **浮动工具条居中**：FloatingToolbar 锚卡片中心 + `translateX(-50%)`（不再按固定宽度算偏移）。
6. **节点动作精简上移**：分镜/转视频/局部编辑改为输入框上方紧凑 chip（图标+2-4字），生成按钮保持整行。
7. **随机种子图标**：🎲 emoji → lucide `Dices`。
8. **双击图片节点 → 局部编辑页面**（视频仍预览；单击仍展开内联面板）。
9. **样式一致性优化**：节点内联面板 + slash/@菜单 + 放大编辑模态从旧白底迁到玻璃 token（与全局统一）；补 `--kind-note` CSS 变量；空画布引导升级为玻璃卡（图标 + 新建文本卡/打开模板按钮 + 提示）。
10. **快赢样式批次**：① LeftDock 从贴边竖条改为**左侧悬浮圆角玻璃 dock**（App 布局调整，浮于画布上，data-interactive）；② CanvasControls 百分比改为**缩放档位下拉**（25/50/100/200%，居中保点击外关闭），保留三组分隔线；③ 卡片**缩放手柄**放大为右下角圆点（选中/悬停显著）+ 拖动时显**尺寸气泡**；④ 图片卡悬停显示 **W×H 尺寸徽标**（fitAspect 捕获）。
11. **中等样式批次**：① **关联高亮**——选中卡时其上下游连线 `ace-edge-active`（accent 色加粗）+ 端卡 accent 描边 glow（CanvasStage 算 relatedIds 传 EdgeLayer/CardView）；② **portal tooltip**——委托式 `TooltipHost`（监听 `data-tip` hover、portal 玻璃浮层、不被画布 overflow 裁剪），CanvasControls/LeftDock/AnnotationToolbar 的 `title` 改 `data-tip`；③ **右键菜单升级**——菜单项按关键词配 lucide 图标（`iconFor`）+「连接到新节点 / 对齐分布」分组小标题 + 已有 pop 回弹动效。

- **P2e 视频抠像 / 绿幕去背**（2026-06-22，已提交）：`mediaVideo.chromakey`——ffmpeg `chromakey` 去绿键，优先输出带透明通道的 vp9 webm，失败（无 vp9/alpha 支持）经 try/catch 退化为合成到背景色 mp4（免依赖编码器探测 API）；`mediaOps` 加 `chromakey` 工具；MediaToolbox 视频区加「绿幕抠像」按钮。
- **P2f 多轨时间线剪辑 v1**（2026-06-24，已提交）：`mediaVideo.composeTimeline`——按各段 in/out **预剪**（复用既有 `clip`，无裁剪则原样直通）后交 `composeFilm` 拼接/转场/混音，进度前半预剪、后半合成；新建 `components/TimelineModal.tsx`（`uiStore.showTimeline`）：打开时 `probeDuration` 探测每段时长 → **可视化视频轨**（按裁剪后时长 `flex-grow` 比例分块、点击选段）+ 选中段 **起/终点滑杆裁剪**（互相约束 ≥0.1s）+ **◀▶ 排序**；底部音频轨（选中音频卡）+ 转场/帧率/分辨率（跟随首段比例）/保留原声；导出落「时间线成片」新视频卡并选中。ContextMenu 选中 ≥1 视频卡时出「时间线编辑（N）」（单段也可纯裁剪）。复用 `clip`/`composeFilm`/`probeDuration`，无新增宿主依赖。**v2 延后**：轨道上拖拽裁剪手柄、多音轨混音（adelay/volume per-track）、缩略图条铺底、片段间独立转场时长。

- **P2g 千级节点虚拟化（视口剔除 + memo）**（2026-06-24，已提交）：`viewport.worldViewRect(vp, vw, vh, marginPx)` 算出当前可见世界矩形（外扩 600px 屏幕像素预渲染）；`CanvasStage` 节点数 **> 200** 时启用 `inView` 剔除——仅渲染与可见区相交的卡片/组，**选中卡恒渲染**（保浮条/编辑器/手柄锚点）；阈值以下保持原行为（零风险）。`EdgeLayer` 加 `cull` prop：按两端锚点包围盒（略外扩防水平/垂直线零尺寸漏判）相交测试跳过界外连线。`CardView` 包 `React.memo`——平移时父级每帧重渲，但本卡 props（card 引用/selected/related）不变即可整卡跳过（CardView 仅订阅稳定 action `updateCard` 与连线期才变的 `connInvalidIds`，均不随视口变化）。**安全性**：marquee 框选/全选/连线命中均遍历 store 而非 DOM，剔除不影响选择与交互；Minimap 独立遍历全量不受影响；卡片根无入场动画，平移入场不弹跳。**延后**：O(N) 每帧重算可见集的增量空间索引（千级足够，万级再做网格/四叉树）、按 board 持久化分片。

- **P2h 万级节点承载（空间索引 + memo化 + LOD + 画布缩略图）**（2026-06-24，已提交）：在 P2g 视口剔除基础上把"每帧 O(N)"全面降为"O(可见)"，目标承载万级节点。
  - **均匀网格空间索引** `canvas/spatialIndex.ts`：`buildGridIndex(items, cell=600)` 把卡片/连线按矩形桶入网格，`query(rect)` 只命中相交格 → 可见集查询 O(可见格) 而非 O(N)。`CanvasStage` 用 `useMemo` 按 `board.cards`/`board.edges` 缓存 cardIndex/edgeIndex——因 `setViewport` 保留 cards/edges 引用，**平移期命中缓存不重建**，仅卡片/连线变化才重建。
  - **派生集合 memo 化**：`hiddenMembers`（折叠组隐藏成员）按 `cards` 缓存、`relatedIds`（关联高亮）按 `edges`+`selectedIds` 缓存——平移期都不再每帧重算。
  - **连线索引**：`EdgeLayer` 加 `edgeIds` prop，虚拟化时只遍历索引查到的可见连线子集（叠加既有 `cull` 精确测试），连线渲染 O(可见)。
  - **LOD 占位** `canvas/CardPlaceholder.tsx`：缩放 < 0.4 时非选中卡渲染为轻量 `kind` 着色块（省 img/video/文本/事件富层），保留 `data-card-id` 故仍可框选/拖动/右键/双击；解决"缩放到底全量可见"的极端开销。选中卡始终完整渲染以保编辑能力。
  - **画布缩略图** `Minimap` 从「每卡一个 SVG `<rect>` 且每帧重渲」改为 **`<canvas>` 绘制**：卡片层 `useEffect` 仅在卡片/布局(min/scale)变化时重绘（平移期布局稳定即跳过），视口框改为廉价 DOM 叠层每帧更新；按 `KIND_ACCENT` 着色更直观。
  - **全选保护**：选中卡恒渲染仅在选择 ≤64 时生效，避免 Ctrl+A 把全量拉成完整 CardView（浮条/编辑器本用世界坐标，不依赖被剔除 DOM）。
  - **延后**：drag 移动海量卡时索引每帧 O(N) 重建（移动少量无碍，万级整体拖动属极端操作）；万级以上再上四叉树/增量更新；按 board 持久化分片。

- **P2i 持久化分片 + 增量保存**（2026-06-27，已提交）：配套万级——原本每次防抖把**整个工程当一个大 JSON 全量写盘**（主存 800ms + 恢复 400ms），万级下序列化/写盘卡顿且易触存储上限。改为分片增量：
  - **存储布局**：`project:current` 存 **manifest**（完整 `ProjectDoc` 但各画布 `cards/edges/annotations` 置空 + `_sharded` 标记），每画布 heavy 数据存 `project:board:<id>` 分片；恢复用 `project:recovery` + `project:rec:board:<id>` 同构。
  - **增量**：`writeSharded` 维护「上次落盘画布引用基线」，**只重写引用变化的画布分片**（依赖 store 不可变更新——`setViewport`/未改画布保持同引用，与 memo/索引同一前提）；删除已移除画布的孤儿分片。
  - **崩溃一致性**：先写分片、后写 manifest——manifest 只指向已落盘的分片。
  - **向后兼容**：旧版「全量 blob」（无 `_sharded`）`readSharded` 原样读回，首次保存自动转分片；本会话首存基线为空=写全量（顺带把迁移/净化结果持久化），其后增量。
  - **恢复增量**：`clearRecovery` 仅删 manifest、保留分片与基线，使主存成功后「恢复」不再被提供、而后续编辑仍按引用增量重写恢复分片（不再清空后又全量）。旧格式恢复快照（`{doc,savedAt}`）会被忽略（仅一次性、不影响主存数据）。
  - 对外 API 签名不变（`loadProject`/`saveProject`/`saveRecovery`/`loadRecovery`/`clearRecovery`），App 接线无需改。**延后**：分片读回仍一次性拼装全工程（按需懒加载画布、LRU 卸载非活动画布留待真·多工程/超大工程时做）。

> **P2 低/中风险项 + 千/万级虚拟化 + 持久化分片完成**（a 作品库 / b 标注层 / c Provider IO / d 拼贴 / e 绿幕抠像 / f 多轨时间线 v1 / g 视口剔除 / h 万级承载 / i 持久化分片）。**剩余 P2**：多工程、360/3D（按需再做）。

### 🐞 跨板串卡 Bug 修复（2026-06-25，已提交）
**现象**：画布 1 的视频/图片出现在画布 2，且画布 2 原有视频"消失"。**根因**：异步写入路径以「当前活动画布」为目标——`generate.ts` 全程用 `updateCard(cardId, …)`、`mediaOps` 处理完用 `addCard` 落卡，而 `updateCard`→`withActiveBoard`、`addCard` 默认活动画布。生成途中切到画布 2，画布 1 的任务完成时把结果（以 `{...undefined, ...patch}`）写到画布 2，既造出缺 `kind`/几何的畸形卡顶替显示，也把结果落错画布。
**修复**：
- `graphStore`：卡片 id 全局唯一 → 新增 `withBoardOfCard`/`getCard`/`boardIdOfCard`；`updateCard` 改为**按 id 定位拥有该卡的画布**写入；`addCard` 增加可选 `boardId` 参数（含目标画布的历史快照与"非活动画布不改选中"）。
- `generate.ts`：限流出队后按 id 取**拥有该卡的画布**（任务排队期间可能已切板），所有 await 后的读取改 `getCard(cardId)`（含视频风格取源画布）。
- `mediaOps.ts`：各工具在同步起点捕获 `boardId = boardIdOfCard(cardId)`，结果卡/宫格/拼贴/抽帧/视频派生卡全部落源画布（`newMediaCard`/`placeImagesGrid` 加 `boardId`）。
- `inpaint.ts`/`ComposeModal`/`TimelineModal`：同样传入源画布 id（模态期本不可切板，防御性补齐）。
- `persistence.migrateProject`：加 `sanitizeBoards` 净化——加载时剔除缺 `kind`/非有限几何的畸形卡并清理悬空连线，**自动修复历史残留**，被顶掉的原卡恢复显示（合法卡必有 kind 与有限 x/y/w/h，零误伤）。

### 🐞 视频文件名碰撞 Bug 修复（2026-06-25，已提交）
**现象**（与上者独立）：多个视频卡显示成同一个（最后生成的那个），同画布或跨画布皆可触发。**根因**：`generate.ts` 视频落盘调 `downloadMedia({ name: card.title })`，后端 `sanitizeName` 的 `\w` 不含中文 → 默认标题"AI 视频"全被替换成 `AI_.mp4`，**每个默认标题视频写到同一文件互相覆盖**，于是多张卡的 `assetLocalPath` 指向同一被覆盖文件，全显示最后那个。**修复**：下载文件名带上全局唯一 `cardId`（`${title}-${cardId}`）→ 每张卡独立文件；重新生成同卡仍用同名覆盖自身（不产生孤儿文件）。音频 `synthSpeech` 用 `tts_${Date.now()}` 本就唯一、无碍。**注意**：已被覆盖的旧视频文件在磁盘上不可恢复，需重新生成。

### P2j 多工程管理（2026-06-27，已提交）
参考 Excalidraw/tldraw（本地优先 + JSON 导入导出）、Figma/Miro（缩略图 dashboard）、Obsidian/VS Code（切换器）。取**工程库网格 modal + 内存只驻留活动工程**（契合万级：切换=存当前→载目标）。
- **存储**：在 P2i 分片基础上加**工程注册表** `projects:index = { activeId, items: ProjectMeta[] }`（轻量：名/时间/卡数/封面=首图卡 assetUrl），每工程命名空间分片 `proj:<id>:current` / `proj:<id>:board:<bid>` / 恢复同构；`writeSharded/readSharded` 参数化 projectId 前缀，baseline 按工程区分。
- **迁移**：`migrateLegacyIfNeeded` 无注册表但存在旧 `project:current` 时，把旧单工程作为首个/活动工程按命名空间另存并建注册表（旧键留孤儿、无害），零手动迁移。
- **`projectStore`**：`init/newProject/switchProject/renameProject/duplicateProject/deleteProject/exportProject/importProject/flushSave/syncActiveMeta`；编排 persistence + `graphStore.replaceProject`；**切换前先 flushSave 当前**；删除活动工程先切到另一个（唯一工程则清空为新工程）；工程名以注册表为权威源（载入时覆盖）。
- **UI**：`ProjectLibrary` 网格 modal（封面/名/卡数/更新时间/当前高亮，新建·打开·重命名·复制·导出 JSON·删除）；TopBar 加工程库入口（FolderOpen）。导入用隐藏 `<input type=file>` 读 JSON、导出用 Blob 下载（不含本地媒体文件）。
- **正确性**：① 载入/切换引发的 store 变更经 `isLoadedRef` 守卫跳过自动保存，避免切换后又全量重写；② 自动保存在「调度时」连同 activeId 一起捕获（防跨工程切换时挂起的保存把旧 doc 写到新工程 id）；③ `seedMainBaseline` 载入后播种基线，首存只写 manifest。
- **延后**：分片读回仍一次性拼装整工程（超大工程再做画布懒加载 / LRU 卸载）；工程封面缩略图懒生成/缓存；文件夹分组。

### P2k 360 全景图生成 + 环视查看器（2026-06-27，已提交）
范围：360 先做、零依赖自写（用户选定）；3D 导演台作为更大的后续一期。
- **生成端**：`paramSchema` 图像加「全景·开/关」开关 + `ASPECTS` 增 `2:1`；`aiImage.generateImage` 检测 `params.pano` → 强制等距柱状 `2:1`、单张、注入 `panoHint`（equirectangular、水平无缝、禁鱼眼/小行星）；`BASE_SIZE` 加 `2:1=[1440,720]`；`generate.ts` 给结果卡打 `meta.pano=true`。
- **查看端**：`canvas/PanoViewer.tsx` **零依赖 WebGL**——全屏 quad + fragment shader 按 yaw/pitch/fov 做等距柱状→透视采样；贴图缩放到 POT `2048×1024` 以便经度方向 `REPEAT` 无缝环绕，`UNPACK_FLIP_Y` 对齐；拖动转视角、滚轮调 FOV、复位、Esc 关；按需 rAF 重绘（静态图不空转）。仅显示不回读像素，`file://` 贴图 taint 不影响。**bundle 仅 +~7KB（无 three.js）**。
- **接入**：`uiStore.panoCardId`；MediaToolbox 全景图加「360 环视」(Compass)；CardView 全景卡显「360°」徽标 + 双击进环视；CanvasStage 双击同理；App 挂载 `PanoViewer`。
- **延后/已知**：是否真无缝取决于模型出图（prompt 尽力）；陀螺仪/VR/小地图热点、把全景当视频卡背景；**3D 导演台**（镜头语言结构化→驱动生成）整体留作后续一期。

> **P2 收尾**：低/中风险 + 千/万级虚拟化 + 持久化分片 + 多工程 + 360 全景均完成。**唯一明确延后**：3D 导演台（previs→生成，单独立项）。

### ⚡ P0 性能·运行时（2026-06-29，已提交）
两条 P0 延后项落地（其一为务实子集）：
- **P0-2 视频 taskId 断点续跑**（完整）：`engine.ts` 把提交内联的轮询循环抽成 `pollTaskTemplate`/`pollTaskDefault`（行为保持型重构，经验证逐行等价），新增 `resumeVideoJob`（仅轮询、不重新提交）。`projectStore.sanitizeDoc` 重开时**保留**带 `meta.task(taskId+provider)` 的视频卡为 running（其余在途仍置 idle 避免卡死）；`loadIntoGraph`（init/switch 都走）末尾 `resumeInflightVideos()` 扫描在途视频卡 → 凭持久化 taskId 重新轮询 → 完成下载落盘。可被「停止」取消、provider 缺失报错、inc/dec 配平、done 后清 `meta.task`。
- **P0-1 交互期降级（务实子集：拖动期索引冻结）**：审计要的「全量 DOM transform / 松手 commit」重写回归面过大（连线/参考线/小地图/平移期虚拟化），而平移本就已是 O(可见)。真正的 O(N)/帧热点是**拖动时每帧重建空间索引**（P2h 明确延后那条）。改为：虚拟化大画布拖动期**冻结** `cardIndex`/`edgeIndex`/`hiddenMembers`（返回 ref 缓存），松手 `commitTick++` 按最终位置重建一次；被拖卡在拖动期无条件补入可见集（覆盖 >64 选择）。小画布零改动。**仍延后**：完整 DOM-transform 解耦（需真机 profile 佐证收益再做）。
- **审查后修复**（3-agent 验证工作流）：① 切换/删除工程前 `abortAllInflightVideos()` 中止旧工程在途续跑（否则完成回调落到新工程被丢弃 → 丢结果）；② stopCard 对视频卡置闲时清 `meta.task`；③ providerStore.load 加 `loaded` 短路；④ 拖动期被拖卡补入可见集；⑤ 三个 memo 的 `frozen` 显式入 deps（消除隐式契约）。engine 轮询重构经核实与原内联逐行等价。

### 🎛️ UX 一致性批（2026-06-29，已提交）
聚焦「功能性一致」（可构建验证、低视觉回归风险）；纯样式原子化（tooltip/Button/Empty/Loading）因属大面积视觉改动、需真机逐一比对，**本批暂缓**。
- **z 层级量表 + 修复真 bug**：新增 `zlayers.ts`（语义层级 panel/modal/fullscreen/contextMenu/dialog/dropdown/toast/tooltip，Tailwind 类字符串集中管理）。**真 bug**：Select 下拉原 `z-[70]` 低于模态 `z-[80]`——模态内打开的 Select 被遮挡；提到 `z-[150]`（dropdown，高于模态与对话框）修复。Select/ContextMenu/Toast/Tooltip/Modal/ProjectSettings/Lightbox 改用 `Z.*`；ProviderSettings/CropModal 的 `z-50` 归一到 `z-[80]`（modal）。构建后核验 `z-index:150`/`95` 已生成。
- **全部手写模态补 ESC 关闭**：`hooks.ts` 的 `useEscClose`（ref 化，置于早返回之前，hooks 顺序安全）接入 9 个模态（Compose/Storyboard/Timeline/MaskInpaint/VideoTrim/ProjectLibrary/ProviderSettings/TemplatePanel/CropModal）——与共享 Modal 行为一致。
- **MediaToolbox 工具条溢出**：`flex-wrap` 多排 → 单行 `overflow-x-auto`（`max-w-[92vw]` + 隐藏滚动条），窄卡不再被挤压成多排。
- **暂缓（需真机视觉迭代）**：tooltip 统一（原生 title vs 玻璃 TooltipHost 二选一，60+ 处）、`<Button variant>` / `<Empty>` / `<Loading>` 原子化与各处替换。

### 🧹 中等杂项批（2026-06-29，已提交）
- **对齐辅助线改色**：拖动对齐参考线 红 `#ec4899` → 浅灰 `#cbd5e1`（opacity 0.85）。
- **导入工程边界校验**：`sanitizeBoards` 兜底每画布 viewport/cards/edges/annotations/id/name + 画布 id 去重 + 空 boards 兜底 + 校正 `activeBoardId`（对合法工程零改动、保住增量 baseline 同引用——经审查确认）。
- **切换工程保存竞态**：`serializeIo` 串行化 `saveProject`/`saveRecovery`/`deleteProjectStorage`，消除共享 baseline 并发交错漏写分片。
- **多图轮询重试**：engine `pollTaskTemplate`/`pollTaskDefault` 对 httpReq 异常与 `transient(sr)` `continue` 重试（受 timeout 上限约束、保留 aborted 检查、不回拨进度）；`aiImage` 多图单张失败不拖垮其余、部分成功返回并 toast 告警、全失败抛 lastErr。
- **并发限流统一**：`limiter.ts` 共享 `aiLimiter`（按工程 concurrency）；`generate` + `inpaint` + `mediaPano`(接缝) + `panoOutpaint`(天地/outpaintFace) 共用一个池——避免叠加打满配额(429)。经审查确认无嵌套死锁。
- **连线删除可达性**：点击连线=「选中」（显示×、`Delete`/`Backspace` 键删、触屏可用），不再整条点击即删；onArm 清卡片选择、Delete 时有卡片选中则让位画布删卡、跳过 contentEditable——消除与画布删卡的双删冲突。
- 审查(3-agent)：核心机制(串行/校验/限流/轮询)全部 none；修掉 5 处 minor（双删让位、contentEditable、部分失败告警、轮询不回拨进度、画布 id 去重+命名统一）。

### 🎨 tooltip 统一 + 原子组件（2026-06-29，已提交）
- **tooltip 统一（零调用点改动）**：`TooltipHost` 在原 `[data-tip]` 基础上**自动接管原生 `[title]`**——hover 时摘除 title（抑制系统气泡、存 `data-ace-title`）、显示玻璃 tooltip、离开/滚轮/按下/卸载时还原。全站 60+ 处 `title=` 自动获得统一玻璃样式，无需逐一改为 data-tip。委托式 mouseover/mouseout 行为与原 data-tip 一致。
- **原子组件** `components/ui.tsx`：`<Button variant=primary|secondary|danger|ghost loading>`（统一 indigo-500/600 主色 + `disabled:opacity-50 cursor-not-allowed`）、`<Empty icon text>`、`<Loading text>`。已采用：DialogHost 按钮（canonical，零视觉变化）、Gallery/TemplatePanel 空态。
- **诚实说明**：纯视觉改动、需在 Mulby 内确认观感；其余 button/空态调用点可后续渐进迁移到原子组件（组件已就位，样式集中）。tooltip 摘 title 期间该元素 a11y 暂失 title（离开即还原，影响很小）。
