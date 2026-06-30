# VideoStudioModal 专业化重设计 · 最终方案（ai-creative-canvas 单卡剪辑工作台）

> 落地基准：`plugins/ai-creative-canvas/src/ui/components/VideoStudioModal.tsx`（952 行）+ `store/studioStore.ts`（`useStudio`：`stack/selectedOpId/busy/progress/undo/redo/updateOp/updateOpLive/commitLive/toggleOp/moveOp/removeOp/addOp/selectOp/exportStack`）+ `services/videoEdit/{types,preview,compile}.ts` + `canvas/CanvasStage.tsx` + `hooks.ts`。
> 硬约束：① 模态弹窗；② 纯渲染进程、无第三方剪辑库；③ 单条视频；④ 复用 `studioStore` 与 `Select/SliderRow/Toggle/WaveStrip`；⑤ Tailwind + `var(--ace-*)` 令牌、明暗主题。
> 本方案**不改数据模型一行**，store 不新增字段；只重排 UI、新增纯展示/交互组件、补 3 处既有缺陷（画布快捷键守卫、Esc 分层、overlay range 预览门控）。

> **本稿相对初稿的关键修订（吸收评审）**：
> 1. 新增 **Step −1 守卫**（阻断级前置）：画布全局 keydown 加模态守卫，模态键盘改 capture+stopImmediatePropagation，Esc 三方竞争重做。列为 Step 1/3/6 硬依赖。
> 2. 明确 **ruler 用源时间基**；输出基元素（subtitle cue / muteRanges）走纯函数 `srcToOut`/`outToSrc` 换算，**首版降级**：trim 或 speed 启用时这些块只读、回落检查器数字输入。
> 3. 补 **overlay range 预览门控**（preview.ts 已传 `range`，渲染层加门控），否则"拖块即所见"对非字幕 overlay 不成立。
> 4. **入轨规则收敛**：progress/timecode/frame + 无 range 的全程 overlay **不上轨**，归检查器；叠加轨**写死上限**（基础 1 条 / 进阶最多 3 条）。
> 5. **缩放降级**为 fit + 1×/2× 两档，删除无级缩放。**右键菜单提级**为核心交互（非可选）。
> 6. **默认折叠时间轴让预览占满**，需要时展开，纠正"5 区把预览压到 ~55vh"。
> 7. **MVP 边界**明确：MVP = Step −1,0,1,2,4；Step 3/5 为专业感增量、可后置。

---

## ① 诊断：当前为什么不专业（保留有效，补阻断项）

**A. 布局结构层（根因）**
1. 时间轴退化成左栏下一条 48px 只读缩略图条（`VideoStudioModal.tsx:348-369`）——无轨道、无可拖块、无标尺刻度。专业 NLE 的灵魂"底部全宽时间轴"缺席，这是"不专业"最大单一来源。
2. 右栏 340px 挤了三件互不相干的事（`383-425`）：添加大类按钮行 / 操作栈列表 / 参数面板。三件混一栏，每件都局促。
3. 操作栈列表与时间轴语义重复又割裂：有时间窗的 trim/overlay/静音本应在轴上拖块，现在退成列表一行字 + 面板两个滑块，要盲调数字。
4. 预览与时间相关信息（缩略图条 / 波形条 / 文字标签三处分散）抢左栏空间，预览实际不够大。

**B. 播放器层**
5. 原生 `<video controls>`（`294`）与自绘缩略图播放头**双控冲突**，原生控件风格不搭令牌主题——被点名"不专业"的直接观感。

**C. 交互层**
6. 几乎无直接操纵：裁剪框 / overlay 位置全靠右栏四滑块盲调（`940-942`、`505-508`），叠加层 `pointer-events-none`（`296`）不能在画面拖。
7. 快捷键只有 Ctrl+Z/Y（`173-184`）。

