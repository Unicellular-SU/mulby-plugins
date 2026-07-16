# AI 创意画布 · 全面审查修复清单（2026-07-13）

> 来源：多智能体六维度深度审查（计划完成度 / 画布引擎 / 剪辑引擎 / 服务层 / 宿主后端 / 产品体验），
> 每条 bug 类发现均经独立对抗核实确认（5 条误报已剔除，见文末附录）。
> 基线：commit `dd59c3c`；typecheck / 25 条 compile 快照 / 4 条引用测试 / 完整构建全绿。
> 行号为审查时点快照，修复过程中会漂移——**动手前先用 grep 定位确认**。

**进度：46/65**（☐ 待办 · ☑ 完成 · ☒ 决定不修 · ~ 部分完成）——批次 A 全清；B1-B11 全清；**批次 C/D 全清**；B12 部分完成（D 决策已定：删除，待回填测试）；B4 拆出 B4b，总数 +1

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

- [x] **B4 [P1/bug] crop/改画幅后 overlay 坐标基不一致：预览按整帧、导出按裁剪后画面；frame/progress/pip 尺寸按原始 baseW 渲染**（✓ 2026-07-13 做**短期诚实角标**：preview.ts 在「有 overlay 且存在 crop 或 outW/outH」时置 exact=false，挂「近似预览·导出更准」角标——消除静默失真（严重度主因，用户此前毫不知情）。精确门控：纯 crop 无叠加时预览内容一致，不过度告警。typecheck+UI 构建+29 测试全绿。**中期坐标换算拆为 B4b 独立跟踪**）
  - 位置：`src/ui/services/videoEdit/compile.ts:469-471,335-336,391`、`preview.ts:51-60`（inexact 列表不含 crop）、`mediaOverlay.ts:87-119`

- [ ] **B4b [P1/bug]（B4 拆出·中期）crop/改画幅后 overlay 坐标真实换算，让导出与预览对齐（而非仅角标提示）**
  - 位置：同 B4
  - 前置决策：预览侧 crop 是「整帧+遮罩」还是「只显示裁剪帧」？定了才能决定换算方向。若保持整帧预览：编译时把 overlay 坐标从原始帧归一换算到裁剪后帧（x'=(x-crop.x)/crop.w、y'=(y-crop.y)/crop.h），frame/progress/pip 画布尺寸改用裁剪/适配后输出宽高。
  - 验证：加 crop+text、crop+frame 两条 recipe 断言换算后的 overlay x 表达式；换算生效后可回收 B4 的 exact=false（预览与导出一致则不再需要角标）。

- [x] **B5 [P1/bug] 亮度预览 CSS 乘法 vs 导出 eq 加法，语义不同却未标 exact=false（计划 T3 点名项）**（✓ 2026-07-13 preview.ts inexact 条件补 `color.brightness`：只调亮度时也置 exact=false 挂角标（b=0 不告警）。与 B4 同策略选诚实角标——「改导出为乘法语义（curves/colorlevels）」需真跑 ffmpeg 视觉验证且改变所有存量用户出图，风险大，未取（角标已消除『声称精确』的失真主因）。typecheck+UI 构建+29 测试全绿）
  - 位置：`src/ui/services/videoEdit/preview.ts:39,44`、`compile.ts:302`
  - 证据：b=-0.4 预览暗部有层次、导出大面积死黑；inexact 列表含 gamma/temp/tint/…唯独不含 brightness。
  - 修法：最小改动——exact 判定加入 `brightness!==0`；或改导出为乘法语义（curves/colorlevels 实现 y=x·(1+b)）。

- [x] **B6 [P1/bug] 打码（mosaic）预览框高度硬编码 20%，忽略 rect.h——隐私遮挡漏码风险**（✓ 2026-07-13 PreviewOverlay 加 height 字段并透传 rect.h；mosaic 预览框 `height:'20%'`→`${o.height*100}%`，与导出 crop `h='ih*rect.h'`（compile.ts:377）对齐——消除漏码风险。pip 分支保持 aspectRatio:16/9 不动：导出 pip 用 `scale=pipW:-2` 自动高度、不读 rect.h，改用 rect.h 反而误导，且 pip 已标 exact=false。typecheck+UI 构建+29 测试全绿）
  - 位置：`src/ui/components/VideoStudioModal.tsx:415`；对照高度滑块 `:1157`、导出 `compile.ts:342`
  - 修法：PreviewOverlay 增加 height 字段（preview.ts:70-73 透传 rect.h），mosaic 分支改 `height:\`${o.height*100}%\``；pip 分支同理用 rect.h 替代硬编码 aspectRatio。

- [x] **B7 [P1/bug] baseW/baseH 以 16×9 占位、只靠 loadedmetadata 修正：HEVC 等浏览器不能解码的源导出叠加层缩成几像素**（✓ 2026-07-13 mediaVideo.ts 新增 probeResolution：宿主无 ffprobe，改用 frameAt 抽首帧 PNG → sharp.metadata() 读真实宽高（绕开浏览器解码），临时帧 finally unlink。VideoStudioModal open 里在 setReady 前调用并 setBase({baseW,baseH})，探测失败退回 onLoadedMetadata 路径。probeDuration 本就整片解码一遍，多抽一帧开销可忽略。typecheck+UI 构建+29 测试全绿。选 probe 而非「exportStack 前校验 baseW>100 阻断」——后者只拦截不修复，probe 是根治）
  - 位置：`src/ui/components/VideoStudioModal.tsx:167,176-177,285-288`
  - 证据：导出 ready 门槛只等 probeDuration 与 metadata 无依赖；预览黑屏但探测成功时 baseW 恒 16 → renderTextPng 画布 ≈13px、pip ≈2px，无任何报错。
  - 修法：宽高不依赖 `<video>`——ensureFfmpeg 后与 probeDuration 一并用 ffmpeg 探测分辨率再置 ready；或 exportStack 前校验 baseW>100 否则阻断提示。

