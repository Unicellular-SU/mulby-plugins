# ai-creative-canvas 单卡视频剪辑工作台 · 完整设计方案（最终稿）

> 面向开发者落地 · 复用优先 · 单次编码优先 · canvas→PNG→overlay 处理一切文字图形
> 硬约束：单次 `window.mulby.ffmpeg.run` + 无 ffprobe（用 `probeDuration`）+ 无内置字体（drawtext/subtitles 不可用）

---

## ① 现状与差距

当前单卡视频能力分散为一排「一次性工具按钮」（`mediaVideo.ts` 提供、`mediaOps.ts:runVideoTool` 派发、`MediaToolbox.tsx` 暴露），范式是「一次 ffmpeg run → 落新卡（`newMediaCard`），源卡保留」。逐域盘点差距：

| 域 | 已有 | 缺口 |
|---|---|---|
| 裁切与分段 | `VideoTrimModal` 双手柄 in/out（`clip`）；`sceneFrames` 仅出代表帧；`TimelineModal` 多卡拼接 | 单卡内剃刀分割、删中段接合、波纹删除、多段保留、**标记点/章节批处理** |
| 变速与时间 | 仅 `reverse` | 匀速变速、定格、回旋、速度曲线、补帧慢动作全缺 |
| 几何与构图 | 视频侧为零（图片有 crop） | 裁画面、旋转翻转、改画幅+模糊背景、Ken-Burns、防抖全缺 |
| 调色与滤镜 | 完全没有 | 亮度/对比/饱和/色温/曲线/LUT/锐化/降噪/暗角/风格预设全缺 |
| 文字与叠加 | 没有；有 `runCollage` 的 canvas 合成先例 | 标题/字幕/水印/进度条/时间码/贴纸/PiP/马赛克全缺 |
| 音频 | `splitAudio`/`stripAudio`；多卡 `composeFilm` 混音 | 单卡音量/淡变/降噪/ducking/变声/响度归一缺；**无波形可视化** |
| 字幕/对白 | 无 | **字幕数据模型 + cue 时间轴轨编辑器**整体缺位（独立子系统，非某 op 的参数） |
| 特效与转场 | 多卡 `xfade/fade/concat`；`chromakey` | 单卡 PiP/分屏/glitch/残影/抖动/打码缺 |
| 输出与格式 | `compress(CRF28)`/`toGif`/`frameAt` | 可调导出面板、平台预设、WebP/APNG、封面选择、目标体积缺 |
| AI 增强 | 后端 `rpc.synthSpeech`(TTS)、`downloadMedia` | 配音可做；ASR/超分/智能抠像缺（需新后端或无模型） |

**用户诉求**：「创意画布里的视频剪辑功能现在只有裁切，太简单了」——本方案把上述域系统补齐，并把零散按钮收编进**统一的非破坏式剪辑工作台（VideoStudioModal，单一 Modal）**。

**明确剔除（infeasible / 需新后端）**：曲线变速（逐帧 PTS 表，单命令无法表达）、vidstab 高质量防抖（两遍，退化为单遍 deshake）、AI 智能抠像 / AI 超分（无模型）、ASR 语音转字幕（需新增后端 Whisper 类 RPC）。详见第⑧章「不做的边界」。

---

## ② 设计目标与原则

1. **卡级非破坏**：每次操作产出新卡（`newMediaCard`），源卡保留；编辑配方序列化进 `card.meta`，可二次编辑、可重放。**默认且唯一推荐入口是「导出新卡」**；不提供「原地覆盖 updateCard 改 assetUrl」（破坏 refIds 可追溯性，与本哲学相悖，见 §5.2）。
2. **单次编码优先**：一条 `-filter_complex`（或 `-vf`/`-af`）= 一遍 encode。唯一允许两遍的是 loudnorm 精确模式与目标体积 ABR，且必须在 UI 显式标注「较慢」。
3. **复用优先**：每条提案点名要扩展的现有 `file:function`，核心 `mediaVideo.ts` 只「加函数不改旧函数」（唯一例外是 `runFf`/`probeDuration` 加可选 `signal` 参数，签名向后兼容）；旧单按钮工具与两个 Modal 全部保活。
4. **canvas→PNG→overlay 处理一切文字图形**：绕开无字体，复用 `runCollage` 先例；样式比 drawtext 更强（任意字体/emoji/描边/阴影）。
5. **无 ffprobe**：时长一律 `probeDuration`（缓存进 meta）；尺寸用 ffmpeg 表达式相对量，JS 侧从 `<video>` 读（见 §8.1 方向校正）。
6. **容错退化**：每个有构建依赖风险的滤镜配明确退化路径（仿 `chromakey`、`composeFilm` 无音轨退化），失败 toast 告知具体 op 名。

---

## ③ 核心架构 —— 非破坏式编辑工作台

### 3.0 取消能力与撤销栈（地基的地基，P0 第 0 项）

这两项是工作台一切操作的前置，必须先于 EditStack 落地。

**(a) 可取消的 ffmpeg 执行**（核实 `mediaVideo.ts:34-39` 与 `:228-242`）

现 `runFf` 与 `probeDuration` 都 `const task = ff().run(...)` 后 `await task.promise`，**task 被丢弃，无处持有，无法 kill**。所有现有调用方（clip/toGif/compose…）都是「一次性 await」形态。打开工作台第一步就是 `probeDuration` 解码全片，长视频这步**不可中止 = 工作台一打开就卡死**。改造：

```ts
// runFf 新签名（旧调用方传 undefined 即兼容）
async function runFf(args: string[], onProgress?: (p:number)=>void, signal?: AbortSignal): Promise<void> {
  const task = ff().run(args, (pr:any)=>{ if (onProgress && typeof pr?.percent==='number') onProgress(Math.min(1, pr.percent/100)) })
  signal?.addEventListener('abort', () => task.kill())
  await task.promise
}
// probeDuration 同步加 signal，并把 task.kill 接到 abort（长视频解码可中止）
```

凡 §7 列为「可取消」的函数（slowmo/transcode/two-pass/keepSegments 大段 concat/probeDuration）一律把 `signal` 贯穿到底——这**不是改一处**，是把 `signal` 接进每个目标函数的签名。工作台导出持一个 `AbortController`，取消 → abort → kill → 删半成品 → toast（与 `generate.ts` 的 aborters 模式一致）。**列 P0 第 0 项，排在 EditStack 之前。**

**(b) 工作台编辑历史（undo/redo）**

画布主图的撤销在 `graphStore`，但工作台是**独立会话态**，反复增删 op / 改参数没有 undo/redo 就不可用。工作台自带一个轻量 ops 历史栈：

```ts
// 工作台会话 zustand slice
opsHistory: EditStack[]   // 每次「结构性变更」(增删 op / 重排 / 改参数 commit) push 一个深拷贝快照
opsCursor: number         // 当前指针；undo=cursor--，redo=cursor++
// 滑块连续拖动用节流，松手(onChangeCommitted)才入栈，避免一拖 100 个快照
```

Ctrl+Z / Ctrl+Y 绑定（`useEscClose` 同层加键监听）。这是工作台级刚需，与画布撤销互不干扰。**列 P0 架构。**

### 3.1 编辑栈数据结构（EditStack / EditOp）

单卡剪辑 = 一条**有序、可启停、可重排的操作链**（`EditOp[]`），全程只描述「要做什么」，提交时才编译成 ffmpeg。栈存在临时编辑会话里，导出时序列化进结果卡 `card.meta.editRecipe`。

```ts
// 新增 src/ui/services/videoEdit/types.ts
export type OpKind =
  | 'trim' | 'speed' | 'transform' | 'color' | 'overlay' | 'audio' | 'export'

export interface BaseOp {
  id: string            // nanoid，UI key & 选中态
  kind: OpKind
  enabled: boolean      // 旁路开关：false=编译时跳过（便于 A/B）
  label?: string        // 用户可改名
  preset?: string
  params: Record<string, unknown>
}
export interface EditStack {
  ops: BaseOp[]         // 顺序=语义顺序；export 强制置尾
  version: 1
  baseDuration: number  // probeDuration 一次，缓存
  baseW: number; baseH: number       // 方向校正后的真实显示宽高（见 §8.1）
  baseRotation?: 0|90|180|270         // 容器 rotate 元数据，供编译器显式 transpose
  needsNormalize?: boolean            // 入栈预检判定为 VFR/source/透明 webm 时置 true
}
```

各 op `params` 关键字段：
- **trim**：`{ segments: {in,out,keep}[] }`（**in/out 恒为源时间基**，见 §3.2 时间基规则）
- **speed**：`{ rate /*0.25–4*/, reverse, pitchCompensate }`
- **transform**：`{ crop?, rotate?, hflip?, vflip?, fit?, outAspect?, kenBurns? }`
- **color**：`{ brightness,contrast,saturation,gamma,temp,tint,sharpen,vignette,blur, lutPath? }`
- **overlay**：`{ sub:'text'|'watermark'|'progress'|'timecode'|'sticker'|'pip'|'mosaic', rect, enable?, anim?, style }`（enable 的 a/b **存源时间基**，编译器按 rate 折算）
- **audio**：`{ volume?, fadeIn?, fadeOut?, loudnorm?, denoise?, duck? }`
- **export**：`{ w?,h?, fps?, crf?, bitrate?, format, platform? }`

`enabled=false` 编译跳过、预览不施加。纯 JSON 可序列化——存进 `card.meta` 可二次编辑的前提。

**不入栈的「一次性裂变」操作**（`toGif` 整片、抽帧、镜头检测、提音轨、按标记批量分割导出多卡）保持旧 `runVideoTool` 单按钮范式——产出多卡/异类卡，与「叠加成一条片」的栈模型正交。

### 3.2 滤镜图编译器（compileStack → ffmpeg.run）

新增 `src/ui/services/videoEdit/compile.ts`，核心：

```ts
compileStack(stack, ctx) → {
  passes: { args: string[]; outPath: string }[]   // 顺序执行，前遍 outPath 作次遍输入
  prepares: () => Promise<string[]>                // 生成 overlay PNG 等，返回已落盘临时文件清单
  cleanup: string[]                                // 中间产物 + 孤儿 PNG，finally unlink
}
```

**时间基规则（编辑器最核心的语义，必须钉死）**
- **trim 的 in/out 恒为源时间基**，编译时**永远最先施加**。UI 里用户在「变速/几何后的预览时间轴」拖 trim 手柄，UI 层负责把拖到的预览秒**映射回源秒**（除以累计 rate）再写入 op。
- **变速/几何/overlay 的时间表达式由编译器按 rate 重映射**：overlay 在编译顺序里位于 setpts 之后，此时 `t` 已是变速后时间轴；用户在原速预览设的 `enable=between(t,a,b)` 的 a/b 是源时间，编译器必须 `a' = a / cumulativeRate`、`b' = b / cumulativeRate`。zoompan/crop(t) 同理。**漏掉此折算 → 变速存在时所有时间窗错位。**

