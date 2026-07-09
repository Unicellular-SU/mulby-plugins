# AI Film Studio 多集工作流与资产中心 V2 方案

## 背景与判断

这份方案基于当前代码，而不是基于早期设想重写。当前插件已经不是“只能做一集”的状态：`ProjectDoc.episodes`、`currentEpisodeId`、`Episode.plan`、`Asset.variants`、`Storyboard.castRefs`、跨集资产矩阵、连续性报告、生成全剧、导出全季等基础能力都已经落地。

真正需要继续优化的是资产边界。现在工作流项目、画布、全局媒体库和身份资产库已经能互相引用，但“全局资产”这个词仍然混合了四种不同对象：

- 媒体文件：`AssetRecord`，图片、视频、音频的全局索引。
- 身份资产：`LibraryEntity` / `ElementRef`，角色、场景、物品、音色的可复用定义。
- 项目生产资产：`ProjectDoc.assets[]`，某个短剧项目里的可复现生产快照。
- 画布候选产物：`PortValue` 输出，默认是实验或候选，只有显式保存后才应进入项目或身份库。

用户认为“工作流、画布共享全局资产不合理”，这个判断是成立的，但问题不是“不能共享”，而是现在缺少足够清晰的共享契约。多集短剧要保证资产一致，必须允许跨集、跨项目复用身份和媒体；但生成链路必须使用项目内快照，不能直接依赖会被任意工作流或画布改动的全局对象。

## 外部参照

Toonflow 公开 README 把产品定位为“策划 -> 编剧 -> 分镜 -> 出片”的短剧生产闭环，并强调无限画布、三层 Agent、持久化记忆、章节事件图谱和角色/分镜/素材/视频节点组织方式：https://github.com/HBAI-Ltd/Toonflow-app

对本插件的启发不是照搬 Toonflow 的数据表，而是两点：

- 画布适合做自由编排、实验、回溯和并行生产，但它不能取代结构化的系列资产圣经。
- 多集稳定性来自事件图谱、Agent 记忆和资产身份的长期召回；真正进入生成前，仍要落到明确的剧集、分镜、项目资产和形态引用。

## 当前代码事实

### 1. 工作流项目已经具备多集结构

主要位置：

- `src/ui/domain/types.ts`
- `src/ui/store/projectStore.ts`
- `src/ui/studio/StudioEditor.tsx`
- `src/ui/studio/services/episodeProduction.ts`
- `src/ui/studio/services/continuityReport.ts`

现状：

- `ProjectDoc` 顶层保存 `seriesBible`、`assets`、`episodes`、`currentEpisodeId`、`memory`、`imageFlows`。
- `Episode` 保存单集 `scripts/storyboards/storyboardTable/clips/track/filmPath/productionRecap/status`。
- 顶层 `scripts/storyboards/clips/track/storyboardTable` 仍作为当前集兼容镜像。
- `Episode.plan.requiredAssetIds` 和 `requiredVariantIds` 已经能表达本集计划使用的角色、场景、道具和形态。
- `Storyboard.castRefs` 已经能精确表达 `assetId + variantId`，比旧的 `associateAssetIds` 更适合多集一致性。
- `AssetVariant` 已经支持妆容、服装、年龄、受伤、状态等 `variantKind`，并支持按剧集、场景、分镜作用域约束。

结论：多集的主干不需要重写。下一阶段应加强“系列资产圣经 -> 本集计划 -> 分镜引用 -> 生成前检查 -> 成片回顾”的闭环。

### 2. 全局媒体库是文件索引，不是身份系统

主要位置：

- `src/ui/services/assetRegistry.ts`
- `src/ui/store/assetStore.ts`
- `src/ui/components/views/AssetsView.tsx`

现状：

- `AssetRecord` 维护 `assets:registry`，记录全局图片、视频、音频。
- `AssetRecord.surface` 区分 `canvas` 和 `studio` 生成来源。
- `backfillFromProjects()` 会扫描画布节点输出。
- `backfillFromStudio()` 会扫描工作流项目的资产图、变体图、关键帧、视频片段、音频等。
- `gcOrphans()` 已经扫描画布、工作流、快照、元素库和上传素材，降低误删仍被引用附件的风险。

