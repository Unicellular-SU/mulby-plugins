# tech-manga 优化实现方案

> 日期：2026-07-18　分支：`feat/tech-manga`
> 来源：两轮多智能体审查产出——第一轮 5 维度 43-agent 代码审查（37 条发现全部经反驳式验证，1 条被推翻剔除），第二轮 12-agent 按工作流起草本方案并逐章对照源码核对行号与 API 可行性。
> 范围：插件 `plugins/tech-manga`（主体）＋ Mulby 宿主 `mulby` 仓库（第 6 章，两个独立分支）＋ 姊妹插件 `plugins/horror-manga`（每条注明回灌适用性）。

## 1. 总览

### 1.1 背景

tech-manga 刚从 Google AI Studio 迁移为 Mulby 插件（AI 能力全部改走 `window.mulby.ai`，含流式剧本、多参考图绘页、全局中止纪元）。迁移保住了功能等价，但审查发现三类问题：

1. **随迁移带入或迁移引入的缺陷**——AI Refine 死按钮（原项目遗留）、Start Over 不清场导致跨运行串台与持续计费、快速"生成→中止→生成"竞态等，当前就在出错或烧钱；
2. **未利用的宿主能力**——零持久化（关窗即丢付费成果）、无系统通知、附件逐页重复上传、费用统计失真等；
3. **宿主自身的缺口**——图像请求无法从插件 UI 真中止（preload 差 3 行）、`images.edit` 无尺寸控制导致页面比例失控、host-worker 三级 API 在隔离进程不可达（类型契约对生产路径撒谎）。

### 1.2 条目一览

| 章 | 优先级 | 内容 | 预估 |
|---|---|---|---|
| 2 | P0 | 缺陷修复批：运行生命周期统一（Start Over/竞态/清场）、AI Refine 死按钮、page_number 归一化、名字匹配、isAbortLike、资产双跑 | ~3 天 |
| 3 | P1 | 会话持久化与恢复：storage/attachment 增量落盘 + 启动恢复 + 配置持久化 | ~2 天 |
| 4 | P1 | 生成管线：附件缓存复用、asyncPool 并发+重试、续绘、prompt caching、剧本 jsonSchema+解析容错、尺寸提示修正 | ~3 天 |
| 5 | P1-P2 | 体验与计费：完成通知、费用矫正、流式进度预览、原生保存、PDF/长图导出、选中文本入口、文案统一 | ~3 天 |
| 6 | P2 | 宿主改造（mulby 仓库两分支）：图像流 `__requestId`、edit 中止链路、size/aspectRatio 透传、host-worker 递归代理 | ~3 天 |
| 7 | P3 | 架构：packages/manga-kit 公共包、mulby-types 单点分发、createAbortScope、App.tsx 状态机拆分 | ~4 天 |

### 1.3 全局设计决定（各章统一遵守）

- **D1** 中止机制保持"全局纪元 epoch"（`abortAllAiTasks`/`getAbortEpoch`），不引入 AbortController 重构；App 层竞态修复采用"运行代际"检查（捕获 epoch，迟到回调发现纪元已变即丢弃）。
- **D2** Start Over 与重新生成剧本统一先调用 `handleCancelAll()`。
- **D3** 参考图附件缓存：`mulbyAiService` 模块级 Map（key = dataUrl 前 256 字符 + 长度，value = Promise 化 attachmentId），命中失效（`attachments.get` 为 null）则重传；不再 finally 删除；新剧本生成成功时统一清缓存并删除旧附件。
- **D4** 并发控制：App 内 `asyncPool(limit=2)` 替代 `setTimeout` 错峰；失败自动重试 1 次（AbortError 除外）。
- **D5** 持久化 key：`storage.set('config')` / `storage.set('session')`；二进制走 `storage.attachment.put`，key 约定 `page-<n>` / `char-<name>` / `prop-<name>`；生成时增量落盘，`onPluginOut` 只兜底保存小体积元数据。
- **D6** 宿主改造开两个分支：`feat/ai-image-abort-and-size`（preload 图像流补发 `__requestId`；`images.edit` 增加 requestId/AbortController 链路；edit/generate 链路 size 与 aspectRatio 透传）与 `fix/host-worker-nested-api`（host-worker 代理支持任意深度命名空间）。插件侧对宿主新能力一律特性探测降级，老宿主也能跑。
- **D7** 每条注明 horror-manga 回灌适用性。
- **D8** 文件引用统一 `路径:行号` 形式，行号以核对时的代码为准。

### 1.4 实施顺序与依赖

```
第 2 章 P0 缺陷批（无依赖，先行）
   └─ 2.1 的代际检查基座 → 被 4.2 asyncPool、3.1 持久化清理联动复用
第 3 章 持久化 ┐
第 4 章 管线   ├─ 互相独立，可并行；两者都依赖 2.1 的运行生命周期
第 5 章 体验计费 ┘  其中 5.3 带参考图路径依赖第 6 章宿主分支落地
第 6 章 宿主两分支（与 2-5 并行推进；合并后插件侧按特性探测逐步启用）
第 7 章 架构（最后做；7.4 明确依赖 3/4 章先落地）
```

验收统一原则：每章条目自带可勾选验收清单；插件侧每批改动跑 `pnpm run build` + `tsc --noEmit` + `mulby pack`，宿主分支跑 `npm run verify:app`；真机验收场景以各章清单为准。

### 1.5 实施进度

| 章 | 状态 | 说明 |
|---|---|---|
| 2 | ✅ 已实现（2026-07-18） | 2.1-2.6 全部落地，build/tsc/pack 通过；真机验收清单待手工执行 |
| 3 | ✅ 已实现（2026-07-18） | 新增 services/persistenceService.ts + App/ConfigPanel 接线；build/tsc/pack 通过；真机验收待手工（强杀恢复、独立窗口关闭恢复、防抖观测） |
| 4 | ✅ 已实现（2026-07-18） | 4.1-4.7 全部落地 + 第 6 章插件侧对接（edit 自带 requestId 真中止 + size/aspectRatio 透传，零探测老宿主退化）；build/tsc/pack 通过；真机重点：附件仅上传一次、并发 ≤2、中止后无重试补发、续绘、json_schema 老网关兼容 |
| 5 | ✅ 已实现（2026-07-18） | 5.1-5.7 全部落地（通知+防噪、计费矫正+pricing.ts 自维护价表、无参考图路径 generateStream 进度/预览+图像流 requestId 登记、全量中文化 strings.ts、原生保存、PDF/长图/阅读模式、over/files 入口+onPluginInit）；jspdf 懒加载 chunk 使 .inplugin 610KB→851KB；build/tsc/pack 通过；**上线前需人工核对 pricing.ts 价目数值（2026-07-18 示意快照）** |
| 6 | ✅ 已实现（2026-07-18） | mulby 仓库两分支均提交并通过 verify:app 全绿（main 未动、未 push）：`feat/ai-image-abort-and-size` @ 7e57eb7（9 文件 +436/-44，新增 11 单测，671/671）、`fix/host-worker-nested-api` @ 784af47（新增 13 单测，673/673）；合并与真机验收待用户决定 |
| 7 | ✅ 已实现（2026-07-18，tech-manga 范围） | packages/manga-kit + packages/mulby-types + sync 脚本 + App.tsx 拆分（1296→801 行，4 hooks + promptBuilder）；构建产物迁移前后逐文件 md5 一致；horror-manga 换装与其余 45 份 d.ts 拷贝迁移列为遗留项 |

**全部章节实施完毕（2026-07-18）。** 遗留项汇总：① horror-manga 换装 manga-kit/@mulby-plugins/types（含 AbortController→createAbortScope 统一）；② 其余 45 份 mulby.d.ts 拷贝渐进迁移（8 份手写 stub 建议保留）；③ sync-mulby-types --check 挂入 CI 与 CONTRIBUTING 增补；④ compiler-API 类型 rollup 管线；⑤ useComicWorkflow reducer 化 + kit 单测（仓库无测试基建）；⑥ pricing.ts 上线前人工核价；⑦ 全章真机回归（各章验收清单）与宿主两分支合并决策。

实现偏差记录（以代码为准）：

**真机回归发现（2026-07-19）**：资产生成期间切换 Storyboard 标签页（Asset Studio ↔ Script）导致 CharacterGenerator 卸载重挂载，实例级在途去重（2.6 的 inFlightRef）随实例归零，自动循环对"尚无图"的在飞资产重复发起请求——旧请求先写入一张、重复请求再覆盖一张，双倍计费且日志全 OK（无失败，withRetryOnce 未触发）。修复：在途跟踪提升为模块级注册表（key=资产名，跨重挂载稳定），命中在途项时领养同一 Promise 而非重发（fix/tech-manga-duplicate-imagegen 分支）。
- 2.4 的 `resolveByName` 泛型约束从 `{ name: string }` 加宽为 `NamedSheetItem { name; referenceImage? }`：项目内个别调用点 tsc 泛型推断退化到约束类型（探针无法复现的推断边缘行为），加宽约束后推断成功与否均类型正确；行为与方案一致。

## 2. 缺陷修复批：插件侧小改动（优先级 P0）

> **状态：✅ 已实现（2026-07-18）**。2.1 统一运行生命周期（handleCancelAll 收敛 + 运行代际检查 + Start Over 确认弹窗与降级）、2.2 AI Refine 修复（instr 透传 + 失败可见 + 输入保留）、2.3 页码归一化（service 层单点）、2.4 resolveByName 统一收口（六个调用点 + ScriptEditor 侧栏）、2.5 epoch 权威中止判定（删 isAbortLike + safeAbort 加固）、2.6 in-flight 单飞去重 + 中止标注。验收清单中的真机场景待手工回归。

本章处理当前就在出错或直接烧钱的缺陷：Storyboard Editor 的逐字段润色整体失效（死按钮）、Start Over / 重新生成 / 快速中止三条路径共用的运行生命周期缺口（排队定时器继续计费、跨运行资产串台、迟到回调打崩新任务状态）、模型输出 page_number 被直接当主键、参考图模糊名匹配画错人、错误被误判为用户中止而静默吞掉、资产手动/自动双跑双倍计费。全部改动都在插件侧（App.tsx、components/、services/ 共 5 个文件），不依赖第 6 章的宿主分支（D6），可以立即落地；其中 2.1 按全局决定 D1/D2 实现为一个统一的"运行生命周期"方案，供后续 D4（asyncPool）与 D5（持久化）章节直接复用其代际检查基座。六个条目合计约 3 天。

### 2.1 统一运行生命周期：Start Over / 重新生成 / 生成-中止-生成 竞态（合并条目 16、24、25）

- **现状与根因**：三个症状同一根因——运行的"开始 / 中止 / 被替代"没有统一边界，App 层完全没有代际保护（`getAbortEpoch` 在 App.tsx 全文未被引用，唯一使用者是 components/CharacterGenerator.tsx:50/58/73，说明该模式是既定做法而 App 层漏配）：
  1. **Start Over 不清理（条目 25）**：App.tsx:562-568 的 Start Over 只 `setWorkflowStep(CONFIG)`；`pendingTimersRef` 仅在 handleCancelAll（App.tsx:95-103）里清空，于是 App.tsx:364-370 每 1.2s 一个的定时器队列继续逐页发起真实计费的 `attachments.upload + images.edit`，epoch 未变、service 的 `throwIfAborted` 放行，结果按 page_number（App.tsx:382-386）写回。更糟的是 STORYBOARDING 自动生成期间 Start Over→立即生成新剧本：CharacterGenerator 卸载但顺序循环仍跑（cleanup 只清 500ms 启动 timer，components/CharacterGenerator.tsx:83-88），deps=[] 的 `handleCharacterUpdate`（App.tsx:243-255）把 A 剧本的角色（名字+图）按 index 顶进 B 剧本 characterSheet 并污染 `comicScript.character_sheet`；且 Start Over 后停在 CONFIG 期间 `isProcessing=false`、`pages=[]`、`workflowStep=CONFIG`，App.tsx:570 的"中止全部任务"按钮三个显示条件全不满足直接消失——孤儿循环持续烧钱，用户连手动止损入口都没有（即便立刻点生成让按钮随 isProcessing 回来，点它也会连新任务一起杀掉）。
  2. **重新生成不清理（条目 25）**：handleGenerateScript（App.tsx:176-183）不调 handleCancelAll、不 bump epoch，且 `setTokenUsage(INITIAL_USAGE)` 已清零——旧任务迟到的 `trackUsage` 会把上一轮花费记进新一轮统计。
  3. **生成-中止-生成竞态（条目 24）**：快速"生成 A→中止→生成 B"时，A 的迟到 AbortError 走 App.tsx:208-218 的 catch/finally，无条件 `setWorkflowStep(CONFIG)` + `setIsProcessing(false)`——B 正在流式中却失去中止按钮，再点生成产生 C 则 B/C 双流交替覆写 outputLog。图像同理：triggerImageGeneration 的 catch（App.tsx:387-404）按 page_number 写回、无代际校验，且图像请求无法真正杀掉（services/mulbyAiService.ts:31-32 注释），孤儿 promise 悬挂数秒到数十秒，中止后立即重绘同页几乎必然被迟到回调覆写成"已被用户中止"。
  4. **Start Over 无确认且是单向门（条目 16）**：无二次确认；CONFIG 视图（App.tsx:594-610）没有任何"继续上次"入口，comicScript/pages 还在内存但用户再也看不到，唯一出路是重新生成再烧一遍钱。
- **改动方案**（遵守 D1：不引入 AbortController，复用全局 epoch 作为"运行代际"；遵守 D2：两个入口统一先 handleCancelAll）：
  1. App 层引入代际判断（与 CharacterGenerator 既有模式同款）：
     ```ts
     import { getAbortEpoch } from './services/mulbyAiService'; // 并入 App.tsx:9 既有 import
     /** 本轮运行的回调是否已过期（用户中止过 / 新一轮已开始） */
     const isStale = (runEpoch: number) => runEpoch !== getAbortEpoch();
     ```
  2. `handleGenerateScript` 开头统一清场并捕获代际，所有异步后 setState 前先比对：
     ```ts
     const handleGenerateScript = async () => {
       handleCancelAll();                    // D2：终止上一轮（bump epoch + 清定时器 + 关 isProcessing）
       const runEpoch = getAbortEpoch();     // D1：捕获本轮代际
       // ...原有 setGlobalError/setIsProcessing/setInputLog/setOutputLog/setPages([])/setTokenUsage(INITIAL_USAGE)...
       try {
         // ...await generateComicScript(...)
       } catch (error: any) {
         if (isStale(runEpoch)) return;      // 迟到回调：本轮已被中止/替代，丢弃，不碰 UI
         if (error?.name === 'AbortError') { setWorkflowStep(WorkflowStep.CONFIG); } // 防御性保留；正常中止路径由步骤 4 收敛
         else if (!handlePermissionError(error)) { /* 原有错误分支 */ }
       } finally {
         if (!isStale(runEpoch)) setIsProcessing(false);  // 过期回调不许关新一轮的 processing
       }
     };
     ```
     epoch bump 后，service 层 `throwIfAborted` 在 `onUsage` 之前执行（generateComicScript 为 :507→:515，generatePanelImage 为 :744→:746），旧任务的 trackUsage 污染自动消失，无需额外改 trackUsage。
  3. `triggerImageGeneration` / `handleStartComicGeneration` / `handleRegeneratePage` 同样在入口捕获 `runEpoch`，`setPages` 写回（成功、AbortError、失败三个分支）前统一 `if (isStale(runEpoch)) return;`。注意 handleRegeneratePage 是单页重试，**不**调用 handleCancelAll（不能误杀其它在飞页），只捕获当前代际。
  4. handleCancelAll 增加一行，把"中止剧本生成时回到配置页"的语义收进统一入口（补偿步骤 2 中 stale 分支不再各自 setWorkflowStep；函数式更新，useCallback deps=[] 不变）：
     ```ts
     setWorkflowStep(prev => prev === WorkflowStep.SCRIPT_GENERATION ? WorkflowStep.CONFIG : prev);
     ```
  5. Start Over 改为"确认 + 真正重置"（条目 16 的方案①+③；方案②面包屑自由往返属 UX 增强，移交 UX 章节）：
     ```ts
     const handleStartOver = async () => {
       const done = pages.filter(p => p.imageData).length;
       const dlg = window.mulby?.dialog;
       const ok = dlg?.showMessageBox
         ? (await dlg.showMessageBox({
             type: 'warning',
             message: 'Start Over 将中止所有在途任务，并丢弃当前剧本与已生成页面',
             detail: done > 0 ? `已生成 ${done} 页图像，此操作不可恢复。` : undefined,
             buttons: ['取消', '丢弃并重新开始'], defaultId: 0, cancelId: 0,
           })).response === 1
         : window.confirm('将丢弃当前剧本与已生成页面，确定重新开始？'); // 老宿主降级
       if (!ok) return;
       handleCancelAll();      // 停定时器、bump epoch（连带停掉 CharacterGenerator 循环）
       setComicScript(null); setCharacterSheet([]); setPropSheet([]);
       setPages([]); setInputLog(''); setOutputLog(''); setGlobalError(null);
       setWorkflowStep(WorkflowStep.CONFIG);
     };
     ```
     `dialog.showMessageBox` 三层链路已核实可用且无需 manifest 权限：类型声明 src/types/mulby.d.ts:763-771（返回 `Promise<{ response: number; checkboxChecked: boolean }>`），preload mulby/src/preload/apis/platform-api.ts:96-104，主进程 mulby/src/main/ipc/dialog.ts:65-68；插件窗口的受限模式只裁剪 runCommand 策略类 API（mulby/src/preload/index.ts:22/29 + platform-api.ts:10-11），dialog 不在受限名单。按 D6 原则仍做特性探测降级。
  6. CharacterGenerator 的跨运行串台**不需要改该组件**：Start Over / 重新生成统一走 handleCancelAll 后 epoch 必变，循环内 components/CharacterGenerator.tsx:58/73 的既有 epoch 检查即生效停止，在飞的单张也会被 service 层 `throwIfAborted`（:584，位于 onUsage 与写回之前）作废（该组件的残余双跑问题在 2.6 处理）。本方案的代际检查独立于排队机制，后续 D4 用 asyncPool 替换 setTimeout 错峰时可原样保留。
- **验收标准**：
  - [ ] COMIC_GENERATION 中点 Start Over 并确认：宿主日志无新的 `[AI] editImage:start` / `[AI] generateImages:start`（mulby/src/main/ai/service/image-orchestration.ts:86/233）记录，TokenMonitor 停止增长
  - [ ] STORYBOARDING 自动生成角色期间 Start Over→立即生成新剧本：新 characterSheet 无旧剧本角色名/图串入
  - [ ] 生成 A→中止→300ms 内生成 B：B 全程保留"中止全部任务"按钮；outputLog 无双流交替串写；A 的迟到 AbortError 不把界面打回 CONFIG、不关闭 B 的 isProcessing
  - [ ] 中止后立即重绘某页：新图落地后不被"已被用户中止"横幅覆盖
  - [ ] Start Over 弹确认框；取消后界面与在途任务完全不受影响；确认后 comicScript/pages/日志全部清空
  - [ ] 模拟无 `mulby.dialog` 的老宿主：window.confirm 降级路径生效
- **工作量**：M，约 1 天（半天实现，半天按清单手工回归竞态场景）。
- **风险与回滚**：改动集中在 App.tsx 编排层（含 handleCancelAll 补一行），不触碰 service 与各组件文件。主要风险是 stale 检查漏配某个 setState 导致 UI 卡在生成态——以"finally 里非 stale 才关 isProcessing、handleCancelAll 无条件关"双保险兜底。回滚 revert App.tsx 单文件。
- **horror-manga 适用性**：部分适用——horror-manga 已用 AbortController + `signal?.aborted` 前置检查（horror-manga/App.tsx:474/515/532）且无 Start Over 按钮，竞态面小得多；仅需对照检查"重新生成剧本前是否统一 abort 旧 controller"并补确认弹窗。

### 2.2 修复 Storyboard Editor 的「AI Refine」死按钮（条目 17）

- **现状与根因**：components/ScriptEditor.tsx:17 的 `instruction` state 从未被写入（全文唯一调用 `setInstruction` 处是 :56 的清空）；handleRefine 首行守卫 components/ScriptEditor.tsx:36 `if (!instruction.trim()) return;` 恒真，永远提前返回；四处调用点（components/ScriptEditor.tsx:143/162/187/203）均写成 `onRefine={(instr) => handleRefine('X', text, idx)}`——RefineBox 传出的 `instr` 被整体丢弃；而 RefineBox 在 components/ScriptEditor.tsx:273/276 回调后立刻清空自己的输入框，用户看到输入消失误以为提交成功，实际零请求发出。README 宣传的"逐字段 AI 指令润色"在 Overview/封面/Layout/Prompt 四处全部失效。附带问题：catch（:57-58）只 `console.error`，失败无任何 UI 反馈；components/PanelCard.tsx:45-46 的润色失败同款静默。
- **改动方案**：
  1. handleRefine 增加 `instr` 形参并透传，删除组件级 `instruction`/`setInstruction`；返回是否成功，供 RefineBox 决定是否清空输入：
     ```ts
     const handleRefine = async (
       target: 'ANALYSIS' | 'COVER' | 'LAYOUT' | 'PROMPT',
       currentText: string,
       instr: string,
       pageIdx?: number
     ): Promise<boolean> => {
       if (!instr.trim()) return false;
       setRefiningField(target); setRefineError(null);
       try {
         // ...原有 context 构建不变...
         const refined = await refineText(currentText, instr, context);
         // ...原有四个 target 分支写回...
         return true;
       } catch (e: any) {
         setRefineError({ target, message: e?.message || 'AI 润色失败，请重试' });
         return false;
       } finally { setRefiningField(null); }
     };
     ```
  2. 四处调用点改为 `onRefine={(instr) => handleRefine('ANALYSIS', script.analysis, instr, -1)}`（其余三处同理）。
  3. RefineBox 的 `onRefine` 签名改为返回 `Promise<boolean>`，仅成功才清空：`const ok = await onRefine(val); if (ok) setVal('');`——失败时保留用户输入；配合新增 `refineError: { target, message } | null` state，仅在对应 target 的盒子下方渲染错误文案（作为 prop 传入 RefineBox 或由父级紧邻渲染均可）。
  4. components/PanelCard.tsx:45-46 同步把 `console.error` 换成组件内错误提示（复用其既有错误展示样式）。费用漏记（润色调用未接 trackUsage）属条目 12 的计费章节范畴，此处只保留 `refineText` 已有的 `onUsage` 可选形参不动。
- **验收标准**：
  - [ ] Overview/封面/Layout/Prompt 四处输入指令后回车与点击均发起 refineText 请求且文本被替换
  - [ ] 空指令点击/回车不发请求
  - [ ] 断网或无文本模型时显示错误文案，且输入框内容保留可重试
  - [ ] PanelCard 的 prompt 润色失败同样有可见错误提示
- **工作量**：S，半天。
- **风险与回滚**：纯组件内改动，不触碰 service 与 App；回滚 revert components/ScriptEditor.tsx 与 components/PanelCard.tsx。
- **horror-manga 适用性**：不适用——horror-manga/components/ScriptReviewPanel.tsx:29/155 已正确绑定 `setInstruction`，无死按钮；仅 :72 的失败 `console.error` 静默可比照第 4 点顺带改进。

### 2.3 page_number 规范化：不再信任模型输出作 React key 与回写主键（条目 28）

- **现状与根因**：services/mulbyAiService.ts:528 对流式拼接结果 `JSON.parse` 后直接 `as ComicResponse`，schema 文本（services/mulbyAiService.ts:269）只写 `"page_number": Integer`，无起始值与唯一性约束；App.tsx:283 封面固定 `page_number: 0`；App.tsx:688 用 page_number 作 React key；triggerImageGeneration（App.tsx:382-403）与 handleRegeneratePage（App.tsx:408/455-466）均按 `p.page_number === page.page_number` 批量写回。模型返回 0 起始页码（与封面撞号）或重复页码（长剧本常见幻觉）时：重复 key 触发 React 复用错乱；撞号两页被同一张图或同一个 error 同时覆盖，封面可被正文覆盖，两路请求互相覆写 `isGenerating` 出现永远转圈/提前停转的页；handleDownloadAll（App.tsx:491-495）按页码拼 zip 文件名，撞号条目在 zip 内被静默覆盖；components/ScriptEditor.tsx:111 侧边栏同样用 page_number 作 key。（核对修正：findings 原文把 handleCancelAll 列入"按页码写回"名单不准确——它按 `p.isGenerating` 匹配（App.tsx:100-102），与页码无关；以代码为准，不影响结论。）
- **改动方案**：在 service 层收口，解析成功后立即按数组序规范化，一行闭环（ScriptEditor 不能增删页，规范化一次即终身唯一）：
  ```ts
  const parsed = JSON.parse(cleanJson(fullText)) as ComicResponse;
  parsed.pages = (parsed.pages ?? []).map((p, i) => ({ ...p, page_number: i + 1 }));
  return parsed;
  ```
  封面保持 0、正文从 1 开始，App.tsx:688 与 components/ScriptEditor.tsx:111 的 `key={page.page_number}`、所有按页码写回及 zip 命名逻辑均无需改动即恢复正确性。
- **验收标准**：
  - [ ] 手工构造 `page_number` 为 0 起始/含重复的剧本 JSON（临时改 fullText 注入）：进入绘制后封面与各页互不覆盖，转圈状态各自独立
  - [ ] zip 导出条目数等于有图页数，无静默覆盖
  - [ ] 正常剧本行为不变，侧边栏与 PanelCard 页码连续 1..N