> **【P0 实现修订】** 已落地的 `compile.ts` 改用更简单且等价的方案：**overlay/audio 的时间窗 (start,end) 直接以「输出时间基」存储**（即叠加/音频面板编辑时预览呈现的 post-trim/post-speed 成片时间轴），编译器**不再做 rate/trim 折算**。理由：叠加面板的预览本就是变速/裁切后的成片，用户天然在输出时间轴上选窗；存输出时间避免了 trim 跨段 + 变速双重折算这一整类错位 bug。trim 的 in/out 仍恒为源时间基。

**视频链固定顺序（不随 UI 重排打乱物理正确性）**
```
trim → setpts(变速) → [方向校正 transpose] → crop/flip/scale/pad/zoompan
  → eq,colorbalance,hue,curves/lut3d,unsharp,vignette,boxblur
  → overlay×N → format=yuv420p
```
理由：trim 先做减帧；变速改 PTS 必须在时间表达式之前确定时间基；overlay 必在调色之后（水印不被染色）。UI 允许「几何/调色/叠加」**内部**重排，跨大类顺序编译器钉死（对应 §5.1 的分区显示）。

音频链固定顺序：`atempo(随 speed) → areverse(随 reverse) → volume → afade → afftdn → loudnorm → [sidechaincompress 引第二输入]`。

**`-vf` vs `-filter_complex`**：纯单链无多输入 → `-vf`/`-af`；trim 多段 concat / overlay 引第二输入 / sidechain / blurpad → `-filter_complex`（具名标签 `[v0][wm]…`，复刻 `buildComposeArgs` 的 parts/labels 拼接）。

**多 pass 状态机（compileStack 返回 `passes[]`，执行器统一处理）**
- 自动追加第二遍的场景：`export.format=gif/webp`（编辑成 mp4 一遍 + 转 GIF 一遍，复用旧 toGif 滤镜）；loudnorm 精测双通（默认单遍）；目标体积 ABR 两遍。
- 执行器契约：**顺序跑 passes，首遍 outPath 作次遍 `-i`；进度按 passes 数均分（0–0.5 / 0.5–1，仿 composeTimeline）；每遍开始前检查 `signal.aborted`（取消可发生在两遍之间）；`finally` 一律 unlink 中间产物与全部孤儿 PNG（`cleanup`）。**
- 这填上了「§3.2 编译器接口 ↔ §8.6 取消模型」之间的缝。

**prepares 事务性**：`prepares()` 生成全部 overlay PNG（canvas 渲染落盘）。**必须「全部成功才进 passes，任一失败（canvas OOM/字体缺）→ unlink 已落 PNG 并抛」**，不留孤儿、不跑半截 run。

**编译器硬规则（内建，违反即报错）**
1. **同一 pad 只能消费一次**：凡需把 `[0:v]` 既作底图又作裁源（mosaic/mirror/privacy-blur/spotlight），必须先 `split=N`（`asplit` 对音频）。selfsplit 是正确模板。
2. **输入数上限而非层数上限**：overlay 预设按「展开后 `-i` 总数 ≤12」限流，超限自动拆成多次串行 run（前次输出作下次输入），对用户仍是一次操作落一张卡。timecode/字幕用精灵图把 N 路压到 1。
3. **表达式集中生成**：atempo 链、zoompan/crop(t)/overlay(t)、between() 一律由工具函数拼字符串，逗号 `\,`、Windows 冒号 `\:` 转义，配单测样例。
4. **逐帧表达式标记**：eq 闪烁须 `eval=frame`；crop 的 x/y 默认逐帧。

### 3.3 HTML5 近似实时预览引擎

新增 `src/ui/services/videoEdit/preview.ts`：`stackToPreview(stack) → { videoStyle, videoRate, clipPath, overlays, audioHint, exact }`，组件声明式渲染，**调参不触发任何 ffmpeg**。

逐 op 浏览器近似（纯 CSS/属性变更，`<video>` 只挂载一次）：
- **speed** → `video.playbackRate`；reverse → `exact=false`，仅时间轴反向标尺。
- **trim** → 播放区间约束（复用 `VideoTrimModal` 的 in/out 跳转）；多段标灰跳过。
- **transform** → 外层 `aspect-box` + `<video>` 套 `transform: rotate() scaleX(-1)` + `object-fit` + `clip-path: inset()`；blurpad 用底层同源 `<video>` 加 `filter:blur()`；Ken-Burns 用 CSS `@keyframes`。
- **color** → 多数映射 CSS `filter`；色温/暗角/锐化/曲线/LUT **映射不了** → `exact=false` + 角标「近似预览，导出更准」。
- **overlay** → 拿当场画的 PNG 绝对定位 DOM 叠在 `<video>` 上（与最终 overlay 同一张 PNG，**这是预览最准的一类**）；PiP=叠第二张卡 `<video>`；马赛克=`backdrop-filter:blur()`。
- **audio** → volume 映射 `video.volume`；fade 用 `timeupdate`；降噪/duck/loudnorm 无法预览，仅标注（音频域真正可视化靠波形条，见 §4.6）。

**精确预览（escape hatch）**：栈含 `exact=false` 硬 op 且点「精确预览」时，对当前 `currentTime` 附近取**短代理片段**（export 的 1/3 分辨率、5–8s、`-preset ultrafast`）跑一次真 ffmpeg，塞进隐藏 `<video>` 覆盖播放。按「栈指纹（去 export 的 hash）」缓存复用，**可取消**（同 abort 机制）。

**代理预览的 UI 状态（成败点，必须明确）**：点「精确预览」→ 预览区进入 `proxy-building` 态：保留旧近似画面 + 角标「精确预览生成中…（可取消）」+ 进度条；编码完成切到代理 `<video>`；**编码期间继续调参 → 标记当前代理过期，角标变「参数已变，点此重算」**，不自动重跑（避免连环编码）。代理过期/会话结束即清理其临时文件。

**A/B 与精确预览的联动（否则 A/B 不可信）**：操作栈的 👁 启停做 A/B 对比时，若被切换的 op 或栈内任一启用 op 是 `exact=false`，**👁 切换自动触发一次精确代理预览**，让用户看到的是导出真差异而非 CSS 近似差异。纯 `exact=true` 栈才允许停留在 CSS 近似 A/B。

**重渲染抑制**：预览状态单独 zustand slice，滑块受控 + `requestAnimationFrame` 节流写 CSS 变量；overlay PNG 仅在「非位置参数」变更时重画（位置/缩放纯 CSS transform）。

### 3.4 关键帧 / 包络模型

**不做通用逐帧关键帧编辑器**（单命令 + 无字体下不现实），改提供少量参数化包络原语，每个一条 ffmpeg 表达式可表达：

**能做（单命令）**：Ken-Burns 两点包络（图片 `zoompan` / 视频 `crop(t)+scale`，2 关键帧）；音量包络（`afade in/out` + `volume:enable='between(t,..)'`，BGM 闪避用 `sidechaincompress` 自动包络）；叠加动画（overlay 的 `x='t*…'`、`enable`、PNG alpha 随 t）；定格（`tpad`/末帧 loop）；匀速变速。

**叠加时间窗的 t 折算**：overlay 在 setpts 之后，所有 `enable=between(t,a,b)` 的 a/b 须按 §3.2 时间基规则乘以累计 rate 的倒数。

**不做**：曲线变速、任意 N 帧动画（仅「两点+缓动」档位）、遮罩/运动跟踪。

**数据表达**：`{ from, to, ease:'linear'|'easeInOut', range:{start,end} }`，UI 呈现「起始值/结束值/缓动/作用区间」四控件，诚实于能力边界。

### 3.5 字幕/对白编辑器（独立子系统）

**这是独立能力大类，不是 overlay 的一个 sub 参数。** 手动字幕没有行级时间轴编辑面板就不可用，单列里程碑（P1 末 / P2）。

**数据模型**（存 `card.meta.subtitles`，纯 JSON）：
```ts
meta.subtitles = {
  cues: { id, start, end, text, style }[]   // start/end 源时间基
  defaultStyle: { font, size, color, stroke, bg, posY }
}
```

**编辑器 UI**：时间轴下方独立 **cue 轨**（与视频轨分层，见 §5.1）——每条 cue 一个色块，支持：拖动改起止、拖边沿改时长、双击改文、回车切下一条、导入 `.srt`、AI 润色（`ai.chat`）。

**.srt 读取（修正 GBK 兜底，核实 `media.ts:88-89` 已有 `readFile(path,'base64')` + `base64ToArrayBuffer`）**：`mulby.filesystem.readFile` 仅支持 `'utf-8' | 'base64'`，**不能直出原始字节**。GBK 解码路径：
```
readFile(path, 'base64') → base64ToArrayBuffer(util) → new TextDecoder('gbk').decode(buf)
```
（先 `'utf-8'` 读会损坏 GBK 文件——删掉「readFile 直出 GBK 文本」的错误描述。）

**渲染**：每条 cue 由 `mediaOverlay.ts` canvas 渲 PNG → `overlay=enable='between(t,start,end)'`（start/end 经 §3.2 折算）。cue 多（>60）分批多次串行 run（每批单次、跨批链式）。

**ASR 自动转写明确不可行**：宿主仅 `ai.chat(vision)` + `rpc.synthSpeech(TTS)`，无音频→文本原语，需新增后端 Whisper 类 RPC，列后续。本子系统只做手动 / 导入 .srt / AI 润色。

---

## ④ 能力清单（按域）

> 每条：效果 / ffmpeg 方案 / UI 与预览 / 复用点 / 可行性与规避 / 优先级。risky 项给出已修正的可落地写法。

### 4.1 裁切与分段

**[P0] 多段保留 / 删中段 / 波纹删除（keepSegments）**
- ffmpeg（单次）：每区间 `[0:v]trim=Si:Ei,setpts=PTS-STARTPTS[vi]` + `[0:a]atrim=Si:Ei,asetpts=PTS-STARTPTS[ai]`，再 `concat=n=N:v=1:a=1`。**末段省 `end`** 规避 probeDuration 近似误差。无音轨退化三处同改：去 atrim 链 + concat `a=0` + 删 `-map [a]`（仿 `composeFilm`）。
- UI：`VideoTrimModal` 双手柄升级多手柄；保留段高亮、删除段灰罩。
- 复用：扩展 `mediaVideo.ts` 新增 `keepSegments`；`runVideoTool` 加 case；时间轴抽 `<TimelineStrip>`。
- 规避：端点 baseDuration clamp；补集前排序合并重叠区间；段数 ≤12。**feasible**。

