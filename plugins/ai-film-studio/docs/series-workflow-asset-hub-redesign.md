# AI Film Studio 多集工作流与资产中心重设计方案

## 目标

这份方案基于当前实际代码制定，面向下一阶段实现，不重复已经完成的修复清单。

要解决两个核心问题：

1. 短剧项目从“当前单集生产”升级为“多集/整季生产”，让剧本、分镜、视频轨、成片按集隔离，同时让角色、场景、道具、音色在整季内保持一致。
2. 重新设计当前“全局资产”能力。现有全局素材库同时服务工作流和画布，但实际混合了媒体文件、角色身份、项目资产、画布节点产物几个不同概念，导致共享边界不清、同步规则不清、资产一致性难以长期维护。

核心原则：

- 全局可以共享“身份”和“媒体”，但项目生产不能直接依赖一个可被任意改动的全局对象。
- 多集短剧的稳定性来自“系列资产圣经 + 单集生产绑定 + 变体作用域”，而不是把所有图都丢到一个全局素材池。
- 画布应作为实验和精修面，不能把画布节点产物自动污染正式项目资产；回写必须是显式动作。

## 当前代码依据

当前插件已经有四套相关模型，它们职责相近但并不等价。

### 结构化工作流项目

位置：

- `src/ui/domain/types.ts`
- `src/ui/domain/persistence.ts`
- `src/ui/store/projectStore.ts`
- `src/ui/studio/StudioEditor.tsx`

当前状态：

- `ProjectDoc` 已有 `episodes?: Episode[]` 和 `currentEpisodeId?: string`。
- 顶层 `scripts/storyboards/clips/track/storyboardTable` 作为当前集兼容镜像保留。
- `Episode` 保存单集 `scripts/storyboards/clips/track/filmPath/productionRecap`。
- `ProjectDoc.assets` 是项目级生产资产，类型包括 `role/scene/prop/audio/clip`。
- `Asset.variants[]` 已承载人物妆容、服装、时期、状态等形态。
- `Storyboard.castRefs[]` 已能精确绑定 `assetId + variantId`。
- `episodeProduction` 和连续性报告已经按剧集、分镜、变体作用域做了很多加固。

结论：

多集基础已经存在，下一步不是重写 `ProjectDoc`，而是增加“系列规划层”和“资产中心绑定层”。

### 画布项目

位置：

- `src/ui/store/graphStore.ts`
- `src/ui/components/FlowCanvas.tsx`
- `src/ui/components/NodeLibrary.tsx`

当前状态：

- 画布项目使用独立的 `ProjectData`，存储在 `project:<id>`。
- 画布节点输出用 `PortValue.assetId/url/localPath/meta` 表达媒体产物。
- 画布可拖入 `AssetRecord` 生成 `image-input/audio-input` 节点。
- 画布可拖入 `ElementRef` 生成角色/场景/道具节点，并把多视图、变体视图写入节点输出。
- `promoteCharViews` 可把画布生成的角色三视图写回全局元素。

结论：

画布现在是独立创作面，不是结构化短剧项目的一部分。它可以贡献素材和视图，但不应直接等同于正式项目资产。

### 全局素材注册表

位置：

- `src/ui/services/assetRegistry.ts`
- `src/ui/store/assetStore.ts`
- `src/ui/components/views/AssetsView.tsx`

当前状态：

- `AssetRecord` 是图片、视频、音频的全局索引。
- `assets:registry` 存所有媒体记录。
- `assets:boards` 存合集。
- `backfillAll()` 会扫描画布工程和工作流项目，把生成媒体登记到注册表。
- `gcOrphans()` 会扫描画布、工作流、快照、元素库和上传素材，避免误删仍被引用的附件。
- 只有 `uploaded` 素材允许在素材库直接删除，生成素材主要靠 GC 回收。

结论：

`AssetRecord` 适合继续作为“媒体文件索引”，但它不应该承载角色、场景、道具的身份语义。

### 全局角色/场景/物品库

位置：

- `src/ui/store/assetStore.ts`
- `src/ui/components/views/AssetsView.tsx`
- `src/ui/store/projectStore.ts`
- `src/ui/store/graphStore.ts`