- **工作量**：S，半天以内（含构造异常剧本回归）。
- **风险与回滚**：若模型给页码赋予了叙事语义（如"第 X 话"），规范化会抹掉——本插件页码仅用于排序、key 与文件名，无此语义；回滚 revert 单行。
- **horror-manga 适用性**：适用——同样 LLM 产出 page_number（horror-manga/services/mulbyAiService.ts:318）、`key={page.page_number}`（horror-manga/App.tsx:740）与按页码写回（horror-manga/App.tsx:521/535/545）；其 App.tsx:388 的 `s.page_number || (index + 1)` 只兜底 0/缺失页码、不去重，重复页码仍会撞号，本方案可原样移植补齐。

### 2.4 参考图名字匹配：短名/子串误配统一收口（条目 26）

- **现状与根因**：绘图路径三处双向 `includes` 模糊匹配——getCharacterReference（App.tsx:168-171，已小写化）、场景解析（App.tsx:303-305 角色、326-328 道具，大小写敏感）、重绘解析（App.tsx:418-420/430-432，大小写敏感）——均无长度下限且取 `find` 首个命中。失败场景：中文短名"大雄"在表内同时存在"大雄的妈妈"（排前）与"野比大雄"时命中妈妈；单字名（历史模式"亮"、"操"）命中任意含该字表项；封面路径查主角"AI"时 `"captain".includes("ai")` 命中 Captain。错误参考图经 images.edit 的 IDENTITY-STRICT 提示词（services/mulbyAiService.ts:691）直接把整页画成错误角色且用户难以察觉。三处实现还不一致（仅封面路径小写化），同一名字封面能匹配、内页失败。加重因素（验证员补充，已核实）：App.tsx:166-167 精确命中的表项若 `referenceImage` 尚未生成，会继续落入 fuzzy 分支——名字完全一致也可能拿到他人立绘。
- **改动方案**：抽统一 helper，五个调用点全部替换：
  ```ts
  const norm = (s: string) => s.toLowerCase().trim();
  const CJK = /[一-鿿]/;
  const fuzzyAllowed = (s: string) => (CJK.test(s) ? s.length >= 2 : s.length >= 3);

  function resolveByName<T extends { name: string }>(name: string, sheet: T[]): T | undefined {
    const target = norm(name);
    const exact = sheet.find(c => norm(c.name) === target);
    if (exact) return exact;                      // 精确命中即终止，不再落入 fuzzy（修复加重因素）
    if (!fuzzyAllowed(target)) return undefined;  // 短名禁用 fuzzy：宁缺勿错
    const hits = sheet.filter(c => {
      const n = norm(c.name);
      return fuzzyAllowed(n) && (n.includes(target) || target.includes(n));
    });
    // 多候选取与目标长度差最小者（"大雄"→"野比大雄"而非"大雄的妈妈"）
    return hits.sort((a, b) =>
      Math.abs(norm(a.name).length - target.length) - Math.abs(norm(b.name).length - target.length)
    )[0];
  }
  ```
  getCharacterReference 内部改用 `resolveByName(name, sheet)?.referenceImage`；App.tsx:303-305/326-328/418-420/430-432 四处 `find||find` 替换为 `resolveByName(name, characterSheet)` / `resolveByName(name, propSheet)`。行为变化说明：精确同名但立绘未生成时返回"该角色、无参考图"，页面仍带 Identity 文字上下文、退化为无参考绘制——比拿他人立绘正确。顺带项：components/ScriptEditor.tsx:66/70 的 getCharImage/getPropImage 是同款双向 includes（仅侧栏头像展示、非计费路径），可一并换用 helper 保持口径一致。
- **验收标准**：
  - [ ] 表内同时含"大雄的妈妈"（排前）与"野比大雄"时，场景"大雄"解析为野比大雄
  - [ ] 名为"AI"的主角不再命中"Captain"；单字名不返回任何 fuzzy 命中
  - [ ] 同一名字在封面/内页/重绘三条路径解析结果一致（统一小写归一）
  - [ ] 精确同名但立绘未生成：不注入他人参考图
- **工作量**：S，半天。
- **风险与回滚**：fuzzy 收紧后部分原本"侥幸配对"的短名变为无参考图，属预期取舍（宁缺勿错）；回滚 revert helper 及调用点。
- **horror-manga 适用性**：适用——horror-manga/App.tsx:401/489 存在同款双向 includes 匹配，helper 可直接移植（亦是条目 31 workspace 公共包的候选沉淀项）。

### 2.5 isAbortLike 子串误判：真实失败被当用户中止静默吞掉（条目 30）

- **现状与根因**：services/mulbyAiService.ts:59-62 用 `message.toLowerCase().includes('abort')` 判定中止；generateComicScript 的 catch（services/mulbyAiService.ts:532）`if (epoch !== abortEpoch || isAbortLike(error)) throw ABORT_ERROR();` 在 `console.error` 之前执行，随后 App.tsx:209-211 对 AbortError 静默回配置页——凡错误文本恰含 "abort(ed)" 的真实失败（HTTP 错误体经宿主 openai-compat 拼进 message：mulby/src/main/ai/service/openai-compat-stream.ts:319 `HTTP ${status} ${statusText} - ${body}`；provider 网关断连文案等）即被伪装成用户中止：无提示、无日志、极难排查。而跨 IPC 后宿主侧错误的 `name` 恒为 `'Error'`（宿主 preload 以 `new Error(String(payload))` 重建，mulby/src/preload/apis/ai.ts:68），子串匹配是当前唯一判据。核对修正（以宿主源码为准）：findings 原文的"AbortSignal.timeout 必现"例证不成立——宿主文本流 fetch 只挂调用方 abortSignal、无超时定时器（openai-compat-stream.ts:297-302），工具循环 120s 步进超时的报错文案为 "…timeout after 120s" 不含 'abort'（openai-compat-stream.ts:700/761，且本插件 NO_TOOLS 基本不走该路径），实际触发依赖错误文本，概率较低，但触发即完全静默，仍值得修。次要问题：services/mulbyAiService.ts:47/491 的 `try { void ai.abort(id) } catch {}` 只能防同步异常，`ai.abort` 是 IPC Promise（类型 `Promise<void>`，src/types/mulby.d.ts:1653；preload mulby/src/preload/apis/ai.ts:223），拒绝会漏成 unhandledrejection（宿主 handler 对未知 id 只 `log.warn` 不抛，mulby/src/main/ai/service.ts:436-443，实际几乎不触发，属低成本加固）。
- **改动方案**：本插件每次真实中止都**先同步 bump epoch 再调 ai.abort**（abortAllAiTasks，services/mulbyAiService.ts:42-51），因此"是否用户中止"可完全由 epoch 权威判定，无需猜错误文本：
  1. 删除 `isAbortLike`，catch 改为：
     ```ts
     } catch (error) {
       if (epoch !== abortEpoch) throw ABORT_ERROR();            // 本轮已被用户中止：按中止收敛
       if ((error as any)?.name === 'AbortError') throw error;   // 本地抛出的原生中止（防御性保留）
       console.error("Script generation failed:", error);
       throw error;                                              // 真实失败：原样上报 UI
     }
     ```
     epoch 未变时的一切错误（包括文本恰含 'abort' 的网关错误）都会走 App.tsx:212-215 的 `setGlobalError` 正常显示。保留 "epoch 已变则吞错" 是刻意的：中止唯一入口是全局 abortAllAiTasks，epoch 变化意味着用户也中止了本任务，静默收敛符合预期 UX。
  2. :47 与 :491 两处改为 `try { ai.abort(id)?.catch?.(() => {}) } catch { /* ignore */ }`，同时覆盖同步抛与 Promise 拒绝（`?.catch?.` 兼容老宿主返回 void 的实现）。
- **验收标准**：
  - [ ] 模拟 provider 返回含 "aborted" 文本的 HTTP 错误（反代 502 文案等）：UI 显示 globalError 而非静默回配置页
  - [ ] 正常点击"中止全部任务"：仍静默中止、无错误弹出（epoch 判定路径）
  - [ ] DevTools 无 unhandledrejection 噪音（中止压测）
  - [ ] 全插件 grep 无 `isAbortLike` 残留引用
- **工作量**：S，半天以内。
- **风险与回滚**：吞错口径从"文本猜测"收窄为"epoch 权威"，不会漏判真实中止；唯一注意点是未来若引入非 epoch 的中止路径需同步调整此判定。回滚 revert services/mulbyAiService.ts 单文件。
- **horror-manga 适用性**：适用——horror-manga/services/mulbyAiService.ts:435 是同款子串判定；其架构有 AbortController，改为 `signal?.aborted || error?.name === 'AbortError'` 判定并删除子串匹配即可。

### 2.6 资产生成手动/自动双跑去重（条目 29）

- **现状与根因**：CharacterGenerator 自动顺序循环（components/CharacterGenerator.tsx:44-88）逐项生成前只检查 `!currentChar.referenceImage`（:60），不检查该项是否正在生成；手动按钮只被自身项的 `generatingStates` 禁用（:200 角色 / :261 道具）且遮罩只盖图片区不盖按钮。循环生成 #2 期间用户手点 #4，循环推进到 #4 时手动请求尚未回写 referenceImage，即对同一资产发起第二次 `ai.images.generate`（services/mulbyAiService.ts:577，每次上报 `imagesGenerated: 1`）——双倍计费、`onUpdateCharacter` last-writer-wins 覆盖，且共享布尔 key 的 finally（:100-102 / :117-119）先完成者提前关闭遮罩，界面显示已完成实则仍在生成。核对确认两点：① findings 已核实线索 3 的"切走后永不自动生成"为假（本次复核一致）——App.tsx:632 是条件渲染，切回即重挂载、`initializedRef`（:34）随新实例重置，循环会重跑；② findings 给出的两个建议中"循环内读 generatingStates"按字面实现无效——循环定义在 deps=[] 的 effect 内，闭包捕获的是初始空 state，须用 ref；采用其另一建议、验证员确认可行的 in-flight 集合方案。次要问题：中止后循环在 :58/:73 静默 return，本挂载期剩余缺图项无任何提示。
- **改动方案**：in-flight Set ref 在生成函数入口做单飞去重（ref 跨渲染稳定，自动循环持有的旧闭包与手动按钮的新闭包读到同一集合；入口幂等后谁先到谁跑，后来者直接跳过）：
  ```ts
  const inFlightRef = useRef<Set<string>>(new Set());

  const handleGenerateCharacter = async (index: number, char: CharacterSheetItem) => {
    const key = `char-${index}`;
    if (inFlightRef.current.has(key)) return;   // 去重：该资产已在生成
    inFlightRef.current.add(key);
    setGeneratingStates(prev => ({ ...prev, [key]: true }));
    setErrorStates(prev => ({ ...prev, [key]: '' }));
    try { /* ...原有生成与回写... */ }
    catch (err) { /* ...原有错误处理... */ }
    finally {
      inFlightRef.current.delete(key);
      setGeneratingStates(prev => ({ ...prev, [key]: false }));
    }
  };
  ```
  `handleGenerateProp`（`prop-${index}` key）同款。单飞后每个 key 至多一个在途请求，遮罩提前关闭的 finally 竞态随之消失。可选加分项（数行级）：自动循环因 epoch 变化 return 前，给剩余缺图项 `setErrorStates` 标注"已被用户中止"，消除静默停止。
- **验收标准**：
  - [ ] 自动循环生成 #2 期间手点 #4：循环推进到 #4 时不发起第二次请求（TokenMonitor 该资产仅计费一次）
  - [ ] 任一资产生成期间连点 Generate 按钮无重复请求
  - [ ] 遮罩仅在该项唯一在途请求结束时关闭
  - [ ] （可选）中止后剩余缺图项有可见状态提示
- **工作量**：S，半天以内。
- **风险与回滚**：单文件、入口幂等，不改变任何成功路径行为；回滚 revert components/CharacterGenerator.tsx。
- **horror-manga 适用性**：不适用——horror-manga 无自动顺序循环（重生成为手动逐个触发，horror-manga/App.tsx:303 起的 handleGenerateCharacterImage），无双跑路径；仅建议顺带确认其重生成按钮在 `isGenerating` 期间已禁用。

## 3. 会话持久化与恢复（优先级 P1）

> **状态：✅ 已实现（2026-07-18）**。`services/persistenceService.ts`（schema v1、附件 id 消毒、session 800ms 防抖写入、孤儿附件清理）+ App 接线（启动读回与恢复条幅、config 500ms 防抖写回带水合门禁、增量落盘、onPluginOut/pagehide/beforeunload 三通道兜底 flush、Start Over 联动清理）+ ConfigPanel 持久化模型失效回退提示。实现偏差（以代码为准）：① 快照 effect 额外跳过 SCRIPT_GENERATION 过渡态，防残缺快照覆盖完整会话；② Start Over 确认丢弃时同步清持久化会话（方案原文"不清"与第 2 章确认框"不可恢复"语义矛盾，按后者收敛）；③ D3 附件缓存清理锚点留待第 4 章挂接；④ mulby.d.ts 的 attachment.put 返回类型按宿主实际修正为 AttachmentPutResult。真机验收注意点见 1.5。

本章解决插件「全程零持久化」的问题：tech-manga 是一条多步付费生成流水线（剧本 → 角色/道具设定图 → 逐页绘制，单次完整跑下来十几次图像调用、数美元成本），但全部工作数据只存 React state，关窗、Reload、宿主重启即全部清零；模型选择等偏好也每次归零。整体思路遵循全局决定 D5：结构化数据走 `storage.set('config')` / `storage.set('session')` 两个 KV 键，图像二进制走 `storage.attachment.put`（key 约定 `page-<n>` / `char-<name>` / `prop-<name>`），**在每个生成成功点增量落盘**，`onPluginOut` 只兜底保存小体积元数据；启动时探测到会话则提供「恢复上次创作」。清理与「Start Over / 重新生成剧本」按 D2/D3 联动：新剧本生成成功时统一覆盖旧会话、删除旧附件并清参考图上传缓存。

一处与 findings 不符、以代码为准的修正：finding 0 的 verdict 称「独立窗口关闭前发 plugin:out（src/main/ipc/window.ts:477-514）」，核对宿主代码后确认 `plugin:out` 只从 `src/main/ipc/window.ts` 的两个 IPC 处理器发出——插件自身调用 `outPlugin()`（`window.ts:477-514`）或 `mulby.close()`（`window.ts:993-1016` 的 `plugin:close`）；用户**直接点独立窗口标题栏的关闭按钮**时，走的是 titlebar `close` 动作直接 `win.close()`（`src/main/plugin/titlebar-view.ts:53-55`）→ `src/main/plugin/panel-window.ts:1147` 的 `closed` 处理——仅 `pluginView.webContents.close()` 销毁渲染进程，**不发送 `plugin:out`**。也就是说最常见的「误关窗口」丢数据场景里 `onPluginOut` 根本收不到回调，增量落盘不是优化项而是唯一可靠通道，这进一步坐实了 D5 的设计。

### 3.1 接入 storage / storage.attachment：增量落盘 + 启动恢复（合并审查条目 0 与 15）

- **现状与根因**：
  - `App.tsx:40-61`：config、comicScript、characterSheet/propSheet（含 base64 参考图）、pages（含 base64 成品图）、tokenUsage 全部只存 `useState`；grep 确认全插件对 `window.mulby.storage` 零引用（仅 `src/types/mulby.d.ts` 类型声明中出现），也无 `beforeunload` 提示。
  - `manifest.json:26`：feature 以 `"mode": "detached"` 独立窗口打开；宿主 `src/main/plugin/panel-window.ts:1147-1154` 在独立窗口 `closed` 时直接 `webContents.close()` 销毁渲染进程——关窗即真丢，且如上所述该路径不发 `plugin:out`。
  - 宿主能力已核实可用：`src/preload/apis/platform-api.ts:200-211` 暴露 `storage.attachment.put(id, data: ArrayBuffer | Uint8Array, mimeType)`（返回 `AttachmentPutResult`，即 `{ ok, error?: 'E_TOO_LARGE' | 'E_INVALID_ID' | 'E_IO' | 'E_META' }`，见 `src/shared/types/storage-v2.ts:25-36`；单文件 50MB，preload 层预检超限、主进程写入为临时文件 + 原子 rename）、`get(id) → Uint8Array | null`、`getType` / `remove` / `list(prefix?) → { id, mimeType, size }[]`；`storage.set/get` 自动 JSON 序列化（SQLite），按 `plugin:<id>` namespace 强制隔离，无需 manifest 权限声明；`src/preload/apis/app-plugin-api.ts:281` 暴露 `onPluginOut((isKill: boolean) => void)`，返回取消订阅函数。卸载插件时宿主会提示保留/删除数据（`purgeData` 可选，`src/main/plugin/manager.ts` uninstall），保留后重装可恢复（含附件文件）。唯一偏差：插件内置类型声明 `src/types/mulby.d.ts:1020` 仍把 `attachment.put` 声明为 `Promise<boolean>`（旧签名），实现时需同步为宿主实际返回的 `AttachmentPutResult`，否则 `res.ok` 过不了类型检查。

- **改动方案**：

  **步骤 1：新建 `services/persistenceService.ts`，定义存储 schema 与读写工具。**

  存储 schema（两个 KV 键 + 三类附件前缀）：

  | 位置 | key | 内容 | 体积预估 |
  |---|---|---|---|
  | KV | `config` | `{ v, savedAt, style, character, storyMode, customStoryPrompt, panelCount, aspectRatio, totalPages, textModel, imageModel }`（**不含 sourceText**，详见 3.2） | < 2KB |
  | KV | `session` | 见下方 `PersistedSession`：工作流位置 + 剧本 + 元数据，**所有 base64 字段剥离** | < 300KB |
  | attachment | `page-<n>` | 第 n 页成品图（n=0 为封面），PNG/二进制 | 每张约 2–4MB |
  | attachment | `char-<name>` | 角色设定图（name 经 ID 消毒） | 每张约 2–4MB |
  | attachment | `prop-<name>` | 道具设定图（同上） | 每张约 2–4MB |

  ```ts
  // services/persistenceService.ts
  export const SCHEMA_VERSION = 1;
  const getStorage = () => (window as any).mulby?.storage; // 特性探测：无 storage 环境全部静默降级

  export interface PersistedSession {
    v: number;
    savedAt: number;
    workflowStep: WorkflowStep;          // 恢复到哪一步
    storyboardTab: 'SCRIPT' | 'CHARACTERS';
    sourceText: string;                  // 源文本属于会话内容，随 session 存
    comicScript: ComicResponse | null;   // character_sheet/prop_sheet 的 referenceImage 已剥离
    characterSheet: (Omit<CharacterSheetItem, 'referenceImage'> & { hasReference: boolean })[];
    propSheet: (Omit<PropSheetItem, 'referenceImage'> & { hasReference: boolean })[];
    pages: (Omit<ComicPageData, 'imageData' | 'isGenerating'> & { hasImage: boolean })[];
    tokenUsage: TokenUsage;              // history 截断至最近 200 条，防 KV 膨胀
  }

  /** 剥离 sheet 内 referenceImage（referenceImage 为可选字段，剥离后仍满足 ComicResponse 类型） */
  export const stripSheetImages = (script: ComicResponse | null): ComicResponse | null =>
    script && {
      ...script,
      character_sheet: (script.character_sheet || []).map(({ referenceImage, ...rest }) => rest),
      prop_sheet: (script.prop_sheet || []).map(({ referenceImage, ...rest }) => rest)
    };

  // 附件 ID 即文件名，须满足宿主校验（src/main/ipc/_shared/attachment-id.ts：无 / \ : * ? " < > |
  // 与控制字符 \x00-\x1f、首尾空白与结尾点、Windows 保留设备名、UTF-8 ≤ 200 字节、不得以 .tmp- 开头；
  // 前缀 char-/prop-/page- 天然规避保留名与 .tmp-）。角色名可能含中文/特殊字符，统一消毒。
  // 注：不同原名可能消毒后同 id（如 "a:b" 与 "a?b"），概率极低，本期接受（见风险 3）。
  const sanitizeAttachmentId = (raw: string): string => {
    // eslint-disable-next-line no-control-regex
    let s = raw.replace(/[/\\:*?"<>|\x00-\x1f\s]/g, '_');
    while (new TextEncoder().encode(s).length > 180) s = s.slice(0, -1);
    return s.replace(/\.+$/, '') || 'unnamed';
  };
  export const attIdForPage = (n: number) => `page-${n}`;
  export const attIdForChar = (name: string) => `char-${sanitizeAttachmentId(name)}`;
  export const attIdForProp = (name: string) => `prop-${sanitizeAttachmentId(name)}`;

  /** dataURL → 附件；失败仅告警，不打断生成流程 */
  export const putImageAttachment = async (id: string, dataUrl: string): Promise<boolean> => {
    const storage = getStorage();
    if (!storage?.attachment) return false;
    const { mimeType, buffer } = dataUrlToBuffer(dataUrl); // 复用 mulbyAiService.ts:83-91，建议抽到共享模块
    const res = await storage.attachment.put(id, buffer, mimeType);
    if (!res?.ok) console.warn(`[persist] attachment.put(${id}) failed:`, res?.error);
    return !!res?.ok;
  };

  /** 附件 → dataURL（Blob + FileReader，避免手写 base64 大数组拼接） */
  export const getImageAttachment = async (id: string): Promise<string | null> => {
    const storage = getStorage();
    if (!storage?.attachment) return null;
    const data: Uint8Array | null = await storage.attachment.get(id);
    if (!data) return null;
    const mimeType = (await storage.attachment.getType(id)) || 'image/png';
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(new Blob([data], { type: mimeType }));
    });
  };

  export const clearSessionAttachments = async () => {
    const storage = getStorage();
    if (!storage?.attachment) return;
    const all = await storage.attachment.list();
    await Promise.allSettled(
      all.filter((a: { id: string }) => /^(page|char|prop)-/.test(a.id))
         .map((a: { id: string }) => storage.attachment.remove(a.id))
    );
  };

  // ---- session 防抖写入（debounce 800ms；flushSession 供兜底同步触发） ----
  let pending: PersistedSession | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  export const saveSessionDebounced = (s: PersistedSession, delay = 800) => {
    pending = s;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void flushSession(); }, delay);
  };
  export const flushSession = async () => {
    if (timer) { clearTimeout(timer); timer = null; }
    const s = pending; pending = null;
    if (s) await getStorage()?.set('session', s);
  };
  ```

  **步骤 2：App.tsx 增加会话快照 effect（任一会话状态变化即防抖落盘）。**

  ```tsx
  // App.tsx：base64 剥离后 debounce 快照；CONFIG 阶段不写（未开始创作）
  useEffect(() => {
    if (!mulbyReady || workflowStep === WorkflowStep.CONFIG) return;
    saveSessionDebounced({
      v: SCHEMA_VERSION, savedAt: Date.now(),
      workflowStep, storyboardTab, sourceText: config.sourceText,
      comicScript: stripSheetImages(comicScript), // 剥离 sheet 内 referenceImage
      characterSheet: characterSheet.map(({ referenceImage, ...rest }) =>
        ({ ...rest, hasReference: !!referenceImage })),
      propSheet: propSheet.map(({ referenceImage, ...rest }) =>
        ({ ...rest, hasReference: !!referenceImage })),
      pages: pages.map(({ imageData, isGenerating, ...rest }) =>
        ({ ...rest, hasImage: !!imageData })),
      tokenUsage: { ...tokenUsage, history: tokenUsage.history.slice(-200) }
    });
  }, [mulbyReady, workflowStep, storyboardTab, comicScript,
      characterSheet, propSheet, pages, tokenUsage, config.sourceText]);
  ```

  补强：workflowStep 迁移（进入 STORYBOARDING / COMIC_GENERATION）属关键节点，effect 内用 ref 比较前值，迁移时以 `saveSessionDebounced(s, 0)` 立即写盘，其余变化用默认 800ms 防抖。

  **步骤 3：在各生成成功点增量写附件。** 增量落盘时机表（哪个事件写哪个 key）：

  | 事件（代码位置） | 写入动作 |
  |---|---|
  | 配置变化（含模型选择） | `storage.set('config')`，debounce 500ms（见 3.2） |
  | 剧本生成成功（`App.tsx:202-206` 成功分支） | 清旧附件 `clearSessionAttachments()` + 清 D3 参考图上传缓存；新 session 由步骤 2 的快照 effect 覆盖写入（workflowStep 迁移到 STORYBOARDING 时 delay=0 立即写。注意不能在成功分支 setState 后同步调 `flushSession()`——此刻快照 effect 尚未运行、pending 为空） |
  | 剧本编辑 `handleScriptUpdate`（`App.tsx:222-240`） | 经步骤 2 的快照 effect 防抖写 `session` |
  | 角色/道具设定图生成或上传成功（`App.tsx:243-269` 收到新 `referenceImage`） | `attachment.put('char-<name>' / 'prop-<name>')`，随后快照 effect 更新 `session`（`hasReference: true`） |
  | 进入逐页生成 `handleStartComicGeneration`（`App.tsx:272`） | 快照 effect 写 `session`（workflowStep + pages 骨架，含拼接后的 image_prompt；迁移点 delay=0） |
  | 单页生成成功（`App.tsx:382-386` 前） | `attachment.put('page-<n>')` → `session`（`hasImage: true`） |
  | 单页失败/中止 | 快照 effect 写 `session`（error 字段随 pages 落盘，恢复后可单独重绘） |
  | `onPluginOut` / `pagehide` | `flushSession()` 兜底——**仅小体积元数据**，大图已在上述节点增量落盘 |

  单页成功点接线示例：

  ```ts
  // triggerImageGeneration 成功分支：图像先落附件（fire-and-forget），再更新 state
  const base64Image = await generatePanelImage(/* ... */);
  void putImageAttachment(attIdForPage(page.page_number), base64Image);
  setPages(prev => prev.map(p => /* ...原逻辑不变... */));
  ```

  **步骤 4：兜底保存。** `onPluginOut` 回调时间有限（app-events.md 明示「回调执行时间有限，避免耗时操作」；强杀路径发事件后立即销毁），且独立窗口 X 关闭根本不发 `plugin:out`（见本章导语的代码修正），因此兜底只 flush 元数据。注意事件选择：宿主关窗走 `pluginView.webContents.close()`，不带 `waitForBeforeUnload` 时 Electron **不触发 `beforeunload`**，但文档销毁会派发 `pagehide`/unload 序列——所以双保险监听 `pagehide`（覆盖 X 关窗）与 `beforeunload`（覆盖标题栏 Reload 等路径）：

  ```tsx
  useEffect(() => {
    const unsub = (window as any).mulby?.onPluginOut?.(() => { void flushSession(); });
    const onTeardown = () => { void flushSession(); }; // fire-and-forget IPC，尽力而为
    window.addEventListener('pagehide', onTeardown);
    window.addEventListener('beforeunload', onTeardown);
    return () => {
      unsub?.();
      window.removeEventListener('pagehide', onTeardown);
      window.removeEventListener('beforeunload', onTeardown);
    };
  }, []);
  ```

  **步骤 5：启动恢复流程（文字版）。**
  1. `mulbyReady` 置真后，并行读 `storage.get('config')`（3.2）与 `storage.get('session')`。
  2. `session` 存在、`v === SCHEMA_VERSION` 且 `workflowStep !== CONFIG` → 在配置页顶部显示「恢复上次创作」条幅（标题、保存时间、已完成页数/总页数），**不自动跳转**，避免劫持想开新作的用户；版本不匹配则视为不可恢复，静默丢弃。
  3. 用户点「恢复」→ 按 `hasReference` / `hasImage` 标记逐个 `getImageAttachment` 读回 `char-*` / `prop-*` / `page-*` 并转回 dataURL，装回 `characterSheet[i].referenceImage`、`propSheet[i].referenceImage`、`pages[i].imageData`；**同时把设定图重新注入 `comicScript.character_sheet` / `prop_sheet`**——维持 `handleCharacterUpdate`/`handlePropUpdate`（`App.tsx:243-269`）建立的 characterSheet ↔ comicScript 双向同步不变量（经核对，`handleScriptUpdate` 的合并（`App.tsx:222-240`）读取的是 characterSheet state 而非 comicScript，不注入不会立即丢图，但两处不一致会给后续任何以 comicScript 为准的读写埋雷）。所有页 `isGenerating` 置 false；标记 `hasImage` 但附件读不回（命中失效）的页置 `error: "图像附件丢失，可单独重绘"`；上次中断的未完成页保留其 error 态。
  4. 依次 `setConfig`（回填 sourceText）、`setComicScript` / `setCharacterSheet` / `setPropSheet` / `setPages` / `setTokenUsage` / `setStoryboardTab`，最后 `setWorkflowStep(saved.workflowStep)`。恢复后 D3 的参考图上传缓存为空，重绘时自然重传，行为正确。
  5. 用户点「放弃」→ `storage.remove('session')` + `clearSessionAttachments()`；`config` 保留。
  6. 孤儿清理：启动时若 `session` 不存在但 `attachment.list()` 有 `page-/char-/prop-` 残留（例如上次「放弃」中途崩溃、或角色改名留下旧 key），静默 `clearSessionAttachments()`。

  **步骤 6：与「Start Over / 新生成」的清理联动（D2/D3）。**
  - Start Over（`App.tsx:562-569`）：按 D2 先 `handleCancelAll()` 再回 CONFIG；**不清 session 与附件**——内存态仍在，用户可能只是回配置页看一眼。
  - 真正的清理点是**新剧本生成成功**（唯一确立"新会话"的时刻）：`handleGenerateScript` 成功分支里 `clearSessionAttachments()` + 清 mulbyAiService 的参考图上传缓存（D3 约定的统一入口）；新 session 由快照 effect 在 workflowStep 迁移时立即覆盖写入。KV 单键覆盖天然实现"旧会话覆盖"。
  - 主动丢弃入口只有恢复条幅的「放弃」按钮（步骤 5.5）。

  **步骤 7：存储容量与清理策略。**
  - 单页 1024x1536 PNG 约 2–4MB，远低于附件单文件 50MB 上限；超限时 preload 预检返回 `E_TOO_LARGE`，按"告警不阻塞"处理（图仍在内存，可导出 zip）。
  - 单会话上限估算：1 封面 + ≤15 页 + 约 5–10 张设定图 ≈ 60–100MB 磁盘，可接受。
  - **只保留一个当前会话**：不做多会话历史；新剧本成功即删旧附件、覆盖 session 键（未来若要多会话，可扩展为 `session-<ts>` 命名，本期不做）。
  - `session` KV 剥离 base64 后 < 300KB；`tokenUsage.history` 截断 200 条。
  - 所有写失败（`E_IO` / `E_META` 等）仅 `console.warn`，不打断生成流程。