**[P0] 标记点 / 章节 + 按标记批量分割（markers）**
- 高频剪辑动作：播放头打标记 → 按标记批量分割成多卡 / 批量导出。属「一次性裂变」（多卡），不入 EditStack。
- ffmpeg：每相邻标记区间逐段调现成 `clip()`（N 次独立 run，`createLimiter(2)` 串行，进度累加）。
- UI：时间轴上方标记轨，点击打点/拖动/删除；「按标记分割」一键出 N 卡。**feasible**。

**[P0] 播放头分割成多卡（splitAt）**
- ffmpeg：N 切点逐段调 `clip()`（放弃 split 多输出 map 到多文件，更脆）。过滤 <0.1s 空段；串行 + 进度累加。**feasible**。

**[P1] 提取片段 / 追加 / 双卡快速拼接**
- 提取=`runVideoTool('clip')`；追加/拼接=复用 `composeFilm({transition:'none'})`（已对异分辨率/帧率归一、音轨 concat、无音轨退化）。过滤有 `assetLocalPath` 的 video 卡；K ≤8 超出引导 TimelineModal。**feasible**。

**[P2] 循环重复（loopClip）**：放弃 `-stream_loop`，用 keepSegments 同引擎把整片重复 N 次（setpts 重排必连续无缝、音画同步）。N ≤20。**feasible**。

**[P2] 帧级步进精修（frame-step）**：纯前端时间轴交互无新编码；可选 `frameAt` 抽单帧精准预览。无 ffprobe 拿不到真 fps → 标「近似帧」让用户选常见帧率，或从 `probeDuration` 的 onProgress frame/time 估算平均 fps。**feasible**。

### 4.2 变速与时间

**[P0] 匀速变速（speed-uniform）**：`[0:v]setpts=PTS/{r}[v];[0:a]{atempoChain}[a]`。`buildAtempoChain(r)` 用对数循环把任意 `r∈[0.25,4]` 分解到每因子 `∈[0.5,2.0]`，`toFixed(4)` 防漂移。倍率滑块 `video.playbackRate` 即时预览，无音轨退 `-an`。**feasible**。

**[P0] 倒放收编（speed-reverse）**：与变速合并 `[0:v]reverse,setpts=PTS/{r}[v];[0:a]areverse,{atempoChain}[a]`（reverse 在 setpts 前）。从 MediaToolbox 移除独立按钮，收编进「时间」面板。**feasible**。

**[P1] 定格/冻结帧（freeze）**：默认「片尾冻结」零风险（`tpad=stop_mode=clone:stop_duration={hold}` + `apad=pad_dur={hold}`）。中段冻结用 `select='eq(n,round(t*FR))'` + 音频对称 `atrim/anullsrc/concat`，失败退片尾档 + toast。**feasible**。

**[P1] 回旋 boomerang**：`[0:v]split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1[v]` -an。reverse 整段入内存 → UI 引导先裁 ≤3s。**feasible**。

**[P1] 速度曲线 speed-ramp**：N+1 段各 `trim+setpts/ri`，音频 `atrim+asetpts+atempoChain(ri)` 各自 concat，端点用**同一浮点数组**勿各自取整。时间轴多切点 + 每段倍率滑块。**feasible**。

**[P2] 平滑慢动作（slowmo-interpolate）**：`minterpolate=fps={N}:mi_mode=mci:mc_mode=obmc,setpts=PTS/{r}` -an；fast 档去 vsbmc、前置 scale 720p。**本批最大构建/性能不确定点** → try 主命令 catch 退 `setpts=PTS/r,fps=N`（复帧版）+ toast；**必须接 signal 可中止**，UI 强提示耗时。**risky，带退化 + 可取消**。

**[P2] 时间预设组合**：子弹时间/电影升格/卡点定格/萌趣回旋 = 各原子 op 固定参数，intensity 用 probeDuration 换算绝对切点。**feasible**。

**[P3] 抽帧定格风格（framestep）**：跳帧只用 `fps={lowFps}` 不叠 setpts（不改时长、`-c:a copy` 同步）；残像 `tmix=frames={n}`（≤5）。**feasible**。

### 4.3 几何与构图

**[P0] 画面裁切（crop）**：`crop=trunc(iw*{w}/2)*2:trunc(ih*{h}/2)*2:trunc(iw*{x}):trunc(ih*{y}),setsar=1,format=yuv420p -c:a copy`，x/y/w/h 为 0..1。JS 端 clamp（`w=min(w,1-x)`）。复刻 `CropModal` 拖框 + CSS `clip-path` 预览。**feasible**。

**[P0] 旋转/转置/翻转（transform-rotate）**：90° 族 `transpose=1/2`、180=`transpose=1,transpose=1`；`hflip`/`vflip`；任意角 `rotate={deg}*PI/180:fillcolor=black` + `setsar=1`。透明角仅 webm/vp9，mp4 退黑底标注。CSS `transform` 预览。**feasible**。

**[P0] 缩放适配（scale-resize）**：`scale=W:-2:flags=lanczos`；适配框 `force_original_aspect_ratio=decrease,pad`。noUpscale 用 `scale=w='min(iw\,W)'`。**feasible**。
> 注：scale-resize 从原稿 P1 升入 P0——它是平台预设与几乎所有导出的底层依赖，比 reframe-blur 稳得多，应作 P0 基线。

**[P1] 改画幅 + 模糊背景填充（reframe-blur）**
- 短视频刚需但**图结构最复杂、最易踩 setsar/format 对齐坑**，故待 split 模板（crop/rotate/scale）在 P0 验证后再上，降 P1。
- ffmpeg（单次）：`split=2[bg][fg];[bg]scale=W:H:force_original_aspect_ratio=increase,crop=W:H,boxblur=luma_radius='min(20,iw/40)':luma_power=2,setsar=1[bgb];[fg]scale=W:H:force_original_aspect_ratio=decrease,setsar=1[fgs];[bgb][fgs]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]`。两路 overlay 前都 `setsar=1` 且 format 一致，失败退纯色 `pad`。**feasible**。

**[P1] Ken-Burns 运镜（ken-burns）**：图片→视频用 `zoompan`（`d=round(dur*fps)`）；**视频整段运镜绝不用 zoompan**（其 `d=` 把每源帧展开成 d 帧 → 时长爆炸），改 `crop=iw/zoom(t):ih/zoom(t):x(t):y(t),scale=W:H`，`zoom(t)` 用秒表达式单次 encode。CSS `@keyframes` 演示方向。**feasible**。

**[P2] 定点缩放（punch-in）**：`crop=trunc(iw/{zoom}/2)*2:...:(iw-iw/zoom)*cx:(ih-ih/zoom)*cy,scale=iw*{zoom}:-2`（偏移表达式天然约束不越界）。**feasible，最稳**。

**[P2] 画面去抖（deshake）**：默认单次 `deshake=edge=mirror`；vidstab 两遍仅在探测到时走（探测靠 run reject，非解析 stderr）。vidstab 失败静默退 deshake；deshake 也失败 toast 不产卡。**risky，默认单遍守约束**。

**[P3] 构图参考线（guides）**：canvas→PNG→overlay（`scale2ref` 贴合源尺寸）；纯 CSS 预览，勾「烧录」才出卡。**feasible**。

### 4.4 调色与滤镜

**[P0] 调色面板（color-grade）**：单条 -vf 非零项才拼 `eq=...,colorbalance=...,hue=...` + 锐化 `unsharp` + 降噪 `hqdn3d`（**先降噪后锐化**）+ 暗角 `vignette` + 颗粒 `noise`。色温优先 `colortemperature` 否则退 `colorbalance`。`-c:a copy` 失败退 `-c:a aac`。CSS `filter` 实时近似（色温/曲线/LUT 标「仅供参考」）。配方存 `meta.colorRecipe`。**feasible**。

**[P1] 一键风格预设（style-preset）**：7 预设=固定 -vf 串（用显式 `curves` 控制点规避 preset 名缺失）。强度=`split[a][b];[b]<预设>,format[g];[a]format[a2];[a2][g]blend=all_opacity=S`（blend 前两路 format 对齐），blend 缺失退仅 100%。
> 从原稿 P0 降 P1：用户诉求是「只有裁切太简单」，P0 聚焦裁切扩展+变速+基础调色面板+导出，一键风格是 color-grade 之上的锦上添花。**feasible**。

**[P1] 3D LUT（apply-lut）**：`lut3d=file='C\:/Users/x/look.cube'`（盘符 `\:`、正斜杠、单引号包裹）。lut3d 缺失 try/catch toast 放弃；`showOpenDialog` 选 `.cube/.3dl`。**risky，退化保留**。

**[P1] 锐化/降噪（sharpen-denoise）**：`hqdn3d`（必在）+ `unsharp`，并入 color-grade 同条 -vf。nlmeans 仅高级可选，失败时整条重拼去掉该段。**feasible**。

**[P2] 暗角/颗粒（vignette-grain）**：`vignette=angle` + `noise=alls=:allf=t`（≤30）。**feasible**。

**[P2] 曲线（curves）**：前端 canvas 曲线编辑器产 0..1 控制点 → `curves=...`。拼串前校验 x 严格递增、xy 钳 [0,1]、空通道省略，失败退对角线。**feasible**。

**[P3] 黑白/反相（mono-invert）**：`hue=s=0` / `colorchannelmixer` / `negate`，一键免面板。**feasible**。

### 4.5 文字与叠加（canvas→PNG→overlay 统一管线）

新增 `src/ui/services/mediaOverlay.ts` 承载 canvas 渲染 + `buildOverlayFilter`，复用 `runCollage` 的 `loadImageInput`/`createImageBitmap`/`toDataURL`/`saveBase64`。PNG 按 `baseW×baseH` 渲染、定位归一化 0..1。**所有 overlay 的 `enable` 时间窗 a/b 经 §3.2 rate 折算。**

**[P0] 文字/标题叠加（overlay-text）**：canvas 渲 RGBA PNG → `[0:v][1:v]overlay=x:y:enable='between(t,a,b)'`。淡变 `format=rgba,fade=...:alpha=1`；滑入用 `x(t)`；打字机预渲 ≤30 帧逐字 PNG 序列。`OverlayStudioModal` 改为**工作台内 overlay op 面板**（非独立 Modal）。字体用 `document.fonts.check` 过滤实测可用。**feasible**。

