# AI 创意画布 · 全面审查修复清单（2026-07-13）

> 来源：多智能体六维度深度审查（计划完成度 / 画布引擎 / 剪辑引擎 / 服务层 / 宿主后端 / 产品体验），
> 每条 bug 类发现均经独立对抗核实确认（5 条误报已剔除，见文末附录）。
> 基线：commit `dd59c3c`；typecheck / 25 条 compile 快照 / 4 条引用测试 / 完整构建全绿。
> 行号为审查时点快照，修复过程中会漂移——**动手前先用 grep 定位确认**。

**进度：10/64**（☐ 待办 · ☑ 完成 · ☒ 决定不修，需写原因）——批次 A 已全部完成

---

## 执行协议（/loop 每轮照此执行）

1. **取项**：按批次顺序（A → B → C → D → E → F）取第一条未勾选（`[ ]`）的项。批次内默认按编号顺序，除非某项标注了「先决」依赖。
2. **复核**：动手前先按「位置/证据」grep 复核问题仍存在（行号可能漂移；若发现该问题已被顺带修掉或证据不成立，标 `[-]` 并写一行原因，本轮改取下一项）。
3. **修复**：按「修法」实施，风格遵循现有代码（中文注释、现有工具函数优先复用）。修法只是建议，若有更优方案可替换，但要在完成记录里写明。
4. **验证**：每轮必跑 `npm run typecheck && npm test`；涉及 compile.ts 的项**禁止盲刷快照**——先确认新输出正确再更新 snapshots.json，并在对应 recipe 的 expect 里补数值断言。有「验证」栏的项按栏内要求补充验证。
5. **记账**：把该项 `[ ]` 改为 `[x]`，行尾追加 `（✓ YYYY-MM-DD commit-subject）`；更新顶部「进度」计数。
6. **提交**：一类问题一个 commit，格式 `fix(ai-creative-canvas): <主题>——<要点>`（沿用仓库现有风格）。文档更新与代码同 commit。
7. **单轮限量**:一轮只做一项（大项可拆多轮做，行尾记录进展），避免超大 diff 不可回溯。

---

## 批次 A · 数据安全与磁盘卫生（最优先，全部完成前不进 B）

- [x] **A1 [P0/bug] 切换/删除工程窗口期，旧工程 doc 被防抖保存写到新工程 id 下（串工程覆盖）**（✓ 2026-07-13 自动保存/pagehide 抢救均改按 `state.project.id` 键控，activeId 仅作初始化门槛；loadIntoGraph 追加 `doc.id===pid` 强一致保险。修法中「cancel 防抖句柄」一项未做：键控修复后挂起写恒指向旧工程自身 id，已无害；删除场景的键复活归 A3 tombstone 处理。typecheck+25 快照+4 引用测试全绿；宿主内运行时复现验证待后续人工过一遍）
  - 位置：`src/ui/store/projectStore.ts:153`（switchProject）、`:209`（deleteProject）、`src/ui/App.tsx:87-95`（保存订阅）
  - 证据：switchProject 先 `set({activeId})` 再异步 loadIntoGraph；applyLoaded 之前 graphStore 仍是旧工程。窗口内任何 updateCard（文本流式 onChunk generate.ts:139、图片 onProgress :147、loadIntoGraph 首行 abortAllInflightVideos 触发的 poll catch :254 置 idle）→ App 订阅读到**新 activeId + 旧 doc** 调度防抖保存 → 800ms 后旧工程整体覆盖新工程存储。目标工程有恢复快照时 confirmDialog 会把窗口拉长到任意久。
  - 修法：保存键改用 `state.project.id` 而非 `useProject.getState().activeId`（代码中 pid===doc.id 恒成立），根治 id/doc 错配；辅以 switch/delete 前 `saveMain.cancel()/saveRec.cancel()`（把两个 debounce 句柄挂到可供 projectStore 调用的位置）。
  - 验证：模拟复现——文本卡流式生成中切换工程，确认新工程存储未被旧 doc 覆盖（检查 `proj:<新id>:current` 的 doc.id）。

- [x] **A2 [P1/bug] 崩溃恢复被采纳后主存分片永不落盘，重启丢回崩溃前版本**（✓ 2026-07-13 loadIntoGraph 恢复分支重构：采纳恢复 → sanitize 后先 `await saveProject(pid, doc)` 全量落主存 → 成功才 clearRecovery，失败保留快照并 toast 提示可再恢复；用户拒绝恢复的分支保持原「即刻丢弃快照」语义。基线机制核实过：恢复路径 ensureBaselineFor 必然重置（冷启/切换）且恢复 doc 的 board 为新反序列化引用，全量重写成立。typecheck+29 测试全绿；宿主内崩溃→恢复→重启链路待人工验证）
  - 位置：`src/ui/store/projectStore.ts:64-77`（loadIntoGraph 恢复分支）、`src/ui/services/persistence.ts:57-61,180-184`
  - 证据：选「恢复」后 `seedMainBaseline(pid, rec.doc)` 把基线播种为恢复快照的 board 引用，writeSharded 按 `baseline.get(b.id) !== b` 判「未改动」全部跳过——磁盘主存仍是崩溃前旧数据，恢复 manifest 又已被删。不编辑或只编辑部分画布 → 再重启即静默丢失恢复的内容。
  - 修法：恢复路径先 `await saveProject(pid, doc)` 全量落盘（空基线会重写全部分片），成功后再 `clearRecovery(pid)`，最后才 applyLoaded/seedMainBaseline。
  - 验证：手工构造恢复快照 → 采纳 → 不做任何编辑直接重载，确认读到的是恢复后内容。

