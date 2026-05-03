# Ctool for Mulby

把开源项目 [Ctool](https://github.com/baiy/Ctool) 适配为 Mulby 插件。Ctool 是一套面向开发者的常用工具集合，包含哈希、加密/解密、编码转换、JSON、二维码、代码格式化、单位换算、正则、文本处理等能力。

本插件不修改 `upstream/Ctool` 原始源码。适配方式是先按 Ctool 官方构建流程产出静态前端，再复制到本插件的 `ui/` 目录，由 Mulby 的 `manifest.json`、`src/main.ts` 和打包流程提供插件外壳。

## 支持功能

- 哈希：MD5、SHA、SM3、批量处理、文件输入。
- 加密/解密：AES、DES、RC4、Rabbit、TripleDES、SM2、SM4、RSA 等。
- 编码转换：Base64、URL、Unicode、HTML、Punycode、Hex/String。
- JSON 工具：格式化、压缩、校验、转义、Unicode、GET 参数、对象生成等。
- 二维码和条形码：生成与解析。
- 代码格式化：JS、TS、HTML、CSS、Markdown、JSON、XML、YAML、SQL 等。
- 文本与开发工具：正则、变量名转换、时间戳、UUID、进制转换、单位换算、JWT、文本处理、差异对比等。
- 部分网络相关工具保留 Ctool 原有行为，是否可用取决于当前网络和跨域限制。

## 触发方式

在 Mulby 中输入以下任一关键词打开：

- `ctool`
- `开发工具`
- `程序工具`
- `json工具`
- `base64`
- `hash`
- `时间戳`

打开后使用 Ctool 内置搜索框或左侧分类进入具体工具。

## 构建

首次构建需要先准备 Ctool 原项目：

```bash
cd upstream/Ctool
pnpm install --frozen-lockfile
pnpm run build
```

然后构建插件：

```bash
cd plugins/ctool
pnpm run build
```

`pnpm run build:ui` 会执行 `scripts/sync-ctool-ui.mjs`，把 `upstream/Ctool/packages/ctool-core/dist` 同步到 `plugins/ctool/ui`。

## 打包

```bash
cd plugins/ctool
pnpm run icon
pnpm run build
pnpm run pack
```

生成物为 `ctool-1.0.0.inplugin`。

## 项目结构

```text
ctool/
|-- manifest.json              # Mulby 插件合约
|-- package.json
|-- src/
|   |-- main.ts                # Mulby 后端入口
|   `-- types/mulby.d.ts
|-- scripts/sync-ctool-ui.mjs  # 同步 Ctool 静态构建产物
|-- assets/icon.svg            # 可编辑图标源
|-- icon.png                   # 插件图标
|-- ui/                        # Ctool 静态前端产物，构建时生成
`-- README.md
```

## 已知限制

- 当前适配使用 Ctool 的 Web 运行时，不伪装或复用 uTools 运行时；动态 uTools 关键字功能未移植。
- Ctool 中需要访问外网或第三方接口的工具仍受网络、跨域策略和接口可用性影响。
- 剪贴板能力沿用浏览器/Electron renderer 的 `navigator.clipboard` 行为，可能需要宿主授权。

## 来源与许可证

- 上游项目：<https://github.com/baiy/Ctool>
- 上游版本：`2.4.0`
- 上游许可证：MIT License