**D. 阻断级缺陷（初稿漏列，评审已核实，必须先修）**
8. **画布全局快捷键无模态守卫**：`CanvasStage.tsx:494-559` 的 keydown 挂 window、唯一跳过条件是 `isTyping()`，无任何模态判断。模态打开时按 **Del 会同时删掉画布选中卡片**（`520-524` `g.removeCards`）、Space 进抓手、F fit 画布、Ctrl+Z 撤销画布历史——与模态新快捷键双重触发，数据破坏级。
9. **Esc 三方抢同一事件**：`useEscClose`（`hooks.ts:5-13`，裸 window 监听无 `stopPropagation`）+ `CanvasStage` Escape→`clearSelection`（`542-543`）+ 模态想加"Esc 取消选中"，三者同时触发，无法分层。
10. **overlay range 在预览里不联动**：`preview.ts:73` 把 `range` 传出，但渲染层只对 subtitle cue 按 playhead 过滤，其余 overlay 恒显示。拖带 range 的文字块、移播放头出窗，预览不消失——"拖块即所见"对非字幕 overlay 失效。

---

## ② 目标布局：五区骨架 + 默认折叠时间轴（ASCII 线框）

模态尺寸 `1080px×88vh` → **`min(1320px, 95vw) × 90vh`**（仍是模态，未独立全屏）。

**关键修正（评审 #1）**：五段固定铬（顶 44 + Transport 40 + TLToolbar 32 + BottomBar 48 ≈ 164px，加 ruler/轨道头）会把预览压到 ~55vh。因此 **时间轴默认折叠**（收成轨道头一行 ~36px，预览占满中部 ~70vh），用户按 ⌘B 或点底部"展开时间轴"再展开。下图为**展开态**：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ [🎬] 剪辑工作台 · 卡片标题      [基础|进阶]   [↶撤销][↷重做] │ [吸附] [✕]      │ ← TopToolbar  h≈44
├──────────────────────────────────────────────────────┬──────────────────────┤
│   ┌──────────────────────────────────────────────┐    │  检查器 Inspector     │
│   │                                              │    │ ┌──────────────────┐ │
│   │            预览舞台 Stage (黑底居中)            │    │ │ [Tab: 选中项/全局] │ │
│   │        <video>(无原生controls) + 叠加DOM层      │    │ ├──────────────────┤ │
│   │        选中元素时: 8锚点拖框 / 裁剪框           │    │ │ ▸ 标题行 图标+名   │ │  ← Inspector
│   │                                              │    │ │   👁启停 🗑删除    │ │   固定宽 320
│   └──────────────────────────────────────────────┘    │ │ ▾ 参数组(可折叠)   │ │   可折叠(⌘J)
│   ┌──────────────────────────────────────────────┐    │ │   Row Slider 值 ↺ │ │
│   │ ⏮ ◀│ ▶/⏸ │▶ ⏭   0:00 / 1:23   预览1×▾  ⛶     │    │ │ ▾ 时间窗 In/Out    │ │
│   └──────────────────────────────────────────────┘    │ │   [跳到该段]       │ │
│        TransportBar (自绘)  h≈40                       │ └──────────────────┘ │
├──────────────────────────────────────────────────────┴──────────────────────┤
│ [✂播放头切] [⌫删段] | [fit][1×][2×] | [+叠加▾]   源时间基 · 00:00↔01:23  [▾收] │ ← TLToolbar h≈32
│ ┌────────┬──────────────────────────────────────────────────────────────────┐│
│ │ 轨道头  │ 0:00    0:05    0:10    0:15    0:20   (ruler · 源时间)           ││
│ │120px   │──────────│(播放头红线 = video.currentTime, 源时间)───────────────││
│ │📹 主视频│▓▓▓缩略图▓▓░░删除段(灰罩红斜纹)░░▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓             ││  ← Timeline
│ │👁🔒叠加 │   [文字块]      [水印▭]        [画中画 ▭]                         ││   底部全宽
│ │👁 字幕  │  [cue][cue] [cue]   [cue]  ← trim/speed 启用时只读              ││   h≈190 拖120-360
│ │👁 音频  │∿∿∿波形∿∿▓静音▓∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿            ││   默认折叠
│ └────────┴──────────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────────────────┤
│ [并保存到本地☐]   [▸展开时间轴]            编辑就绪·导出新卡   [⬇ 导出新卡]      │ ← BottomBar h≈48
└─────────────────────────────────────────────────────────────────────────────┘
        ↑ busy 时此条变进度条 + [取消]
