# 360 全景 + 3D 导演台 设计方案（引入 three.js）· v1

> 适用插件：`mulby-plugins/plugins/ai-creative-canvas`
> 背景：自写 shader 版 360 查看器已能用，但通用模型出的"伪全景"几何不对 → 糊/拉伸/晕。
> 决策：引入 three.js，按开源最佳实践重做查看器，并改进生成；为后续 3D 导演台立基座。

## 一、调研结论（开源项目 / 论文 / 成熟查看器）

### 1.1 AI 生成等距柱状（equirectangular）的关键
- **专用模型 / LoRA 才出真等距柱状**（通用文生图只是"看着像全景的宽图"）：
  - Diffusion360 / `ArcherFMY/SD-T2I-360PanoImage`（论文 2311.13141）——**circular blending**：去噪每步把右部 latent 与左部按自适应权重混合 → 无缝。
  - PanFusion（双分支：透视分支 + 全景分支，共享 UNet + 各自 LoRA）。
  - ProGamerGov `360-Diffusion-LoRA-sd-v1-5` / `sdxl-360-diffusion`；Civitai「Flux Equirectangular 360° Panorama」LoRA。
  - DiT360 / SHERPA / TanDiT：DiT 架构 + circular padding（水平周期边界）。
- **触发词**：`equirectangular 360 view` / `360 panorama`。
- **比例**：严格 **2:1**（1024×512 / 1536×768 / 2048×1024…）。
- **无缝**：核心是 circular padding / circular blending（水平方向左右边缘信息互通）。ComfyUI 实践：`Make Circular VAE` + `Seamless Tile`（x 轴）。

### 1.2 查看器工程实践（three.js 官方例 / Pannellum / Photo-Sphere-Viewer）
- 源图 **2:1**；three.js 经典做法：`new SphereGeometry(r, 60, 40)` + `geometry.scale(-1,1,1)`（翻成内壁，从中心看**不镜像**）+ `MeshBasicMaterial({ map })`。
- **FOV 约束 40–100°**（我们取默认 60、范围 35–90）。
- **阻尼（damping）是"不晕"的关键**：`OrbitControls.enableDamping=true` + `dampingFactor`；`rotateSpeed` 取负 → 抓取手感。
- 用 `minPolarAngle/maxPolarAngle` 限制俯仰（避免怼极点畸变）。
- **清晰度**：贴图 `anisotropy = renderer.capabilities.getMaxAnisotropy()` + mipmap（`LinearMipmapLinearFilter`）+ `SRGBColorSpace`；源图越高越清晰（≥2K，理想 4K）。
- 进阶：little planet（stereographic 投影）、自动旋转、陀螺仪、热点标注。

> 来源：Diffusion360(arxiv 2311.13141)、PanFusion(chengzhag.github.io/publication/panfusion)、ProGamerGov 360-Diffusion(HF)、Civitai 735980、three.js webgl_panorama_equirectangular、Photo-Sphere-Viewer 文档、Pannellum。

## 二、方案（分两阶段）

### 阶段一（本期）：three.js 全景查看器 + 生成增强
1. **依赖**：`pnpm add three` + `-D @types/three`。**动态 import 代码分割**——`const THREE = await import('three')` 仅在打开 360 时拉取 three chunk，**主包体积不变**、画布启动不受拖累。
2. **PanoViewer（three 版，替换自写 shader）**：
   - 内壁球 `SphereGeometry(500,64,40).scale(-1,1,1)` + `MeshBasicMaterial{map}`；贴图 anisotropy=max + mipmap + sRGB。
   - 透视相机置于球心；`OrbitControls`：`enableDamping`、`rotateSpeed=-0.3`（抓取式 + 阻尼，治晕）、`enablePan=false`、`minDistance=maxDistance`（锁中心，仅转 + 改 FOV）、polar 限 ±85°。
   - 滚轮改 FOV（35–90，默认 60）。
   - 工具条：复位、自动旋转开关、little planet（stereographic）切换、当前视角截图（导出/当参考图）。
3. **生成增强**：
   - 强制 2:1 + ≥2K（已做）；触发词 `equirectangular 360 view` 注入（已有 panoHint，强化）。
   - **可选「专用 360 模型」**：参数里允许指定 equirectangular 模型 id（若 provider 提供 LoRA/专用模型），优先用它。
   - **成图后循环羽化** `seamBlendEquirect`：canvas 取右边缘一条带 wrap 混合到左边（poor-man's circular blend），减轻接缝；作为「修复接缝」按钮或全景生成后自动执行。
4. **期望管理**：通用模型仍是近似；最佳源 = 真实 360 相机的 2:1 等距柱状图（导入即用）或专用模型。