- [x] **A3 [P2/bug] deleteProject 不取消挂起的防抖保存：已删工程的存储键被写回成永久孤儿**（✓ 2026-07-13 persistence.ts 加会话级墓碑集合 deletedProjects：deleteProjectStorage 同步立碑，saveProject/saveRecovery 对墓碑 pid 拒写；serializeIo FIFO 保证先入队的保存会被随后的删除清理，两种时序均安全。核实过 importProject/duplicateProject 均强制换新 uid，无 id 复用误伤。cancel 防抖句柄方案弃用——墓碑更彻底且不引入 App↔store 耦合。typecheck+29 测试全绿）
  - 位置：`src/ui/store/projectStore.ts:191-222`
  - 证据：编辑后 800ms 内删除工程 → deleteProjectStorage 清键后，防抖到期的 saveProject(旧pid) 经 ensureBaselineFor 全量重写 manifest+分片——注册表已无该 id，这批键永远无人清理。
  - 修法：persistence 层加 tombstone 集合（deleteProjectStorage 记录 pid，saveProject/saveRecovery 拒写 tombstone 中的 pid）；配合 A1 的 cancel 双保险。先决：A1。

- [x] **A4 [P1/bug] main.ts sanitizeName 白名单含 `.`，subdir 传 `..` 可逃逸出插件落盘根目录**（✓ 2026-07-13 与 A5 同轮修复：downloadMedia 删除 subdir 入参，路径全由后端拼接；sanitizeName 追加 `.replace(/^\.+$/,'_')` 归一纯点序列作纵深防御。两个调用方（generate.ts:210/285）核实只传 url/name/projectId，无破坏性变更）
  - 位置：`src/main.ts:68`（sanitizeName）、`:82-88`（downloadMedia 路径拼接）
  - 证据：`/[^\w.\-]+/g` 不改写纯点序列，`subdir:'..'` + `name:'xxx.json'` 可把任意 URL 内容写到 userData 根目录（`host.call` 允许跨插件调用，属暴露面）。宿主 checkSystemProtection 不拦 userData。
  - 修法：downloadMedia 直接删掉 subdir 入参（现有调用方只用 projectId，路径全部后端拼接）；保留 sanitizeName 时追加 `.replace(/^\.+$/,'_')` 或逐段拒绝 `..`/`.`。

- [x] **A5 [P2/bug] sanitizeName 把 subdir 的 `/` 压成 `_`：host 下载落盘到 media_&lt;pid&gt; 而非 media/&lt;pid&gt;，与 UI 端/README 分裂**（✓ 2026-07-13 与 A4 同轮：后端直接拼 `media/<projectId>`（仅对 projectId 段消毒），与 UI 端/README 一致；死的逐级 mkdir 循环删除（宿主 mkdir 已核实为 mkdirSync recursive，plugin/filesystem.ts:318），两处错误注释修正。旧 `media_<pid>` 目录不迁移——卡片按绝对路径引用仍可用，清扫责任记入 A6）
  - 位置：`src/main.ts:82-88`；对照 `src/ui/services/media.ts:30`、README L39
  - 证据：`media/p123` 被 sanitize 成 `media_p123`，逐级 mkdir 循环是死逻辑（宿主 mkdir 本就递归）；同一工程素材分裂两处，按文档路径做迁移/清理会漏掉全部 host 下载媒体。
  - 修法：与 A4 同批改——路径由后端以 projectId 拼 `media/<pid>`（仅对 projectId 段 sanitize）；需兼容读取/一次性迁移已存在的 `media_<pid>` 目录；修正 main.ts:35 错误注释。先决：A4。

- [x] **A6 [P1/incomplete] 删除工程不清理磁盘媒体；重复生成旧文件永不回收；TTS 不分工程目录**（✓ 2026-07-13 ①main.ts 新增 removeProjectMedia RPC：递归删 media/<pid> 与遗留 media_<pid> 全部文件——宿主 filesystem 无 rmdir 只有 unlink，空目录骨架残留（零体积）；②deleteProject 两分支接入清理，普通删除分支加引用护栏：扫描剩余工程 doc 是否引用本工程媒体路径（duplicateProject 副本共享原工程文件，审查未覆盖的坑），有引用则跳过清盘；③TTS 归档到 media/<projectId>：runTts 增加 opts.projectId 并在 generate.ts/VideoStudioModal 两个调用点传入，synthSpeech 无 projectId 时退回旧 audio/ 目录。未做：旧共享 audio/ 目录的存量孤儿不清（无工程归属无法安全删）；「保存时惰性孤儿清扫」为可选项未做（重复生成的旧文件仍会累积，删工程时才回收）。typecheck+双端构建+29 测试全绿）
  - 位置：`src/ui/services/persistence.ts:271-315`、`src/main.ts:176-183`（synthSpeech 写 `${root}/audio`，收了 projectId 没用）
  - 证据：deleteProjectStorage 只删 storage 键，media/<pid> 目录整体成孤儿；每次重生成用 `${cardId}_${stamp()}` 新文件名，旧文件从不删；生成中删卡后落盘文件无主。磁盘只增不减。
  - 修法：main.ts 增加 `removeProjectMedia(projectId)` RPC（递归删 media/{pid}），deleteProject 调用；synthSpeech 改写入 media/{projectId}/；可选：保存时对比卡片 assetLocalPath 集合做惰性孤儿清扫。先决：A5（已完成）。注意：A5 修复前的存量安装存在遗留 `media_<pid>` 目录（host 下载曾落此处），removeProjectMedia 须同时清扫 `media/<pid>` 与 `media_<pid>` 两个位置。