```

| 区 | 位置 | 尺寸 | 折叠 | 复用 |
|---|---|---|---|---|
| TopToolbar | 顶全宽 | h≈44 | 否 | 现头部 + IconBtn |
| Stage 预览 | 中左 flex-1 | 折叠态占 ~70vh | — | 现 `<video>`/叠加层（去 controls、去 `pointer-events-none`）|
| TransportBar | Stage 下沿 | h≈40 | 否 | 新增，驱动 `vref` |
| Inspector | 中右 | 固定 **320** | ⌘J 折叠成 36px 竖条 | 现全部 `*Panel` 原样搬入 |
| Timeline | 底全宽 | h≈190，拖 120–360 | **默认折叠**，⌘B/点"展开" | 现 thumbs/WaveStrip/keeps 灰罩 |
| BottomBar | 底全宽 | h≈48 | 否 | 现导出条 |

**基础/进阶双档**（OpenShot Simple/Advanced）：TopToolbar 分段开关，仅控可见密度不改数据。基础=叠加合 1 轨、检查器只显常用组；进阶=叠加最多 3 轨、检查器展开全部组。

---

## ③ 时间基统一（自洽性核心 · 评审最严重项，初稿完全漏掉）

`types.ts` 写明两套时间基：`OverlayRange.start/end`（**源时间基**，`103-104`，编译器按累计 rate 折算）、`TrimSegment.in/out`（源基）；而 `SubtitleCue.start/end`（**输出时间基**，`99-100`）、`AudioParams.muteRanges`（输出基，`137`）。存在 trim（删中段）或 speed（变速）时，源↔输出不再线性对应，**同一把 ruler 同时正确摆源块和输出块在数学上不成立**。

**决策（写死，Step 2 之前敲定）**：

- **ruler 一律采用源时间基**——因为播放头只能是 `video.currentTime`（源时间），keeps 灰罩也是源时间（现 `358-368` 自洽）。
- 源基元素（**主轨 trim 段、overlay range**）直接 `t * pxPerSec` 定位，与播放头同基，可直接比较。
- 输出基元素（**subtitle cue、muteRanges**）需换算后定位，提供一对**纯函数 + 单测**：

```ts
// services/videoEdit/timebase.ts （新增，纯函数，无副作用，单测覆盖）
// keeps: 启用 trim 的保留段(源基, 升序)；rate: 启用 speed 的 rate(默认1)
export function outToSrc(tOut: number, keeps: Keep[] | undefined, rate: number): number
export function srcToOut(tSrc: number, keeps: Keep[] | undefined, rate: number): number
// 逻辑：累加 keeps 段时长×(1/rate?) 得输出轴；落在被删段的输出时刻钳到段边界
```

- **首版降级（评审 C 推荐，强制执行）**：当 `trim` **或** `speed` 启用时，字幕 cue / muteRange 块在时间轴上渲染为 **`不可拖、半透明只读条`**（仅作位置示意，标注"仅检查器编辑"），编辑回落检查器数字输入；两者都未启用时（源≡输出），才允许拖。这样首版可不依赖换算函数的边界正确性，零返工风险。`timebase.ts` 可在 Step 3+ 接入解锁拖拽。

---

## ④ 时间轴详设 `<Timeline>`

### 轨道结构 → 数据模型映射（含入轨规则收敛）

| 轨道 | 数据来源 | 块含义 | 上限 |
|---|---|---|---|
| 📹 主视频轨（恒顶、不可删）| `thumbs` + `trim.segments` | 缩略图铺底；`keep:false` 段灰罩+红斜纹（复用 `358-367`）；保留段边界=切点 | trim 单例 |
| 叠加轨 | **仅带 range 的** overlay op | 每 overlay=一块，位置/宽=`range`（源基） | **基础 1 条全横排；进阶最多 3 条**（文字类 / 遮挡类 mosaic+watermark / 画中画 pip）|
| 字幕轨 | `sub==='subtitle'` 的 `cues[]` | 每 cue 一小块（输出基，按 ③ 换算/只读） | 单字幕 op |
| 音频轨 | `waveform` + `audio.muteRanges` | WaveStrip 铺底（复用 `89-110`）；每 muteRange 红块（输出基）| 多区间 |

**入轨规则（评审 E/F，写死）**：
- **不上轨、归检查器"全局/装饰"组**：`progress`（HUD 全程）、`timecode`（HUD 全程）、`frame`（恒 rect 0,0,1,1 全程）、以及**无 `range` 的 text/watermark/sticker/mosaic/pip**（全程作用、无时间拖拽意义）。
- **只有显式设了 `range`（限定时间段）的 overlay 才生成可拖块**上叠加轨。
- 叠加轨**永不"每 sub 一轨"**；进阶档按上表 3 组归并，硬上限 3 条。最坏轨数 = 主轨 1 + 叠加 3 + 字幕 1 + 音频 1 = **6 条**（非初稿被批的 12 条），h≈190 下每轨 ~30px，可承载拖块。

> **轨道头**（左固定 ~120px）：图标 + 名 + 👁`toggleOp`（复用现 Eye/EyeOff）。**轨道头眼睛 = 现操作栈列表的启停**，语义一致，迁移后操作栈列表整体取消——栈改由"时间轴块 + 检查器全局徽章"两处自然呈现。

### 块交互（统一手势，全走 `updateOpLive` + `commitLive`）

- 拖块体=平移时间窗（overlay `range` / cue / mute 整体平移）；拖中调 `updateOpLive(id,{...})`，`onPointerUp`→`commitLive()`（与 SliderRow live/commit 一致，零新 store API，store `134-143` 确认）。
- 拖左/右边缘=改时长，8px 热区；钳制沿用现面板 `Math.min(v, x.end-0.1)`（`766-770`、`598-601`、`946-947`）。
- 点选块→`selectOp(op.id)`（已存在），加 `ring-1 ring-pink-500`（现 `406`）。
- 双击文字/字幕→检查器对应输入聚焦（复用 `913-914`）。
- **右键菜单（评审 G 提级为核心，非可选）**：【删除 `removeOp` / 复制 `addOp(kind,{...params})` / 启停 `toggleOp` / 在此切分（仅主轨，复用 `splitAtPlayhead` 737-745）】，均走既有 store。

### 标尺 / 播放头 / 缩放 / 吸附

- ruler：源时间刻度，<1min 用秒、>1min 用 `m:ss`。点标尺=seek（`vref.current.currentTime=t`，复用 `350-353`）。
- 播放头：贯穿全轨竖线（提升现 `368` `bg-pink-500`），= `video.currentTime`（源基）。可拖 scrub；**拖块 trim 时播放头临时固定**。
- **缩放（评审 H 降级）**：**只做 `fit + 1× + 2×` 两档按钮**，删除无级缩放 / Ctrl+滚轮 / 横向滚动（880px 窄视口收益低、过度设计）。块按 `t * pxPerSec` 定位。
- 吸附：拖块/拖边/拖播放头吸附【播放头 / 0 / dur / 相邻块边缘】，阈值 ~6px，竖虚线反馈，TopToolbar 开关（默认开）。

> 剔除（单卡无关）：多素材插入/盖写、Ripple/Roll、transition 轨、磁吸无轨布局——固定四类轨，不开放建轨。

---

## ⑤ 检查器详设 `<Inspector>`

几乎原样复用现 `ParamPanel` 及子面板（TrimPanel/OverlayPanel/SubtitlePanel/AudioBgmEditor + 各全局 op 滑块组），只重排外壳。

**两种态**（Tab 切换【选中项｜全局】，靠 `selectedOpId` 区分）：
1. **选中态**（选中时间性元素）：顶=标题行【kind 图标+改名+👁`toggleOp`+🗑`removeOp`】（搬现操作栈行按钮），下=该元素现有 Panel + 「时间窗」折叠组（In/Out 数字 + 「跳到该段」，与轴双向联动；trim/speed 启用时这是字幕/静音的**唯一**编辑入口）。
2. **全局态**：顶=全局徽章行（speed/transform/color/audio/export，各带 👁 启停 + 状态点），点徽章=`selectOp(globalOpId)` 渲染其参数组。**progress/timecode/frame + 无 range overlay 也归此态的"全局/装饰"组**（评审 E）。

**分组**（可折叠 `<Section>`）：几何 transform（`484-536` 分 3 段）｜调色 color（`538-572`）｜变速 speed（`470-482`）｜音频 audio（`574-606`）｜导出 export（`608-644`）。

**参数行四件套**（廉价加分）：`SliderRow`（`62-78`）升级为 `标签｜滑块｜数值｜↺复位`，`↺`=`set({[key]:default})`（Step 7 加，向后兼容）。

**可视化手柄**（专业感最大来源，Step 5）：取消叠加层 `pointer-events-none`，选中带空间属性 op 时叠加 `<RectHandles>`/`<TransformHandles>`（8 锚点+4 边）。坐标用现 `vrect` 归一系（`296`，memory 记录的贴合修复不可破坏）。**手柄只在选中元素上；拖手柄 `stopPropagation` 不触发 video seek / 不冒泡舞台 seek；处理 z 序**（评审 #5，此步够一个独立 PR）。拖手柄走 `updateOpLive`→`commitLive`，与滑块双向绑定。

---

## ⑥ 播放器详设 `<TransportBar>`

移除 `<video>` 的 `controls`（`294`），自绘控制条贴 Stage 下沿，消双控冲突。

```
[⏮回起点] [◀帧] [▶/⏸] [帧▶] [⏭到尾] | 0:00 / 1:23 | 预览1×▾ ⛶
```
- ▶/⏸=`v.paused?play():pause()`（空格）。
- 逐帧=`v.currentTime ± 1/30`（CSS 近似、固定步长，**`types` 无 fps 字段，UI 不显示 `:ff` 帧号，不暗示帧精确**，评审 G）。
- ⏮回起点=`keeps?.[0].in ?? 0`。
- 时码 `tabular-nums`（现 `fmt`）。
- **预览倍速（评审 G 消歧）**：下拉 0.5×/1×/2× 只设 `v.playbackRate`，**不写回数据**。**`speed` op 启用时 `pv.playbackRate` 已驱动（189-191）**，二者会互相覆盖——约定 **`speed` op 启用时隐藏/禁用预览倍速下拉**（显示 "由变速 op 控制"），避免覆盖战。
- ⛶全屏=Stage `requestFullscreen()`（F 进 / Esc 退，见 ⑦）。

> 剔除：JKL 飞梭（HTML5 不支持负 playbackRate）、I/O 取片、双查看器。

---

## ⑦ 交互与快捷键（含阻断级守卫 · 评审最高优先）

### Step −1 守卫（所有快捷键步骤的硬前置，新增）

**A. 画布全局键让位**：`CanvasStage.tsx` `onKeyDown`（`500`）开头加
```ts
if (useUi.getState().studioCardId) return   // 模态打开时画布全局键全部让位
```
（已确认现无此守卫，否则模态里按 Del 误删画布卡片 `520-524`、Space 进抓手、F fit、Ctrl+Z 撤销画布历史。`studioCardId` 即模态开关来源。）

**B. 模态键盘收敛 capture**：模态所有快捷键收进一个 `useEffect`，
```ts
window.addEventListener('keydown', h, { capture: true })
// 已处理键调 e.stopImmediatePropagation()，杜绝与画布/useEscClose 冒泡竞争
```
（现模态 undo/redo `173-184` 用冒泡，与画布同在 window 冒泡，顺序不定。）

**C. Esc 分层重做**：**不再用 `useEscClose` 裸监听关闭**（绕过/移除它）。在模态 capture 处理器里分层：
```ts
if (document.fullscreenElement) { document.exitFullscreen(); e.stopImmediatePropagation(); return }
if (selectedOpId != null) { selectOp(null); e.stopImmediatePropagation(); return }
close(); e.stopImmediatePropagation()
```
（先退全屏并吞事件——否则浏览器退全屏同时 `useEscClose` 关掉整个模态；再取消选中；再关闭。）

### 快捷键表

| 键 | 行为 | 实现 |
|---|---|---|
| 空格 | 播停 | `v.paused?play():pause()` |
| ← / → | 逐帧 ∓ | `v.currentTime ± 1/30` |
| Shift+←/→ 或 Home/End | 首/尾 | `currentTime = 0 / dur` |
| S | 播放头切分（主轨）| `splitAtPlayhead`（737-745）|
| Del / Backspace | 删选中块 | `removeOp(selectedOpId)`（守卫后不再误删画布卡）|
| Ctrl+Z / Ctrl+Y(或 Shift+Z) | 撤销/重做 | 现有 |
| ⌘/Ctrl+B / J | 折叠时间轴 / 检查器 | 切折叠态 |
| Shift+M | 吸附开关 | 切 `snap` |
| F | 全屏 | Stage `requestFullscreen` |
| Esc | 退全屏→取消选中→关闭 | 见 C 分层 |

（**fit 与 1×/2× 缩放无快捷键**，仅工具栏按钮——缩放已降级。）

---

## ⑧ 视觉：深度分层 + 令牌

- 暗主题背景分层：壳 `var(--ace-bg)` 最深；Stage 纯黑 `#000`（不随主题）；Timeline/Inspector `var(--ace-surface)`；轨道交替 `bg-white/[0.02]`；轨道头再深一档。
- 强调色编码：粉 `pink-500`=选中/播放头/主操作；绿 `emerald-500`=波形/trim 保留段；玫 `rose-500`=静音/删除段/危险；琥珀 `amber`=打码/"近似预览"角标。
- 边框 `var(--ace-border)`；选中 `ring-1 ring-pink-500/40 bg-pink-500/15`；手柄白实心方点 `bg-white shadow` + 框线 `border-pink-400`；图标按钮 28×28 `hover:bg-white/10`。
- **只读条**（trim/speed 启用时的字幕/静音块）：`opacity-50` + 斜纹 + 无 hover 手柄，与可拖块视觉区分。