当前状态：

- `ElementRef` 存在 `elements:library`。
- `ElementRef` 有 `kind/name/description/prompt/refAssetIds/views/identity/appearanceVariants/voiceId/lora`。
- 工作流可以通过 `importElementToProject` 把 Element 变成 `ProjectDoc.assets[]`。
- 工作流可以通过 `promoteAssetToElement` 把项目资产保存回 Element。
- 画布可以通过 `insertElementNode` 使用 Element，并将多视图和变体视图下沉到节点输出。

结论：

`ElementRef` 已经接近“全局身份资产”，但它和 `ProjectDoc.assets.Asset`、`AssetVariant` 的字段模型并不统一。现在的桥接是“拷贝一部分字段”，不是“同一个资产生命周期”。

## 当前全局资产设计的问题

### 1. “素材”和“资产身份”混在同一个入口

素材库里有：

- 原始媒体文件：图片、视频、音频。
- 生成产物：工作流关键帧、资产图、画布节点输出。
- 角色/场景/物品定义：`ElementRef`。
- 提示词片段。

这些都放在 `AssetsView` 下，用户看到的是“素材库”，但实际有三种完全不同的操作语义：

- 媒体文件可以上传、下载、分组、预览。
- 角色/场景/物品需要维护身份、别名、多视图、形态、声音、使用记录。
- 工作流项目资产需要维护集数、分镜引用、变体作用域和生产状态。

如果继续把它们叫成一个“全局资产”，后续多集工作流会越来越难解释。

### 2. 工作流资产和全局元素是快照式拷贝，但 UI 暗示它们是共享的

`importElementToProject` 当前逻辑：

- 将 Element 的 `name/description/prompt` 拷到项目资产。
- 参考图只取 `views.front` 或 `refAssetIds[0]`。
- 写入 `elementId` 作为桥接。

这会丢失：

- 全局 Element 的多视图。
- 全局 Element 的 `appearanceVariants`。
- 全局 Element 的 `voiceId/lora/tags`。
- 变体视图和项目 `AssetVariant` 的映射。

`promoteAssetToElement` 当前逻辑：

- 只把项目资产的 `name/desc/prompt/refImageId` 写回 Element。
- 只保存一张参考图。
- 不保存 aliases、images 历史、variants 作用域、voiceAssetId、children derivative。

这会导致用户以为“保存到角色/场景库”能保留完整角色设定，实际只保留了很薄的一层信息。

### 3. 全局改动不应自动影响已生产剧集

短剧项目尤其需要可复现：

- 第 1 集已成片时，角色主图和变体图不应该因为全局库被改动而悄悄变化。
- 第 5 集需要换妆时，应创建本项目或本系列的变体作用域，而不是改掉全局角色主形象。
- 画布实验生成的新图不应自动替换项目里正在生产的角色图。

所以“全局共享”不能是直接共享可变对象。更合理的是：

- 全局库保存规范身份和可复用媒体。
- 项目导入时生成项目内生产资产快照。
- 项目资产保留与全局实体的链接，但生产链路使用项目快照。
- 用户明确选择“同步全局更新”或“发布项目修改到全局”。

### 4. 画布产物缺少明确回写目标

画布现在可以：

- 从素材库拖入媒体。
- 从 Element 拖入角色/场景节点。
- 把角色三视图回写到 Element。

但缺少几个关键概念：

- 这张图是角色主图、三视图、某个妆容变体，还是一次临时实验？
- 回写到全局后，要不要同步到某个工作流项目？
- 如果同一个角色在多个项目中有快照，是否通知这些项目有可用更新？

画布应该是资产研发面，而不是自动同步面。

### 5. `ElementRef` 与 `AssetVariant` 的变体模型重复

当前：

- 全局 Element 使用 `appearanceVariants`，里面有 `views/front/side/back`。
- 项目 Asset 使用 `variants`，里面有 `refImageId/appliesToEpisodeIds/appliesToSceneIds/appliesToStoryboardIds`。

这两个模型都在表达同一个人的不同状态，但一个偏“全局身份”，一个偏“项目生产作用域”。它们需要明确映射关系，否则用户会看到两套“变体”。

