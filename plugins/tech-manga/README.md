# 技术漫画生成器（tech-manga）

AI 技术漫画生成器 Mulby 插件。把技术文档、代码片段、Bug 报告、历史事件或人物传记改编成漫画：

1. **编写剧本**（流式输出）：自动分析素材类型（技术指南 / Bug 报告 / 历史事件 / 传记）并生成标题、画风描述、角色表、道具表、封面提示词和逐页分镜脚本（含中文对白）；
2. **资产工坊**（Asset Studio）：为每个角色和关键道具生成参考设定图，可重生成 / 上传替换；支持用哆啦A梦、皮卡丘等预设动漫角色出演，或自定义角色；
3. **剧本编辑**（Script & Storyboard）：逐字段编辑剧本，支持 AI 指令润色；
4. **逐页绘制**：以角色/道具参考图锁定形象一致性，逐页生成含简体中文对白的漫画页（代码与技术术语保留英文），支持单页重绘与提示词润色；
5. **导出**：一键打包下载全部页面（.zip）；内置 Token 用量与费用监控面板。

> 本插件由 [tech-manga](https://github.com/Unicellular-SU/tech-manga)（Google AI Studio 项目）迁移而来，AI 能力已全部改为 **Mulby AI 接口**（`window.mulby.ai`），不再需要 Google API Key——模型与密钥统一由 Mulby 管理。

## 使用前提

在 Mulby 设置 → AI 中配置：

- **至少一个文本模型**（剧本生成与润色；推荐支持 JSON 结构化输出的模型）；
- **至少一个「图像生成」端点类型的模型**（角色/道具/页面绘制）。
  - 角色与道具参考图一致性依赖**多图输入**能力（`images.edit` + 额外参考图），推荐 Gemini 系列图像模型；不支持多图的模型仍可生成，但形象一致性会下降。

## 触发方式

在 Mulby 输入框输入任一关键词，以独立窗口打开：

- `技术漫画`
- `科技漫画`
- `techmanga`

## 功能与配置

| 配置项 | 说明 |
|---|---|
| AI 模型 | 文本模型（默认用 Mulby 全局默认模型）与图像模型（默认用第一个可用的图像生成模型） |
| Comic Style | 24 种画风（黑白漫画、美漫、像素、水彩、赛博朋克、吉卜力、蒸汽朋克、Q版等），支持自定义 |
| Story Mode | 冲突 / 教学 / 悬疑 / 喜剧 / 异世界 / 职场 / 恐怖 / 科普 / 严肃历史（自动选角）/ 历史恶搞（角色扮演）/ 自定义 |
| Main Character | 预设动漫角色出演（哆啦A梦等）或自定义角色；严肃历史模式自动从素材提取真实人物 |
| Page Length / Panels | 篇幅（3-5 / 6-10 / 11-15 页）与每页分格数 |
| Format Ratio | 页面宽高比（1:1 / 3:4 / 4:3 / 16:9 / 9:16 / 2:3） |

## 开发

```bash
pnpm install        # 在仓库根执行
pnpm run build      # esbuild 后端 (dist/main.js) + vite 前端 (ui/index.html)
pnpm run pack       # 构建并打包 tech-manga-<version>.inplugin
```

## Mulby AI 迁移说明

| 原实现（Google GenAI SDK） | 现实现（Mulby AI） |
|---|---|
| `gemini-3-pro-preview` 流式 + responseSchema | `ai.call` 流式 + `params.responseFormat: 'json_object'` + prompt 内嵌 schema |
| `gemini-3-pro-preview` 文本/提示词润色 | `ai.call`（所选文本模型） |
| `gemini-3-pro-image-preview` 角色/道具参考图（文生图） | `ai.images.generate`（3:4 / 1:1 尺寸映射） |
| `gemini-3-pro-image-preview` 多参考图页面生成 | `ai.attachments.upload` + `ai.images.edit`（`referenceAttachmentIds` 多图一致性） |
| Token 用量（usageMetadata） | `ai.call` 返回的 `usage` / `images.*` 返回的 `tokens`，缺失时按字符估算 |

模型选择通过 `services/mulbyAiService.ts` 的 `setActiveModels()` 注入（App 在配置变化时调用），各组件的函数签名与 props 保持不变。

已知差异：

- 原实现页面图用 2K 分辨率；Mulby 侧统一按 size 映射（如 `1024x1536`），实际分辨率取决于所选模型。`images.edit` 不支持 size 参数，带参考图页面的宽高比仅由 prompt 提示约束。
- 界面费用为估算值（沿用原项目 Gemini 定价常数），不代表所选 Provider 的真实计费。

## 手动验收清单

1. Mulby 安装 `tech-manga-1.0.0.inplugin`（或开发者模式加载本目录），输入「技术漫画」应打开独立窗口；
2. 配置面板顶部能列出 Mulby 中配置的文本/图像模型；
3. 粘贴一段技术文档 → GENERATE COMIC：右侧日志流式滚动，完成后进入 Asset Studio 展示角色/道具表；
4. 角色与道具参考图可生成 / 重生成 / 上传；
5. Script & Storyboard 页可编辑剧本并 AI 润色；
6. Continue 进入 Comic Pages：封面与各页逐张生成，角色形象与参考图一致，代码术语保留英文；
7. 单页「重新生成」与提示词润色可用；
8. Token 监控面板数字随调用增长；Download Full Comic 能导出 zip。