结论：媒体库应该保留为全局媒体仓，但它不应被称为“全局资产”的全部。它只能回答“这个文件在哪里、被谁引用”，不能回答“这是不是同一个角色”。

### 3. 身份资产库已有 V1 模型，但持久层仍是 ElementRef

主要位置：

- `src/ui/store/assetStore.ts`
- `src/ui/services/assetHub.ts`
- `src/ui/store/assetHubStore.ts`
- `src/ui/components/views/AssetsView.tsx`

现状：

- `ElementRef` 存在 `elements:library`，包含 `kind/name/aliases/description/prompt/refAssetIds/views/mediaRefs/identity/appearanceVariants/voiceId/lora`。
- `LibraryEntity` 是 `assetHub.ts` 里的规范视图，包含 `kind/name/aliases/identity/mediaRefs/variants/voiceRef/lora/version/archived`。
- `elementToLibraryEntity()` 和 `libraryEntityToElement()` 负责 Element V1 与 LibraryEntity 之间转换。
- `createProjectAssetFromEntity()` 能把身份资产导入为项目生产资产，并保留 `libraryLink.syncPolicy = snapshot`、`entityVersion`、`variantMap`。
- `promoteProjectAssetToEntity()` 能把项目资产发布回身份资产，并生成新版本。

结论：现在已经有“身份资产”的雏形，但持久层和 UI 还在 Element 时代。V2 应把 `LibraryEntity` 提升为用户心智和内部服务的主模型，`ElementRef` 只作为兼容格式。

### 4. 项目资产已经是生产快照

主要位置：

- `src/ui/domain/types.ts`
- `src/ui/store/projectStore.ts`
- `src/ui/studio/services/continuityReport.ts`

现状：

- `Asset.libraryLink` 表达项目资产与身份资产的关系。
- `syncPolicy` 目前实际主要使用 `snapshot` 和 `forked`。
- `linkAssetToLibraryEntity()` 只建立身份链接，不覆盖项目内名称、提示词、图片等生产字段。
- `syncAssetFromLibraryEntity()` 明确同步新版身份快照，并会使使用该资产的剧集失效，避免静默变化。
- `markAssetAsDistinctIdentity()` 能压制“这不是同一身份”的候选误报，并把冲突中的当前链接标记为 `forked`。
- `mergeProjectAssetInto()` 能合并重复项目资产，并迁移分镜和剧集计划引用。

结论：生成链路已经在向“项目快照”靠拢。V2 需要把这个原则写进产品交互：全局身份更新只能提示和显式同步，不能自动改已生产项目。

### 5. 画布已经有 lineage，但缺少采纳层

主要位置：

- `src/ui/store/graphStore.ts`
- `src/ui/services/canvasLineage.ts`
- `src/ui/components/inspectorViews.tsx`
- `src/ui/components/FlowCanvas.tsx`

现状：

- 画布输出 `PortValue.meta.purpose` 可标记 `candidate` 或 `approved`。
- `markCanvasPortValueAsProjectAsset()` 能给画布输出写入 `projectId/projectAssetId/projectVariantId`。
- `markCanvasPortValueAsLibraryEntity()` 能给画布输出写入 `libraryEntityId/libraryVariantId/view`。
- 检查器里已经有“保存到项目资产/项目变体”和“保存到身份资产/身份变体”的显式动作。
- `promoteCanvasOutputs()` 能把画布输出写入身份资产。
- `promoteCanvasImageToProjectAsset()` 能把画布图片写入项目资产或项目变体。

结论：画布并不是完全自动污染全局库，但目前“保存动作”只体现在输出 meta 和目标对象字段里，缺少独立的采纳记录、差异确认和回滚入口。

## 当前设计问题

### 1. “素材库 / 身份资产 / 项目资产 / 画布候选”的边界不够可见

`AssetsView` 目前把媒体文件、身份资产、提示词放在同一个大入口里。工作流侧又通过跨集资产矩阵显示资产中心状态。用户容易把所有内容都理解为“全局资产”，但实际操作语义完全不同：

- 媒体文件可以上传、分组、预览、下载、GC。
- 身份资产可以被多个项目导入，应该有版本、归档、别名、变体、声音、LoRA。
- 项目资产是某个短剧项目的生产快照，要承载剧集计划、分镜引用和变体作用域。
- 画布候选图只是候选结果，保存前不应进入正式生成链路。

