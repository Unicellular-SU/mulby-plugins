# 3D 导演台 设计方案 · v1

> 适用插件：`mulby-plugins/plugins/ai-creative-canvas`（复用已引入的 three.js，动态分割）
> 目标：在 3D 场景里摆机位/主体做 blocking（previs），导出"结构化镜头提示词 + 控制/参考图"驱动 AI 生成。

## 一、调研（优秀开源 / 参考）
- **3D OpenPose Editor**（`nonnonstop/sd-webui-3d-open-pose-editor`、`ZhUyU1997/open-pose-editor`）、**Posex**：浏览器摆 3D 骨架/人台 + 移动相机，导出 **OpenPose / Depth / Normal / Canny** 控制图 → ControlNet。这是"3D blocking → AI 图像控制"的主流闭环。
- **three.js `PerspectiveCamera.setFocalLength`**（film gauge 默认 35mm）：内置镜头模型；与 AI-CanvasPro PanoramaScene 的焦段(16–135mm)+画幅(36mm) 一致。
- **Previs Pro / 虚拟制片 previs**：机位/焦段/镜别/调度的影视化元数据与 UX。
- **AI-CanvasPro PanoramaScene**（已有反混淆源）：GLTF 人台 + 摄影机位 + 360 环境 → 生成。

## 二、控制机制（决定精度上限）
- **强控制 = ControlNet（OpenPose/Depth/Canny）**：3D 渲染控制图 → 条件生成，姿态/构图被严格遵守。需 provider 支持控制模型（按"360 专用模型"同款 model id 路由接入）。
- **弱控制 = img2img 参考（通用 gpt-image-2）**：3D 视口截图/深度图当参考，引导布局/机位，但模型自由重绘、姿态不严格。
- 设计上两者都支持：默认走参考图；若配了"控制模型 id"则走控制图。

## 三、架构（DirectorStage，复用 three.js）
- `DirectorStage` 全屏 modal（`await import('three')` 动态分割，主包不增）：
  - **场景**：地面 + 网格 + 基础灯光。
  - **主体**：人台（GLTF）/ 道具代理；可移动/旋转/缩放（v1 摆位；v2 摆姿）。带标签（角色A/道具）。
  - **相机**：焦段(mm) + 35mm 画幅 → FOV（`setFocalLength`）；轨道/推拉；机位高度（低/平/高/俯）；镜别预设（特写/中景/全景 → 设距离/构图）。
  - **输出**：① 结构化镜头提示词（机位/角度/焦段/镜别/主体相对位置 → 中英文片段）；② 控制/参考图（视口截图 +（可选）深度图）。
  - **生成**：「用此机位生成」→ 新图像/视频卡（提示词 + 参考图/控制图），衔接分镜表/时间线。

## 四、分期
- **v1**：场景 + 可摆位主体 + 相机(焦段/镜别/角度) + **视口截图当参考** + 结构化提示词 → 生成。最快闭环。
- **v2**：可摆姿人台（GLTF rig + 关节）；**深度/OpenPose 控制图** + ControlNet 模型路由（若 provider 支持）。
- **v3**：多机位 shot list、与分镜表/时间线打通、镜头动画关键帧。

## 五、取舍 / 风险
- three 已是依赖，DirectorStage 动态分割 → 主包不增。
- **精度天花板取决于 provider 是否支持 ControlNet**；否则只能到"构图参考"级（与之前 360 的教训一致——根因常在 API 能力）。
- 主体资源：GLTF 人台需内置一个轻量 mannequin glb（注意体积）；或先用 primitive 代理（胶囊=人、盒=道具）零体积起步。

