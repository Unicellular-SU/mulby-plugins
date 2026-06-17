# AI 影视工坊（ai-film-studio）

> 无限画布 · 故事到影片 · 多模态 AI 工作流

在 Mulby 的无限画布上，用**可视化节点工作流**把"一段话 / 一个故事"逐步加工成短片：

```
故事 → 剧本 → 分镜 → 角色图/场景图 → 关键帧 → 视频片段 →（配音/字幕/合成）→ 成片
```

文本与图像默认复用 Mulby 宿主 AI（零配置）；视频由插件自管第三方供应商（如 fal.ai）。每个能力都是画布上的一个节点，连线即数据流，可分支、可重跑、可锁定。

---

## ✨ 功能特性

- **无限画布工作流**：基于 React Flow，拖拽添加节点、连线编排、缩放平移；连线带端口类型校验（`text/json/image/video/audio`）。
- **文本链路（零配置）**：故事梳理 → 剧本 → 分镜脚本，调用 `mulby.ai.call` 流式生成，结构化 JSON 输出。
- **图像链路（零配置）**：角色三视图 / 场景概念图 / 关键帧，调用 `mulby.ai.images`；支持参考图（img2img，`ai.images.edit`）保持角色一致性。
- **视频链路（自管供应商）**：图生视频 / 文生视频，统一异步三段式 `submit → poll → fetch`；内置 `fal` 与 `custom-http` 适配器；生成后自动下载落盘到本机。
- **多供应商管理**：增删供应商、节点级模型/供应商覆盖、连通性自测；API Key 走系统级加密存储（Keychain/DPAPI），结构中无明文。
- **工程持久化**：防抖自动保存、多工程切换、JSON 导入导出；图像存附件存储、视频落 `userData` 文件系统。
- **主题跟随宿主**：暗色优先，自动适配 Mulby 明/暗主题。

---

## 🧩 节点一览

| 分类 | 节点 | 输入 → 输出 | 说明 |
|---|---|---|---|
| 输入 | 故事输入 / 文本片段 | — → text | 原始素材 |
| 输入 | 参考图 | — → image | 本地上传，作为下游参考 |
| 输入 | 全局设定 | — → json | 画风 / 画幅 / 角色库 |
| 文本 | 剧本生成 | json/text → json | 分场剧本 |
| 文本 | 分镜脚本 | json → json | 镜头表（景别/运镜/时长/角色/场景） |
| 文本 | 角色设定 | json/text → json | 角色描述 + 三视图提示词 |
| 文本 | 提示词处理 | text → text | 扩写 / 中英互译 / 风格化 |
| 图像 | 角色三视图 | json → image | 前/侧/背 turnaround |
| 图像 | 场景概念图 | json/text → image | 场景设定图 |
| 图像 | 分镜关键帧 | json + 参考图 → image | 单镜首帧 |
| 视频 | 图生视频 I2V | image(首帧) + text → video | 关键帧动起来 |
| 视频 | 文生视频 T2V | text → video | 纯文本生成片段 |
| 音频 | 配音 TTS | text → audio | OpenAI 兼容语音合成（Key 加密存储） |
| 输出 | 预览 | any | 内联预览文本/图/视频/音频 |
| 输出 | 影片合成 | video×N + audio + json(分镜) → video | ffmpeg 归一+拼接，可选烧录/软字幕 + 配音混音 |
| 输出 | 导出 | video | 另存成片到本机指定位置 |

> 合成节点的「视频片段」端口可连多个视频节点，按拓扑顺序拼接；字幕由分镜 JSON 按片段时长生成。首次合成会自动下载 ffmpeg。

---

## 🚀 使用方法

1. 在 Mulby 中通过关键词 `故事画布` / `AI视频` / `分镜` / `影视工坊` 打开插件（独立窗口）。
2. 从左侧节点库拖拽节点到画布，按数据流连线（如 `故事输入 → 剧本生成 → 分镜脚本`）；或点顶栏「＋模板…」一键载入预置流水线（故事→分镜 / 完整影视流水线 / 片段→成片）。
3. 顶栏选择文本/图像模型（复用你在 Mulby 已配置的模型）。
4. 点击节点的「运行此节点」或顶栏「运行」执行全图（按拓扑顺序）。
5. 在右侧属性面板查看结果（JSON / 大图 / 视频播放器），可逐节点重跑。

### 配置视频供应商（生成视频前必做）

视频能力 Mulby 不内置，需自管供应商：