### 2. 全局身份仍没有“一次改动影响范围”的产品化控制

代码已经有 `entityVersion` 和 `library_entity_version_outdated`，但用户需要更清楚地看到：

- 哪些项目仍停留在旧快照。
- 同步会覆盖哪些字段。
- 哪些剧集会因此重新进入待生成状态。
- 哪些项目已经 fork，不应再提示同步。

现在这些能力分散在资产卡、资产矩阵和连续性抽屉里，还没有形成身份资产详情页的主流程。

### 3. 画布保存缺少采纳记录

当前“保存到项目资产/身份资产”成功后，结果能通过 usage 图谱读到，但没有单独记录：

- 来源画布项目、节点、端口、候选序号。
- 当时的 prompt、模型、参考图。
- 采纳目标是项目主图、项目变体、身份主图、身份变体还是某个视图角度。
- 谁在什么时候采纳，是否覆盖了旧图。
- 是否需要同步到其他项目快照。

这会影响后续审计、回滚和跨项目复用。

### 4. 全局变体和项目变体的作用域语义需要拆清

同一个人的不同妆容、服装、时期、受伤状态应由变体表达。现在项目 `AssetVariant` 已有 `appliesToEpisodeIds/appliesToSceneIds/appliesToStoryboardIds`，但全局 `LibraryVariant` 不应保存某个项目的剧集作用域。

因此 V2 要明确：

- 全局身份变体表示“可复用外观模板”，例如“晚宴妆”“战损”“少年期”。
- 项目资产变体表示“本项目生产形态”，可以链接到全局变体，也可以本项目专属。
- 剧集、场景、分镜作用域只属于项目资产变体，不属于全局身份变体。

### 5. 多项目共享缺少库级策略

所有身份资产目前共享一个全局命名空间。对于短剧生产，这会带来两类冲突：

- A 项目里“林砚”是男主，B 项目里“林砚”是另一个人，同名候选会干扰。
- 画布里试验的角色图可能被保存到错误身份，其他项目会看到新版提示。

V2 应增加“身份库集合 / 项目资产包 / 系列资产包”的概念，让用户可以把身份资产按作品、客户、风格或团队隔离，而不是只有一个平铺全局库。

## V2 核心原则

### 1. 生成只读项目快照

关键帧、视频和合成必须从 `ProjectDoc.assets`、`AssetVariant`、`Storyboard.castRefs`、`Episode.plan` 读取。全局身份资产只用于导入、候选匹配、同步提示和发布，不直接参与生成请求。

### 2. 全局身份是模板，不是生产真相

`LibraryEntity` 保存跨项目可复用的身份模板，包括稳定身份、别名、主参考、多视图、可复用形态、声音和 LoRA。导入项目时创建项目快照；发布项目修改时创建身份新版本；同步身份更新时需要用户确认。

### 3. 画布默认产出候选，采纳必须显式

画布节点生成的图片默认是 `candidate`。只有用户点击“采纳到项目资产”或“发布到身份资产”后，才写入项目资产或身份库，并把输出 lineage 标为 `approved`。

### 4. 变体必须服务多集一致性

同一个人的不同妆容、服装、时期、受伤状态都进入 `AssetVariant` / `LibraryVariant`，不能复制成多个同名角色。分镜必须尽量写 `castRefs.variantId`，生成前必须校验变体图是否存在。

### 5. 所有跨边界写入都要可追踪

身份导入、项目发布、全局同步、画布采纳、fork、合并重复资产，都应有明确的目标、差异、结果和可回溯记录。

## 目标信息架构

### 资产中心

把现在的“素材库”升级为“资产中心”，顶层分为五个页签：

- 媒体仓：现有 `AssetRecord`、Boards、上传、预览、下载、GC。
- 身份库：`LibraryEntity`，角色、场景、道具、音色，多视图、变体、版本、归档、使用图谱。
- 采纳箱：画布和工作流生成的候选输出，显示候选来源、目标建议、采纳状态。
- 项目图谱：按项目查看项目资产快照、身份链接、版本差异、使用剧集。
- 提示词库：现有 PromptLibrary。

这样用户能理解：媒体是文件，身份是模板，项目资产是快照，画布输出是候选。

### 工作流项目资产页

保留并继续强化当前跨集资产矩阵：

