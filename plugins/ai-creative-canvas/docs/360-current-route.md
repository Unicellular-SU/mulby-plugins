# 360 全景 · 当前路线说明

> 更新：2026-07-18（独立 pano 卡片类型；schemaVersion v2）

## 当前路线（在用）

1. **独立卡片**：360 全景是独立卡片类型 `kind: 'pano'`（不再是图片卡的 `params.pano` 开关）。入口：左侧 Dock「全景」、右键「新建 360 全景」、连线空放菜单、右键「连到新全景节点」；已有等距柱状图（图片/素材卡）可右键「转为 360 全景卡」。
2. **生成**：走 Mulby 原生 `ai.images` 文生图/图生图（`generate.ts` → `aiImage.ts`，`pano = card.kind === 'pano'`）：
   - 提示词自动注入等距柱状全景关键词（`panoHint()`：equirectangular / spherical panorama for VR / seamless wrap-around / 地平线居中 / 禁鱼眼）；接参考图时另加「以参考图场景重构 360 环绕」引导语，参考图可替代文字输入。
   - 强制 2:1、分辨率至少 2K、单张；模型优先级：卡片显式所选 > 工程「360 专用模型」（`defaultPanoModel`）> 图像默认模型（`generateCard` 回填写回 `card.modelId`）。任意文/图生图模型可用，专用 equirect 模型效果更好。
3. **查看**：节点内预览（无全屏查看器）。pano 卡双击 / 工具条「360 预览」→ 卡面就地换成 `PanoNodePreview.tsx`（three.js 内壁球环视，阻尼 + 自动旋转 + FOV 缩放），直接在卡片里拖动环视；相机按钮把**当前视角高清截图（1600 宽重渲）落成新图片卡**（`refIds` 连回全景卡，可继续转视频/图生图）。Esc / 关闭按钮退出；预览不算模态，画布快捷键照常。
4. **后处理（可选，全景卡工具条）**：
   - **接缝修复**（`mediaPano.repairEquirectSeam`）：水平半幅偏移 → 中缝 inpaint → 复位；结果落新 pano 卡。
   - **天/地锚定修复**（`panoOutpaint.repairEquirectPoles`）：针对天花板/地板锚定重绘，仍走 `ai.images.edit`；结果落新 pano 卡。
   - **高清放大**：结果保留 pano 身份；裁剪/扩图/宫格/抠像/局部编辑会破坏 2:1 投影，全景卡不提供。
5. **下游消费**：pano 产物对下游是「图片素材」（`references.matKindOfCard` 兜底 image），可作图生图参考、分镜一致性参考、拼贴输入。

## v2 迁移（2026-07-18）

`schemaVersion 1 → 2`（`persistence.migrateProject`）：旧「图片卡 + `params.pano` 开关（未生成）/ `meta.pano` 标记（已生成）」统一改为 `kind: 'pano'` 并移除开关字段；同时把工程「360 专用模型」钉到卡上（v1 生成时忽略 `card.modelId` 直用专用模型，v2 优先级反转为卡片显式优先，不钉会静默换模型），`resolution: '1K'` 归一为 `'2K'`。

**迁移不按版本号门控、每次加载幂等重跑**：分片持久化下，迁移只发生在内存，随后的增量保存会写出 v2 manifest 但只重写引用变化的画布分片——未编辑画布的分片仍是 v1 旧卡；若按 `v < 2` 跳过，这些卡将永远失去迁移机会（对抗校验抓出的 critical，见 `test/persistence.test.ts` 回归钉住）。

用户组模板另在 `templates.listTemplates` 读取时兜底转换（模板存储不走工程迁移，`params.pano` 与 `meta.pano` 两类标记都识别）。注意：新版导出的工程在旧版插件打开时，pano 卡会被旧 `VALID_KINDS` 剔除（不兼容降级，发版说明需提及）。

## 已删除路线（勿恢复）

**渐进式 equirect outpaint 合成**（`eq↔persp` 主循环、半幅对齐、PanoDreamer LLM 规划等）已于 `a69d343` 删除。

- **原因**：复杂室内场景效果差、接缝/天地混淆、迭代成本高。
- **遗留**：`panoOutpaint.ts` 中保留投影核心与天/地修复；主循环代码已移除。

## 验证清单（WS3）

| 场景 | 期望 |
|---|---|
| 文生 360，简单户外 | 2:1 等距柱状，环视无明显接缝 |
| 文生 360，复杂室内 | 专用模型可接受；必要时用手动接缝/天地修复 |
| 图生 360 | 参考图语义保留，比例正确 |
| 非 2:1 出图 | 查看器容错或提示用户 |
| 4K+ 大图 | 查看器内存可接受，不崩溃 |

## 相关文件

- `src/ui/canvas/PanoViewer.tsx` — 查看器
- `src/ui/services/mediaPano.ts` — 接缝修复
- `src/ui/services/panoOutpaint.ts` — 投影工具 + 天地修复
- `src/ui/services/generate.ts` — `params.pano` → `meta.pano`
