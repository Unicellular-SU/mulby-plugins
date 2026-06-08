# Vibe 板块 UI 收敛 + 动效设计方案

> 目标：把"看似规范但偏复杂"的三栏向导式界面，收敛为"对话为唯一主线 + 按需浮现"的轻量界面（对齐 Claude Code / opencode 的形态），并加入克制而灵动的动效，提升质感与可感知反馈。
> 约束：① 不推倒重来，既有工作流（脚手架/契约/计划/构建/载入/版本/一致性/冒烟/影子快照）全部复用；② 动效零新依赖（纯 CSS/Tailwind）；③ 分阶段、每步可独立上线、低风险。

---

## 0. 实施进度（2026-06-08，方案 A 已全量落地）

- ✅ **U1 去重** + **M1 进场动效**（commit 680179f）：新建 3→1、停止 2→1、状态单一来源、删重复按钮；纯 CSS keyframes + 按钮按压 + 思考点 + prefers-reduced-motion。
- ✅ **U2 顶部 stepper + 对话主区**：删左栏阶段导航与中栏向导，根布局改为 顶部细条(进度/模型/详情/重新开始) + 主区(项目设置仅描述阶段 + 对话) + 进阶抽屉。
- ✅ **U3 进阶详情抽屉**：DeliverStage(验收/一致性/改动/版本/冒烟/DevTools)、契约编辑、生成时间线移入右侧滑入抽屉（默认关，顶部「详情」开）。
- ✅ **U4 契约术语隐身**：对话内「设定」友好摘要卡（确认并生成）；完整字段编辑器移入抽屉「契约设定」。
- ✅ **U5 自适应 + 文案**：stepper/模型窄屏隐藏、抽屉 max-w 限宽；修正「右侧对话/中间面板」过时文案为「下方对话/顶部详情」。
- ✅ **动效**：M3 抽屉滑入、M4 stepper 勾选弹入、M7 按钮按压、M8 计划 todo 勾选弹入、M10 AI 思考三点跳动。
- 验证：tsc 0 / build 1722 模块 / lint 干净。需 Mulby 重载插件查看效果。

---

## 1. 现状盘点（基于实际代码）

布局根结构 `VibePanel.tsx` 渲染（L2235-2423）是**三栏 flex**：

| 区域 | 宽度 | 内容 |
|---|---|---|
| 左 `aside` | `w-56` | 4 阶段只读进度 + 生成模型下拉 + 重新开始 |
| 中 `div` | `flex-1`（最大面积） | 4 个阶段屏（Describe/Contract/Generate/Deliver）+ 底部操作条（上一步/下一步/重新生成/去构建交付/停止/状态 badge） |
| 右 `aside` | `w-80` | SessionSwitcher + 新建项目 + ChatPanel（对话主线） |

**问题（与"对话式 agent"定位冲突）：**

1. **两套交互并存**：对话已是主线，但整套向导（左进度 + 中阶段屏 + 底部操作条）原样保留 → 中栏占最大面积，多数时间只是"只读进度 + 重复按钮"。两侧栏吃掉约 336px，窄屏中栏拥挤。
2. **同一动作多入口**：
   - "新建" 3 处：右上「新建项目」+ SessionSwitcher 下拉新建 + ChatPanel 头部「新建会话」。
   - "停止" 2 处：中栏 stage2 底部 + 右侧输入框。
   - "重新生成/制定计划" 概念重叠：中栏底部按钮 vs 右侧 plan 卡「重新规划」/ contractPending 卡「确认并制定计划」。
3. **同一状态多处显示** 3 处：左栏阶段进度、中栏 stage3 badge、右侧状态卡。
4. **两个"重屏"对小白是噪音**：
   - `DeliverStage`（L2614+）一屏堆叠：图标、验收清单(6 项 StatusRow)、契约一致性卡、改动 diff 卡、版本历史卡、成功卡(运行验证/打开目录/重新构建)、实时调试卡、构建失败修复卡。
   - `ContractStage`（ContractEditor 22KB）把 name/type/template/features/triggers/permissions/window/behavior 全字段摊开，与"术语隐身、对小白友好"的初衷相悖。

**样式基线**（`styles.css` / `tailwind.config.js`）：纯 Tailwind；自定义 `btn-primary`(带 hover 辉光)/`btn-secondary`/`btn-ghost`/`btn-danger`/`badge*`/`glass-panel`/`input-base`；仅有 `spin-slow`、`skeleton` 两个自定义动画；**无 framer-motion 等动画库**。`theme.extend` 为空。

---

## 2. 设计原则

1. **单主线**：对话是唯一主交互，占据主要面积。
2. **渐进披露（Progressive Disclosure）**：进阶/质检功能（版本历史、一致性、冒烟、DevTools、契约全字段编辑）默认收起，按需在抽屉/折叠里出现。
3. **每个概念只有一个出口**：一个"新建"、一处状态、一处"停止"、一处入口。
4. **阶段是氛围而非屏幕**：4 阶段从"占一栏的向导"降为对话顶部的细长只读进度条。
5. **动效服务于反馈，不喧宾夺主**：克制为主、少量"愉悦时刻"，并遵守 `prefers-reduced-motion`。