**[P0] 水印/Logo（overlay-watermark）**：canvas 端预乘 alpha 进 PNG → `overlay`；平铺=canvas 拼整幅半透明 PNG；缩放 `scale=iw*0.2:-1`。**feasible**。

**[P1] 画中画 PiP（overlay-pip）**：`[1:v]fps=FPS,setsar=1,scale=W*0.3:-1[pip];[0:v]fps=FPS,setsar=1[base];[base][pip]overlay=x:y:enable='gte(t,START)'[v];[0:a][1:a]amix=inputs=2:duration=first[a]`。子画面起点用 `enable`/`tpad`（不用裸 setpts+repeatlast）；base/pip 都归一；圆角前 `format=rgba` 再 `alphamerge`（缺失退直角）；amix 缺音轨退单路/静音。
> 从原稿 P0 降 P1：双输入 + 归一 + 蒙版的图结构复杂度高于 crop/rotate，待 split 模板验证后再上。**feasible**。

**[P1] 进度条（overlay-progress）**：满幅进度 PNG + `overlay=x='-W+(W*t/DUR)'` 从左推进（输出尺寸恒定，避免 crop 变宽绿边）。DUR=probeDuration。**feasible**。

**[P1] 时间码/倒计时（overlay-timecode）**：优先单张精灵图——数字格横排进一张 PNG，`overlay` 配 `crop` 的 `x='floor(t/step)*cellW'` 按时间选格（单输入单次）。退化才用多 PNG ≤60；>180s 降粒度。**feasible**。

**[P1] 字幕烧录** → 见 §3.5「字幕/对白编辑器」独立子系统，不在此重复。

**[P2] 贴纸/Emoji（overlay-sticker）**：emoji=`canvas fillText` 绘 PNG；漂浮 `overlay=y='H*0.5+30*sin(2*PI*t/2)'`。**feasible**。

**[P2] 片头/片尾卡（overlay-titlecard）**：建议直接复用 `composeFilm` 把片头当一段 clip（PNG→静帧段 + `anullsrc` 静音轨 concat）。**feasible**。

**[P2] 马赛克/模糊遮挡（overlay-mosaic）**：`[0:v]split=2[base][src];[src]crop=W:H:X:Y,boxblur=20:2[blur];[base][blur]overlay=X:Y:enable='between(t,a,b)'`。马赛克=`scale=iw/12:-1:flags=neighbor,scale=W:H:flags=neighbor`。多区域 split N+1 ≤4，仅静止遮挡。**feasible**。

**[P3] 角标/弹幕条/预设包（overlay-preset-pack）**：单条 filter_complex，按展开后 -i 总数 ≤12 限流，超限自动拆多次串行 run，逐层 try 跳过失败层。**feasible**。

### 4.6 音频（单卡精修）

音频域统一在工作台内 **audio op 面板**（非独立 AudioStudioModal）。video 卡一律 `-map 0:v -c:v copy` 仅 `-af`（秒级完成）；`-map 0:a?` 带 `?` 容错无音轨。

**[P0] 音频波形可视化（前置依赖，先于所有音频 op）**
- VideoTrimModal 骨架只有视频缩略图条，**没有波形**——区间静音/淡变/对齐配乐全靠盲调不可用。无 ffprobe / 无解码波形数据，路径是**渲染进程 WebAudio 离线解码**：
  ```
  fetch(toFileUrl(path)).arrayBuffer() → new AudioContext().decodeAudioData(buf)
    → 取 channelData → 按像素宽降采样取 min/max 包络 → canvas 画波形条
  ```
- 替代视频缩略图条作为音频面板的时间轴底图。大文件分块降采样防卡顿，解码失败（编码不支持）退「无波形，仅时间标尺」。**列音频域 P0 依赖。**

**[P0] 音量（audio-volume）**：`volume=6dB`，`probeHasAudio` 仅 toast 不硬阻。**feasible**。

**[P0] 淡入淡出（audio-fade）**：`afade=t=in:st=0:d=,afade=t=out:st={dur-D}:d=:curve=`，dur=probeDuration。**st 容差**：probeDuration 对 VFR/有 B 帧的流误差可达数百 ms，淡出 st 算错会「提前结束或被截」——规避用「`st=max(0,dur-D)` 配足够 `d` 容差」，必要时改末尾相对定位。`dur>2D` 下限判断。**feasible**。

**[P1] 区间静音（audio-mute-range）**：多段 `volume=0:enable='between(t,a,b)'` 串联（a/b 经 rate 折算）。**feasible**。

**[P1] 替换原声（audio-replace）**：`-map 0:v -map 1:a -c:v copy -c:a aac`。「跟视频」用显式 `-t {probeDuration(video)}` 而非裸 `-shortest`；offset 用 `adelay`。**feasible**。

**[P1] 叠加配乐（audio-bgm）**：照搬 `buildComposeArgs` 混音骨架（`aresample/aformat/adelay/volume/amix=duration=longest/apad`）`-t T` 收尾。原声缺失退 replaceAudio。**feasible**。

**[P1] AI 配音旁白（audio-narrate）**：`engine.ts:runTts`（已封 synthSpeech，零新后端）→ mp3 → amix 并轨 `-t {videoDur}`。未配置 provider 抛错提示。**feasible**。

**[P1] 响度归一（audio-loudnorm）**：**单遍** `loudnorm=I=-16:TP=-1.5:LRA=11`（动态归一，结论成立；放弃两遍线性——`onProgress` 字段无 loudnorm 测量 JSON，无法读 stderr）。链尾 `aresample=44100`。缺失退 `dynaudnorm`。**feasible**。

**[P1] 降噪（audio-denoise）**：`afftdn=nf=-25` → try 失败 catch 退 `highpass=f=80,lowpass=f=12000`（核心带通必可用）；anlmdn 仅可选。A/B 只处理前 8s。**risky → 退化后 feasible**。

**[P2] BGM 闪避 Ducking（audio-duck）**：**必须先 asplit 复制原声**（否则 `[0:a]` 被消费两次报错）：
```
[0:a]asplit=2[a_main][a_sc];[1:a]volume={vol}[bg];
[bg][a_sc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=300[duck];
[a_main][duck]amix=inputs=2:duration=longest[mix]
```
`sidechaincompress` 缺失退「固定低音量 BGM」。**修正图结构后 feasible**。

**[P2] 变调/变声（audio-pitch）**：`asetrate=44100*PR,aresample=44100,atempo=1/PR`（±12 半音）。**feasible**。

**[P3] 提取/去音轨（audio-split-strip）**：复用现成 `splitAudio`/`stripAudio` 收编，零新代码。**feasible**。

### 4.7 输出与格式

导出统一在工作台内 **export op 面板（栈尾单例）**，非独立 ExportModal。把零散 compress/toGif/frameAt 收编。

**[P0] 视频转码（transcode）**：`scale=W:-2:flags=lanczos -c:v libx264 -crf -pix_fmt yuv420p -c:a aac -movflags +faststart`；webm=vp9+opus。`-r` 置输出侧勿与 fps 滤镜并用。退化判定除 reject 外兜底「产物存在且大小>阈值」。**feasible**。

**[P0] 平台预设（platform-preset）**：抖音/视频号/小红书 1080×1920、B站/YouTube 16:9、方屏 1080×1080。画幅适配三选一：crop 填满 / 黑边 pad / 模糊填充（两路 `setsar=1`+format 对齐，仍单次）。**feasible**。

**[P0] 导出到本地（export-to-local）**：编码产物 → `showSaveDialog`+`filesystem.copy`（抽 `saveToLocal` 共享，复用 `MediaToolbox.download`）；`rpc.exportFile` base64 兜底。**feasible**。

**[P1] GIF 精控（gif-precise）**：`fps,scale,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse=dither=` `-loop`。**feasible**。

**[P1] 封面/海报帧（poster-frame）**：复用 `frameAt`，写 `meta.posterPath`，卡 `<video poster>`。**feasible**。

**[P2] 目标体积 ABR（target-size，两遍）**
- 从原稿 P1 降 P2：风险密度高（probeDuration 精度依赖 + passlogfile 路径未核实 + 两遍取消状态机），而「目标体积」是小众需求。让两遍基础设施先在更安全场景（gif/webp 自动二遍）验证。
- ffmpeg：`probeDuration` 取 D 反算 `Vk`；pass1 `-b:v Vk -pass 1 -an -f null -`；pass2 `-pass 2 -c:a aac`。probeDuration 失败必须阻断（不用默认时长）；加最小码率下限；进度 0–0.5/0.5–1。
- `-passlogfile` 路径正/反斜杠**未核实**（MEMORY 的反斜杠仅对 WinRT filesystem 成立，对 ffmpeg 命令行是推断非实测）——列入「验收前置」实测，错则 target-size 静默失败。**risky，落地前实测 passlogfile。**

**[P2] WebP/APNG（animated-webp-apng）**：`libwebp -q:v -loop 0` / `-f apng -plays`。**探测先行**（testsrc 编 1 帧）不可用灰掉退 GIF。**risky，探测+退化**。

**[P2] H.265/AV1（hevc-av1）**：`libx265 -tag:v hvc1` / `libsvtav1`（优先）。**探测+缓存 `codecSupport` 进 uiStore** 不可用灰掉；HEVC 卡内预览可能黑屏 toast。**risky**。

**[P3] 烧入式角标（burn-overlay）**：水印静态 PNG overlay 单次；进度条改用纯滤镜时间表达式（`drawbox`/色条 `w='iw*t/DUR'`，无字体无 PNG 真单次）；时间码才走有限分段 PNG ≤段数上限。**feasible**。

**[P3] 批量/多平台（batch-export）**：`createLimiter(2)` 循环 `runVideoTool`，持每个 abort 句柄可整体取消。**feasible**。

### 4.8 特效与隐私

特效统一在工作台内 **transform/overlay/color 复合 op**（不起独立 VfxModal）。

**[P0] 局部马赛克/模糊打码（privacy-blur）**：**必须 split** `[0:v]split=2[base][src];[src]crop=W:H:X:Y,boxblur=10:2[fg];[base][fg]overlay=X:Y[v]`；N 框 `split=N+1` 逐级。马赛克=`scale=iw/16:ih/16:flags=neighbor,scale=W:H:flags=neighbor`。坐标偶数化，圆形遮罩走 canvas 圆 alpha PNG。**feasible**。

**[P0] 首尾淡入淡出（fade-inout）**：`fade=t=in:st=0:d=D,fade=t=out:st={dur-D}:d=D` + `afade` 同步（st 容差同 §4.6）；`dur>2D` 判断。**feasible**。

**[P1] 跟踪打码框（privacy-track）**：split 同上；overlay `x/y` 线性插值，>4 关键帧降级多段 enable 静态框；框取关键帧并集+padding+偶数化。**risky → 修正后可落地**。