- [x] **A7 [P2/bug] downloadMedia/synthSpeech 网络拉取无超时、无大小上限、无内容类型校验**（✓ 2026-07-13 main.ts 新增 fetchBinaryGuarded：AbortSignal.timeout 整体超时（含响应体读取）+ content-type 前缀校验（媒体 image|video|audio、TTS audio|octet-stream）+ Content-Length 预检与流式计数兜底。downloadMedia 10min/500MB、synthSpeech 120s/50MB；UI 端两处 `mime:'video/mp4'` 硬编码改为优先用后端返回的真实 content-type。typecheck+后端构建+29 测试全绿）
  - 位置：`src/main.ts:92`（downloadMedia fetch）、`:158`（synthSpeech fetch）；连带 `src/ui/services/generate.ts:224` 硬编码 `mime:'video/mp4'`
  - 证据：签名 URL 过期返回 200+HTML 时被当视频落盘、卡片标 done；数百 MB 文件 base64（×1.33）整串跨 RPC，内存峰值 ≈2.3× 文件大小；服务器挂起则 RPC 无限等待、卡片永停 running。
  - 修法：fetch 加 `AbortSignal.timeout`（下载 5-10min、TTS 60-120s）；Content-Length 超阈值（如 500MB）拒绝，无长度则边读边计数；校验 content-type 前缀 image/|video/|audio/ 否则 `{ok:false,error:'非媒体响应: '+ct}`；返回真实 mime，UI 端去掉硬编码。

## 批次 B · 剪辑引擎正确性（WS1 遗留风险，B1 是根因先做）

- [x] **B1 [P1/bug] overlay/字幕/静音时间基契约三处矛盾：trim/变速下导出时间窗必错（预览↔导出不一致的根因）**（✓ 2026-07-13 核实预览真相：预览 `<video>` 放的是源文件、playhead=currentTime 为源时间、删除段靠跳播、变速不改播放速率、滑块 max=baseDuration——UI 全程源时间基，compile.ts 头注声称的「预览已 post-trim/post-speed」是错的。统一契约为「源时间基存储、编译器折算」：新增 buildTimeMap（trim 保留段折叠→删除段坍缩到接缝，除以 rate，reverse 镜像，boomerang 退回全程），applyOverlays 的 range、字幕 cue、applyAudio 的 muteRanges 三处都过映射；修正 compile.ts 头注与 types.ts 两处时间基注释（SubtitleCue 原误标「输出时间基」）。验证：`trim-two-keeps-speed2x` 的窗 `1.500→0.750`（rate2 折算）、新增 recipe `trim-secondseg-overlay-timewindow-fold` 锁定跨段偏移 源`[7,9]→[3,5]`，均加了 filterContains 数值断言；`trim-delete-middle-subtitle` cue 都在首段故快照不变。typecheck+26 recipe 快照全绿。**注**：预览侧本就源时间基、现与导出对齐，无需改预览；timeline 的 srcEqOut 拖拽禁用可后续放宽，不属本项）
  - 位置：`src/ui/services/videoEdit/compile.ts:334`（enable 不折算）、`types.ts:104`（注释称「源时间基、编译器折算」）、`VideoStudioModal.tsx:411-412,806,897-899,941-943,1166-1167`（UI 按源时间基写入/编辑）
  - 证据：trim 保留 [7,10]（输出 3s），播放头 8s 处加 overlay 8–9 → 导出 `between(t,8,9)` 永不出现；speed 2× 时源 4–8s 字幕落在输出 4–8s（应为 2–4s）。muteRanges（compile.ts:413-415）、subtitle cues（:357-362）同病。**snapshots.json:81 已把未折算行为锁成基准**。
  - 修法：统一为「存源时间基、编译器折算」：compile.ts 增加 `srcToOut(t)`（按 trim 保留段累计扣删除段，再除以 rate；reverse/boomerang 先禁用 range 或按 outDur-t 镜像），applyOverlays/muteRanges/cues 三处都过映射；改 compile.ts 头注；recipes 的时间窗用例升级为断言具体数值（如 trim[0,3]+[7,10]+2x 下源 8–9 → between(0.5,1.0)）后刷新快照。
  - 验证：快照 diff 逐条人工确认折算数值；有条件时 `npm run test:export` 真跑一条 trim+speed+overlay。

- [x] **B2 [P1/bug] 色温方向反转：「暖阳」导出偏蓝，且与退化路径方向互斥**（✓ 2026-07-13 主路径映射改 `k = 6500 - temp*25`：正 temp（暖阳预设 temp>0）→ 低开尔文 → 暖，与预设语义及退化路径 colorbalance(正=加红) 对齐；补注释说明方向约束。验证：temp=20 recipe 断言升级为 `colortemperature=temperature=6000`（原 7000，正值现更暖）、退化 recipe 断言 `colorbalance=rs=0.150`（>0=暖）——两路径方向都锁死。26 recipe 全绿）
  - 位置：`src/ui/services/videoEdit/compile.ts:313-315`；对照预设 `VideoStudioModal.tsx:76-77`、退化分支 `compile.ts:309-311`
  - 证据：`k = 6500 + temp*25` 把正 temp 映射到冷端（colortemperature 低开尔文=暖），UI 约定正=暖；退化路径 rs=+0.3t 方向却是对的——同一配方新旧 ffmpeg 色调相反。
  - 修法：改为 `k = 6500 - temp*25`；recipes 增加 temp=+50 用例，断言主路径 K 值 <6500 且退化路径 rs>0，防再次反向。