- [x] **B8 [P2/bug] boomerang 与 trim/变速组合产生悬空音频输出标签，主变体 filtergraph 非法，全靠失败重试兜底**（✓ 2026-07-14 applyTimeEffects boomerang 分支置 g.a=null 前，若 g.a 是滤镜输出（≠原始 `0:a` 输入）先 `[label]anullsink` 消费，消除悬空报错。现有 speed-boomerang(rate=1 无 trim) g.a 仍为 `0:a`→不加 sink，快照不变。新增 recipe `trim-boomerang-hasaudio-nosink`（[ta0]anullsink）+`speed2x-boomerang-hasaudio-nosink`（[a1]anullsink）断言 anullsink 存在且 -an，28 recipe 全绿）
  - 位置：`src/ui/services/videoEdit/compile.ts:190-199`（g.a=null 前不清理已产出的 [ta0]/[ca]/atempo 链标签）
  - 证据：hasAudio 源+trim+boomerang → 变体① 必编译失败（Output pad not connected），靠变体②出片；测试用例 speed-boomerang 恰无 trim/rate 绕开缺陷。
  - 修法：boomerang 置空前若 g.a≠'0:a' 追加 `anullsink`（或 Graph 记录音频语句整体剔除）；recipes 补 trim+boomerang+hasAudio、rate2x+boomerang+hasAudio 两条。

- [x] **B9 [P2/bug] 退化梯度把「滤镜缺失」与「无音轨」混为一谈：任一视频滤镜不可用即静默丢整条音轨并全量降级**（✓ 2026-07-14 run.ts exportStudio 梯度重排为「先保音轨、后丢音轨」：①有音轨 ②有音轨+滤镜退化（新增）③无音轨 ④无音轨+滤镜退化——旧 FFmpeg 缺 colortemperature 时变体②即可保音轨出片，不再无谓静音。非首选变体成功 toast('warning') 告知具体降级了什么（音轨保留/无声/近似滤镜），消除静默降级。「解析 stderr 的 No such filter 精准 fallback」未取——宿主 ffmpeg.run 只暴露 onProgress 无 stderr/日志，无法实现。typecheck+UI 构建+28 recipe 全绿）
  - 位置：`src/ui/services/videoEdit/run.ts:69-74`
  - 证据：变体只有 ①hasAudio ②无音 ③无音+broadFallback，缺「hasAudio+fallbacks」；旧 ffmpeg 缺 colortemperature → 用户拿到被静音+全量降级的成片，除成功 toast 外零提示。LUT 路径失效同理。
  - 修法：梯度改为 {audio}→{audio+fallbacks}→{无音}→{无音+fallbacks}；更优：解析 stderr 的 `No such filter: 'xxx'` 精准 fallback 后重编译；任何降级都 toast 告知。

- [x] **B10 [P2/debt] glitch 的 rgbashift→chromashift 退化名存实亡：两滤镜同版本同源文件引入，旧 ffmpeg 必然一起缺失**（✓ 2026-07-14 退化路径改为直接跳过 glitch（`!fb.has('rgbashift')` 时才发 rgbashift，否则不发任何滤镜）——rgbashift/chromashift 均 FFmpeg 4.1 同文件引入，退化到 chromashift 无意义。用户失去故障特效但导出不再失败，B9 的退化 toast 已告知「部分特效不可用」。「geq 等老滤镜近似」未取——无法在此跑 ffmpeg 验证，写错会让 fallback 变体也失败致导出彻底挂，风险大于收益。新增 recipe `glitch-fallback-rgbashift-skip`（fallbacks:['rgbashift']）断言 filterNotContains rgbashift+chromashift；既有非退化 glitch recipe 快照不变。29 recipe 全绿）
  - 位置：`src/ui/services/videoEdit/compile.ts:270-274`
  - 修法：退化改用老滤镜可表达的近似（split+overlay 通道错位或 lutrgb+blend），或退化时跳过 glitch 并 toast「当前 ffmpeg 不支持故障特效」；recipes 补 `fallbacks:['rgbashift']` 用例。

- [x] **B11 [P2/bug] commitLive 无条件压历史：点击滑块不拖也产生重复 undo 步；history 无上限**（✓ 2026-07-14 commitLive 先 JSON.stringify 比较 stack 与 history[cursor]，相同则跳过（点击滑块/Tab 路过 keyup 触发但未改值不再压重复步）；commit 加 HISTORY_MAX=100 上限，超出从头丢最旧、cursor 恒指末项。**补齐计划 WS1-T4 缺失的 studioStore 单测**：新建 test/store/studioStore.test.ts（脱 React 驱动 zustand），3 用例——拖拽×N+commitLive 后 undo 一步回到拖拽前、点击未改值不压重复步、history 上限 100 且 canUndo；接入 package.json test:studio。typecheck+全套件(29 compile+4 refs+3 studio)+UI 构建全绿）
  - 位置：`src/ui/store/studioStore.ts:140-143`；触发点 `VideoStudioModal.tsx:103-104`（onPointerUp+onKeyUp 都挂 onCommit）
  - 修法：commitLive 先比较 stack 与 history[cursor]（或 liveDirty 标志），相同跳过；history 设上限（如 100）。补 store 级单测：updateOpLive×N+commitLive 后 undo 一步回到拖拽前（正是计划 WS1-T4 要求、至今缺失的测试）。

