# QR 代码助手插件进展

## 最新更新：增加二维码生成 AI 能力（2026-03-23）

**任务目标：**
在 `qrcode-helper` 插件中增加 AI 工具，使得 AI 可以通过传入文本，调用该工具生成 base64 格式的二维码图片。

**完成内容：**
1. **依赖安装**：在 `qrcode-helper` 项目中安装了 `qrcode` 及其类型定义 `@types/qrcode`，用于在 Node 端生成二维码。
2. **声明工具**：在 `manifest.json` 中加入了 `tools` 字段，声明了名为 `generate_qrcode` 的 AI 插件能力，定义了明确的输入和输出 schema。
3. **注册运行时逻辑**：修改了 `src/main.ts` 中的 `onLoad` 及 `onUnload` 生命周期钩子：
   - 补充了 `PluginContext.api.tools` 的类型声明。
   - 使用 `api.tools.register('generate_qrcode', ...)` 注册了工具处理器。
   - 添加了错误捕获并使用 `qrcode.toDataURL()` 将文本渲染为带有 margin 的 base64 图片格式并返回。
4. **代码评审修复**：根据评审反馈，将工具的注册从 `onEnable` 转移至 `onLoad` 中执行，以匹配系统首发并初始化工具时的加载时机要求。同样地将注销操作移入 `onUnload`。

**下一步/测试建议：**
- 重新启动或加载该插件。
- 在 AI 会话中直接发送测试请求（例如：“将 `hello world` 转换成二维码图片发给我”），以验证链路是否生效及 AI 是否能成功拿到 `base64Image` 参数。
