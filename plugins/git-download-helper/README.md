# Git下载助手

将 GitHub 文件链接一键拼接国内加速前缀，并优先唤起本机下载工具下载；如果未配置下载工具，则自动回退到浏览器下载。

## 功能说明

- 支持识别 `github.com` 与 `raw.githubusercontent.com` 链接。
- 自动将 `github.com/<owner>/<repo>/blob/...` 转换为 `raw.githubusercontent.com/...` 可下载地址。
- 默认加速前缀为 `https://gh-proxy.com/`，可按需修改。
- 可配置外部下载器命令与参数模板（支持 `{url}` 占位符）。
- 无下载器配置或调用失败时，自动使用浏览器打开下载链接。

## 使用方法

### 1) 直接下载

- 方式 A：在 Mulby 输入 GitHub 链接，选择 `加速下载 GitHub 链接`。
- 方式 B：先复制 GitHub 链接，再输入关键词 `git下载助手` 触发。

插件会：
1. 规范化 GitHub 链接；
2. 拼接加速前缀；
3. 优先调用下载器；
4. 回退浏览器（如果下载器未配置或执行失败）。

### 2) 配置加速前缀

```text
gdh prefix https://gh-proxy.com/
```

### 3) 配置下载器

设置下载器命令：

```text
gdh cmd IDMan.exe
```

设置参数模板（`{url}` 会被替换为加速后的链接）：

```text
gdh args /d "{url}" /n /a /s
```

清除下载器配置（回退浏览器下载）：

```text
gdh clear
```

查看当前配置：

```text
gdh config
```

## 示例

- 输入：`https://github.com/owner/repo/blob/main/dist/app.zip`
- 输出下载链接：`https://gh-proxy.com/https://raw.githubusercontent.com/owner/repo/main/dist/app.zip`

## 依赖与前置条件

- 需要在 Mulby 环境中运行（使用 `api.storage` 与 `api.shell`）。
- 若要唤起第三方下载器，请确保下载器命令可在系统环境中执行。

## 开发

```bash
pnpm install
pnpm run build
```

推荐在仓库根目录使用 workspace 方式执行（更符合本仓库）：

```bash
pnpm install --filter git-download-helper...
pnpm --filter git-download-helper run build
```

打包：

```bash
pnpm run pack
```

仓库根目录等价命令：

```bash
pnpm --filter git-download-helper run pack
```