- [x] **B3 [P1/bug] timecode 叠加导出后永远停在 0:00：精灵图输入缺 `-loop 1`，crop 的 t 表达式只求值一次**（✓ 2026-07-13 Graph.inputs 从 `string[]` 改为 `{path,pre?}[]` 支持 per-input 前置参数，args 组装相应展开；timecode 精灵图输入加 `['-loop','1']` 让单帧 PNG 持续产帧、crop 的 x 逐帧前推。输出长度由主流经 overlay 收束，无限输入不会让成片变长。验证：已有 `overlay-pip-mosaic-progress-timecode` recipe 加 argsContains `-loop 1 -i /test/fixtures/tc.png` 锁定，26 recipe 全绿。**遗留**：backlog 建议的「真跑 ffmpeg 抽帧断言第 2 秒≠第 0 秒」属集成测试，归入 B12）
  - 位置：`src/ui/services/videoEdit/compile.ts:365-376,498-499`；对照 `mediaOverlay.ts:127-153`
  - 证据：image2 单帧输入只产 t=0 一帧，crop x 恒为 0，overlay 以 eof_action=repeat 把第一格重复到整片；progress 条能动是因为其表达式写在 overlay 上按主流求值。
  - 修法：g.addInput 支持 per-input 前置参数，对精灵图输入加 `['-loop','1']`；或改用 `[idx:v]loop=loop=-1:size=1` 滤镜。补集成用例：抽帧断言第 2 秒画面 ≠ 第 0 秒。

- [ ] **B4 [P1/bug] crop/改画幅后 overlay 坐标基不一致：预览按整帧、导出按裁剪后画面；frame/progress/pip 尺寸按原始 baseW 渲染**
  - 位置：`src/ui/services/videoEdit/compile.ts:469-471,335-336,391`、`preview.ts:51-60`（inexact 列表不含 crop）、`mediaOverlay.ts:87-119`
  - 证据：crop{x:0.25,w:0.5}+文字 rect.x=0.1 → 预览文字在将被裁掉的区域、导出在裁剪后画面 10% 处，肉眼可见漂移且无「近似预览」角标；frame/progress PNG 按 baseW×baseH 整幅渲染叠到更小画面会截断/失真。
  - 修法：短期 preview.ts 对存在 crop 或 outW/outH 时置 exact=false；中期编译时把 overlay 坐标换算到裁剪后帧（x'=(x-crop.x)/crop.w 等）、frame/progress/pip 画布尺寸改用输出宽高；加 crop+text、crop+frame 两条 recipe 断言换算表达式。

- [ ] **B5 [P1/bug] 亮度预览 CSS 乘法 vs 导出 eq 加法，语义不同却未标 exact=false（计划 T3 点名项）**
  - 位置：`src/ui/services/videoEdit/preview.ts:39,44`、`compile.ts:302`
  - 证据：b=-0.4 预览暗部有层次、导出大面积死黑；inexact 列表含 gamma/temp/tint/…唯独不含 brightness。
  - 修法：最小改动——exact 判定加入 `brightness!==0`；或改导出为乘法语义（curves/colorlevels 实现 y=x·(1+b)）。

- [ ] **B6 [P1/bug] 打码（mosaic）预览框高度硬编码 20%，忽略 rect.h——隐私遮挡漏码风险**
  - 位置：`src/ui/components/VideoStudioModal.tsx:415`；对照高度滑块 `:1157`、导出 `compile.ts:342`
  - 修法：PreviewOverlay 增加 height 字段（preview.ts:70-73 透传 rect.h），mosaic 分支改 `height:\`${o.height*100}%\``；pip 分支同理用 rect.h 替代硬编码 aspectRatio。

- [ ] **B7 [P1/bug] baseW/baseH 以 16×9 占位、只靠 loadedmetadata 修正：HEVC 等浏览器不能解码的源导出叠加层缩成几像素**
  - 位置：`src/ui/components/VideoStudioModal.tsx:167,176-177,285-288`
  - 证据：导出 ready 门槛只等 probeDuration 与 metadata 无依赖；预览黑屏但探测成功时 baseW 恒 16 → renderTextPng 画布 ≈13px、pip ≈2px，无任何报错。
  - 修法：宽高不依赖 `<video>`——ensureFfmpeg 后与 probeDuration 一并用 ffmpeg 探测分辨率再置 ready；或 exportStack 前校验 baseW>100 否则阻断提示。

- [ ] **B8 [P2/bug] boomerang 与 trim/变速组合产生悬空音频输出标签，主变体 filtergraph 非法，全靠失败重试兜底**
  - 位置：`src/ui/services/videoEdit/compile.ts:190-199`（g.a=null 前不清理已产出的 [ta0]/[ca]/atempo 链标签）
  - 证据：hasAudio 源+trim+boomerang → 变体① 必编译失败（Output pad not connected），靠变体②出片；测试用例 speed-boomerang 恰无 trim/rate 绕开缺陷。
  - 修法：boomerang 置空前若 g.a≠'0:a' 追加 `anullsink`（或 Graph 记录音频语句整体剔除）；recipes 补 trim+boomerang+hasAudio、rate2x+boomerang+hasAudio 两条。

- [ ] **B9 [P2/bug] 退化梯度把「滤镜缺失」与「无音轨」混为一谈：任一视频滤镜不可用即静默丢整条音轨并全量降级**
  - 位置：`src/ui/services/videoEdit/run.ts:69-74`
  - 证据：变体只有 ①hasAudio ②无音 ③无音+broadFallback，缺「hasAudio+fallbacks」；旧 ffmpeg 缺 colortemperature → 用户拿到被静音+全量降级的成片，除成功 toast 外零提示。LUT 路径失效同理。
  - 修法：梯度改为 {audio}→{audio+fallbacks}→{无音}→{无音+fallbacks}；更优：解析 stderr 的 `No such filter: 'xxx'` 精准 fallback 后重编译；任何降级都 toast 告知。

- [ ] **B10 [P2/debt] glitch 的 rgbashift→chromashift 退化名存实亡：两滤镜同版本同源文件引入，旧 ffmpeg 必然一起缺失**
  - 位置：`src/ui/services/videoEdit/compile.ts:270-274`
  - 修法：退化改用老滤镜可表达的近似（split+overlay 通道错位或 lutrgb+blend），或退化时跳过 glitch 并 toast「当前 ffmpeg 不支持故障特效」；recipes 补 `fallbacks:['rgbashift']` 用例。