### 6. 缺少资产使用图谱

现在可以从连续性报告里看到项目内资产问题，但全局资产库不知道：

- 一个 Element 被哪些工作流项目引用。
- 哪些项目资产是从这个 Element 导入的。
- 哪些画布节点使用过这个 Element。
- 哪些媒体文件被哪个实体、哪个项目资产、哪个分镜引用。

缺少使用图谱，用户就不敢安全删除、合并或同步资产。

## 目标产品形态

把现在的“素材库”拆成更准确的“资产中心”，下设三层。

### 1. 媒体文件层

对应当前 `AssetRecord`，建议命名为 `MediaAsset` 或在 UI 上称为“媒体文件”。

职责：

- 管理图片、视频、音频的二进制引用。
- 上传、下载、预览、分组。
- 记录来源：上传、画布生成、工作流生成。
- 被 GC 和引用扫描保护。

不负责：

- 判断“这是哪个角色”。
- 判断“这是某个角色的哪个妆容”。
- 判断“这个图该用于第几集”。

当前 `AssetRecord` 可继续保留，只是 UI 和服务层要把它定位为媒体索引，不再叫“角色资产”。

### 2. 全局身份资产层

对应当前 `ElementRef`，建议升级为 `LibraryEntity`。

职责：

- 表达可跨项目复用的角色、场景、道具、音色身份。
- 保存稳定身份信息、别名、多视图、默认参考图。
- 保存可复用的全局形态，例如“少年期”“战损妆”“晚宴礼服”“雨夜场景”“破损道具”。
- 记录与媒体文件的关系。
- 记录使用图谱和版本。

推荐模型：

```ts
export type LibraryEntityKind = 'character' | 'scene' | 'prop' | 'voice'

export interface MediaRef {
  mediaAssetId?: string
  assetId?: string
  localPath?: string
  url?: string
  role: 'primary' | 'front' | 'side' | 'back' | 'concept' | 'reference' | 'audio'
  label?: string
  createdAt: number
}

export interface LibraryVariant {
  id: string
  label: string
  kind?: 'age' | 'outfit' | 'makeup' | 'injury' | 'state' | 'time' | 'weather' | 'custom'
  desc?: string
  prompt?: string
  parentVariantId?: string
  mediaRefs?: MediaRef[]
  tags?: string[]
  createdAt: number
  updatedAt: number
}

export interface LibraryEntity {
  id: string
  kind: LibraryEntityKind
  name: string
  aliases?: string[]
  identity?: string
  description?: string
  prompt?: string
  tags?: string[]
  mediaRefs?: MediaRef[]
  variants?: LibraryVariant[]
  voiceRef?: MediaRef
  lora?: { provider?: string; ref: string; weight?: number }
  version: number
  archived?: boolean
  createdAt: number
  updatedAt: number
}
```

兼容策略：

- `ElementRef` 可迁移为 `LibraryEntity`。
- `ElementRef.refAssetIds` 迁移为 `mediaRefs`。
- `ElementRef.views` 迁移为 `mediaRefs` 的 `front/side/back`。
- `ElementRef.appearanceVariants` 迁移为 `LibraryVariant`。
- 旧 key `elements:library` 暂时保留，新增读写通过 `assetHubStore` 做兼容。

### 3. 项目生产资产层

对应当前 `ProjectDoc.assets.Asset`。

职责：

- 表达这个短剧项目实际生产使用的角色、场景、道具、音色。
- 保存从全局身份资产导入时的项目快照。
- 保存项目特定别名、描述、提示词、参考图和生成状态。
- 保存本系列/本集特定的变体作用域。
- 被分镜 `castRefs` 引用，是生成链路的权威输入。

推荐在现有 `Asset` 上增量添加：

```ts
export interface ProjectAssetLibraryLink {
  entityId: string
  entityVersion?: number
  syncPolicy: 'linked' | 'snapshot' | 'forked'
  variantMap?: Record<string, string> // localVariantId -> libraryVariantId
  lastSyncedAt?: number
}

export interface Asset {
  // existing fields...
  libraryLink?: ProjectAssetLibraryLink
}

export interface AssetVariant {
  // existing fields...
  libraryVariantId?: string
  variantKind?: 'age' | 'outfit' | 'makeup' | 'injury' | 'state' | 'time' | 'weather' | 'custom'
}
```

