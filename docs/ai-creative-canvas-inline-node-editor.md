# AI 创意画布 — 内联节点编辑器（Inline Node Editor）设计方案

> 目标：把"点击节点 → 右侧抽屉编辑"改为"点击节点 → 节点正下方浮出编辑面板就地编辑"。
> 参考：AI-CanvasPro 的节点内联编辑体验（设计层面理解，不照搬其代码）。
> 创建：2026-06-20

---

## 0. 背景

- **现状**：选中节点后在右侧 `Inspector` 抽屉里编辑（标题/提示词/引用下拉/模型/生成/媒体工具箱/导出）。问题：编辑区与节点分离、脱离画布上下文。
- **期望**：点击节点，在**节点下方**就地浮出一个编辑对话框，可配置该节点属性、上传素材、看到可选模型；**上游连入的节点自动作为素材展示**，并能 **@ 这些素材**来写提示词。
- **AI-CanvasPro 的做法（理解，不照搬）**：每个节点自带一个编辑面板，**挂在节点下方**、随选中淡入淡出、缩放时反向缩放保持屏幕尺寸恒定；提示词是富文本（contentEditable），输入 `@` 弹出"素材候选菜单"，选中后在文中插入一个**不可编辑的引用 pill**（缩略图 + 自动编号标签，如 图片1/文本2）；**连入的上游节点自动汇成一条素材条**（缩略图 chips，按 kind 归类）；模型菜单来自模型清单/Provider 元数据；上传走本地文件导入并落地为本地路径。其节点数据里以 `assetInputRefs` 存引用列表、边以 `refSlot` 表达"接到哪个输入"。

---

## 1. 需求分解（对齐你的描述）

| 编号 | 你的需求 | 落地任务 |
|---|---|---|
| R1 | 点击节点在**下方**弹编辑对话框（不要右侧抽屉） | A 面板外壳 + 定位 |
| R2 | 面板内配置该节点的属性 | B 属性区（提示词/模型/参数/生成） |
| R3 | 面板内可上传素材 | D 上传 |
| R4 | 面板内显示该节点对应的**可选模型** | F 模型/Provider 选择 |
| R5 | 有上游连入时，连入内容**自动作为素材展示** | C 素材条 + E 素材模型 |
| R6 | 可 **@ 这些素材** 来写提示词 | G @ 引用 |

---

## 2. 与现有架构的衔接（我们已有的）

- `store/graphStore.ts`：`Card{ id,kind,x,y,w,h,prompt,modelId,providerId,params,refIds,assetUrl,assetLocalPath,mime,text,meta }`、`Edge{ source,target }`。
- `services/references.ts`：`collectRefCards` = `refIds` + 指向本卡的 incoming edges；`resolveRefs` → `{texts, imageCards}`。
- `services/generate.ts`：按 kind 调 `aiText`/`aiImage`/provider，用 `resolveRefs` 取上下文/参考图。
- `components/Inspector.tsx`：当前承载逐节点编辑（要迁入内联面板）。
- 复用件：`ModelPicker`、`MediaToolbox`、`ProviderHint`、`ConnectMenu`、屏幕坐标浮层范式（`EdgeLayer`/`Minimap`/`ConnectMenu`）、`stageEl` + `worldToScreen`、`importMedia`/`media.saveBase64`。

> 结论：内联面板 ≈ 把现 Inspector 内容搬到"锚定节点下方的屏幕浮层"，再加 **素材条 + 上传 + @ 引用** 三块新能力。

---

## 3. 总体设计

### 3.1 面板定位（R1）— 屏幕坐标浮层，锚定节点下方
- **不放进世界层**（会随缩放糊化/变形）。改用**屏幕坐标浮层**（同 `EdgeLayer`/`ConnectMenu`），位置 = `worldToScreen(节点底边中点)`，宽度固定（约 360px），随 pan/zoom/节点移动实时跟随（CanvasStage 已在视口/节点变化时重渲染，无需反向缩放 hack）。
- **仅当恰好选中 1 个节点**时显示；多选/空选隐藏。
- 超出视口下边缘 → 翻到节点上方；左右越界 → 夹取到可视范围。
- 加 `data-interactive`，避免被画布指针逻辑抢事件；`Esc` 关闭、`Ctrl/⌘+Enter` 生成。
- 新增组件 `canvas/NodeEditor.tsx`，在 `CanvasStage` 内渲染（读 `selectedIds` 单选）。

### 3.2 素材模型（R5/R6 的基础）
统一"节点素材 Material"：
```ts
interface Material {
  matId: string                 // 'card:<id>' | 'upload:<assetId>'
  origin: 'edge' | 'card' | 'upload'
  kind: 'image' | 'video' | 'audio' | 'text'
  label: string                 // 自动编号：图片1 / 文本2 / 视频1 ...
  thumbUrl?: string
  text?: string
  cardId?: string               // origin=edge|card
  assetUrl?: string; assetLocalPath?: string; mime?: string  // origin=upload
}
```
`buildMaterials(card, board)` 合并去重、按 kind 自动编号，来源：
1. **上游连线**（`origin:'edge'`）：指向本节点的 incoming edges 的源卡片。
2. **显式引用**（`origin:'card'`）：`refIds` 中、非连线来源的卡片。
3. **本节点上传**（`origin:'upload'`）：新增字段 `Card.assets`。