**[P1] 全画面像素化（pixelate）**：`scale=trunc(iw/N/2)*2:trunc(ih/N/2)*2:flags=neighbor,scale=iw:ih:flags=neighbor`。**feasible**。

**[P1] 分屏自我复制（selfsplit，结构模板）**：`split=2[a][b];各 scale/eq;[a2][b2]hstack`；逐格延时用 `tpad` 补帧（保逐帧对齐），尺寸偶数化。**feasible**。

**[P1] 相框/拍立得（frame-border）**：canvas 按 `baseW×baseH`（§3.1 已从 `<video>` 缓存，**直接用，不额外抽帧**）渲透明中心边框 PNG → `[0:v]scale=W:H[bg];[bg][1:v]overlay=0:0,format=yuv420p[v]`。CSS border/box-shadow 精确预览。**feasible**。

**[P1] 老电影/复古（film-vintage）**
- 从原稿 P0 降 P1：依赖 `curves+noise+vignette+eq:eval=frame` 多个可选/逐帧滤镜、退化路径多，是表现力锦上添花，不与「裁切/变速/调色面板」核心诉求并列。
- ffmpeg：`curves=...,noise=alls=18:allf=t,vignette=PI/4,eq=saturation=0.7:contrast=1.1` 单链；闪烁 `eq=brightness='0.02*sin(2*PI*t*8)':eval=frame`；划痕走 canvas PNG overlay；curves 缺失退 eq+colorbalance。**risky → 退化后 feasible**。

**[P2] 故障 Glitch（glitch-rgb）**：`rgbashift=rh=8:bh=-8`（4.3+）；退化用 `split`+`lutrgb` 通道位移。**risky**。

**[P2] 速度残影（motion-trail）**：`tmix=frames=4`（≤8）/ `lagfun`；try 失败 catch tblend。**risky → 退化后 feasible**。

**[P2] 抖动摇晃（shake）**：`scale=iw*1.1:ih*1.1,crop={原尺寸}:'(iw-ow)/2+A*sin(t*F)':'(ih-oh)/2+A*cos(t*F*1.3)'`；A ≤ 放大余量/2 防黑边。**feasible**。

**[P3] 镜像/万花筒（mirror-kaleido）**：split `[0:v]crop=trunc(iw/2/2)*2:ih:0:0,split=2[l][lc];[lc]hflip[r];[l][r]hstack[v]`。**feasible**。

**[P3] 聚光灯（spotlight）**：单张径向渐变 PNG + `overlay` 整片平移（避免多帧序列 IO 爆炸）。**risky → 修正后 feasible**。

---

## ⑤ 工作台 UI/UX

### 5.1 布局（VideoStudioModal，唯一新增 Modal）

新增 `VideoStudioModal.tsx`，`uiStore.studioCardId` 驱动。**音频/导出/特效全部是工作台内的 op 面板，不起独立 Modal**（消灭「一堆零散弹窗」正是本次目标）。四区栅格（复用 `ace-dialog`/`ace-anim-scale`/`useEscClose`）：

```
┌───────────────────────────────────────────────┐
│ 头部：标题 + [近似/精确预览] + Undo/Redo + 关闭   │
├──────────────────────────┬────────────────────┤
│  预览区（可拖句柄）         │  操作栈（按大类分区） │
│  <video> + 叠加 DOM 层     │  ┌ 裁切区 ⋮ 👁 🗑 ┐  │
│  + crop/overlay 可拖锚点    │  │ 变速区 ⋮ 👁 🗑 │  │ ← 区内可拖
│                          │  │ 几何区 ⋮ 👁 🗑 │  │   跨区禁拖
│                          │  │ 调色区/叠加区… │  │
├──────────────────────────┤  └ export(锁尾)   ┘  │
│  分层时间轴：              ├────────────────────┤
│   · 视频轨（缩略图+多切点） │  参数面板（随选中op）│
│   · overlay 轨（时间窗块）  │  滑块/输入/预设      │
│   · 音频轨（波形条）        │  + 选中 op 的可拖句柄│
│   · cue 字幕轨（可选）      │                     │
│  + 标记轨                  │                     │
├──────────────────────────┴────────────────────┤
│ 底部：总时长/预计 · [取消] [导出新卡] 进度条       │
└───────────────────────────────────────────────┘
```

- **分层时间轴**：视频轨 / overlay 轨 / 音频波形轨 / cue 字幕轨各占一行（**不再把多切点+overlay 时间窗+段保留糊在一条 14px 条上**）。视频轨抽 `<TimelineStrip>`（复用 `timelineThumbs` + 多切点）；音频轨用 §4.6 WebAudio 波形；标记轨支持打点。
- **操作栈按大类分区显示**（裁切区/变速区/几何区/调色区/叠加区/音频区）：**区内可拖重排，跨区禁拖**（与编译器钉死的大类顺序一致，消除「拖了不生效」的矛盾信号）；拖到非法位置弹回 + 视觉提示。每项 👁 启停 + 🗑 删 + 改名。
- **预览区可视化句柄**：选中 crop/overlay/transform op 时，预览区出现对应的**可拖框/锚点**（复刻 `CropModal` 的拖框），与右侧参数面板**双向绑定**。
- **A/B 联动**：👁 切换若命中 `exact=false` op → 自动触发精确代理预览（见 §3.3），否则 A/B 不可信。
- **参数面板**：随选中 op 切换；色彩有风格预设条、几何有平台画幅预设。

### 5.2 与现有两个 Modal 的取舍

- **VideoTrimModal → 吸收为薄壳**：时间轴+手柄抽成 `<TimelineStrip>` 给工作台用；MediaToolbox「裁剪」改为打开工作台默认选中 trim op。保留一个「快速裁剪」轻量入口（直接旧 clip），即 TrimModal 降薄壳内部复用同组件。
- **TimelineModal 保留、明确分工**：它是**多卡→一条成片**（concat/转场/混音）；工作台是**单卡多操作叠加**。衔接：工作台产新卡可进 TimelineModal 拼接；TimelineModal 片段「精修」→ `setStudioCardId(clip.id)` 进工作台。
- 入口：MediaToolbox 视频卡新增主按钮「剪辑工作台」，把零散 reverse/compress/chromakey 收编为工作台 op。
- **「原地覆盖」入口删除**：§2 原则1 卡级非破坏与「原地覆盖 updateCard 改 assetUrl」相悖——原地覆盖后源卡产物变了，被 refIds 引用的下游卡/已导出成片可追溯性断裂。**默认且唯一是「导出新卡」**；如确需「替换感」，做成「新建版本卡并把源卡折叠」（不改源卡 assetUrl），保 refIds 可追溯。

### 5.3 交互流

1. 点「剪辑工作台」→ `setStudioCardId(card.id)` → 打开。**先以可取消的 `probeDuration(signal)` 填 baseDuration**（长视频可中止，不卡死），`<video>` 读并方向校正 baseW/H。
2. 入栈预检：若卡为 source/webm/检测到 VFR → 提示「标准化输入」（见 §8.1 归一档）。
3. 若 `meta.editRecipe` 存在 → 用源 `meta.sourcePath` 作 base 回填栈（**在原始素材重算，避免代际衰减**）。
4. 加 op / 调参 → 预览引擎即时 CSS 反馈（exact=false 角标，可点精确预览）；每次结构性变更 push undo 快照。
5. 拖拽重排（区内可拖、export 锁尾）、👁 启停 A/B（联动精确预览）、Ctrl+Z/Y 撤销。
6. 导出 → `compileStack` → `prepares()`（全成功才进 passes）→ 顺序跑 passes（进度均分、abort 在遍间检查）→ 落新卡 → finally 清中间产物。

---

## ⑥ 数据模型与持久化

`card.meta` 是自由字段袋，**无需改 types.ts**，仅约定键。

**统一编辑配方**（工作台导出写入）：
```ts
meta.editRecipe = { ops, version: 1, baseDuration }
meta.sourcePath = inPath          // 二次编辑用原始素材重算
meta.recipeSource = 源卡id
```

**单按钮工具收编一致性（修正半截收编）**：单按钮工具（reverse/compress/chromakey 等）落卡时**也写 `meta.sourcePath` + 把操作翻译成等价 `editRecipe.ops`**（如 compress → `[{kind:'export',params:{crf}}]`），而非各写互不通的 `meta.timeRecipe/colorRecipe`。这样「先用单按钮压制、再进工作台」时，工作台读到 editRecipe 能在**原始素材**回填重算，不降级「在结果上继续」、不代际衰减。各域专用配方键（`meta.colorRecipe` 等）可保留作展示/复制用，但 editRecipe + sourcePath 是回填的唯一真相。

**overlay PNG 是临时产物**：meta 只存渲染参数（文字/样式/位置），二次编辑按参数**重新 canvas 渲染**，不存 PNG 路径。临时产物落 `ensureSubDir(projectId, 'ov_<ts>'/'tmp_<ts>')`，会话结束整体删 + 启动 GC 兜底（§8.9）。

**落新卡**：`addCard('video', {x:src.x+src.w+200,...}, {title:`${src.title} · 剪辑`, refIds:[src.id]})`，`assetUrl=toFileUrl(out)`、`assetLocalPath`、`mime`。

**uiStore 新增**：`studioCardId/setStudioCardId`（收敛到工作台后，各域临时弹窗的 cardId 不再新增）。

**mediaOps 扩展**：`VideoTool` 联合类型 + `VTOOL_LABEL` 追加；`runVideoTool` opts 扩可带 recipe；多参操作另设 `runSplitAt/runQuickMerge/narrateOnto` 编排函数避免过载。

---

## ⑦ 分期路线图

### P0（直接回应「只有裁切太简单」，技术最稳）

**架构（地基，第 0 项前置）**
- **runFf + probeDuration 加 signal/AbortSignal 可取消**（旧调用方传 undefined 兼容；probeDuration 必须可中止，否则打开工作台即卡死）——**排在 EditStack 之前**
- 工作台编辑历史栈（undo/redo）
- EditStack + compileStack（含 passes 状态机 + prepares 事务性 + 时间基/rate 折算规则）+ preview 引擎（含 A/B↔精确预览联动）+ `<TimelineStrip>` + 分层时间轴 + **单一 VideoStudioModal**

