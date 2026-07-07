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

第五轮提交继续落地 P3：

- `projectStore` 新增 `promoteCanvasImageToProjectAsset(target)`，允许画布输出图显式写入当前工作流项目资产主图或某个项目变体图。
- 写入项目资产主图时，会加入资产候选图历史、更新 `currentImageId/refImageId/state`，并让使用该项目资产的剧集生产状态失效。
- 写入项目变体图时，会更新 `AssetVariant.refImageId/state`，并让绑定该变体的剧集生产状态失效。
- Inspector 输出画廊增加“保存到项目”选择器，候选目标来自当前打开工作流项目中的角色/场景/道具项目资产及其变体。
- 画布输出如果携带 `projectAssetId/projectVariantId`、`libraryEntityId/libraryVariantId` 或明确名称，会尝试自动选中唯一项目目标；否则需要用户手动选择。
- 单张输出图现在可以同时提供“保存到身份资产”和“存项目”两个显式动作，但仍不会自动回写任何生产资产。

本轮仍不处理全局身份资产更新后的“同步到所有引用项目”流程；该能力需要在后续 P4/P5 的系列资产矩阵和连续性质量门中做差异确认。

第六轮提交开始落地 P4：

- `ProjectDoc` 新增 `seriesBible`，保存整季 logline、梗概、主题、世界规则、连续性规则和计划集数。
- `Episode` 新增 `plan`，保存单集 hook、conflict、cliffhanger，以及本集必需项目资产和必需变体。
- 持久化归一化会为旧项目补齐默认 `seriesBible`，并清理旧剧集计划里重复、空白或非字符串的资产/变体 id。
- `projectStore` 新增 `updateSeriesBible` 与 `updateEpisodePlan`，写入时会压缩空白文本，并过滤已经不存在的项目资产/变体引用。
- Studio 工作台新增“系列”阶段页，位于“原著”之前；用户可以直接编辑系列圣经、计划集数、每集三段式规划，并用勾选方式维护必需项目资产和形态/妆容。
- “补齐剧集”会按计划集数一次性创建缺少的剧集，但不会自动覆盖已有剧集内容。

本轮还没有把 `seriesBible` / `Episode.plan` 接入 Agent 工具循环和连续性质量门；下一步需要让 Agent 能读取、更新和遵守这些规划字段。

第七轮提交继续落地 P4：

- Agent 只读工具新增 `get_series_bible`，返回系列圣经、每集计划、可用项目资产和可用变体，供整季规划、续写和换装决策使用。
- `get_workspace` / `get_episodes` 的剧集视图会返回 `Episode.plan` 摘要，并把必需资产/必需变体解析成可读名称，降低 Agent 只看 id 误判的概率。
- Agent 写入工具新增 `update_series_bible`，可更新整季 logline、梗概、主题、世界规则、连续性规则和计划集数。
- Agent 写入工具新增 `upsert_episode_plan`，可按剧集选择器更新某集 hook/conflict/cliffhanger，并能用资产名或变体名解析本集必需项目资产和必需形态/妆容。
- 工具循环系统提示已要求：整季规划和只做大纲时优先写 `seriesBible` / `Episode.plan`，不要直接重写剧本；生成单集剧本/分镜时必须遵守对应 episode plan。
- `agentTools.selftest.ts` 覆盖了读取系列规划、写入系列圣经、按剧集写入计划以及资产/变体名称解析。

第八轮提交开始落地 P5 的前置质量门：

- 连续性报告会读取 `Episode.plan.requiredAssetIds`，检查计划要求的项目资产是否仍存在、是否属于可用于分镜的角色/场景/道具，以及在本集已有分镜时是否已经被 `castRefs` 引用。
- 连续性报告会读取 `Episode.plan.requiredVariantIds`，解析变体所属项目资产，检查计划要求的形态/妆容是否仍存在、是否属于可用于分镜的项目资产，以及在本集已有分镜时是否已经被有效绑定。
- 新增 `episode_plan_invalid_asset`、`episode_plan_invalid_variant`、`episode_plan_missing_asset`、`episode_plan_missing_variant` 四类问题，避免 Agent 或用户规划了本集必需资产，但分镜生产链路实际没有使用。
- 还没有创建分镜的剧集不会因为缺少计划资产/变体使用而报警，避免规划阶段产生噪音；但无效计划引用仍会被提示，便于清理旧数据。
- `continuityReport.selftest.ts` 覆盖了计划资产已使用、计划资产缺失、计划变体缺失、计划变体已绑定、无效计划引用，以及无分镜时跳过缺失检查。

第九轮提交继续落地 P5 的资产中心质量门：

- `ElementRef` 兼容增加 `archived` 字段，`elementToLibraryEntity` / `libraryEntityToElement` / `promoteProjectAssetToEntity` 会保留身份资产归档状态。
- 连续性报告新增可选 `libraryEntities` 快照参数；未传入资产中心快照时保持原有纯项目内检查，避免 UI 首次加载阶段误报链接缺失。
- 资产中心快照可用时，连续性报告会检查项目资产链接的身份资产是否已不存在、已归档、或资产中心版本高于项目快照版本。
- 即使没有资产中心快照，连续性报告也会基于项目内 `libraryLink.entityId` / `elementId` 检查同一个 `LibraryEntity` 是否被导入成多个项目资产。
- Studio 工作台的一致性提示、详情抽屉和跨集资产矩阵会自动加载资产中心快照并传给连续性报告；Agent 的 `get_continuity_report` 也会尽量加载资产中心快照，失败时回退为项目内报告。
- 新增 `library_entity_missing`、`library_entity_archived`、`library_entity_version_outdated`、`duplicate_library_entity_project_assets` 四类问题，并在 `assetHub.selftest.ts` / `continuityReport.selftest.ts` 中覆盖。

第十轮提交继续落地 P5 的身份候选匹配：

- 连续性报告会基于资产中心快照构建同类型身份查找表：项目人物只匹配 `character`，项目场景只匹配 `scene`，项目道具只匹配 `prop`，避免跨类型同名误报。
- 已关联身份的项目资产如果名称/别名命中其他未归档身份，会报告 `library_entity_alias_conflict`，提示可能关联错身份或别名冲突。
- 尚未关联身份的项目资产如果名称/别名命中资产中心身份，会报告 `asset_matches_unlinked_library_entity`，提示应该从资产中心快照导入、手动关联，或明确改名为不同身份。
- 归档身份不会作为合并候选参与匹配，避免把项目资产引导回废弃身份。
- `continuityReport.selftest.ts` 覆盖了已关联资产命中其他身份、未关联资产命中资产中心身份、归档身份跳过候选、跨类型同名不误报。

第十一轮提交继续落地 P5 的候选身份处置：

- 项目资产新增 `rejectedLibraryEntityIds`，用于记录用户或 Agent 已明确判定“不是同一身份”的资产中心候选，连续性报告会跳过这些候选，避免同名/别名误报反复出现。
- `projectStore` 新增 `linkAssetToLibraryEntity`，只把项目资产关联到资产中心身份快照并写入 `libraryLink` / `elementId` / 可匹配的变体映射，不覆盖项目内名称、提示词、参考图等生产字段。
- `projectStore` 新增 `markAssetAsDistinctIdentity`，可把候选身份加入拒绝列表；如果拒绝的是当前已链接身份，则把 `syncPolicy` 标为 `forked`，表示项目快照已明确分叉。
- Studio 连续性详情抽屉为 `asset_matches_unlinked_library_entity` 和 `library_entity_alias_conflict` 增加“关联候选身份”和“标记为不同身份”处置按钮。
- Agent 写入工具新增 `link_project_asset_to_library_entity` 和 `mark_project_asset_distinct_identity`，让自动修复流程可以处理同样的资产中心候选问题；`get_assets` 也会返回 `libraryLink` 和 `rejectedLibraryEntityIds` 供 Agent 观察结果。
- `continuityReport.selftest.ts` 覆盖被拒绝的身份候选不会再报告；`agentTools.selftest.ts` 覆盖 Agent 关联身份和标记不同身份的写入结果。

第十二轮提交继续落地 P5 的项目资产合并：

- `projectStore` 新增 `mergeProjectAssetInto`，只允许同类型项目资产合并；合并时把分镜 `associateAssetIds` / `castRefs` 和 `Episode.plan.requiredAssetIds` / `requiredVariantIds` 从源资产迁移到目标资产，然后删除源资产及其子资产。
- 合并时会按 `libraryVariantId` 或变体标签匹配源/目标变体；目标缺少的源变体会复制过去，避免同一角色的妆容、服装、状态引用在合并后丢失。
- Studio 连续性详情抽屉为 `duplicate_library_entity_project_assets` 增加“合并到同身份项目资产”动作，多候选时需要选择目标，并在执行前确认源资产会被移除。
- Agent 写入工具新增 `merge_project_asset_into`，可处理连续性报告中同一身份资产被导入成多个项目资产的情况，并返回合并后的目标资产状态。
- `agentTools.selftest.ts` 覆盖了 Agent 合并项目资产后源资产被删除、分镜引用迁移到目标资产、源变体映射到目标变体。

第十三轮提交继续落地 P5 的跨集疑似重复资产判断：

- 连续性报告新增 `cross_episode_duplicate_project_asset_candidate`，会在同类型项目资产实际出现在不同剧集、名称/别名命中同一称呼、且没有已经链接到同一身份时提示可能被拆成了多个生产资产。
- 该问题会带上 `relatedAssetIds`、命中的 `conflictLabel` 和跨集出场摘要，便于 UI 或 Agent 直接选择要合并到的目标项目资产。
- Studio 连续性详情抽屉复用“合并到同身份项目资产”动作处理该问题，用户确认后迁移分镜和剧集计划引用。
- Agent `merge_project_asset_into` 的用途扩展到 `cross_episode_duplicate_project_asset_candidate`，让工具循环可以修复未链接身份但跨集疑似重复的项目资产。
- `continuityReport.selftest.ts` 覆盖了跨集名称/别名重叠时报告候选，以及两个资产已链接到同一身份时不重复报告。

第十四轮提交补齐 P4/P5 的 Agent 资产中心发布与同步工具：

- `projectStore` 新增 `syncAssetFromLibraryEntity`，可从资产中心身份资产同步项目资产快照字段，更新名称、别名、提示词、主参考图、媒体图和可复用变体，同时保留项目内变体的剧集/场景/分镜作用域。
- Agent 写入工具新增 `publish_project_asset_to_library`，调用现有 `promoteAssetToElement` 把项目资产发布或更新到资产中心，并在项目资产上回写 `elementId` / `libraryLink`。
- Agent 写入工具新增 `sync_project_asset_from_library`，从资产中心快照同步项目资产；未指定身份时默认使用项目资产已有的 `libraryLink.entityId` / `elementId`。
- 同步后会让使用该资产的已制作剧集失效，避免后续导出继续沿用旧参考图。
- `agentTools.selftest.ts` 覆盖了发布项目资产到资产中心，以及从模拟资产中心同步项目资产时保留本地变体作用域。

第十五轮提交补齐 P5 的资产中心同步处置入口：

- Studio 连续性详情抽屉为 `library_entity_version_outdated` 增加“同步资产中心新版”动作，直接调用 `syncAssetFromLibraryEntity` 应用新版身份快照。
- Studio 连续性详情抽屉为 `library_entity_missing` 增加“重新发布为身份资产”动作，调用 `promoteAssetToElement` 从当前项目快照重新发布身份资产，并刷新资产中心快照。
- 这些动作让用户在连续性质量门里处理“全局有新版本”和“链接身份已丢失”，不需要切回资产页手动寻找对应资产。

第十六轮提交补齐 P5 的合并前差异预览：

- Studio 连续性详情抽屉为 `duplicate_library_entity_project_assets` 和 `cross_episode_duplicate_project_asset_candidate` 增加“合并预览”，在执行“合并到同身份项目资产”前展示源资产和候选目标资产。
- 预览会显示命中的名称/别名、资产类型、别名数量、形态数量、有作用域形态数量、参考图数量、分镜引用、形态绑定、剧集计划引用、出现剧集以及身份链接版本。
- 多个候选目标会按目标序号并列展示，用户可以先比较哪一个项目资产承载了更多已绑定分镜、变体和剧集计划，再决定合并方向。

第十七轮提交开始落地 P6 的 UI 读取收敛：

- Studio 工作台左侧 Dock 和画布 Workbench Dock 的“身份资产/媒体文件”列表改为从 `assetHubStore.entities` / `assetHubStore.mediaAssets` 读取，不再直接订阅 `useAssetStore.elements`。
- Dock 中的身份资产仍沿用原有 `DND_ELEMENT` 拖拽协议，但拖入项目资产页和画布时会优先从 `assetHubStore.entities` 解析，再通过 `libraryEntityToElement` 转为兼容写入结构，旧 `assetStore.elements` 仅作为回退。
- 媒体文件拖入项目资产页和画布时同样优先读取 `assetHubStore.mediaAssets`，旧媒体注册表 store 作为兼容回退；这让两个主要入口开始使用资产中心快照，同时保持旧数据可拖拽。

第十八轮提交继续落地 P6 的项目资产卡读取收敛：

- Studio 项目资产卡不再用 `useAssetStore.elements` 判断“身份资产”链接状态，改为读取 `assetHubStore.entities`，并优先使用 `libraryLink.entityId`，再兼容旧 `elementId`。
- 项目资产卡的身份链接标签会展示资产中心实体名称和项目快照版本；如果资产中心尚未加载，会按需刷新快照。
- “发布/更新到资产中心身份资产”完成后会刷新 `assetHubStore`，避免项目资产卡和其他资产中心入口继续显示旧身份快照。

第十九轮提交继续落地 P3/P6 的画布回写读取收敛：

- 画布检查器中“保存到身份资产”的目标匹配不再直接订阅 `useAssetStore.elements`，改为使用 `assetHubStore.entities` 的身份资产快照。
- 目标解析会基于 `libraryEntityId`、旧 `charId`、名称/别名和身份类型匹配唯一 `LibraryEntity`，并读取 `LibraryVariant` 标签显示将要保存到的变体/视图。
- 实际写入仍通过兼容的 `promoteCanvasOutputs` 更新旧 `elements:library` 存储；写入前确保旧 store 已加载，写入成功后刷新 `assetHubStore`，让资产中心视图和后续画布回写看到新版本。

第二十轮提交继续落地 P6 的资产中心页面读取收敛：

