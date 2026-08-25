/**
 * 分镜生成的连续性约束。
 *
 * 旧版这里是一段 400 字的作用域操作手册（何时 ensureScope、选哪个 scopeKind、
 * 哪个工具追加范围而不是覆盖数组…）。作用域声明删掉之后，规则只剩一句话：
 * 外观自动继承，只有真的变了才登记一次。
 */
export const CONTINUITY_STORYBOARD_RULE =
  '【形态连续性】角色/场景/道具的外观在分镜之间**自动沿用上一镜**，你不需要为每一镜重复标注形态，' +
  '也不存在"这个形态适用于哪几集/场/镜"这种声明——那是系统从时间轴推导出来的。' +
  '只有当剧情在某一镜真的发生换装、化妆、受伤、年龄或时期变化时，才给那一镜写一条 stateChanges' +
  '（assetName + toVariantLabel + reason；恢复原样则省略 toVariantLabel）。' +
  'get_episode_handoff 的 carriedState 就是本集开拍时每个资产的当前形态，直接照着用即可，不要另行猜测。'