默认策略：

- 从全局身份资产导入项目时，默认 `syncPolicy: 'snapshot'`。
- 项目生产只读项目内 `Asset` 和 `AssetVariant`。
- 全局资产更新后，只显示“全局有更新”，不自动改项目快照。
- 用户手动选择“同步到项目”时，才更新项目资产。
- 用户在项目里改过资产后，可选择“发布到资产中心”或“另存为新全局身份”。

这能避免全局修改破坏已成片剧集。

### 4. 画布引用层

画布节点不应拥有正式身份，只应引用资产中心或媒体文件。

推荐给 `PortValue.meta` 增加标准字段：

```ts
export interface AssetLineageMeta {
  mediaAssetId?: string
  libraryEntityId?: string
  libraryVariantId?: string
  projectId?: string
  projectAssetId?: string
  projectVariantId?: string
  view?: 'front' | 'side' | 'back' | 'concept' | 'primary'
  purpose?: 'experiment' | 'candidate' | 'approved'
}
```

画布回写动作应变成显式命令：

- “保存为全局角色主图”
- “保存为全局角色三视图”
- “保存为全局角色变体图”
- “保存为当前项目资产图”
- “保存为当前项目某个变体图”
- “仅入媒体库”

默认生成结果只进入媒体文件层，不自动修改身份资产或项目生产资产。

## 多集工作流下一步方案

### 1. 增加系列规划层

当前 `ProjectDoc` 已有多集结构，但还缺少系列层信息。建议新增：

```ts
export interface SeriesBible {
  logline?: string
  synopsis?: string
  theme?: string
  worldRules?: string
  continuityRules?: string[]
  plannedEpisodeCount?: number
  characterArcNotes?: Record<string, string>
  locationNotes?: Record<string, string>
}

export interface EpisodePlan {
  hook?: string
  conflict?: string
  cliffhanger?: string
  requiredAssetIds?: string[]
  requiredVariantIds?: string[]
}

export interface ProjectDoc {
  // existing fields...
  seriesBible?: SeriesBible
}

export interface Episode {
  // existing fields...
  plan?: EpisodePlan
}
```

用途：

- Agent 先生成整季结构，再逐集生成。
- 资产 Agent 根据 `seriesBible` 建立角色、场景、道具清单。
- 每集计划明确需要哪些资产和状态。
- 生成下一集时，不只读上一集 `productionRecap`，还读整季设定。

### 2. 新增“系列圣经”视图

在 Studio 工作台中增加一个一级阶段页，建议位于“原著/剧本/资产”之前。

内容：

- 整季梗概。
- 集数列表和每集 hook/conflict/cliffhanger。
- 角色清单和角色弧光。
- 场景清单和空间规则。
- 道具清单和状态规则。
- 连续性规则，例如“伤疤从 E3 开始出现”“E5 之前不能使用晚宴妆”。

这个视图不生成媒体，主要用于让用户确认“整季生产蓝图”。

### 3. 项目资产页升级为“系列资产矩阵”

当前资产页已有跨集一致性矩阵，下一步应升级为正式生产面板。

每个资产卡需要显示：

- 项目资产名称、别名、类型。
- 是否来自全局身份资产。
- 同步状态：本地快照、已关联、全局有更新、项目已改动、已分叉。
- 主图和候选图。
- 形态/妆容/服装/状态变体。
- 每个变体作用域：全集、某集、某场景、某分镜。
- 出现剧集和分镜数量。
- 质量问题：缺图、重名、别名冲突、作用域不完整、状态回退。

关键交互：

- “从资产中心导入”
- “发布到资产中心”
- “同步全局更新”
- “分叉为项目专属资产”
- “把当前图设为主图”
- “把当前图设为某个变体图”

### 4. 同一个人的不同妆容处理规则

规则：

- “同一个人”永远是同一个 `Asset` 或 `LibraryEntity`。
- 妆容、服装、年龄、受伤状态、职业伪装等都进入 `AssetVariant` 或 `LibraryVariant`。
- 分镜只绑定 `castRefs.assetId + variantId`，不新建角色。
- 只有身份真的不同，才新建角色资产。