- 资产中心“身份资产”页的列表不再订阅 `useAssetStore.elements`，改为从 `assetHubStore.entities` 派生兼容编辑视图，展示与使用图谱都以资产中心快照为准。
- 身份资产编辑器的参考图候选不再回退读取旧媒体 store，而是使用 `assetHubStore.mediaAssets`；页面加载时统一刷新资产中心快照。
- 新建、编辑、删除身份资产仍通过兼容的旧 `elements:library` 写入 API 执行，但写入前会确保旧 store 已加载，写入后刷新 `assetHubStore`，避免把未加载的旧列表误当成空库覆盖。

第二十一轮提交继续落地 P6 的拖拽落点读取收敛：

- Studio 项目资产页接收“身份资产/媒体文件”拖入时不再直接读取 `assetStore.elements` / `assetStore.assets` 作为 fallback，而是先确保 `assetHubStore` 已加载，再从 `entities` / `mediaAssets` 解析拖拽 id。
- FlowCanvas 接收“身份资产/媒体文件”拖入时同样只从 `assetHubStore` 解析，并通过 `libraryEntityToElement` 转为当前画布节点写入所需的兼容结构。
- 旧 `elements:library` 仍作为持久化兼容层存在，但 UI 拖拽入口不再把旧 store 当作并列数据源，减少“同一资产从两个列表读取”的状态漂移。

第二十二轮提交继续落地 P6 的发布路径读取收敛：

- `projectStore.promoteAssetToElement` 发布或更新身份资产时，不再从 `useAssetStore.getState().elements` 查找已有全局元素，而是先读取 `assetHubStore.entities`，并优先以 `libraryLink.entityId` 作为身份链接基准，再兼容旧 `elementId`。
- 旧 `assetStore.saveElement` 仍作为 `elements:library` 持久化兼容写入层保留，但写入前会确保旧 store 已加载，避免未加载空列表把已有身份误判为新建。
- 发布完成后由 store 动作刷新 `assetHubStore`，让项目资产卡、连续性处置入口、资产中心页面和画布回写入口看到同一份身份资产快照。

第二十三轮提交继续落地 P6 的旧检查器写入保护：

- 画布旧 `Inspector` 中“保存到资产中心”的兼容入口不再直接调用 `saveElement` 写入旧 `elements:library`，而是先确保旧资产 store 已加载，避免把未加载状态下的空列表持久化回去。
- 保存身份资产后立即刷新 `assetHubStore`，让 Dock、资产中心页、画布回写目标和工作流项目资产卡看到最新身份资产快照。
- 这个入口仍保留为画布资产节点的快捷发布能力，但写入语义与资产中心页面、项目资产发布路径保持一致：旧 store 只做兼容持久化，Hub 快照负责后续读取。

第二十四轮提交继续落地 P6 的兼容写入 id 稳定性：

- `assetStore.saveElement` 在新建身份资产时，如果调用方已经传入稳定 `id`，会保留该 id；只有完全没有 id 的 UI 新建场景才生成新的 `el_...`。
- 这让项目资产发布、缺失身份重建、资产中心兼容编辑等路径可以保持 `libraryLink.entityId` / `elementId` 的稳定性，减少多集项目快照与全局身份资产之间的无谓断链。
- 旧 `elements:library` 仍只是兼容持久化层，但它不再在“恢复已有身份 id”时主动改写身份主键。

第二十五轮提交继续落地 P1/P6 的媒体文件页读取收敛：

- 资产中心“媒体文件”页的列表和合集读取改为使用 `assetHubStore.mediaAssets` / `assetHubStore.boards`，不再直接把 `useAssetStore.assets` / `useAssetStore.boards` 当作渲染数据源。
- 上传、删除、移动合集、创建/重命名/删除合集、GC 清理仍沿用旧 `assetStore` 的兼容写 API，但每次写入后刷新 `assetHubStore`，让媒体文件页、Dock 和画布拖拽入口看到同一份快照。
- 首次进入媒体文件页时会先确保旧 store 完成 backfill，再刷新 Hub，避免 Hub 在旧注册表尚未回填时展示不完整媒体索引。

第二十六轮提交继续落地 P1/P6 的存储清理刷新：

- 设置页“存储”里的 GC 清理仍使用旧 `assetStore.runGc` 和存储占用统计，但清理完成后会刷新 `assetHubStore`。
- 这样用户从设置页清理孤儿附件后，资产中心媒体文件页、Dock、画布拖拽入口不会继续显示清理前的旧媒体快照。
- 存储页仍只承担容量和清理职责，不把媒体文件管理逻辑重新引入设置页。

第二十七轮提交继续落地 P5 的剧集计划质量门处置：

- 连续性详情抽屉为 `episode_plan_missing_asset` 增加“加入计划资产到分镜”动作，可选择目标剧集中的分镜并把计划要求的项目资产写入 `castRefs`。
- 连续性详情抽屉为 `episode_plan_missing_variant` 增加“绑定计划形态到分镜”动作，可选择目标分镜并绑定计划要求的资产变体；如果该变体已有剧集/场景/分镜作用域，会同步扩展作用域，避免绑定后仍不适用于本集。
- 这让“系列页规划了本集必需角色/场景/道具/妆容，但分镜没有使用”的质量门从只读提示变成可直接修复的生产入口。

第二十八轮提交继续落地 P5 的无效剧集计划清理：

- 连续性详情抽屉为 `episode_plan_invalid_asset` 和 `episode_plan_invalid_variant` 增加“从剧集计划移除”动作。
- 当系列页里某集计划仍引用已删除的项目资产或形态时，用户可以直接在质量门里清掉无效 id，不需要回到系列页逐项查找。
- 这个动作只修改目标剧集的 `Episode.plan.requiredAssetIds` / `requiredVariantIds`，不会改分镜、资产或身份资产。

第二十九轮提交继续落地 P4/P5 的计划集数质量门：

- 连续性报告新增 `series_planned_episodes_missing`，当系列圣经的 `plannedEpisodeCount` 大于当前已创建剧集数量时提示缺口。
- 连续性详情抽屉为该问题增加“补齐计划剧集”动作，直接调用现有 `createEpisodes` 补足缺失剧集。
- `continuityReport.selftest.ts` 覆盖了计划集数缺口会报警、剧集已补齐时不报警，避免整季蓝图只停留在系列页提示层。

第三十轮提交继续落地 P1/P6 的媒体文件使用图谱：

- `assetHub` 快照新增 `usageByMedia`，按媒体 `assetId/localPath/url` 扫描工作流项目资产、资产候选图、项目变体、关键帧、视频/音频产物、精修流、身份资产媒体引用、画布节点和快照输出。
- `assetHubStore` 暴露媒体 usage，资产中心“媒体文件”卡片会显示“项目资产/分镜/身份资产/画布节点/快照”的引用概况，悬停可查看具体来源。
- 这补上了“媒体文件不是身份资产，但用户仍要知道它被哪里引用”的只读使用图谱，为后续安全删除、GC 判断和资产合并提供更强证据。

第三十一轮提交继续落地 P1/P6 的媒体安全删除入口：

- 资产中心“媒体文件”上传素材的删除按钮开始读取 `usageByMedia`，只允许未被项目资产、分镜/片段、身份资产、画布节点或快照引用的上传媒体被直接删除。
- 被引用的上传媒体会在卡片动作区禁用删除按钮，并给出“先解除引用后再删除”的标题；删除函数内部也会再次检查引用图谱，避免通过旧事件或状态延迟误删仍在使用的媒体。
- 这样媒体使用图谱不再只是展示信息，而是开始成为资产中心删除边界的一部分，降低用户清理素材时破坏多集资产一致性的风险。

第三十二轮提交继续落地 P1/P4/P6 的 GC 与多集媒体回填保护：

- `assetRegistry` 的工作流媒体回填开始扫描 `episodes[]` 里的非当前集关键帧、视频片段、片段 poster 和轨道音频，媒体文件页不再只登记当前扁平镜像的工作流产物。
- GC 引用扫描补齐身份资产的 `views`、旧版 `variants.assetId`、`appearanceVariants` 和 `voiceId`，避免资产中心中的多角度图、妆容/服装形态图或音色引用被当成孤儿附件删除。
- GC 同时保护工作流 `episodes[]` 的非当前集关键帧、片段 poster 和轨道音频，避免多集短剧切到下一集后，前后集仍在使用的媒体被“清理未引用”误删。

第三十三轮提交继续落地 P1/P6 的媒体引用图谱扫描口径补齐：

- `loadMediaAssetUsages` 开始把视频片段 poster、视频轨道音频和精修流输入 `references[]` 计入媒体引用图谱。
- 这些引用会出现在媒体文件卡片的“已被分镜/片段引用”摘要和悬停来源里，避免 GC 已保护但资产中心仍显示“未被引用”的认知不一致。
- 这让媒体文件页、安全删除入口、GC 清理保护三者在多集工作流下使用更接近同一套引用证据。

第三十四轮提交继续落地 P1/P6 的媒体引用详情入口：

- 资产中心“媒体文件”卡片的引用摘要从静态文本改成可点击状态控件；被引用媒体可打开“媒体引用详情”弹窗，未引用媒体保持只读状态。
- 详情弹窗按工作流项目、身份资产、画布项目、快照分组列出具体来源和引用名称，让用户在删除按钮被禁用时能定位应先解除的引用。
- 本轮仍保持只读使用图谱，不跨项目自动解除引用；这样先完善可解释性和安全删除判断，再为后续跳转来源、解除引用、批量清理打基础。

第三十五轮提交继续落地 P1/P6 的身份资产删除保护：

- 资产中心“身份资产”卡片的引用摘要也改成可点击状态控件，可打开引用详情弹窗查看工作流项目、画布项目和快照来源。
- 删除身份资产前会读取 `usageByEntity`；仍被项目资产、画布节点或快照引用时禁用删除按钮，并在删除函数内部再次拦截，避免破坏多集项目里的资产中心链接。
- 媒体文件和身份资产两类共享资源现在都先进入“引用可解释、被引用不可直接删除”的安全边界，为后续解除引用和同步/合并操作提供一致交互基础。

第三十六轮提交继续落地 P1/P5/P6 的身份资产归档入口：

- 资产中心“身份资产”卡片新增“归档 / 恢复”动作，直接写入现有 `ElementRef.archived` 兼容字段，不新增持久化结构。
- 归档身份会在卡片上显示“已归档”状态，并继续保留引用详情和删除保护；已有项目快照不被删除，但后续候选匹配、导入和连续性检查会按已归档身份处理。
- 这补上了“不能直接删除被引用共享身份时，用户仍需要停止继续复用该身份”的管理路径，比硬删除更适合多集短剧的长期资产库维护。

第三十七轮提交继续落地 P1/P6 的身份资产归档筛选：

- 资产中心“身份资产”工具栏新增“可用 / 已归档 / 全部”分段筛选，并显示各状态数量。
- 默认只展示可用身份资产，归档身份仍可通过筛选查看、恢复、查看引用详情或在未被引用时删除。
- 这让归档真正承担“从日常复用资产池移出”的产品语义，而不是只在卡片上打标。

第三十八轮提交继续落地 P1/P5/P6 的归档身份复用入口收敛：

- 工作流左侧资源 Dock 和画布资源 Dock 在展示身份资产时过滤 `archived` 身份。
- 归档身份仍保留在资产中心“已归档 / 全部”筛选中，可查看引用详情或恢复，但不会继续作为拖拽导入或插入名称的日常复用入口。
- 这让“归档”语义从资产中心页面延伸到实际生产入口，避免用户把废弃身份继续拖入多集项目。

第三十九轮提交继续落地 P3/P6 的归档身份回写候选收敛：

- 画布输出“保存到身份资产”的目标解析开始排除 `archived` 身份。
- 即使输出元数据里仍带着已归档身份的 `libraryEntityId/charId/name`，检查器也不会继续把它作为可写回目标，避免画布实验结果污染已废弃身份。
- 如需继续使用该身份，用户需要先在资产中心的“已归档”筛选中恢复它，再执行拖拽导入或画布回写。

第四十轮提交继续落地 P1/P5/P6 的归档身份导入防御：

- 工作流资产页的拖拽落点在读取 `assetHubStore.entities` 后会再次检查 `archived`，即使旧拖拽数据仍带着身份 id，也不会把归档身份导入为项目资产快照。
- 画布拖拽落点同样阻止归档身份生成角色/场景/物品节点，避免实验画布继续引用已废弃身份。
- `projectStore.importElementToProject` 增加兜底校验，直接调用导入 API 时也会返回空 id 并提示需要先恢复身份，保证归档语义不只依赖 UI 列表过滤。

第四十一轮提交继续落地 P3/P6 的归档身份写回防御：

- 项目资产卡如果仍链接到已归档身份，会在身份链接状态中显示“已归档”，并禁用“发布/更新到资产中心”动作。
- `projectStore.promoteAssetToElement` 在复用 `libraryLink.entityId/elementId` 前会读取资产中心快照；目标身份已归档时直接返回失败，不再更新已废弃身份。
- Agent 工具 `publish_project_asset_to_library` 改为读取发布动作的布尔结果，被 store 拦截时返回 `published: false` 和错误信息，避免自动流程误判为已写回。

第四十二轮提交继续落地 P5/P6 的归档身份同步防御：

- 连续性报告遇到已归档的链接身份时只保留 `library_entity_archived` 问题，不再继续追加 `library_entity_version_outdated`，避免给用户展示“同步新版”的误导性修复动作。
- Studio 连续性详情里的“同步资产中心新版”入口再次检查目标身份未归档，防止旧报告或异步快照变化后仍触发同步。
- `projectStore.syncAssetFromLibraryEntity` 增加 store 层兜底，直接调用同步 API 时如果目标身份已归档会返回失败并提示先恢复身份。

第四十三轮提交继续落地 P5/P6 的归档身份链接防御：

- `projectStore.linkAssetToLibraryEntity` 的入参补充 `name/archived`，直接调用链接 API 时如果目标身份已归档会返回失败并提示需要先恢复身份。
- Studio 连续性候选关联入口和 Agent 工具 `link_project_asset_to_library_entity` 会把身份名称与归档状态传入 store，避免兜底层只能看到裸 id。
- 这把“导入、链接、同步、发布/更新”四条项目资产与资产中心身份之间的主要写入通道都收敛到同一条归档语义：归档身份只可查看和恢复，不能继续作为新的生产绑定目标。

第四十四轮提交继续落地 P3 的画布回写目标显式化：

- 画布输出面板在已有“保存到项目”下拉之外，新增“保存到身份资产”下拉，用户需要明确选择身份资产或身份变体后才能点击图片上的“存身份”动作。
- 身份资产目标列表来自 `assetHubStore.entities`，过滤已归档身份和音色身份；如果输出元数据带有唯一身份/变体提示，会把该目标预选出来并在下拉中可见。
- 画布保存仍按单张输出的 `meta.view` 写入主图、正面、侧面、背面、概念图或参考图，但目标身份不再只靠点击时自动推断，降低实验产物误写回正式身份资产的风险。

