# 恐怖漫画生成器（horror-manga）

AI 恐怖漫画生成器 Mulby 插件。输入一段恐怖故事大意，插件会：

1. **编写剧本**（流式输出）：自动生成漫画标题、整体画风、角色设定表、封面提示词和逐页分镜脚本（含中文对白与旁白）；
2. **角色定妆**（Review 阶段）：为每个角色生成参考立绘，可手动重生成 / 上传替换，并可用 AI 指令润色任意文本字段；
3. **逐页绘制**：以角色参考图锁定形象一致性，逐页生成含简体中文对白气泡的漫画页，支持单页重绘与提示词 AI 润色；
4. **导出**：可加文字/图片水印，一键打包下载全部页面（.zip）。

> 本插件由 [HorrorManga](https://github.com/Unicellular-SU/HorrorManga)（Google AI Studio 项目）迁移而来，AI 能力已全部改为 **Mulby AI 接口**（`window.mulby.ai`），不再需要 Google API Key 或自定义 OpenAI 兼容配置——模型与密钥统一由 Mulby 管理。

## 使用前提

在 Mulby 设置 → AI 中配置：

- **至少一个文本模型**（用于剧本生成与文本润色；推荐支持 JSON 结构化输出的模型）；
- **至少一个「图像生成」端点类型的模型**（用于封面/角色/页面绘制）。
  - 角色参考图一致性依赖**多图输入**能力（`images.edit` + 额外参考图），推荐 Gemini 系列图像模型（如 gemini-3-pro-image / nano-banana 类）；不支持多图的模型仍可生成，但角色形象一致性会下降。

## 触发方式

在 Mulby 输入框输入任一关键词，以独立窗口打开：

- `恐怖漫画`
- `horrormanga`
- `漫画生成`

## 功能与配置

| 配置项 | 说明 |
|---|---|
| Brain Source | 选择文本模型（默认用 Mulby 全局默认模型）与图像模型（默认用第一个可用的图像生成模型） |
| Art Style | 14 种大师画风（伊藤润二、楳图一雄、美式 EC、韩式条漫、克苏鲁等），支持自定义 |
| Color Mode | 黑白（漫画网点）/ 全彩 |
| Genre / Subgenre | 主类型 + 可选混合副类型（心理 / 猎奇 / 灵异 / 躯体恐怖 / 宇宙恐怖 / 科技 / 民俗 / 生存 / 怪兽） |
| Ending Style | 悲剧 / 开放 / 反转 / 循环 / 生还 / 惨胜 |
| Length / Panels | 篇幅（3-5 / 6-10 / 11-15 页）与每页分格数 |
| Format | 页面宽高比（1:1 / 3:4 / 4:3 / 16:9 / 9:16 / 2:3） |
| Cursed Seal | 水印：平铺/角标文字、居中/角标图片，透明度可调，支持逐页覆盖 |

界面右上角实时显示累计 Token 用量与估算费用（按原项目的定价模型估算，仅供参考）。

## 开发

```bash
pnpm install        # 在仓库根执行
pnpm run build      # esbuild 后端 (dist/main.js) + vite 前端 (ui/index.html)
pnpm run pack       # 构建并打包 horror-manga-<version>.inplugin
```

## Mulby AI 迁移说明

| 原实现（Google GenAI SDK / 自定义 OpenAI API） | 现实现（Mulby AI） |
|---|---|
| `gemini-3-pro-preview` 流式 + responseSchema | `ai.call` 流式 + `params.responseFormat: 'json_object'` + prompt 内嵌 schema |
| `gemini-2.5-flash` 文本润色 | `ai.call`（所选文本模型） |
| `gemini-3-pro-image-preview` 生图（文生图） | `ai.images.generate`（size 由宽高比映射） |
| `gemini-3-pro-image-preview` 多参考图生图 | `ai.attachments.upload` + `ai.images.edit`（`referenceAttachmentIds` 多图一致性） |
| `AbortController` 直接中止 SDK 请求 | 桥接为 `ai.abort(requestId)`（首个 chunk 的 `__requestId`） |
| Gemini `safetySettings`（BLOCK_NONE） | 无对应能力，由所选 Provider 的默认安全策略决定（迁移差异） |
| Token 用量（usageMetadata） | `ai.call` 返回的 `usage` / `images.*` 返回的 `tokens`，缺失时按字符估算 |

已知差异：

- 图像宽高比通过 `size`（如 `1024x1536`）+ prompt 提示实现；`images.edit` 不支持 size 参数，比例仅由 prompt 提示约束，实际输出比例取决于所选模型。
- 费用为估算值（沿用原项目 Gemini 定价常数），不代表所选 Provider 的真实计费。

## 手动验收清单

1. Mulby 安装 `horror-manga-1.0.0.inplugin`（或开发者模式加载本目录），输入「恐怖漫画」应打开独立窗口；
2. Brain Source 面板能列出 Mulby 中配置的文本/图像模型；
3. 输入一段故事 → MANIFEST HORROR：左侧日志流式滚动，完成后进入 Review 阶段展示剧本与角色表；
4. Review 阶段角色参考图自动生成，可重生成 / 上传，AI 润色指令生效；
5. 确认进入 Production：封面与各页逐张生成，含参考图的页面角色形象与参考图一致；
6. 单页「重新生成」与提示词 AI 润色可用；水印开关后图片即时更新；
7. 生成中点击 CANCEL RITUAL 能中止脚本流式输出；
8. Download Artifacts 能导出包含全部页面的 zip。