数据模型新增：
```ts
interface NodeAsset { id:string; kind:CardKind; url:string; localPath?:string; mime?:string; name?:string }
// Card 增补： assets?: NodeAsset[]
```

### 3.3 素材条（R5）
- 面板顶部一行缩略图 chips：图片显缩略图、视频显首帧/图标、文本显摘要、音频显图标。
- 连线来源的 chip 带"🔗 链接"角标，可一键断开（删边）；上传的可删除；显式引用的可移除。
- 点 chip → 在提示词光标处插入对应素材的 @ 引用（等价于在 @ 菜单里选它）。

### 3.4 提示词 + @ 引用（R6）— 分期
- **方案①（推荐先做）：`<textarea>` + `@` 自动补全 + 素材条**
  - 输入 `@` 弹素材菜单（按本节点可接受 kind 过滤）；选中插入文本标记 `@图片1` 并记录 `label→matId` 映射（存 `card.meta.mentions` 或解析时按素材条标签反查）。
  - 鲁棒、易实现、中文友好；引用可视化由素材条承担。
- **方案②（后续增强，最贴 AI-CanvasPro）：contentEditable 内联 pill**
  - 富文本里把引用渲染成不可编辑缩略图 pill。体验最佳，但 caret/序列化/粘贴/撤销/IME 复杂、易出 bug。建议 ① 稳定后再做。
- `@` 菜单内容：默认列"本节点素材"（连入 + 上传 + 已显式引用）；可选再加"画布上其它卡片"（选中＝新建一条引用）。按 kind 过滤（如图生图只收 image）。

### 3.5 模型与参数（R2/R4）
- 模型：复用 `ModelPicker`（text/image，按 kind 给可选模型）；视频/音频显示 `ProviderHint`（Provider + 设置入口）。
- 参数行（写入 `card.params`）：图片(尺寸/比例/数量)、视频(时长/比例)、音频(音色/语速/格式)。

### 3.6 上传素材（R3）
- 面板"上传"按钮 + 拖文件到面板：导入 → 落本地（复用 `media.saveBase64`/`importMedia`）→ 追加到 `card.assets` → 成为 `Material(origin:'upload')` → 素材条出现、可 @。

### 3.7 生成集成（让素材与 @ 真正参与）
- 扩展 `resolveRefs`/`generate`：把 Material 全集（边 + 显式 + 上传）解析为 `{texts, images}`，参考图含上传素材。
- `@` 影响**取用与顺序**：提示词含 @ 引用时，按被 @ 的素材（及顺序）作参考；未 @ 时回退"全部连入素材"（兼容现状）。

### 3.8 右侧抽屉去向
- 取消 `Inspector` 的逐节点编辑（迁入内联面板）。
- 多选：保留极简右栏或换成画布浮动小条（删除/对齐）；Delete 快捷键已可删。
- 工程级（名称/画布切换）已在 `TopBar`。**建议整体移除右侧抽屉。**

---

## 4. 里程碑（每步 tsc + build 把关）
- **E1 面板外壳**：`NodeEditor` 屏幕浮层、锚定节点下方、单选显隐、跟随视口；迁入现 Inspector 的 提示词/模型/参数/生成/媒体工具箱/导出；移除右侧逐节点编辑。
- **E2 素材模型 + 素材条**：`buildMaterials`、`Card.assets`、顶部 chips（连入/上传/显式，自动编号、删除/断开、点插入）。
- **E3 上传**：面板上传按钮 + 拖入 → `card.assets` → 素材条。
- **E4 @ 自动补全（方案①）**：textarea `@` 菜单、插入标记、kind 过滤、点 chip 插入。
- **E5 生成集成**：`resolveRefs`/`generate` 纳入 Material 全集 + @ 选择/顺序。
- **E6（可选）contentEditable 内联 pill（方案②）**。
- **E7 收尾**：定位边界（翻面/夹取）、键盘（Esc 关 / ⌘Enter 生成）、空状态、暗色、缩略图懒加载/性能。

---

## 5. 风险
- contentEditable pill 复杂 → 故分期，先 textarea。
- 浮层在缩放/视口边缘的定位边界 → 翻面/夹取处理 + 实测。
- 素材多时缩略图性能 → 懒加载/数量上限/降级图标。
- 迁移期"右抽屉 vs 内联"双写状态不一致 → **一次性切换**，不并存。

---

## 6. 需你确认（确认后按 E1→E7 推进）
1. `@` 引用先做**方案①（textarea + 自动补全 + 素材条）**、pill 内联（方案②）作后续增强 —— 可否？
2. 右侧抽屉**整体移除**（逐节点编辑全进内联；多选删除用快捷键/浮条）—— 可否？还是保留一个极简右栏？
3. `@` 菜单只列"本节点素材（连入 + 上传 + 已引用）"，还是也允许 @ 画布上**任意其它卡片**（＝新建引用）？
4. 面板显示时机：**单击选中即显示**（推荐），还是点节点上的"编辑"按钮/双击才显示？