第四十五轮提交继续落地 P3/P6 的画布身份写回兜底：

- `assetStore.promoteCanvasOutputs` 在实际写入旧 `elements:library` 前检查目标身份是否 `archived`，即使调用方绕过输出面板选择器或持有旧目标 id，也不会继续写入归档身份。
- 被拦截时返回 `0` 并提示需要先恢复身份，和输出面板“没有可保存的画布输出/未写入”的已有反馈路径兼容。

第四十六轮提交继续落地 P3 的画布项目采纳 lineage：

- 画布图片输出保存到项目资产或项目变体成功后，会在原输出 `meta` 中写入 `projectAssetId/projectVariantId` 并把 `purpose` 从候选产物标记为 `approved`。
- 扇出图片按原始 `items[]` 下标更新对应项；第一张被采纳时同步更新端口顶层 `meta`，让画布输出、媒体使用图谱和后续“保存到”目标解析能看到同一条项目采纳证据。
- 这让“仅入媒体文件层”到“明确采纳为项目生产资产”的边界可追溯：默认生成仍是媒体候选，点击“存项目”后才成为项目资产输入。

第四十七轮提交继续落地 P3/P6 的画布项目采纳使用图谱：

- 画布图片输出保存到项目资产或项目变体成功后，`markOutputAsProjectAsset` 现在会同步写入 `projectId`，不再只记录 `projectAssetId/projectVariantId`，避免资产中心只能看到画布节点而无法定位工作流项目。
- `assetHub.loadMediaAssetUsages` 在扫描画布端口时会读取 `projectId/projectAssetId/projectVariantId/purpose` 这组显式采纳血缘；当目标项目与资产仍存在时，同一张媒体会额外出现在媒体详情的“工作流项目”用量里。
- 采纳血缘只接受 `approved` 或旧数据里未标明 `purpose` 的项目目标；`candidate/experiment` 仍只作为画布媒体引用显示，避免候选实验图被误认为正式生产资产。
- 项目资产用量继续复用原有去重逻辑：如果项目文档本身已经把该媒体设为主图或变体图，不会重复增加项目资产计数；如果项目保存尚未 flush，画布 lineage 也能补上可读的项目资产来源。

第四十八轮提交继续落地 P1/P6 的身份资产使用图谱口径收敛：

- `assetHub.loadIdentityAssetUsages` 扫描工作流项目资产时，开始优先读取 `Asset.libraryLink.entityId`，旧 `Asset.elementId` 仅作为兼容回退。
- 这让资产中心身份资产卡的“被哪些工作流项目引用”不再依赖旧 Element 桥接字段；后续项目快照逐步收敛到 `libraryLink` 后，引用详情和删除/归档保护仍能看到正确来源。
- 新增 `projectAssetIdentityEntityId` 纯解析函数和自测，覆盖新字段优先、旧字段回退、空白 id 忽略，避免使用图谱再次退回只识别 `elementId` 的旧口径。

第四十九轮提交继续落地 P3/P6 的画布身份 lineage 使用图谱：

- `assetHub` 扫描画布项目和快照节点时，开始优先读取输出端口 `meta.libraryEntityId`，不再只靠旧 `charId` 或 `name/kind` 做身份匹配。
- 旧画布数据仍保留 `charId` 与名称匹配回退；新画布输出里的稳定身份 id 会直接进入 `usageByEntity`，让身份资产引用详情、删除保护和归档可解释性更接近真实 lineage。
- 新增 `canvasPortIdentityEntityId` 纯解析函数和自测，覆盖显式身份 id、旧 `charId` 回退和未知显式 id 保留，避免后续画布使用图谱再次退回名称猜测。

第五十轮提交继续落地 P2/P6 的项目资产身份链接状态可见性：

- Studio 项目资产卡的身份资产链接行开始显示 `libraryLink.syncPolicy` 派生状态：快照、已关联、已分叉，旧 `elementId` 兼容链接会显示“旧链接”。
- 当资产中心身份版本高于项目快照版本时，卡片会同时显示“有新版”；目标身份已归档时仍显示“已归档”，帮助用户区分“可同步的新版本”和“已明确分叉/不可继续复用”的生产状态。
- 本轮只补齐状态展示，不改变项目生产仍读取本地 `Asset/AssetVariant` 快照的规则，也不自动同步资产中心更新。

第五十一轮提交继续落地 P2/P5/P6 的已分叉身份链接边界：

- `projectAssetIdentityEntityId` 现在会跳过 `libraryLink.syncPolicy === 'forked'` 的项目资产，不再把已明确分叉的项目快照计入身份资产使用图谱，也不会通过旧 `elementId` 回退重新判成活动绑定。
- 连续性报告的 `linkedLibraryEntityId` 同步跳过已分叉链接，避免用户已经标记“不同身份”后继续触发身份缺失、归档、版本过期和同一身份重复导入提示。
- 已分叉资产仍可通过 UI 看到历史链接状态；如果同时记录了 `rejectedLibraryEntityIds`，候选身份匹配也会继续被压制，避免质量门反复建议用户刚刚拒绝的身份。

第五十二轮提交继续落地 P2/P5/P6 的已分叉发布目标：

- `projectStore.promoteAssetToElement` 发布项目资产时改用活动身份解析，不再直接复用 `libraryLink.entityId ?? elementId`；已分叉资产发布会另存为新的身份资产，避免覆盖用户已经拒绝的旧身份。
- `markAssetAsDistinctIdentity` 会把旧 `elementId` 兼容链接也显式标成 `syncPolicy: 'forked'`，让旧项目数据在被用户标记“不是同一身份”后进入同一套分叉语义。
- Studio 项目资产卡的发布按钮在已分叉状态下提示“另存为新身份资产”，且不会因为旧身份已归档而禁用；Agent 工具描述同步说明已分叉发布会另存新身份。
- `agentTools.selftest.ts` 增加旧 `elementId` 分叉和分叉后发布另存新身份的覆盖，确保自动流程不会把 forked 项目快照写回旧身份资产。

第五十三轮提交继续落地 P5/P6 的已分叉同步目标：

- Agent 工具 `sync_project_asset_from_library` 未显式指定目标身份时，改用 `projectAssetIdentityEntityId` 解析活动身份链接；已分叉项目资产不会再通过旧 `libraryLink.entityId` 或 `elementId` 被隐式同步回旧身份。
- 工具描述补充“已分叉资产必须显式指定新的身份目标”，让自动流程在恢复/同步项目资产时先确认目标身份，而不是反向撤销用户刚刚做出的分叉判断。
- `agentTools.selftest.ts` 增加“资产中心存在旧身份快照，但 forked 项目资产未指定目标时仍拒绝同步”的覆盖，避免后续 Agent 默认参数再次绕过 forked 边界。

第五十四轮提交继续落地 P5/P6 的同步接受态收敛：

- `projectStore.syncAssetFromLibraryEntity` 同步成功后会从 `rejectedLibraryEntityIds` 中移除被同步接受的身份 id，让“已同步/已关联”和“已拒绝同一身份”不再同时存在。
- Agent 工具测试替身同步这条 store 语义，并新增“显式同步 forked 资产到目标身份后清理该 rejected id”的覆盖，支持用户或 Agent 明确撤销之前的不同身份判断。
- 这让“标记不同身份 -> forked -> 显式重新同步/恢复身份”的闭环保持一致：隐式流程尊重 forked，显式接受则清理冲突状态。

第五十五轮提交继续落地 P5 的剧集计划资产矩阵完整性：

- 连续性报告新增 `episode_plan_variant_asset_missing`：当 `Episode.plan.requiredVariantIds` 要求某个形态/妆容，但该形态所属项目资产没有出现在同一集 `requiredAssetIds` 时提示，避免系列资产矩阵只看到变体却缺少父资产。
- Studio 连续性详情为该问题提供“补入本集计划资产”动作，直接把父项目资产追加到对应剧集计划，不需要用户回系列页手动查 id。
- Agent 工具 `upsert_episode_plan` 写入 `requiredVariants` 时会自动把这些变体所属资产并入 `requiredAssetIds`；`remove` 模式不自动删除父资产，避免误删仍被其他规划项依赖的资产。
- 新增连续性报告和 Agent 工具自测，覆盖“已规划父资产不误报”“只规划变体会提示”“Agent 只写变体也会补父资产”三条路径。

第五十六轮提交继续落地 P5 的剧集计划变体作用域前置质量门：

- 连续性报告新增 `episode_plan_variant_scope_mismatch`：当 `Episode.plan.requiredVariantIds` 指向的形态/妆容已经通过 `appliesToEpisodeIds` 限定到其他剧集时，即使本集还没有分镜也会提示，避免多集计划阶段就埋下错用妆容或服装的风险。
- Studio 连续性详情复用变体作用域修复动作，为该问题提供“标记计划形态适用于本集”入口，把当前剧集补入该变体的 `appliesToEpisodeIds`。
- Agent 工具 `set_asset_variant_scope` 的说明补充该问题码，人工修复和 Agent 修复都走同一条增量作用域更新路径，不会覆盖已有 scene/storyboard 作用域。

第五十七轮提交继续落地 P5 的剧集计划生产前拦截：

- `episodeProductionContinuityBlockers` 将剧集计划类问题纳入生产 blocker，包括 `episode_plan_invalid_asset`、`episode_plan_missing_asset`、`episode_plan_invalid_variant`、`episode_plan_variant_asset_missing`、`episode_plan_variant_scope_mismatch` 和 `episode_plan_missing_variant`。
- 全剧生成开启 `enforceContinuity` 时，不再只拦截分镜实际使用中的资产/形态问题，也会拦截“计划要求但没有落到本集分镜”或“计划形态不适用于本集”的问题，避免系列资产矩阵报警后仍继续出片。
- `episodeProduction.selftest.ts` 增加计划资产缺失和计划变体作用域不符的生产 blocker 覆盖，确保连续性报告、生产前错误文案和全剧队列拦截口径一致。

第五十八轮提交继续落地 P4/P5 的剧集计划交接包：

- `EpisodeProductionHandoff` 新增 `plannedAssets` 和 `plannedVariants`，从 `Episode.plan.requiredAssetIds/requiredVariantIds` 解析本集必须覆盖的项目资产和形态/妆容，作为下一集制片/分镜 Agent 的结构化输入。
- 计划形态会携带 `scopeAppliesToEpisode` 和已有 `appliesToEpisodeIds`，让 Agent 在生成分镜前就能知道该妆容是否已经适用于当前剧集，而不是等到分镜绑定后才发现作用域问题。
- `get_episode_handoff` 自动透出这些字段；服务自测和 Agent 工具自测都覆盖计划资产/计划形态进入交接包，保证“系列计划 -> 单集生成上下文 -> 连续性质量门”闭环一致。

第五十九轮提交继续落地 P4/P5 的计划级 handoff 修复建议：

- `buildEpisodeProductionHandoff` 会直接从 `plannedAssets/plannedVariants` 生成可执行建议：计划资产缺主参考图时建议生成主图，计划形态缺参考图时建议生成形态图，计划形态未适用于本集时建议补 `appliesToEpisodeIds`。
- 这些建议不再依赖本集已经存在分镜；用户或 Agent 在“先规划、后分镜”的阶段也能提前补齐本集生产输入，避免到了关键帧/视频生成前才发现缺图或作用域不符。
- `episodeProduction.selftest.ts` 增加“无分镜但有剧集计划”的覆盖，确保计划本身能驱动补图和补作用域建议。

第六十轮提交继续落地 P4/P5 的 handoff 计划输入可见性：

- Studio 剧集切换栏的跨集承接弹层开始把 `plannedAssets/plannedVariants` 作为显性线索展示，并计入触发态、标题摘要和空状态判断，避免“Agent 能看到计划输入，但用户在 UI 看不到”的断层。
- “本集计划输入”区块会列出计划项目资产、计划形态/妆容、主参考图/形态图是否缺失，以及形态是否已标记适用于当前集；已有作用域会以剧集标签展示，方便用户理解修复建议来自哪条计划约束。
- 本轮只改 UI 可解释性，不改变 `buildEpisodeProductionHandoff` 的生成口径，也不改变生产阻断规则；计划级修复建议仍由上一轮的 handoff 服务统一产出。

第六十一轮提交继续落地 P4/P5 的 Agent planned handoff 约束：

- 新增共享 Agent 策略常量，明确 `get_episode_handoff.plannedAssets/plannedVariants` 是当前集 `Episode.plan` 的权威生产输入；新增或续写分镜时，计划资产必须进入 `castRefs/associateAssetIds`，计划形态必须进入对应资产的 `castRefs.variantId/variantLabel`。
- 工具循环 system、分阶段分镜子 Agent、子 Agent 工具上下文、运行时本地工具协议和 `get_episode_handoff` 工具描述都复用同一条规则；缺主图、缺形态图或形态未适用本集时，Agent 应先执行 handoff 建议或对应补图/补作用域工具，再生成关键帧/视频。
- 新增 `agentPolicy.selftest.ts` 并接入 `npm run test:continuity`，回归检查工具描述、工具循环 system 和本地工具协议都包含 `plannedAssets/plannedVariants` 以及必须落到分镜绑定的约束，避免后续提示词改动重新削弱计划输入边界。

第六十二轮提交继续落地 P4/P5 的 handoff 建议执行闭环：

- Agent 写入工具新增 `apply_episode_handoff_suggestion`，可按 `suggestionId/suggestionIds` 执行 `get_episode_handoff.suggestions`，也可用 `allAuto=true` 循环处理当前集所有未禁用的自动建议。
- 该工具复用 handoff suggestion id 作为稳定入口，支持计划资产生成主参考图、计划形态生成参考图、补 `plannedVariants` 的 episode 作用域，以及创建本集专属形态并绑定当前已有分镜；执行后会返回新的 `remainingSuggestions`，供 Agent 继续判断是否还缺生产输入。
- `PLANNED_HANDOFF_STORYBOARD_RULE` 改为优先引导 Agent 使用 `apply_episode_handoff_suggestion`，并在 `agentTools.selftest.ts` 中覆盖“E3 只规划 Cloak 形态 -> 自动补父资产主图、补形态作用域、生成形态图”的闭环。

第六十三轮提交继续落地 P4/P5 的 handoff 执行口径收敛：