- 资产名、类型、身份状态、计划剧集、出场剧集、使用形态、计划形态、问题状态。
- 支持按剧集、类型、状态筛选。
- 支持定位资产卡、补主图、补形态图、发布身份、同步新版身份、合并重复项目资产。

下一步新增：

- 关联候选身份。
- 标记候选身份为不同身份。
- 对多候选合并目标提供选择，而不是自动选第一个。
- 显示“本项目快照版本 -> 身份库版本”的字段级差异摘要。

### 画布检查器

保留现有“保存到项目资产/身份资产”能力，但交互文案改为更明确：

- “采纳为项目主图”
- “采纳为项目形态图”
- “发布为身份主图”
- “发布为身份形态图”

保存前显示目标、覆盖字段和来源信息；保存后生成采纳记录，并刷新资产中心图谱。

### 系列页

当前 `SeriesTab` 已有系列设定、剧集规划、required assets/variants。V2 继续扩展为“系列资产圣经”：

- 按角色/场景/道具展示整季出现计划。
- 每个角色显示主身份、别名、全局身份链接、项目快照版本。
- 每个形态显示适用剧集、场景或分镜。
- 对未绑定变体、回退主形象、计划未落分镜、计划外出场给出明确待办。

## 建议数据模型演进

### 1. 保留现有字段，先增加规范服务层

短期不要破坏已有持久化。先把 `LibraryEntity` 作为规范领域模型，继续从 `ElementRef` 转换：

```ts
type AssetHubEntity = LibraryEntity
type AssetHubMedia = AssetRecord
type ProjectAssetSnapshot = Asset
type CanvasCandidate = PortValue
```

新增 helper：

- `assetHubEntityVersionStatus(projectAsset, entity)`
- `assetHubProjectAssetDiff(projectAsset, entity)`
- `assetHubAdoptionTargetForCanvasOutput(portValue, doc, entities)`
- `assetHubVariantScopeSummary(asset, variant, episodes)`

先让 UI 和 Agent 都走这些 helper，减少散落判断。

### 2. 新增采纳记录

建议新增 KV：

```ts
interface AssetHubAdoptionRecord {
  id: string
  sourceSurface: 'canvas' | 'studio'
  sourceProjectId?: string
  sourceProjectName?: string
  sourceNodeId?: string
  sourceNodeTitle?: string
  sourcePort?: string
  sourceItemIndex?: number
  mediaAssetId?: string
  localPath?: string
  url?: string
  prompt?: string
  model?: string
  purposeBefore?: 'candidate' | 'experiment' | 'approved'
  target:
    | { kind: 'projectAsset'; projectId: string; assetId: string; variantId?: string; libraryEntityId?: string; libraryVariantId?: string }
    | { kind: 'libraryEntity'; entityId: string; libraryVariantId?: string; view?: string }
  action: 'save' | 'overwrite' | 'link-only'
  state: 'applied' | 'rejected' | 'superseded'
  createdAt: number
  appliedAt?: number
}
```

用途：

- 资产中心“采纳箱”可显示历史。
- 媒体 usage 可解释为什么某张图进入项目或身份库。
- 后续可以做回滚、比较和批量同步。

### 3. 新增身份库集合

建议新增：

```ts
interface AssetHubCollection {
  id: string
  name: string
  kind: 'series' | 'client' | 'style' | 'personal' | 'archive'
  entityIds: string[]
  mediaBoardIds?: string[]
  createdAt: number
  updatedAt: number
}
```

项目可选择默认集合：

```ts
interface ProjectAssetHubSettings {
  collectionIds?: string[]
  importPolicy?: 'snapshot'
  syncPolicy?: 'manual'
}
```

第一阶段可以不写入 `ProjectDoc`，先在资产中心里通过 usage 推断项目关联；后续再持久化项目默认集合。

### 4. 把 LibraryEntity 变成正式持久层

中期迁移：

- 新 KV：`assetHub:entities:v2`。
- 启动时从 `elements:library` 迁移为 `LibraryEntity[]`。
- 保存身份资产时写 V2，并同步回 `elements:library` 兼容旧 UI 和旧画布节点。
- 迁移稳定后，`ElementRef` 只保留给旧模板和旧节点读取。

### 5. 明确 syncPolicy

当前类型有 `linked | snapshot | forked`，但实际核心是 `snapshot/forked`。建议重新定义产品语义：