---

## 3. 目标布局（推荐 A，备选 B/C）

### 方案 A（推荐）：对话主导 + 进阶抽屉
```
┌───────────────────────────────────────────────────────────┐
│  顶部细条：阶段进度(4点·只读)   │  插件状态(图标·名·触发词) ··· │  ← ··· 收纳 打开/试用/打包/图标/打开目录/撤销
├──────────────┬────────────────────────────────────────────┤
│ 会话侧栏      │              对话主线（主区，加宽）            │   ┌─ 进阶抽屉(默认关，右侧滑入) ─┐
│ (可折叠 w-52) │   消息流 / 卡片(头脑风暴·计划·设定·确认) /     │   │ 验收清单 / 一致性 / 改动 diff │
│  + 新建       │   输入框(含停止)                              │   │ 版本历史 / 运行验证 / DevTools │
└──────────────┴────────────────────────────────────────────┘   └──────────────────────────────┘
```
- 删除中栏向导整列与底部操作条；阶段→顶部细长 stepper（只读）。
- DeliverStage 的进阶/质检内容 → 右侧 **slide-in 抽屉**「插件详情」，默认关闭，状态条一个按钮打开。交付默认只见：图标 + "已就绪 🎉" + 触发提示 + 1~2 个主操作（试用/打开）。
- 会话列表降为可折叠左侧细栏（或并入顶部下拉）。

### 方案 B（最小改动过渡）：保留三栏，去重 + 折叠化
- 中栏不再是向导：describe/contract/generate 阶段只显示氛围进度；deliver 才显示"插件详情"，且进阶项改为手风琴折叠。删底部操作条。改动小，但仍未根治"三栏挤压"。

### 方案 C（终态最彻底）：真单栏
- 一栏对话；会话列表/状态做顶部条；进阶做抽屉/弹窗。最贴近 Claude Code，但一次性改动最大。

> 推荐路径：以 **A 为终态**，按下面分阶段从 B 的低风险步骤过渡到 A；C 作为长期方向（A 已基本达成 C 的体验）。

---

## 4. 收敛方案：分阶段实施（U1–U5）

### U1 去重（最低风险，无结构改动，先上）
- "新建" 收敛为 1 处：状态条/会话栏一个「+」菜单含「新建项目 / 新建会话」；删除其余重复入口。
- 删中栏底部"停止"（保留输入框停止）。
- 删中栏底部与对话卡片重复的按钮（重新生成/去构建交付——对话已驱动）。
- 状态只保留右侧状态卡一处；移除中栏 stage3 badge。
- **收益**：立刻清爽，零结构风险。

### U2 向导降为氛围进度
- 左 `w-56` 阶段栏 + 中栏阶段屏 → 顶部细长 stepper（4 步只读，当前步高亮）。
- DescribeStage 的"项目设置"(目标目录/改造对象/生成方式) → 首次进入时对话内一张「开始设置」卡（或顶部紧凑设置行），不再占一屏。
- Generate 阶段本就在对话里流式 → 中栏不再单独画时间线（时间线移进"进阶抽屉"或对话内"N 步操作"折叠）。

### U3 进阶/质检抽屉
- 新增右侧 slide-in「插件详情」抽屉，收纳 DeliverStage 的：验收清单、契约一致性卡、改动 diff、版本历史、运行验证(冒烟)、实时调试(DevTools)、重新构建。
- 交付默认视图只剩：图标 + 就绪标题 + 触发提示 + 试用/打开。构建失败时仍在对话里"说人话 + 一键修复"（保留现有自愈）。

### U4 契约"术语隐身"
- ContractStage 默认显示友好摘要卡（名字 + 一句话作用 + 触发方式 + 「看起来不错 / 我要改」），「我要改」才展开现有 ContractEditor（移入"高级设定"折叠）。

### U5 布局收尾 + 自适应
- 对话主区加宽；会话栏可折叠；窄宽优雅降级（侧栏自动收起为图标/抽屉）。

> 每阶段独立可上线。建议顺序 **U1 →（M 动效并行）→ U2 → U3 → U4 → U5**。

---

## 5. 动效方案（纯 CSS/Tailwind，零依赖）

> 在 `styles.css` 的 `@layer utilities` 增加一组 `@keyframes` 与工具类；组件按需挂 className；统一受 `prefers-reduced-motion` 收束。

