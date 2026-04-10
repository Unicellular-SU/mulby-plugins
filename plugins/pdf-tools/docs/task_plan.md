# Task Plan: PDF Tools 六项优先优化

## Goal
完成契约一致性、初始化路由、文档完善、路径统一、性能优化、preload 清理六项优化，并通过构建验证。

## Phases
- [x] Phase 1: Plan and setup
- [x] Phase 2: Research/gather information
- [x] Phase 3: Execute/build
- [x] Phase 4: Review and deliver

## Key Questions
1. `manifest`、`main`、UI 初始化是否已形成一致的 feature 契约？
2. 路径拼接和 PDF 缓存是否能在不改产品行为的前提下提升稳定性与性能？
3. preload 精简后是否仍覆盖前端所需 API？

## Decisions Made
- 使用 `docs/task_plan.md` 与 `docs/notes.md` 追踪本次改造过程。
- 优先先修契约层（`manifest` + `main` + init 路由），再做实现层优化。
- 在 `PDFService` 增加轻量 LRU 缓存，优先减少重复渲染带来的 UI 卡顿。
- 在 preload 增加 `joinPath`，逐步统一跨平台路径拼接方式。

## Errors Encountered
- 暂无。

## Status
**Completed** - 六项优先优化已实现并通过构建与 lints 检查。