**能力**
- 裁切：keepSegments（多段/删中段/波纹）、splitAt 剃刀、**markers 标记点批处理**
- 变速：speed-uniform + reverse 收编
- 几何：crop、transform-rotate、**scale-resize**（reframe-blur 降 P1、pip 降 P1）
- 调色：color-grade 面板（style-preset 降 P1）
- 叠加：overlay-text、overlay-watermark
- 音频：**波形可视化（前置）**、audio-volume、audio-fade（+ splitAudio 收编）
- 输出：transcode、platform-preset、export-to-local
- 特效：privacy-blur（split 修正）、fade-inout（film-vintage 降 P1）
- 验收：每 op 单独落新卡且源卡保留；配方写 meta 可重放；预览 CSS 即时；导出可取消；undo/redo 正常；无音轨/copy 失败有退化 toast。

### P1
- 裁切：extract/append/quick-merge；变速：freeze、boomerang、speed-ramp
- 几何：reframe-blur、ken-burns、pip
- 调色：style-preset、apply-lut、sharpen-denoise
- 叠加：overlay-progress、overlay-timecode（精灵图）
- **字幕/对白编辑器（独立子系统：数据模型 + cue 时间轴轨 + .srt 导入 + AI 润色 + 分批 run）——单列里程碑，P1 末**
- 音频：mute-range、replace、bgm、narrate、loudnorm、denoise
- 输出：gif-precise、poster-frame
- 特效：privacy-track、pixelate、selfsplit、frame-border、film-vintage
- 启动 GC（§8.9）
- 验收：混音骨架复用一致；LUT/降噪退化诚实文案；字幕子系统增删拖拽可用；二次编辑回填栈正确。

### P2（性能/调参/构建成本）
- 变速：slowmo-interpolate（必带可中止 + 退化）、time-presets、framestep
- 几何：punch-in、deshake
- 调色：vignette-grain、curves
- 叠加：sticker、titlecard、mosaic
- 音频：duck（asplit 修正）、pitch
- 输出：**target-size（两遍，先实测 passlogfile）**、animated-webp-apng、hevc-av1（探测+缓存）
- 特效：glitch、motion-trail、shake
- 验收：探测式编码器灰选项；minterpolate/两遍可中止；duck 图结构正确。

### P3
- 调色：mono-invert；叠加：preset-pack；输出：burn-overlay、batch-export
- 几何：guides；特效：mirror-kaleido、spotlight；音频：split-strip 归档
- 验收：预设包按 -i 总数限流自动拆 run；批量并发限流可整体取消。

---

## ⑧ 可行性与风险

### 8.1 无 ffprobe + 输入归一 + 方向校正
- **取时长**：一律 `probeDuration`，缓存进 meta，**可取消（signal）**。读解码末帧近似值 → trim 末段省 `end`；fade/loudnorm/target-size 的 `st=dur-D` 对 VFR/B 帧误差可达数百 ms，淡出用「`st=max(0,dur-D)` 配足够 d 容差或末尾相对定位」，不把近似值当精确点。
- **取尺寸 + 方向校正**：baseW/H 从 `<video>.videoWidth/Height` 读（§3.1 缓存）。**部分 webm / 容器在 mp4 外 videoWidth 可能为 0；手机竖屏带 rotate 元数据时 `<video>` 给的可能是未旋转物理宽高**，与 ffmpeg 实际处理方向不一致 → crop/overlay 坐标全错。规避：用 `<video>` 实测渲染方向校正 baseW/H，并把 `baseRotation` 显式存入栈，编译器据此插入 `transpose` 显式化方向；videoWidth=0 时退「先 scale 到固定画幅再处理」。frame-border 直接用缓存的 baseW/H，**不额外抽帧**（与单次编码冲突）。
- **取 fps**：拿不到 → 标「近似帧」让用户选常见帧率，或从 probeDuration 的 onProgress frame/time 估算平均 fps。
- **入栈归一档（可选）**：对 source/webm/检测到 VFR 的卡，入栈前可选「标准化输入」——先 `-vsync cfr -r N` 转一遍 mp4 作 base，避免 speed/concat/overlay 对 VFR 的音画漂移。

### 8.2 无字体
- 任何文字/字幕/水印/进度条/时间码/边框/参考线 → **canvas→PNG→overlay**（复用 `runCollage`），绝不用 drawtext/subtitles。本约束下反而**强于 drawtext**。
- **filter_complex 输入数爆炸**：timecode/字幕逐帧多 PNG 会让 `-i` 数量爆 → 用**单张精灵图 + overlay crop 选格**压到 1 路；或**分批多次串行 run**。预设包按「展开后 -i 总数 ≤12」限流。

### 8.3 可选/构建相关滤镜（探测或 try/catch 退化）

| 滤镜 | 风险 | 退化 |
|---|---|---|
| `colortemperature` | 旧版缺 | `colorbalance` 近似 |
| `lut3d` | 构建相关 | toast 放弃 |
| `nlmeans`/`anlmdn`/`afftdn` | 慢/可能缺 | `hqdn3d` / `highpass+lowpass` |
| `sidechaincompress` | 构建相关 | 固定低音量 BGM |
| `minterpolate` | 慢/可能缺 | `setpts+fps` 复帧（必带可中止） |
| `vidstab` | 需两遍+编译 | 单遍 `deshake`（默认不走 vidstab） |
| `rgbashift`/`lagfun`/`tmix` | 4.3+/构建相关 | `lutrgb` 通道位移 / `tblend=average` |
| `libvpx-vp9`/`libwebp`/apng/`libx265`/`libaom` | 构建相关 | h264/GIF；探测先行灰选项 |
| `blend`/`alphamerge` | 旧版缺 | 仅 100% 强度 / 直角 |

- **退化判定**：除 promise reject 外兜底「产物存在且大小>阈值」。**`ffmpeg.run` 非零退出是否 reject 尚未确认——这是整个退化体系的地基，列入「验收前置」必须先实测**（见 §8.10）。

### 8.4 透明通道
- 透明角/叠加输出仅 webm/yuva420p（vp9）保 alpha，mp4 退黑底标注（仿 chromakey）。frame-border/水印只需透明 **PNG 输入** + 不透明 libx264 输出，零风险。

### 8.5 filtergraph 结构 bug（编译器硬规则强制）
- **同一 pad 消费两次报错**：mosaic/mirror/privacy-blur/spotlight/duck 必须先 `split`/`asplit`。
- **PiP 子画面起点**：用 `enable`/`tpad` 而非裸 `setpts+repeatlast`；base/pip 都 fps/setsar 归一。
- **变速/concat 音画同步**：视频 `setpts` 与音频 `atempo` 同一 r；trim/atrim 端点同一浮点数组勿各自取整；`buildAtempoChain` 对数循环每因子 ∈[0.5,2]、保精度。
- **overlay/enable 时间窗在变速后偏移**：§3.2 时间基规则，编译器按累计 rate 折算 a/b。

### 8.6 取消与并发
- runFf/probeDuration 接 `AbortSignal`（§3.0）；工作台导出持 AbortController，取消 → kill → 删半成品 → toast。**两遍操作的取消必须能发生在两遍之间**（执行器每遍前查 `signal.aborted`）。导出/批量走 `createLimiter(2)`。

### 8.7 路径与转义（Windows）
- ffmpeg 命令行路径用正斜杠（`mediaPath` 已跑通）；filtergraph 内逗号 `\,`、冒号 `\:`（lut3d 盘符）转义；含空格/中文单引号包裹。表达式集中在 compile.ts 工具函数生成 + 单测。
- **`-passlogfile` 正/反斜杠未核实**（MEMORY 的反斜杠仅对 WinRT filesystem 成立，对 ffmpeg 命令行是推断）——列「验收前置」实测，错则 target-size 静默失败。

### 8.8 prepares 事务性与代理清理
- prepares 全成功才进 passes，任一失败 unlink 已落 PNG 并抛（§3.2）。
- 代理预览片段按栈指纹缓存、过期/会话结束清理（§3.3）。

### 8.9 启动 GC（孤儿目录清理）
- 会话结束整删临时目录，但**崩溃/强退不触发**。插件启动时扫 `media/<projectId>` 下 `tl_/frames_/scenes_/ov_/tmp_` 前缀且 `mtime>24h` 的目录 `unlink`（复用 `readdir`+`stat`，core 已有 readdir 封装）。列 P1（MEMORY phase-0 GC 风险有先例）。

### 8.10 验收前置（落地前必跑，三项任一为否对应退化路径才成立）
1. **`ffmpeg.run` 非零退出是否 reject**（决定整个退化体系判定方式；若不 reject，统一改「产物大小阈值」判定）
2. **`-passlogfile` 正/反斜杠**（决定 target-size 两遍能否落地）
3. **`libvpx-vp9` / `lut3d` / `sidechaincompress` / `minterpolate` / `libx265` 在宿主自带构建中是否存在**（决定对应 op 主路径 vs 退化路径）

### 8.11 不做的边界（infeasible，不暴露）
- 曲线变速（逐帧 PTS 表）、任意 N 帧关键帧动画、遮罩/运动跟踪、AI 智能抠像、AI 超分、ASR 语音转字幕（需新增后端 Whisper 类 RPC，列后续）、HSL 精细分色、自动/AI 调色。

---

## ⑨ 复用地图（现有 file:function → 如何扩展）

### 直接复用
| 现有 | 用途 | 扩展 |
|---|---|---|
| `mediaVideo.ts:runFf`（:34-39） | 唯一 ffmpeg 执行、percent 映射 | **改签名加 `signal?:AbortSignal`，内部 `signal?.addEventListener('abort',()=>task.kill())`（旧调用方传 undefined 兼容）** |
| `mediaVideo.ts:probeDuration`（:228-242） | 无 ffprobe 取时长 | **同步加 signal 可中止**；填 baseDuration、变速时长推算、loudnorm/target-size 判定 |
| `mediaVideo.ts:timelineThumbs` | 缩略图条 | 抽 `<TimelineStrip>` |
| `mediaVideo.ts:clip` | 单段裁切 | splitAt/markers 逐段调用；快速裁剪入口 |
| `mediaVideo.ts:buildComposeArgs`（私有，:244） | parts/labels/scale+pad/amix/退化范式 | **compile.ts 蓝本**（模式复用） |
| `mediaVideo.ts:chromakey` | alpha-webm 失败退化 | 导出容错范本；收编 op |
| `mediaVideo.ts:composeFilm` | concat/转场/混音/无音轨退化 | append/quick-merge/titlecard 直接调 |
| `mediaVideo.ts:splitAudio/stripAudio` | 提/去音轨 | 收编进音频面板，零新代码 |
| `mediaVideo.ts:frameAt` | 截帧 | poster-frame / frame-step 预览 |
| `mediaOps.ts:runCollage` | **canvas→PNG 权威先例**（loadImageInput/createImageBitmap/toDataURL，规避 file:// taint） | 所有 overlay PNG 渲染（mediaOverlay.ts） |
| `mediaOps.ts:newMediaCard/captureFrame` | 落新卡/截帧 | 工作台导出调用 |
| `mediaOps.ts:createLimiter(2)`（:10） | 并发闸 | 导出/批量 |
| `mediaOps.ts:runVideoTool/VideoTool/VTOOL_LABEL` | 派发 | 扩 case + opts + 中文名 |
| `media.ts:mediaPath/ensureSubDir/saveBase64/toFileUrl`（+ `readFile(path,'base64')`+`base64ToArrayBuffer`，:88-89） | 全套 IO | 输出路径、PNG 落盘、**.srt GBK 解码（base64→ArrayBuffer→TextDecoder('gbk')）** |
| `VideoTrimModal.tsx` | 时间轴+手柄+播放头 | 抽 `<TimelineStrip>`；TrimModal 降薄壳 |
| `CropModal.tsx:clampPt + naturalWidth 换算` | 框选/取点 | crop/reframe/punchIn/mosaic/预览可拖句柄 |
| `taskStore:useTask` / `uiStore` / `useEscClose` / `Select` / `ace-dialog` / `toastStore` | 全局忙碌/弹窗/样式/通知 | 加 studioCardId；统一进度与退化提示 |