变体作用域建议：

- 常态形象：不写 `variantId`，使用主图。
- 一整集都使用的妆容：`appliesToEpisodeIds`。
- 一个场景内使用的服装：`appliesToSceneIds`。
- 只在某个镜头出现的状态：`appliesToStoryboardIds`。
- 跨项目都可能复用的形态：发布为 `LibraryVariant`。
- 只属于本项目剧情的形态：保留为项目 `AssetVariant`。

### 5. 多集生成流程

推荐流程：

1. 用户输入故事或导入原著。
2. Agent 生成 `seriesBible` 和 `episodes[].plan`。
3. 用户确认集数、每集冲突和角色弧光。
4. Agent 生成项目级资产草稿。
5. 用户从资产中心匹配已有角色/场景/道具，或新建项目资产。
6. 逐集生成剧本和分镜。
7. 分镜生成时必须输出 `castRefs`，优先复用项目资产和已有变体。
8. 生成关键帧前运行资产预检。
9. 生成视频前运行连续性预检。
10. 每集成片后写 `productionRecap`。
11. 下一集生成时读取 `seriesBible + previous productionRecap + asset usage history`。
12. 全剧导出时生成资产引用清单和缺失报告。

### 6. Agent 行为约束

Agent 工具循环和分阶段 Agent 需要增加几条硬约束：

- 不能因为“别名/称号/昵称”创建新角色，应先用名称和别名查找资产中心与项目资产。
- 不能因为“换妆/换衣/受伤/年龄变化”创建新角色，应创建或选择变体。
- 明确指定第 N 集时，写入对应 Episode；无效集数必须报错。
- “下一集”不存在时可以创建，但要先延续 `seriesBible`。
- 只总结或只生成资产时，不能重写剧本。
- 画布产物回写必须有明确目标：媒体、全局身份、项目资产、项目变体。

## 资产中心重构实施计划

### 当前落地进度

截至本轮提交，P0 已开始落地：

- 资产中心入口已把原“素材库”重新拆分为“媒体文件 / 身份资产 / 提示词”三个概念。
- 工作流阶段页中的“资产”已改为“项目资产”，明确它是生产用项目快照，而不是全局可变对象。
- 工作台 Dock 和画布 Dock 已把可拖拽资源分成“身份资产”和“媒体文件”，并明确拖入项目资产区会导入项目快照。
- 项目资产卡会显示其 `elementId` 关联的身份资产，提示生产仍以项目内资产和变体为准。
- 身份资产卡会只读显示当前被多少个工作流项目引用，来源是扫描 `studio:index` 与 `studio:project:<id>` 中的 `Asset.elementId`。
- 画布 Inspector 与角色三视图回写提示已改为“资产中心”，避免继续暗示这是普通素材库。

本轮没有改变持久化数据结构，也没有改变生成链路；它只先把现有边界显性化，为 P1 的 `assetHub` 服务层和 P2 的完整双向映射做准备。

第二轮提交继续落地 P1：

- 新增 `src/ui/services/assetHub.ts`，统一读取 `assets:registry`、`assets:boards` 和旧 `elements:library`。
- 新增 `LibraryEntity`、`LibraryVariant`、`MediaRef` 兼容视图，先不迁移旧数据，只把 `ElementRef` 映射成新资产中心模型。
- 新增 `src/ui/store/assetHubStore.ts`，作为 UI 读取媒体文件、身份资产、合集和 usage 的统一 Store。
- 将身份资产页迁移为从 `assetHubStore` 读取 `elements/mediaAssets/usageByEntity`；原 P0 的单独 `assetUsage` 扫描被移除。
- usage 扫描范围扩展到 `studio:index` / `studio:project:<id>`、画布 `projects:index` / `project:<id>` 和 `snapshots`。
- 新增 `createProjectAssetFromEntity` 与 `promoteProjectAssetToEntity` 纯映射函数，为 P2 的双向导入/发布提供字段映射底座。
- 新增 `assetHub.selftest.ts` 并接入 `npm run test:continuity`，覆盖 ElementRef → LibraryEntity、LibraryEntity → 项目资产、项目资产 → LibraryEntity 的核心映射。