- [~] **B12 [P1/incomplete] 测试矩阵补齐：多行缺失、快照曾锁定已知 bug、集成脚本只跑 25 条中的 1 条**（部分完成，D 依赖项待回填——不勾选）
  - 位置：`test/videoEdit/recipes.json`、`run-export.mjs:32`
  - 缺口清单：①kenBurns+mirror（依赖 D3 决策）②bitrate ABR（依赖 D5 决策）③needsNormalize/baseRotation 断言（依赖 D4）④stackIsNoop=真导出原样（依赖 D5）⑤gif/webp/webm/mp4 各补一条**带 overlay** ⑥退化键 tmix/minterpolate/rgbashift/lut3d 各一条 fallback 用例；时间窗用例 expect 升级为具体 between(...) 数值（B1 已做则核对）。
  - **✓ 2026-07-14 已做（不依赖 D 的部分）**：⑥补齐 fallback recipe `fallback-minterpolate-skip`(smoothSlowmo→NotContains minterpolate)、`fallback-tmix-to-tblend`(motionTrail→tblend、NotContains tmix)、`fallback-lut3d-skip`(lutPath→NotContains lut3d)（rgbashift 在 B10、colortemperature/denoise/sidechain 在 export-webm-fallback 已覆盖）；⑤补 `gif-with-text-overlay`(passCount=2+overlay+palettegen)。时间窗数值断言 B1 已做。recipe 数 25→33。
  - **待回填（D 决策后）**：①kenBurns ②bitrate ③needsNormalize/baseRotation ④stackIsNoop 各自的用例；run-export.mjs 改为遍历全部 recipe（fixtures 按 README testsrc 现场合成 + 补 VFR 源）断言 exit=0 + ffprobe 时长/分辨率/流数。

## 批次 C · 画布与任务交互（信任感）

- [x] **C1 [P1/bug] resize/重命名/便签文本等 updateCard 路径全部漏入 undo 栈；无历史操作不清 future 导致 redo 覆盖新改动**（✓ 2026-07-14 采「调用方在离散编辑前 pushHistory」方案（与拖拽移动同构，非改 updateCard），7 处入口全补：CardView 卡片 resize(首帧 push)/便签文本 onBlur(有变才 push)/便签色；GroupView 组 resize(首帧 push，与结束时成员吸入/弹出合为一次撤销)/折叠/组色/重命名(重构为本地 draft+提交时一次 push，消除逐键写 store & 逐键触发 @ 传播)。pushHistory 清 future 顺带修好 redo 覆盖(新编辑后 future 清空→redo 不再用旧快照覆盖)。新增 test/store/graphStore.test.ts 2 用例（resize→undo 回原尺寸、undo→新编辑→redo 不覆盖）接入 test:graph。typecheck+UI 构建+全套件(33+4+3+2)全绿）
  - 位置：`src/ui/store/graphStore.ts:406-439`；入口 `CardView.tsx:215`、`GroupView.tsx:79,96,147`、`CardView.tsx:271`
  - 证据：resize 后 Cmd+Z 不回退尺寸反而回退更早操作；undo 后做一次 resize 再 redo，旧快照整体覆盖 cards 静默丢掉刚做的修改。对照：addCard/removeCards/paste/拖动均正确入栈。
  - 修法：resize 在首次越过阈值时 pushHistory 一次（中间态照走 updateCard）；重命名/便签 blur 提交且有变时 push；折叠/换色各 push；或给 updateCard 加 options.history 由调用方声明，保证所有改 cards 的入口要么入栈要么明确豁免（fitAspect、生成进度）。
  - 验证：补 graphStore 单测：resize→undo 回到原尺寸；undo→resize→redo 不覆盖。

- [x] **C2 [P1/bug] 弹窗打开时画布快捷键仍生效：作品库/工程库下按 Delete 静默删卡**（✓ 2026-07-14 uiStore 加统一 `anyModalOpen()`（覆盖全部 13 个全屏模态/预览来源：showProviderSettings/Compose/Timeline/Templates/TaskCenter/Gallery/ProjectLibrary/Director + studioCardId/storyboardCardId/maskCardId/trimCardId/panoCardId + preview lightbox），单点维护、新模态在此登记。CanvasStage keydown 入口从单一 studioCardId 豁免改为 `anyModalOpen() || useDialog.current` 全豁免。核实过所有模态可见性均源自 uiStore/dialogStore，枚举无遗漏。为 C7（模态栈/ESC 层级）预置了共用状态。typecheck+UI 构建+全套件全绿）
  - 位置：`src/ui/canvas/CanvasStage.tsx:501`（只豁免 studioCardId）
  - 修法：keydown 入口统一判断「任意模态开着」（showGallery/showProjectLibrary/showProviderSettings/showTemplates/dialogStore.current…或模态计数器）即 return。