- `snapshot`：从身份资产导入或同步过；生成使用项目快照；身份库有新版时提示。
- `forked`：确认不是同一身份，或项目需要独立演进；不再提示同步到原身份。
- `linked`：仅作为未来高级模式预留，不在 UI 暴露，除非实现“生成时动态读取身份库”。

短期 UI 只显示“快照 / 已分叉 / 有新版 / 已归档 / 旧链接”。

## 多集与同人不同妆容方案

### 1. 同一个人跨多集

同一个人应只创建一个项目角色资产：

- `Asset.type = role`
- `Asset.name = 角色名`
- `Asset.aliases = 别名、称呼、误写`
- `Asset.libraryLink.entityId = 全局身份 ID`
- `Asset.refImageId = 本项目默认主图`

每一集通过 `Episode.plan.requiredAssetIds` 表达本集计划出现。

### 2. 同一个人的不同妆容、服装、时期

不同妆容不应复制新角色，应创建形态：

- `AssetVariant.variantKind = makeup | outfit | age | injury | state | custom`
- `AssetVariant.label = 晚宴妆 / 战损 / 少年期`
- `AssetVariant.refImageId = 该形态参考图`
- `AssetVariant.appliesToEpisodeIds = 适用剧集`
- 必要时用 `appliesToSceneIds` 或 `appliesToStoryboardIds` 精确限定。

分镜必须通过 `Storyboard.castRefs[].variantId` 锁定具体形态。视频参考图收集和提示词编号都应从同一份 `castRefs` 派生。

### 3. 生成前一致性守门

继续沿用并扩展当前 preflight 和 continuity report：

- `assetId` 不存在：阻止生成。
- `variantId` 不属于资产：阻止生成。
- 已指定变体但没有 `refImageId`：阻止生成或提示先生成形态图。
- 本集计划了资产但分镜未使用：在资产矩阵显示“待落分镜”。
- 分镜出现计划外资产：显示“计划外”。
- 同一角色跨集从具体形态回退主形象：显示状态回退。
- 同一场景内角色形态漂移：提示统一形态。
- 同名/别名重复项目资产：提示合并或标记不同身份。

### 4. 跨集承接

当前 `Episode.productionRecap` 和 `buildEpisodeProductionHandoff()` 已经能给后续集提供承接线索。V2 继续增加：

- 从上一集最终使用的 `castRefs` 和变体图生成“本集建议形态”。
- 当本集计划使用同一角色但未指定形态时，优先建议上一集形态或计划中的形态。
- 当用户输入“女主换晚宴妆”“男主战损”时，Agent 创建或选择对应 `AssetVariant`，并写入当前集计划与分镜。

## 工作流改造步骤

### P0：文档与术语落地

- 采用本方案作为 V2 基准。
- UI 文案统一：
  - “媒体文件”不再叫“资产身份”。
  - “身份资产”不再叫“素材”。
  - “项目资产”明确为“项目快照”。
  - “画布输出”默认叫“候选”，保存后叫“采纳”。

验收：

- docs 中有清晰模型和迁移顺序。
- 不改持久化，不影响现有项目。

### P1：补齐资产中心领域 helper

- 新增 `assetHubDomain.ts` 或扩展 `assetHub.ts`。
- 集中实现身份版本状态、字段差异、候选保存目标、变体作用域摘要。
- 把 Studio 资产矩阵、连续性抽屉、画布检查器中重复判断逐步收敛到 helper。

验收：

- `npm run test:continuity` 覆盖 helper。
- 现有矩阵状态不回退。

### P2：矩阵补完身份候选动作

- 在跨集资产矩阵加入“关联候选身份”。
- 加入“标记为不同身份”。
- 多个重复合并候选时让用户选择目标，不自动取第一个。
- 身份状态筛选中区分“有新版 / 已归档 / 候选身份 / 重复身份 / 未入图谱”。

验收：

- 不打开连续性抽屉，也能处理常见身份候选问题。
- `asset_matches_unlinked_library_entity` 和 `library_entity_alias_conflict` 有行级处理入口。

### P3：画布采纳记录

- 新增 `AssetHubAdoptionRecord` KV。
- 画布保存到项目或身份时写入采纳记录。
- 资产中心新增“采纳箱”页签，按候选、已采纳、已覆盖显示。
- 媒体 usage 对话中展示采纳来源。