---

## ⑨ 实施计划（标 MVP / 增量；每步独立 build 通过）

> 每步结束 `pnpm -C plugins/ai-creative-canvas build`（memory：`CI=true` + `--no-frozen-lockfile`；`mulby verify` 本环境不可用，用 tsc/build 验证）。**MVP 闭环 = Step −1,0,1,2,4**；Step 3/5 为专业感增量、可后置；Step 6/7 打磨。

**Step −1【MVP·阻断前置】守卫**：CanvasStage 加 `studioCardId` 守卫；模态键盘改 capture+stopImmediatePropagation；Esc 三层重做、绕过 `useEscClose`。**是 Step 1/3/6 的硬依赖。** 验证：模态开时按 Del/Space/F/Ctrl+Z 不再波及画布。

**Step 0【MVP】骨架重排**：`return` 改五区，现有元素原位平移；模态 `min(1320px,95vw)×90vh`；**时间轴默认折叠**。验证：布局成型、功能等价、预览占满。

**Step 1【MVP】`<TransportBar>`**（依赖 −1）：去 `controls`，绑空格/←→/F；speed op 启用时隐藏预览倍速。验证：播停/逐帧/时码/全屏可用、无双控。

**Step 2【MVP】`<Timeline>` 只读 + `timebase.ts`**：先敲定 ③ 时间基决策并落 `srcToOut/outToSrc`（含单测）；渲染主轨（缩略图+keeps 灰罩）、音频轨（WaveStrip+mute）、叠加轨（仅带 range 块）、字幕轨（输出基，trim/speed 启用时**只读条**）；ruler（源基）、贯穿播放头、fit/1×/2×。点块=selectOp、点标尺=seek。验证：时间性元素以块呈现、可点选、可 seek、时间基不错位。

