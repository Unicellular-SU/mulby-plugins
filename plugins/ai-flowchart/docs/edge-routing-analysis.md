# 泳道图边路由问题分析与优化方案

## 一、当前问题

复杂泳道图（4+ 泳道、多 decision 分支）中出现严重的视觉混乱：
1. **线段重叠**：多条边走相同路径，完全重合无法区分
2. **节点遮挡线段**：边穿越非 source/target 的中间节点
3. **复杂图越混乱**：节点越多，问题越严重，因为路由算法没有全局感知

## 二、当前架构分析

### 技术栈
- **节点布局**：Dagre（LR 方向）内置于每个泳道，泳道垂直堆叠
- **边路由**：自定义 A* 算法（参考 `idootop/reactflow-auto-layout`）
- **渲染框架**：React Flow v12（@xyflow/react）

### 核心文件清单

| 文件 | 职责 | 行数 |
|------|------|------|
| `src/ui/layout/edge/routing.ts` | 边路由入口：协调 offset、直连判断、A* 调用 | 126 |
| `src/ui/layout/edge/a-star.ts` | A* 寻路算法：Manhattan 启发 + 水平/垂直路径 | 139 |
| `src/ui/layout/edge/point.ts` | 几何工具：矩形膨胀、控制点计算、碰撞检测 | 240 |
| `src/ui/layout/edge/edge.ts` | SVG 路径生成：圆角折线 + 方向判断 | 136 |
| `src/ui/layout/edge/simple.ts` | 简单路径：近距离或直连时的快速路由 | 101 |
| `src/ui/utils/swimlaneLayout.ts` | 泳道布局：提取泳道 → Dagre LR → 垂直堆叠 | 192 |
| `src/ui/utils/edgeUtils.ts` | 边处理：handle 推断、跨组重映射、孤儿修复 | ~420 |
| `src/ui/components/edges/SmartEdge.tsx` | 智能边组件：A* 路由 + 圆角折线 + 可拖拽 | 376 |
| `src/ui/utils/layoutUtils.ts` | 通用布局：节点尺寸估算 + Dagre 主布局 | 284 |

### 路由流程（每条边独立执行）

```
SmartEdge 组件
  ↓
computeEdgePath(sourceX/Y, targetX/Y, sourceRect, targetRect)
  ↓
判断是否直连或太近 → getSimplePath() 
否则 →
  1. getExpandedRect() 膨胀 source/target 矩形
  2. getVerticesFromRectVertex() + getCenterPoints() 收集候选控制点
  3. getAStarPath() — A* 寻路
     ↓
     只检查路径是否穿过 sourceRect 和 targetRect!!
     ⚠️ 不检查其它节点！不检查其它边！
  4. getPathWithRoundCorners() — 圆角 SVG
```

### 5 个核心缺陷

#### 缺陷 1：边路由只感知 source + target 两个节点
`a-star.ts:getNeighbors()` 只检查 `isSegmentCrossingRect(p, current, sourceRect)` 和 `isSegmentCrossingRect(p, current, targetRect)`，完全不知道其它节点的存在。

**后果**：边自由穿越其它节点（特别是跨泳道连线穿过中间泳道的节点）。

#### 缺陷 2：边与边之间没有交互
每条边独立计算路径（在 SmartEdge 组件的 `useMemo` 中），不感知其它边的位置。

**后果**：多条边走完全相同的路径，视觉上完全重叠。

#### 缺陷 3：候选控制点集合太稀疏
`routing.ts` 只从 source/target 的膨胀矩形顶点 + 中点生成候选点（约 16 个点），没有考虑其它节点周围的绕行点。

**后果**：A* 无法找到绕开其它节点的路径，因为根本没有绕行候选点。

#### 缺陷 4：泳道布局与边路由完全解耦
`swimlaneLayout.ts` 使用 Dagre 布局时只传入泳道内部的边（L84 `childIds.has(edge.source) && childIds.has(edge.target)`），跨泳道的边被忽略，不影响节点位置和间距计算。

**后果**：Dagre 不知道跨泳道连线的存在，不会为跨泳道边预留走线通道。

#### 缺陷 5：无并行边分离机制
没有检测多条边共享同一条路径（或路径非常接近）的逻辑，没有"nudge"分离。

**后果**：并行边完全重叠。

## 三、开源解决方案调研

### 方案 A：avoid-nodes-edge（⭐ 推荐）