### 后端复用
- `main.ts:rpc.synthSpeech`（经 `engine.ts:runTts`）→ AI 配音，**零新后端**
- `main.ts:rpc.exportFile/downloadMedia` → 导出落盘、外部 LUT/.cube 下载

### 新增（薄）
- `services/videoEdit/{types,compile,preview}.ts`（含时间基/rate 折算、passes 状态机、prepares 事务）
- `services/mediaOverlay.ts`（canvas 渲染 + buildOverlayFilter）
- `services/audioWaveform.ts`（WebAudio decodeAudioData → 降采样 → canvas 波形）
- `services/exportPresets.ts`（PLATFORM_PRESETS 纯数据）
- `components/VideoStudioModal.tsx` + `<TimelineStrip>` + cue 字幕轨组件
- 工作台会话 store slice（EditStack + opsHistory/opsCursor + 预览态 + AbortController）
- `mediaVideo.ts` 新增函数（**只加不改旧，runFf/probeDuration 仅加可选 signal**）：`keepSegments/speed/freeze/boomerang/speedRamp/slowmoInterpolate/crop/reframe/transform/resize/kenBurns/punchIn/deshake/colorGrade/stylePreset/applyLut/transcode/toAnimated/audioGain/audioFade/audioMute/replaceAudio/addBgm/audioLoudnorm/audioDenoise/audioDuck/audioPitch/privacyBlur/frameBorder` + 工具 `buildAtempoChain/probeHasAudio/buildAudioMapArgs`

---

## ⑩ 附录：关键 filtergraph 示例

> 占位符 `{}` 为 JS 注入值；输出统一 `-c:v libx264 -crf {crf} -preset fast -movflags +faststart`，无音轨退化省 `-map [a]`。overlay/enable 的 a,b 均为**编译器按累计 rate 折算后**的值。

### A. 模糊背景竖横互转（reframe-blur）
```bash
ffmpeg -i in.mp4 -filter_complex "\
[0:v]split=2[bg][fg];\
[bg]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur=luma_radius='min(20,iw/40)':luma_power=2,setsar=1[bgb];\
[fg]scale={W}:{H}:force_original_aspect_ratio=decrease,setsar=1[fgs];\
[bgb][fgs]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]" \
-map "[v]" -map 0:a? -c:a copy out.mp4
# 失败退化：去 boxblur 用 pad=color=black
```

### B. canvas 字幕条 overlay（多 cue，单次；超 60 段分批 run）
```bash
ffmpeg -i in.mp4 -i cue0.png -i cue1.png -i cue2.png -filter_complex "\
[0:v][1:v]overlay=(W-w)/2:H-h-60:enable='between(t,1.0,3.2)'[c1];\
[c1][2:v]overlay=(W-w)/2:H-h-60:enable='between(t,3.2,5.5)'[c2];\
[c2][3:v]overlay=(W-w)/2:H-h-60:enable='between(t,5.5,8.0)',format=yuv420p[v]" \
-map "[v]" -map 0:a? -c:a copy out.mp4
```

### C. 回旋 Boomerang
```bash
ffmpeg -i clip.mp4 -filter_complex "\
[0:v]split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1,format=yuv420p[v]" \
-map "[v]" -an out.mp4
```

### D. 区间打码（局部马赛克，split 去重 + 时间窗）
```bash
ffmpeg -i in.mp4 -filter_complex "\
[0:v]split=2[base][src];\
[src]crop={W}:{H}:{X}:{Y},scale='iw/16':'ih/16':flags=neighbor,scale={W}:{H}:flags=neighbor[mos];\
[base][mos]overlay={X}:{Y}:enable='between(t,2.0,6.0)',format=yuv420p[v]" \
-map "[v]" -map 0:a? -c:a copy out.mp4
```

### E. 变速保音画同步 + 删中段
```bash
# E1 匀速 3x（atempoChain: atempo=2.0,atempo=1.5）
ffmpeg -i in.mp4 -filter_complex "[0:v]setpts=PTS/3[v];[0:a]atempo=2.0,atempo=1.5[a]" \
-map "[v]" -map "[a]" out.mp4
# 无音轨退化：去 [0:a] 链、去 -map [a]、加 -an

# E2 删中段 [A,B] 接合（末段省 end 自然到流尾）
ffmpeg -i in.mp4 -filter_complex "\
[0:v]trim=0:{A},setpts=PTS-STARTPTS[v0];[0:a]atrim=0:{A},asetpts=PTS-STARTPTS[a0];\
[0:v]trim=start={B},setpts=PTS-STARTPTS[v1];[0:a]atrim=start={B},asetpts=PTS-STARTPTS[a1];\
[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]" \
-map "[v]" -map "[a]" out.mp4
```

### F. 画中画 PiP（enable 控起点 + 双路归一 + 圆角蒙版 + amix）
```bash
ffmpeg -i base.mp4 -i pip.mp4 -i mask.png -filter_complex "\
[0:v]fps={FPS},setsar=1[base];\
[1:v]fps={FPS},setsar=1,scale=W*0.3:-1,format=rgba[pips];\
[pips][2:v]alphamerge[piprm];\
[base][piprm]overlay=W-w-24:H-h-24:enable='gte(t,{START})',format=yuv420p[v];\
[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=0[a]" \
-map "[v]" -map "[a]" out.mp4
# 缺音轨/alphamerge：try/catch 退化 -map 0:a / 去蒙版直角
```

### G. BGM 闪避 Ducking（asplit 去重，原方案不 split 会报错）
```bash
ffmpeg -i in.mp4 -i bgm.mp3 -filter_complex "\
[0:a]asplit=2[a_main][a_sc];[1:a]volume={vol}[bg];\
[bg][a_sc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=300[duck];\
[a_main][duck]amix=inputs=2:duration=longest:dropout_transition=0[mix]" \
-map 0:v -map "[mix]" -c:v copy -c:a aac -t {videoDur} out.mp4
# sidechaincompress 缺失：退化为固定低音量 BGM（addBgm）
```

---

## ⑪ 实现进度

> 边实现边记录。每完成一段：更新本节 + tsc/build green + 提交。未在 Mulby 运行时验证（沿用本插件惯例：tsc + vite build + pack 通过，用户手动在 Mulby 测）。落地前必跑 §8.10 三项实测。

### 完成情况小结（17 次实现提交，全程 typecheck + vite build green）

**已实现（P0 全部 + P1 全部 + 可靠 P2）**：
- 引擎：EditStack 非破坏式编辑栈 + compileStack 单条/两遍 ffmpeg 编译器（固定滤镜顺序、时间基输出态、三级退化梯度）+ run.ts 执行器（可中止/进度均分/清产物）+ studioStore（undo/redo/导出落卡/可二次编辑配方）+ stackToPreview CSS 近似预览 + VideoStudioModal 工作台 UI。
- 裁切：多段保留/删中段/剃刀分割。变速：0.25–4×/倒放/boomerang/片尾冻结/平滑慢动作(补帧)/运动残影。几何：裁画面/旋转翻转/画幅适配(黑边·裁满·模糊背景)/像素化/镜像/抖动/去抖。调色：eq 全项/色温/色相/锐化/降噪/暗角/颗粒/反相/LUT/glitch/7 风格预设。叠加：文字/字幕(+.srt)/水印/贴纸/打码/边框/进度条/时间码/画中画（全 canvas→PNG）。音频：音量/淡变/区间静音/响度归一/降噪/变调/波形可视化/配乐·替换·闪避/AI 配音。输出：mp4·webm·gif·webp/平台预设/保存本地。

**有意延后（需先在 Mulby 跑通 §8.10 三项实测，否则盲做有风险）**：
- 目标体积两遍编码（`-passlogfile` 斜杠方向未核实）
- HEVC/AV1/APNG（需编码器探测）
- 启动 GC 孤儿清理（误删活动卡产物风险——frames_/scenes_ 产物本身是卡）
- 视频整段 Ken-Burns（zoompan 的 fps/时长风险）
- **整套三级退化体系依赖「ffmpeg.run 非零退出会 reject」这一未核实前提**——这是头号待验证项。

**边际/低价值未做**：curves 拖点编辑器（eq+预设已覆盖九成）、分屏 selfsplit、聚光灯、构图参考线、预设包、批量导出、封面帧。

