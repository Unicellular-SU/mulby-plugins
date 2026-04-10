# Deliverable: PDF Tools 六项优先优化

## 完成范围

1. 契约一致性（`manifest`）
2. 后端初始化路由（`main`）
3. README 文档重写
4. 路径拼接统一改造（`PDFService + preload`）
5. 性能优化（文档与缩略图缓存）
6. preload 清理与日志轮转

## 核心改动

- `manifest.json`
  - 插件名称/描述升级为通用 PDF 工具箱。
  - 补齐 `merge/split/compress/watermark/extract-img/pdf-to-img/pdf-to-word/pdf-to-ppt/pdf-to-excel` 九个 feature。
  - 每个 feature 增加关键词触发和 `files` 触发规则，并配置 `route` 与 `mode`。

- `src/main.ts`
  - 实现 feature 到 route 的映射。
  - `run()` 记录 `pendingInit`（含 `featureCode/route/input/attachments`）。
  - 新增 host 可调用方法：`getPendingInit`、`clearPendingInit`。

- `src/ui/App.tsx` 和 `src/ui/pages/SplitPDF.tsx`
  - 初始化时优先按 route/featureCode 跳转到对应页面。
  - `SplitPDF` 成功消费初始化输入后清理 pending init，避免残留。

- `src/ui/services/PDFService.ts`
  - 增加文档缓存（最多 4 个）与缩略图缓存（最多 120 个）。
  - 封装统一输出路径拼接函数，替换多处手工分隔符拼接逻辑。

- `preload.cjs`
  - 移除未使用依赖（`docx`、`pptxgenjs`、`xlsx`）。
  - 增加 `joinPath` API 供前端统一路径拼接。
  - 日志增加 1MB 轮转策略，避免 `debug.log` 无限制增长。

- `src/ui/types.ts`
  - 对齐 `window.pdfApi` 类型声明，补全 `joinPath/getFileSize/getPDFImagePreview/extractPDFImages`。

- `README.md`
  - 以真实功能重写：功能清单、触发方式、输出规则、已知限制、开发命令和验收建议。

## 验证结果

- 构建命令：`npm run build`
- 结果：通过（backend 与 UI 均构建成功）
- Lints：无新增错误

## 后续建议

- 下一步可继续把 `PDFToImage`、`ExtractImages` 页面中的目录拼接也逐步切换到 `joinPath`，彻底消除页面侧手工路径字符串。
- 若后续引入 OCR，建议把 OCR 计算下沉到 backend worker 或独立 host 方法，避免阻塞 UI。