- [ ] **B11 [P2/bug] commitLive 无条件压历史：点击滑块不拖也产生重复 undo 步；history 无上限**
  - 位置：`src/ui/store/studioStore.ts:140-143`；触发点 `VideoStudioModal.tsx:103-104`（onPointerUp+onKeyUp 都挂 onCommit）
  - 修法：commitLive 先比较 stack 与 history[cursor]（或 liveDirty 标志），相同跳过；history 设上限（如 100）。补 store 级单测：updateOpLive×N+commitLive 后 undo 一步回到拖拽前（正是计划 WS1-T4 要求、至今缺失的测试）。

- [ ] **B12 [P1/incomplete] 测试矩阵补齐：多行缺失、快照曾锁定已知 bug、集成脚本只跑 25 条中的 1 条**（放批次末，B1-B11 修完后做）
  - 位置：`test/videoEdit/recipes.json`、`run-export.mjs:32`
  - 缺口清单：①kenBurns+mirror（依赖 D3 决策）②bitrate ABR（依赖 D5 决策）③needsNormalize/baseRotation 断言（依赖 D4）④stackIsNoop=真导出原样 ⑤gif/webp/webm/mp4 各补一条**带 overlay** ⑥退化键 tmix/minterpolate/rgbashift/lut3d 各一条 fallback 用例；时间窗用例 expect 升级为具体 between(...) 数值（B1 已做则核对）。
  - 修法：run-export.mjs 改为遍历全部 recipe（fixtures 按 README 的 testsrc 命令现场合成，补 VFR 源）断言 exit=0 + ffprobe 时长/分辨率/流数；快照数 ≥35。

## 批次 C · 画布与任务交互（信任感）

- [ ] **C1 [P1/bug] resize/重命名/便签文本等 updateCard 路径全部漏入 undo 栈；无历史操作不清 future 导致 redo 覆盖新改动**
  - 位置：`src/ui/store/graphStore.ts:406-439`；入口 `CardView.tsx:215`、`GroupView.tsx:79,96,147`、`CardView.tsx:271`
  - 证据：resize 后 Cmd+Z 不回退尺寸反而回退更早操作；undo 后做一次 resize 再 redo，旧快照整体覆盖 cards 静默丢掉刚做的修改。对照：addCard/removeCards/paste/拖动均正确入栈。
  - 修法：resize 在首次越过阈值时 pushHistory 一次（中间态照走 updateCard）；重命名/便签 blur 提交且有变时 push；折叠/换色各 push；或给 updateCard 加 options.history 由调用方声明，保证所有改 cards 的入口要么入栈要么明确豁免（fitAspect、生成进度）。
  - 验证：补 graphStore 单测：resize→undo 回到原尺寸；undo→resize→redo 不覆盖。

- [ ] **C2 [P1/bug] 弹窗打开时画布快捷键仍生效：作品库/工程库下按 Delete 静默删卡**
  - 位置：`src/ui/canvas/CanvasStage.tsx:501`（只豁免 studioCardId）
  - 修法：keydown 入口统一判断「任意模态开着」（showGallery/showProjectLibrary/showProviderSettings/showTemplates/dialogStore.current…或模态计数器）即 return。

- [ ] **C3 [P1/incomplete] 复制/粘贴/Ctrl+D 不携带组成员与连线：复制分组得到空组框**
  - 位置：`src/ui/store/graphStore.ts:601-629`；对照拖动路径的递归收集 `CanvasStage.tsx:269-272`
  - 修法：copySelection 按 parentId 递归收集选中组全部后代；paste 仿 insertTemplate（graphStore.ts:390-399）用 idMap 重映射并复制两端都在剪贴板内的 edges。
  - 验证：编组 5 卡→复制→粘贴，成员+内部连线齐全。

- [ ] **C4 [P1/bug] 生成取消不贯穿：requestId 未到达 / images.edit / TTS 三条路径点停止后照跑，卡片几十秒后「复活」成 done**
  - 位置：`src/ui/services/generate.ts:335-359`（stopCard）、`aiText.ts:44-47`、`aiImage.ts:121-142`、`engine.ts:280-298`
  - 修法：每次生成分配 runId（cardId→runId map），stopCard 使其失效；**所有成功写回前校验 runId 仍有效**，无效则丢弃结果不写卡；images.edit/runTts 至少做到「结果作废」级取消。

- [ ] **C5 [P2/bug] 同一卡片可并发重复生成：generateCard 无 running/queued 守卫，取消器互相覆盖**
  - 位置：`src/ui/services/generate.ts:86`；未设防入口 `MediaToolbox.tsx:38`、`NodeEditor.tsx:143`
  - 修法：入口加守卫（running/queued 时 return，或语义化为先 stopCard 再重跑）；aborters/videoAborts 值带 runId，finally 仅在自己的 runId 在位时删除。先决：C4（共用 runId 机制）。

- [ ] **C6 [P2/bug] 全库无 IME isComposing 防护：中文组合期 Enter/Esc 误提交/误关闭**
  - 位置：`GroupView.tsx:149-151`、`DialogHost.tsx:48`、`hooks.ts:9`（useEscClose）
  - 修法：这些 onKeyDown 开头加 `if (e.nativeEvent.isComposing || e.keyCode === 229) return`；useEscClose 的 window 监听同样检查。

- [ ] **C7 [P2/bug] ESC 无模态层级管理：多层弹窗一键同关；Modal 无焦点 trap/焦点恢复**
  - 位置：`src/ui/components/Modal.tsx:20-26`、`hooks.ts:8-12`；连带 `CanvasStage.tsx:543` 的 Escape clearSelection 同帧执行
  - 修法：引入模态栈（zustand 记录打开顺序），ESC 只关栈顶；Modal 挂载时 focus 容器、卸载还焦到 opener。与 C2 的「模态计数器」共用一套状态。先决：C2。