本轮仍不改变持久化数据结构；`elements:library` 继续作为兼容来源，P2 再把 `importElementToProject` / `promoteAssetToElement` 接入新映射。

第三轮提交继续落地 P2：

- `ProjectDoc.assets.Asset` 增加 `libraryLink`，记录来源身份资产、来源版本、快照同步策略和本地变体到全局变体的映射。
- `AssetVariant` 增加 `libraryVariantId` 与 `variantKind`，用于区分“本项目使用的形态”与“资产中心可复用形态”。
- `ElementRef` 兼容增加 `aliases/version`，`ElementVariant` 兼容增加 `kind/parentVariantId/tags`，避免发布回资产中心时丢别名、版本和变体语义。
- `importElementToProject` 已改为通过 `elementToLibraryEntity` + `createProjectAssetFromEntity` 导入，默认生成项目快照，并导入别名、多图、变体和 `libraryLink`。
- `promoteAssetToElement` 已改为通过 `promoteProjectAssetToEntity` + `libraryEntityToElement` 发布，保留项目资产别名、图片历史、变体与已有身份资产的视图角色，同时剥离项目内 episode/scene/storyboard 作用域。
- `assetHub.selftest.ts` 增加别名、`libraryLink`、变体映射和发布回 ElementRef 的覆盖。

本轮仍然不做持久化 key 迁移，也不把全局身份资产改成实时 linked 模式；项目生产链路继续以项目内 `Asset` 快照为准。

第四轮提交开始落地 P3：

- `PortValue.meta` 增加标准 lineage 字段，画布输出可以携带 `mediaAssetId/libraryEntityId/libraryVariantId/view/purpose`。
- 从资产中心拖入身份资产到画布时，输出项会保留 `libraryEntityId`；变体视图会保留 `libraryVariantId`，媒体文件输入会保留 `mediaAssetId`。
- 变体的主图/参考图也会随身份资产拖入画布，避免只保存为变体主图后下次无法被画布继续使用。
- 角色/场景/物品节点上传或生成参考图时，输出图会标记为 `candidate`，表示它只是候选媒体，不自动成为身份资产。
- 角色设定图节点不再在生成完成后自动写回资产中心；生成结果只保留在画布输出和媒体文件索引中。
- `assetStore` 新增 `promoteCanvasOutputs(items, target)`，调用方必须传入明确的身份资产、视图角色和可选变体目标，避免继续按 `charId/name` 自动猜测写回。
- Inspector 输出画廊增加显式“保存为主图/正面图/侧面图/背面图/变体图”动作；只有能解析到唯一身份资产目标时才允许保存。

本轮仍不处理“保存到当前工作流项目资产/项目变体”的路径；该能力需要在 P3 后续增量里接入当前工作流项目上下文和项目资产选择器。

### P0：术语和边界先落地

改动范围小，先降低用户认知混乱。

任务：

- 把 UI 中“素材库”的三个标签重新命名：
  - “素材（图片/视频/音频）”改为“媒体文件”。
  - “角色/场景库”改为“资产中心”或“身份资产”。
  - 工作流资产页继续叫“项目资产”。
- 在 Studio Dock 中区分“媒体文件”和“身份资产”。
- 在项目资产卡上显示 `elementId` 关联状态。
- 在全局身份资产卡上显示被哪些项目引用，先用扫描结果只读展示。

验收：

- 用户能看懂：媒体文件不是角色，身份资产不是项目生产资产，项目资产才是分镜生成依据。

### P1：新增 Asset Hub 服务层

不立即删除 `assetStore`，先增加统一服务。

新增：

- `src/ui/services/assetHub.ts`
- `src/ui/store/assetHubStore.ts`

职责：

- 统一读取 `assets:registry` 和 `elements:library`。
- 给 `ElementRef` 提供 `LibraryEntity` 兼容视图。
- 提供 `getUsage(entityId)`，扫描：
  - `studio:index` 和 `studio:project:<id>`
  - `projects:index` 和 `project:<id>`
  - `snapshots`