- **验收标准**：
  - [ ] 逐页生成进行中强杀 Mulby 进程，重启进插件出现「恢复上次创作」；恢复后剧本、设定图、已完成页齐全，未完成页显示错误态且可单独重绘
  - [ ] 直接点独立窗口 X 关闭（不按 Esc、不走 outPlugin）再重开，同样可完整恢复——验证增量落盘不依赖 `plugin:out`
  - [ ] 恢复后继续逐页生成、单页重绘（含参考图重传）、下载 zip 均正常
  - [ ] 新剧本生成成功后 `attachment.list()` 无上一会话残留附件；「放弃恢复」后 `session` 键与附件清空、`config` 保留
  - [ ] 中文/含 `:` `?` 等特殊字符的角色名可正常存取设定图（ID 消毒生效）
  - [ ] 生成过程中 session 写入被 800ms 防抖合并（DevTools 观察无高频写）
  - [ ] `window.mulby.storage` 不可用的环境下插件功能不受影响（特性探测降级，仅无恢复能力）

- **工作量**：M，约 1.5 天（3 个半天：persistenceService + 落盘接线半天；恢复流程与条幅 UI 半天；清理联动、边界用例与真机验证半天）。

- **风险与回滚**：
  - 风险 1：pages 在逐页生成期间高频变化触发快照——已由 800ms 防抖 + base64 剥离（单次写 < 300KB）控制；outputLog/inputLog 不入快照。
  - 风险 2：schema 演进导致半恢复崩溃——`v` 版本字段兜底，不匹配即不提供恢复，宁可丢弃不可崩溃。
  - 风险 3：角色改名产生孤儿 `char-<旧名>` 附件、以及不同角色名消毒后撞同一 id（概率极低，必要时可追加短哈希后缀）——由"新剧本成功统一清理 + 启动孤儿清理"兜底，不做实时 GC。
  - 回滚：改动集中在新文件 `persistenceService.ts` 与 App.tsx 的少量接线点，可用常量开关 `PERSISTENCE_ENABLED` 一键停用；回滚后残留的 `session` / 附件数据无害，下版可清理。

- **horror-manga 适用性**：适用——horror-manga（实际路径在 `mulby-plugins/.worktrees/tech-manga/plugins/horror-manga`，任务说明中的 `plugins/horror-manga` 不存在）同为零持久化、同 `INITIAL_CONFIG`/`useState` 结构（其 App.tsx:91/112 已核实），persistenceService 与 key 约定可整体移植。

### 3.2 模型选择与常用配置持久化：「上次的选择就是这次的默认」（审查条目 19）

- **现状与根因**：`App.tsx:15-24` 的 `INITIAL_CONFIG` 每次启动从头初始化，`App.tsx:40` 无任何读回；`ConfigPanel.tsx:119-146` 的文本/图像模型双下拉空值即回落「Mulby 默认模型 / 自动（第一个图像生成模型）」，用户若有明确偏好（如指定 Gemini 图像模型保证多图一致性）每次都要重选，画风/篇幅/比例等偏好同样归零。宿主 `storage.get/set` 对插件窗口直接可用（`src/preload/apis/platform-api.ts:157-164`；restricted 模式仅封锁 shell runCommand/策略 API，不影响 storage），`ai.allModels`（`src/preload/apis/ai.ts:217`）可用于启动时校验所选模型仍存在。属高频摩擦、极低成本修复。

- **改动方案**：

  **步骤 1：App.tsx 启动读回 + 变化防抖写回 `config` 键**（schema 见 3.1 表格；`sourceText` 明确排除——它属于会话内容归 `session`，且大文本不宜随每次 keystroke 高频写 KV）。注意首写竞态：写回 effect 在挂载时也会运行，若不加保护，读回完成前就会把 `INITIAL_CONFIG` 默认值写进 KV，用 `configHydratedRef` 门禁：

  ```tsx
  const configHydratedRef = useRef(false);

  // 启动读回（mulbyReady 后一次）
  useEffect(() => {
    if (!mulbyReady) return;
    void (async () => {
      const saved = await (window as any).mulby?.storage?.get('config');
      if (saved?.v === SCHEMA_VERSION) {
        const { v, savedAt, ...rest } = saved;
        setConfig(prev => ({ ...prev, ...rest })); // sourceText 保持现值，不被覆盖
      }
      configHydratedRef.current = true; // 读回完成前不允许写回，避免默认值抢写
    })();
  }, [mulbyReady]);

  // 变化写回：排除 sourceText，debounce 500ms
  useEffect(() => {
    if (!mulbyReady || !configHydratedRef.current) return;
    const { sourceText, ...persistable } = config;
    const t = setTimeout(() => {
      void (window as any).mulby?.storage?.set('config',
        { v: SCHEMA_VERSION, savedAt: Date.now(), ...persistable });
    }, 500);
    return () => clearTimeout(t);
  }, [mulbyReady, config]);
  ```

  写回后 `App.tsx:87-89` 已有的 `setActiveModels` effect 会自动把恢复的模型注入 AI 服务，无需额外接线。

  **步骤 2：ConfigPanel.tsx 模型有效性校验。** 校验放在模型列表的持有方（`ConfigPanel.tsx:27-53` 的 effect 已加载 `allModels`），且必须独立成 effect——App 恢复 config 与 ConfigPanel 拉模型列表存在先后竞态，依赖数组要同时监听两者：

  ```tsx
  // ConfigPanel.tsx：列表加载完成后校验持久化的模型是否仍存在，失效则回退并提示
  const [staleModelNotice, setStaleModelNotice] = useState<string | null>(null);
  useEffect(() => {
    if (modelsLoading) return;
    if (config.textModel && !textModels.some(m => m.id === config.textModel)) {
      setStaleModelNotice(`上次使用的文本模型「${config.textModel}」已不可用，已回退到 Mulby 默认模型`);
      onChange({ ...config, textModel: '' });
    } else if (config.imageModel && !imageModels.some(m => m.id === config.imageModel)) {
      setStaleModelNotice(`上次使用的图像模型「${config.imageModel}」已不可用，已回退到自动选择`);
      onChange({ ...config, imageModel: '' });
    }
  }, [modelsLoading, config.textModel, config.imageModel, textModels, imageModels]);
  ```

  提示行渲染在模型选择区块（`ConfigPanel.tsx:114-154`）内，样式复用现有的黄色小字提示（`ConfigPanel.tsx:147-151`）。

  **步骤 3：恢复语义核对。** `character` 字段持久化为普通对象，`ConfigPanel.tsx:100` 的 `isCustomChar` 判断基于 name 匹配，自定义角色恢复后判定依旧正确；`storyMode = HISTORY_SERIOUS` 时 `handleInputChange` 的联动重置逻辑（`ConfigPanel.tsx:61-74`）只在用户交互时触发，读回不受影响。

- **验收标准**：
  - [ ] 选定文本/图像模型、画风、比例、篇幅、故事模式、自定义角色后关闭插件重开，全部保持
  - [ ] `sourceText` 不随 config 恢复（仅随 3.1 的会话恢复回填）
  - [ ] 在宿主设置中删除所配模型后重开插件，下拉回落默认并出现失效提示，不静默使用失效模型 ID
  - [ ] 连续快速改配置时 storage 写入被 500ms 防抖合并
  - [ ] `window.mulby.storage` 不可用的环境下不报错（可选链降级）

- **工作量**：S，半天（含真机验证）。

- **风险与回滚**：风险极低。持久化的 enum 字符串若随插件升级改值，由 `v` 版本字段兜底（不匹配即弃用整份 config）；模型校验 effect 的 `onChange` 只在检出失效时触发一次，不会形成循环。回滚：删除 App.tsx 两个 effect 与 ConfigPanel 校验 effect 即可，残留 `config` 键无害。

- **horror-manga 适用性**：适用——同样的 `INITIAL_CONFIG` 每次重建与 ConfigPanel 双模型下拉结构，两段 effect 可原样移植（仅 config 字段名按其 AppConfig 调整）。

## 4. 生成管线：省钱、提速、可靠（优先级 P1）

> **状态：✅ 已实现（2026-07-18）**，含第 6 章插件侧对接。新增 `services/asyncPool.ts`（asyncPool(2) 纪元感知 + withRetryOnce）；mulbyAiService：附件 Promise 缓存 + `clearReferenceAttachmentCache`（挂接新剧本成功锚点与 Start Over）、`STATIC_SYSTEM_PROMPT` 静态化（prompt caching）、`COMIC_JSON_SCHEMA`（strict:false）+ extractJson + 修复重试一次的三级容错、aspectRatioToSize 重写（canvasHint/requestedHint 与画布数学一致）、edit 路径自生成 requestId 登记中止集合 + size/aspectRatio 透传；App：setTimeout 错峰→asyncPool、triggerImageGeneration 包 withRetryOnce、`resolvePageRefs` 抽取共用、「续绘全部未完成页」按钮（与第 3 章恢复路径衔接）；CharacterGenerator 并入同一池删 800ms 硬睡；PanelCard 错误浮层一键重试。实现偏差（以代码为准）：① withRetryOnce 加纪元防线（被 ai.abort 杀掉的请求跨 IPC 后 name 为 'Error'，防中止后按新纪元重发计费）；② 三个图像函数 catch 补 epoch→AbortError 归一（2.5 模式外推）；③ 缓存清理挂 Start Over 确认分支而非 handleCancelAll（普通中止需保留缓存供续绘）；④ 池结束后统一补标中止项（未启动任务无法自标）；⑤ json_schema 参数被老网关拒绝时未做自动降级，错误可见留待真机再议。

本章处理"从剧本到成图"这条主管线上的钱、时间与成功率问题。当前管线存在三类结构性浪费：同一批参考图被反复上传又删除（纯浪费带宽与 UI 卡顿）、并发策略两极分化（资产阶段纯串行+硬睡，绘页阶段 16 路无上限并发且失败无重试）、以及可靠性软肋（剧本 JSON 零容错解析、尺寸提示与实际画布自相矛盾导致模型画边框白费重绘）。整体思路：以一个共享的 `asyncPool(limit=2)` + `withRetryOnce` 工具统一两个阶段的并发与重试（全局决定 D4），以模块级 Promise 缓存消灭重复上传（D3），以 `jsonSchema` API 级约束 + 解析容错把最贵的一次文本调用的成功率提到接近 100%，并用纯插件侧的一行级修正消除尺寸提示自相矛盾（宿主治本见第 6 章 D6 分支）。所有改动遵守 D1 纪元中止机制，不引入 AbortController 重构。

### 4.1 参考图附件上传一次、缓存 attachmentId 复用

- **现状与根因**：`generatePanelImage`（services/mulbyAiService.ts:671-777）每绘一页都把 `referenceImages` 中每张 data URL 走同步 `atob` 循环解码（services/mulbyAiService.ts:87-89，MB 级 base64 逐字节解码阻塞 UI 线程）→ `attachments.upload`（services/mulbyAiService.ts:721-725），`finally` 中又逐个 `attachments.delete`（services/mulbyAiService.ts:773-775）。15 页 × 每页 2-3 张参考 ≈ 30-45 次上传，实际唯一图只有约 5 张。已核对宿主 `AttachmentStore`（mulby/src/main/ai/attachments.ts）：内存 Map + 磁盘文件，无 TTL、`expiresAt` 从未赋值、`images.edit` 消费后不自动删除，附件在会话内持续有效——跨页复用完全安全；IPC 门禁也已核对：`ai:attachments:upload` 仅 filePath 上传被限制为系统窗口，buffer 上传插件可用（mulby/src/main/ipc/ai.ts `ensureAiAttachmentUploadAllowed`）。且复用还能命中宿主 upload-helpers 的 provider 远程上传缓存（`AttachmentStore.getRemote/setRemote`），属额外收益。`attachments.get` 已在 preload 暴露（mulby/src/preload/apis/ai.ts:255），可做命中校验。
- **改动方案**（严格按 D3）：
  1. mulbyAiService 模块级增加缓存，key 为 dataUrl 前 256 字符 + 长度，value 为 **Promise 形式**的 attachmentId（并发页同时 miss 时只上传一次）：
     ```ts
     // services/mulbyAiService.ts 模块级
     const attachmentCache = new Map<string, Promise<string>>();
     const cacheKeyOf = (dataUrl: string) => `${dataUrl.slice(0, 256)}:${dataUrl.length}`;

     const uploadRefCached = (ai: ReturnType<typeof getAi>, dataUrl: string): Promise<string> => {
       const key = cacheKeyOf(dataUrl);
       const hit = attachmentCache.get(key);
       if (hit) {
         // 命中失效校验：attachments.get 为 null 则重传（D3）
         return hit.then(async (id) => {
           const meta = await ai.attachments.get(id).catch(() => null);
           if (meta) return id;
           attachmentCache.delete(key);
           return uploadRefCached(ai, dataUrl);
         });
       }
       const p = (async () => {
         const { mimeType, buffer } = dataUrlToBuffer(dataUrl);
         const att = await ai.attachments.upload({ buffer, mimeType, purpose: 'vision' });
         return att.attachmentId;
       })();
       p.catch(() => attachmentCache.delete(key)); // 上传失败不留脏缓存
       attachmentCache.set(key, p);
       return p;
     };

     /** 删除全部已缓存附件并清空缓存；新剧本生成成功与 Start Over 时调用（D3） */
     export const clearReferenceAttachmentCache = () => {
       const ai = (window as Window).mulby?.ai;
       attachmentCache.forEach((p) =>
         p.then((id) => ai?.attachments.delete(id)).catch(() => { /* ignore */ })
       );
       attachmentCache.clear();
     };
     ```
  2. `generatePanelImage` 的上传循环（services/mulbyAiService.ts:721-725）改为 `uploadedAttachmentIds.push(await uploadRefCached(ai, imgData))`；**删除** finally 中的 `attachments.delete` 块（services/mulbyAiService.ts:771-776）。
  3. App.tsx 的 `handleGenerateScript` 在 `generateComicScript` 成功返回后调用 `clearReferenceAttachmentCache()`（旧剧本的角色图已作废）；Start Over 路径经由 D2 统一走 `handleCancelAll()` 的清理链，同样挂接此函数。
- **验收标准**：
  - [ ] 生成一部 10 页漫画，通过宿主日志/断点确认每张唯一参考图只触发一次 `ai:attachments:upload`；
  - [ ] 手动在宿主侧删除某附件后重绘该页，插件自动重传不报错（命中失效路径）；
  - [ ] 重新生成剧本后，旧附件被批量 delete、缓存清空；
  - [ ] 绘页阶段 UI 卡顿显著减轻（atob 解码次数从 ~40 次降到 ~5 次）。
- **工作量**：S（0.5 天）。
- **风险与回滚**：缓存 key 用前缀+长度而非全量 hash，理论上存在前 256 字符与长度都相同的不同图片碰撞，实际由 base64 随机性可忽略；若担心可换 `crypto.subtle.digest` 全量 SHA-256（异步，成本可接受）。另须明确：宿主对附件**没有** TTL 或会话结束清理任务（重启后内存记录失效，但磁盘文件遗留在 userData/ai/attachments），因此 `clearReferenceAttachmentCache` 的批量 delete 属必要清理而非锦上添花。回滚：恢复逐页上传 + finally 删除即可（旧路径的 finally 删除自身即是清理保障）。
- **horror-manga 适用性**：适用——其 `generatePanelImage` 同样逐页 `attachments.upload`（horror-manga services/mulbyAiService.ts:729）+ `images.edit`（:749），可直接搬移同一套缓存函数。

### 4.2 绘页阶段：asyncPool(limit=2) 替代 setTimeout 错峰，失败自动重试一次

- **现状与根因**：`handleStartComicGeneration`（App.tsx:364-370）对每页 `setTimeout((idx+1)*1200)` 后调 `triggerImageGeneration`，但单张图耗时 30-60s+，1.2s 错峰后 Long 档（15 页+封面）实际是 16 个 `images.edit` 同时在飞；宿主 `executeImageWithRetry`（mulby/src/main/ai/service/image-pipeline.ts:45-90）仅重试 1 次（maxAttempts=2、attempt*800ms 退避），高并发下 429 很容易耗尽。插件侧 `triggerImageGeneration` 的 catch（App.tsx:399-403）只置 `error: "Image generation failed."`，无任何自动重试，用户只能逐页手动 Regenerate（二次花钱）。注意验证员修正的一处实现约束：**插件侧拿不到结构化 `retryable`/`statusCode` 字段**——`images.*` 走 `ipcRenderer.invoke`，Electron 对 handle rejection 只保留 message 字符串，自定义属性全被剥离，因此重试判定只能基于 message 文本或"非中止即重试"。
- **改动方案**（严格按 D4）：
  1. 新建共享工具（供本条与 4.3、4.4 复用）：
     ```ts
     // services/asyncPool.ts
     import { getAbortEpoch } from './mulbyAiService';

     /** 并发上限 limit 的任务池；每次取任务前比对纪元，中止即清空排队（D1/D4） */
     export async function asyncPool(tasks: Array<() => Promise<void>>, limit = 2): Promise<void> {
       const epoch = getAbortEpoch();
       let next = 0;
       const worker = async () => {
         while (true) {
           if (getAbortEpoch() !== epoch) return; // 中止：不再取新任务
           const i = next++;
           if (i >= tasks.length) return;
           await tasks[i](); // 任务需自行吞错，池不中断
         }
       };
       await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
     }

     /** 失败自动重试 1 次（AbortError 与鉴权错误除外），重试前退避（D4） */
     export async function withRetryOnce<T>(fn: () => Promise<T>, delayMs = 1500): Promise<T> {
       try {
         return await fn();
       } catch (e) {
         const msg = String((e as Error)?.message ?? '');
         if ((e as { name?: string })?.name === 'AbortError') throw e;
         if (/403|401|PERMISSION_DENIED|Unauthorized/i.test(msg)) throw e; // 鉴权错误重试无意义
         await new Promise((r) => setTimeout(r, delayMs));
         return fn();
       }
     }
     ```
  2. `handleStartComicGeneration` 中删除 setTimeout 错峰（App.tsx:361-370）与 `pendingTimersRef`（App.tsx:92），改为：
     ```ts
     const jobs = [
       { page: coverPage, refs: coverRefs },
       ...preparedPages.map((p) => ({ page: p.pageData, refs: p.resolvedRefs })),
     ];
     void asyncPool(jobs.map((j) => () =>
       triggerImageGeneration(j.page, config.aspectRatio, j.refs)
     ), 2);
     ```
  3. `triggerImageGeneration` 内用 `withRetryOnce` 包裹 `generatePanelImage` 调用（App.tsx:375-380）；其余错误落地逻辑不变。重试的 `onUsage` 会记两笔，属真实计费，正确。
  4. `handleCancelAll`（App.tsx:95-103）删去定时器清理两行，其余不变：池 worker 在下一次取任务时发现纪元已变自然停止，未启动页仍是 `isGenerating: true`（App.tsx:351 预置），被现有的"标记为已中止"逻辑正确覆盖。
- **验收标准**：
  - [ ] Long 档生成时，任意时刻在途 `images.edit/generate` 不超过 2 个（宿主日志验证）；
  - [ ] 人为让某页第一次调用失败（如断网瞬断），该页自动重试一次并成功，UI 无感知；
  - [ ] 生成中点「中止全部任务」：在途 ≤2 个任务作废、排队任务不再发出、所有未完成页显示"已被用户中止"；
  - [ ] `pendingTimersRef` 及相关代码已删除，插件 `pnpm run build`（esbuild + vite）通过、无类型报错（插件仓库无 `verify:app`，该命令属宿主仓）。
- **工作量**：M（1 天，含并发/中止/重试三条路径的手工验证）。
- **风险与回滚**：limit=2 会拉长总墙钟时间（原先 16 路并发理论上更快），但换来 429 风险消除与费用可控，且宿主内建退避在低并发下才真正有效；如实测供应商 RPM 富余可把 limit 提到 3。回滚：恢复 setTimeout 错峰版本即可，工具文件无副作用。
- **horror-manga 适用性**：适用——其 App.tsx:460 有同款 `setTimeout((idx+1)*1000)` 错峰、同样无插件侧重试，可直接复用 asyncPool/withRetryOnce（注意其中止走 AbortController 的 `signal.aborted`，纪元比对处需替换为对应检查）。