| 项目 | 说明 |
|------|------|
| 仓库 | `github.com/gordonmleigh/avoid-nodes-edge` |
| 原理 | 基于 `libavoid`（C++ 正交路由引擎，来自 Adaptagrams 项目）编译为 WASM |
| 安装 | `npm install avoid-nodes-edge libavoid-js` |
| 兼容 | React Flow v12+ |

**核心优势**：
1. **全局节点感知**：自动绕过所有节点，不只是 source/target
2. **并行边分离（nudging）**：自动微调并行边间距，避免重叠
3. **WASM 高性能**：路由计算在 Web Worker 中运行，零主线程阻塞
4. **增量更新**：拖拽节点时只重路由受影响的边
5. **可配置**：边到节点间距、圆角半径、网格吸附等

**集成方式**：作为 React Flow 的自定义 Edge 类型使用，替换当前的 `SmartEdge`。

**潜在风险**：
- WASM 二进制体积（需评估对 Electron 插件包大小的影响）
- 泳道容器节点需要特殊处理（避免把泳道矩形本身当障碍物）

### 方案 B：ELKjs（布局 + 路由一体）

| 项目 | 说明 |
|------|------|
| 仓库 | `github.com/kieler/elkjs`，Eclipse 开源项目 |
| 原理 | 基于 Eclipse Layout Kernel 的 JavaScript 移植（GWT 编译） |
| 安装 | `npm install elkjs` |
| 配置 | `elk.algorithm: "layered"`, `elk.edgeRouting: "ORTHOGONAL"` |

**核心优势**：
1. **布局和路由一体化**：节点位置和边路由同时计算，互相感知
2. **内置 ORTHOGONAL 路由**：保证正交折线，最小化交叉
3. **层级图/复合图支持**：子图 (hierarchical) 天然适合泳道

**潜在风险**：
- ELK 没有原生的"泳道"概念，需要用层级节点（compound nodes）模拟
- 配置复杂度高，需要大量参数调优
- 性能比 WASM 方案低（GWT 编译的 JS 运行）
- 替换 Dagre 需要重写整个布局流程

### 方案 C：不替换库，自行改进当前 A* 算法

**改进方向**：
1. **全局障碍物注入**：将所有节点矩形传入 `getNeighbors()`，不只是 source/target
2. **全局候选点**：收集所有节点膨胀矩形的顶点作为候选控制点
3. **边排序 + 偏移**：先路由所有边，然后检测重叠/平行的边对，自动偏移
4. **边间距 cost**：在 A* 启发函数中增加"靠近已有边"的惩罚

**优缺点**：
- ✅ 无新依赖，改动在现有代码上
- ❌ 工作量大，需要自行实现 nudging、全局碰撞等复杂算法
- ❌ 手写算法难以达到 libavoid 等成熟库的鲁棒性

## 四、推荐方案

### 推荐：方案 A（avoid-nodes-edge）+ 现有 Dagre 泳道布局

**理由**：
1. 专为 React Flow 设计，集成成本最低
2. WASM 性能好，大图也不卡
3. 自动绕节点 + 自动分离并行边，一次性解决两大问题
4. 保留现有的 Dagre 泳道布局（只改边路由，不动节点布局）

**集成步骤概要**：
1. 安装 `avoid-nodes-edge` + `libavoid-js`
2. 创建新的 edge 类型替换 `SmartEdge`
3. 配置 obstacle 列表（所有非泳道容器的节点矩形）
4. 保留现有的 `edgeUtils.ts` 中的 handle 推断逻辑
5. 测试跨泳道连线的绕行效果

### 备选：如果 avoid-nodes-edge 不适合泳道场景

考虑方案 C（改进当前 A*），重点改进：
1. 把所有节点矩形作为障碍物传入路由
2. 实现简单的并行边检测 + 偏移

## 五、关键常量参考

当前泳道布局的核心参数（`swimlaneLayout.ts`）：
```typescript
LANE_HEADER_WIDTH = 120  // 泳道标题区宽度
LANE_PADDING = 40        // 泳道内边距
LANE_GAP = 40            // 泳道间距
NODE_GAP_X = 100         // 节点水平间距
NODE_GAP_Y = 50          // 节点垂直间距
```

A* 路由参数（`routing.ts`）：
```typescript
DEFAULT_OFFSET = 20      // handle 偏移距离
DEFAULT_BORDER_RADIUS = 12 // 圆角半径
```