- [ ] **C8 [P2/bug] 三处指针交互收尾不完备：pointercancel/源卡卸载时 window 监听与临时状态残留**
  - 位置：`GroupView.tsx:71-113`、`MultiConnectHandle.tsx:66-67`、`CardView.tsx:158-198`（startConnect cleanup 全绑在 handle 元素上）
  - 修法：复制同文件 startCardResize 已有的 setPointerCapture+四事件收尾模式；startConnect 的兜底监听放 window 或在 unmount cleanup 调用。

- [ ] **C9 [P2/bug] createConnectedNode 绕过 canConnect：便签可连出永远无效的僵尸边**
  - 位置：`src/ui/store/graphStore.ts:565-589`、`MultiConnectHandle.tsx:22`（过滤漏 note）
  - 修法：createConnectedNode 建边前逐 source 过 canConnect；MultiConnectHandle 过滤补 `c.kind !== 'note'`。

- [ ] **C10 [P2/incomplete] 标注不入 undo 栈也无清空确认，注释却写「即可逆操作」**
  - 位置：`src/ui/store/graphStore.ts:536-539`、`AnnotationToolbar.tsx:49`
  - 修法：最低成本 clearAnnotations 前加 confirmDialog；更完整则 BoardSnap 增加 annotations 并让增删清都 pushHistory，修正注释。

- [ ] **C11 [P2/debt] 切换/新建画布 Tab 即清空撤销栈，无提示**
  - 位置：`src/ui/store/graphStore.ts:236-246`
  - 证据：历史快照本身带 boardId（undo 还会跳回对应画布），清空并非结构必需。
  - 修法：按 boardId 维护多份历史栈（改动集中在 push/undo/redo 取栈），或至少切换不清空。先决：C1（undo 语义先修对）。

- [ ] **C12 [P2/bug] 任务中心三处脱节：只列活动画布（与顶栏全局计数、跨画布续跑矛盾）；「定位」只改选中不移视口不切画布**
  - 位置：`src/ui/components/TaskCenter.tsx:17,48-56`；对照 `TopBar.tsx:19`、`generate.ts:305-320`、Gallery.focus（`Gallery.tsx:31-43`）
  - 修法：改为扫描 project.boards 全部卡片，行内标注画布名；jump 复用 Gallery.focus 逻辑（setActiveBoard→setViewport 居中→选中）。

- [ ] **C13 [P2/bug] Provider 密钥保存静默吞错：setKey 失败也 toast「已保存」，且误操作工程保存指示器**
  - 位置：`src/ui/components/ProviderSettings.tsx:81-87`、`providerStore.ts:92-98`
  - 修法：await setKey 并对失败给出明确错误 toast；删除误写的 `setSaving(false)`。

- [ ] **C14 [P2/bug] 删除 Provider 无确认：单击即删配置并销毁加密密钥**
  - 位置：`src/ui/components/ProviderSettings.tsx:281-288`
  - 修法：confirmDialog（danger 样式），文案说明「将同时删除已保存的 API Key，不可恢复」。

- [ ] **C15 [P2/bug] pollTaskTemplate 不识别完成态：videoUrlPath 配错时任务已成功却空转 10 分钟报「生成超时」**
  - 位置：`src/ui/services/providers/engine.ts:92-113`；对照默认轮询 `:138-142` 的快速失败
  - 修法：增加 doneValues 判定（`cfg.doneValues || 'completed,succeeded,success'`）：状态命中 done 但取不到 URL 时立即抛「已完成但未找到结果 URL（检查 videoUrlPath）」。

- [ ] **C16 [P2/bug] 作品库收录规则偏差：生成中的流式预览图被当成品收录；音频/TTS 成品被排除**
  - 位置：`src/ui/components/Gallery.tsx:24`；对照 `generate.ts:148`（流式把 preview dataURL 写 assetUrl）
  - 修法：过滤条件加 status==='done'；audio 卡纳入收录（波形占位图渲染）。

- [ ] **C17 [P2/bug] 作品库「双击预览」不可达：单击 focus() 即 close()，dblclick 永不触发**
  - 位置：`src/ui/components/Gallery.tsx:42,54-57`
  - 修法：预览改独立入口（缩略图角上放大按钮），或单击仅选中+「定位」按钮。

## 批次 D · 功能缺口补完

- [ ] **D1 [P1/incomplete] 画布 Tab 无法重命名/删除：store 的 renameBoard/removeBoard 已实现但全 UI 零调用**
  - 位置：`src/ui/components/TopBar.tsx:51-70`；`graphStore.ts:247,251`
  - 修法：Tab 加右键菜单/双击重命名（promptDialog 现成）+ 删除项（confirmDialog+removeBoard），成本极低。

- [ ] **D2 [P1/incomplete] FFmpeg 首次下载无进度反馈（README 承诺「带进度提示」）**
  - 位置：`src/ui/services/mediaVideo.ts:20-21`（进度回调是空函数，toast ~4.7s 即消失）
  - 修法：download 进度回调更新常驻 toast 或任务中心条目（「FFmpeg 下载中 42%」），完成/失败替换终态提示。

- [ ] **D3 [P2/incomplete] Ken-Burns 全链路未实现：类型/预览分支/计划用例都在，编译器与 UI 均空——实现或删除，二选一**
  - 位置：`types.ts:51-58,69`、`preview.ts:60`、`compile.ts:213-277`（applyTransform 不读）
  - 修法：实现（zoompan 或 scale+crop 表达式随 t 插值，注意与 mirror/crop 顺序）+UI 入口 + recipe；或删字段并在计划文档标注放弃。不要留在「有类型无实现」状态。