### 4.3 资产阶段：删除 800ms 硬睡，与绘页共用并发池

- **现状与根因**：`CharacterGenerator` 的 `generateSequentially`（components/CharacterGenerator.tsx:44-88）对角色（:57-64）和道具（:72-79）逐个 `await` 生成，且每张成功后固定 `await 800ms`（:62、:77）——5 角色 + 3 道具按单张 20-40s 计要 3-5 分钟，其中 6.4s 是纯死等；与绘页阶段（改造前 16 路无上限）形成两个极端。角色/道具生成互无数据依赖，UI 状态按 `char-${idx}`/`prop-${idx}` 键 + 函数式 setState，天然支持并发更新。
- **改动方案**：
  1. `generateSequentially` 改为构建任务数组并交给 4.2 的 `asyncPool`，删除两处 800ms sleep：
     ```ts
     // components/CharacterGenerator.tsx generateSequentially 内
     const epoch = getAbortEpoch();
     const charTasks = charIndices.map((idx) => async () => {
       if (getAbortEpoch() !== epoch) return;
       const c = charactersRef.current[idx];
       if (c && !c.referenceImage) await handleGenerateCharacter(idx, c);
     });
     const propTasks = propIndices.map((idx) => async () => { /* 同理 handleGenerateProp */ });
     await asyncPool([...charTasks, ...propTasks], 2);
     ```
  2. `handleGenerateCharacter` / `handleGenerateProp` 内部用 `withRetryOnce` 包裹 `generateCharacterReference` / `generatePropReference` 调用（两函数已自带 catch 落 errorStates，池不会被打断）。
  3. 限流不再靠 sleep，交给并发上限 + 宿主内建退避 + 插件侧 withRetryOnce。保留现有逐卡片 `generatingStates` UI 反馈，无需改动。
- **验收标准**：
  - [ ] 5 角色 + 3 道具的资产阶段总耗时较改造前近乎减半（并发 2）；
  - [ ] 生成过程中多张卡片同时显示 Generating 且互不串状态；
  - [ ] 资产生成中点「中止全部任务」，池停止推进、后续卡片不再发起请求；
  - [ ] 手动点单张 Regenerate 行为不变（与自动循环并发双跑问题由第 5 章条目处理，本条不引入新竞态）。
- **工作量**：S（0.5 天）。
- **风险与回滚**：免费档低 RPM 供应商下 2 并发有轻微 429 风险（量级 3-6 RPM，宿主退避 + withRetryOnce 可覆盖）；如仍频发可将资产阶段 limit 降回 1（仍比现状快 6.4s 且代码统一）。回滚：恢复 for-await + sleep。
- **horror-manga 适用性**：不适用——horror-manga 无自动串行资产循环（CastingPanel 已移除，角色图由审阅界面的 `handleGenerateCharacterImage` 手动逐个生成，horror-manga App.tsx:303 起），无硬睡可删；若未来加自动批量生成可直接用共享池。

### 4.4 失败页一键重试与「续绘全部未完成页」

- **现状与根因**：中止后 `handleCancelAll`（App.tsx:95-103）把所有在途/排队页标记 error，一本 10 页漫画可能一次出现 8 个中止页；而 `PanelCard` 错误浮层（components/PanelCard.tsx:127-131）只是纯文本无重试按钮，用户须经「View Prompt & Dialogue」（components/PanelCard.tsx:300-310）或 hover 铅笔展开编辑面板，再点「Redraw Page」（components/PanelCard.tsx:250-256）——每页至少 2 次点击、10 页约 20 次（findings 原文的 40 次系高估，以代码为准）。普通失败页（App.tsx:399-403）同样如此。全插件无任何批量续绘入口。
- **改动方案**（纯插件端）：
  1. 错误浮层内加「重试本页」按钮，直接用当前 prompt 重发（`handleRegeneratePage` 第 3/4 参缺省时自动回退到页面现有 `characters_in_scene`/`props_in_scene` 并重建参考图与 context 块，封面页 prompt 不含 context 标记、走 App.tsx:450 兜底分支，均已核实可用）：
     ```tsx
     {/* components/PanelCard.tsx 错误浮层 */}
     {page.error && (
       <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-900/80 p-4 text-center space-y-3 z-10">
         <p className="text-red-200 text-sm font-mono">{page.error}</p>
         <button
           onClick={() => onRegenerate(page.page_number, page.image_prompt)}
           className="text-xs bg-red-700 hover:bg-red-600 text-white px-4 py-1.5 rounded font-bold"
         >
           重试本页
         </button>
       </div>
     )}
     ```
  2. App.tsx 把 `handleRegeneratePage` 中"按名字解析参考图 + 重建 context 块"的段落（App.tsx:411-453）抽成 `resolvePageRefs(page, characters, props)` 纯函数；Comic Pages 头部（App.tsx:664-683 区域）在存在未完成页时显示批量按钮：
     ```tsx
     const unfinished = pages.filter((p) => !p.imageData && !p.isGenerating);

     const handleResumeAll = () => {
       const targets = unfinished;
       setPages((prev) => prev.map((p) =>
         targets.some((t) => t.page_number === p.page_number)
           ? { ...p, isGenerating: true, error: undefined } : p
       ));
       void asyncPool(targets.map((p) => () => {
         const { refs } = resolvePageRefs(p, characterSheet, propSheet);
         return triggerImageGeneration(p, config.aspectRatio, refs);
       }), 2);
     };
     // JSX：<button onClick={handleResumeAll}>续绘全部未完成页（{unfinished.length}）</button>
     ```
     批量续绘走 4.2 的 asyncPool（原 findings 建议复用 1.2s 排队逻辑，按 D4 已被并发池取代），并自然获得失败重试与中止响应。
- **验收标准**：
  - [ ] 失败/中止页浮层出现「重试本页」，单击即重绘，无需展开编辑面板；
  - [ ] 存在 N 个未完成页时头部出现「续绘全部未完成页（N）」，点击后按并发 2 批量重发，完成后按钮消失；
  - [ ] 续绘过程中可再次「中止全部任务」，行为与首轮生成一致；
  - [ ] 封面页（page_number=0）的单页重试同样可用。
- **工作量**：S（0.5 天）。
- **风险与回滚**：`resolvePageRefs` 抽取属纯重构，须保证与 `handleRegeneratePage` 现有行为逐字一致（尤其 context 块替换逻辑 App.tsx:442-449）；建议抽取后让 `handleRegeneratePage` 也改调该函数以免双份漂移。回滚：删按钮即可，无数据影响。
- **horror-manga 适用性**：适用——其 PanelCard.tsx:172-176 同为纯文本错误浮层、无批量续绘，改法同构。

### 4.5 剧本 systemPrompt 前缀重排：命中 provider 隐式 prompt caching

- **现状与根因**：`generateComicScript` 的 systemPrompt（services/mulbyAiService.ts:377-465）约 5-8K token，以**单条 user 消息**发送（services/mulbyAiService.ts:480），且变量插值把静态前缀打得粉碎：`style` 在最顶部（:380）、`castingPhase` 含角色名（:406 展开处）、页数/分格在 PHASE 6（:431-432）、源文本嵌在中部（:434-437）、narrative 指令在 :440——任何变量变化都使整段前缀失效，OpenAI（≥1024 token 前缀自动 5-9 折）、Gemini/DeepSeek（implicit caching）全部无法命中。已核对宿主：`AiMessage` 支持 `role:'system'`（mulby/src/shared/types/ai.ts:57），openai-compat 直通（message-converters 按原 role 透传）、anthropic-helpers 合并进 system 参数；插件 `NO_TOOLS` 关闭了 skills/MCP 注入，宿主只在启用 run-command 内部工具时才前插 system 指引（capability-injection），本插件不触发，前缀稳定性完全由插件掌控。静态段（phase 规则 + JSON schema 文字版）约 1.4-1.6K token，超过 OpenAI 1024 阈值，收益真实。
- **改动方案**：
  1. 把 prompt 拆成两条消息：system 放**完全静态**的内容（Role、PHASE 1/2/4/5/7 通用规则、`getJsonSchemaString()`——模块加载时求值一次，字节稳定；正文中的 `${style}` 等插值改为指代语"the Target Art Style specified in the user message"）；user 放全部变量，且**会话内稳定的 Source Material 放最前**、可调变量放最后（验证员修正：否则调 style 仍会使源文本段失效）：
     ```ts
     const STATIC_SYSTEM_PROMPT = `Role: Professional Tech Manga Director...
     ${/* PHASE 1/2/4/5/7 全部静态规则，零插值 */''}
     ${getJsonSchemaString()}`; // 模块级常量

     // generateComicScript 内
     messages: [
       { role: 'system', content: STATIC_SYSTEM_PROMPT },
       { role: 'user', content: [
         `Source Material:\n"""\n${text}\n"""`,        // 会话内稳定，放最前
         castingPhase,                                   // 随 storyMode/角色变
         `Target Art Style: "${style}"`,
         pageCountInstruction,
         `Panels per Page: ${panelsPerPage}.`,
         `Directives for Plot & Narrative (Style Lens):\n${specificNarrativeInstructions}`,
       ].join('\n\n') },
     ]
     ```
  2. `onLogUpdate('INPUT', ...)`（services/mulbyAiService.ts:468）改为记录 system + user 拼接文本，日志观感不变。
  3. 明确边界（验证员核对）：宿主 main/ai 从未设置 Anthropic `cache_control`，走 Anthropic 供应商时本条无缓存收益（若需要可作为第 6 章宿主分支的可选项）；收益面为 OpenAI/Gemini/DeepSeek 类隐式缓存供应商。`refineText` 未传 `onUsage`（components/ScriptEditor.tsx:49）属费用统计缺口，归第 5 章费用条目处理，此处不动。
- **验收标准**：
  - [ ] 同一会话内第二次生成剧本（仅调 style 或页数）时，经 provider 控制台/账单或宿主主进程日志中的原始 usage（如 OpenAI `prompt_tokens_details.cached_tokens`）确认前缀缓存命中、输入费下降——注意宿主 `AiTokenBreakdown` 仅含 inputTokens/outputTokens（mulby/src/shared/types/ai.ts:506-509），插件侧 usage 观测不到 cached 字段，不能以插件内数字为准；
  - [ ] 拆分前后对同一输入生成的剧本质量无可感知回退（人工对比 2-3 组）；
  - [ ] LogPanel 的 INPUT 日志仍完整展示全部发送内容。
- **工作量**：S-M（0.5-1 天，主要成本在拆分后的输出质量回归验证）。
- **风险与回滚**：部分模型对 system/user 拆分的指令遵从度略有差异，若实测 JSON 遵从度下降，可把 schema 段复制一份到 user 消息尾部（牺牲少量缓存额度换稳定）。回滚：合回单条 user 消息即可。
- **horror-manga 适用性**：部分适用（改法不同，验证员修正）——其 `generateComicScript` **已经**拆成 system + user 两条消息且 user 只含源文本（horror-manga services/mulbyAiService.ts:377-380 发送、:460 组装 userPrompt），拆分动作可省；但其 systemPrompt 仍被 `${style}`/`${pageCountInstruction}`/`${narrativeInstructions}` 等插值打散（`constructSystemPrompt`，:150 起的模板），静态前缀过短同样吃不到隐式缓存，需要的是同一套"system 纯静态 + 变量集中到 user 尾部"的重排。

### 4.6 剧本 JSON 可靠性：jsonSchema API 级约束 + 解析容错 + 失败自动重试一次