- 新增 `episodeHandoffSuggestions` 服务，把 `generate_asset_ref_image`、`generate_variant_ref_image`、`add_variant_episode_scope`、`create_episode_variant` 四类建议的执行逻辑从 Agent 工具和 Studio 弹层中抽为同一份实现。
- Agent 的 `apply_episode_handoff_suggestion` 保留“执行后重读最新 handoff”的循环策略，但单条建议执行改为调用共享服务；Studio 跨集承接弹层的单条修复和“全部执行”也改用同一服务，批量执行会在每一步后重新读取最新项目文档和最新建议，避免旧弹层状态导致重复或漏修。
- 新增 `episodeHandoffSuggestions.selftest.ts` 并接入 `npm run test:continuity`，直接覆盖主图生成、形态图生成、episode 作用域补齐、本集专属形态创建并绑定当前分镜，保证 UI 和 Agent 共享的执行器后续改动有独立回归。

第六十四轮提交继续落地 P4/P5 的生产拦截可修复性：

- `formatEpisodeProductionContinuityError` 支持接收当前集 handoff suggestions，并在连续性 blocker 文案后追加可自动处理的 handoff 建议摘要和稳定 suggestion id，让全剧生成被暂停时不只说明“哪里错了”，也告诉用户或 Agent 下一步可先执行哪些修复。
- `produceCurrentEpisode` 在 `enforceContinuity` 模式下构建当前集 `buildEpisodeProductionHandoff(...).suggestions` 后再格式化错误；因此 `autoProduceSeries` 写入 `Episode.filmError` 的生产失败信息也会携带可执行修复入口。
- `episodeProduction.selftest.ts` 覆盖跨集主形象回退和剧集计划形态作用域不匹配两类 blocker，确认生产拦截错误中包含 `handoff` 提示和对应 suggestion id，为 UI 弹层和 Agent 工具的修复闭环提供更直接的失败上下文。

第六十五轮提交继续落地 P4/P5 的 Agent 剧集概览可操作性：

- `episodeView` 新增轻量 `handoff` 摘要，`get_workspace/get_project_overview/get_episodes` 会随每集返回计划输入数量、跨集复用数量、建议数量、可自动处理建议数量，以及前几条稳定 suggestion 引用。
- 这样 Agent 在普通项目概览阶段就能判断某集是否有待处理 handoff 建议，并能直接拿到 suggestion id 去调用 `apply_episode_handoff_suggestion`；只有需要完整回顾、共享资产出现记录和细节时，才继续读取 `get_episode_handoff`。
- `agentTools.selftest.ts` 增加 `get_workspace exposes episode handoff summary`，确认剧集计划缺主图时概览能暴露 `asset-image:<assetId>` 这类可执行入口。

第六十六轮提交继续落地 P3/P6 的画布身份采纳 lineage：

- 画布图片输出保存到身份资产或身份变体成功后，会在原输出 `meta` 中写入 `libraryEntityId/libraryVariantId/view`，并把 `purpose` 从候选产物标记为 `approved`；扇出图片按原始 `items[]` 下标更新，第一张被采纳时同步更新端口顶层 `meta`。
- `assetHub` 身份使用图谱读取画布输出时，和项目采纳 lineage 使用同一条边界：只接受 `approved` 或旧数据未标 `purpose` 的身份目标，`candidate/experiment` 不再被当成正式身份引用，仍只作为媒体层画布引用保留。
- `assetHub.selftest.ts` 增加身份 lineage 的 approved/legacy/candidate 覆盖，确保后续画布实验图不会重新污染身份资产删除保护和引用详情。

第六十七轮提交继续落地 P3/P6 的画布采纳后刷新一致性：

- `markOutputAsProjectAsset` 和 `markOutputAsLibraryEntity` 改为可等待的保存动作，调用方会在画布 lineage 写入并落盘后再刷新 `assetHubStore`，避免资产中心使用图谱立刻刷新时读到旧画布工程。
- “存身份”成功后仍先更新身份资产兼容存储，再等待画布输出 `approved` lineage 保存，最后刷新 Hub；“存项目”成功后也会刷新 Hub，让媒体详情能立即看到项目资产来源和画布采纳证据。
- 这个调整不改变用户操作入口，只收紧保存顺序，保证显式回写目标、媒体使用图谱和身份引用详情在一次点击后可读一致。

第六十八轮提交继续落地 P3/P6 的项目采纳身份 lineage 继承：

- 画布图片输出保存到已关联资产中心身份的项目资产或项目变体时，项目采纳 lineage 会同步写入目标的 `libraryEntityId/libraryVariantId`，让同一次显式采纳同时具备“项目生产资产”和“身份资产来源”两条稳定线索。
- 保存到项目主图且目标有明确身份链接时，会清空输出里旧的身份变体 id/label；保存到项目变体时则写入目标变体对应的 `libraryVariantId`，避免上一次实验图携带的妆容状态误导后续“存身份”目标推断。
- 这样资产中心使用图谱、画布输出目标自动匹配和项目资产快照之间的关系更接近方案里的“共享身份，生产使用项目快照”边界。

第六十九轮提交继续落地 P1/P3 的快照媒体用量 lineage：

- `assetHub.loadMediaAssetUsages` 扫描画布命名快照时，不再只把端口媒体登记为“快照引用”；如果快照端口携带 `projectId/projectAssetId/projectVariantId` 且 `purpose` 为 `approved` 或旧数据未标记，也会复用实时画布同一套解析规则补充登记到对应工作流项目资产。
- 这样用户在媒体文件详情里查看历史画布快照保留的采纳产物时，仍能看到它曾被显式采纳到哪个项目资产/项目变体，减少“快照里有图，但不知道它是否已经进入正式生产资产”的断层。
- `candidate/experiment` 快照端口仍只显示为快照媒体引用，不会被提升为项目资产用量，保持 P3 的实验产物边界。

第七十轮提交继续落地 P1/P6 的存储统计读取收敛：

- `assetHub` 快照新增 `storageUsage`，统一读取附件数量和占用字节数；`assetHubStore` 暴露该只读统计，作为资产中心层的媒体文件统计来源。
- 设置页“存储”和资产中心“媒体文件”页不再为了展示附件占用直接订阅旧 `assetStore.usage`，而是从 `assetHubStore.storageUsage` 读取；上传、删除、合集移动和 GC 后已有的 Hub 刷新路径会同步更新统计。
- 旧 `assetStore` 仍保留上传、删除、GC 和元素兼容写入能力，但只读展示继续向 Hub 收敛，减少同一统计从两个 store 读取造成的状态漂移。

第七十一轮提交继续落地 P1/P6 的只读页面旧加载收敛：

- 设置页“存储”和资产中心“媒体文件”页不再为了只读展示触发旧 `assetStore.load()`；进入这些页面时只刷新 `assetHubStore`，由 Hub 快照提供媒体文件、合集、使用图谱和存储占用统计。
- 上传、删除、合集管理和 GC 清理仍通过旧 `assetStore` 的兼容写 API 执行，并在写入后刷新 Hub；身份资产编辑页、画布回写等需要操作旧 `elements:library` 的路径仍保留写入前加载保护。
- 这一步进一步把旧 store 限定为兼容写入层，而不是媒体/统计只读数据源，推进 P6 “UI 不再直接使用旧库读取”的目标。

第七十二轮提交继续落地 P1/P6 的 Hub 刷新一致性：

- `assetHubStore.refresh()` 改为复用同一个 in-flight Promise；当多个页面、Dock、写入路径或画布回写同时请求刷新时，后续调用会等待正在进行的刷新完成，而不是因为 `loading` 为 true 直接提前返回。
- 这让 `await refreshHub()` 的语义更可靠：上传/删除/发布/回写后的调用方只有在 Hub 快照真正完成更新后才继续执行，减少刚写入后立刻读取旧媒体、旧身份或旧使用图谱的窗口。
- 刷新失败仍保持原有容错行为：写入 `error`、恢复 `loading=false`，不向调用方抛出异常；下一次刷新可以重新发起。

第七十三轮提交继续落地 P1/P6 的 Hub 刷新竞争修复：

- `assetHubStore.refresh()` 在已有刷新运行时不再只是复用旧 Promise，而是标记一次 queued rerun；当前刷新结束后会立刻补跑一轮，再统一 resolve 所有等待中的调用方。
- 这修复了“旧刷新正在读取、随后发生上传/删除/发布/画布回写并 `await refreshHub()`”的竞争窗口，避免写入后的调用方只等到写入前快照完成就继续读取旧 Hub。
- 刷新失败仍不向 UI 调用方抛异常；如果失败期间有新刷新请求，会继续补跑，最终状态仍通过 `loading/loaded/error` 暴露给页面。

第七十四轮提交继续落地 P6 的身份资产页只读收敛：

- 资产中心“身份资产”页打开时不再主动触发旧 `assetStore.load()`；列表、筛选、引用图谱和参考图候选继续只从 `assetHubStore` 快照读取。
- 新建、编辑、删除、归档和恢复身份资产仍保留写入前加载旧 `elements:library` 的保护，旧 store 只在兼容写入路径发生时参与。
- 这进一步降低只读浏览资产中心时旧 `elements:library` 与 Hub 快照并行加载造成的状态漂移，推进 P6 “旧库只做兼容写入层”的目标。

第七十五轮提交继续落地 P1/P5 的媒体使用图谱剧集上下文：

- `assetHub.loadMediaAssetUsages` 扫描工作流项目媒体引用时，分镜关键帧、视频片段、轨道音频和项目资产变体会携带对应剧集标签，例如 `E3 雨夜 · 分镜 #2` 或 `女主 / 战损妆（E3 雨夜）`。
- 当前集兼容镜像会优先使用 `currentEpisodeId` 对应的剧集标题；非当前集的 storyboards/clips/tracks 则保留各自所在 episode 的上下文。
- 这让资产中心媒体文件引用详情更接近验收场景 4 的要求：用户不仅能看到某张图被哪个项目使用，也能看到它关联到哪一集、哪个分镜或哪个妆容/状态变体。

第七十六轮提交继续落地 P1/P5 的身份资产出场剧集图谱：

- `assetHub.loadIdentityAssetUsages` 扫描工作流项目身份引用时，会基于各集分镜的 `castRefs` 和兼容 `associateAssetIds` 统计项目资产在哪些剧集出场，并把 `E1 开局`、`E2 雨夜` 这类标签写入项目 usage。
- 资产中心“身份资产引用详情”的工作流项目行会显示“项目资产；出场：剧集列表”，让用户能从全局身份资产反查同一个人、场景或道具在全剧中的出现范围。
- 这补强了验收场景 1 的“全剧导出清单能列出女主在哪些集出现”，也为后续合并重复项目资产或处理同人多妆容提供更明确的人工核对信息。

第七十七轮提交继续落地 P1/P5 的身份资产形态出场摘要：

- 身份资产 usage 的项目引用新增 `appearanceLabels`，会从各集分镜的 `castRefs` 汇总 `E1 开局 · 主形象`、`E2 雨夜 · 战损妆` 这类按剧集绑定的形态/妆容摘要。
- 资产中心“身份资产引用详情”会在项目行显示“形态：剧集 · 形态列表”，让同一个人的主形象、换装、妆容或受伤状态能直接从身份资产反查。
- 这进一步支撑验收场景 2：用户能确认 E3 战损妆、E5 晚宴妆分别在哪些集/分镜链路中被实际绑定，而不是只看到该身份被某项目引用。

第七十八轮提交继续落地 P1/P5 的精修流媒体使用上下文：

- `assetHub.loadMediaAssetUsages` 扫描 `doc.imageFlows` 时，不再只显示 `精修流 flowId`；会先根据 `Asset.flowId` 反查项目资产，显示 `客厅 · 精修流 flow-asset` 这类资产上下文。
- 如果精修流来自分镜 `Storyboard.flowId`，媒体引用会显示对应剧集和分镜，例如 `E2 雨夜 · 分镜 #3 精修流 flow-storyboard 参考`，让精修输出和参考图都能回到单集生产链路。
- 无法反查到项目资产或分镜时仍保留原有 flowId fallback，避免破坏旧项目；这补齐了验收场景 4 中“精修流图片也能说明来自哪个项目生产环节”的使用图谱缺口。

第七十九轮提交继续落地 P1/P5 的 Agent 资产中心 usage 可见性：

- `get_workspace` / `get_project_overview` 的根资产概览新增 `assetCenterUsage` 摘要；`get_assets` 的完整资产视图也会在可用时返回同一字段，让工具循环不只看到 `libraryLink`，还能看到该身份在当前项目中的出场剧集和形态/妆容摘要。
- `assetCenterUsage` 通过 `loadAssetHub().usageByEntity` 读取，只暴露 `entityId`、项目/画布/快照计数以及当前项目的 `episodeLabels`、`appearanceLabels`；Hub 加载失败时保留原工具输出，避免只读工具被资产中心异常拖垮。
- 这让 Agent 在生成或续写多集时能先看到 `E1 Episode 1`、`E2 Second · Gala` 这类资产中心 usage 线索，减少只凭资产名误建重复角色或误用妆容的概率。

第八十轮提交继续落地 P4/P5 的系列规划资产 usage 可见性：

- `get_series_bible` 的 `availableAssets` 现在也会返回 `assetCenterUsage`，让整季规划工具在列出可用角色/场景/道具时同时看到资产中心身份链接、当前项目出场剧集和形态/妆容摘要。
- 这把上一轮的 usage 线索从“工作区概览/完整资产读取”扩展到“系列圣经与每集计划读取”，避免 Agent 在规划后续剧集时只看到 `id/name/type/aliases`，却看不到该角色已经在哪些剧集以何种形态出现。
- 自测通过模拟真实 `studio:index`、`studio:project:<id>` 和 `elements:library`，验证 `get_series_bible.availableAssets` 能暴露 `E2 Second` 与 `E2 Second · Gala`，继续支撑多集一致性和同人多妆容管理。

第八十一轮提交继续落地 P4/P5 的单集承接资产 usage 可见性：

- `get_episode_handoff` 的 `plannedAssets`、`plannedVariants` 和 `sharedAssets` 现在会附带 `assetCenterUsage`，让 Agent 在生成某一集前能直接看到计划资产、计划形态和承接资产对应的身份链接、出场剧集和形态/妆容摘要。
- 这把资产中心 usage 线索从整季规划继续下沉到单集生产承接包，减少 Agent 在处理“本集要不要沿用上一集妆容、是否要创建本集专属形态”时只依赖局部分镜或资产名称的风险。
- 自测验证 `get_episode_handoff` 返回的 planned/shared 资产都能暴露 `el-hero`、`E1 Episode 1` 和 `E2 Second · Gala`，继续补强多集资产一致性和同人多妆容管理闭环。