- [x] **C3 [P1/incomplete] 复制/粘贴/Ctrl+D 不携带组成员与连线：复制分组得到空组框**（✓ 2026-07-14 clipboard 从 `Card[]` 改为 `{cards,edges}`；copySelection 用 getDescendants 递归展开选中组的全部后代、并收集两端都在选区内的连线；paste 用 idMap 重映射连线（uid('edge')）一并落盘，级联粘贴的 clipboard 也带重映射后的 edges。同步改 ContextMenu 的 `clipboard.length`→`clipboard.cards.length`。新增 graphStore 测试用例：编组(2卡+1连线)→只选组→复制粘贴，断言 +3 卡(非空框)且连线复制。typecheck+UI 构建+全套件(33+4+3+3)全绿）
  - 位置：`src/ui/store/graphStore.ts:601-629`；对照拖动路径的递归收集 `CanvasStage.tsx:269-272`
  - 修法：copySelection 按 parentId 递归收集选中组全部后代；paste 仿 insertTemplate（graphStore.ts:390-399）用 idMap 重映射并复制两端都在剪贴板内的 edges。
  - 验证：编组 5 卡→复制→粘贴，成员+内部连线齐全。

- [x] **C4 [P1/bug] 生成取消不贯穿：requestId 未到达 / images.edit / TTS 三条路径点停止后照跑，卡片几十秒后「复活」成 done**（✓ 2026-07-14 引入 runId 机制：generateCard 起跑分配 `runId=++runSeq` 存 `runIds<cardId,runId>`，生成体内所有卡片写入经 `commit(patch)`（仅当 `isCurrentRun` 才写）；图/视频/TTS 各在结果落盘前加 `if(!isCurrentRun) throw AbortError`（作废结果、不产孤儿媒体）。stopCard 首行 `runIds.delete(cardId)` 使当前 run 失效——三条无法真正中止底层的路径，其后续 done 写入全部落空，卡片停在 idle 不复活。catch 改用 commit 门控（不覆盖已停/新状态）；finally 仅在 isCurrentRun 时清 aborters/videoAborts/runIds（顺带利好 C5，避免误删新 run 的取消器）。typecheck+UI 构建+全套件全绿。为 C5 预置了 runId 基础）
  - 位置：`src/ui/services/generate.ts:335-359`（stopCard）、`aiText.ts:44-47`、`aiImage.ts:121-142`、`engine.ts:280-298`
  - 修法：每次生成分配 runId（cardId→runId map），stopCard 使其失效；**所有成功写回前校验 runId 仍有效**，无效则丢弃结果不写卡；images.edit/runTts 至少做到「结果作废」级取消。

- [x] **C5 [P2/bug] 同一卡片可并发重复生成：generateCard 无 running/queued 守卫，取消器互相覆盖**（✓ 2026-07-14 generateCard 入口加 `if (card0.status === 'running' || 'queued') return` 守卫，与 generateSelected 既有守卫一致——从源头阻止 MediaToolbox「重新生成」/NodeEditor direct 预设等未设防入口的并发重触发。C4 的 runId 机制已让 finally 按 isCurrentRun 守卫取消器清理（缓解交叉删除），本守卫杜绝并发发生。「重新生成」语义为先停止再重跑（当前 running 时忽略重复点击，符合既有 generateSelected 行为）。typecheck+UI 构建+全套件全绿）
  - 位置：`src/ui/services/generate.ts:86`；未设防入口 `MediaToolbox.tsx:38`、`NodeEditor.tsx:143`
  - 修法：入口加守卫（running/queued 时 return，或语义化为先 stopCard 再重跑）；aborters/videoAborts 值带 runId，finally 仅在自己的 runId 在位时删除。先决：C4（共用 runId 机制）。

- [x] **C6 [P2/bug] 全库无 IME isComposing 防护：中文组合期 Enter/Esc 误提交/误关闭**（✓ 2026-07-14 util.ts 新增 `isImeComposing(e)`（兼容 React 合成事件的 nativeEvent.isComposing 与原生 window 事件的 isComposing，含 keyCode===229 旧浏览器兜底），6 处统一加防护：GroupView 组重命名、DirectorStage 对象重命名、DialogHost prompt 提交、NodeEditor Ctrl+Enter 生成的 onKeyDown 开头 return；useEscClose 与共享 Modal 的 window Escape 监听加 `&& !isImeComposing(e)`。审查点名 3 处，实查补足到 6 处（含 Modal shell 的 Esc、NodeEditor、DirectorStage）。typecheck+UI 构建+全套件全绿）
  - 位置：`GroupView.tsx:149-151`、`DialogHost.tsx:48`、`hooks.ts:9`（useEscClose）
  - 修法：这些 onKeyDown 开头加 `if (e.nativeEvent.isComposing || e.keyCode === 229) return`；useEscClose 的 window 监听同样检查。

- [x] **C7 [P2/bug] ESC 无模态层级管理：多层弹窗一键同关；Modal 无焦点 trap/焦点恢复**（✓ 2026-07-14 新建 modalStack.ts：单一 window Esc 监听按挂载顺序只关**栈顶**一层；Modal 与 useEscClose 统一委托 useModalEsc，消除各挂 window 监听导致一次 Esc 连关多层。关键：hooks 不能条件调用，多数模态在 `if(!show)return null` 前调 hook——给 useModalEsc/useEscClose 加 `active` 参数（依赖它增删栈），7 个早返回模态（Timeline/Compose/ProjectLibrary/VideoTrim/Storyboard/MaskInpaint/TemplatePanel）传各自可见性；父级条件挂载的（ProviderSettings/CropModal/Gallery/DialogHost）用默认 true。Modal 加焦点管理：render 阶段捕获 opener（早于子 autoFocus 提交）、挂载聚焦容器（已有 autoFocus 则不抢）、卸载还焦；轻量 Tab 陷阱首尾循环不移出遮罩。CanvasStage 的 Esc 已由 C2 anyModalOpen 守住。VideoStudioModal 自管 capture 相位 Esc 不入栈（保留）。typecheck+UI 构建+全套件全绿）
  - 位置：`src/ui/components/Modal.tsx:20-26`、`hooks.ts:8-12`；连带 `CanvasStage.tsx:543` 的 Escape clearSelection 同帧执行
  - 修法：引入模态栈（zustand 记录打开顺序），ESC 只关栈顶；Modal 挂载时 focus 容器、卸载还焦到 opener。与 C2 的「模态计数器」共用一套状态。先决：C2。

