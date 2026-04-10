# 泳道图连线混乱优化 — 完成总结

## 改动文件

| 文件 | 核心变更 |
|------|---------| 
| [a-star.ts](file:///Users/su/workspace/mulby_plugins/plugins/ai-flowchart/src/ui/layout/edge/a-star.ts) | 寻路失败时生成正交 L 形折线，不再直连产生斜线 |
| [edgeRoutingStore.ts](file:///Users/su/workspace/mulby_plugins/plugins/ai-flowchart/src/ui/store/edgeRoutingStore.ts) | **[NEW]** 全局边路由协调 store，debounced 并行边分离 |
| [SmartEdge.tsx](file:///Users/su/workspace/mulby_plugins/plugins/ai-flowchart/src/ui/components/edges/SmartEdge.tsx) | 集成 edgeRoutingStore：注册路由结果 + 使用分离路径渲染 |

## 修复详情

### 1. A* 回退斜线修复
- `a-star.ts` L79: 寻路失败时不再 `return [start, end]`（斜线）
- 新增 `getOrthogonalFallback()`：生成 L 形正交拐点

### 2. 并行边分离集成
- `edgeRoutingStore.ts`：SmartEdge 注册路由 → 100ms debounce → `separateParallelEdges` 批量分离
- `SmartEdge.tsx`：订阅分离结果，优先使用分离后路径渲染

## 验证

- `tsc --noEmit` ✅ 零错误
- `npm run build:ui` ✅ 成功 (477KB, 3.06s)