- 提供 `promoteProjectAssetToEntity` 和 `createProjectAssetFromEntity` 的完整字段映射。

验收：

- 不破坏现有 UI。
- 可以从一个 API 读到媒体、身份资产和使用记录。

### P2：修正项目资产和全局身份资产的双向映射

重点修当前最不合理的地方。

改造 `importElementToProject`：

- 导入 aliases。
- 导入 identity/description/prompt/tags。
- 导入主图和多视图中最适合生产的图。
- 把 `appearanceVariants` 转成项目 `AssetVariant`。
- 建立 `libraryLink.variantMap`。
- 默认 `syncPolicy: 'snapshot'`。

改造 `promoteAssetToElement`：

- 保存 aliases。
- 保存 images/currentImageId。
- 保存 variants，但去掉项目作用域，只保留可复用形态信息。
- 保存 voice/lora 可映射字段。
- 如果已有 `libraryLink`，按版本更新；否则新建。
- 发布前显示差异预览，避免覆盖全局身份。

验收：

- 项目中的“女主晚宴妆”发布到资产中心后，在新项目中能作为同一个角色的变体导入。
- 从资产中心导入角色后，项目资产能看到对应变体，而不是只拿到一张主图。

### P3：画布回写显式化

改造点：

- `insertElementNode` 保留 `libraryEntityId/libraryVariantId` 到节点输出 meta。
- `promoteCharViews` 改为 `promoteCanvasOutputs`，必须传明确目标。
- 画布节点输出面板增加“保存到”菜单：
  - 仅入媒体文件
  - 设为全局身份主图
  - 设为全局身份三视图
  - 设为全局身份变体图
  - 设为当前项目资产主图
  - 设为当前项目资产变体图
- 默认不自动回写到项目或全局身份。

验收：

- 画布生成一个角色侧脸，不会自动改变项目资产。
- 用户明确选择“保存为女主 E2 晚宴妆侧视图”后，资产中心和项目变体都能找到它。

### P4：引入系列圣经和多集规划

新增：

- `SeriesBible` 和 `EpisodePlan` 类型。
- Studio “系列”阶段页。
- Agent 工具：
  - `get_series_bible`
  - `update_series_bible`
  - `upsert_episode_plan`
  - `link_project_asset_to_library_entity`
  - `publish_project_asset_to_library`
  - `sync_project_asset_from_library`

验收：

- 用户可以先规划 20 集短剧，再逐集生成。
- 每集生成前都能看到本集必须承接的角色状态、场景和道具。

### P5：连续性质量门升级

在现有连续性报告上增加资产中心维度：

- 项目资产链接的全局身份已被归档。
- 项目资产链接的全局身份有新版本。
- 项目资产和全局身份别名冲突。
- 本集分镜使用了项目资产，但资产中心存在更明确的同名身份，需要用户确认是否合并。
- 同一个 `LibraryEntity` 被导入成多个项目资产。
- 同一个角色的两个项目资产在不同集出现，可能是重复角色。

验收：

- 多集生产前能发现“同一个人被拆成两个项目资产”的问题。
- 能一键合并到同一个项目资产，或明确标记为不同身份。

### P6：逐步废弃旧 `elements:library` 直接访问

完成 P1-P5 后：

- UI 不再直接使用 `useAssetStore.elements`。
- 统一从 `assetHubStore.entities` 读取。
- `elements:library` 仅作为迁移来源或兼容缓存。
- `ElementRef` 类型保留一段时间，最终收敛为 `LibraryEntity`。

验收：

- 新代码里新增功能不再直接依赖 `ElementRef`。
- 旧用户数据仍可打开、编辑、迁移。

## 推荐的数据同步策略

### 从全局身份资产导入项目

默认是快照：

- 创建项目 `Asset`。
- 写入 `libraryLink.entityId`。
- 写入 `libraryLink.entityVersion`。
- 写入 `syncPolicy: 'snapshot'`。
- 复制必要字段和变体。

为什么不默认 linked：

- 短剧生产要求可复现。
- 已完成集不应被全局修改影响。
- 用户需要明确知道某个角色形象是否发生变化。

### 从项目资产发布到全局

必须经过差异确认：