**Step 4【MVP】`<Inspector>` 重排**：外壳 + `<Section>`；现 `*Panel` 原样塞选中态；全局徽章行 + Tab；progress/timecode/frame/无 range overlay 归"全局/装饰"组；标题行迁 👁/🗑/改名；"添加大类"移入 Timeline【+叠加】抽屉 + 徽章"添加"态。验证：选中谁编辑谁、添加入口归位、操作栈列表已移除。

—— 以上为最小可用闭环 ——

**Step 3【增量】`<TrackClip>` 拖拽**（依赖 −1、2）：通用块拖中平移/拖边改时长；接 live/commit；接 `timebase.ts` 解锁源≡输出时的换算拖拽；吸附+虚线；Del/S/右键菜单。验证：拖块即改时间窗、与检查器双向同步。

**Step 5【增量·独立 PR】预览手柄 + overlay range 门控**：
- 先补**预览 range 门控**（评审 D，渲染层加：非 subtitle overlay `if (o.range && (playhead < o.range.start || playhead > o.range.end)) return null`，range 与 playhead 同为源基可直接比，preview.ts:73 已传 `range`）。
- 再取消叠加层 `pointer-events-none`，叠加 `<RectHandles>`/`<TransformHandles>`（处理 z 序、手柄仅选中元素、stopPropagation 不触 seek、vrect 归一换算）。验证：移播放头出窗块消失、预览拖框改参数。