- [x] **C8 [P2/bug] 三处指针交互收尾不完备：pointercancel/源卡卸载时 window 监听与临时状态残留**（✓ 2026-07-14 ①CardView.startConnect：pointermove/up/cancel 从 handle 元素移到 window——源卡在连线拖拽中被删(Delete)时 handle 卸载、Chrome 不派发 lostpointercapture，绑 handle 则 cleanup 永不执行、临时线残留；改 window 后卸载也能收尾（lostpointercapture 保留作正常丢指针兜底）。②GroupView.startResize：补 pointercancel→up（打断也收尾，否则 move 残留继续改尺寸）。③MultiConnectHandle.start：拆出 detach() 清理，补 pointercancel→onCancel（仅清理不连线）。typecheck+UI 构建+全套件全绿）
  - 位置：`GroupView.tsx:71-113`、`MultiConnectHandle.tsx:66-67`、`CardView.tsx:158-198`（startConnect cleanup 全绑在 handle 元素上）
  - 修法：复制同文件 startCardResize 已有的 setPointerCapture+四事件收尾模式；startConnect 的兜底监听放 window 或在 unmount cleanup 调用。

- [x] **C9 [P2/bug] createConnectedNode 绕过 canConnect：便签可连出永远无效的僵尸边**（✓ 2026-07-14 createConnectedNode 建边前对每个 source 过 `canConnect(cards[sid], card).ok`（新节点是 target），与 addEdgeBetween/connectAll 一致——便签/分组源不再建出 buildMaterials 会跳过、却仍在 EdgeLayer 渲染的僵尸边；MultiConnectHandle 的 sources 过滤补 `c.kind !== 'note'`（纵深防御，便签不显示多选连接手柄）。新增 graphStore 用例：从[便签,图片]连出新节点，断言仅图片建边、便签被跳过。typecheck+UI 构建+全套件(33+4+3+4)全绿）
  - 位置：`src/ui/store/graphStore.ts:565-589`、`MultiConnectHandle.tsx:22`（过滤漏 note）
  - 修法：createConnectedNode 建边前逐 source 过 canConnect；MultiConnectHandle 过滤补 `c.kind !== 'note'`。

- [x] **C10 [P2/incomplete] 标注不入 undo 栈也无清空确认，注释却写「即可逆操作」**（✓ 2026-07-14 AnnotationToolbar 清空按钮加 confirmDialog(danger) 二次确认——有标注时才弹（空则直接返回），消除手滑抹掉全部评审批注；确认逻辑放 UI 层保持 clearAnnotations store action 纯净。修正 graphStore 误导注释（明说 BoardSnap 不含 annotations、Ctrl+Z 无法恢复、清空由 UI confirm 兜底）。选清空确认而非「BoardSnap 加 annotations 入 undo」——后者需改快照结构 + 验证标注绘制粒度（每笔 vs 每点，避免逐点刷栈），范围/风险大，严重度主因（一键永久清空）已由确认消除。typecheck+UI 构建+全套件全绿）
  - 位置：`src/ui/store/graphStore.ts:536-539`、`AnnotationToolbar.tsx:49`
  - 修法：最低成本 clearAnnotations 前加 confirmDialog；更完整则 BoardSnap 增加 annotations 并让增删清都 pushHistory，修正注释。

- [x] **C11 [P2/debt] 切换/新建画布 Tab 即清空撤销栈，无提示**（✓ 2026-07-14 单一 past/future 栈改为按 boardId 维护的 `boardHistories: Record<boardId,{past,future}>`：pushHistory/addCard-inline/undo/redo/canUndo/canRedo 全部操作当前(或目标)画布自己的栈；setActiveBoard/addBoard 不再清空（各画布历史独立保留），removeBoard 连带删该画布历史，replaceProject(换工程)清空全部。CanvasControls 的 `s.past.length` reactive 订阅改为派生选择器 `boardHistories[activeBoardId]?.past.length`（唯一外部消费者，DirectorStage 的 canUndo 是 3D 台本地状态无关）。新增 graphStore 用例：A 编辑→新建切 B→切回 A，断言 A 历史保留且 undo 仍生效。typecheck+UI 构建+全套件(33+4+3+5)全绿）
  - 位置：`src/ui/store/graphStore.ts:236-246`
  - 证据：历史快照本身带 boardId（undo 还会跳回对应画布），清空并非结构必需。
  - 修法：按 boardId 维护多份历史栈（改动集中在 push/undo/redo 取栈），或至少切换不清空。先决：C1（undo 语义先修对）。

- [x] **C12 [P2/bug] 任务中心三处脱节：只列活动画布（与顶栏全局计数、跨画布续跑矛盾）；「定位」只改选中不移视口不切画布**（✓ 2026-07-14 ①TaskCenter 从 getActiveBoard 改为遍历 project.boards 全部卡片，与顶栏全局计数/跨画布续跑对齐；②行内对非活动画布任务标注画布名（`· 画布名`）；③定位从 setSelection 改为共用新建的 focusCard(boardId, cardId)——切所属画布+选中+视口居中。提取 Gallery.focus 的居中逻辑到 src/ui/focusCard.ts，Gallery 与 TaskCenter 共用（消除重复）。typecheck+UI 构建+全套件全绿）
  - 位置：`src/ui/components/TaskCenter.tsx:17,48-56`；对照 `TopBar.tsx:19`、`generate.ts:305-320`、Gallery.focus（`Gallery.tsx:31-43`）
  - 修法：改为扫描 project.boards 全部卡片，行内标注画布名；jump 复用 Gallery.focus 逻辑（setActiveBoard→setViewport 居中→选中）。