- **现状与根因**（合并 findings #4 与 #23）：本插件最贵的一次调用只有软约束：schema 是拼进 prompt 的英文说明（`getJsonSchemaString()`，services/mulbyAiService.ts:249-297），`params` 只传 `responseFormat: 'json_object'`（:481）；解析侧 `cleanJson`（:108-110）仅做**小写敏感**的 ```` ```json ````/```` ``` ```` 替换，随后 `JSON.parse(cleanJson(fullText))`（:528）无任何提取/修复/重试——模型输出大写围栏、前置说明文字、截断或尾逗号时，数千 token 已计费的流式生成整体作废，App.tsx:212-214 仅显示错误并退回 CONFIG。已核对宿主完整支持结构化输出：`responseFormat: 'json_schema'` + `jsonSchema`（draft 2020-12 子集）+ `jsonSchemaName` + `strict`（mulby/src/shared/types/ai.ts:360-373），主进程 `openAiCompatJsonBody`（mulby/src/main/ai/service/utils.ts:658）与 `buildSdkStructuredOutput`（utils.ts:682）分别映射 OpenAI `response_format.json_schema` 与 AI SDK Output/Gemini responseSchema，流式路径均已接入（openai-compat-stream 与 provider-stream-orchestration）；插件 `NO_TOOLS` 满足"无工具时启用"条件。注意：宿主 `strict` **默认 true**（utils.ts `strict: params.strict !== false`），复杂嵌套 schema 在 OpenAI strict 模式下会被拒，须显式传 `false`；Anthropic 原生端点暂不注入 schema（anthropic-helpers 无 jsonSchema 处理），prompt 文字版须保留兜底。
- **改动方案**：
  1. 把 `ComicResponse` 写成真 JSON Schema 常量并传入 params（文字版 `getJsonSchemaString()` 保留在 4.5 的静态 system 段作跨 provider 兜底）：
     ```ts
     const COMIC_JSON_SCHEMA = {
       type: 'object',
       required: ['analysis', 'title', 'global_art_style', 'character_sheet',
                  'prop_sheet', 'cover_image_prompt', 'pages'],
       properties: {
         analysis: { type: 'string' }, title: { type: 'string' },
         global_art_style: { type: 'string' },
         character_sheet: { type: 'array', items: { type: 'object',
           required: ['name', 'description'],
           properties: { name: { type: 'string' }, description: { type: 'string' } } } },
         prop_sheet: { /* 同 character_sheet 结构 */ },
         cover_image_prompt: { type: 'string' },
         pages: { type: 'array', items: { type: 'object',
           required: ['page_number', 'characters_in_scene', 'props_in_scene',
                      'layout_description', 'persistent_states',
                      'state_changes_this_page', 'image_prompt'],
           properties: { page_number: { type: 'integer' }, /* ...其余字段按 types.ts */ } } },
       },
     } as const;

     params: {
       responseFormat: 'json_schema',
       jsonSchema: COMIC_JSON_SCHEMA,
       jsonSchemaName: 'comic_script',
       strict: false, // 宿主默认 true；复杂嵌套在 OpenAI strict 下会被拒（验证员核对）
     }
     ```
  2. 解析容错三级递进——本地提取 → 一次自动修复重试 → 保留原文抛错：
     ```ts
     const extractJson = (text: string): string => {
       const stripped = text.replace(/```(?:json)?/gi, '').trim(); // 大小写不敏感
       const start = stripped.indexOf('{');
       const end = stripped.lastIndexOf('}');
       return start >= 0 && end > start ? stripped.slice(start, end + 1) : stripped;
     };

     const parseScriptWithRepair = async (raw: string, onUsage?: (s: UsageStat) => void) => {
       try {
         return JSON.parse(extractJson(raw)) as ComicResponse;
       } catch (parseError) {
         // 自动重试一次：原文 + 错误信息回喂做低成本修复（非流式）
         const fixed = await getAi().call({
           ...(activeModels.textModel ? { model: activeModels.textModel } : {}),
           messages: [
             { role: 'system', content: 'You are a JSON repair tool. Return ONLY the corrected, complete JSON object. No markdown, no commentary.' },
             { role: 'user', content: `This text should be one JSON object but fails to parse (${String(parseError)}). Fix and return it:\n\n${raw}` },
           ],
           params: { responseFormat: 'json_object' },
           ...NO_TOOLS,
         });
         // 修复调用同样计费，记入 TokenMonitor
         onUsage?.({
           inputTokens: fixed?.usage?.inputTokens ?? estimateTokens(raw),
           outputTokens: fixed?.usage?.outputTokens ?? estimateTokens(String(fixed?.content ?? '')),
           imagesGenerated: 0,
           modelType: 'GEMINI_3_PRO'
         });
         try {
           return JSON.parse(extractJson(String(fixed?.content ?? ''))) as ComicResponse;
         } catch {
           const err = new Error('剧本 JSON 解析失败（已自动修复重试一次）。原始输出已保留在右侧日志面板，可复制后手动修复重用。');
           (err as Error & { rawText?: string }).rawText = raw;
           throw err;
         }
       }
     };
     ```
     `generateComicScript` 的 :528 改为 `const parsed = await parseScriptWithRepair(fullText, onUsage); throwIfAborted(epoch); return parsed;`（修复调用耗时较长，返回后需补一次纪元检查）。
  3. 保留原文供手动恢复：App 侧无需新增存储——失败路径不清空 `outputLog`（仅在 handleGenerateScript 开头清空，App.tsx:180），退回 CONFIG 后 LogPanel 仍在（App.tsx:604-608），完整原文可见可复制；只需把 App.tsx:213 的笼统文案换成上面 error.message，指引用户到日志面板。
  4. 修复调用不注册 requestId：现有 `throwIfAborted(epoch)`（:507）在修复发生之前执行，因此须按上式在修复返回后再补一次纪元检查，中止时结果被丢弃，符合 D1。
- **验收标准**：
  - [ ] OpenAI/Gemini 类供应商下，抓包/宿主日志确认请求携带 `json_schema` 结构化输出参数；
  - [ ] 构造大写围栏、前置说明文字、尾逗号三类脏输出（可 mock `ai.call`），前两类被本地提取直接救回、第三类经修复重试救回；
  - [ ] 修复重试也失败时，错误提示指向日志面板且原文完整可复制，不再退回后一片空白；
  - [ ] 修复调用的 token 进入 TokenMonitor 记账。
- **工作量**：M（1 天，含 schema 编写与三类脏输出的 mock 测试）。
- **风险与回滚**：`strict:false` 下是"强约束 + 应用层重试"而非绝对硬保证（这正是保留修复重试的原因）；个别老旧 OpenAI 兼容网关可能不认 `json_schema` 而报参数错——如遇到，特性探测降级为 `json_object`（catch 参数错误后降级重发一次，符合 D6 插件侧降级原则）。回滚：params 退回 `json_object`，解析容错部分独立保留（无回滚必要）。
- **horror-manga 适用性**：适用——同款 `cleanJson`（小写敏感，horror-manga services/mulbyAiService.ts:52）+ 裸 `JSON.parse`（:474）+ 仅 `json_object`（:381），两插件可共享 schema 常量与 `parseScriptWithRepair`（未来收敛进 packages/manga-kit）。

### 4.7 尺寸提示自相矛盾的插件侧修正（宿主治本见第 6 章）

- **现状与根因**（findings #11/#27 的插件侧短期缓解部分）：三层问题中，宿主侧两层（`images.edit` 入参无 size，mulby/src/shared/types/ai.ts:597-603；generate 直连路径 `aspectRatio: undefined` 写死，mulby/src/main/ai/service/image-pipeline.ts:661）归第 6 章 `feat/ai-image-abort-and-size` 分支治本。插件侧可立即修的是 `aspectRatioToSize`（services/mulbyAiService.ts:94-105）的**自相矛盾**：默认档 MANGA_PAGE='2:3' 被 :96 归一化为 '3:4'，而 '3:4' 映射到 '1024x1536'——1024:1536 **恰好就是 2:3**；即默认路径画布实为 2:3，拼进 prompt 的 hint（:711）却告诉模型 "portrait 3:4"，模型可能自行留白/加边框凑 3:4，导致用户不满意→手动重绘→每次都是一整张图的钱。'4:3' 与 '16:9' 也都映射到 1536x1024（实际 3:2）。`generateCharacterReference` 同病：size '1024x1536'（:580）配 "portrait 3:4" 文字（:571）。另外 edit 路径 size 整个被丢弃（:729-734 无处可传），hint 是唯一比例控制，此时应传**用户所选比例**而非画布比例。
- **改动方案**（纯插件侧，一函数 + 两处文案）：
  1. 重写 `aspectRatioToSize`，区分"画布提示"（generate 路径，须与 size 一致防留白）与"意图提示"（edit 路径，无画布，忠实用户所选）：
     ```ts
     const aspectRatioToSize = (aspectRatio: string): {
       size: string; canvasHint: string; requestedHint: string;
     } => {
       switch (aspectRatio) {
         case '1:1':  return { size: '1024x1024', canvasHint: 'square 1:1', requestedHint: 'square 1:1' };
         case '4:3':  return { size: '1536x1024', canvasHint: 'landscape 3:2', requestedHint: 'landscape 4:3' };
         case '16:9': return { size: '1536x1024', canvasHint: 'landscape 3:2', requestedHint: 'wide landscape 16:9' };
         case '9:16': return { size: '1024x1536', canvasHint: 'tall portrait 2:3', requestedHint: 'tall portrait 9:16' };
         case '3:4':  return { size: '1024x1536', canvasHint: 'portrait 2:3', requestedHint: 'portrait 3:4' };
         case '2:3':
         default:     return { size: '1024x1536', canvasHint: 'portrait 2:3 (manga page)', requestedHint: 'portrait 2:3 (manga page)' };
       }
     };
     ```
     删除 :96 的 2:3→3:4 归一化行；`generatePanelImage` 的 :711 改为 `hasRefs ? requestedHint : canvasHint`。默认 MANGA_PAGE 路径两者重合为 'portrait 2:3'，与 size 画布、PanelCard 的 `aspect-[2/3]` 展示框（components/PanelCard.tsx:93）三者完全对齐。
  2. `generateCharacterReference` 的 :571 改为 `Output image aspect ratio: portrait 2:3.`（与 :580 的 1024x1536 一致）；可顺带把 CharacterGenerator 角色卡展示框 `aspect-[3/4]`（components/CharacterGenerator.tsx:170）改为 `aspect-[2/3]` 消除裁切。
  3. 与第 6 章衔接：宿主分支给 `images.edit` 补 size/aspectRatio 透传后，插件在 edit 入参**始终附带** `size` 与 `aspectRatio` 字段——老宿主对未知字段静默忽略，天然满足 D6 的特性探测降级要求，无需版本判断；届时 requestedHint 退化为辅助提示。
- **验收标准**：
  - [ ] 默认 MANGA_PAGE 生成的无参考图页面（generate 路径）不再出现上下留白/边框凑 3:4 的成品（抽样 5 张目测）；
  - [ ] 带参考图页面的 prompt 尾部 hint 与用户所选比例一致（日志核对）；
  - [ ] 角色立绘 prompt 文字与 size 一致，Asset Studio 卡片不再裁切立绘；
  - [ ] 六个 AspectRatio 枚举值逐一过一遍映射，size 与 canvasHint 数学上一致。
- **工作量**：S（0.5 天）。
- **风险与回滚**：'4:3'/'16:9'/'9:16' 在 generate 路径短期内仍只能得到最近似画布（3:2 或 2:3）——这是宿主 size 档位限制，插件侧只能做到"提示不撒谎"，真实比例待第 6 章 aspectRatio 透传；文案改动对已生成内容无影响，回滚即恢复原函数。
- **horror-manga 适用性**：适用——其 `aspectRatioToSize`（horror-manga services/mulbyAiService.ts:38-49）与 tech-manga 逐字相同，含同一处 2:3→3:4 归一化矛盾，直接同步修正。

## 5. 体验与计费（优先级 P1-P2）

> **状态：✅ 已实现（2026-07-18）**。新增 `services/pricing.ts`（前缀匹配价表，未收录返回 null）、`services/exportService.ts`（三态保存/ZIP/PDF/长图）、`components/ReaderOverlay.tsx`（阅读模式）、`strings.ts`（约 100 条文案）、`utils/imageMime.ts`（魔数探测）、`utils/progressText.ts`；manifest 加 permissions.notification 与 over/files cmds；TokenMonitor 重写为按实际模型分组、未计价只显 token/张数；无参考图三路径改 generateStream（进度+渐进预览+`__requestId` 登记复用中止集合）；ConfigPanel pre-flight 费用预估（tokens.estimate 探测降级）；全组件中文化。主要偏差（以代码为准）：① TokenUsage 形状变更未 bump SCHEMA_VERSION，恢复路径 sanitizePersistedUsage 单独校验（旧快照仅费用统计降级重置）；② 图像流 requestId 复用 activeTextRequestIds 而非独立集合；③ 批次通知增加"批次启动纪元绑定"堵中止→立即续绘的标志误消费；④ 图像鉴权失败不再永久转圈（可被续绘拾起）；⑤ **pricing.ts 价目为 2026-07-18 示意快照，上线前须人工核价**；⑥ jspdf 动态 import，主 bundle 持平，.inplugin +240KB。

本章处理迁移后遗留的体验与计费问题：长任务无系统通知（条目 1）、费用统计整体失真（条目 3+12 合并）、图像生成假进度条（条目 2/20 的插件侧）、界面中英混杂与误导性硬编码（条目 22）、导出链路（条目 5、21）与启动器入口缺失（条目 6）。整体思路：优先用宿主已有 API（notification / tokens.estimate / images.generateStream / dialog+filesystem / onPluginInit）替换 AI Studio 时代的浏览器式实现，全部改动遵守 D1（epoch 中止）/ D2（统一 handleCancelAll）/ D4（asyncPool）/ D6（宿主新能力一律特性探测降级）。条目 2/20 中依赖宿主改造的部分（图像流 __requestId 透传、images.edit 可中止）归第 6 章，本章只做插件侧承接。注：撰写时 horror-manga 未出现在 mulby-plugins 仓库中——plugins/ 目录无此插件、分支列表亦无对应分支（tech-manga 本身位于 feat/tech-manga worktree），各条目的适用性判断基于其与 tech-manga 同源迁移结构的假设。

### 5.1 长任务完成/失败系统通知（含 manifest permissions 与防噪逻辑）

- **现状与根因**：一部 Medium/Long 漫画（含封面最多 16 页）逐页绘图要跑数分钟（App.tsx:364-370 现为 (idx+1)×1200ms 排队，D4 将改 asyncPool，不影响本条），用户切走后无任何完成提醒——manifest.json 全文无 permissions 字段，插件代码零 notification 调用；失败仅在卡片显示一行 "Image generation failed."（App.tsx:399-403）。宿主侧：window.mulby.notification.show(message, type?) 已存在（preload core-api.ts:188-191），但 main/ipc/notification.ts:5-13 会经 ensureCallerAccessPluginPermissions 校验，未声明 `manifest.permissions.notification` 时抛 `Plugin "tech-manga" lacks manifest.permissions.notification`（校验与抛错在 permission-manager.ts:850-866，错误对象由 media-permission-policy.ts:42-50 的 createMissingPluginPermissionError 构造；permissions 合法字段见 media-permission-policy.ts:13-24）；且 `silent: type === 'error' ? false : true`（notification.ts:10），error 类型带声音。
- **改动方案**：
  1. manifest.json 顶层增加：
     ```json
     "permissions": { "notification": true }
     ```
  2. App 层批次收尾通知，挂在 D4 asyncPool 全部 settle 之后（比 useEffect 监听 pages 更直接），并按 verdict 提醒做两条防噪：**中止场景不弹失败通知**（handleCancelAll 关闭批次标志 + D1 epoch 双保险）、**单页重绘不重复弹**（handleRegeneratePage 不开启批次标志，批次标志一次性消费）：
     ```ts
     // App.tsx
     const batchRef = useRef<{ active: boolean; epoch: number }>({ active: false, epoch: 0 });

     const notify = (message: string, type?: 'error') => {
       try { (window as any).mulby?.notification?.show?.(message, type); }
       catch { /* 老宿主 / 未声明权限：静默降级 */ }
     };

     // handleStartComicGeneration（asyncPool 版）末尾：
     batchRef.current = { active: true, epoch: getAbortEpoch() };
     await asyncPool(2, imageTasks); // 全部 settle（含失败重试后）
     const batch = batchRef.current;
     if (batch.active && batch.epoch === getAbortEpoch()) {  // D1 运行代际检查
       batch.active = false;                                  // 一次性消费，防重复
       // 注意用 pagesRef（或 setPages(prev => …) 旁路读取）取最新页数组，
       // 闭包里的 pages state 在长批次后是旧值
       const done = countPages(p => !!p.imageData);
       const failed = countPages(p => !!p.error);
       if (failed > 0) notify(`《${title}》生成结束：成功 ${done} 页 / 失败 ${failed} 页，可在卡片上单独重绘`, 'error');
       else if (document.hidden) notify(`《${title}》${done} 页全部生成完成`);
     }

     // handleCancelAll（D2 统一入口）内追加：
     batchRef.current.active = false;
     ```
  3. 降噪细则：全部成功且用户正盯着窗口（!document.hidden）不弹；有失败恒弹 error（带声）。剧本生成完成进入 STORYBOARDING 时，仅 document.hidden 弹一条「剧本已生成，可回来确认角色设定」。
- **验收标准**：
  - [ ] 声明 permissions 后调用不再抛 lacks manifest.permissions.notification
  - [ ] Medium 批量含失败页时收到一条 error 通知（有声），全成功且窗口在后台时收到一条静音通知
  - [ ] 点「中止全部任务」后不出现任何"失败 N 页"通知
  - [ ] 单页重绘完成不触发批量通知
  - [ ] 中止后立刻重启新批次，通知只统计新批次页数（epoch 校验）
  - [ ] 在不支持 notification 的宿主上静默降级、不抛错
- **工作量**：S，约半天（含真机验证权限链路与声音行为）。
- **风险与回滚**：纯增量，permissions.notification 是宿主已知字段（media-permission-policy.ts 白名单内）无兼容风险；嫌吵可收紧为"仅失败弹"；回滚即删 manifest 字段与 notify 调用。
- **horror-manga 适用性**：适用——同为数分钟批量绘图流程，批次标志 + epoch 防噪逻辑可原样共享。

### 5.2 费用统计矫正（tokens.estimate 兜底 + 按模型计价 / 只显 token 数）

- **现状与根因**（合并条目 3、12）：
  - 兜底估算是 `Math.ceil(text.length / 4)`（mulbyAiService.ts:113），中文场景低估约 4 倍；
  - 六处 usage 上报硬编码 modelType：'GEMINI_3_PRO'（mulbyAiService.ts:166、235、520）与 'GEMINI_3_PRO_IMAGE'（:591、:657、:759），而 ConfigPanel 可任选 Provider 模型（App.tsx:87-89 注入）；trackUsage（App.tsx:114-160）按写死 Gemini 价目计价，选 DeepSeek/GPT 时金额纯属虚构；GEMINI_2_5_FLASH_IMAGE 分支（App.tsx:135-140）无调用点，是死代码；
  - 图像 token 全不可信（verdict 修正，比 findings 原文更严重）：宿主图像编排三条路径统一用 `estimateTokens({ messages: [] })` 估算（main/ai/service.ts:517/547/569 → image-orchestration.ts:112/188/268），受 main/ai/tokens.ts:71-73 的 max(16,…) 下限影响恒返回 `{inputTokens: 0, outputTokens: 16}`，因此插件 :589/:655 的 `|| 1120` 兜底根本不触发（16 为真值），每图输出实记 16 token（按 $120/MTok 折算 ≈$0.002），成本被低记约两个数量级；:748-753 的 560/1120 也是拍脑袋常数；
  - 润色调用漏记：ScriptEditor.tsx:49 refineText、PanelCard.tsx:36-42 refineImagePrompt 均未传 onUsage（服务函数已具备该参数，mulbyAiService.ts:123/184）；
  - 宿主支持：ai.tokens.estimate（preload/apis/ai.ts:259-261 → main/ai/tokens.ts:64-79，js-tiktoken 真分词，支持 outputText 精确计输出；对 Gemini/DeepSeek 仍是近似但远优于 length/4）；宿主不暴露模型价目（AiModel 无 pricing 字段，shared/types/ai.ts:389-415），美元金额只能插件自维护——匹配不到就只显 token 数。
- **改动方案**：
  1. 数据模型重构（types.ts:140-165）：删除 ModelType 枚举与三段式 breakdown，改为：
     ```ts
     export interface UsageStat {
       kind: 'text' | 'image';
       modelId: string;            // 实际所用模型 id；文本留空时记 '(Mulby 默认)'
       inputTokens: number;
       outputTokens: number;
       imagesGenerated: number;
       estimated: boolean;         // usage 来自兜底估算时为 true
     }
     // TokenUsage.breakdown: Record<modelId, { cost: number | null; inputTokens: number; outputTokens: number; images: number }>
     ```
  2. 服务层如实上报：文本调用 modelId 取 `activeModels.textModel || '(Mulby 默认)'`；图像调用取 resolveImageModel() 返回值（已是具体 id）。
  3. 文本兜底改走 tokens.estimate（特性探测，老宿主回退到中文保守系数）：
     ```ts
     const estimateTextUsage = async (model: string | undefined, prompt: string, outputText: string) => {
       const est = getAi().tokens?.estimate;
       if (est) {
         try { return await est({ ...(model ? { model } : {}), messages: [{ role: 'user', content: prompt }], outputText }); }
         catch { /* fall through */ }
       }
       return { inputTokens: Math.ceil(prompt.length / 2), outputTokens: Math.ceil(outputText.length / 2) };
     };
     ```
     在 refineText / refineImagePrompt / generateComicScript 三处 `res?.usage` 缺失时使用（onUsage 路径改 async）。
  4. 图像计价改"按张"：宿主返回的 tokens(0/16) 直接忽略，插件维护集中价表 `services/pricing.ts`（前缀匹配，数值为示意，落地当天按官网价目更新并注释快照日期）：
     ```ts
     const IMAGE_PRICE_PER_IMAGE: Array<[prefix: string, usd: number]> = [
       ['gemini-3-pro-image', 0.24], ['gpt-image-1', 0.17], ['gemini-2.5-flash-image', 0.04]];
     const TEXT_PRICE_PER_MTOK: Array<[prefix: string, inUsd: number, outUsd: number]> = [
       ['gemini-3-pro', 2.0, 12.0], ['deepseek', 0.28, 0.42]];
     // 匹配不到 → cost = null：该行只显 token / 张数，不显美元
     ```
     trackUsage 重写为查表计价；总额显示为「已计价 $X（估算）+ N 次未计价调用」。
  5. 补漏记：ScriptEditor / PanelCard 增加 onUsage props（App 已有 trackUsage，透传），调用点补第 4 个参数。
  6. Pre-flight 预估：把剧本 systemPrompt 构造抽成 `buildScriptSystemPrompt(config)`（与 prompt caching 条目的静态前缀重排共用同一函数），导出 `estimateScriptTokens(config)`；ConfigPanel 对 sourceText 变化 debounce 800ms 调用，在 GENERATE 按钮旁显示「预计输入约 X tokens」，tokens.estimate 不可用时隐藏。
  7. TokenMonitor：删除硬编码 Gemini 三行（TokenMonitor.tsx:47-58）改为按 breakdown 的 modelId 动态渲染；历史行显示真实 modelId（删除 :77 的 GEMINI_ 前缀替换）；所有金额加「估算」角标。若 D5 的 session 落盘包含 usage，落盘结构带版本号以免旧数据反序列化失败。
- **验收标准**：
  - [ ] 选 DeepSeek/GPT 后界面无任何 Gemini 字样，费用按实际模型 id 分组
  - [ ] 未收录价目的模型只显 token/张数不显美元，总额注明未计价调用数
  - [ ] usage 缺失时兜底经 tokens.estimate（日志验证），中文估算不再是 length/4
  - [ ] ScriptEditor 与 PanelCard 的润色调用出现在 Recent Activity
  - [ ] Medium 一部（约 10 图）图像费用 = 张数 × 单价，不再是 16 token 折算
  - [ ] GENERATE 旁显示预估输入 tokens；老宿主上隐藏且不报错
  - [ ] GEMINI_2_5_FLASH_IMAGE 死代码删除，`tsc --noEmit` 无报错（插件无 typecheck script，构建通过即可）
- **工作量**：M，约 1-1.5 天（类型改动波及 service / App / TokenMonitor 三层 + 价目整理 + pre-flight 与 prompt 重构联动）。
- **风险与回滚**：按张计价仍是估算，靠全局「估算」标注管理预期；UsageStat 为 UI 侧类型无历史数据负担；回滚可按 pricing.ts / 兜底 / 补漏记三块独立回退。
- **horror-manga 适用性**：适用——TokenMonitor/trackUsage/硬编码 modelType 为同源结构，pricing.ts 与 estimateTextUsage 应进共享包复用。

### 5.3 图像生成进度与预览（generateStream；无参考图路径先行）

- **现状与根因**：generateCharacterReference（调用点 mulbyAiService.ts:577）、generatePropReference（:643）、generatePanelImage 无参考图分支（:736）走非流式 images.generate，带参考图分支走 images.edit（:729）；UI 只有 PanelCard.tsx:96-105 的 animate-loading-bar 假动画，一页 30-60s 零反馈。宿主 preload/apis/ai.ts:171-213 已有 images.generateStream，chunk 为 AiImageGenerateProgressChunk（shared/types/ai.ts:511-519）：type 'status'|'preview'、stage（start/partial/finalizing/completed/fallback）、received/total、image（渐进预览，是否出现取决于 provider 适配器；start/completed 两个 status 由编排层恒发，image-orchestration.ts:161/189）——插件完全没用，且插件本地 src/types/mulby.d.ts:1689 已声明该 API，无类型阻碍。真中止（返回 Promise 的 .abort 被 contextBridge 剥离、chunk 无 requestId）与 images.edit 可中止依赖第 6 章 feat/ai-image-abort-and-size，本条只做插件侧。
- **改动方案**：
  1. service 增加流式统一封装（维持 D1 epoch，不引入 AbortController）：
     ```ts
     export interface ImageProgress { stage?: string; message?: string; preview?: string; received?: number; total?: number }
     const activeImageRequestIds = new Set<string>();  // abortAllAiTasks 中与文本集合一并 abort + clear

     const generateImageWithProgress = async (
       input: { model: string; prompt: string; size: string; count: 1 },
       epoch: number, onProgress?: (p: ImageProgress) => void
     ) => {
       const ai = getAi();
       if (typeof ai.images?.generateStream !== 'function') return ai.images.generate(input); // 特性探测降级
       return ai.images.generateStream(input, (chunk: any) => {
         if (chunk?.__requestId) {   // 仅第 6 章宿主改造后出现；老宿主天然不发，无需额外探测
           if (epoch === abortEpoch) activeImageRequestIds.add(chunk.__requestId);
           else { try { void ai.abort(chunk.__requestId); } catch { /* ignore */ } }
           return;
         }
         if (epoch !== abortEpoch || !onProgress) return;   // 中止后迟到 chunk 丢弃
         onProgress({ stage: chunk.stage, message: chunk.message,
           preview: chunk.type === 'preview' && chunk.image ? toDataUrl(chunk.image) : undefined,
           received: chunk.received, total: chunk.total });
       });
     };
     ```
     三个无参考图调用点改走该封装并新增可选 onProgress 参数。
  2. 带参考图路径本条不改调用方式；在封装中预留分支：探测到第 6 章的可中止 edit 通道即切换。过渡期给 edit 两段式真实进度——附件上传完成时点插件自己可知（mulbyAiService.ts:721-727）：「上传参考图 → 绘制中」。
  3. UI：ComicPageData 增加 `progress?: ImageProgress`；triggerImageGeneration 把 onProgress 映射进 setPages（150ms 节流；epoch 变更即丢弃，符合 D1）。PanelCard 在 isGenerating 时：有 preview 显示半透明预览图 + stage 文案（start→排队中，partial→绘制中 received/total，finalizing→合成中），无 preview 保留进度条但叠加 stage 文案。Comic Pages 头部（App.tsx:664-683）加「已完成 X / Y 页」总进度。CharacterGenerator 资产卡片同样接入。
- **验收标准**：
  - [ ] 封面/角色/道具生成期间显示真实阶段文案；OpenAI 兼容 provider 可见渐进预览图（image-pipeline 的 partial_images 流式路径）
  - [ ] images.generateStream 缺失的宿主上自动回落非流式，功能零回归
  - [ ] Comic Pages 头部「已完成 X/Y 页」实时推进
  - [ ] 快速「生成→中止→重新生成」时旧任务预览/结果不写入新界面（epoch 检查）
  - [ ] 第 6 章分支合入后联调：中止全部任务真正取消在途无参考图请求（宿主日志验证）
- **工作量**：M，约 1 天（service 封装半天 + UI 半天；第 6 章联调另计）。
- **风险与回滚**：generateStream 与 generate 返回结构一致（shared/types/ai.ts:592-596，同为 `{ images, tokens }`），异常时一键退回非流式；preview 不出现仅是体验降级。
- **horror-manga 适用性**：适用——图像调用与假进度条为同源代码，封装入共享包后其仅需接 UI。

### 5.4 文案统一与可行动错误信息

- **现状与根因**：① 中英混杂：ConfigPanel.tsx:110 "Story Configuration"、:344 "Dreaming up your comic..."、:347 "GENERATE COMIC" 与同屏的「文本模型（剧本 / 润色）」（:121）混排；App.tsx:567 "Start Over" vs :577 「中止全部任务」；PanelCard/ScriptEditor/TokenMonitor 大量英文标签，而触发词与对白语言均面向中文用户（manifest.json:28-30）。② 误导性硬编码：LogPanel.tsx:27 "AI_AGENT_TERMINAL -- GEMINI-3.0-PRO"，TokenMonitor 的 Gemini 标签（5.2 已处理），换模型后界面仍宣称在用 Gemini。③ 错误不可行动：页面失败吞掉 error.message 只显 "Image generation failed."（App.tsx:399-403）；剧本 JSON 解析失败把 JSON.parse 原始 "Unexpected token…" 经 App.tsx:213 直接透传（解析点在 mulbyAiService.ts:528，verdict 已修正 findings 原文的 App.tsx:528）。
- **改动方案**：
  1. 全量文案统一简体中文：集中到与 constants.ts 同级的 strings.ts 常量表（约 40 处，不上 i18n 框架；注意不能放 ui/ 目录——那是 vite outDir 构建产物目录，vite.config.ts:10），专有名词（token、prompt）保留英文。涉及 ConfigPanel / App / PanelCard / ScriptEditor / CharacterGenerator / LogPanel / TokenMonitor。
  2. LogPanel 标题动态化：props 传入 config.textModel，渲染 `AI_AGENT_TERMINAL -- ${config.textModel || 'Mulby 默认模型'}`（textModel 为空时插件无法得知宿主实际路由的模型 id，按 verdict 建议显示「Mulby 默认模型」）。
  3. 页面失败透出原因与行动建议（triggerImageGeneration 的兜底分支）：
     ```ts
     error: `绘制失败：${trimErr(error?.message)}。可在卡片「编辑」中重试；若持续失败，` +
            `请在配置页更换图像模型（当前模型可能不支持多图参考输入）。`
     // trimErr: 截断到 ~140 字符，防错误层溢出（PanelCard.tsx:127-131）
     ```
  4. 剧本 JSON 解析失败翻译为可行动文案（容错解析本体归条目 23 所在章节，此处只兜文案；注意包在 JSON.parse 专属 try/catch，勿吞外层 abort 判定 mulbyAiService.ts:532）：
     ```ts
     catch { throw new Error('模型返回的剧本不是有效 JSON。建议：① 直接重试；② 更换支持 JSON 输出的文本模型。'); }
     ```
     按 verdict 不另做"一键重试"按钮——失败后已回配置页且输入保留，重试本就是一次点击。
- **验收标准**：
  - [ ] 全界面统一简体中文，无中英混排句（含按钮、占位符、loading 文案）
  - [ ] 更换模型后 grep 界面无 "GEMINI" 硬编码残留；LogPanel 显示实际模型或「Mulby 默认模型」
  - [ ] 页面失败卡片可见真实 error.message 摘要与换模型建议
  - [ ] 剧本 JSON 失败提示为中文建议文案，不出现 "Unexpected token"
- **工作量**：S-M，约 1 天（面广但机械）。
- **风险与回滚**：纯展示层；主要风险是与其他章节同文件改动的合并冲突，建议本条目排在批次最后落地。
- **horror-manga 适用性**：部分适用——混杂模式与硬编码标签大概率同源存在，但具体文案需按其题材另写。

### 5.5 原生保存流（dialog.showSaveDialog + filesystem.writeFile）

- **现状与根因**：整本导出 handleDownloadAll（App.tsx:476-515）与单页 downloadImage（PanelCard.tsx:72-80）均为 createElement('a')+click()；ConfigPanel 上传为 `<input type=file>`+FileReader（ConfigPanel.tsx:88-98）。**findings 与代码不符处（以代码为准）**：宿主未对插件 session 注册 will-download 拦截（grep 确认仅内置浏览器 InBrowserWindow.ts:605 用到），Electron 默认会为 `<a download>` 弹系统保存框，所以"用户无法选路径"很可能不成立；本条真实收益是：插件当前拿不到落盘路径（无法做成功通知 / showItemInFolder / startDrag），且下载失败对插件完全静默。宿主 API 齐备且无需 permissions：showSaveDialog/showOpenDialog（preload platform-api.ts:83-95；save 取消返回 null，open 返回**路径数组**、取消为空数组，main/ipc/dialog.ts:43/:60）、writeFile 接受 ArrayBuffer（:71-72，受系统路径黑名单 + 跨插件私有目录隔离保护，main/ipc/filesystem.ts:43-46）、shell.openPath/showItemInFolder（:48-50）、window.startDrag（core-api.ts:118）。
- **改动方案**：
  1. 统一封装（含老宿主降级）：
     ```ts
     const saveBinary = async (defaultName: string, data: ArrayBuffer,
                               filters: { name: string; extensions: string[] }[]): Promise<string | null> => {
       const m = (window as any).mulby;
       if (!m?.dialog?.showSaveDialog || !m?.filesystem?.writeFile) { legacyAnchorDownload(defaultName, data); return null; }
       const path = await m.dialog.showSaveDialog({ title: '保存', defaultPath: defaultName, filters });
       if (!path) return null;               // 用户取消：宿主返回 null，静默
       await m.filesystem.writeFile(path, data);
       return path;
     };
     ```
  2. 整本导出：`zip.generateAsync({ type: 'arraybuffer' })` → saveBinary(`${safeTitle}.zip`)；成功后 notify（复用 5.1）「已导出到 …」并提供「在文件夹中显示」（shell.showItemInFolder）；写失败 catch 后 setGlobalError 中文提示——不再静默。
  3. 单页保存：dataUrl → ArrayBuffer 复用 dataUrlToBuffer（mulbyAiService.ts:83-91，抽到共享 util），扩展名按 5.6 魔数探测结果、filter 对应。
  4. 上传统一原生：`const [path] = await showOpenDialog({ filters: [{ name: '文本', extensions: ['txt','md'] }] })`（返回路径数组，空数组即用户取消）+ filesystem.readFile(path, 'utf-8')，保留 `<input type=file>` 作降级分支。
  5. 可选增强：已保存过的成品页支持 onDragStart → window.startDrag(path) 拖进访达/聊天窗口（仅对有落盘路径的页启用）。
- **验收标准**：
  - [ ] 整本导出可选路径/文件名，成功后有通知且可一键定位文件
  - [ ] 用户取消保存无任何报错
  - [ ] 写盘失败（只读目录）有中文错误提示
  - [ ] 单页保存走原生框且扩展名与真实格式一致（配合 5.6）
  - [ ] 无 dialog API 的宿主自动回落 `<a download>`，功能零回归
- **工作量**：S，约半天；可选拖拽增强另计约 0.5 天。
- **风险与回滚**：verdict 置信度 medium 的点（Electron 默认弹框行为）不影响本方案——我们绕开默认下载行为而非依赖它；降级分支保底，回滚即删封装。
- **horror-manga 适用性**：适用——导出/上传同为浏览器套路，saveBinary 封装可直接共享。

### 5.6 PDF/长图导出、阅读模式与比例显示修复

- **现状与根因**：① 导出仅 JSZip 散图（App.tsx:476-515），分享/阅读需用户自己拼。② 固定裁切：PanelCard.tsx:93 容器写死 aspect-[2/3]、:112 img object-cover，而 constants.ts:113-119 提供 1:1/4:3/16:9 且 mulbyAiService.ts:94-105 真的按 1536x1024 生成横图——塞进 2:3 框只显示约 44% 宽度，边缘对白被裁掉，用户误以为比例设置无效。③ **findings 与代码不符处（以 verdict 修正为准）**：宿主把图像归一为纯 base64，插件 toDataUrl 恒标 image/png（mulbyAiService.ts:116-117），因此"dataUrl mime 与 .png 后缀分叉"并不发生（App.tsx:488 解析 extension 恒得 png）；真实问题更深一层——字节可能是 jpeg/webp 却统一贴 png 标签，导出后缀可能与真实格式不符，应按魔数探测。
- **改动方案**：
  1. 魔数探测真实 mime，toDataUrl 使用探测结果（App.tsx:488 现有后缀逻辑随之自动正确）：
     ```ts
     const sniffImageMime = (b64: string): string => {
       const head = atob(b64.slice(0, 16));  // 16 个 base64 字符 → 12 字节，足够覆盖 WEBP 的第 8-11 字节
       if (head.startsWith('\x89PNG')) return 'image/png';
       if (head.startsWith('\xff\xd8')) return 'image/jpeg';
       if (head.slice(0, 4) === 'RIFF' && head.slice(8, 12) === 'WEBP') return 'image/webp';
       return 'image/png';
     };
     ```
  2. 显示修复（最小改动）：容器宽高比跟随 config.aspectRatio（config 已是 PanelCard props，PanelCard.tsx:15），img 改 object-contain（生成尺寸与标称比例不一致时留边不裁切，如 16:9 实际生成 1536x1024=3:2）：
     ```ts
     const RATIO_CLASS: Record<string, string> = {
       '2:3': 'aspect-[2/3]', '3:4': 'aspect-[3/4]', '1:1': 'aspect-square',
       '4:3': 'aspect-[4/3]', '16:9': 'aspect-video', '9:16': 'aspect-[9/16]' };
     ```
  3. 阅读模式：点击成品图进入全屏 ReaderOverlay（fixed inset-0），左右方向键/点击两侧翻页、Esc 退出，按有 imageData 的页序导航（约 80 行新组件）。
  4. PDF 导出：新增依赖 jspdf（与 jszip 同为打进 bundle 的 npm 包，file:// 下无 CDN 问题），动态 import 控制主包体积；每页按各自图像像素尺寸建页（`new jsPDF({ unit: 'px', format: [w, h] })` + addPage + addImage）；webp 字节先经 canvas 转码为 jpeg（顺带压体积），走 5.5 的 saveBinary 落盘。
  5. 长图导出：canvas 纵向拼接（统一宽 1024，data: URL 不污染 canvas），toBlob → arrayBuffer → saveBinary；Long 16 页（15 页 + 封面，每页 1024x1536）高约 2.4 万 px，低于常见 32767 上限，仍加守卫超限分段导出。
  6. 导出入口改下拉：ZIP 散图 / PDF / 竖向长图。
- **验收标准**：
  - [ ] 16:9 配置下横图完整可见，各比例无裁切、无横向滚动
  - [ ] 阅读模式全屏翻页 / 键盘导航 / Esc 退出正常
  - [ ] PDF 页尺寸与图一致，系统预览可打开；10+ 页体积可控
  - [ ] 长图在 Long（16 页）不超 canvas 上限或正确分段
  - [ ] 导出文件后缀与真实字节格式一致（zip 内与单页均验证）
- **工作量**：M-L，约 1.5 天（PDF/长图各半天 + 阅读模式半天）。
- **风险与回滚**：jspdf 增加约 350KB（gzip 前），动态 import 缓解；长图内存峰值大，必要时降采样至宽 768；比例映射为纯样式可即时回滚。
- **horror-manga 适用性**：适用——恐怖漫画对连页阅读/长图分享诉求更强，阅读模式与导出管线整体可复用。

### 5.7 启动器入口：选中文本 / 文件一键改编（over/files cmd + onPluginInit）

- **现状与根因**：manifest.json:27-31 仅 3 个 keyword cmd；UI 全程不监听 window.mulby.onPluginInit（grep 确认，仅 src/types/mulby.d.ts:1959 有声明），宿主带 payload 进来也会被丢弃。宿主支持齐备：CmdFiles / CmdOver 定义于 shared/types/plugin.ts:163-185（over 的 maxLength 是字符数、默认仅 10000，接长文档需显式放大；files 的 min/maxLength 语义是**文件数**）；preload/apis/app-plugin-api.ts:225-259 的 onPluginInit 自带事件缓冲并向晚注册监听者重放（专治 React useEffect 竞态）；detached 窗口（本插件模式）同样收到 plugin:init（main/plugin/window.ts:522，payload 含 input/attachments/nonce）；files 附件带 path（InputAttachment，shared/types/plugin.ts:104-114），可 filesystem.readFile(path, 'utf-8') 读取。verdict 小修正："必须手动粘贴"略夸张——ConfigPanel.tsx:88 起已有插件内上传逻辑（handleFileUpload），缺的是启动器入口层。
- **改动方案**：
  1. manifest features[0].cmds 追加：
     ```json
     { "type": "over", "label": "改编成技术漫画", "minLength": 50, "maxLength": 100000 },
     { "type": "files", "label": "把文档改编成漫画", "exts": ["txt", "md"], "fileType": "file", "maxLength": 1 }
     ```
  2. App.tsx 挂载监听（含文件读取与错误提示；nonce 去重表放模块级，跨 StrictMode 卸载/重挂载仍有效——effect 内闭包会在重挂载时重置，挡不住缓冲重放）：
     ```ts
     const lastInitNonce = { v: -1 };  // 模块级（组件外）

     useEffect(() => {
       const off = (window as any).mulby?.onPluginInit?.(async (data: any) => {
         if (data?.nonce != null && data.nonce === lastInitNonce.v) return;  // 缓冲重放/StrictMode 去重
         lastInitNonce.v = data?.nonce ?? -1;
         let text = data?.input || '';
         const filePath = data?.attachments?.[0]?.path;
         if (!text && filePath) {
           try { text = await (window as any).mulby.filesystem.readFile(filePath, 'utf-8'); }
           catch { setGlobalError('无法读取拖入的文件，请确认文件为 UTF-8 文本。'); return; }
         }
         if (text) applyIncomingSource(text);
       });
       return () => { off?.(); };
     }, []);
     ```
  3. applyIncomingSource：在 CONFIG 步骤直接预填 `config.sourceText` 并停留配置页；若窗口已在生成/成品阶段（manifest 已配 pluginSetting.single: true，宿主会复用已开窗口并再次发送 plugin:init——main/plugin/window.ts:316/:522 两条复用路径均如此），先弹确认「载入新素材将丢弃当前漫画？」，确认后按 D2 统一调用 handleCancelAll() 再回 CONFIG 预填，取消则忽略 payload（与 Start Over 确认条目的交互保持一致）。
- **验收标准**：
  - [ ] 划词/超级面板选中 ≥50 字文本出现「改编成技术漫画」入口，进入后 sourceText 已预填
  - [ ] 选中 .md/.txt 文件可触发入口并读入内容；非 UTF-8 文件有可读错误提示
  - [ ] 插件生成中再次从入口进入：有确认弹窗，确认后旧任务被中止（D2）、无资产串台
  - [ ] keyword 空手打开行为不变
  - [ ] React 双挂载/晚注册不丢事件、不重复预填（模块级 nonce 去重）
- **工作量**：S，约半天。
- **风险与回滚**：manifest cmds 纯增量；风险集中在 single 窗口复用的二次 payload 交互，确认弹窗兜底；回滚删 cmds 与 effect 即可。
- **horror-manga 适用性**：适用——同样的"素材文本 → 漫画"入口模式，仅 label 与 minLength 需按其定位调整。

## 6. 宿主改造：mulby 仓库两个分支（优先级 P2）

> **状态：✅ 已实现（2026-07-18）**，两分支均在 mulby 仓库 worktree 提交、`verify:app` 全绿（typecheck/lint/API docs 严格校验/单测/bundle），main 未动、未 push：
> - **`feat/ai-image-abort-and-size` @ 7e57eb7**（worktree `mulby/.worktrees/ai-image-abort`）：6.1 图像流补发 `{__requestId}` 合成 chunk；6.2 `images.edit` 支持 `requestId` 入参 + AbortController 全链路（重试边界感知中止），后端类型同步并顺带修复 edit 漏 `referenceAttachmentIds` 的既有缺口；6.3 `sizeToAspectRatio` 映射替换 pipeline 写死的 `aspectRatio: undefined`，generate/stream/edit 全链路可选透传；docs/apis/ai.md 同步。新增 11 个单测。
> - **`fix/host-worker-nested-api` @ 784af47**（worktree `mulby/.worktrees/host-worker-nested`）：递归代理提取为 `host-api-proxy.ts` 共用模块（thenable/symbol 守卫），host-manager 逐段嵌套解析，两级路径行为与错误消息完全向后兼容；类型与文档如实标注隔离进程下回调/AiPromiseLike.abort 的既有限制。新增 13 个单测。
> - **实现偏差**（均已核）：6.3 的 aspectRatio 额外穿透了 orchestration→decodeFallback（纯可选，未传即原行为）；6.5 代理逻辑抽独立模块以便单测（仓库既有惯例）；另发现 renderer 侧 `host.invoke` 路由仍为两段解析——不在本方案范围，留档待议。
> - **插件侧接入要点**：三项能力同分支发布，无需显式探测——图像流 onChunk 收到 `__requestId` 即登记进中止集合（老宿主永不发送，自动退化）；edit 由插件自生成 requestId 随 input 传入（老宿主安全忽略多余字段）；需要 UI 判别时以"首次 generateStream 是否收到 `__requestId`"作运行时探针。
> - **环境注记**：分支 A worktree 安装依赖时 electron-rebuild 在本机对 usocket 编译失败（node-gyp 环境问题，用 `--ignore-scripts` 绕过完成校验），过程中主仓 `mulby/node_modules` 内 usocket 构建产物 mtime 被更新（git 状态干净）；若宿主运行时 usocket 异常，主仓重跑 `pnpm install` 即可恢复。

本章解决"插件侧无论怎么改都够不到"的三个宿主级缺口：图像流拿不到 requestId（中止句柄被 contextBridge 剥离）、`images.edit` 全链路无中止且丢弃尺寸控制、插件后端（utilityProcess）访问不到 `ai.images.*` 等三级命名空间。按全局设计决定 D6 开两个独立分支：**`feat/ai-image-abort-and-size`**（图像中止 + 尺寸透传，6.1–6.4）与 **`fix/host-worker-nested-api`**（host-worker 递归代理，6.5）。所有改动均为"新增可选能力"，老插件零感知；插件侧对新能力一律做特性探测降级（各条目内给出），保证 tech-manga 在未升级的老宿主上仍按现状运行。宿主每分支合并前须过 `pnpm run verify:app`（含 Typecheck + Lint + API Docs 校验与同步 + 单测 + Bundle Smoke）。

**分支一 `feat/ai-image-abort-and-size` 总览**

涉及宿主文件（行号已逐一核对现状）：

| 文件 | 现状锚点 | 改动 |
|---|---|---|
| `mulby/src/preload/apis/ai.ts` | 171-213 `generateImageStream`；96 文本流补发 `__requestId` 的对齐模板；265 `edit` 为纯透传 invoke | 图像流补发合成 chunk（6.1）；edit 无需改（新字段随 input 透传） |
| `mulby/src/main/ipc/ai.ts` | 460-470 `'ai:images:edit'` 裸 await 且 input 整体透传；428-458 stream 版有 requestId；225-228 `'ai:abort'` 无窗口门禁 | 无代码改动：`requestId` 随 input 透传进 service（6.2），锚点仅为核对 |
| `mulby/src/main/ai/service.ts` | 554-571 `editImage` 无 controller；521-552 stream 版 controllers 注册模板；114 controllers Map；436-450 `abort()`；515/545/567 三处 `executeImageWithRetry` 三参包装 | editImage 注册 AbortController；包装函数补第 4 参透传（6.2） |
| `mulby/src/main/ai/service/image-orchestration.ts` | 204-272 `executeEditImageOrchestration` 无 abortSignal/size；129 stream 版有 abortSignal | edit 编排穿透 abortSignal + size（6.2/6.3） |
| `mulby/src/main/ai/service/image-pipeline.ts` | 45-90 `executeImageWithRetry` 无中止检查；254-260 `generateImageWithDecodeFallback` 已接受 size/abortSignal；661 `aspectRatio: undefined` 写死 | 重试边界感知中止（6.2）；size→aspectRatio 映射（6.3） |
| `mulby/src/shared/types/ai.ts` | 511-519 `AiImageGenerateProgressChunk`；597-603 edit 入参 | 类型补 `__requestId?` / `requestId?` / `size?` / `aspectRatio?`（6.1-6.3） |
| `mulby/src/shared/types/plugin.ts` | 754-761 后端 images 类型（760 edit 同样漏 `referenceAttachmentIds`） | 与 ai.ts 同步（6.2/6.3） |
| `mulby/src/main/plugin/api.ts` | 670-683 后端 images 实现；682 edit 类型漏 `referenceAttachmentIds`（docs/apis/ai.md:961 已注明该缺口，顺带修） | 类型同步 + 透传（6.2/6.3） |
| `mulby/docs/apis/ai.md` | 130、207-208 已明文"Promise 附属 abort 跨 contextBridge 必丢" | 补图像流 `__requestId`（907 行起图像流章节）与 edit 中止/尺寸文档 |

向后兼容性总论：三项改动全部是"可选入参 + 合成 chunk"。老插件不传 `requestId`/`size`/`aspectRatio` 时宿主行为逐字节等同现状；合成 `__requestId` chunk 与文本流既有约定（preload/apis/ai.ts:96）完全同构，凡按文档处理过文本流合成 chunk 的插件天然兼容，未处理的插件收到一个无 `type` 字段的 chunk——与文本流场景的暴露面一致，非新增风险。插件侧特性探测：均为"传了老宿主也安全忽略"的被动降级，无需显式探测（详见各条目）。

**分支二 `fix/host-worker-nested-api` 总览**

涉及宿主文件：`mulby/src/main/plugin/host-worker.ts`（201-314 `createProxyAPI`、122-143 `callMainApi`、145-155 `cloneForMessage`）、`mulby/src/main/plugin/host-manager.ts`（562-715 `handleApiCall`，568 两段解构）。向后兼容性：worker 与 manager 同属宿主一次构建、原子升级，不存在新旧混跑；对插件而言所有既有两级调用产生的 `api` 字符串与解析结果不变（论证见 6.5）。

### 6.1 图像流补发 `__requestId`：插件 UI 获得图像流真中止句柄

- **现状与根因**：文本流 `call()` 在拿到 requestId 后会向流回调补发合成 chunk `{ __requestId }`（mulby/src/preload/apis/ai.ts:96），插件据此调用 `ai.abort(requestId)`——这是官方文档认定的渲染进程唯一可靠中止方式（docs/apis/ai.md:130、207-208 明文：挂在 Promise 上的 `abort` 跨 contextBridge 序列化必丢）。但图像流 `generateImageStream`（preload/apis/ai.ts:171-213）没有对等实现：requestId 只用于闭包内的 `abortFn`（175-177 行），随 `toAbortablePromise` 挂到 Promise 上（212 行），到插件页面即被剥离。而主进程侧 `'ai:images:generate:stream'`（main/ipc/ai.ts:428-458）→ `generateImagesStream`（main/ai/service.ts:521-552）早已按 requestId 注册 AbortController，abortSignal 一路穿到 provider fetch（image-pipeline.ts:460、517）——取消能力齐备，只差 preload 这一跳。这也是插件 mulbyAiService.ts:27-33 注释自认"图像请求无法真中止"的直接根因。
- **改动方案**：
  1. preload 补发合成 chunk（对齐 ai.ts:96 的既有约定）：
     ```ts
     // mulby/src/preload/apis/ai.ts — generateImageStream，173-177 行 .then(({ requestId }) => { 内、abortFn 赋值后
     abortFn = () => { void ipcRenderer.invoke('ai:abort', requestId) }
     // 新增：与文本流 call()（本文件 96 行）对齐，把 requestId 以合成 chunk 交给插件侧
     try {
       onChunk({ __requestId: requestId } as unknown as AiImageGenerateProgressChunk)
     } catch { /* 插件回调异常不影响流程 */ }
     ```
     合成 chunk 在监听器注册前同步发出，IPC 业务 chunk 最早也要下一个宏任务才到达，"首个回调即 `__requestId`"的时序有保证。
  2. 类型同步（shared/types/ai.ts:511-519）：
     ```ts
     export interface AiImageGenerateProgressChunk {
       type?: 'status' | 'preview'   // 放宽为可选：合成 chunk 不携带 type
       // …既有字段不变…
       /** 流建立后首个回调携带；用于 ai.abort(requestId)。该合成 chunk 不含 type 字段 */
       __requestId?: string
     }
     ```
     `type` 放宽会让消费方多一次判空——业务 chunk 始终有 `type`（image-pipeline/image-helpers 的所有发射点均带 type，已核实），宿主渲染端与 internal-plugins 目前均无 `AiImageGenerateProgressChunk` 消费方（已核实），主进程 428-443 行仅做日志读取、对可选 type 无影响；随 D6 第三步同步 docs/apis/ai.md（907 行起）与插件侧手工维护的 `src/types/mulby.d.ts`——注意宿主目前**没有** d.ts 自动生成（审查 finding 32 的 workspace 单点分发落地前，插件侧 d.ts 需手动同步）。
  3. 插件侧（配合第 2/3 章的 `generateStream` 迁移）：`onChunk` 首行防御性捕获——
     ```ts
     onChunk: (chunk) => {
       const rid = (chunk as { __requestId?: string }).__requestId;
       if (rid) { activeTextRequestIds.add(rid); return; }  // 合成 chunk，无 type 字段
       if (chunk.type === 'preview') { /* 渐进预览 */ }
     }
     ```
     特性探测降级：老宿主永远不会发出该合成 chunk，插件拿不到 requestId 时自动退化为现状（epoch 作废结果），无需版本判断。
- **验收标准**：
  - [ ] 新宿主上任一插件 `images.generateStream` 的首个回调收到 `{ __requestId }`，且随后 `ai.abort(requestId)` 触发主进程 `[AI] IPC ai:abort received`（main/ipc/ai.ts:226）→ `[AI] abort:request`（service.ts:439）日志、在飞 fetch 实际中断（image-pipeline.ts:460/517 的 signal 生效）。
  - [ ] `AiImageGenerateProgressChunk` 类型、docs/apis/ai.md、插件侧 mulby.d.ts 三处同步更新。
  - [ ] 老插件（不识别合成 chunk）在新宿主上功能无回归：宿主渲染端无图像流消费方（已核实无内建图像生成面板），用未迁移版 tech-manga / horror-manga（走非流式 generate/edit，完全不受影响）+ 一个不判 `type` 的最小 generateStream demo 插件手测确认仅多收到一个无 `type` 的 chunk。
  - [ ] `pnpm run verify:app` 全绿。
- **工作量**：S（0.5 天，含类型/文档同步）。
- **风险与回滚**：风险极低——纯新增一次回调；唯一暴露面是"不判 `type` 的既有消费方"，与文本流合成 chunk 的既有暴露面同构。回滚即删除补发行与类型字段，无数据迁移。
- **horror-manga 适用性**：适用——同为 file:// 渲染进程插件，迁移到 `generateStream` 后即可用同一句柄真中止图像流。

### 6.2 `images.edit` 增加 requestId + AbortController 中止链路

- **现状与根因**：tech-manga 每一张带参考图的漫画页（几乎全部页面）走 `images.edit`（插件 mulbyAiService.ts:729-734），而宿主 edit 链路任何一层都没有中止路径：IPC `'ai:images:edit'` 是裸 await（main/ipc/ai.ts:460-470）；`aiService.editImage`（service.ts:554-571）不注册 controllers（对比 stream 版 521-552 的注册模板）；`executeEditImageOrchestration`（image-orchestration.ts:204-272）连 `abortSignal` 参数都没有（仅 stream 版有，129 行）；重试助手 `executeImageWithRetry`（image-pipeline.ts:45-90）在两次尝试与 800ms×n 退避间隙里也无任何中止检查。讽刺的是叶子函数 `generateImageWithDecodeFallback`（image-pipeline.ts:254-260）本就接受 `abortSignal` 并穿到 `doGenerate`（665 行）与 SDK 调用（`callGenerateImageSdk`，670-685 行）——只差中间三层透传。由于 `invoke` 的返回值就是最终结果，无法像 stream 那样先返回 requestId，因此采用"调用方自带 requestId"模式。
- **改动方案**：
  1. IPC 层（main/ipc/ai.ts:460-470）**无需改代码**：handler 将 input 整体透传给 `aiService.editImage(input)`，无白名单过滤，`requestId` 字段随之进入 service。此处仅作核对确认（安全面：`'ai:abort'` 本就对所有渲染端开放且无窗口门禁，225-228 行，requestId 入参不引入新攻击面）。
  2. service（service.ts:554，仿 521-552）：
     ```ts
     async editImage(input: {
       imageAttachmentId: string; prompt: string; model: string
       referenceAttachmentIds?: string[]; size?: string; aspectRatio?: string
       requestId?: string
     }): Promise<{ images: string[]; tokens: AiTokenBreakdown }> {
       const id = input.requestId || this.createRequestId()
       const controller = new AbortController()
       this.controllers.set(id, controller)
       try {
         const resolved = resolveImageProvider({ stage: 'editImage', … })
         return await executeEditImageOrchestration({
           ...input,
           abortSignal: controller.signal,
           …  // 既有 deps：readAttachment / executeImageWithRetry / generateImageWithDecodeFallback 等
         })
       } finally {
         this.controllers.delete(id)
       }
     }
     ```
     controllers Map（service.ts:114）与 `abort()`（436-450）零改动直接复用。
  3. 编排层（image-orchestration.ts:204-272）：入参加 `abortSignal?: AbortSignal`，`generateImageWithDecodeFallback` 的 dep 类型签名（218-221 行）补 `size?/abortSignal?`，调用处（250-259 行）透传两者，并把 abortSignal 作为第 4 参传给 `executeImageWithRetry`。注意 `executeImageWithRetry` 是注入的 dep：编排层的 dep 类型（213-217 行，stream/generate 版同构的 65-69/132-136 行一并）加可选第 4 参，service 侧三处三参包装 lambda（service.ts:515/545/567）同步改为透传第 4 参到 pipeline 助手。
  4. 重试边界（image-pipeline.ts:45）：
     ```ts
     export async function executeImageWithRetry<T>(
       stage: 'generateImages' | 'editImage',
       execute: () => Promise<T>,
       context: Record<string, unknown>,
       abortSignal?: AbortSignal        // 新增，可选
     ): Promise<T> {
       …
       while (attempt < maxAttempts) {
         if (abortSignal?.aborted) throw new DOMException('Aborted', 'AbortError')
         attempt += 1
         try { return await execute() }
         catch (error) {
           if (abortSignal?.aborted) throw error   // 中止引发的失败不再重试
           …
           await sleep(delayMs)
         }
       }
     ```
     流式 generate 调用链（executeGenerateImagesStreamOrchestration 已持有 `abortSignal`，129 行）顺手传入其 signal，补上流式路径重试间隙的中止盲区；非流式 `generateImages`（service.ts:502-519）本就不注册 controller、无 signal 可传，维持现状不动。
  5. 类型同步：shared/types/ai.ts:597-603（加 `size?/aspectRatio?/requestId?`）、shared/types/plugin.ts:754-761（其中 760 行 edit 类型与 main/plugin/api.ts:682 一样漏了 `referenceAttachmentIds`，与实际透传行为不符——docs/apis/ai.md:961 已注明该缺口，本次一并修正并删除该文档补丁说明）。preload edit（preload/apis/ai.ts:265）是纯透传 invoke，无需改代码。
  6. 插件侧用法与降级：mulbyAiService.ts 的 edit 调用生成 `requestId`（`Date.now()-random` 即可，与 service.ts:714 `createRequestId` 无碰撞要求）随 input 传入并登记进 `activeTextRequestIds`（沿用 D1 纪元机制，`abortAllAiTasks` 统一 `ai.abort`），finally 时移除。老宿主降级论证：多余的 `requestId` 字段经 `{...input}` 展开进入编排层后无人消费、完全无害；对老宿主调 `ai.abort(requestId)` 仅命中 `abort:no-controller` 警告日志（service.ts:443），无副作用——即插件无需任何显式探测，同一份代码新老宿主皆可跑。
- **验收标准**：
  - [ ] 新宿主上 edit 在飞时 `ai.abort(requestId)`：`[AI] abort:request` 日志出现，`doGenerate`/SDK fetch 实际中断，Promise 以 abort 类错误拒绝。
  - [ ] 中止发生在重试退避期（构造首次可重试失败，如临时 5xx）时，第二次尝试不再发出：`image:retry` 日志出现后无第二次尝试的 `image:direct:failed` / `image:generate:result` 日志（注意 `editImage:start` 每次调用只打一次、对重试不敏感，不能作为观测点）。
  - [ ] 不传 `requestId` 的老调用行为与改造前完全一致（单测覆盖）。
  - [ ] 三处类型（shared/types/ai.ts / shared/types/plugin.ts / main/plugin/api.ts）+ 插件侧 mulby.d.ts + docs/apis/ai.md 同步；`pnpm run verify:app` 全绿。
- **工作量**：M（1 天：四层透传 0.5 天 + 单测与手测 0.5 天）。
- **风险与回滚**：中风险点在 `executeImageWithRetry` 签名变更波及 generate/stream 调用方——参数可选，未传即原行为；abort 错误分类已核实无忧：`classifyAiImageError`（shared/ai/imageDiagnostics.ts:123-130）把 abort 类消息归为 `AI_IMAGE_ABORTED` 且 `retryable: false`，第 4 步的 `abortSignal?.aborted` 前置检查是双保险而非唯一防线。回滚：revert 分支即可，无持久化状态。
- **horror-manga 适用性**：适用——horror-manga 同样以带参考图 edit 为成本大头，接入方式与 tech-manga 完全相同。

### 6.3 edit / generate 链路的 size 与 aspectRatio 透传

- **现状与根因**：三层失控（审查 findings 11/27 已核实）：(1) `images.edit` 入参根本没有 `size`（shared/types/ai.ts:597-603），插件算好的 `1024x1536` 在 edit 分支静默丢弃（插件 mulbyAiService.ts:729-734），比例只剩 prompt 文字暗示，而该暗示还自相矛盾——`aspectRatioToSize`（插件 mulbyAiService.ts:94-105）把画布设为 1024x1536（精确 2:3）却告诉模型 "portrait 3:4"；(2) 编排层调 `generateImageWithDecodeFallback` 只传 `{ modelKey, prompt }`（image-orchestration.ts:253-258），即使入参有 size 也无人消费；(3) direct 调用路径写死 `aspectRatio: undefined`（image-pipeline.ts:661），而宿主经 `@ai-sdk/google` 构建 Gemini 图像模型（main/ai/providerCatalog.ts:41-45 `createGoogleGenerativeAI`），该 provider 的 `doGenerate` 只认 `aspectRatio` 不认 `size`——连 generate 分支的尺寸控制对 Gemini 也是空转。另外 edit 语义把第一张角色立绘当主图（image-orchestration.ts:238-257 `[image, ...refImages]`），输出分辨率强烈跟随首图，封面（参考图仅一张主角立绘，插件 App.tsx:360-362 `coverRefs`）易退化为立绘微调——size/aspectRatio 透传后由明确的输出规格约束对冲。
- **改动方案**：
  1. 类型与签名：edit 入参加 `size?: string; aspectRatio?: string`（generate 入参已有 `size`，同步补 `aspectRatio?`），三处类型文件与 6.2 第 5 步合并提交。
  2. 编排层：`executeEditImageOrchestration` 把 `size` 透传给 `generateImageWithDecodeFallback`（该函数 image-pipeline.ts:254-260 已接受 size，direct 路径在 660 行、SDK 路径在 280-286 行的 `callGenerateImageSdk` 调用处消费）。
  3. pipeline 增加按 provider 的映射（Gemini 认 aspectRatio，OpenAI 系认 size）：
     ```ts
     // mulby/src/main/ai/service/image-pipeline.ts — 新增
     function sizeToAspectRatio(size?: string): `${number}:${number}` | undefined {
       const m = /^(\d+)x(\d+)$/.exec(size || '')
       if (!m) return undefined
       const w = Number(m[1]), h = Number(m[2])
       if (!w || !h) return undefined
       const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
       const g = gcd(w, h)
       return `${w / g}:${h / g}` as `${number}:${number}`   // '1024x1536' → '2:3'
     }

     // generateImageByDirectModelCall（640-668 行）：
     const response = await model.doGenerate({
       …,
       size: input.size,
       aspectRatio: input.aspectRatio ?? sizeToAspectRatio(input.size),  // 原 661 行写死 undefined
       …
     })
     ```
     入参链路（`generateImageWithDecodeFallback` / `generateImageByDirectModelCall` / `callGenerateImageSdk`）统一补可选 `aspectRatio`；SDK 路径（670-685 行）为避免 AI SDK 对 size/aspectRatio 双传告警，采用"有 size 传 size，否则传 aspectRatio"的择一策略。OpenAI-compat 的 JSON/SSE 策略（`generateImageViaCompatJson` 等）已带 size，不动。
  4. 插件侧：edit 调用补传 `size`（与 generate 分支同源），并把 hint 修正为与画布一致（`'1024x1536'` → `'portrait 2:3 (manga page)'`，属插件章节改动，此处仅列依赖）。降级论证：老宿主对 edit 入参里多出的 `size/aspectRatio` 字段同样是展开后无人消费、安全忽略，行为退化为现状（靠 prompt hint），无需显式探测。
- **验收标准**：
  - [ ] `sizeToAspectRatio` 单测：`1024x1536→2:3`、`1536x1024→3:2`、`1024x1024→1:1`、非法输入→undefined。
  - [ ] Gemini 模型下 generate 与 edit 的输出比例跟随入参（手测 2:3 / 1:1 / 16:9 三档，zip 导出原图核对）。
  - [ ] OpenAI 兼容模型下 size 行为无回归（既有 JSON/SSE 策略仍带 size）。
  - [ ] 不传新字段的老调用输出与改造前一致；`pnpm run verify:app` 全绿。
- **验收补充说明**：edit 模式下部分模型仍会部分跟随首图分辨率，aspectRatio 是强约束而非绝对保证——验收以"显著偏差率下降"为准，不承诺 100%。
- **工作量**：M（1 天：宿主透传+映射 0.5 天，双 provider 手测 0.5 天）。
- **风险与回滚**：择一策略若与某 OpenAI 兼容网关不合（个别网关要求必传 size），direct 路径原本就是最后回退、影响面小；出问题可将 661 行恢复 `undefined` 单点回滚，不影响 6.2 的中止链路。
- **horror-manga 适用性**：适用——horror-manga 同样存在 edit 尺寸失控与 2:3/3:4 hint 矛盾，宿主改动共享，插件侧仅需同款 hint 修正。

### 6.4 「真中止省钱」的收益界定与验证口径

- **现状与根因**：插件现状的中止只作废结果（插件 mulbyAiService.ts:27-33 注释自认），Long 档最多 16 张图在飞时点中止，在途请求照常跑完照常计费。但需要如实界定 6.1/6.2 落地后的收益边界，避免 PR 与用户沟通中把"真中止"夸大为"全额挽回 $3-4"：对同步图像 API 与 async-job 型 provider，请求一旦派发，客户端断开连接**未必**免除该单次请求的服务端计费。
- **改动方案**（本条不新增代码，产出为两个 PR 的收益说明与验收口径）：
  1. **确定性省掉的部分**（写入 PR 描述）：① 重试第二次提交——`executeImageWithRetry` maxAttempts=2（image-pipeline.ts:50），失败自动重发一次即双倍计费风险，6.2 的重试边界检查直接掐断；② 策略回退的再次提交——`generateImageWithProgress` 的策略循环（image-pipeline.ts:125-246）会依次尝试 stream-sse/sync-json/async-job/sdk-direct，每次都是完整计费请求，abortSignal 在 127 行的循环头检查掐断（该循环仅 generate/generateStream 路径使用；edit 直达 `generateImageWithDecodeFallback`，不经策略循环，靠 ① 与叶子层 signal 覆盖）；③ async-job 轮询——`pollAsyncImageTask`（image-pipeline.ts:384-442）最长 180s 的轮询在下一轮检查（398-400 行，间隔 1.8s）即终止，不再发出新的查询请求；④ SSE 流式路径断开连接（496-504 行的 abort 中继），部分 provider（OpenAI partial_images 流）会停止后续生成；⑤ 配合 D4 的 asyncPool：中止后队列不再取新任务，未派发的页面一分钱不花——这是批量场景里最大的一笔确定性节省。
  2. **不确定的部分**（同样写入 PR）：已派发的单次同步请求的服务端计费不受客户端 abort 控制，"每次中止挽回 ~$3-4"是理论上限而非保证。
  3. **验证口径**：中止后宿主日志序列应为 `[AI] abort:request` → 无后续 `image:retry` / `image:strategy:try` 日志，且异步任务不再发出新的轮询请求（轮询本身不打宿主日志，经 provider 侧请求记录 / 插件 DevTools 网络面板确认）；配合一次真实批量任务在 provider 控制台的账单前后对比（把"省钱"验收定义为"中止时刻之后零新增计费请求"，而非"在途请求退款"）。
- **验收标准**：
  - [ ] 两个 PR 描述含上述收益边界说明（确定性 ①-⑤ 与不确定性声明）。
  - [ ] 手测：16 页批量中途中止，日志确认中止时刻后零新增 provider 请求。
  - [ ] 插件 mulbyAiService.ts:27-33 的注释在插件侧章节落地时同步改写为新语义（"在新宿主上真中止，老宿主上作废结果"）。
- **工作量**：S（0.5 天，随 6.1/6.2 联调完成）。
- **风险与回滚**：无代码风险；唯一风险是表述失准引发预期落差，本条即为其对冲。
- **horror-manga 适用性**：适用——收益边界论证对任何批量图像插件成立，可直接复用同一验收口径。

### 6.5 host-worker 递归代理：任意深度命名空间在隔离进程可达

- **现状与根因**：shared/types/plugin.ts:754-761 向插件后端承诺了 `ai.images.generate/generateStream/edit`（docs/apis/ai.md:893 起亦标注 [Renderer] [Backend]），但生产路径（utilityProcess 隔离）实际拿到的是 host-worker.ts:201-314 `createProxyAPI` 的代理：除 `tools/features/messaging` 三个特判外（207-297 行），其余命名空间走通用两级转发（299-309 行）——访问 `mulby.ai.images` 返回的是普通函数 `(...args) => callMainApi('ai.images', args)`，再取 `.generate` 得 `undefined`，调用即 TypeError。主进程侧 host-manager.ts:568 的 `api.split('.')` 两段解构与 679-690 行的两级解析同样不支持嵌套。只有开发模式关隔离时 runner.ts（runner.ts:88）进程内直用 `createPluginAPI`（main/plugin/api.ts:105 起，`ai.images` 三级实现见 670-683）才符合类型承诺——类型契约对生产路径撒谎。这也是审查认定"路线(b)：把图像调用挪到插件后端"当前不可行的直接证据；修复后所有插件后端受益。
- **改动方案**：
  1. worker 侧递归代理（host-worker.ts，替换 299-309 行的通用分支；`tools/features/messaging` 特判保持原样）：
     ```ts
     // mulby/src/main/plugin/host-worker.ts — 新增
     function createNamespaceProxy(path: string): unknown {
       // 双态：既可作为函数调用（叶子方法 → 转发主进程），也可继续展开子命名空间
       const invoke = (...args: unknown[]) => callMainApi(path, args)
       return new Proxy(invoke, {
         get(_target, prop) {
           if (typeof prop !== 'string') return undefined
           // 防 thenable 误判：代理被 await / Promise.resolve 探测时不得伪装成 Promise
           if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined
           return createNamespaceProxy(`${path}.${prop}`)
         },
         apply(_target, _thisArg, args: unknown[]) {
           return callMainApi(path, args)
         }
       })
     }

     // createProxyAPI 的 get 末尾（原 299-309 行）：
     return createNamespaceProxy(prop)
     ```
  2. 主进程侧按路径段解析（host-manager.ts:562-715 `handleApiCall`；568 行两段解构改为逐段 reduce，574-651 行的哨兵值特判保持原样）：
     ```ts
     const segments = api.split('.')
     const namespace = segments[0]                    // 网络日志上报（694/706 行）沿用 namespace
     const method = segments.slice(1).join('.')       // 同上：上报第三参仍需 method（http 恒为单段方法名，行为不变）
     …
     let target: unknown = pluginApi
     for (let i = 0; i < segments.length - 1; i += 1) {
       target = target && typeof target === 'object'
         ? (target as Record<string, unknown>)[segments[i]]
         : undefined
       if (!target || typeof target !== 'object') {
         throw new Error(`Unknown API namespace: ${segments.slice(0, i + 1).join('.')}`)
       }
     }
     const apiMethod = (target as Record<string, unknown>)[segments[segments.length - 1]]
     if (typeof apiMethod !== 'function') {
       throw new Error(`Unknown API method: ${api}`)
     }
     const result = await apiMethod(...args)   // 与现状一致：不绑定 this（createPluginAPI 全为闭包）
     ```
  3. **既有限制如实标注**（本分支不解决，写入 PR 与 docs）：`cloneForMessage`（host-worker.ts:145-155）对参数做 `structuredClone` → JSON 兜底，**回调函数会被剥为 null**——因此修复后可达的是"数据进、数据出"的 Promise 型 API（`ai.images.generate/edit`、`ai.attachments.*`、`ai.tokens.estimate` 等）；`ai.images.generateStream` 的 `onChunk` 与返回值上的 `AiPromiseLike.abort` 依然穿不过 postMessage 边界（返回值是回投的普通数据）。流式回调需要后续仿 `messaging.on` 的 handlerId + `deliverPluginMessage` 回投通道（host-manager.ts:605-631 有现成模板），本分支不做；但中止语义已可闭环——`ai.abort` 是两级路径本就可达（plugin.ts:740），配合分支一的 edit `requestId` 入参，后端也能显式中止。另注意 `callMainApi` 的 5 分钟超时（host-worker.ts:136-141）覆盖绝大多数图像任务时长，暂不调整。同步把 shared/types/plugin.ts:754-761 的 `generateStream` 返回类型在文档中标注后端限制，消除类型契约撒谎。
  4. 插件后端特性探测降级：
     ```ts
     // 老宿主：mulby.ai.images 是普通函数，.edit 为 undefined → false；新宿主：递归代理，typeof 恒为 'function' → true
     const hasNestedBackendApi = typeof mulby.ai?.images?.edit === 'function'
     ```
     tech-manga 当前所有 AI 调用都在 UI 层（main.ts 是空壳），本条对其是"解锁未来路线(b)与 manifest.tools 后端工具"的前置修复，而非当前功能依赖——探测为 false 时保持 UI 层调用即可。
- **向后兼容性论证**：worker/manager 同一构建原子升级，无新旧混跑。对老插件：两级调用 `mulby.clipboard.readText()` 产生的 `api='clipboard.readText'` 在新解析下逐段结果与旧两段解构完全一致；三个特判命名空间未动；此前访问 `mulby.ai.images` 得函数、误调用会发 `'ai.images'` 报 "Unknown API method"，新逻辑下同样落入 "Unknown API method: ai.images"（method 位是对象），错误类别不变。行为差异仅有一处：新递归代理下，插件把顶层命名空间当函数误调（如 `mulby.storage()`）会发出单段 `api='storage'`——旧代理在 worker 本地直接抛 TypeError，新逻辑发往主进程后因 `createPluginAPI` 顶层成员全为对象命名空间、无顶层函数（已核实 PluginAPI 接口全部 16 个顶层成员均为对象）而落入 "Unknown API method: storage" 拒绝：同为报错、无静默成功可能，仅错误形态从同步 TypeError 变为 Promise 拒绝，且仅误用代码可触达。递归代理新增的 `then/catch/finally` 守卫防止 `await mulby.storage` 之类表达式把代理误判为 thenable。
- **宿主侧测试建议**：单测①：mock `callMainApi` 断言 `mulby.ai.images.generate(x)` 产生 `('ai.images.generate', [x])`、`mulby.ai.abort(id)` 仍为 `('ai.abort', [id])`；单测②：`handleApiCall` 对 fake 嵌套 pluginApi 解析二级/三级/单段/未知路径的成功与报错信息；集成：一个 demo 后端插件在隔离模式下依次调 `ai.tokens.estimate`、`ai.attachments.upload`（buffer 形态，filePath 会被 `rejectPluginAiAttachmentFilePath` 拒绝）+`get`、`ai.images.generate`，并回归 `messaging.on`/`features.onMainPush` 哨兵流程不受影响；最后 `pnpm run verify:app`。
- **验收标准**：
  - [ ] 隔离模式下后端 `ai.images.generate/edit`、`ai.attachments.*`、`ai.tokens.estimate` 全部可调并返回真实数据。
  - [ ] 既有两级 API 与 tools/features/messaging 特判零回归（集成用例通过）。
  - [ ] PR 与 docs 明确标注流式回调 / `AiPromiseLike.abort` 的既有限制及 requestId 替代方案。
  - [ ] `pnpm run verify:app` 全绿。
- **工作量**：M（1-1.5 天：递归代理与解析各 0.25 天，单测/集成与文档 0.5-1 天）。
- **风险与回滚**：主要风险是 Proxy 双态对象在插件侧被非常规使用（序列化、深比较、`.apply`/`.bind` 反射调用）时行为怪异——守卫已覆盖 thenable 与 symbol 访问，其余与旧"函数型代理"暴露面相当。独立分支、无状态迁移，revert 即回滚。
- **horror-manga 适用性**：适用——修复属宿主级公共缺陷，horror-manga 未来任何后端能力（如导出工具、manifest.tools）都直接受益，无插件侧改动成本。

## 7. 架构与工程化（优先级 P3）

> **状态：✅ 已实现（2026-07-18，tech-manga 范围）**。7.1/7.3 `packages/manga-kit`（abort-scope/async-pool/name-match/image-mime/progress-text/ai-bridge/attachment-cache + vite/tailwind/postcss preset 工厂，零文案零模型名）；7.2 `packages/mulby-types`（基线 2425 行含 AiPromiseLike→Promise 降级修正）+ `scripts/sync-mulby-types.mjs`（宿主快照哈希漂移检查，--check 输出全仓 47 份未迁移拷贝清单）+ detect-changed-plugins 依赖精准标记；7.4 App.tsx 1296→801 行（useComicWorkflow/useImageQueue/useUsageTracker/useSessionPersistence + promptBuilder，逐块 tsc、prompt 字节级校验）。验证：UI 构建产物迁移前后逐文件 md5 一致；build/tsc/pack/workspace install 全绿。主要偏差（以代码为准）：① 未 reducer 化（与"机械搬移"约束冲突，留 TODO）；② App 801 行 > 350 目标（3/5 章新增 JSX 属 UI 组件化范畴，超出结构收纳范围）；③ 新增 useSessionPersistence 第五轴；④ 文本/图像调用骨架未收编 kit（留待 horror-manga 换装步骤）；⑤ sync 脚本为快照哈希方案而非 compiler rollup（方案自评可延后）。遗留项见 1.5。

本章处理的不是单点 bug，而是"改一处要抄两遍、拷一份就漂一版"的工程结构性债务：tech-manga 与 horror-manga 两个姊妹插件的构建配置逐字节相同、AI 桥接层大量同构、`mulby.d.ts` 是同一份 2413 行拷贝，而全仓这份类型文件已漂移出 27 个不同版本；同时 tech-manga 的 App.tsx 把状态机、编排、计价、prompt 拼装全部塞在 743 行里。整体思路：以 pnpm workspace 为底座抽出 `packages/manga-kit`（AI 桥接核心 + 中止 scope + 构建配置模板）与 `packages/mulby-types`（宿主类型单点分发），再把 App.tsx 按状态机/队列/计价/prompt 四条轴拆成 hooks 与纯函数。本章所有条目均为纯重构或工具链改造，不改变用户可见行为，且全部落在 mulby-plugins 仓 feat/tech-manga 分支内（horror-manga 只存在于该分支，主分支 plugins/ 下没有它），不占用 D6 的两个宿主分支。

路径约定：`tech-manga/…`、`horror-manga/…` 指 mulby-plugins 仓 feat/tech-manga 分支（工作树 `.worktrees/tech-manga`）`plugins/` 下对应目录；`宿主 …` 指 mulby 仓（/Users/zhuanz/workspace/other/mulby-all/mulby）根目录。

与其他章节的总体先后关系（详见 7.4）：**第 3 章（D5 持久化）与第 4 章（D1/D2/D4 竞态与并发）先在 tech-manga 落地并验证 → 7.4 拆分 App.tsx → 7.1 抽 manga-kit（7.3 随 7.1 顺手完成）→ horror-manga 换装**。7.2（类型分发）无依赖，可与任何阶段并行。

### 7.1 抽出 packages/manga-kit 公共包，收敛两插件的 AI 桥接层与构建配置

- **现状与根因**：两插件由同一份 Google AI Studio 模板迁移而来，公共部分靠复制粘贴共享。实测核对：`tech-manga/vite.config.ts`、`tailwind.config.js`、`postcss.config.mjs` 与 horror-manga 对应文件 diff 为空（逐字节相同）；`src/types/mulby.d.ts` 为相同的 2413 行拷贝；服务层 `tech-manga/services/mulbyAiService.ts` 与 `horror-manga/services/mulbyAiService.ts` 中 `getAi`、`dataUrlToBuffer`、`aspectRatioToSize`、`cleanJson`、`resolveImageModel` 等 helper 逐字节或近逐字节重复，流式调用（`__requestId` 登记）与附件上传骨架结构同构（注：原 finding 称"约 60% 重复"，以代码为准修正为字面重复约 15-20%、外加大段结构同构——prompt 文案占了文件大头，不在收敛范围）。已知分叉点：中止机制（tech 为 epoch 五件套 `tech-manga/services/mulbyAiService.ts:35-57`，horror 为 AbortSignal 桥接 `horror-manga/services/mulbyAiService.ts:366-371`）、模型注入方式（模块态 `setActiveModels`（tech 服务层第 12 行）vs 逐调用传 config（horror 的 `resolveImageModel(config?: AppConfig)`，服务层第 17 行））、用量上报形状（tech 的 `UsageStat` vs horror 的 `OnTokenUpdate` 含 `totalCost`/`callType`，结构性不同，须留在插件侧）。根因：workspace（`pnpm-workspace.yaml` 目前仅 `plugins/*`）没有公共包层，修一个 `dataUrlToBuffer` 的 mime 解析 bug 要改两遍，且第 2-5 章在 tech-manga 落地的修复（D1 epoch 竞态、D3 附件缓存、D4 asyncPool）horror-manga 天然享受不到。

- **改动方案**：

  **包边界（明确划线）**：

  | 进 `packages/manga-kit` | 留在各插件 |
  |---|---|
  | `ai-bridge.ts`：`getAi`、`cleanJson`、`dataUrlToBuffer`、`aspectRatioToSize`、`toDataUrl`、`estimateTokens`、`isAbortLike`、`NO_TOOLS` 常量、注入式 `resolveImageModel(preferred?: string)` | 全部 prompt 文案（`STORY_MODE_PROMPTS`、JSON schema 字符串、各 generateXxx 的指令模板） |
  | `abort-scope.ts`：`createAbortScope()` 工厂（见 7.3） | 计价表与用量上报逻辑（`UsageStat` vs `OnTokenUpdate` 形状不同，kit 只回调统一的 `KitUsage`，插件各自适配） |
  | `attachment-cache.ts`：D3 的参考图附件缓存（模块级 Map，从 tech-manga 落地版**平移**而非重写） | `types.ts` 业务类型（`ComicResponse` 两插件 schema 不同：tech 有 `prop_sheet`，horror 有 `EndingType`/`ColorMode`） |
  | `async-pool.ts`：D4 的 `asyncPool(limit=2)` 与重试 1 次逻辑（同样从 tech-manga 平移） | 全部 UI 组件与 App 编排、hooks（7.4 产物） |
  | 调用骨架：`callTextStream(...)`（含 `__requestId` 登记 + abort scope 接入 + 非流式兜底）、`generateImage`/`editImage`（含附件缓存、D6 新宿主能力的特性探测降级） | `src/main.ts` 后端入口、manifest、图标等插件身份文件 |
  | `configs/`：vite/tailwind/postcss preset 工厂 | — |

  **步骤 1：workspace 配置与空包**。`pnpm-workspace.yaml` 增一行：

  ```yaml
  packages:
    - 'plugins/*'
    - 'packages/*'
  ```

  `packages/manga-kit/package.json`（直接分发 .ts 源码，无独立构建步骤——两插件均以 `vite build` + `esbuild --bundle` 全量打包（见插件 package.json 的 `build:ui`/`build:backend`），workspace 依赖会被转译并内联进产物，`.inplugin` 打包流程零改动）：

  ```json
  {
    "name": "@mulby-plugins/manga-kit",
    "private": true,
    "version": "0.1.0",
    "type": "module",
    "exports": {
      ".": "./src/index.ts",
      "./configs/vite": "./src/configs/vite.ts",
      "./configs/tailwind": "./src/configs/tailwind.js",
      "./configs/postcss": "./src/configs/postcss.mjs"
    },
    "peerDependencies": {
      "vite": "^6.2.0",
      "@vitejs/plugin-react": "^5.0.0"
    }
  }
  ```

  插件侧 `"dependencies": { "@mulby-plugins/manga-kit": "workspace:*" }`。

  **步骤 2：先迁构建配置（最低风险验证 workspace 链路）**。preset 工厂：

  ```ts
  // packages/manga-kit/src/configs/vite.ts
  import path from 'node:path'
  import { defineConfig, type UserConfig } from 'vite'
  import react from '@vitejs/plugin-react'

  /** Mulby 插件以 file:// 加载 ui/index.html：必须相对 base + 输出到根 ui/ */
  export const createMulbyPluginViteConfig = (pluginDir: string, overrides: UserConfig = {}) =>
    defineConfig({
      base: './',
      plugins: [react()],
      build: { outDir: 'ui', emptyOutDir: true },
      resolve: { alias: { '@': path.resolve(pluginDir, '.') } },
      ...overrides
    })
  ```

  插件的 `vite.config.ts` 缩成两行 `export default createMulbyPluginViteConfig(__dirname)`；tailwind/postcss 同理（content globs 两插件本就相同：`['./index.html', './App.tsx', './components/**/*.tsx']`）。构建后对 `ui/` 产物做 diff，确认与迁移前一致。

  **步骤 3：迁底层纯函数 + 中止 scope**。把上表 `ai-bridge.ts` 一栏的 helper 从 `tech-manga/services/mulbyAiService.ts` 平移进 kit，service 改为 import；同步落地 7.3 的 `createAbortScope`。用量回调统一形状：

  ```ts
  // packages/manga-kit/src/ai-bridge.ts
  export interface KitUsage {
    inputTokens: number
    outputTokens: number
    imagesGenerated: number
    kind: 'text' | 'image'
  }
  export type OnKitUsage = (u: KitUsage) => void
  // tech 侧适配为 UsageStat（补 modelType），horror 侧适配为 OnTokenUpdate（补 totalCost/callType）
  ```

  **步骤 4：迁调用骨架与 D3/D4 实现**。前提是第 3/4 章已在 tech-manga 合入并验证——kit 收编的是"修好的最终版"（附件缓存、asyncPool、epoch 竞态检查），而不是把旧 bug 抄进公共包。`resolveImageModel` 参数化为 `resolveImageModel(ai, preferred?)`，同时兼容 tech 的模块态注入（tech 传 `activeModels.imageModel`）与 horror 的逐调用 config（horror 传 `config?.imageModel`）。

  **步骤 5：horror-manga 换装（最后做）**。horror 的 `callMulbyTextStream`（horror-manga/services/mulbyAiService.ts:349 起）换成 kit 的 `callTextStream` + `createAbortScope`：其文本流真中止能力（`ai.abort(requestId)` 桥接）kit scope 已内建，等价替换；图像侧"作废结果"语义与 tech 相同（contextBridge 限制，见 7.2）。删除 horror 自研的 AbortController 桥接与重复 helper。`scripts/detect-changed-plugins.js` 增一条规则：`packages/` 有变更时，将声明了 kit 依赖的插件全部视为 changed（其 `INFRA_PATTERNS` 目前不含 `packages/`；退而求其次也可把 `packages/` 直接加进 `INFRA_PATTERNS` 触发全量重建，但按依赖精准标记更省 CI）。`scripts/build-all-plugins.js` 本身已在仓库根做 `pnpm install`，无需改动。

- **验收标准**：
  - [ ] `pnpm-workspace.yaml` 含 `packages/*`，根 `pnpm install` 通过，`node scripts/build-all-plugins.js` 全绿
  - [ ] 步骤 2 完成后，两插件 `ui/` 构建产物与迁移前 diff 一致（允许 hash 文件名差异，内容等价）
  - [ ] 步骤 3/4 完成后，tech-manga 全流程（剧本 → 资产 → 逐页生成 → 中止 → 单页重绘 → zip 导出）真机回归通过
  - [ ] 步骤 5 完成后，horror-manga 同项回归通过，且其 `services/mulbyAiService.ts` 中不再存在与 kit 重复的 helper 定义
  - [ ] 两插件 `.inplugin` 打包（`pnpm run pack`，即 build + `mulby pack`）成功，产物中无 node_modules 泄漏（kit 代码已内联）
  - [ ] prompt 文案、计价表、用量上报形状仍在各插件内，kit 中 `grep -i "gemini\|doraemon\|manga director"` 无命中

- **工作量**：L。约 3.5 天：步骤 1-2 半天；步骤 3-4 共 1.5 天（含 tech 回归）；步骤 5 horror 换装 1 天；缓冲半天。

- **风险与回滚**：主要风险是公共包引入行为耦合——kit 里一个 bug 双杀两插件；缓解：每步独立小提交 + 两插件产物 diff/回归门禁，任一步出问题 `git revert` 该步即可（插件内代码退回 vendor 拷贝状态）。次要风险：vite/esbuild 对 workspace 链接包 .ts 源码的转译在个别版本组合下有坑；缓解：若步骤 2 产物 diff 异常，退路是 kit 增加 `tsc -b` 预构建、exports 指向 dist（多一步构建但链路更保守）。注意 horror-manga 仅存在于 feat/tech-manga 分支，整个重构须在该分支完成后随分支一起合回。

- **horror-manga 适用性**：适用——本条即以两插件收敛为目标，horror-manga 是步骤 5 的迁移对象，并借此免费获得第 2-5 章在 tech-manga 验证过的全部修复。

### 7.2 mulby.d.ts 全仓漂移治理：packages/mulby-types 单点分发 + 从宿主同步的脚本管线

- **现状与根因**：实测盘点（主检出，不含 worktree、不含 node_modules/dist）：mulby-plugins 全仓共 **46 份** `src/types/mulby.d.ts` 手工拷贝（含 archived-plugins 下 2 份），按内容去重后 **27 个不同版本**——其中 19 个是千行级全量拷贝的漂移变体（1215/1222/1265/1273/1765/1846×2/1861/1900/2038/2042/2092/2356/2398/2406/2407/2417/2503/2514 行；注意存在两个都是 1846 行但 hash 不同的版本，漂移已细到无法靠行数分辨），另有 8 份小型手写 stub（15-209 行）。两 manga 插件共用的 2413 行版本只存在于 feat/tech-manga 分支——该分支上合计 48 份拷贝、28 个版本。比漂移更糟的是**类型谎言**：`tech-manga/src/types/mulby.d.ts:1648` 声明 `type AiPromiseLike<T> = Promise<T> & { abort: () => void }` 且 `ai.call` 返回它，但宿主 `docs/apis/ai.md:130` 明确说明 contextBridge 序列化会剥离 Promise 上的附加属性、渲染进程唯一可靠中止方式是 `ai.abort(requestId)`——该类型只对宿主自身代码为真（类型定义于宿主 `src/shared/types/ai.ts:521`，`src/preload/apis/ai.ts:16` 的 `toAbortablePromise` 在 preload 侧真实构造），跨过 contextBridge 到插件 UI 即为假；tech-manga 之所以要自建 abort-epoch 机制（D1），正是这个谎言的直接受害场景。根因：没有任何同步机制，每个插件从上一个插件拷一份然后各自增补。

- **改动方案**：

  **步骤 1：建 `packages/mulby-types` 基线包**。基线选两 manga 的 2413 行版本（最新、且经本轮 43-agent 审查逐 API 核对过），落为 `packages/mulby-types/mulby.d.ts`，并手工应用唯一一处语义修正——把 `AiPromiseLike` 改为与渲染进程现实一致：

  ```ts
  // packages/mulby-types/mulby.d.ts
  /**
   * 注意：宿主自身代码（preload/主进程侧）中此类型带 abort()（见宿主 src/shared/types/ai.ts:521，
   * preload/apis/ai.ts:16 的 toAbortablePromise 构造），但 Electron contextBridge 会剥离
   * Promise 上的附加属性（宿主 docs/apis/ai.md:130），插件 UI 侧 abort 不可用。
   * 中止请使用 ai.abort(requestId)（requestId 经流式 chunk 的 __requestId 获取）。
   */
  type AiPromiseLike<T> = Promise<T>
  ```

  保留别名不改各方法签名，diff 最小；`interface Window`（原文件 2410 行）等其余内容原样保留。包结构：

  ```json
  {
    "name": "@mulby-plugins/types",
    "private": true,
    "version": "0.1.0",
    "types": "./mulby.d.ts",
    "exports": { ".": { "types": "./mulby.d.ts" } }
  }
  ```

  **步骤 2：插件接入**。该 d.ts 是无 import/export 的 ambient 声明，目前靠 tsconfig 无 `include` 时的默认全目录收录生效；换成包分发后需显式声明——插件 `tsconfig.json` 的 `compilerOptions.types` 从 `["node"]` 改为 `["node", "@mulby-plugins/types"]`（类型引用指令解析支持非 @types 包，与 `types: ["vite/client"]` 同机制），`devDependencies` 加 `"@mulby-plugins/types": "workspace:*"`，删除本地 `src/types/mulby.d.ts`。先只迁两 manga 插件；其余 46 份按插件维护活跃度渐进迁移（stub 型的 8 份可保留，它们是刻意精简的局部声明，迁移反而扩大类型面）。

  **步骤 3：防再漂移检查**。`mulby-plugins/scripts/check-mulby-types.mjs`：

  ```ts
  // 凡已迁移插件（读 package.json 是否依赖 @mulby-plugins/types）：
  // 其 src/types/mulby.d.ts 若仍存在 → 报错（防止"包 + 本地拷贝"双轨）；
  // 未迁移插件：本地拷贝与基线 diff，仅 warning 列出漂移行数，不阻塞。
  ```

  挂进 `scripts/build-all-plugins.js` 开头与 CI。

  **步骤 4：从宿主同步的脚本管线（增强项）**。宿主已有文档管线先例（`scripts/sync-skill-docs.mjs` + `scripts/check-api-docs.mjs`，经宿主 package.json 的 `verify:app` 串入），平行做一条类型管线，但脚本放 **mulby-plugins 仓**（`scripts/sync-mulby-types.mjs`），不占用 D6 的两个宿主分支：读取同级宿主检出（`MULBY_REPO` 环境变量，默认 `../mulby`）。注意 window.mulby 表面的真源结构（实测核对后修正）：宿主 `src/shared/types/plugin.ts` 的 `PluginAPI`（plugin.ts:630 定义，其 ai 子面自 plugin.ts:737 起、`abort` 返回 `void`）是**插件后端 context.api** 的表面（src/main.ts 场景），并非 window.mulby；window.mulby 没有单一聚合类型，由宿主 `src/preload/index.ts:25-35` 用 `createCoreApi`/`createAiApi`/`createAppPluginApi`/`createPlatformApi` 等工厂拼装，其中 ai 子面的类型真源是 `src/shared/types/ai.ts` 的 `AiApi`（ai.ts:525，preload 实现即以 `AiApi['images']['generateStream']` 等标注）。因此脚本以 preload 各 api 工厂的返回类型 + `AiApi` 等 shared 类型为输入，用 TypeScript compiler API 展开 import 依赖闭包、rollup 成单文件 ambient d.ts，并施加固定变换：window 表面上 `AiPromiseLike<T>` → `Promise<T>`（即步骤 1 的修正，自动化版）。生成结果与 `packages/mulby-types/mulby.d.ts` diff，不一致则 check 脚本失败——宿主每次扩 API，跑一次 sync 即完成全插件类型升级。注意**不能**纯 rollup 宿主类型不做变换：`AiPromiseLike` 对宿主自身代码（preload/主进程侧）是真实的，降级变换只应用于 window 表面。

- **验收标准**：
  - [ ] `packages/mulby-types` 建立，`AiPromiseLike` 已降级为纯 `Promise` 且带解释注释
  - [ ] 两 manga 插件删除本地 `src/types/mulby.d.ts` 后 `tsc --noEmit` 通过，构建产物不变
  - [ ] 若插件代码存在对 `req.abort()`（Promise 附加属性）的调用，类型检查现在会报错（谎言不再可写）——两 manga 当前实现均已用 `ai.abort(requestId)`，应零报错
  - [ ] `check-mulby-types.mjs` 挂入 CI：已迁移插件残留本地拷贝时构建失败
  - [ ] `sync-mulby-types.mjs` 在本地宿主检出上运行，输出与基线 diff 为空（或 diff 即为待升级内容）
  - [ ] 文档：仓库根 CONTRIBUTING.md 增加"新插件不要拷贝 mulby.d.ts，依赖 @mulby-plugins/types"一节

- **工作量**：M。步骤 1-3 共 1 天（盘点已完成）；步骤 4 同步脚本 1-1.5 天（window.mulby 无单一聚合类型，需从 preload 各工厂返回类型收敛，比"单文件纯 rollup"复杂）。合计约 2-2.5 天，步骤 4 可延后独立交付。

- **风险与回滚**：基线版本若较某插件的本地拷贝缺少个别成员，迁移该插件时会暴露类型错误——这是期望行为（暴露即漂移点），修法是把缺失成员经步骤 4 管线补进基线而非回退；`skipLibCheck: true` 已在插件 tsconfig 中，第三方类型冲突风险低。回滚：任一插件恢复本地拷贝 + tsconfig types 撤回即可，包与脚本可独立存在不影响未迁移插件。风险最低的条目之一，因为它不触碰任何运行时代码。

- **horror-manga 适用性**：适用——horror 的 mulby.d.ts 与 tech 为同一份 2413 行拷贝，步骤 2 一并迁移，成本近零。

### 7.3 中止纪元收编为 createAbortScope() 工厂（随 7.1 顺手完成）

- **现状与根因**：`tech-manga/services/mulbyAiService.ts:35-57` 的中止机制是模块级五件套：`abortEpoch`、`activeTextRequestIds`、`getAbortEpoch`、`abortAllAiTasks`、`throwIfAborted`。审查结论（经核对成立）：**当前完全安全**——manifest 声明 `pluginSetting.single: true`（tech-manga/manifest.json:20），宿主每个插件窗口是独立 JS realm，且 plugin-view-pool 只预建空白壳视图、用过的视图不回池，"池化复用残留"场景根本不存在；即便未来开多窗口，模块态也是每窗口一份，"中止本窗口全部任务"语义反而正确。唯一的未来风险点：若把 AI 编排迁入插件后端（src/main.ts 路线），宿主 `src/main/plugin/host-manager.ts:124` 的 `hosts: Map` 按 plugin.id 建 utilityProcess，同插件所有窗口共享一个后端进程，届时模块级单例会变成跨窗口全局，一个窗口点中止会误杀其他窗口任务。此外模块级单态导致单测无法各自造 scope。本条**不是修 bug，是低成本的面向未来**，故不单独立项，随 7.1 步骤 3 顺手完成。

- **改动方案**：遵守 D1——保持全局 epoch 语义与 `abortAllAiTasks`/`getAbortEpoch` 对外接口，仅把实现收进工厂，不引入 AbortController 重构。

  ```ts
  // packages/manga-kit/src/abort-scope.ts
  export interface AbortScope {
    epoch(): number
    isCurrent(epochAtStart: number): boolean
    throwIfAborted(epochAtStart: number): void
    /** 登记流式 requestId；若捕获时纪元已变则返回 false，调用方应立即 ai.abort(id) */
    trackIfCurrent(epochAtStart: number, requestId: string): boolean
    untrack(requestId: string): void
    abortAll(): void
  }

  // abort 类型取 void | Promise<void>：兼容插件 UI 的 window.mulby.ai
  // （mulby.d.ts:1653 声明返回 Promise<void>）与未来插件后端 context.api
  // （宿主 shared/types/plugin.ts 的 PluginAPI 中 abort 返回 void）
  export const createAbortScope = (
    getAiApi: () => { abort(id: string): void | Promise<void> } | undefined
  ): AbortScope => {
    let epoch = 0
    const active = new Set<string>()
    return {
      epoch: () => epoch,
      isCurrent: e => e === epoch,
      throwIfAborted(e) { if (e !== epoch) throw new DOMException('Aborted', 'AbortError') },
      trackIfCurrent(e, id) { if (e !== epoch) return false; active.add(id); return true },
      untrack(id) { active.delete(id) },
      abortAll() {
        epoch += 1
        const ai = getAiApi()
        if (ai) active.forEach(id => { try { void ai.abort(id) } catch { /* ignore */ } })
        active.clear()
      }
    }
  }
  ```

  service 侧保持对 App 零改动的兼容层（模块级默认实例，即"每窗口一份"的现语义）：

  ```ts
  // tech-manga/services/mulbyAiService.ts
  const scope = createAbortScope(() => (window as Window).mulby?.ai)
  export const getAbortEpoch = () => scope.epoch()
  export const abortAllAiTasks = () => scope.abortAll()
  ```

  原 `generateComicScript` 中 chunk 回调的登记逻辑（tech-manga/services/mulbyAiService.ts:485-494）等价改写为 `if (!scope.trackIfCurrent(epoch, chunk.__requestId)) { try { void ai.abort(chunk.__requestId) } catch {} }`。未来若走插件后端路线，改为按窗口/会话实例化 scope 并经参数下发即可，公共实现不动。

- **验收标准**：
  - [ ] `createAbortScope` 落在 manga-kit，带单测：epoch 递增作废旧任务、trackIfCurrent 对过期 epoch 返回 false、abortAll 对全部登记 id 调用 ai.abort 且清空
  - [ ] tech-manga 的 `abortAllAiTasks`/`getAbortEpoch` 对外签名不变，App.tsx 无需改动
  - [ ] 真机回归："中止全部任务"仍能杀掉在途文本流并作废在途图像结果；中止后重新发起生成正常
  - [ ] 第 4 章 D1 的 App 层运行代际检查所依赖的 `getAbortEpoch` 语义未变（捕获-比对-丢弃链路回归通过）

- **工作量**：S。半天，含单测，计入 7.1 步骤 3。

- **风险与回滚**：语义等价改写，风险极低；唯一细节是 `trackIfCurrent` 把原实现的判断-登记两步（tech-manga/services/mulbyAiService.ts:487-492：先判 epoch、当前则 add、过期则立即 abort）合并为单次调用，逐分支语义与原实现一致。回滚：revert 该提交，service 退回模块级五件套。

- **horror-manga 适用性**：部分适用——horror 的 AbortController 方案并非缺陷（其 onAbort 会桥接 `ai.abort(requestId)` 真中止文本流，且已是 App 实例级 scope，由 `abortControllerRef` 持有、每次生成新建 controller），换装 kit scope 属统一实现、删重复代码，而非修复；随 7.1 步骤 5 一并完成即可，不值得单独做。

### 7.4 App.tsx 拆分：状态机 + 图像队列 + 计价器 + promptBuilder（依赖第 3/4 章，最后做）

- **现状与根因**：`tech-manga/App.tsx` 恰 743 行，混杂四类不相干职责：(1) `WorkflowStep` 状态机（types.ts:53 定义）散落在各 handler 的 `setWorkflowStep`/`setIsProcessing`/`setGlobalError` 手工转移里；(2) 逐页生成编排——`handleStartComicGeneration` 用 `(idx+1)*1200ms` 的 setTimeout 阶梯（App.tsx:364-370）+ `pendingTimersRef` 手工清理（App.tsx:92），属伪限流（15 页在 ~18 秒内全部压向 provider，无并发上限、无重试）；(3) `trackUsage` 内嵌三套计价分支（App.tsx:114-160）；(4) 角色/道具引用解析在 `preparedPages`（App.tsx:295-355）与 `handleRegeneratePage`（App.tsx:407-474）两处重复实现。具体缺陷已核实：`triggerImageGeneration`（App.tsx:373）未 useCallback 却出现在 handleRegeneratePage 的依赖数组（App.tsx:474）中，每次渲染重建导致 memo 失效（deps 同时含 `pages` 也是并列原因）；全插件零处调用 mulby storage，生成图全以 base64 data URL 存 React state（15 页约 30-60MB，叠加参考图可能更高），窗口关闭即丢弃整次高成本生成。**其中 (2) 的 setTimeout 阶梯与零持久化分别由第 4 章（D4 asyncPool）与第 3 章（D5 storage）修复，本条只做结构收纳，不重复造方案。**

- **改动方案**：

  **先后依赖（本条的核心约束）**：第 3 章（D5：`storage.set('config'/'session')` + `attachment.put` 增量落盘）与第 4 章（D1 运行代际检查、D2 Start Over/重生成先 `handleCancelAll()`、D4 asyncPool 替换 setTimeout 阶梯）**必须先在现有 App.tsx 结构上落地并回归通过**，本条随后做纯结构重构（行为冻结）。理由：若先拆分后改行为，第 3/4 章的 diff 会横跨新旧两套结构，评审与回归成本翻倍；先落行为、再做"只挪不改"的重构，每一步都可用"重构前后行为一致"作为验收基线。7.1 的 kit 抽取在本条之后执行（kit 收编的 asyncPool/abort scope 接口以本条定型的 hook 边界为准）。

  **步�骤 1：`hooks/useComicWorkflow.ts`**——用 useReducer 收敛状态机，显式化全部合法转移：

  ```ts
  type WorkflowEvent =
    | { type: 'SCRIPT_START' } | { type: 'SCRIPT_DONE' }
    | { type: 'SCRIPT_FAIL'; error: string | null }
    | { type: 'RENDER_START' } | { type: 'CANCEL_ALL' } | { type: 'RESET' }

  interface WorkflowState { step: WorkflowStep; isProcessing: boolean; globalError: string | null }

  // 落地时按 s.step 收窄合法转移（如仅 SCRIPT_GENERATION 下接受 SCRIPT_DONE/SCRIPT_FAIL），
  // 非法事件一律 return s——对应下方"非法转移保持原状态"的验收项
  const workflowReducer = (s: WorkflowState, e: WorkflowEvent): WorkflowState => {
    switch (e.type) {
      case 'SCRIPT_START': return { step: WorkflowStep.SCRIPT_GENERATION, isProcessing: true, globalError: null }
      case 'SCRIPT_DONE':  return { step: WorkflowStep.STORYBOARDING, isProcessing: false, globalError: null }
      case 'SCRIPT_FAIL':  return { step: WorkflowStep.CONFIG, isProcessing: false, globalError: e.error }
      case 'RENDER_START': return { ...s, step: WorkflowStep.COMIC_GENERATION }
      case 'CANCEL_ALL':   return { ...s, isProcessing: false }
      case 'RESET':        return { step: WorkflowStep.CONFIG, isProcessing: false, globalError: null }
    }
  }
  ```

  `RESET`/`SCRIPT_START` 的入口封装保持第 4 章已落地的 D2 行为（先 `handleCancelAll()` 再转移）；AbortError 静默回 CONFIG 且不设 error（现 App.tsx:209-211——事件化时对该场景以 `SCRIPT_FAIL` 传 `error: null`，行为冻结不偷改）与鉴权错误分支（`handlePermissionError`，App.tsx:105）在入口封装处归一为 `SCRIPT_FAIL` 的 error 入参。

  **步骤 2：`hooks/useImageQueue.ts`**——把第 4 章落在 App 里的 asyncPool 调度、abort scope 接入、失败重试收进 hook：

  ```ts
  const { enqueueAll, isRunning } = useImageQueue({
    concurrency: 2,                       // D4
    run: (task: PageRenderTask) => generatePanelImage(task.prompt, task.ratio, task.refs, onStat),
    onDone: (task, dataUrl) => { patchPage(task.pageNumber, dataUrl); void persistPage(task, dataUrl) },  // D5 增量落盘挂点
    onError: (task, err) => patchPageError(task.pageNumber, err),
    abortScope: scope                      // 7.3；AbortError 不重试、其余自动重试 1 次
  })
  ```

  `handleStartComicGeneration` 缩减为"构造 PageRenderTask[] → enqueueAll"；`handleRegeneratePage` 变成 `enqueue(single)`,与批量生成共享同一队列（单页重绘天然受并发上限约束）。`pendingTimersRef` 与 `triggerImageGeneration`（App.tsx:373-405）整体删除，App.tsx:474 的依赖数组问题随之消失。

  **步骤 3：`utils/promptBuilder.ts`**——纯函数去重两处引用解析：

  ```ts
  export interface SceneResolution { refs: string[]; contexts: string[] }
  /** 收敛 App.tsx:303-334（preparedPages 内，含 persistent_states 状态覆写）
   *  与 App.tsx:418-440（handleRegeneratePage 内，无状态覆写）两处实现 */
  export const resolveSceneRefs = (
    characterNames: string[], propNames: string[],
    characterSheet: CharacterSheetItem[], propSheet: PropSheetItem[],
    pageStates?: ComicPageData['persistent_states']
  ): SceneResolution => { /* 模糊匹配 + 引用图收集 + context 行拼装 */ }
  export const buildPagePrompt = (style: string, globalArtStyle: string, contexts: string[], scenePrompt: string): string => { … }
  export const replaceContextBlock = (editedPrompt: string, contexts: string[]): string => { /* 收敛 App.tsx:441-450 */ }
  ```

  注意两处现实现有一处已知差异：preparedPages 版含 `persistent_states` 的 `[ACTION STATE OVERRIDE]` 拼装而 regenerate 版没有——统一为可选参数保留两种行为，不在重构中偷改。

  **步骤 4：`hooks/useUsageTracker.ts`**——计价表参数化：

  ```ts
  type Tier = { upTo: number; rate: number }
  const PRICING: Record<UsageStat['modelType'], { input: Tier[]; output: Tier[] }> = {
    GEMINI_3_PRO:          { input: [{ upTo: 200_000, rate: 2 }, { upTo: Infinity, rate: 4 }],
                             output: [{ upTo: 200_000, rate: 12 }, { upTo: Infinity, rate: 18 }] },
    GEMINI_3_PRO_IMAGE:    { input: [{ upTo: Infinity, rate: 2 }],  output: [{ upTo: Infinity, rate: 120 }] },
    GEMINI_2_5_FLASH_IMAGE:{ input: [{ upTo: Infinity, rate: 0.3 }], output: [{ upTo: Infinity, rate: 30 }] }
  }
  ```

  `trackUsage`（App.tsx:114-160）的三分支 if/else 变成查表；`breakdown` 三字段由表 key 驱动。查表语义须与现实现一致：按**总量落在哪一档取整档费率**（现实现为 `stat.inputTokens > 200000 ? 4.00 : 2.00` 的阈值整档切换），不是边际分段累进——对拍验收要求金额逐分一致，档位语义不能顺手"修正"。计价表本身留在插件（7.1 边界决定），hook 实现后续可进 kit。

  **步骤 5：收尾**。App.tsx 目标缩至 ~300 行（纯组装 + JSX）；`handleDownloadAll`（App.tsx:476 起）的 zip 导出移入 `utils/exportZip.ts`。拆分全程不改任何 prompt 字符串、不改计价数值、不改转移语义——用"重构前后同一输入得到同一 UI 状态序列"作验收。

- **验收标准**：
  - [ ] 前置确认：第 3 章 D5 与第 4 章 D1/D2/D4 已合入且回归通过（本条 PR 的 base 包含它们）
  - [ ] App.tsx 不再含 setTimeout 阶梯、pendingTimersRef、内联计价分支、重复的引用解析；行数 ≤ 350
  - [ ] `resolveSceneRefs` 单测：精确匹配/包含匹配/无匹配、有无 persistent_states 两种模式，与旧实现输出逐字符一致（用旧函数做 golden 对拍后删除旧实现）
  - [ ] `workflowReducer` 单测覆盖全部事件×状态组合；非法转移（如 STORYBOARDING 下收到 SCRIPT_DONE）保持原状态
  - [ ] 计价查表对固定用量样本与旧 trackUsage 输出金额完全一致（含 >200k tokens 的高档位分支）
  - [ ] 真机全流程回归：生成 15 页长漫画→中途中止→单页重绘→Start Over→再生成，UI 状态与重构前一致；关窗重开可从 D5 持久化恢复
  - [ ] handleRegeneratePage 不再因 `pages`/`triggerImageGeneration` 进依赖数组而每帧重建（React DevTools Profiler 抽查 PanelCard 无全量重渲）

- **工作量**：M。约 2.5 天：步骤 1-2 一天（状态机 + 队列 hook 化）、步骤 3-4 半天、步骤 5 + 对拍单测 + 真机回归一天。

- **风险与回滚**：风险集中在状态机转移的隐式行为（如 SCRIPT_FAIL 时既设 error 又回 CONFIG 的耦合、CANCEL_ALL 不清 error 的现状、AbortError 静默不设 error）被"顺手规整"——纪律是重构批次内零行为变更，发现想改的行为记 TODO 进后续批次。回滚：本条是单 PR 纯重构，revert 即回到第 3/4 章完成态，不牵连行为修复。

- **horror-manga 适用性**：适用——horror 的 App.tsx 为 773 行同构文件，含同款 setTimeout 阶梯与重复引用解析；四个 hook/纯函数按 7.1 步骤 5 的节奏在 horror 复刻（promptBuilder 因剧本 schema 不同需各自实现，hook 骨架可经 manga-kit 共享）。