## 六、v1 实现（2026-06-28，已提交）
用户选定：轻量人台 + 视口截图当 img2img 参考。
- `DirectorStage` 全屏 modal（three + OrbitControls + TransformControls，全部 `await import` 动态分割，three 仍单独 chunk）。
- 人台=**程序化人形**（胶囊/球拼，零资源、零打包体积——无法内置真实 glb，遂用基础几何，视觉目的一致）；道具=盒。点选 → TransformControls 移动/旋转。
- 相机=视图（OrbitControls 转/推拉）；焦段滑杆（`setFocalLength`，filmGauge 36）；镜别预设（特写/中景/全景=调相机到 target 距离）；角度预设（仰/平/俯=调相机高度）。
- 「用此机位生成」：`shotFragment()` 由相机几何推导镜头提示词（焦段→镜头类型、俯仰角→仰/平/俯、距离→镜别）+ 用户场景描述 → 视口截图 `toDataURL` 当 `ai.images.edit` 的 img2img 参考 → 落图像卡（活动画布）。
- 入口：TopBar Clapperboard 按钮；模型用工程默认图像模型。
- 控制为「弱控制/构图参考」级（gpt-image-2 会自由重绘，灰模仅作站位/机位引导）。
- **v2**：可摆姿（关节）、深度/OpenPose 控制图 + ControlNet 路由、场景持久化、多机位 shot list、接分镜/时间线。

## 七、v2 增强（2026-06-28，已提交）
- **可摆姿人台**：人台改为关节层级（root + 头/左右肩·肘/左右髋·膝 joint 组）。「旋转/摆姿」模式下点关节即选中该关节，用 TransformControls 旋转掰姿势；「移动」模式操作整体。
- **复制 / 看向选中 / 删除**：复制 = clone(true) 偏移放置；看向 = 把相机 target 设到选中主体（快速框人）。
- **焦段预设** 24/35/50/85 一键；保留焦段滑杆 + 镜别(特写/中景/全景) + 角度(仰/平/俯)。
- **布局感知镜头提示词**：`shotFragment` 把各人台投影到相机 NDC → 居左/中/右 + 角色数量，连同 镜头/焦段/角度/镜别 一起写进生成提示，机位语义更准。
- 仍为弱控制（gpt-image-2 img2img 参考）；v3 再上深度/OpenPose ControlNet（需控制模型）、场景持久化、多机位 shot list、接分镜/时间线。

## 八、v3（2026-06-28，已提交）：ControlNet 强控制 + 场景持久化 + 多机位 shot list
- **ControlNet 强控制**：`ProjectDoc.defaultControlModel` + `setDefaultModel('control')` + ProjectSettings「ControlNet 控制模型」下拉。导出**深度控制图**（`MeshDepthMaterial` BasicDepthPacking + 临时 far=14 + 反相使近=亮，符合 controlnet-depth 约定）；配了控制模型时生成走「控制模型 + 深度图 + 严格据此构图/姿态」提示，否则回落「默认图像模型 + 截图参考」。
- **场景持久化**：`ProjectDoc.director`（subjects 含 kind/pos/rot/scale/关节欧拉角 + camera + shots + prompt）；`setDirectorScene`；打开恢复、关闭/Esc 保存（随分片 manifest 持久化）。
- **多机位 shot list**：右侧面板「+记录」当前机位为 shot、点 shot 切换机位、删除；「批量生成 N 机位」逐个 applyCam → 生成 → 成片在画布排成一行。生成不再自动关闭（便于多机位迭代）。
- 控制精度仍取决于 provider 是否真支持控制模型；未配则为构图参考级（已如实标注）。

## 九、摆姿优化（2026-06-28，已提交）
逐关节 gizmo 摆姿太繁琐 → 参考 Magic Poser/JustSketchMe/3D OpenPose Editor，加**一键预设**：
- **姿势预设**（站立/T姿/叉腰/举双手/招手/行走/坐/指向前）：`applyPose` 先清零关节再套预设欧拉角；选中人台时左面板出现。
- **整体朝向**（面向/背向/朝左/朝右）：`setFacing` 设 root.rotation.y（精确）。
- **姿势名写进生成提示**：`shotFragment` 输出「角色1居左(招手)」，即使灰模粗略，AI 也据姿势名渲染。
- 手动逐关节（旋转/摆姿点关节）保留作微调。预设欧拉角为粗摆估值，可按真机反馈微调正负号。