- [x] **C13 [P2/bug] Provider 密钥保存静默吞错：setKey 失败也 toast「已保存」，且误操作工程保存指示器**（✓ 2026-07-14 providerStore.setKey 返回类型 Promise&lt;void&gt;→Promise&lt;boolean&gt;：encrypted 不可用或写入抛错返回 false（不再 catch 吞成 void）；ProviderSettings.save 改 async 并 `await setKey`——成功才 toast success，失败 toast error「密钥保存失败：系统安全存储不可用」。删除误写的 `useUi.setSaving(false)`（那操作的是工程自动保存指示器，与 Provider 保存无关）。keyVal 加载现有密钥故空值=主动清除，总是写入语义不变。typecheck+UI 构建+全套件全绿）
  - 位置：`src/ui/components/ProviderSettings.tsx:81-87`、`providerStore.ts:92-98`
  - 修法：await setKey 并对失败给出明确错误 toast；删除误写的 `setSaving(false)`。

- [x] **C14 [P2/bug] 删除 Provider 无确认：单击即删配置并销毁加密密钥**（✓ 2026-07-14 ProviderSettings 删除按钮加 confirmDialog(danger)：文案带 Provider 名（draft.label）并说明「将删除…及其已保存的 API Key，不可恢复」——防误点（删除按钮紧邻保存/测试）。remove 会同时删配置+encrypted key，确认后才执行。typecheck+UI 构建+全套件全绿）
  - 位置：`src/ui/components/ProviderSettings.tsx:281-288`
  - 修法：confirmDialog（danger 样式），文案说明「将同时删除已保存的 API Key，不可恢复」。

- [x] **C15 [P2/bug] pollTaskTemplate 不识别完成态：videoUrlPath 配错时任务已成功却空转 10 分钟报「生成超时」**（✓ 2026-07-14 pollTaskTemplate 补 doneValues 判定（`cfg.doneValues || 'completed,succeeded,success'`，与 pollTaskDefault 一致）：状态命中 done 但 videoUrlPath 取不到 URL 时立即抛「任务已完成但未取到结果 URL（请检查 videoUrlPath 配置）」，而非空转到 600s 超时把配错伪装成超时。url 检查在 done 检查之前，配置正确时先 return，done-check 仅在配错场景触发。typecheck+UI 构建+全套件全绿）
  - 位置：`src/ui/services/providers/engine.ts:92-113`；对照默认轮询 `:138-142` 的快速失败
  - 修法：增加 doneValues 判定（`cfg.doneValues || 'completed,succeeded,success'`）：状态命中 done 但取不到 URL 时立即抛「已完成但未找到结果 URL（检查 videoUrlPath）」。

- [x] **C16 [P2/bug] 作品库收录规则偏差：生成中的流式预览图被当成品收录；音频/TTS 成品被排除**（✓ 2026-07-14 收录条件加「非 running/queued」过滤——流式生成期 assetUrl 存半成品预览 dataURL 不再混入作品库；用「非生成中」而非「==done」以保留 idle 的导入素材卡(source)。纳入 audio kind（TTS/配音成品），网格用 Music 图标占位；音频双击跳卡片播放（Lightbox 仅支持图/视频）。typecheck+UI 构建+全套件全绿）
  - 位置：`src/ui/components/Gallery.tsx:24`；对照 `generate.ts:148`（流式把 preview dataURL 写 assetUrl）
  - 修法：过滤条件加 status==='done'；audio 卡纳入收录（波形占位图渲染）。

- [x] **C17 [P2/bug] 作品库「双击预览」不可达：单击 focus() 即 close()，dblclick 永不触发**（✓ 2026-07-14 改为独立预览入口：缩略图右上角悬停放大按钮(Maximize2)触发 preview 并 stopPropagation，单击卡片仍=定位跳卡（会关作品库）。删除永不触发的 onDoubleClick。外层 button→div(role=button,tabIndex,Enter 定位,focus-visible ring) 以避免 button 嵌 button 非法结构。audio 无预览按钮（单击跳卡播放）。typecheck+UI 构建+全套件全绿）
  - 位置：`src/ui/components/Gallery.tsx:42,54-57`
  - 修法：预览改独立入口（缩略图角上放大按钮），或单击仅选中+「定位」按钮。

## 批次 D · 功能缺口补完

- [x] **D1 [P1/incomplete] 画布 Tab 无法重命名/删除：store 的 renameBoard/removeBoard 已实现但全 UI 零调用**（✓ 2026-07-15 TopBar 画布 Tab 加 onDoubleClick→promptDialog 重命名（renameBoard）、onContextMenu→confirmDialog(danger) 删除（removeBoard，boards>1 才允许、preventDefault 屏蔽系统右键菜单）；title 提示「单击切换·双击重命名·右键删除」。store 层现成，纯 UI 接线。typecheck+UI 构建+全套件全绿）
  - 位置：`src/ui/components/TopBar.tsx:51-70`；`graphStore.ts:247,251`
  - 修法：Tab 加右键菜单/双击重命名（promptDialog 现成）+ 删除项（confirmDialog+removeBoard），成本极低。