验收：

- 一张画布图保存到项目变体后，可以追溯来源节点、端口、prompt、目标资产。
- GC 和 usage 不受影响。

### P4：身份库详情与版本差异

- 身份资产详情页显示使用项目、画布节点、快照版本、归档状态。
- 对每个项目资产显示“项目快照 vs 身份新版”差异。
- 同步时允许选择字段：名称/描述/提示词/主图/多视图/变体/声音/LoRA。
- 同步后明确提示会影响哪些剧集或分镜。

验收：

- 全局身份更新不会静默影响项目。
- 用户能解释为什么某个项目还停在旧版本。

### P5：身份库集合与项目资产包

- 新增身份集合。
- 项目可指定默认集合。
- 导入身份资产时优先搜索项目集合。
- 画布保存身份时默认写入当前项目集合。

验收：

- 不同短剧项目可以隔离同名角色。
- 用户可把一部短剧的角色、场景、道具、声音整理成“系列资产包”。

### P6：正式持久层迁移

- 新增 `assetHub:entities:v2`。
- 从 `elements:library` 一次性迁移。
- `assetHubStore` 先读 V2，缺失时读旧 Element。
- 保存身份资产双写 V2 和旧 Element。
- 稳定后逐步减少直接操作 `ElementRef` 的 UI。

验收：

- 旧项目和旧画布节点仍可打开。
- 新身份库不再受 Element 字段缺失限制。

## Agent 改造要求

### 决策 Agent

- 区分“总结/分析故事”“生成资产”“生成第 N 集”“改写剧本”“只做画布实验”。
- 提到“故事”不应自动进入改写剧本，继续遵守显式意图。

### 资产 Agent

- 创建新身份前先查项目资产、身份库、已拒绝候选。
- 同名但已被标记不同身份时不再重复提示。
- 用户要求“同一个人换妆/换装/受伤/少年期”时创建或选择 `AssetVariant`，不要创建新角色。

### 分镜 Agent

- 输出 `castRefs`，尽量绑定 `variantId`。
- 对当前集计划里的 required variants 优先使用。
- 发现缺图时返回待办，不绕过前置检查。

### 画布 Agent 或工具

- 生成图默认标记 `purpose: candidate`。
- 只有工具明确调用“保存到项目/身份”时，才写入 `approved` lineage 和采纳记录。

## 验收场景

### 场景 1：一部短剧 20 集，同一主角贯穿全剧

预期：

- 项目只有一个主角项目资产。
- 20 集计划都可引用同一个 `assetId`。
- 每集分镜通过 `castRefs` 使用该角色。
- 跨集资产矩阵能看到计划剧集、实际出场剧集、身份版本和缺图状态。

### 场景 2：女主第 5 集换晚宴妆

预期：

- 不创建第二个女主。
- 创建或复用 `variantKind: makeup` 的 `AssetVariant`。
- `appliesToEpisodeIds` 包含第 5 集。
- 第 5 集分镜 `castRefs.variantId` 指向晚宴妆。
- 生成视频时参考图编号与实际发送图片一致。

### 场景 3：画布生成一张战损图并采纳为项目形态

预期：

- 画布输出初始为 `candidate`。
- 用户选择“采纳为项目形态图”。
- 项目 `AssetVariant.refImageId` 更新。
- 画布输出 lineage 标记 `projectAssetId/projectVariantId/purpose: approved`。
- 采纳记录保存来源节点、端口、媒体、目标和时间。

### 场景 4：全局身份库更新主角三视图

预期：

- 已导入项目不自动变化。
- 项目资产矩阵显示“有新版”。
- 用户点击同步时看到字段差异和受影响剧集。
- 同步后项目快照更新，相关剧集失效或提示需要重生成。

### 场景 5：两个项目都有同名角色

预期：

- 身份候选能提示但不强制关联。
- 用户可标记不同身份。
- 被拒绝的身份不再重复干扰该项目资产。
- 身份集合可以让两个项目默认搜索不同资产包。

## 实施优先级

短期最值得做：

1. 资产矩阵补齐“关联候选身份 / 标记不同身份 / 多候选合并选择”。
2. 新增采纳记录，并在画布保存到项目或身份时写入。
3. 增加身份版本差异 helper，让同步动作可解释。
4. 在资产中心 UI 上重新命名和分区，先改变用户心智。