- **[P0 地基·已完成]** 可取消执行：`mediaVideo.ts:runFf` / `probeDuration` 加可选 `signal?: AbortSignal`，`abort → task.kill()`，旧调用方传 undefined 完全兼容。`runFf` 导出供工作台/编译器复用。
- **[P0 地基·已完成]** 编辑栈类型系统：新增 `src/ui/services/videoEdit/types.ts` —— `OpKind`/`EditOp`(按 kind 判别联合，7 大类参数类型)/`EditStack`/`EditRecipe`、大类编译顺序 `OP_KIND_ORDER`、`createOp` 工厂、`stackIsNoop`。纯类型骨架，typecheck green。
- **[P1 时间码·已完成]** overlay 加 `timecode`：`renderTimecodePng` 横排精灵图（每格一个 M:SS 标签，`step=ceil(dur/120)` 限格数防超宽画布），编译器 `crop=cellW:cellH:'floor(t/step)*cellW':0` 逐帧裁出当前格（单输入单次）。`OverlayInput` 扩 cellW/cellH/step；`compile.ts` 导出 `stackOutDuration` 供 `prepareOverlays` 算格数；`run.ts` 传入。OverlayPanel 颜色/位置；预览显示 M:SS。typecheck + vite build green。
- **[P1 进度条·已完成]** overlay 加 `progress` 播放进度条：`renderProgressBarPng` 满幅纯色条，编译器用滑动表达式 `overlay=x='-w+w*t/dur'` 从左推进（输出尺寸恒定）；`applyOverlays` 加 `outDur` 参。OverlayPanel 颜色/粗细/垂直位置；预览 CSS 进度条按播放头填充。typecheck + vite build green。
- **[P2 去抖/平滑慢动作·已完成]** transform 加 `deshake`（单遍 `deshake=edge=mirror`）；speed 加 `smoothSlowmo`（仅 rate<1 时 `minterpolate=fps=60:mi_mode=mci`，退化跳过为复帧慢动作）。退化集加 `minterpolate`。UI：transform 去抖 toggle，speed 倍率<1 时显示平滑慢动作 toggle。typecheck + vite build green。
- **[P2 动感特效·已完成]** transform 加 `shake`（过扫描 1.08x + 余量内 sin/cos 振荡裁剪，偏移表达式约束不越界）与 `glitch`（`rgbashift`，退化 `chromashift`）；speed 加 `motionTrail` 运动残影（`tmix=frames`，退化 `tblend=average`）。退化集加 `rgbashift/tmix`。preview 全标近似。transform/speed 面板加滑块。typecheck + vite build green。
- **[P1 镜像/相框·已完成]** transform 加 `mirror`（h 左右万花筒 / v 上下：`crop 一半→split→flip→hstack/vstack`，输出尺寸不变，偶数化）；overlay 加 `frame` 相框（新增 `renderFramePng` canvas 画透明中心边框 PNG，整帧 overlay；OverlayPanel 颜色/粗细/圆角，预览 CSS border）。preview：mirror→近似，frame→CSS border。typecheck + vite build green。
- **[P1 字幕·已完成]** 字幕做成 `sub:'subtitle'` 的 overlay op（**偏离原稿 §3.5 的 meta.subtitles**，改纳入 EditStack：自动进 editRecipe/undo/recipe 复用全套基建）。`OverlayParams.cues: SubtitleCue[]`；`OverlayInput` 扩 `kind:'subtitle'+cues`。`prepareOverlays` 每条 cue 渲一张 PNG（≤80 条防输入爆炸），编译器逐 cue `overlay enable=between` 串联（底部居中）。UI `SubtitlePanel`：在播放头加 cue / 逐条文本+起止编辑 / `.srt` 导入（base64→TextDecoder utf-8，乱码退 gbk）/ 字号·颜色·垂直位置；预览按播放头显示当前 cue。typecheck + vite build green。**延后**：AI 润色、独立 cue 时间轴轨、>80 条分批 run。
- **[P1 配乐/AI旁白·已完成]** audio op 加 `bgm`（source card/tts · mode mix/replace/duck · volume/offset）。编译器 `applyAudio` 加第二音频输入：`aresample+adelay+volume` → 混音 `amix` / 替换 `g.a=bg` / 闪避 `asplit+sidechaincompress+amix`（`sidechain` 不可用退化混音，已加进退化集）；含 bgm 时 `-t outDuration` 把成片钉到视频长。UI `AudioBgmEditor`：选画布音频卡 / 输入文案 `runTts`(复用 `engine.runTts`→`synthSpeech`，零新后端)生成 AI 配音 → 关系/音量/延迟。无原声时自动走替换。typecheck + vite build green。
- **[P1 画中画 PiP·已完成]** overlay 加「画中画」：从画布另一张视频卡选源（`pipCardId`）。编译器 pip 分支修正——子画面宽用 `baseW×rect.w` 数值偶数化（`scale=pipW:-2`，弃用 scale 里非法的 `main_w`），位置仍用 overlay 的 `main_w/main_h` 表达式自适应；`applyOverlays` 加 `baseW` 参。`studioStore.exportStack` 解析 pip 源卡 → `assetLocalPath` 作视频输入经 `ctxBase.overlayResolved` 传入（与 PNG overlay 合并）。OverlayPanel 加来源选择+大小；预览渲染画中画框。typecheck + vite build green。
- **[P1 调色/画面收尾·已完成]** color op 加 `invert`(negate) + LUT 文件选择（`dialog.showOpenDialog` → lutPath，编译器 lut3d 带退化）+ 风格预设增「老电影/赛博」；transform op 加 `pixelate` 全画面像素化（neighbor 缩小再放大，放大目标偶数化避免奇数尺寸报错）。preview：invert→CSS `invert(1)`，pixelate→近似。typecheck + vite build green。
- **[P0补完/P1 音频·已完成]** 音频波形可视化：新增 `src/ui/services/audioWaveform.ts`（`loadWaveform` WebAudio `decodeAudioData` → 降采样取峰值包络，解码失败/无音轨返回 null）。工作台时间轴下新增 `WaveStrip`（峰值 bar useMemo 缓存 + 红区=区间静音 + 播放头 + 点击定位）。音频面板加「区间静音」管理（在播放头加 / 起止滑块 / 删除；编译器 `applyAudio` 早已支持 `volume=0:enable=between`）。typecheck + vite build green。
- **[P1 时间/运动·已完成]** 变速 op 扩展：回旋 boomerang（`split→reverse→concat`，去音轨）+ 片尾冻结 freeze（`tpad=stop_mode=clone` + 音频 `apad`）；export op 扩展：成片首尾黑场淡入淡出（`fade`+`afade` 同步，淡出 st 用 outDuration 容差判断）。`computeOutDuration` 计回旋×2 与冻结+freeze。`applyTimeEffects` 在变速后几何前；export fade 在音频后 format 前。preview 标 boomerang/freeze/reverse 为近似。speed/export 面板加对应控件。typecheck + vite build green。
- **[P0 输出/平台预设·已完成]** 新增 `src/ui/services/videoEdit/exportPresets.ts`（`PLATFORM_PRESETS`：抖音/视频号/小红书 竖屏 blur-pad、B站/YouTube 1080p contain、方屏 cover，含 w/h/fps/crf/fit/ratio）与 `src/ui/services/saveLocal.ts`（`saveToLocal` 共享：dialog.showSaveDialog + filesystem.copy）。export 面板加「平台预设」下拉（一键套 outW/outH/fps/crf/fit），手动改分辨率会清平台标记；底部加「并保存到本地」勾选 → `exportStack(saveLocal)` 落卡后另存。`MediaToolbox.download` 重构复用 `saveToLocal`（删重复逻辑）。typecheck + vite build green。
- **[P0 文字叠加·已完成]** 新增 `src/ui/services/mediaOverlay.ts` —— `renderTextPng`(canvas 渲文字/水印/贴纸为透明 PNG，贪心换行支持中日韩逐字断行、描边/背景/对齐/透明度，字号相对 baseH 自适应) + `prepareOverlays(stack,projectId)`(事务性备好所有 PNG 输入，单层失败跳过不阻断，返回 cleanup)。`run.ts:exportStudio` 先 `prepareOverlays` 填 `overlayResolved`，finally 清 overlay PNG。UI：操作栈加「文字/水印/贴纸/打码」添加按钮（overlay 多实例）+ `OverlayPanel`(内容/字号/颜色/居中/描边 · 打码 马赛克vs模糊+强度+框 · 位置 X/Y/盒宽 · 限定时间段)；预览区叠加 DOM 渲染带样式文字 + 打码虚框。补 Ctrl+Z/Y 撤销重做键。typecheck + vite build green。
- **[P0 工作台 UI·已完成]** 新增 `src/ui/services/videoEdit/preview.ts`（`stackToPreview` → CSS filter/transform/clip-path + playbackRate + 叠加 DOM + `exact` 角标 + trim 保留段）与 `src/ui/components/VideoStudioModal.tsx`（四区：预览区 video+CSS近似+叠加DOM+「近似预览」角标 / 缩略图时间轴+删除段灰罩+播放头 / 操作栈列表(启停👁·上下移·删除·选中) + 添加大类按钮 / 参数面板(trim 多段切刀·保留删除 / speed 倍率·倒放·保调 / transform 旋转·翻转·裁剪·画幅 / color 5预设+10滑块 / audio 音量·淡变·loudnorm·降噪 / export 格式·分辨率·CRF·帧率) / 底部导出+进度+取消 + 头部 undo/redo）。`uiStore` 加 `studioCardId`；`App.tsx` 挂载；`MediaToolbox` 视频卡加「工作台」主按钮（旧一次性工具保留）；`studioStore.open` 确保栈尾恒有 export op。typecheck + vite build green。
- **[P0 执行器+会话态·已完成]** `src/ui/services/videoEdit/run.ts`：`exportStudio(stack,ctxBase,{signal,onProgress})` 顺序跑 passes，进度按 weight 均分、每遍前查 `signal.aborted`、失败/中止清半成品、成功清中间产物；三级退化梯度（有音轨→无音轨→无音轨+可选滤镜退化集），仿 `composeFilm` 容错。新增 `src/ui/store/studioStore.ts`：会话 EditStack + undo/redo 历史栈（commit 截断 redo 尾）+ 选中 op + busy/progress + AbortController；`open/close/setBase/addOp/updateOp/updateOpLive/commitLive(松手入历史)/toggleOp/removeOp/moveOp(export 锁尾)/undo/redo/exportStack/cancel`；导出落新卡(gif/webp→source 卡、mp4/webm→video 卡) + 写 `meta.editRecipe/sourcePath/recipeSource` 可二次编辑。typecheck green。
- **[P0 引擎·已完成]** 滤镜图编译器：新增 `src/ui/services/videoEdit/compile.ts` —— `compileStack(stack,ctx,opts) → { passes, finalOut, cleanup, outDuration }`。`Graph` 构建器维护 v/a 标签 + split 去重；按固定顺序编译 trim(多段 trim+concat，无音轨退化 a=0)、speed(setpts+reverse+atempo 链 `buildAtempoChain` 任意倍率分解到[0.5,2])、transform(crop/flip/transpose/任意角 rotate/画幅适配 contain·cover·blur-pad)、color(hqdn3d→eq→colortemperature/colorbalance→hue→unsharp→vignette→noise→lut3d，含退化开关)、overlay(mosaic split 打码 / pip / PNG overlay，时间窗用 main_w/main_h 表达式)、audio(volume/afade/区间静音/afftdn 退化/loudnorm/变调)、export(mp4·webm 单遍；gif·webp 自动二遍 palettegen)。**P0 决策：overlay/audio 时间窗以输出时间基存储，不做 rate 折算**（规避时间错位类 bug，已更新 §3.2 约定）。typecheck green。