第八十二轮提交继续落地 P4/P5 的项目搜索资产 usage 可见性：

- `search_project` 在搜索资产域时会按需读取资产中心 usage，并在每条资产结果上附带 `assetCenterUsage`；搜索失败或 Hub 加载失败时仍保留原有资产搜索结果。
- 这让 Agent 通过关键词或别名搜索“主角/女主/场景/道具”时，不只拿到 `id/name/type/aliases`，也能立即看到该资产关联的全局身份、当前项目出场剧集和形态/妆容摘要。
- 自测新增搜索入口断言，验证 `search_project.assets` 能暴露 `el-hero`、`E1 Episode 1`、`E2 Second` 和 `Gala`，避免后续只优化完整读取工具而遗漏常用搜索路径。

第八十三轮提交继续落地 P4/P5 的分镜 cast 资产 usage 可见性：

- `get_storyboards` 在返回分镜时新增 `castAssets`，把每条 `castRef` 对应的项目资产、变体标签、镜头角色和 `assetCenterUsage` 放在同一条结构化记录里；`includeAssets=false` 时仍会省略这部分，保留原有轻量读取能力。
- 这让 Agent 读取某集真实分镜时，不只看到 `castRefs` 里的 `assetId/variantId`，也能同时看到该资产对应的全局身份、当前项目出场剧集和形态/妆容摘要，减少续写时误把同一人的不同妆容当成新角色。
- 自测新增第二集分镜读取断言，验证 `Hero-Gala` cast 记录能暴露 `el-hero` 和 `E2 Second · Gala`。

第八十四轮提交继续落地 P5 的连续性质量门资产 usage 可见性：

- `get_continuity_report` 在 Hub 可用时会把报告包装为 Agent 专用视图：每集 `castUses` 附带 `assetCenterUsage`，每条 issue 也会在存在 `assetId` 或 `relatedAssetIds` 时暴露对应 usage 摘要；Hub 加载失败时仍返回原始连续性报告。
- 这让 Agent 处理 `episode_variant_available`、`asset_state_changed_variant`、重复资产、缺失计划资产等质量门问题时，不需要再二次查询资产中心就能判断该资产对应的全局身份、出场剧集和形态/妆容历史。
- 自测新增连续性报告入口断言，验证第二集 `Hero-Gala` cast use 能直接暴露 `el-hero` 和 `E2 Second · Gala`。

第八十五轮提交继续落地 P4/P5 的时间线资产 usage 可见性：

- `get_timeline` 的每条 track 新增 `storyboardCastAssets`，按 `storyboardIds` 聚合对应分镜的 cast 资产、变体和 `assetCenterUsage`；原有 track/clip 字段保持不变。
- 这让 Agent 回看某集时间线、候选片段和选中视频段时，可以直接从 track 追溯到该视频段使用了哪些项目资产、全局身份和形态/妆容历史，减少成片整理或重生成时只凭 clip id 判断上下文的风险。
- 自测新增第二集时间线断言，验证 `track-ep2` 关联的 `sb-ep2` 能暴露 `Hero-Gala` 的 `el-hero` 和 `E2 Second · Gala`。

第八十六轮提交继续落地 P4/P5 的设计层分镜表资产 usage 可见性：

- `get_storyboard_table` 不再只返回原始 `castNames/assetRefNames`，会额外把场景级 cast 名和行级资产引用名解析为 `resolvedCastAssets` / `resolvedAssetRefs`，包含匹配到的项目资产和 `assetCenterUsage`。
- 这让 Agent 在正式生成分镜前读取大纲/分镜表时，就能把“主角/女主/场景”等名称绑定到已有项目资产、全局身份和出场历史，减少从设计层阶段开始误建重复资产。
- 自测新增第二集分镜表断言，验证 `主角` 能解析到 `hero`、`el-hero` 和 `E2 Second · Gala`。

第八十七轮提交继续落地 P2 的身份资产音色映射：

- `elementToLibraryEntity` 现在会把旧 `ElementRef.voiceId` 映射为 `LibraryEntity.voiceRef`，让资产中心身份层能显式知道角色绑定的音色引用。
- `createProjectAssetFromEntity` 在从角色身份导入项目资产时，会把 `voiceRef.assetId` 恢复为项目角色的 `voiceAssetId`；`promoteProjectAssetToEntity` 在项目角色发布回身份资产时，也会把 `voiceAssetId` 写回 `voiceRef`。
- 自测新增音色往返断言，验证旧身份资产、项目角色资产和发布后的身份资产都能保留同一个角色的音色绑定，不再只依赖 legacyElement 回退。

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

在现有连续性报告上先接入单集生产计划，再增加资产中心维度：

- `Episode.plan.requiredAssetIds` 指定的项目资产已不存在，或不是可用于分镜的角色/场景/道具。
- `Episode.plan.requiredAssetIds` 指定了本集必需项目资产，但本集已有分镜仍未通过 `castRefs` 引用。
- `Episode.plan.requiredVariantIds` 指定的形态/妆容已不存在，或不属于可用于分镜的项目资产。
- `Episode.plan.requiredVariantIds` 指定了本集必需形态/妆容，但本集已有分镜仍未绑定该 `variantId`。
- 项目资产链接的全局身份已被归档。
- 项目资产链接的全局身份有新版本。
- 项目资产和全局身份别名冲突。
- 本集分镜使用了项目资产，但资产中心存在更明确的同名身份，需要用户确认是否合并。
- 同一个 `LibraryEntity` 被导入成多个项目资产。
- 同一个角色的两个项目资产在不同集出现，可能是重复角色。

验收：

- 多集生产前能发现“同一个人被拆成两个项目资产”的问题。
- 多集生产前能发现“本集计划要求的角色/场景/道具/妆容没有进入分镜 castRefs”的问题。
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

## 第八十八轮提交：项目资产保留 LoRA 身份绑定

本轮继续补 P2“全局身份资产和项目资产双向映射不丢字段”：

- `Asset` 增加可选 `lora` 快照字段，项目资产可以承接全局身份资产的 LoRA 绑定。
- `createProjectAssetFromEntity` 导入身份资产时复制 `LibraryEntity.lora`。
- `promoteProjectAssetToEntity` 发布项目资产时优先使用项目资产上的 `lora`，旧项目没有该字段时继续保留已有全局身份 LoRA。
- `syncAssetFromLibraryEntity` 从资产中心同步快照时补齐 `lora`，并在资产中心提供角色音色时刷新 `voiceAssetId/audioBindState`。
- Agent 资产视图返回 `lora`，避免工具链读到的资产快照比实际项目资产少字段。
- `assetHub.selftest` 增加 ElementRef、LibraryEntity、Project Asset、ElementRef 的 LoRA 往返断言。

验收：

- 从全局身份导入角色到项目后，项目资产保留 LoRA 绑定。
- 项目内修改后发布回全局身份时，LoRA 不会被旧全局记录覆盖或丢失。
- 从资产中心同步新版身份快照时，角色音色和 LoRA 能随快照进入项目资产。

## 第八十九轮提交：Agent 身份摘要暴露稳定资产字段

本轮继续补 P2/P5 的 Agent 可观察性：

- `libraryEntityView` 不再只返回 `id/name/version/variants`，会额外返回身份描述、标签、媒体引用、`voiceRef` 和 `lora`。
- 变体摘要也返回 `kind/parentVariantId/tags/mediaRefs`，让 Agent 在同步或选择身份候选时能看见妆容/状态变体的真实媒体线索。
- `sync_project_asset_from_library` 的返回值现在能同时说明“同步到哪个身份”以及该身份携带的 LoRA、音色、主图和变体图。
- `agentTools.selftest` 补充同步身份快照后，返回的 `entity` 和 `asset` 同时带有 `voiceRef/voiceAssetId`、`lora`、媒体引用和变体类型的断言。

验收：

- Agent 在处理资产中心同步/候选身份处置时，不需要再只凭名称和版本判断身份。
- 多集生产里同步角色身份后，工具结果能直接显示该角色的稳定 LoRA、音色和妆容媒体线索。

## 第九十轮提交：Agent 写工具返回资产中心 usage 闭环

本轮继续补 P4/P5 的 Agent 修复闭环：

- `assetCenterUsageView` 在 Hub usage 没有当前项目细节时，会直接从当前 `ProjectDoc` 推导该项目资产的出场剧集和形态/妆容摘要。
- `link_project_asset_to_library_entity`、`mark_project_asset_distinct_identity`、`publish_project_asset_to_library`、`sync_project_asset_from_library` 和 `merge_project_asset_into` 的返回资产现在会携带 `assetCenterUsage`。
- 这些写工具在执行后使用最新内存项目文档生成 usage，避免项目尚未 flush 到 KV 时，Agent 看到的是旧的资产中心快照。
- `agentTools.selftest` 补充链接、发布、同步后的 `assetCenterUsage.entityId` 和当前项目出场/形态摘要断言。

验收：

- Agent 调用资产中心修复工具后，可以直接从返回值判断当前项目资产已经关联到哪个身份。
- 多集续写或修复重复资产时，工具结果能立即显示当前项目中该身份的剧集和妆容线索，不必再额外调用只读工具确认。

## 第九十一轮提交：合并 Hub usage 与内存项目 usage

本轮继续补 P4/P5 的多集资产可观察性：

- `assetCenterUsageView` 不再在 Hub usage 和当前 `ProjectDoc` 推导结果之间二选一，而是合并两边的 `episodeLabels` 与 `appearanceLabels`。
- 当 Agent 写工具刚新增分镜、绑定形态或切换剧集，还没来得及把项目 flush 到 KV 时，返回的 `assetCenterUsage.currentProject` 仍能包含刚写入的内存项目线索。
- 合并结果使用去重后的标签列表，避免 Hub 与当前文档同时包含同一集/同一妆容时重复显示。
- `agentTools.selftest` 补充“Hub 旧快照只有 Gala，当前内存项目已有 Cloak”的断言，确保写工具返回 usage 同时包含两种形态。

验收：

- Agent 在同一轮工具调用中先写分镜/形态，再链接或同步资产中心身份时，结果不会漏掉刚刚写入的形态/妆容。
- 多集修复流程可以直接依赖写工具返回的 usage 继续决策，而不受持久化刷新时机影响。

## 第九十二轮提交：分镜写工具返回 cast 资产中心 usage

本轮继续补 P4/P5 的 Agent 分镜修复闭环：

- `set_storyboard_cast_variant`、`set_storyboard_asset_ref`、`set_storyboard_scene_asset` 和 `add_storyboard` 在写入后返回的分镜视图，现在会给 `castAssets` 注入 `assetCenterUsage`。
- `assetCenterUsageView` 在当前资产缺少显式 `libraryLink/elementId` 时，会从 Hub usage 中按“当前项目 + assetId”反查实体 ID，覆盖写入后内存项目和 KV 快照短暂不同步的情况。
- 写入工具返回的 `asset` 视图也继续携带同一份 usage，避免 Agent 需要再调用只读工具确认该资产是否关联到资产中心身份。
- `agentTools.selftest` 补充新增分镜、绑定场景作用域变体后，`castAssets` 直接返回剧集与妆容 usage 的断言。

验收：

- Agent 新增或修复某集分镜后，可以直接从返回的 `storyboard.castAssets[].assetCenterUsage` 判断该角色对应的资产中心身份、出场剧集和妆容线索。
- 多集生产中刚写入的分镜不再因为项目还未 flush 到 KV，而丢失资产中心 usage，后续连续性修复可以继续基于同一轮工具结果推进。

## 第九十三轮提交：Studio 资产矩阵显示资产中心图谱

本轮继续补 P0/P1/P5 的人工检查视图：

- `assetHub` 服务层新增 `projectAssetIdentityUsageEntityId` 与 `projectAssetIdentityUsageFromHub`，把“按当前项目 + assetId 从 Hub usage 反查身份”的逻辑从 Agent 局部实现上移为公共能力。
- 公共 helper 明确尊重 `forked` 状态，避免分叉项目资产被旧 Hub 快照重新显示成活动身份引用。
- Studio「跨集资产一致性」矩阵新增资产中心图谱摘要列，显示该项目资产关联身份被多少项目、项目资产、画布节点和快照引用。
- 矩阵图谱列的 tooltip 展示项目出场、形态/妆容、画布节点和快照明细，让人工核对全局身份和项目快照边界时不必跳转到资产中心。
- `assetHub.selftest` 补充无显式链接资产从 Hub usage 反查身份，以及 forked 资产不被旧 usage 复活的断言。

验收：

- 用户在项目资产页能直接看出某个角色是否已经进入资产中心使用图谱，以及是否被画布或快照引用。
- Agent 和 Studio UI 现在共用同一套项目资产身份反查规则，降低多集修复与人工检查结果不一致的风险。

## 第九十四轮提交：画布回写清理互斥 lineage

本轮继续补 P3 的“画布产物显式回写目标”边界：

- 新增 `canvasLineage` 服务，把画布端口产物标记为项目资产或身份资产的 meta 更新逻辑从 `graphStore` 中抽出为纯函数。
- 画布产物保存到未关联身份的项目资产时，会清理旧的 `libraryEntityId/libraryVariantId/variantId/variantLabel`，避免旧身份 lineage 继续污染资产中心图谱。
- 画布产物保存到身份资产时，会清理旧的 `projectId/projectAssetId/projectVariantId`，避免同一产物被误判为仍属于某个项目资产回写。
- 保存到已关联身份的项目资产时，仍会显式写入项目资产和身份资产两组 lineage，表示这是用户确认过的桥接关系。
- `graphStore` 的 `markOutputAsProjectAsset` 和 `markOutputAsLibraryEntity` 复用该服务，减少画布、项目和资产中心三套边界规则分叉。
- `canvasLineage.selftest` 接入 `npm run test:continuity`，覆盖未关联项目目标清理旧身份、身份目标清理旧项目、已关联项目目标保留显式身份以及 fanout 只更新选中项。

验收：

- 用户把画布实验图保存到项目资产时，只有明确目标会进入使用图谱，不会因为产物曾经来自某个身份资产而误算全局身份引用。
- 用户把同一张画布图另存为身份资产时，资产中心不会继续把它误认为某个项目资产的生产快照，除非用户再次明确保存到项目目标。

## 第九十五轮提交：身份媒体角色保留显式 mediaRefs

本轮继续执行 P3/P6 的“画布回写目标显式化”和“身份资产读取收敛”：