中期再做：

1. 身份集合。
2. 采纳箱。
3. LibraryEntity V2 持久层。
4. Agent 围绕资产中心 V2 的工具升级。

暂不建议马上做：

- 让项目生成直接读取全局身份库。
- 自动把画布候选同步到所有项目。
- 删除顶层当前集兼容镜像。
- 一次性迁移掉 `ElementRef`。

这些改动风险高，会破坏现有项目可复现性。

## 当前落地进度

### 第一轮提交：P1 资产中心领域 helper

- 新增 `src/ui/services/assetHubDomain.ts`，集中实现 V2 方案 P1 要求的四类领域判断：
  - `assetHubEntityVersionStatus(asset, entity)`：统一解析项目资产与身份资产的链接状态（未链接/旧链接/快照/已关联/已分叉）、版本落差、归档状态和可同步性，并输出 UI 状态标签；`entity` 传 `null` 表示 Hub 已加载但身份缺失，可用于区分“未加载”和“已丢失”。
  - `assetHubProjectAssetDiff(asset, entity)`：计算“项目快照 vs 身份库当前版本”的字段级差异，覆盖名称、别名、描述、提示词、主参考图、形态、音色、LoRA；别名忽略顺序差异，形态区分“项目专属”和“未导入”，项目作用域字段不参与比较。
  - `assetHubAdoptionTargetForCanvasOutput(port, doc, entities)`：从画布输出 lineage 解析显式采纳目标（项目主图/项目形态/身份主图/身份形态），项目目标优先；目标失效时回退身份目标，身份已归档时不作为目标返回。
  - `assetHubVariantScopeSummary(asset, variant, episodes)`：汇总项目变体的剧集/场景/分镜作用域为可读摘要，未限定作用域时明确显示“全剧通用”，并统计已失效的未知剧集引用。
- `StudioEditor` 的项目资产链接状态标签改为复用 `assetHubEntityVersionStatus`，收敛第一处散落判断；行为对齐连续性报告既有语义：已分叉和已归档身份不再提示“有新版”。
- 新增 `assetHubDomain.selftest.ts` 并接入 `npm run test:continuity`，覆盖版本状态（快照/分叉/归档/旧链接/缺失/未链接）、字段差异（漂移检测、别名顺序不敏感、形态双向差异）、画布采纳目标（项目优先、归档排除、失效回退、无 lineage 候选）和变体作用域摘要。
- 本轮不改变持久化结构和生成链路；矩阵、连续性抽屉、画布检查器的其余重复判断将在后续轮次逐步收敛到该 helper。

### 第二轮提交：P2 资产矩阵身份候选动作

- 跨集资产矩阵新增行级身份候选处置，不再依赖连续性详情抽屉：
  - 「关联」：读取 `asset_matches_unlinked_library_entity` / `library_entity_alias_conflict` 的候选身份；单候选直接关联，多候选弹出序号选择，再调用 `linkAssetToLibraryEntity`。
  - 「不同身份」：确认后把当前行全部候选写入 `rejectedLibraryEntityIds`，调用 `markAssetAsDistinctIdentity`，后续不再重复提示。
  - 「合并」：多重复目标时先让用户选择合并目标，不再自动取第一个；确认后仍走 `mergeProjectAssetInto`。
- 身份状态筛选从单一「身份状态」细分为独立筛选项：有新版、已归档、候选身份、重复身份、未入图谱；并单独成「身份」筛选组，与质量组（连续性问题 / 缺主图 / 缺形态图）分开。
- 验收口径：不打开连续性抽屉也能处理常见身份候选问题；`asset_matches_unlinked_library_entity` 与 `library_entity_alias_conflict` 有行级处理入口。
- 本轮不新增持久化字段；`typecheck`、`test:continuity`、`build` 通过。

## 最小安全落地线

任何下一步实现都应满足：

- 旧项目能打开。
- 旧画布能打开。
- `ProjectDoc.assets` 仍是生成权威输入。
- 身份资产同步必须显式。
- 画布候选采纳必须显式。
- 变体作用域继续只属于项目资产变体。
- `npm run typecheck`、`npm run test:continuity`、`npm run build` 通过。
