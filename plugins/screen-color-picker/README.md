# 屏幕取色器（screen-color-picker）

在 Mulby 中从屏幕任意位置快速取色，自动生成 HEX / RGB / HSL，并支持历史色板管理。

## 插件能力

- 屏幕取色：优先调用 `mulby.screen.colorPick()`，若环境不支持则自动回退 `EyeDropper`。
- 一键复制：取色后自动复制 HEX，同时可手动复制 RGB/HSL。
- 历史色板：自动保存最近 24 个颜色到插件存储，支持快速回填当前色值。
- 主题适配：跟随 Mulby 亮/暗色主题切换。

## 触发方式

`manifest.features` 提供 1 个入口：

- `code`: `open_color_picker`
- 关键词：`屏幕取色`、`取色器`、`color picker`、`pick color`

## 使用说明

1. 在 Mulby 输入关键词打开“屏幕取色器”。
2. 点击「开始屏幕取色」，在屏幕上点击目标颜色。
3. 取色成功后会自动复制 HEX，可按需复制 RGB/HSL。
4. 在历史色板中点击任意颜色可恢复为当前色。

## 构建与打包

```bash
cd plugins/screen-color-picker
npm install
npm run icon
npm run build
npm run pack
```

## Mulby 手工验收清单

1. 关键词可唤起插件，且只有一个 feature 入口。
2. 点击「开始屏幕取色」后可以正常拾取屏幕颜色。
3. 取色后 HEX 自动进入剪贴板，RGB/HSL 按钮可正常复制。
4. 历史色板会保留最近颜色，重开插件后仍可读到历史记录。
5. 在亮色和暗色主题下界面均可正常显示。