- [x] **D2 [P1/incomplete] FFmpeg 首次下载无进度反馈（README 承诺「带进度提示」）**（✓ 2026-07-15 toastStore 扩展 pushSticky(不自动消失)+update(原位刷新)+对应导出 toastSticky/toastUpdate/toastDismiss；ensureFfmpeg 的 download 空回调改为用 FFmpegDownloadProgress(phase+percent) 实时更新常驻 toast「FFmpeg 下载中 42%」/「解压中」，终态「已就绪」短暂展示后关闭、失败展示错误。README 承诺的「带进度提示」兑现。typecheck+UI 构建+全套件全绿）
  - 位置：`src/ui/services/mediaVideo.ts:20-21`（进度回调是空函数，toast ~4.7s 即消失）
  - 修法：download 进度回调更新常驻 toast 或任务中心条目（「FFmpeg 下载中 42%」），完成/失败替换终态提示。

> **用户决策（2026-07-15）**：D3/D4/D5 的「有类型无实现」项一律**删除类型/死代码**（不实现）。D 批次全部要做。
> 删除后同步收缩 B12：kenBurns/needsNormalize/baseRotation/bitrate 相关的待补用例取消（因为功能删了）；
> stackIsNoop 例外——它是「空栈导出=原样」的真实优化点，保留并接线（详见 D5）。

- [x] **D3 [P2/incomplete]（决策：删除）Ken-Burns 全链路未实现：类型/预览分支/计划用例都在，编译器与 UI 均空**（✓ 2026-07-15 删除 KenBurns 接口、TransformParams.kenBurns 字段、preview.ts 的 kenBurns→inexact 分支——全库 kenBurns 引用清零，消除「有类型无实现」假象。编译器本就不读该字段，删除不改运行时行为。B12 的 kenBurns+mirror 用例随之取消。typecheck+UI 构建+全套件全绿）
  - 位置：`types.ts:51-58,69`、`preview.ts:60`、`compile.ts:213-277`（applyTransform 不读）
  - 修法（删除）：删 KenBurns 类型与 TransformParams.kenBurns 字段、preview.ts 的 kenBurns→inexact 分支；消除「有类型无实现」假象。B12 的 kenBurns+mirror 用例取消。

- [x] **D4 [P2/incomplete]（决策：删除）needsNormalize/baseRotation 是死字段：VFR/竖屏 rotation 预检完全未做**（✓ 2026-07-15 删 EditStack.baseRotation/needsNormalize 字段、studioStore.open 的 rotation 参数与 `baseRotation: base.rotation` 赋值、setBase Pick 中两字段；清理 recipes.json 两条死数据(transform-crop-blurpad 的 baseRotation:90、export-webm 的 needsNormalize:true)。编译器从不读，删除不改运行时（rotation 仍靠 ffmpeg autorotate 兜底），快照不变。B12 的 needsNormalize/baseRotation 断言取消。typecheck+UI 构建+33 recipe 全绿）
  - 位置：`types.ts:183-184`、`studioStore.ts:103`、`VideoStudioModal.tsx:167`（恒传 undefined）
  - 修法（删除）：删 needsNormalize/baseRotation 两字段及 studioStore.open/setBase 的透传；避免误导维护者以为预检已存在。B12 的 needsNormalize/baseRotation 断言取消。（注：rotation 目前靠 ffmpeg autorotate 兜底，删字段不改运行时行为。）

- [x] **D5 [P2/debt] 剪辑死代码组：stackIsNoop 零调用（空栈也整片重编码）、bitrate/anim/op.label 无实现、单例 op 上移下移无效、run.ts void produced**（✓ 2026-07-15 删除：ExportParams.bitrate、OverlayParams.anim(+DEFAULTS 默认值+preview.ts 的 anim→inexact 块)、OpBase.label(+VideoStudioModal 图层名回退改为纯 OP_KIND_LABEL)、run.ts 的 produced 数组+void produced；moveOp 上/下移箭头改为**仅对 overlay op 渲染**（单例大类顺序被 OP_KIND_ORDER 钉死、reduceStack 取最后启用项，重排无效）。**stackIsNoop 接线**：exportStudio 顶部加 canPassthrough——无编辑 op + 导出无变换(outW/outH/fps/fade) + 格式与源容器一致时直接 fs.copy 源文件，跳过整片重编码（保画质省时），复制失败回落编码。typecheck+UI 构建+33 recipe 全绿。B12 的 bitrate 用例取消、stackIsNoop 保留（属集成脚本层，无法在 compile 快照测）。）
  - 位置：`types.ts:211-213,151,114,162,11`、`studioStore.ts:222`、`VideoStudioModal.tsx:349-353`、`run.ts:55`
  - 修法（删除为主 + stackIsNoop 接线）：删 ExportParams.bitrate、OverlayParams.anim、op.label 改名残余、run.ts 的 void produced；moveOp 箭头仅对 overlay 渲染。**stackIsNoop 保留并接线**：exportStack 开头判 noop 直接复制源为新卡（真实画质优化，非死代码）。B12 的 bitrate 用例取消、stackIsNoop 用例保留。