- 新建全局身份。
- 或更新已有全局身份。
- 或只发布某个变体。
- 或只发布某张媒体图。

发布时不带项目作用域：

- `appliesToEpisodeIds` 不进入全局。
- `appliesToSceneIds` 不进入全局。
- `appliesToStoryboardIds` 不进入全局。

全局只保存“可复用形态”，项目保存“这个形态在本剧什么时候使用”。

### 从画布回写

默认只入媒体文件层。

如果要写入身份资产或项目资产，必须明确：

- 目标实体。
- 目标变体。
- 目标视图角色：主图、正面、侧面、背面、概念图、参考图。
- 是否同步到当前项目。

## 关键验收场景

### 场景 1：20 集短剧，同一个女主保持一致

步骤：

1. 创建女主全局身份资产。
2. 导入到短剧项目，生成项目资产快照。
3. 规划 20 集。
4. 每集分镜都通过 `castRefs.assetId` 引用同一个项目资产。
5. 视频生成前连续性报告确认没有重复女主资产。

验收：

- 不会因为“女主/阿瑶/王小姐”等称呼创建多个角色。
- 全剧导出清单能列出女主在哪些集出现。

### 场景 2：同一个人多套妆容

步骤：

1. 女主主形象为常态。
2. 创建 `E3 战损妆` 变体，作用域为第 3 集。
3. 创建 `E5 晚宴妆` 变体，作用域为第 5 集宴会场景。
4. 分镜 `castRefs` 绑定对应 `variantId`。

验收：

- E3 不会误用 E5 晚宴妆。
- E5 宴会外场景不会误用晚宴妆。
- 如果 E6 又回到主形象，连续性报告要求确认是状态恢复，而不是漏绑定。

### 场景 3：画布生成三视图并回写

步骤：

1. 从资产中心拖女主到画布。
2. 画布生成 front/side/back。
3. 用户选择“保存为全局女主三视图”。
4. 再选择是否同步到当前项目。

验收：

- 不选择同步时，当前项目已成片集不变。
- 选择同步时，项目资产显示全局版本更新，并由用户确认应用。

### 场景 4：删除或清理素材

步骤：

1. 某张图片被项目资产变体引用。
2. 用户运行“清理未引用素材”。

验收：

- 图片不被 GC 删除。
- 资产中心使用图谱能显示该图被哪个项目、哪一集、哪个变体使用。

## 对 Toonflow 的借鉴方式

Toonflow 给当前插件的启发不应该是复制数据表，而是复制几个工作流原则：

- 资产属于项目和产线，不是临时散落在节点上。
- 剧本、分镜、视频生成需要明确作用域。
- 派生资产需要保留父子关系。
- 多 Agent 生产时，资产和分镜必须通过稳定 id 传递，而不是只靠名称。
- 无限画布适合探索和编辑，但正式生产需要结构化资产和剧集状态。

结合当前 Mulby 插件的 JSON KV 架构，最合适的落地方式是：

- 保留 `ProjectDoc` 作为结构化短剧项目文档。
- 保留 `AssetRecord` 作为媒体文件索引。
- 将 `ElementRef` 升级为资产中心的身份资产。
- 将项目资产作为生产快照和分镜生成权威输入。
- 将画布产物通过显式回写进入资产中心或项目。

## 下一步建议

优先级最高的是资产边界重构，而不是继续堆更多生成按钮。

推荐实施顺序：

1. P0：先改 UI 术语和只读使用图谱，降低误解。
2. P1：新增 `assetHub` 服务层，统一读取媒体、身份资产和使用记录。
3. P2：修正 `importElementToProject` 和 `promoteAssetToElement`，保证全局身份和项目资产双向映射不再丢字段。
4. P3：画布回写显式化，避免实验产物污染生产资产。
5. P4：做系列圣经视图和多集规划 Agent。
6. P5：把资产中心维度接入连续性质量门。

完成 P0-P3 后，当前“工作流、画布共享全局资产”的问题会基本被拆开：共享的是媒体和身份，生产使用的是项目快照，画布结果需要明确发布目标。完成 P4-P5 后，多集短剧的资产一致性和同人多妆容管理才会真正稳定。