- `ElementRef` 与 `ElementVariant` 增加 `mediaRefs`，用于保存身份主图、三视图、概念图、参考图和音频等明确媒体角色，不再只依赖 `refAssetIds` 的数组顺序推断含义。
- `applyCanvasOutputToElement` 在画布产物保存到身份资产或身份变体时，会同步写入目标 `view` 对应的 `mediaRefs`；`primary/front/side/back` 作为单槽位替换，`concept/reference` 允许保留多张不同参考。
- `assetHub` 在 `ElementRef -> LibraryEntity -> ElementRef` 往返时优先使用显式 `mediaRefs`，再兼容旧 `views/refAssetIds`；旧数据仍可读取，新数据不会把 concept/reference 退化成普通主图。
- `assetRegistry` 的引用扫描纳入身份与变体的 `mediaRefs`，避免保存为概念图或参考图的画布产物被 GC 当作孤儿媒体清理。
- `assetStore.selftest` 覆盖画布保存 identity/variant 的 `primary/front/concept/reference` 角色写入；`assetHub.selftest` 覆盖显式 `concept/reference` 在 Hub 转换中的保留。

验收：

- 画布输出保存为全局身份概念图或参考图后，资产中心能知道它的真实角色，而不是只把它当成 `@图1` 主参考。
- 同一身份的主图更新不会丢掉概念图；三视图更新仍写回 `views` 兼容旧读取路径。
- 身份变体的参考图会进入使用图谱和 GC 保护范围，适合后续多集妆容、服装、受伤状态等形态素材复用。

## 第九十六轮提交：媒体角色消费端统一主图选择

本轮继续补 P3/P6 中“显式媒体角色不仅要保存，也要被读取端正确消费”的收口：

- `assetHub` 新增 `preferredMediaRef` 与 `preferredMediaAssetId`，把身份媒体的默认选择规则统一为 `front -> primary -> reference -> concept`，不再由各个 UI 自己按数组顺序猜测。
- `createProjectAssetFromEntity`、身份变体快照和音色回退继续复用同一套 helper，确保导入项目资产时不会因为某张较新的 reference/concept 排在前面而抢占正式主图。
- Studio Dock、画布 Workbench Dock 和资产中心身份卡片的缩略图改为使用 `preferredMediaAssetId`，让第九十五轮新增的显式 `mediaRefs` 角色真正影响预览显示。
- `assetHub.selftest` 增加“较新的 reference 不覆盖 front”和“只有 concept 时仍可兜底显示”的断言。

验收：

- 同一身份同时有三视图、主图、参考图和概念图时，项目导入与 UI 缩略图优先展示正式生产图，而不是最近保存的实验参考图。
- 只有概念图的早期身份资产仍能在 Dock 和资产中心卡片中显示预览，不会变成空白卡片。

## 第九十七轮提交：身份编辑器同步主参考媒体角色

本轮继续补 P3/P6 中显式 `mediaRefs` 与旧编辑入口的兼容写入边界：

- `assetStore` 新增 `setElementPrimaryReference`，把资产中心手动选择主参考图时的 `refAssetIds` 和 `mediaRefs.primary` 更新收敛为同一个纯函数。
- 资产中心身份编辑器的参考图选择不再只改旧 `refAssetIds`；选择新图会替换旧 `primary` 媒体角色，取消选择只移除 `primary`，保留 `concept/reference/front` 等其他显式角色。
- 编辑器选中态优先读取 `mediaRefs.primary`，再兼容旧 `refAssetIds[0]`，避免带有显式媒体角色的身份资产在编辑时误显示旧主图。
- `assetStore.selftest` 增加手动编辑替换 primary、保留 concept/reference，以及清除 primary 不误删其他媒体角色的断言。

验收：

- 用户在资产中心手动更换身份主参考图后，后续导入项目、Dock 预览和身份卡片都会按新的 `primary` 媒体角色读取。
- 用户清空主参考图时，不会把画布保存的概念图、参考图或三视图一起删掉，适合继续维护同一身份的多集素材库。

## 第九十八轮提交：身份形态变体可手动绑定主参考图

本轮继续补 P4/P5 的“同一身份多妆容/多形态”资产维护入口：

- `assetStore` 新增 `setElementVariantPrimaryReference`，把身份形态变体的旧 `refAssetIds` 与新 `mediaRefs.primary` 同步更新收敛为纯函数。
- 资产中心身份编辑器的每个时期/形态变体现在可以直接选择一张主参考图；选择新图会替换该变体旧 `primary`，取消选择只移除 `primary`，保留 `reference/concept` 等辅助媒体角色。
- 变体参考图选择区复用现有缩略图瓦片，并增加横向滚动的 mini 布局，避免多张素材撑破编辑面板。
- `assetStore.selftest` 增加变体手动替换 primary、保留 reference/concept，以及清除 primary 不误删其他媒体角色的断言。

验收：

- 同一个角色可以在资产中心维护“常态、战损妆、晚宴妆”等多个形态，并为每个形态绑定稳定主参考图。
- 用户清空某个形态的主参考图时，不会删除该形态从画布或项目发布回来的参考图/概念图线索。

## 第九十九轮提交：身份形态变体可选择结构化类型

本轮继续补 P4/P5 的“同一身份多妆容/多形态”结构化管理：

- 资产中心身份编辑器的时期/形态变体新增类型下拉，可标记为年龄/时期、服装、妆容、伤情、状态、时段、天气或自定义。
- 该类型直接写入 `ElementVariant.kind`，继续经 `assetHub` 映射到 `LibraryVariant.kind` 和项目资产快照的 `AssetVariant.variantKind`，让多集生产和连续性质量门能区分“妆容变化”和“服装/受伤/年龄变化”。
- 变体编辑行调整为“标签 + 类型 + 外观 + 删除”的稳定网格，移动端保持可压缩布局。
- `assetHub.selftest` 增加 LibraryEntity 往返 ElementRef 时保留变体类型的断言。

验收：

- 用户维护同一角色的“战损妆”“晚宴服”“少年时期”等形态时，不再只靠自由文本，后续导入项目和 Agent 读取都能看到明确类型。
- 项目资产快照仍能继承资产中心变体类型，服务跨集计划、handoff 和连续性检查。

## 第一百轮提交：项目资产形态类型可编辑可见

本轮继续补 P4/P5 的“同一身份多妆容/多形态”项目快照维护能力：

- 新增共享 `variantKinds` 枚举模块，资产中心身份变体和 Studio 项目资产变体复用同一套年龄/时期、服装、妆容、伤情、状态、时段、天气、自定义类型文案。
- Studio 项目资产的形态/妆容变体卡新增类型下拉，可直接维护 `AssetVariant.variantKind`，不再只能依赖从资产中心导入时带入的快照值。
- 系列剧集规划的“必需形态/妆容”选项会显示变体类型，长标签使用省略与 tooltip，避免多集规划面板被复杂妆容名撑破。
- 分镜出场资产的形态选择器也会显示变体类型，并在选项 title 中保留类型与描述，帮助用户在同名或近似形态之间区分“妆容、服装、受伤、年龄”等变化。

验收：

- 用户在项目内临时新建“雨夜战损”“少年时期”“晚宴服”等形态后，可以补充结构化类型，后续连续性质量门和 handoff 不必只看自由文本。
- 剧集规划和分镜绑定形态时能直接看到类型提示，减少把同一角色不同妆容/服装误当成普通备注的风险。

## 第一百零一轮提交：单集承接包暴露形态类型

本轮继续补 P4/P5 的 Agent 多集承接可观察性：

- `EpisodeHandoffPlannedVariant` 新增 `variantKind`，让本集计划要求的形态不只暴露 label，也能说明它是妆容、服装、受伤、年龄/时期等结构化类型。
- `EpisodeHandoffAssetCue` 新增当前承接形态的 `variantId/variantKind`，共享资产线索可以直接告诉 Agent 当前集正在沿用或切换哪一种类型的形态。
- `EpisodeHandoffAppearance` 新增 `variantDetails`，跨集 appearance 摘要在保留旧 `variants/variantLabels` 字符串的同时，提供每个历史形态的 `variantId/label/variantKind`。
- handoff 的可执行建议在涉及已有形态时也携带 `variantKind`，方便 Agent 判断“补图/补作用域”是在修复妆容、服装、伤情还是年龄状态。
- `episodeProduction.selftest` 和 `agentTools.selftest` 增加计划形态、共享资产线索、历史形态明细与建议类型的断言。

验收：

- Agent 调用 `get_episode_handoff` 续写下一集时，可以直接看到 planned/shared 形态的结构化类型，减少把晚宴服、战损妆和少年时期都当作普通文本标签的风险。
- 旧的 handoff 字符串字段保持兼容，现有 UI 和工具消费者不需要同步改造也能继续工作。

## 第一百零二轮提交：读工具分镜资产暴露形态类型

本轮继续补 P4/P5 的 Agent 多集资产可观察性：

- `get_storyboards` 返回的 `castAssets` 在分镜已绑定 `variantId` 时新增 `variantKind`，让 Agent 读取真实分镜时能直接区分妆容、服装、伤情、年龄/时期等形态类型。
- `get_timeline` 的 `storyboardCastAssets.castAssets` 复用同一视图，也会带出当前视频段关联分镜里的形态类型。
- `get_storyboard_table` 的设计层名称解析结果新增轻量 `variants` 摘要，包含 `id/label/variantKind/refImageId/appliesToEpisodeIds`，让 Agent 在正式分镜生成前就能看到该项目资产有哪些结构化形态可用。
- `agentTools.selftest` 增加分镜、分镜表和时间线三个读取入口的 `variantKind` 断言。

验收：

- Agent 不必只在 `get_episode_handoff` 中才能看到形态类型；回读已生成分镜、设计分镜表或时间线时，同一角色的晚宴妆、战损妆、服装和时期变化仍然有结构化字段可用。
- 旧的 `variantId/variantLabel/label` 字段保持不变，现有工具消费方继续兼容。

## 第一百零三轮提交：连续性质量门暴露形态类型

本轮继续补 P4/P5 的多集连续性可观察性：

- `ContinuityCastUse` 新增 `variantKind`，连续性报告里的真实分镜出场记录会直接说明当前使用的是妆容、服装、伤情、年龄/时期等哪类形态。
- `ContinuityIssue` 新增当前、候选和历史形态类型字段：`variantKind`、`candidateVariantKinds`、`previousVariantKind`。
- 作用域越界、缺少参考图、主形象误用本集可用形态、跨集切换未标作用域、从历史形态回退到主形象等问题都会携带相关形态类型。
- `get_continuity_report` 的 Agent 读取结果与 `get_episode_handoff`、`get_storyboards`、`get_timeline` 等入口保持一致，后续修复工具可以按“妆容/服装/伤情/年龄”等类型做更精确决策。
- `continuityReport.selftest` 和 `agentTools.selftest` 补齐 cast usage、issue 当前类型、候选类型与历史类型的断言。

验收：

- Agent 运行连续性质量门时，不需要再只靠形态 label 猜测问题类型；缺图、越界、跨集状态变化等问题都能直接暴露结构化类型。
- 旧的 `variantId/variantLabel/candidateVariantLabels/previousVariantLabel` 字段保持兼容，现有 UI 和工具消费者可以继续读取原字段。

## 第一百零四轮提交：人工连续性视图与交付清单消费形态类型

本轮继续补 P4/P5 的“质量门结果可被人和交付物消费”：

- Studio 一致性检查详情抽屉新增只读形态类型标签，会把 issue 上的 `variantKind`、`candidateVariantKinds`、`previousVariantKind` 显示为“形态/候选/上一形态”。
- 这些标签复用项目内统一的年龄/时期、服装、妆容、伤情、状态等文案，人工修复时不用再从形态 label 里猜测问题属于哪一类变化。
- 全季导出和单集导出的 delivery manifest 中，`assetReferences[]` 新增 `variantKind`，让交付清单保留成片分镜实际使用的结构化形态类型。
- `episodeExport.selftest` 将导出夹具改为使用带 `variantKind` 的形态出场，并断言全季与单集 manifest 都保留该类型。

验收：

- 用户打开连续性详情抽屉时，可以直接看到缺图、越界、候选绑定、跨集状态变化等问题涉及的是妆容、服装、伤情还是其他结构化形态。
- 交付给外部流程的 manifest 不再只保留 `variantId/variantLabel`，也能携带可机器读取的 `variantKind`。

## 第一百零五轮提交：交付清单保留资产中心 lineage

本轮继续补 P2/P5 的“项目快照与资产中心身份可追踪”：

- 全季导出和单集导出的 delivery manifest 中，`assetReferences[]` 新增 `libraryEntityId`、`libraryEntityVersion`、`librarySyncPolicy` 和 `libraryVariantId`。
- 这些字段来自项目资产的 `libraryLink` 与项目形态的 `libraryVariantId/variantMap`，让交付物能说明本地生产快照源自哪个资产中心身份和哪个全局形态。
- 对旧项目中只有 `elementId`、没有 `libraryLink` 的资产，导出清单仍会把 `elementId` 作为兼容的 `libraryEntityId` 来源。
- `episodeExport.selftest` 将导出夹具补成资产中心快照资产，并断言全季与单集 manifest 都保留身份版本、同步策略和全局变体 ID。

验收：

- 用户导出全季或单集包后，外部流程可以从 manifest 追踪“这个成片分镜使用的项目资产快照来自哪个资产中心身份/形态”，而不是只能看到项目内临时 ID。
- 分叉、快照、链接三种同步策略会随交付清单保留，避免把项目专属资产误判成仍可自动同步的全局身份。

## 第一百零六轮提交：交付缺失报告保留资产中心 lineage

本轮继续补 P2/P5 的交付质量报告闭环：

- delivery manifest 的 `issues[]` 与 `missingItems[]` 现在会基于 `assetId/variantId` 注入项目资产名称、类型、资产中心身份、身份版本、同步策略和全局形态 ID。
- 这些字段与 `assetReferences[]` 共用同一套解析逻辑，避免正常引用清单和缺失/问题清单在资产中心 lineage 上出现分叉。
- 如果连续性 issue 自身已经携带 `libraryEntityId`，会优先保留 issue 的身份语义；否则从项目资产的 `libraryLink/elementId` 回填。
- `episodeExport.selftest` 增加“资产中心快照形态缺图”的独立导出夹具，断言 `missing_ref_image` 缺失项保留 `libraryEntityId/libraryEntityVersion/librarySyncPolicy/libraryVariantId` 与形态类型。

验收：

- 外部流程读取导出包 manifest 时，不仅能追踪已使用资产，也能直接定位缺失参考图、无效引用等问题对应的资产中心身份和全局形态。
- 交付报告中的缺失项可以作为后续补图、同步或分叉处理的输入，不需要再回查项目内资产表才能判断身份来源。

