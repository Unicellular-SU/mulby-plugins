# 网页翻译

网页翻译是一个 Mulby 插件，用标签页打开常用网页翻译站，并把 Mulby 主搜索框输入或选中的文本自动填入网页左侧源文本输入区。

## 支持站点

- 有道翻译：`https://fanyi.youdao.com/`
- 腾讯翻译：`https://fanyi.qq.com/`
- 百度翻译：`https://fanyi.baidu.com/`
- Google Translate：`https://translate.google.com/`
- DeepL：`https://www.deepl.com/translator`
- Bing 翻译：`https://www.bing.com/translator`
- 搜狗翻译：`https://fanyi.sogou.com/text`
- 彩云小译：`https://fanyi.caiyunapp.com/`
- Yandex Translate：`https://translate.yandex.com/`
- Papago：`https://papago.naver.com/`
- Reverso：`https://www.reverso.net/text-translation`
- 小牛翻译：`https://niutrans.com/trans`
- 金山词霸：`https://www.iciba.com/translate`

默认显示有道翻译、腾讯翻译、百度翻译和 Google Translate。可以在插件内点击齿轮按钮弹出配置窗口，启用更多内置站点或添加自定义网页翻译站点。自定义站点会使用通用输入框规则尝试自动填入文本。

## 使用方式

1. 在 Mulby 主搜索框输入任意待翻译文本，选择“网页翻译”候选项。
2. 插件打开后，顶部选择翻译站点。
3. 页面加载完成后，插件会尝试自动填入文本。
4. 如果网页结构变化导致自动填入失败，可以点击“打开”使用 Mulby 内置浏览器备用路径。
5. 点击齿轮按钮可启用/禁用站点、添加自定义站点或恢复默认站点列表。

也可以输入关键词 `网页翻译`、`web-translate` 或 `web translator` 打开插件。

## 已知限制

- 首版只填入源文本，不控制源语言或目标语言。
- 第三方翻译站的 DOM、登录状态、人机验证、地区网络限制或安全策略可能导致自动填入失败。
- 部分翻译站是长连接或 SPA 页面，插件按 `webview` 生命周期事件判断页面可注入和加载状态。
- 插件已声明 `permissions.webview: true`；嵌入式网页依赖宿主按该权限启用 Electron `webview`。如果当前宿主未授权或未启用，插件会显示备用打开入口。

## 开发

```bash
npm install
npm run build
npm run pack
```

## Mulby 验收清单

- 输入 `hello world`，选择“网页翻译”，确认插件打开并带入文本。
- 依次切换内置翻译站点，确认页面加载后尝试自动填入。
- 点击齿轮按钮，确认配置窗口覆盖在网页上方且不挤压 webview；禁用/启用站点并添加一个自定义站点，确认顶部标签页同步更新。
- 输入中文、英文、多行文本分别验证。
- 在嵌入网页不可用的宿主环境中，点击“打开”确认内置浏览器备用路径可用。