### 阶段二（后续独立期）：3D 导演台
- 复用 three：360 环境球作天空盒 + 内部放 **3D 人台（GLTF，参考 AI-CanvasPro 用 GLTFLoader/SkeletonUtils）**；摄影机位用焦段（16–135mm）+ 画幅（36mm）模型。
- 桥：机位/朝向/焦段/人台位置 → 结构化镜头提示词 + 视口截图当构图参考 → 生成图像/视频卡，衔接分镜表/时间线。
- 工程量大；本期先把 three 基座 + 查看器立起来，导演台在其上扩展。

## 三、风险 / 取舍
- **包体**：three 动态分割 → 主包不增；首次开 360 拉一次 chunk（~150KB gz，缓存后无感）。
- **真无缝 / 真等距柱状受模型根本限制**：查看器再好也救不了"假全景"的几何错误 → 生成端专用模型 / 真实源才是关键；循环羽化只治接缝、治不了投影错误。
- three.js 与现有自写画布共存：仅在 PanoViewer 全屏 modal 内使用，互不干扰。

## 四、实现进度
- **阶段一（2026-06-27，已提交）**：用户选定「生成端=通用模型+触发词+成图循环羽化」「查看器=核心版」。
  - 依赖：`three@0.169` + `@types/three`；`PanoViewer` 用 `await import('three')` **动态分割**——three 单独 chunk(~176KB gz)，主包不变(~132KB gz)，仅打开 360 时加载。
  - 查看器(three)：内壁球 `scale(-1,1,1)` 不镜像；贴图 `SRGBColorSpace + anisotropy=max + mipmap`(治糊)；抓取式拖动(对齐 three 官方)+ lerp 阻尼(治晕)；FOV 35–90 默认 60；俯仰 ±85；自动旋转 / 复位 / Esc。
  - 生成：`panoHint` 加英文触发词 `equirectangular 360 view, 360 panorama, seamless`；`seamBlendEquirect` 成图后循环羽化左右接缝(poor-man's circular blend)，全景生成自动执行；强制 2:1 + ≥2K(此前已做)。
  - 局限(已如实记录)：循环羽化只缓解拼缝、治不了"假等距柱状"的投影错误；真等距柱状仍需专用模型或真实 360 相机图。
- **阶段二（待启动）**：3D 导演台——复用 three 基座(360 环境球 + GLTF 人台 + 摄影机位 → 结构化镜头/截图参考 → 生成)。

## 五、生成质量增强 A+B+C（2026-06-28，已提交）
调研 GPT Image 2 社区方案后（提示词模板、偏移+生成式重绘、CubeDiff 立方体合并；羽化被确认效果差已弃用）：
- **A 提示词优化**：`panoHint` 换成 GPT Image 2 模板（equirectangular/cylindrical equidistant、2:1、左右无缝、光照一致、地平线居中、禁鱼眼·小行星）；**删除自动羽化**。
- **B 偏移+生成式重绘修缝** `mediaPano.repairEquirectSeam`：水平平移半幅→接缝移到画面中央→中缝挖透明带→图生图(`ai.images.edit`)按周边重绘接好→再平移半幅复位→落新全景卡。MediaToolbox 全景图加「修复接缝」(GitMerge)。替代羽化，质量高得多。
- **C 立方体 6 面合成** `mediaPano.generateCubemapPano` + `cubemapToEquirect`：用源卡提示词+模型生成 6 个 90° 透视面（同 seed/同风格利于一致）→ WebGL 显式 R/U 向量做 cubemap→equirect（readPixels 翻行）→ 落全景卡。MediaToolbox 图像卡加「6 面合成 360」(Boxes)。**实验性**：面间一致性靠尽力，可能有接面差异；天/地朝向若不对，调 `CUBE_FRAG` 对应面的 R/U 向量即可（已集中）。
- 模型前提：用户确认 provider 支持 gpt-image-2 / 图生图（B/C 依赖图生图）。

## 六、③ equirect 渐进式 outpaint（2026-06-28，已提交）
独立 6 面无法无缝（无共享上下文），改 Skybox 式渐进 outpaint。分步交付：
- **第 1 步 投影核心 + 自检**：`panoOutpaint.eqToPersp`/`perspToEqPaste` 两个 WebGL 投影 + `selfCheckProjection`（零 API，肉眼校几何）。实测：几何正确（不畸变/不翻转），仅默认朝向差 180°→ 用 `rollHalf`（半幅经度滚动）对齐查看器正前。
- **第 2 步 主循环** `progressiveEquirect`：正前 init(文生图)→ 水平绕圈(每 60°、重叠 30°)每块 `eqToPersp`(左已填/右透明)→图生图 outpaint 续画→`perspToEqPaste` 贴回 → 补天/地(lat±88) → `rollHalf` 对齐 → 落全景卡。约 8 次调用，边跑边更新进度。
- MediaToolbox：图像卡「渐进式合成 360」(Boxes，replaces cube)；全景图「投影自检」(Crosshair)。cube 旧实现保留未用。
- 待真机验证：outpaint 对透明洞的遵循度、绕圈接缝、天/地补全质量；不行再调 FOV/步长/overlap/提示词。

## 七、方案修正：放弃"从零渐进"，改"全局底图 + 锚定修复"（2026-06-28，已提交）
调研结论：从零链式 outpaint 是公认会"语义漂移 + 闭环失败"的（PanoDiffusion 等），复杂场景必错乱；
真正解决环形一致性要把 circular padding/旋转做进扩散采样循环（需模型/latent，通用 API 做不到）。
优秀 DIY 方案（DreamScene360 / L-MAGIC / PanoDreamer / Blockade Skybox）共性：**先一张全局连贯底图，再局部精修**，不是从零拼。
- **新默认工作流**：A 直接生成 equirect 底图（全局锚，不漂移）→ B 修接缝（偏移+重绘）→ **🆕 天/地锚定修复**。
- `panoOutpaint.repairEquirectPoles`：在已连贯底图上，把天顶/地心投影成透视（FOV 120 带一大圈真实周边当锚）→ 中心挖透明圆（`punchCircleCenter` r≈0.42S，只重绘畸变最重的极点）→ 方向专属强约束重绘（天花板/地板、禁家具立面）→ 贴回（同约定读写、列对齐、不需 rollHalf）。四周真实环带锁住语义 → 不再瞎画家具、不漂移。
- MediaToolbox 全景图加「天/地修复」(ArrowUpDown)。`progressiveEquirect`(从零渐进)保留为实验项，不推荐复杂场景用。

## 八、采纳 PanoDreamer 的 LLM 全局规划（2026-06-28，已提交）
读 PanoDreamer(2504.05152)：它强在 ① LLM 先把场景拆成各方向连贯描述；② warp+**严格 mask inpaint(SD2，mask 外逐像素不变)**保住锚 + GPT-4o 去重复物体；③ 360 专用极点 inpaint + 超分。
诊断：**我们 DIY 的真正天花板是 gpt-image-2 的 edit 不是严格 mask inpaint（它倾向重画整图），所以链式/warp 拼接必漂移**——非参数可救。
本次采纳成本最低、收益较确定的一点 ①：
- `planPanoViews(scene)`：文本模型(`ai.call`，用 project.defaultTextModel)把场景拆成 `{global,front,right,back,left,up,down}` 连贯 JSON。
- `progressiveEquirect`：init 用 plan.front；绕圈每步用 `cardinalDesc(plan,lon)`(就近方向描述)；天/地用 plan.up/down。
- `repairEquirectPoles`：天/地用 plan.up/down 的具体描述（如"中式吊顶藻井""木地板"）。
- 仍受 ② 的天花板限制，不会质变。真正一步到位仍建议接专用 360 模型/工作流(Skybox/RunningHub image-panorama-360/360 LoRA)。

## 九、删除渐进式合成，转专用 360 模型路线（2026-06-28）
渐进式 outpaint 效果差（受 gpt-image-2 edit 非严格 mask inpaint 的根本限制，复杂场景必漂移），按用户决定删除：
- 移除 `progressiveEquirect` + 工具条「渐进式合成 360」按钮；连带清理死代码：cubemap 6 面合成（`generateCubemapPano`/CUBE 着色器/转换器）、`selfCheckProjection`、`genFace`/`rollHalf`/`cardinalDesc`。
- 保留：360 查看器、直接生成全景(A)、接缝修复(B)、天/地锚定修复（对任意全景图仍有用）。
- **下一步**：接专用 360 生成（Skybox API / RunningHub image-panorama-360 工作流 / 360 equirect LoRA 模型）——一次出图即真无缝 equirect。待用户提供 endpoint/model 形态再设计接入。

## 十、接专用 360 模型（Provider model id 形态）（2026-06-28，已提交）
用户确认走"Provider 里的 360/equirect 专用模型 id"路线（最简形态）：
- `ProjectDoc.defaultPanoModel`；`graphStore.setDefaultModel` 扩展 'pano'；`ProjectSettings` 加「360 全景专用模型」下拉（选能直接出 equirect 的模型/LoRA）。
- `aiImage.generateImage`：`pano` 开启时优先用 `project.defaultPanoModel`（否则沿用卡片模型）；仍保留 2:1 + ≥2K + equirect 触发词提示（对专用模型多为有益的 trigger）。
- 用法：工程设置选 360 专用模型 → 卡片「全景·开」→ 生成即走该模型出真等距柱状；缝/天地若仍有小瑕疵可用既有「修复接缝」「天/地修复」收尾。