## 第一百零七轮提交：连续性出场记录暴露资产中心 lineage

本轮继续补 P2/P5 的“质量门读数可直接驱动修复/同步决策”：

- `ContinuityCastUse` 新增 `libraryEntityId`、`libraryEntityVersion`、`librarySyncPolicy` 和 `libraryVariantId`。
- 连续性报告里的真实分镜出场记录现在会说明该项目资产快照来自哪个资产中心身份、使用哪种同步策略，以及本地形态对应哪个全局形态。
- `libraryVariantId` 优先读取项目形态自身的 `libraryVariantId`，旧数据没有该字段时回退到 `libraryLink.variantMap`，保持和交付清单 lineage 规则一致。
- `get_continuity_report` 保留既有 `assetCenterUsage` 摘要；新增字段用于直接定位身份/形态来源，避免 Agent 在修复缺图、作用域或同步问题时再回查项目资产表。
- `continuityReport.selftest` 与 `agentTools.selftest` 补齐连续性 cast use 的身份版本、同步策略和全局形态 ID 断言。

验收：

- Agent 读取连续性报告时，可以同时看到某次出场的项目内资产、形态类型、资产中心身份、身份版本、同步策略和全局形态 ID。
- 后续修复工具可以把连续性报告直接作为补图、同步或分叉的输入，而不是只依赖 `assetCenterUsage` 的汇总标签。

## 第一百零八轮提交：单集承接包暴露资产中心 lineage

本轮继续补 P2/P5 的多集续写输入可追踪性：

- `EpisodeHandoffPlannedAsset` 新增 `libraryEntityId`、`libraryEntityVersion` 和 `librarySyncPolicy`，让本集计划资产直接说明来自哪个资产中心身份快照。
- `EpisodeHandoffPlannedVariant` 与 `EpisodeHandoffAssetCue` 新增同一组身份 lineage，并额外暴露 `libraryVariantId`，用于区分本地形态和全局形态。
- `EpisodeHandoffVariantDetail` 新增 `libraryVariantId`，历史出场里的形态明细不再只保留本地 `variantId/label/variantKind`。
- handoff 生成逻辑优先读取形态自身的 `libraryVariantId`，旧项目回退到 `libraryLink.variantMap`，与连续性报告和交付清单保持同一 lineage 规则。
- `episodeProduction.selftest` 与 `agentTools.selftest` 补齐 planned/shared/appearance variant 明细的身份版本、同步策略和全局形态 ID 断言。

验收：

- Agent 调用 `get_episode_handoff` 续写或修复某集时，可以从 planned 和 shared 线索直接定位资产中心身份/形态，而不必再通过项目资产表二次反查。
- 多集承接包中的 `assetCenterUsage` 继续作为使用图谱摘要存在；新增 lineage 字段用于精确同步、补图和分叉决策。

## 第一百零九轮提交：读工具分镜资产暴露资产中心 lineage

本轮继续补 P2/P5 的 Agent 多集资产读取闭环：

- `storyboardCastAssets` 共享视图新增 `libraryEntityId`、`libraryEntityVersion`、`librarySyncPolicy` 和 `libraryVariantId`。
- `get_storyboards` 返回的 `castAssets` 现在不只包含项目内 `assetId/variantId/variantKind` 和 `assetCenterUsage` 摘要，也能直接说明该分镜出场来自哪个资产中心身份和全局形态。
- `get_timeline` 的 `storyboardCastAssets.castAssets` 复用同一视图，因此时间线读工具也同步具备资产中心 lineage。
- `libraryVariantId` 继续优先读取项目形态自身字段，旧项目回退到 `libraryLink.variantMap`，与 handoff、continuity 和 delivery manifest 保持一致。
- `agentTools.selftest` 补齐分镜读工具与时间线读工具的身份版本、同步策略和全局形态 ID 断言。

验收：

- Agent 回读某集分镜或时间线时，可以直接从 cast asset 项定位资产中心身份/形态，减少后续补图、同步或分叉前的二次查询。
- 既有 `assetCenterUsage` 仍保留使用图谱摘要，新 lineage 字段用于精确来源追踪。

## 第一百一十轮提交：设计层分镜表资产解析暴露 lineage

本轮继续补 P2/P5 中“正式分镜生成前也能追踪身份来源”的读工具闭环：

- `projectAssetNameUsageView` 新增资产级 `libraryEntityId`、`libraryEntityVersion` 和 `librarySyncPolicy`。
- 该视图返回的 `variants[]` 新增 `libraryVariantId`，让设计层名称解析也能看到本地形态对应的全局形态。
- `get_storyboard_table` 的 `resolvedCastAssets` 与 `resolvedAssetRefs` 都复用该视图，因此分镜表场景角色和行级资产引用同步暴露资产中心 lineage。
- `libraryVariantId` 同样优先读取项目形态字段，旧项目回退到 `libraryLink.variantMap`，与 handoff、continuity、storyboard/timeline 和 delivery manifest 保持一致。
- `agentTools.selftest` 补齐分镜表设计层解析的身份版本、同步策略和全局形态 ID 断言。

验收：

- Agent 在把设计层分镜表转成正式分镜前，就能知道“主角/道具/场景”这些名称解析到了哪个资产中心身份和全局形态。
- 这减少了生成正式分镜前因同名资产、同人多妆容或旧快照而选错资产的风险。

## 第一百一十一轮提交：资产列表读入口暴露 lineage

本轮继续补 P2/P5 中 Agent 初筛资产时的身份可追踪性：

- 新增 `assetLineageView` 与 `variantLibraryIdView`，把项目资产快照的身份来源字段收敛为共享读模型。
- `assetView` 顶层新增 `libraryEntityId`、`libraryEntityVersion` 和 `librarySyncPolicy`，保留旧 `libraryLink` 的同时提供稳定直读字段。
- `search_project` 的资产搜索结果、`get_workspace` 的资产概览、`get_series_bible.availableAssets` 都同步暴露资产中心 lineage。
- `get_series_bible.availableVariants` 新增 `variantKind`、`libraryVariantId` 与父资产 lineage，让系列规划阶段可以直接区分本地形态和全局形态。
- `agentTools.selftest` 补齐资产搜索、资产列表、工作区概览、系列规划资产和可用形态的 lineage 断言。

验收：

- Agent 在搜索资产、读取项目概览或读取系列圣经时，不必先调用更重的资产详情工具，也能知道候选资产来自哪个资产中心身份快照。
- 系列规划选择必需形态时，可以直接看到全局形态 ID，减少同人多妆容、多服装、多状态下的误选风险。

## 第一百一十二轮提交：handoff 可执行建议暴露 lineage

本轮继续补 P4/P5 的 Agent 自动修复闭环：

- `EpisodeHandoffSuggestion` 新增 `libraryEntityId`、`libraryEntityVersion`、`librarySyncPolicy` 和 `libraryVariantId`。
- `generate_asset_ref_image`、`generate_variant_ref_image`、`add_variant_episode_scope` 和 `create_episode_variant` 四类 handoff 建议都会携带对应项目资产快照的身份来源。
- 涉及已有形态的建议会额外携带全局形态 ID；新建本集形态建议只携带父资产身份 lineage，避免伪造尚不存在的全局形态。
- 建议 lineage 复用 `handoffAssetLineage` 与 `handoffVariantLibraryId`，保持 planned/shared/historical appearance 与 actionable suggestion 的来源解析一致。
- `episodeProduction.selftest` 与 `agentTools.selftest` 补齐 handoff suggestions 的身份版本、同步策略和全局形态 ID 断言。

验收：

- Agent 读取 `get_episode_handoff.suggestions` 后，可以直接判断每条建议要修复哪个资产中心身份/形态，不必再从 planned/shared 列表或项目资产表回查。
- 执行 `apply_episode_handoff_suggestion` 前后，建议输入与修复结果可以沿用同一组 lineage 字段做审计。

## 第一百一十三轮提交：handoff 自动修复结果保留 lineage

本轮继续补 P4/P5 的 Agent 自动修复审计闭环：

- `EpisodeHandoffSuggestionApplyResult` 新增 `libraryEntityId`、`libraryEntityVersion`、`librarySyncPolicy`、`libraryVariantId` 和 `variantKind`，执行 `apply_episode_handoff_suggestion` 后不再只返回项目内 `assetId/variantId`。
- `applyEpisodeHandoffSuggestion` 对生成主图、生成形态图、补 episode/scene/storyboard 作用域、新建本集形态以及跳过结果都复用同一套 suggestion lineage，确保成功和失败分支都能被追踪。
- Agent 工具的轻量 `handoffSuggestionRef` 同步暴露 lineage，使 `get_workspace` 的 handoff 摘要、缺少 suggestionId 时返回的候选建议、以及执行后的 `remainingSuggestions` 都保留资产中心来源。
- `episodeHandoffSuggestions.selftest` 增加服务层执行结果的身份版本、同步策略、全局形态 ID 与形态类型断言。
- `agentTools.selftest` 增加工作区 handoff 摘要和 `apply_episode_handoff_suggestion allAuto` 执行结果的 lineage 断言。

验收：

- Agent 批量执行 handoff 自动修复后，可以从 `applied[]` 直接看到每个补图/补作用域动作对应的资产中心身份和全局形态，不需要再用项目资产表二次回查。
- 轻量 handoff 摘要与完整 `get_episode_handoff.suggestions` 使用同一组来源字段，避免规划、执行、剩余建议三段输出在 lineage 上出现断层。

## 第一百一十四轮提交：剧集计划必需资产暴露 lineage

本轮继续补 P2/P5 的系列规划读入口闭环：

- `planView` 的 `requiredAssets[]` 新增 `libraryEntityId`、`libraryEntityVersion` 和 `librarySyncPolicy`，让单集计划里的必需资产不再只暴露项目内 `id/name/type`。
- `get_workspace` 的每集 `plan.requiredAssets` 会同步携带资产中心身份来源，适合 Agent 每轮快速浏览整季状态时直接判断计划资产来自哪个全局身份快照。
- `get_series_bible.episodes[].plan.requiredAssets` 同步暴露 lineage，使整季蓝图、每集计划、可用资产列表和可用形态列表在身份来源字段上保持一致。
- 既有 `requiredVariants[]` 已通过 `variantOptions` 暴露父资产 lineage 与 `libraryVariantId`，本轮补齐对应的父级必需资产字段。
- `agentTools.selftest` 增加工作区概览和系列圣经两个入口的剧集计划资产 lineage 断言。

验收：

- Agent 在整季规划阶段读取 `get_workspace` 或 `get_series_bible` 时，可以直接知道 E2/E3 等剧集计划要求的角色、场景或道具源自哪个资产中心身份快照。
- 后续基于计划生成分镜或执行 handoff 修复时，不需要先把 `requiredAssetIds` 再映射回项目资产表才能判断同步策略和身份来源。

## 第一百一十五轮提交：剧集计划必需资产暴露使用图谱

本轮继续补 P2/P5 的系列规划读入口闭环：

- `planView` 新增可选 `usageByEntity` 输入，`requiredAssets[]` 在保留 `libraryEntityId/libraryEntityVersion/librarySyncPolicy` 的同时增加 `assetCenterUsage`。
- `get_workspace` 和 `get_project_overview` 已经会加载资产中心使用图谱，本轮把该图谱传入每集 `episodeView`，让工作区概览里的剧集计划资产也能显示当前项目出场集数和形态出场摘要。
- `get_series_bible.episodes[].plan.requiredAssets` 同步带出 `assetCenterUsage`，与 `availableAssets`、`plannedAssets`、handoff 和 continuity 的使用图谱字段保持一致。
- 没有可用资产中心快照时，`assetCenterUsage` 仍会基于项目内 `libraryLink/elementId` 与分镜引用回填当前项目用法，不阻塞离线或旧项目读取。
- `agentTools.selftest` 增加工作区概览和系列圣经两个入口的计划资产使用图谱断言。

验收：

- Agent 在整季规划阶段读取 E2/E3 的必需资产时，可以同时看到资产中心身份来源和该身份在当前项目中的 episode/appearance 使用标签。
- 后续判断“计划要求的资产是否已经在前后集出现过、是否有同一身份的形态出场”时，不需要再额外调用资产列表或连续性报告做第一轮反查。

## 第一百一十六轮提交：剧集计划必需形态暴露使用图谱

本轮继续补 P2/P5 的系列规划读入口闭环：

- `variantOptions` 新增可选 `usageByEntity` 输入，返回的每个项目形态在保留 `variantKind/libraryVariantId` 与父资产 lineage 的同时增加 `assetCenterUsage`。
- `planView.requiredVariants[]` 现在会随 `get_workspace`、`get_project_overview` 和 `get_series_bible` 暴露父资产的资产中心使用图谱，让单集计划里的“必需妆容/服装/状态”也能看到当前项目出场标签。
- `get_series_bible.availableVariants[]` 同步带出 `assetCenterUsage`，规划阶段浏览可用形态时不再只看到形态 ID、类型和全局形态 ID。
- 该字段复用父资产的 `assetCenterUsageView`，与 handoff plannedVariants、continuity cast uses 和 storyboard cast assets 的使用图谱来源保持一致。
- `agentTools.selftest` 增加工作区概览、系列圣经计划形态和可用形态的使用图谱断言。

验收：

- Agent 在整季规划阶段读取“E2 必须使用 Gala 妆容”这类计划形态时，可以直接看到它对应的资产中心身份已经在哪些剧集、哪些形态出场过。
- 后续选择同一角色的妆容、服装或受伤状态时，可以先用计划读入口判断上下文，再决定是否需要 handoff 修复、continuity 审计或新建本集形态。

## 第一百一十七轮提交：剧集列表计划暴露使用图谱

本轮继续补 P2/P5 的系列规划读入口一致性：

- `get_episodes` 现在会加载资产中心使用图谱，并把 `usageByEntity` 传入 `episodeView`。
- 因为 `episodeView` 已复用 `planView`，剧集列表里的 `plan.requiredAssets[]` 和 `plan.requiredVariants[]` 会与 `get_workspace`、`get_project_overview`、`get_series_bible` 一样暴露 `assetCenterUsage`。
- 这个入口常用于 Agent 开始多集编辑前确认当前剧集、跳过状态和每集计划，本轮避免它在计划资产/形态使用图谱上落后于其他概览入口。
- `agentTools.selftest` 新增 `get_episodes` 的计划资产和计划形态使用图谱断言。

验收：

- Agent 只调用 `get_episodes` 读取剧集列表时，也能看到每集计划要求的资产/形态对应的资产中心身份在当前项目中的 episode/appearance 标签。
- 多集编辑前的轻量剧集扫描不再需要额外调用 `get_workspace` 或 `get_series_bible` 才能获得同一组计划使用图谱字段。

