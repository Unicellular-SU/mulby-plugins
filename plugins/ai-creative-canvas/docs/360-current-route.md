# 360 全景 · 当前路线说明

> 更新：2026-07（专用模型路线验证阶段）

## 当前路线（在用）

1. **生成**：用户在图片卡参数中开启「360 全景」（`card.params.pano`），走 Mulby 原生 `ai.images` 文生图/图生图，由**支持全景的专用图像模型**出图（工程内按模型路由，见 `generate.ts` → `meta.pano`）。
2. **查看**：带 `meta.pano` 标记的图片卡用 `PanoViewer.tsx`（three.js 环视）打开。
3. **后处理（可选）**：
   - **接缝修复**（`mediaPano.repairEquirectSeam`）：水平半幅偏移 → 中缝 inpaint → 复位。不依赖渐进式 outpaint 主循环。
   - **天/地锚定修复**（`panoOutpaint.repairEquirectPoles`）：针对天花板/地板锚定重绘，仍走 `ai.images.edit`。

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
