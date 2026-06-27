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