## 第一百一十八轮提交：剧集计划写入口返回使用图谱

本轮继续补 P2/P5 的系列规划写后回读闭环：

- `upsert_episode_plan` 写入或更新单集计划后，现在会加载资产中心使用图谱，并把 `usageByEntity` 传入返回的 `planView`。
- 写工具返回的 `plan.requiredAssets[]` 与 `plan.requiredVariants[]` 因此会和 `get_workspace`、`get_project_overview`、`get_series_bible`、`get_episodes` 的读工具保持同一套 `assetCenterUsage` 字段。
- 这解决了 Agent 在写完“某集必须使用某角色/某妆容”后，下一步立即判断跨集出现记录时还要额外调用读工具补上下文的问题。
- `agentTools.selftest` 新增 `upsert_episode_plan` 写后返回计划资产和计划形态使用图谱的断言，覆盖同一身份在当前项目的 episode/appearance 标签。

验收：

- Agent 调用 `upsert_episode_plan` 后，可以直接从返回结果看到计划资产/形态对应的资产中心身份，以及该身份在当前项目中已经出现过的剧集和形态标签。
- 系列规划的“写入计划 -> 依据使用图谱继续分镜/承接/修复”的链路不再依赖额外回读才能获得同一组资产中心上下文。

## 第一百一十九轮提交：剧集生命周期写入口返回使用图谱

本轮继续补 P2/P5 的写工具一致性：

- 新增 `episodeViewWithUsage` 与 `episodeListWithUsage`，统一为写工具返回的单集视图和剧集列表注入资产中心使用图谱。
- `create_episode`、`create_episodes`、`switch_episode`、`rename_episode`、`set_episode_series_skip`、`assign_episode_chapters` 和 `distribute_episode_chapters` 的返回结果现在会把 `usageByEntity` 传入 `episodeView`。
- 这些工具的错误回退剧集列表也同步使用同一套带 usage 的列表视图，避免 Agent 在选错剧集后看到的候选计划信息低于正常读入口。
- `agentTools.selftest` 新增 `set_episode_series_skip` 写后返回计划资产和计划形态使用图谱的断言，覆盖剧集状态写入口。

验收：

- Agent 在创建、切换、重命名、暂缓或分配章节后，如果返回的剧集已有 `plan.requiredAssets[]` / `plan.requiredVariants[]`，可以直接读取 `assetCenterUsage`。
- 多集规划的剧集管理动作不会再把计划资产/形态退回成只有本地 ID 的裸视图，后续分镜、handoff 和连续性修复可以沿用同一组资产中心上下文。

## 第一百二十轮提交：剧集搜索与候选列表返回使用图谱

本轮继续补 P2/P5 的读入口一致性：

- `search_project` 在搜索 `episodes` 域时现在会加载资产中心使用图谱，并把 `usageByEntity` 传入返回的 `episodeView`。
- `get_episode_handoff`、`get_script`、`get_storyboards`、`get_storyboard_table` 和 `get_timeline` 在指定剧集不存在时，返回的候选 `episodes[]` 改为使用 `episodeListWithUsage`。
- 这些错误回退列表里的 `plan.requiredAssets[]` / `plan.requiredVariants[]` 因此会和正常 `get_episodes` 结果一样包含 `assetCenterUsage`。
- `agentTools.selftest` 新增剧集搜索结果和无效剧集选择器候选列表的计划使用图谱断言。

验收：

- Agent 从 `search_project` 找到某集后，可以直接读取该集计划资产/形态的资产中心使用图谱，不必再额外调用 `get_episodes`。
- Agent 选错剧集时，错误结果里的候选剧集也保留同一组计划资产上下文，方便下一步自动改用正确剧集继续执行。

## 第一百二十一轮提交：搜索命中分镜资产返回使用图谱

本轮继续补 P2/P5 的搜索入口一致性：

- `search_project` 在搜索 `storyboards` 或 `storyboardTable` 域时现在会加载资产中心使用图谱。
- 分镜搜索结果新增 `castAssets`，复用正式 `storyboardCastAssets` 视图，包含项目资产、形态、资产中心 lineage 和 `assetCenterUsage`。
- 分镜表搜索结果里的 `scene` 改为复用 `storyboardTableView`，因此包含 `resolvedCastAssets` 与行级 `resolvedAssetRefs`。
- `agentTools.selftest` 新增分镜搜索命中和分镜表搜索命中的资产中心使用图谱断言。

验收：

- Agent 从搜索结果命中某个真实分镜时，可以直接知道该镜头使用了哪个资产中心身份/形态，不必再调用 `get_storyboards` 做第一轮回查。
- Agent 从搜索结果命中设计层分镜表时，也可以直接看到名称解析到的项目资产和使用图谱，方便后续生成正式分镜或修正同名/别名资产。

## 第一百二十二轮提交：变体写入口返回 lineage 与使用图谱

本轮继续补 P2/P5 的多集形态写后回读闭环：

- `variantView` 从只返回 `{ assetId, assetName, variant }` 升级为轻量形态视图，保留原有 `variant` 嵌套对象，同时补充父资产 `libraryEntityId/libraryEntityVersion/librarySyncPolicy`、形态级 `variantId/variantLabel/variantKind/libraryVariantId` 和 `assetCenterUsage`。
- `upsert_asset_variant`、`generate_asset_variant`、`set_asset_variant_scope` 与 `set_storyboard_cast_variant` 的返回结果现在都使用同一套变体视图。
- `add_storyboard` 在返回自动补作用域的 `variants[]` 时，也会为这些 scoped variants 注入资产中心 lineage 与使用图谱。
- 对 forked 项目资产，返回值仍保留 lineage 和同步策略，但 `assetCenterUsage` 遵循既有规则不把分叉资产误归入可同步身份使用图谱。
- `agentTools.selftest` 增加新增分镜 scoped variant、更新形态、生成形态图、绑定分镜形态和设置形态作用域的断言。

验收：

- Agent 写入“同一角色的不同妆容/服装/状态”后，可以直接从写工具返回值确认本地形态对应哪个资产中心身份和全局形态。
- 多集修复链路不需要额外回读资产列表，便能判断某个形态是可同步快照、项目分叉，还是缺少全局形态映射。

## 第一百二十三轮提交：资产写入口错误返回保留使用图谱

本轮继续补 P2/P5 的资产修复写后回读闭环：

- 新增 `assetViewWithUsage`，统一为写工具里返回的项目资产视图注入 `assetCenterUsage`。
- `update_asset` 成功返回的 `asset` 现在和 `get_assets/search_project` 一样携带资产中心 lineage 与使用图谱。
- `link_project_asset_to_library_entity`、`mark_project_asset_distinct_identity`、`publish_project_asset_to_library`、`sync_project_asset_from_library`、`merge_project_asset_into`、`set_asset_variant_scope`、`generate_asset_variant`、`set_storyboard_cast_variant`、`set_storyboard_asset_ref` 的资产错误返回不再退回裸 `assetView`。
- 对 forked 项目资产，错误返回仍会保留 `libraryEntityId/librarySyncPolicy`，但不会误挂 `assetCenterUsage`。
- `agentTools.selftest` 增加资产更新成功、发布缺主图失败和分镜资产引用变体错误的断言。

验收：

- Agent 在资产修复失败时，也可以直接看到失败对象来自哪个资产中心身份、当前同步策略是什么。
- 多集资产修复链路不需要因为一次失败返回而再调用资产列表补上下文。

## 第一百二十四轮提交：直接资产写入口返回结构化资产视图

本轮继续补 P2/P5 的资产写后回读一致性：

- `add_asset` 从纯文本提示改为返回 `{ id, asset }`，其中 `asset` 复用标准 `assetView`，包含项目资产字段、lineage 和可用的 `assetCenterUsage`。
- `generate_asset` 从纯文本提示改为返回 `{ generated, asset }`，生成主参考图后会立即回读项目资产并返回带 lineage/usage 的资产视图。
- `generate_asset` 的未命中分支改为结构化错误，返回候选项目资产列表，便于 Agent 自动改用正确资产继续执行。
- forked 资产生成主图后仍会保留 `libraryEntityId/librarySyncPolicy`，但不会误挂资产中心使用图谱。
- `agentTools.selftest` 增加新增资产结构化返回和按别名生成资产后返回 lineage 的断言。

验收：

- Agent 新建资产或生成主参考图后，不必再额外调用 `get_assets` 才能拿到资产 ID、别名、lineage 和同步策略。
- 多集资产补图链路可以直接沿用写工具返回值继续做分镜绑定、发布或同步判断。

## 第一百二十五轮提交：分镜生成入口返回资产使用图谱

本轮继续补 P2/P5 的生产写后回读闭环：

- `generate_keyframe` 从纯文本提示改为返回 `{ generated, episode, storyboard }`。
- `generate_clip` 从纯文本提示改为返回 `{ generated, episode, storyboard, clips }`。
- 两个生成入口的 `storyboard` 都复用标准 `storyboardView`，因此包含 `castAssets`、资产中心 lineage 与 `assetCenterUsage`。
- 分镜序号越界时改为结构化错误，并返回候选分镜列表，便于 Agent 自动改用正确序号。
- `agentTools.selftest` 为关键帧生成和视频生成补充断言，覆盖同一镜头返回的角色形态使用图谱和生成 clip 候选。

验收：

- Agent 生成关键帧或视频后，可以直接知道该镜头使用了哪个资产中心身份/形态，不必再调用 `get_storyboards` 回查。
- 多集生产链路可以把“生成动作 -> 检查资产一致性/补图/发布交付”的上下文保留在同一个工具结果里。

## 第一百二十六轮提交：写工具无效剧集返回候选使用图谱

本轮继续补 P2/P5 的多集写工具错误回退一致性：

- `switchToEpisodeForWrite` 在找不到目标剧集时保留当前项目文档，不再只返回裸错误。
- 新增 `episodeWriteTargetErrorView`，统一为写工具的无效剧集选择返回 `episodes[]` 候选列表。
- 候选剧集复用 `episodeListWithUsage`，因此 `plan.requiredAssets[]` 与 `plan.requiredVariants[]` 继续携带资产中心 `assetCenterUsage`。
- `apply_episode_handoff_suggestion`、`upsert_script`、`set_storyboard_cast_variant`、`set_storyboard_asset_ref`、`set_storyboard_scene_asset`、`add_storyboard`、`generate_keyframe` 和 `generate_clip` 的目标剧集错误返回都走同一视图。
- `agentTools.selftest` 增加无效剧集写工具返回候选计划资产/形态使用图谱的断言。

验收：

- Agent 写错剧集标题或序号时，可以直接从错误结果里看到可选剧集及其计划资产上下文。
- 多集自动修复不需要在一次目标剧集错误后额外调用 `get_episodes` 才能重新选择正确剧集。

## 第一百二十七轮提交：写工具资产候选返回使用图谱

本轮继续补 P2/P5 的写工具错误回退一致性：

- 新增 `assetCandidateList` / `assetCandidateListWithUsage`，统一为写工具错误结果里的 `assets[]` 候选注入标准 `assetView`。
- `update_asset`、`link_project_asset_to_library_entity`、`mark_project_asset_distinct_identity`、`publish_project_asset_to_library`、`sync_project_asset_from_library`、`merge_project_asset_into`、`upsert_asset_variant`、`set_asset_variant_scope`、`generate_asset_variant`、`set_storyboard_cast_variant`、`set_storyboard_asset_ref`、`set_storyboard_scene_asset` 与 `generate_asset` 的资产未命中错误都返回带 lineage 和 `assetCenterUsage` 的候选项目资产。
- 场景资产未命中时仍只列出场景类候选，但候选同样带资产中心身份、同步策略和当前项目使用标签。
- `agentTools.selftest` 增加资产写工具和分镜资产绑定工具的失败候选使用图谱断言。

验收：

- Agent 写错资产名、别名或 ID 时，可以直接从错误结果里的候选资产判断正确项目资产对应哪个资产中心身份。
- 多集资产修复不再需要因为一次“未找到资产”错误额外调用 `get_assets` 才能补齐候选资产的 lineage / 使用图谱上下文。

## 第一百二十八轮提交：写工具形态候选返回使用图谱

本轮继续补 P2/P5 的多集形态修复错误回退一致性：

- 新增 `variantCandidateList` / `variantCandidateListWithUsage`，统一把项目资产下的可选形态转换为标准 `variantView`。
- `set_asset_variant_scope`、`generate_asset_variant`、`set_storyboard_cast_variant` 与 `set_storyboard_asset_ref` 在形态/妆容/服装未命中时，除了返回父资产，也会返回带 lineage、`libraryVariantId` 和 `assetCenterUsage` 的 `variants[]` 候选。
- `generate_asset_variant` 不再返回裸 `asset.variants`，避免 Agent 只能看到本地形态字段而看不到资产中心身份和当前项目使用标签。
- `agentTools.selftest` 增加分镜形态绑定失败和形态图生成失败时的候选形态使用图谱断言。

验收：

- Agent 写错“Gala / Cloak / 某妆容”这类形态名称时，可以直接从错误结果里选择正确形态并继续绑定或生成。
- 多集里的同一角色不同妆容/服装修复链路，不再因为一次“未找到变体”错误额外回读资产列表才能判断候选形态对应的资产中心身份和全局形态。

## 第一百二十九轮提交：写工具分镜候选返回使用图谱

本轮继续补 P2/P5 的分镜级错误回退一致性：

- 新增 `storyboardCandidateList` / `storyboardCandidateListWithUsage`，把分镜候选统一转换为标准 `storyboardView`。
- `set_storyboard_cast_variant`、`set_storyboard_asset_ref`、`set_storyboard_scene_asset`、`generate_keyframe` 与 `generate_clip` 在分镜未命中、场景组未命中或分镜序号越界时，返回的 `storyboards[]` 候选会携带 `castAssets`、资产中心 lineage 和 `assetCenterUsage`。
- 旧的 `storyboardIndexOptions` 裸候选被移除，避免只返回 `{ id, index, videoDesc }` 导致 Agent 需要额外调用 `get_storyboards` 才能判断镜头资产上下文。
- `agentTools.selftest` 增加关键帧生成序号越界时的候选分镜资产使用图谱断言。

验收：

- Agent 写错分镜序号或目标分镜 ID 时，可以直接从错误结果里的候选分镜判断每个镜头绑定了哪些资产中心身份/形态。
- 多集生产链路中的“选错镜头 -> 改用正确镜头继续生成/绑定/修复”不再依赖额外回读分镜列表补齐资产上下文。