- [ ] **D4 [P2/incomplete] needsNormalize/baseRotation 是死字段：VFR/竖屏 rotation 预检（计划风险面 4）完全未做**
  - 位置：`types.ts:183-184`、`studioStore.ts:103`、`VideoStudioModal.tsx:167`（恒传 undefined）
  - 修法：最小闭环——打开工作台时经 probeDuration 通道扩展探测 VFR/透明 webm，置 needsNormalize 并在编译首段插 fps=30/format 归一；或删两字段与透传，避免误导维护者。决策后同步 B12 的用例。

- [ ] **D5 [P2/debt] 剪辑死代码组：stackIsNoop 零调用（空栈也整片重编码）、bitrate/anim/op.label 无实现、单例 op 上移下移无效、run.ts void produced**
  - 位置：`types.ts:211-213,151,114,162,11`、`studioStore.ts:222`、`VideoStudioModal.tsx:349-353`、`run.ts:55`
  - 修法：exportStack 开头判 stackIsNoop 直接复制源文件为新卡；bitrate/anim/label 删除或补齐；moveOp 箭头仅对 overlay 渲染；清 void produced。涉及 B12 用例 ④②。

- [ ] **D6 [P2/incomplete] 新手引导「打开模板」指向必然为空的模板库（无内置模板）**
  - 位置：`CanvasStage.tsx:628`、`templates.ts:8-15`、`TemplatePanel.tsx:50`
  - 修法：内置 2-3 个演示模板（文生图基础链/图生视频链/分镜扇出，纯结构无产物，用现有 GroupTemplate 格式硬编码），listTemplates 合并展示。

- [ ] **D7 [P2/incomplete] 工程导出 JSON 不含媒体：跨机迁移后全部裂图**
  - 位置：`src/ui/store/projectStore.ts:241`
  - 修法：「导出含媒体」选项——host-worker 把 JSON+media 目录打 zip；至少导入时把缺媒体的卡片标注出来 + README 说明仅同机可恢复。

- [ ] **D8 [P2/optimization] 无卡片搜索/按标题定位**
  - 位置：确认不存在（全 src/ui 无过滤逻辑）；跳转所需 Gallery.focus 已有
  - 修法：顶栏或作品库加搜索框，按 title/prompt/text 过滤全工程卡片，点击复用 focus 跳转。

- [ ] **D9 [P2/optimization] 无批量导出：多选后只能逐卡另存**
  - 位置：`ContextMenu.tsx:187`（cards.length===1 才显示导出）、NodeEditor 单卡下载
  - 修法：多选时 ContextMenu/BatchActions 加「导出所选（N）」：一次选目录，循环 filesystem.copy，文件名 title+序号。

## 批次 E · 性能优化（大画布体验）

- [ ] **E1 [P1/optimization] 索引冻结不覆盖 resize：缩放卡片/分组时每个 pointermove 触发 O(N) 全量重建，且无 rAF 合帧**
  - 位置：`CanvasStage.tsx:73`（frozen 条件）、`CardView.tsx:208-216`、`GroupView.tsx:74-79`；对照拖动的 dragAcc `CanvasStage.tsx:231-233`
  - 修法：resize 走 rAF 合帧（仿 dragAcc）；冻结条件扩展为「任何连续交互」（resize 开始设 ref 标志，结束 commitTick++ 重建一次，与拖动同构）。

- [ ] **E2 [P2/optimization] 拖动吸附每帧全量扫描所有卡片（含屏幕外），未用空间索引**
  - 位置：`src/ui/canvas/snapping.ts:23`
  - 修法：候选先用 cardIndex.query(视口外扩吸附阈值) 取可见集再比较；顺带消除「吸附到看不见的卡」的怪异手感。

- [ ] **E3 [P2/optimization] GroupView 未 memo；折叠组渲染函数内调用 O(N) allDescendants()，每个平移帧全量重跑**
  - 位置：`GroupView.tsx:20,162`；对照 `CardView.tsx:486` 的 memo
  - 修法：`memo(GroupViewImpl)`；后代计数 useMemo 依赖 cards，或由 CanvasStage 算 hiddenMembers 时顺带产出传入。

- [ ] **E4 [P2/optimization] Minimap 视口一出内容包围盒即每帧 O(N) canvas 全量重绘（与注释承诺相反）**
  - 位置：`src/ui/canvas/Minimap.tsx:24-33,43,60`
  - 修法：边界只用卡片包围盒（视口指示框裁剪到边缘），或对 minX/scale 量化取整减少依赖抖动。

- [ ] **E5 [P2/optimization] 媒体卡无缩略图：可见图片卡全分辨率解码（100 张 4K ≈ 数 GB 位图），视频卡逐个挂 &lt;video&gt; 强制首帧解码**
  - 位置：`CardView.tsx:367-373,68-77`；LOD 仅 >200 卡且 zoom<0.4 生效（`CanvasStage.tsx:65-66`）
  - 修法：导入/生成完成时用 sharp/canvas 生成 ~2x 卡片尺寸缩略图存 meta.thumbUrl，卡片渲染 thumb、预览/编辑才用原图；视频卡默认渲染 poster（captureFrame 已有），点击播放才挂 video。

- [ ] **E6 [P2/optimization] 视频任务在共享并发池内挂满整个轮询周期（默认 4 并发、poll 上限 600s），长视频饿死文/图队列**
  - 位置：`src/ui/services/generate.ts:117-264`
  - 修法：视频拆两段——submit 在 aiLimiter 内、拿到 taskId 即释放槽位，poll 循环放池外（resumeVideoCard 已天然在池外，行为对齐即可）。

## 批次 F · 技术债 / 文档 / 工程配置

- [ ] **F1 [debt] WS1-T5：VideoStudioModal.tsx 76KB → 按功能面板拆分子组件（目标 <40KB，纯机械移动不改行为）**
  - 前置：批次 B 完成后做（快照守护拆分）。三次 UI 范式迭代的死代码/死样式一并清理。