### 5.1 动效目录（M1–M12）
| 编号 | 场景 | 效果 |
|---|---|---|
| M1 | 消息/卡片进场 | 淡入 + 上移（opacity 0→1, translateY 8px→0, 180ms ease-out）；列表错峰 stagger |
| M2 | 卡片浮现(头脑风暴/计划/设定/确认/pendingPrompt) | scale-in 0.97→1 + 淡入，轻微弹性 |
| M3 | 进阶抽屉 | 右侧滑入 translateX 100%→0 + 背景遮罩淡入（240ms cubic-bezier(.2,.8,.2,1)） |
| M4 | 阶段 stepper | 当前步呼吸辉光；完成步 ✓ 弹入(scale + check pop) |
| M5 | 流式光标 | 沿用 pulse；微调节奏 |
| M6 | 状态变化 | 状态点/badge 颜色过渡；"已载入"成功瞬间 ✓ 弹跳 + 绿色辉光环（复用 btn-primary 辉光语言） |
| M7 | 按钮微反馈 | hover 抬起(translateY -1px)+阴影；active:scale-95 按压 |
| M8 | 计划 todo 勾选 | ✓ scale 弹入 + 文本 line-through 渐显 + 行底色绿色一闪即收 |
| M9 | 加载骨架 | 在 .skeleton 基础上加 shimmer 渐变扫光 |
| M10 | "AI 思考中" | 三点跳动(bounce dots) 替代单一转圈，更灵动 |
| M11 | 图标生成中 | 缩略图轻微"呼吸"缩放 |
| M12 | 阶段/视图切换 | 内容 crossfade |

### 5.2 关键 keyframes（落地草案）
```css
@layer utilities {
  @keyframes fade-in-up { from { opacity:0; transform:translateY(8px);} to {opacity:1;transform:none;} }
  @keyframes scale-in   { from { opacity:0; transform:scale(.97);} to {opacity:1;transform:none;} }
  @keyframes slide-in-right { from { transform:translateX(100%);} to {transform:none;} }
  @keyframes check-pop  { 0%{transform:scale(0);} 60%{transform:scale(1.2);} 100%{transform:scale(1);} }
  @keyframes shimmer    { 100% { background-position: 200% 0; } }
  @keyframes bounce-dot { 0%,80%,100%{transform:translateY(0);opacity:.4;} 40%{transform:translateY(-3px);opacity:1;} }
  @keyframes glow-pulse { 0%,100%{box-shadow:0 0 0 0 rgba(16,185,129,.0);} 50%{box-shadow:0 0 14px 2px rgba(16,185,129,.35);} }

  .anim-in    { animation: fade-in-up .18s ease-out both; }
  .anim-pop   { animation: scale-in .16s ease-out both; }
  .anim-drawer{ animation: slide-in-right .24s cubic-bezier(.2,.8,.2,1) both; }
  .anim-check { animation: check-pop .28s ease-out both; }
  .anim-glow  { animation: glow-pulse 1.6s ease-in-out infinite; }
}
@media (prefers-reduced-motion: reduce) {
  .anim-in,.anim-pop,.anim-drawer,.anim-check,.anim-glow { animation: none !important; }
}
```
- 错峰：列表项用内联 `style={{ animationDelay: i*40+'ms' }}`。
- 全局已有 `transition-all` 在按钮上；M7 仅补 `hover:-translate-y-px active:scale-95`。

### 5.3 为什么纯 CSS 不引库
插件最终打成单 JS（当前 UI 产物 ~346KB）。framer-motion 等会显著增重；上述效果用 CSS keyframes + Tailwind 过渡即可全覆盖，维护成本低、性能好。

---

## 6. 复用 vs 重构

**复用（不动逻辑，仅迁移/重排 UI）**：所有 hostCall/工作流、ChatPanel 卡片体系、ContractEditor、版本/一致性/冒烟/DevTools 逻辑、影子快照与撤销、意图路由、断点续传。
**重构（UI 层）**：根布局三栏 → 主线+抽屉；删中栏向导与底部操作条；DeliverStage 拆为"精简交付视图 + 进阶抽屉"；DescribeStage/ContractStage 改为对话内卡片/折叠；新增顶部 stepper、状态条「···」菜单、Drawer 容器、动效工具类。

---

## 7. 风险与回归

- U1 去重：风险极低（删冗余入口/按钮）。
- U2/U3 结构改动：中风险——确保删向导后所有动作在对话/抽屉里仍可达；回归"新建项目/会话、契约确认、计划执行、构建失败修复、版本回滚、撤销 AI 改动、打开/试用/打包/图标"全链路。
- 动效：低风险、可灰度；务必加 `prefers-reduced-motion`，避免长列表错峰过度导致卡顿（错峰上限 ~10 项）。
- 每阶段 tsc + build 验证（基线：vite 1722 模块 / main.js ~38KB）。

---

## 8. 待拍板决策

1. **目标布局**：A 对话主导+抽屉（推荐）/ B 三栏去重折叠 / C 真单栏。
2. **动效强度**：克制专业 / 适度灵动(推荐：克制为主 + 几个愉悦时刻) / 活泼。
3. **动效实现**：纯 CSS（推荐）/ 引入 framer-motion。
4. **本轮范围**：仅定稿本文档 / 立即开干 U1+M1（去重 + 进场动效，最快见效且零风险）。