**Step 6【打磨】TopToolbar + 折叠 + 双档**（依赖 −1）：迁撤销/重做/关闭；吸附开关、基础|进阶、⌘B/⌘J 折叠。

**Step 7【打磨】**：SliderRow 加 ↺；ruler 着色；命中区放大；进阶档拆叠加轨（≤3）。（右键菜单已在 Step 3，不在此。）

**新增组件**（`components/studio/`）：`TopToolbar`、`TransportBar`、`Timeline`、`TrackHeader`、`TrackClip`、`Inspector`、`Section`、`RectHandles`、`TransformHandles`；纯函数 `services/videoEdit/timebase.ts`（+单测）。
**复用不改**：`useStudio` 全部方法、`Select`、`SliderRow`（Step 7 加可选 reset 列）、`Toggle`、`WaveStrip`、`stackToPreview`、所有 `*Panel`。
**改既有**：`CanvasStage.tsx`（Step −1 守卫）、模态键盘（capture）、`preview.ts`/渲染层（Step 5 range 门控）；绕过 `useEscClose`。

---

### 落地关键引用（绝对路径）
- 主组件 `D:\Node.js\mulby-all\mulby-plugins\plugins\ai-creative-canvas\src\ui\components\VideoStudioModal.tsx`（布局 275-451；叠加层 296-342；快捷键 173-184；keeps 灰罩 358-368；裁剪 setter 505-508；overlay 位置 setter 940-942；splitAtPlayhead 737-745）
- 画布 `...\src\ui\canvas\CanvasStage.tsx`（无守卫全局 keydown 494-559；Del 删卡 520-524；Escape→clearSelection 542-543）
- `...\src\ui\hooks.ts`（`useEscClose` 裸监听 5-13）
- 预览 `...\src\ui\services\videoEdit\preview.ts`（range 传出未门控 69-75；keeps 78-84）
- 类型 `...\src\ui\services\videoEdit\types.ts`（OverlayRange 源基 103-104；SubtitleCue 输出基 98-102；muteRanges 输出基 137；rect 归一 109）
- store `...\src\ui\store\studioStore.ts`（live/commit 134-143；moveOp 锁 export 158-168；exportStack 187-245）

不触碰 `compile.ts`/`run.ts` 导出管线、不改数据模型、不新增 store 字段（全局徽章复用 `selectOp`），契合"单卡操作栈"，可在一个 React 模态内分步增量落地。