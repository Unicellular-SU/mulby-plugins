# Notes: PDF Tools 六项优先优化

## Baseline Findings
- `manifest.json` 当前仅声明 `split`，但 UI 实际包含 9 个功能页面。
- `src/main.ts` 仅做加载与通知，未实现 `getPendingInit`，与 UI 调用不一致。
- `README.md` 为模板内容，缺少真实功能说明与限制说明。
- `src/ui/services/PDFService.ts` 多处手工处理路径分隔符，存在跨平台风险。
- 缩略图与文档加载缺少缓存策略，重复渲染较多。
- `preload.cjs` 引入了未使用依赖，日志 append 未做轮转。

## Planned Changes
- 更新 `manifest.json`：补全 feature 列表与触发词。
- 重写 `src/main.ts`：实现 pending init 缓存与 host 方法。
- 更新 `src/ui/App.tsx`：featureCode -> route 映射。
- 更新 `src/ui/pages/SplitPDF.tsx`：初始化后消费 pending init。
- 更新 `src/ui/services/PDFService.ts`：统一输出路径 helper + LRU 缓存。
- 更新 `preload.cjs` 与 `src/ui/types.ts`：新增/对齐 API，清理冗余依赖与日志策略。
- 重写 `README.md`：真实功能、限制、开发/验收指南。

## Execution Result
- 所有计划改动已完成。
- `npm run build` 通过（backend + UI）。
- `ReadLints` 检查无新增报错。