1. 顶栏点击「视频供应商」打开设置弹窗。
2. 新增供应商，选择类型：
   - **fal**：填 `model`（如 `fal-ai/...`）+ API Key，一个 Key 覆盖 Kling/Veo/Sora/Seedance 等。
   - **custom-http**：填 `submit` / `poll` 接口 URL 与结果字段的 JSON 路径（留空按常见命名自动尝试），兜底任意供应商。
3. 填入 API Key（密文存储），可点「测试连接」做轻量连通自测。
4. 回到画布，把关键帧接到「图生视频」节点（或文本接「文生视频」）后运行。

> **API Key 安全**：所有 Key 通过 `storage.encrypted`（macOS Keychain / Windows DPAPI / Linux Secret Service）加密存储，工程与供应商结构里只保存键名引用，绝不落明文。

---

## 🛠 开发与构建

```bash
npm install        # 安装依赖
npm run build      # 构建：esbuild 后端(dist/main.js) + vite 前端(ui/)
npm run pack       # 打包为 .inplugin（需要 mulby CLI）
```

- 后端 `src/main.ts`：视频下载落盘、配音合成（M5）、文件导出等 RPC。
- 前端 `src/ui/`：画布、节点、引擎与供应商适配器。AI 文本/图像调用放前端（避免 IPC 超时、便于流式）。

### 目录结构

```
src/
  main.ts                  # 后端：下载/落盘/导出 RPC
  types/mulby.d.ts         # 宿主 API 类型
  ui/
    App.tsx  main.tsx  styles.css  index.html
    nodes/nodeDefs.ts      # 节点定义（端口/参数/图标）
    store/                 # graphStore（图+运行+持久化）/ providerStore
    components/            # FlowCanvas / Toolbar / NodeLibrary / Inspector / ProviderSettings / nodes
    services/
      textEngine / imageEngine / models / prompts / jsonParse / executor
      assets（storage.attachment）/ keys（storage.encrypted）/ download
      providers/           # fal / customHttp / http / test / index(runVideo)
```

---

## ✅ Mulby 内手动验收清单

- [ ] 关键词能打开插件，画布可拖拽/连线/缩放/平移。
- [ ] `故事输入 → 剧本生成 → 分镜脚本` 连线后运行，得到结构化剧本与分镜表。
- [ ] 选择图像模型，由分镜/角色设定生成关键帧 / 三视图 / 场景图，节点显示缩略图。
- [ ] 上传参考图接入关键帧，触发 img2img（一致性）。
- [ ] 配置 fal 供应商并「测试连接」通过；关键帧 → 图生视频，节点内联播放。
- [ ] 视频生成后自动落盘，属性面板可「打开文件夹」。
- [ ] 配音节点填入 TTS API Key（加密保存），由文本合成音频并播放。
- [ ] 多个视频片段 + 分镜(字幕) + 配音 → 影片合成节点「运行」，首次自动下载 ffmpeg，得到带字幕/配音的成片。
- [ ] 导出节点把成片另存到指定位置。
- [ ] 新建/切换/重命名/删除工程；导入导出 JSON；重开后图像与工程恢复。
- [ ] 切换 Mulby 明/暗主题，界面跟随。

---

## 📌 依赖与前置

- Mulby 宿主（提供 `ai` / `storage` / `http` / `filesystem` / `security` 等 API）。
- 文本/图像：需在 Mulby 设置中已配置至少一个文本模型与图像模型（否则相应节点不可用）。
- 视频：需用户自带第三方供应商账号与 API Key。

---

## 🗺 里程碑

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M0 | 脚手架 + 可用画布 | ✅ |
| M1 | 文本链路（故事→剧本→分镜） | ✅ |
| M2 | 图像链路（角色/场景/关键帧） | ✅ |
| M3 | 视频链路（关键帧→视频） | ✅ |
| M4 | 供应商管理增强（覆盖/自测/落盘/img2img） | ✅ |
| M5 | 合成导出（配音/字幕 + ffmpeg 合成 + 导出） | ✅ |
| M6 | 打磨（工作流模板 / 音频导入 / 错误汇总 / `.inplugin` 打包） | ✅ |
| M7 | 一致性与扇出（自动 N→N、项目级全局设定、Inspector 重做） | ✅ |

> **自动扇出**：N 个角色→N 张三视图、N 个镜头→N 个关键帧→N 个视频，合成节点自动收齐所有片段。**全局设定**（顶栏 🎨）的画风/画幅自动注入所有生成节点并决定尺寸。显式 ForEach/Merge 控制流仍为后续里程碑。

详见 `mulby-plugins/docs/ai-film-studio-design.md`。