- [ ] **F2 [debt] WS3-T1 收尾：panoOutpaint.ts 的 eqToPersp/perspToEqPaste/planPanoViews 三个 export 已无外部消费者；文件头注释仍是过期的「渐进式 outpaint 第 1 步」**
  - 位置：`src/ui/services/panoOutpaint.ts`（repairEquirectPoles 被 MediaToolbox 使用，保留）
  - 修法：去掉三个死 export（改内部函数），重写文件头注释说明现状（工具函数服务于极点修复），或把保留函数并入 mediaPano.ts 后删文件。

- [ ] **F3 [debt] exportFile RPC 是死代码，却暴露「任意绝对路径+任意内容」写盘接口——直接删除**
  - 位置：`src/main.ts:192`（UI 导出实际走 saveLocal.ts 的 dialog+copy）

- [ ] **F4 [debt] UI 侧约 20 个文件用 (window as any).mulby 绕过 1846 行 d.ts 类型：typecheck 对宿主 API 调用面形同虚设**
  - 位置：`src/ui/hooks/useMulby.ts:10`、`media.ts:4-9`、`mediaVideo.ts:4`、`engine.ts:6` 等
  - 修法：d.ts 已声明 Window.mulby——useMulby 返回 `MulbyAPI | null`，各 helper 去掉 `: any`，一次性改动后跑 typecheck 清理暴露的问题。

- [ ] **F5 [debt] manifest 声明 clipboard 权限但全代码零使用（权限面板向用户展示用不到的能力）**
  - 位置：`manifest.json:13`。修法：删除 `"clipboard": true`，保留 notification。

- [ ] **F6 [incomplete] manifest features exts 与实际支持不一致：缺 .gif/.aac/.opus（自家「转 GIF」产物拖回 Mulby 都不触发本插件）**
  - 位置：`manifest.json:35-36`；对照 `importMedia.ts:15-18`
  - 修法：files cmd 增补 ".gif",".aac",".opus"，img cmd 增补 ".gif"；或反向收敛 importMedia 格式表，两边单一事实源。

- [ ] **F7 [debt] 版本号 0.1.0 历经 108 commit 从未 bump：商店更新检测（compareVersions>0）永远不推送更新**
  - 位置：`manifest.json:5`、package.json
  - 修法：直接升 0.3.0（manifest 与 package.json 同步）；建立「功能合入即 bump」约定；可在 scripts/validate-plugin.js 加 CI 检查（插件目录有变更但 version 未变则告警）。

- [ ] **F8 [incomplete] test/ 不在任何 tsconfig 覆盖内：esbuild 直出不做类型检查，测试床可信度打折**
  - 位置：`tsconfig.json:19`
  - 修法：tsconfig.json include 扩为 ["src","test"]（或独立 tsconfig.test.json + typecheck 脚本第三段）。

- [ ] **F9 [doc] README「开发」一节的 dev/pack 命令依赖未声明未安装的 mulby CLI，按文档执行必失败**
  - 位置：`README.md:81-90`；CLI 实际在同工作区 mulby/packages/mulby-cli
  - 修法：README 补 CLI 获取方式，或 devDependencies 以 workspace 协议声明使 dev/pack 开箱可跑。

- [ ] **F10 [doc] README 快捷键表失实：「L」键无绑定；「Ctrl+D 原位复制」实为偏移粘贴；Ctrl+G/Esc/加选/双击进局部编辑已实现未收录**
  - 位置：`README.md:55`；对照 `CanvasStage.tsx:500-545`

- [ ] **F11 [doc] README 功能清单大幅落后：工程库/任务中心/作品库/3D 导演台/标注/分镜/局部重绘/对齐分布均未提及**
  - 位置：`README.md:25-40`；对照 `App.tsx:127-142`

- [ ] **F12 [doc] main.ts 头注宣称「密钥不进页面」与实现不符（明文 key 读入渲染进程拼 Authorization）**
  - 位置：`src/main.ts:4`；`providerStore.ts:100-106`、`engine.ts:201,258`
  - 修法：修正注释；（可选长期项）把带密钥的 submit/poll 移到 host worker（uploadImageToHost/synthSpeech 已是此模式）。

- [ ] **F13 [optimization] synthSpeech 返回值冗余携带整段音频 base64（调用方只用 path/mime），长音频 IPC 负载翻倍**
  - 位置：`src/main.ts:185`；调用方 `engine.ts:296-298`
  - 修法：返回值去掉 base64 字段，只留 { ok, path, mime }。

---

## 不进本循环的大项（单独立项，不要在 /loop 单轮里做）

| 项 | 原因 |
|---|---|
| WS3-T2/T3/T4：360 专用模型三场景实测、接缝修复适配、PanoViewer 非 2:1 容错/大图内存 | 依赖真实外部 Provider 与人工看图验证，无法纯代码闭环；PanoViewer 容错部分（宽高比检测+超大图降采样+meta.pano 缺失引导）可拆成独立代码项后补入 D 批次 |
| WS4-T1~T4：两套时间线收敛（送工作台精修/回填替换/timelineRecipe 持久化/职责文案） | 架构级打通，见 `2026-07-stabilization-and-convergence-plan.md` §WS4，应作为独立里程碑推进 |

## 附录 · 对抗核实中被驳回的发现（勿再重复上报）

1. ~~工程加载/导入无数值校验（zoom≤0 → NaN）~~——migrateProject 实际调用 sanitize 链路有校验。
2. ~~engine 报错显示 [object Object]~~——mulby.http 的 data 永远是原始字符串，前提不成立。
3. ~~clearRecovery 与恢复快照写入竞态丢编辑~~——serializeIo 串行化排除了该时序。
4. ~~零图像模型时报错指错方向~~——实际报错文案与流程可达性与声称不符。
5. ~~导出失败静默 no-op~~——导出按钮被 assetLocalPath 条件渲染包裹，场景不可达。