- [x] **D6 [P2/incomplete] 新手引导「打开模板」指向必然为空的模板库（无内置模板）**（✓ 2026-07-15 新建 builtinTemplates.ts：3 个演示模板（文生图基础链 text→image、图生视频链 image→video、分镜扇出 text→3×image），用 GroupTemplate 格式硬编码、纯结构无产物、id 前缀 builtin-。listTemplates 置顶合并内置+用户模板，新手引导「打开模板」不再指向空列表。TemplatePanel 内置项显示「内置」徽标、隐藏删除按钮；deleteTemplate 拒删内置并**修正潜在 bug**——原 filter 写回的是含内置的 listTemplates 结果、会污染用户存储，改为直接读用户存储过滤。typecheck+UI 构建+全套件全绿）
  - 位置：`CanvasStage.tsx:628`、`templates.ts:8-15`、`TemplatePanel.tsx:50`
  - 修法：内置 2-3 个演示模板（文生图基础链/图生视频链/分镜扇出，纯结构无产物，用现有 GroupTemplate 格式硬编码），listTemplates 合并展示。

- [x] **D7 [P2/incomplete] 工程导出 JSON 不含媒体：跨机迁移后全部裂图**（✓ 2026-07-15 host 无 zip 能力、jszip 是重依赖，采自包含 base64 内嵌方案：新增 `exportProjectWithMedia`——把全部画布卡片的本地媒体读为 base64 装进 `{__ac:'project-with-media',doc,media}` 信封，200MB base64 上限超限拒绝(防撑爆内存)并提示改用 JSON 导出，文件名 .acmedia.json。importProject 兼容信封+裸 doc：含媒体则用现成 saveBase64 写回新工程媒体目录并重写 assetLocalPath/assetUrl/mime，未随附媒体的卡标 meta.mediaMissing。CardView 对 mediaMissing 卡显示琥珀色「媒体缺失」徽标(带解释 title)。ProjectLibrary 加「导出含媒体」按钮(Package 图标)，原 JSON 导出提示改为「仅同机可恢复」。导入 toast 报告恢复/缺失数。typecheck+UI 构建+全套件全绿）
  - 位置：`src/ui/store/projectStore.ts:241`
  - 修法：「导出含媒体」选项——host-worker 把 JSON+media 目录打 zip；至少导入时把缺媒体的卡片标注出来 + README 说明仅同机可恢复。

- [x] **D8 [P2/optimization] 无卡片搜索/按标题定位**（✓ 2026-07-15 新建 CardSearch 面板：按 标题/提示词/文本 过滤全工程卡片（跳过 group），带命中摘要片段、结果上限 50、行内标 kind+画布名；点击结果调 focusCard 切画布+居中。uiStore 加 showSearch 并纳入 anyModalOpen(C2 一致)。TopBar 加搜索图标入口，App 挂载 CardSearch，CanvasStage 加 Ctrl/Cmd+F 快捷键。typecheck+UI 构建+全套件全绿）
  - 位置：确认不存在（全 src/ui 无过滤逻辑）；跳转所需 Gallery.focus 已有
  - 修法：顶栏或作品库加搜索框，按 title/prompt/text 过滤全工程卡片，点击复用 focus 跳转。

- [x] **D9 [P2/optimization] 无批量导出：多选后只能逐卡另存**（✓ 2026-07-16 ContextMenu 加 exportMany：多选≥2 张带媒体卡时显示「导出所选（N）」，showOpenDialog(openDirectory) 选一次目录 → 逐个 filesystem.copy（文件名=标题_序号.ext，去文件系统非法字符、单个失败不阻断），toast 报告 ok/total。单卡仍走原「导出」。typecheck+UI 构建+全套件全绿）
  - 位置：`ContextMenu.tsx:187`（cards.length===1 才显示导出）、NodeEditor 单卡下载
  - 修法：多选时 ContextMenu/BatchActions 加「导出所选（N）」：一次选目录，循环 filesystem.copy，文件名 title+序号。

## 批次 E · 性能优化（大画布体验）

- [x] **E1 [P1/optimization] 索引冻结不覆盖 resize：缩放卡片/分组时每个 pointermove 触发 O(N) 全量重建，且无 rAF 合帧**（✓ 2026-07-16 新建 interactionStore(useInteraction.resizing)：CardView/GroupView resize 开始 setResizing(true)、收尾(cleanup/up)setResizing(false)；CanvasStage 订阅 resizing，frozen 扩展为 `drag || resizing`——resize 期间三个 useMemo(hiddenMembers/cardIndex/edgeIndex) 命中冻结缓存，不再每帧 O(N) 重建，结束翻 false 时 frozen 变化触发按最终尺寸重建一次（天然复用现有 frozen 机制，无需 commitTick）。rAF 合帧未做——pointermove 本就约按帧触发、冻结已消除主要 O(N) 成本，收益边际。typecheck+UI 构建+全套件全绿）
  - 位置：`CanvasStage.tsx:73`（frozen 条件）、`CardView.tsx:208-216`、`GroupView.tsx:74-79`；对照拖动的 dragAcc `CanvasStage.tsx:231-233`
  - 修法：resize 走 rAF 合帧（仿 dragAcc）；冻结条件扩展为「任何连续交互」（resize 开始设 ref 标志，结束 commitTick++ 重建一次，与拖动同构）。

- [x] **E2 [P2/optimization] 拖动吸附每帧全量扫描所有卡片（含屏幕外），未用空间索引**（✓ 2026-07-16 snapping.ts 的 snapBox/computeSnap/computeSnapBox 参数从 `cards: Record` 改为 `candidates: Card[]`；CanvasStage flush 大画布(>VIRTUALIZE_THRESHOLD)用 cardIndexRef.query(worldViewRect 视口外扩 600) 预筛候选——每帧 O(可见) 而非 O(全部)，且天然不吸附到屏外看不见的卡（消除「顿一下却看不到对齐目标」的怪异手感）。小画布保持全量扫描零行为变化。typecheck+UI 构建+全套件全绿）
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
