export const PLANNED_HANDOFF_FIELD_NAMES = ['plannedAssets', 'plannedVariants'] as const

export const PLANNED_HANDOFF_STORYBOARD_RULE =
  'get_episode_handoff 返回的 plannedAssets/plannedVariants 是当前集 Episode.plan 的权威生产输入；新增或续写分镜时，plannedAssets 里的资产必须进入 castRefs/associateAssetIds，plannedVariants 里的形态必须进入对应资产的 castRefs.variantId/variantLabel。若缺主图、缺形态图或 scopeAppliesToEpisode=false，先执行 handoff.suggestions，或用 generate_asset/generate_asset_variant/set_asset_variant_scope 补齐，再生成关键帧/视频；不要只把计划资产或计划形态写进画面描述。'
